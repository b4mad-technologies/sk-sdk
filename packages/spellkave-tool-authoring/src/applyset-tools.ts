import {
	type ScopedInstanceSnapshot,
	scopedComparableIdentities,
	scopedComparableManifest,
} from "@spellkave/world-author/tooling";
// `spellkave_applyset_diff` / `spellkave_applyset_apply` (ADR-0145, ADR-0144
// D-9; openspec change `sk-diff-apply`): the kubectl client-side apply loop
// for Spellkave manifests. `sk diff -k` / `sk apply -k` project these tools.
//
// This module only orchestrates: it reads the root and the include files the
// Rust core names, reads the applyset memory and the live exports through host
// ports, calls `classifyAndBuildDelta` (Rust, through wasm) and sends its
// delta. It derives no row identity, hash, class or delta row itself.

import {
	APPLYSET_APPLY_PARAMS,
	APPLYSET_APPLY_TOOL,
	APPLYSET_DIFF_PARAMS,
	APPLYSET_DIFF_TOOL,
} from "@spellkave/tool-contracts/schemas";
import type { FilesystemPort, NodeToolCapabilities } from "@spellkave/tool-runtime";
import {
	type ApplysetAuthoritySnapshot,
	type ApplysetClassifiedRow,
	type ApplysetDiffOutput,
	type ApplysetExtentScope,
	type ApplysetMemory,
	type ApplysetPartSource,
	type ApplysetRowClass,
	applysetRootInfo,
	classifyAndBuildDelta,
	manifestRowIdentities,
} from "@spellkave/world-author/tooling";
import type { Static } from "typebox";
import type { LivePlace, WorldRowsOnEntity } from "./applyset-world-rows.ts";
import {
	classifyWorldAdded,
	equipmentSlotsFromEntries,
	memoryViewFromEntries,
	seedsFromCollected,
	type WorldAddedOnEntity,
} from "./applyset-world-rows.ts";
import type { AuthorToolContext, AuthorToolResult } from "./authoring";
import { type PortableSource, portableSourceFilesystem, sourcePath } from "./portable-source";
import { defineTool } from "./tool-registry.ts";

/** One `r_apply_bundle` call (ADR-0145 D-4). */
export interface ApplyBundleCall {
	deltaToml: string;
	applyset: string;
	rootPath: string;
	partsJson: string;
	expectedGeneration: number;
	force: boolean;
	/** Absent only for the transitional legacy adapter. */
	bundleIds?: string[];
}

/**
 * Host port for the applyset memory and `r_apply_bundle`. Absent = the two
 * applyset tools refuse as not connected.
 */
export interface ApplysetPort {
	/** The world's memory of one applyset, or `null` when it has none. */
	readScopedSnapshot?(): Promise<ScopedInstanceSnapshot>;
	readApplyset(applyset: string): Promise<ApplysetMemory | null>;
	/** Cached sender grants and public memory; no placement authority inference. */
	readExtentScope?(): Promise<ApplysetExtentScope | undefined>;
	readAuthoritySnapshot?(): Promise<ApplysetAuthoritySnapshot | undefined>;
	/** One `r_apply_bundle` call, awaited until its seal or its failure. */
	applyBundle(call: ApplyBundleCall): Promise<{ ok: true } | { ok: false; detail: string }>;
	/**
	 * The root path the server records for a root file: relative to the
	 * worktree root, as `sk dev seed` passes it.
	 */
	rootPathFor(absoluteRootFile: string): string;
	/** True only when the session opened the owner-table subscription. */
	readsAsPublisher?(): boolean;
	/** Rows on one retracted entity, or `"not_subscribed"` when the owner
	 * tables or the five definition-seed catalogs are not in cache. */
	worldRows?(entityId: string): WorldRowsOnEntity | "not_subscribed";
	/** Numeric id from the cached `visible_manifest_authored_entity` row. */
	authoredEntityId?(bundleId: string, entityKey: string): string | null;
	/** Owner-subscription places for prune reconstruction, or not subscribed. */
	livePlaces?(): LivePlace[] | "not_subscribed";
	/** Applying publisher identity hex; `$sender` in memory stands for this. */
	publisherIdentity?(): string | null;
}

type ClassCounts = Record<ApplysetRowClass, number>;

interface LiveReport {
	exported: string[];
	not_exported: Array<{ bundle_id: string; reason: string }>;
	not_comparable: number;
	source?: ScopedInstanceSnapshot["source"];
}

