// `createJsonlFileSink({ maxBytes })` — the disk-side twin of `createMemorySink`'s
// `maxEvents` (sk-jay0.6.15.40). A long-running host appends to one file for the
// lifetime of each seat. A long-lived appender can fill its volume without rotation.
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentRunEvent } from "../events.ts";
import {
	AGENT_RUN_EVENTS_FILENAME,
	buildRunIndex,
	createJsonlFileSink,
	pruneRotatedTranscripts,
} from "../node.ts";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "agent-obs-rot-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** One event whose JSON line is comfortably over 100 bytes. */
function event(index: number): AgentRunEvent {
	return {
		v: "agent-run-events/v1",
		ts: new Date(Date.parse("2026-08-30T00:00:00.000Z") + index * 1000).toISOString(),
		run_id: "npc-host-kavemouth-1-ulda_1",
		run_kind: "world_observation",
		actor_id: "ulda_1",
		role: "NPC",
		controller_kind: "deterministic_npc",
		driver: "srd-cc-npc-host-kavemouth",
		seed: "0",
		type: "tool_call",
		data: { tool_name: "spellkave_scene", note: `padding-${"x".repeat(64)}-${index}` },
	} as AgentRunEvent;
}

describe("createJsonlFileSink maxBytes rotation", () => {
	it("keeps the live file under the cap and retains exactly one rotated generation", () => {
		const root = tempRoot();
		const file = join(root, "seat", AGENT_RUN_EVENTS_FILENAME);
		const sink = createJsonlFileSink(file, { maxBytes: 2_000 });
		for (let index = 0; index < 500; index += 1) sink.write(event(index));

		expect(statSync(file).size).toBeLessThanOrEqual(2_000);
		expect(existsSync(`${file}.1`)).toBe(true);
		expect(statSync(`${file}.1`).size).toBeLessThanOrEqual(2_000);
		// The point of the whole change: total occupancy is bounded by the cap,
		// not by how long the host has been running.
		expect(existsSync(`${file}.2`)).toBe(false);
	});

	it("is byte-identical to the old behaviour when no cap is given", () => {
		const root = tempRoot();
		const capped = join(root, "capped", AGENT_RUN_EVENTS_FILENAME);
		const uncapped = join(root, "uncapped", AGENT_RUN_EVENTS_FILENAME);
		const zero = createJsonlFileSink(capped, { maxBytes: 0 });
		const none = createJsonlFileSink(uncapped);
		for (let index = 0; index < 200; index += 1) {
			zero.write(event(index));
			none.write(event(index));
		}
		// `maxBytes: 0` is the documented "uncapped" spelling for a short run.
		expect(statSync(capped).size).toBe(statSync(uncapped).size);
		expect(existsSync(`${capped}.1`)).toBe(false);
	});

	it("seeds its budget from the file a previous process left behind", () => {
		const root = tempRoot();
		const file = join(root, "seat", AGENT_RUN_EVENTS_FILENAME);
		const first = createJsonlFileSink(file, { maxBytes: 2_000 });
		for (let index = 0; index < 8; index += 1) first.write(event(index));
		const carried = statSync(file).size;
		expect(carried).toBeGreaterThan(0);

		// A restart must not reset the budget to zero — that is how an
		// append-only file grows past its cap one pod restart at a time.
		const second = createJsonlFileSink(file, { maxBytes: 2_000 });
		for (let index = 0; index < 200; index += 1) second.write(event(index));
		expect(statSync(file).size).toBeLessThanOrEqual(2_000);
	});

	it("discards an oversized legacy file instead of preserving it as a generation", () => {
		const root = tempRoot();
		const file = join(root, "seat", AGENT_RUN_EVENTS_FILENAME);
		// A volume with pre-existing logs can contain: a file written before rotation
		// existed. Retaining it as `.1` would keep the disk full forever.
		mkdirSync(join(root, "seat"), { recursive: true });
		writeFileSync(file, "x".repeat(50_000));
		const sink = createJsonlFileSink(file, { maxBytes: 2_000 });
		sink.write(event(0));
		expect(statSync(file).size).toBeLessThan(2_000);
		expect(existsSync(`${file}.1`)).toBe(false);
	});

	it("writes a single line larger than the cap whole rather than spinning", () => {
		const root = tempRoot();
		const file = join(root, "seat", AGENT_RUN_EVENTS_FILENAME);
		const sink = createJsonlFileSink(file, { maxBytes: 50 });
		sink.write(event(0));
		sink.write(event(1));
		// Never split, never drop: the sink only decides where the boundary falls.
		expect(statSync(file).size).toBeGreaterThan(50);
		expect(existsSync(`${file}.1`)).toBe(true);
	});

	it("hides rotated generations from the run index", () => {
		const root = tempRoot();
		const file = join(root, "seat", AGENT_RUN_EVENTS_FILENAME);
		const sink = createJsonlFileSink(file, { maxBytes: 2_000 });
		for (let index = 0; index < 100; index += 1) sink.write(event(index));
		expect(existsSync(`${file}.1`)).toBe(true);
		// `walkForEventFiles` matches the canonical name exactly, so a rotated
		// file cannot make one run look like two.
		expect(buildRunIndex(root)).toHaveLength(1);
	});
});

// --- volume budget (sk-jay0.6.15.40) ----------------------------------------
// `maxBytes` bounds ONE seat and cannot bound a volume while the seat count is
// free to grow. These cases pin the total retained size against the shared budget.

/** Write `bytes` of filler into `path`, stamped with `mtimeMs`. */
function seed(path: string, bytes: number, mtimeMs: number): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, "x".repeat(bytes));
	utimesSync(path, mtimeMs / 1000, mtimeMs / 1000);
}

