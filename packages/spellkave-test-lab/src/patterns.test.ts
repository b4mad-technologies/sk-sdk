import { InternalError, SenderError } from "spacetimedb";
import { describe, expect, it, vi } from "vitest";
import type { TestWorld } from "./live";
import { diffSnapshots, isServerRefusal, probe, recordedDraw } from "./patterns";
import { formatStepReport, SLOW_TEST_WARN_MS } from "./reporter";
import type { Scene, SceneSnapshot } from "./scene";

const snap = (entries: [string, string | null][]): SceneSnapshot =>
	new Map(entries.map(([id, node]) => [id, { node }]));

describe("scene diff", () => {
	it("is empty when nothing changed", () => {
		const a = snap([["1", "p/g/hall"]]);
		expect(diffSnapshots(a, snap([["1", "p/g/hall"]])).empty).toBe(true);
	});

	it("reports added, removed and moved entities", () => {
		const before = snap([
			["1", "p/g/hall"],
			["2", "p/g/hall"],
		]);
		const after = snap([
			["1", "p/g/yard"],
			["3", "p/g/yard"],
		]);
		const diff = diffSnapshots(before, after);
		expect(diff.empty).toBe(false);
		expect(diff.added).toEqual([3n]);
		expect(diff.removed).toEqual([2n]);
		expect(diff.changed).toEqual([
			{ entityId: 1n, node: { before: "p/g/hall", after: "p/g/yard" } },
		]);
	});
});

describe("recorded draw", () => {
	const row = (ids: string[], values: number[]) => ({
		provenanceId: "p1",
		selectedTemplateIds: ids,
		draws: values.map((value) => ({ value: BigInt(value) })),
	});

	it("takes the one draw of an unbiased roll", () => {
		expect(recordedDraw(row([], [13]))).toMatchObject({ face: 13, faces: [13], bias: "none" });
	});

	it("takes the higher draw under advantage and the lower under disadvantage", () => {
		expect(recordedDraw(row(["resolution_roll_bias:advantage"], [4, 17])).face).toBe(17);
		expect(recordedDraw(row(["resolution_roll_bias:disadvantage"], [4, 17])).face).toBe(4);
	});

	it("rejects an unlabelled multi-draw row and a row without draws", () => {
		expect(() => recordedDraw(row([], [4, 17]))).toThrow(/without a roll-bias label/);
		expect(() => recordedDraw(row([], []))).toThrow(/no stochastic draw/);
	});
});

describe("step reporter", () => {
	it("prints duration and steps per test and warns above the threshold", () => {
		const lines = formatStepReport([
			{ file: "a.test.ts", test: "fast", durationMs: 120, steps: { act: 1 }, state: "passed" },
			{
				file: "b.test.ts",
				test: "slow",
				durationMs: SLOW_TEST_WARN_MS + 1,
				steps: {},
				state: "passed",
			},
		]);
		expect(lines[0]).toBe("[test-lab] passed 120ms steps=1 (act=1) a.test.ts > fast");
		expect(
			lines.some((line) => line.includes("WARN slow live test") && line.includes("slow")),
		).toBe(true);
		expect(lines.at(-1)).toMatch(/2 test\(s\)/);
	});
});

describe("probe verdicts", () => {
	function fakeScene(): Scene {
		const owner = {
			identity: "owner",
			conn: { reducers: { debugSyncMarker: vi.fn(async () => {}) } },
			db: () => ({}),
			subscribeReaders: async () => {},
			disconnect: () => {},
		} as unknown as TestWorld;
		return {
			owner,
			heroes: () => [],
			reads: { snapshot: () => new Map() },
		} as unknown as Scene;
	}

	it("turns a server refusal into an ok:false verdict", async () => {
		const refusal = new SenderError("not_your_turn");
		const { verdict, diff } = await probe({
			scene: fakeScene(),
			act: () => Promise.reject(refusal),
		});
		expect(verdict).toEqual({ ok: false, error: refusal });
		expect(diff.empty).toBe(true);
	});

	it("treats a wrapped refusal (an error whose cause is a SenderError) as a refusal", () => {
		expect(
			isServerRefusal(new Error("apply failed", { cause: new SenderError("MF-APPLY-013") })),
		).toBe(true);
	});

	it("rethrows a harness guard error instead of reporting it as refused", async () => {
		const guard = new Error(
			"manualTick advances the world clock ... mark it `// live-phase: final`",
		);
		await expect(probe({ scene: fakeScene(), act: () => Promise.reject(guard) })).rejects.toBe(
			guard,
		);
	});

	it("rethrows an internal reducer error and a connection failure", async () => {
		await expect(
			probe({ scene: fakeScene(), act: () => Promise.reject(new InternalError("panic")) }),
		).rejects.toBeInstanceOf(InternalError);
		await expect(
			probe({ scene: fakeScene(), act: () => Promise.reject(new Error("socket closed")) }),
		).rejects.toThrow("socket closed");
	});
});