interface ApplysetComputation {
	out: ApplysetDiffOutput;
	counts: ClassCounts;
	live: LiveReport;
	bundleIds?: string[];
}

function toolResult<T>(details: T): AuthorToolResult<T> {
	return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
}

function message(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function basename(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1);
}

/** A root directory or root file -> the absolute root file. */
function rootFile(filesystem: FilesystemPort, tool: string, given: string): string {
	const resolved = filesystem.resolve(given);
	const file = filesystem.isFile(resolved) ? resolved : filesystem.join(resolved, "manifest.toml");
	if (!filesystem.isFile(file)) {
		throw new Error(`${tool}: no root manifest at '${given}' (looked for ${file}).`);
	}
	return file;
}

function readText(filesystem: FilesystemPort, tool: string, path: string): string {
	try {
		return filesystem.readText(path);
	} catch (err) {
		throw new Error(`${tool}: cannot read '${path}': ${message(err)}`);
	}
}

/** Read a root and its includes (in the order the Rust core names them). */
function readRoot(
	filesystem: FilesystemPort,
	tool: string,
	given: string,
): {
	file: string;
	root: ApplysetPartSource;
	files: Record<string, string>;
	applyset: string | null;
	bundles: string[];
} {
	const file = rootFile(filesystem, tool, given);
	const toml = readText(filesystem, tool, file);
	let info: ReturnType<typeof applysetRootInfo>;
	try {
		info = applysetRootInfo(toml);
	} catch (err) {
		throw new Error(`${tool}: '${file}' does not parse: ${message(err)}`);
	}
	const dir = filesystem.dirname(file);
	const files: Record<string, string> = {};
	for (const include of info.includes) {
		files[include] = readText(filesystem, tool, filesystem.join(dir, include));
	}
	return {
		file,
		root: { path: basename(file), toml },
		files,
		applyset: info.applyset,
		bundles: info.bundles,
	};
}

