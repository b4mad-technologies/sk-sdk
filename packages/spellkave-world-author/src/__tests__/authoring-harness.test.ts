// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "minimal header strings exercise in-memory workspace and header stripping", "signatures": ["toml_version", "schema_shape"]}
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	checkOrWrite,
	diffBigIntFieldsRaw,
	diffManifestKindRows,
	type FileEntry,
	loadBundleChain,
	loadBundleChainDetailed,
	loadFlattened,
	memoryWorkspace,
	renderFile,
	renderManifestToml,
	semanticEqual,
	stripHeader,
	writeOutputs,
} from "../authoring-harness";
import {
	renderManifestInclude,
	splitIncludedManifestMetadata,
} from "../included-manifest-metadata";
import { inspectManifest } from "../inspect";

describe("memoryWorkspace", () => {
	it("starts empty and round-trips whatever is written", () => {
		const ws = memoryWorkspace();
		expect(ws.readToml()).toBeNull();
		expect(ws.current()).toBeNull();
		ws.writeToml('schema_version = "1.0.0"\n');
		expect(ws.readToml()).toBe('schema_version = "1.0.0"\n');
		expect(ws.current()).toBe('schema_version = "1.0.0"\n');
	});
});

describe("stripHeader", () => {
	it("removes the 2-line schema header + blank line", () => {
		const rendered = '#:schema https://x\nschema_version = "1.0.0"\n\n[[foo]]\nbar = 1\n';
		expect(stripHeader(rendered)).toBe("[[foo]]\nbar = 1\n");
	});

	it("throws loudly if the header shape ever changes", () => {
		expect(() => stripHeader("not-a-header\n")).toThrow(/header shape changed/);
	});
});

