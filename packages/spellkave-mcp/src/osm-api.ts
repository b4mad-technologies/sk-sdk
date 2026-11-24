/**
 * OSM API 0.6 read subset under `/w/<slug>/api/0.6/` (ADR-0123 / sk-adr8.13).
 *
 * Endpoints: capabilities, map?bbox, node|way|relation/<id>[/full],
 * nodes?nodes= / ways?ways= / relations?relations=.
 * Writes → 405 Allow: GET.
 */

import {
	type OsmDocument,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
	renderOsmJsonString,
	renderOsmXml,
} from "@spellkave/world-map";

import {
	bboxAreaDeg2,
	OSM_AREA_MAXIMUM_DEG2,
	OSM_WAYNODES_MAXIMUM,
	type OsmElementSet,
	type WorldOsmCache,
	type WorldOsmSnapshot,
} from "./osm-model.ts";

export const OSM_API_GENERATOR = "Spellkave OSM API 0.6";

/** Path: `/w/<slug>/api/0.6/...` or `/w/<slug>/api/interpreter`. */
const WORLD_API_PATH = /^\/w\/([a-z][a-z0-9-]{0,63})\/api(?:\/0\.6(\/.*)?|\/interpreter\/?)$/;

export function parseWorldApiPath(
	pathname: string,
): { slug: string; kind: "osm06" | "interpreter"; rest: string } | null {
	const match = WORLD_API_PATH.exec(pathname);
	if (match === null) return null;
	const slug = match[1] ?? "";
	if (pathname.includes("/api/interpreter")) {
		return { slug, kind: "interpreter", rest: "" };
	}
	return { slug, kind: "osm06", rest: match[2] ?? "/" };
}

export function wantsJson(request: Request, pathname: string): boolean {
	if (pathname.endsWith(".json")) return true;
	const accept = request.headers.get("accept") ?? "";
	if (accept.includes("application/json") && !accept.includes("application/xml")) return true;
	if (accept.includes("application/osm+json")) return true;
	return false;
}

function stripJsonSuffix(path: string): string {
	return path.endsWith(".json") ? path.slice(0, -".json".length) : path;
}

export function osmCorsHeaders(request: Request): Record<string, string> {
	// Open CORS for GET/POST — JOSM / Overpass Turbo / MapLibre (ADR-0123).
	const origin = request.headers.get("origin");
	const allowOrigin = origin !== null && origin !== "" ? origin : "*";
	return {
		"access-control-allow-origin": allowOrigin,
		"access-control-allow-methods": "GET, POST, OPTIONS",
		"access-control-allow-headers": "authorization, content-type, accept",
		"access-control-max-age": "600",
		vary: "Origin",
	};
}

export function osmPreflightResponse(request: Request): Response {
	return new Response(null, {
		status: 204,
		headers: { ...osmCorsHeaders(request), "cache-control": "no-store" },
	});
}

function docFromSet(base: WorldOsmSnapshot, set: OsmElementSet): OsmDocument {
	return {
		generator: base.doc.generator,
		tick: base.doc.tick,
		timestamp: base.doc.timestamp,
		nodes: set.nodes,
		ways: set.ways,
		relations: set.relations,
	};
}

function renderDoc(doc: OsmDocument, asJson: boolean): { body: string; contentType: string } {
	if (asJson) {
		return {
			body: renderOsmJsonString(doc, false),
			contentType: "application/json; charset=utf-8",
		};
	}
	return {
		body: renderOsmXml(doc),
		contentType: "application/xml; charset=utf-8",
	};
}

function ok(request: Request, body: string, contentType: string, status = 200): Response {
	return new Response(body, {
		status,
		headers: {
			...osmCorsHeaders(request),
			"content-type": contentType,
			"cache-control": "no-store",
		},
	});
}

function errText(
	request: Request,
	status: number,
	text: string,
	extra?: Record<string, string>,
): Response {
	return new Response(text, {
		status,
		headers: {
			...osmCorsHeaders(request),
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
			...extra,
		},
	});
}

