import { liveLaneTest } from "@spellkave/test-lab/lanes";
import { defineConfig } from "vitest/config";

// `pnpm test:live`: the live lane counts steps per test, refuses clock and
// turn advances outside `// live-phase: final` files and reports each test's duration and steps.
export default defineConfig({
	test: liveLaneTest({
		root: import.meta.dirname,
		include: ["src/live/**/*.live.test.ts"],
		lane: "live",
	}),
});
