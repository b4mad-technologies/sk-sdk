// OTel PROJECTION sink (ADR-0074): OTel is a projection, never the source of
// truth — the canonical store stays file-based JSONL run artifacts.
//
// BINDING disambiguation (ADR-0074, "Naming disambiguation"): this package
// observes WORLD ACTORS. ADR-0030 coding-agent telemetry owns separate trace
// and metric streams. This sink MUST use the distinct resource/service names
// below and MUST NOT write into any ADR-0030 stream.

import type { AgentRunSink } from "./emit.ts";
import type { AgentRunEvent } from "./events.ts";

/** OTel resource `service.name` for world-actor run events. Distinct from
 * every ADR-0030 coding-agent service name by construction. */
export const OTEL_SERVICE_NAME = "spellkave-world-actors";

/** Target stream name for the OTel logs projection. Never a coding-agent
 * stream. */
export const OTEL_STREAM_NAME = "world_actor_run_events";

export interface OtelSinkOptions {
	/** Transport injected by the host (e.g. an OTLP HTTP poster). S2 ships the
	 * sink as a stub around this callback; S5 fills the wiring. */
	export: (resource: { serviceName: string; stream: string }, event: AgentRunEvent) => void;
}

/**
 * Injected-transport projection: each event goes through the host's transport
 * with the world-actor resource names. Kept dependency-free — no OTel SDK
 * import in this package; the host supplies transport.
 */
export function createOtelProjectionSink(options: OtelSinkOptions): AgentRunSink {
	return {
		write(event) {
			options.export({ serviceName: OTEL_SERVICE_NAME, stream: OTEL_STREAM_NAME }, event);
		},
	};
}

// ── S5 fill: a batteries-included OTLP/HTTP logs exporter ────────────────────

export interface OtlpHttpSinkOptions {
	/** OTLP logs endpoint, e.g. `http://host:5080/api/default/v1/logs`. */
	endpoint: string;
	/** Extra request headers (auth, `stream-name`, ...). The stream-name header
	 * is always forced to OTEL_STREAM_NAME — never an ADR-0030 stream. */
	headers?: Record<string, string>;
	/** Injectable fetch for tests / non-global environments. */
	fetchFn?: typeof fetch;
	/** Delivery failure hook (default: silent — observability never breaks the run). */
	onError?: (error: unknown) => void;
	/** Maximum concurrent requests; excess projection copies are dropped. Default 64. */
	maxPendingExports?: number;
	/** Records per POST. Default 100. `1` restores one-request-per-event. */
	maxBatchRecords?: number;
	/** Upper bound on how long a record may wait for a partial batch, in
	 * milliseconds. Default 2000. Under load the size trigger fires first, so
	 * this is the latency ceiling on a quiet world, not the normal path. */
	flushIntervalMs?: number;
	/** Hard cap on buffered records; beyond it, writes are dropped. Default
	 * 10000. `0` disables buffering entirely (every write sends or drops).
	 * Without this cap an unreachable collector would trade "lose telemetry"
	 * for "the host fills up", which is the worse failure. */
	maxBufferedRecords?: number;
	/** Abort each request after this deadline; default 10 seconds. */
	requestTimeoutMs?: number;
	/** Deployed revision for the `service.version` resource attribute. */
	serviceVersion?: string;
	/** Additional resource attributes, filtered through
	 * `OTLP_LOG_SAFE_RESOURCE_ATTRIBUTE_KEYS` (sk-jay0.6.38.13). Callers
	 * assemble this from env — this module stays dependency-free and never
	 * reads env itself. */
	resourceAttributes?: Record<string, string>;
}

/**
 * Event-data fields admitted to the shared OTLP projection. Canonical JSONL
 * intentionally remains richer; this list is the projection's disclosure
 * boundary and must stay scalar-only.
 *
 * ADR-0114 D-4a: `utterance` and `intent` are NOT on this list. Player-authored
 * text on a creation readback (`intent.utterance`) must not inherit into OTLP
 * because a retired stdout projection used to exclude it by construction.
 * Proof: `otel-sink.test.ts` "drops intent.utterance on brain_decision".
 */
