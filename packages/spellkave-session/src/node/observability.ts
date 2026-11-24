// Session daemon observability (#2003): closes the sk blind spot in
// world-actor observability by mirroring Pi's wiring
// (`.pi/extensions/spellkave/src/extension/run-observability.ts`,
// `main.ts`'s `reducerAttemptTelemetry`) around the daemon's own tool
// dispatch. Two independent pieces, both env-gated by `SPELLKAVE_RUN_EVENTS`:
//
//   - `resolveReducerAttemptTelemetry` — the `WorldActorTracer` passed into
//     `openSession`'s `actorClientOptions.reducerAttemptTelemetry` (the seam
//     #1997/Pi already fills). Built BEFORE `openSession` runs, because the
//     actor client needs it at construction time.
//   - `createSessionRunObserver` — the `agent-run-events/v1` emitter
//     (`run_start`/`tool_call`/`run_end`). Built AFTER `openSession` succeeds
//     (#2003 design decision 1: run boundary = daemon lifetime — a daemon
//     that never finished starting never lived a run) and closed exactly
//     once, from whichever trigger ends the daemon first (shutdown, idle
//     timeout, fatal error).
//
// `off` disables BOTH pieces — no emitter, no reducer-attempt tracer, zero
// behavior change from before #2003.

import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "node:path";

import {
	type AgentRunEventType,
	type AgentRunSink,
	createOtlpHttpSink,
	createRunEmitter,
	normalizeWorldActorCausalContext,
	type WorldActorCausalContext,
	type WorldActorMetrics,
	type WorldActorTracer,
	worldActorCausalAttributes,
	worldActorCausalEventData,
} from "@spellkave/agent-observability";
import {
	AGENT_RUN_EVENTS_FILENAME,
	createJsonlFileSink,
	createWorldActorMetricsFromEnv,
	createWorldActorTracerFromEnv,
	logSinkResourceAttributesFromEnv,
	parseOtelPairs,
	serviceVersionFromEnv,
} from "@spellkave/agent-observability/node";
import { PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";

import type { SessionBinding } from "../binding.ts";
import { runEventsPath } from "./paths.ts";

export const SESSION_RUN_DRIVER = "sk-daemon";
const SESSION_RUN_EXPERIMENT_ID = "sk-daemon";
/** Resource `service.name` on session-daemon world-actor metrics so a freshness
 * query can tell this process from the npc-host (same heartbeat series). */
export const SESSION_METRICS_SERVICE_NAME = "spellkave-session-daemon";

/** Master switch env var (#2003 design decision 4). */
export const RUN_EVENTS_ENV = "SPELLKAVE_RUN_EVENTS";
/** OTLP logs projection endpoint — the convention `world-explorer/run-play.ts`
 * already established for `createOtlpHttpSink`; reused rather than invented. */
export const RUN_EVENTS_OTLP_ENDPOINT_ENV = "SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT";

export const RUN_EVENTS_MODES = ["off", "jsonl", "otlp", "jsonl+otlp"] as const;
export type RunEventsMode = (typeof RUN_EVENTS_MODES)[number];

const DEFAULT_RUN_EVENTS_MODE: RunEventsMode = "jsonl";

/**
 * Parse `SPELLKAVE_RUN_EVENTS`. Unset/empty defaults to `"jsonl"` (cheap,
 * local, daemon-lifetime-bounded — ADR-0002 observability-as-surface). An
 * UNRECOGNIZED value refuses to start rather than silently falling back to
 * `off` — a misconfigured mode must be loud, not a silent observability gap.
 */
export function parseRunEventsMode(env: NodeJS.ProcessEnv = process.env): RunEventsMode {
	const raw = env[RUN_EVENTS_ENV];
	if (raw === undefined || raw.trim() === "") return DEFAULT_RUN_EVENTS_MODE;
	const trimmed = raw.trim();
	if ((RUN_EVENTS_MODES as readonly string[]).includes(trimmed)) {
		return trimmed as RunEventsMode;
	}
	throw new Error(
		`${RUN_EVENTS_ENV}=${JSON.stringify(raw)} is not a recognized observability mode ` +
			`(valid: ${RUN_EVENTS_MODES.join(", ")}). Refusing to start rather than silently ` +
			"falling back to a different mode.",
	);
}

/** Byte cap for one JSONL run-events file before it rotates to `<path>.1`. */
export const RUN_EVENTS_MAX_BYTES_ENV = "SPELLKAVE_RUN_EVENTS_MAX_BYTES";

/** A 32 MiB live file and one rotated generation bound each appender. */
export const DEFAULT_RUN_EVENTS_MAX_BYTES = 32 * 1024 * 1024;

/** Byte budget for the WHOLE transcript tree, enforced by deleting rotated
 * generations oldest-first on every rotation. */
export const RUN_EVENTS_ROOT_MAX_BYTES_ENV = "SPELLKAVE_RUN_EVENTS_ROOT_MAX_BYTES";

/** Hosts with a shared transcript volume can set a budget across all seats. */
export const DEFAULT_RUN_EVENTS_ROOT_MAX_BYTES = undefined;

/**
 * Parse `SPELLKAVE_RUN_EVENTS_ROOT_MAX_BYTES`. Unset/empty and `0` both mean
 * no volume bound. Like {@link parseRunEventsMaxBytes}, an unparseable value
 * refuses to start rather than silently running unbounded.
 */
export function parseRunEventsRootMaxBytes(
	env: NodeJS.ProcessEnv = process.env,
): number | undefined {
	const raw = env[RUN_EVENTS_ROOT_MAX_BYTES_ENV];
	if (raw === undefined || raw.trim() === "") return DEFAULT_RUN_EVENTS_ROOT_MAX_BYTES;
	const parsed = Number(raw.trim());
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(
			`${RUN_EVENTS_ROOT_MAX_BYTES_ENV}=${JSON.stringify(raw)} is not a non-negative integer ` +
				"byte count. Refusing to start rather than silently writing an unbounded transcript tree.",
		);
	}
	return parsed === 0 ? undefined : parsed;
}

