import { defineConfig } from "vitest/config";
import { LIVE_NODE_TEST_TIMEOUT_MS } from "../../scripts/ci/live-vitest-timeout.mts";

// Live tests share one freshly seeded database. Manifest applies drain
// globally, so independent test files must not write that node concurrently.
// Keep offline unit tests at Vitest's default parallelism.
const liveNode = process.env.SPELLKAVE_LOCAL_NODE === "1";
// `scripts/test-live.sh` sets the lane: the scene-live run counts steps per test,
// refuses clock/turn advances outside `// live-phase: final` files and reports
// each test's duration and steps. The kernel-live files run without it.
const liveLane = process.env.SPELLKAVE_LIVE_LANE === "live";

export default defineConfig({
	test: {
		fileParallelism: liveNode ? false : undefined,
		testTimeout: liveNode ? LIVE_NODE_TEST_TIMEOUT_MS : undefined,
		setupFiles: liveLane ? ["src/vitest-setup.ts"] : [],
		reporters: [
			...(liveLane ? ["default", "./src/reporter.ts"] : ["default"]),
		],
	},
});
