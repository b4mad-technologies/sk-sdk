import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOtlpHttpMetrics, type HostMemorySample } from "../metrics.ts";
import { sampleHostMemory, startHostMemorySampler } from "../node-memory.ts";

const memory = () => ({
	rss: 1000,
	heapUsed: 200,
	heapTotal: 300,
	external: 400,
	arrayBuffers: 350,
});

describe("host memory snapshot", () => {
	afterEach(() => vi.useRealTimers());
	it("distinguishes real worker buffer allocation from isolate heap", async () => {
		const worker = new Worker(
			`
			const { parentPort } = require("node:worker_threads");
			const before = process.memoryUsage();
			const retained = Buffer.alloc(16 * 1024 * 1024, 1);
			const after = process.memoryUsage();
			parentPort.postMessage({ externalDelta: after.external - before.external,
				bufferDelta: after.arrayBuffers - before.arrayBuffers,
				heapDelta: after.heapUsed - before.heapUsed, retained: retained.length });
		`,
			{ eval: true },
		);
		try {
			const result = await new Promise<{
				externalDelta: number;
				bufferDelta: number;
				heapDelta: number;
				retained: number;
			}>((resolve, reject) => {
				worker.once("message", resolve);
				worker.once("error", reject);
				worker.once("exit", (code) => {
					if (code !== 0) reject(new Error(`worker exited ${code}`));
				});
			});
			expect(result.retained).toBe(16 * 1024 * 1024);
			expect(result.externalDelta).toBeGreaterThanOrEqual(15 * 1024 * 1024);
			expect(result.bufferDelta).toBeGreaterThanOrEqual(15 * 1024 * 1024);
			expect(result.heapDelta).toBeLessThan(4 * 1024 * 1024);
		} finally {
			await worker.terminate();
		}
	});
	it("recovers after sampling or recording errors without overlapping work", async () => {
		vi.useFakeTimers();
		const value = {
			processRssBytes: 1,
			heapUsedBytes: 1,
			heapTotalBytes: 1,
			externalBytes: 0,
			arrayBuffersBytes: 0,
		};
		const sample = vi
			.fn<() => Promise<HostMemorySample>>()
			.mockRejectedValueOnce(new Error("sample failed"))
			.mockResolvedValue(value);
		const recordHostMemory = vi.fn().mockImplementationOnce(() => {
			throw new Error("record failed");
		});
		const stop = startHostMemorySampler({ recordHostMemory }, sample, 10);
		await vi.advanceTimersByTimeAsync(25);
		stop();
		expect(sample).toHaveBeenCalledTimes(3);
		expect(recordHostMemory).toHaveBeenCalledTimes(2);
	});
	it("exposes stale worker sample age and separate external allocations", async () => {
		let now = 100;
		const bodies: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://unused.invalid",
			now: () => now,
			fetchFn: async (_url, init) => {
				bodies.push(String(init?.body));
				return new Response(null, { status: 200 });
			},
		});
		metrics.recordWorkerHeap?.({
			actorEntityKey: "npc/probe",
			heapUsedBytes: 20,
			heapTotalBytes: 40,
			externalBytes: 1000,
			arrayBuffersBytes: 900,
		});
		now = 250;
		await metrics.flush();
		const payload = JSON.parse(bodies[0] ?? "{}");
		const rows = payload.resourceMetrics[0].scopeMetrics[0].metrics;
		expect(
			rows.find((row: { name: string }) => row.name.endsWith("worker_memory_sample_age_ms")).gauge
				.dataPoints[0].asInt,
		).toBe("150");
		expect(
			rows.find((row: { name: string }) => row.name.endsWith("worker_external_bytes")).gauge
				.dataPoints[0].asInt,
		).toBe("1000");
	});
	it("bounds pending sampling and discards completion after stop", async () => {
		vi.useFakeTimers();
		let complete!: (value: HostMemorySample) => void;
		const sample = vi.fn(
			() =>
				new Promise<HostMemorySample>((resolve) => {
					complete = resolve;
				}),
		);
		const recordHostMemory = vi.fn();
		const stop = startHostMemorySampler({ recordHostMemory }, sample, 10);
		await vi.advanceTimersByTimeAsync(100);
		expect(sample).toHaveBeenCalledTimes(1);
		stop();
		complete({
			processRssBytes: 1,
			heapUsedBytes: 1,
			heapTotalBytes: 1,
			externalBytes: 0,
			arrayBuffersBytes: 0,
		});
		await Promise.resolve();
		expect(recordHostMemory).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("exports only fresh host-wide samples, without actor dimensions", async () => {
		const bodies: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://unused.invalid",
			fetchFn: async (_url, init) => {
				bodies.push(String(init?.body));
				return new Response(null, { status: 200 });
			},
		});
		metrics.recordHostMemory?.({
			processRssBytes: 1000,
			heapUsedBytes: 200,
			heapTotalBytes: 300,
			externalBytes: 400,
			arrayBuffersBytes: 350,
		});
		await metrics.flush();
		expect(bodies).toHaveLength(1);
		expect(bodies[0]).toContain("spellkave.world_actor.process_rss_bytes");
		expect(bodies[0]).not.toContain("actor_entity_key");
		expect(bodies[0]).not.toContain("cgroup_limit_bytes");
		await metrics.flush();
		expect(bodies).toHaveLength(1);
	});
	it("keeps process, isolate, and container accounting separate", async () => {
		const files: Record<string, string> = {
			"/sys/fs/cgroup/memory.current": "1200\n",
			"/sys/fs/cgroup/memory.peak": "1500\n",
			"/sys/fs/cgroup/memory.max": "2000\n",
		};
		expect(await sampleHostMemory(async (path) => files[path] ?? "", memory)).toEqual({
			processRssBytes: 1000,
			heapUsedBytes: 200,
			heapTotalBytes: 300,
			externalBytes: 400,
			arrayBuffersBytes: 350,
			cgroupCurrentBytes: 1200,
			cgroupPeakBytes: 1500,
			cgroupLimitBytes: 2000,
		});
	});
	it("does not report missing, unlimited, or invalid cgroup values as zero", async () => {
		const sample = await sampleHostMemory(async (path) => {
			if (path.endsWith("memory.max")) return "max";
			if (path.endsWith("memory.peak")) return "NaN";
			throw new Error("unavailable");
		}, memory);
		expect(sample).toEqual({
			processRssBytes: 1000,
			heapUsedBytes: 200,
			heapTotalBytes: 300,
			externalBytes: 400,
			arrayBuffersBytes: 350,
		});
	});
});