/**
 * Parse `SPELLKAVE_RUN_EVENTS_MAX_BYTES`. Unset/empty takes
 * `DEFAULT_RUN_EVENTS_MAX_BYTES`; `0` means uncapped (the pre-rotation
 * behavior, for a short run that wants one whole artifact). Like
 * `parseRunEventsMode`, an unparseable value refuses to start — silently
 * running uncapped is the failure this exists to prevent.
 */
export function parseRunEventsMaxBytes(env: NodeJS.ProcessEnv = process.env): number | undefined {
	const raw = env[RUN_EVENTS_MAX_BYTES_ENV];
	if (raw === undefined || raw.trim() === "") return DEFAULT_RUN_EVENTS_MAX_BYTES;
	const parsed = Number(raw.trim());
	if (!Number.isSafeInteger(parsed) || parsed < 0) {
		throw new Error(
			`${RUN_EVENTS_MAX_BYTES_ENV}=${JSON.stringify(raw)} is not a non-negative integer byte ` +
				"count. Refusing to start rather than silently writing an unbounded transcript.",
		);
	}
	return parsed === 0 ? undefined : parsed;
}

/**
 * The reducer-attempt tracer for `openSession`'s `actorClientOptions`. `off`
 * disables it unconditionally; any other mode reuses Pi's own env bootstrap
 * (`createWorldActorTracerFromEnv`: standard `OTEL_EXPORTER_OTLP_*` vars,
 * `SPELLKAVE_OTEL_DISABLED=1` escape hatch), so a daemon and a Pi session
 * pointed at the same collector need no daemon-specific config.
 */
export function resolveReducerAttemptTelemetry(options: {
	mode: RunEventsMode;
	env?: NodeJS.ProcessEnv;
	/** Injectable for tests — bypasses the real env bootstrap. */
	tracer?: WorldActorTracer;
}): WorldActorTracer | undefined {
	if (options.mode === "off") return undefined;
	if (options.tracer !== undefined) return options.tracer;
	return createWorldActorTracerFromEnv(options.env ?? process.env);
}

/** Process-owned request metrics. `off` disables them together with the
 * other projections; endpoint absence leaves them quietly disabled. */