async function computeApplyset(
	context: AuthorToolContext,
	filesystem: FilesystemPort | undefined,
	tool: string,
	params: { dir?: string; source?: PortableSource; dep?: string[]; force?: boolean },
	prune: boolean,
): Promise<ApplysetComputation> {
	if ((params.dir === undefined) === (params.source === undefined))
		throw new Error(`${tool}: supply exactly one of dir or source.`);
	if (params.source !== undefined) {
		if ((params.dep?.length ?? 0) > 0)
			throw new Error(`${tool}: source mode cannot read dependency paths.`);
		filesystem = portableSourceFilesystem(params.source);
	}
	if (filesystem === undefined)
		throw new Error(
			`${tool}: hosted authoring requires source { root_path, root_toml, fragments }; local dir needs a filesystem port.`,
		);
	const port = context.applyset;
	if (port === undefined) {
		throw new Error(`${tool}: not connected — it reads the world's applyset memory.`);
	}
	const root = readRoot(filesystem, tool, params.source?.root_path ?? params.dir!);
	if (root.applyset === null) {
		throw new Error(
			`${tool}: MF-APPLYSET-LOAD: '${root.file}' declares no applyset; ` +
				'add a top-level `applyset = "<name>"` to the root manifest (ADR-0145).',
		);
	}
	const dependencies = (params.dep ?? []).map((dep) => {
		const read = readRoot(filesystem, tool, dep);
		return {
			root: read.root,
			fragments: Object.entries(read.files).map(([path, toml]) => ({ path, toml })),
		};
	});
	const memory = await port.readApplyset(root.applyset);
	const live: LiveReport = { exported: [], not_exported: [], not_comparable: 0 };
	const exports: Array<{ bundle_id: string; manifest_json: string }> = [];
	let scoped: ScopedInstanceSnapshot | undefined;
	if (port.readsAsPublisher?.() === false && port.readScopedSnapshot) {
		try {
			scoped = await port.readScopedSnapshot();
			live.source = scoped.source;
		} catch {
			/* Named unavailable comparison below; no publisher fallback. */
		}
	}

	const comparisonBundles =
		port.readsAsPublisher?.() === false
			? [
					...new Set([
						...root.bundles,
						...[
							[root.root.toml, true] as const,
							...Object.values(root.files).map((toml) => [toml, false] as const),
						].flatMap(([toml, isRoot]) =>
							manifestRowIdentities(toml, isRoot)
								.rows.map((row) => row.bundle_id)
								.filter((id): id is string => Boolean(id)),
						),
					]),
				]
			: root.bundles;
	for (const bundle of comparisonBundles) {
		if (scoped) {
			exports.push({ bundle_id: bundle, manifest_json: scopedComparableManifest(scoped, bundle) });
			live.exported.push(bundle);
			continue;
		}
		if (port.readsAsPublisher?.() === false) {
			live.not_exported.push({ bundle_id: bundle, reason: "reader_unavailable" });
			continue;
		}

		if (context.exportManifest === undefined) {
			live.not_exported.push({ bundle_id: bundle, reason: "no export port" });
			continue;
		}
		try {
			const row = await context.exportManifest(bundle);
			exports.push({ bundle_id: bundle, manifest_json: row.manifestJson });
			live.exported.push(bundle);
		} catch (err) {
			// `core`, over-limit bundles (MF-EXPORT-010/011) and export failures:
			// drift is information only, so the diff goes on without it.
			live.not_exported.push({
				bundle_id: bundle,
				reason: /publisher|operator/i.test(message(err))
					? "the connection cannot read live rows (the export is publisher-only)"
					: message(err),
			});
		}
	}
	let live_places: LivePlace[] = [];
	let places_read = false;
	if (port.readsAsPublisher?.() !== false && port.livePlaces !== undefined) {
		const places = port.livePlaces();
		if (places !== "not_subscribed") {
			live_places = places;
			places_read = true;
		}
	}
	if (scoped) {
		live_places = exports.flatMap(({ manifest_json }) => {
			const manifest = JSON.parse(manifest_json) as {
				entities?: { entity_key: string; place_node_id?: string }[];
			};
			return (manifest.entities ?? []).map((row) => ({
				kind: "entities",
				key: row.entity_key,
				place_node_id: row.place_node_id ?? "",
			}));
		});
		places_read =
			scoped.source.coverage.entities === "complete" &&
			scoped.source.coverage.actor_spatial_locations === "complete";
	}
	const extentScope = await port.readExtentScope?.();
	const authority = await port.readAuthoritySnapshot?.();
	const out = classifyAndBuildDelta({
		root: root.root,
		root_path:
			params.source === undefined
				? port.rootPathFor(root.file)
				: sourcePath(params.source.root_path),
		files: root.files,
		memory,
		prune,
		dependencies,
		live: exports,
		live_places,
		places_read,
		not_exported: live.not_exported,
		force: params.force === true,
		applying_identity: port.publisherIdentity?.() ?? undefined,
		extent_scope: extentScope,
		authority,
	});
	if (port.readsAsPublisher?.() === false) {
		const captured = scoped;
		const observed = captured
			? exports.flatMap(({ bundle_id }) => scopedComparableIdentities(captured, bundle_id))
			: [];

		for (const row of out.rows.filter(
			(row) =>
				["create", "configure", "adopt", "prune"].includes(row.class) &&
				row.kind !== "role_bindings",
		)) {
			let reason =
				scoped?.source.coverage[row.kind] ?? (scoped ? "unsupported_kind" : "reader_unavailable");
			if (reason === "complete" && scoped) {
				const found = observed.some(
					(item) =>
						item.kind === row.kind && item.key === row.key && item.bundle_id === row.bundle_id,
				);
				if (!found && !scoped.source.authorized_bundles?.includes(row.bundle_id ?? ""))
					reason = "outside_read_scope";
			}

			const baseline = out.not_checked.find(
				(item) => item.kind === row.kind && item.key === row.key,
			);
			if (reason === "complete" && baseline)
				reason = baseline.reason.includes("comparable hash") ? "missing_baseline" : baseline.reason;
			if (reason !== "complete") {
				out.not_checked = out.not_checked.filter(
					(item) => item.kind !== row.kind || item.key !== row.key,
				);
				out.not_checked.push({ kind: row.kind, key: row.key, reason });
				row.world_changed = { state: "unknown", reason };
				out.conflicts = out.conflicts.filter(
					(item) => item.kind !== row.kind || item.key !== row.key,
				);
				out.values = out.values.filter((item) => item.kind !== row.kind || item.key !== row.key);
			}
		}
	}
	const counts: ClassCounts = {
		create: 0,
		adopt: 0,
		configure: 0,
		move: 0,
		prune: 0,
		unchanged: 0,
	};
	for (const row of out.rows) {
		counts[row.class] += 1;
		if (row.live === "not_comparable") live.not_comparable += 1;
	}
	// Binding-only deltas need no bundle declaration. Stamp every supplied
	// entry's bundle (including world-owned "") so the scoped server verifies
	// the actual payload rather than rejecting an empty root bundle list.
	const payloadBundles = [
		...new Set([
			...root.bundles,
			...out.parts.flatMap((part) =>
				part.entries.flatMap((entry) => (entry.bundle_id == null ? [] : [entry.bundle_id])),
			),
		]),
	];
	return { out, counts, live, bundleIds: extentScope === undefined ? undefined : payloadBundles };
}

