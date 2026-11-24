/**
 * Client-side place-graph projection (ADR-0029 D-1/D-3, ADR-0123 D-1).
 *
 * Consolidated from the retired spatial compatibility layer; this package now
 * owns the projection and layout math for every host.
 *
 * Concepts:
 * - **Sheet frame**: authored pos_x/pos_y; +x east, +y south (image rows).
 * - **Local frame** (ADR-0029): +x east, +y north. Flip: ly = anchor_y − pos_y.
 * - **Bearing**: clockwise degrees from north (projectLocalPosition).
 * - **H3 origin**: root graph anchor sits on cellToLatLng(origin_cell_res10).
 * - **Nest link**: portal edge parent↔child; child nest coincides with parent nest.
 * - **Indoor children included** — the earlier H3 layout deliberately omitted
 *   indoor graphs; this generalisation is the product math (ADR-0123 D-1 case 3).
 * - **No fake plane**: orphan roots without an origin cell are unplaced (D-1.5).
 */

import { cellToLatLng, isValidCell, latLngToCell } from "h3-js";

import type { UnplacedGraph } from "./model.ts";
import type { EdgeRow, GraphRow, NodeRow, WorldOsmInput } from "./rows.ts";
import { normalizeWorldOsmInput } from "./rows.ts";
import { buildCoordinateKindMap, spatialClassOf } from "./tags.ts";

// ─── Projection math ─────────────────────────────────────────────────────────

export interface WorldOffset {
	east_m: number;
	north_m: number;
}

export interface ProjectionParams {
	bearing_deg: number;
	scale: number;
}

/**
 * Clockwise bearing; scale: graph unit → metres.
 * Canonical `projectLocalPosition`; keep its established math byte-identical.
 */
export function projectLocalPosition(
	params: ProjectionParams,
	localX: number,
	localY: number,
): WorldOffset {
	const bearingRad = (params.bearing_deg * Math.PI) / 180;
	const cosB = Math.cos(bearingRad);
	const sinB = Math.sin(bearingRad);
	const scale = params.scale > 0 ? params.scale : 1;
	return {
		east_m: scale * (localX * cosB + localY * sinB),
		north_m: scale * (-localX * sinB + localY * cosB),
	};
}

/** Port of shared tool runtime `composeProjection`. */
export function composeProjection(parent: WorldOffset, child: WorldOffset): WorldOffset {
	return {
		east_m: parent.east_m + child.east_m,
		north_m: parent.north_m + child.north_m,
	};
}

/** Mean metres per degree of latitude (WGS84 equirectangular; ADR-0123 G-3). */
export const METRES_PER_DEG_LAT = 111_320;

export function worldOffsetToLatLng(
	off: WorldOffset,
	lat0: number,
	lng0: number,
): { lat: number; lon: number } {
	const cosLat = Math.cos((lat0 * Math.PI) / 180);
	const lat = lat0 + off.north_m / METRES_PER_DEG_LAT;
	const lon = lng0 + off.east_m / (METRES_PER_DEG_LAT * (cosLat === 0 ? 1e-12 : cosLat));
	return { lat, lon };
}

/** Lat/lng → plane (+x east, +y south for SVG y-down). */
export function latLngToPlane(
	lat: number,
	lng: number,
	lat0: number,
	lng0: number,
): { x: number; y: number } {
	const cosLat = Math.cos((lat0 * Math.PI) / 180);
	const east = (lng - lng0) * METRES_PER_DEG_LAT * cosLat;
	const north = (lat - lat0) * METRES_PER_DEG_LAT;
	return { x: east, y: -north };
}

export function worldOffsetToPlane(
	off: WorldOffset,
	originEast = 0,
	originNorth = 0,
): {
	x: number;
	y: number;
} {
	return {
		x: off.east_m - originEast,
		y: -(off.north_m - originNorth),
	};
}

// ─── H3 cell helpers ─────────────────────────────────────────────────────────

/** Accept decimal string / hex / number / bigint → H3 hex index, or null. */
export function cellRes10ToHex(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === "bigint") {
		if (value <= 0n) return null;
		const hex = value.toString(16);
		return isValidCell(hex) ? hex : null;
	}
	if (typeof value === "number") {
		// H3 res10 ids exceed Number.MAX_SAFE_INTEGER — refuse rather than corrupt.
		if (!(value > 0) || !Number.isFinite(value)) return null;
		if (!Number.isSafeInteger(value)) return null;
		const hex = BigInt(value).toString(16);
		return isValidCell(hex) ? hex : null;
	}
	if (typeof value === "string") {
		const s = value.trim();
		if (s === "" || s === "0") return null;
		if (/^\d+$/.test(s)) {
			try {
				const hex = BigInt(s).toString(16);
				return isValidCell(hex) ? hex : null;
			} catch {
				return null;
			}
		}
		if (/^0x[0-9a-f]+$/i.test(s) || /^[0-9a-f]*[a-f][0-9a-f]*$/i.test(s)) {
			const hex = s.replace(/^0x/i, "").toLowerCase();
			return isValidCell(hex) ? hex : null;
		}
	}
	return null;
}

