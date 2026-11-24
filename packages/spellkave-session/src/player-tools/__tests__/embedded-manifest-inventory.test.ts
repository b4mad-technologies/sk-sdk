// Ratchet for intentionally embedded manifest inputs in this package.
// Reusable neutral worlds belong in package-owned fixtures. Exact parser
// inputs and dynamically authored live proofs stay local only when the
// manifest construction itself is the test subject classified below.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = resolve(import.meta.dirname, "../../..");
const AUTHORING_PACKAGE_ROOT = resolve(PACKAGE_ROOT, "../spellkave-tool-authoring");
const REPO_ROOT = resolve(PACKAGE_ROOT, "../..");
// Repository-only policy tooling stays outside the package build root and public API.
const { checkEmbeddedManifestClassifications } = await import(
	resolve(REPO_ROOT, "scripts/lib/embedded-manifest-classifications.ts")
);
const TOML_SCHEMA_MARKER = ["schema_version", " = ", '"1.0.0"'].join("");
const SCHEMA_OBJECT_MARKER = ["schema_version", ': "1.0.0"'].join("");
const MEMORY_WORKSPACE_IMPORT =
	/import\s*\{[^}]*\bmemoryWorkspace\b[^}]*\}\s*from\s*"@spellkave\/world-author"/s;
const CREATE_AUTHOR_TOOLS_IMPORT =
	/import\s*\{[^}]*\bcreateAuthorFacing(?:Bound)?Tools\b[^}]*\}\s*from\s*"[^"]*authoring(?:\.ts)?"/s;
const FAKE_WORKSPACE_DECLARATION = /function\s+fakeWorkspace\s*\(/;

interface SourceFile {
	absolutePath: string;
	displayPath: string;
}

// Package-relative paths below `root`, never entering the package's own
// node_modules: walking it first and filtering after visited ~100k entries.
function packageFiles(root: string, dir = ""): string[] {
	return readdirSync(resolve(root, dir), { withFileTypes: true }).flatMap((entry) => {
		const path = dir ? `${dir}/${entry.name}` : entry.name;
		if (entry.isDirectory()) return path === "node_modules" ? [] : packageFiles(root, path);
		return [path];
	});
}

let sources: SourceFile[] | undefined;

function sourceFiles(): SourceFile[] {
	const roots: Array<[string, string]> = [
		["session", PACKAGE_ROOT],
		["tool-authoring", AUTHORING_PACKAGE_ROOT],
	];
	sources ??= roots.flatMap(([label, root]) =>
		packageFiles(root)
			.filter((path) => path.endsWith(".ts") || path.endsWith(".md"))
			.map((path) => ({ absolutePath: resolve(root, path), displayPath: `${label}/${path}` })),
	);
	return sources;
}

const rules = [
	{
		category: "toml_literal",
		allowedCategories: ["exact_text_oracle"],
		minimumRationaleLength: 40,
		matches: (source: string) => source.replaceAll('\\"', '"').includes(TOML_SCHEMA_MARKER),
	},
	{
		category: "schema_object",
		allowedCategories: [
			"schema_object_oracle",
			"production_empty_manifest",
			"production_manifest_constructor",
		],
		minimumRationaleLength: 40,
		matches: (source: string) => source.includes(SCHEMA_OBJECT_MARKER),
	},
	{
		category: "dynamic_authoring",
		allowedCategories: ["dynamic_authoring_proof"],
		minimumRationaleLength: 40,
		matches: (source: string) =>
			CREATE_AUTHOR_TOOLS_IMPORT.test(source) &&
			(MEMORY_WORKSPACE_IMPORT.test(source) ||
				(source.includes("DOC-PROMISE:") && FAKE_WORKSPACE_DECLARATION.test(source))),
	},
];

describe("embedded manifest inventory", () => {
	it("classifies every TOML, schema-object and dynamic-authoring site beside its source", () => {
		const files = sourceFiles().map(({ absolutePath, displayPath }) => ({
			path: displayPath,
			source: readFileSync(absolutePath, "utf8"),
		}));
		expect(checkEmbeddedManifestClassifications(files, rules)).toEqual([]);
		const categories = new Set(
			files.flatMap(({ source }) =>
				[...source.matchAll(/^\/\/ embedded-manifest: (.+)$/gm)].map(
					(match) => JSON.parse(match[1]!).category as string,
				),
			),
		);
		for (const rule of rules) {
			expect(rule.allowedCategories.filter((category) => categories.has(category))).toEqual(
				rule.allowedCategories,
			);
		}
	});

});
