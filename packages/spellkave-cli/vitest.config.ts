// The unit tests of `sk` (`pnpm test`): every test file vitest finds by its
// default pattern. The *.live.test.ts files are included but skip without a
// node; `sk spire check @spellkave/cli test` shows which CI step runs each.
// The live-delta journal is off here: suites that drive `sk --live
// apply_manifest_delta` through a fake connector would otherwise write real
// files under .local/live-deltas/. live.test.ts turns it on in a temp dir.
import { defineConfig } from "vitest/config";
import { LIVE_NODE_TEST_TIMEOUT_MS } from "../../scripts/ci/live-vitest-timeout.mts";

export default defineConfig({
	test: {
		testTimeout: process.env.SPELLKAVE_LOCAL_NODE === "1" ? LIVE_NODE_TEST_TIMEOUT_MS : undefined,
		env: {
			SPELLKAVE_LIVE_DELTA_JOURNAL: "0",
		},
	},
});
