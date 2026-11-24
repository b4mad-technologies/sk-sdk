import type { AgentRunEvent, AgentRunSink } from "@spellkave/agent-observability";
import type { SessionDaemonStatus } from "@spellkave/session/node";

import type { PlayerMcpGatewayStatus } from "./gateway.ts";
import { playerMcpServerInfo } from "./tools.ts";

export const MUST_GATHER_BUNDLE_VERSION = "spellkave-must-gather/v1" as const;
export const DEFAULT_MAX_MUST_GATHER_BYTES = 256 * 1024; // 256 KiB
export const DEFAULT_MAX_RUN_EVENTS = 50;
export const DEFAULT_MAX_RECENT_TOOL_ERRORS = 10;

export interface MustGatherTraceSummary {
	readonly traceId?: string;
	readonly spanCount?: number;
	readonly spans?: readonly {
		readonly name: string;
		readonly status?: string;
		readonly durationMs?: number;
		readonly attributes?: Record<string, unknown>;
	}[];
	readonly lastProvenanceStatus?: string;
	readonly lastReducer?: string;
	readonly failureClass?: string;
	readonly summary?: string;
	readonly [key: string]: unknown;
}

export interface MustGatherToolError {
	readonly toolName?: string;
	readonly correlationId?: string;
	readonly errorCategory?: "domain" | "transport" | "protocol" | "internal" | string;
	readonly errorCode?: string;
	readonly errorMessage?: string;
	readonly timestamp?: string;
	readonly durationMs?: number;
	readonly [key: string]: unknown;
}

export interface MustGatherContext {
	readonly runId?: string;
	readonly correlationId?: string;
	readonly world?: {
		readonly slug?: string;
		readonly db?: string;
	};
	readonly seat?:
		| {
				readonly actorId?: string;
				readonly actor_id?: string;
				readonly subjectPrefix?: string;
				readonly subject_prefix?: string;
				readonly role?: string;
		  }
		| string;
	readonly versions?: {
		readonly gateway?: string;
		readonly module?: string;
		readonly companion?: string;
		readonly protocol?: string | number;
		readonly [key: string]: unknown;
	};
	readonly sessionStatus?: SessionDaemonStatus | PlayerMcpGatewayStatus | Record<string, unknown>;
	readonly runEvents?: readonly AgentRunEvent[];
	readonly eventsSink?: AgentRunSink & {
		readonly events?: readonly AgentRunEvent[];
		getEvents?: (runId?: string) => readonly AgentRunEvent[];
	};
	readonly traceSummary?: MustGatherTraceSummary | Record<string, unknown>;
	readonly recentToolErrors?: readonly (MustGatherToolError | Record<string, unknown>)[];
	readonly timestamps?: {
		readonly collectedAt?: string;
		readonly collected_at?: string;
		readonly sessionStartedAt?: string;
		readonly [key: string]: string | undefined;
	};
	readonly maxEvents?: number;
	readonly maxBytes?: number;
	readonly now?: () => Date;
	readonly notes?: string;
	readonly clientInfo?: Record<string, unknown>;
}

export interface MustGatherBundle {
	v: typeof MUST_GATHER_BUNDLE_VERSION;
	collected_at: string;
	world: {
		slug: string;
		db: string;
	};
	seat: {
		actor_id: string;
		subject_prefix?: string;
		role?: string;
	};
	versions: {
		gateway: string;
		module: string;
		companion?: string;
		protocol?: string | number;
		[key: string]: unknown;
	};
	session_status: Record<string, unknown>;
	run: {
		run_id: string;
		correlation_id?: string;
		events_count: number;
		events: AgentRunEvent[];
	};
	traces_summary: Record<string, unknown>;
	recent_tool_errors: MustGatherToolError[];
	timestamps: {
		collected_at: string;
		[key: string]: string | undefined;
	};
	diagnostics: {
		size_bytes: number;
		truncated: boolean;
	};
	notes?: string;
	client_info?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Redaction Engine
// ---------------------------------------------------------------------------

/**
 * Standard bearer token pattern: Authorization header or raw Bearer prefix.
 */
const BEARER_TOKEN_REGEX = /\b(bearer\s+)([a-zA-Z0-9_\-.~+/]+=*)/gi;

/**
 * Standard JWT pattern: header.payload.signature
 * Starts with eyJ (base64 of {"alg" or {"typ")
 */
const JWT_TOKEN_REGEX = /\beyJ[a-zA-Z0-9_-]{5,}\.eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]+\b/g;

/**
 * API tokens with known Stripe, GitHub, and WorkOS prefixes.
 */
const SECRET_PREFIX_REGEX = /\b(sk|ghp|gho|ghu|ghs|ghr|workos)_[a-zA-Z0-9_-]{16,}\b/g;

/**
 * Email address pattern (RFC 5322 compatible common subsets)
 */
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g;

