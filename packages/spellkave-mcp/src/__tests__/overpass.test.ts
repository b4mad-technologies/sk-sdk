// A map client queries the world in Overpass QL and gets the same elements a real
// Overpass server would return. If the parser rejects a real query shape or returns
// different results, map tools break. Runs the parser and executor over the demo
// fixture, no setup.

// keep-file(K1): Overpass QL parser table and golden

import { describe, expect, it } from "vitest";

import { createStaticWorldOsmCache } from "../osm-model.ts";
import { executeOverpass, parseOverpassQL } from "../overpass.ts";
import { sampleOsmSnapshot } from "./osm-fixture.ts";

/** Real-world Overpass Turbo / wizard-shaped queries (≥15). */
const PARSER_QUERIES: Array<{ name: string; q: string }> = [
	{
		name: "turbo wizard pub",
		q: `[out:json][timeout:25];
(
  node["amenity"="pub"](47.49,-122.31,47.51,-122.29);
  way["amenity"="pub"](47.49,-122.31,47.51,-122.29);
  relation["amenity"="pub"](47.49,-122.31,47.51,-122.29);
);
out body;
>;
out skel qt;`,
	},
	{
		name: "nwr highway path",
		q: `[out:json][timeout:25];
nwr["highway"="path"](47.49,-122.31,47.51,-122.29);
out geom;`,
	},
	{
		name: "global bbox setting",
		q: `[out:json][bbox:47.49,-122.31,47.51,-122.29];
node[name];
out body;`,
	},
	{
		name: "key presence indoor",
		q: `[out:json];
way["indoor"](47.49,-122.31,47.51,-122.29);
out tags;`,
	},
	{
		name: "regex name",
		q: `[out:json];
node[name~"Inn"](47.49,-122.31,47.51,-122.29);
out body;`,
	},
	{
		name: "regex name case-insensitive ,i",
		q: `[out:json][timeout:25];
nwr["name"~"inn",i](47.49,-122.31,47.51,-122.29);
out center;`,
	},
	{
		name: "negated tag",
		q: `[out:json];
way["highway"!="steps"](47.49,-122.31,47.51,-122.29);
out skel;`,
	},
	{
		name: "union with sets",
		q: `[out:json];
(
  node["spellkave:anchor"="yes"](47.49,-122.31,47.51,-122.29);
  way["highway"="corridor"](47.49,-122.31,47.51,-122.29);
)->.a;
.a out body;`,
	},
	{
		name: "out center",
		q: `[out:json];
way["highway"](47.49,-122.31,47.51,-122.29);
out center;`,
	},
	{
		name: "out ids",
		q: `[out:json];
relation(47.49,-122.31,47.51,-122.29);
out ids;`,
	},
	{
		name: "out meta",
		q: `[out:json];
node(47.498,-122.303,47.501,-122.296);
out meta;`,
	},
	{
		name: "recurse down after ways",
		q: `[out:json];
way["highway"="path"](47.49,-122.31,47.51,-122.29);
out body;
>;
out skel qt;`,
	},
	{
		name: "recurse up from nodes",
		q: `[out:json];
node["entrance"="yes"](47.49,-122.31,47.51,-122.29);
<;
out body;`,
	},
	{
		name: "xml out",
		q: `[out:xml][timeout:10];
node["name"="Crossroads"](47.49,-122.31,47.51,-122.29);
out;`,
	},
	{
		name: "rel alias",
		q: `[out:json];
rel["type"="building"](47.49,-122.31,47.51,-122.29);
out body;`,
	},
	{
		name: "nw shorthand",
		q: `[out:json];
nw["spellkave:portal"="yes"](47.49,-122.31,47.51,-122.29);
out body;`,
	},
	{
		name: "key-only filter on node",
		q: `[out:json];
node["spellkave:cell_res10"](47.49,-122.31,47.51,-122.29);
out tags qt;`,
	},
	{
		name: "building yes",
		q: `[out:json];
relation["building"="yes"](47.49,-122.31,47.51,-122.29);
out body;
>;
out skel;`,
	},
];

describe("Overpass QL parser table", () => {
	for (const { name, q } of PARSER_QUERIES) {
		it(`parses: ${name}`, () => {
			const parsed = parseOverpassQL(q);
			expect(parsed.statements.length).toBeGreaterThan(0);
		});
	}

	it("rejects unsupported statements with remark-shaped error", () => {
		expect(() => parseOverpassQL("[out:json];make x=1;")).toThrow(/unsupported/);
	});
});

describe("Overpass golden on demo", () => {
	it("returns named Crossroads node and highway ways", () => {
		const snap = sampleOsmSnapshot();
		const cross = executeOverpass(
			snap,
			`[out:json];
node["name"="Crossroads"](47.49,-122.31,47.51,-122.29);
out body;`,
		);
		expect(cross.out).toBe("json");
		const body = JSON.parse(cross.body) as {
			generator: string;
			osm3s: { timestamp_osm_base: string; copyright: string };
			elements: Array<{ type: string; tags?: Record<string, string> }>;
		};
		expect(body.generator).toContain("Spellkave");
		expect(body.osm3s.copyright).toBeTruthy();
		expect(body.elements.some((e) => e.tags?.name === "Crossroads")).toBe(true);

		const paths = executeOverpass(
			snap,
			`[out:json][timeout:25];
way["highway"](47.49,-122.31,47.51,-122.29);
out geom;`,
		);
		const pathBody = JSON.parse(paths.body) as {
			elements: Array<{ type: string; geometry?: unknown; tags?: Record<string, string> }>;
		};
		expect(pathBody.elements.some((e) => e.type === "way" && e.geometry)).toBe(true);

		const cache = createStaticWorldOsmCache({ "demo": snap });
		expect(cache.get("demo")?.doc.nodes.length).toBe(2);
	});
});
