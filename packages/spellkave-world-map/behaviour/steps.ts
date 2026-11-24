// The sentences of behaviour/*.feature, against the real world-map CLI run in
// a throwaway directory per scenario. Nothing under src/ is imported: every
// Then reads what the tool printed or the files it wrote. Ids are re-derived
// here from ADR-0123 D-3 (FNV-1a 64, sign bit dropped) and cells with h3-js,
// so a check never trusts the code it checks.

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { argvOf, cliRunner, type Run } from "@spellkave/behaviour/cli";
import { Given, type NarratedWorld, Then, When } from "@spellkave/behaviour/narrate";
import { contractSteps } from "@spellkave/behaviour/steps";
import { gridDisk, latLngToCell } from "h3-js";
import { After, type DataTable } from "quickpickle";
import { expect } from "vitest";

import { BUNDLE, LAUNCHERS, PKG, REPO, TSX_BIN } from "./support/paths.ts";

type Tags = Record<string, string>;
type OsmElement =
	| { type: "node"; id: string; lat: number; lon: number; tags?: Tags }
	| { type: "way"; id: string; nodes: string[]; tags?: Tags }
	| {
			type: "relation";
			id: string;
			members: { type: string; ref: string; role: string }[];
			tags?: Tags;
	  };
type OsmJson = {
	version: number;
	generator: string;
	osm3s?: { timestamp_osm_base?: string };
	elements: OsmElement[];
};
type Summary = {
	ok: boolean;
	counts: Record<string, number>;
	unplaced_graphs: string[];
	diagnostics: string[];
};
type World = NarratedWorld & { dir?: string; run?: Run };

function dir(world: World): string {
	world.dir ??= mkdtempSync(join(tmpdir(), "world-map-behaviour-"));
	return world.dir;
}
function ran(world: World): Run {
	if (!world.run) throw new Error("no world-map run yet: this step needs a preceding When");
	return world.run;
}
function summary(world: World): Summary {
	return JSON.parse(ran(world).stdout) as Summary;
}
const read = (world: World, file: string) => readFileSync(join(dir(world), file), "utf8");
const osm = (world: World, file: string) => JSON.parse(read(world, file)) as OsmJson;
const tagsOf = (el: OsmElement): Tags => el.tags ?? {};
const nodes = (doc: OsmJson) => doc.elements.filter((e) => e.type === "node");
const ways = (doc: OsmJson) => doc.elements.filter((e) => e.type === "way");
const relations = (doc: OsmJson) => doc.elements.filter((e) => e.type === "relation");

function placeNode(doc: OsmJson, nodeId: string) {
	const node = nodes(doc).find((n) => tagsOf(n)["spellkave:node_id"] === nodeId);
	if (!node) throw new Error(`no node with spellkave:node_id ${nodeId}`);
	return node;
}

// ADR-0123 D-3, written out again on purpose: FNV-1a 64 over the UTF-8 key,
// sign bit dropped, 0 remapped to 1.
function osmId(key: string): string {
	let hash = 0xcbf29ce484222325n;
	for (const byte of new TextEncoder().encode(key)) {
		hash ^= BigInt(byte);
		hash = (hash * 0x100000001b3n) & 0xffff_ffff_ffff_ffffn;
	}
	const id = hash & 0x7fff_ffff_ffff_ffffn;
	return (id === 0n ? 1n : id).toString(10);
}

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
	const toR = (d: number) => (d * Math.PI) / 180;
	const h =
		Math.sin(toR(b.lat - a.lat) / 2) ** 2 +
		Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(toR(b.lon - a.lon) / 2) ** 2;
	return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}
const cellHex = (decimal: string) => BigInt(decimal).toString(16);

function cleanEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (value === undefined || key.startsWith("GIT_") || key.startsWith("SPELLKAVE_")) continue;
		env[key] = value;
	}
	return { ...env, PATH: `${TSX_BIN}:${env.PATH ?? ""}` };
}

function tool(world: World, bin: string, node: boolean, name = "world-map") {
	return cliRunner({
		name,
		bin,
		node,
		cwd: dir(world),
		baseEnv: cleanEnv(),
		redactions: [
			[dir(world), "<scenario>"],
			[REPO, "<checkout>"],
		],
	});
}

After(async (world: World) => {
	if (world.dir) rmSync(world.dir, { recursive: true, force: true });
});

// ---- Given: what the tool reads --------------------------------------------



Given("the rows file {string}:", (world: World, name: string, doc: unknown) => {
	writeFileSync(join(dir(world), name), String(doc));
});

