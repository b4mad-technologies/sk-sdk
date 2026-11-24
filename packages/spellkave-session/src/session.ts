// Isomorphic session lifecycle: resolve -> connect -> bind identity/actor ->
// subscribe-on-connect -> return a handle. This is the ONE place that
// sequence happens (#1990 decision 4) — the daemon, the Pi extension, and any
// future browser host are meant to call `openSession` instead of re-spelling
// `@spellkave/sdk`'s connect/createActorClient/subscribe call chain, which
// today is hand-rolled at ~110 call sites (walkthrough scripts, world-explorer
// probes, live twin tests, wanderer.ts).
//
// "Resolve" is deliberately NOT a step this module performs: profile/
// credential resolution (`resolveConnection`, `resolveCredential`) needs
// `node:fs`, so it lives one layer up, in the Node-only caller that builds a
// `SessionBinding` + token before calling `openSession` (see
// `@spellkave/session/node`'s `daemon.ts`). This module starts from an
// already-resolved binding, exactly like `.pi/extensions/spellkave`'s
// `connection-controller.ts` does at its own `connectSession` seam.
//
// Connection subscription is the SELECT-* table subscription built centrally
// by `connect()` (`buildSubscribeSet`, `packages/spellkave-sdk/src/connection.ts`).
// The actor-scoped factual context is materialised by the server lifecycle;
// opening a session never invokes a cache reducer.
//
// CONTRACT NON-GOALS (#2001 — decided, not deferred; NON-GOAL 4 revised by
// ADR-0103 D-3 / sk-dms.46). The package-adoption pass (#1996) listed four
// shapes. (1) and (3) still stand, each with exactly one caller that keeps
// its hand-rolled chain ON PURPOSE. (2) was retired when a second caller
// appeared. (4) now allows one setup step on the session's own connection:
//
// 1. Caller-supplied actor resolution (body-swap): `binding.actorId` IS the
//    actor this session resolves. `wanderer.ts`'s `actorPrincipalId` branch
//    (resolve a different acting body than the connected actor) stays
//    hand-rolled in `@spellkave/agent-scenarios`.
// 2. Custom `readerManifests` — RETIRED (sk-dms.1, srd-cc backlog #BL-9): a
//    SECOND caller appeared (`@spellkave/npc`'s NPC host, `src/host/host.ts`)
//    — per this doc's own "if a SECOND caller ever appears... extend
//    deliberately then" escape valve, `readerManifests` is now a first-class
//    `OpenSessionDeps` field, forwarded to `connect()`'s own
//    `buildSubscribeSet` verbatim. A per-seat manifest is exactly how a host
//    widens one NPC's live subscriptions without touching every other seat's
//    (or the registry-derived default) subscribe set. `undefined` (the
//    default) is unchanged behavior: `connect()` falls back to
//    `READER_SCOPED_TABLES` ∪ the registered-reader union, same as before
//    this field existed.
// 3. Subscribe-less passive observer: always-subscribe, always-an-ActorClient
//    is the point of this seam (#1987) — a session that never subscribes is
//    not an `openSession` variant. A passive observer in a live test is a
//    scene hero connection that never gets an action client.
// 4. `openSession` still resolves an already-controlled actor; a caller may
//    run ONE setup step on the session's own connection before resolution
//    (claim, bind, self-grant). Dual-identity test flows remain a
//    composition.
//
// If a SECOND caller ever appears for (1), that is the moment to revisit —
// extend deliberately then, not speculatively now.

import {
	type ActorClient,
	type ActorClientOptions,
	asEntityRef,
	connect,
	createActorClient,
	defaultReaderManifest,
	type ReaderManifest,
	type ResolvedActor,
	readManipulationContext,
	resolveActor,
	type SpellkaveSession,
	snapshot,
	snapshotDb,
} from "@spellkave/sdk";

import { AUTHORITY_TOOL_READER_MANIFEST, callerActingContexts } from "./acting-context";
import type { SessionBinding } from "./binding.ts";

