/** Node-owned local-folder implementation of the transport-neutral AUTHOR target. */
import { isDeepStrictEqual } from "node:util";
import type { AuthorTarget, ManifestRow } from "@spellkave/tool-authoring";
import type { FilesystemPort } from "@spellkave/tool-runtime";
import {
	inspectManifest,
	loadBundleChainDetailed,
	ROW_KIND_NATURAL_KEY,
	renderSchemaManifest,
	validateManifestToml,
	withRootApplyset,
} from "@spellkave/world-author";
import { nodeFilesystem } from "../filesystem.ts";
import { entityReferenceFields, planEntityRemoval } from "./remove-entity.ts";

export interface LocalAuthorTargetOptions {
	fixturesRoot?: string;
	/** Scratch TOML supplies bundle dependencies until the root is first written. */
	readPendingManifest?: () => string | null;
	/** Explicit bundle-ID to manifest paths; unlisted IDs use the fixture-root layout. */
	dependencyManifests?: Readonly<Record<string, string>>;
	warn?: (warning: string) => void;
	filesystem?: FilesystemPort;
}
export class LocalAuthorTargetDirectoryError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LocalAuthorTargetDirectoryError";
	}
}
/** A dependency path could not be resolved; callers can offer configuration recovery. */
export class LocalAuthorDependencyError extends Error {
	constructor(
		readonly bundleId: string,
		readonly manifestPath: string,
		message: string,
		options?: ErrorOptions,
	) {
		super(message, options);
		this.name = "LocalAuthorDependencyError";
	}
}
export interface ResolveLocalAuthorTargetOptions extends LocalAuthorTargetOptions {}
export interface ResolvedLocalAuthorTarget {
	target: AuthorTarget;
	dir: string;
}
const rowsOfKind = (manifest: Record<string, unknown>, rowKind: string): ManifestRow[] =>
	Array.isArray(manifest[rowKind]) ? (manifest[rowKind] as ManifestRow[]) : [];

const sameRow = (a: ManifestRow, b: ManifestRow): boolean => {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	return [...keys].every((field) => JSON.stringify(a[field]) === JSON.stringify(b[field]));
};

const APPLYSET_NAME = /^[a-z0-9][a-z0-9._-]*$/;

/** The applyset for a root being created: its only bundle's id, when that is a valid name. */
const newRootApplyset = (manifest: Record<string, unknown>): string | undefined => {
	if (typeof manifest.applyset === "string") return undefined;
	const bundles = rowsOfKind(manifest, "bundles");
	const id = bundles.length === 1 ? bundles[0]?.bundle_id : undefined;
	return typeof id === "string" && APPLYSET_NAME.test(id) ? id : undefined;
};

const metadataAttachmentIdentity = (row: ManifestRow): string | undefined => {
	const fields = ["target_kind", "target_ref", "namespace", "bundle_id"];
	if (!fields.every((field) => typeof row[field] === "string")) return undefined;
	return JSON.stringify(fields.map((field) => row[field]));
};

const metadataNamespaceIdentity = (row: ManifestRow): string | undefined => {
	if (typeof row.namespace !== "string" || typeof row.bundle_id !== "string") return undefined;
	return JSON.stringify([row.namespace, row.bundle_id]);
};

