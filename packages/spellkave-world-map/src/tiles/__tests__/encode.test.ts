// The tile gateway serves vector tiles down to tactical zoom (z=21); a path
// whose two ends lie outside a tile must still cross it. Builds tiles in
// memory with geojson-vt and vt-pbf; no HTTP.
// keep-file(K5): pins geojson-vt clipping and vt-pbf encoding, which the CLI does not drive
import { describe, expect, it } from "vitest";

import type { OsmDocument } from "../../model.ts";
import { encodeMvtTile } from "../encode.ts";
import { buildWorldTilesCacheFromExport } from "../layers.ts";

describe("encodeMvtTile at high zoom (2m / tactical 5m scale)", () => {
	it("preserves paths whose endpoints lie outside the tile at z=21", () => {
		// A straight horizontal path from lon=0 to lon=0.001 (~111m) at lat=0.
		// At z=21:
		// x for lon=0: Math.floor((0 + 180)/360 * 2^21) = 1,048,576
		// x for lon=0.001: Math.floor((0.001 + 180)/360 * 2^21) = 1,048,581
		// Tile (21, 1,048,578, 1,048,576) lies squarely in the middle:
		// neither start nor end point is inside this tile.
		const doc: OsmDocument = {
			generator: "test",
			tick: 1,
			timestamp: "2026-01-01T00:00:00Z",
			nodes: [
				{
					id: "1",
					type: "node",
					version: 1,
					changeset: 1,
					uid: 1,
					user: "u",
					visible: true,
					timestamp: "2026-01-01T00:00:00Z",
					lon: 0,
					lat: 0,
					tags: { "spellkave:node_id": "hamlet/gate", name: "Gate" },
				},
				{
					id: "2",
					type: "node",
					version: 1,
					changeset: 1,
					uid: 1,
					user: "u",
					visible: true,
					timestamp: "2026-01-01T00:00:00Z",
					lon: 0.001,
					lat: 0,
					tags: { "spellkave:node_id": "hamlet/square", name: "Square" },
				},
			],
			ways: [
				{
					id: "10",
					type: "way",
					version: 1,
					changeset: 1,
					uid: 1,
					user: "u",
					visible: true,
					timestamp: "2026-01-01T00:00:00Z",
					refs: ["1", "2"],
					tags: { highway: "path" },
				},
			],
			relations: [],
		};

		const cache = buildWorldTilesCacheFromExport("test-world", {
			doc,
			backdrops: [],
			manifest: {
				generator: "test",
				tick: 1,
				timestamp: "2026-01-01T00:00:00Z",
				origin: null,
				counts: {
					nodes: 2,
					ways: 1,
					relations: 0,
					backdrops: 0,
					unplaced_graphs: 0,
				},
				unplaced_graphs: [],
				diagnostics: [],
			},
		});

		// At z=21, tile in the middle between the nodes:
		const z = 21;
		const middleX = 1_048_578;
		const y = 1_048_576;

		// Verify corridor layer in middle tile has the clipped line
		const corridorTile = cache.indexes.spellkave_corridor.getTile(z, middleX, y);
		expect(corridorTile).not.toBeNull();
		expect(corridorTile?.features?.length).toBeGreaterThan(0);

		// Verify MVT encoding produces non-null bytes
		const buf = encodeMvtTile(cache, z, middleX, y);
		expect(buf).not.toBeNull();
		expect(buf!.length).toBeGreaterThan(0);
	});
});