/**
 * Shared default for `setupTimeoutMs` and `resolveTimeoutMs` (ADR-0103 D-3).
 * Unchanged by sk-jay0.6.38.25 — these two steps run against an already-open
 * connection and stay tight.
 */
const DEFAULT_OPEN_SESSION_TIMEOUT_MS = 4_000;

/**
 * Recommended bound for `readyTimeoutMs`/`factualContextTimeoutMs`
 * (sk-jay0.6.38.25, made OPT-IN by the #3477 RUM-lane review). Neither field
 * is applied automatically any more: `undefined` (the default) leaves
 * `session.ready`/factual-context readiness unbounded, the behavior every
 * caller had before sk-jay0.6.38.25 first shipped a blanket 30s default that
 * silently applied to every `openSession` caller, including the Pi/MCP
 * session daemon, npc-brains' drive loop, `orient-adventure`, and the NPC
 * seat — none of which asked for a bound, and a cold or throttled world
 * (e.g. right after a roll plus world re-load) would have turned their
 * previously-patient awaits into a hard startup failure.
 *
 * Play (`apps/play/src/lib/play-session.ts`) is the one caller that opts in,
 * passing this constant explicitly for both fields. The #3464 headless/hosted
 * repros measured a *healthy* connect completing in under 2s, but a live
 * `play.spellkave.com` run during the original review measured ~10s
 * wall-clock end to end, and `openSession`'s other caller (`@spellkave/npc`'s
 * host) cold-connects under CPU throttling with a known reconnect-storm
 * history (`npc-host-storm-cpu-and-reconnect`) — 30s gives ample headroom
 * above the ~10s observed worst case for a caller that wants a bound at all.
 */
export const PLAY_CONNECT_PHASE_TIMEOUT_MS = 30_000;

/**
 * Which `openSession` step is in flight or failed. Attached to every error
 * this function throws after `connect()` returns (sk-jay0.6.38.25), so a
 * caller (or its telemetry) can tell "the WS never opened" apart from "the
 * WS opened but the affordance-cache subscribe never replied" without
 * parsing error text.
 */
export type SessionPhase = "ready" | "setup" | "resolve_actor" | "factual_context";

/**
 * Thrown when a bounded `openSession` phase does not complete in time. The
 * message stays the same shape prior callers already match on
 * (`"<label> timed out after <ms>ms"`); `phase`/`timeoutMs` are additive.
 */
export class OpenSessionTimeoutError extends Error {
	readonly phase: SessionPhase;
	readonly timeoutMs: number;
	constructor(phase: SessionPhase, timeoutMs: number, message: string) {
		super(message);
		this.name = "OpenSessionTimeoutError";
		this.phase = phase;
		this.timeoutMs = timeoutMs;
	}
}

/** Tags any thrown `Error` with the `openSession` phase it failed in, without
 * altering its message — callers that already assert on error text (e.g. the
 * unchanged "not found in live actor_spatial_location" message) keep passing. */
function withPhase(err: unknown, phase: SessionPhase): unknown {
	if (err instanceof Error) (err as Error & { phase?: SessionPhase }).phase = phase;
	return err;
}