export const OTEL_SAFE_EVENT_DATA_FIELDS = [
	"tool_name",
	"is_error",
	"duration_ms",
	"tool_calls_used",
	"max_tool_calls",
	"dry_streak",
	"max_dry_streak",
	"tokens_used",
	"token_budget",
	"turn",
	"input_tokens",
	"output_tokens",
	"tool_calls",
	"max_events",
	"events_written",
	"terminal",
	"turns",
	"correlation_id",
	"world_slug",
	/** SHA-256 hex prefix of an OAuth subject — never the raw `sub`. */
	"subject_prefix",
	"cause_kind",
	"cause_id",
	"action_id",
	"target_ref",
	"provenance_id",
	"provenance_status",
	"provenance_kind",
	"failure_class",
	"result_status",
	"poll_count",
	"lag_warning",
	"invoke_settled",
	"invoke_failed",
	"error_category",
	"step",
	"error_code",
	// sk-0m4.120.36: constructor name of the throw behind `internal_error`
	// (`RangeError`, `ZodError`, …) — an identifier, never a message.
	"error_class",
	// sk-0m4.120.42: factual PLAYER-context counts — integers and one boolean;
	// never direct-attempt parameters, rows, or text.
	"total_rows",
	"matched",
	"shown",
	"truncated",
	"retry_count",
	// sk-jay0.7.389.3 contract_shape_mismatch — schema names and types only
	// (the module's own table/column/reducer identifiers), never row data.
	"shape_item",
	"shape_detail",
	"shape_mode",
	"shape_database",
	"client_epoch",
	// sk-rax8.7 player_feedback — join keys only; never message/bundle body.
	"category",
	"reference",
	"bundle_sha256",
	"message_chars",
	// sk-0m4.120.10 act receipts — the receipt's closed vocabulary
	// (accepted/rejected/unobserved/travelling) and the reply-window flag; never
	// the utterance, observation, or conversation text.
	"outcome",
	"awaiting_response",
	// sk-0m4.120.11 gateway HTTP edge — route is the matched PATTERN, never a URL.
	"http_status",
	"http_method",
	"route",
	"cf_ray",
	// sk-0m4.120.12 lifecycle — closed-vocabulary scalars only.
	"image_tag",
	"spawned",
	"cause",
	"reason",
	// sk-jay0.6.38.2 world_lifecycle — five new disclosure fields; `world_slug`,
	// `duration_ms`, `image_tag`, `failure_class`, `error_class`, `error_code`
	// above are reused. `job_id`/`artifact_digest` are join keys and a pinned
	// digest, never secret; `phase`/`job_kind`/`boot_ms` are closed-vocabulary
	// or numeric.
	"phase",
	"job_id",
	"job_kind",
	"boot_ms",
	"artifact_digest",
	// ADR-0114 D-2: the decision branch a brain took, as a stable identifier
	// (`wait/no-level-earned-yet`), never prose and never a payload.
	"rule",
	// ADR-0114 D-2 option A (sk-jay0.6.31.15 / .17): seventeen literal
	// decision-input key names, hoisted to the payload top by
	// `emitBrainDecision`. The nested `inputs` map itself is NOT admitted — it
	// is not a scalar. Unlisted input names are dropped here, not renamed and
	// not blobbed.
	//
	// Tripwire: revisit option A if the DISTINCT decision-input name count
	// exceeds 25 (see `OTEL_DECISION_INPUT_FIELDS`). Decision-input census
	// today: 17. World-table projection adds 3 more SAFE keys below (not
	// decision inputs), the Rust npc-host 3 more after those; combined
	// distinct names at this list tail: 23.
	// `step` is already admitted above as cycle-step vocabulary; it is also one
	// of the seventeen names.
	"quest",
	"intendedRule",
	"viewKind",
	"role",
	"desired",
	"myTurn",
	"goal",
	"speaker",
	"retryCount",
	"errorCode",
	// sk-jay0.6.31.17: Aldwin wait-branch keys already emitted on every wait.
	"levelBand",
	"offerPresent",
	"applyPresent",
	"advancementLive",
	"heardQuestion",
	"speakable",
	// sk-jay0.6.31.7: WorldEvent TABLE header projection (not the player-facing
	// `world_event` delivery type). Scalar join keys only; never summary or
	// detail-table content. Not decision-input names — they do not belong on
	// `OTEL_DECISION_INPUT_FIELDS`. Combined distinct names at this list tail:
	// 17 decision-input + 3 world-table + 3 Rust npc-host = 23. Tripwire 25
	// stays on the decision-input census.
	"event_id",
	"tick",
	"event_kind",
	// sk-jay0.1.55.60.35: Rust npc-host `brain_decision` rows. `intent_kind` is
	// the closed intent vocabulary (wait/communicate/manipulate/move/end_turn/
	// react), `record_type` the closed DM record vocabulary (ceremony/layer/
	// setup/boot/class_diagnostic), `repeat_count` the number of identical
	// consecutive waits folded into one row (Slayer sk-w8zx.129). Not
	// decision-input names; the decision-input census stays 17.
	"intent_kind",
	"record_type",
	"repeat_count",
] as const;

