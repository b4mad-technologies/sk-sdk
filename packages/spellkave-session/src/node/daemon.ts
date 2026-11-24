// Session daemon host (#1990 decision 3/4): one process, one binding, one
// live session, dispatching `invoke` frames against the PLAYER tool registry
// over a unix socket. Split into two layers so the protocol logic is
// testable without a live SpacetimeDB node:
//
//   - `SessionDispatcher` — pure frame-in/response-out + idle bookkeeping.
//     No `node:net`, no live session. Tests drive it directly.
//   - `serveDaemon` — binds the socket, wires `JsonlFrameDecoder` to the
//     dispatcher, and owns the idle-check loop. Accepts an already-built
//     tool list, so tests can prove the real IPC roundtrip over a real
//     temp-dir unix socket with a FAKE tool registry — no live node.
//   - `startDaemon` — the production entry point: opens ONE session (core
//     `openSession`), builds the shared PLAYER tools from it, and
//     delegates to `serveDaemon`.
//
// CRITICAL invariant (mirrors `packages/spellkave-cli`'s
// `registry-parity.test.ts`): no registry tool name may appear as a string
// literal anywhere in this file. Every tool this daemon can invoke comes from
// `createPlayerFacingTools`'s own registration order — adding a tool to that
// registry makes it callable here with zero edits, exactly like `sk`.

import { unlinkSync } from "node:fs";
import * as net from "node:net";