// ---- When: the user's action -----------------------------------------------

async function act(world: World, command: string, bin: string, node: boolean) {
	const cli = tool(world, bin, node);
	world.run = await cli.runAsync(argvOf(command, "world-map"));
	await cli.attach(world.run);
}

When("I run {string}", async (world: World, command: string) => {
	await act(world, command, BUNDLE, true);
});

When("I run {string} through the front door", async (world: World, command: string) => {
	const [launcher, ...rest] = command.split(/\s+/);
	const bin = LAUNCHERS[launcher as keyof typeof LAUNCHERS];
	if (!bin) throw new Error(`no launcher ${launcher} in ${PKG}/bin`);
	const cli = tool(world, bin, false, launcher);
	world.run = await cli.runAsync(rest);
	await cli.attach(world.run);
});

// ---- Then: how it answers --------------------------------------------------

contractSteps<World>({ tool: "world-map", lastRun: ran });

Then("stdout is empty and stderr says {string}", (world: World, text: string) => {
	expect(ran(world).stdout).toBe("");
	expect(ran(world).stderr).toContain(text);
});

const usageOnStderr = (world: World) => ran(world).stderr.includes("Usage:\n  world-map export");
Then("stderr shows the usage", (world: World) => {
	expect(usageOnStderr(world), ran(world).stderr).toBe(true);
});
Then("stderr does not show the usage", (world: World) => {
	expect(usageOnStderr(world), ran(world).stderr).toBe(false);
});

Then("stdout shows the usage once", (world: World) => {
	expect(ran(world).stdout.split("Usage:")).toHaveLength(2);
});

Then("no file {string} was written", (world: World, file: string) => {
	expect(existsSync(join(dir(world), file))).toBe(false);
});

Then(
	"stdout is one JSON summary counting {int} nodes, {int} ways, {int} relations and {int} backdrops",
	(world: World, n: number, w: number, r: number, b: number) => {
		const s = summary(world);
		expect(s.ok).toBe(true);
		expect(s.counts).toMatchObject({ nodes: n, ways: w, relations: r, backdrops: b });
	},
);

Then("the summary lists the unplaced graphs {string}", (world: World, list: string) => {
	expect(summary(world).unplaced_graphs).toEqual(list.split(/,\s*/));
});

Then("the summary's diagnostics mention {string}", (world: World, text: string) => {
	expect(summary(world).diagnostics.some((d) => d.includes(text))).toBe(true);
});

Then(
	"{string} has the summary's counts, unplaced graphs and diagnostics",
	(world: World, file: string) => {
		const manifest = JSON.parse(read(world, file)) as {
			counts: Record<string, number>;
			unplaced_graphs: { place_graph_id: string }[];
			diagnostics: string[];
		};
		const s = summary(world);
		expect(manifest.counts).toEqual(s.counts);
		expect(manifest.unplaced_graphs.map((u) => u.place_graph_id)).toEqual(s.unplaced_graphs);
		expect(manifest.diagnostics).toEqual(s.diagnostics);
	},
);

Then(
	"{string} says each unplaced graph is {string}",
	(world: World, file: string, reason: string) => {
		const manifest = JSON.parse(read(world, file)) as { unplaced_graphs: { reason: string }[] };
		expect(manifest.unplaced_graphs.length).toBeGreaterThan(0);
		for (const u of manifest.unplaced_graphs) expect(u.reason).toBe(reason);
	},
);

Then(
	"{string} is OSM XML 0.6 from {string} at tick {int} and {string}",
	(world: World, file: string, generator: string, tick: number, timestamp: string) => {
		const xml = read(world, file);
		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
		const root = xml.split("\n")[1] ?? "";
		expect(root).toContain('<osm version="0.6"');
		expect(root).toContain(`generator="${generator}"`);
		expect(root).toContain('xmlns:spellkave="https://spellkave.com/osm"');
		expect(root).toContain(`spellkave:tick="${tick}"`);
		expect(root).toContain(`timestamp="${timestamp}"`);
		expect(xml.trimEnd().endsWith("</osm>")).toBe(true);
		const count = (re: RegExp) => (xml.match(re) ?? []).length;
		expect(count(/<node[\s>]/g)).toBe(count(/<\/node>/g) + count(/<node\b[^>]*\/>/g));
		expect(count(/<way[\s>]/g)).toBe(count(/<\/way>/g));
		expect(count(/<relation[\s>]/g)).toBe(count(/<\/relation>/g));
		// Every element carries the read-only upload meta an OSM editor expects (D-4).
		const elements = count(/<(node|way|relation) id=/g);
		expect(elements).toBeGreaterThan(0);
		expect(count(/ version="1" changeset="1" uid="1" user="spellkave" /g)).toBe(elements);
		expect(xml).not.toContain("repeat_on");
	},
);

