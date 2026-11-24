// A package's live test files split into a fast live lane and a smoke lane of playthroughs; only
// the live lane counts steps, and both lanes stop a hung test or hook with one watchdog.
import { describe, expect, it } from "vitest";
import {
	isSmokeFile,
	LIVE_HANG_WATCHDOG_MS,
	laneFromEnv,
	liveLaneTest,
	partitionLiveFiles,
} from "./lanes";

const FILES: Record<string, string> = {
	"src/live/probe.live.test.ts": "import { probe } from '@spellkave/test-lab';\n",
	"src/live/final.live.test.ts": "// live-phase: final\n",
	"src/live/fight.live.test.ts": "// live-lane: smoke\n// a full fight\n",
	"src/live/mention.live.test.ts": "const doc = 'not a marker: // live-lane: smoke-ish';\n",
};

function partition() {
	return partitionLiveFiles(
		"/pkg",
		["src/live/**/*.test.ts", "src/live/*.live.test.ts"],
		(file) => FILES[file] ?? "",
		() => Object.keys(FILES),
	);
}

describe("live lanes", () => {
	it("splits the candidate files into disjoint and complete lanes", () => {
		const { live, smoke } = partition();
		expect(smoke).toEqual(["src/live/fight.live.test.ts"]);
		expect(new Set([...live, ...smoke])).toEqual(new Set(Object.keys(FILES)));
		expect(live.filter((file) => smoke.includes(file))).toEqual([]);
	});

	it("accepts only the exact marker line", () => {
		expect(isSmokeFile("// live-lane: smoke\n")).toBe(true);
		expect(isSmokeFile("  //   live-lane:  smoke  \n")).toBe(true);
		expect(isSmokeFile("// live-lane: smoke-ish\n")).toBe(false);
		expect(isSmokeFile("const x = 1; // live-lane: smoke\n")).toBe(false);
	});

	it("turns the step counter off in the smoke lane only", () => {
		const live = liveLaneTest({ root: import.meta.dirname, include: [], lane: "live" });
		const smoke = liveLaneTest({ root: import.meta.dirname, include: [], lane: "smoke" });
		expect(live.setupFiles).toHaveLength(1);
		expect(smoke.setupFiles).toEqual([]);
		expect(smoke.passWithNoTests).toBe(true);
	});

	it("gives every test and hook of both lanes the one hang watchdog", () => {
		for (const lane of ["live", "smoke"] as const) {
			const config = liveLaneTest({ root: import.meta.dirname, include: [], lane });
			expect(config.testTimeout).toBe(LIVE_HANG_WATCHDOG_MS);
			expect(config.hookTimeout).toBe(LIVE_HANG_WATCHDOG_MS);
		}
	});

	it("reads the lane from the environment and rejects unknown lanes", () => {
		expect(laneFromEnv(undefined)).toBe("live");
		expect(laneFromEnv("smoke")).toBe("smoke");
		expect(() => laneFromEnv("nightly")).toThrow(/live" or "smoke/);
	});
});
