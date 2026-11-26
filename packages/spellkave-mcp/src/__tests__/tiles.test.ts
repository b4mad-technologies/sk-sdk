// A map client loads the world as vector tiles with a TileJSON and style, and every tile
// parses back to the features the world contains. If it breaks, the map renders empty or
// wrong. Builds tiles from the demo fixture and temp dirs, no live world.

// keep-file(K1): tile path parsing, MVT encode, TileJSON/style over the demo fixture; served tiles need a world export the offline gateway cannot make

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { VectorTile } from "@mapbox/vector-tile";
import { sampleWorldRows } from "./osm-fixture.ts";
import Pbf from "pbf";
import { describe, expect, it } from "vitest";
import { buildWorldTilesCache, TILE_LAYER_NAMES, TilesModelStore } from "../osm-model.ts";
import {
	addSatelliteToStyle,
	buildMapLibreStyle,
	buildTileJson,
	defaultWorldAssetsRoot,
	encodeMvtTile,
	handleWorldTilesRequest,
	parseWorldTilesPath,
	resolveAssetOnDisk,
	resolveBackdropUrls,
	resolveWorldAsset,
	satelliteArchivePath,
	validateMapLibreStyle,
	worldAssetsLoaded,
} from "../tiles.ts";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../../../..");
const assetsRoot = join(here, "fixtures");
const fontsRoot = join(repoRoot, "packages/spellkave-mcp/static/fonts");
const mapsDemoPath = join(repoRoot, "packages/spellkave-mcp/static/maps-demo.html");

async function sampleCache() {
	return buildWorldTilesCache("demo", sampleWorldRows, {
		tick: 42,
		timestamp: "2026-08-22T00:00:00Z",
	});
}

describe("parseWorldTilesPath", () => {
	it("parses tiles / style / backdrops / assets / fonts", () => {
		expect(parseWorldTilesPath("/w/demo/tiles.json")).toEqual({
			kind: "tiles_json",
			slug: "demo",
		});
		expect(parseWorldTilesPath("/w/demo/tiles/12/655/1427.pbf")).toEqual({
			kind: "tile",
			slug: "demo",
			z: 12,
			x: 655,
			y: 1427,
		});
		expect(parseWorldTilesPath("/w/demo/tiles/16/1/2.mvt")?.kind).toBe("tile");
		expect(parseWorldTilesPath("/w/demo/style.json")?.kind).toBe("style");
		expect(parseWorldTilesPath("/w/demo/satellite.pmtiles")?.kind).toBe("satellite");
		expect(parseWorldTilesPath("/w/demo/backdrops.json")?.kind).toBe("backdrops");
		expect(parseWorldTilesPath("/w/demo/maps-demo")?.kind).toBe("maps_demo");
		expect(parseWorldTilesPath("/w/demo/assets/sample-maps/maps/x.jpg")).toEqual({
			kind: "asset",
			slug: "demo",
			assetPath: "sample-maps/maps/x.jpg",
		});
		expect(parseWorldTilesPath("/w/nope")).toEqual({ kind: "root", slug: "nope" });
		expect(parseWorldTilesPath("/w/Demo")).toBeNull();
		expect(parseWorldTilesPath("/tiles.json")).toBeNull();
	});
});

