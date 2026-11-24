// `behaviour-docs readme|guide [<package dir>]`: write a package's README.md
// (offline) or its docs/guide.md and docs/scenarios.md (from the last run's
// results in behaviour/.results) and the README that quotes the guide. The
// package dir defaults to the cwd, which
// is what `pnpm --filter <pkg> readme` gives.

import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { loadDocsConfig } from "./config.ts";
import { generateGuide } from "./guide.ts";
import { renderReadme } from "./readme.ts";
import { generateReport } from "./report.ts";

export async function main(argv: readonly string[]): Promise<number> {
	const at = argv.indexOf("--scope");
	const scope = at >= 0 ? argv[at + 1] : undefined;
	const [command, dir] = argv.filter(
		(arg, i) => arg !== "--open" && (at < 0 || (i !== at && i !== at + 1)),
	);
	const pkg = resolve(dir ?? process.cwd());
	const config = await loadDocsConfig(pkg, scope);
	if (command === "readme") {
		if (config.readme === false) {
			process.stdout.write(
				"behaviour-docs: README.md is hand-written here (readme: false); left alone\n",
			);
			return 0;
		}
		writeFileSync(join(pkg, "README.md"), renderReadme(pkg, config));
		process.stdout.write("behaviour-docs: README.md written\n");
		return 0;
	}
	if (command === "guide") {
		const written = generateGuide(pkg, config);
		// The README quotes the guide's run line, so it is rewritten with it.
		if (config.readme !== false) writeFileSync(join(pkg, "README.md"), renderReadme(pkg, config));
		const names = `${config.docs?.guide ?? "guide.md"} ${written.guide} lines, ${config.docs?.evidence ?? "scenarios.md"} ${written.scenarios} lines`;
		process.stdout.write(
			`behaviour-docs: ${names}${config.readme === false ? "" : ", README.md"}\n`,
		);
		return 0;
	}
	if (command === "report") return generateReport(pkg, config, argv.includes("--open"));
	process.stderr.write(
		"Usage: behaviour-docs readme|guide|report [<package dir>] [--scope <suite>] [--open]\n",
	);
	return 1;
}

// Run directly (this package's own `readme` script); the bin launcher imports `main`.
if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
	process.exitCode = await main(process.argv.slice(2));
}
