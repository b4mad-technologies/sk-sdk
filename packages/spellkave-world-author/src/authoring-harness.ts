// embedded-manifest: {"category": "production_schema_constructor", "rationale": "production harness constructs schema envelopes from caller-supplied rows", "signatures": ["schema_object", "schema_shape"]}
// Generic verb-call-script harness (#1968 "fixtures become verb-call
// scripts"). Extracted from `packages/spellkave-mechanics/src/core/generate-core-fixtures.ts` so any
// bundle-generation script (core today; srd/phandelver planned) can reuse the
// same file-based workspace, manifest merge/render/compare helpers, and
// drift-check plumbing without re-deriving them.
//
// Deliberately has NO dependency on `@spellkave/tool-authoring` — the
// AUTHOR-facing verb tools (and their `AuthorWorkspace`/`AuthorToolContext`
// types) live there; this module only needs the STRUCTURAL shape of a
// workspace (`readToml`/`writeToml`), so it declares its own minimal
// `HarnessWorkspace` interface instead of importing the nominal type. A
// generator script imports verbs from shared tool runtime AND this harness from
// world-author side by side — no cycle between the two packages.

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { splitIncludedManifestMetadata } from "./included-manifest-metadata";
import { inspectManifest } from "./inspect";
import { renderSchemaManifest } from "./manifest";

/** Structural match for `@spellkave/tool-authoring`'s `AuthorWorkspace` —
 * kept in sync by convention, not by import (see file header). */
export interface HarnessWorkspace {
	readToml(): string | null;
	writeToml(next: string): string;
}

/** An in-memory `HarnessWorkspace` — same shape every verb tool call writes
 * through, but nothing ever touches disk until the script explicitly renders
 * output files. */
export function memoryWorkspace(): HarnessWorkspace & { current(): string | null } {
	let toml: string | null = null;
	return {
		readToml: () => toml,
		writeToml: (next: string) => {
			toml = next;
			return "(in-memory)";
		},
		current: () => toml,
	};
}

export interface KindGroup {
	kind: string;
	rows: Record<string, unknown>[];
}
export interface FileEntry {
	relPath: string;
	groups: KindGroup[];
}

/** Strip `renderSchemaManifest`'s 2-line schema header + blank line — an
 * included fragment file never carries one (the loader's include
 * concatenation supplies it exactly once, from the root manifest). */
export function stripHeader(rendered: string): string {
	const lines = rendered.split("\n");
	if (!lines[0]?.startsWith("#:schema")) {
		throw new Error(`renderSchemaManifest header shape changed (line 0): ${lines[0]}`);
	}
	if (!lines[1]?.startsWith("schema_version")) {
		throw new Error(`renderSchemaManifest header shape changed (line 1): ${lines[1]}`);
	}
	if (lines[2] !== "") {
		throw new Error(`renderSchemaManifest header shape changed (line 2 not blank): ${lines[2]}`);
	}
	return lines.slice(3).join("\n");
}

/** Render one included fragment file (a flat kind->rows map, no bundle/metadata). */
export function renderFile(file: FileEntry): string {
	const mini: Record<string, unknown> = { schema_version: "1.0.0" };
	for (const group of file.groups) mini[group.kind] = group.rows;
	return stripHeader(renderSchemaManifest(mini));
}

/** Render the root `manifest.toml` (bundle header + metadata + `[[include]]` block). */
export function renderManifestToml(
	bundle: Record<string, unknown>,
	metadata: Record<string, unknown>,
	includeOrder: readonly string[],
	applyset?: string,
): string {
	// ADR-0145: a root names its applyset; `undefined` renders no field.
	const mini = {
		schema_version: "1.0.0",
		...(applyset === undefined ? {} : { applyset }),
		metadata,
		bundles: [bundle],
	};
	const rendered = renderSchemaManifest(mini).replace(/\n+$/, "\n");
	const includeBlock = includeOrder.map((path) => `[[include]]\npath = "${path}"\n`).join("\n");
	return `${rendered}\n${includeBlock}`;
}

