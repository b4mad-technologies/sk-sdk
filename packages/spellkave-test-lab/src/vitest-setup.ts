/**
 * Vitest setup file for opted-in live lanes (wired by `liveTestConfig`).
 *
 * Starts the per-test step budget (`steps.ts`) before each test and stops it
 * after. The step counts land in `task.meta.testLabSteps`, where the test-lab
 * reporter (`reporter.ts`) reads them.
 */
import { afterEach, beforeEach } from "vitest";
import { beginStepBudget, endStepBudget, stepCounts } from "./steps";

declare module "vitest" {
	interface TaskMeta {
		testLabSteps?: Record<string, number>;
	}
}

beforeEach(({ task }) => {
	beginStepBudget(task.name, task.file?.filepath);
});

afterEach(({ task }) => {
	task.meta.testLabSteps = { ...stepCounts() };
	endStepBudget();
});
