// Lightweight, dependency-free OTLP/HTTP trace projection for world-actor work.
// Hosts configure transport; instrumented libraries depend only on the small
// structural WorldActorTracer interface, not on an OpenTelemetry SDK.

export const OTEL_TRACE_SERVICE_NAME = "spellkave-world-actors";
export const OTEL_TRACE_STREAM_NAME = "world_actor_traces";

export type WorldActorSpanStatus = "unset" | "ok" | "error";

export interface WorldActorSpan {
	addEvent(name: string, attributes?: Record<string, unknown>): void;
	end(status?: WorldActorSpanStatus): void;
}

export interface WorldActorTracer {
	startSpan(name: string, attributes?: Record<string, unknown>): WorldActorSpan;
	flush(): Promise<void>;
}

interface OtlpAttribute {
	key: string;
	value:
		| { stringValue: string }
		| { intValue: string }
		| { doubleValue: number }
		| { boolValue: boolean };
}

interface OtlpSpan {
	traceId: string;
	spanId: string;
	name: string;
	kind: number;
	startTimeUnixNano: string;
	endTimeUnixNano: string;
	attributes: OtlpAttribute[];
	events: Array<{ timeUnixNano: string; name: string; attributes: OtlpAttribute[] }>;
	status: { code: number };
}

/** Correlation keys a reducer-attempt host may attach. The SDK keeps a
 * matching runtime copy (`REDUCER_ATTEMPT_SAFE_TELEMETRY_ATTRIBUTES`) because
 * it stays free of a runtime dependency on this package; the exporter list
 * below is derived from this one so a new correlation key cannot be forgotten
 * at export. Equality is asserted by
 * `packages/spellkave-sdk/src/__tests__/reducer-attempt-telemetry-allowlist.test.ts`. */
export const WORLD_ACTOR_CORRELATION_ATTRIBUTE_KEYS = [
	"spellkave.reducer",
	"spellkave.actor_id",
	"spellkave.action_id",
	"spellkave.target_ref",
	"spellkave.correlation_id",
	"spellkave.world_slug",
	"spellkave.cause_kind",
	"spellkave.cause_id",
] as const;

const SAFE_TRACE_ATTRIBUTE_EXTRAS = [
	"spellkave.subject_id",
	"spellkave.timeout_ms",
	"spellkave.poll_ms",
	"spellkave.success_on_provenance",
	"spellkave.baseline_count",
	"spellkave.provenance_id",
	"spellkave.provenance_status",
	"spellkave.provenance_kind",
	"spellkave.failure_class",
	"spellkave.result_status",
	"spellkave.poll_count",
	"spellkave.invoke_settled",
	"spellkave.invoke_failed",
	"spellkave.lag_warning",
	"spellkave.step",
	"spellkave.error_code",
	"spellkave.retry_count",
] as const;

export const SAFE_TRACE_ATTRIBUTE_KEYS = new Set<string>([
	...WORLD_ACTOR_CORRELATION_ATTRIBUTE_KEYS,
	...SAFE_TRACE_ATTRIBUTE_EXTRAS,
]);

const SAFE_RESOURCE_ATTRIBUTE_KEYS = new Set([
	"service.name",
	"service.namespace",
	// Deployed revision (`SPELLKAVE_IMAGE_TAG`, sk-0m4.120.13) — a tag, never a path.
	"service.version",
	"service.instance.id",
	// sk-jay0.6.38.13: old semconv key — the collector hygiene key AND the live
	// column (`service_deployment_environment` on `world_actor_traces`).
	"deployment.environment",
	"deployment.environment.name",
	"openobserve.stream",
	"spellkave.world_slug",
]);

export interface OtlpHttpTracerOptions {
	endpoint: string;
	serviceName?: string;
	headers?: Record<string, string>;
	resourceAttributes?: Record<string, unknown>;
	fetchFn?: typeof fetch;
	now?: () => number;
	batchSize?: number;
	onError?: (error: unknown) => void;
	/** Abort each export request after this deadline; default 10 seconds, as
	 * for the log and metrics exporters. A request that never settles would
	 * otherwise stay pending for the life of the process and hold `flush`
	 * open (sk-jay0.6.15.56.21). */
	requestTimeoutMs?: number;
}

const STATUS_CODE: Record<WorldActorSpanStatus, number> = { unset: 0, ok: 1, error: 2 };