/** Write a root manifest + its included fragment files under `outDir`, mirroring
 * a `{outDir}/manifest.toml` + `{outDir}/<relPath>` layout. */
export function writeOutputs(
	outDir: string,
	bundle: Record<string, unknown>,
	metadata: Record<string, unknown>,
	includeOrder: readonly string[],
	files: readonly FileEntry[],
	applyset?: string,
): void {
	mkdirSync(outDir, { recursive: true });
	writeFileSync(
		join(outDir, "manifest.toml"),
		renderManifestToml(bundle, metadata, includeOrder, applyset),
		"utf8",
	);
	for (const file of files) {
		const outPath = join(outDir, file.relPath);
		mkdirSync(dirname(outPath), { recursive: true });
		writeFileSync(outPath, renderFile(file), "utf8");
	}
}

/** Concatenate a root source and its direct parsed `[[include]]` files, each
 * followed by "\n". `manifestFile` supports standalone roots such as an
 * adventure descriptor without duplicating loader logic. */
export function loadFlattened(dir: string, manifestFile = "manifest.toml"): string {
	const manifestText = readFileSync(join(dir, manifestFile), "utf8");
	const includePaths = includePathsFromRoot(manifestText);
	let resolved = `${manifestText}\n`;
	for (const rel of includePaths) {
		const fragment = readFileSync(join(dir, rel), "utf8");
		resolved += `${splitIncludedManifestMetadata(fragment).rowsToml}\n`;
	}
	return resolved;
}

/**
 * Merge every top-level ARRAY field of `manifest` into the matching bucket of
 * `into` (creating the bucket on first sight), leaving non-array fields
 * (`schema_version`, `metadata`, `include`) untouched on `into` — a bundle's
 * own `[[include]]`/metadata are per-bundle bookkeeping, never merged content.
 */
function mergeManifestRowsInto(
	into: Record<string, unknown>,
	manifest: Record<string, unknown>,
): void {
	for (const [key, value] of Object.entries(manifest)) {
		if (!Array.isArray(value)) continue;
		const bucket = into[key];
		if (Array.isArray(bucket)) bucket.push(...value);
		else into[key] = [...value];
	}
}

export interface BundleManifestSource {
	/** Every authored `[[bundles]].bundle_id` in the flattened source, never inferred from a directory name. */
	bundleIds: string[];
	/** Absolute root TOML path supplied by the caller or its dependency resolver. */
	manifestPath: string;
	/** Root `schema_version`, retained outside the row-only merged projection. */
	schemaVersion: unknown;
	/** Root `[metadata]`; deliberately outside the merged Manifest row projection. */
	metadata: Record<string, unknown>;
	/** Direct `[[include]]` paths in declaration order, with their resolved files. */
	includes: Array<{ path: string; resolvedPath: string }>;
	/**
	 * Direct include metadata in declaration order. This is intentionally
	 * outside the merged row projection: an include's `[metadata]` describes
	 * the source file, not a second bundle root.
	 */
	fragments: Array<{ path: string; resolvedPath: string; metadata: Record<string, unknown> }>;
}

export interface LoadBundleChainDetailedOptions {
	/** Any root name is valid, including an adventure descriptor such as adventure.manifest.toml. */
	rootManifestPath: string;
	/**
	 * The root's TOML when it is not (yet) the file on disk, such as a pending
	 * write. `rootManifestPath` still anchors its includes and identity.
	 */
	rootManifestText?: string;
	/** Maps the authored dependency id to its root TOML. Return undefined when it is unavailable. */
	resolveDependency: (bundleId: string, from: BundleManifestSource) => string | undefined;
}

export interface LoadedBundleChain {
	/** Canonical row projection: only top-level array row kinds are merged. */
	manifest: Record<string, unknown>;
	/** Dependency-before-dependent sources, with root headers retained per source. */
	sources: BundleManifestSource[];
}

function recordOf(value: unknown): Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
}

/** Uses the manifest parser rather than syntax-sensitive text matching so the
 * flattened body and provenance observe exactly the same includes. */
