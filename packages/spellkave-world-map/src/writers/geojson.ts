/**
 * String-id-safe GeoJSON projection of an OSM document.
 *
 * - nodes → Point features
 * - edge ways (2 refs) → LineString
 * - extent ways (closed ring, ≥ 4 unique corners) → Polygon
 * - tags become properties; `id` is always a string
 *
 * Used by sk-adr8.14 tiles. Never coerces OSM ids through Number.
 */

import type { OsmDocument, OsmNode, OsmWay } from "../model.ts";

export interface GeoJsonFeatureCollection {
	type: "FeatureCollection";
	features: GeoJsonFeature[];
}

export interface GeoJsonFeature {
	type: "Feature";
	id: string;
	geometry:
		| { type: "Point"; coordinates: [number, number] }
		| { type: "LineString"; coordinates: [number, number][] }
		| { type: "Polygon"; coordinates: [number, number][][] };
	properties: Record<string, string | number | boolean | null>;
}

function nodeCoords(nodesById: Map<string, OsmNode>, id: string): [number, number] | null {
	const n = nodesById.get(id);
	if (!n) return null;
	return [n.lon, n.lat];
}

function propsFromTags(tags: Record<string, string>): Record<string, string> {
	return { ...tags };
}

function wayToFeature(w: OsmWay, nodesById: Map<string, OsmNode>): GeoJsonFeature | null {
	const coords: [number, number][] = [];
	for (const ref of w.refs) {
		const c = nodeCoords(nodesById, ref);
		if (!c) return null;
		coords.push(c);
	}
	if (coords.length < 2) return null;

	const first = coords[0];
	const last = coords[coords.length - 1];
	const isClosed =
		coords.length >= 4 &&
		first !== undefined &&
		last !== undefined &&
		first[0] === last[0] &&
		first[1] === last[1];
	const isExtent =
		isClosed &&
		(w.tags.indoor === "room" ||
			w.tags["spellkave:extent"] === "yes" ||
			Boolean(w.tags["spellkave:extent_shape"]));

	if (isExtent) {
		return {
			type: "Feature",
			id: w.id,
			geometry: { type: "Polygon", coordinates: [coords] },
			properties: propsFromTags(w.tags),
		};
	}

	return {
		type: "Feature",
		id: w.id,
		geometry: { type: "LineString", coordinates: coords },
		properties: propsFromTags(w.tags),
	};
}

export function renderGeoJson(doc: OsmDocument): GeoJsonFeatureCollection {
	const nodesById = new Map(doc.nodes.map((n) => [n.id, n]));
	const features: GeoJsonFeature[] = [];

	for (const n of doc.nodes) {
		// Skip untagged extent corner nodes (noise for map consumers).
		if (Object.keys(n.tags).length === 0) continue;
		features.push({
			type: "Feature",
			id: n.id,
			geometry: { type: "Point", coordinates: [n.lon, n.lat] },
			properties: propsFromTags(n.tags),
		});
	}

	for (const w of doc.ways) {
		const f = wayToFeature(w, nodesById);
		if (f) features.push(f);
	}

	return { type: "FeatureCollection", features };
}

export function renderGeoJsonString(doc: OsmDocument, pretty = true): string {
	return JSON.stringify(renderGeoJson(doc), null, pretty ? 2 : undefined) + (pretty ? "\n" : "");
}
