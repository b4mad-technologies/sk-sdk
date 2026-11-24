/**
 * MVT tiles + TileJSON + backdrops.json + MapLibre style + asset/font routes
 * under `/w/<slug>/…` (ADR-0123 D-2 sidecar, bead sk-adr8.14).
 *
 * Auth + open CORS are applied by the gateway branch that calls
 * `handleWorldTilesRequest`. This module is pure request→response for a
 * known slug once the caller has validated Bearer auth.
 */

import { existsSync } from "node:fs";
import { open, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, normalize, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
	backdropsOf,
	buildMapLibreStyle,
	buildTileJson,
	encodeMvtTile,
	resolveBackdropUrls,
	type WorldTilesCache,
} from "@spellkave/world-map/tiles";

import type { TilesModelStore } from "./osm-model.ts";

/** `/w/<slug>/…` path parser. */
const WORLD_PATH =
	/^\/w\/([a-z][a-z0-9-]{0,63})(?:\/(tiles\.json|backdrops\.json|style\.json|satellite\.pmtiles|maps-demo|tiles\/(\d+)\/(\d+)\/(\d+)\.(?:pbf|mvt)|assets\/(.+)|fonts\/(.+)))?$/;

export type WorldTilesPath =
	| { kind: "root"; slug: string }
	| { kind: "tiles_json"; slug: string }
	| { kind: "backdrops"; slug: string }
	| { kind: "style"; slug: string }
	| { kind: "satellite"; slug: string }
	| { kind: "maps_demo"; slug: string }
	| { kind: "tile"; slug: string; z: number; x: number; y: number }
	| { kind: "asset"; slug: string; assetPath: string }
	| { kind: "font"; slug: string; fontPath: string };

export function parseWorldTilesPath(pathname: string): WorldTilesPath | null {
	// Decode %20 etc. so asset/font paths with spaces match after Request URL round-trips.
	let decoded = pathname;
	try {
		decoded = decodeURIComponent(pathname);
	} catch {
		/* keep raw */
	}
	const match = WORLD_PATH.exec(decoded);
	if (!match) return null;
	const slug = match[1]!;
	const rest = match[2];
	if (rest === undefined) return { kind: "root", slug };
	if (rest === "tiles.json") return { kind: "tiles_json", slug };
	if (rest === "backdrops.json") return { kind: "backdrops", slug };
	if (rest === "style.json") return { kind: "style", slug };
	if (rest === "satellite.pmtiles") return { kind: "satellite", slug };
	if (rest === "maps-demo") return { kind: "maps_demo", slug };
	if (match[3] !== undefined && match[4] !== undefined && match[5] !== undefined) {
		const z = Number(match[3]);
		const x = Number(match[4]);
		const y = Number(match[5]);
		if (![z, x, y].every((n) => Number.isInteger(n) && n >= 0)) return null;
		if (z > 22) return null;
		return { kind: "tile", slug, z, x, y };
	}
	if (match[6] !== undefined) return { kind: "asset", slug, assetPath: match[6] };
	if (match[7] !== undefined) return { kind: "font", slug, fontPath: match[7] };
	return null;
}

/** Open CORS for MapLibre / JOSM / Overpass Turbo (any origin). */
export function openTilesCorsHeaders(request: Request): Record<string, string> {
	const origin = request.headers.get("origin");
	const allowOrigin = origin && origin !== "" ? origin : "*";
	const headers: Record<string, string> = {
		"access-control-allow-origin": allowOrigin,
		"access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
		"access-control-allow-headers": "authorization, content-type, range",
		"access-control-expose-headers": "accept-ranges, content-length, content-range, etag",
		"access-control-max-age": "600",
	};
	if (allowOrigin !== "*") headers.vary = "Origin";
	return headers;
}

export function tilesPreflightResponse(request: Request): Response {
	return new Response(null, {
		status: 204,
		headers: {
			...openTilesCorsHeaders(request),
			"cache-control": "no-store",
		},
	});
}

/** One path segment; directory existence under the root is the allowlist. */
const ASSET_MODULE_RE = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * Resolve `asset_module` + `asset_path` under an assets root.
 * Rejects path traversal and modules whose directory is not present.
 * Returns absolute path or null.
 */