export interface OpenSessionDeps {
	/** Auth token for the connection. `undefined` connects anonymously. */
	token?: string;
	/** Optional JSONL diagnostic sink, forwarded to `connect()`. */
	onDiagnostic?: (line: object) => void;
	/** Optional transport error hook, forwarded to `connect()`. */
	onError?: (err: Error) => void;
	/** Optional disconnect hook, forwarded to `connect()`. */
	onDisconnect?: (err: Error | undefined) => void;
	/** Optional cache-mutation hook, forwarded to `connect()`. Receives the
	 * moved table name (or `__applied`); nullary listeners remain valid. */
	onUpdate?: (table?: string) => void;
	/** Extra `ActorClient` options (e.g. custom timeouts); `successOnProvenance` is always set. */
	actorClientOptions?: ActorClientOptions;
	/** Optional reader profile narrowing/widening this session's live subscribe
	 * set, forwarded to `connect()`'s own `readerManifests` (`buildSubscribeSet`)
	 * verbatim. `undefined` (the default) is unchanged behavior — `connect()`
	 * falls back to its own registry-derived default. See this module's
	 * CONTRACT NON-GOALS comment (item 2) for why this field exists now: a
	 * second caller (`@spellkave/npc`'s NPC host) needs a per-seat widened
	 * subscription, the same shape a `ReaderManifest[]` already describes. */
	readerManifests?: readonly ReaderManifest[];
	/** Opt in to public role catalogs and caller-redacting bindings for authority tools. */
	authorityTools?: boolean;
	/**
	 * Runs on the session's OWN connection after `session.ready` and BEFORE
	 * actor resolution (ADR-0103 D-3 / sk-dms.46). Any throw or timeout
	 * closes the connection and rethrows — no partially-open state.
	 */
	setup?: (session: SpellkaveSession) => Promise<void>;
	/**
	 * Bound for `setup`. Defaults to the same default as `resolveTimeoutMs`
	 * (`DEFAULT_OPEN_SESSION_TIMEOUT_MS`).
	 */
	setupTimeoutMs?: number;
	/**
	 * Bound for the check-then-wait `resolveActor` path. The common case
	 * (controlled-actor row already present at `ready`/`setup`) pays zero
	 * extra latency. Default `DEFAULT_OPEN_SESSION_TIMEOUT_MS`.
	 */
	resolveTimeoutMs?: number;
	/**
	 * Bound for `await session.ready` (sk-jay0.6.38.25 — added to investigate
	 * the #3464 "Connecting to SpacetimeDB WS…" stall). **OPT-IN** (#3477
	 * RUM-lane review): `undefined` (the default) leaves this await unbounded,
	 * matching every caller's behavior before sk-jay0.6.38.25. Play passes
	 * `PLAY_CONNECT_PHASE_TIMEOUT_MS` (30s) explicitly; the Pi/MCP session
	 * daemon, npc-brains' drive loop, `orient-adventure`, and the NPC seat do
	 * not set this and keep waiting indefinitely, same as before #3477.
	 */
	readyTimeoutMs?: number;
	/**
	 * Reserved opt-in bound for observing the server-materialised factual
	 * context. The current lifecycle emits this phase after actor resolution;
	 * callers that need an action context read it through the SDK reader.
	 */
	factualContextTimeoutMs?: number;
	/**
	 * Runs after each phase below completes successfully, in order: `ready`,
	 * `setup` (only if `deps.setup` is set), `resolve_actor`,
	 * `factual_context`. `elapsedMs` covers only that phase. A host uses this
	 * to observe connect progress (e.g. mark "connected" once
	 * `factual_context` fires) without console-logging every phase itself.
	 * Never called on failure — the thrown error's `.phase` covers that.
	 */
	onPhase?(phase: SessionPhase, elapsedMs: number): void;
}

/**
 * A live, subscribed session bound to one binding. `close()` is idempotent —
 * a caller wiring shutdown from multiple triggers (idle timeout, explicit
 * `shutdown` op, transport disconnect) never has to guard against a double
 * `disconnect()`.
 */
