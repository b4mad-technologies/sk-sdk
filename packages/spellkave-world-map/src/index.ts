/**
 * @spellkave/world-map — pure-TS OSM projection of the place graph (ADR-0123).
 *
 * No DOM. No `node:` imports in this barrel (CLI lives in `cli.ts`).
 */

// Coords / projection (D-1)
export {
	cellCentroidLatLng,
	cellRes10ToHex,
	composeProjection,
	latLngToPlane,
	latLngToRes10Decimal,
	METRES_PER_DEG_LAT,
	type PlacedNode,
	type ProjectionParams,
	type ProjectWorldOpts,
	type ProjectWorldResult,
	placeWorld,
	projectLocalPosition,
	projectSheetPoint,
	projectWorld,
	sheetToLocal,
	type WorldOffset,
	worldOffsetToLatLng,
	worldOffsetToPlane,
} from "./coords.ts";
// Export (D-1..D-4)
export {
	type ExportWorldOpts,
	type ExportWorldResult,
	exportWorld,
	GENERATOR,
	nodeLevelIndex,
	PACKAGE_VERSION,
} from "./export.ts";
// Ids (D-3)
export {
	fnv1a63,
	fnv1a63String,
	type IdHasher,
	IdRegistry,
	OsmIdCollision,
} from "./ids.ts";

// Model
export type {
	BackdropEntry,
	ExportManifest,
	OsmDocument,
	OsmExport,
	OsmMember,
	OsmMeta,
	OsmNode,
	OsmRelation,
	OsmWay,
	UnplacedGraph,
} from "./model.ts";
// POI schema (ADR-0073 / ADR-0130)
export {
	isPoiNamespace,
	POI_NAMESPACE,
	type PoiMetadataPayload,
	parsePoiMetadata,
} from "./poi.ts";
// Rows
export {
	type EdgeAffordanceRow,
	type EdgeRow,
	type EdgeStateRow,
	type GraphRow,
	type MapLayerRow,
	type MetadataAttachmentRow,
	type NicheDefinitionRow,
	type NodeRow,
	type NodeStateRow,
	type NormalizedRows,
	normalizeWorldOsmInput,
	type SpatialNicheAttachmentRow,
	type SubstrateDef,
	type WorldOsmInput,
} from "./rows.ts";
// Tags / class (D-2)
export {
	buildCoordinateKindMap,
	CORE_SUBSTRATE_KINDS,
	LEVEL_HEIGHT_M,
	levelIndex,
	type SpatialClass,
	spatialClassOf,
} from "./tags.ts";
export {
	type GeoJsonFeature,
	type GeoJsonFeatureCollection,
	renderGeoJson,
	renderGeoJsonString,
} from "./writers/geojson.ts";
export {
	type OsmJsonDocument,
	type OsmJsonElement,
	renderOsmJson,
	renderOsmJsonString,
} from "./writers/json.ts";
// Writers
export { escapeXml, renderOsmXml, SPELLKAVE_OSM_NS } from "./writers/xml.ts";
