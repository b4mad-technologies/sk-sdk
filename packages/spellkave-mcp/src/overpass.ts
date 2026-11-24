/**
 * Small Overpass QL interpreter for shapes Overpass Turbo / QuickOSM / JOSM emit.
 * POST /w/<slug>/api/interpreter (+ GET ?data=). ADR-0123 / sk-adr8.13.
 *
 * Supported: settings `[out:json|xml][timeout:n][bbox:s,w,n,e]`;
 * statements `node|way|rel|relation|nwr(bbox)[filters];`, unions, `->.set` /
 * `.set` inputs, `out body|skel|ids|tags|meta|geom|center [qt];`, `>;` `<;`.
 * Anything else → 400 with Overpass remark body.
 */

import {
	type OsmDocument,
	type OsmNode,
	type OsmRelation,
	type OsmWay,
	renderOsmXml,
} from "@spellkave/world-map";

import { osmCorsHeaders } from "./osm-api.ts";
import {
	elementsInBboxFromDoc,
	type OsmElementSet,
	type WorldOsmCache,
	type WorldOsmSnapshot,
} from "./osm-model.ts";

export const OVERPASS_GENERATOR = "Spellkave Overpass";
export const OVERPASS_COPYRIGHT =
	"The data included in this document is from a Spellkave world projected as OSM (ADR-0123).";

type ElementKind = "node" | "way" | "relation";

interface TagFilter {
	key: string;
	/** undefined = key presence; string = exact; RegExp = regex match */
	value?: string | RegExp;
	negate?: boolean;
}

interface QuerySettings {
	out: "json" | "xml";
	timeout: number;
	bbox?: [number, number, number, number]; // s,w,n,e Overpass order
}

type SetMap = Map<string, OsmElementSet>;

interface OutSpec {
	mode: "body" | "skel" | "ids" | "tags" | "meta" | "geom" | "center";
	qt: boolean;
	fromSet?: string;
}

type Statement =
	| {
			kind: "select";
			types: ElementKind[];
			bbox?: [number, number, number, number]; // l,b,r,t
			filters: TagFilter[];
			inputSet?: string;
			outSet?: string;
	  }
	| { kind: "union"; parts: Statement[]; outSet?: string }
	| { kind: "recurse_down"; outSet?: string }
	| { kind: "recurse_up"; outSet?: string }
	| { kind: "out"; spec: OutSpec };

export class OverpassParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "OverpassParseError";
	}
}

function emptySet(): OsmElementSet {
	return { nodes: [], ways: [], relations: [] };
}

function mergeSets(parts: OsmElementSet[]): OsmElementSet {
	const nodes = new Map<string, OsmNode>();
	const ways = new Map<string, OsmWay>();
	const relations = new Map<string, OsmRelation>();
	for (const p of parts) {
		for (const n of p.nodes) nodes.set(n.id, n);
		for (const w of p.ways) ways.set(w.id, w);
		for (const r of p.relations) relations.set(r.id, r);
	}
	return {
		nodes: [...nodes.values()],
		ways: [...ways.values()],
		relations: [...relations.values()],
	};
}

function stripComments(src: string): string {
	// Block comments /* ... */ and // line comments (Overpass Turbo wizard).
	return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

function parseSettings(src: string): { settings: QuerySettings; rest: string } {
	const settings: QuerySettings = { out: "xml", timeout: 25 };
	let rest = src.trim();
	const settingRe = /^\[([^\]]+)\]\s*/;
	while (true) {
		const m = settingRe.exec(rest);
		if (m === null) break;
		const body = (m[1] ?? "").trim();
		rest = rest.slice(m[0].length);
		if (body === "out:json") settings.out = "json";
		else if (body === "out:xml") settings.out = "xml";
		else if (body.startsWith("timeout:")) {
			const n = Number(body.slice("timeout:".length));
			if (!Number.isFinite(n) || n < 1) throw new OverpassParseError(`bad timeout: ${body}`);
			settings.timeout = n;
		} else if (body.startsWith("bbox:")) {
			const nums = body
				.slice("bbox:".length)
				.split(",")
				.map((s) => Number(s.trim()));
			if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
				throw new OverpassParseError(`bad bbox setting: ${body}`);
			}
			settings.bbox = nums as [number, number, number, number];
		} else if (body.startsWith("maxsize:")) {
			// Accepted and ignored (we stream from memory).
		} else if (body.startsWith("date:") || body.startsWith("diff:")) {
			throw new OverpassParseError(`unsupported setting: [${body}]`);
		} else {
			throw new OverpassParseError(`unsupported setting: [${body}]`);
		}
	}
	// Optional semicolon after the settings block (Turbo always emits one).
	rest = rest.replace(/^;\s*/, "");
	return { settings, rest };
}