export function createLocalAuthorTarget(
	dir: string,
	options: LocalAuthorTargetOptions = {},
): AuthorTarget {
	const filesystem = options.filesystem ?? nodeFilesystem;
	const fileTarget = dir.endsWith(".toml") || (filesystem.exists(dir) && filesystem.isFile(dir));
	const bundleDir = fileTarget ? filesystem.dirname(dir) : dir;
	const rootPath = fileTarget ? dir : filesystem.join(dir, "manifest.toml");
	const fixturesRoot = options.fixturesRoot ?? filesystem.dirname(bundleDir);
	let cache: Record<string, unknown> | undefined;
	const resolveDependency = (bundleId: string): string => {
		const mapped = Object.hasOwn(options.dependencyManifests ?? {}, bundleId)
			? options.dependencyManifests?.[bundleId]
			: undefined;
		const dependencyPath = mapped ?? filesystem.join(fixturesRoot, bundleId, "manifest.toml");
		if (mapped?.startsWith("~")) {
			throw new LocalAuthorDependencyError(
				bundleId,
				dependencyPath,
				`dependency '${bundleId}': literal ~ paths are not expanded; use an absolute path instead: ${mapped}`,
			);
		}
		try {
			if (!filesystem.exists(dependencyPath)) {
				throw new LocalAuthorDependencyError(
					bundleId,
					dependencyPath,
					`dependency '${bundleId}' manifest not found: ${dependencyPath}`,
				);
			}
		} catch (error) {
			if (error instanceof LocalAuthorDependencyError) throw error;
			throw new LocalAuthorDependencyError(
				bundleId,
				dependencyPath,
				`dependency '${bundleId}' manifest is not readable: ${dependencyPath}: ${error instanceof Error ? error.message : String(error)}`,
				{ cause: error },
			);
		}
		return dependencyPath;
	};
	let pendingBundles: string | undefined;
	const chain = () => {
		if (filesystem.exists(rootPath)) {
			cache ??= loadBundleChainDetailed({ rootManifestPath: rootPath, resolveDependency }).manifest;
			return cache;
		}
		const pending = options.readPendingManifest?.();
		// Only headers are needed: scratch rows are already checked by the verbs.
		// Key the cache by headers so defining/changing depends_on takes effect
		// without reloading dependencies for every added scratch row.
		const headers = pending
			? rowsOfKind(inspectManifest(pending).manifest as Record<string, unknown>, "bundles")
			: [];
		const headerText = renderSchemaManifest({ schema_version: "1.0.0", bundles: headers });
		if (pendingBundles !== headerText) {
			cache = undefined;
			pendingBundles = headerText;
		}
		cache ??=
			headers.length === 0
				? { schema_version: "1.0.0" }
				: loadBundleChainDetailed({
						rootManifestPath: rootPath,
						rootManifestText: headerText,
						resolveDependency,
					}).manifest;
		return cache;
	};
	const ownManifest = () =>
		filesystem.exists(rootPath)
			? (inspectManifest(filesystem.readText(rootPath)).manifest as Record<string, unknown>)
			: { schema_version: "1.0.0" };
	const readIncludes = (manifest: Record<string, unknown>) =>
		rowsOfKind(manifest, "include").map((include) => {
			const path = String(include.path);
			return {
				path,
				manifest: inspectManifest(
					renderSchemaManifest({ schema_version: "1.0.0" }) +
						filesystem.readText(filesystem.resolve(bundleDir, path)),
				).manifest as Record<string, unknown>,
			};
		});
	const validateLocal = (
		merged: Record<string, unknown>,
		applyset?: string,
	): { rendered: string; detail?: string } => {
		const rendered =
			applyset === undefined
				? renderSchemaManifest(merged)
				: withRootApplyset(renderSchemaManifest(merged), applyset);
		// Validate the pending root, its includes and dependency closure before
		// writing. A missing dependency keeps the local-bundle diagnostic fallback
		// for the validator's implicit core exemption.
		let closure = rendered;
		try {
			closure = renderSchemaManifest(
				loadBundleChainDetailed({
					rootManifestPath: rootPath,
					rootManifestText: rendered,
					resolveDependency,
				}).manifest,
			);
		} catch (error) {
			if (!(error instanceof LocalAuthorDependencyError))
				return {
					rendered,
					detail: `local target: ${error instanceof Error ? error.message : String(error)}`,
				};
			// Dependencies can be absent (core is implicit to the validator),
			// but local includes must still participate in the fallback check.
			const local = { ...merged };
			for (const { manifest } of readIncludes(merged)) {
				for (const [kind, rows] of Object.entries(manifest)) {
					if (Array.isArray(rows) && kind !== "include")
						local[kind] = [...rowsOfKind(local, kind), ...rows];
				}
			}
			closure = renderSchemaManifest(local);
		}
		const fatal = validateManifestToml(closure).filter(
			(diagnostic) => diagnostic.severity === "fatal",
		);
		if (fatal.length > 0)
			return {
				rendered,
				detail: fatal.map((d) => `${d.code}: ${d.message} (${d.path})`).join("; "),
			};
		return { rendered };
	};
	return {
		kind: "local",
		resolveRef(rowKind, id) {
			const key = ROW_KIND_NATURAL_KEY[rowKind];
			return key !== undefined && rowsOfKind(chain(), rowKind).some((row) => row[key] === id);
		},
		lookup(rowKind, filter) {
			const rows = rowsOfKind(chain(), rowKind);
			// perf(world-author, sk-jay0.7.23.35): an unfiltered call returns the
			// SAME array reference every time (until `applyBatch` invalidates
			// `cache` and `chain()` rebuilds it) instead of a fresh `.filter()`
			// copy of identical elements. Read-only callers (verified: no
			// `.push`/`.splice`/index-assignment on a `lookup()` result anywhere
			// in the tree) are unaffected. Measured (sk-jay0.7.23.35 profiling):
			// this alone is a small slice of `commitOrReport`'s target-aware cost
			// (`augmentForValidation`'s own diff is ~10% of a call;
			// `renderSchemaManifest`+`validateManifestToml` over the augmented
			// manifest dominate) — kept as a no-regret optimization and as the
			// stable-reference building block a future caller-side cache (or a
			// narrower augmentation) can key on, not a fix by itself.
			return filter?.bundle === undefined
				? rows
				: rows.filter((row) => row.bundle_id === filter.bundle);
		},
		async removeEntity(entityKey, workspace) {
			const beforeRoot = filesystem.exists(rootPath) ? filesystem.readText(rootPath) : null;
			const beforeScratch = workspace.readToml();
			try {
				const root = ownManifest();
				const scratch = beforeScratch?.trim()
					? (inspectManifest(beforeScratch).manifest as Record<string, unknown>)
					: { schema_version: "1.0.0" };
				if (rowsOfKind(scratch, "include").length > 0)
					return {
						ok: false,
						detail:
							"local target: remove_entity requires a flat scratch; its include files were left unchanged.",
					};
				for (const fragment of readIncludes(root)) {
					for (const rows of Object.values(fragment.manifest)) {
						if (
							Array.isArray(rows) &&
							rows.some((row) => entityReferenceFields(row, entityKey).length > 0)
						)
							return {
								ok: false,
								detail: `local target: '${entityKey}' is owned or referenced by include '${fragment.path}'; edit that file. No files were written.`,
							};
					}
				}
				const rootPlan = planEntityRemoval(root, entityKey);
				const scratchPlan = planEntityRemoval(scratch, entityKey);
				const detail = rootPlan.detail ?? scratchPlan.detail;
				if (detail !== undefined) return { ok: false, detail };
				const rootChanged = Object.keys(rootPlan.removed).length > 0;
				const scratchChanged = Object.keys(scratchPlan.removed).length > 0;
				const ownsEntity = [
					...rowsOfKind(root, "entities"),
					...rowsOfKind(scratch, "entities"),
				].some((row) => row.entity_key === entityKey);
				if (!ownsEntity && (rootChanged || scratchChanged))
					return {
						ok: false,
						detail: `local target: entity '${entityKey}' is not authored in the root or scratch; dependent rows were left unchanged.`,
					};
				const checked = rootChanged ? validateLocal(rootPlan.manifest) : undefined;
				if (checked?.detail !== undefined) return { ok: false, detail: checked.detail };
				const nextScratch = scratchChanged ? renderSchemaManifest(scratchPlan.manifest) : null;
				// Validate both plans before persistence. Restore prior bytes if either
				// host write fails; include files never enter this write set.
				let scratchAttempted = false;
				let rootAttempted = false;
				try {
					if (nextScratch !== null) {
						scratchAttempted = true;
						workspace.writeToml(nextScratch);
					}
					if (checked !== undefined) {
						rootAttempted = true;
						filesystem.writeText(rootPath, checked.rendered);
					}
				} catch (error) {
					const failures: string[] = [];
					if (beforeScratch !== null && scratchAttempted) {
						try {
							workspace.writeToml(beforeScratch);
						} catch {
							failures.push("scratch restore failed");
						}
					}
					if (beforeRoot !== null && rootAttempted) {
						try {
							filesystem.writeText(rootPath, beforeRoot);
						} catch {
							failures.push("root restore failed");
						}
					}
					return {
						ok: false,
						detail: `local target: removal write failed: ${String(error)}${failures.length ? `; ${failures.join("; ")}` : "; previous content restored"}`,
					};
				}
				cache = undefined;
				return { ok: true, removed: { root: rootPlan.removed, workspace: scratchPlan.removed } };
			} catch (error) {
				return { ok: false, detail: `local target: could not prepare removal: ${String(error)}` };
			}
		},
		async applyBatch(toml) {
			let delta: Record<string, unknown>;
			try {
				delta = inspectManifest(toml).manifest as Record<string, unknown>;
			} catch (error) {
				return { ok: false, detail: `local target: could not parse delta TOML: ${String(error)}` };
			}
			const merged = { ...ownManifest() } as Record<string, unknown>;
			// Only the root is rewritten. Preserve fragment bytes and refuse an edit
			// to an include-owned row rather than writing a second copy in the root.
			let fragments: { path: string; manifest: Record<string, unknown> }[];
			try {
				fragments = readIncludes(merged);
			} catch (error) {
				return { ok: false, detail: `local target: could not read include: ${String(error)}` };
			}
			if (delta.metadata !== undefined) {
				if (
					delta.metadata === null ||
					typeof delta.metadata !== "object" ||
					Array.isArray(delta.metadata)
				)
					return { ok: false, detail: "local target: manifest metadata must be an object." };
				const existing = merged.metadata;
				if (
					existing !== undefined &&
					(existing === null || typeof existing !== "object" || Array.isArray(existing))
				)
					return {
						ok: false,
						detail: "local target: existing manifest metadata must be an object.",
					};
				// Root metadata is owned by the local root only. A delta replaces named
				// top-level keys but never merges dependency metadata into this file.
				merged.metadata = {
					...(existing as Record<string, unknown> | undefined),
					...delta.metadata,
				};
			}
			for (const [table, rows] of Object.entries(delta)) {
				if (!Array.isArray(rows)) continue;
				const key = ROW_KIND_NATURAL_KEY[table];
				const existing = rowsOfKind(merged, table);
				for (const row of rows as ManifestRow[]) {
					if (table === "metadata_namespaces") {
						const foreignOwner = [...existing, ...rowsOfKind(chain(), "metadata_namespaces")].find(
							(item) => item.namespace === row.namespace && item.bundle_id !== row.bundle_id,
						);
						if (foreignOwner !== undefined)
							return {
								ok: false,
								detail: `local target: namespace '${String(row.namespace)}' is already owned by bundle '${String(foreignOwner.bundle_id)}'.`,
							};
					}
					const specialIdentity =
						table === "metadata_attachments"
							? metadataAttachmentIdentity(row)
							: table === "metadata_namespaces"
								? metadataNamespaceIdentity(row)
								: undefined;
					const includeOwner = fragments.find(({ manifest }) =>
						rowsOfKind(manifest, table).some((item) =>
							key !== undefined
								? item[key] === row[key]
								: specialIdentity !== undefined
									? (table === "metadata_attachments"
											? metadataAttachmentIdentity(item)
											: metadataNamespaceIdentity(item)) === specialIdentity
									: isDeepStrictEqual(item, row),
						),
					);
					if (includeOwner !== undefined) {
						if (
							rowsOfKind(includeOwner.manifest, table).some((item) => isDeepStrictEqual(item, row))
						)
							continue;
						return {
							ok: false,
							detail: `local target: ${table} row '${String(key === undefined ? specialIdentity : row[key])}' is owned by include '${includeOwner.path}'; edit that file. No files were written.`,
						};
					}
					const matches =
						specialIdentity === undefined
							? []
							: existing
									.map((item, index) => ({ item, index }))
									.filter(({ item }) =>
										table === "metadata_attachments"
											? metadataAttachmentIdentity(item) === specialIdentity
											: metadataNamespaceIdentity(item) === specialIdentity,
									);
					if (matches.length > 1)
						return {
							ok: false,
							detail: `local target: ambiguous ${table} identity; repair duplicate rows before applying.`,
						};
					const index =
						matches.length === 1
							? (matches[0]?.index ?? -1)
							: key === undefined
								? -1
								: existing.findIndex((item) => item[key] === row[key]);
					if (index >= 0) existing[index] = row;
					// A keyless row cannot upsert, and the scratch re-sends every row on
					// each flush: skip an exact copy instead of appending it again
					// (sk-jay0.3.26.23).
					else if (
						key === undefined &&
						specialIdentity === undefined &&
						existing.some((item) => sameRow(item, row))
					)
						continue;
					else existing.push(row);
				}
				merged[table] = existing;
			}
			// A new root is named after its single bundle (ADR-0145 D-1), as every
			// generator names its root, so `sk dev seed` accepts it (sk-jay0.3.26.8).
			// An existing root keeps whatever applyset it has, or none.
			const applyset = filesystem.exists(rootPath) ? undefined : newRootApplyset(merged);
			const { rendered, detail } = validateLocal(merged, applyset);
			if (detail !== undefined) return { ok: false, detail };
			filesystem.ensureDirectory(filesystem.dirname(rootPath));
			filesystem.writeText(rootPath, rendered);
			cache = undefined;
			return applyset === undefined ? { ok: true } : { ok: true, applyset };
		},
	};
}

export function resolveLocalAuthorTarget(
	dir: string,
	options: ResolveLocalAuthorTargetOptions = {},
): ResolvedLocalAuthorTarget {
	if (dir.trim().length === 0)
		throw new LocalAuthorTargetDirectoryError("local author target dir must be a non-empty path.");
	const filesystem = options.filesystem ?? nodeFilesystem;
	const resolvedDir = filesystem.resolve(dir);
	return {
		dir: resolvedDir,
		target: createLocalAuthorTarget(resolvedDir, {
			...options,
			fixturesRoot:
				options.fixturesRoot === undefined ? undefined : filesystem.resolve(options.fixturesRoot),
			filesystem,
		}),
	};
}
