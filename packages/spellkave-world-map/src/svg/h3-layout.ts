/**
 * Outdoor world layout: ADR-0029 composition + H3 hex footprints.
 *
 * - Root outdoor graph anchors at origin_cell_res10 (centroid).
 * - Nested outdoor graphs project into the parent frame at the portal nest point.
 * - Indoor graphs are not drawn as floorplans — only outdoor portal nodes remain.
 * - Hex outlines from authored cell_res10 (terrain substrate later fills these).
 *
 * Same methodology for spellkave_map_graph / CLI / fixture proofs (not web-only).
 */

import { cellToBoundary, isValidCell } from "h3-js";

import { cellRes10ToHex, latLngToPlane, placeWorld, worldOffsetToPlane } from "../coords.ts";
import type { EdgeRow, GraphRow, NodeRow } from "../rows.ts";

import type { SpatialGraphEdge, SpatialGraphMeta, SpatialGraphNode } from "./types.ts";

export { cellRes10ToHex };

export interface H3HexFootprint {
	/** H3 res10 hex index. */
	hex: string;
	/** Closed ring in layout plane (same coords as nodes). */
	ring: Array<{ x: number; y: number }>;
	/** Fill class for terrain/ownership (CSS h3-cell--*). */
	fillKind?: "root" | "settlement" | "wilderness" | "default";
}

export interface H3WorldLayoutResult {
	nodes: SpatialGraphNode[];
	edges: SpatialGraphEdge[];
	graphs: Array<{ graphId: string; offsetX: number; offsetY: number }>;
	hexes: H3HexFootprint[];
	/** True when composition projection produced the layout. */
	usedComposition: boolean;
}

/**
 * Layout outdoor world via root H3 anchor + nested metric composition.
 * Implemented on top of @spellkave/world-map placeWorld (ADR-0123 D-1).
 * Indoor nodes omitted (portal presence is on outdoor endpoints).
 */
export function layoutOutdoorWorldByComposition(
	nodes: readonly SpatialGraphNode[],
	edges: readonly SpatialGraphEdge[],
	graphs: readonly SpatialGraphMeta[],
): H3WorldLayoutResult | null {
	const outdoor = nodes.filter((n) => n.substrateId === "outdoor");
	if (outdoor.length < 2) return null;

	const gmeta = new Map(graphs.map((g) => [g.graphId, g]));
	const outdoorGraphIds = new Set(outdoor.map((n) => n.graphId));

	const graphRows: GraphRow[] = graphs
		.filter((g) => outdoorGraphIds.has(g.graphId))
		.map((g) => ({
			place_graph_id: g.graphId,
			parent_graph_id:
				g.parentGraphId && outdoorGraphIds.has(g.parentGraphId.trim())
					? g.parentGraphId.trim()
					: "",
			anchor_node_id: g.anchorNodeId ?? outdoor.find((n) => n.graphId === g.graphId)?.id ?? "",
			substrate_id: g.substrateId ?? "outdoor",
			bearing: g.bearing ?? 0,
			metres_per_unit: g.metresPerUnit && g.metresPerUnit > 0 ? g.metresPerUnit : 1,
			origin_cell_res10: g.originCellRes10Hex ?? 0,
			origin_cell_res7: 0,
			origin_cell_res4: 0,
			display_name: g.displayName ?? "",
			description: "",
			bundle_id: "",
			blueprint_id: "",
			is_ephemeral_instance: false,
		}));

	const nodeRows: NodeRow[] = outdoor.map((n) => ({
		node_id: n.id,
		place_graph_id: n.graphId,
		bundle_id: "",
		local_id: "",
		substrate_id: n.substrateId ?? "outdoor",
		display_name: n.label,
		description: "",
		cell_res10: n.cellRes10Hex ?? 0,
		cell_res7: 0,
		cell_res4: 0,
		pos_present: true,
		pos_x: n.x,
		pos_y: n.y,
		pose_elevation_present: n.elevationPresent,
		pose_elevation: n.elevation,
		extent_shape_id: n.extent?.shapeId ?? "",
		extent_params_json: n.extent?.params ? JSON.stringify(n.extent.params) : "",
		is_ephemeral: false,
	}));

	const edgeRows: EdgeRow[] = edges.map((e, i) => ({
		edge_key: `${e.from}->${e.to}`,
		bundle_id: "",
		place_graph_id: e.graphId,
		from_node_id: e.from,
		to_node_id: e.to,
		pose_dt_elevation_present: false,
		pose_dt_elevation: 0,
		substrate_crossing: false,
		cell_anchor_present: false,
		cell_anchor: 0,
		cell_anchor_u: 0,
		cell_anchor_v: 0,
		from_anchor_side: "",
		from_anchor_offset: 0,
		to_anchor_side: "",
		to_anchor_offset: 0,
		description: "",
		inherit_movement_default: true,
	}));

	const { placed, origin } = placeWorld(graphRows, nodeRows, edgeRows);
	if (origin === null || placed.size < 2) return null;

	const placedNodes: SpatialGraphNode[] = [];
	for (const n of outdoor) {
		const p = placed.get(n.id);
		if (!p) continue;
		const plane = worldOffsetToPlane({ east_m: p.east_m, north_m: p.north_m }, 0, 0);
		placedNodes.push({ ...n, x: plane.x, y: plane.y });
	}

	const nodeIds = new Set(placedNodes.map((n) => n.id));
	// Portal entrances: outdoor node linked to a non-outdoor endpoint.
	const portalEntrances = new Set<string>();
	for (const e of edges) {
		if (nodeIds.has(e.from) && !nodeIds.has(e.to)) portalEntrances.add(e.from);
		if (nodeIds.has(e.to) && !nodeIds.has(e.from)) portalEntrances.add(e.to);
	}
	for (let i = 0; i < placedNodes.length; i++) {
		const n = placedNodes[i];
		if (n === undefined) continue;
		const short = n.label.length <= 14 ? n.label : `${n.label.slice(0, 12)}…`;
		placedNodes[i] = {
			...n,
			shortLabel: short,
			portalEntrance: portalEntrances.has(n.id),
		};
	}
	// Edges among outdoor placed nodes (includes outdoor↔outdoor portals).
	const placedEdges = edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));

	// Hex footprints: unique outdoor cells (authored) + root origin.
	const hexSet = new Set<string>();
	hexSet.add(origin.hex);
	for (const n of outdoor) {
		if (n.cellRes10Hex && isValidCell(n.cellRes10Hex)) hexSet.add(n.cellRes10Hex);
	}

	const outdoorGraphIdsList = [...outdoorGraphIds];
	const nestGraphIds = new Set(
		outdoorGraphIdsList.filter((id) => {
			const p = gmeta.get(id)?.parentGraphId?.trim() ?? "";
			return p !== "" && outdoorGraphIds.has(p);
		}),
	);
	const rootId = [...outdoorGraphIdsList]
		.filter((id) => {
			const p = gmeta.get(id)?.parentGraphId?.trim() ?? "";
			return (
				(p === "" || !outdoorGraphIds.has(p)) &&
				cellRes10ToHex(gmeta.get(id)?.originCellRes10Hex) !== null
			);
		})
		.sort((a, b) => a.localeCompare(b))[0];

	const cellsOf = (pred: (n: SpatialGraphNode) => boolean) => {
		const s = new Set<string>();
		for (const n of outdoor) {
			if (!pred(n) || !n.cellRes10Hex || !isValidCell(n.cellRes10Hex)) continue;
			s.add(n.cellRes10Hex);
		}
		return s;
	};
	const settlementCells = cellsOf((n) => nestGraphIds.has(n.graphId));
	const rootCells = rootId ? cellsOf((n) => n.graphId === rootId) : new Set<string>();

	const hexes: H3HexFootprint[] = [];
	for (const hex of [...hexSet].sort()) {
		const boundary = cellToBoundary(hex); // [[lat,lng], ...]
		const ring = boundary.map(([lat, lng]) => {
			const p = latLngToPlane(lat, lng, origin.lat, origin.lon);
			return worldOffsetToPlane({ east_m: p.x, north_m: -p.y }, 0, 0);
		});
		// Close ring
		if (ring.length > 0) ring.push({ ...ring[0]! });
		let fillKind: H3HexFootprint["fillKind"] = "default";
		if (hex === origin.hex) fillKind = "root";
		else if (settlementCells.has(hex)) fillKind = "settlement";
		else if (rootCells.has(hex)) fillKind = "wilderness";
		hexes.push({ hex, ring, fillKind });
	}

	const placedGraphIds = new Set([...placed.values()].map((p) => p.node.place_graph_id));
	const graphOffsets = [...placedGraphIds].map((graphId) => ({
		graphId,
		offsetX: 0,
		offsetY: 0,
	}));

	return {
		nodes: placedNodes,
		edges: placedEdges,
		graphs: graphOffsets,
		hexes,
		usedComposition: true,
	};
}