export function resolveAssetOnDisk(
	assetModule: string,
	assetPath: string,
	assetsRoot: string,
): string | null {
	if (!ASSET_MODULE_RE.test(assetModule)) return null;
	if (assetPath.includes("\0")) return null;
	// Reject absolute paths (unix or windows) before any join.
	if (
		assetPath.startsWith("/") ||
		assetPath.startsWith("\\") ||
		/^[a-zA-Z]:[\\/]/.test(assetPath)
	) {
		return null;
	}
	// Disallow absolute and parent segments before join.
	const parts = assetPath.split(/[/\\]+/).filter((p) => p !== "");
	if (parts.some((p) => p === ".." || p === ".")) return null;
	if (parts.length === 0) return null;

	const root = resolve(assetsRoot);
	const candidate = resolve(root, assetModule, ...parts);
	const rel = relative(root, candidate);
	if (rel.startsWith("..") || rel.includes(`..${sep}`) || normalize(rel).startsWith("..")) {
		return null;
	}
	// Must stay under the module dir, which must exist (filesystem allowlist).
	if (!rel.startsWith(`${assetModule}${sep}`) && rel !== assetModule) return null;
	if (!existsSync(join(root, assetModule))) return null;
	return candidate;
}

/** Overlay PVC per-slug root only. Missing overlay → no art. */
export function resolveWorldAsset(
	assetModule: string,
	assetPath: string,
	overlayRoot?: string,
): string | null {
	if (!overlayRoot) return null;
	return resolveAssetOnDisk(assetModule, assetPath, overlayRoot);
}

export function parseAssetUrlPath(assetPath: string): { module: string; path: string } | null {
	const parts = assetPath.split("/").filter((p) => p !== "");
	if (parts.length < 2) return null;
	const module = parts[0]!;
	const path = parts.slice(1).join("/");
	return { module, path };
}

function contentTypeForExt(ext: string): string {
	switch (ext.toLowerCase()) {
		case ".jpg":
		case ".jpeg":
			return "image/jpeg";
		case ".png":
			return "image/png";
		case ".webp":
			return "image/webp";
		case ".gif":
			return "image/gif";
		case ".pbf":
			return "application/x-protobuf";
		case ".html":
			return "text/html; charset=utf-8";
		case ".js":
			return "text/javascript; charset=utf-8";
		case ".css":
			return "text/css; charset=utf-8";
		default:
			return "application/octet-stream";
	}
}

/** A MapLibre glyph range file: `<start>-<end>.pbf`, 256 code points per range. */
const GLYPH_RANGE_FILE = /^(\d{1,5})-(\d{1,5})\.pbf$/;