/** The seventeen decision-input key names admitted under option A.
 * Tripwire: if this list grows past 25 distinct names, revisit the choice.
 * Count today: 17. `step` lives in `OTEL_SAFE_EVENT_DATA_FIELDS` already
 * (cycle-step) and is included here so the census stays one list.
 * `closedForLevel` and `offeredForLevel` stay JSONL-only: they live under
 * `reasoning.state`, not in the emitted `inputs` map. */
export const OTEL_DECISION_INPUT_FIELDS = [
	"quest",
	"intendedRule",
	"viewKind",
	"role",
	"desired",
	"myTurn",
	"goal",
	"speaker",
	"step",
	"retryCount",
	"errorCode",
	"levelBand",
	"offerPresent",
	"applyPresent",
	"advancementLive",
	"heardQuestion",
	"speakable",
] as const;

export type OtelSafeEventDataField = (typeof OTEL_SAFE_EVENT_DATA_FIELDS)[number];
export type OtelSafeScalar = string | number | boolean;

const MAX_PROJECTED_STRING_LENGTH = 256;

/** `hashTranscriptSubject` shape: first 16 hex chars of SHA-256. Anything else
 * (including a raw OAuth `sub`) is refused at the OTLP disclosure boundary. */
const SUBJECT_PREFIX_PATTERN = /^[a-f0-9]{16}$/;