export function cellCentroidLatLng(cell: unknown): { lat: number; lon: number } | null {
	const hex = cellRes10ToHex(cell);
	if (hex === null || !isValidCell(hex)) return null;
	const [lat, lon] = cellToLatLng(hex);
	return { lat, lon };
}

/** Acceptance helper: res-10 cell containing a WGS84 point (decimal string). */
export function latLngToRes10Decimal(lat: number, lon: number): string {
	const hex = latLngToCell(lat, lon, 10);
	return BigInt(`0x${hex}`).toString(10);
}

// ─── Sheet → local flip ──────────────────────────────────────────────────────

/** Sheet (y-down) → local (y-north) relative to an anchor sheet point. */
export function sheetToLocal(
	posX: number,
	posY: number,
	anchorX: number,
	anchorY: number,
): { lx: number; ly: number } {
	return { lx: posX - anchorX, ly: anchorY - posY };
}

// ─── Full-world composition ──────────────────────────────────────────────────

export interface PlacedNode {
	node: NodeRow;
	east_m: number;
	north_m: number;
	lat: number;
	lon: number;
	/** Composed bearing along the ancestor chain (degrees clockwise). */
	composed_bearing_deg: number;
}

export interface ProjectWorldResult {
	/** node_id → WGS84 */
	positions: Map<string, { lat: number; lon: number }>;
	/** Rich placement (used by export). */
	placed: Map<string, PlacedNode>;
	unplaced: UnplacedGraph[];
	diagnostics: string[];
	/** Root origin used as the equirectangular frame. */
	origin: { lat: number; lon: number; hex: string } | null;
}

export interface ProjectWorldOpts {
	/** Extra diagnostics to prepend (e.g. loader notes). */
	diagnostics?: string[];
}

type NestLink = { parentNodeId: string; childNodeId: string };

function findNestLink(
	parentGraphId: string,
	childGraphId: string,
	nodes: readonly NodeRow[],
	edges: readonly EdgeRow[],
	childAnchorId: string,
): NestLink | null {
	const parentNodes = new Set(
		nodes.filter((n) => n.place_graph_id === parentGraphId).map((n) => n.node_id),
	);
	const childNodes = new Set(
		nodes.filter((n) => n.place_graph_id === childGraphId).map((n) => n.node_id),
	);
	for (const e of edges) {
		if (parentNodes.has(e.from_node_id) && childNodes.has(e.to_node_id)) {
			return { parentNodeId: e.from_node_id, childNodeId: e.to_node_id };
		}
		if (parentNodes.has(e.to_node_id) && childNodes.has(e.from_node_id)) {
			return { parentNodeId: e.to_node_id, childNodeId: e.from_node_id };
		}
	}
	if (childAnchorId && childNodes.has(childAnchorId)) {
		const parentList = [...parentNodes];
		if (parentList.length > 0) {
			return { parentNodeId: parentList[0]!, childNodeId: childAnchorId };
		}
	}
	if (childAnchorId && parentNodes.has(childAnchorId)) {
		const childList = [...childNodes];
		if (childList.length > 0) {
			return { parentNodeId: childAnchorId, childNodeId: childList[0]! };
		}
	}
	return null;
}

/**
 * Place every placeable node in WGS84 via ADR-0123 D-1.
 * Accepts plain row bags (`readPlaceTopology` / TOML) without knowing origin.
 */
export function projectWorld(
	input: WorldOsmInput,
	opts: ProjectWorldOpts = {},
): ProjectWorldResult {
	const rows = normalizeWorldOsmInput(input);
	const { kindBySubstrate, usedBootstrapFallback } = buildCoordinateKindMap(
		rows.substrate_definitions,
	);
	const diagnostics: string[] = [...(opts.diagnostics ?? [])];
	if (usedBootstrapFallback) {
		diagnostics.push(
			"substrate_kind_fallback: no substrate_definitions rows; using kernel bootstrap seed (outdoor→h3_cell, indoor→graph_local, tactical→tactical_grid)",
		);
	}

	const graphs = rows.place_graphs.filter(
		(g) => spatialClassOf(g.substrate_id, kindBySubstrate) !== "drop",
	);
	const nodes = rows.place_nodes.filter(
		(n) => spatialClassOf(n.substrate_id, kindBySubstrate) !== "drop",
	);
	const edges = rows.place_edges;

	const placement = placeWorld(graphs, nodes, edges);
	const positions = new Map<string, { lat: number; lon: number }>();
	for (const [id, p] of placement.placed) {
		positions.set(id, { lat: p.lat, lon: p.lon });
	}

	return {
		positions,
		placed: placement.placed,
		unplaced: placement.unplacedGraphs,
		diagnostics,
		origin: placement.origin,
	};
}