describe("renderFile / renderManifestToml / writeOutputs / loadFlattened", () => {
	let dir: string;

	afterEach(() => {
		if (dir) rmSync(dir, { recursive: true, force: true });
	});

	it("round-trips a minimal bundle through write + flatten", () => {
		dir = mkdtempSync(join(tmpdir(), "authoring-harness-test-"));
		const bundle = {
			bundle_id: "harness_test",
			display_name: "Harness Test",
			author: "spellkave-test",
			version: "0.0.0",
			depends_on: [],
			description: "unit test bundle",
		};
		const metadata = { bundle: "harness_test", profile: "harness_test" };
		const files: FileEntry[] = [
			{
				relPath: "base/spatial.toml",
				groups: [
					{
						kind: "area_shape_definitions",
						rows: [
							{
								shape_id: "harness_test/area/sphere",
								bundle_id: "harness_test",
								description: "test shape",
								parameter_schema_json: "{}",
							},
						],
					},
				],
			},
		];

		writeOutputs(dir, bundle, metadata, ["base/spatial.toml"], files);
		const flattened = loadFlattened(dir);
		expect(flattened).toContain('bundle_id = "harness_test"');
		expect(flattened).toContain("[[area_shape_definitions]]");
		expect(flattened).toContain('shape_id = "harness_test/area/sphere"');

		const manifestToml = renderManifestToml(bundle, metadata, ["base/spatial.toml"]);
		expect(manifestToml).toContain('[[include]]\npath = "base/spatial.toml"');

		const fileToml = renderFile(files[0] as FileEntry);
		expect(fileToml).not.toMatch(/^#:schema/);
		expect(fileToml).toContain("[[area_shape_definitions]]");
	});

	it("renders structured JSON-compatible metadata through the wasm formatter", () => {
		const bundle = {
			bundle_id: "structured_metadata",
			display_name: "Structured metadata",
			author: "spellkave-test",
			version: "0.0.0",
			depends_on: [],
			description: "unit test bundle",
		};
		const rendered = renderManifestToml(
			bundle,
			{
				title: "A test bundle",
				public: true,
				tags: ["forest", "ruin"],
				provenance: { source: "test", revision: 1 },
			},
			[],
		);
		expect(inspectManifest(rendered).manifest.metadata).toEqual({
			title: "A test bundle",
			public: true,
			tags: ["forest", "ruin"],
			provenance: { source: "test", revision: 1 },
		});
	});

	it("keeps actual include metadata in the detailed envelope, not flattened rows", () => {
		dir = mkdtempSync(join(tmpdir(), "authoring-harness-fragment-metadata-"));
		const bundle = {
			bundle_id: "fragment_metadata",
			display_name: "Fragment metadata",
			author: "spellkave-test",
			version: "0.0.0",
			depends_on: [],
			description: "unit test bundle",
		};
		writeFileSync(
			join(dir, "manifest.toml"),
			renderManifestToml(bundle, {}, ["base/reader.toml"]),
			"utf8",
		);
		const rendered = renderManifestInclude(
			renderManifestToml(
				bundle,
				{
					docs: {
						"reader-page": {
							body: "First line.\n[[resource_definitions]]\nStill prose.",
						},
					},
				},
				[],
			),
			{ retainMetadata: true },
		);
		mkdirSync(join(dir, "base"), { recursive: true });
		writeFileSync(
			join(dir, "base", "reader.toml"),
			`${rendered}\n[[resource_definitions]]\nbundle_id = "fragment_metadata"\ndescription = "Reader resource"\ndisplay_name = "Reader resource"\ninitial_value = 0\nmax_value = 1\nmin_value = 0\nrecovery_rule = "persistent"\nresource_definition_id = "fragment_metadata/reader"\nvalue_kind = "int"\n`,
			"utf8",
		);

		const fragment = readFileSync(join(dir, "base", "reader.toml"), "utf8");
		const split = splitIncludedManifestMetadata(fragment);
		expect(split.metadata).toEqual({
			docs: { "reader-page": { body: "First line.\n[[resource_definitions]]\nStill prose." } },
		});
		expect(split.rowsToml).toContain('resource_definition_id = "fragment_metadata/reader"');
		expect(split.rowsToml).not.toContain("reader-page");

		const detailed = loadBundleChainDetailed({
			rootManifestPath: join(dir, "manifest.toml"),
			resolveDependency: () => undefined,
		});
		expect(detailed.sources[0]?.fragments).toEqual([
			{
				path: "base/reader.toml",
				resolvedPath: resolve(dir, "base/reader.toml"),
				metadata: {
					docs: {
						"reader-page": {
							body: "First line.\n[[resource_definitions]]\nStill prose.",
						},
					},
				},
			},
		]);
		expect(detailed.manifest.metadata).toBeUndefined();
		expect(detailed.manifest.resource_definitions).toHaveLength(1);
	});

	it("keeps metadata-free include bytes and rejects non-round-trippable metadata", () => {
		const legacy = "# authored provenance\n\n";
		expect(splitIncludedManifestMetadata(legacy)).toEqual({ metadata: {}, rowsToml: legacy });
		expect(() => splitIncludedManifestMetadata("[metadata]\nreleased = 2026-09-08\n")).toThrow(
			/TOML datetimes are not JSON-compatible/,
		);
	});

	it("removes only metadata from a metadata-bearing include and rejects nested includes", () => {
		const withBundleRow = [
			"[metadata.docs]",
			'title = "Reader"',
			"",
			"[[bundles]]",
			'bundle_id = "fragment_bundle"',
			'display_name = "Fragment bundle"',
			'author = "spellkave-test"',
			'version = "0.0.0"',
			"depends_on = []",
			'description = "A fragment-owned bundle row"',
			"",
		].join("\n");
		const split = splitIncludedManifestMetadata(withBundleRow);
		expect(split.rowsToml).toContain('bundle_id = "fragment_bundle"');
		expect(split.rowsToml).not.toContain("[metadata");
		expect(() =>
			splitIncludedManifestMetadata(
				'[metadata.docs]\ntitle = "Reader"\n\n[[include]]\npath = "nested.toml"\n',
			),
		).toThrow(/nested manifest includes are not supported/);
	});

	it("preserves admitted large row integers when an include also carries metadata", () => {
		const largeCell = "622054109320019967";
		const rendered = renderManifestInclude(
			`${renderManifestToml(
				{
					bundle_id: "precision_fragment",
					display_name: "Precision fragment",
					author: "spellkave-test",
					version: "0.0.0",
					depends_on: [],
					description: "unit test bundle",
				},
				{ docs: { title: "Precision" } },
				[],
			)}${renderFile({
				relPath: "base/precision.toml",
				groups: [
					{
						kind: "place_nodes",
						rows: [
							{
								node_id: "precision/point",
								bundle_id: "precision_fragment",
								place_graph_id: "precision",
								local_id: "point",
								substrate_id: "outdoor",
								display_name: "Point",
								cell_res10: largeCell,
							},
						],
					},
				],
			})}`,
			{ retainMetadata: true },
		);
		const split = splitIncludedManifestMetadata(rendered);
		expect(split.rowsToml).toContain(`cell_res10 = ${largeCell}`);
		expect(split.rowsToml).not.toContain(`cell_res10 = "${largeCell}"`);
	});

	it("flattens a standalone bundle root with a non-default filename", () => {
		dir = mkdtempSync(join(tmpdir(), "authoring-harness-named-root-test-"));
		const bundle = {
			bundle_id: "named_root_test",
			display_name: "Named Root Test",
			author: "spellkave-test",
			version: "0.0.0",
			depends_on: [],
			description: "unit test bundle",
		};
		const files: FileEntry[] = [
			{
				relPath: "adventure/world.toml",
				groups: [
					{
						kind: "area_shape_definitions",
						rows: [
							{
								shape_id: "named_root_test/area/sphere",
								bundle_id: "named_root_test",
								description: "test shape",
								parameter_schema_json: "{}",
							},
						],
					},
				],
			},
		];

		writeOutputs(
			dir,
			bundle,
			{ bundle: "named_root_test", profile: "named_root_test" },
			["adventure/world.toml"],
			files,
		);
		renameSync(join(dir, "manifest.toml"), join(dir, "adventure.manifest.toml"));

		const flattened = loadFlattened(dir, "adventure.manifest.toml");
		expect(flattened).toContain('bundle_id = "named_root_test"');
		expect(flattened).toContain('shape_id = "named_root_test/area/sphere"');
	});

	// #1968 backlog item 2 — a u64 H3 cell id above Number.MAX_SAFE_INTEGER
	// (2^53-1) round-trips bit-exact through `renderFile` with NO
	// `restoreBigIntPrecision`/override table anywhere in the picture: the
	// wasm bridge now carries it as a JSON string (exact digits, never a
	// rounded float64), and `spellkave-schema`'s widened deserialize accepts
	// that string form and renders it back out as a native TOML integer.
	it("carries a u64 above 2^53 through renderFile without an override table", () => {
		const aboveMaxSafeInteger = "622054109320019967";
		expect(Number.isSafeInteger(Number(aboveMaxSafeInteger))).toBe(false);

		const file: FileEntry = {
			relPath: "base/spatial.toml",
			groups: [
				{
					kind: "place_nodes",
					rows: [
						{
							node_id: "village/green",
							bundle_id: "harness_test",
							place_graph_id: "village",
							local_id: "green",
							substrate_id: "outdoor",
							display_name: "Green",
							cell_res10: aboveMaxSafeInteger,
						},
					],
				},
			],
		};

		const rendered = renderFile(file);
		expect(rendered).toContain(`cell_res10 = ${aboveMaxSafeInteger}`);
		// Native TOML integer, never a quoted string.
		expect(rendered).not.toContain(`cell_res10 = "${aboveMaxSafeInteger}"`);
	});

	it("checkOrWrite --check reports zero diffs against its own just-written output", () => {
		dir = mkdtempSync(join(tmpdir(), "authoring-harness-checkorwrite-"));
		const bundle = {
			bundle_id: "harness_check",
			display_name: "Harness Check",
			author: "spellkave-test",
			version: "0.0.0",
			depends_on: [],
			description: "unit test bundle",
		};
		const metadata = { bundle: "harness_check", profile: "harness_check" };
		const files: FileEntry[] = [
			{
				relPath: "base/spatial.toml",
				groups: [
					{
						kind: "area_shape_definitions",
						rows: [
							{
								shape_id: "harness_check/area/cube",
								bundle_id: "harness_check",
								description: "test cube",
								parameter_schema_json: "{}",
							},
						],
					},
				],
			},
		];

		expect(
			checkOrWrite(dir, bundle, metadata, ["base/spatial.toml"], files, { check: false }),
		).toBeNull();
		const diffs = checkOrWrite(dir, bundle, metadata, ["base/spatial.toml"], files, {
			check: true,
		});
		expect(diffs).toEqual([]);
	});
});

describe("loadBundleChain (#1968 connection-level target — local driver dependency resolution)", () => {
	let fixturesRoot: string;

	afterEach(() => {
		if (fixturesRoot) rmSync(fixturesRoot, { recursive: true, force: true });
	});

	function writeBundle(
		dir: string,
		bundleId: string,
		dependsOn: string[],
		files: FileEntry[],
		metadata: Record<string, string> = { bundle: bundleId, profile: bundleId },
	): void {
		writeOutputs(
			dir,
			{
				bundle_id: bundleId,
				display_name: bundleId,
				author: "spellkave-test",
				version: "0.0.0",
				depends_on: dependsOn,
				description: `test bundle ${bundleId}`,
			},
			metadata,
			files.map((f) => f.relPath),
			files,
		);
	}

	it("merges a dependency's rows into the flat chain", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "authoring-harness-chain-"));
		writeBundle(
			join(fixturesRoot, "chain_dep"),
			"chain_dep",
			[],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "area_shape_definitions",
							rows: [
								{
									shape_id: "chain_dep/area/sphere",
									bundle_id: "chain_dep",
									description: "dep shape",
									parameter_schema_json: "{}",
								},
							],
						},
					],
				},
			],
		);
		writeBundle(
			join(fixturesRoot, "chain_base"),
			"chain_base",
			["chain_dep"],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "area_shape_definitions",
							rows: [
								{
									shape_id: "chain_base/area/cube",
									bundle_id: "chain_base",
									description: "base shape",
									parameter_schema_json: "{}",
								},
							],
						},
					],
				},
			],
		);

		const merged = loadBundleChain(join(fixturesRoot, "chain_base"), fixturesRoot);
		const shapeIds = (merged.area_shape_definitions as Record<string, unknown>[]).map(
			(r) => r.shape_id,
		);
		expect(shapeIds).toContain("chain_base/area/cube");
		expect(shapeIds).toContain("chain_dep/area/sphere");
	});

	it("never re-parses the same bundle twice in a diamond dependency graph", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "authoring-harness-diamond-"));
		writeBundle(
			join(fixturesRoot, "diamond_root"),
			"diamond_root",
			[],
			[
				{
					relPath: "base/spatial.toml",
					groups: [
						{
							kind: "area_shape_definitions",
							rows: [
								{
									shape_id: "diamond_root/area/point",
									bundle_id: "diamond_root",
									description: "root shape",
									parameter_schema_json: "{}",
								},
							],
						},
					],
				},
			],
		);
		writeBundle(join(fixturesRoot, "diamond_a"), "diamond_a", ["diamond_root"], []);
		writeBundle(join(fixturesRoot, "diamond_b"), "diamond_b", ["diamond_root"], []);
		writeBundle(join(fixturesRoot, "diamond_top"), "diamond_top", ["diamond_a", "diamond_b"], []);

		const merged = loadBundleChain(join(fixturesRoot, "diamond_top"), fixturesRoot);
		const rootShapes = (merged.area_shape_definitions as Record<string, unknown>[]).filter(
			(r) => r.shape_id === "diamond_root/area/point",
		);
		expect(rootShapes).toHaveLength(1);
	});

	it("loads a named root through explicit dependency paths and retains root headers", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "authoring-harness-detailed-"));
		const dependencyDir = join(fixturesRoot, "dependency-location");
		const rootDir = join(fixturesRoot, "adventure-location");
		writeBundle(dependencyDir, "shared_rules", [], [], {
			bundle: "shared_rules",
			audience: "public",
		});
		writeBundle(rootDir, "adventure_root", ["shared_rules"], [], {
			bundle: "adventure_root",
			profile: "play",
		});
		renameSync(join(rootDir, "manifest.toml"), join(rootDir, "adventure.manifest.toml"));

		const detailed = loadBundleChainDetailed({
			rootManifestPath: join(rootDir, "adventure.manifest.toml"),
			resolveDependency: (bundleId) =>
				bundleId === "shared_rules" ? join(dependencyDir, "manifest.toml") : undefined,
		});

		expect(detailed.sources.map((source) => source.bundleIds)).toEqual([
			["shared_rules"],
			["adventure_root"],
		]);
		expect(detailed.sources.map((source) => source.manifestPath)).toEqual([
			resolve(dependencyDir, "manifest.toml"),
			resolve(rootDir, "adventure.manifest.toml"),
		]);
		expect(detailed.sources.map((source) => source.metadata)).toEqual([
			{ bundle: "shared_rules", audience: "public" },
			{ bundle: "adventure_root", profile: "play" },
		]);
		expect(detailed.sources.map((source) => source.schemaVersion)).toEqual(["1.0.0", "1.0.0"]);
		expect(detailed.manifest.metadata).toBeUndefined();
	});

	it("accepts multiple bundle declarations from one flattened source", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "authoring-harness-multiple-bundles-"));
		const rootDir = join(fixturesRoot, "root");
		writeBundle(rootDir, "first", ["second"], []);
		const manifestPath = join(rootDir, "manifest.toml");
		writeFileSync(
			manifestPath,
			`${readFileSync(manifestPath, "utf8")}\n[[bundles]]\nbundle_id = "second"\ndisplay_name = "Second"\nauthor = "spellkave-test"\nversion = "0.0.0"\ndepends_on = []\ndescription = "second bundle"\n`,
			"utf8",
		);

		const detailed = loadBundleChainDetailed({
			rootManifestPath: manifestPath,
			resolveDependency: () => undefined,
		});
		expect(detailed.sources[0]?.bundleIds).toEqual(["first", "second"]);
	});

	it("uses parsed include paths for both flattened rows and source provenance", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "authoring-harness-quoted-include-"));
		const rootDir = join(fixturesRoot, "quoted");
		writeBundle(
			rootDir,
			"quoted",
			[],
			[
				{
					relPath: "base/row.toml",
					groups: [
						{
							kind: "area_shape_definitions",
							rows: [
								{
									shape_id: "quoted/area/point",
									bundle_id: "quoted",
									description: "quoted include",
									parameter_schema_json: "{}",
								},
							],
						},
					],
				},
			],
		);
		const manifestPath = join(rootDir, "manifest.toml");
		writeFileSync(
			manifestPath,
			readFileSync(manifestPath, "utf8").replace(
				'[[include]]\npath = "base/row.toml"',
				"[[include]]\n  path = 'base/row.toml'",
			),
			"utf8",
		);
		const detailed = loadBundleChainDetailed({
			rootManifestPath: manifestPath,
			resolveDependency: () => undefined,
		});
		expect(detailed.sources[0]?.includes).toEqual([
			{ path: "base/row.toml", resolvedPath: resolve(rootDir, "base/row.toml") },
		]);
		expect(detailed.manifest.area_shape_definitions).toEqual([
			{
				shape_id: "quoted/area/point",
				bundle_id: "quoted",
				description: "quoted include",
				parameter_schema_json: "{}",
			},
		]);
	});

	it("rejects missing, mismatched, cyclic, and inconsistent dependency roots", () => {
		fixturesRoot = mkdtempSync(join(tmpdir(), "authoring-harness-detailed-errors-"));
		writeBundle(join(fixturesRoot, "root"), "root", ["dependency"], []);
		writeBundle(join(fixturesRoot, "wrong"), "wrong", [], []);
		const rootManifestPath = join(fixturesRoot, "root", "manifest.toml");

		expect(() =>
			loadBundleChainDetailed({ rootManifestPath, resolveDependency: () => undefined }),
		).toThrow(/has no manifest path/);
		expect(() =>
			loadBundleChainDetailed({
				rootManifestPath,
				resolveDependency: () => join(fixturesRoot, "wrong", "manifest.toml"),
			}),
		).toThrow(/declares bundle_id/);

		writeBundle(join(fixturesRoot, "dependency"), "dependency", ["root"], []);
		expect(() =>
			loadBundleChainDetailed({
				rootManifestPath,
				resolveDependency: (bundleId) => join(fixturesRoot, bundleId, "manifest.toml"),
			}),
		).toThrow(/dependency cycle root -> dependency -> root/);

		writeBundle(join(fixturesRoot, "diamond-root"), "diamond-root", ["left", "right"], []);
		writeBundle(join(fixturesRoot, "left"), "left", ["shared"], []);
		writeBundle(join(fixturesRoot, "right"), "right", ["shared"], []);
		writeBundle(join(fixturesRoot, "shared-a"), "shared", [], []);
		writeBundle(join(fixturesRoot, "shared-b"), "shared", [], []);
		expect(() =>
			loadBundleChainDetailed({
				rootManifestPath: join(fixturesRoot, "diamond-root", "manifest.toml"),
				resolveDependency: (bundleId, from) => {
					if (bundleId !== "shared") return join(fixturesRoot, bundleId, "manifest.toml");
					return from.bundleIds.includes("left")
						? join(fixturesRoot, "shared-a", "manifest.toml")
						: join(fixturesRoot, "shared-b", "manifest.toml");
				},
			}),
		).toThrow(/resolved inconsistently/);
	});
});

