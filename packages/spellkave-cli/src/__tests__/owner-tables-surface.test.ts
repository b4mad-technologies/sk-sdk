// A connection that sets `ownerTables` also subscribes, as the world's
// publisher, to its private tables, which the ordinary reader route strips.
// Only `sk`'s publisher connection (`src/cli.ts`, through the SDK's
// `connection.ts`) and two named live-test helpers may set it. This test
// scans SDK workspace source and fails on any other place, so a new
// caller has to be named here on purpose. Reads repository files; no node.
// Owner subscription: ADR-0150.
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, matchesGlob, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The scan looks for the property name, not a call name: the gateway passes
// an injected `connectFn`, so a pin on `connect(` would miss it. `*.test.ts`
// and compiled `/dist/` are left out (`tsc` emits `dist/cli.js` with the
// allowed connect path).

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

// Legacy extension-specific globs are retained as the fixture parity oracle.
const SCOPES = [
	"packages/**/*.ts",
	"packages/**/*.tsx",
	"packages/**/*.js",
	"packages/**/*.mjs",
	"packages/**/*.svelte",
	"apps/**/*.ts",
	"apps/**/*.tsx",
	"apps/**/*.js",
	"apps/**/*.mjs",
	"apps/**/*.svelte",
] as const;

/** Production definitions. Not a caller-supplied whitelist. */
const ALLOWED_SOURCES = new Set([
	"packages/spellkave-cli/src/cli.ts",
	"packages/spellkave-sdk/src/connection.ts",
]);

/**
 * Live-test support modules (not `*.test.ts`, so the filename exclusion does
 * not cover them) that open a publisher-token owner-table session to read raw
 * rows for live claims, exactly as the `*.live.test.ts` files they replaced
 * did. Test-only, never imported by production code; each entry is an exact
 * path so a new caller still has to be named here.
 */
const ALLOWED_LIVE_TEST_SUPPORT = new Set([
	"packages/spellkave-test-lab/src/scene-live/support.ts",
	"packages/spellkave-world-author/src/test/live/support.ts",
]);

/** Property token, including a normal quoted object key (`"ownerTables":`). */
const PROPERTY_NAME = /\bownerTables\b/;

function toRepoPath(path: string): string {
	return path.split("\\").join("/");
}

function isScannedSource(path: string): boolean {
	const rel = toRepoPath(path);
	return (
		!rel.includes("node_modules/") && !rel.includes("/dist/") && !basename(rel).endsWith(".test.ts")
	);
}

function scannedSources(root = repo): string[] {
	// One walk per root, rather than revisiting each directory for five extensions.
	const found = globSync(["packages/**/*", "apps/**/*"], {
		cwd: root,
		// Prune before descent; filtering matches afterwards still walks dependencies
		// and build outputs once for every source pattern.
		exclude: (entry) => ["node_modules", "dist"].includes(basename(entry)),
	});
	return [...new Set(found.map(toRepoPath))]
		.filter(
			(path) => matchesGlob(basename(path), "*.{ts,tsx,js,mjs,svelte}") && isScannedSource(path),
		)
		.sort();
}

function propertyLines(source: string): number[] {
	// Most source files have no property token; avoid splitting and testing every line.
	if (!PROPERTY_NAME.test(source)) return [];
	const lines: number[] = [];
	const text = source.split("\n");
	for (let i = 0; i < text.length; i++) {
		if (PROPERTY_NAME.test(text[i] ?? "")) lines.push(i + 1);
	}
	return lines;
}

function unauthorizedPropertyHits(
	files: readonly { path: string; source: string }[],
): { path: string; line: number }[] {
	const hits: { path: string; line: number }[] = [];
	for (const file of files) {
		const path = toRepoPath(file.path);
		if (ALLOWED_SOURCES.has(path) || ALLOWED_LIVE_TEST_SUPPORT.has(path)) continue;
		for (const line of propertyLines(file.source)) hits.push({ path, line });
	}
	return hits;
}

