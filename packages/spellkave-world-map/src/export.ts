/**
 * ADR-0123 D-1..D-4 exporter: place rows → OSM primitives + backdrops sidecar.
 *
 * LEVEL_HEIGHT_M = 3.0 (ADR-0123 D-2): level index = round(elevation / 3.0).
 * Backdrop metres via the owning graph's metres_per_unit (G-5 amendment).
 * Stairs inferred from level delta when pose_dt_elevation is absent.
 */

import {
	cellRes10ToHex,
	type PlacedNode,
	projectSheetPoint,
	projectWorld,
	type WorldOffset,
} from "./coords.ts";
import { IdRegistry } from "./ids.ts";
import type {
	BackdropEntry,
	ExportManifest,
	OsmDocument,
	OsmExport,
	OsmMember,
	OsmNode,
	OsmRelation,
	OsmWay,
} from "./model.ts";
import { isPoiNamespace, type PoiMetadataPayload, parsePoiMetadata } from "./poi.ts";
import type {
	EdgeAffordanceRow,
	EdgeStateRow,
	GraphRow,
	MapLayerRow,
	NicheDefinitionRow,
	NodeRow,
	NodeStateRow,
	SpatialNicheAttachmentRow,
	WorldOsmInput,
} from "./rows.ts";
import { normalizeWorldOsmInput } from "./rows.ts";
import { buildCoordinateKindMap, levelIndex, type SpatialClass, spatialClassOf } from "./tags.ts";

export { LEVEL_HEIGHT_M } from "./tags.ts";

export const PACKAGE_VERSION = "0.0.0";
export const GENERATOR = `spellkave world-osm ${PACKAGE_VERSION}`;

export interface ExportWorldOpts {
	timestamp?: string;
	tick?: number;
	/** Override generator string (tests / spike parity). */
	generator?: string;
	diagnostics?: string[];
}

/** Internal result with test hooks. */
export interface ExportWorldResult extends OsmExport {
	placed: Map<string, PlacedNode>;
	nodeOsmId: Map<string, string>;
	levelByNodeId: Map<string, number>;
	kindBySubstrate: Map<string, string>;
}

function classOf(substrateId: string, kindBySubstrate: ReadonlyMap<string, string>): SpatialClass {
	return spatialClassOf(substrateId, kindBySubstrate);
}

function parseExtent(
	shapeId: string,
	paramsJson: string,
	defaultShape: string,
	defaultParams: string,
): { shape: "cube" | "sphere"; x_m: number; y_m: number } | null {
	const shape = shapeId || defaultShape;
	const json = paramsJson || defaultParams;
	if (!shape) return null;
	if (shape !== "core/area/cube" && shape !== "core/area/sphere") return null;
	let params: Record<string, unknown> = {};
	try {
		params = JSON.parse(json || "{}") as Record<string, unknown>;
	} catch {
		params = {};
	}
	const n = (k: string): number | undefined => {
		const v = params[k];
		return typeof v === "number" && Number.isFinite(v) ? v : undefined;
	};
	if (shape === "core/area/sphere") {
		const rx = n("radius_x_m") ?? n("radius_m");
		const ry = n("radius_y_m") ?? n("radius_m") ?? rx;
		if (rx === undefined || rx <= 0) return null;
		return { shape: "sphere", x_m: rx, y_m: ry ?? rx };
	}
	const ex = n("extent_x_m") ?? n("extent_m");
	const ey = n("extent_y_m") ?? n("extent_m") ?? ex;
	if (ex === undefined || ex <= 0) return null;
	return { shape: "cube", x_m: ex, y_m: ey ?? ex };
}

/** Rotate a local east/north offset by clockwise bearing. */
function rotateEn(east: number, north: number, bearingDeg: number): WorldOffset {
	const r = (bearingDeg * Math.PI) / 180;
	const cos = Math.cos(r);
	const sin = Math.sin(r);
	return {
		east_m: east * cos + north * sin,
		north_m: -east * sin + north * cos,
	};
}

function cellTag(value: unknown): string | null {
	const hex = cellRes10ToHex(value);
	if (hex === null) return null;
	try {
		return BigInt(`0x${hex}`).toString(10);
	} catch {
		return null;
	}
}

function metaAttrs(timestamp: string) {
	return {
		version: 1,
		changeset: 1,
		uid: 1,
		user: "spellkave",
		visible: true,
		timestamp,
	};
}

