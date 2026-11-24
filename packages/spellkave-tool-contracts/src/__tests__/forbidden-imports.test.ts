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
	"@earendil-works/pi",
	"@modelcontextprotocol/",
	"@spellkave/companion-agent",
	"@spellkave/agent-observability",
	"@spellkave/world-map",
	"test-helper",
];

function productionSources(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSources(path);
		return entry.name.endsWith(".ts") ? [readFileSync(path, "utf8")] : [];
	});
}

function importSpecifiers(source: string): string[] {
	const staticImports = [
		...source.matchAll(/\b(?:import|export)\s+(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/g),
	].map((match) => match[1]);
	const dynamicImports = [...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)].map(
		(match) => match[1],
	);
	return [...staticImports, ...dynamicImports];
}

describe("production dependency boundary", () => {
	it("has no forbidden production import or package dependency", () => {
		const imports = productionSources(sourceRoot).flatMap(importSpecifiers);
		for (const token of forbidden) {
			expect(imports.some((specifier) => specifier.includes(token))).toBe(false);
		}
		const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
			dependencies?: Record<string, string>;
			exports?: Record<string, { types?: string; default?: string }>;
		};
		expect(manifest.dependencies).toEqual({ typebox: "1.1.38" });
		for (const target of Object.values(manifest.exports ?? {}).flatMap(Object.values)) {
			expect(target).toMatch(/^\.\/src\//);
		}
	});
});