describe("diffManifestKindRows", () => {
	it("reports no diff for order-shuffled identical arrays", () => {
		const a = { entities: [{ x: 1 }, { x: 2 }] };
		const b = { entities: [{ x: 2 }, { x: 1 }] };
		expect(diffManifestKindRows(a, b)).toEqual([]);
	});

	it("reports a diff when rows differ", () => {
		const a = { entities: [{ x: 1 }] };
		const b = { entities: [{ x: 2 }] };
		expect(diffManifestKindRows(a, b)).toHaveLength(1);
	});

	it("ignores the `include` key by default", () => {
		const a = { include: [{ path: "a" }] };
		const b = { include: [{ path: "b" }] };
		expect(diffManifestKindRows(a, b)).toEqual([]);
	});
});

describe("diffBigIntFieldsRaw", () => {
	it("catches a precision-losing value even when both sides parse to the same rounded number", () => {
		const oldText = "cell_res10 = 622054109320019967\n";
		const newText = "cell_res10 = 622054109320020000\n";
		expect(diffBigIntFieldsRaw(oldText, newText)).toHaveLength(1);
	});

	it("reports no diff for identical digit strings", () => {
		const text = "cell_res10 = 622054109320019967\n";
		expect(diffBigIntFieldsRaw(text, text)).toEqual([]);
	});
});