function includePathsFromRoot(manifestText: string): string[] {
	const root = inspectManifest(manifestText).manifest as Record<string, unknown>;
	return Array.isArray(root.include)
		? root.include
				.map((row) => recordOf(row).path)
				.filter((path): path is string => typeof path === "string")
		: [];
}

/**
 * A manifest root the loader was pointed at does not exist: the requested root,
 * or the file a `depends_on` resolver returned. Typed so a host can tell a
 * missing bundle from a malformed one without reading the message.
 */
export class ManifestRootMissingError extends Error {
	readonly path: string;
	constructor(path: string) {
		super(`loadBundleChainDetailed: manifest root missing '${path}'.`);
		this.name = "ManifestRootMissingError";
		this.path = path;
	}
}

function sourceForManifest(
	manifestPath: string,
	manifestText?: string,
): {
	source: BundleManifestSource;
	manifest: Record<string, unknown>;
} {
	const absolutePath = resolve(manifestPath);
	if (manifestText === undefined && !existsSync(absolutePath)) {
		throw new ManifestRootMissingError(absolutePath);
	}
	const rootText = manifestText ?? readFileSync(absolutePath, "utf8");
	const root = inspectManifest(rootText).manifest as Record<string, unknown>;
	const relativeIncludes = includePathsFromRoot(rootText);
	const fragments = relativeIncludes.map((path) => {
		const resolvedPath = resolve(dirname(absolutePath), path);
		const fragment = splitIncludedManifestMetadata(readFileSync(resolvedPath, "utf8"));
		return { path, resolvedPath, metadata: fragment.metadata, rowsToml: fragment.rowsToml };
	});
	const flattened = `${rootText}\n${fragments.map((fragment) => `${fragment.rowsToml}\n`).join("")}`;
	const parsed = inspectManifest(flattened).manifest as Record<string, unknown>;
	const bundleRows = Array.isArray(parsed.bundles)
		? (parsed.bundles as Record<string, unknown>[])
		: [];
	const bundleIds = [
		...new Set(
			bundleRows.map((row) => row.bundle_id).filter((id): id is string => typeof id === "string"),
		),
	];
	if (bundleIds.length === 0) {
		throw new Error(`loadBundleChainDetailed: '${absolutePath}' declares no bundle_id.`);
	}
	return {
		source: {
			bundleIds,
			manifestPath: absolutePath,
			schemaVersion: root.schema_version,
			metadata: recordOf(root.metadata),
			includes: relativeIncludes.map((path) => ({
				path,
				resolvedPath: resolve(dirname(absolutePath), path),
			})),
			fragments: fragments.map(({ path, resolvedPath, metadata }) => ({
				path,
				resolvedPath,
				metadata,
			})),
		},
		manifest: parsed,
	};
}

/**
 * Load an explicitly rooted bundle dependency closure into the same row-only
 * projection as {@link loadBundleChain}, while retaining each root's authored
 * metadata and direct include provenance in a separate envelope. Dependency
 * traversal is dependency-before-dependent, deduplicates diamonds by authored
 * bundle ID, and does not itself de-duplicate row natural keys.
 */