function parseTagFilters(raw: string): { filters: TagFilter[]; rest: string } {
	const filters: TagFilter[] = [];
	let rest = raw;
	// [k=v] [k] [k!=v] [k~"re"] [k~"re",i] [~"k"~"v"] — enough for Turbo wizard.
	// Optional `,i` after a regex value is the Overpass case-insensitive flag.
	const re =
		/^\[\s*(!?)\s*(?:(~)\s*"((?:\\.|[^"\\])*)"\s*~\s*"((?:\\.|[^"\\])*)"(,i)?|("(?:\\.|[^"\\])*"|[A-Za-z0-9:_:-]+)\s*(!?=|!=|~|=)?\s*("(?:\\.|[^"\\])*"|[A-Za-z0-9:_:-]+)?(,i)?)?\s*\]/;
	while (true) {
		const m = re.exec(rest);
		if (m === null) break;
		rest = rest.slice(m[0].length);
		const negPrefix = m[1] === "!";
		if (m[2] === "~") {
			// [~"k"~"v"] optional ,i
			const flags = m[5] === ",i" ? "i" : "";
			const kRe = new RegExp(unescapeRe(m[3] ?? ""), flags);
			const vRe = new RegExp(unescapeRe(m[4] ?? ""), flags);
			filters.push({
				key: "",
				value: vRe,
				negate: negPrefix,
				// key-regex handled specially in matchesFilters via key === ""
			});
			// Stash key regex on a synthetic marker — see matchesFilters.
			(filters[filters.length - 1] as TagFilter & { keyRe?: RegExp }).keyRe = kRe;
			continue;
		}
		const keyRaw = m[6] ?? "";
		const key = unquote(keyRaw);
		const op = m[7];
		const valRaw = m[8];
		const caseInsensitive = m[9] === ",i";
		if (op === undefined || op === "") {
			filters.push({ key, negate: negPrefix });
		} else if (op === "=" || op === "!=") {
			const value = unquote(valRaw ?? "");
			filters.push({ key, value, negate: negPrefix || op === "!=" });
		} else if (op === "~" || op === "!~") {
			const value = new RegExp(unquote(valRaw ?? ""), caseInsensitive ? "i" : "");
			filters.push({ key, value, negate: negPrefix || op === "!~" });
		} else {
			throw new OverpassParseError(`unsupported tag filter operator: ${op}`);
		}
	}
	return { filters, rest };
}

function unquote(s: string): string {
	if (s.startsWith('"') && s.endsWith('"')) {
		return s.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\");
	}
	return s;
}

function unescapeRe(s: string): string {
	return s.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function parseTypeList(token: string): ElementKind[] | null {
	switch (token) {
		case "node":
			return ["node"];
		case "way":
			return ["way"];
		case "rel":
		case "relation":
			return ["relation"];
		case "nwr":
		case "nw":
			return token === "nw" ? ["node", "way"] : ["node", "way", "relation"];
		default:
			return null;
	}
}

function parseBboxClause(
	raw: string,
	globalBbox: [number, number, number, number] | undefined,
): { bbox?: [number, number, number, number]; rest: string } {
	// (s,w,n,e) Overpass order → convert to l,b,r,t
	const m = /^\(\s*([^)]*)\s*\)/.exec(raw);
	if (m === null) return { rest: raw };
	const inner = (m[1] ?? "").trim();
	const rest = raw.slice(m[0].length);
	if (inner === "" || inner === "bbox") {
		if (globalBbox === undefined) {
			throw new OverpassParseError("bbox selector used but no global [bbox:…] setting");
		}
		const [s, w, n, e] = globalBbox;
		return { bbox: [w, s, e, n], rest };
	}
	const nums = inner.split(",").map((x) => Number(x.trim()));
	if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n))) {
		throw new OverpassParseError(`bad bbox selector: (${inner})`);
	}
	const [s, w, n, e] = nums as [number, number, number, number];
	return { bbox: [w, s, e, n], rest };
}