import { asEntityRef, snapshotDb } from "@spellkave/sdk";
import { PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import type { TSchema } from "typebox";
import { Check as typeboxCheck, Errors as typeboxErrors } from "typebox/value";

import { createCallerSessionTools } from "../authoring/caller-tools";
import type { SessionBinding } from "../binding.ts";
import type { ToolResult } from "../player-tools/tool-registry.ts";
import { type OpenSessionDeps, openSession } from "../session.ts";
import {
	createSessionCausalTelemetry,
	createSessionRunObserver,
	OFF_SESSION_RUN_OBSERVER,
	parseRunEventsMode,
	resolveReducerAttemptTelemetry,
	resolveWorldActorMetrics,
	type SessionRunObserver,
} from "./observability.ts";
import {
	socketPath as deriveSocketPath,
	ensureParentDir,
	restrictSocketPermissions,
} from "./paths.ts";
import {
	encodeFrame,
	type InvokeRequest,
	isRequest,
	JsonlFrameDecoder,
	PROTOCOL_VERSION,
	type Response,
	requestId,
} from "./protocol.ts";
import { createSessionWorldEventFeed, type SessionWorldEventFeed } from "./world-events.ts";

/** Default idle window: no frame handled for this long -> clean close (ssh ControlPersist's equivalent). */
export const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
/** How often a live daemon ships `exporter_heartbeats_total` with no player request. */
export const DEFAULT_METRICS_HEARTBEAT_INTERVAL_MS = 15_000;

// The contract roster is ordered and has been frozen by the pre-cut baseline;
// derive the orient audit target from it instead of importing a companion
// schema/name constant. This keeps session protocol routing tied to the same
// canonical descriptor source MCP publishes.
const PLAYER_ORIENT_TOOL_NAME = PLAYER_TOOL_NAMES[0] ?? "";

/**
 * The minimal shape the dispatcher needs from a registry tool. `execute`'s
 * `params` type is deliberately `never` rather than `unknown` — this is the
 * same escape hatch used by heterogeneous runtime `BoundTool` registries:
 * `never` is assignable to each concrete tool parameter under
 * contravariance. The dispatcher
 * still only ever calls `execute` after validating `params` against the
 * tool's own `parameters` schema, so no unvalidated JSON reaches a tool body.
 */
export interface InvokableTool {
	readonly name: string;
	readonly parameters: TSchema;
	execute(toolCallId: string, params: never): Promise<ToolResult<unknown>>;
}

export interface DispatcherOptions {
	binding: SessionBinding;
	tools: readonly InvokableTool[] | (() => readonly InvokableTool[]);
	idleTimeoutMs?: number;
	/** Injectable clock for tests. Defaults to `Date.now`. */
	now?: () => number;
	/** Invoked once, after a `shutdown` op has been accepted and responded to. */
	onShutdown?: () => void;
	/** Session-run observability (#2003): `invoke` dispatch is wrapped with the
	 * observer's `tool_call` events, and its `status` is echoed in the `status`
	 * frame. Defaults to the `off` no-op so callers that don't care (most
	 * existing tests) see no behavior change. */
	observability?: SessionRunObserver;
	/** sk-0m4.22: the daemon's ONE WorldEventBuilder, constructed by
	 * `startDaemon` and held for the whole process lifetime. Tests that don't
	 * care (the fake-registry IPC suite) omit this and get no `pushes` field. */
	pushes?: SessionWorldEventFeed;
	/** sk-uglp: whether the live world connection behind these tools is still
	 * up. Echoed as `status.subscribed`; defaults to always-true for the
	 * fake-registry test seam. */
	connected?: () => boolean;
}

/**
 * Pure protocol dispatch: given a decoded frame, produce a response. Tracks
 * last-activity for the idle timeout independently of any transport — a
 * caller (test or `serveDaemon`) drives it by calling `handle()`.
 */
export class SessionDispatcher {
	readonly binding: SessionBinding;
	readonly idleTimeoutMs: number;
	private readonly tools: readonly InvokableTool[] | (() => readonly InvokableTool[]);
	private readonly now: () => number;
	private readonly startedAt: number;
	private readonly onShutdown: (() => void) | undefined;
	private readonly observability: SessionRunObserver;
	private readonly pushFeed: SessionWorldEventFeed | undefined;
	private readonly connected: () => boolean;
	private lastActivityAt: number;
	/** One serial PLAYER execution lane, shared by every socket frame. */
	private invokeTail: Promise<void> = Promise.resolve();

	constructor(options: DispatcherOptions) {
		this.binding = options.binding;
		this.tools = options.tools;
		this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
		this.now = options.now ?? Date.now;
		this.onShutdown = options.onShutdown;
		this.observability = options.observability ?? OFF_SESSION_RUN_OBSERVER;
		this.pushFeed = options.pushes;
		this.connected = options.connected ?? (() => true);
		this.startedAt = this.now();
		this.lastActivityAt = this.startedAt;
	}

	/** Milliseconds since the last frame this dispatcher handled. */
	idleForMs(): number {
		return this.now() - this.lastActivityAt;
	}

	isIdle(): boolean {
		return this.idleForMs() >= this.idleTimeoutMs;
	}

	async handle(raw: unknown): Promise<Response> {
		this.lastActivityAt = this.now();
		if (!isRequest(raw)) {
			return {
				id: requestId(raw) ?? -1,
				ok: false,
				error: { message: "malformed request frame", code: "bad_request" },
			};
		}
		switch (raw.op) {
			case "list_tools":
				return { id: raw.id, ok: true, result: this.currentTools().map((tool) => tool.name) };
			case "hello":
				return {
					id: raw.id,
					ok: true,
					result: { protocol: PROTOCOL_VERSION, binding: this.binding },
				};
			case "status":
				return {
					id: raw.id,
					ok: true,
					result: {
						binding: this.binding,
						uptimeMs: this.now() - this.startedAt,
						// True once `startDaemon` built this dispatcher (after
						// `openSession`'s subscribe-on-connect resolved) — UNTIL the
						// world connection drops (sk-uglp): a daemon that lost its
						// world closes itself, but a `status` racing that close must
						// not report a live subscription.
						subscribed: this.connected(),
						// #2003: ambient observability config must be visible, not just
						// inferable — same posture as the #2002 profile announce. Additive
						// field only; every existing `status` consumer keeps working.
						observability: this.observability.status,
					},
				};
			case "shutdown": {
				// Respond before tearing down, on the next microtask — the ack must
				// land on the wire before `serveDaemon` closes the socket under it.
				queueMicrotask(() => this.onShutdown?.());
				return this.withPushes({ id: raw.id, ok: true, result: {} });
			}
			case "drain_pushes":
				// Explicit drain (sk-0m4.22 bonus): same piggyback as every other
				// op, with an empty result so `sk events --drain` has a dedicated
				// request that does not invent a PLAYER tool name.
				return this.withPushes({ id: raw.id, ok: true, result: {} });
			case "invoke":
				return this.enqueueInvoke(raw);
		}
	}

	/**
	 * The daemon, not an HTTP adapter, owns PLAYER serialization. This keeps
	 * reducer/event ordering stable when two clients send frames concurrently;
	 * `invoke()` drains/takes WorldEvents before releasing the next tool.
	 *
	 * sk-0m4.121: a tool may hand the lock back EARLY through
	 * {@link releaseCurrentInvoke} once its ordering-relevant work is done —
	 * the `communicate` reply window (`tool-player`'s `awaitConversationReply`)
	 * does, after the reducer settled, so a read that arrives during the window
	 * is served instead of queueing behind it into the gateway's fast-fail.
	 * The lock holder is unambiguous by construction (one invoke body at a
	 * time), so a single field, not per-call plumbing, identifies it.
	 */
	private async enqueueInvoke(request: InvokeRequest): Promise<Response> {
		const previous = this.invokeTail;
		let release: (() => void) | undefined;
		this.invokeTail = new Promise<void>((resolve) => {
			release = resolve;
		});
		await previous;
		this.currentInvokeRelease = release;
		try {
			return await this.invoke(request);
		} finally {
			// Idempotent: a no-op if the tool already released via
			// `releaseCurrentInvoke`, and never clears a SUCCESSOR's release.
			if (this.currentInvokeRelease === release) this.currentInvokeRelease = undefined;
			release?.();
		}
	}

	/** Release function of the invoke currently holding the serialisation
	 * lock; `undefined` between invokes or after an early release. */
	private currentInvokeRelease: (() => void) | undefined;

	/**
	 * sk-0m4.121: let the NEXT queued invoke run while the current tool body
	 * is still finishing. Safe only once the caller has no ordering-relevant
	 * work left (no reducer call, no consequence take) — its remaining reads
	 * of the shared `WorldEventBuilder` are single-threaded and each
	 * `takeWhere`/`drain` is atomic, so interleaving with the next invoke's
	 * drain is zero-loss (the `takeWhere` carry contract). A second call
	 * before the next invoke acquires the lock is a no-op.
	 */
	releaseCurrentInvoke(): void {
		const release = this.currentInvokeRelease;
		this.currentInvokeRelease = undefined;
		release?.();
	}

	/** Attach pending WorldEvents as an additive `pushes` field. Omitted when
	 * there is no feed (test seam) or the drain is empty — never `[]`. */
	private withPushes(response: Response, auditVisibleTraces = false): Response {
		const pushes = this.drainPushes(auditVisibleTraces);
		if (pushes === undefined) return response;
		return { ...response, pushes };
	}

	private drainPushes(auditVisibleTraces: boolean): readonly unknown[] | undefined {
		if (this.pushFeed === undefined) return undefined;
		const pushes = this.pushFeed.drain({ auditVisibleTraces });
		return pushes.length === 0 ? undefined : pushes;
	}

	private currentTools(): readonly InvokableTool[] {
		return typeof this.tools === "function" ? this.tools() : this.tools;
	}

	private async invoke(request: InvokeRequest): Promise<Response> {
		const tool = this.currentTools().find((candidate) => candidate.name === request.tool);
		if (tool === undefined) {
			return this.withPushes({
				id: request.id,
				ok: false,
				error: { message: `unknown tool ${request.tool}`, code: "unknown_tool" },
			});
		}
		if (!typeboxCheck(tool.parameters, request.args)) {
			const errors = [...typeboxErrors(tool.parameters, request.args)];
			return this.withPushes({
				id: request.id,
				ok: false,
				error: {
					message: `invalid parameters for ${request.tool}: ${errors
						.map((e) => `${e.instancePath || "/"} ${e.message}`)
						.join("; ")}`,
					code: "bad_request",
				},
			});
		}
		try {
			const result = await this.observability.observeToolCall(
				request.tool,
				() => tool.execute(String(request.id), request.args as never),
				request.causal_context,
			);
			return this.withPushes(
				{ id: request.id, ok: true, result },
				request.tool === PLAYER_ORIENT_TOOL_NAME,
			);
		} catch (err) {
			return this.withPushes(
				{
					id: request.id,
					ok: false,
					error: {
						message: err instanceof Error ? err.message : String(err),
						code:
							err instanceof Error && "code" in err && typeof err.code === "string"
								? err.code
								: "tool_error",
					},
				},
				request.tool === PLAYER_ORIENT_TOOL_NAME,
			);
		}
	}
}

export interface DaemonHandle {
	readonly socketPath: string;
	readonly dispatcher: SessionDispatcher;
	/**
	 * Idempotent. Closes the socket, cancels the idle timer, ends the run
	 * observer with `terminal` (default `"shutdown"`), and runs `onClose`
	 * (session teardown).
	 */
	close(terminal?: string): Promise<void>;
}

export interface ServeDaemonOptions {
	binding: SessionBinding;
	tools: readonly InvokableTool[] | (() => readonly InvokableTool[]);
	socketPath: string;
	idleTimeoutMs?: number;
	now?: () => number;
	/** How often the idle check re-arms; defaults to the idle timeout itself. */
	idleCheckIntervalMs?: number;
	/** How often to ship an unconditional metrics heartbeat; `0` disables. */
	metricsHeartbeatIntervalMs?: number;
	/** Torn down exactly once, from whichever trigger closes the daemon first. */
	onClose?: () => void;
	/** #2003: forwarded to the dispatcher and ended exactly once on close. */
	observability?: SessionRunObserver;
	/** sk-0m4.22: forwarded to the dispatcher. Production `startDaemon` always
	 * supplies one; the fake-registry test seam omits it. */
	pushes?: SessionWorldEventFeed;
	/** sk-uglp: forwarded to the dispatcher's `status.subscribed`. */
	connected?: () => boolean;
}

/**
 * Bind `socketPath`, wire JSONL framing to a `SessionDispatcher`, and run the
 * idle-check loop. Takes an already-built tool list — the live-node-free
 * seam `@spellkave/session-node-tests` exercises with a fake registry.
 */
export function serveDaemon(options: ServeDaemonOptions): Promise<DaemonHandle> {
	ensureParentDir(options.socketPath);
	removeSocketFileIfPresent(options.socketPath);

	let closed = false;
	let idleTimer: ReturnType<typeof setTimeout> | undefined;
	let metricsHeartbeatTimer: ReturnType<typeof setInterval> | undefined;

	const dispatcher = new SessionDispatcher({
		binding: options.binding,
		tools: options.tools,
		...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
		...(options.now === undefined ? {} : { now: options.now }),
		...(options.observability === undefined ? {} : { observability: options.observability }),
		...(options.pushes === undefined ? {} : { pushes: options.pushes }),
		...(options.connected === undefined ? {} : { connected: options.connected }),
		onShutdown: () => {
			void close("shutdown");
		},
	});

	const server = net.createServer((socket) => {
		const decoder = new JsonlFrameDecoder();
		socket.setEncoding("utf8");
		socket.on("data", (chunk: string) => {
			for (const frame of decoder.push(chunk)) {
				void dispatcher.handle(frame).then((response) => {
					if (!socket.destroyed) socket.write(encodeFrame(response));
				});
			}
		});
		// A peer that vanishes mid-write is not a daemon-lifecycle event on its
		// own — the idle timer, not a single connection's socket error, decides
		// whether this daemon keeps running (other clients may still be live).
		socket.on("error", () => {});
	});

	async function close(terminal = "shutdown"): Promise<void> {
		if (closed) return;
		closed = true;
		if (idleTimer !== undefined) clearTimeout(idleTimer);
		if (metricsHeartbeatTimer !== undefined) clearInterval(metricsHeartbeatTimer);
		await new Promise<void>((resolve) => server.close(() => resolve()));
		removeSocketFileIfPresent(options.socketPath);
		await options.observability?.end(terminal);
		options.onClose?.();
	}

	function scheduleIdleCheck(): void {
		const interval = options.idleCheckIntervalMs ?? dispatcher.idleTimeoutMs;
		idleTimer = setTimeout(() => {
			if (dispatcher.isIdle()) {
				void close("idle_timeout");
				return;
			}
			scheduleIdleCheck();
		}, interval);
		idleTimer.unref?.();
	}

	function startMetricsHeartbeat(): void {
		const observer = options.observability;
		if (observer === undefined) return;
		const interval = options.metricsHeartbeatIntervalMs ?? DEFAULT_METRICS_HEARTBEAT_INTERVAL_MS;
		if (interval <= 0) return;
		void observer.heartbeatMetrics();
		metricsHeartbeatTimer = setInterval(() => {
			void observer.heartbeatMetrics();
		}, interval);
		metricsHeartbeatTimer.unref?.();
	}

	return new Promise<DaemonHandle>((resolve, reject) => {
		server.once("error", reject);
		server.listen(options.socketPath, () => {
			restrictSocketPermissions(options.socketPath);
			scheduleIdleCheck();
			startMetricsHeartbeat();
			resolve({ socketPath: options.socketPath, dispatcher, close });
		});
	});
}

function removeSocketFileIfPresent(path: string): void {
	try {
		unlinkSync(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
	}
}

export interface StartDaemonOptions {
	binding: SessionBinding;
	/** Select events only when the client has a suitable event return channel. */
	replyDelivery?: "bundled" | "events";
	token?: string;
	idleTimeoutMs?: number;
	socketPath?: string;
	onDiagnostic?: OpenSessionDeps["onDiagnostic"];
	/** Source of `SPELLKAVE_RUN_EVENTS`/`CAMPAIGN_ARTIFACTS_ROOT`/OTLP env vars
	 * (#2003); defaults to `process.env`. `spawn.ts` snapshots the daemon's
	 * whole environment at spawn time, so this reflects that snapshot. */
	env?: NodeJS.ProcessEnv;
	/** sk-uglp: invoked once, AFTER the daemon closed itself because its world
	 * connection was lost (wipe/redeploy/host restart). The process entry uses
	 * it to exit, so nothing keeps a dead session's process alive. */
	onWorldConnectionLost?: () => void;
}

/**
 * sk-0m4.73: the daemon-level override for the companion `communicate` reply
 * window. `SPELLKAVE_REPLY_WINDOW_MS` (a positive finite number of
 * milliseconds) wins when set. Otherwise this returns `undefined`, leaving
 * the companion layer to compute its tick-scaled fallback from the live
 * session estimator.
 */
export function resolveReplyWindowMs(env: NodeJS.ProcessEnv): number | undefined {
	const raw = env.SPELLKAVE_REPLY_WINDOW_MS;
	if (raw !== undefined && raw.trim() !== "") {
		const parsed = Number(raw);
		if (Number.isFinite(parsed) && parsed > 0) return parsed;
	}
	return undefined;
}

/**
 * sk-0m4.121: upper bound on the DEFAULT (tick-scaled) `communicate` reply
 * window — for THIS host only. The hosted gateway fast-fails every daemon
 * invoke at `SESSION_INVOKE_FAST_FAIL_MS` (12 s,
 * `packages/spellkave-mcp/src/runtime.ts`); a synchronous wait longer than
 * that never reaches the player anyway — the gateway has already answered
 * `awaiting_response=true` and the reply lands as a `speech_heard` world event
 * on the next call. A slow world can yield a tick-scaled timeout of roughly 100 seconds
 * (2 × tick interval), so every act wedged the invoke queue for the whole
 * window. 8 s leaves framing headroom under 12 s.
 *
 * In-process hosts (pi extension, the adventure story recorder) never go
 * through the daemon and keep the full tick-scaled default — the cap is not
 * a tool-player default.
 */
export const DAEMON_REPLY_WINDOW_CAP_MS = 8_000;

/**
 * The daemon's reply-window slice of `SpellkaveWorldEventsContext`: an
 * explicit `SPELLKAVE_REPLY_WINDOW_MS` wins, uncapped; otherwise only the cap
 * is passed and tool-player bounds its tick-scaled default by it.
 */
export function resolveReplyWindowOptions(
	env: NodeJS.ProcessEnv,
): { replyWindowMs: number } | { replyWindowCapMs: number } {
	const replyWindowMs = resolveReplyWindowMs(env);
	return replyWindowMs === undefined
		? { replyWindowCapMs: DAEMON_REPLY_WINDOW_CAP_MS }
		: { replyWindowMs };
}

/**
 * Production entry point: open ONE session for `binding`, bind its PLAYER
 * tools, and serve them over the binding's derived socket. This is what
 * `daemon-entry.ts` (the process `spawn.ts` launches) calls.
 *
 * Observability (#2003): `SPELLKAVE_RUN_EVENTS` is parsed FIRST — an
 * unrecognized value refuses to start before a session is even opened. The
 * reducer-attempt tracer must exist before `openSession` (the actor client
 * needs it at construction); the run-events emitter is built AFTER
 * `openSession` succeeds, so a daemon that never finished starting never
 * leaves behind a half-open run.
 */
export async function startDaemon(options: StartDaemonOptions): Promise<DaemonHandle> {
	const env = options.env ?? process.env;
	const runEventsMode = parseRunEventsMode(env);
	const reducerAttemptTelemetry = resolveReducerAttemptTelemetry({ mode: runEventsMode, env });
	const metrics = resolveWorldActorMetrics({ mode: runEventsMode, env });
	const causalTelemetry =
		reducerAttemptTelemetry === undefined
			? undefined
			: createSessionCausalTelemetry(reducerAttemptTelemetry);
	// sk-uglp: a daemon whose WORLD connection dies must die with it. The SDK
	// never reconnects (`connect()` is one-shot), so a daemon that ignored
	// `onDisconnect` kept listening on a healthy socket over a dead world —
	// every reattach found "something listening" and re-joined the corpse,
	// every tool call hung into the 3s fast-fail, and read-only tools served
	// the pre-wipe client cache as if live. Closing here unlinks the socket, so
	// the next `ensureDaemon` spawns a fresh process against the fresh world.
	let handle: DaemonHandle | undefined;
	const replyLifetime = new AbortController();
	let worldLost = false;
	// Assigned after `openSession` resolves (the observer needs a live session);
	// a `const` here would hit the TDZ if the world dropped mid-startup.
	let observabilityRef: SessionRunObserver | undefined;
	const onWorldLost = (): void => {
		replyLifetime.abort(new Error("World connection lost"));
		if (worldLost) return;
		worldLost = true;
		// sk-0m4.120.12: name the cause on the daemon's own run BEFORE close()
		// ends it — the row a triager needs to tell "subscription dropped" from
		// "pod restarted" (both leave the same doctor snapshot).
		observabilityRef?.emitLifecycle("subscription_lost", { cause: "world_connection_lost" });
		const current = handle;
		if (current === undefined) return; // still starting up; see below
		void current.close("world_connection_lost").finally(() => options.onWorldConnectionLost?.());
	};
	const live = await openSession(options.binding, {
		authorityTools: true,
		...(options.token === undefined ? {} : { token: options.token }),
		...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
		...(causalTelemetry === undefined
			? {}
			: { actorClientOptions: { reducerAttemptTelemetry: causalTelemetry.tracer } }),
		onDisconnect: () => onWorldLost(),
	});
	const observability = createSessionRunObserver({
		mode: runEventsMode,
		binding: options.binding,
		env,
		...(causalTelemetry === undefined ? {} : { causalTelemetry }),
		...(metrics === undefined ? {} : { metrics }),
	});
	observabilityRef = observability;
	// The session's ONE cursor (finding #98 / ADR-0093 D-5), not a
	// daemon-constructed builder: `live.session.worldEvents` is the SDK's
	// lazily-memoized fanout, one per session, primed here at construction
	// (see the module header). Built BEFORE the tools below — sk-0m4.73's
	// communicate reply window (and sk-0m4.74's consequences register) needs
	// the SAME builder instance injected as `worldEvents.builder`, so the
	// tools can no longer be constructed first.
	const pushes = createSessionWorldEventFeed({
		db: () => snapshotDb(live.session),
		actorId: () => asEntityRef(live.actorId),
		builder: live.session.worldEvents,
		...(causalTelemetry === undefined ? {} : { telemetry: causalTelemetry.tracer }),
	});
	const callerTools = createCallerSessionTools(live, {
		controlReducers: live.session.conn.reducers,
		db: () => snapshotDb(live.session),
		act: {
			actorId: () => live.actorId,
			actorClient: () => live.actorClient,
		},
		worldEvents: {
			builder: pushes.builder,
			replyDelivery: options.replyDelivery ?? "bundled",
			onUpdate: (notify) => live.onUpdate(notify),
			replySignal: replyLifetime.signal,
			estimator: live.session.estimator,
			...resolveReplyWindowOptions(env),
			// sk-0m4.121: late-bound — the dispatcher only exists once
			// `serveDaemon` below returns, and the tools must be built first.
			releaseInvokeLock: () => handle?.dispatcher.releaseCurrentInvoke(),
		},
	});
	handle = await serveDaemon({
		binding: options.binding,
		tools: callerTools.tools,
		socketPath: options.socketPath ?? deriveSocketPath(options.binding),
		...(options.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: options.idleTimeoutMs }),
		observability,
		pushes,
		connected: () => !worldLost,
		onClose: () => {
			replyLifetime.abort(new Error("Session closed"));
			callerTools.close();
			return live.close();
		},
	});
	// The world may have dropped us between `openSession` resolving and the
	// socket binding — close now rather than serve a dead session.
	if (worldLost) {
		void handle.close("world_connection_lost").finally(() => options.onWorldConnectionLost?.());
	}
	return handle;
}