export function loadBundleChainDetailed(
	options: LoadBundleChainDetailedOptions,
): LoadedBundleChain {
	const manifest: Record<string, unknown> = { schema_version: "1.0.0" };
	const sources: BundleManifestSource[] = [];
	const completed = new Set<string>();
	const visiting: string[] = [];
	const resolvedPaths = new Map<string, string>();

	function visit(manifestPath: string, expectedBundleId?: string, manifestText?: string): void {
		if (expectedBundleId !== undefined) {
			const cycleAt = visiting.indexOf(expectedBundleId);
			if (cycleAt !== -1) {
				throw new Error(
					`loadBundleChainDetailed: dependency cycle ${[...visiting.slice(cycleAt), expectedBundleId].join(" -> ")}.`,
				);
			}
			const absolutePath = resolve(manifestPath);
			const knownPath = resolvedPaths.get(expectedBundleId);
			if (knownPath !== undefined) {
				if (knownPath !== absolutePath) {
					throw new Error(
						`loadBundleChainDetailed: dependency '${expectedBundleId}' resolved inconsistently to ` +
							`'${knownPath}' and '${absolutePath}'.`,
					);
				}
				if (completed.has(expectedBundleId)) return;
			}
		}
		const loaded = sourceForManifest(manifestPath, manifestText);
		const { source } = loaded;
		if (expectedBundleId !== undefined && !source.bundleIds.includes(expectedBundleId)) {
			throw new Error(
				`loadBundleChainDetailed: dependency '${expectedBundleId}' resolved to '${source.manifestPath}', ` +
					`which declares bundle_id(s) '${source.bundleIds.join(", ")}'.`,
			);
		}
		for (const bundleId of source.bundleIds) {
			const knownPath = resolvedPaths.get(bundleId);
			if (knownPath !== undefined && knownPath !== source.manifestPath) {
				throw new Error(
					`loadBundleChainDetailed: bundle_id '${bundleId}' appears in both '${knownPath}' and '${source.manifestPath}'.`,
				);
			}
			resolvedPaths.set(bundleId, source.manifestPath);
		}
		if (source.bundleIds.every((bundleId) => completed.has(bundleId))) return;
		const activeBundleId = source.bundleIds.find((bundleId) => visiting.includes(bundleId));
		if (activeBundleId !== undefined) {
			const cycleAt = visiting.indexOf(activeBundleId);
			throw new Error(
				`loadBundleChainDetailed: dependency cycle ${[...visiting.slice(cycleAt), activeBundleId].join(" -> ")}.`,
			);
		}
		visiting.push(...source.bundleIds);
		const bundleRows = Array.isArray(loaded.manifest.bundles)
			? (loaded.manifest.bundles as Record<string, unknown>[])
			: [];
		const dependencies = bundleRows.flatMap((bundle) =>
			Array.isArray(bundle.depends_on)
				? bundle.depends_on.filter((id): id is string => typeof id === "string")
				: [],
		);
		for (const dependency of dependencies) {
			if (source.bundleIds.includes(dependency)) continue;
			const dependencyPath = options.resolveDependency(dependency, source);
			if (dependencyPath === undefined) {
				throw new Error(
					`loadBundleChainDetailed: dependency '${dependency}' required by '${source.bundleIds.join(", ")}' has no manifest path.`,
				);
			}
			visit(dependencyPath, dependency);
		}
		visiting.length -= source.bundleIds.length;
		for (const bundleId of source.bundleIds) completed.add(bundleId);
		mergeManifestRowsInto(manifest, loaded.manifest);
		sources.push(source);
	}

	visit(options.rootManifestPath, undefined, options.rootManifestText);
	return { manifest, sources };
}

export function loadBundleChain(
	dir: string,
	fixturesRoot: string = dirname(dir),
): Record<string, unknown> {
	return loadBundleChainDetailed({
		rootManifestPath: join(dir, "manifest.toml"),
		resolveDependency: (bundleId) => join(fixturesRoot, bundleId, "manifest.toml"),
	}).manifest;
}

function stableStringify(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	if (value !== null && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
			a.localeCompare(b),
		);
		return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
	}
	return JSON.stringify(value);
}

/** Order-insensitive per-kind row comparison. `include` is excluded by
 * default (loader-only/ignored by apply logic, not authored content — never
 * a drift signal); pass `ignoreKeys` to exclude any other top-level keys a
 * caller's manifest shape doesn't want compared. */