/**
 * Internal placer over already-normalized typed rows.
 * Unlike shared tool runtime h3-layout (outdoor-only draw), this includes indoor children.
 */
export function placeWorld(
	graphs: readonly GraphRow[],
	nodes: readonly NodeRow[],
	edges: readonly EdgeRow[],
): {
	placed: Map<string, PlacedNode>;
	unplacedGraphs: UnplacedGraph[];
	origin: { lat: number; lon: number; hex: string } | null;
} {
	const gmeta = new Map(graphs.map((g) => [g.place_graph_id, g]));
	const nodeById = new Map(nodes.map((n) => [n.node_id, n]));
	const placed = new Map<string, PlacedNode>();
	const unplacedGraphs: UnplacedGraph[] = [];

	const roots = graphs.filter((g) => (g.parent_graph_id ?? "").trim() === "");
	const placeableRoots = roots.filter((g) => cellRes10ToHex(g.origin_cell_res10) !== null);
	for (const g of roots) {
		if (cellRes10ToHex(g.origin_cell_res10) === null && !g.is_ephemeral_instance) {
			unplacedGraphs.push({
				place_graph_id: g.place_graph_id,
				reason: "root graph without origin_cell_res10 (ADR-0123 D-1.5)",
			});
		}
	}
	if (placeableRoots.length === 0) {
		return { placed, unplacedGraphs, origin: null };
	}

	const root = [...placeableRoots].sort((a, b) =>
		a.place_graph_id.localeCompare(b.place_graph_id),
	)[0]!;
	const originHex = cellRes10ToHex(root.origin_cell_res10)!;
	const [lat0, lng0] = cellToLatLng(originHex);
	const origin = { lat: lat0, lon: lng0, hex: originHex };

	const worldById = new Map<string, WorldOffset>();
	const bearingByGraph = new Map<string, number>();

	const commitNode = (n: NodeRow, off: WorldOffset, composedBearing: number): void => {
		const { lat, lon } = worldOffsetToLatLng(off, lat0, lng0);
		worldById.set(n.node_id, off);
		placed.set(n.node_id, {
			node: n,
			east_m: off.east_m,
			north_m: off.north_m,
			lat,
			lon,
			composed_bearing_deg: composedBearing,
		});
	};

	const placeGraphMetric = (
		graphId: string,
		anchorSheet: { x: number; y: number },
		baseWorld: WorldOffset,
		composedBearing: number,
	): void => {
		const meta = gmeta.get(graphId);
		const params: ProjectionParams = {
			bearing_deg: meta?.bearing ?? 0,
			scale: meta?.metres_per_unit && meta.metres_per_unit > 0 ? meta.metres_per_unit : 1,
		};
		bearingByGraph.set(graphId, composedBearing);
		for (const n of nodes.filter((nn) => nn.place_graph_id === graphId)) {
			if (!n.pos_present) {
				// D-1.4: non-metric outdoor with cell → centroid.
				const c = cellCentroidLatLng(n.cell_res10);
				if (c) {
					const east = (c.lon - lng0) * METRES_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
					const north = (c.lat - lat0) * METRES_PER_DEG_LAT;
					commitNode(n, { east_m: east, north_m: north }, composedBearing);
				}
				continue;
			}
			const { lx, ly } = sheetToLocal(n.pos_x, n.pos_y, anchorSheet.x, anchorSheet.y);
			const rel = projectLocalPosition(params, lx, ly);
			commitNode(n, composeProjection(baseWorld, rel), composedBearing + (meta?.bearing ?? 0));
		}
	};

	const rootAnchor = nodeById.get(root.anchor_node_id);
	const rax = rootAnchor?.pos_x ?? 0;
	const ray = rootAnchor?.pos_y ?? 0;
	placeGraphMetric(root.place_graph_id, { x: rax, y: ray }, { east_m: 0, north_m: 0 }, 0);

	for (const other of placeableRoots) {
		if (other.place_graph_id === root.place_graph_id) continue;
		const hex = cellRes10ToHex(other.origin_cell_res10)!;
		const [olat, olng] = cellToLatLng(hex);
		const east = (olng - lng0) * METRES_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
		const north = (olat - lat0) * METRES_PER_DEG_LAT;
		const a = nodeById.get(other.anchor_node_id);
		placeGraphMetric(
			other.place_graph_id,
			{ x: a?.pos_x ?? 0, y: a?.pos_y ?? 0 },
			{ east_m: east, north_m: north },
			0,
		);
	}

	// BFS nested children (indoor + outdoor + tactical) via nest links.
	const placedGraphs = new Set<string>(placeableRoots.map((g) => g.place_graph_id));
	let grew = true;
	while (grew) {
		grew = false;
		for (const child of graphs) {
			if (placedGraphs.has(child.place_graph_id)) continue;
			const parentId = (child.parent_graph_id ?? "").trim();
			if (!parentId || !placedGraphs.has(parentId)) continue;
			const nest = findNestLink(parentId, child.place_graph_id, nodes, edges, child.anchor_node_id);
			if (nest === null) {
				unplacedGraphs.push({
					place_graph_id: child.place_graph_id,
					reason: `nested graph has no nest-link portal to parent '${parentId}'`,
				});
				placedGraphs.add(child.place_graph_id);
				continue;
			}
			const parentWorld = worldById.get(nest.parentNodeId);
			const childNest = nodeById.get(nest.childNodeId);
			if (!parentWorld || !childNest) continue;
			const parentBearing = bearingByGraph.get(parentId) ?? 0;

			// Tactical grids or child graphs whose anchor is a node in the parent graph
			const parentNodes = new Set(
				nodes.filter((n) => n.place_graph_id === parentId).map((n) => n.node_id),
			);
			if (child.anchor_node_id && parentNodes.has(child.anchor_node_id)) {
				const parentAnchor = nodeById.get(child.anchor_node_id);
				const childGraphNodes = nodes.filter(
					(n) => n.place_graph_id === child.place_graph_id && n.pos_present,
				);
				let centerX = 0;
				let centerY = 0;
				if (childGraphNodes.length > 0) {
					const minX = Math.min(...childGraphNodes.map((n) => n.pos_x));
					const maxX = Math.max(...childGraphNodes.map((n) => n.pos_x));
					const minY = Math.min(...childGraphNodes.map((n) => n.pos_y));
					const maxY = Math.max(...childGraphNodes.map((n) => n.pos_y));
					centerX = (minX + maxX) / 2;
					centerY = (minY + maxY) / 2;
				}
				placeGraphMetric(
					child.place_graph_id,
					{ x: centerX, y: centerY },
					parentWorld,
					parentBearing,
				);
				if (parentAnchor?.pose_elevation_present) {
					for (const n of childGraphNodes) {
						if (!n.pose_elevation_present || n.pose_elevation === 0) {
							n.pose_elevation = parentAnchor.pose_elevation;
							n.pose_elevation_present = true;
						}
					}
				}
			} else {
				placeGraphMetric(
					child.place_graph_id,
					{ x: childNest.pos_x, y: childNest.pos_y },
					parentWorld,
					parentBearing,
				);
			}
			placedGraphs.add(child.place_graph_id);
			grew = true;
		}
	}

	for (const g of graphs) {
		if (placedGraphs.has(g.place_graph_id)) continue;
		if (unplacedGraphs.some((u) => u.place_graph_id === g.place_graph_id)) continue;
		const parentId = (g.parent_graph_id ?? "").trim();
		if (parentId && unplacedGraphs.some((u) => u.place_graph_id === parentId)) {
			unplacedGraphs.push({
				place_graph_id: g.place_graph_id,
				reason: `ancestor unplaced (${parentId})`,
			});
		}
	}

	return { placed, unplacedGraphs, origin };
}

/**
 * Project a sheet-cell point of a placed graph into WGS84.
 * Used for map_layer image corners (ADR-0123 D-2 map_layer table).
 */
export function projectSheetPoint(
	sheetX: number,
	sheetY: number,
	anchorSheet: { x: number; y: number },
	baseWorld: WorldOffset,
	bearingDeg: number,
	metresPerUnit: number,
	lat0: number,
	lng0: number,
): { lat: number; lon: number } {
	const { lx, ly } = sheetToLocal(sheetX, sheetY, anchorSheet.x, anchorSheet.y);
	const rel = projectLocalPosition({ bearing_deg: bearingDeg, scale: metresPerUnit }, lx, ly);
	return worldOffsetToLatLng(composeProjection(baseWorld, rel), lat0, lng0);
}
