import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceRoot = join(packageRoot, "src");
const forbidden = [
	"node:",
	"@spellkave/sdk",
	"spacetimedb",
	"@spellkave/companion-agent",
	"@modelcontextprotocol/",
	"@spellkave/agent-observability",
	"@spellkave/world-map",
];

function productionSources(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSources(path);
		return entry.name.endsWith(".ts") ? [readFileSync(path, "utf8")] : [];
	});
}

function importSpecifiers(source: string): string[] {
	return [
		...source.matchAll(/\b(?:import|export)\s+(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/g),
	].map((match) => match[1] ?? "");
}

describe("Pi adapter dependency boundary", () => {
	it("is Pi-only and imports no host implementation", () => {
		const imports = productionSources(sourceRoot).flatMap(importSpecifiers);
		for (const token of forbidden)
			expect(imports.some((specifier) => specifier.includes(token))).toBe(false);
		const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
		};
		expect(manifest.dependencies).toEqual({
			"@spellkave/tool-contracts": "workspace:*",
			"@spellkave/tool-runtime": "workspace:*",
		});
	});
});