/** The rows worth showing: every difference and every drifted row. */
function shownRows(out: ApplysetDiffOutput): ApplysetClassifiedRow[] {
	return out.rows.filter((row) => row.class !== "unchanged" || row.live === "drift");
}

function hasDifferences(counts: ClassCounts): boolean {
	return counts.create + counts.adopt + counts.configure + counts.move + counts.prune > 0;
}

function diffDetails(kind: string, { out, counts, live }: ApplysetComputation) {
	return {
		ok: out.diagnostics.length === 0,
		kind,
		applyset: out.applyset,
		root_path: out.root_path,
		generation: out.generation,
		base_state: out.base_state,
		differences: hasDifferences(counts),
		counts,
		rows: shownRows(out),
		warnings: out.warnings,
		diagnostics: out.diagnostics,
		refused_by_extent: out.extent_verdicts,
		authority_verdicts: out.authority_verdicts ?? [],
		placement_server_decides: out.placement_server_decides,
		values: out.values,
		conflicts: out.conflicts,
		not_checked: out.not_checked,
		seal_drift_not_checked: out.seal_drift_not_checked ?? [],
		live_only: out.live_only,
		live,
	};
}

export const applysetDiffToolDef = defineTool<
	AuthorToolContext,
	typeof APPLYSET_DIFF_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: APPLYSET_DIFF_TOOL,
	schema: APPLYSET_DIFF_PARAMS,
	run: async (
		context: AuthorToolContext,
		params: Static<typeof APPLYSET_DIFF_PARAMS>,
		_toolCallId,
		capabilities,
	) => {
		const computed = await computeApplyset(
			context,
			capabilities?.node?.filesystem,
			APPLYSET_DIFF_TOOL,
			params,
			params.prune === true,
		);
		const base = diffDetails("applyset_diff", computed);
		if (params.prune !== true) return toolResult(base);
		const port = context.applyset as ApplysetPort;
		const memory = await port.readApplyset(computed.out.applyset);
		const hasEntityPrune = computed.out.rows.some(
			(row) => row.class === "prune" && row.kind === "entities",
		);
		const inspected =
			port.readsAsPublisher?.() === false && hasEntityPrune
				? {
						cannotLook: "scope_prune_unsupported: entity prune preview requires publisher closure",
						added: [],
					}
				: inspectPrunedEntities(port, computed.out, memory, true);
		return toolResult({
			...base,
			prune: true,
			sent: false,
			world_added_rows: worldAddedMap(inspected.added),
			...(inspected.cannotLook === false
				? {}
				: { ok: false, error: `cannot look: ${inspected.cannotLook}` }),
		});
	},
});

const RESULT_FOR: Record<ApplysetRowClass, string> = {
	create: "created",
	adopt: "adopted",
	configure: "configured",
	move: "moved",
	prune: "pruned",
	unchanged: "unchanged",
};

/** The MF-* code at the front of a reducer or outcome failure, if any. */
function failureCode(detail: string): string | undefined {
	return /MF-[A-Z]+-[0-9A-Z-]+/.exec(detail)?.[0];
}

export type ForceUsed = Array<"root_takeover" | "world_added_rows" | "world_changed">;

function forceUsed(args: {
	force: boolean;
	takeover: boolean;
	worldAdded: boolean;
	worldChanged: boolean;
}): ForceUsed | undefined {
	if (!args.force) return undefined;
	const used: ForceUsed = [];
	if (args.takeover) used.push("root_takeover");
	if (args.worldAdded) used.push("world_added_rows");
	if (args.worldChanged) used.push("world_changed");
	return used.length ? used : undefined;
}