export interface LiveSession {
	readonly binding: SessionBinding;
	readonly session: SpellkaveSession;
	/** Resolved body entity id from `resolveActor`. Named `actorId` because hosts (`@spellkave/npc` seats, daemon wiring) consume this field; renaming would leak. */
	readonly actorId: string;
	readonly actorClient: ActorClient;
	/**
	 * Replace this connection's reader set without reconnecting or re-claiming
	 * the actor. The next set overlaps the old one until its snapshot applies.
	 * Callers own the semantic transition: this API does not decide whether an
	 * NPC is safe to make passive.
	 */
	replaceReaderManifests(manifests: readonly ReaderManifest[]): Promise<void>;
	/**
	 * T25: register a listener for the same underlying cache-mutation signal
	 * the constructor-time `deps.onUpdate` callback already receives. Returns
	 * an unsubscribe function. Both fire on every update — this is additive,
	 * not a replacement for the constructor callback.
	 *
	 * Exists because a consumer that builds something OVER an already-open
	 * `LiveSession` (the NPC seat's `"async"` mode being the first, `@spellkave/npc`'s
	 * `supervisor.ts`) cannot supply its listener at `openSession()` call time —
	 * the thing that needs to react to updates isn't constructed yet. Before
	 * this, every such host reproduced a mutable-closure workaround (`let
	 * notify: (() => void) | undefined` filled in after the fact); this
	 * registry makes that indirection unnecessary — wire in natural order
	 * instead: `openSession()` → build the consumer → `live.onUpdate((table) =>
	 * consumer.notify(table))`. Each event carries the single moved table
	 * (or `__applied`); listeners that ignore the argument stay valid.
	 */
	onUpdate(listener: (table?: string) => void): () => void;
	/**
	 * Monotonic cache-mutation revision. Incremented inside the same
	 * constructor-time `onUpdate` fan-out registered listeners already
	 * receive. Starts at 0 (no mutations observed yet). An NPC seat uses
	 * this to skip `perceive()` when nothing in the subscribed cache has
	 * changed (sk-dms.34).
	 */
	revision(): number;
	close(): void;
}

/**
 * Thrown when an async operation on an `ActorClient` is aborted or attempted
 * after its owning `LiveSession` has closed (sk-jay0.6.15.56.16.12.3).
 */
export class SessionClosedError extends Error {
	constructor(message = "Session is closed") {
		super(message);
		this.name = "SessionClosedError";
	}
}

/**
 * Open a session for `binding`: connect, await `ready`, run optional `setup`
 * on this connection, validate the actor is directly controlled (bounded
 * wait on the cache-mutation fan-out if the row is not yet present), build
 * an `ActorClient`, and wait for its actor-scoped factual context before
 * returning.
 * Rejects (and disconnects) if any step fails — there is no partially-open
 * state a caller could observe.
 */
