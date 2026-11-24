import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(__dirname, "../..");
const srcRoot = path.join(packageRoot, "src");

function resolveLocalModule(fromFile: string, specifier: string): string | null {
	if (!specifier.startsWith(".")) return null;

	const base = path.resolve(path.dirname(fromFile), specifier);
	const candidates = [
		base,
		`${base}.ts`,
		`${base}.tsx`,
		path.join(base, "index.ts"),
		path.join(base, "index.tsx"),
	];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function localImports(file: string): string[] {
	const source = readFileSync(file, "utf8");
	const imports: string[] = [];
	for (const match of source.matchAll(
		/^\s*(?:import(?:\s+type)?(?:[\s\S]*?\sfrom\s)?|export(?:\s+type)?[\s\S]*?\sfrom\s)["']([^"']+)["']/gm,
	)) {
		if (match[1] !== undefined) imports.push(match[1]);
	}
	return imports;
}

function reachableLocalModules(entry: string): string[] {
	const seen = new Set<string>();
	const pending = [entry];

	while (pending.length > 0) {
		const file = pending.pop();
		if (file === undefined || seen.has(file)) continue;
		seen.add(file);

		for (const specifier of localImports(file)) {
			const resolved = resolveLocalModule(file, specifier);
			if (resolved?.startsWith(srcRoot)) {
				pending.push(resolved);
			}
		}
	}

	return Array.from(seen).sort();
}

describe("@spellkave/sdk/readers browser entry", () => {
	it("is declared as a package subpath export", () => {
		const pkg = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
			exports?: Record<string, { default?: string; types?: string }>;
		};

		expect(pkg.exports?.["./readers"]).toEqual({
			types: "./src/readers.ts",
			default: "./src/readers.ts",
		});
	});

	it("does not reach Node built-in imports", () => {
		const entry = path.join(srcRoot, "readers.ts");
		const reachable = reachableLocalModules(entry);
		const violations = reachable.flatMap((file) =>
			localImports(file)
				.filter((specifier) => specifier.startsWith("node:"))
				.map((specifier) => `${path.relative(packageRoot, file)} -> ${specifier}`),
		);

		expect(violations).toEqual([]);
	});
});
