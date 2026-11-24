/**
 * Per-world OSM export + MVT vector tiles cache for the player-mcp gateway (ADR-0123 / sk-adr8.13 / sk-adr8.14).
 *
 * Connects as the module publisher / operator identity so `visible_*` views
 * return the FULL catalog (fog-of-war is sk-adr8.15). Rebuilds via
 * `@spellkave/world-map` `exportWorld(rows)` on subscription `onUpdate`
 * (debounced ≤1 s). Lazily computes and caches MVT GeoJSON layers and
 * geojson-vt indexes for `/tiles/…` routes.
 *
 * Bbox index: simple linear scan over nodes. Fine for <10k nodes (elven-mini
 * is ~280); replace with an R-tree when a world exceeds that.
 */

import type { CatalogWorld, WorldCatalog } from "@spellkave/gateway-identity";
import {
	connect,
	type ReaderManifest,
	readMapLayers,
	readMetadataAttachmentRows,
	readPlaceTopology,
	readSubstrateDefinitions,
	readWorldStatus,
	resolveEffectiveSpatialEnvironmentStates,
	type SpellkaveSession,
	snapshotDb,
} from "@spellkave/sdk";
import {
	type BackdropEntry,
	type ExportManifest,
	type ExportWorldResult,
	exportWorld,
	type OsmDocument,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
	type WorldOsmInput,
} from "@spellkave/world-map";
import {
	backdropsOf,
	buildWorldTilesCache,
	buildWorldTilesCacheFromExport,
	GEOJSON_VT_OPTIONS,
	manifestOf,
	splitTileLayers,
	TILE_LAYER_NAMES,
	type TileLayerFields,
	type TileLayerName,
	vectorLayerFields,
	type WorldTilesCache,
} from "@spellkave/world-map/tiles";

export const OSM_REFRESH_DEBOUNCE_MS = 1_000;

/** OSM API 0.6 `map` / Overpass default area cap (square degrees). */
export const OSM_AREA_MAXIMUM_DEG2 = 0.25;

export const OSM_WAYNODES_MAXIMUM = 2_000;

export interface WorldOsmSnapshot {
	doc: OsmDocument;
	backdrops: BackdropEntry[];
	manifest: ExportManifest;
	tick: number;
	builtAt: string;
	/** Lazily populated on first tiles request for this snapshot. */
	tiles?: WorldTilesCache;
}

export interface OsmElementSet {
	nodes: OsmNode[];
	ways: OsmWay[];
	relations: OsmRelation[];
}

export interface WorldOsmCache {
	/** Ensure a live operator connection (or static seed) for the slug. */
	ensure(slug: string): Promise<void>;
	get(slug: string): WorldOsmSnapshot | undefined;
	getTiles(slug: string): WorldTilesCache | undefined;
	/** OSM API `map` semantics — see `elementsInBbox`. */
	elementsInBbox(
		slug: string,
		left: number,
		bottom: number,
		right: number,
		top: number,
	): OsmElementSet | undefined;
	close(): Promise<void>;
}

export interface LiveWorldOsmCacheOptions {
	worldUrl: string;
	catalog: WorldCatalog;
	/** Operator / module-publisher token. `null` = anonymous (not full world). */
	token?: string | null;
	debounceMs?: number;
	/** Test seam. */
	connectFn?: typeof connect;
}

const OSM_READER_MANIFESTS: ReaderManifest[] = [
	{
		requiredTables: [
			"visible_place_node",
			"visible_place_edge",
			"visible_place_graph_definition",
			"visible_map_layer",
			"substrate_definition",
			"world_time",
			"public_metadata_attachment",
			"visible_metadata_attachment",
			"place_edge_affordance",
			"visible_spatial_environment_state",
			"visible_spatial_niche_attachment",
		],
	},
];

function catalogWorld(catalog: WorldCatalog, slug: string): CatalogWorld | undefined {
	return catalog.worlds.find((w) => w.slug === slug);
}