export async function openSession(
	binding: SessionBinding,
	deps: OpenSessionDeps = {},
): Promise<LiveSession> {
	const listeners = new Set<(table?: string) => void>();
	let cacheRevision = 0;
	function onUpdate(listener: (table?: string) => void): () => void {
		listeners.add(listener);
		return () => listeners.delete(listener);
	}
	function revision(): number {
		return cacheRevision;
	}

	const session = await connect(
		{
			url: binding.url,
			db: binding.db,
			token: deps.token,
			connectedActorId: binding.actorId,
			...(deps.onDiagnostic === undefined ? {} : { onDiagnostic: deps.onDiagnostic }),
			...(deps.authorityTools
				? {
						readerManifests: [
							...(deps.readerManifests ?? [defaultReaderManifest()]),
							AUTHORITY_TOOL_READER_MANIFEST,
						],
					}
				: deps.readerManifests === undefined
					? {}
					: { readerManifests: deps.readerManifests }),
		},
		{
			onError: deps.onError ?? (() => {}),
			onDisconnect: deps.onDisconnect ?? (() => {}),
			onUpdate: (table) => {
				cacheRevision += 1;
				deps.onUpdate?.(table);
				for (const listener of listeners) listener(table);
			},
		},
	);

	let closed = false;
	const inFlightRejections = new Set<(err: Error) => void>();

	const abortWaits = new Set<(err: Error) => void>();

	function close(): void {
		if (closed) return;
		closed = true;
		session.disconnect();
		const closeErr = new SessionClosedError("Session is closed");
		for (const reject of inFlightRejections) {
			reject(closeErr);
		}
		inFlightRejections.clear();
		for (const reject of abortWaits) {
			reject(closeErr);
		}
		abortWaits.clear();
	}

	function wrapActorClient(raw: ActorClient): ActorClient {
		return new Proxy(raw, {
			get(target, prop, receiver) {
				const value = Reflect.get(target, prop, receiver);
				if (typeof value !== "function") {
					return value;
				}
				if (prop === "withDriverToken") {
					return (...args: unknown[]) => wrapActorClient(Reflect.apply(value, target, args));
				}
				return function (this: unknown, ...args: unknown[]) {
					const thisArg = this === receiver ? target : this;
					const result = Reflect.apply(value, thisArg, args);
					if (
						result !== null &&
						typeof result === "object" &&
						typeof (result as PromiseLike<unknown>).then === "function"
					) {
						if (closed) {
							return Promise.reject(new SessionClosedError("Session is closed"));
						}
						return new Promise((resolve, reject) => {
							const rejectInFlight = (err: Error) => {
								reject(err);
							};
							inFlightRejections.add(rejectInFlight);
							Promise.resolve(result).then(
								(val) => {
									inFlightRejections.delete(rejectInFlight);
									resolve(val);
								},
								(err) => {
									inFlightRejections.delete(rejectInFlight);
									reject(err);
								},
							);
						});
					}
					return result;
				};
			},
		});
	}

	const resolveTimeoutMs = deps.resolveTimeoutMs ?? DEFAULT_OPEN_SESSION_TIMEOUT_MS;
	const setupTimeoutMs = deps.setupTimeoutMs ?? DEFAULT_OPEN_SESSION_TIMEOUT_MS;
	// Opt-in (#3477 RUM-lane review): `undefined` stays unbounded — see the
	// two fields' own JSDoc above and `PLAY_CONNECT_PHASE_TIMEOUT_MS`.
	const readyTimeoutMs = deps.readyTimeoutMs;
	const factualContextTimeoutMs = deps.factualContextTimeoutMs;

	try {
		let phaseStartedAt = Date.now();
		await awaitWithTimeout(
			session.ready,
			readyTimeoutMs,
			`openSession: session.ready timed out after ${readyTimeoutMs}ms`,
			"ready",
		);
		deps.onPhase?.("ready", Date.now() - phaseStartedAt);

		if (deps.setup !== undefined) {
			phaseStartedAt = Date.now();
			await awaitWithTimeout(
				deps.setup(session),
				setupTimeoutMs,
				`OpenSessionDeps.setup timed out after ${setupTimeoutMs}ms`,
				"setup",
			);
			deps.onPhase?.("setup", Date.now() - phaseStartedAt);
		}
		phaseStartedAt = Date.now();
		const presence = callerActingContexts(session).find(
			(choice) => choice.kind === "presence" && choice.bodyId === binding.actorId,
		);
		const resolved =
			presence === undefined
				? await resolveControlledActor(binding.actorId, session, listeners, resolveTimeoutMs)
				: { body_entity_id: presence.bodyId };
		deps.onPhase?.("resolve_actor", Date.now() - phaseStartedAt);
		const rawActorClient = createActorClient(session, resolved.body_entity_id, {
			// Generic session hosts (the daemon, the Pi extension) cannot supply
			// a world-state predicate for every authored action; the server's
			// provenance is authoritative — same rationale as
			// `connection-controller.ts`'s `createActorClient` wiring.
			successOnProvenance: true,
			...deps.actorClientOptions,
		});
		const actorClient = wrapActorClient(rawActorClient);
		phaseStartedAt = Date.now();
		if (presence === undefined)
			await awaitFactualContext(
				resolved.body_entity_id,
				session,
				listeners,
				factualContextTimeoutMs,
				abortWaits,
			);
		deps.onPhase?.("factual_context", Date.now() - phaseStartedAt);
		return {
			binding,
			session,
			actorId: resolved.body_entity_id,
			actorClient,
			replaceReaderManifests: (manifests) => session.replaceReaderManifests(manifests),
			onUpdate,
			revision,
			close,
		};
	} catch (err) {
		close();
		throw err;
	}
}

/**
 * The context header is the server's atomic readiness witness: `ready` means
 * that the subscribed target/action/participant fact generation is coherent.
 * As with actor resolution, check first to avoid adding an event wait in the
 * warm case and only listen when the initial snapshot is still catching up.
 */
