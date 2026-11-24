// The Vitest globalSetup every behaviour suite runs first (behaviourConfig
// adds it): one run, one result set. It clears the suite's results directory,
// so the guide and the Allure report never mix in an older run, and records
// the commit the run tests. A package's own globalSetup may still call
// `startRun` with a wider set of watched paths; that overwrites run.json.

import { resolve } from "node:path";

import type { TestProject } from "vitest/node";

import { startRun } from "./setup.ts";

export const RESULTS_ENV = "BEHAVIOUR_RESULTS_DIR";

export function setup(project: TestProject): void {
	const root = project.config.root;
	const results = resolve(root, project.config.env[RESULTS_ENV] ?? "behaviour/.results");
	startRun(results, root, ["."]);
}
