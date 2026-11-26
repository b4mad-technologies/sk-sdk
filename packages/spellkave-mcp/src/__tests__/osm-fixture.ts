import type { WorldOsmInput } from "@spellkave/world-map";
import type { WorldOsmSnapshot } from "../osm-model.ts";

const timestamp = "2026-08-22T00:00:00Z";
const meta = { timestamp, version: 1, changeset: 1, uid: 1, user: "spellkave", visible: true };
const generator = "Spellkave SDK test fixture";

export function sampleOsmSnapshot(): WorldOsmSnapshot {
	return {
		doc: {
			generator,
			timestamp,
			tick: 0,
			nodes: [
				{ ...meta, type: "node", id: "1", lat: 47.5, lon: -122.3, tags: { name: "Crossroads" } },
				{ ...meta, type: "node", id: "2", lat: 47.5001, lon: -122.2999, tags: {} },
			],
			ways: [{ ...meta, type: "way", id: "3", refs: ["1", "2"], tags: { highway: "path" } }],
			relations: [],
		},
		backdrops: [],
		manifest: {
			generator,
			timestamp,
			tick: 0,
			origin: null,
			counts: { nodes: 2, ways: 1, relations: 0, backdrops: 0, unplaced_graphs: 0 },
			unplaced_graphs: [],
			diagnostics: [],
		},
		tick: 0,
		builtAt: timestamp,
	};
}

export const sampleWorldRows: WorldOsmInput = {
		place_graphs: [{
			place_graph_id: "demo/yard", display_name: "Yard", substrate_id: "outdoor",
			origin_cell_res10: "622215095455449087", metres_per_unit: 1,
			anchor_node_id: "demo/yard/start",
		}],
		place_nodes: [{
			node_id: "demo/yard/start", place_graph_id: "demo/yard", local_id: "start", display_name: "Start",
			substrate_id: "outdoor", cell_res10: "622215095455449087", pos_present: true, pos_x: 0, pos_y: 0, pose_elevation_present: true, pose_elevation: 0,
		}],
		map_layers: [{
			map_layer_id: "demo/yard/art", place_graph_id: "demo/yard", display_name: "Yard map",
			asset_module: "sample-maps", asset_path: "maps/sample.jpg", state: "ready",
			image_width_px: 40, image_height_px: 40, grid_size_px: 10, grid_distance_m: 1,
			image_origin_x: 20, image_origin_y: 20,
		}],
	};
