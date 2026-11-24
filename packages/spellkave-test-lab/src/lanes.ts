/**
 * Live lanes: `test:live` (fast, step-budgeted) and `test:smoke` (playthroughs).
 *
 * A file whose header carries `// live-lane: smoke` is a playthrough. The
 * package's `test:live` run never includes it, and `test:smoke` runs only those
 * files, serially, with the step counter off (design D-5, task 3.3a). The two
 * sets are disjoint and together cover every candidate file; `partitionLiveFiles`
 * is the single place that decides it.
 *
 * Usage in a package `vitest.config.ts`:
 *
 * ```ts
 * import { liveLaneTest } from "@spellkave/test-lab/lanes";
 * export default defineConfig({ test: liveLaneTest({ root: import.meta.dirname, include: ["src/live/**\/*.test.ts"] }) });
 * ```
 *
 * The lane comes from `options.lane`, else `SPELLKAVE_LIVE_LANE`, else `live`.
 */
import { globSync, readFileSync } from "node:fs";
import path from "node:path";

export type LiveLane = "live" | "smoke";

/** The lane selector. Not an exemption: smoke files still follow the wait and dice rules. */
export const SMOKE_LANE_MARKER = /^\s*\/\/\s*live-lane:[ \t]*smoke[ \t]*$/m;

export function isSmokeFile(source: string): boolean {
	return SMOKE_LANE_MARKER.test(source);
}

export interface LiveFilePartition {
	live: string[];
	smoke: string[];
}

/** Split the files matched by `include` (relative to `root`) into the two lanes. */
export function partitionLiveFiles(
	root: string,
	include: readonly string[],
	readFile: (file: string) => string = (file) => readFileSync(path.join(root, file), "utf8"),
	glob: (pattern: string) => string[] = (pattern) =>
		globSync(pattern, { cwd: root, exclude: (p) => p.includes("node_modules") }),
): LiveFilePartition {
	const files = [...new Set(include.flatMap((pattern) => glob(pattern)))].sort();
	const live: string[] = [];
	const smoke: string[] = [];
	for (const file of files) (isSmokeFile(readFile(file)) ? smoke : live).push(file);
	return { live, smoke };
}

export interface LiveLaneOptions {
	/** Package root; `include` globs are relative to it. */
	root: string;
	/** Candidate live files of the package. */
	include: readonly string[];
	lane?: LiveLane;
}

/**
 * The lane's one hang watchdog for every test and hook, in milliseconds.
 *
 * Vitest's own default (5 s test, 10 s hook) is below what an ordinary live
 * test costs on a loaded runner (sk-jay0.7.254: 3.4-4.3 s passes, one 5006 ms
 * failure), so tests copied a deadline of their own into each file. This value
 * replaces those copies. It is a hang catcher, not a wait: a test still waits
 * on state (`syncConnection`, `agentStep`), never on time, and a test that
 * reaches this deadline has hung. Vitest allows no custom timeout message, so
 * the failure reads `Test timed out in 120000ms`; in a live lane that number
 * names this watchdog (README "One hang watchdog per lane").
 */
export const LIVE_HANG_WATCHDOG_MS = 120_000;

const SETUP_FILE = path.join(import.meta.dirname, "vitest-setup.ts");
const REPORTER_FILE = path.join(import.meta.dirname, "reporter.ts");

/** Vitest `test` options for one lane: file selection, step counter, reporter, hang watchdog. */
export function liveLaneTest(options: LiveLaneOptions) {
	const lane = options.lane ?? laneFromEnv(process.env.SPELLKAVE_LIVE_LANE);
	const { live, smoke } = partitionLiveFiles(options.root, options.include);
	const files = lane === "smoke" ? smoke : live;
	return {
		include: files,
		// A package without playthroughs has an empty smoke lane; that is not an error.
		passWithNoTests: lane === "smoke",
		// Smoke runs serially on its own DB; live files share one DB (one writer per apply).
		fileParallelism: false,
		setupFiles: lane === "smoke" ? [] : [SETUP_FILE],
		reporters: ["default", REPORTER_FILE],
		testTimeout: LIVE_HANG_WATCHDOG_MS,
		hookTimeout: LIVE_HANG_WATCHDOG_MS,
	};
}

export function laneFromEnv(value: string | undefined): LiveLane {
	if (value === undefined || value === "" || value === "live") return "live";
	if (value === "smoke") return "smoke";
	throw new Error(`SPELLKAVE_LIVE_LANE must be "live" or "smoke", got ${JSON.stringify(value)}`);
}