function timestampFromSnap(snap: ReturnType<typeof snapshotDb>): string {
	const status = readWorldStatus(snap);
	// Prefer world_time if the row exposes lastTickAt via raw accessor.
	const timeRows = (snap as { world_time?: { iter?: () => Iterable<Record<string, unknown>> } })
		.world_time;
	if (timeRows?.iter !== undefined) {
		for (const row of timeRows.iter()) {
			const last = row.lastTickAt ?? row.last_tick_at;
			if (last !== undefined && last !== null) {
				if (typeof last === "string") return last.replace(/\.\d{3}Z$/, "Z");
				if (typeof last === "object" && last !== null && "microsSinceUnixEpoch" in last) {
					const micros = Number(
						(last as { microsSinceUnixEpoch: bigint | number }).microsSinceUnixEpoch,
					);
					if (Number.isFinite(micros)) {
						return new Date(micros / 1_000).toISOString().replace(/\.\d{3}Z$/, "Z");
					}
				}
				if (
					typeof last === "object" &&
					last !== null &&
					"__timestamp_micros_since_unix_epoch__" in last
				) {
					const micros = Number(
						(last as { __timestamp_micros_since_unix_epoch__: bigint | number })
							.__timestamp_micros_since_unix_epoch__,
					);
					if (Number.isFinite(micros)) {
						return new Date(micros / 1_000).toISOString().replace(/\.\d{3}Z$/, "Z");
					}
				}
			}
		}
	}
	void status;
	return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** Effective map rows from the already-visible state stream. */
export function effectiveOsmEnvironmentRows(
	input: Iterable<Record<string, unknown>>,
): Record<string, unknown>[] {
	return resolveEffectiveSpatialEnvironmentStates(
		[...input].map((raw) => ({
			...raw,
			bundleId: String(raw.bundleId ?? raw.bundle_id ?? ""),
			stateId: String(raw.stateId ?? raw.state_id ?? ""),
			stateRowId: BigInt(String(raw.stateRowId ?? raw.state_row_id ?? 0)),
			updatedTick: BigInt(String(raw.updatedTick ?? raw.updated_tick ?? 0)),
			targetKind: String(raw.targetKind ?? raw.target_kind ?? ""),
			targetRef: raw.targetRef ?? raw.target_ref,
			placeNodeId: String(raw.placeNodeId ?? raw.place_node_id ?? ""),
			placeEdgeId: BigInt(String(raw.placeEdgeId ?? raw.place_edge_id ?? 0)),
			locationDefId: String(raw.locationDefId ?? raw.location_def_id ?? ""),
			cellRes10: BigInt(String(raw.cellRes10 ?? raw.cell_res10 ?? 0)),
			cellRes7: BigInt(String(raw.cellRes7 ?? raw.cell_res7 ?? 0)),
			cellRes4: BigInt(String(raw.cellRes4 ?? raw.cell_res4 ?? 0)),
			substrateId: String(raw.substrateId ?? raw.substrate_id ?? ""),
		})),
	);
}

function buildSnapshot(session: SpellkaveSession): WorldOsmSnapshot {
	const snap = snapshotDb(session);
	const topology = readPlaceTopology(snap);
	const mapLayers = readMapLayers(snap);
	const substrates = readSubstrateDefinitions(snap);
	const status = readWorldStatus(snap);
	const tick = status?.tick ?? 0;
	const timestamp = timestampFromSnap(snap);
	const metaRows: Record<string, unknown>[] = [];
	for (const r of readMetadataAttachmentRows(snap)) {
		metaRows.push({
			attachment_id: r.key ?? "",
			bundle_id: r.bundleId ?? "",
			target_kind: r.targetKind ?? "",
			target_ref: r.targetRef ?? "",
			namespace: r.namespace ?? "",
			payload_json: r.payloadJson ?? "{}",
			audience: r.audience ?? "public",
			on_demand: r.onDemand ?? false,
			source: r.source ?? "manifest",
		});
	}

	const edgeAffordances: Record<string, unknown>[] = [];
	const rawAffs =
		(snap as { place_edge_affordance?: { iter?: () => Iterable<Record<string, unknown>> } })
			.place_edge_affordance ??
		(snap as { placeEdgeAffordance?: { iter?: () => Iterable<Record<string, unknown>> } })
			.placeEdgeAffordance;
	if (rawAffs?.iter !== undefined) {
		for (const r of rawAffs.iter()) {
			edgeAffordances.push({
				edge_key: r.edge_key ?? r.edgeKey ?? "",
				affordance_template_id: r.affordance_template_id ?? r.affordanceTemplateId ?? "",
				mode_id: r.mode_id ?? r.modeId ?? "",
				bindings_json: r.bindings_json ?? r.bindingsJson ?? "",
			});
		}
	}

	const edgeStates: Record<string, unknown>[] = [];
	const nodeStates: Record<string, unknown>[] = [];
	const rawStates =
		(
			snap as {
				visible_spatial_environment_state?: { iter?: () => Iterable<Record<string, unknown>> };
			}
		).visible_spatial_environment_state ??
		(
			snap as {
				visibleSpatialEnvironmentState?: { iter?: () => Iterable<Record<string, unknown>> };
			}
		).visibleSpatialEnvironmentState;
	if (rawStates?.iter !== undefined) {
		for (const r of effectiveOsmEnvironmentRows(rawStates.iter())) {
			if (
				r.target_kind === "place_edge" ||
				r.targetKind === "place_edge" ||
				r.place_edge_id ||
				r.placeEdgeId
			) {
				edgeStates.push({
					edge_id: r.place_edge_id ?? r.placeEdgeId ?? r.edge_id ?? r.edgeId,
					edge_key: r.edge_key ?? r.edgeKey,
					state_id: r.state_id ?? r.stateId ?? "",
					value: r.value,
				});
			} else {
				nodeStates.push({
					place_node_id: r.place_node_id ?? r.placeNodeId ?? r.target_ref ?? r.targetRef,
					state_id: r.state_id ?? r.stateId ?? "",
					value: r.value,
				});
			}
		}
	}

	const spatialNiches: Record<string, unknown>[] = [];
	const rawNiches =
		(
			snap as {
				visible_spatial_niche_attachment?: { iter?: () => Iterable<Record<string, unknown>> };
			}
		).visible_spatial_niche_attachment ??
		(
			snap as {
				visibleSpatialNicheAttachment?: { iter?: () => Iterable<Record<string, unknown>> };
			}
		).visibleSpatialNicheAttachment;
	if (rawNiches?.iter !== undefined) {
		for (const r of rawNiches.iter()) {
			spatialNiches.push({
				place_node_id: r.place_node_id ?? r.placeNodeId ?? r.target_ref ?? r.targetRef ?? "",
				niche_id: r.niche_id ?? r.nicheId ?? "",
				condition_bool: r.condition_bool ?? r.conditionBool,
			});
		}
	}

	const nicheDefs: Record<string, unknown>[] = [];
	const rawNicheDefs =
		(snap as { niche_definition?: { iter?: () => Iterable<Record<string, unknown>> } })
			.niche_definition ??
		(snap as { nicheDefinition?: { iter?: () => Iterable<Record<string, unknown>> } })
			.nicheDefinition;
	if (rawNicheDefs?.iter !== undefined) {
		for (const r of rawNicheDefs.iter()) {
			nicheDefs.push({
				niche_id: r.niche_id ?? r.nicheId ?? "",
				display_name: r.display_name ?? r.displayName ?? "",
				description: r.description,
			});
		}
	}

	const result = exportWorld(
		{
			place_graphs: topology.place_graphs,
			place_nodes: topology.place_nodes,
			place_edges: topology.place_edges,
			map_layers: mapLayers,
			substrate_definitions: substrates,
			metadata_attachments: metaRows,
			place_edge_affordances: edgeAffordances,
			edge_states: edgeStates,
			spatial_niche_attachments: spatialNiches,
			niche_definitions: nicheDefs,
			spatial_environment_states: nodeStates,
		},
		{ tick, timestamp },
	);
	return {
		doc: result.doc,
		backdrops: result.backdrops,
		manifest: result.manifest,
		tick,
		builtAt: new Date().toISOString(),
	};
}

// Tile layer split / geojson-vt / WorldTilesCache: @spellkave/world-map/tiles
export {
	backdropsOf,
	buildWorldTilesCache,
	buildWorldTilesCacheFromExport,
	GEOJSON_VT_OPTIONS,
	manifestOf,
	splitTileLayers,
	TILE_LAYER_NAMES,
	type TileLayerFields,
	type TileLayerName,
	type WorldTilesCache,
	vectorLayerFields,
};

export function buildWorldTilesCacheFromSnapshot(
	slug: string,
	snap: WorldOsmSnapshot,
): WorldTilesCache {
	return buildWorldTilesCacheFromExport(slug, {
		doc: snap.doc,
		backdrops: snap.backdrops,
		manifest: snap.manifest,
	});
}

/** In-memory multi-slug cache with optional refresh hook (test helper / store). */
export class TilesModelStore {
	private readonly bySlug = new Map<string, WorldTilesCache>();

	get(slug: string): WorldTilesCache | undefined {
		return this.bySlug.get(slug);
	}

	set(cache: WorldTilesCache): void {
		this.bySlug.set(cache.slug, cache);
	}

	has(slug: string): boolean {
		return this.bySlug.has(slug);
	}

	clear(): void {
		this.bySlug.clear();
	}
}

/**
 * Nodes in bbox + ways with any ref in that node set + their missing ref nodes
 * + relations with any member in the accumulated set (OSM API `map` semantics).
 */
export function elementsInBboxFromDoc(
	doc: OsmDocument,
	left: number,
	bottom: number,
	right: number,
	top: number,
): OsmElementSet {
	const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
	const inBbox = new Set<string>();
	for (const n of doc.nodes) {
		// Simple array scan — adequate under 10k nodes.
		if (n.lon >= left && n.lon <= right && n.lat >= bottom && n.lat <= top) {
			inBbox.add(n.id);
		}
	}

	const ways: OsmWay[] = [];
	const wayNodeIds = new Set<string>();
	for (const w of doc.ways) {
		if (w.refs.some((ref) => inBbox.has(ref))) {
			ways.push(w);
			for (const ref of w.refs) wayNodeIds.add(ref);
		}
	}

	const selectedNodeIds = new Set<string>([...inBbox, ...wayNodeIds]);

	const relations: OsmRelation[] = [];
	const memberIds = new Set<string>();
	for (const r of doc.relations) {
		const hits = r.members.some((m) => {
			if (m.type === "node") return selectedNodeIds.has(m.ref);
			if (m.type === "way") return ways.some((w) => w.id === m.ref);
			return false;
		});
		if (hits) {
			relations.push(r);
			for (const m of r.members) {
				if (m.type === "node") memberIds.add(m.ref);
				// relation members of type way that weren't selected via bbox
				// stay omitted unless already in `ways` (OSM map does not pull
				// full recursive relation membership beyond the bbox set).
			}
		}
	}

	for (const id of memberIds) selectedNodeIds.add(id);

	const nodes: OsmNode[] = [];
	for (const id of selectedNodeIds) {
		const n = nodeById.get(id);
		if (n !== undefined) nodes.push(n);
	}

	return { nodes, ways, relations };
}

export function bboxAreaDeg2(left: number, bottom: number, right: number, top: number): number {
	return Math.abs(right - left) * Math.abs(top - bottom);
}

/** Live per-world operator cache. */
export function createLiveWorldOsmCache(options: LiveWorldOsmCacheOptions): WorldOsmCache {
	const debounceMs = options.debounceMs ?? OSM_REFRESH_DEBOUNCE_MS;
	const connectFn = options.connectFn ?? connect;
	const sessions = new Map<string, SpellkaveSession>();
	const snapshots = new Map<string, WorldOsmSnapshot>();
	const pending = new Map<string, ReturnType<typeof setTimeout>>();
	const ensuring = new Map<string, Promise<void>>();

	function scheduleRebuild(slug: string): void {
		const previous = pending.get(slug);
		if (previous !== undefined) clearTimeout(previous);
		pending.set(
			slug,
			setTimeout(() => {
				pending.delete(slug);
				const session = sessions.get(slug);
				if (session === undefined) return;
				try {
					snapshots.set(slug, buildSnapshot(session));
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					console.warn(`osm-model: rebuild failed for ${slug}: ${message}`);
				}
			}, debounceMs),
		);
	}

	async function ensure(slug: string): Promise<void> {
		if (snapshots.has(slug) && sessions.has(slug)) return;
		const inflight = ensuring.get(slug);
		if (inflight !== undefined) {
			await inflight;
			return;
		}
		const work = (async () => {
			const world = catalogWorld(options.catalog, slug);
			if (world === undefined) throw new Error(`unknown catalog world: ${slug}`);
			if (sessions.has(slug)) return;
			const session = await connectFn(
				{
					url: options.worldUrl,
					db: world.db,
					token: options.token === undefined ? undefined : options.token,
					connectedActorId: "osm-operator",
					readerManifests: OSM_READER_MANIFESTS,
				},
				{
					onError(err) {
						console.warn(`osm-model: ${slug} error: ${err.message}`);
					},
					onDisconnect() {
						sessions.delete(slug);
					},
					onUpdate() {
						scheduleRebuild(slug);
					},
				},
			);
			await session.ready;
			sessions.set(slug, session);
			snapshots.set(slug, buildSnapshot(session));
		})();
		ensuring.set(slug, work);
		try {
			await work;
		} finally {
			ensuring.delete(slug);
		}
	}

	return {
		ensure,
		get(slug) {
			return snapshots.get(slug);
		},
		getTiles(slug) {
			const snap = snapshots.get(slug);
			if (snap === undefined) return undefined;
			if (snap.tiles === undefined) {
				snap.tiles = buildWorldTilesCacheFromSnapshot(slug, snap);
			}
			return snap.tiles;
		},
		elementsInBbox(slug, left, bottom, right, top) {
			const snap = snapshots.get(slug);
			if (snap === undefined) return undefined;
			return elementsInBboxFromDoc(snap.doc, left, bottom, right, top);
		},
		async close() {
			for (const timer of pending.values()) clearTimeout(timer);
			pending.clear();
			for (const session of sessions.values()) session.disconnect();
			sessions.clear();
			snapshots.clear();
		},
	};
}

/** Static cache for unit tests — seed from a prebuilt `exportWorld` result. */
export function createStaticWorldOsmCache(bySlug: Record<string, WorldOsmSnapshot>): WorldOsmCache {
	const map = new Map(Object.entries(bySlug));
	return {
		async ensure(slug) {
			if (!map.has(slug)) throw new Error(`unknown catalog world: ${slug}`);
		},
		get(slug) {
			return map.get(slug);
		},
		getTiles(slug) {
			const snap = map.get(slug);
			if (snap === undefined) return undefined;
			if (snap.tiles === undefined) {
				snap.tiles = buildWorldTilesCacheFromSnapshot(slug, snap);
			}
			return snap.tiles;
		},
		elementsInBbox(slug, left, bottom, right, top) {
			const snap = map.get(slug);
			if (snap === undefined) return undefined;
			return elementsInBboxFromDoc(snap.doc, left, bottom, right, top);
		},
		async close() {
			map.clear();
		},
	};
}

export function snapshotFromExport(
	result: ReturnType<typeof exportWorld>,
	tick = result.manifest.tick,
): WorldOsmSnapshot {
	return {
		doc: result.doc,
		backdrops: result.backdrops,
		manifest: result.manifest,
		tick,
		builtAt: new Date().toISOString(),
	};
}
