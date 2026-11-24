import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const forbidden = [
	"node:",
	"@spellkave/sdk",
	"@spellkave/session",
	"@spellkave/companion-agent",
	"@earendil-works/pi",
];

function sources(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		return entry.isDirectory()
			? entry.name === "__tests__"
				? []
				: sources(path)
			: [readFileSync(path, "utf8")];
	});
}

describe("browser-safe authoring boundary", () => {
	it("keeps delivery, SDK, Node, and legacy compatibility out of canonical execution", () => {
		const imports = sources(join(root, "src")).flatMap((source) =>
			[...source.matchAll(/\b(?:import|export)\s+(?:[^"'();]*?\s+from\s+)?["']([^"']+)["']/g)].map(
				(match) => match[1],
			),
		);
		for (const specifier of forbidden)
			expect(imports.some((entry) => entry.includes(specifier))).toBe(false);
	});
});
