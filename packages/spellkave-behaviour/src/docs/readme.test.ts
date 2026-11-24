// Parallel README edits must compose without regenerating a shared total.
// Exercise Git's three-way merge and the same drift check consumers run.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { execFileSyncGit } from "../git-env.ts";
import { readmeDrift } from "./checks.ts";
import type { DocsConfig } from "./config.ts";
import { renderReadme } from "./readme.ts";

// keep(K4): merged generated inventories must pass the consumer's drift gate while stale rows still fail
it("accepts two branches adding independent kept rows and rejects missing or changed rows", () => {
	const root = mkdtempSync(join(tmpdir(), "behaviour-readme-merge-"));
	const config: DocsConfig = {
		binary: "fixture",
		tagline: "README merge fixture",
		commands: () => [],
		verbOf: (command) => command,
		design: [],
		suite: [],
		watched: [],
	};
	const addTest = (name: string) =>
		writeFileSync(
			join(root, "src", `${name}.test.ts`),
			`// keep(K1): rule for ${name}\nit("${name}", () => {});\n`,
		);
	const render = (name: string) => {
		const path = join(root, name);
		writeFileSync(path, renderReadme(root, config));
		return path;
	};
	try {
		mkdirSync(join(root, "src"));
		writeFileSync(
			join(root, "package.json"),
			JSON.stringify({ name: "@fixture/merge", scripts: { test: "vitest run" } }),
		);
		// Separate insertion points keep the fixture focused on the shared total.
		for (const name of ["a", "m", "z"]) addTest(name);
		const base = render("base.md");
		addTest("b");
		const left = render("left.md");
		rmSync(join(root, "src/b.test.ts"));
		addTest("y");
		const right = render("right.md");
		addTest("b");
		const merged = execFileSyncGit(["merge-file", "-p", left, base, right], { cwd: root });
		const readme = join(root, "README.md");
		writeFileSync(readme, merged);
		expect(merged).toContain("| b |");
		expect(merged).toContain("| y |");
		expect(readmeDrift(root, config)).toEqual([]);
		// Keeping the merged README but losing a row must still trip the gate.
		writeFileSync(readme, merged.replace(/^\| b \|.*\n/m, ""));
		expect(readmeDrift(root, config)).toEqual([
			"README.md is stale: run `pnpm --filter @fixture/merge readme`",
		]);
		writeFileSync(readme, merged);
		const source = join(root, "src/y.test.ts");
		writeFileSync(source, readFileSync(source, "utf8").replace("rule for y", "revised reason"));
		expect(readmeDrift(root, config)).toHaveLength(1);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