describe("ownerTables stays on the publisher connect path", () => {
	// keep(K4): preserves the authority guard's filesystem coverage during traversal changes.
	it("preserves the legacy source set and unauthorized hits while pruning excluded directories", () => {
		const root = mkdtempSync(resolve(tmpdir(), "spellkave-owner-table-scan-"));
		const included = [
			"packages/example/src/source.ts",
			"packages/example/src/view.tsx",
			"packages/example/src/script.js",
			"packages/example/src/module.mjs",
			"packages/example/src/component.svelte",
			"packages/example/src/types.d.ts",
			"packages/example/src/component.test.tsx",
			"packages/example/src/script.test.js",
			"packages/example/src/distribution/source.ts",
			"packages/root.ts",
			"packages/example/src/suffix.spec.ts",
			"apps/example/src/source.ts",
			"apps/example/src/view.tsx",
			"apps/example/src/script.js",
			"apps/example/src/module.mjs",
			"apps/example/src/component.svelte",
		];
		const excluded = [
			"packages/example/node_modules/dependency/source.ts",
			"packages/example/src/nested/node_modules/dependency/component.svelte",
			"packages/example/dist/source.js",
			"apps/example/node_modules/dependency/source.ts",
			"apps/example/src/nested/dist/component.svelte",
			"packages/example/src/source.test.ts",
			"packages/example/src/source.mts",
			"apps/example/src/source.cts",
			"outside/source.ts",
			"packages/example/src/source.json",
			"packages/example/src/.hidden.ts",
			"packages/example/.hidden/source.ts",
		];
		try {
			for (const path of [...included, ...excluded]) {
				const target = resolve(root, path);
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, "connect({ ownerTables: true });\n");
			}
			const legacy = [
				...new Set(SCOPES.flatMap((pattern) => globSync(pattern, { cwd: root })).map(toRepoPath)),
			]
				.filter(isScannedSource)
				.sort();
			const files = scannedSources(root);
			expect(files).toEqual(legacy);
			expect(files).toEqual([...included].sort());
			expect(
				unauthorizedPropertyHits(
					files.map((path) => ({ path, source: readFileSync(resolve(root, path), "utf8") })),
				),
			).toEqual(files.map((path) => ({ path, line: 1 })));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// keep(K4): native glob case matching differs by platform and must retain its legacy coverage.
	it("preserves native glob extension casing", () => {
		const root = mkdtempSync(resolve(tmpdir(), "spellkave-owner-table-case-"));
		try {
			for (const path of ["packages/example/UPPER.TS", "apps/example/MIXED.TsX"]) {
				const target = resolve(root, path);
				mkdirSync(dirname(target), { recursive: true });
				writeFileSync(target, "connect({ ownerTables: true });\n");
			}
			const legacy = [...new Set(SCOPES.flatMap((pattern) => globSync(pattern, { cwd: root })))]
				.map(toRepoPath)
				.filter(isScannedSource)
				.sort();
			expect(scannedSources(root)).toEqual(legacy);
			expect(
				unauthorizedPropertyHits(
					legacy.map((path) => ({ path, source: readFileSync(resolve(root, path), "utf8") })),
				),
			).toEqual(legacy.map((path) => ({ path, line: 1 })));
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	// keep(K1): pins token boundaries and one-based lines for the scan's fast rejection path.
	it("preserves exact property lines while rejecting files without the token", () => {
		for (const [source, lines] of [
			["const ownerTablesSuffix = true;\nconst prefixownerTables = true;", []],
			['const options = {\n  "ownerTables": true,\n};', [2]],
			["ownerTables\r\n\r\nownerTables", [1, 3]],
		] as const)
			expect(propertyLines(source)).toEqual(lines);
	});

	it("fails when a fixture adds the option to the gateway connectFn call", () => {
		const source = `const session = await connectFn(
			{
				url: options.worldUrl,
				db: world.db,
				token: options.token,
				ownerTables: true,
			},
			handlers,
		);`;
		expect(
			unauthorizedPropertyHits([{ path: "packages/spellkave-mcp/src/osm-model.ts", source }]),
		).not.toEqual([]);
	});

	it("fails when a fixture adds the option to a harness module connection", () => {
		const source = `const world = await connectTestWorld({ token: liveNodeToken(), ownerTables: true });`;
		expect(
			unauthorizedPropertyHits([
				{
					path: "packages/spellkave-adventure-runtime/src/stage/apply-test-gatekeeper.ts",
					source,
				},
			]),
		).not.toEqual([]);
	});

	it("fails when the option is a quoted object key", () => {
		for (const source of [
			`await connectFn({ "ownerTables": true })`,
			`await connectTestWorld({ 'ownerTables': true })`,
		]) {
			expect(
				unauthorizedPropertyHits([{ path: "packages/spellkave-mcp/src/osm-model.ts", source }]),
				source,
			).not.toEqual([]);
		}
	});

	it("keeps the live-test support allowlist exact", () => {
		const source = `await connect({ ownerTables: true })`;
		expect(
			unauthorizedPropertyHits([
				{ path: "packages/spellkave-test-lab/src/scene-live/other.ts", source },
			]),
		).not.toEqual([]);
		const files = new Set(scannedSources());
		for (const path of ALLOWED_LIVE_TEST_SUPPORT) expect(files.has(path), path).toBe(true);
	});

	it("passes on the tree", () => {
		const files = scannedSources();
		expect(files.some((path) => path.endsWith(".ts"))).toBe(true);
		expect(files).toContain("packages/spellkave-cli/src/__tests__/helpers.ts");
		expect(files.some((path) => path.endsWith(".test.ts"))).toBe(false);
		expect(files.some((path) => path.includes("node_modules/"))).toBe(false);

		const hits = unauthorizedPropertyHits(
			files.map((path) => ({
				path,
				source: readFileSync(resolve(repo, path), "utf8"),
			})),
		);
		expect(hits).toEqual([]);
	});
});
