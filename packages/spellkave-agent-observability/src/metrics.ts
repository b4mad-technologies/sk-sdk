// Dependency-free OTLP/HTTP metrics for WORLD ACTORS. Hosts own this exporter;
// browser-safe gameplay libraries receive only the structural port below.
import { CYCLE_WAKE_OUTCOMES, type CycleWakeOutcome } from "./events.ts";
import type { OtlpTransportSnapshot } from "./otel.ts";

export const OTEL_METRICS_SERVICE_NAME = "spellkave-world-actors";

export type WorldActorRequestStatus = "ok" | "error";

export interface HostMemorySample {
	processRssBytes: number;
	heapUsedBytes: number;
	heapTotalBytes: number;
	externalBytes: number;
	arrayBuffersBytes: number;
	cgroupCurrentBytes?: number;
	cgroupPeakBytes?: number;
	cgroupLimitBytes?: number;
}

export interface WorkerMemorySample {
	actorEntityKey: string;
	heapUsedBytes: number;
	heapTotalBytes?: number;
	externalBytes?: number;
	arrayBuffersBytes?: number;
}

const HOST_MEMORY_METRICS = {
	processRssBytes: "process_rss_bytes",
	heapUsedBytes: "main_heap_used_bytes",
	heapTotalBytes: "main_heap_total_bytes",
	externalBytes: "main_external_bytes",
	arrayBuffersBytes: "main_array_buffers_bytes",
	cgroupCurrentBytes: "cgroup_current_bytes",
	cgroupPeakBytes: "cgroup_peak_bytes",
	cgroupLimitBytes: "cgroup_limit_bytes",
} as const;

export interface WorldActorMetrics {
	recordRequest(input: {
		toolName: string;
		durationMs: number;
		status: WorldActorRequestStatus;
	}): void;
	recordCycleFailure(input: {
		step: string;
		failureClass: string;
		errorCode?: string;
		retryCount: number;
		/** Seat that failed. Admitted via SAFE_METRIC_ATTRIBUTE_KEYS. */
		actorEntityKey?: string;
	}): void;
	/** One scheduled self-driven seat run and its fate (the `cycle_wake`
	 * event's bounded `outcome`). Counts, no actor attribute: the question it
	 * answers is host-wide ("how many wakes per tick ran vs. skipped"). */
	recordCycleWake?(input: { outcome: CycleWakeOutcome }): void;
	/** Aggregate cycle-duration sample (work-only; excludes concurrency-slot
	 * wait). Implementations MUST NOT export a per-cycle series — accumulate
	 * and ship on {@link flush}. */
	recordCycleDuration?(input: { actorEntityKey: string; durationMs: number }): void;
	/** Time spent waiting for `acquireCycleSlot`. Same actor-attribute
	 * discipline as {@link recordCycleDuration}. */
	recordCycleQueueWait?(input: { actorEntityKey: string; durationMs: number }): void;
	/** Host-wide in-flight cycle count. Accumulates max-in-window (not last
	 * sample) and ships as a gauge on flush. Optional queueDepth is the limiter
	 * waiter count — also max-in-window, host-wide, no actor attribute. */
	recordOpenCycles?(input: { openCycles: number; queueDepth?: number }): void;
	/** Unconditional metrics-exporter liveness. Call on a host heartbeat (npc-host
	 * sweep or session-daemon interval); shipped as a delta counter on flush even
	 * when nothing else happened. */
	recordExporterHeartbeat?(): void;
	/** Latest V8 isolate heap per seat worker. Shipped as a gauge on flush. */
	recordWorkerHeap?(input: WorkerMemorySample): void;
	/** Host-wide snapshot, without actor labels. Missing fields stay absent. */
	recordHostMemory?(input: HostMemorySample): void;
	/** A seat worker was respawned: a fresh V8 isolate and a full seat-graph
	 * compile. THE signal for the CPU-throttle storm of sk-jay0.6.15.12 —
	 * before this counter existed the only trace was a `console.error` line,
	 * which is why that bug sat open for two weeks and had to be measured by
	 * grepping pod logs. Watch the TREND: a rate that does not decay after
	 * boot is the storm. */
	recordSeatRespawn?(input: { reason: SeatRecoveryReason }): void;
	/** A seat reopened its own session instead of being respawned
	 * (sk-jay0.6.15.56.10). `success` rising while `seat_respawns_total` stays
	 * flat is the fix working. */
	recordSeatReconnect?(input: { outcome: "success" | "failure" }): void;
	/** A seat's cycle-slot request waited longer than the warning threshold
	 * without a grant (sk-jay0.6.15.56.16.12.4). Watch the TREND: a counter
	 * that keeps rising after boot means the host cycle gate is starved. */
	recordCycleSlotWaitExceeded?(input: { actorEntityKey: string }): void;
	flush(): Promise<void>;
}