function parseSetAssign(raw: string): { outSet?: string; rest: string } {
	const m = /^->\s*\.([A-Za-z_][A-Za-z0-9_]*)/.exec(raw);
	if (m === null) return { rest: raw };
	return { outSet: m[1], rest: raw.slice(m[0].length) };
}

function parseStatements(
	src: string,
	globalBbox: [number, number, number, number] | undefined,
): Statement[] {
	const statements: Statement[] = [];
	let rest = src.trim();

	while (rest.length > 0) {
		rest = rest.replace(/^[\s;]+/, "");
		if (rest.length === 0) break;

		// Union block: ( stmt; stmt; );
		if (rest.startsWith("(")) {
			const close = findMatchingParen(rest);
			if (close < 0) throw new OverpassParseError("unclosed union");
			const inner = rest.slice(1, close).trim();
			rest = rest.slice(close + 1);
			const parts = parseStatements(inner, globalBbox).filter((s) => s.kind !== "out");
			const assign = parseSetAssign(rest);
			rest = assign.rest.replace(/^\s*;\s*/, "");
			statements.push({ kind: "union", parts, outSet: assign.outSet });
			continue;
		}

		// Recursion
		if (rest.startsWith(">;") || rest.startsWith("> ;")) {
			rest = rest.replace(/^>\s*;\s*/, "");
			statements.push({ kind: "recurse_down" });
			continue;
		}
		if (rest.startsWith("<;") || rest.startsWith("< ;")) {
			rest = rest.replace(/^<\s*;\s*/, "");
			statements.push({ kind: "recurse_up" });
			continue;
		}

		// .set out …;  OR  out … [.set];
		{
			const setOut =
				/^\.([A-Za-z_][A-Za-z0-9_]*)\s+out\s+(body|skel|ids|tags|meta|geom|center)?(?:\s+(qt))?\s*;/.exec(
					rest,
				) ?? /^\.([A-Za-z_][A-Za-z0-9_]*)\s+out\s*;/.exec(rest);
			if (setOut !== null) {
				rest = rest.slice(setOut[0].length);
				const fromSet = setOut[1];
				const mode = (setOut[2] as OutSpec["mode"] | undefined) ?? "body";
				const qt = setOut[3] === "qt";
				statements.push({
					kind: "out",
					spec: { mode, qt, ...(fromSet === undefined ? {} : { fromSet }) },
				});
				continue;
			}
		}
		if (/^out\b/.test(rest)) {
			const m =
				/^out\s+(body|skel|ids|tags|meta|geom|center)?(?:\s+(qt))?(?:\s+\.([A-Za-z_][A-Za-z0-9_]*))?\s*;/.exec(
					rest,
				) ?? /^out\s*;/.exec(rest);
			if (m === null) throw new OverpassParseError(`bad out statement near: ${rest.slice(0, 40)}`);
			rest = rest.slice(m[0].length);
			const mode = (m[1] as OutSpec["mode"] | undefined) ?? "body";
			const qt = m[2] === "qt";
			const fromSet = m[3];
			statements.push({
				kind: "out",
				spec: { mode, qt, ...(fromSet === undefined ? {} : { fromSet }) },
			});
			continue;
		}

		// Optional input set .foo (before a type selector)
		let inputSet: string | undefined;
		const setIn = /^\.([A-Za-z_][A-Za-z0-9_]*)\s*/.exec(rest);
		if (setIn !== null) {
			inputSet = setIn[1];
			rest = rest.slice(setIn[0].length);
		}

		const typeM = /^(node|way|rel|relation|nwr|nw)\b/.exec(rest);
		if (typeM === null) {
			throw new OverpassParseError(`unsupported statement near: ${rest.slice(0, 60)}`);
		}
		const types = parseTypeList(typeM[1] ?? "");
		if (types === null) throw new OverpassParseError(`bad type: ${typeM[1]}`);
		rest = rest.slice(typeM[0].length);

		// Filters and (bbox) may appear in either order (Turbo emits filters first).
		let bbox: [number, number, number, number] | undefined;
		const filters: TagFilter[] = [];
		while (true) {
			const before = rest;
			const bboxParsed = parseBboxClause(rest, globalBbox);
			if (bboxParsed.bbox !== undefined && bbox === undefined) {
				bbox = bboxParsed.bbox;
				rest = bboxParsed.rest;
			} else if (bboxParsed.rest !== rest && bboxParsed.bbox === undefined) {
				// bare () consumed nothing useful
			}
			const filt = parseTagFilters(rest);
			if (filt.filters.length > 0) {
				filters.push(...filt.filters);
				rest = filt.rest;
			}
			if (rest === before) break;
		}
		const assign = parseSetAssign(rest);
		rest = assign.rest;
		if (!rest.trimStart().startsWith(";")) {
			throw new OverpassParseError(`expected ';' after statement near: ${rest.slice(0, 40)}`);
		}
		rest = rest.replace(/^\s*;\s*/, "");
		// Global [bbox:…] applies when the statement has no explicit (bbox) and no input set.
		if (bbox === undefined && inputSet === undefined && globalBbox !== undefined) {
			const [s, w, n, e] = globalBbox;
			bbox = [w, s, e, n];
		}
		statements.push({
			kind: "select",
			types,
			...(bbox === undefined ? {} : { bbox }),
			filters,
			...(inputSet === undefined ? {} : { inputSet }),
			...(assign.outSet === undefined ? {} : { outSet: assign.outSet }),
		});
	}
	return statements;
}