export function resolveWorldActorMetrics(options: {
	mode: RunEventsMode;
	env?: NodeJS.ProcessEnv;
	metrics?: WorldActorMetrics;
}): WorldActorMetrics | undefined {
	if (options.mode === "off") return undefined;
	if (options.metrics !== undefined) return options.metrics;
	return createWorldActorMetricsFromEnv(options.env ?? process.env, {
		allowedToolNames: PLAYER_TOOL_NAMES,
		serviceName: SESSION_METRICS_SERVICE_NAME,
	});
}

/** Daemon-request scope shared by the run observer and the SDK tracer. The
 * tracer keeps its structural interface while AsyncLocalStorage supplies the
 * current request's safe correlation to spans created below tool dispatch. */
export interface SessionCausalTelemetry {
	readonly tracer: WorldActorTracer;
	run<T>(context: WorldActorCausalContext | undefined, operation: () => Promise<T>): Promise<T>;
}

export function createSessionCausalTelemetry(tracer: WorldActorTracer): SessionCausalTelemetry {
	const storage = new AsyncLocalStorage<WorldActorCausalContext>();
	return {
		tracer: {
			startSpan(name, attributes) {
				return tracer.startSpan(name, {
					...worldActorCausalAttributes(storage.getStore()),
					...attributes,
				});
			},
			flush: () => tracer.flush(),
		},
		run(context, operation) {
			const safe = normalizeWorldActorCausalContext(context);
			return safe === undefined ? operation() : storage.run(safe, operation);
		},
	};
}

/** Where the JSONL run-events file for `runId` lives. Pi's convention:
 * `CAMPAIGN_ARTIFACTS_ROOT` root when set, else a package-owned fallback —
 * here the daemon's own run dir, next to its log (`paths.ts`'s `runEventsPath`
 * derives the SAME per-binding file every time, so successive runs append to
 * one file rather than scattering one-per-run directories the way the
 * campaign-artifacts tree does; a daemon session has no natural "experiment"
 * grouping the way a campaign playthrough does). */
export function sessionRunArtifactPath(options: {
	binding: SessionBinding;
	runId: string;
	env?: NodeJS.ProcessEnv;
}): string {
	const root = options.env?.CAMPAIGN_ARTIFACTS_ROOT;
	if (root !== undefined && root.length > 0) {
		return join(
			root,
			"experiments",
			SESSION_RUN_EXPERIMENT_ID,
			"runs",
			options.runId,
			AGENT_RUN_EVENTS_FILENAME,
		);
	}
	return runEventsPath(options.binding, options.env);
}

function sessionRunId(now: Date): string {
	return `run-${now.toISOString().replaceAll(":", "-").replaceAll(".", "-")}`;
}

export interface SessionRunObserverStatus {
	mode: RunEventsMode;
	/** Present only when a JSONL sink is active (`jsonl`/`jsonl+otlp`). */
	artifactPath?: string;
	/** Configuration only: never includes a collector URL or credentials. */
	logsProjection?: "configured" | "disabled";
	/** Configuration only: never claims that a collector accepted a span. */
	tracesProjection?: "configured" | "disabled";
	/** Configuration only: does not claim collector delivery health. */
	metricsProjection?: "configured" | "disabled";
}

/** The daemon-lifetime run observer `serveDaemon`/`SessionDispatcher` wrap
 * `invoke` dispatch with. Mirrors `PiRunObserver`'s shape. */
export interface SessionRunObserver {
	readonly status: SessionRunObserverStatus;
	observeToolCall<T>(
		toolName: string,
		operation: () => Promise<T>,
		causalContext?: WorldActorCausalContext,
	): Promise<T>;
	/**
	 * sk-0m4.120.12: one lifecycle line on the daemon's own run (e.g.
	 * `subscription_lost {cause}`). Scalars only; best-effort, never throws.
	 * `end()` itself emits `daemon_exit {reason}` before `run_end`.
	 */
	emitLifecycle(type: AgentRunEventType, data?: Record<string, unknown>): void;
	/** Unconditional metrics-exporter liveness. Safe no-op when metrics are off. */
	heartbeatMetrics(): void | Promise<void>;
	/** Idempotent — safe to call from more than one shutdown trigger. */
	end(terminal?: string): Promise<void>;
}