function isGlyphRangeFile(name: string): boolean {
	const match = GLYPH_RANGE_FILE.exec(name);
	if (match === null) return false;
	const start = Number(match[1]);
	return start % 256 === 0 && Number(match[2]) === start + 255 && start <= 65280;
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

function withCors(
	request: Request,
	init: ResponseInit,
	body?: string | Uint8Array | Buffer | null,
): Response {
	const headers = new Headers(init.headers);
	for (const [k, v] of Object.entries(openTilesCorsHeaders(request))) {
		headers.set(k, v);
	}
	return new Response(body ?? null, { ...init, headers });
}

function jsonResponse(request: Request, body: unknown, status = 200, etag?: string): Response {
	const headers: Record<string, string> = {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store",
	};
	if (etag) headers.etag = etag;
	return withCors(request, { status, headers }, JSON.stringify(body));
}

// Builders live in @spellkave/world-map/tiles — re-export for existing mcp importers.
export {
	buildMapLibreStyle,
	buildTileJson,
	encodeMvtTile,
	resolveBackdropUrls,
	validateMapLibreStyle,
} from "@spellkave/world-map/tiles";

export interface WorldTilesHandlerOptions {
	store: TilesModelStore;
	/** Resolve / refresh cache for a catalog slug. */
	loadCache: (slug: string) => Promise<WorldTilesCache | null>;
	/** Per-slug overlay root (`<root>/<slug>/<module>/…`). Absent → no art. */
	worldAssetsRoot?: string;
	/** Absolute root of static fonts (Open Sans Regular/{range}.pbf) */
	fontsRoot: string;
	/** Absolute path to maps-demo.html */
	mapsDemoPath: string;
	/** Optional maplibre-gl assets dir for demo (js/css). */
	maplibreAssetsDir?: string;
	/**
	 * Public origin to bake into TileJSON / style / backdrops links (e.g. the
	 * gateway's canonical `https://mcp.spellkave.com`). Behind Cloudflare Tunnel
	 * or a LAN forwarder `request.url` carries the loopback bind address, which
	 * no remote client can reach. Absent → derived from the request.
	 */
	publicBaseUrl?: string;
	/** Known catalog slugs; unknown → 404. */
	knownSlugs: ReadonlySet<string>;
}

function packageDir(): string {
	return fileURLToPath(new URL("..", import.meta.url));
}

/** Loaded-bundle art overlay (`SPELLKAVE_MCP_WORLD_ASSETS_ROOT/<slug>/`). */
export function defaultWorldAssetsRoot(): string | undefined {
	const fromEnv = process.env.SPELLKAVE_MCP_WORLD_ASSETS_ROOT?.trim();
	return fromEnv === undefined || fromEnv === "" ? undefined : fromEnv;
}

/**
 * `backdrops.json` `loaded`: slug dir exists under the overlay root.
 * No overlay root → false (no baked art). Independent of any checkout path.
 */
export function worldAssetsLoaded(worldAssetsRoot: string | undefined, slug: string): boolean {
	if (worldAssetsRoot === undefined || worldAssetsRoot === "") return false;
	return existsSync(join(worldAssetsRoot, slug));
}

/** Fixed archive location inside the installed adventure asset module. */
export function satelliteArchivePath(
	worldAssetsRoot: string | undefined,
	slug: string,
): string | null {
	if (!worldAssetsRoot) return null;
	const path = join(worldAssetsRoot, slug, "satellite", "outdoor.pmtiles");
	return existsSync(path) ? path : null;
}

interface SatelliteStyle {
	sources: Record<string, unknown>;
	layers: Array<Record<string, unknown>>;
	metadata?: Record<string, unknown>;
}

/** Add one hidden raster pyramid beneath the Spellkave vector layers. */
export function addSatelliteToStyle(
	style: SatelliteStyle,
	archiveUrl: string,
	attribution = "Spellkave outdoor imagery",
): SatelliteStyle {
	const sourceId = "spellkave-satellite";
	const layerId = "spellkave-satellite";
	const layers = [...style.layers];
	const backgroundIndex = layers.findIndex((layer) => layer.type === "background");
	layers.splice(backgroundIndex < 0 ? 0 : backgroundIndex + 1, 0, {
		id: layerId,
		type: "raster",
		source: sourceId,
		layout: { visibility: "none" },
		paint: { "raster-opacity": 0.88 },
	});
	return {
		...style,
		sources: {
			...style.sources,
			[sourceId]: { type: "raster", url: `pmtiles://${archiveUrl}`, tileSize: 256, attribution },
		},
		layers,
		metadata: {
			...(style.metadata ?? {}),
			"spellkave:satellite": {
				available: true,
				source: sourceId,
				layer: layerId,
				archive: archiveUrl,
			},
		},
	};
}

async function serveSatelliteArchive(request: Request, path: string): Promise<Response> {
	const file = await stat(path);
	const size = file.size;
	const etag = `"${size.toString(16)}-${Math.trunc(file.mtimeMs).toString(16)}"`;
	const headers: Record<string, string> = {
		"accept-ranges": "bytes",
		"cache-control": "public, max-age=3600",
		"content-type": "application/vnd.pmtiles",
		etag,
	};
	const range = request.headers.get("range");
	if (!range) {
		headers["content-length"] = String(size);
		return withCors(
			request,
			{ status: 200, headers },
			request.method === "HEAD" ? null : await readFile(path),
		);
	}
	const match = /^bytes=(\d+)-(\d*)$/.exec(range);
	if (!match) {
		return withCors(request, {
			status: 416,
			headers: { ...headers, "content-range": `bytes */${size}` },
		});
	}
	const start = Number(match[1]);
	const requestedEnd = match[2] === "" ? size - 1 : Number(match[2]);
	if (
		!Number.isSafeInteger(start) ||
		!Number.isSafeInteger(requestedEnd) ||
		start >= size ||
		requestedEnd < start
	) {
		return withCors(request, {
			status: 416,
			headers: { ...headers, "content-range": `bytes */${size}` },
		});
	}
	const end = Math.min(requestedEnd, size - 1);
	const length = end - start + 1;
	headers["content-range"] = `bytes ${start}-${end}/${size}`;
	headers["content-length"] = String(length);
	let body: Buffer | null = null;
	if (request.method !== "HEAD") {
		const handle = await open(path, "r");
		try {
			body = Buffer.allocUnsafe(length);
			await handle.read(body, 0, length, start);
		} finally {
			await handle.close();
		}
	}
	return withCors(request, { status: 206, headers }, body);
}

export function defaultFontsRoot(): string {
	return resolve(packageDir(), "static/fonts");
}

export function defaultMapsDemoPath(): string {
	return resolve(packageDir(), "static/maps-demo.html");
}

export async function handleWorldTilesRequest(
	request: Request,
	parsed: WorldTilesPath,
	options: WorldTilesHandlerOptions,
): Promise<Response> {
	const { slug } = parsed;
	if (!options.knownSlugs.has(slug)) {
		return withCors(
			request,
			{ status: 404, headers: { "cache-control": "no-store" } },
			"Not found.",
		);
	}

	if (request.method === "OPTIONS") {
		return tilesPreflightResponse(request);
	}
	if (request.method !== "GET" && request.method !== "HEAD") {
		return withCors(
			request,
			{
				status: 405,
				headers: { allow: "GET, HEAD, OPTIONS", "cache-control": "no-store" },
			},
			"Method not allowed.",
		);
	}

	// Static demo / fonts / assets may not need the full export cache.
	if (parsed.kind === "satellite") {
		const archive = satelliteArchivePath(options.worldAssetsRoot, slug);
		if (archive === null) return withCors(request, { status: 404 }, "Satellite archive not found.");
		try {
			return await serveSatelliteArchive(request, archive);
		} catch {
			return withCors(request, { status: 404 }, "Satellite archive not found.");
		}
	}

	if (parsed.kind === "maps_demo") {
		try {
			const html = await readFile(options.mapsDemoPath, "utf8");
			const body = request.method === "HEAD" ? null : html;
			return withCors(
				request,
				{
					status: 200,
					headers: {
						"content-type": "text/html; charset=utf-8",
						"cache-control": "no-store",
					},
				},
				body,
			);
		} catch {
			return withCors(request, { status: 404 }, "maps-demo not found.");
		}
	}

	if (parsed.kind === "font") {
		const fontPath = parsed.fontPath;
		const parts = fontPath.split("/").filter((p) => p !== "" && p !== "." && p !== "..");
		if (parts.length !== 2 || !parts[1]!.endsWith(".pbf")) {
			return withCors(request, { status: 404 }, "Not found.");
		}
		const abs = resolve(options.fontsRoot, ...parts);
		const rel = relative(resolve(options.fontsRoot), abs);
		if (rel.startsWith("..")) {
			return withCors(request, { status: 404 }, "Not found.");
		}
		const glyphHeaders = {
			"content-type": "application/x-protobuf",
			"cache-control": "public, max-age=86400",
		};
		try {
			const buf = await readFile(abs);
			return withCors(
				request,
				{ status: 200, headers: glyphHeaders },
				request.method === "HEAD" ? null : buf,
			);
		} catch (cause) {
			// Only a missing file is a missing range. Any other read failure
			// (EMFILE, EACCES, EISDIR, ...) must not look like an empty range,
			// and must not be cached.
			// A file where a font-stack directory should be (ENOTDIR) is a
			// missing path too, so a probe cannot turn it into a 500.
			const code = (cause as NodeJS.ErrnoException | null)?.code;
			if (code !== "ENOENT" && code !== "ENOTDIR") {
				return withCors(
					request,
					{ status: 500, headers: { "cache-control": "no-store" } },
					"Font range unavailable.",
				);
			}
			// Only a few glyph ranges are vendored. The style's labels carry
			// emoji whose ranges are not, and MapLibre draws those locally, so a
			// 404 there is console noise only (sk-jay0.1.8.100 s10). A
			// well-formed range of a vendored font stack answers an empty glyph
			// PBF; an unknown stack or a malformed range stays a 404. The empty
			// answer is cached for minutes, not the day a real glyph file gets,
			// so a range vendored later shows up soon.
			if (isGlyphRangeFile(parts[1]!) && (await isDirectory(dirname(abs)))) {
				return withCors(
					request,
					{
						status: 200,
						headers: { ...glyphHeaders, "cache-control": "public, max-age=300" },
					},
					request.method === "HEAD" ? null : new Uint8Array(0),
				);
			}
			return withCors(request, { status: 404 }, "Font range not found.");
		}
	}

	if (parsed.kind === "asset") {
		const parsedAsset = parseAssetUrlPath(parsed.assetPath);
		if (!parsedAsset) {
			return withCors(request, { status: 404 }, "Not found.");
		}
		const overlay =
			options.worldAssetsRoot === undefined ? undefined : join(options.worldAssetsRoot, slug);
		const abs = resolveWorldAsset(parsedAsset.module, parsedAsset.path, overlay);
		if (abs === null) {
			return withCors(request, { status: 404 }, "Not found.");
		}
		try {
			const buf = await readFile(abs);
			return withCors(
				request,
				{
					status: 200,
					headers: {
						"content-type": contentTypeForExt(extname(abs)),
						"cache-control": "public, max-age=3600",
					},
				},
				request.method === "HEAD" ? null : buf,
			);
		} catch {
			return withCors(request, { status: 404 }, "Asset not found.");
		}
	}

	if (parsed.kind === "root") {
		return jsonResponse(request, {
			slug,
			endpoints: [
				"tiles.json",
				"tiles/{z}/{x}/{y}.pbf",
				"backdrops.json",
				"style.json",
				"satellite.pmtiles",
				"maps-demo",
				"assets/<module>/<path>",
				"fonts/{fontstack}/{range}.pbf",
			],
		});
	}

	const cache =
		options.store.get(slug) ??
		(await options.loadCache(slug).then((c) => {
			if (c) options.store.set(c);
			return c;
		}));
	if (!cache) {
		return withCors(
			request,
			{ status: 503, headers: { "cache-control": "no-store" } },
			"World tiles unavailable.",
		);
	}

	const ifNoneMatch = request.headers.get("if-none-match");
	if (ifNoneMatch && ifNoneMatch === cache.etag) {
		return withCors(request, { status: 304, headers: { etag: cache.etag } });
	}

	const requestUrl = new URL(request.url);
	const baseUrl = (options.publicBaseUrl ?? `${requestUrl.protocol}//${requestUrl.host}`).replace(
		/\/$/,
		"",
	);

	if (parsed.kind === "tiles_json") {
		return jsonResponse(request, buildTileJson(cache, baseUrl), 200, cache.etag);
	}
	if (parsed.kind === "backdrops") {
		const backdrops = resolveBackdropUrls(backdropsOf(cache), baseUrl, slug);
		return jsonResponse(
			request,
			{
				v: "spellkave-backdrops/v1",
				backdrops,
				loaded: worldAssetsLoaded(options.worldAssetsRoot, slug),
			},
			200,
			cache.etag,
		);
	}
	if (parsed.kind === "style") {
		const plain = buildMapLibreStyle(cache, baseUrl);
		const archive = satelliteArchivePath(options.worldAssetsRoot, slug);
		const style =
			archive === null
				? plain
				: addSatelliteToStyle(
						plain as unknown as SatelliteStyle,
						`${baseUrl}/w/${slug}/satellite.pmtiles`,
					);
		return jsonResponse(request, style, 200, cache.etag);
	}
	if (parsed.kind === "tile") {
		const { z, x, y } = parsed;
		const encoded = encodeMvtTile(cache, z, x, y);
		if (encoded === null) {
			return withCors(request, {
				status: 204,
				headers: {
					etag: cache.etag,
					"cache-control": "no-store",
				},
			});
		}
		return withCors(
			request,
			{
				status: 200,
				headers: {
					"content-type": "application/x-protobuf",
					etag: cache.etag,
					"cache-control": "no-store",
					// Explicitly no Content-Encoding (uncompressed pbf).
				},
			},
			request.method === "HEAD" ? null : Buffer.from(encoded),
		);
	}

	return withCors(request, { status: 404 }, "Not found.");
}

export { join };