describe("semanticEqual", () => {
	let oldDir: string;
	let newDir: string;

	afterEach(() => {
		if (oldDir) rmSync(oldDir, { recursive: true, force: true });
		if (newDir) rmSync(newDir, { recursive: true, force: true });
	});

	it("is empty for two directories written from the same data", () => {
		oldDir = mkdtempSync(join(tmpdir(), "authoring-harness-semeq-old-"));
		newDir = mkdtempSync(join(tmpdir(), "authoring-harness-semeq-new-"));
		const bundle = {
			bundle_id: "harness_semeq",
			display_name: "Harness SemEq",
			author: "spellkave-test",
			version: "0.0.0",
			depends_on: [],
			description: "unit test bundle",
		};
		const metadata = { bundle: "harness_semeq", profile: "harness_semeq" };
		const files: FileEntry[] = [
			{
				relPath: "base/spatial.toml",
				groups: [
					{
						kind: "area_shape_definitions",
						rows: [
							{
								shape_id: "harness_semeq/area/line",
								bundle_id: "harness_semeq",
								description: "test line",
								parameter_schema_json: "{}",
							},
						],
					},
				],
			},
		];
		writeOutputs(oldDir, bundle, metadata, ["base/spatial.toml"], files);
		writeOutputs(newDir, bundle, metadata, ["base/spatial.toml"], files);
		expect(semanticEqual(oldDir, newDir)).toEqual([]);
	});
});
