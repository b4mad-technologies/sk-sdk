// JSONL file sink + run index coverage (ADR-0074 S2): the canonical sink
// round-trips through the index, mixed streams split per run_id, and foreign
// files are ignored.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRunEmitter } from "../emit.ts";
import {
	AGENT_RUN_EVENTS_FILENAME,
	buildRunIndex,
	createJsonlFileSink,
	readRunEventsFile,
} from "../node.ts";

const roots: string[] = [];

function tempRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "agent-obs-"));
	roots.push(root);
	return root;
}

afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function runOnce(file: string, runId: string, tsBase: string): void {
	let tick = 0;
	const emitter = createRunEmitter(
		{
			run_id: runId,
			run_kind: "campaign_playthrough",
			actor_id: "phandelver/hero",
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: "pi-agent",
			seed: "7",
			now: () => new Date(Date.parse(tsBase) + tick++ * 1000),
		},
		[createJsonlFileSink(file)],
	);
	emitter.emit("run_start");
	emitter.emit("tool_call", { tool_name: "spellkave_move" });
	emitter.emit("turn_end", { input_tokens: 10, output_tokens: 5 });
	emitter.emit("terminal", { terminal: "explored_enough" });
	emitter.emit("run_end", { terminal: "explored_enough" });
}

describe("createJsonlFileSink + readRunEventsFile", () => {
	it("round-trips a run through the canonical file", () => {
		const root = tempRoot();
		const file = join(root, "run-a", AGENT_RUN_EVENTS_FILENAME);
		runOnce(file, "run-a", "2026-07-15T12:00:00.000Z");
		const { events, skipped } = readRunEventsFile(file);
		expect(skipped).toBe(0);
		expect(events.map((event) => event.type)).toEqual([
			"run_start",
			"tool_call",
			"turn_end",
			"terminal",
			"run_end",
		]);
	});
});

describe("buildRunIndex", () => {
	it("indexes runs across a nested tree, splitting shared files per run_id", () => {
		const root = tempRoot();
		runOnce(join(root, "exp/run-a", AGENT_RUN_EVENTS_FILENAME), "run-a", "2026-07-15T12:00:00Z");
		runOnce(join(root, "exp/run-b", AGENT_RUN_EVENTS_FILENAME), "run-b", "2026-07-15T13:00:00Z");
		// A second run appended to run-b's file (shared-sink NPC fleet case).
		runOnce(join(root, "exp/run-b", AGENT_RUN_EVENTS_FILENAME), "run-c", "2026-07-15T14:00:00Z");
		// Foreign artifacts are ignored entirely.
		writeFileSync(join(root, "exp", "run.json"), JSON.stringify({ run_id: "run-x" }));
		const index = buildRunIndex(root);
		expect(index.map((entry) => entry.run_id)).toEqual(["run-a", "run-b", "run-c"]);
		const runA = index[0];
		expect(runA?.run_kind).toBe("campaign_playthrough");
		expect(runA?.totals.tool_calls).toBe(1);
		expect(runA?.totals.input_tokens).toBe(10);
		expect(runA?.terminal).toEqual({
			terminal: "explored_enough",
			reason: null,
			incomplete: false,
		});
		expect(runA?.first_ts).toBe("2026-07-15T12:00:00.000Z");
	});

	it("returns an empty index for a missing root", () => {
		expect(buildRunIndex(join(tempRoot(), "does-not-exist"))).toEqual([]);
	});

	it("a partial-envelope line is skipped and never crashes the index", () => {
		const root = tempRoot();
		const file = join(root, "run-p", AGENT_RUN_EVENTS_FILENAME);
		runOnce(file, "run-p", "2026-07-15T12:00:00Z");
		// A malformed producer line carrying only v/run_id/type (no ts!) — the
		// index must skip it rather than sort on an undefined ts.
		writeFileSync(
			file,
			`${JSON.stringify({ v: "agent-run-events/v1", run_id: "run-p", type: "budget_tick" })}\n`,
			{ flag: "a" },
		);
		const index = buildRunIndex(root);
		expect(index).toHaveLength(1);
		expect(index[0]?.skipped_lines).toBe(1);
		expect(index[0]?.totals.tool_calls).toBe(1);
	});
});