function safeScalar(value: unknown): OtelSafeScalar | undefined {
	if (typeof value === "string") return value.slice(0, MAX_PROJECTED_STRING_LENGTH);
	if (typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return undefined;
}

function safeSubjectPrefix(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim().toLowerCase();
	return SUBJECT_PREFIX_PATTERN.test(trimmed) ? trimmed : undefined;
}

/** Central, allowlisted projection of event data. Unknown, nested, and
 * content-bearing fields are dropped even when a caller emits them.
 * `subject_prefix` is admitted only as a 16-char hex hash — never a raw sub. */
export function projectSafeEventData(
	data: Readonly<Record<string, unknown>>,
): Partial<Record<OtelSafeEventDataField, OtelSafeScalar>> {
	const projected: Partial<Record<OtelSafeEventDataField, OtelSafeScalar>> = {};
	for (const key of OTEL_SAFE_EVENT_DATA_FIELDS) {
		const value = key === "subject_prefix" ? safeSubjectPrefix(data[key]) : safeScalar(data[key]);
		if (value !== undefined) projected[key] = value;
	}
	return projected;
}

function otlpAttribute(key: string, value: OtelSafeScalar): Record<string, unknown> {
	if (typeof value === "boolean") return { key, value: { boolValue: value } };
	if (typeof value === "number") {
		return Number.isInteger(value)
			? { key, value: { intValue: String(value) } }
			: { key, value: { doubleValue: value } };
	}
	return { key, value: { stringValue: value } };
}

/** Map one v1 event to an OTLP LogRecord using only the safe projection. */
export function toOtlpLogRecord(event: AgentRunEvent): Record<string, unknown> {
	const envelope = {
		run_id: event.run_id,
		run_kind: event.run_kind,
		actor_id: event.actor_id,
		role: event.role,
		controller_kind: event.controller_kind,
		driver: event.driver,
		...(event.model === undefined ? {} : { model: event.model }),
		seed: event.seed,
		event_type: event.type,
		// The game clock may deliberately be historical for a reproducible
		// adventure. OTLP backends commonly reject such timestamps at ingest, so
		// retain the event time as data while indexing the projection at its real
		// delivery time.
		event_ts: event.ts,
	};
	const data = projectSafeEventData(event.data);
	const attributes = [
		...Object.entries(envelope).map(([key, value]) =>
			otlpAttribute(key, String(value).slice(0, MAX_PROJECTED_STRING_LENGTH)),
		),
		...Object.entries(data).map(([key, value]) => otlpAttribute(`spellkave.${key}`, value)),
	];
	return {
		timeUnixNano: `${Date.now()}000000`,
		severityText: "INFO",
		body: { stringValue: JSON.stringify({ type: event.type, data }) },
		attributes,
	};
}

/**
 * Extra resource attributes a host may stamp onto the logs projection,
 * restricted to this explicit allowlist — same discipline as
 * `SAFE_RESOURCE_ATTRIBUTE_KEYS` in traces.ts/metrics.ts. Anything outside
 * the list is dropped silently rather than surfacing an unreviewed key on
 * the wire.
 *
 * `deployment.environment` (not `.name`) is the one Spellkave hosts emit
 * (sk-jay0.6.38.13): it is the collector's hygiene key — the shared
 * OpenObserve collector stamps `deployment.environment=otel-sink` only when
 * a record arrives with none — and it is also the LIVE column name
 * (`deployment_environment` on `world_actor_run_events`). The newer
 * `.name` variant is kept alongside for any exporter that already emits it.
 */
export const OTLP_LOG_SAFE_RESOURCE_ATTRIBUTE_KEYS = new Set([
	"deployment.environment",
	"deployment.environment.name",
	"service.namespace",
]);

export interface OtlpResourceOptions {
	/** Deployed revision (`SPELLKAVE_IMAGE_TAG`, e.g. `sha-919f9ae5`) projected
	 * as the standard OTel `service.version` resource attribute so every
	 * exported row names the code that produced it (sk-0m4.120.13). Omitted
	 * when unknown — never a placeholder. */
	serviceVersion?: string;
	/** Additional resource attributes, filtered through
	 * `OTLP_LOG_SAFE_RESOURCE_ATTRIBUTE_KEYS` (sk-jay0.6.38.13). */
	resourceAttributes?: Record<string, string>;
}

/** Wrap log records in an OTLP/HTTP JSON payload with the WORLD-ACTOR
 * resource — `service.name` distinct from every ADR-0030 coding-agent
 * service by construction. */
export function toOtlpPayload(
	records: ReadonlyArray<Record<string, unknown>>,
	resource: OtlpResourceOptions = {},
): unknown {
	const serviceVersion = resource.serviceVersion?.trim();
	const extraAttributes = Object.entries(resource.resourceAttributes ?? {})
		.filter(([key, value]) => OTLP_LOG_SAFE_RESOURCE_ATTRIBUTE_KEYS.has(key) && value.trim() !== "")
		.map(([key, value]) => ({ key, value: { stringValue: value } }));
	return {
		resourceLogs: [
			{
				resource: {
					attributes: [
						{ key: "service.name", value: { stringValue: OTEL_SERVICE_NAME } },
						{ key: "spellkave.observes", value: { stringValue: "world_actors" } },
						...(serviceVersion
							? [{ key: "service.version", value: { stringValue: serviceVersion } }]
							: []),
						...extraAttributes,
					],
				},
				scopeLogs: [
					{
						scope: { name: "@spellkave/agent-observability" },
						logRecords: records,
					},
				],
			},
		],
	};
}

/** Sink-lifetime counters; timeout and failure can describe the same request. */
export interface OtlpTransportSnapshot {
	pending: number;
	dropped: number;
	timedOut: number;
	failed: number;
}

export interface OtlpHttpSink extends AgentRunSink {
	/** Local snapshot for a separate metrics transport; never emits another log. */
	transportSnapshot(): OtlpTransportSnapshot;
}

/** OTLP logs projection: records are batched into one POST, then admitted
 * against a bounded concurrency budget. Saturation loses projection copies,
 * never gameplay state. Requests receive an abort deadline; close flushes the
 * buffer and drains actual settlement, so an injected abort-ignoring transport
 * still requires the caller's bounded shutdown policy.
 *
 * Batching is the point (sk-jay0.6.15.56.21). This sink is ONE PER HOST
 * PROCESS — every seat worker relays its events to the parent, whose single
 * emitter is the one projection sink (`seat-worker-runtime.ts`) — so 71 seats
 * shared the same 64 admission slots. At one request per record that ceiling is
 * reached under a burst of events before any single export settles.
 * At 100 records per POST the same budget absorbs a hundred times the rate.
 *
 * See otel-backpressure.test.ts and otel-batching.test.ts. */
export function createOtlpHttpSink(options: OtlpHttpSinkOptions): OtlpHttpSink {
	const doFetch = options.fetchFn ?? fetch;
	const pending = new Set<Promise<void>>();
	const configuredMax = options.maxPendingExports ?? 64;
	const maxPending = Number.isFinite(configuredMax) ? Math.max(1, Math.trunc(configuredMax)) : 64;
	const configuredBatch = options.maxBatchRecords ?? 100;
	const maxBatch = Number.isFinite(configuredBatch)
		? Math.max(1, Math.trunc(configuredBatch))
		: 100;
	const configuredInterval = options.flushIntervalMs ?? 2_000;
	const flushIntervalMs = Number.isFinite(configuredInterval)
		? Math.max(1, Math.trunc(configuredInterval))
		: 2_000;
	const configuredBuffer = options.maxBufferedRecords ?? 10_000;
	const maxBuffered = Number.isFinite(configuredBuffer)
		? Math.max(0, Math.trunc(configuredBuffer))
		: 10_000;
	const buffer: Array<Record<string, unknown>> = [];
	let flushTimer: ReturnType<typeof setTimeout> | undefined;
	let saturated = false;
	let dropped = 0;
	let timedOut = 0;
	let failed = 0;
	const configuredTimeout = options.requestTimeoutMs ?? 10_000;
	const timeoutMs = Number.isFinite(configuredTimeout)
		? Math.max(1, Math.trunc(configuredTimeout))
		: 10_000;
	const reportError = (error: unknown) => {
		try {
			options.onError?.(error);
		} catch {
			// Error reporting must not break the actor or export cleanup.
		}
	};
	return {
		transportSnapshot: () => ({ pending: pending.size, dropped, timedOut, failed }),
		write(event) {
			const record = toOtlpLogRecord(event);
			// Batch only under pressure. With a free slot and nothing already
			// queued there is nothing to gain by waiting: the record goes now, at
			// the latency it has always had. Batches form exactly when admission
			// is full, which is the state that was dropping records.
			if (buffer.length === 0 && sendReady()) {
				send([record]);
				return;
			}
			// The buffer is the last line of defence, not the normal path, and
			// dropping at its ceiling is deliberate. Losing projection copies is
			// the documented trade; growing without bound until the host dies is
			// not.
			if (buffer.length >= maxBuffered) {
				dropped++;
				if (!saturated) {
					saturated = true;
					reportError(new Error("OTLP logs export queue is saturated"));
				}
				return;
			}
			buffer.push(record);
			if (buffer.length >= maxBatch) {
				drainBuffer();
				return;
			}
			// Size trigger missed, so arm the latency ceiling. A quiet world must
			// not hold its last records forever — those are the ones worth having.
			if (flushTimer === undefined) {
				flushTimer = setTimeout(() => {
					flushTimer = undefined;
					drainBuffer();
				}, flushIntervalMs);
				flushTimer.unref?.();
			}
		},
		async close() {
			if (flushTimer !== undefined) {
				clearTimeout(flushTimer);
				flushTimer = undefined;
			}
			// Flush what is buffered, waiting for admission between rounds: a
			// shutdown that abandoned the buffer would discard exactly the records
			// a crash makes interesting. Each round frees at least one slot, so
			// this terminates unless the transport itself never settles — which is
			// the same unbounded case `close` already had.
			while (buffer.length > 0) {
				drainBuffer();
				if (buffer.length === 0) break;
				await Promise.allSettled([...pending]);
			}
			// Drain every in-flight POST — settled, not raced, so a slow or
			// failing delivery can't be abandoned mid-flight by a fast Promise.race.
			await Promise.allSettled([...pending]);
		},
	};

	function sendReady(): boolean {
		return pending.size < maxPending;
	}

	/** Send whole batches while admission allows. Anything left stays buffered
	 * for the next trigger rather than being discarded here. */
	function drainBuffer(): void {
		while (buffer.length > 0 && sendReady()) {
			send(buffer.splice(0, maxBatch));
		}
		if (buffer.length === 0 && flushTimer !== undefined) {
			clearTimeout(flushTimer);
			flushTimer = undefined;
		}
	}

	function send(records: Array<Record<string, unknown>>): void {
		const payload = toOtlpPayload(records, {
			...(options.serviceVersion === undefined ? {} : { serviceVersion: options.serviceVersion }),
			...(options.resourceAttributes === undefined
				? {}
				: { resourceAttributes: options.resourceAttributes }),
		});
		// Build through Headers so header-name case-insensitivity works FOR the
		// binding instead of against it: a caller-supplied `Stream-Name` (any
		// casing) is REPLACED, never merged, by the world-actor stream —
		// ADR-0074's rule that these events never route to ADR-0030 streams.
		const headers = new Headers(options.headers);
		headers.set("content-type", "application/json");
		headers.set("stream-name", OTEL_STREAM_NAME);
		// `doFetch` may throw synchronously (not just return a rejected
		// promise) — a broken shim or a malformed URL, for example. Route
		// both failure shapes through the same `onError` path so `write`
		// itself never throws, matching the `AgentRunSink` contract without
		// relying on the emitter's own try/catch as the only backstop.
		let request: Promise<Response>;
		const controller = new AbortController();
		const timer = setTimeout(() => {
			timedOut++;
			controller.abort();
		}, timeoutMs);
		try {
			request = doFetch(options.endpoint, {
				method: "POST",
				headers,
				body: JSON.stringify(payload),
				signal: controller.signal,
			});
		} catch (error) {
			clearTimeout(timer);
			failed++;
			reportError(error);
			return;
		}
		const post: Promise<void> = request
			.then(async (response) => {
				// The projection does not consume collector response content. Release
				// the body on both success and HTTP failure before freeing admission.
				await response.body?.cancel();
				// fetch only rejects on network/transport failure — a 4xx/5xx
				// resolves normally, so an unchecked `.catch` alone would silently
				// drop delivery failures. Treat non-2xx as a delivery error too.
				if (!response.ok) {
					throw new Error(`OTLP export failed: ${response.status} ${response.statusText}`);
				}
			})
			.catch((error) => {
				failed++;
				// Sinks must never throw into the emitting run (see emit.ts) —
				// the only surfacing path is the caller-supplied onError hook.
				reportError(error);
			})
			.finally(() => {
				clearTimeout(timer);
				pending.delete(post);
				if (pending.size < maxPending) saturated = false;
			});
		pending.add(post);
	}
}
