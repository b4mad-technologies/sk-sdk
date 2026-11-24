/**
 * OSM XML 0.6 writer (read-only export; no changeset upload).
 * ADR-0123 D-4: version/changeset/uid/user/timestamp + xmlns:spellkave.
 *
 * Element order is nodes → ways → relations (JOSM/osmium convention).
 */

import type { OsmDocument, OsmMeta } from "../model.ts";

/** ADR-0123 D-4 namespace for spellkave:* root attributes. */
export const SPELLKAVE_OSM_NS = "https://spellkave.com/osm";

export function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function metaAttrs(el: OsmMeta): string {
	return [
		`id="${el.id}"`,
		`version="${el.version}"`,
		`changeset="${el.changeset}"`,
		`uid="${el.uid}"`,
		`user="${escapeXml(el.user)}"`,
		`visible="${el.visible}"`,
		`timestamp="${escapeXml(el.timestamp)}"`,
	].join(" ");
}

function tagsXml(tags: Record<string, string>, indent: string): string {
	return Object.entries(tags)
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(([k, v]) => `${indent}<tag k="${escapeXml(k)}" v="${escapeXml(v)}"/>`)
		.join("\n");
}

export function renderOsmXml(doc: OsmDocument): string {
	const lines: string[] = [];
	lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
	// Declare the spellkave prefix so browser DOMParser accepts the root attr
	// (ADR-0123 D-4: spellkave:tick on <osm>).
	lines.push(
		`<osm version="0.6" generator="${escapeXml(doc.generator)}" ` +
			`xmlns:spellkave="${SPELLKAVE_OSM_NS}" ` +
			`spellkave:tick="${doc.tick}" timestamp="${escapeXml(doc.timestamp)}">`,
	);

	for (const n of doc.nodes) {
		const tagBlock = tagsXml(n.tags, "    ");
		const head = `  <node ${metaAttrs(n)} lat="${n.lat.toFixed(9)}" lon="${n.lon.toFixed(9)}"`;
		if (tagBlock) {
			lines.push(`${head}>`);
			lines.push(tagBlock);
			lines.push(`  </node>`);
		} else {
			lines.push(`${head}/>`);
		}
	}

	for (const w of doc.ways) {
		lines.push(`  <way ${metaAttrs(w)}>`);
		for (const ref of w.refs) {
			lines.push(`    <nd ref="${ref}"/>`);
		}
		const tagBlock = tagsXml(w.tags, "    ");
		if (tagBlock) lines.push(tagBlock);
		lines.push(`  </way>`);
	}

	for (const r of doc.relations) {
		lines.push(`  <relation ${metaAttrs(r)}>`);
		for (const m of r.members) {
			lines.push(`    <member type="${m.type}" ref="${m.ref}" role="${escapeXml(m.role)}"/>`);
		}
		const tagBlock = tagsXml(r.tags, "    ");
		if (tagBlock) lines.push(tagBlock);
		lines.push(`  </relation>`);
	}

	lines.push(`</osm>`);
	lines.push("");
	return lines.join("\n");
}