export interface OtlpHttpMetricsOptions {
	/** Pull the local log transport state on flush, without logging recursively. */
	logTransportSnapshot?: () => OtlpTransportSnapshot;
	endpoint: string;
	serviceName?: string;
	headers?: Record<string, string>;
	resourceAttributes?: Record<string, unknown>;
	fetchFn?: typeof fetch;
	now?: () => number;
	onError?: (error: unknown) => void;
	maxPendingExports?: number;
	/** Abort each export request after this deadline; default 10 seconds, the
	 * same bound the OTLP log sink uses. Without it a request that never
	 * settles holds its admission slot for the life of the process, and once
	 * `maxPendingExports` of them hang every later export is dropped as
	 * "queue is saturated" (sk-jay0.6.15.56.21). */
	requestTimeoutMs?: number;
	/** Exact registry-owned values permitted to create metric series. */
	allowedToolNames?: readonly string[];
	allowedCycleSteps?: readonly string[];
	allowedErrorCodes?: readonly string[];
}

type Scalar = string | number | boolean;

const SAFE_RESOURCE_ATTRIBUTE_KEYS = new Set([
	"service.name",
	"service.namespace",
	// Deployed revision (`SPELLKAVE_IMAGE_TAG`, sk-0m4.120.13) — a tag, never a path.
	"service.version",
	"service.instance.id",
	// sk-jay0.6.38.13: old semconv key — the collector hygiene key AND the live
	// column (see `world_actor_traces`/`world_actor_run_events` for the
	// per-signal column names this maps to).
	"deployment.environment",
	"deployment.environment.name",
	"spellkave.world_slug",
]);

const SAFE_METRIC_ATTRIBUTE_KEYS = new Set([
	"spellkave.world_slug",
	"spellkave.tool_name",
	"spellkave.status",
	"spellkave.step",
	"spellkave.failure_class",
	"spellkave.error_code",
	"spellkave.actor_entity_key",
	"spellkave.recovery_reason",
]);

const DURATION_BUCKETS_MS = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000];
const FAILURE_CLASSES = new Set([
	"authoring_rejected",
	"apply_rejected",
	"SeatContractError",
	"Error",
	"TypeError",
	"unknown",
]);

function failureClassDimension(value: string): string {
	return FAILURE_CLASSES.has(value) ? value : "other";
}

/** Why a seat worker was respawned. CLOSED SET — the raw reason strings carry
 * durations ("no update for 12345ms exceeds 5000"), so shipping them as an
 * attribute would be unbounded cardinality. */
const SEAT_RECOVERY_REASONS = new Set(["transport_down", "open_cycle", "stale", "other"]);

export type SeatRecoveryReason = "transport_down" | "open_cycle" | "stale" | "other";

function seatRecoveryReasonDimension(value: string): string {
	return SEAT_RECOVERY_REASONS.has(value) ? value : "other";
}

function scalar(value: unknown): Scalar | undefined {
	if (typeof value === "string") return value.slice(0, 128);
	if (typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	return undefined;
}

function otlpAttributes(
	values: Readonly<Record<string, unknown>>,
	allowed: ReadonlySet<string>,
): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = [];
	for (const [key, raw] of Object.entries(values)) {
		if (!allowed.has(key)) continue;
		const value = scalar(raw);
		if (value === undefined) continue;
		if (typeof value === "boolean") out.push({ key, value: { boolValue: value } });
		else if (typeof value === "number") {
			out.push({
				key,
				value: Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value },
			});
		} else out.push({ key, value: { stringValue: value } });
	}
	return out;
}

