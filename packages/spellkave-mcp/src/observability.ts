import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/server";
import {
	type AgentRunEvent,
	type AgentRunEventType,
	type AgentRunSink,
	createOtlpHttpSink,
	createRunEmitter,
	type HttpRequestData,
	normalizeWorldActorCausalContext,
	type RunEmitter,
	type WorldActorCausalContext,
} from "@spellkave/agent-observability";
import {
	AGENT_RUN_EVENTS_FILENAME,
	createJsonlFileSink,
	logSinkResourceAttributesFromEnv,
	serviceVersionFromEnv,
} from "@spellkave/agent-observability/node";
import {
	otlpLogsHeadersFromEnv,
	parseRunEventsMode,
	RUN_EVENTS_OTLP_ENDPOINT_ENV,
} from "@spellkave/session/node";

import { hashTranscriptSubject } from "./transcript.ts";

export const REMOTE_MCP_RUN_DRIVER = "remote-mcp";
export const MCP_RUN_EVENTS_PATH_ENV = "SPELLKAVE_MCP_RUN_EVENTS_PATH";
export const MCP_STATUS_PATH_ENV = "SPELLKAVE_MCP_STATUS_PATH";
export const PLAYER_MCP_OPERATION_LOG_VERSION = "player-mcp-operations/v1";
export const DEFAULT_RUN_EVENTS_BUFFER_SIZE = 100;

export interface RunEventsRingBufferSink extends AgentRunSink {
	readonly events: readonly AgentRunEvent[];
	getEvents(runId?: string): AgentRunEvent[];
	clear(): void;
}

/** In-memory ring buffer sink retaining recent world_actor_run_events. */
export function createRunEventsRingBufferSink(
	maxEvents: number = DEFAULT_RUN_EVENTS_BUFFER_SIZE,
): RunEventsRingBufferSink {
	const buffer: AgentRunEvent[] = [];
	return {
		get events(): readonly AgentRunEvent[] {
			return [...buffer];
		},
		write(event: AgentRunEvent) {
			buffer.push(event);
			if (buffer.length > maxEvents) {
				buffer.shift();
			}
		},
		getEvents(runId?: string): AgentRunEvent[] {
			if (runId === undefined || runId.trim() === "") {
				return [...buffer];
			}
			return buffer.filter((e) => e.run_id === runId);
		},
		clear() {
			buffer.length = 0;
		},
	};
}

interface RemoteMcpRequestContext {
	correlationId: string;
}

interface CurrentRemoteMcpRunEmit {
	emit: (type: AgentRunEventType, data?: Record<string, unknown>) => void;
}

const requestContext = new AsyncLocalStorage<RemoteMcpRequestContext>();
const requestSubject = new AsyncLocalStorage<string>();
const requestAccessToken = new AsyncLocalStorage<string>();
/** Bound for the duration of one `observeToolCall` so gateway-local tools
 * (e.g. spellkave_feedback) can append events to the SAME run envelope. */
const currentRunEmit = new AsyncLocalStorage<CurrentRemoteMcpRunEmit>();

/** Scope one authorized request to its token subject (the routed PLAYER seat). */
export function withRemoteMcpRequestSubject<T>(subject: string, operation: () => T): T {
	return requestSubject.run(subject, operation);
}

/** The token subject of the current authorized request, if any. */
export function currentRemoteMcpRequestSubject(): string | undefined {
	return requestSubject.getStore();
}

/** Scope one authorized request to its raw bearer JWT (passed to withToken). */
export function withRemoteMcpAccessToken<T>(token: string, operation: () => T): T {
	return requestAccessToken.run(token, operation);
}

export function currentRemoteMcpAccessToken(): string | undefined {
	return requestAccessToken.getStore();
}

export function createRequestCorrelationId(): string {
	return randomUUID();
}

export function withRemoteMcpRequestContext<T>(
	correlationId: string,
	operation: () => Promise<T>,
): Promise<T> {
	return requestContext.run({ correlationId }, operation);
}

export function currentRemoteMcpCorrelationId(): string {
	return requestContext.getStore()?.correlationId ?? createRequestCorrelationId();
}