/** Whole-row stringify compare for harness drift (not the product `diffManifests`). */
export function diffManifestKindRows(
	oldManifest: Record<string, unknown>,
	newManifest: Record<string, unknown>,
	ignoreKeys: readonly string[] = ["include"],
): string[] {
	const diffs: string[] = [];
	const keys = new Set([...Object.keys(oldManifest), ...Object.keys(newManifest)]);
	for (const ignored of ignoreKeys) keys.delete(ignored);
	for (const key of keys) {
		const a = oldManifest[key];
		const b = newManifest[key];
		if (Array.isArray(a) || Array.isArray(b)) {
			const aSorted = (Array.isArray(a) ? a : []).map(stableStringify).sort();
			const bSorted = (Array.isArray(b) ? b : []).map(stableStringify).sort();
			if (JSON.stringify(aSorted) !== JSON.stringify(bSorted)) {
				const aSet = new Set(aSorted);
				const bSet = new Set(bSorted);
				const onlyOld = aSorted.filter((v) => !bSet.has(v));
				const onlyNew = bSorted.filter((v) => !aSet.has(v));
				diffs.push(
					`kind '${key}': ${onlyOld.length} row(s) only in OLD, ${onlyNew.length} row(s) only in NEW`,
				);
			}
		} else if (stableStringify(a) !== stableStringify(b)) {
			diffs.push(`field '${key}': OLD=${stableStringify(a)} NEW=${stableStringify(b)}`);
		}
	}
	return diffs;
}

/**
 * Supplementary RAW-TEXT check for u64-precision-risk fields (see
 * `restoreBigIntPrecision`'s comment): `semanticEqual`'s `inspectManifest`
 * pass parses BOTH sides through the SAME lossy wasm->JSON hop, so a future
 * precision regression would be invisible to it (both sides would
 * independently round to the SAME wrong value and compare equal). This check
 * never goes through JSON — it greps the exact digit strings from the raw
 * flattened text on both sides.
 */
export function diffBigIntFieldsRaw(
	oldText: string,
	newText: string,
	fields: readonly string[] = ["cell_res10", "cell_res7", "cell_res4"],
): string[] {
	const diffs: string[] = [];
	for (const field of fields) {
		const pattern = new RegExp(`^${field} = (-?\\d+)$`, "gm");
		const oldValues = [...oldText.matchAll(pattern)].map((m) => m[1]).sort();
		const newValues = [...newText.matchAll(pattern)].map((m) => m[1]).sort();
		if (JSON.stringify(oldValues) !== JSON.stringify(newValues)) {
			diffs.push(
				`RAW field '${field}' (u64 precision check): OLD=${JSON.stringify(oldValues)} NEW=${JSON.stringify(newValues)}`,
			);
		}
	}
	return diffs;
}

/** Full drift check between two on-disk manifest directories: semantic
 * per-kind diff (order-insensitive) plus the raw u64-precision sweep. */
export function semanticEqual(
	oldDir: string,
	newDir: string,
	opts: { ignoreKeys?: readonly string[]; bigIntFields?: readonly string[] } = {},
): string[] {
	const oldText = loadFlattened(oldDir);
	const newText = loadFlattened(newDir);
	const oldManifest = inspectManifest(oldText).manifest as Record<string, unknown>;
	const newManifest = inspectManifest(newText).manifest as Record<string, unknown>;
	return [
		...diffManifestKindRows(oldManifest, newManifest, opts.ignoreKeys),
		...diffBigIntFieldsRaw(oldText, newText, opts.bigIntFields),
	];
}

/** Run `check` (write outputs to a scratch temp dir, semantic-diff against
 * `committedDir`, clean up) OR write outputs directly to `committedDir` — the
 * shared `--check`/write fork every generator script needs. Returns the
 * drift diagnostics in check mode (empty = clean); returns `null` in write mode. */
export function checkOrWrite(
	committedDir: string,
	bundle: Record<string, unknown>,
	metadata: Record<string, unknown>,
	includeOrder: readonly string[],
	files: readonly FileEntry[],
	options: { check: boolean } = { check: false },
): string[] | null {
	if (!options.check) {
		writeOutputs(committedDir, bundle, metadata, includeOrder, files);
		return null;
	}
	const tmpDir = mkdtempSync(join(tmpdir(), "authoring-harness-check-"));
	try {
		writeOutputs(tmpDir, bundle, metadata, includeOrder, files);
		return semanticEqual(committedDir, tmpDir);
	} finally {
		rmSync(tmpDir, { recursive: true, force: true });
	}
}
