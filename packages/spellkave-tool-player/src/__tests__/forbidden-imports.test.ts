import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const sourceRoot = join(packageRoot, "src");
const forbidden = [
	"node:",
	"@spellkave/session",
	"@spellkave/tool-node",
	"@spellkave/companion-agent",
	"@spellkave/mcp",
	"@modelcontextprotocol/",
	"@mariozechner/pi",
	"@earendil-works/pi",
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

describe("browser-safe production boundary", () => {
	it("contains no Node, session, agent, or transport imports", () => {
		const imports = productionSources(sourceRoot).flatMap(importSpecifiers);
		for (const token of forbidden)
			expect(imports.some((specifier) => specifier.includes(token))).toBe(false);
	});
});
