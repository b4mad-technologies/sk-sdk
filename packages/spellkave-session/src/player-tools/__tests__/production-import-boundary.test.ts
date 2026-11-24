import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const sourceDirectory = fileURLToPath(new URL("..", import.meta.url));

async function productionSources(directory: string): Promise<string[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const nested = await Promise.all(
		entries
			.filter((entry) => entry.isDirectory() && entry.name !== "__tests__")
			.map((entry) => productionSources(join(directory, entry.name))),
	);
	return [
		...entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
			.map((entry) => join(directory, entry.name)),
		...nested.flat(),
	];
}

describe("companion production import boundary", () => {
	it("never imports test helpers or __tests__ from production source", async () => {
		const sources = await productionSources(sourceDirectory);
		const violations = sources.filter((source) =>
			/(?:from|import)\s*["'][^"']*(?:__tests__|test-helper)/.test(readFileSync(source, "utf8")),
		);

		expect(violations).toEqual([]);
	});
});
