/**
 * Duration and step-count reporter for live lanes (design D-5, task 3.4).
 *
 * Measurement, not a gate: it prints one line per test with its wall time and
 * the step counts the setup file recorded, and a warning line for every test
 * slower than {@link SLOW_TEST_WARN_MS}. It never fails a run. Whether the
 * budget becomes binding is a later decision made with the pilot's numbers.
 */
import path from "node:path";
import type { Reporter, TestCase } from "vitest/node";

export const SLOW_TEST_WARN_MS = 5_000;

export interface StepReportRow {
	file: string;
	test: string;
	durationMs: number;
	steps: Record<string, number>;
	state: string;
}

export function formatStepReport(rows: readonly StepReportRow[]): string[] {
	const lines: string[] = [];
	for (const row of rows) {
		const total = Object.values(row.steps).reduce((a, b) => a + b, 0);
		const kinds = Object.entries(row.steps)
			.map(([kind, n]) => `${kind}=${n}`)
			.join(" ");
		lines.push(
			`[test-lab] ${row.state} ${row.durationMs.toFixed(0)}ms steps=${total}${kinds ? ` (${kinds})` : ""} ${row.file} > ${row.test}`,
		);
	}
	for (const row of rows) {
		if (row.durationMs > SLOW_TEST_WARN_MS) {
			lines.push(
				`[test-lab] WARN slow live test (${row.durationMs.toFixed(0)}ms > ${SLOW_TEST_WARN_MS}ms): ${row.file} > ${row.test}`,
			);
		}
	}
	const total = rows.reduce((sum, row) => sum + row.durationMs, 0);
	lines.push(`[test-lab] ${rows.length} test(s), ${total.toFixed(0)}ms summed test time`);
	return lines;
}

export default class TestLabStepReporter implements Reporter {
	private readonly rows: StepReportRow[] = [];

	onTestCaseResult(testCase: TestCase): void {
		const result = testCase.result();
		if (result.state === "skipped" || result.state === "pending") return;
		this.rows.push({
			file: path.relative(process.cwd(), testCase.module.moduleId),
			test: testCase.fullName,
			durationMs: testCase.diagnostic()?.duration ?? 0,
			steps: testCase.meta().testLabSteps ?? {},
			state: result.state,
		});
	}

	onTestRunEnd(): void {
		if (this.rows.length === 0) return;
		for (const line of formatStepReport(this.rows)) console.log(line);
	}
}
