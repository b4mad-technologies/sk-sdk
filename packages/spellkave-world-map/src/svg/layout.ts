import { layoutOutdoorWorldByComposition, shouldUseH3WorldLayout } from "./h3-layout.ts";
import { pickDefaultSlice } from "./model.ts";
import type {
	SpatialGraphEdge,
	SpatialGraphLayout,
	SpatialGraphModel,
	SpatialGraphNode,
	SpatialSliceMode,
	SpatialViewOptions,
} from "./types.ts";

type GraphOffset = { graphId: string; offsetX: number; offsetY: number };

/**
 * Deterministic layout from already-materialized node positions,
 * multi-floor side-by-side panels, or topology-only adjacency placement.
 * Does NOT implement ADR-0029's coordinate projection kernel.
 */
export function layoutSpatialGraph(
	model: SpatialGraphModel,
	options: SpatialViewOptions & { sliceMode?: SpatialSliceMode } = {},
): SpatialGraphLayout {
	const graphId = options.graphId?.trim();
	const sliceMode = options.sliceMode ?? options.slice ?? pickDefaultSlice(model.nodes, options);

	if (sliceMode === "topology_only") {
		return layoutTopology(model, graphId);
	}
	if (sliceMode === "all_floors_offset") {
		return layoutAllFloorsOffset(model, graphId);
	}
	if (sliceMode === "h3_world") {
		return layoutH3World(model, graphId) ?? layoutMetric(model, graphId, options);
	}

	// Unfiltered outdoor compose: ADR-0029 composition + H3 footprints when root has origin.
	const graphScoped = graphId !== undefined && graphId.length > 0;
	if (
		options.preferH3World !== false &&
		shouldUseH3WorldLayout(
			graphScoped,
			model.nodes,
			new Map(model.nodes.map((n) => [n.id, n.cellRes10Hex ?? null])),
			model.graphs,
		)
	) {
		const h3 = layoutH3World(model, graphId);
		if (h3 !== null) return h3;
	}

	// metric + elevation_band: single plane from node x/y
	return layoutMetric(model, graphId, options);
}

function layoutH3World(
	model: SpatialGraphModel,
	graphId: string | undefined,
): SpatialGraphLayout | null {
	// Single-graph filter: fall back to metric (sheet view).
	if (graphId !== undefined && graphId.length > 0) return null;
	const result = layoutOutdoorWorldByComposition(model.nodes, model.edges, model.graphs);
	if (result === null) return null;
	return {
		nodes: result.nodes,
		edges: result.edges,
		graphs: result.graphs,
		hexes: result.hexes,
	};
}

function layoutMetric(
	model: SpatialGraphModel,
	graphId: string | undefined,
	options: SpatialViewOptions = {},
): SpatialGraphLayout {
	// `model.nodes` is already the authority on which graph(s) are drawn —
	// for an ordinary single-graph call that is exactly `[graphId]` (model.ts
	// filtered to only that graph's nodes, as before); for sk-pej D-2's
	// composed session-grid call, model.ts has already folded the child
	// (grid) graph's nodes into the parent's local frame and included both
	// graphIds. Deriving `selected` from the node set itself (rather than
	// trusting the single `graphId` string) picks up whichever graph(s)
	// model.ts actually included, with no separate "composed" branch here —
	// byte-identical to the old `[graphId]` for every non-composed call.
	const selected = [...new Set(model.nodes.map((node) => node.graphId))];
	const selectedSet = new Set(selected);
	const nodesByGraph = new Map<string, SpatialGraphNode[]>();
	for (const node of model.nodes) {
		if (!selectedSet.has(node.graphId)) continue;
		const group = nodesByGraph.get(node.graphId) ?? [];
		group.push(node);
		nodesByGraph.set(node.graphId, group);
	}
	const graphOffsets =
		graphId === undefined || graphId.length === 0
			? composeGraphOffsets(nodesByGraph, model.edges)
			: combinedBoundsOffsets(nodesByGraph);
	const nodes = model.nodes
		.filter((node) => selectedSet.has(node.graphId))
		.flatMap((node) => {
			const offset = graphOffsets.get(node.graphId);
			if (offset === undefined) return [];
			return [{ ...node, x: node.x + offset.offsetX, y: node.y + offset.offsetY }];
		});
	const graphs = [...graphOffsets.values()].filter((offset) => selectedSet.has(offset.graphId));
	// Indoor/tactical plans: flip Y so larger authored y reads "up" on the page.
	// sheetAlign keeps image-cell coords (y-down) for backdrop-aligned product views.
	const indoorish =
		!options.sheetAlign &&
		nodes.some((n) => n.substrateId === "indoor" || n.substrateId === "tactical");
	const oriented = indoorish ? flipYInPlace(nodes) : nodes;
	const nodeIds = new Set(oriented.map((node) => node.id));
	const edges = model.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));
	return { nodes: oriented, edges, graphs };
}

