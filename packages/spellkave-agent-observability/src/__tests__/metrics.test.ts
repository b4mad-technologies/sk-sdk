import { describe, expect, it, vi } from "vitest";

import { createOtlpHttpMetrics } from "../metrics.ts";

describe("createOtlpHttpMetrics", () => {
	it("exports bounded request and duration metrics to the standard OTLP route", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local:4318",
			allowedToolNames: ["spellkave_act_affordance"],
			now: () => 1_700_000_000_000,
			resourceAttributes: {
				"deployment.environment.name": "production",
				"spellkave.world_slug": "elven-mini-1",
				"oauth.subject": "SECRET-SUBJECT",
			},
			fetchFn: (async (url: string, init: RequestInit) => {
				calls.push({ url, init });
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordRequest({ toolName: "spellkave_act_affordance", durationMs: 73, status: "ok" });
		await metrics.flush();

		expect(calls).toHaveLength(1);
		expect(calls[0]?.url).toBe("http://collector.local:4318/v1/metrics");
		const serialized = calls[0]?.init.body as string;
		expect(serialized).toContain("spellkave.world_actor.requests_total");
		expect(serialized).toContain("spellkave.world_actor.request_duration");
		expect(serialized).toContain("spellkave_act_affordance");
		expect(serialized).not.toContain("SECRET-SUBJECT");
		const payload = JSON.parse(serialized);
		const exportedMetrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
		for (const metric of exportedMetrics) {
			const dataPoint = metric.sum?.dataPoints[0] ?? metric.histogram?.dataPoints[0];
			expect(dataPoint.attributes).toContainEqual({
				key: "spellkave.world_slug",
				value: { stringValue: "elven-mini-1" },
			});
		}
	});

	it("counts failures and only counts retry attempts after the first failure", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local/v1/metrics",
			allowedCycleSteps: ["equip-creation-longsword"],
			allowedErrorCodes: ["MF-VAL-319"],
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordCycleFailure({
			step: "equip-creation-longsword",
			failureClass: "authoring_rejected",
			errorCode: "MF-VAL-319",
			retryCount: 0,
		});
		metrics.recordCycleFailure({
			step: "equip-creation-longsword",
			failureClass: "authoring_rejected",
			errorCode: "MF-VAL-319",
			retryCount: 1,
		});
		await metrics.flush();

		expect(payloads).toHaveLength(2);
		expect(payloads[0]).toContain("spellkave.world_actor.cycle_failures_total");
		expect(payloads[0]).not.toContain("spellkave.world_actor.cycle_retries_total");
		expect(payloads[1]).toContain("spellkave.world_actor.cycle_retries_total");
		expect(payloads.join("\n")).toContain("MF-VAL-319");
	});

	it("collapses unregistered dimensions instead of creating attacker-controlled series", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			allowedToolNames: ["spellkave_scene"],
			allowedCycleSteps: ["npc-cycle"],
			allowedErrorCodes: ["MF-VAL-319"],
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordRequest({ toolName: "SECRET-TOOL-CANARY", durationMs: 1, status: "ok" });
		metrics.recordCycleFailure({
			step: "SECRET-STEP-CANARY",
			failureClass: "SECRET-CLASS-CANARY",
			errorCode: "SECRET-CODE-CANARY",
			retryCount: 0,
		});
		await metrics.flush();

		const serialized = payloads.join("\n");
		expect(serialized).not.toMatch(/SECRET-(?:TOOL|STEP|CLASS|CODE)-CANARY/u);
		expect(serialized).toContain("other");
	});

	it("keeps collector failures outside gameplay and drains them on flush", async () => {
		const onError = vi.fn();
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			fetchFn: (async () => new Response(null, { status: 503 })) as typeof fetch,
			onError,
		});

		expect(() =>
			metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 1, status: "error" }),
		).not.toThrow();
		await metrics.flush();
		expect(onError).toHaveBeenCalledOnce();
	});

	it("bounds pending exports while a collector is stalled", async () => {
		const onError = vi.fn();
		let release: (() => void) | undefined;
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			maxPendingExports: 1,
			fetchFn: (async () => {
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return new Response(null, { status: 200 });
			}) as typeof fetch,
			onError,
		});

		metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 1, status: "ok" });
		metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 2, status: "ok" });
		metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 3, status: "ok" });
		expect(onError).toHaveBeenCalledOnce();

		release?.();
		await metrics.flush();
	});

	// sk-jay0.6.15.56.21: a request that never settles must not hold its slot
	// forever, or the queue stays saturated and every later export is dropped.
	it("aborts a hung export after requestTimeoutMs and frees the slot", async () => {
		vi.useFakeTimers();
		try {
			const onError = vi.fn();
			let calls = 0;
			const metrics = createOtlpHttpMetrics({
				endpoint: "http://collector.local",
				maxPendingExports: 1,
				requestTimeoutMs: 50,
				fetchFn: ((_url: string, init: RequestInit) => {
					calls += 1;
					return new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener("abort", () =>
							reject(new DOMException("This operation was aborted", "AbortError")),
						);
					});
				}) as typeof fetch,
				onError,
			});

			metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 1, status: "ok" });
			expect(calls).toBe(1);
			await vi.advanceTimersByTimeAsync(60);
			expect(onError).toHaveBeenCalledOnce();
			expect(String(onError.mock.calls[0]?.[0])).toContain("AbortError");

			// The slot is free again: the next export is sent, not dropped.
			metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 2, status: "ok" });
			expect(calls).toBe(2);
			await vi.advanceTimersByTimeAsync(60);
		} finally {
			vi.useRealTimers();
		}
	});

	it("accumulates cycle durations per seat and ships them only on flush", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordCycleDuration?.({ actorEntityKey: "goblin-1", durationMs: 12 });
		metrics.recordCycleDuration?.({ actorEntityKey: "goblin-1", durationMs: 40 });
		metrics.recordOpenCycles?.({ openCycles: 2 });
		expect(payloads).toHaveLength(0);

		await metrics.flush();
		expect(payloads).toHaveLength(1);
		expect(payloads[0]).toContain("spellkave.world_actor.cycle_duration");
		expect(payloads[0]).toContain("spellkave.world_actor.open_cycles");
		expect(payloads[0]).toContain("goblin-1");
		const payload = JSON.parse(payloads[0] ?? "{}");
		const cycleMetric = payload.resourceMetrics[0].scopeMetrics[0].metrics.find(
			(metric: { name: string }) => metric.name === "spellkave.world_actor.cycle_duration",
		);
		expect(cycleMetric.histogram.dataPoints[0].count).toBe("2");
	});

	it("accumulates cycle queue-wait per seat and ships it only on flush", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordCycleQueueWait?.({ actorEntityKey: "goblin-1", durationMs: 80 });
		metrics.recordCycleQueueWait?.({ actorEntityKey: "goblin-1", durationMs: 20 });
		expect(payloads).toHaveLength(0);

		await metrics.flush();
		expect(payloads[0]).toContain("spellkave.world_actor.cycle_queue_wait");
		expect(payloads[0]).toContain("goblin-1");
		const payload = JSON.parse(payloads[0] ?? "{}");
		const waitMetric = payload.resourceMetrics[0].scopeMetrics[0].metrics.find(
			(metric: { name: string }) => metric.name === "spellkave.world_actor.cycle_queue_wait",
		);
		expect(waitMetric.histogram.dataPoints[0].count).toBe("2");
		expect(waitMetric.histogram.dataPoints[0].sum).toBe(100);
	});

	it("ships cycle_failures_total with actor_entity_key when provided", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			allowedCycleSteps: ["npc-cycle"],
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordCycleFailure({
			step: "npc-cycle",
			failureClass: "Error",
			retryCount: 0,
			actorEntityKey: "goblin-1",
		});
		await metrics.flush();

		const payload = JSON.parse(payloads[0] ?? "{}");
		const failure = payload.resourceMetrics[0].scopeMetrics[0].metrics.find(
			(metric: { name: string }) => metric.name === "spellkave.world_actor.cycle_failures_total",
		);
		expect(failure.sum.dataPoints[0].attributes).toContainEqual({
			key: "spellkave.actor_entity_key",
			value: { stringValue: "goblin-1" },
		});
	});

	it("ships open_cycles as max-in-window and publishes queue depth", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordOpenCycles?.({ openCycles: 2, queueDepth: 3 });
		metrics.recordOpenCycles?.({ openCycles: 0, queueDepth: 0 });
		await metrics.flush();

		const first = JSON.parse(payloads[0] ?? "{}");
		const names = first.resourceMetrics[0].scopeMetrics[0].metrics as Array<{
			name: string;
			gauge?: { dataPoints: Array<{ asInt: string }> };
		}>;
		const open = names.find((metric) => metric.name === "spellkave.world_actor.open_cycles");
		const queue = names.find((metric) => metric.name === "spellkave.world_actor.cycle_queue_depth");
		expect(open?.gauge?.dataPoints[0]?.asInt).toBe("2");
		expect(queue?.gauge?.dataPoints[0]?.asInt).toBe("3");

		await metrics.flush();
		const second = JSON.parse(payloads[1] ?? "{}");
		const later = second.resourceMetrics[0].scopeMetrics[0].metrics as Array<{
			name: string;
			gauge?: { dataPoints: Array<{ asInt: string }> };
		}>;
		expect(
			later.find((metric) => metric.name === "spellkave.world_actor.open_cycles")?.gauge
				?.dataPoints[0]?.asInt,
		).toBe("0");
	});

	it("ships exporter heartbeats on flush even when no cycles ran", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		await metrics.flush();
		expect(payloads).toHaveLength(0);

		metrics.recordExporterHeartbeat?.();
		metrics.recordExporterHeartbeat?.();
		await metrics.flush();
		expect(payloads).toHaveLength(1);
		expect(payloads[0]).toContain("spellkave.world_actor.exporter_heartbeats_total");
		const payload = JSON.parse(payloads[0] ?? "{}");
		const heartbeat = payload.resourceMetrics[0].scopeMetrics[0].metrics.find(
			(metric: { name: string }) =>
				metric.name === "spellkave.world_actor.exporter_heartbeats_total",
		);
		expect(heartbeat.sum.dataPoints[0].asInt).toBe("2");
	});

	it("ships per-seat worker heap as a gauge on flush", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordWorkerHeap?.({ actorEntityKey: "aldwin", heapUsedBytes: 12_345_678 });
		await metrics.flush();
		expect(payloads[0]).toContain("spellkave.world_actor.worker_heap_bytes");
		expect(payloads[0]).toContain("aldwin");
		expect(payloads[0]).toContain("12345678");
	});

	it("ships cycle_slot_wait_exceeded_total with stable attributes on record", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			resourceAttributes: {
				"spellkave.world_slug": "test-world",
			},
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(init.body as string);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});

		metrics.recordCycleSlotWaitExceeded?.({ actorEntityKey: "aldwin" });
		await metrics.flush();

		expect(payloads).toHaveLength(1);
		expect(payloads[0]).toContain("spellkave.world_actor.cycle_slot_wait_exceeded_total");
		expect(payloads[0]).not.toContain("aldwin");
		const payload = JSON.parse(payloads[0] ?? "{}");
		const metric = payload.resourceMetrics[0].scopeMetrics[0].metrics.find(
			(m: { name: string }) => m.name === "spellkave.world_actor.cycle_slot_wait_exceeded_total",
		);
		expect(metric.sum.dataPoints[0].asInt).toBe("1");
		expect(metric.sum.dataPoints[0].attributes).toContainEqual({
			key: "spellkave.world_slug",
			value: { stringValue: "test-world" },
		});
	});
});