/**
 * Export plain spatial rows to an in-memory OSM document + backdrops + manifest.
 * Operator rows = full world (ADR-0123 identity requirement).
 */
export function exportWorld(input: WorldOsmInput, opts: ExportWorldOpts = {}): ExportWorldResult {
	const timestamp = opts.timestamp ?? new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	const tick = opts.tick ?? 0;
	const generator = opts.generator ?? GENERATOR;
	const meta = metaAttrs(timestamp);

	const normalized = normalizeWorldOsmInput(input);
	const { kindBySubstrate, usedBootstrapFallback } = buildCoordinateKindMap(
		normalized.substrate_definitions,
	);
	const diagnostics: string[] = [...(opts.diagnostics ?? [])];
	if (usedBootstrapFallback) {
		diagnostics.push(
			"substrate_kind_fallback: no substrate_definitions rows; using kernel bootstrap seed (outdoor→h3_cell, indoor→graph_local, tactical→tactical_grid)",
		);
	}

	const projection = projectWorld(input, { diagnostics: [] });
	// Re-use projection diagnostics only once (projectWorld may also emit fallback).
	for (const d of projection.diagnostics) {
		if (!diagnostics.includes(d)) diagnostics.push(d);
	}

	const graphs = normalized.place_graphs.filter(
		(g) => classOf(g.substrate_id, kindBySubstrate) !== "drop",
	);
	const nodes = normalized.place_nodes.filter(
		(n) => classOf(n.substrate_id, kindBySubstrate) !== "drop",
	);
	const edges = normalized.place_edges;

	const { placed, unplaced: unplacedGraphs, origin } = projection;

	const unplacedIds = new Set(unplacedGraphs.map((u) => u.place_graph_id));
	const exportableNodes = [...placed.values()].filter(
		(p) => !unplacedIds.has(p.node.place_graph_id),
	);

	const poiByNodeId = new Map<string, PoiMetadataPayload>();
	const poiByGraphId = new Map<string, PoiMetadataPayload>();
	for (const att of normalized.metadata_attachments) {
		if (!isPoiNamespace(att.namespace)) continue;
		const poi = parsePoiMetadata(att.payload_json);
		if (!poi) continue;
		if (att.target_kind === "place_node") {
			poiByNodeId.set(att.target_ref, poi);
		} else if (att.target_kind === "place_graph") {
			poiByGraphId.set(att.target_ref, poi);
		}
	}

	const affordancesByEdgeKey = new Map<string, EdgeAffordanceRow[]>();
	for (const aff of normalized.place_edge_affordances) {
		const list = affordancesByEdgeKey.get(aff.edge_key) ?? [];
		list.push(aff);
		affordancesByEdgeKey.set(aff.edge_key, list);
	}

	const statesByEdgeId = new Map<string, EdgeStateRow[]>();
	const statesByEdgeKey = new Map<string, EdgeStateRow[]>();
	for (const st of normalized.edge_states) {
		if (st.edge_id) {
			const list = statesByEdgeId.get(st.edge_id) ?? [];
			list.push(st);
			statesByEdgeId.set(st.edge_id, list);
		}
		if (st.edge_key) {
			const list = statesByEdgeKey.get(st.edge_key) ?? [];
			list.push(st);
			statesByEdgeKey.set(st.edge_key, list);
		}
	}

	const nodeIds = new IdRegistry();
	const wayIds = new IdRegistry();
	const relIds = new IdRegistry();

	const osmNodes: OsmNode[] = [];
	const osmWays: OsmWay[] = [];
	const osmRelations: OsmRelation[] = [];

	const nodeOsmId = new Map<string, string>();
	const levelByNodeId = new Map<string, number>();
	const extentWayByNode = new Map<string, string>();
	const edgeWayByKey = new Map<string, string>();
	const graphRelById = new Map<string, string>();

	const nicheDefsById = new Map<string, NicheDefinitionRow>();
	for (const nd of normalized.niche_definitions) {
		if (nd.niche_id) nicheDefsById.set(nd.niche_id, nd);
	}

	const nichesByNodeId = new Map<string, SpatialNicheAttachmentRow[]>();
	for (const sn of normalized.spatial_niche_attachments) {
		if (sn.place_node_id) {
			const list = nichesByNodeId.get(sn.place_node_id) ?? [];
			list.push(sn);
			nichesByNodeId.set(sn.place_node_id, list);
		}
	}

	const statesByNodeId = new Map<string, NodeStateRow[]>();
	for (const ns of normalized.node_states) {
		if (ns.node_id) {
			const list = statesByNodeId.get(ns.node_id) ?? [];
			list.push(ns);
			statesByNodeId.set(ns.node_id, list);
		}
	}

	const swimNodes = new Set<string>();
	for (const e of edges) {
		const hashKey = e.edge_key || `edge:${e.edge_id ?? `${e.from_node_id}->${e.to_node_id}`}`;
		const affs =
			affordancesByEdgeKey.get(hashKey) ??
			(e.edge_key ? affordancesByEdgeKey.get(e.edge_key) : undefined) ??
			[];
		for (const aff of affs) {
			if (aff.mode_id === "swim") {
				swimNodes.add(e.from_node_id);
				swimNodes.add(e.to_node_id);
			}
		}
	}

	// ── place_node → OSM node (+ optional extent way) ────────────────────────
	for (const p of exportableNodes) {
		const n = p.node;
		const osmId = nodeIds.id(n.node_id);
		nodeOsmId.set(n.node_id, osmId);
		const tags: Record<string, string> = {
			"spellkave:node_id": n.node_id,
			"spellkave:bundle": n.bundle_id,
			"spellkave:graph": n.place_graph_id,
			"spellkave:substrate": n.substrate_id,
		};
		if (n.local_id) tags.ref = n.local_id;
		if (n.display_name) tags.name = n.display_name;
		if (n.description) tags.description = n.description;
		const c10 = cellTag(n.cell_res10);
		const c7 = cellTag(n.cell_res7);
		const c4 = cellTag(n.cell_res4);
		if (c10) tags["spellkave:cell_res10"] = c10;
		if (c7) tags["spellkave:cell_res7"] = c7;
		if (c4) tags["spellkave:cell_res4"] = c4;
		if (n.pos_present) {
			tags["spellkave:pos_x"] = String(n.pos_x);
			tags["spellkave:pos_y"] = String(n.pos_y);
		}
		const nCls = classOf(n.substrate_id, kindBySubstrate);
		const lvl = levelIndex(n.pose_elevation_present, n.pose_elevation, nCls);
		if (lvl !== null) {
			tags.level = String(lvl);
			levelByNodeId.set(n.node_id, lvl);
			tags["spellkave:elevation_m"] = String(n.pose_elevation);
		} else if (n.pose_elevation_present) {
			tags["spellkave:elevation_m"] = String(n.pose_elevation);
		}

		const graph = graphs.find((g) => g.place_graph_id === n.place_graph_id);
		const gCls = graph ? classOf(graph.substrate_id, kindBySubstrate) : "outdoor";
		const isAnchor = graph?.anchor_node_id === n.node_id;
		if (isAnchor) tags["spellkave:anchor"] = "yes";
		if (isAnchor && gCls === "indoor") tags.entrance = "yes";

		const extent = parseExtent(
			n.extent_shape_id,
			n.extent_params_json,
			normalized.default_extent_shape_id,
			normalized.default_extent_params_json,
		);
		if (nCls === "indoor") {
			tags.indoor = "room";
		} else if (nCls === "tactical") {
			tags["spellkave:tactical"] = "cell";
		}
		if (extent) {
			tags["spellkave:extent_shape"] = n.extent_shape_id || normalized.default_extent_shape_id;
		}

		// Project POI metadata attachment (from place_node or inheriting from place_graph anchor)
		const nodePoi =
			poiByNodeId.get(n.node_id) ?? (isAnchor ? poiByGraphId.get(n.place_graph_id) : undefined);
		if (nodePoi) {
			if (nodePoi.icon) tags["spellkave:poi_icon"] = nodePoi.icon;
			if (nodePoi.category) tags["spellkave:poi_category"] = nodePoi.category;
			if (nodePoi.badge) tags["spellkave:poi_badge"] = nodePoi.badge;
			if (nodePoi.color) tags["spellkave:poi_color"] = nodePoi.color;
			if (nodePoi.label && !tags.name) tags.name = nodePoi.label;
		}

		// Project hazard niches, states, and categories
		let hazardType: string | undefined;
		const nodeNiches = nichesByNodeId.get(n.node_id) ?? [];
		for (const sn of nodeNiches) {
			const nId = sn.niche_id.toLowerCase();
			const def = nicheDefsById.get(sn.niche_id);
			const dName = (def?.display_name ?? "").toLowerCase();
			if (nId.includes("acid") || dName.includes("acid")) hazardType = "acid";
			else if (nId.includes("slime") || dName.includes("slime")) hazardType = "slime";
			else if (nId.includes("lava") || dName.includes("lava")) hazardType = "lava";
			else if (nId.includes("hazard") || dName.includes("hazard") || nId.includes("pool")) {
				hazardType = hazardType ?? (nId.includes("pool") ? "slime" : "hazard");
			}
		}

		if (nodePoi?.category === "hazard" || nodePoi?.icon === "hazard") {
			const lbl = (nodePoi.label ?? "").toLowerCase();
			if (lbl.includes("acid")) hazardType = "acid";
			else if (lbl.includes("slime")) hazardType = "slime";
			else if (lbl.includes("lava")) hazardType = "lava";
			else hazardType = hazardType ?? "hazard";
		}

		const nodeStates = statesByNodeId.get(n.node_id) ?? [];
		for (const st of nodeStates) {
			const sId = st.state_id.toLowerCase();
			if (sId.includes("acid")) hazardType = "acid";
			else if (sId.includes("slime")) hazardType = "slime";
			else if (sId.includes("lava")) hazardType = "lava";
			else if (sId.includes("hazard")) hazardType = hazardType ?? "hazard";
		}

		if (hazardType) {
			tags["spellkave:hazard"] = hazardType;
			tags.hazard = "yes";
		}

		// Project liquid / water body
		let waterType: string | undefined;
		const lowerName = (n.display_name ?? n.local_id ?? n.node_id).toLowerCase();
		if (swimNodes.has(n.node_id)) {
			waterType = lowerName.includes("river")
				? "river"
				: lowerName.includes("pool")
					? "pool"
					: "water";
		} else if (
			lowerName.includes("river") ||
			lowerName.includes("stream") ||
			lowerName.includes("brook") ||
			lowerName.includes("water") ||
			lowerName.includes("lake") ||
			lowerName.includes("swamp") ||
			lowerName.includes("pond") ||
			lowerName.includes("pool")
		) {
			if (lowerName.includes("river") || lowerName.includes("stream")) waterType = "river";
			else if (lowerName.includes("lake")) waterType = "lake";
			else if (lowerName.includes("swamp")) waterType = "swamp";
			else if (lowerName.includes("pool")) waterType = "pool";
			else if (lowerName.includes("pond")) waterType = "pond";
			else waterType = "water";
		} else if (nodePoi?.category === "water") {
			waterType = "water";
		}

		if (waterType) {
			tags.natural = "water";
			tags.water = waterType;
		}

		// Project difficult terrain
		for (const st of nodeStates) {
			const sId = st.state_id.toLowerCase();
			if (sId.includes("difficult_terrain")) {
				tags["spellkave:terrain"] = "difficult";
				break;
			}
		}

		osmNodes.push({
			type: "node",
			id: osmId,
			lat: p.lat,
			lon: p.lon,
			tags,
			...meta,
		});

		if (extent) {
			const cornerRefs: string[] = [];
			const cornersEn: Array<{ e: number; n: number }> = [];
			if (extent.shape === "cube") {
				const hx = extent.x_m / 2;
				const hy = extent.y_m / 2;
				cornersEn.push({ e: -hx, n: hy }, { e: hx, n: hy }, { e: hx, n: -hy }, { e: -hx, n: -hy });
			} else {
				for (let i = 0; i < 16; i++) {
					const a = (i / 16) * Math.PI * 2;
					cornersEn.push({
						e: Math.cos(a) * extent.x_m,
						n: Math.sin(a) * extent.y_m,
					});
				}
			}
			for (let i = 0; i < cornersEn.length; i++) {
				const key = `extent:${n.node_id}:${i}`;
				const cid = nodeIds.id(key);
				const rot = rotateEn(cornersEn[i]!.e, cornersEn[i]!.n, p.composed_bearing_deg);
				const lat = p.lat + rot.north_m / 111_320;
				const cosLat = Math.cos((p.lat * Math.PI) / 180);
				const lon = p.lon + rot.east_m / (111_320 * (cosLat === 0 ? 1e-12 : cosLat));
				osmNodes.push({
					type: "node",
					id: cid,
					lat,
					lon,
					tags: {},
					...meta,
				});
				cornerRefs.push(cid);
			}
			const closed = [...cornerRefs, cornerRefs[0]!];
			const wayKey = `extent:${n.node_id}`;
			const wayId = wayIds.id(wayKey);
			extentWayByNode.set(n.node_id, wayId);
			const wtags: Record<string, string> = {
				"spellkave:node_id": n.node_id,
				"spellkave:graph": n.place_graph_id,
				"spellkave:extent_shape": n.extent_shape_id || normalized.default_extent_shape_id,
				"spellkave:extent_params": n.extent_params_json || normalized.default_extent_params_json,
			};
			if (n.display_name) wtags.name = n.display_name;
			if (nCls === "indoor") {
				wtags.indoor = "room";
			} else {
				wtags["spellkave:extent"] = "yes";
			}
			if (lvl !== null) wtags.level = String(lvl);
			if (tags["spellkave:hazard"]) {
				wtags["spellkave:hazard"] = tags["spellkave:hazard"];
				wtags.hazard = "yes";
			}
			if (tags.natural === "water") {
				wtags.natural = "water";
				if (tags.water) wtags.water = tags.water;
			}
			if (tags["spellkave:terrain"]) {
				wtags["spellkave:terrain"] = tags["spellkave:terrain"];
			}
			if (tags["spellkave:poi_category"])
				wtags["spellkave:poi_category"] = tags["spellkave:poi_category"];
			if (tags["spellkave:poi_icon"]) wtags["spellkave:poi_icon"] = tags["spellkave:poi_icon"];
			if (tags["spellkave:poi_color"]) wtags["spellkave:poi_color"] = tags["spellkave:poi_color"];
			osmWays.push({
				type: "way",
				id: wayId,
				refs: closed,
				tags: wtags,
				...meta,
			});
		}
	}

	// ── place_edge → 2-node way ──────────────────────────────────────────────
	const nodeGraph = new Map(nodes.map((n) => [n.node_id, n]));
	for (const e of edges) {
		const fromOsm = nodeOsmId.get(e.from_node_id);
		const toOsm = nodeOsmId.get(e.to_node_id);
		if (!fromOsm || !toOsm) continue;
		const hashKey = e.edge_key || `edge:${e.edge_id ?? `${e.from_node_id}->${e.to_node_id}`}`;
		const wayId = wayIds.id(hashKey);
		edgeWayByKey.set(hashKey, wayId);
		const fromN = nodeGraph.get(e.from_node_id)!;
		const toN = nodeGraph.get(e.to_node_id)!;
		const fromLvl = levelByNodeId.get(e.from_node_id);
		const toLvl = levelByNodeId.get(e.to_node_id);
		const bothIndoor =
			classOf(fromN.substrate_id, kindBySubstrate) === "indoor" &&
			classOf(toN.substrate_id, kindBySubstrate) === "indoor";
		const tags: Record<string, string> = {
			"spellkave:edge_key": hashKey,
			"spellkave:bundle": e.bundle_id,
			"spellkave:from_node": e.from_node_id,
			"spellkave:to_node": e.to_node_id,
			oneway: "yes",
			"spellkave:inherit_movement_default": e.inherit_movement_default ? "yes" : "no",
		};
		if (e.description) tags.description = e.description;

		const isPortal = (e.place_graph_id ?? "").trim() === "";
		if (isPortal) {
			tags["spellkave:portal"] = "yes";
		} else {
			tags["spellkave:graph"] = e.place_graph_id;
		}

		const fromCls = classOf(fromN.substrate_id, kindBySubstrate);
		const toCls = classOf(toN.substrate_id, kindBySubstrate);
		if (fromCls === "tactical" || toCls === "tactical") {
			tags["spellkave:tactical"] = "edge";
		}

		const dtPresent = e.pose_dt_elevation_present && e.pose_dt_elevation !== 0;
		const levelsDiffer = fromLvl !== undefined && toLvl !== undefined && fromLvl !== toLvl;
		if (dtPresent || levelsDiffer) {
			tags.highway = "steps";
			if (dtPresent) {
				tags.incline = e.pose_dt_elevation > 0 ? "up" : "down";
				tags["spellkave:elevation_delta_m"] = String(e.pose_dt_elevation);
			} else if (levelsDiffer) {
				tags.incline = (toLvl ?? 0) > (fromLvl ?? 0) ? "up" : "down";
			}
			if (fromLvl !== undefined && toLvl !== undefined) {
				tags.level = `${fromLvl};${toLvl}`;
			}
		} else {
			tags.highway = bothIndoor ? "corridor" : "path";
			if (fromLvl !== undefined && fromLvl === toLvl) {
				tags.level = String(fromLvl);
			}
		}
		if (bothIndoor) tags.indoor = "room";

		if (e.substrate_crossing) {
			tags.door = "yes";
			tags["spellkave:substrate_crossing"] = "yes";
		}
		if (e.cell_anchor_present) {
			const ca = cellTag(e.cell_anchor);
			if (ca) tags["spellkave:cell_anchor"] = ca;
			tags["spellkave:cell_anchor_u"] = String(e.cell_anchor_u);
			tags["spellkave:cell_anchor_v"] = String(e.cell_anchor_v);
		}
		if (e.from_anchor_side) {
			tags["spellkave:from_side"] = e.from_anchor_side;
			tags["spellkave:from_offset"] = String(e.from_anchor_offset);
		}
		if (e.to_anchor_side) {
			tags["spellkave:to_side"] = e.to_anchor_side;
			tags["spellkave:to_offset"] = String(e.to_anchor_offset);
		}

		// Project edge affordances (traversal mode, seals/barriers)
		const affs =
			affordancesByEdgeKey.get(hashKey) ??
			(e.edge_key ? affordancesByEdgeKey.get(e.edge_key) : undefined) ??
			[];
		for (const aff of affs) {
			if (aff.mode_id) {
				tags["spellkave:traversal_mode"] = aff.mode_id;
			}
			const tpl = aff.affordance_template_id;
			if (tpl) {
				tags["spellkave:affordance_template"] = tpl;
				const lower = tpl.toLowerCase();
				if (
					lower.includes("seal") ||
					lower.includes("threshold") ||
					lower.includes("gate") ||
					lower.includes("lock")
				) {
					tags.barrier = "gate";
					tags["spellkave:seal"] = tpl;
					tags.door = "yes";
				}
			}
		}

		// Check dynamic edge state for open/locked status
		const edgeStates = [
			...(e.edge_id !== undefined ? (statesByEdgeId.get(String(e.edge_id)) ?? []) : []),
			...(statesByEdgeKey.get(hashKey) ?? []),
			...(e.edge_key ? (statesByEdgeKey.get(e.edge_key) ?? []) : []),
		];
		let isLocked: boolean | undefined;
		for (const st of edgeStates) {
			const sId = st.state_id.toLowerCase();
			if (sId.endsWith("-open") || sId.endsWith(".open") || sId.includes("open")) {
				isLocked = !st.value;
			} else if (sId.includes("locked")) {
				isLocked = Boolean(st.value);
			}
		}
		if (isLocked !== undefined) {
			tags["spellkave:locked"] = isLocked ? "yes" : "no";
		} else if (tags["spellkave:seal"]) {
			tags["spellkave:locked"] = "yes";
		}

		osmWays.push({
			type: "way",
			id: wayId,
			refs: [fromOsm, toOsm],
			tags,
			...meta,
		});
	}

	// ── place_graph_definition → relation ────────────────────────────────────
	const placedGraphIds = new Set(exportableNodes.map((p) => p.node.place_graph_id));
	for (const g of graphs) {
		if (!placedGraphIds.has(g.place_graph_id)) continue;
		const relId = relIds.id(g.place_graph_id);
		graphRelById.set(g.place_graph_id, relId);
	}

	for (const g of graphs) {
		const relId = graphRelById.get(g.place_graph_id);
		if (!relId) continue;
		const members: OsmMember[] = [];
		const graphNodes = exportableNodes.filter((p) => p.node.place_graph_id === g.place_graph_id);
		const levels: number[] = [];
		for (const p of graphNodes) {
			const oid = nodeOsmId.get(p.node.node_id)!;
			const role = g.anchor_node_id === p.node.node_id ? "anchor" : "node";
			members.push({ type: "node", ref: oid, role });
			const lvl = levelByNodeId.get(p.node.node_id);
			if (lvl !== undefined) levels.push(lvl);
			const ext = extentWayByNode.get(p.node.node_id);
			if (ext) members.push({ type: "way", ref: ext, role: "extent" });
		}
		for (const e of edges) {
			if (e.place_graph_id !== g.place_graph_id) continue;
			const hashKey = e.edge_key || `edge:${e.edge_id ?? ""}`;
			const wid = edgeWayByKey.get(hashKey);
			if (wid) members.push({ type: "way", ref: wid, role: "edge" });
		}
		const graphNodeSet = new Set(graphNodes.map((p) => p.node.node_id));
		for (const e of edges) {
			if ((e.place_graph_id ?? "").trim() !== "") continue;
			if (!graphNodeSet.has(e.from_node_id) && !graphNodeSet.has(e.to_node_id)) continue;
			const hashKey = e.edge_key || `edge:${e.edge_id ?? ""}`;
			const wid = edgeWayByKey.get(hashKey);
			if (wid) members.push({ type: "way", ref: wid, role: "portal" });
		}
		for (const child of graphs) {
			if (child.parent_graph_id !== g.place_graph_id) continue;
			const childRel = graphRelById.get(child.place_graph_id);
			if (childRel) members.push({ type: "relation", ref: childRel, role: "child" });
		}

		const tags: Record<string, string> = {
			"spellkave:graph_id": g.place_graph_id,
			"spellkave:bundle": g.bundle_id,
			"spellkave:substrate": g.substrate_id,
			"spellkave:bearing": String(g.bearing),
			"spellkave:metres_per_unit": String(g.metres_per_unit),
			"spellkave:anchor_node": g.anchor_node_id,
		};
		if (g.display_name) tags.name = g.display_name;
		if (g.description) tags.description = g.description;
		if (g.blueprint_id) tags["spellkave:blueprint"] = g.blueprint_id;
		if (g.parent_graph_id) tags["spellkave:parent_graph"] = g.parent_graph_id;
		const o10 = cellTag(g.origin_cell_res10);
		const o7 = cellTag(g.origin_cell_res7);
		const o4 = cellTag(g.origin_cell_res4);
		if (o10) tags["spellkave:origin_cell_res10"] = o10;
		if (o7) tags["spellkave:origin_cell_res7"] = o7;
		if (o4) tags["spellkave:origin_cell_res4"] = o4;

		const graphPoi = poiByGraphId.get(g.place_graph_id);
		if (graphPoi) {
			if (graphPoi.icon) tags["spellkave:poi_icon"] = graphPoi.icon;
			if (graphPoi.category) tags["spellkave:poi_category"] = graphPoi.category;
			if (graphPoi.badge) tags["spellkave:poi_badge"] = graphPoi.badge;
			if (graphPoi.color) tags["spellkave:poi_color"] = graphPoi.color;
		}

		const gSubCls = classOf(g.substrate_id, kindBySubstrate);
		if (gSubCls === "indoor") {
			tags.type = "building";
			tags.building = "yes";
			if (levels.length > 0) {
				const minL = Math.min(...levels);
				const maxL = Math.max(...levels);
				tags.min_level = String(minL);
				tags.max_level = String(maxL);
				tags["building:levels"] = String(maxL - Math.min(minL, 0) + 1);
			}
		} else if (gSubCls === "tactical") {
			tags.type = "site";
			tags.site = "spellkave_tactical_grid";
			tags["spellkave:tactical"] = "grid";
		} else {
			tags.type = "site";
			tags.site = "spellkave_graph";
		}

		osmRelations.push({
			type: "relation",
			id: relId,
			members,
			tags,
			...meta,
		});
	}

	// ── map_layer → backdrops.json ───────────────────────────────────────────
	const backdrops: BackdropEntry[] = [];
	if (origin) {
		for (const layer of normalized.map_layers) {
			if (unplacedIds.has(layer.place_graph_id)) continue;
			if (!placedGraphIds.has(layer.place_graph_id)) continue;
			const g = graphs.find((gg) => gg.place_graph_id === layer.place_graph_id);
			if (!g) continue;
			const entry = backdropEntry(layer, g, placed, origin, graphRelById);
			if (entry) backdrops.push(entry);
		}
	}

	const doc: OsmDocument = {
		generator,
		tick,
		timestamp,
		nodes: osmNodes,
		ways: osmWays,
		relations: osmRelations,
	};

	const manifest: ExportManifest = {
		generator,
		timestamp,
		tick,
		origin: origin
			? {
					lat: origin.lat,
					lon: origin.lon,
					cell_res10_hex: origin.hex,
					cell_res10_decimal: BigInt(`0x${origin.hex}`).toString(10),
				}
			: null,
		counts: {
			nodes: osmNodes.length,
			ways: osmWays.length,
			relations: osmRelations.length,
			backdrops: backdrops.length,
			unplaced_graphs: unplacedGraphs.length,
		},
		unplaced_graphs: unplacedGraphs,
		diagnostics,
	};

	return {
		doc,
		backdrops,
		manifest,
		placed,
		nodeOsmId,
		levelByNodeId,
		kindBySubstrate,
	};
}