function findMatchingParen(s: string): number {
	let depth = 0;
	for (let i = 0; i < s.length; i++) {
		const c = s[i];
		if (c === "(") depth += 1;
		else if (c === ")") {
			depth -= 1;
			if (depth === 0) return i;
		}
	}
	return -1;
}

function matchesFilters(
	tags: Record<string, string>,
	filters: Array<TagFilter & { keyRe?: RegExp }>,
): boolean {
	for (const f of filters) {
		let ok: boolean;
		if (f.keyRe !== undefined) {
			const entries = Object.entries(tags).filter(([k]) => f.keyRe?.test(k));
			if (f.value instanceof RegExp) {
				ok = entries.some(([, v]) => f.value instanceof RegExp && f.value.test(v));
			} else {
				ok = entries.length > 0;
			}
		} else if (f.value === undefined) {
			ok = Object.hasOwn(tags, f.key);
		} else if (typeof f.value === "string") {
			ok = tags[f.key] === f.value;
		} else {
			ok = f.value.test(tags[f.key] ?? "");
		}
		if (f.negate) ok = !ok;
		if (!ok) return false;
	}
	return true;
}

function selectFromDoc(
	doc: OsmDocument,
	stmt: Extract<Statement, { kind: "select" }>,
	sets: SetMap,
): OsmElementSet {
	let universe: OsmElementSet;
	if (stmt.inputSet !== undefined) {
		universe = sets.get(stmt.inputSet) ?? emptySet();
	} else if (stmt.bbox !== undefined) {
		const [l, b, r, t] = stmt.bbox;
		universe = elementsInBboxFromDoc(doc, l, b, r, t);
	} else {
		universe = {
			nodes: doc.nodes,
			ways: doc.ways,
			relations: doc.relations,
		};
	}

	const out = emptySet();
	if (stmt.types.includes("node")) {
		for (const n of universe.nodes) {
			if (matchesFilters(n.tags, stmt.filters)) out.nodes.push(n);
		}
	}
	if (stmt.types.includes("way")) {
		for (const w of universe.ways) {
			if (matchesFilters(w.tags, stmt.filters)) out.ways.push(w);
		}
	}
	if (stmt.types.includes("relation")) {
		for (const r of universe.relations) {
			if (matchesFilters(r.tags, stmt.filters)) out.relations.push(r);
		}
	}
	return out;
}

