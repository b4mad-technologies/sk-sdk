/**
 * MVT encode (geojson-vt tile → vt-pbf).
 */

import { createRequire } from "node:module";

import { TILE_LAYER_NAMES, type TileLayerName, type WorldTilesCache } from "./layers.ts";

const require = createRequire(import.meta.url);
// vt-pbf is CJS.
const vtpbf = require("vt-pbf") as {
	fromGeojsonVt: (
		layers: Record<string, unknown>,
		options?: { version?: number; extent?: number },
	) => Uint8Array;
};

export function encodeMvtTile(
	cache: WorldTilesCache,
	z: number,
	x: number,
	y: number,
): Uint8Array | null {
	const layers: Record<string, unknown> = {};
	let any = false;
	for (const name of TILE_LAYER_NAMES) {
		const tile = cache.indexes[name as TileLayerName].getTile(z, x, y);
		if (tile && tile.features && tile.features.length > 0) {
			layers[name] = tile;
			any = true;
		}
	}
	if (!any) return null;
	return vtpbf.fromGeojsonVt(layers, { version: 2, extent: 4096 });
}