function backdropEntry(
	layer: MapLayerRow,
	graph: GraphRow,
	placed: Map<string, PlacedNode>,
	origin: { lat: number; lon: number; hex: string },
	graphRelById: Map<string, string>,
): BackdropEntry | null {
	let anchorSheet = { x: 0, y: 0 };
	let baseWorld: WorldOffset = { east_m: 0, north_m: 0 };
	const anchorPlaced = placed.get(graph.anchor_node_id);
	const parentId = (graph.parent_graph_id ?? "").trim();
	if (!parentId) {
		if (anchorPlaced) {
			anchorSheet = { x: anchorPlaced.node.pos_x, y: anchorPlaced.node.pos_y };
			baseWorld = { east_m: 0, north_m: 0 };
		}
	} else {
		// Nested graphs nest at the anchor in elven-mini; use anchor as sheet origin.
		const nestPlaced = placed.get(graph.anchor_node_id) ?? anchorPlaced;
		if (nestPlaced) {
			anchorSheet = { x: nestPlaced.node.pos_x, y: nestPlaced.node.pos_y };
			baseWorld = { east_m: nestPlaced.east_m, north_m: nestPlaced.north_m };
		} else {
			return null;
		}
	}

	const grid = layer.grid_size_px > 0 ? layer.grid_size_px : 1;
	// G-5: metres via the owning graph's metres_per_unit (sheet unit nodes use).
	const metres =
		graph.metres_per_unit > 0
			? graph.metres_per_unit
			: layer.grid_distance_m > 0
				? layer.grid_distance_m
				: 1;
	const bearing = (graph.bearing ?? 0) + (layer.rotation_deg ?? 0);

	const pxCorners: Array<[number, number]> = [
		[0, 0],
		[layer.image_width_px, 0],
		[layer.image_width_px, layer.image_height_px],
		[0, layer.image_height_px],
	];
	const coordinates = pxCorners.map(([px, py]) => {
		const sheetX = px / grid - layer.image_origin_x;
		const sheetY = py / grid - layer.image_origin_y;
		const { lat, lon } = projectSheetPoint(
			sheetX,
			sheetY,
			anchorSheet,
			baseWorld,
			bearing,
			metres,
			origin.lat,
			origin.lon,
		);
		return [lon, lat] as [number, number];
	}) as BackdropEntry["coordinates"];

	const entry: BackdropEntry = {
		id: layer.map_layer_id,
		graph: layer.place_graph_id,
		relation_id: graphRelById.get(layer.place_graph_id) ?? "",
		name: layer.display_name,
		url: `asset://${layer.asset_module}/${layer.asset_path}`,
		asset: { module: layer.asset_module, path: layer.asset_path },
		source: layer.source_kind,
		license: layer.posture,
		state: layer.state,
		size_px: [layer.image_width_px, layer.image_height_px],
		coordinates,
		grid_distance_m: layer.grid_distance_m,
	};
	if (layer.min_zoom > 0) entry.minzoom = layer.min_zoom;
	if (layer.max_zoom > 0) entry.maxzoom = layer.max_zoom;
	return entry;
}

/** Convenience: level index for a typed node row. */
export function nodeLevelIndex(node: NodeRow, cls: SpatialClass): number | null {
	return levelIndex(node.pose_elevation_present, node.pose_elevation, cls);
}
