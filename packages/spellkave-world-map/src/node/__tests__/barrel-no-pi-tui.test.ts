// The hosted PLAYER MCP gateway loads `@spellkave/world-map/node` from a
// production deploy without the optional pi-tui peer; one static pi-tui import
// reachable from that barrel breaks `spellkave_map` for every output type.
// Terminal helpers stay behind `node/terminal.ts`. Reads the source files only.
// keep-file(K4): a static import-graph drift gate, not runtime behaviour (#2468)
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const nodeDir = resolve(here, "..");

function staticImports(file: string): string[] {
	const src = readFileSync(file, "utf8");
	const specs: string[] = [];
	for (const m of src.matchAll(/^(?:import|export)[^;]*?from\s+["']([^"']+)["']/gms)) {
		const spec = m[1];
		if (spec !== undefined) specs.push(spec);
	}
	return specs;
}

function resolveLocal(fromFile: string, spec: string): string | null {
	const base = resolve(dirname(fromFile), spec);
	if (existsSync(base) && extname(base)) return base;
	for (const ext of [".ts", ".tsx", ".js", ".mjs"]) {
		const candidate = base.endsWith(ext) ? base : `${base}${ext}`;
		if (existsSync(candidate)) return candidate;
	}
	return null;
}

function reachableLocalFiles(entry: string, seen = new Set<string>()): Set<string> {
	if (seen.has(entry)) return seen;
	seen.add(entry);
	for (const spec of staticImports(entry)) {
		if (!spec.startsWith(".")) continue;
		const next = resolveLocal(entry, spec);
		if (next) reachableLocalFiles(next, seen);
	}
	return seen;
}

describe("@spellkave/world-map/node barrel", () => {
	it("never statically imports @earendil-works/pi-tui (optional peer, absent in prod deploys)", () => {
		const files = reachableLocalFiles(join(nodeDir, "index.ts"));
		const offenders = [...files].filter((f) =>
			staticImports(f).some((s) => s.startsWith("@earendil-works/pi-tui")),
		);
		expect(offenders).toEqual([]);
	});

	it("keeps the terminal entry as the only pi-tui importer", () => {
		const files = reachableLocalFiles(join(nodeDir, "terminal.ts"));
		expect([...files].some((f) => f.endsWith("terminal-capabilities.ts"))).toBe(true);
	});
});