/**
 * URL credentials: https://user:password@hostname -> https://[REDACTED]@hostname
 */
const URL_CREDENTIALS_REGEX = /^(https?:\/\/)([^:/@]+:[^@/]+)@/i;

/**
 * Field names that must have their direct string values fully redacted.
 */
export const SENSITIVE_FIELD_NAMES = new Set([
	"authorization",
	"auth",
	"authtoken",
	"access_token",
	"accesstoken",
	"refresh_token",
	"refreshtoken",
	"id_token",
	"idtoken",
	"token",
	"bearer",
	"secret",
	"client_secret",
	"clientsecret",
	"password",
	"passwd",
	"api_key",
	"apikey",
	"private_key",
	"privatekey",
	"cookie",
	"set-cookie",
]);

function isSensitiveFieldName(name: string): boolean {
	const normalized = name.toLowerCase().replace(/[-_]/g, "");
	if (SENSITIVE_FIELD_NAMES.has(name.toLowerCase())) return true;
	if (SENSITIVE_FIELD_NAMES.has(normalized)) return true;
	return false;
}

/**
 * Redact sensitive patterns (JWTs, bearer tokens, emails, secrets) within a string.
 */
export function redactString(input: string): string {
	if (input === "") return input;

	let result = input;

	// Redact URL credentials
	result = result.replace(URL_CREDENTIALS_REGEX, "$1[REDACTED_AUTH]@");

	// Redact explicit Bearer tokens
	result = result.replace(BEARER_TOKEN_REGEX, "$1[REDACTED_TOKEN]");

	// Redact standalone JWTs
	result = result.replace(JWT_TOKEN_REGEX, "[REDACTED_JWT]");

	// Redact known token prefixes
	result = result.replace(SECRET_PREFIX_REGEX, "[REDACTED_TOKEN]");

	// Redact email addresses
	result = result.replace(EMAIL_REGEX, "[REDACTED_EMAIL]");

	return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deeply redact sensitive tokens, authorization headers, passwords, and emails
 * from any object, array, or primitive.
 */
export function redactSensitiveData<T>(input: T, seen = new WeakSet<object>()): T {
	if (typeof input === "string") {
		return redactString(input) as unknown as T;
	}

	if (typeof input !== "object" || input === null) {
		return input;
	}

	if (seen.has(input)) {
		return "[CIRCULAR]" as unknown as T;
	}
	seen.add(input);

	if (Array.isArray(input)) {
		return input.map((item) => redactSensitiveData(item, seen)) as unknown as T;
	}

	if (isPlainObject(input)) {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(input)) {
			if (isSensitiveFieldName(key)) {
				out[key] = "[REDACTED_TOKEN]";
			} else {
				out[key] = redactSensitiveData(value, seen);
			}
		}
		return out as unknown as T;
	}

	return input;
}

// ---------------------------------------------------------------------------
// Size Capping / Truncation
// ---------------------------------------------------------------------------

function truncateStringsDeep<T>(input: T, maxLen: number, seen = new WeakSet<object>()): T {
	if (typeof input === "string") {
		if (input.length > maxLen) {
			return `${input.slice(0, maxLen)}...[TRUNCATED]` as unknown as T;
		}
		return input;
	}

	if (typeof input !== "object" || input === null) {
		return input;
	}

	if (seen.has(input)) return input;
	seen.add(input);

	if (Array.isArray(input)) {
		return input.map((item) => truncateStringsDeep(item, maxLen, seen)) as unknown as T;
	}

	if (isPlainObject(input)) {
		const out: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(input)) {
			out[key] = truncateStringsDeep(value, maxLen, seen);
		}
		return out as unknown as T;
	}

	return input;
}

function finalizeDiagnostics(bundle: MustGatherBundle, truncated: boolean): MustGatherBundle {
	bundle.diagnostics = { size_bytes: 0, truncated };
	for (let i = 0; i < 4; i++) {
		const len = JSON.stringify(bundle).length;
		if (bundle.diagnostics.size_bytes === len) break;
		bundle.diagnostics.size_bytes = len;
	}
	return bundle;
}

