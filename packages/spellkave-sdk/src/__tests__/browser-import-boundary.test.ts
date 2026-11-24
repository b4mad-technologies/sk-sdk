// Browser import boundary for the `@spellkave/sdk` package.
//
// The dev-server blank-screen bug (PR #1237): the four core modules
// (`credential`, `paths`, `profile`, `resolve`) imported `node:fs`/`os`/`path`
// at the top level. They are re-exported from the root barrel, so Vite's dev
// pre-bundler pulled `node:fs` through `@spellkave/web` -> `@spellkave/sdk` and
// externalized it into a shim that throws at module-eval -- blanking
// `world-admin` and `world-author`. (`vite build` tree-shook them out, so the
// crash was dev-only and easy to miss.)
//
// This test walks the transitive import graph from every browser-facing entry
// and asserts that NO reachable module imports a `node:*` builtin, and that the
// Node-only `core/node-io.ts` (the single legitimate `node:*` touchpoint) is
// never reachable from those entries. Mirrors
// `apps/world-review/src/import-boundary.test.ts` in spirit, but follows the
// graph rather than scanning a single directory.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Entries `@spellkave/web` and replay/browser bundles can pull.
const BROWSER_ENTRIES = ["index.ts", "readers.ts", "replay.ts"].map((f) => resolve(srcDir, f));
const NODE_ONLY_MODULE = resolve(srcDir, "core/node-io.ts");

function fromSpecifiers(source: string): string[] {
	return [...source.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/g)].map(
		(m) => m[1] ?? "",
	);
}

function resolveRelative(fromFile: string, spec: string): string | undefined {
	const base = resolve(dirname(fromFile), spec);
	for (const candidate of [base, `${base}.ts`, `${base}/index.ts`]) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

interface Walk {
	reachable: Set<string>;
	nodeImports: string[]; // "<file>: node:<x>"
}

function walk(entries: string[]): Walk {
	const reachable = new Set<string>();
	const nodeImports: string[] = [];
	const queue = [...entries];
	while (queue.length > 0) {
		// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
		const file = queue.pop()!;
		if (reachable.has(file)) continue;
		reachable.add(file);
		const source = readFileSync(file, "utf8");
		for (const spec of fromSpecifiers(source)) {
			if (spec.startsWith("node:")) {
				nodeImports.push(`${file.replace(srcDir, "src")}: ${spec}`);
			} else if (spec.startsWith(".")) {
				const target = resolveRelative(file, spec);
				if (target !== undefined) queue.push(target);
			}
			// bare specifiers (spacetimedb, @spellkave/bindings, smol-toml) are external
		}
	}
	return { reachable, nodeImports };
}

describe("@spellkave/sdk browser import boundary", () => {
	const result = walk(BROWSER_ENTRIES);

	it("no module reachable from a browser entry imports a node:* builtin", () => {
		expect(result.nodeImports).toEqual([]);
	});

	it("the Node-only core/node-io.ts is not reachable from any browser entry", () => {
		expect(result.reachable.has(NODE_ONLY_MODULE)).toBe(false);
	});
});