Then("{string} is OSM JSON 0.6 whose ids are decimal strings", (world: World, file: string) => {
	const doc = osm(world, file);
	expect(doc.version).toBe(0.6);
	expect(doc.elements.length).toBeGreaterThan(0);
	for (const el of doc.elements) {
		expect(el.id).toMatch(/^\d+$/);
		if (el.type === "way") for (const ref of el.nodes) expect(ref).toMatch(/^\d+$/);
	}
});

Then(
	"{string} lists {int} backdrops, each with four corners and no description",
	(world: World, file: string, n: number) => {
		const backdrops = JSON.parse(read(world, file)) as Record<string, unknown>[];
		expect(backdrops).toHaveLength(n);
		for (const b of backdrops) {
			expect(b).not.toHaveProperty("description");
			expect(b.coordinates).toHaveLength(4);
		}
	},
);

Then("{string} and {string} are byte-identical", (world: World, a: string, b: string) => {
	expect(read(world, a)).toBe(read(world, b));
});

Then(
	"in {string} every node id is the hash of its spellkave:node_id and every relation id the hash of its spellkave:graph_id",
	(world: World, file: string) => {
		const doc = osm(world, file);
		let checked = 0;
		for (const n of nodes(doc)) {
			// Extent-corner nodes have synthetic keys and no spellkave:node_id tag.
			const key = tagsOf(n)["spellkave:node_id"];
			if (key) {
				expect(n.id).toBe(osmId(key));
				checked++;
			}
		}
		expect(checked).toBeGreaterThan(0);
		for (const r of relations(doc)) {
			const key = tagsOf(r)["spellkave:graph_id"];
			expect(key).toBeTruthy();
			expect(r.id).toBe(osmId(key as string));
		}
	},
);

Then(
	"in {string} every id is a positive 63-bit integer, unique within its element type",
	(world: World, file: string) => {
		const doc = osm(world, file);
		for (const kind of [nodes(doc), ways(doc), relations(doc)]) {
			const ids = kind.map((e) => BigInt(e.id));
			for (const id of ids) {
				expect(id > 0n).toBe(true);
				expect(id <= 0x7fff_ffff_ffff_ffffn).toBe(true);
			}
			expect(new Set(ids).size).toBe(ids.length);
		}
	},
);

Then(
	"in {string} every node of {string} lies within {int} rings of H3 cell {string}",
	(world: World, file: string, graph: string, rings: number, cell: string) => {
		const allowed = new Set(gridDisk(cellHex(cell), rings));
		const inGraph = nodes(osm(world, file)).filter((n) => tagsOf(n)["spellkave:graph"] === graph);
		expect(inGraph.length).toBeGreaterThan(0);
		for (const n of inGraph) expect(allowed.has(latLngToCell(n.lat, n.lon, 10))).toBe(true);
	},
);

Then(
	"in {string} {string} is less than {float} m from {string}",
	(world: World, file: string, a: string, metres: number, b: string) => {
		const doc = osm(world, file);
		expect(haversineM(placeNode(doc, a), placeNode(doc, b))).toBeLessThan(metres);
	},
);

Then(
	"in {string} the node {string} lies in H3 cell {string}",
	(world: World, file: string, nodeId: string, cell: string) => {
		const n = placeNode(osm(world, file), nodeId);
		expect(BigInt(`0x${latLngToCell(n.lat, n.lon, 10)}`).toString(10)).toBe(cell);
	},
);

Then(
	"in {string} the relation of {string} is a named building from level {int} to {int}",
	(world: World, file: string, graph: string, min: number, max: number) => {
		const rel = relations(osm(world, file)).find((r) => tagsOf(r)["spellkave:graph_id"] === graph);
		expect(rel).toBeDefined();
		const tags = tagsOf(rel!);
		expect(tags).toMatchObject({
			type: "building",
			building: "yes",
			min_level: String(min),
			max_level: String(max),
		});
		expect(tags.name).toBeTruthy();
		expect(tags["building:levels"]).toBeTruthy();
	},
);

Then(
	"in {string} these nodes are on these levels:",
	(world: World, file: string, table: DataTable) => {
		const doc = osm(world, file);
		for (const row of table.hashes()) {
			expect(tagsOf(placeNode(doc, row.node!))).toMatchObject({
				"spellkave:elevation_m": row.elevation_m,
				level: row.level,
			});
		}
	},
);