function enforceSizeCap(bundle: MustGatherBundle, maxBytes: number): MustGatherBundle {
	let testBundle = finalizeDiagnostics({ ...bundle }, false);
	if (testBundle.diagnostics.size_bytes <= maxBytes) {
		return testBundle;
	}

	let modified = { ...bundle };

	// Step 1: Reduce run events to the most recent 10 if there are more
	if (modified.run.events.length > 10) {
		modified.run = {
			...modified.run,
			events: modified.run.events.slice(-10),
		};
		testBundle = finalizeDiagnostics({ ...modified }, true);
		if (testBundle.diagnostics.size_bytes <= maxBytes) {
			return testBundle;
		}
	}

	// Step 2: Reduce tool errors to the most recent 5
	if (modified.recent_tool_errors.length > 5) {
		modified.recent_tool_errors = modified.recent_tool_errors.slice(-5);
		testBundle = finalizeDiagnostics({ ...modified }, true);
		if (testBundle.diagnostics.size_bytes <= maxBytes) {
			return testBundle;
		}
	}

	// Step 3: Truncate large strings across the whole bundle
	for (const limit of [1024, 256, 64]) {
		modified = truncateStringsDeep(modified, limit);
		testBundle = finalizeDiagnostics({ ...modified }, true);
		if (testBundle.diagnostics.size_bytes <= maxBytes) {
			return testBundle;
		}
	}

	// Step 4: Aggressive fallback if still over maxBytes
	modified.run = {
		...modified.run,
		events: modified.run.events.slice(-2),
	};
	modified.recent_tool_errors = modified.recent_tool_errors.slice(-2);
	modified = truncateStringsDeep(modified, 32);
	return finalizeDiagnostics(modified, true);
}

// ---------------------------------------------------------------------------
// Bundle Builder
// ---------------------------------------------------------------------------

function resolveActorId(ctx: MustGatherContext): string {
	if (typeof ctx.seat === "string" && ctx.seat.trim() !== "") {
		return ctx.seat.trim();
	}
	if (typeof ctx.seat === "object" && ctx.seat !== null) {
		const id = ctx.seat.actorId ?? ctx.seat.actor_id;
		if (typeof id === "string" && id.trim() !== "") return id.trim();
	}
	if (ctx.sessionStatus !== undefined && "binding" in ctx.sessionStatus) {
		const binding = ctx.sessionStatus.binding as { actorId?: string; actor_id?: string };
		const id = binding?.actorId ?? binding?.actor_id;
		if (typeof id === "string" && id.trim() !== "") return id.trim();
	}
	return "unresolved";
}

function resolveWorld(ctx: MustGatherContext): { slug: string; db: string } {
	let slug = ctx.world?.slug?.trim() ?? "";
	let db = ctx.world?.db?.trim() ?? "";

	if (db === "" && ctx.sessionStatus !== undefined && "binding" in ctx.sessionStatus) {
		const binding = ctx.sessionStatus.binding as { db?: string };
		if (typeof binding?.db === "string") db = binding.db.trim();
	}

	if (slug === "" && db !== "") {
		slug = db;
	}

	return {
		slug: slug || "unknown",
		db: db || "unknown",
	};
}

function resolveSubjectPrefix(ctx: MustGatherContext): string | undefined {
	if (typeof ctx.seat !== "object" || ctx.seat === null) return undefined;
	const prefix = ctx.seat.subjectPrefix ?? ctx.seat.subject_prefix;
	return typeof prefix === "string" && prefix.trim() !== "" ? prefix.trim() : undefined;
}