/** `off`-mode observer: zero behavior change, `status.mode` still reported
 * so `status` frames are truthful about ambient config either way. */
export const OFF_SESSION_RUN_OBSERVER: SessionRunObserver = {
	status: {
		mode: "off",
		logsProjection: "disabled",
		tracesProjection: "disabled",
		metricsProjection: "disabled",
	},
	observeToolCall: (_toolName, operation) => operation(),
	emitLifecycle: () => {},
	async heartbeatMetrics() {},
	async end() {},
};

/**
 * Request headers for the run-events OTLP logs sink, from the standard OTel
 * env pair: `OTEL_EXPORTER_OTLP_LOGS_HEADERS` wins over
 * `OTEL_EXPORTER_OTLP_HEADERS`, like the OTel SDKs. The public ingest
 * (telemetry.spellkave.com) sits behind Cloudflare Access, so a sink without
 * these is refused with 403 at the edge while the traces exporter — which
 * reads the same variables on its own — keeps working (sk-0m4.120.9). Shared
 * by the daemon sink, the npc host and the MCP gateway so the parse lives
 * once. Never log the values: they are the ingest credential.
 */
export function otlpLogsHeadersFromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	return parseOtelPairs(env.OTEL_EXPORTER_OTLP_LOGS_HEADERS ?? env.OTEL_EXPORTER_OTLP_HEADERS);
}

function buildDefaultSinks(options: {
	mode: RunEventsMode;
	artifactPath: string | undefined;
	env: NodeJS.ProcessEnv;
}): AgentRunSink[] {
	const sinks: AgentRunSink[] = [];
	if (
		(options.mode === "jsonl" || options.mode === "jsonl+otlp") &&
		options.artifactPath !== undefined
	) {
		sinks.push(createJsonlFileSink(options.artifactPath));
	}
	if (options.mode === "otlp" || options.mode === "jsonl+otlp") {
		const endpoint = options.env[RUN_EVENTS_OTLP_ENDPOINT_ENV];
		if (endpoint !== undefined && endpoint.trim().length > 0) {
			const serviceVersion = serviceVersionFromEnv(options.env);
			sinks.push(
				createOtlpHttpSink({
					endpoint,
					headers: otlpLogsHeadersFromEnv(options.env),
					...(serviceVersion === undefined ? {} : { serviceVersion }),
					resourceAttributes: logSinkResourceAttributesFromEnv(options.env),
				}),
			);
		}
	}
	return sinks;
}

export interface CreateSessionRunObserverOptions {
	mode: RunEventsMode;
	binding: SessionBinding;
	env?: NodeJS.ProcessEnv;
	/** Injectable clock for deterministic tests. Defaults to wall clock. */
	now?: () => Date;
	/** Injectable sinks — bypasses env-driven sink selection (tests). */
	sinks?: readonly AgentRunSink[];
	/** Request scope shared with the actor-client reducer tracer. */
	causalTelemetry?: SessionCausalTelemetry;
	/** Process-owned, bounded-label request metrics. */
	metrics?: WorldActorMetrics;
}

/**
 * Build the daemon-lifetime run observer. Callers create this AFTER
 * `openSession` has already succeeded — see the module comment. `mode ===
 * "off"` returns the shared no-op singleton without touching the filesystem
 * or network.
 */