Then(
	"in {string} every room way of {string} is on a whole level",
	(world: World, file: string, graph: string) => {
		const rooms = ways(osm(world, file)).filter(
			(w) => tagsOf(w).indoor === "room" && tagsOf(w)["spellkave:node_id"]?.startsWith(`${graph}/`),
		);
		expect(rooms.length).toBeGreaterThan(0);
		for (const w of rooms) expect(tagsOf(w).level).toMatch(/^-?\d+$/);
	},
);

Then("in {string} a stair way joins two levels with an incline", (world: World, file: string) => {
	const stairs = ways(osm(world, file)).filter((w) => tagsOf(w).highway === "steps");
	const between = stairs.find((w) => (tagsOf(w).level ?? "").includes(";"));
	expect(between, "a highway=steps way with level=<from>;<to>").toBeDefined();
	expect(tagsOf(between!).level).toMatch(/^-?\d+;-?\d+$/);
	expect(["up", "down"]).toContain(tagsOf(between!).incline);
});

Then(
	"in {string} no outdoor node and no outdoor extent carries an indoor or level tag",
	(world: World, file: string) => {
		const doc = osm(world, file);
		const outdoor = [
			...nodes(doc).filter((n) => tagsOf(n)["spellkave:substrate"] === "outdoor"),
			...ways(doc).filter((w) => tagsOf(w)["spellkave:extent"] === "yes"),
		];
		expect(outdoor.length).toBeGreaterThan(0);
		for (const el of outdoor) {
			expect(tagsOf(el).indoor).toBeUndefined();
			expect(tagsOf(el).level).toBeUndefined();
		}
	},
);

Then(
	"in {string} a door way tagged as a portal is a {string} member of at least {int} relations",
	(world: World, file: string, role: string, n: number) => {
		const doc = osm(world, file);
		const door = ways(doc).find(
			(w) => tagsOf(w)["spellkave:portal"] === "yes" && tagsOf(w).door === "yes",
		);
		expect(door, "a way with spellkave:portal=yes and door=yes").toBeDefined();
		const memberOf = relations(doc).filter((r) =>
			r.members.some((m) => m.type === "way" && m.ref === door!.id && m.role === role),
		);
		expect(memberOf.length).toBeGreaterThanOrEqual(n);
	},
);

Then(
	"in {string} a {string} extent is a closed way of {int} refs",
	(world: World, file: string, shape: string, refs: number) => {
		const closed = ways(osm(world, file)).filter(
			(w) =>
				tagsOf(w)["spellkave:extent_shape"] === shape &&
				w.nodes.length === refs &&
				w.nodes[0] === w.nodes[refs - 1],
		);
		expect(closed.length).toBeGreaterThan(0);
	},
);

Then(
	"in {string} no node belongs to {string} or {string}",
	(world: World, file: string, a: string, b: string) => {
		for (const n of nodes(osm(world, file))) {
			expect([a, b]).not.toContain(tagsOf(n)["spellkave:graph"]);
		}
	},
);

Then(
	"in {string} the node {string} has the tags:",
	(world: World, file: string, nodeId: string, table: DataTable) => {
		expect(tagsOf(placeNode(osm(world, file), nodeId))).toMatchObject(
			Object.fromEntries(table.raw()),
		);
	},
);

Then(
	"in {string} the way {string} has the tags:",
	(world: World, file: string, edgeKey: string, table: DataTable) => {
		const way = ways(osm(world, file)).find((w) => tagsOf(w)["spellkave:edge_key"] === edgeKey);
		expect(way, `a way with spellkave:edge_key ${edgeKey}`).toBeDefined();
		expect(tagsOf(way!)).toMatchObject(Object.fromEntries(table.raw()));
	},
);

Then(
	"in {string} the node {string} and its extent both have {string}",
	(world: World, file: string, nodeId: string, pairs: string) => {
		const doc = osm(world, file);
		const want = Object.fromEntries(
			pairs.split(/\s+/).map((p) => p.split("=") as [string, string]),
		);
		expect(tagsOf(placeNode(doc, nodeId))).toMatchObject(want);
		const outline = ways(doc).find((w) => tagsOf(w)["spellkave:node_id"] === nodeId);
		expect(outline, `an extent way of ${nodeId}`).toBeDefined();
		expect(tagsOf(outline!)).toMatchObject(want);
	},
);
