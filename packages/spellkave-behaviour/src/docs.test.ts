// Generated documentation preserves the package inventory, evidence and declared constraints.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { expect, it } from "vitest";
import { execFileSyncGit } from "./git-env.ts";
import docs from "../behaviour/docs.config.ts";
import { readmeDrift } from "./docs/checks.ts";
import type { DocsConfig } from "./docs/config.ts";
import { generateGuide } from "./docs/guide.ts";

// keep(K4): README drift gate
it("README.md is what behaviour-docs readme writes", () => {
	expect(readmeDrift(resolve(import.meta.dirname, ".."), docs)).toEqual([]);
});

function withGuideFixture(
	check: (
		render: (options?: { knownLimits?: readonly string[]; transcript?: string }) => {
			guide: string;
			evidence: string;
		},
	) => void,
): void {
	const pkg = mkdtempSync(join(tmpdir(), "behaviour-guide-"));
	const results = join(pkg, "behaviour", ".results");
	const output = join(pkg, "docs");
	const config: DocsConfig = {
		binary: "fixture",
		tagline: "Guide contract fixture",
		commands: () => [{ usage: "fixture read", what: "Read one page" }],
		verbOf: () => "read",
		design: [],
		suite: [],
		watched: [],
	};
	try {
		execFileSyncGit(["init", "--quiet"], { cwd: pkg });
		mkdirSync(results, { recursive: true });
		writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@fixture/guide" }));
		writeFileSync(
			join(pkg, "behaviour", "read.feature"),
			'Feature: Read pages\n  Read what the caller may see.\n\n  Scenario: Read a page\n    When I run "fixture read"\n    Then a page is returned\n',
		);
		writeFileSync(join(results, "run.json"), JSON.stringify({ commit: "abc123", dirty: false }));
		writeFileSync(
			join(results, "read-result.json"),
			JSON.stringify({
				status: "passed",
				start: 1_700_000_000_000,
				fullName: "fixture:behaviour/read.feature#Read a page",
				labels: [
					{ name: "story", value: "Read a page" },
					{ name: "feature", value: "Read pages" },
					{ name: "layer", value: "intent" },
				],
				steps: [
					{
						name: 'When I run "fixture read"',
						attachments: [{ name: "fixture read", type: "text/plain", source: "read.txt" }],
					},
				],
			}),
		);
		check((options = {}) => {
			writeFileSync(
				join(results, "read.txt"),
				options.transcript ?? "$ fixture read\npage returned\n[exit 0]",
			);
			generateGuide(
				pkg,
				{
					...config,
					...(options.knownLimits === undefined ? {} : { knownLimits: options.knownLimits }),
				},
				results,
				output,
			);
			return {
				guide: readFileSync(join(output, "guide.md"), "utf8"),
				evidence: readFileSync(join(output, "scenarios.md"), "utf8"),
			};
		});
	} finally {
		rmSync(pkg, { recursive: true, force: true });
	}
}

// keep(K4): generated guide contract separates author declarations from executed evidence
it("shows author-declared constraints even when every scenario passed", () => {
	withGuideFixture((render) => {
		const { guide, evidence } = render({ knownLimits: ["Pages can change between requests."] });
		expect(guide).toContain("full suite — 1 verified.");
		expect(guide).toContain("### Author-declared constraints");
		expect(guide).toContain(
			"These constraints are declared by the package author; this run does not prove them.",
		);
		expect(guide).toContain("- Pages can change between requests.");
		expect(guide).toContain("### Execution results\n\n- None in this run.");
		expect(guide).not.toContain("Every statement below is a scenario that ran");
		expect(guide).not.toMatch(/not working yet|not run in this run|@planned/);
		expect(evidence).toContain("Status: **verified**");
		expect(evidence).not.toContain("Pages can change between requests.");
		expect(evidence).not.toMatch(/not working yet|not run in this run|@planned/);
	});
});

// keep(K4): optional configuration must preserve existing generated documents byte for byte
it("renders the existing all-pass guide identically for absent and empty known limits", () => {
	withGuideFixture((render) => {
		const original = render();
		expect(render({ knownLimits: [] })).toEqual(original);
		expect(original.guide).toContain(
			"Every statement below is a scenario that ran against the real tool;",
		);
		expect(original.guide).toContain("## Known limits\n\n- None in this run.");
		expect(original.guide).not.toContain("Author-declared constraints");
		const emptyArgv = render({ transcript: "$ fixture \nordinary output\n[exit 0]" });
		expect(emptyArgv.evidence).toContain("  $ fixture\n");
		expect(emptyArgv.evidence).not.toContain("  $ fixture \n");
	});
});