function flipYInPlace(nodes: SpatialGraphNode[]): SpatialGraphNode[] {
	if (nodes.length === 0) return nodes;
	const b = mapBounds(nodes);
	return nodes.map((n) => ({ ...n, y: b.maxY - (n.y - b.minY) }));
}

/**
 * Place each elevation in a **uniform** panel, stacked top→bottom (highest z first).
 * Y is flipped inside each panel (architectural: +y up on the page).
 * Cross-floor edges are marked for dashed "stairs" rendering.
 */
function layoutAllFloorsOffset(
	model: SpatialGraphModel,
	graphId: string | undefined,
): SpatialGraphLayout {
	const selected =
		graphId === undefined || graphId.length === 0
			? model.nodes
			: model.nodes.filter((n) => n.graphId === graphId);
	const byFloor = new Map<number, SpatialGraphNode[]>();
	for (const node of selected) {
		const z = Math.round(node.elevation * 1000) / 1000;
		const group = byFloor.get(z) ?? [];
		group.push(node);
		byFloor.set(z, group);
	}
	const floors = [...byFloor.keys()].sort((a, b) => b - a); // highest elevation at top

	// Uniform content box = max span of any floor (so a 1-node cellar isn't a stamp).
	let contentW = 1;
	let contentH = 1;
	for (const z of floors) {
		const b = mapBounds(byFloor.get(z) ?? []);
		contentW = Math.max(contentW, b.maxX - b.minX, 1);
		contentH = Math.max(contentH, b.maxY - b.minY, 1);
	}
	const pad = 1.5;
	const panelW = contentW + pad * 2;
	const panelH = contentH + pad * 2 + 1.2; // title strip
	const gap = 2.5;

	const laid: SpatialGraphNode[] = [];
	const panels: NonNullable<SpatialGraphLayout["floorPanels"]> = [];
	const elevById = new Map<string, number>();
	let cursorY = 0;
	for (const z of floors) {
		const floorNodes = byFloor.get(z) ?? [];
		const bounds = mapBounds(floorNodes);
		const spanX = bounds.maxX - bounds.minX;
		const spanY = bounds.maxY - bounds.minY;
		const ox = pad + (contentW - spanX) / 2 - bounds.minX;
		const oyBase = cursorY + pad + 1.0;
		const placed = floorNodes.map((n) => {
			const localY = n.y - bounds.minY;
			const flippedY = spanY - localY;
			elevById.set(n.id, z);
			return {
				...n,
				x: n.x + ox,
				y: oyBase + flippedY + (contentH - spanY) / 2,
			};
		});
		laid.push(...placed);
		panels.push({
			elevation: z,
			title: floorTitle(z),
			minX: 0,
			minY: cursorY,
			maxX: panelW,
			maxY: cursorY + panelH,
		});
		cursorY += panelH + gap;
	}

	const nodeIds = new Set(laid.map((n) => n.id));
	const edges = model.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
	const crossFloorEdgeKeys: string[] = [];
	for (const e of edges) {
		const za = elevById.get(e.from);
		const zb = elevById.get(e.to);
		if (za !== undefined && zb !== undefined && za !== zb) {
			crossFloorEdgeKeys.push(edgeKey(e.from, e.to));
		}
	}
	const graphs =
		graphId === undefined || graphId.length === 0
			? [...new Set(laid.map((n) => n.graphId))].map((id) => ({
					graphId: id,
					offsetX: 0,
					offsetY: 0,
				}))
			: [{ graphId, offsetX: 0, offsetY: 0 }];
	return { nodes: laid, edges, graphs, floorPanels: panels, crossFloorEdgeKeys };
}

