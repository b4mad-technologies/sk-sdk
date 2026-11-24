// The Allure 3 HTML report of the last behaviour run, for people who want to
// click through scenarios, steps and transcripts. The results are the same
// files the guide is generated from; nothing is re-run. The report is a
// local, disposable view (behaviour/<scope>/.report, gitignored); the guide
// and the evidence stay the committed documents.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DocsConfig } from "./config.ts";
import { featuresDir, resultsDir } from "./sources.ts";

/** Where `report` writes the HTML: next to the suite's results. */
export const reportDir = (pkg: string, scope?: string) => join(featuresDir(pkg, scope), ".report");

/** Generate the report; `open` serves it in the browser afterwards. Returns the exit code. */
export function generateReport(pkg: string, config: DocsConfig, open = false): number {
	const results = resultsDir(pkg, config.scope);
	if (!existsSync(results)) {
		process.stderr.write(
			`behaviour-docs: no results at ${results}; run the behaviour suite first\n`,
		);
		return 1;
	}
	// The allure package exports no subpath for its CLI; run this package's bin link.
	const allure = fileURLToPath(new URL("../../node_modules/.bin/allure", import.meta.url));
	const out = reportDir(pkg, config.scope);
	const run = spawnSync(
		allure,
		[
			"generate",
			results,
			"--output",
			out,
			"--report-name",
			config.title ?? config.binary,
			...(open ? ["--open"] : []),
		],
		{ stdio: "inherit" },
	);
	if (run.status === 0 && !open)
		process.stdout.write(`behaviour-docs: report in ${join(out, "index.html")}\n`);
	return run.status ?? 1;
}