// keep(K4): published transcripts retain executable commands while bounding ordinary output
it("keeps long JSON and cursor commands intact while truncating long output lines", () => {
	withGuideFixture((render) => {
		const jsonCommand = `$ fixture read --json '${JSON.stringify({ query: "q".repeat(450) })}'`;
		const cursorCommand = `$ fixture read --cursor ${"c".repeat(480)}`;
		const output = "o".repeat(450);
		const { evidence } = render({
			transcript: `${jsonCommand}\n${cursorCommand}\n${output}\n[exit 0]`,
		});
		expect(evidence).toContain(jsonCommand);
		expect(evidence).toContain(cursorCommand);
		expect(evidence).toContain(`${"o".repeat(400)} … (50 more characters)`);
		expect(evidence).not.toContain(output);
	});
});

// keep(K4): a multiline command's literal data must survive every transcript cleanup stage
it("preserves quoted and continued command lines before filtering noise, ANSI or long output", () => {
	withGuideFixture((render) => {
		const ansi = `${String.fromCharCode(27)}[31m`;
		const payload = [
			"first  ",
			"",
			"Compiling literal argument",
			`${ansi}literal colour`,
			"x".repeat(450),
			"last  ",
		].join("\n");
		const commands = [
			`$ fixture read '${payload}'`,
			`$ fixture read "${payload}"`,
			`$ fixture read \\\n${"x".repeat(450)}`,
			"$ fixture read escaped\\ ",
		];
		for (const command of commands) {
			const { evidence } = render({
				transcript: `${command}\n${ansi}ordinary output\nCompiling actual build noise\n${"o".repeat(450)}\n[exit 0]`,
			});
			expect(evidence).toContain(
				command
					.split("\n")
					.map((line) => `  ${line}`)
					.join("\n"),
			);
			expect(evidence).toContain("  ordinary output\n");
			expect(evidence).not.toContain(`${ansi}ordinary output`);
			expect(evidence).toContain(`${"o".repeat(400)} … (50 more characters)`);
			expect(evidence).toContain("… 1 lines of build and tool output not shown");
		}
	});
});

// keep(K4): unmatched raw argv punctuation must not disable output cleanup or cross attachment boundaries
it("bounds ordinary output after an unmatched apostrophe in the recorded command", () => {
	withGuideFixture((render) => {
		const ansi = `${String.fromCharCode(27)}[31m`;
		const command = "$ fixture read O'Brien";
		const { evidence } = render({
			transcript: `${command}\n${"o".repeat(450)}\nCompiling actual build noise\n[stderr]\n${ansi}diagnostic'\n[exit 0]`,
		});
		expect(evidence).toContain(command);
		expect(evidence).toContain(`${"o".repeat(400)} … (50 more characters)`);
		expect(evidence).not.toContain("o".repeat(450));
		expect(evidence).not.toContain("Compiling actual build noise");
		expect(evidence).not.toContain(ansi);
		expect(evidence).toContain("diagnostic'");
		expect(evidence).toContain("… 1 lines of build and tool output not shown");
	});
});

// keep(K4): synthetic renderer fixtures pin six document outputs from the pre-change renderer
it("preserves historical applyset, doors and sk-dev rendering without claiming a new live run", () => {
	// Commands are excerpts from the published applyset-scenarios.md, doors-scenarios.md
	// and sk-dev/docs/scenarios.md. Minimal answers are synthetic renderer inputs,
	// not recovered raw receipts. Golden hashes were compared with the original
	// renderer at 066659388d in an external harness; the test needs no Git oracle.
	const fixtures = [
		{
			name: "applyset",
			transcript:
				'$ sk --format jsonl apply world\n{"kind":"error","scope":"usage","message":"usage: sk apply -k <dir> [--prune] [--dry-run] [--force] [--dep <manifest>]..."}\n[exit 1]',
			guide: "09eb59e2a95e1eb5a5d2d62b31eef3cd2dc544c3b09bfca05effa4e8f57bd528",
			evidence: "2dc88be1e47dee35e6d58e3037eddd33cd7a6c797c86e85f0df3c3578da4cfe9",
		},
		{
			name: "doors",
			transcript:
				'$ SPELLKAVE_DEV_BACKEND=local sk --format jsonl --profile door-proof-ada scene\n{"kind":"tool_result","tool":"spellkave_scene","ok":true}\n[exit 0]',
			guide: "6ade692d6c8b74daa316e6912b39a7fdbf8811ddb8049c509d08c4bbc87158a0",
			evidence: "dd3e185e3b874a305ec0b734e9df04876fb0cf970043f262d4b07efa2f635ef7",
		},
		{
			name: "sk-dev",
			transcript: '$ sk dev drop bdd-a\n{"kind":"dev_drop","name":"bdd-a"}\n[exit 0]',
			guide: "5c9fcc65dcfbbd2b3b5e786a852aec04cceaa11945f18d96239a48ffce1bf7b4",
			evidence: "8c92da739b5ef40ec06b925031540a346b686de8d20891f97e8949880b64375e",
		},
	];
	withGuideFixture((render) => {
		for (const fixture of fixtures) {
			const actual = render({ transcript: fixture.transcript });
			for (const doc of ["guide", "evidence"] as const)
				expect(
					createHash("sha256").update(actual[doc]).digest("hex"),
					`${fixture.name} ${doc}`,
				).toBe(fixture[doc]);
		}
	});
});