/**
 * Emit one additional agent-run-events/v1 line on the CURRENT tool-call run
 * (same run_id + identity bits as the observer's tool_call). No-op outside
 * `observeToolCall` or when observability is off. Best-effort: never throws.
 */
export function emitOnCurrentRemoteMcpRun(
	type: AgentRunEventType,
	data: Record<string, unknown> = {},
): void {
	try {
		currentRunEmit.getStore()?.emit(type, data);
	} catch {
		// Observability must never change a PLAYER outcome.
	}
}

export type PlayerMcpOperationLog =
	| {
			kind: "http_request";
			correlation_id: string;
			method: string;
			route: string;
			status: number;
			auth: "accepted" | "rejected" | "not_applicable";
			/** Allowlisted failure category; never raw headers, claims or error text. */
			auth_reason?: string;
			duration_ms: number;
	  }
	| {
			kind: "tool_call";
			correlation_id: string;
			tool_name: string;
			outcome: "ok" | "error";
			error_category?: "domain" | "transport" | "protocol" | "gateway" | "internal";
			duration_ms: number;
	  }
	| {
			kind: "account_event";
			correlation_id: string;
			event: string;
			sub: string;
			slug?: string;
			/** WorkOS API key id — never the secret. */
			key_id?: string;
			outcome: string;
	  };

export type PlayerMcpOperationLogger = (
	event: PlayerMcpOperationLog & { v: typeof PLAYER_MCP_OPERATION_LOG_VERSION; ts: string },
) => void;

export const NOOP_PLAYER_MCP_OPERATION_LOGGER: PlayerMcpOperationLogger = () => {};

export const STDERR_PLAYER_MCP_OPERATION_LOGGER: PlayerMcpOperationLogger = (event) => {
	process.stderr.write(`${JSON.stringify(event)}\n`);
};

export function emitPlayerMcpOperationLog(
	logger: PlayerMcpOperationLogger,
	event: PlayerMcpOperationLog,
	now: () => Date = () => new Date(),
): void {
	try {
		logger({ v: PLAYER_MCP_OPERATION_LOG_VERSION, ts: now().toISOString(), ...event });
	} catch {
		// Observability is best-effort and must never change a PLAYER outcome.
	}
}

/** One lifecycle line (sk-0m4.120.12): `gateway_start`, `session_attach`,
 * `subscription_lost`, `session_resubscribed`, `session_detach`,
 * `session_token_refreshed` (sk-jay0.5.14.15). Scalars only. */
export type RemoteMcpLifecycleEmit = (
	type: AgentRunEventType,
	data?: Record<string, unknown>,
) => void;

/** Envelope for rows the gateway PROCESS emits about itself — no actor
 * decision behind them, hence `controller_kind: "service"`. */
const GATEWAY_ENVELOPE = {
	actor_id: "gateway",
	role: "GATEWAY",
	controller_kind: "service",
	driver: REMOTE_MCP_RUN_DRIVER,
} as const;

/** Process-lifetime run for lifecycle rows emitted OUTSIDE any tool call
 * (`gateway_start`, a keepalive re-attach). Inside a tool call the same rows
 * ride the tool's own `mcp-<correlation_id>` run instead. */
export const GATEWAY_LIFECYCLE_RUN_KIND = "mcp_gateway_lifecycle";
/** Run kind of the per-request `http_request` row; its run_id is the tool
 * call's `mcp-<correlation_id>`, so the two join by run_id AND correlation_id. */
export const GATEWAY_HTTP_RUN_KIND = "mcp_http_request";

export interface RemoteMcpRunObserver {
	readonly status?: {
		mode: string;
		logsProjection: "configured" | "disabled" | "unknown";
	};
	readonly eventsSink?: RunEventsRingBufferSink;
	observeToolCall(
		toolName: string,
		operation: (causalContext: WorldActorCausalContext) => Promise<CallToolResult>,
	): Promise<CallToolResult>;
	/** sk-0m4.120.12 — see {@link RemoteMcpLifecycleEmit}. Best-effort, never throws. */
	emitLifecycle?: RemoteMcpLifecycleEmit;
	/** sk-0m4.120.11 — one `http_request` row per handled request. Best-effort. */
	emitHttpRequest?: (data: HttpRequestData) => void;
}