describe("pruneRotatedTranscripts volume budget", () => {
	it("deletes rotated generations oldest-first until the tree fits", () => {
		const root = tempRoot();
		const t0 = Date.parse("2026-09-13T00:00:00.000Z");
		for (const [index, name] of ["alpha", "beta", "gamma"].entries()) {
			seed(join(root, name, AGENT_RUN_EVENTS_FILENAME), 100, t0 + 10_000);
			seed(join(root, name, `${AGENT_RUN_EVENTS_FILENAME}.1`), 1_000, t0 + index * 1_000);
		}
		// 3 x 100 live + 3 x 1000 rotated = 3300. Budget 1500 must drop the two
		// oldest rotations (alpha, beta) and keep gamma's.
		const result = pruneRotatedTranscripts(root, 1_500);
		expect(result.bytesBefore).toBe(3_300);
		expect(result.bytesAfter).toBe(1_300);
		expect(result.overBudget).toBe(false);
		expect(result.deleted.map((path) => path.split("/").at(-2))).toEqual(["alpha", "beta"]);
		expect(existsSync(join(root, "gamma", `${AGENT_RUN_EVENTS_FILENAME}.1`))).toBe(true);
		// Every live file survives: a live file is an in-flight run.
		for (const name of ["alpha", "beta", "gamma"]) {
			expect(existsSync(join(root, name, AGENT_RUN_EVENTS_FILENAME))).toBe(true);
		}
	});

	it("never deletes a live file, and says so when the live set alone overflows", () => {
		const root = tempRoot();
		const t0 = Date.parse("2026-09-13T00:00:00.000Z");
		for (const name of ["alpha", "beta"]) {
			seed(join(root, name, AGENT_RUN_EVENTS_FILENAME), 1_000, t0);
			seed(join(root, name, `${AGENT_RUN_EVENTS_FILENAME}.1`), 1_000, t0);
		}
		// Budget 500 is below the 2000 bytes of live files. Everything rotated
		// goes, nothing live does, and the caller is told the bound did not hold.
		const result = pruneRotatedTranscripts(root, 500);
		expect(result.bytesAfter).toBe(2_000);
		expect(result.overBudget).toBe(true);
		expect(result.deleted).toHaveLength(2);
		for (const name of ["alpha", "beta"]) {
			expect(existsSync(join(root, name, AGENT_RUN_EVENTS_FILENAME))).toBe(true);
		}
	});

	it("ignores files that are not run-event transcripts", () => {
		const root = tempRoot();
		const t0 = Date.parse("2026-09-13T00:00:00.000Z");
		seed(join(root, "seat", "installed.json"), 5_000, t0);
		seed(join(root, "seat", `${AGENT_RUN_EVENTS_FILENAME}.1`), 100, t0);
		const result = pruneRotatedTranscripts(root, 10);
		// The foreign file is neither counted nor deleted — this budget governs
		// transcripts, and the tree may be shared with other operator state.
		expect(result.bytesBefore).toBe(100);
		expect(existsSync(join(root, "seat", "installed.json"))).toBe(true);
	});

	it("is a no-op on a root that does not exist", () => {
		const result = pruneRotatedTranscripts(join(tempRoot(), "absent"), 10);
		expect(result).toEqual({ bytesBefore: 0, bytesAfter: 0, deleted: [], overBudget: false });
	});
});

describe("createJsonlFileSink rootMaxBytes", () => {
	it("enforces the volume budget across seats on rotation", () => {
		const root = tempRoot();
		const t0 = Date.parse("2026-09-13T00:00:00.000Z");
		// A neighbour seat that already rotated once and is doing nothing.
		seed(join(root, "idle", AGENT_RUN_EVENTS_FILENAME), 100, t0);
		seed(join(root, "idle", `${AGENT_RUN_EVENTS_FILENAME}.1`), 4_000, t0);
		const file = join(root, "busy", AGENT_RUN_EVENTS_FILENAME);
		const sink = createJsonlFileSink(file, { maxBytes: 400, rootDir: root, rootMaxBytes: 2_000 });
		// Enough events to rotate the busy seat at least once.
		for (let index = 0; index < 20; index += 1) sink.write(event(index));
		// The idle neighbour's rotated generation is what the budget reclaims —
		// a per-seat cap would never have touched it.
		expect(existsSync(join(root, "idle", `${AGENT_RUN_EVENTS_FILENAME}.1`))).toBe(false);
		expect(existsSync(join(root, "idle", AGENT_RUN_EVENTS_FILENAME))).toBe(true);
		// The busy seat rotated (that is what triggered the prune) and its own
		// live file restarted. Size is bounded by the cap plus at most one whole
		// line — the sink never splits an event, see the maxBytes cases above.
		expect(existsSync(join(root, "busy", `${AGENT_RUN_EVENTS_FILENAME}.1`))).toBe(true);
		expect(statSync(file).size).toBeLessThan(1_000);
	});

	it("leaves the tree alone when no budget is set", () => {
		const root = tempRoot();
		const t0 = Date.parse("2026-09-13T00:00:00.000Z");
		seed(join(root, "idle", `${AGENT_RUN_EVENTS_FILENAME}.1`), 4_000, t0);
		const sink = createJsonlFileSink(join(root, "busy", AGENT_RUN_EVENTS_FILENAME), {
			maxBytes: 400,
		});
		for (let index = 0; index < 20; index += 1) sink.write(event(index));
		expect(existsSync(join(root, "idle", `${AGENT_RUN_EVENTS_FILENAME}.1`))).toBe(true);
	});
});