function worldAddedMap(
	rows: WorldAddedOnEntity[],
): Record<string, { taken: unknown; left_behind: unknown }> {
	return Object.fromEntries(
		rows.map((row) => [row.key, { taken: row.taken, left_behind: row.left_behind }]),
	);
}

function inspectPrunedEntities(
	port: ApplysetPort,
	out: ApplysetDiffOutput,
	memory: ApplysetMemory | null,
	prune: boolean,
): { cannotLook: false | string; added: WorldAddedOnEntity[] } {
	// Without --prune the core still classes dropped rows `prune` (candidates
	// kept in the part). Inspect contents only with requested prune semantics.
	if (!prune) {
		return { cannotLook: false, added: [] };
	}
	const pruned = out.rows.filter((row) => row.class === "prune" && row.kind === "entities");
	if (pruned.length === 0) {
		return { cannotLook: false, added: [] };
	}
	const cannotLook = (reason: string) => ({
		cannotLook: reason,
		added: [] as WorldAddedOnEntity[],
	});
	// D-8 cannot-look list: no worldRows / not_subscribed / unknown authored id /
	// not_comparable place or position.
	if (port.worldRows === undefined) {
		return cannotLook("no worldRows");
	}
	if (port.worldRows("0") === "not_subscribed") {
		return cannotLook("not_subscribed");
	}
	const entries = (memory?.parts ?? []).flatMap((part) => part.entries);
	const publisherIdentity = port.publisherIdentity?.() ?? undefined;
	const added: WorldAddedOnEntity[] = [];
	for (const row of pruned) {
		const spatial = out.rows.find(
			(candidate) =>
				candidate.class === "prune" &&
				candidate.kind === "actor_spatial_locations" &&
				candidate.key === row.key,
		);
		if (row.live === "not_comparable" || spatial?.live === "not_comparable") {
			return cannotLook("not_comparable place or position");
		}
		const bundleId = row.bundle_id ?? "";
		const entityId = port.authoredEntityId?.(bundleId, row.key);
		// D-8 cannot-look list: unknown authored id (never skip the entity).
		if (entityId === null || entityId === undefined) {
			return cannotLook("unknown authored id");
		}
		const collected = port.worldRows(entityId);
		if (collected === "not_subscribed") return cannotLook("not_subscribed");
		const memoryView = memoryViewFromEntries(entries, row.key, row.bundle_id ?? "");
		const classified = classifyWorldAdded({
			collected,
			memory: memoryView,
			seeds: seedsFromCollected(collected),
			publisherIdentity,
			equipmentSlots: equipmentSlotsFromEntries(entries, row.bundle_id ?? ""),
		});
		const taken = classified
			.filter((item) => item.heading === "taken")
			.map(({ heading: _, ...rest }) => rest);
		const left_behind = classified
			.filter((item) => item.heading === "left_behind")
			.map(({ heading: _, ...rest }) => rest);
		if (row.live === "drift") {
			const location = collected.rows.find((item) => item.table === "entity_location");
			if (location !== undefined && location.key !== "") {
				taken.push({ table: "entity_location", key: location.key });
			}
		}
		const position = collected.rows.find((item) => item.table === "actor_spatial_location");
		if (position !== undefined && memoryView.spatial !== true) {
			// D-8: a spatial row exists where none is expected.
			taken.push({ table: "actor_spatial_location", key: position.key });
		} else if (spatial?.live === "drift" && position !== undefined) {
			taken.push({
				table: "actor_spatial_location",
				key: position.key,
			});
		}
		if (taken.length > 0 || left_behind.length > 0) {
			added.push({ key: row.key, taken, left_behind });
		}
	}
	return { cannotLook: false, added };
}

