// keep-file(K1): cases over the pure argv helper; the play-test live suite runs
// `sk apply -k` on a dependent root end to end (sk-jay0.3.26.28).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { withConfiguredDependencies } from "../cli.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** base <- rules <- adventure, each a root in its own folder. */
function chain(): { root: string; deps: Record<string, string> } {
	const dir = mkdtempSync(join(tmpdir(), "sk-applyset-deps-"));
	dirs.push(dir);
	const write = (id: string, deps: string[]) => {
		mkdirSync(join(dir, id));
		writeFileSync(
			join(dir, id, "manifest.toml"),
			[
				["#:schema https://spellkave.dev/", "schema/world-manifest-1.0.0.json"].join(""),
				'schema_version = "1.0.0"',
				`applyset = "${id}"`,
				"[[bundles]]",
				`bundle_id = "${id}"`,
				`display_name = "${id}"`,
				'author = "t"',
				'version = "1"',
				`depends_on = [${deps.map((d) => `"${d}"`).join(", ")}]`,
				"",
			].join("\n"),
		);
		return join(dir, id, "manifest.toml");
	};
	const base = write("base", []);
	const rules = write("rules", ["base"]);
	write("adventure", ["rules"]);
	return { root: join(dir, "adventure"), deps: { base, rules } };
}

const verb = (dir: string, ...flags: string[]) => ({
	verb: "apply" as const,
	tool: "applyset_apply" as const,
	argv: ["--dir", dir, ...flags],
});

describe("sk apply -k without --dep (sk-jay0.3.26.28)", () => {
	it("adds the configured dependency closure, dependencies first", () => {
		const { root, deps } = chain();
		expect(withConfiguredDependencies(verb(root, "--prune"), deps).argv).toEqual([
			"--dir",
			root,
			"--prune",
			"--dep",
			deps.base,
			"--dep",
			deps.rules,
		]);
	});

	it("keeps an explicit --dep untouched", () => {
		const { root, deps } = chain();
		const explicit = verb(root, "--dep", "/elsewhere/manifest.toml");
		expect(withConfiguredDependencies(explicit, deps)).toBe(explicit);
	});

	it("leaves the argv unchanged when the map cannot resolve the closure", () => {
		const { root, deps } = chain();
		const partial = { rules: deps.rules ?? "" };
		expect(withConfiguredDependencies(verb(root), partial).argv).toEqual(["--dir", root]);
	});
});