function floorTitle(z: number): string {
	if (Math.abs(z) < 1e-9) return "Ground floor (z=0)";
	if (z < 0) return `Below (z=${fmtZ(z)})`;
	return `Upper (z=${fmtZ(z)})`;
}

function fmtZ(z: number): string {
	return Number.isInteger(z) ? String(z) : z.toFixed(1);
}

function edgeKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Deterministic adjacency layout: BFS levels left→right, siblings top→bottom.
 * Ignores authored x/y (topology_only).
 */
function layoutTopology(model: SpatialGraphModel, graphId: string | undefined): SpatialGraphLayout {
	const selected =
		graphId === undefined || graphId.length === 0
			? model.nodes
			: model.nodes.filter((n) => n.graphId === graphId);
	if (selected.length === 0) {
		return { nodes: [], edges: [], graphs: [] };
	}
	const ids = selected.map((n) => n.id).sort((a, b) => a.localeCompare(b));
	const idSet = new Set(ids);
	const adj = new Map<string, string[]>();
	for (const id of ids) adj.set(id, []);
	for (const edge of model.edges) {
		if (!idSet.has(edge.from) || !idSet.has(edge.to)) continue;
		adj.get(edge.from)!.push(edge.to);
		adj.get(edge.to)!.push(edge.from);
	}
	for (const [k, v] of adj)
		adj.set(
			k,
			[...new Set(v)].sort((a, b) => a.localeCompare(b)),
		);

	// Prefer graph anchor / model.root so entrance leads left→right.
	const root = model.root !== null && idSet.has(model.root) ? model.root : ids[0]!;
	const level = new Map<string, number>();
	const order = new Map<string, number>();
	const queue = [root];
	level.set(root, 0);
	order.set(root, 0);
	let qi = 0;
	const perLevelCount = new Map<number, number>([[0, 1]]);
	while (qi < queue.length) {
		const cur = queue[qi++]!;
		const L = level.get(cur)!;
		for (const next of adj.get(cur) ?? []) {
			if (level.has(next)) continue;
			const nL = L + 1;
			const idx = perLevelCount.get(nL) ?? 0;
			perLevelCount.set(nL, idx + 1);
			level.set(next, nL);
			order.set(next, idx);
			queue.push(next);
		}
	}
	// Disconnected components
	for (const id of ids) {
		if (level.has(id)) continue;
		const nL = Math.max(0, ...level.values()) + 2;
		const idx = perLevelCount.get(nL) ?? 0;
		perLevelCount.set(nL, idx + 1);
		level.set(id, nL);
		order.set(id, idx);
	}

	const xGap = 6;
	const yGap = 4;
	const byId = new Map(selected.map((n) => [n.id, n] as const));
	const laid = ids.map((id) => {
		const n = byId.get(id)!;
		const L = level.get(id) ?? 0;
		const o = order.get(id) ?? 0;
		const levelSize = perLevelCount.get(L) ?? 1;
		const y = (o - (levelSize - 1) / 2) * yGap;
		return { ...n, x: L * xGap, y };
	});
	const nodeIds = new Set(laid.map((n) => n.id));
	const edges = model.edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
	const graphs = [
		{
			graphId: graphId ?? selected[0]!.graphId,
			offsetX: 0,
			offsetY: 0,
		},
	];
	// Normalize to origin
	const b = mapBounds(laid);
	const nodes = laid.map((n) => ({ ...n, x: n.x - b.minX, y: n.y - b.minY }));
	return { nodes, edges, graphs };
}

