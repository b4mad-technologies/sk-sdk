/**
 * TileJSON + MapLibre style + backdrop URL helpers (no HTTP).
 */

import { validateStyleMin } from "@maplibre/maplibre-gl-style-spec";

import type { BackdropEntry } from "../model.ts";
import { backdropsOf, vectorLayerFields, type WorldTilesCache } from "./layers.ts";

export function buildTileJson(cache: WorldTilesCache, baseUrl: string): Record<string, unknown> {
	const tilesBase = `${baseUrl.replace(/\/$/, "")}/w/${cache.slug}`;
	const licenses = [
		...new Set(
			cache.export.backdrops
				.map((b) => b.license)
				.filter((l) => typeof l === "string" && l.trim() !== ""),
		),
	];
	const attributionParts = [...licenses, "Spellkave"];
	return {
		tilejson: "3.0.0",
		name: `spellkave:${cache.slug}`,
		description: `Spellkave place-graph MVT for catalog world ${cache.slug}`,
		version: "1.0.0",
		scheme: "xyz",
		tiles: [`${tilesBase}/tiles/{z}/{x}/{y}.pbf`],
		minzoom: 0,
		maxzoom: 22,
		bounds: cache.bounds,
		center: [...cache.center, 16],
		attribution: attributionParts.join(" · "),
		vector_layers: vectorLayerFields(cache).map((l) => ({
			id: l.id,
			description: l.description,
			fields: l.fields,
		})),
		// Extension for the maps-demo level picker.
		levels: cache.levels,
		generator: cache.export.manifest.generator,
		tick: cache.tick,
	};
}

export function resolveBackdropUrls(
	backdrops: readonly BackdropEntry[],
	baseUrl: string,
	slug: string,
): Array<BackdropEntry & { url: string }> {
	const base = baseUrl.replace(/\/$/, "");
	return backdrops.map((b) => ({
		...b,
		url: `${base}/w/${slug}/assets/${b.asset.module}/${b.asset.path}`,
	}));
}