function attributes(
	values: Record<string, unknown>,
	allowed: ReadonlySet<string>,
): OtlpAttribute[] {
	const out: OtlpAttribute[] = [];
	for (const [key, value] of Object.entries(values)) {
		if (!allowed.has(key)) continue;
		if (value === undefined || value === null) continue;
		if (typeof value === "boolean") out.push({ key, value: { boolValue: value } });
		else if (typeof value === "number" && Number.isFinite(value)) {
			out.push({
				key,
				value: Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value },
			});
		} else if (typeof value === "bigint") out.push({ key, value: { intValue: value.toString() } });
		else out.push({ key, value: { stringValue: String(value).slice(0, 8_000) } });
	}
	return out;
}

function hexId(bytes: number): string {
	const value = new Uint8Array(bytes);
	globalThis.crypto.getRandomValues(value);
	return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function unixNano(now: () => number): string {
	return String(Math.round(now() * 1_000_000));
}

function tracesUrl(endpoint: string): string {
	const base = endpoint.trim().replace(/\/+$/, "");
	return base.endsWith("/v1/traces") ? base : `${base}/v1/traces`;
}

export function createOtlpHttpTracer(options: OtlpHttpTracerOptions): WorldActorTracer {
	const now = options.now ?? Date.now;
	const doFetch = options.fetchFn ?? globalThis.fetch.bind(globalThis);
	const serviceName = options.serviceName ?? OTEL_TRACE_SERVICE_NAME;
	const batchSize = options.batchSize ?? 32;
	const queue: OtlpSpan[] = [];
	const pending = new Set<Promise<void>>();
	const configuredTimeout = options.requestTimeoutMs ?? 10_000;
	const requestTimeoutMs = Number.isFinite(configuredTimeout)
		? Math.max(1, Math.trunc(configuredTimeout))
		: 10_000;

	function payload(spans: OtlpSpan[]): unknown {
		return {
			resourceSpans: [
				{
					resource: {
						attributes: attributes(
							{
								"service.name": serviceName,
								"service.namespace": "spellkave",
								"openobserve.stream": OTEL_TRACE_STREAM_NAME,
								...options.resourceAttributes,
							},
							SAFE_RESOURCE_ATTRIBUTE_KEYS,
						),
					},
					scopeSpans: [{ scope: { name: "@spellkave/agent-observability" }, spans }],
				},
			],
		};
	}

	function ship(spans: OtlpSpan[]): Promise<void> {
		if (spans.length === 0) return Promise.resolve();
		const headers = new Headers(options.headers);
		headers.set("content-type", "application/json");
		headers.set("stream-name", OTEL_TRACE_STREAM_NAME);
		let request: Promise<Response>;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
		timer.unref?.();
		try {
			request = doFetch(tracesUrl(options.endpoint), {
				method: "POST",
				headers,
				body: JSON.stringify(payload(spans)),
				signal: controller.signal,
			});
		} catch (error) {
			clearTimeout(timer);
			options.onError?.(error);
			return Promise.resolve();
		}
		let tracked: Promise<void>;
		tracked = request
			.then((response) => {
				if (!response.ok)
					throw new Error(`OTLP trace export failed: ${response.status} ${response.statusText}`);
			})
			.catch((error) => options.onError?.(error))
			.finally(() => {
				clearTimeout(timer);
				pending.delete(tracked);
			});
		pending.add(tracked);
		return tracked;
	}

	function flushQueue(): Promise<void> {
		return ship(queue.splice(0, queue.length));
	}

	return {
		startSpan(name, spanAttributes = {}) {
			const span: OtlpSpan = {
				traceId: hexId(16),
				spanId: hexId(8),
				name,
				kind: 1,
				startTimeUnixNano: unixNano(now),
				endTimeUnixNano: unixNano(now),
				attributes: attributes(spanAttributes, SAFE_TRACE_ATTRIBUTE_KEYS),
				events: [],
				status: { code: STATUS_CODE.unset },
			};
			let ended = false;
			return {
				addEvent(eventName, eventAttributes = {}) {
					if (ended) return;
					span.events.push({
						timeUnixNano: unixNano(now),
						name: eventName,
						attributes: attributes(eventAttributes, SAFE_TRACE_ATTRIBUTE_KEYS),
					});
				},
				end(status = "ok") {
					if (ended) return;
					ended = true;
					span.endTimeUnixNano = unixNano(now);
					span.status = { code: STATUS_CODE[status] };
					queue.push(span);
					if (queue.length >= batchSize) void flushQueue();
				},
			};
		},
		async flush() {
			await flushQueue();
			await Promise.allSettled([...pending]);
		},
	};
}