function recurseDown(doc: OsmDocument, current: OsmElementSet): OsmElementSet {
	const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
	const wayById = new Map(doc.ways.map((w) => [w.id, w]));
	const nodes = new Map(current.nodes.map((n) => [n.id, n]));
	const ways = new Map(current.ways.map((w) => [w.id, w]));
	const relations = new Map(current.relations.map((r) => [r.id, r]));

	for (const w of ways.values()) {
		for (const ref of w.refs) {
			const n = nodeById.get(ref);
			if (n !== undefined) nodes.set(n.id, n);
		}
	}
	for (const r of relations.values()) {
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
			}
		}
	}
	return {
		nodes: [...nodes.values()],
		ways: [...ways.values()],
		relations: [...relations.values()],
	};
}

function recurseUp(doc: OsmDocument, current: OsmElementSet): OsmElementSet {
	const nodeIds = new Set(current.nodes.map((n) => n.id));
	const wayIds = new Set(current.ways.map((w) => w.id));
	const ways = new Map(current.ways.map((w) => [w.id, w]));
	const relations = new Map(current.relations.map((r) => [r.id, r]));
	const nodes = new Map(current.nodes.map((n) => [n.id, n]));

	for (const w of doc.ways) {
		if (w.refs.some((ref) => nodeIds.has(ref))) ways.set(w.id, w);
	}
	for (const r of doc.relations) {
		if (
			r.members.some(
				(m) =>
					(m.type === "node" && nodeIds.has(m.ref)) ||
					(m.type === "way" && (wayIds.has(m.ref) || ways.has(m.ref))),
			)
		) {
			relations.set(r.id, r);
		}
	}
	return {
		nodes: [...nodes.values()],
		ways: [...ways.values()],
		relations: [...relations.values()],
	};
}

function runStatements(
	doc: OsmDocument,
	statements: Statement[],
): {
	defaultSet: OsmElementSet;
	outs: Array<{ set: OsmElementSet; spec: OutSpec }>;
} {
	const sets: SetMap = new Map();
	let defaultSet = emptySet();
	const outs: Array<{ set: OsmElementSet; spec: OutSpec }> = [];

	function store(set: OsmElementSet, outSet?: string): void {
		defaultSet = set;
		if (outSet !== undefined) sets.set(outSet, set);
	}

	function exec(stmt: Statement): void {
		if (stmt.kind === "select") {
			store(selectFromDoc(doc, stmt, sets), stmt.outSet);
			return;
		}
		if (stmt.kind === "union") {
			const parts: OsmElementSet[] = [];
			const saved = defaultSet;
			for (const p of stmt.parts) {
				exec(p);
				parts.push(defaultSet);
			}
			defaultSet = saved;
			store(mergeSets(parts), stmt.outSet);
			return;
		}
		if (stmt.kind === "recurse_down") {
			store(recurseDown(doc, defaultSet), stmt.outSet);
			return;
		}
		if (stmt.kind === "recurse_up") {
			store(recurseUp(doc, defaultSet), stmt.outSet);
			return;
		}
		if (stmt.kind === "out") {
			const set =
				stmt.spec.fromSet !== undefined ? (sets.get(stmt.spec.fromSet) ?? emptySet()) : defaultSet;
			outs.push({ set, spec: stmt.spec });
		}
	}

	for (const s of statements) exec(s);
	return { defaultSet, outs };
}

interface OutElement {
	type: string;
	id: string;
	lat?: number;
	lon?: number;
	timestamp?: string;
	version?: number;
	changeset?: number;
	user?: string;
	uid?: number;
	tags?: Record<string, string>;
	nodes?: string[];
	members?: Array<{ type: string; ref: string; role: string }>;
	geometry?: Array<{ lat: number; lon: number } | null>;
	center?: { lat: number; lon: number };
}

function elementCenter(doc: OsmDocument, way: OsmWay): { lat: number; lon: number } | undefined {
	const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
	let lat = 0;
	let lon = 0;
	let count = 0;
	for (const ref of way.refs) {
		const n = nodeById.get(ref);
		if (n === undefined) continue;
		lat += n.lat;
		lon += n.lon;
		count += 1;
	}
	if (count === 0) return undefined;
	return { lat: lat / count, lon: lon / count };
}

