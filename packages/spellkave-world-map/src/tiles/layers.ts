/**
 * MVT layer split + geojson-vt index build (browser-safe pure builders).
 * HTTP / operator cache stay in @spellkave/player-mcp.
 */

import geojsonvt from "geojson-vt";

import {
	type BackdropEntry,
	type ExportManifest,
	exportWorld,
	type GeoJsonFeature,
	type GeoJsonFeatureCollection,
	type OsmDocument,
	renderGeoJson,
	type WorldOsmInput,
} from "../index.ts";

type GeoJSONVT = ReturnType<typeof geojsonvt>;

export const TILE_LAYER_NAMES = [
	"spellkave_node",
	"spellkave_room",
	"spellkave_corridor",
	"spellkave_building",
	"spellkave_backdrop_frame",
] as const;

export type TileLayerName = (typeof TILE_LAYER_NAMES)[number];

export const GEOJSON_VT_OPTIONS = {
	maxZoom: 22,
	tolerance: 3,
	extent: 4096,
	buffer: 64,
	indexMaxZoom: 5,
	indexMaxPoints: 100_000,
	promoteId: "spellkave:node_id",
	generateId: false,
} as const;

export interface TileLayerFields {
	id: string;
	fields: Record<string, "String" | "Number" | "Boolean">;
	description: string;
}

export interface WorldTilesCache {
	slug: string;
	tick: number;
	timestamp: string;
	export: {
		doc: OsmDocument;
		backdrops: BackdropEntry[];
		manifest: ExportManifest;
	};
	geojson: GeoJsonFeatureCollection;
	layers: Record<TileLayerName, GeoJsonFeatureCollection>;
	indexes: Record<TileLayerName, GeoJSONVT>;
	bounds: [number, number, number, number];
	center: [number, number];
	levels: string[];
	etag: string;
}

function emptyFc(): GeoJsonFeatureCollection {
	return { type: "FeatureCollection", features: [] };
}

function propString(props: GeoJsonFeature["properties"], key: string): string | undefined {
	const v = props[key];
	if (v === undefined || v === null) return undefined;
	return String(v);
}

/** Split renderGeoJson output + relations/backdrops into MVT source layers. */
export function splitTileLayers(
	doc: OsmDocument,
	geojson: GeoJsonFeatureCollection,
	backdrops: readonly BackdropEntry[],
): Record<TileLayerName, GeoJsonFeatureCollection> {
	const nodes = emptyFc();
	const rooms = emptyFc();
	const corridors = emptyFc();
	const buildings = emptyFc();
	const frames = emptyFc();

	for (const f of geojson.features) {
		const g = f.geometry;
		const props = f.properties;
		if (g.type === "Point") {
			nodes.features.push(f);
			continue;
		}
		if (g.type === "Polygon") {
			if (props.indoor === "room" || props["spellkave:extent"] === "yes") {
				rooms.features.push(f);
			}
			continue;
		}
		if (g.type === "LineString") {
			corridors.features.push(f);
		}
	}

	// Building footprints: bbox-union of member room polygons (or skip).
	const roomsByGraph = new Map<string, GeoJsonFeature[]>();
	for (const f of rooms.features) {
		const nodeId = propString(f.properties, "spellkave:node_id") ?? "";
		// Infer graph from node id prefix when available; else skip grouping.
		const graph =
			propString(f.properties, "spellkave:graph") ??
			(nodeId.includes("/") ? nodeId.split("/").slice(0, -1).join("/") : "");
		if (!graph) continue;
		const list = roomsByGraph.get(graph) ?? [];
		list.push(f);
		roomsByGraph.set(graph, list);
	}

	for (const rel of doc.relations) {
		if (rel.tags.type !== "building") continue;
		const graphId = rel.tags["spellkave:graph_id"] ?? "";
		const memberRooms = roomsByGraph.get(graphId) ?? [];
		// Also match rooms whose node_id starts with graphId/
		const extra = rooms.features.filter((f) => {
			const nid = propString(f.properties, "spellkave:node_id") ?? "";
			return nid.startsWith(`${graphId}/`);
		});
		const pool = memberRooms.length > 0 ? memberRooms : extra;
		if (pool.length === 0) continue;

		let minLon = Number.POSITIVE_INFINITY;
		let minLat = Number.POSITIVE_INFINITY;
		let maxLon = Number.NEGATIVE_INFINITY;
		let maxLat = Number.NEGATIVE_INFINITY;
		for (const f of pool) {
			if (f.geometry.type !== "Polygon") continue;
			for (const ring of f.geometry.coordinates) {
				for (const c of ring) {
					const lon = c[0];
					const lat = c[1];
					if (lon === undefined || lat === undefined) continue;
					if (lon < minLon) minLon = lon;
					if (lat < minLat) minLat = lat;
					if (lon > maxLon) maxLon = lon;
					if (lat > maxLat) maxLat = lat;
				}
			}
		}
		if (!Number.isFinite(minLon)) continue;

		const props: Record<string, string> = {
			type: rel.tags.type ?? "building",
			building: rel.tags.building ?? "yes",
		};
		for (const key of ["name", "min_level", "max_level", "building:levels"] as const) {
			const value = rel.tags[key];
			if (value) props[key] = value;
		}
		for (const [k, v] of Object.entries(rel.tags)) {
			if (k.startsWith("spellkave:")) props[k] = v;
		}

		buildings.features.push({
			type: "Feature",
			id: rel.id,
			geometry: {
				type: "Polygon",
				coordinates: [
					[
						[minLon, maxLat],
						[maxLon, maxLat],
						[maxLon, minLat],
						[minLon, minLat],
						[minLon, maxLat],
					],
				],
			},
			properties: props,
		});
	}

	for (const bd of backdrops) {
		// A polygon ring closes on its own first corner; a backdrop with no
		// corners has no ring to close and is skipped rather than asserted.
		const firstCorner = bd.coordinates[0];
		if (firstCorner === undefined) continue;
		const ring = [...bd.coordinates, firstCorner];
		frames.features.push({
			type: "Feature",
			id: `backdrop:${bd.id}`,
			geometry: { type: "Polygon", coordinates: [ring] },
			properties: {
				url: bd.url,
				graph: bd.graph,
				name: bd.name,
				license: bd.license,
				"spellkave:backdrop_id": bd.id,
			},
		});
	}

	return {
		spellkave_node: nodes,
		spellkave_room: rooms,
		spellkave_corridor: corridors,
		spellkave_building: buildings,
		spellkave_backdrop_frame: frames,
	};
}

