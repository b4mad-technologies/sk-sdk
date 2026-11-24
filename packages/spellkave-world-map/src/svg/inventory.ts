import type { SpatialGraphModel } from "./types.ts";

/** Tactical-grid cell ids minted as `…/c_<x>_<y>` (session grids, ADR-0052). */
const TACTICAL_GRID_CELL_ID = /\/c_-?\d+_-?\d+$/;

/** A grid cell is not a listed place: composed cells are unlabeled, and
 * bare-grid (compose_parent=false) cells keep their labels but still share
 * the same `c_x_y` identity. */
export function isTacticalGridCell(node: SpatialGraphModel["nodes"][number]): boolean {
	return node.unlabeled === true || TACTICAL_GRID_CELL_ID.test(node.id);
}

/** How many understandable places the map list should report: named rooms /
 * outdoor nodes, or one row per grid layer when the slice is cells only.
 * Never one row per cell (sk-zz8). */
export function countMapPlaces(model: SpatialGraphModel): number {
	const named = model.nodes.filter((n) => !isTacticalGridCell(n)).length;
	if (named > 0) return named;
	return groupByGraph(model.nodes.filter(isTacticalGridCell)).size;
}

/** Agent-facing text inventory: coords, elevation, adjacency, occupancy, floors. */
export function renderSpatialGraphTextInventory(model: SpatialGraphModel): string {
	if (model.nodes.length === 0) {
		return "Spatial graph: empty (no positioned place_nodes for this slice/filter).";
	}
	const lines: string[] = [];
	const gridNodes = model.nodes.filter(isTacticalGridCell);
	const visibleNodes = model.nodes.filter((n) => !isTacticalGridCell(n));
	const gridNodeIds = new Set(gridNodes.map((n) => n.id));
	const visibleEdges = model.edges.filter(
		(e) => !(gridNodeIds.has(e.from) && gridNodeIds.has(e.to)),
	);
	const adj = adjacency(visibleNodes, visibleEdges);
	const connectionCount = new Set(
		visibleEdges.map((e) => [e.from, e.to].sort((a, b) => a.localeCompare(b)).join("—")),
	).size;
	lines.push(
		`Spatial inventory: ${visibleNodes.length} named places` +
			(gridNodes.length > 0 ? `; ${gridNodes.length}-cell grid` : "") +
			`; ${connectionCount} named connections; slice=${model.sliceLabel}`,
	);
	const scales = [...new Set(model.graphs.map((g) => g.metresPerUnit))];
	if (scales.length === 1 && scales[0] !== undefined) {
		const s = scales[0];
		lines.push(`1 graph unit = ${s === 1 ? "1 m" : `${s} m`} (place_graph.metres_per_unit)`);
		if (model.nodes.length >= 2) {
			const xs = model.nodes.map((n) => n.x);
			const ys = model.nodes.map((n) => n.y);
			const dx = Math.max(...xs) - Math.min(...xs);
			const dy = Math.max(...ys) - Math.min(...ys);
			if (dx > 0) lines.push(`Δx ${dx * s} m (bbox)`);
			if (dy > 0) lines.push(`Δy ${dy * s} m (bbox)`);
		}
	}
	if (model.floors.length > 0) {
		lines.push(`Floors (elevation): ${model.floors.map((z) => formatZ(z)).join(", ")}`);
	}

	const occ = new Map(model.actorClusters.map((c) => [c.placeNodeId, c.count]));

	lines.push("NODES (id | name | x,y,z | occupants | adjacent)");
	const sorted = [...visibleNodes].sort((a, b) => a.id.localeCompare(b.id));
	for (const n of sorted) {
		const count = occ.get(n.id) ?? 0;
		const zBit = n.elevationPresent || n.elevation !== 0 ? formatZ(n.elevation) : "0";
		const neighbours = adj.get(n.id) ?? [];
		lines.push(
			`  ${n.id}  "${n.label}"  (${n.x}, ${n.y}, z=${zBit})` +
				(count > 0 ? `  actors=${count}` : "") +
				`  adjacent=[${neighbours.join(", ")}]`,
		);
	}
	for (const [graphId, cells] of groupByGraph(gridNodes)) {
		const graph = model.graphs.find((g) => g.graphId === graphId);
		const width = new Set(cells.map((n) => n.x)).size;
		const height = new Set(cells.map((n) => n.y)).size;
		const cellSize = graph?.metresPerUnit ?? 1;
		lines.push(
			`  GRID ${graphId}  ${width}x${height} cells  cell=${formatZ(cellSize)} m` +
				`  anchor=${graph?.anchorNodeId || "?"}`,
		);
		const drillDown = visibleNodes.length === 0;
		for (const cell of cells.sort((a, b) => a.id.localeCompare(b.id))) {
			const count = occ.get(cell.id) ?? 0;
			// A composed tactical grid is centred in its anchor's own extent, so
			// repeating that tautological overlap on every cell adds no signal.
			// Other visible place extents remain useful map-local landmarks.
			const overlaps = visibleNodes.filter(
				(node) => node.id !== graph?.anchorNodeId && containsPoint(node, cell.x, cell.y),
			);
			const notable = model.notableScopes.filter((scope) => containsPoint(scope, cell.x, cell.y));
			// Composed listing collapses empty cells under the GRID row. A bare
			// grid (no named parent) is the drill-down: list every cell id.
			if (count > 0 || overlaps.length > 0 || notable.length > 0 || drillDown) {
				lines.push(
					`    ${cell.id}` +
						(count > 0 ? `  actors=${count}` : "") +
						(overlaps.length > 0 ? `  overlaps=[${overlaps.map((n) => n.id).join(", ")}]` : "") +
						(notable.length > 0
							? `  notable=[${notable.map((n) => `${n.nicheId}@${n.anchorNodeId}`).join(", ")}]`
							: ""),
				);
			}
		}
	}
	return lines.join("\n");
}

