// Render a package's README.md offline, in about a second, from what the
// package is:
//
//   behaviour/docs.config.ts  the commands (from the package's own schema or
//                             usage text) and which files carry the design
//   behaviour/**/*.feature    what the package promises, tested from outside
//   docs/guide.md             the header line of the last behaviour run
//   source header comments    the design: why each part is the way it is
//   unit-test annotations     which unit tests stay, and why
//   package.json              how to run the tests
//
// Nothing in the README is written by hand. To change a sentence, change its
// source; the package's docs drift test fails when the README differs.
// The kept inventory has no shared total: independent row additions can merge
// without leaving a stale count (proved in readme.test.ts).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { DocsConfig } from "./config.ts";
import { featureOutlines, headerComment, type UnitTest, unitTests } from "./sources.ts";

export const K_RULES: Record<string, string> = {
	K1: "one of several cases over a pure function",
	K2: "a branch the public surface cannot provoke without an injected host, process, fault or TTY",
	K3: "a cross-run invariant (determinism, idempotence, ordering)",
	K4: "a compile proof, snapshot or documentation drift gate",
	K5: "a contract with another tool the suite does not drive (shell scripts, shared file formats)",
};

// GitHub's heading anchors: lowercase, drop punctuation except - and _, spaces to -.
export const anchor = (text: string) =>
	text
		.toLowerCase()
		.replace(/[^a-z0-9 _-]/g, "")
		.trim()
		.replace(/\s/g, "-");

const cell = (text: string) => text.replaceAll("|", "\\|");

function commands(pkg: string, config: DocsConfig): string[] {
	const rows = config.commands();
	const replaces = rows.some((r) => r.replaces !== undefined);
	return [
		replaces
			? `| Command | What it does | ${config.replacesTitle ?? "Replaces"} |`
			: "| Command | What it does |",
		replaces ? "|---|---|---|" : "|---|---|",
		...rows.map(
			(r) =>
				`| \`${cell(r.usage)}\` | ${cell(r.what)} |${replaces ? ` ${r.replaces || "—"} |` : ""}`,
		),
		"",
		...(config.commandsNote ? [config.commandsNote, ""] : []),
		...(existsSync(join(pkg, "docs/guide.md"))
			? [
					"How it answers and fails, with real records, is in [the guide](docs/guide.md#how-it-answers).",
				]
			: []),
	];
}

function behaviour(pkg: string, config: DocsConfig): string[] {
	const guidePath = join(pkg, "docs/guide.md");
	const guide = existsSync(guidePath) ? readFileSync(guidePath, "utf8") : "";
	const run = guide.match(/^Run: .*$/m)?.[0] ?? "Run: none recorded yet.";
	const outlines = featureOutlines(pkg, config.features, config.scope);
	const total = outlines.reduce((n, f) => n + f.scenarios.length, 0);
	const lines = [
		`What \`${config.title ?? config.binary}\` does is described and tested from the outside: ${total} scenarios in [\`behaviour/\`](behaviour/) drive the real tool. The last run produced [\`docs/guide.md\`](docs/guide.md) (short, for people and agents) and [\`docs/scenarios.md\`](docs/scenarios.md) (every scenario with its transcripts).`,
		"",
		run,
		"",
	];
	if (!outlines.length)
		return [
			"No behaviour scenarios yet: the package is tested by its unit tests and by the suites that use it.",
		];
	for (const f of outlines) {
		lines.push(
			`- **[${f.title}](docs/scenarios.md#${anchor(f.title)})** — ${f.scenarios.length} scenarios`,
		);
		for (const rule of f.rules) lines.push(`  - ${rule}.`);
	}
	return lines;
}

const headers = (pkg: string, paths: readonly string[], heading: (path: string) => string) =>
	paths.flatMap((path) => [heading(path), "", headerComment(pkg, path), ""]);

function unitTestSection(pkg: string): string[] {
	const { tests, missing } = unitTests(pkg);
	if (missing.length) {
		throw new Error(
			`unit tests without a "// keep(K…): …" or "// open: …" line above them:\n  ${missing.join("\n  ")}`,
		);
	}
	const kept = tests.filter((t) => t.verdict !== "open");
	const open = tests.filter((t) => t.verdict === "open");
	const row = (t: UnitTest) =>
		`| ${cell(t.name)} | [\`${t.file.split("/").at(-1)}\`](${t.file}) | ${t.verdict === "open" ? "" : `${t.verdict}: `}${cell(t.reason)} |`;
	// A file-wide reason is one row: "all N tests".
	const keptRows: string[] = [];
	const files = new Set<string>();
	for (const t of kept) {
		if (t.scope === "test") keptRows.push(row(t));
		else if (!files.has(t.file)) {
			files.add(t.file);
			const n = kept.filter((k) => k.file === t.file && k.scope === "file").length;
			keptRows.push(row({ ...t, name: `all ${n} tests in the file` }));
		}
	}
	return [
		"A unit test stays only for what the behaviour suite cannot reach. The line above each test says why (`// keep(K…): …`, or one `// keep-file(K…): …` line for a whole file), or names the scenario it still lacks (`// open: …`).",
		"",
		...Object.entries(K_RULES).map(([k, text]) => `- **${k}** ${text}`),
		"",
		"**Kept**",
		"",
		"| Test | File | Why it stays |",
		"|---|---|---|",
		...keptRows,
		"",
		`**Open (${open.length})**: reachable from outside; each goes once a scenario covers it.`,
		"",
		...(open.length
			? ["| Test | File | Missing scenario |", "|---|---|---|", ...open.map(row)]
			: ["None."]),
	];
}

function running(pkg: string): string[] {
	const json = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
	const scripts = Object.keys(json.scripts as Record<string, string>);
	const width = Math.max(...scripts.map((s) => s.length));
	return [
		"```bash",
		...scripts.map((s) => `pnpm --filter ${json.name} ${s.padEnd(width)}  # ${json.scripts[s]}`),
		"```",
	];
}

export function renderReadme(pkg: string, config: DocsConfig): string {
	const json = JSON.parse(readFileSync(join(pkg, "package.json"), "utf8"));
	const lines = [
		`<!-- Generated by @spellkave/behaviour (behaviour-docs readme); do not edit. Change the source it names and run \`pnpm --filter ${json.name} readme\`. -->`,
		"",
		`# ${json.name}`,
		"",
		`> \`${config.title ?? config.binary}\` — ${config.tagline}`,
		"",
		"## Commands",
		"",
		...commands(pkg, config),
		"",
		...(config.readmeSections?.() ?? []).flatMap((section) => [
			`## ${section.title}`,
			"",
			...section.lines,
			"",
		]),
		"## What it promises",
		"",
		...behaviour(pkg, config),
		"",
		"## Design",
		"",
		"Each part's header comment, as written next to the code.",
		"",
		...headers(pkg, config.design, (path) => `### [\`${path}\`](${path})`),
		"## Behaviour suite",
		"",
		...headers(pkg, config.suite, (path) => `From [\`${path}\`](${path}):`),
		"## Unit tests",
		"",
		...unitTestSection(pkg),
		"",
		"## Run",
		"",
		...running(pkg),
		"",
	];
	return `${lines
		.map((l) => l.trimEnd())
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trimEnd()}\n`;
}
