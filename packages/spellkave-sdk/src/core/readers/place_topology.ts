
import type { PlaceEdgeRow, PlaceGraphDefinitionRow, PlaceNodeRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	["visible_place_node", "visible_place_edge", "visible_place_graph_definition"]
> = ["visible_place_node", "visible_place_edge", "visible_place_graph_definition"];
registerReaderManifest({ requiredTables });

export interface PlaceTopology {
	place_graphs: Record<string, unknown>[];
	place_nodes: Record<string, unknown>[];
	place_edges: Record<string, unknown>[];
}

/**
 * Read the caller's admitted place-graph topology: every visible
 * place_graph/place_node/place_edge row, in the manifest's own snake_case
 * row shape. Filtering is module-side — see the header note.
 */
export function readPlaceTopology(db: SnapshotDb): PlaceTopology {
	return projectPlaceTopology(
		db,
		"visible_place_graph_definition",
		"visible_place_node",
		"visible_place_edge",
	);
}

/**
 * Shared projection over named accessors — kept so fixtures and internal
 * callers can point at explicit table names while producing the same row shape.
 */
export function projectPlaceTopology(
	db: SnapshotDb,
	graphTable: string,
	nodeTable: string,
	edgeTable: string,
): PlaceTopology {
	const place_graphs = rows<PlaceGraphDefinitionRow>(db, graphTable).map((g) => ({
		place_graph_id: asString(g.placeGraphId),
		bundle_id: asString(g.bundleId),
		substrate_id: asString(g.substrateId),
		display_name: asString(g.displayName),
		description: asString(g.description),
		origin_cell_res10: g.originCellRes10,
		bearing: g.bearing,
		metres_per_unit: g.metresPerUnit,
		blueprint_id: asString(g.blueprintId),
		parent_graph_id: asString(g.parentGraphId),
		anchor_node_id: asString(g.anchorNodeId),
		// Runtime-minted instance (session tactical grid) vs authored graph.
		// `parent_graph_id` alone does NOT discriminate the two — authored
		// graphs nest as well (elven-mini's tomb/inn under hamlet/region) —
		// so a consumer that must treat ephemeral instances differently needs
		// this column, not the parent link. Projected for the companion's
		// map composition gate (bead sk-pej D-2), which otherwise has to
		// sniff the server's `session_grid_<id>` string shape.
		is_ephemeral_instance: g.isEphemeralInstance,
	}));
	const place_nodes = rows<PlaceNodeRow>(db, nodeTable).map((n) => ({
		node_id: asString(n.nodeId),
		bundle_id: asString(n.bundleId),
		place_graph_id: asString(n.placeGraphId),
		local_id: asString(n.localId),
		substrate_id: asString(n.substrateId),
		display_name: asString(n.displayName),
		description: asString(n.description),
		cell_res10: n.cellRes10,
		cell_res7: n.cellRes7,
		cell_res4: n.cellRes4,
		pose_elevation: n.poseElevation,
		pose_elevation_present: n.poseElevationPresent,
		pos_x: n.posX,
		pos_y: n.posY,
		pos_present: n.posPresent,
		extent_shape_id: asString(n.extentShapeId),
		extent_params_json: asString(n.extentParamsJson),
		is_ephemeral: Boolean(n.isEphemeral),
	}));
	const place_edges = rows<PlaceEdgeRow>(db, edgeTable).map((e) => ({
		// u64 on the wire — keep decimal string so world-map never loses bits.
		edge_id: asString(e.edgeId),
		edge_key: asString(e.edgeKey),
		bundle_id: asString(e.bundleId),
		place_graph_id: asString(e.placeGraphId),
		from_node_id: asString(e.fromNodeId),
		to_node_id: asString(e.toNodeId),
		pose_dt_elevation: e.poseDtElevation,
		pose_dt_elevation_present: Boolean(e.poseDtElevationPresent),
		substrate_crossing: Boolean(e.substrateCrossing),
		cell_anchor: e.cellAnchor,
		cell_anchor_u: e.cellAnchorU,
		cell_anchor_v: e.cellAnchorV,
		cell_anchor_present: Boolean(e.cellAnchorPresent),
		from_anchor_side: asString(e.fromAnchorSide),
		from_anchor_offset: e.fromAnchorOffset,
		to_anchor_side: asString(e.toAnchorSide),
		to_anchor_offset: e.toAnchorOffset,
		description: asString(e.description),
		inherit_movement_default: Boolean(e.inheritMovementDefault),
	}));
	return { place_graphs, place_nodes, place_edges };
}