function projectOut(doc: OsmDocument, set: OsmElementSet, spec: OutSpec): OutElement[] {
	const nodeById = new Map(doc.nodes.map((n) => [n.id, n]));
	const els: OutElement[] = [];
	const withMeta = spec.mode === "body" || spec.mode === "meta" || spec.mode === "geom";
	const withTags =
		spec.mode === "body" ||
		spec.mode === "tags" ||
		spec.mode === "meta" ||
		spec.mode === "geom" ||
		spec.mode === "center";
	const idsOnly = spec.mode === "ids";

	function meta(el: {
		timestamp: string;
		version: number;
		changeset: number;
		user: string;
		uid: number;
	}) {
		if (!withMeta) return {};
		return {
			timestamp: el.timestamp,
			version: el.version,
			changeset: el.changeset,
			user: el.user,
			uid: el.uid,
		};
	}

	for (const n of set.nodes) {
		if (idsOnly) {
			els.push({ type: "node", id: n.id });
			continue;
		}
		const out: OutElement = {
			type: "node",
			id: n.id,
			lat: n.lat,
			lon: n.lon,
			...meta(n),
		};
		if (withTags && Object.keys(n.tags).length > 0) out.tags = { ...n.tags };
		els.push(out);
	}
	for (const w of set.ways) {
		if (idsOnly) {
			els.push({ type: "way", id: w.id });
			continue;
		}
		const out: OutElement = { type: "way", id: w.id, ...meta(w) };
		if (spec.mode !== "tags" && spec.mode !== "center") {
			out.nodes = [...w.refs];
		}
		if (withTags && Object.keys(w.tags).length > 0) out.tags = { ...w.tags };
		if (spec.mode === "geom") {
			out.geometry = w.refs.map((ref) => {
				const n = nodeById.get(ref);
				return n === undefined ? null : { lat: n.lat, lon: n.lon };
			});
		}
		if (spec.mode === "center" || spec.mode === "geom") {
			const c = elementCenter(doc, w);
			if (c !== undefined) out.center = c;
		}
		els.push(out);
	}
	for (const r of set.relations) {
		if (idsOnly) {
			els.push({ type: "relation", id: r.id });
			continue;
		}
		const out: OutElement = { type: "relation", id: r.id, ...meta(r) };
		if (spec.mode !== "tags" && spec.mode !== "center") {
			out.members = r.members.map((m) => ({ type: m.type, ref: m.ref, role: m.role }));
		}
		if (withTags && Object.keys(r.tags).length > 0) out.tags = { ...r.tags };
		els.push(out);
	}

	if (spec.qt) {
		els.sort((a, b) => {
			const la = a.lat ?? a.center?.lat ?? 0;
			const lo = a.lon ?? a.center?.lon ?? 0;
			const ra = b.lat ?? b.center?.lat ?? 0;
			const ro = b.lon ?? b.center?.lon ?? 0;
			return la - ra || lo - ro;
		});
	}
	return els;
}

export function parseOverpassQL(query: string): {
	settings: QuerySettings;
	statements: Statement[];
} {
	const stripped = stripComments(query);
	const { settings, rest } = parseSettings(stripped);
	const statements = parseStatements(rest, settings.bbox);
	if (statements.length === 0) throw new OverpassParseError("empty query");
	return { settings, statements };
}