/** Mirrors the kernel's planar extent-overlap test for the two extent shapes
 * projected by the map model. This is the strongest map-local notable-cell
 * signal available: attachment rows are intentionally not part of the
 * player-scoped topology projection, while inherited local attachments use
 * this same containing extent as their spatial scope. */
function containsPoint(
	node: SpatialGraphModel["nodes"][number] | SpatialGraphModel["notableScopes"][number],
	x: number,
	y: number,
): boolean {
	const extent = node.extent;
	if (extent === undefined || extent.widthUnits <= 0 || extent.heightUnits <= 0) return false;
	const dx = Math.abs(x - node.x);
	const dy = Math.abs(y - node.y);
	const rx = extent.widthUnits / 2;
	const ry = extent.heightUnits / 2;
	if (extent.shapeId === "core/area/sphere") {
		return (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) <= 1;
	}
	if (extent.shapeId === "core/area/cube") return dx <= rx && dy <= ry;
	return false;
}

function formatZ(z: number): string {
	if (Number.isInteger(z)) return String(z);
	return z.toFixed(2).replace(/\.?0+$/, "");
}

function adjacency(
	nodes: readonly SpatialGraphModel["nodes"][number][],
	edges: readonly SpatialGraphModel["edges"][number][],
): Map<string, string[]> {
	const m = new Map<string, string[]>();
	for (const n of nodes) m.set(n.id, []);
	for (const e of edges) {
		if (!m.has(e.from) || !m.has(e.to)) continue;
		m.get(e.from)!.push(e.to);
		m.get(e.to)!.push(e.from);
	}
	for (const [k, v] of m) {
		m.set(
			k,
			[...new Set(v)].sort((a, b) => a.localeCompare(b)),
		);
	}
	return m;
}

function groupByGraph(
	nodes: readonly SpatialGraphModel["nodes"][number][],
): Map<string, SpatialGraphModel["nodes"]> {
	const groups = new Map<string, SpatialGraphModel["nodes"]>();
	for (const node of nodes) {
		const group = groups.get(node.graphId) ?? [];
		group.push(node);
		groups.set(node.graphId, group);
	}
	return groups;
}