function unixNano(now: () => number): string {
	return String(Math.round(now() * 1_000_000));
}

function metricsUrl(endpoint: string): string {
	const base = endpoint.trim().replace(/\/+$/, "");
	return base.endsWith("/v1/metrics") ? base : `${base}/v1/metrics`;
}

function countBuckets(value: number): string[] {
	const counts = DURATION_BUCKETS_MS.map(() => 0);
	let placed = false;
	for (let index = 0; index < DURATION_BUCKETS_MS.length; index += 1) {
		if (!placed && value <= (DURATION_BUCKETS_MS[index] ?? Number.POSITIVE_INFINITY)) {
			counts[index] = 1;
			placed = true;
		}
	}
	return [...counts, placed ? 0 : 1].map(String);
}

interface HistogramAcc {
	count: number;
	sum: number;
	min: number;
	max: number;
	buckets: number[];
}

function addHistogramSample(
	map: Map<string, HistogramAcc>,
	actorEntityKey: string,
	durationMs: number,
): void {
	const key = actorEntityKey.slice(0, 128);
	const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
	const existing = map.get(key);
	if (existing === undefined) {
		const buckets = DURATION_BUCKETS_MS.map(() => 0);
		let placed = false;
		for (let index = 0; index < DURATION_BUCKETS_MS.length; index += 1) {
			if (!placed && safeDuration <= (DURATION_BUCKETS_MS[index] ?? Number.POSITIVE_INFINITY)) {
				buckets[index] = 1;
				placed = true;
			}
		}
		map.set(key, {
			count: 1,
			sum: safeDuration,
			min: safeDuration,
			max: safeDuration,
			buckets: [...buckets, placed ? 0 : 1],
		});
		return;
	}
	existing.count += 1;
	existing.sum += safeDuration;
	existing.min = Math.min(existing.min, safeDuration);
	existing.max = Math.max(existing.max, safeDuration);
	let placed = false;
	for (let index = 0; index < DURATION_BUCKETS_MS.length; index += 1) {
		if (!placed && safeDuration <= (DURATION_BUCKETS_MS[index] ?? Number.POSITIVE_INFINITY)) {
			existing.buckets[index] = (existing.buckets[index] ?? 0) + 1;
			placed = true;
		}
	}
	if (!placed) {
		const overflow = existing.buckets.length - 1;
		existing.buckets[overflow] = (existing.buckets[overflow] ?? 0) + 1;
	}
}

