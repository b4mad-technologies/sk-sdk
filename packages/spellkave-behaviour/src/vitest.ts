// The Vitest configuration of a behaviour suite: Gherkin files run through
// QuickPickle, results go to Allure's result format (read by the guide
// generator and by `behaviour-docs report`). Every run starts by clearing the
// suite's results (global-setup.ts), so no older run leaks into the documents.
// Feature files run one after another unless the suite says its scenarios
// share nothing.

import { fileURLToPath } from "node:url";

import { quickpickle } from "quickpickle";
import { configDefaults, type ViteUserConfig } from "vitest/config";
import type { InlineConfig } from "vitest/node";

import { nestedScopes } from "./docs/sources.ts";
import { RESULTS_ENV } from "./global-setup.ts";

export interface BehaviourConfigOptions {
	/** Step modules, after the narration hooks (package-relative). */
	readonly steps: readonly string[];
	/** Runs after the built-in setup that clears the results. */
	readonly globalSetup?: readonly string[];
	readonly env?: Record<string, string>;
	/** Tags that skip a scenario in this run, besides `@skip`. */
	readonly skipTags?: readonly string[];
	/** QuickPickle's own default is 3 s per step. */
	readonly stepTimeout?: number;
	readonly testTimeout?: number;
	readonly hookTimeout?: number;
	/** One suite's subfolder of behaviour/ (see DocsConfig.scope); its results go there too. */
	readonly scope?: string;
	/** Feature files in parallel: only for suites whose scenarios share nothing. */
	readonly parallel?: boolean;
}

export const RESULTS = "behaviour/.results";

/** A suite's results directory, package-relative. */
export const resultsPath = (scope?: string) => (scope ? `behaviour/${scope}/.results` : RESULTS);

const CLEAR_RESULTS = fileURLToPath(new URL("./global-setup.ts", import.meta.url));

export function behaviourConfig(options: BehaviourConfigOptions): ViteUserConfig {
	const results = resultsPath(options.scope);
	const config = {
		plugins: [
			// QuickPickle's types resolve the workspace's hoisted vite, which can be a
			// newer major than the one vitest runs on; the plugin works with both.
			quickpickle({
				stepTimeout: options.stepTimeout ?? 60_000,
				skipTags: ["@skip", ...(options.skipTags ?? [])],
			}) as unknown as NonNullable<ViteUserConfig["plugins"]>[number],
		],
		test: {
			include: [
				options.scope ? `behaviour/${options.scope}/**/*.feature` : "behaviour/**/*.feature",
			],
			// A subfolder with its own docs.config.ts is a separate suite (sources.ts).
			exclude: [
				...configDefaults.exclude,
				...(options.scope ? [] : nestedScopes(process.cwd()).map((name) => `behaviour/${name}/**`)),
			],
			globalSetup: [CLEAR_RESULTS, ...(options.globalSetup ?? [])],
			setupFiles: ["allure-vitest/setup", "@spellkave/behaviour/narrate", ...options.steps],
			env: { ...options.env, [RESULTS_ENV]: results },
			testTimeout: options.testTimeout ?? 120_000,
			hookTimeout: options.hookTimeout ?? 120_000,
			fileParallelism: options.parallel ?? false,
			reporters: [
				"default",
				[
					"allure-vitest/reporter",
					// No expect(...) sub-steps: the results should read as the Gherkin sentences.
					{ resultsDir: results, reportMatchers: false },
				],
			],
		} satisfies InlineConfig,
	};
	// Typed through vitest's own InlineConfig: whether vite's UserConfig knows
	// `test` depends on which vite the importing package resolves.
	return config as ViteUserConfig;
}