export const applysetApplyToolDef = defineTool<
	AuthorToolContext,
	typeof APPLYSET_APPLY_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: APPLYSET_APPLY_TOOL,
	schema: APPLYSET_APPLY_PARAMS,
	run: async (
		context: AuthorToolContext,
		params: Static<typeof APPLYSET_APPLY_PARAMS>,
		_toolCallId,
		capabilities,
	) => {
		const prune = params.prune === true;
		const computed = await computeApplyset(
			context,
			capabilities?.node?.filesystem,
			APPLYSET_APPLY_TOOL,
			params,
			prune,
		);
		const { out, counts } = computed;
		const base = diffDetails("applyset_apply", computed);
		const pruneCandidates = prune
			? []
			: out.rows
					.filter((row) => row.class === "prune")
					.map(({ kind, key, part }) => ({
						kind,
						key,
						part,
					}));
		const report = {
			...base,
			prune,
			dry_run: params.dry_run === true,
			prune_candidates: pruneCandidates,
		};
		if (params.dry_run === true) return toolResult({ ...report, sent: false });
		if (out.diagnostics.length > 0) {
			return toolResult({
				...report,
				ok: false,
				sent: false,
				error: "refused before sending: the files cannot be applied as they are (see diagnostics)",
			});
		}
		const port = context.applyset as ApplysetPort;
		if (
			port.readsAsPublisher?.() === false &&
			prune &&
			out.rows.some((row) => row.class === "prune" && row.kind === "entities")
		) {
			return toolResult({
				...report,
				ok: false,
				sent: false,
				error: "scope_prune_unsupported: entity prune requires publisher closure",
			});
		}
		const unchecked = out.not_checked.filter((row) => row.kind !== "role_bindings");
		if (port.readsAsPublisher?.() === false && unchecked.length > 0) {
			return toolResult({
				...report,
				ok: false,
				sent: false,
				error: "unchecked_scoped_write: force cannot supply missing comparison coverage",
			});
		}
		const uncheckedSeals = out.seal_drift_not_checked ?? [];
		if (uncheckedSeals.length > 0 && params.force !== true) {
			return toolResult({
				...report,
				ok: false,
				sent: false,
				error: `seal row drift not checked (${uncheckedSeals.join(", ")}); pass --force to re-seal`,
			});
		}
		if (out.conflicts.length > 0 && params.force !== true) {
			return toolResult({
				...report,
				ok: false,
				sent: false,
				error: `${out.conflicts.length} row(s) changed in the world since the last apply; pass --force to write the files' rows`,
			});
		}
		if (!out.send) {
			return toolResult({ ...report, sent: false, results: [], generation_after: out.generation });
		}
		const memory = await port.readApplyset(out.applyset);
		const inspected = inspectPrunedEntities(port, out, memory, prune);
		const worldAdded = inspected.added.length > 0 || inspected.cannotLook !== false;
		const takeover = memory !== null && memory.root_path !== out.root_path;
		const used = forceUsed({
			force: params.force === true,
			takeover,
			worldAdded,
			worldChanged: out.conflicts.length > 0 || uncheckedSeals.length > 0,
		});
		if (inspected.cannotLook !== false && params.force !== true) {
			return toolResult({
				...report,
				ok: false,
				sent: false,
				error: `cannot look: ${inspected.cannotLook}`,
			});
		}
		if (inspected.added.length > 0 && params.force !== true) {
			return toolResult({
				...report,
				ok: false,
				sent: false,
				error: "world-added rows on pruned entities; pass --force to retract them",
				world_added_rows: worldAddedMap(inspected.added),
			});
		}
		const outcome = await port.applyBundle({
			bundleIds: computed.bundleIds,
			deltaToml: out.delta_toml,
			applyset: out.applyset,
			rootPath: out.root_path,
			partsJson: JSON.stringify(out.parts),
			expectedGeneration: out.generation,
			force: params.force === true,
		});
		if (!outcome.ok) {
			return toolResult({
				...report,
				ok: false,
				sent: true,
				error: outcome.detail,
				code: failureCode(outcome.detail),
			});
		}
		const addedByKey = new Map(inspected.added.map((row) => [row.key, row]));
		const results = out.rows
			.filter((row) => row.class !== "unchanged" && (row.class !== "prune" || prune))
			.map((row) => {
				const world_added_rows =
					row.kind === "entities" && row.class === "prune" ? addedByKey.get(row.key) : undefined;
				return {
					result: RESULT_FOR[row.class],
					kind: row.kind,
					key: row.key,
					part: row.part,
					...(row.from_part === undefined ? {} : { from_part: row.from_part }),
					...(world_added_rows === undefined
						? {}
						: {
								world_added_rows: {
									taken: world_added_rows.taken,
									left_behind: world_added_rows.left_behind,
								},
							}),
				};
			});
		return toolResult({
			...report,
			sent: true,
			results,
			unchanged: counts.unchanged,
			generation_after: out.generation + 1,
			...(used === undefined ? {} : { force_used: used }),
		});
	},
});