function capabilitiesXml(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="${OSM_API_GENERATOR}">
  <api>
    <version minimum="0.6" maximum="0.6"/>
    <area maximum="${OSM_AREA_MAXIMUM_DEG2}"/>
    <waynodes maximum="${OSM_WAYNODES_MAXIMUM}"/>
    <timeout seconds="30"/>
    <status database="online" api="readonly" gpx="offline"/>
  </api>
</osm>
`;
}

function capabilitiesJson(): string {
	return JSON.stringify(
		{
			version: "0.6",
			generator: OSM_API_GENERATOR,
			api: {
				version: { minimum: "0.6", maximum: "0.6" },
				area: { maximum: OSM_AREA_MAXIMUM_DEG2 },
				waynodes: { maximum: OSM_WAYNODES_MAXIMUM },
				timeout: { seconds: 30 },
				status: { database: "online", api: "readonly", gpx: "offline" },
			},
		},
		null,
		2,
	);
}

function parseBbox(raw: string | null): [number, number, number, number] | string {
	if (raw === null || raw.trim() === "")
		return "The parameter bbox is required, and must be of the form min_lon,min_lat,max_lon,max_lat.";
	const parts = raw.split(",").map((p) => Number(p.trim()));
	if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
		return "The parameter bbox is required, and must be of the form min_lon,min_lat,max_lon,max_lat.";
	}
	const [left, bottom, right, top] = parts as [number, number, number, number];
	if (left > right || bottom > top) {
		return "The minimum longitude must be less than the maximum longitude, and likewise for latitudes.";
	}
	return [left, bottom, right, top];
}

function parseIdList(raw: string | null): string[] | null {
	if (raw === null || raw.trim() === "") return null;
	return raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s !== "");
}

function findNode(doc: OsmDocument, id: string): OsmNode | undefined {
	return doc.nodes.find((n) => n.id === id);
}
function findWay(doc: OsmDocument, id: string): OsmWay | undefined {
	return doc.ways.find((w) => w.id === id);
}
function findRel(doc: OsmDocument, id: string): OsmRelation | undefined {
	return doc.relations.find((r) => r.id === id);
}

function wayFull(doc: OsmDocument, way: OsmWay): OsmElementSet {
	const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
	const nodes: OsmNode[] = [];
	for (const ref of way.refs) {
		const n = nodeById.get(ref);
		if (n !== undefined) nodes.push(n);
	}
	return { nodes, ways: [way], relations: [] };
}

function relationFull(doc: OsmDocument, rel: OsmRelation): OsmElementSet {
	const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
	const wayById = new Map(doc.ways.map((w) => [w.id, w]));
	const relById = new Map(doc.relations.map((r) => [r.id, r]));
	const nodes = new Map<string, OsmNode>();
	const ways = new Map<string, OsmWay>();
	const relations = new Map<string, OsmRelation>([[rel.id, rel]]);

	function pullRel(r: OsmRelation): void {
		for (const m of r.members) {
			if (m.type === "node") {
				const n = nodeById.get(m.ref);
				if (n !== undefined) nodes.set(n.id, n);
			} else if (m.type === "way") {
				const w = wayById.get(m.ref);
				if (w !== undefined) {
					ways.set(w.id, w);
					for (const ref of w.refs) {
						const n = nodeById.get(ref);
						if (n !== undefined) nodes.set(n.id, n);
					}
				}
			} else if (m.type === "relation") {
				const child = relById.get(m.ref);
				if (child !== undefined && !relations.has(child.id)) {
					relations.set(child.id, child);
					pullRel(child);
				}
			}
		}
	}
	pullRel(rel);
	return {
		nodes: [...nodes.values()],
		ways: [...ways.values()],
		relations: [...relations.values()],
	};
}

export interface ServeOsmApiOptions {
	cache: WorldOsmCache;
	slug: string;
	/** Path after `/api/0.6`, e.g. `/map` or `/node/123`. */
	rest: string;
	catalogHasSlug: boolean;
}

/** Handle one OSM 0.6 request (auth already checked by gateway/http). */
export async function serveOsmApi(
	request: Request,
	options: ServeOsmApiOptions,
): Promise<Response> {
	const cors = osmCorsHeaders(request);
	if (!options.catalogHasSlug) {
		return errText(request, 404, "Not found.");
	}

	const method = request.method.toUpperCase();
	if (method === "OPTIONS") return osmPreflightResponse(request);

	// Writes are absent (ADR-0123 read-only).
	if (method === "PUT" || method === "POST" || method === "DELETE" || method === "PATCH") {
		return errText(request, 405, "Method not allowed.", {
			allow: "GET, HEAD, OPTIONS",
			...cors,
		});
	}
	if (method !== "GET" && method !== "HEAD") {
		return errText(request, 405, "Method not allowed.", { allow: "GET, HEAD, OPTIONS" });
	}

	const asJson = wantsJson(request, options.rest);
	const rest = stripJsonSuffix(options.rest);
	const url = new URL(request.url);

	try {
		await options.cache.ensure(options.slug);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.startsWith("unknown catalog world")) {
			return errText(request, 404, "Not found.");
		}
		return errText(request, 503, `World snapshot unavailable: ${message}`);
	}

	const snap = options.cache.get(options.slug);
	if (snap === undefined) {
		return errText(request, 503, "World snapshot unavailable.");
	}

	// /capabilities
	if (rest === "/capabilities" || rest === "/capabilities/") {
		if (asJson) return ok(request, capabilitiesJson(), "application/json; charset=utf-8");
		return ok(request, capabilitiesXml(), "application/xml; charset=utf-8");
	}

	// /map?bbox=l,b,r,t
	if (rest === "/map" || rest === "/map/") {
		const parsed = parseBbox(url.searchParams.get("bbox"));
		if (typeof parsed === "string") return errText(request, 400, parsed);
		const [left, bottom, right, top] = parsed;
		const area = bboxAreaDeg2(left, bottom, right, top);
		if (area > OSM_AREA_MAXIMUM_DEG2) {
			// Same wording real OSM uses for oversized bbox.
			return errText(
				request,
				400,
				`The maximum bbox size is ${OSM_AREA_MAXIMUM_DEG2}, and your request was too large. Either request a smaller area, or use planet.osm`,
			);
		}
		const set = options.cache.elementsInBbox(options.slug, left, bottom, right, top);
		if (set === undefined) return errText(request, 503, "World snapshot unavailable.");
		const rendered = renderDoc(docFromSet(snap, set), asJson);
		return ok(request, rendered.body, rendered.contentType);
	}

	// /nodes?nodes= /ways?ways= /relations?relations=
	const multiNode = rest === "/nodes" || rest === "/nodes/";
	const multiWay = rest === "/ways" || rest === "/ways/";
	const multiRel = rest === "/relations" || rest === "/relations/";
	if (multiNode || multiWay || multiRel) {
		const key = multiNode ? "nodes" : multiWay ? "ways" : "relations";
		const ids = parseIdList(url.searchParams.get(key));
		if (ids === null) {
			return errText(request, 400, `The parameter ${key} is required`);
		}
		const nodes: OsmNode[] = [];
		const ways: OsmWay[] = [];
		const relations: OsmRelation[] = [];
		for (const id of ids) {
			if (multiNode) {
				const n = findNode(snap.doc, id);
				if (n) nodes.push(n);
			} else if (multiWay) {
				const w = findWay(snap.doc, id);
				if (w) ways.push(w);
			} else {
				const r = findRel(snap.doc, id);
				if (r) relations.push(r);
			}
		}
		if (nodes.length + ways.length + relations.length === 0) {
			return errText(request, 404, "Not found.");
		}
		const rendered = renderDoc(docFromSet(snap, { nodes, ways, relations }), asJson);
		return ok(request, rendered.body, rendered.contentType);
	}

	// /node|way|relation/<id>[/full]
	const single = /^\/(node|way|relation)\/([^/]+)(?:\/(full))?\/?$/.exec(rest);
	if (single !== null) {
		const kind = single[1] as "node" | "way" | "relation";
		const id = single[2] ?? "";
		const full = single[3] === "full";
		if (kind === "node") {
			if (full) return errText(request, 400, "Full is only supported for ways and relations.");
			const n = findNode(snap.doc, id);
			if (n === undefined) return errText(request, 404, "Not found.");
			const rendered = renderDoc(docFromSet(snap, { nodes: [n], ways: [], relations: [] }), asJson);
			return ok(request, rendered.body, rendered.contentType);
		}
		if (kind === "way") {
			const w = findWay(snap.doc, id);
			if (w === undefined) return errText(request, 404, "Not found.");
			const set = full ? wayFull(snap.doc, w) : { nodes: [], ways: [w], relations: [] };
			const rendered = renderDoc(docFromSet(snap, set), asJson);
			return ok(request, rendered.body, rendered.contentType);
		}
		const r = findRel(snap.doc, id);
		if (r === undefined) return errText(request, 404, "Not found.");
		const set = full ? relationFull(snap.doc, r) : { nodes: [], ways: [], relations: [r] };
		const rendered = renderDoc(docFromSet(snap, set), asJson);
		return ok(request, rendered.body, rendered.contentType);
	}

	return errText(request, 404, "Not found.");
}
