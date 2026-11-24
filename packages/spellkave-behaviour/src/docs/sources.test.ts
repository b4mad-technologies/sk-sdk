// A package's README and guide list every unit test with its keep reason, the
// header comment of each design file, and a working link for each @code tag;
// a misread marker or tag would show a reader a wrong reason or a dead link.
// Each case is one rule of that grammar, on files in a temp directory.

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { expect, it } from "vitest";

import { headerComment, locate, unitTests } from "./sources.ts";

function pkg(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "behaviour-sources-"));
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), text);
	}
	return root;
}

// keep(K1): marker grammar — a test's own line wins, a file line covers the rest
it("reads a test's own marker, a file-wide marker, and reports a test with neither", () => {
	const root = pkg({
		"src/a.test.ts": [
			'it("unmarked", () => {});',
			"// keep(K2): needs a TTY",
			'it("own line", () => {});',
			"// open: needs a scenario",
			"it('single quotes don\\'t end early', () => {});",
		].join("\n"),
		"src/b.test.ts": ["// keep-file(K1): rule cases", 'it("covered by the file", () => {});'].join(
			"\n",
		),
	});
	const { tests, missing } = unitTests(root);
	expect(missing).toEqual(['src/a.test.ts:1 "unmarked"']);
	expect(tests).toEqual([
		{
			file: "src/a.test.ts",
			name: "own line",
			verdict: "K2",
			reason: "needs a TTY",
			scope: "test",
		},
		{
			file: "src/a.test.ts",
			name: "single quotes don\\'t end early",
			verdict: "open",
			reason: "needs a scenario",
			scope: "test",
		},
		{
			file: "src/b.test.ts",
			name: "covered by the file",
			verdict: "K1",
			reason: "rule cases",
			scope: "file",
		},
	]);
});

// keep(K1): marker grammar — an it.each title is named by its describe
it("names an it.each case by its describe", () => {
	const root = pkg({
		"src/c.test.ts": [
			'describe("parity", () => {',
			"\t// keep(K5): parity with a script",
			'\tit.each(cases)("%s", () => {});',
			"});",
		].join("\n"),
	});
	expect(unitTests(root).tests.map((t) => t.name)).toEqual(["parity (each case)"]);
});

// keep(K1): comment grammar — line comments, block comments, links and lead-ins
it("turns a header comment into Markdown", () => {
	const root = pkg({
		"src/x/line.ts":
			"#!/usr/bin/env tsx\n// First line.\n//\n// WHY X. See [the doc](../../docs/a.md).\nimport x from 'y';\n",
		"src/block.ts":
			"/**\n * Block {@link Thing} text.\n *\n * STAGES.\n * More.\n */\nexport {};\n",
	});
	expect(headerComment(root, "src/x/line.ts")).toBe(
		"First line.\n\n**WHY X.** See [the doc](docs/a.md).",
	);
	expect(headerComment(root, "src/block.ts")).toBe("Block `Thing` text.\n\n**STAGES.**\nMore.");
});

// keep(K1): spec ID grammar — the heading form, and every tag on either side
it("checks @spec tags against the spec's scenario IDs, both ways", async () => {
	const { specDrift } = await import("./checks.ts");
	const root = pkg({
		"spec.md":
			"#### Scenario: WE-01 Find\n#### Scenario: WE-02 Reuse\n#### Not a scenario: WE-03\n",
		"behaviour/a/x.feature":
			"Feature: x\n  @spec:WE-01 @planned\n  Scenario: one\n  @spec:WE-09\n  Scenario: two\n",
	});
	const config = { specs: ["spec.md"] } as unknown as Parameters<typeof specDrift>[2];
	expect(specDrift(root, root, config)).toEqual([
		"spec scenario WE-02 has no @spec:WE-02 scenario",
		"@spec:WE-09 names no scenario in spec.md",
	]);
});

// keep(K1): scope rule — a suite's subfolder alone, for features, hash and spec tags
it("reads one suite of several when a scope is given", async () => {
	const { expectNoSpecDrift } = await import("./checks.ts");
	const { featureFiles, featuresHash } = await import("./sources.ts");
	const root = pkg({
		"spec.md": "#### Scenario: WE-01 Find\n",
		"behaviour/exploration/a.feature": "Feature: a\n  @spec:WE-01\n  Scenario: one\n",
		"behaviour/other/b.feature": "Feature: b\n  @spec:XX-09\n  Scenario: two\n",
	});
	expect(featureFiles(root, "exploration").map((f) => f.slice(root.length))).toEqual([
		"/behaviour/exploration/a.feature",
	]);
	expect(featuresHash(root, "exploration")).not.toBe(featuresHash(root));
	expect(() =>
		expectNoSpecDrift(root, ["spec.md"], { scope: "exploration", repo: root }),
	).not.toThrow();
	expect(() => expectNoSpecDrift(root, ["spec.md"], { repo: root })).toThrow(/XX-09/);
});

// keep(K1): code-tag grammar — a tag without a symbol names the file
it("links a @code tag without a symbol to its file, labelled by the file name", () => {
	const root = pkg({ "src/bin/tool.ts": "const player = process.argv[2];\n" });
	expect(locate(root, "src/bin/tool.ts")).toEqual({
		path: "src/bin/tool.ts",
		symbol: "tool.ts",
		line: 1,
	});
	expect(locate(root, "src/bin/missing.ts")).toEqual({
		error: "src/bin/missing.ts: no file src/bin/missing.ts",
	});
});