describe("satellite raster pyramid", () => {
	it("inserts one hidden PMTiles raster below vector layers", () => {
		const style = addSatelliteToStyle(
			{
				sources: { spellkave: { type: "vector" } },
				layers: [
					{ id: "background", type: "background" },
					{ id: "roads", type: "line", source: "spellkave" },
				],
			},
			"https://gateway.example/w/demo/satellite.pmtiles",
		);
		expect((style.sources as Record<string, unknown>)["spellkave-satellite"]).toMatchObject({
			type: "raster",
			url: "pmtiles://https://gateway.example/w/demo/satellite.pmtiles",
		});
		expect(style.layers.map((layer) => layer.id)).toEqual([
			"background",
			"spellkave-satellite",
			"roads",
		]);
		expect((style.layers[1] as { layout?: unknown } | undefined)?.layout).toEqual({
			visibility: "none",
		});
	});

	it("serves byte ranges and rejects unsatisfiable ranges", async () => {
		const overlay = mkdtempSync(join(tmpdir(), "spellkave-satellite-"));
		const archive = join(overlay, "demo", "satellite", "outdoor.pmtiles");
		mkdirSync(dirname(archive), { recursive: true });
		writeFileSync(archive, Buffer.from("0123456789"));
		expect(satelliteArchivePath(overlay, "demo")).toBe(archive);
		const cache = await sampleCache();
		const options = {
			store: new TilesModelStore(),
			loadCache: async () => cache,
			worldAssetsRoot: overlay,
			fontsRoot,
			mapsDemoPath,
			knownSlugs: new Set(["demo"]),
		};
		const hit = await handleWorldTilesRequest(
			new Request("https://gateway.example/w/demo/satellite.pmtiles", {
				headers: { range: "bytes=2-5" },
			}),
			{ kind: "satellite", slug: "demo" },
			options,
		);
		expect(hit.status).toBe(206);
		expect(hit.headers.get("content-range")).toBe("bytes 2-5/10");
		expect(await hit.text()).toBe("2345");
		expect(hit.headers.get("access-control-expose-headers")).toContain("content-range");
		const styleResponse = await handleWorldTilesRequest(
			new Request("https://gateway.example/w/demo/style.json"),
			{ kind: "style", slug: "demo" },
			options,
		);
		const style = (await styleResponse.json()) as {
			metadata: Record<string, unknown>;
			layers: Array<{ id: string }>;
		};
		expect(style.metadata["spellkave:satellite"]).toMatchObject({ available: true });
		expect(style.layers.findIndex((layer) => layer.id === "spellkave-satellite")).toBeLessThan(
			style.layers.findIndex((layer) => layer.id === "node-circle"),
		);
		const miss = await handleWorldTilesRequest(
			new Request("https://gateway.example/w/demo/satellite.pmtiles", {
				headers: { range: "bytes=99-" },
			}),
			{ kind: "satellite", slug: "demo" },
			options,
		);
		expect(miss.status).toBe(416);
		expect(miss.headers.get("content-range")).toBe("bytes */10");
		rmSync(overlay, { recursive: true, force: true });
	});
});