export function createOtlpHttpMetrics(options: OtlpHttpMetricsOptions): WorldActorMetrics {
	const now = options.now ?? Date.now;
	const doFetch = options.fetchFn ?? globalThis.fetch.bind(globalThis);
	const pending = new Set<Promise<void>>();
	const configuredMaxPending = options.maxPendingExports ?? 64;
	const maxPendingExports = Number.isFinite(configuredMaxPending)
		? Math.max(1, Math.trunc(configuredMaxPending))
		: 64;
	let saturationReported = false;
	const configuredTimeout = options.requestTimeoutMs ?? 10_000;
	const requestTimeoutMs = Number.isFinite(configuredTimeout)
		? Math.max(1, Math.trunc(configuredTimeout))
		: 10_000;
	const resourceAttributes = otlpAttributes(
		{
			"service.name": options.serviceName ?? OTEL_METRICS_SERVICE_NAME,
			"service.namespace": "spellkave",
			...options.resourceAttributes,
		},
		SAFE_RESOURCE_ATTRIBUTE_KEYS,
	);
	const stableMetricAttributes = {
		"spellkave.world_slug": options.resourceAttributes?.["spellkave.world_slug"],
	};
	const allowedToolNames = new Set(options.allowedToolNames ?? []);
	const allowedCycleSteps = new Set(options.allowedCycleSteps ?? []);
	const allowedErrorCodes = new Set(options.allowedErrorCodes ?? []);
	const cycleDurationBySeat = new Map<string, HistogramAcc>();
	const cycleQueueWaitBySeat = new Map<string, HistogramAcc>();
	const workerHeapBySeat = new Map<string, { sample: WorkerMemorySample; atMs: number }>();
	let hostMemory: HostMemorySample | undefined;
	let openCycles = 0;
	let openCyclesMax = 0;
	let openCyclesRecorded = false;
	let queueDepth = 0;
	let queueDepthMax = 0;
	let queueDepthRecorded = false;
	let exporterHeartbeats = 0;
	const reportError = (error: unknown): void => {
		try {
			options.onError?.(error);
		} catch {
			// An observability callback is observability too; keep it non-fatal.
		}
	};

	function ship(metrics: ReadonlyArray<Record<string, unknown>>): void {
		if (pending.size >= maxPendingExports) {
			if (!saturationReported) {
				saturationReported = true;
				reportError(new Error("OTLP metrics export queue is saturated"));
			}
			return;
		}
		let request: Promise<Response>;
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
		timer.unref?.();
		try {
			const headers = new Headers(options.headers);
			headers.set("content-type", "application/json");
			request = doFetch(metricsUrl(options.endpoint), {
				method: "POST",
				headers,
				signal: controller.signal,
				body: JSON.stringify({
					resourceMetrics: [
						{
							resource: { attributes: resourceAttributes },
							scopeMetrics: [
								{
									scope: { name: "@spellkave/agent-observability" },
									metrics,
								},
							],
						},
					],
				}),
			});
		} catch (error) {
			clearTimeout(timer);
			reportError(error);
			return;
		}
		let tracked: Promise<void>;
		tracked = request
			.then((response) => {
				if (!response.ok) {
					throw new Error(`OTLP metrics export failed: ${response.status} ${response.statusText}`);
				}
			})
			.catch((error) => reportError(error))
			.finally(() => {
				clearTimeout(timer);
				pending.delete(tracked);
				if (pending.size < maxPendingExports) saturationReported = false;
			});
		pending.add(tracked);
	}

	function sumMetric(
		name: string,
		attributes: Readonly<Record<string, unknown>>,
		value = 1,
	): Record<string, unknown> {
		return {
			name,
			unit: "{event}",
			sum: {
				aggregationTemporality: 1,
				isMonotonic: true,
				dataPoints: [
					{
						attributes: otlpAttributes(attributes, SAFE_METRIC_ATTRIBUTE_KEYS),
						timeUnixNano: unixNano(now),
						asInt: String(Math.max(0, Math.trunc(value))),
					},
				],
			},
		};
	}

	return {
		recordRequest({ toolName, durationMs, status }) {
			const safeDuration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
			const attributes = {
				...stableMetricAttributes,
				"spellkave.tool_name": allowedToolNames.has(toolName) ? toolName : "other",
				"spellkave.status": status === "ok" ? "ok" : "error",
			};
			ship([
				sumMetric("spellkave.world_actor.requests_total", attributes),
				{
					name: "spellkave.world_actor.request_duration",
					unit: "ms",
					histogram: {
						aggregationTemporality: 1,
						dataPoints: [
							{
								attributes: otlpAttributes(attributes, SAFE_METRIC_ATTRIBUTE_KEYS),
								timeUnixNano: unixNano(now),
								count: "1",
								sum: safeDuration,
								explicitBounds: DURATION_BUCKETS_MS,
								bucketCounts: countBuckets(safeDuration),
								min: safeDuration,
								max: safeDuration,
							},
						],
					},
				},
			]);
		},
		recordSeatRespawn({ reason }) {
			ship([
				sumMetric("spellkave.world_actor.seat_respawns_total", {
					...stableMetricAttributes,
					"spellkave.recovery_reason": seatRecoveryReasonDimension(reason),
				}),
			]);
		},
		recordSeatReconnect({ outcome }) {
			ship([
				sumMetric("spellkave.world_actor.seat_reconnects_total", {
					...stableMetricAttributes,
					"spellkave.status": outcome === "success" ? "success" : "failure",
				}),
			]);
		},
		recordCycleSlotWaitExceeded(_input: { actorEntityKey: string }) {
			ship([
				sumMetric("spellkave.world_actor.cycle_slot_wait_exceeded_total", stableMetricAttributes),
			]);
		},
		recordCycleFailure({ step, failureClass, errorCode, retryCount, actorEntityKey }) {
			const safeErrorCode =
				errorCode !== undefined && allowedErrorCodes.has(errorCode) ? errorCode : undefined;
			const attributes = {
				...stableMetricAttributes,
				"spellkave.step": allowedCycleSteps.has(step) ? step : "other",
				"spellkave.failure_class": failureClassDimension(failureClass),
				...(safeErrorCode === undefined ? {} : { "spellkave.error_code": safeErrorCode }),
				...(actorEntityKey === undefined || actorEntityKey === ""
					? {}
					: { "spellkave.actor_entity_key": actorEntityKey.slice(0, 128) }),
			};
			ship([
				sumMetric("spellkave.world_actor.cycle_failures_total", attributes),
				...(retryCount > 0
					? [sumMetric("spellkave.world_actor.cycle_retries_total", attributes)]
					: []),
			]);
		},
		recordCycleWake({ outcome }) {
			ship([
				sumMetric("spellkave.world_actor.cycle_wakes_total", {
					...stableMetricAttributes,
					"spellkave.wake_outcome": CYCLE_WAKE_OUTCOMES.includes(outcome) ? outcome : "other",
				}),
			]);
		},
		recordCycleDuration({ actorEntityKey, durationMs }) {
			addHistogramSample(cycleDurationBySeat, actorEntityKey, durationMs);
		},
		recordCycleQueueWait({ actorEntityKey, durationMs }) {
			addHistogramSample(cycleQueueWaitBySeat, actorEntityKey, durationMs);
		},
		recordOpenCycles({ openCycles: next, queueDepth: nextQueue }) {
			openCycles = Number.isFinite(next) ? Math.max(0, Math.trunc(next)) : 0;
			openCyclesMax = Math.max(openCyclesMax, openCycles);
			openCyclesRecorded = true;
			if (nextQueue === undefined) return;
			queueDepth = Number.isFinite(nextQueue) ? Math.max(0, Math.trunc(nextQueue)) : 0;
			queueDepthMax = Math.max(queueDepthMax, queueDepth);
			queueDepthRecorded = true;
		},
		recordExporterHeartbeat() {
			exporterHeartbeats += 1;
		},
		recordWorkerHeap(sample) {
			workerHeapBySeat.set(sample.actorEntityKey.slice(0, 128), {
				sample: { ...sample },
				atMs: now(),
			});
		},
		recordHostMemory(sample) {
			hostMemory = { ...sample };
		},
		async flush() {
			const cycleMetrics: Record<string, unknown>[] = [];
			try {
				const snapshot = options.logTransportSnapshot?.();
				if (snapshot !== undefined) {
					for (const key of ["pending", "dropped", "timedOut", "failed"] as const) {
						const value = snapshot[key];
						if (!Number.isSafeInteger(value) || value < 0) continue;
						const suffix = key === "timedOut" ? "timed_out" : key;
						cycleMetrics.push({
							name: `spellkave.world_actor.log_export_${suffix}`,
							unit: "{request}",
							gauge: {
								dataPoints: [
									{
										attributes: otlpAttributes(stableMetricAttributes, SAFE_METRIC_ATTRIBUTE_KEYS),
										timeUnixNano: unixNano(now),
										asInt: String(value),
									},
								],
							},
						});
					}
				}
			} catch (error) {
				reportError(error);
			}
			if (hostMemory !== undefined) {
				for (const [key, name] of Object.entries(HOST_MEMORY_METRICS)) {
					const value = hostMemory[key as keyof HostMemorySample];
					if (value === undefined || !Number.isSafeInteger(value) || value < 0) continue;
					cycleMetrics.push({
						name: `spellkave.world_actor.${name}`,
						unit: "By",
						gauge: {
							dataPoints: [
								{
									attributes: otlpAttributes(stableMetricAttributes, SAFE_METRIC_ATTRIBUTE_KEYS),
									timeUnixNano: unixNano(now),
									asInt: String(value),
								},
							],
						},
					});
				}
				hostMemory = undefined;
			}
			if (exporterHeartbeats > 0) {
				cycleMetrics.push(
					sumMetric(
						"spellkave.world_actor.exporter_heartbeats_total",
						stableMetricAttributes,
						exporterHeartbeats,
					),
				);
				exporterHeartbeats = 0;
			}
			for (const [actorEntityKey, acc] of cycleDurationBySeat) {
				cycleMetrics.push({
					name: "spellkave.world_actor.cycle_duration",
					unit: "ms",
					histogram: {
						aggregationTemporality: 1,
						dataPoints: [
							{
								attributes: otlpAttributes(
									{
										...stableMetricAttributes,
										"spellkave.actor_entity_key": actorEntityKey,
									},
									SAFE_METRIC_ATTRIBUTE_KEYS,
								),
								timeUnixNano: unixNano(now),
								count: String(acc.count),
								sum: acc.sum,
								explicitBounds: DURATION_BUCKETS_MS,
								bucketCounts: acc.buckets.map(String),
								min: acc.min,
								max: acc.max,
							},
						],
					},
				});
			}
			cycleDurationBySeat.clear();
			for (const [actorEntityKey, acc] of cycleQueueWaitBySeat) {
				cycleMetrics.push({
					name: "spellkave.world_actor.cycle_queue_wait",
					unit: "ms",
					histogram: {
						aggregationTemporality: 1,
						dataPoints: [
							{
								attributes: otlpAttributes(
									{
										...stableMetricAttributes,
										"spellkave.actor_entity_key": actorEntityKey,
									},
									SAFE_METRIC_ATTRIBUTE_KEYS,
								),
								timeUnixNano: unixNano(now),
								count: String(acc.count),
								sum: acc.sum,
								explicitBounds: DURATION_BUCKETS_MS,
								bucketCounts: acc.buckets.map(String),
								min: acc.min,
								max: acc.max,
							},
						],
					},
				});
			}
			cycleQueueWaitBySeat.clear();
			if (openCyclesRecorded) {
				cycleMetrics.push({
					name: "spellkave.world_actor.open_cycles",
					unit: "{cycle}",
					gauge: {
						dataPoints: [
							{
								attributes: otlpAttributes(stableMetricAttributes, SAFE_METRIC_ATTRIBUTE_KEYS),
								timeUnixNano: unixNano(now),
								asInt: String(openCyclesMax),
							},
						],
					},
				});
				openCyclesMax = openCycles;
			}
			if (queueDepthRecorded) {
				cycleMetrics.push({
					name: "spellkave.world_actor.cycle_queue_depth",
					unit: "{waiter}",
					gauge: {
						dataPoints: [
							{
								attributes: otlpAttributes(stableMetricAttributes, SAFE_METRIC_ATTRIBUTE_KEYS),
								timeUnixNano: unixNano(now),
								asInt: String(queueDepthMax),
							},
						],
					},
				});
				queueDepthMax = queueDepth;
			}
			for (const [actorEntityKey, { sample, atMs }] of workerHeapBySeat) {
				const fields = [
					["worker_heap_bytes", sample.heapUsedBytes, "By"],
					["worker_heap_total_bytes", sample.heapTotalBytes, "By"],
					["worker_external_bytes", sample.externalBytes, "By"],
					["worker_array_buffers_bytes", sample.arrayBuffersBytes, "By"],
					["worker_memory_sample_age_ms", Math.max(0, now() - atMs), "ms"],
				] as const;
				for (const [name, value, unit] of fields) {
					if (value === undefined || !Number.isSafeInteger(value) || value < 0) continue;
					cycleMetrics.push({
						name: `spellkave.world_actor.${name}`,
						unit,
						gauge: {
							dataPoints: [
								{
									attributes: otlpAttributes(
										{
											...stableMetricAttributes,
											"spellkave.actor_entity_key": actorEntityKey,
										},
										SAFE_METRIC_ATTRIBUTE_KEYS,
									),
									timeUnixNano: unixNano(now),
									asInt: String(value),
								},
							],
						},
					});
				}
			}
			if (cycleMetrics.length > 0) ship(cycleMetrics);
			await Promise.allSettled([...pending]);
		},
	};
}
