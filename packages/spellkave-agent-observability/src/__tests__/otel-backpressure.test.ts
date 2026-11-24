import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createRunEmitter } from "../emit.ts";
import { createOtlpHttpMetrics } from "../metrics.ts";
import { createOtlpHttpSink } from "../otel.ts";

function emitter(sink: ReturnType<typeof createOtlpHttpSink>) {
	return createRunEmitter(
		{
			run_id: "transport-pressure",
			run_kind: "combat_beat",
			actor_id: "probe",
			role: "NPC",
			controller_kind: "deterministic_npc",
			driver: "test",
		},
		[sink],
	);
}

describe("OTLP log transport resource lifecycle", () => {
	it("aborts native fetch against a local collector that never sends headers", async () => {
		const server = createServer((_request, _response) => {
			// Intentionally no response: exercise the actual Node transport.
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (address === null || typeof address === "string") throw new Error("Missing port");
			const sink = createOtlpHttpSink({
				endpoint: `http://127.0.0.1:${address.port}/v1/logs`,
				requestTimeoutMs: 100,
			});
			emitter(sink).emit("run_start");
			await sink.close?.();
			expect(sink.transportSnapshot()).toEqual({ pending: 0, dropped: 0, timedOut: 1, failed: 1 });
		} finally {
			server.closeAllConnections();
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});

	it("projects local transport snapshots through separate metrics requests", async () => {
		const bodies: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://unused.invalid",
			logTransportSnapshot: () => ({ pending: 2, dropped: 17, timedOut: 3, failed: 4 }),
			fetchFn: async (_url, init) => {
				bodies.push(String(init?.body));
				return new Response(null);
			},
		});
		await metrics.flush();
		const payload = JSON.parse(bodies[0] ?? "{}");
		const exported = payload.resourceMetrics[0].scopeMetrics[0].metrics;
		for (const [suffix, value] of [
			["pending", "2"],
			["dropped", "17"],
			["timed_out", "3"],
			["failed", "4"],
		]) {
			expect(exported).toContainEqual(
				expect.objectContaining({
					name: `spellkave.world_actor.log_export_${suffix}`,
					gauge: { dataPoints: [expect.objectContaining({ asInt: value })] },
				}),
			);
		}
	});

	it("keeps an abort-ignoring request charged against admission until it settles", async () => {
		vi.useFakeTimers();
		try {
			let calls = 0;
			let release: (() => void) | undefined;
			const sink = createOtlpHttpSink({
				endpoint: "http://unused.invalid",
				maxPendingExports: 1,
				requestTimeoutMs: 10,
				// One record per POST and no buffer: the pre-batching contract,
				// pinned here on purpose. This test is about admission accounting
				// surviving a request that ignores its abort, not about batching.
				maxBatchRecords: 1,
				maxBufferedRecords: 0,
				fetchFn: () => {
					calls++;
					return new Promise<Response>((resolve) => {
						release = () => resolve(new Response(null));
					});
				},
			});
			const run = emitter(sink);
			run.emit("run_start");
			await vi.advanceTimersByTimeAsync(100);
			for (let i = 0; i < 1000; i++) run.emit("brain_decision", {});
			expect(calls).toBe(1);
			expect(sink.transportSnapshot()).toEqual({
				pending: 1,
				dropped: 1000,
				timedOut: 1,
				failed: 0,
			});
			release?.();
			await sink.close?.();
		} finally {
			vi.useRealTimers();
		}
	});

	it("buffers behind full admission instead of dropping, and still drops at the buffer ceiling", async () => {
		// The contract this change exists to replace. Before batching, a full
		// admission budget discarded every further record — which is how a busy host
		// lost 27486 of them with nobody playing (sk-jay0.6.15.56.21). Now they
		// queue, and only a full BUFFER drops.
		let calls = 0;
		const releases: Array<() => void> = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://unused.invalid",
			maxPendingExports: 1,
			maxBatchRecords: 10,
			maxBufferedRecords: 50,
			fetchFn: () => {
				calls++;
				return new Promise<Response>((resolve) => {
					releases.push(() => resolve(new Response(null)));
				});
			},
		});
		const run = emitter(sink);
		// One takes the single admission slot; the next 50 fill the buffer.
		for (let i = 0; i < 51; i++) run.emit("brain_decision", {});
		expect(calls).toBe(1);
		expect(sink.transportSnapshot().dropped).toBe(0);

		// Past the ceiling, dropping resumes — the buffer must not grow without
		// bound just because the collector is gone.
		for (let i = 0; i < 25; i++) run.emit("brain_decision", {});
		expect(sink.transportSnapshot().dropped).toBe(25);

		for (const release of releases) release();
		const drain = sink.close?.();
		// close() keeps flushing what is buffered, so it starts further requests;
		// release each as it appears rather than abandoning the queue.
		while (releases.length > 0) {
			for (const release of releases.splice(0)) release();
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		await drain;
		expect(calls).toBeGreaterThan(1);
	});

	it("aborts a stalled request and recovers admission even if error reporting throws", async () => {
		vi.useFakeTimers();
		try {
			let calls = 0;
			let aborted = 0;
			const sink = createOtlpHttpSink({
				endpoint: "http://unused.invalid",
				maxPendingExports: 1,
				requestTimeoutMs: 50,
				// Pre-batching shape on purpose: this pins abort-and-recover, and a
				// batch trigger would only obscure which request was aborted.
				maxBatchRecords: 1,
				maxBufferedRecords: 0,
				onError: () => {
					throw new Error("broken reporter");
				},
				fetchFn: (_url, init) => {
					calls++;
					if (calls > 1) return Promise.resolve(new Response(null));
					return new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener(
							"abort",
							() => {
								aborted++;
								reject(new Error("aborted"));
							},
							{ once: true },
						);
					});
				},
			});
			const run = emitter(sink);
			run.emit("run_start");
			await vi.advanceTimersByTimeAsync(50);
			expect(aborted).toBe(1);
			run.emit("brain_decision", {});
			await sink.close?.();
			expect(calls).toBe(2);
			expect(sink.transportSnapshot()).toEqual({ pending: 0, dropped: 0, timedOut: 1, failed: 1 });
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("bounds default admission while a collector is stalled", async () => {
		const releases: Array<() => void> = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://unused.invalid",
			fetchFn: () =>
				new Promise<Response>((resolve) => {
					releases.push(() => resolve(new Response(null, { status: 200 })));
				}),
		});
		const run = emitter(sink);
		for (let i = 0; i < 1000; i++) run.emit("brain_decision", {});
		const admitted = releases.length;
		expect(admitted).toBeLessThanOrEqual(64);
		// close() flushes the records that queued behind those 64, which starts
		// further requests; release each round so the drain can finish.
		const drain = sink.close?.();
		while (releases.length > 0) {
			for (const release of releases.splice(0)) release();
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
		await drain;
	});

	it("packs records queued behind full admission into one POST", async () => {
		// The measured win. One record per request made the 64-slot budget a
		// RATE ceiling, and 71 seats share one sink (the parent emitter, see
		// seat-worker-runtime.ts), so the ceiling was hit constantly. Batching
		// turns the same budget into a throughput of maxBatchRecords x 64.
		const bodies: string[] = [];
		let releaseFirst: (() => void) | undefined;
		const sink = createOtlpHttpSink({
			endpoint: "http://unused.invalid",
			maxPendingExports: 1,
			maxBatchRecords: 100,
			fetchFn: async (_url, init) => {
				bodies.push(String(init?.body));
				if (releaseFirst === undefined) {
					await new Promise<void>((resolve) => {
						releaseFirst = resolve;
					});
				}
				return new Response(null);
			},
		});
		const run = emitter(sink);
		// The first takes the only slot and blocks; the next 100 have nowhere to
		// go and queue.
		run.emit("run_start");
		for (let i = 0; i < 100; i++) run.emit("brain_decision", {});
		expect(bodies).toHaveLength(1);

		releaseFirst?.();
		await sink.close?.();

		// 101 records, two requests: one single that was already in flight, and
		// one carrying the whole queued batch. Unbatched this was 101 requests
		// of which 100 would have been dropped.
		expect(bodies).toHaveLength(2);
		const batched = JSON.parse(bodies[1] ?? "{}");
		expect(batched.resourceLogs[0].scopeLogs[0].logRecords).toHaveLength(100);
	});

	it.each([
		200, 503,
	])("releases HTTP %i response bodies before reporting the export drained", async (status) => {
		let cancelled = false;
		const body = new ReadableStream({
			cancel() {
				cancelled = true;
			},
		});
		const sink = createOtlpHttpSink({
			endpoint: "http://unused.invalid",
			fetchFn: async () => new Response(body, { status }),
		});
		emitter(sink).emit("run_start");
		await sink.close?.();
		const releasedBeforeClose = cancelled;
		await body.cancel();
		expect(releasedBeforeClose).toBe(true);
		expect(sink.transportSnapshot().failed).toBe(status === 200 ? 0 : 1);
	});
});
