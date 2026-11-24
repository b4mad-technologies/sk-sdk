/**
 * @spellkave/world-map/tiles — MVT builders, TileJSON, MapLibre style.
 * Not HTTP: the gateway keeps routing, auth, CORS, asset/font serving.
 */

export { encodeMvtTile } from "./encode.ts";
export {
	backdropsOf,
	buildWorldTilesCache,
	buildWorldTilesCacheFromExport,
	GEOJSON_VT_OPTIONS,
	manifestOf,
	splitTileLayers,
	TILE_LAYER_NAMES,
	type TileLayerFields,
	type TileLayerName,
	vectorLayerFields,
	type WorldTilesCache,
} from "./layers.ts";
export {
	buildMapLibreStyle,
	buildTileJson,
	resolveBackdropUrls,
	validateMapLibreStyle,
} from "./style.ts";