describe("asset path traversal", () => {
	it("rejects .. and unknown modules", () => {
		expect(resolveAssetOnDisk("sample-maps", "../secret", assetsRoot)).toBeNull();
		expect(resolveAssetOnDisk("sample-maps", "maps/../../etc/passwd", assetsRoot)).toBeNull();
		expect(resolveAssetOnDisk("evil", "maps/x.jpg", assetsRoot)).toBeNull();
		expect(resolveAssetOnDisk("Evil", "maps/x.jpg", assetsRoot)).toBeNull();
		expect(resolveAssetOnDisk("sample-maps", "/abs/path.jpg", assetsRoot)).toBeNull();
	});

	it("resolves an asset beneath its module directory", () => {
		const root = mkdtempSync(join(tmpdir(), "tile-asset-"));
		try {
			const folder = join(root, "sample-maps", "maps");
			mkdirSync(folder, { recursive: true });
			const file = join(folder, "sample.jpg");
			writeFileSync(file, "fixture bytes");
			expect(resolveAssetOnDisk("sample-maps", "maps/sample.jpg", root)).toBe(file);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it("serves overlay only; missing overlay is no art", () => {
		const overlay = mkdtempSync(join(tmpdir(), "world-assets-"));
		try {
			const moduleDir = join(overlay, "demo", "sample-maps", "maps");
			mkdirSync(moduleDir, { recursive: true });
			const overlayFile = join(moduleDir, "overlay.jpg");
			writeFileSync(overlayFile, "overlay");
			expect(resolveWorldAsset("sample-maps", "maps/overlay.jpg", join(overlay, "demo"))).toBe(
				overlayFile,
			);
			expect(
				resolveWorldAsset(
					"sample-maps",
					"maps/Sample Hamlet.jpg",
					join(overlay, "missing-slug"),
				),
			).toBeNull();
			expect(resolveWorldAsset("sample-maps", "maps/overlay.jpg")).toBeNull();
		} finally {
			rmSync(overlay, { recursive: true, force: true });
		}
	});

	it("defaultWorldAssetsRoot honours SPELLKAVE_MCP_WORLD_ASSETS_ROOT", () => {
		const prev = process.env.SPELLKAVE_MCP_WORLD_ASSETS_ROOT;
		process.env.SPELLKAVE_MCP_WORLD_ASSETS_ROOT = "/world-assets";
		try {
			expect(defaultWorldAssetsRoot()).toBe("/world-assets");
		} finally {
			if (prev === undefined) delete process.env.SPELLKAVE_MCP_WORLD_ASSETS_ROOT;
			else process.env.SPELLKAVE_MCP_WORLD_ASSETS_ROOT = prev;
		}
		expect(defaultWorldAssetsRoot()).toBeUndefined();
	});

	it("worldAssetsLoaded is slug-dir existence under the overlay root", () => {
		expect(worldAssetsLoaded(undefined, "demo")).toBe(false);
		const overlay = mkdtempSync(join(tmpdir(), "loaded-flag-"));
		try {
			expect(worldAssetsLoaded(overlay, "demo")).toBe(false);
			mkdirSync(join(overlay, "demo"));
			expect(worldAssetsLoaded(overlay, "demo")).toBe(true);
		} finally {
			rmSync(overlay, { recursive: true, force: true });
		}
	});
});

describe("demo MVT encode", () => {
	it("builds layers and encodes z=12/16/19 tiles with expected layer names", async () => {
		const cache = await sampleCache();
		for (const name of TILE_LAYER_NAMES) {
			expect(cache.layers[name].type).toBe("FeatureCollection");
		}
		expect(cache.layers.spellkave_node.features.length).toBeGreaterThan(0);
		expect(cache.layers.spellkave_backdrop_frame.features.length).toBe(
			cache.export.backdrops.length,
		);
		expect(Array.isArray(cache.levels)).toBe(true);

		// Tile XYZ covering the fixture center up to tactical zoom z=21.
		const [minLon, , maxLon, maxLat] = cache.bounds;
		const lon = (minLon + maxLon) / 2;
		const lat = (cache.bounds[1] + maxLat) / 2;
		const samples: Array<[number, number, number]> = [12, 16, 19, 21].map((z) => {
			const n = 2 ** z;
			const x = Math.floor(((lon + 180) / 360) * n);
			const latRad = (lat * Math.PI) / 180;
			const y = Math.floor(
				((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
			);
			return [z, x, y];
		});
		for (const [z, x, y] of samples) {
			const buf = encodeMvtTile(cache, z, x, y);
			expect(buf, `tile z=${z} x=${x} y=${y}`).not.toBeNull();
			const tile = new VectorTile(new Pbf(buf!));
			const layerNames = Object.keys(tile.layers).sort();
			expect(layerNames.length).toBeGreaterThan(0);
			expect(layerNames.every((n) => (TILE_LAYER_NAMES as readonly string[]).includes(n))).toBe(
				true,
			);
			for (const name of layerNames) {
				const layer = tile.layers[name]!;
				expect(layer.length).toBeGreaterThan(0);
				const feat = layer.feature(0);
				expect(feat.properties).toBeTypeOf("object");
				const keys = Object.keys(feat.properties);
				if (name === "spellkave_node") {
					expect(keys.some((k) => k.includes("spellkave:") || k === "name" || k === "ref")).toBe(
						true,
					);
				}
			}
		}
	});

	it("returns null (empty) for ocean tiles far from the world", async () => {
		const cache = await sampleCache();
		expect(encodeMvtTile(cache, 3, 0, 0)).toBeNull();
	});
});

describe("TileJSON + style + backdrops", () => {
	it("TileJSON 3.0 has vector_layers, bounds, levels", async () => {
		const cache = await sampleCache();
		const tj = buildTileJson(cache, "http://localhost:8080");
		expect(tj.tilejson).toBe("3.0.0");
		expect(tj.minzoom).toBe(0);
		expect(tj.maxzoom).toBe(22);
		expect(Array.isArray(tj.tiles)).toBe(true);
		expect((tj.tiles as string[])[0]).toContain("/w/demo/tiles/{z}/{x}/{y}.pbf");
		expect(tj.bounds).toEqual(cache.bounds);
		expect(Array.isArray(tj.vector_layers)).toBe(true);
		const ids = (tj.vector_layers as { id: string }[]).map((l) => l.id);
		for (const name of TILE_LAYER_NAMES) expect(ids).toContain(name);
		expect(tj.attribution as string).toMatch(/Spellkave/);
		expect(Array.isArray(tj.levels)).toBe(true);
	});

	it("style validates with maplibre-gl-style-spec", async () => {
		const cache = await sampleCache();
		const style = buildMapLibreStyle(cache, "http://localhost:8080");
		const errors = validateMapLibreStyle(style);
		expect(errors, errors.join("\n")).toEqual([]);
		expect(style.glyphs).toContain("/w/demo/fonts/{fontstack}/{range}.pbf");
		const indoorBd = (style.metadata as { "spellkave:indoor_backdrops"?: { graph: string }[] })[
			"spellkave:indoor_backdrops"
		];
		expect(Array.isArray(indoorBd)).toBe(true);
		expect(indoorBd?.some((row) => row.graph.includes("yard"))).toBe(false);
		const allBd = (
			style.metadata as { "spellkave:backdrops"?: { graph: string; indoor: boolean }[] }
		)["spellkave:backdrops"];
		expect(allBd?.some((row) => row.graph.includes("yard") && row.indoor === false)).toBe(true);

		expect(style.sources).toHaveProperty("spellkave");
		// No external basemap source.
		const sources = style.sources as Record<string, { type: string; url?: string }>;
		for (const [id, src] of Object.entries(sources)) {
			if (id === "spellkave") {
				expect(src.type).toBe("vector");
				expect(src.url).toContain("tiles.json");
				expect((src as { promoteId?: Record<string, string> }).promoteId).toEqual({
					spellkave_node: "spellkave:node_id",
					spellkave_room: "spellkave:node_id",
				});
			} else {
				expect(src.type).toBe("image");
			}
		}
	});

	it("projects each backdrop as four corners and builds its asset URL", async () => {
		const cache = await sampleCache();
		expect(cache.export.backdrops).toHaveLength(1);
		expect(cache.export.backdrops[0]?.coordinates).toHaveLength(4);
		const resolved = resolveBackdropUrls(
			cache.export.backdrops,
			"http://localhost:8080",
			"demo",
		);
		for (const b of resolved) {
			expect(b.url).toMatch(/^http:\/\/localhost:8080\/w\/demo\/assets\/sample-maps\//);
		}
	});
});

describe("HTTP handler", () => {
	it("bakes publicBaseUrl (canonical origin) into tiles.json / style.json links, not the bind address", async () => {
		const cache = await sampleCache();
		const store = new TilesModelStore();
		store.set(cache);
		const options = {
			store,
			loadCache: async () => null,
			fontsRoot,
			mapsDemoPath,
			knownSlugs: new Set(["demo"]),
			publicBaseUrl: "https://mcp.spellkave.com/",
		};
		const tilesJson = await handleWorldTilesRequest(
			new Request("http://127.0.0.1:8080/w/demo/tiles.json"),
			{ kind: "tiles_json", slug: "demo" },
			options,
		);
		const body = (await tilesJson.json()) as { tiles: string[] };
		expect(body.tiles[0]).toMatch(/^https:\/\/mcp\.spellkave\.com\/w\/demo\//);
		const style = await handleWorldTilesRequest(
			new Request("http://127.0.0.1:8080/w/demo/style.json"),
			{ kind: "style", slug: "demo" },
			options,
		);
		const text = await style.text();
		expect(text).toContain("https://mcp.spellkave.com/w/demo/");
		expect(text).not.toContain("127.0.0.1");
	});

	it("serves tiles.json / empty tile 204 / rejects unknown slug / traversal 404", async () => {
		const cache = await sampleCache();
		const store = new TilesModelStore();
		store.set(cache);
		const options = {
			store,
			loadCache: async () => null,
			fontsRoot,
			mapsDemoPath,
			knownSlugs: new Set(["demo"]),
		};

		const tilesJson = await handleWorldTilesRequest(
			new Request("http://localhost:8080/w/demo/tiles.json"),
			{ kind: "tiles_json", slug: "demo" },
			options,
		);
		expect(tilesJson.status).toBe(200);
		expect(tilesJson.headers.get("content-type")).toContain("application/json");
		expect(tilesJson.headers.get("etag")).toBe(cache.etag);
		expect(tilesJson.headers.get("access-control-allow-origin")).toBeTruthy();

		const empty = await handleWorldTilesRequest(
			new Request("http://localhost:8080/w/demo/tiles/3/0/0.pbf"),
			{ kind: "tile", slug: "demo", z: 3, x: 0, y: 0 },
			options,
		);
		expect(empty.status).toBe(204);

		const unknown = await handleWorldTilesRequest(
			new Request("http://localhost:8080/w/nope/tiles.json"),
			{ kind: "tiles_json", slug: "nope" },
			options,
		);
		expect(unknown.status).toBe(404);

		const trav = await handleWorldTilesRequest(
			new Request("http://localhost:8080/w/demo/assets/sample-maps/../package.json"),
			{ kind: "asset", slug: "demo", assetPath: "sample-maps/../package.json" },
			options,
		);
		expect(trav.status).toBe(404);

		// Font range present.
		const font = await handleWorldTilesRequest(
			new Request("http://localhost:8080/w/demo/fonts/Noto%20Sans%20Regular/0-255.pbf"),
			{ kind: "font", slug: "demo", fontPath: "Noto Sans Regular/0-255.pbf" },
			options,
		);
		expect(font.status).toBe(200);
		expect(font.headers.get("content-type")).toBe("application/x-protobuf");
		expect(font.headers.get("cache-control")).toBe("public, max-age=86400");

		// Unvendored range of a vendored stack: MapLibre asks for emoji in the
		// traversal labels as UTF-16 surrogate ranges (55296-55551, ...). An
		// empty glyph PBF, not 404 console noise (sk-jay0.1.8.100 s10).
		const missingRange = await handleWorldTilesRequest(
			new Request("http://localhost:8080/w/demo/fonts/Noto%20Sans%20Regular/55296-55551.pbf"),
			{ kind: "font", slug: "demo", fontPath: "Noto Sans Regular/55296-55551.pbf" },
			options,
		);
		expect(missingRange.status).toBe(200);
		expect(missingRange.headers.get("content-type")).toBe("application/x-protobuf");
		expect((await missingRange.arrayBuffer()).byteLength).toBe(0);
		// Short-lived: a range vendored later must not stay empty for a day.
		expect(missingRange.headers.get("cache-control")).toBe("public, max-age=300");
		// A read failure other than "no such file" is not an empty range. A
		// directory named like a range fails the read with EISDIR.
		const brokenRoot = mkdtempSync(join(tmpdir(), "sk-fonts-"));
		try {
			mkdirSync(join(brokenRoot, "Noto Sans Regular", "1280-1535.pbf"), { recursive: true });
			const broken = await handleWorldTilesRequest(
				new Request("http://localhost:8080/w/demo/fonts/Noto%20Sans%20Regular/1280-1535.pbf"),
				{ kind: "font", slug: "demo", fontPath: "Noto Sans Regular/1280-1535.pbf" },
				{ ...options, fontsRoot: brokenRoot },
			);
			expect(broken.status).toBe(500);
			expect(broken.headers.get("cache-control")).toBe("no-store");
			// A plain file where a font stack should be is a missing path: 404.
			writeFileSync(join(brokenRoot, "README.md"), "not a font stack");
			const notDir = await handleWorldTilesRequest(
				new Request("http://localhost:8080/w/demo/fonts/README.md/0-255.pbf"),
				{ kind: "font", slug: "demo", fontPath: "README.md/0-255.pbf" },
				{ ...options, fontsRoot: brokenRoot },
			);
			expect(notDir.status).toBe(404);
		} finally {
			rmSync(brokenRoot, { recursive: true, force: true });
		}
		// An unknown font stack or a malformed range stays a 404.
		for (const fontPath of [
			"No Such Font/55296-55551.pbf",
			"Noto Sans Regular/1-2.pbf",
			"Noto Sans Regular/65536-65791.pbf",
		]) {
			const miss = await handleWorldTilesRequest(
				new Request(`http://localhost:8080/w/demo/fonts/${encodeURI(fontPath)}`),
				{ kind: "font", slug: "demo", fontPath },
				options,
			);
			expect(miss.status).toBe(404);
		}

		const asset = await handleWorldTilesRequest(
			new Request(
				"http://localhost:8080/w/demo/assets/sample-maps/maps/Sample%20Hamlet.jpg",
			),
			{
				kind: "asset",
				slug: "demo",
				assetPath: "sample-maps/maps/Sample Hamlet.jpg",
			},
			options,
		);
		expect(asset.status).toBe(404);
	});

	it("serves overlay art and 404s without the PVC tree", async () => {
		const cache = await sampleCache();
		const store = new TilesModelStore();
		store.set(cache);
		const overlay = mkdtempSync(join(tmpdir(), "world-assets-"));
		try {
			const moduleDir = join(overlay, "demo", "sample-maps", "maps");
			mkdirSync(moduleDir, { recursive: true });
			writeFileSync(join(moduleDir, "overlay.jpg"), "jpeg-bytes");
			const options = {
				store,
				loadCache: async () => null,
				fontsRoot,
				mapsDemoPath,
				worldAssetsRoot: overlay,
				knownSlugs: new Set(["demo"]),
			};
			const hit = await handleWorldTilesRequest(
				new Request("http://localhost:8080/w/demo/assets/sample-maps/maps/overlay.jpg"),
				{ kind: "asset", slug: "demo", assetPath: "sample-maps/maps/overlay.jpg" },
				options,
			);
			expect(hit.status).toBe(200);
			expect(hit.headers.get("content-type")).toBe("image/jpeg");
			const miss = await handleWorldTilesRequest(
				new Request(
					"http://localhost:8080/w/demo/assets/sample-maps/maps/Sample%20Hamlet.jpg",
				),
				{
					kind: "asset",
					slug: "demo",
					assetPath: "sample-maps/maps/Sample Hamlet.jpg",
				},
				{ ...options, worldAssetsRoot: undefined },
			);
			expect(miss.status).toBe(404);
		} finally {
			rmSync(overlay, { recursive: true, force: true });
		}
	});

	it("backdrops.json envelope keeps entries and adds loaded", async () => {
		const cache = await sampleCache();
		const store = new TilesModelStore();
		store.set(cache);
		const overlay = mkdtempSync(join(tmpdir(), "bd-loaded-"));
		const baseOptions = {
			store,
			loadCache: async () => null,
			fontsRoot,
			mapsDemoPath,
			knownSlugs: new Set(["demo"]),
		};
		try {
			const none = await handleWorldTilesRequest(
				new Request("http://localhost:8080/w/demo/backdrops.json"),
				{ kind: "backdrops", slug: "demo" },
				baseOptions,
			);
			expect(none.status).toBe(200);
			const noneBody = (await none.json()) as {
				v: string;
				loaded: boolean;
				backdrops: Array<{ id: string; url: string; asset: unknown; coordinates: unknown }>;
			};
			expect(noneBody.v).toBe("spellkave-backdrops/v1");
			expect(noneBody.loaded).toBe(false);
			expect(noneBody.backdrops.length).toBeGreaterThan(0);
			expect(noneBody.backdrops[0]?.id).toBeTruthy();
			expect(noneBody.backdrops[0]?.url).toContain("/w/demo/assets/");
			expect(noneBody.backdrops[0]?.asset).toBeTruthy();
			expect(noneBody.backdrops[0]?.coordinates).toBeTruthy();

			const missing = await handleWorldTilesRequest(
				new Request("http://localhost:8080/w/demo/backdrops.json"),
				{ kind: "backdrops", slug: "demo" },
				{ ...baseOptions, worldAssetsRoot: overlay },
			);
			const missingBody = (await missing.json()) as { loaded: boolean; backdrops: unknown[] };
			expect(missing.status).toBe(200);
			expect(missingBody.loaded).toBe(false);
			expect(missingBody.backdrops.length).toBe(noneBody.backdrops.length);

			mkdirSync(join(overlay, "demo"));
			const empty = await handleWorldTilesRequest(
				new Request("http://localhost:8080/w/demo/backdrops.json"),
				{ kind: "backdrops", slug: "demo" },
				{ ...baseOptions, worldAssetsRoot: overlay },
			);
			const emptyBody = (await empty.json()) as { loaded: boolean; backdrops: unknown[] };
			expect(emptyBody.loaded).toBe(true);

			writeFileSync(join(overlay, "demo", "marker"), "x");
			const filled = await handleWorldTilesRequest(
				new Request("http://localhost:8080/w/demo/backdrops.json"),
				{ kind: "backdrops", slug: "demo" },
				{ ...baseOptions, worldAssetsRoot: overlay },
			);
			const filledBody = (await filled.json()) as { loaded: boolean; backdrops: unknown[] };
			expect(filledBody.loaded).toBe(true);
			expect(filledBody.backdrops.length).toBeGreaterThan(0);
		} finally {
			rmSync(overlay, { recursive: true, force: true });
		}
	});
});
