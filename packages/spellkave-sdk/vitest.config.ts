import { defineConfig } from "vitest/config";

// SDK live tests share one freshly seeded database. Manifest applies drain
// globally, so independent test files must not write that node concurrently.
// Keep offline unit tests at Vitest's default parallelism.
const liveNode = process.env.SPELLKAVE_LOCAL_NODE === "1";

export default defineConfig({
	test: {
		fileParallelism: liveNode ? false : undefined,
	},
});
