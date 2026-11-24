/**
 * OSM JSON writer — Overpass/`osm-json` shape that sk-adr8.13 will serve:
 * `{ version, generator, elements: [...] }`.
 *
 * Ids stay decimal strings (never coerced to number).
 */

import type { OsmDocument, OsmNode, OsmRelation, OsmWay } from "../model.ts";

export interface OsmJsonDocument {
	version: number;
	generator: string;
	/** World tick (Spellkave extension; consumers may ignore). */
	osm3s?: { timestamp_osm_base?: string };
	elements: OsmJsonElement[];
}

export type OsmJsonElement =
	| {
			type: "node";
			id: string;
			lat: number;
			lon: number;
			timestamp: string;
			version: number;
			changeset: number;
			user: string;
			uid: number;
			tags?: Record<string, string>;
	  }
	| {
			type: "way";
			id: string;
			timestamp: string;
			version: number;
			changeset: number;
			user: string;
			uid: number;
			nodes: string[];
			tags?: Record<string, string>;
	  }
	| {
			type: "relation";
			id: string;
			timestamp: string;
			version: number;
			changeset: number;
			user: string;
			uid: number;
			members: Array<{ type: string; ref: string; role: string }>;
			tags?: Record<string, string>;
	  };

function maybeTags(tags: Record<string, string>): Record<string, string> | undefined {
	const entries = Object.entries(tags).filter(([, v]) => v !== undefined && v !== "");
	if (entries.length === 0) return undefined;
	return Object.fromEntries(entries);
}

function nodeEl(n: OsmNode): OsmJsonElement {
	const el: OsmJsonElement = {
		type: "node",
		id: n.id,
		lat: n.lat,
		lon: n.lon,
		timestamp: n.timestamp,
		version: n.version,
		changeset: n.changeset,
		user: n.user,
		uid: n.uid,
	};
	const tags = maybeTags(n.tags);
	if (tags) (el as { tags?: Record<string, string> }).tags = tags;
	return el;
}

function wayEl(w: OsmWay): OsmJsonElement {
	const el: OsmJsonElement = {
		type: "way",
		id: w.id,
		timestamp: w.timestamp,
		version: w.version,
		changeset: w.changeset,
		user: w.user,
		uid: w.uid,
		nodes: [...w.refs],
	};
	const tags = maybeTags(w.tags);
	if (tags) (el as { tags?: Record<string, string> }).tags = tags;
	return el;
}

function relEl(r: OsmRelation): OsmJsonElement {
	const el: OsmJsonElement = {
		type: "relation",
		id: r.id,
		timestamp: r.timestamp,
		version: r.version,
		changeset: r.changeset,
		user: r.user,
		uid: r.uid,
		members: r.members.map((m) => ({ type: m.type, ref: m.ref, role: m.role })),
	};
	const tags = maybeTags(r.tags);
	if (tags) (el as { tags?: Record<string, string> }).tags = tags;
	return el;
}

export function renderOsmJson(doc: OsmDocument): OsmJsonDocument {
	const elements: OsmJsonElement[] = [
		...doc.nodes.map(nodeEl),
		...doc.ways.map(wayEl),
		...doc.relations.map(relEl),
	];
	return {
		version: 0.6,
		generator: doc.generator,
		osm3s: { timestamp_osm_base: doc.timestamp },
		elements,
	};
}

/** JSON string with ids left as strings (no number coercion). */
export function renderOsmJsonString(doc: OsmDocument, pretty = true): string {
	return JSON.stringify(renderOsmJson(doc), null, pretty ? 2 : undefined) + (pretty ? "\n" : "");
}