function eventStringField(event: AgentRunEvent, key: string): string | undefined {
	const value = event.data?.[key];
	return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The caller's slice of the process-wide ring buffer: every row stamped with
 * the caller's hashed `subject_prefix` (observability.ts identityBits), bounded
 * to the last `maxEvents`.
 *
 * Never by `run_id`: each MCP tool call is its own run, so a run_id filter can
 * only ever return the feedback call's own `run_start` (sk-0m4.120.8).
 *
 * Identity is compared as `(row.subject_prefix ?? undefined) === callerPrefix`,
 * so a caller without a subject (local stdio, no OAuth) keeps only unstamped
 * rows and an authenticated caller keeps only their own — another player's
 * rows never cross over. `world_slug` is a soft filter: rows stamped with a
 * different world are dropped, unstamped rows stay.
 */
function resolveEvents(ctx: MustGatherContext, worldSlug: string | undefined): AgentRunEvent[] {
	let rawEvents: readonly AgentRunEvent[] = [];

	if (ctx.runEvents !== undefined) {
		rawEvents = ctx.runEvents;
	} else if (ctx.eventsSink !== undefined) {
		if (typeof ctx.eventsSink.getEvents === "function") {
			rawEvents = ctx.eventsSink.getEvents();
		} else if (Array.isArray(ctx.eventsSink.events)) {
			rawEvents = ctx.eventsSink.events;
		}
	}

	const subjectPrefix = resolveSubjectPrefix(ctx);
	rawEvents = rawEvents.filter((e) => eventStringField(e, "subject_prefix") === subjectPrefix);

	if (worldSlug !== undefined) {
		rawEvents = rawEvents.filter((e) => {
			const rowSlug = eventStringField(e, "world_slug");
			return rowSlug === undefined || rowSlug === worldSlug;
		});
	}

	const maxEvents = ctx.maxEvents ?? DEFAULT_MAX_RUN_EVENTS;
	const sliced = rawEvents.slice(-maxEvents);
	return sliced.map((e) => ({ ...e }));
}

/**
 * `recent_tool_errors` from `tool_call` rows with `is_error=true` — the same
 * fields the observer stamps (tool_name, error_category, error_code when an
 * emitter provides one, duration_ms, ts, correlation_id). Never the tool's
 * arguments or result: the ring buffer never held them either.
 */
export function deriveRecentToolErrors(
	events: readonly AgentRunEvent[],
	maxErrors: number = DEFAULT_MAX_RECENT_TOOL_ERRORS,
): MustGatherToolError[] {
	const errors: MustGatherToolError[] = [];
	for (const event of events) {
		if (event.type !== "tool_call" || event.data?.is_error !== true) continue;
		const toolName = eventStringField(event, "tool_name");
		const errorCategory = eventStringField(event, "error_category");
		const errorCode = eventStringField(event, "error_code");
		const correlationId = eventStringField(event, "correlation_id");
		const summary = eventStringField(event, "summary");
		const durationMs = event.data?.duration_ms;
		errors.push({
			...(toolName !== undefined ? { toolName } : {}),
			...(correlationId !== undefined ? { correlationId } : {}),
			...(errorCategory !== undefined ? { errorCategory } : {}),
			...(errorCode !== undefined ? { errorCode } : {}),
			...(summary !== undefined ? { errorMessage: summary } : {}),
			timestamp: event.ts,
			...(typeof durationMs === "number" ? { durationMs } : {}),
			runId: event.run_id,
		});
	}
	return errors.slice(-maxErrors);
}

/**
 * Collects a player's diagnostic report in the gateway into a versioned,
 * size-capped, redacted JSON bundle.
 *
 * Pure function with no network calls or filesystem writes.
 */
export function buildMustGather(ctx: MustGatherContext): MustGatherBundle {
	const now = ctx.now ?? (() => new Date());
	const collectedAt =
		ctx.timestamps?.collectedAt ?? ctx.timestamps?.collected_at ?? now().toISOString();

	const world = resolveWorld(ctx);
	const actorId = resolveActorId(ctx);

	const subjectPrefix =
		typeof ctx.seat === "object" && ctx.seat !== null
			? (ctx.seat.subjectPrefix ?? ctx.seat.subject_prefix)
			: undefined;

	const role = typeof ctx.seat === "object" && ctx.seat !== null ? ctx.seat.role : undefined;

	const gatewayVersion = ctx.versions?.gateway?.trim() || playerMcpServerInfo().version;
	const moduleVersion = ctx.versions?.module?.trim() || "unknown";

	const versions = {
		gateway: gatewayVersion,
		module: moduleVersion,
		...(ctx.versions ?? {}),
	};

	const sessionStatus = (ctx.sessionStatus ?? {}) as Record<string, unknown>;

	const events = resolveEvents(ctx, ctx.world?.slug?.trim() || undefined);
	const runId =
		ctx.runId ??
		(ctx.correlationId !== undefined
			? `mcp-${ctx.correlationId}`
			: (events[0]?.run_id ?? "unknown"));

	const correlationId =
		ctx.correlationId ?? (events[0]?.data?.correlation_id as string | undefined);

	const tracesSummary = (ctx.traceSummary ?? {}) as Record<string, unknown>;

	const recentToolErrors = (ctx.recentToolErrors ??
		deriveRecentToolErrors(events)) as MustGatherToolError[];

	const timestamps: {
		collected_at: string;
		[key: string]: string | undefined;
	} = {
		...(ctx.timestamps ?? {}),
		collected_at: collectedAt,
	};

	const rawBundle: MustGatherBundle = {
		v: MUST_GATHER_BUNDLE_VERSION,
		collected_at: collectedAt,
		world,
		seat: {
			actor_id: actorId,
			...(subjectPrefix !== undefined ? { subject_prefix: subjectPrefix } : {}),
			...(role !== undefined ? { role } : {}),
		},
		versions,
		session_status: sessionStatus,
		run: {
			run_id: runId,
			...(correlationId !== undefined ? { correlation_id: correlationId } : {}),
			events_count: events.length,
			events,
		},
		traces_summary: tracesSummary,
		recent_tool_errors: recentToolErrors,
		timestamps,
		diagnostics: {
			size_bytes: 0,
			truncated: false,
		},
		...(ctx.notes !== undefined ? { notes: ctx.notes } : {}),
		...(ctx.clientInfo !== undefined ? { client_info: ctx.clientInfo } : {}),
	};

	// Redact sensitive data (tokens, emails, secrets, credentials)
	const redacted = redactSensitiveData(rawBundle);

	// Enforce size cap (default 256 KiB)
	const maxBytes = ctx.maxBytes ?? DEFAULT_MAX_MUST_GATHER_BYTES;
	return enforceSizeCap(redacted, maxBytes);
}