function computeBounds(geojson: GeoJsonFeatureCollection): [number, number, number, number] {
	let minLon = Number.POSITIVE_INFINITY;
	let minLat = Number.POSITIVE_INFINITY;
	let maxLon = Number.NEGATIVE_INFINITY;
	let maxLat = Number.NEGATIVE_INFINITY;
	const push = (lon: number, lat: number) => {
		if (lon < minLon) minLon = lon;
		if (lat < minLat) minLat = lat;
		if (lon > maxLon) maxLon = lon;
		if (lat > maxLat) maxLat = lat;
	};
	const walk = (coords: unknown): void => {
		if (!Array.isArray(coords)) return;
		if (typeof coords[0] === "number" && typeof coords[1] === "number") {
			push(coords[0] as number, coords[1] as number);
			return;
		}
		for (const c of coords) walk(c);
	};
	for (const f of geojson.features) walk(f.geometry.coordinates);
	if (!Number.isFinite(minLon)) return [-180, -85, 180, 85];
	return [minLon, minLat, maxLon, maxLat];
}

function collectLevels(layers: Record<TileLayerName, GeoJsonFeatureCollection>): string[] {
	const set = new Set<string>();
	for (const name of TILE_LAYER_NAMES) {
		for (const f of layers[name].features) {
			const lvl = f.properties.level;
			if (lvl === undefined || lvl === null || lvl === "") continue;
			for (const part of String(lvl).split(";")) {
				const t = part.trim();
				if (t !== "") set.add(t);
			}
		}
	}
	return [...set].sort((a, b) => Number(a) - Number(b));
}

function fieldCatalog(layers: Record<TileLayerName, GeoJsonFeatureCollection>): TileLayerFields[] {
	const out: TileLayerFields[] = [];
	const descriptions: Record<TileLayerName, string> = {
		spellkave_node: "Place-graph nodes (points)",
		spellkave_room: "Indoor room polygons",
		spellkave_corridor: "Corridor / path / steps edges",
		spellkave_building: "Indoor building footprints",
		spellkave_backdrop_frame: "Backdrop image corner frames",
	};
	for (const id of TILE_LAYER_NAMES) {
		const fields: Record<string, "String" | "Number" | "Boolean"> = {};
		for (const f of layers[id].features) {
			for (const [k, v] of Object.entries(f.properties)) {
				if (fields[k] !== undefined) continue;
				if (typeof v === "number") fields[k] = "Number";
				else if (typeof v === "boolean") fields[k] = "Boolean";
				else fields[k] = "String";
			}
		}
		// Ensure common filter keys exist even on empty layers.
		if (id !== "spellkave_backdrop_frame" && fields.level === undefined) {
			fields.level = "String";
		}
		if (id === "spellkave_node" && fields.name === undefined) fields.name = "String";
		out.push({ id, fields, description: descriptions[id] });
	}
	return out;
}

export function buildWorldTilesCacheFromExport(
	slug: string,
	result: { doc: OsmDocument; backdrops: readonly BackdropEntry[]; manifest: ExportManifest },
): WorldTilesCache {
	const geojson = renderGeoJson(result.doc);
	const layers = splitTileLayers(result.doc, geojson, result.backdrops);
	const indexes = {} as Record<TileLayerName, GeoJSONVT>;
	for (const name of TILE_LAYER_NAMES) {
		indexes[name] = geojsonvt(layers[name] as GeoJSON.FeatureCollection, {
			...GEOJSON_VT_OPTIONS,
		});
	}
	const bounds = computeBounds(geojson);
	const center: [number, number] = [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2];
	const levels = collectLevels(layers);
	const tick = result.manifest.tick;
	return {
		slug,
		tick,
		timestamp: result.manifest.timestamp,
		export: {
			doc: result.doc,
			backdrops: [...result.backdrops],
			manifest: result.manifest,
		},
		geojson,
		layers,
		indexes,
		bounds,
		center,
		levels,
		etag: `"tick-${tick}"`,
	};
}

/** Build a tiles cache from plain WorldOsmInput rows (operator snapshot / test helper). */
export function buildWorldTilesCache(
	slug: string,
	input: WorldOsmInput,
	opts: { tick?: number; timestamp?: string } = {},
): WorldTilesCache {
	const result = exportWorld(input, {
		tick: opts.tick ?? 0,
		timestamp: opts.timestamp,
	});
	return buildWorldTilesCacheFromExport(slug, result);
}

export function vectorLayerFields(cache: WorldTilesCache): TileLayerFields[] {
	return fieldCatalog(cache.layers);
}

export function manifestOf(cache: WorldTilesCache): ExportManifest {
	return cache.export.manifest;
}

export function backdropsOf(cache: WorldTilesCache): BackdropEntry[] {
	return cache.export.backdrops;
}