export function executeOverpass(
	snap: WorldOsmSnapshot,
	query: string,
): { out: "json" | "xml"; body: string } {
	const { settings, statements } = parseOverpassQL(query);
	const { outs } = runStatements(snap.doc, statements);
	const effectiveOuts =
		outs.length > 0 ? outs : [{ set: emptySet(), spec: { mode: "body" as const, qt: false } }];

	const elements: OutElement[] = [];
	for (const o of effectiveOuts) {
		elements.push(...projectOut(snap.doc, o.set, o.spec));
	}

	// Dedupe by type+id keeping last (Overpass prints multiple outs sequentially).
	const seen = new Map<string, OutElement>();
	for (const el of elements) seen.set(`${el.type}/${el.id}`, el);
	const deduped = [...seen.values()];

	if (settings.out === "json") {
		const body = JSON.stringify({
			version: 0.6,
			generator: OVERPASS_GENERATOR,
			osm3s: {
				timestamp_osm_base: snap.doc.timestamp,
				copyright: OVERPASS_COPYRIGHT,
			},
			elements: deduped,
		});
		return { out: "json", body };
	}

	// XML path: rebuild a minimal OsmDocument from body-mode-ish elements.
	const nodeById = new Map(snap.doc.nodes.map((n) => [n.id, n]));
	const wayById = new Map(snap.doc.ways.map((w) => [w.id, w]));
	const relById = new Map(snap.doc.relations.map((r) => [r.id, r]));
	const nodes: OsmNode[] = [];
	const ways: OsmWay[] = [];
	const relations: OsmRelation[] = [];
	for (const el of deduped) {
		if (el.type === "node") {
			const n = nodeById.get(el.id);
			if (n) nodes.push(n);
		} else if (el.type === "way") {
			const w = wayById.get(el.id);
			if (w) ways.push(w);
		} else if (el.type === "relation") {
			const r = relById.get(el.id);
			if (r) relations.push(r);
		}
	}
	const xml = renderOsmXml({
		generator: OVERPASS_GENERATOR,
		tick: snap.doc.tick,
		timestamp: snap.doc.timestamp,
		nodes,
		ways,
		relations,
	});
	return { out: "xml", body: xml };
}

function remarkResponse(request: Request, message: string, asJson: boolean): Response {
	const cors = osmCorsHeaders(request);
	if (asJson) {
		return new Response(JSON.stringify({ remark: message }), {
			status: 400,
			headers: {
				...cors,
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
			},
		});
	}
	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="${OVERPASS_GENERATOR}">\n  <remark>${escapeXml(message)}</remark>\n</osm>\n`;
	return new Response(xml, {
		status: 400,
		headers: {
			...cors,
			"content-type": "application/xml; charset=utf-8",
			"cache-control": "no-store",
		},
	});
}

function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

export interface ServeOverpassOptions {
	cache: WorldOsmCache;
	slug: string;
	catalogHasSlug: boolean;
}

export async function serveOverpass(
	request: Request,
	options: ServeOverpassOptions,
): Promise<Response> {
	const cors = osmCorsHeaders(request);
	if (!options.catalogHasSlug) {
		return new Response("Not found.", {
			status: 404,
			headers: { ...cors, "cache-control": "no-store" },
		});
	}
	const method = request.method.toUpperCase();
	if (method === "OPTIONS") {
		return new Response(null, { status: 204, headers: { ...cors, "cache-control": "no-store" } });
	}
	if (method !== "GET" && method !== "POST") {
		return new Response("Method not allowed.", {
			status: 405,
			headers: { ...cors, allow: "GET, POST, OPTIONS", "cache-control": "no-store" },
		});
	}

	let data = "";
	if (method === "GET") {
		data = new URL(request.url).searchParams.get("data") ?? "";
	} else {
		const ct = request.headers.get("content-type") ?? "";
		const raw = await request.text();
		if (ct.includes("application/x-www-form-urlencoded")) {
			data = new URLSearchParams(raw).get("data") ?? raw;
		} else {
			data = raw;
		}
	}
	if (data.trim() === "") {
		return remarkResponse(request, "No query (data=) supplied.", true);
	}

	try {
		await options.cache.ensure(options.slug);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return remarkResponse(request, `World snapshot unavailable: ${message}`, true);
	}
	const snap = options.cache.get(options.slug);
	if (snap === undefined) {
		return remarkResponse(request, "World snapshot unavailable.", true);
	}

	try {
		const result = executeOverpass(snap, data);
		const contentType =
			result.out === "json"
				? "application/json; charset=utf-8"
				: "application/osm3s+xml; charset=utf-8";
		return new Response(result.body, {
			status: 200,
			headers: { ...cors, "content-type": contentType, "cache-control": "no-store" },
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const preferJson = /\[out:json\]/.test(data) || !/\[out:xml\]/.test(data);
		return remarkResponse(request, message, preferJson);
	}
}
