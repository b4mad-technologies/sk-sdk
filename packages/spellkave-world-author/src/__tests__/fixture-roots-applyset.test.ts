// ADR-0145 D-1: every seedable fixture root names its applyset, so
// `sk dev seed`/`up` (r_apply_bundle) can apply it. A seedable root is a file
// under packages/<pkg>/fixtures*/ named `manifest.toml`, `*.manifest.toml` or
// `*.proof.toml`. Live deltas and migrations are partial applies, not roots
// of an applyset; they are excluded.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = resolve(import.meta.dirname, "../../../..");
const EXCLUDED_DIRS = new Set(["live-deltas", "migrations", "node_modules", ".check-tmp"]);
const FIXTURE_DIR = resolve(REPO, "packages/spellkave-cli/src/__tests__/fixtures");
const IS_ROOT = /(^manifest\.toml$|\.manifest\.toml$|\.proof\.toml$)/;

function walk(dir: string, out: string[]): void {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (!EXCLUDED_DIRS.has(name)) walk(path, out);
		} else if (IS_ROOT.test(name)) {
			out.push(path);
		}
	}
}

function fixtureRoots(): string[] {
	const roots: string[] = [];
	const packages = join(REPO, "packages");
	for (const pkg of readdirSync(packages)) {
		const pkgDir = join(packages, pkg);
		if (!statSync(pkgDir).isDirectory()) continue;
		for (const entry of readdirSync(pkgDir)) {
			if (entry.startsWith("fixtures") && statSync(join(pkgDir, entry)).isDirectory()) {
				walk(join(pkgDir, entry), roots);
			}
		}
	}
	walk(FIXTURE_DIR, roots);
	return roots.map((path) => relative(REPO, path)).sort();
}

describe("fixture roots declare an applyset (ADR-0145)", () => {
	const roots = fixtureRoots();

	it("finds the seedable roots", () => {
		expect(roots).toContain("packages/spellkave-cli/src/__tests__/fixtures/catalog/manifest.toml");
	});

	it("every root declares a top-level applyset", () => {
		const missing = roots.filter(
			(path) =>
				!/^applyset = "[a-z0-9][a-z0-9._-]*"$/m.test(readFileSync(join(REPO, path), "utf8")),
		);
		expect(missing).toEqual([]);
	});

	it("applyset names are unique across roots", () => {
		const byName = new Map<string, string[]>();
		for (const path of roots) {
			const name = /^applyset = "([^"]+)"$/m.exec(readFileSync(join(REPO, path), "utf8"))?.[1];
			if (name !== undefined) byName.set(name, [...(byName.get(name) ?? []), path]);
		}
		const clashes = [...byName].filter(([, paths]) => paths.length > 1);
		expect(clashes).toEqual([]);
	});
});