/** MapLibre style v8 — no basemap; self-hosted glyphs; level via setFilter. */
export function buildMapLibreStyle(
	cache: WorldTilesCache,
	baseUrl: string,
): Record<string, unknown> {
	const base = baseUrl.replace(/\/$/, "");
	const slug = cache.slug;
	const sourceUrl = `${base}/w/${slug}/tiles.json`;
	const glyphs = `${base}/w/${slug}/fonts/{fontstack}/{range}.pbf`;
	const backdrops = resolveBackdropUrls(backdropsOf(cache), base, slug);

	const sources: Record<string, unknown> = {
		spellkave: {
			type: "vector",
			url: sourceUrl,
			promoteId: {
				spellkave_node: "spellkave:node_id",
				spellkave_room: "spellkave:node_id",
			},
		},
	};
	for (const bd of backdrops) {
		sources[`bd-${bd.id}`] = {
			type: "image",
			url: bd.url,
			coordinates: bd.coordinates,
		};
	}

	const indoorGraphs = new Set<string>();
	for (const f of cache.layers.spellkave_room.features) {
		if (f.properties.indoor !== "room") continue;
		const graph = f.properties["spellkave:graph"];
		if (typeof graph === "string" && graph !== "") indoorGraphs.add(graph);
	}

	const layers: Record<string, unknown>[] = [
		{
			id: "background",
			type: "background",
			paint: { "background-color": "#0b1215" },
		},
	];

	const indoorBackdrops: Array<{ layer: string; graph: string }> = [];
	for (const bd of backdrops) {
		const layerId = `raster-${bd.id}`;
		const indoor = indoorGraphs.has(bd.graph);
		if (indoor) indoorBackdrops.push({ layer: layerId, graph: bd.graph });
		layers.push({
			id: layerId,
			type: "raster",
			source: `bd-${bd.id}`,
			paint: { "raster-opacity": 1 },
			...(indoor ? { layout: { visibility: "none" } } : {}),
		});
	}

	// Indoor layers use a plain filter (no global-state in pinned style-spec).
	// Client swaps the level via map.setFilter — see maps-demo.html.
	// Default shows features with no level OR level == "0".
	const defaultLevelFilter: unknown[] = [
		"any",
		["!", ["has", "level"]],
		["==", ["get", "level"], "0"],
		["in", "0", ["get", "level"]],
	];

	layers.push(
		{
			id: "building-fill",
			type: "fill",
			source: "spellkave",
			"source-layer": "spellkave_building",
			paint: {
				"fill-color": "#1b263b",
				"fill-opacity": 0.35,
				"fill-outline-color": "#415a77",
			},
		},
		{
			id: "room-fill",
			type: "fill",
			source: "spellkave",
			"source-layer": "spellkave_room",
			filter: defaultLevelFilter,
			paint: {
				"fill-color": [
					"match",
					["coalesce", ["get", "level"], ""],
					"-1",
					"#3d5a80",
					"0",
					"#98c1d9",
					"1",
					"#ee6c4d",
					"#6b9080",
				],
				"fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.55, 0.28],
				"fill-outline-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					"#f4a261",
					"#cce3de",
				],
			},
		},
		{
			id: "water-fill",
			type: "fill",
			source: "spellkave",
			"source-layer": "spellkave_room",
			filter: ["all", defaultLevelFilter, ["==", ["get", "natural"], "water"]],
			paint: {
				"fill-color": "#0284c7",
				"fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.65, 0.42],
				"fill-outline-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					"#f4a261",
					"#38bdf8",
				],
			},
		},
		{
			id: "difficult-terrain-fill",
			type: "fill",
			source: "spellkave",
			"source-layer": "spellkave_room",
			filter: ["all", defaultLevelFilter, ["==", ["get", "spellkave:terrain"], "difficult"]],
			paint: {
				"fill-color": "#d97706",
				"fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.55, 0.28],
				"fill-outline-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					"#f4a261",
					"#f59e0b",
				],
			},
		},
		{
			id: "hazard-fill",
			type: "fill",
			source: "spellkave",
			"source-layer": "spellkave_room",
			filter: ["all", defaultLevelFilter, ["has", "spellkave:hazard"]],
			paint: {
				"fill-color": [
					"case",
					["==", ["get", "spellkave:hazard"], "acid"],
					"#84cc16",
					["==", ["get", "spellkave:hazard"], "slime"],
					"#10b981",
					["==", ["get", "spellkave:hazard"], "lava"],
					"#f97316",
					"#10b981",
				],
				"fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.75, 0.52],
				"fill-outline-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					"#f4a261",
					"#ef4444",
				],
			},
		},
		{
			id: "corridor-line",
			type: "line",
			source: "spellkave",
			"source-layer": "spellkave_corridor",
			filter: defaultLevelFilter,
			paint: {
				"line-color": [
					"match",
					["coalesce", ["get", "highway"], ""],
					"steps",
					"#f4a261",
					"corridor",
					"#e9c46a",
					"#8d99ae",
				],
				"line-width": 2.5,
			},
		},
		{
			id: "steps-dash",
			type: "line",
			source: "spellkave",
			"source-layer": "spellkave_corridor",
			filter: ["all", defaultLevelFilter, ["==", ["get", "highway"], "steps"]],
			paint: {
				"line-color": "#f4a261",
				"line-width": 3,
				"line-dasharray": [1, 1],
			},
		},
		{
			id: "flight-dash",
			type: "line",
			source: "spellkave",
			"source-layer": "spellkave_corridor",
			filter: ["all", defaultLevelFilter, ["==", ["get", "spellkave:traversal_mode"], "fly"]],
			paint: {
				"line-color": "#c084fc",
				"line-width": 3.5,
				"line-dasharray": [2, 2],
			},
		},
		{
			id: "swim-dash",
			type: "line",
			source: "spellkave",
			"source-layer": "spellkave_corridor",
			filter: ["all", defaultLevelFilter, ["==", ["get", "spellkave:traversal_mode"], "swim"]],
			paint: {
				"line-color": "#0284c7",
				"line-width": 3.5,
				"line-dasharray": [3, 1],
			},
		},
		{
			id: "barrier-dash",
			type: "line",
			source: "spellkave",
			"source-layer": "spellkave_corridor",
			filter: ["all", defaultLevelFilter, ["has", "spellkave:seal"]],
			paint: {
				"line-color": ["case", ["==", ["get", "spellkave:locked"], "no"], "#10b981", "#ef4444"],
				"line-width": 4.5,
				"line-dasharray": [1, 2],
			},
		},
		{
			id: "door-symbol",
			type: "circle",
			source: "spellkave",
			"source-layer": "spellkave_corridor",
			filter: ["all", defaultLevelFilter, ["==", ["get", "door"], "yes"]],
			paint: {
				"circle-radius": 4,
				"circle-color": "#e63946",
				"circle-stroke-width": 1,
				"circle-stroke-color": "#f1faee",
			},
		},
		{
			id: "traversal-label",
			type: "symbol",
			source: "spellkave",
			"source-layer": "spellkave_corridor",
			filter: [
				"all",
				defaultLevelFilter,
				[
					"any",
					["==", ["get", "spellkave:traversal_mode"], "fly"],
					["==", ["get", "spellkave:traversal_mode"], "swim"],
					["has", "spellkave:seal"],
				],
			],
			layout: {
				"symbol-placement": "line-center",
				"text-field": [
					"case",
					["==", ["get", "spellkave:traversal_mode"], "fly"],
					"🪽 Fly",
					["==", ["get", "spellkave:traversal_mode"], "swim"],
					"🏊 Swim",
					["has", "spellkave:seal"],
					["case", ["==", ["get", "spellkave:locked"], "no"], "🔓 Open", "🔒 Locked"],
					"",
				],
				"text-font": ["Noto Sans Regular"],
				"text-size": 11,
				"text-offset": [0, -1],
			},
			paint: {
				"text-color": [
					"case",
					["==", ["get", "spellkave:traversal_mode"], "fly"],
					"#c084fc",
					["==", ["get", "spellkave:traversal_mode"], "swim"],
					"#38bdf8",
					["==", ["get", "spellkave:locked"], "no"],
					"#10b981",
					"#ef4444",
				],
				"text-halo-color": "#0b1215",
				"text-halo-width": 2,
			},
		},
		{
			id: "node-selected-ring",
			type: "circle",
			source: "spellkave",
			"source-layer": "spellkave_node",
			filter: ["all", defaultLevelFilter],
			minzoom: 12,
			paint: {
				"circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 14, 0],
				"circle-color": "rgba(244, 162, 97, 0.2)",
				"circle-stroke-color": "#f4a261",
				"circle-stroke-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 0],
				"circle-stroke-opacity": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					0.9,
					0,
				],
			},
		},
		{
			id: "node-circle",
			type: "circle",
			source: "spellkave",
			"source-layer": "spellkave_node",
			minzoom: 14,
			filter: ["all", defaultLevelFilter, ["!", ["has", "spellkave:poi_icon"]]],
			paint: {
				"circle-radius": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					7,
					["==", ["get", "entrance"], "yes"],
					6,
					5,
				],
				"circle-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					"#f4a261",
					["==", ["get", "entrance"], "yes"],
					"#e76f51",
					"#f1faee",
				],
				"circle-stroke-width": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					3,
					["==", ["get", "entrance"], "yes"],
					2,
					1,
				],
				"circle-stroke-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					"#edf2f4",
					["==", ["get", "entrance"], "yes"],
					"#f4a261",
					"#1d3557",
				],
			},
		},
		{
			id: "node-label",
			type: "symbol",
			source: "spellkave",
			"source-layer": "spellkave_node",
			filter: ["all", defaultLevelFilter, ["!", ["has", "spellkave:poi_icon"]]],
			minzoom: 14,
			layout: {
				"text-field": ["coalesce", ["get", "name"], ""],
				"text-font": ["Noto Sans Regular"],
				"text-size": 12,
				"text-variable-anchor": [
					"top",
					"bottom",
					"left",
					"right",
					"top-left",
					"top-right",
					"bottom-left",
					"bottom-right",
				],
				"text-radial-offset": 2.2,
				"text-justify": "auto",
				"text-padding": 4,
				"text-optional": true,
				"text-allow-overlap": false,
				"text-ignore-placement": false,
			},
			paint: {
				"text-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					"#f4a261",
					"#edf2f4",
				],
				"text-halo-color": "#0b1215",
				"text-halo-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.2, 1.2],
			},
		},
		{
			id: "poi-symbol",
			type: "symbol",
			source: "spellkave",
			"source-layer": "spellkave_node",
			filter: ["all", defaultLevelFilter, ["has", "spellkave:poi_icon"]],
			minzoom: 12,
			layout: {
				"icon-image": ["concat", "poi-", ["coalesce", ["get", "spellkave:poi_icon"], "default"]],
				"icon-anchor": "bottom",
				"icon-offset": [0, 2],
				"icon-size": 1.0,
				"icon-padding": 3,
				"icon-allow-overlap": true,
				"icon-ignore-placement": false,
				"text-field": ["coalesce", ["get", "name"], ""],
				"text-font": ["Noto Sans Regular"],
				"text-size": 11,
				"text-anchor": "top",
				"text-offset": [0, 1.0],
				"text-optional": true,
				"text-padding": 3,
				"text-allow-overlap": false,
				"text-ignore-placement": false,
			},
			paint: {
				"text-color": [
					"case",
					["boolean", ["feature-state", "selected"], false],
					"#f4a261",
					"#edf2f4",
				],
				"text-halo-color": "#0b1215",
				"text-halo-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.2, 1.2],
			},
		},
	);

	return {
		version: 8,
		name: `spellkave:${slug}`,
		glyphs,
		sources,
		layers,
		center: cache.center,
		zoom: 16,
		// Documented for clients: level filter is plain (not global-state);
		// swap via setFilter on room-fill / corridor-line / steps-dash /
		// door-symbol / node-circle / node-label / poi-symbol.
		metadata: {
			"spellkave:level_filter":
				"Client swaps indoor level via map.setFilter; global-state not used (pinned maplibre-gl-style-spec).",
			"spellkave:levels": cache.levels,
			"spellkave:tick": cache.tick,
			"spellkave:indoor_backdrops": indoorBackdrops,
			"spellkave:backdrops": backdrops.map((bd) => ({
				layer: `raster-${bd.id}`,
				graph: bd.graph,
				indoor: indoorGraphs.has(bd.graph),
			})),
		},
	};
}

/** Validate a style object; returns error messages (empty = ok). */
export function validateMapLibreStyle(style: unknown): string[] {
	const errors = validateStyleMin(style as never);
	return (errors ?? []).map((e) => String(e?.message ?? e));
}