/** @deprecated kept for tests — prefer layoutOutdoorWorldByComposition */
export function layoutNodesByH3(
	nodes: readonly SpatialGraphNode[],
	cellByNodeId: ReadonlyMap<string, string | null>,
	metresPerUnitByGraphId: ReadonlyMap<string, number>,
): SpatialGraphNode[] | null {
	const enriched = nodes.map((n) => ({
		...n,
		cellRes10Hex: cellByNodeId.get(n.id) ?? n.cellRes10Hex ?? null,
	}));
	const graphs: SpatialGraphMeta[] = [...new Set(nodes.map((n) => n.graphId))].map((graphId) => ({
		graphId,
		metresPerUnit: metresPerUnitByGraphId.get(graphId) ?? 1,
		substrateId: "outdoor",
		displayName: null,
		parentGraphId: "",
		originCellRes10Hex: null,
		bearing: 0,
		anchorNodeId: null,
	}));
	// Fake root origin from first cell
	const first = [...cellByNodeId.values()].find((h) => h && isValidCell(h));
	if (!first) return null;
	graphs[0] = { ...graphs[0]!, originCellRes10Hex: first };
	const r = layoutOutdoorWorldByComposition(enriched, [], graphs);
	return r?.nodes ?? null;
}

export function shouldUseH3WorldLayout(
	graphScoped: boolean,
	nodes: readonly SpatialGraphNode[],
	_cellByNodeId: ReadonlyMap<string, string | null>,
	graphs?: readonly SpatialGraphMeta[],
): boolean {
	if (graphScoped) return false;
	const outdoor = nodes.filter((n) => n.substrateId === "outdoor" || n.substrateId === null);
	if (outdoor.length < 2) return false;
	if (graphs) {
		const hasRootOrigin = graphs.some(
			(g) =>
				(g.substrateId === "outdoor" || g.substrateId === null) &&
				g.originCellRes10Hex &&
				isValidCell(g.originCellRes10Hex),
		);
		if (hasRootOrigin) return true;
	}
	let withCell = 0;
	for (const n of outdoor) {
		if (n.cellRes10Hex && isValidCell(n.cellRes10Hex)) withCell += 1;
	}
	return withCell >= 2 && withCell / outdoor.length >= 0.5;
}