export const OFF_REMOTE_MCP_RUN_OBSERVER: RemoteMcpRunObserver = {
	status: { mode: "off", logsProjection: "disabled" },
	observeToolCall: (_toolName, operation) =>
		operation({ correlation_id: currentRemoteMcpCorrelationId() }),
	emitLifecycle: () => {},
	emitHttpRequest: () => {},
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Stable daemon-handler error code (`session_invoke_timeout`, `session_unavailable`, …). */
function resultErrorCode(result: CallToolResult): string | undefined {
	return resultErrorField(result, "code");
}

/** sk-0m4.120.36: constructor name of an unknown throw behind `internal_error`
 * (`error_class`, set by the daemon handler) — a closed identifier, never a message. */
function resultErrorClass(result: CallToolResult): string | undefined {
	return resultErrorField(result, "error_class");
}

function resultErrorField(
	result: CallToolResult,
	field: "code" | "error_class",
): string | undefined {
	if (result.isError !== true || !isRecord(result.structuredContent)) return undefined;
	const error = result.structuredContent.error;
	if (!isRecord(error)) return undefined;
	const value = error[field];
	return typeof value === "string" && value !== "" ? value : undefined;
}

const RECEIPT_VERB_KEYS = ["manipulate", "communicate", "sense"] as const;

/**
 * sk-0m4.120.10: the act receipt's SCALAR verdict, read from the modelled
 * `structuredContent` fields only — `receipt.outcome` (accepted / rejected /
 * unobserved / travelling), the dispatched verb's `action_id` / target /
 * SDK status, and `conversation.awaiting_response`. Never the utterance,
 * observation, reply text, or any free-text `reason`.
 */
export function actReceiptEventData(result: CallToolResult): Record<string, unknown> {
	const structured = result.structuredContent;
	if (!isRecord(structured)) return {};
	const out: Record<string, unknown> = {};
	const receipt = structured.receipt;
	if (isRecord(receipt)) {
		if (typeof receipt.outcome === "string") out.outcome = receipt.outcome;
		for (const key of RECEIPT_VERB_KEYS) {
			const verb = receipt[key];
			if (!isRecord(verb)) continue;
			if (typeof verb.action_id === "string") out.action_id = verb.action_id;
			if (typeof verb.target_id === "string") out.target_ref = verb.target_id;
			if (typeof verb.status === "string") out.result_status = verb.status;
			break;
		}
	}
	const conversation = structured.conversation;
	if (isRecord(conversation) && typeof conversation.awaiting_response === "boolean") {
		out.awaiting_response = conversation.awaiting_response;
	}
	return out;
}

function resultErrorCategory(
	result: CallToolResult,
): "domain" | "transport" | "protocol" | "gateway" | "internal" | undefined {
	if (result.isError !== true) return undefined;
	const structured = result.structuredContent;
	if (typeof structured !== "object" || structured === null || !("error" in structured)) {
		return "internal";
	}
	const error = structured.error;
	if (typeof error !== "object" || error === null || !("category" in error)) return "internal";
	const category = error.category;
	return category === "domain" ||
		category === "transport" ||
		category === "protocol" ||
		category === "gateway" ||
		category === "internal"
		? category
		: "internal";
}

export type ResolvedMcpRunActor = {
	actorId: string;
	worldSlug?: string;
};

export interface CreateRemoteMcpRunObserverOptions {
	/** Static fallback when `resolveActor` is absent or returns nothing. */
	actorId?: string;
	/**
	 * Prefer the world-router seat for the current authorized subject.
	 * Called once per tool call before emission so `actor_id` is not stuck on
	 * the gateway bootstrap placeholder `unresolved` (sk-1s68).
	 */
	resolveActor?: () => ResolvedMcpRunActor | undefined | Promise<ResolvedMcpRunActor | undefined>;
	sinks: readonly AgentRunSink[];
	eventsSink?: RunEventsRingBufferSink;
	logger?: PlayerMcpOperationLogger;
	now?: () => Date;
	/** Sanitized configuration evidence; never an endpoint or credential. */
	status?: RemoteMcpRunObserver["status"];
}

async function resolveRunActor(
	options: CreateRemoteMcpRunObserverOptions,
): Promise<ResolvedMcpRunActor> {
	const dynamic = await options.resolveActor?.();
	if (dynamic !== undefined && dynamic.actorId.trim() !== "" && dynamic.actorId !== "unresolved") {
		return dynamic;
	}
	const fallback = options.actorId?.trim() ?? "";
	if (fallback !== "" && fallback !== "unresolved") {
		return { actorId: fallback };
	}
	return { actorId: "unresolved" };
}

/** One canonical ADR-0074 run per authorized MCP tool invocation. */
export function createRemoteMcpRunObserver(
	options: CreateRemoteMcpRunObserverOptions,
): RemoteMcpRunObserver {
	const now = options.now ?? (() => new Date());
	const logger = options.logger ?? NOOP_PLAYER_MCP_OPERATION_LOGGER;
	// Lazily built: most observers (tests, off-mode) never emit a lifecycle row.
	let lifecycleEmitter: RunEmitter | undefined;
	const processLifecycleEmitter = (): RunEmitter => {
		lifecycleEmitter ??= createRunEmitter(
			{
				run_id: `mcp-gateway-${randomUUID()}`,
				run_kind: GATEWAY_LIFECYCLE_RUN_KIND,
				...GATEWAY_ENVELOPE,
				now,
			},
			options.sinks,
		);
		return lifecycleEmitter;
	};
	/** sk-0m4.120.12: prefer the CURRENT tool-call run (join by run_id with the
	 * tool_call that triggered the attach/detach); fall back to the process
	 * run for rows outside any request (startup, keepalive re-attach). The
	 * subject prefix is added here, never by the caller, so no caller can
	 * stamp the raw sub. */
	const emitLifecycle: RemoteMcpLifecycleEmit = (type, data = {}) => {
		try {
			const subject = currentRemoteMcpRequestSubject();
			if (subject !== undefined && subject !== "" && JSON.stringify(data).includes(subject)) {
				return;
			}
			const stamped = {
				...data,
				...(subject !== undefined && subject !== ""
					? { subject_prefix: hashTranscriptSubject(subject) }
					: {}),
			};
			const current = currentRunEmit.getStore();
			if (current !== undefined) {
				current.emit(type, stamped);
				return;
			}
			processLifecycleEmitter().emit(type, stamped);
		} catch {
			// Observability must never change a PLAYER outcome.
		}
	};
	/** sk-0m4.120.11: one row per handled request on the tool call's own run id. */
	const emitHttpRequest = (data: HttpRequestData): void => {
		try {
			createRunEmitter(
				{
					run_id: `mcp-${data.correlation_id}`,
					run_kind: GATEWAY_HTTP_RUN_KIND,
					...GATEWAY_ENVELOPE,
					now,
				},
				options.sinks,
			).emit("http_request", { ...data });
		} catch {
			// Observability must never change a PLAYER outcome.
		}
	};
	return {
		...(options.status === undefined ? {} : { status: options.status }),
		...(options.eventsSink === undefined ? {} : { eventsSink: options.eventsSink }),
		emitLifecycle,
		emitHttpRequest,
		async observeToolCall(toolName, operation) {
			const correlationId = currentRemoteMcpCorrelationId();
			const startedAt = now();
			const actor = await resolveRunActor(options);
			const causalContext = normalizeWorldActorCausalContext({
				correlation_id: correlationId,
				...(actor.worldSlug === undefined ? {} : { world_slug: actor.worldSlug }),
			}) ?? { correlation_id: correlationId };
			const subject = currentRemoteMcpRequestSubject();
			const emitter = createRunEmitter(
				{
					run_id: `mcp-${correlationId}`,
					run_kind: "mcp_tool_call",
					actor_id: actor.actorId,
					role: "PLAYER",
					controller_kind: "llm_player",
					driver: REMOTE_MCP_RUN_DRIVER,
					now,
				},
				options.sinks,
			);
			// Never stamp the raw OAuth sub — same SHA-256 prefix as public transcripts.
			const identityBits: Record<string, unknown> = {
				correlation_id: correlationId,
				...(actor.worldSlug !== undefined && actor.worldSlug !== ""
					? { world_slug: actor.worldSlug }
					: {}),
				...(subject !== undefined && subject !== ""
					? { subject_prefix: hashTranscriptSubject(subject) }
					: {}),
			};
			/** Drop the emit if any field accidentally re-introduces the raw subject. */
			const emitSafe = (type: AgentRunEventType, data: Record<string, unknown> = {}) => {
				const probe = JSON.stringify(data);
				if (subject !== undefined && subject !== "" && probe.includes(subject)) {
					return;
				}
				emitter.emit(type, data);
			};
			return currentRunEmit.run({ emit: emitSafe }, async () => {
				emitSafe("run_start", identityBits);
				let result: CallToolResult;
				try {
					result = await operation(causalContext);
				} catch (error) {
					const durationMs = Math.max(0, now().getTime() - startedAt.getTime());
					emitSafe("tool_call", {
						tool_name: toolName,
						is_error: true,
						duration_ms: durationMs,
						...identityBits,
						summary: "tool execution failed",
					});
					emitSafe("run_end", {
						terminal: "error",
						duration_ms: durationMs,
						...identityBits,
					});
					emitPlayerMcpOperationLog(
						logger,
						{
							kind: "tool_call",
							correlation_id: correlationId,
							tool_name: toolName,
							outcome: "error",
							error_category: "internal",
							duration_ms: durationMs,
						},
						now,
					);
					void emitter.close();
					throw error;
				}

				const errorCategory = resultErrorCategory(result);
				const errorCode = resultErrorCode(result);
				const errorClass = resultErrorClass(result);
				const durationMs = Math.max(0, now().getTime() - startedAt.getTime());
				emitSafe("tool_call", {
					tool_name: toolName,
					is_error: errorCategory !== undefined,
					duration_ms: durationMs,
					...identityBits,
					// sk-0m4.120.10: which act, on what, with which verdict — from the
					// modelled receipt only (never args or free text).
					...actReceiptEventData(result),
					// sk-0m4.120.42: affordance listing counts (scalars only; the
					// daemon's `details` rides here as `structuredContent`).
					...(errorCategory === undefined
						? {}
						: { error_category: errorCategory, summary: `${errorCategory} error` }),
					// sk-0m4.120.11: the stable daemon-handler code behind the category.
					...(errorCode === undefined ? {} : { error_code: errorCode }),
					// sk-0m4.120.36: which unknown throw hid behind `internal_error`.
					...(errorClass === undefined ? {} : { error_class: errorClass }),
				});
				emitSafe("run_end", {
					terminal: errorCategory === undefined ? "completed" : "error",
					duration_ms: durationMs,
					...identityBits,
				});
				emitPlayerMcpOperationLog(
					logger,
					{
						kind: "tool_call",
						correlation_id: correlationId,
						tool_name: toolName,
						outcome: errorCategory === undefined ? "ok" : "error",
						duration_ms: durationMs,
						...(errorCategory === undefined ? {} : { error_category: errorCategory }),
					},
					now,
				);
				void emitter.close();
				return result;
			});
		},
	};
}

function defaultStateRoot(env: NodeJS.ProcessEnv): string {
	return env.XDG_STATE_HOME ?? join(homedir(), ".local", "state");
}

export function defaultMcpRunEventsPath(env: NodeJS.ProcessEnv = process.env): string {
	return (
		env[MCP_RUN_EVENTS_PATH_ENV] ??
		join(defaultStateRoot(env), "spellkave", "player-mcp", AGENT_RUN_EVENTS_FILENAME)
	);
}

export function defaultMcpStatusPath(env: NodeJS.ProcessEnv = process.env): string {
	return (
		env[MCP_STATUS_PATH_ENV] ??
		join(defaultStateRoot(env), "spellkave", "player-mcp", "status.json")
	);
}

export function createRemoteMcpRunObserverFromEnv(options: {
	actorId?: string;
	resolveActor?: CreateRemoteMcpRunObserverOptions["resolveActor"];
	env?: NodeJS.ProcessEnv;
	logger?: PlayerMcpOperationLogger;
	now?: () => Date;
	bufferSize?: number;
}): RemoteMcpRunObserver {
	const env = options.env ?? process.env;
	const mode = parseRunEventsMode(env);
	const eventsSink = createRunEventsRingBufferSink(
		options.bufferSize ?? DEFAULT_RUN_EVENTS_BUFFER_SIZE,
	);
	if (mode === "off") {
		return {
			...OFF_REMOTE_MCP_RUN_OBSERVER,
			eventsSink,
		};
	}
	const sinks: AgentRunSink[] = [eventsSink];
	if (mode === "jsonl" || mode === "jsonl+otlp") {
		sinks.push(createJsonlFileSink(defaultMcpRunEventsPath(env)));
	}
	if (mode === "otlp" || mode === "jsonl+otlp") {
		const endpoint = env[RUN_EVENTS_OTLP_ENDPOINT_ENV];
		if (endpoint !== undefined && endpoint.trim() !== "") {
			const serviceVersion = serviceVersionFromEnv(env);
			sinks.push(
				createOtlpHttpSink({
					endpoint,
					headers: otlpHeadersFromEnv(env),
					...(serviceVersion === undefined ? {} : { serviceVersion }),
					resourceAttributes: logSinkResourceAttributesFromEnv(env),
				}),
			);
		}
	}
	return createRemoteMcpRunObserver({
		actorId: options.actorId,
		resolveActor: options.resolveActor,
		sinks,
		eventsSink,
		logger: options.logger,
		now: options.now,
		status: {
			mode,
			logsProjection:
				(mode === "otlp" || mode === "jsonl+otlp") && env[RUN_EVENTS_OTLP_ENDPOINT_ENV]?.trim()
					? "configured"
					: "disabled",
		},
	});
}

/**
 * Auth headers for the OTLP logs projection, from the standard
 * `OTEL_EXPORTER_OTLP_HEADERS` (`k=v,k2=v2`, values URL-encoded) — the same
 * variable the metrics/traces exporters already honour. A public ingest such
 * as `telemetry.spellkave.com` sits behind Cloudflare Access, so the gateway
 * has to present `CF-Access-Client-Id` / `CF-Access-Client-Secret`; without
 * this the projection was silently dropped at the edge (sk-0m4.120.2).
 * Never log the values: they are the ingest credential.
 */
export function otlpHeadersFromEnv(env: NodeJS.ProcessEnv): Record<string, string> {
	return otlpLogsHeadersFromEnv(env);
}

export type PlayerMcpStatusWriter<T> = (status: T) => Promise<void>;

/**
 * Atomic private status snapshot for the ADR-0002 operator commands.
 *
 * The destination may be a shared volume whose directory is owned by
 * another user. Tighten the directory mode when permitted and apply 0600
 * to the snapshot created by this process.
 */
export function createPrivateStatusFileWriter<T>(filePath: string): PlayerMcpStatusWriter<T> {
	return async (status) => {
		const directory = dirname(filePath);
		await mkdir(directory, { recursive: true, mode: 0o700 });
		try {
			await chmod(directory, 0o700);
		} catch (error) {
			if (!isNotPermittedError(error)) {
				throw error;
			}
		}
		const temporary = `${filePath}.${process.pid}.tmp`;
		await writeFile(temporary, `${JSON.stringify(status)}\n`, { mode: 0o600 });
		await chmod(temporary, 0o600);
		await rename(temporary, filePath);
		await chmod(filePath, 0o600);
	};
}

/** EPERM/EACCES from an ownership boundary we do not control. */
function isNotPermittedError(error: unknown): boolean {
	const code = (error as NodeJS.ErrnoException | undefined)?.code;
	return code === "EPERM" || code === "EACCES";
}