function awaitFactualContext(
	actorId: string,
	session: SpellkaveSession,
	listeners: Set<(table?: string) => void>,
	timeoutMs: number | undefined,
	abortWaits: Set<(err: Error) => void>,
): Promise<void> {
	const ready = (): boolean =>
		readManipulationContext(snapshotDb(session), asEntityRef(actorId)).status === "ready";
	if (ready()) return Promise.resolve();

	return new Promise((resolve, reject) => {
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (fn: () => void): void => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			listeners.delete(onUpdate);
			abortWaits.delete(onAbort);
			fn();
		};
		const attempt = (): void => {
			if (ready()) finish(resolve);
		};
		const onUpdate = (): void => attempt();
		const onAbort = (err: Error): void => finish(() => reject(err));
		listeners.add(onUpdate);
		abortWaits.add(onAbort);
		if (timeoutMs !== undefined) {
			timer = setTimeout(() => {
				if (ready()) finish(resolve);
				else {
					finish(() =>
						reject(
							new OpenSessionTimeoutError(
								"factual_context",
								timeoutMs,
								`openSession: factual context timed out after ${timeoutMs}ms`,
							),
						),
					);
				}
			}, timeoutMs);
		}
		attempt();
	});
}

function isMissingControlledActor(err: unknown): boolean {
	return err instanceof Error && err.message.includes("not found in live actor_spatial_location");
}

function tryResolveActor(actorId: string, session: SpellkaveSession): ResolvedActor {
	return resolveActor(actorId, snapshot(session.conn).controlledActors);
}

/**
 * Check-then-wait (ADR-0103 D-3): run `resolveActor` once immediately. Only
 * if the controlled-actor row is absent do we subscribe to the same
 * cache-mutation fan-out `LiveSession.onUpdate` uses and re-check on each
 * event until `timeoutMs`. The common case pays zero extra latency and zero
 * extra event round trips. Deadline failure rethrows `resolveActor`'s own
 * error (unchanged text).
 */
function resolveControlledActor(
	actorId: string,
	session: SpellkaveSession,
	listeners: Set<(table?: string) => void>,
	timeoutMs: number,
): Promise<ResolvedActor> {
	try {
		return Promise.resolve(tryResolveActor(actorId, session));
	} catch (err) {
		if (!isMissingControlledActor(err)) return Promise.reject(withPhase(err, "resolve_actor"));
	}

	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			listeners.delete(onCacheUpdate);
			fn();
		};
		const attempt = (): boolean => {
			try {
				const resolved = tryResolveActor(actorId, session);
				finish(() => resolve(resolved));
				return true;
			} catch (err) {
				if (!isMissingControlledActor(err)) {
					finish(() => reject(withPhase(err, "resolve_actor")));
					return true;
				}
				return false;
			}
		};
		const onCacheUpdate = (): void => {
			attempt();
		};
		listeners.add(onCacheUpdate);
		const timer = setTimeout(() => {
			try {
				const resolved = tryResolveActor(actorId, session);
				finish(() => resolve(resolved));
			} catch (err) {
				finish(() => reject(withPhase(err, "resolve_actor")));
			}
		}, timeoutMs);
		attempt();
	});
}

/** `timeoutMs === undefined` runs `work` with no bound at all (no timer is
 * even created) — the compat default for `readyTimeoutMs`/
 * `factualContextTimeoutMs` (#3477 RUM-lane review). */
async function awaitWithTimeout<T>(
	work: Promise<T>,
	timeoutMs: number | undefined,
	message: string,
	phase: SessionPhase,
): Promise<T> {
	if (timeoutMs === undefined) {
		try {
			return await work;
		} catch (err) {
			throw withPhase(err, phase);
		}
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			work,
			new Promise<T>((_, reject) => {
				timer = setTimeout(
					() => reject(new OpenSessionTimeoutError(phase, timeoutMs, message)),
					timeoutMs,
				);
			}),
		]);
	} catch (err) {
		throw withPhase(err, phase);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}
