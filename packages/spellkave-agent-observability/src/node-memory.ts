import { readFile } from "node:fs/promises";
import type { HostMemorySample, WorldActorMetrics } from "./metrics.ts";

function byteCount(raw: string): number | undefined {
	const value = raw.trim();
	if (!/^\d+$/.test(value)) return undefined;
	const bytes = Number(value);
	return Number.isSafeInteger(bytes) ? bytes : undefined;
}

/** Best-effort cgroup-v2 snapshot. Missing files/unlimited values are absent,
 * not zero. Process RSS includes all workers; other process fields describe
 * the calling isolate. External includes arrayBuffers: never add them twice.
 * No credentials, process arguments, or gameplay state are read. */
export async function sampleHostMemory(
	read: (path: string) => Promise<string> = (path) => readFile(path, "utf8"),
	memory: () => NodeJS.MemoryUsage = () => process.memoryUsage(),
): Promise<HostMemorySample> {
	const usage = memory();
	const fields = [
		["cgroupCurrentBytes", "memory.current"],
		["cgroupPeakBytes", "memory.peak"],
		["cgroupLimitBytes", "memory.max"],
	] as const;
	const sample: HostMemorySample = {
		processRssBytes: usage.rss,
		heapUsedBytes: usage.heapUsed,
		heapTotalBytes: usage.heapTotal,
		externalBytes: usage.external,
		arrayBuffersBytes: usage.arrayBuffers,
	};
	await Promise.all(
		fields.map(async ([key, file]) => {
			try {
				const bytes = byteCount(await read(`/sys/fs/cgroup/${file}`));
				if (bytes !== undefined) sample[key] = bytes;
			} catch {
				// Non-Linux and unavailable cgroups retain the process-only sample.
			}
		}),
	);
	return sample;
}

/** Independent of NPC cycle completion: a wedged cycle must not freeze the
 * host-memory signal. At most one snapshot is in flight; stop discards it. */
export function startHostMemorySampler(
	metrics: Pick<WorldActorMetrics, "recordHostMemory">,
	sample: () => Promise<HostMemorySample> = sampleHostMemory,
	intervalMs = 10_000,
): () => void {
	let stopped = false;
	let pending = false;
	const tick = async () => {
		if (stopped || pending) return;
		pending = true;
		try {
			const value = await sample();
			if (!stopped) metrics.recordHostMemory?.(value);
		} catch {
			// Sampling/export callbacks cannot terminate the observed host.
		} finally {
			pending = false;
		}
	};
	const timer = setInterval(() => void tick(), intervalMs);
	timer.unref();
	void tick();
	return () => {
		stopped = true;
		clearInterval(timer);
	};
}
