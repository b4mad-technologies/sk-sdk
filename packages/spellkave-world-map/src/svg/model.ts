import {
	composeChildLocalToParentFrame,
	isEphemeralInstanceGraph,
	localBoundsCenter,
	metresPerParentLocalUnit,
} from "./compose.ts";
import { cellRes10ToHex } from "./h3-layout.ts";
import type {
	SpatialGraphEdge,
	SpatialGraphModel,
	SpatialGraphNode,
	SpatialGraphNodeExtent,
	SpatialGraphToolRows,
	SpatialSliceMode,
	SpatialViewOptions,
} from "./types.ts";

function stringValue(row: Record<string, unknown>, key: string): string | null {
	const value = row[key];
	return typeof value === "string" ? value : null;
}

function numberValue(row: Record<string, unknown>, key: string): number | null {
	const value = row[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(row: Record<string, unknown>, key: string): boolean {
	return row[key] === true;
}

function titleFromId(id: string): string {
	return (id.split("/").at(-1) ?? id)
		.replaceAll("_", " ")
		.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function roundFloor(elevation: number): number {
	// Snap near-integers so 0.0 and -0.0 and 0.01 band as one floor key.
	return Math.round(elevation * 1000) / 1000;
}

/**
 * Auto-pick slice when the caller omits `slice`.
 * Indoor/tactical multi-floor → elevation_band; unpositioned → topology_only; else metric.
 */
export function pickDefaultSlice(
	nodes: readonly SpatialGraphNode[],
	options: SpatialViewOptions,
): SpatialSliceMode {
	if (options.slice !== undefined) return options.slice;
	const graphScoped = options.graphId !== undefined && options.graphId.trim().length > 0;
	// Outdoor world compose: same H3 plane methodology as web when cells exist.
	if (!graphScoped && options.preferH3World !== false) {
		const withCell = nodes.filter((n) => n.cellRes10Hex).length;
		if (withCell >= 2 && withCell / Math.max(nodes.length, 1) >= 0.5) return "h3_world";
	}
	const positioned = nodes.filter((n) => Number.isFinite(n.x) && Number.isFinite(n.y));
	if (positioned.length === 0 && nodes.length > 0) return "topology_only";
	const floors = new Set(positioned.map((n) => roundFloor(n.elevation)));
	const indoorish = positioned.some(
		(n) => n.substrateId === "indoor" || n.substrateId === "tactical",
	);
	if (indoorish && floors.size > 1) return "elevation_band";
	return "metric";
}

/**
 * Build a spatial-graph model from tool-result-shaped row arrays
 * (`spellkave_query` list rows or equivalent manifest row objects).
 */
export function buildSpatialGraphModel(
	rows: SpatialGraphToolRows,
	options: SpatialViewOptions = {},
): SpatialGraphModel {
	const graphRows = rows.place_graphs ?? [];
	const allNodes = rows.place_nodes ?? [];
	const selectedGraph = options.graphId?.trim();
	const graphScoped = selectedGraph !== undefined && selectedGraph.length > 0;

	const graphMetaById = new Map<
		string,
		{
			metresPerUnit: number;
			substrateId: string | null;
			displayName: string | null;
			parentGraphId: string;
			originCellRes10Hex: string | null;
			bearing: number;
			anchorNodeId: string | null;
			isEphemeralInstance: boolean;
		}
	>();
	for (const row of graphRows) {
		const id = stringValue(row, "place_graph_id");
		if (id === null) continue;
		const metresPerUnit = numberValue(row, "metres_per_unit");
		const bearing = numberValue(row, "bearing");
		graphMetaById.set(id, {
			metresPerUnit: metresPerUnit !== null && metresPerUnit > 0 ? metresPerUnit : 1,
			substrateId: stringValue(row, "substrate_id"),
			displayName: stringValue(row, "display_name"),
			parentGraphId: stringValue(row, "parent_graph_id") ?? "",
			originCellRes10Hex: cellRes10ToHex(row.origin_cell_res10),
			bearing: bearing ?? 0,
			anchorNodeId: stringValue(row, "anchor_node_id"),
			isEphemeralInstance: isEphemeralInstanceGraph(row, id),
		});
	}

	// sk-pej D-2: compose an ephemeral session-grid graph over its parent's
	// own topology by default (operator decision 2026-08-13 — "one picture,
	// no mode switch"). Gated on is_ephemeral_instance (NOT merely a
	// non-empty parent_graph_id) so ordinary authored nesting — elven-mini's
	// tomb/inn under hamlet, is_ephemeral_instance=false — never composes;
	// see compose.ts's isEphemeralInstanceGraph doc for why that gate is
	// load-bearing (committed elevation_band renders would otherwise move).
	const composeParentOpt = options.composeParent !== false;
	const selectedMeta = graphScoped ? graphMetaById.get(selectedGraph!) : undefined;
	const composeParentGraphId =
		composeParentOpt && selectedMeta?.isEphemeralInstance === true && selectedMeta.parentGraphId
			? selectedMeta.parentGraphId
			: "";
	const composeParentGraph = composeParentGraphId !== "" && graphMetaById.has(composeParentGraphId);
	const includedGraphIds = graphScoped
		? new Set(composeParentGraph ? [selectedGraph!, composeParentGraphId] : [selectedGraph!])
		: null;

	// Collect candidates (respect graph filter + outdoor world-compose rule).
	type Raw = {
		id: string;
		label: string;
		graphId: string;
		x: number | null;
		y: number | null;
		posPresent: boolean;
		elevation: number;
		elevationPresent: boolean;
		substrateId: string | null;
		cellRes10Hex: string | null;
		extent: SpatialGraphNodeExtent | null;
		/** Set only for composed tactical-grid cells; see SpatialGraphNode. */
		unlabeled?: boolean;
	};
	/** Planar geometry (graph-local units) of a node's own authored extent, or
	 * null when none is authored / the shape carries no supported geometry. Metre →
	 * unit conversion uses the node graph's backdrop grid distance when present,
	 * because positioned backdrop coordinates are image cells; otherwise it
	 * falls back to the graph's metres_per_unit.
	 * Bundle defaults are deliberately not resolved here (no mod_bundle rows
	 * in the tool row set) — an unauthored node keeps the renderer's 1-unit
	 * fallback footprint. */
	const explicitExtent = (
		row: Record<string, unknown>,
		graphId: string,
	): SpatialGraphNodeExtent | null => {
		const shapeId = stringValue(row, "extent_shape_id");
		if (shapeId === null || shapeId.length === 0) return null;
		let params: Record<string, unknown>;
		try {
			params = JSON.parse(stringValue(row, "extent_params_json") ?? "");
		} catch {
			return null;
		}
		const mapLayer = (rows.map_layers ?? []).find(
			(candidate) => stringValue(candidate, "place_graph_id") === graphId,
		);
		const metresPerUnit = metresPerParentLocalUnit(
			mapLayer,
			graphMetaById.get(graphId)?.metresPerUnit ?? 1,
		);
		const num = (key: string): number | null =>
			typeof params[key] === "number" && (params[key] as number) > 0
				? (params[key] as number)
				: null;
		// Keep planar axes separate. sk-6rm may widen the existing shape params
		// rather than add ids; accepting either form here prevents this renderer
		// from baking in a scalar-only model.
		const halfAxes: [number | null, number | null] | null =
			shapeId === "core/area/sphere"
				? [num("radius_x_m") ?? num("radius_m"), num("radius_y_m") ?? num("radius_m")]
				: shapeId === "core/area/cube"
					? [num("extent_x_m") ?? num("extent_m"), num("extent_y_m") ?? num("extent_m")]
					: null;
		if (halfAxes === null || halfAxes[0] === null || halfAxes[1] === null) return null;
		const halfDepthMetres =
			shapeId === "core/area/sphere"
				? (num("radius_z_m") ?? num("radius_m"))
				: (num("extent_z_m") ?? num("extent_m"));
		if (halfDepthMetres === null) return null;
		return {
			shapeId,
			params,
			widthUnits: (halfAxes[0] * 2) / metresPerUnit,
			heightUnits: (halfAxes[1] * 2) / metresPerUnit,
			depthMetres: halfDepthMetres * 2,
		};
	};
	const raws: Raw[] = [];
	for (const row of allNodes) {
		const id = stringValue(row, "node_id");
		const graphId = stringValue(row, "place_graph_id");
		if (id === null || graphId === null) continue;
		if (graphScoped) {
			if (!includedGraphIds!.has(graphId)) continue;
		} else {
			const substrate = stringValue(row, "substrate_id");
			// Unfiltered world compose: outdoor only (legacy).
			if (substrate !== "outdoor") continue;
		}
		const elevN = numberValue(row, "pose_elevation");
		const elevPresent = booleanValue(row, "pose_elevation_present");
		raws.push({
			id,
			label: stringValue(row, "display_name") ?? titleFromId(id),
			graphId,
			x: numberValue(row, "pos_x"),
			y: numberValue(row, "pos_y"),
			posPresent: booleanValue(row, "pos_present"),
			elevation: elevPresent && elevN !== null ? elevN : (elevN ?? 0),
			elevationPresent: elevPresent || elevN !== null,
			substrateId: stringValue(row, "substrate_id"),
			cellRes10Hex: cellRes10ToHex(row.cell_res10),
			extent: explicitExtent(row, graphId),
		});
	}

	// sk-pej D-2: fold the child (grid) graph's raw local coordinates into
	// the PARENT's own local frame, in place, before slicing/layout ever
	// see them — downstream (pickDefaultSlice probe, asNodes, layout.ts's
	// bounds-normalising offset) then treats the composed set as one shared
	// coordinate space, so parent nodes and the grid move together as a
	// rigid body (and, via layout.graphs including the parent's own graph
	// id, its authored [[map_layers]] backdrop lines up too — render-svg.ts
	// matches backdrops by graph id already present in the laid-out set).
	if (composeParentGraph) {
		const parentMeta = graphMetaById.get(composeParentGraphId)!;
		const anchorNodeId = selectedMeta!.anchorNodeId;
		const anchorRaw =
			anchorNodeId !== null && anchorNodeId.length > 0
				? raws.find((r) => r.graphId === composeParentGraphId && r.id === anchorNodeId)
				: undefined;
		if (anchorRaw !== undefined && anchorRaw.x !== null && anchorRaw.y !== null) {
			const childPositioned = raws.filter(
				(r) => r.graphId === selectedGraph && r.x !== null && r.y !== null,
			);
			const center = localBoundsCenter(
				childPositioned.map((r) => ({ x: r.x as number, y: r.y as number })),
			);
			// The ONE metres -> parent-graph-local-unit conversion (compose.ts's
			// metresPerParentLocalUnit doc has the full grounding): prefer the
			// parent's OWN [[map_layers]] row's grid_distance_m (already metres
			// since sk-yze) over its place_graph_definition.metres_per_unit,
			// which is frequently an unmaintained default disconnected from the
			// backdrop's real cell size.
			const parentMapLayerRow = (rows.map_layers ?? []).find(
				(row) => stringValue(row, "place_graph_id") === composeParentGraphId,
			);
			const composeParams = {
				childMetresPerUnit: selectedMeta!.metresPerUnit,
				parentMetresPerUnit: metresPerParentLocalUnit(parentMapLayerRow, parentMeta.metresPerUnit),
				bearingDeg: selectedMeta!.bearing,
				anchor: { x: anchorRaw.x, y: anchorRaw.y },
				center,
			};
			for (const r of childPositioned) {
				const p = composeChildLocalToParentFrame(r.x as number, r.y as number, composeParams);
				r.x = p.x;
				r.y = p.y;
				// generate_tactical_grid hardcodes pose_elevation=0 regardless of
				// the anchor's real floor (tactical_grid.rs) — composing onto the
				// wrong elevation band would silently drop the grid from the
				// default elevation_band slice (z=0±0.5). Adopt the anchor's own
				// elevation instead so the composed picture stays on one floor.
				r.elevation = anchorRaw.elevation;
				r.elevationPresent = anchorRaw.elevationPresent;
				// 100 "Cell 4,7" labels smear into an unreadable band across the
				// backdrop art and carry no information a reader wants — the mark
				// IS the cell. Suppressed only for COMPOSED cells: a caller who
				// asks for the bare grid (compose_parent=false) has no backdrop to
				// collide with and keeps its labels.
				r.unlabeled = true;
			}
		}
	}

	const asNodes = (list: Raw[], forceTopology: boolean): SpatialGraphNode[] =>
		list.flatMap((r) => {
			if (forceTopology) {
				return [
					{
						id: r.id,
						label: r.label,
						unlabeled: r.unlabeled,
						graphId: r.graphId,
						x: 0,
						y: 0,
						elevation: r.elevation,
						elevationPresent: r.elevationPresent,
						substrateId: r.substrateId,
						cellRes10Hex: r.cellRes10Hex,
						extent: r.extent ?? undefined,
						extentUnits: r.extent ? Math.max(r.extent.widthUnits, r.extent.heightUnits) : undefined,
					},
				];
			}
			// H3 world can place cells without graph-local pos; metric still needs pos.
			const allowCellOnly = options.slice === "h3_world" || !graphScoped;
			if ((!r.posPresent || r.x === null || r.y === null) && !(allowCellOnly && r.cellRes10Hex)) {
				return [];
			}
			return [
				{
					id: r.id,
					label: r.label,
					unlabeled: r.unlabeled,
					graphId: r.graphId,
					x: r.x ?? 0,
					y: r.y ?? 0,
					elevation: r.elevation,
					elevationPresent: r.elevationPresent,
					substrateId: r.substrateId,
					cellRes10Hex: r.cellRes10Hex,
					extent: r.extent ?? undefined,
					extentUnits: r.extent ? Math.max(r.extent.widthUnits, r.extent.heightUnits) : undefined,
				},
			];
		});

	// Pre-slice positioned nodes for floor discovery / auto mode.
	const positionedProbe = asNodes(raws, false);
	const sliceMode = pickDefaultSlice(
		positionedProbe.length > 0
			? positionedProbe
			: asNodes(raws, true).map((n, i) => ({ ...n, x: i, y: 0 })),
		options,
	);

	let working = asNodes(raws, sliceMode === "topology_only");
	const allFloors = [...new Set(working.map((n) => roundFloor(n.elevation)))].sort((a, b) => a - b);

	let sliceLabel: string = sliceMode;
	if (sliceMode === "elevation_band") {
		const z = options.z ?? 0;
		const tol = options.zTolerance ?? 0.5;
		working = working.filter((n) => Math.abs(n.elevation - z) <= tol);
		sliceLabel = `elevation_band z=${z}±${tol}`;
	} else if (sliceMode === "all_floors_offset") {
		sliceLabel = `all_floors_offset floors=[${allFloors.join(",")}]`;
	} else if (sliceMode === "topology_only") {
		sliceLabel = "topology_only";
	} else if (sliceMode === "h3_world") {
		sliceLabel = "h3_world";
	} else {
		sliceLabel = "metric";
	}

	const nodes = working;
	const attachmentAnchorById = new Map(
		(rows.notable_anchor_nodes ?? []).flatMap((row) => {
			const id = stringValue(row, "node_id");
			return id === null ? [] : [[id, row] as const];
		}),
	);
	const notableScopes = (rows.visible_spatial_niche_attachments ?? []).flatMap((attachment) => {
		const anchorNodeId = stringValue(attachment, "place_node_id");
		const nicheId = stringValue(attachment, "niche_id");
		if (anchorNodeId === null || anchorNodeId === "" || nicheId === null) return [];
		const anchor = attachmentAnchorById.get(anchorNodeId);
		if (anchor === undefined) return [];
		const graphId = stringValue(anchor, "place_graph_id");
		const x = numberValue(anchor, "pos_x");
		const y = numberValue(anchor, "pos_y");
		if (graphId === null || x === null || y === null || !booleanValue(anchor, "pos_present"))
			return [];
		if (includedGraphIds !== null && !includedGraphIds.has(graphId)) return [];
		const extent = explicitExtent(anchor, graphId);
		return extent === null ? [] : [{ anchorNodeId, nicheId, x, y, extent }];
	});
	const nodeIds = new Set(nodes.map((node) => node.id));
	const edges: SpatialGraphEdge[] = (rows.place_edges ?? []).flatMap((row) => {
		const from = stringValue(row, "from_node_id");
		const to = stringValue(row, "to_node_id");
		if (from === null || to === null) return [];
		// Single-graph: both ends must be present.
		if (graphScoped) {
			if (!nodeIds.has(from) || !nodeIds.has(to)) return [];
		} else {
			// Outdoor world: keep edges touching any outdoor node (indoor portal stubs).
			if (!nodeIds.has(from) && !nodeIds.has(to)) return [];
		}
		return [{ from, to, graphId: stringValue(row, "place_graph_id") ?? "" }];
	});

	const actorByPlace = new Map<string, number>();
	for (const row of rows.actor_spatial_locations ?? []) {
		const place = stringValue(row, "place_node_id");
		if (place === null || !nodeIds.has(place)) continue;
		actorByPlace.set(place, (actorByPlace.get(place) ?? 0) + 1);
	}

	const graphIds = [...new Set(nodes.map((n) => n.graphId))];
	const graphs = graphIds.map((graphId) => {
		const meta = graphMetaById.get(graphId);
		return {
			graphId,
			metresPerUnit: meta?.metresPerUnit ?? 1,
			substrateId:
				meta?.substrateId ?? nodes.find((n) => n.graphId === graphId)?.substrateId ?? null,
			displayName: meta?.displayName ?? null,
			parentGraphId: meta?.parentGraphId ?? "",
			originCellRes10Hex: meta?.originCellRes10Hex ?? null,
			bearing: meta?.bearing ?? 0,
			anchorNodeId: meta?.anchorNodeId ?? null,
		};
	});
	// Include outdoor root meta even if filter dropped its nodes (need origin for h3_world).
	for (const [graphId, meta] of graphMetaById) {
		if (graphs.some((g) => g.graphId === graphId)) continue;
		if (meta.substrateId !== "outdoor" || !meta.originCellRes10Hex) continue;
		graphs.push({
			graphId,
			metresPerUnit: meta.metresPerUnit,
			substrateId: meta.substrateId,
			displayName: meta.displayName,
			parentGraphId: meta.parentGraphId,
			originCellRes10Hex: meta.originCellRes10Hex,
			bearing: meta.bearing,
			anchorNodeId: meta.anchorNodeId,
		});
	}

	const anchor =
		(selectedGraph !== undefined
			? stringValue(
					graphRows.find((r) => stringValue(r, "place_graph_id") === selectedGraph) ?? {},
					"anchor_node_id",
				)
			: null) ??
		stringValue(graphRows[0] ?? {}, "anchor_node_id") ??
		nodes[0]?.id ??
		null;

	return {
		nodes,
		edges,
		actorClusters: [...actorByPlace.entries()].map(([placeNodeId, count]) => ({
			placeNodeId,
			count,
		})),
		graphs,
		root: anchor !== null && nodeIds.has(anchor) ? anchor : (nodes[0]?.id ?? null),
		reachable: [...nodeIds],
		unreachable: [],
		floors: allFloors,
		sliceLabel,
		notableScopes,
	};
}
