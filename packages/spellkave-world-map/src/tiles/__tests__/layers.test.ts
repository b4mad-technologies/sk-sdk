// The maps app draws rooms and outdoor extents as filled areas: the tile layer
// split must keep both as polygons in the room layer and their points in the
// node layer. Pure function over GeoJSON.
// keep-file(K1): rule case of the pure layer split; the CLI writes no tiles
import { describe, expect, it } from "vitest";

import type { OsmDocument } from "../../model.ts";
import type { GeoJsonFeatureCollection } from "../../writers/geojson.ts";
import { splitTileLayers } from "../layers.ts";

const emptyDoc: OsmDocument = {
	generator: "test",
	tick: 1,
	timestamp: "2026-01-01T00:00:00Z",
	nodes: [],
	ways: [],
	relations: [],
};

describe("splitTileLayers", () => {
	it("keeps indoor rooms and outdoor extents as polygons", () => {
		const geojson: GeoJsonFeatureCollection = {
			type: "FeatureCollection",
			features: [
				{
					type: "Feature",
					id: "n-path",
					properties: { "spellkave:node_id": "hamlet/crypt_path", name: "Path" },
					geometry: { type: "Point", coordinates: [0, 0] },
				},
				{
					type: "Feature",
					id: "w-path",
					properties: {
						"spellkave:node_id": "hamlet/crypt_path",
						"spellkave:extent": "yes",
						name: "Path",
					},
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[0, 0],
								[1, 0],
								[1, 1],
								[0, 1],
								[0, 0],
							],
						],
					},
				},
				{
					type: "Feature",
					id: "n-ent",
					properties: {
						"spellkave:node_id": "bramble_crypt/entrance",
						indoor: "room",
						name: "Entrance",
					},
					geometry: { type: "Point", coordinates: [0, 0] },
				},
				{
					type: "Feature",
					id: "w-ent",
					properties: {
						"spellkave:node_id": "bramble_crypt/entrance",
						indoor: "room",
						name: "Entrance",
					},
					geometry: {
						type: "Polygon",
						coordinates: [
							[
								[0, 0],
								[0.4, 0],
								[0.4, 0.4],
								[0, 0.4],
								[0, 0],
							],
						],
					},
				},
			],
		};
		const layers = splitTileLayers(emptyDoc, geojson, []);
		expect(layers.spellkave_node.features.map((f) => f.properties["spellkave:node_id"])).toEqual([
			"hamlet/crypt_path",
			"bramble_crypt/entrance",
		]);
		expect(layers.spellkave_room.features.map((f) => f.properties["spellkave:node_id"])).toEqual([
			"hamlet/crypt_path",
			"bramble_crypt/entrance",
		]);
	});
});