export function createSessionRunObserver(
	options: CreateSessionRunObserverOptions,
): SessionRunObserver {
	if (options.mode === "off") return OFF_SESSION_RUN_OBSERVER;

	const env = options.env ?? process.env;
	const worldSlug = env.SPELLKAVE_WORLD_SLUG?.trim() || undefined;
	const stableWorldData = worldSlug === undefined ? {} : { world_slug: worldSlug };
	const now = options.now ?? (() => new Date());
	const startedAt = now();
	const runId = sessionRunId(startedAt);
	const artifactPath =
		options.mode === "otlp"
			? undefined
			: sessionRunArtifactPath({ binding: options.binding, runId, env });
	const sinks = options.sinks ?? buildDefaultSinks({ mode: options.mode, artifactPath, env });
	const logsProjection =
		(options.mode === "otlp" || options.mode === "jsonl+otlp") &&
		(options.sinks !== undefined || env[RUN_EVENTS_OTLP_ENDPOINT_ENV]?.trim())
			? "configured"
			: "disabled";
	const tracesProjection =
		options.causalTelemetry !== undefined ||
		(env.SPELLKAVE_OTEL_DISABLED !== "1" &&
			(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()))
			? "configured"
			: "disabled";
	const metricsProjection = options.metrics === undefined ? "disabled" : "configured";

	const emitter = createRunEmitter(
		{
			run_id: runId,
			run_kind: "sk_session",
			actor_id: options.binding.actorId,
			role: "PLAYER",
			controller_kind: "human",
			driver: SESSION_RUN_DRIVER,
			now,
		},
		sinks,
	);
	let ended = false;

	emitter.emit("run_start", {
		url: options.binding.url,
		db: options.binding.db,
		...stableWorldData,
		...(artifactPath === undefined ? {} : { artifact_path: artifactPath }),
	});

	return {
		status: {
			mode: options.mode,
			...(artifactPath === undefined ? {} : { artifactPath }),
			logsProjection,
			tracesProjection,
			metricsProjection,
		},
		async observeToolCall(toolName, operation, causalContext) {
			const toolStartedAt = now().getTime();
			const causalData = {
				...worldActorCausalEventData(causalContext),
				...stableWorldData,
			};
			let requestStatus: "ok" | "error" = "ok";
			try {
				const result = await (options.causalTelemetry === undefined
					? operation()
					: options.causalTelemetry.run(causalContext, operation));
				emitter.emit("tool_call", {
					tool_name: toolName,
					is_error: false,
					duration_ms: Math.max(0, now().getTime() - toolStartedAt),
					...causalData,
					// sk-0m4.120.42: affordance listing counts (scalars only).
				});
				return result;
			} catch (error) {
				requestStatus = "error";
				emitter.emit("tool_call", {
					tool_name: toolName,
					is_error: true,
					duration_ms: Math.max(0, now().getTime() - toolStartedAt),
					summary: "tool execution failed",
					...causalData,
				});
				throw error;
			} finally {
				try {
					options.metrics?.recordRequest({
						toolName,
						durationMs: Math.max(0, now().getTime() - toolStartedAt),
						status: requestStatus,
					});
				} catch {
					// Observability cannot change a gameplay result.
				}
				// Long-lived daemons may never reach the tracer's batch threshold.
				// Start export after each request without putting collector latency on
				// the gameplay response path; orderly shutdown awaits it below.
				void options.causalTelemetry?.tracer.flush().catch(() => {});
			}
		},
		emitLifecycle(type, data = {}) {
			if (ended) return;
			try {
				emitter.emit(type, { ...data, ...stableWorldData });
			} catch {
				// Observability cannot change a gameplay result.
			}
		},
		async heartbeatMetrics() {
			if (ended || options.metrics === undefined) return;
			try {
				options.metrics.recordExporterHeartbeat?.();
			} catch {
				// Observability cannot change a gameplay result.
			}
			await options.metrics.flush().catch(() => {});
		},
		async end(terminal = "shutdown") {
			if (ended) return;
			ended = true;
			// sk-0m4.120.12: the exit REASON as its own row. `run_end.terminal`
			// carries the same word, but a reader filtering `event_type =
			// 'daemon_exit'` gets every daemon death — idle, shutdown, world
			// loss, crash — without knowing which run kinds end how.
			emitter.emit("daemon_exit", { reason: terminal, ...stableWorldData });
			emitter.emit("run_end", {
				terminal,
				duration_ms: Math.max(0, now().getTime() - startedAt.getTime()),
				...stableWorldData,
			});
			await emitter.close();
			await Promise.allSettled([
				options.causalTelemetry?.tracer.flush() ?? Promise.resolve(),
				options.metrics?.flush() ?? Promise.resolve(),
			]);
		},
	};
}