/**
 * ONE bounds-normalising offset computed over ALL graphs' nodes together,
 * applied identically to every graph key present. For the pre-existing
 * single-graph call (`nodesByGraph.size === 1`) this is byte-identical to
 * the old per-graph-independent `singleGraphOffsets` it replaces — bounds
 * over "the one graph's nodes" either way. For sk-pej D-2's composed
 * session-grid call (`nodesByGraph.size === 2`: parent + grid, the grid's
 * nodes already expressed in the parent's own local frame by model.ts),
 * computing ONE shared offset — rather than each graph's own independent
 * bounds-normalise — is what keeps the grid and its parent's own nodes (and,
 * via `layout.graphs` sharing this same offset, the parent's backdrop image)
 * moving together as a rigid body instead of each being re-centred on its
 * own bounds and drifting apart.
 */
function combinedBoundsOffsets(
	nodesByGraph: Map<string, SpatialGraphNode[]>,
): Map<string, GraphOffset> {
	const bounds = mapBounds([...nodesByGraph.values()].flat());
	const offsets = new Map<string, GraphOffset>();
	for (const graphId of nodesByGraph.keys()) {
		offsets.set(graphId, { graphId, offsetX: -bounds.minX, offsetY: -bounds.minY });
	}
	return offsets;
}

function composeGraphOffsets(
	nodesByGraph: Map<string, SpatialGraphNode[]>,
	edges: readonly SpatialGraphEdge[],
): Map<string, GraphOffset> {
	const offsets = new Map<string, GraphOffset>();
	const nodeById = new Map(
		[...nodesByGraph.values()].flat().map((node) => [node.id, node] as const),
	);
	const sortedGraphIds = [...nodesByGraph.keys()].sort((a, b) =>
		graphSortKey(a).localeCompare(graphSortKey(b)),
	);
	let cursorX = 0;
	for (const id of sortedGraphIds) {
		if (offsets.has(id)) continue;
		const bounds = mapBounds(nodesByGraph.get(id) ?? []);
		offsets.set(id, { graphId: id, offsetX: cursorX - bounds.minX, offsetY: -bounds.minY });
		propagateGraphOffsets(offsets, nodeById, edges);
		const placedBounds = transformedBounds(offsets, nodesByGraph);
		cursorX = placedBounds.maxX + 18;
	}
	return offsets;
}

function propagateGraphOffsets(
	offsets: Map<string, GraphOffset>,
	nodeById: Map<string, SpatialGraphNode>,
	edges: readonly SpatialGraphEdge[],
): void {
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of edges) {
			const from = nodeById.get(edge.from);
			const to = nodeById.get(edge.to);
			if (from === undefined || to === undefined) continue;
			const fromOff = offsets.get(from.graphId);
			const toOff = offsets.get(to.graphId);
			if (fromOff !== undefined && toOff === undefined) {
				offsets.set(to.graphId, {
					graphId: to.graphId,
					offsetX: fromOff.offsetX + from.x - to.x,
					offsetY: fromOff.offsetY + from.y - to.y,
				});
				changed = true;
			} else if (toOff !== undefined && fromOff === undefined) {
				offsets.set(from.graphId, {
					graphId: from.graphId,
					offsetX: toOff.offsetX + to.x - from.x,
					offsetY: toOff.offsetY + to.y - from.y,
				});
				changed = true;
			}
		}
	}
}

function transformedBounds(
	offsets: Map<string, GraphOffset>,
	nodesByGraph: Map<string, SpatialGraphNode[]>,
): { minX: number; minY: number; maxX: number; maxY: number } {
	const pts: SpatialGraphNode[] = [];
	for (const [graphId, nodes] of nodesByGraph) {
		const off = offsets.get(graphId);
		if (off === undefined) continue;
		for (const n of nodes) {
			pts.push({ ...n, x: n.x + off.offsetX, y: n.y + off.offsetY });
		}
	}
	return mapBounds(pts);
}

function graphSortKey(graphId: string): string {
	return graphId;
}

export function mapBounds(nodes: readonly { x: number; y: number }[]): {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
} {
	if (nodes.length === 0) {
		return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
	}
	let minX = nodes[0]!.x;
	let minY = nodes[0]!.y;
	let maxX = nodes[0]!.x;
	let maxY = nodes[0]!.y;
	for (const n of nodes) {
		minX = Math.min(minX, n.x);
		minY = Math.min(minY, n.y);
		maxX = Math.max(maxX, n.x);
		maxY = Math.max(maxY, n.y);
	}
	return { minX, minY, maxX, maxY };
}
