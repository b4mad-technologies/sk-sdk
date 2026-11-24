
import type { MapLayerRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString, rows } from "./_helpers";

export const requiredTables: RequiredTables<["visible_map_layer"]> = ["visible_map_layer"];
registerReaderManifest({ requiredTables });

/**
 * Read the caller's admitted map_layer catalog — every visible backdrop
 * pointer, in the manifest's own snake_case row shape. Filtering is
 * module-side — see the header note.
 */
export function readMapLayers(db: SnapshotDb): Record<string, unknown>[] {
	return projectMapLayers(db, "visible_map_layer");
}

/**
 * Shared projection over a named accessor — kept so fixtures can point at
 * an explicit table name while producing the same row shape.
 */
export function projectMapLayers(db: SnapshotDb, table: string): Record<string, unknown>[] {
	return rows<MapLayerRow>(db, table).map((row) => ({
		map_layer_id: asString(row.mapLayerId),
		bundle_id: asString(row.bundleId),
		place_graph_id: asString(row.placeGraphId),
		display_name: asString(row.displayName),
		asset_module: asString(row.assetModule),
		asset_path: asString(row.assetPath),
		source_kind: asString(row.sourceKind),
		state: asString(row.state),
		posture: asString(row.posture),
		image_width_px: row.imageWidthPx,
		image_height_px: row.imageHeightPx,
		grid_size_px: row.gridSizePx,
		grid_distance_m: row.gridDistanceM,
		local_width_cells: row.localWidthCells,
		local_height_cells: row.localHeightCells,
		image_origin_x: row.imageOriginX,
		image_origin_y: row.imageOriginY,
		rotation_deg: row.rotationDeg,
		min_zoom: row.minZoom,
		max_zoom: row.maxZoom,
	}));
}
