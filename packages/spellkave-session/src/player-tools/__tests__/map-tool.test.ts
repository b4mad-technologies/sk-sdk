import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { snapshotDbFromFixture } from "@spellkave/sdk";
import { nodeToolCapability } from "@spellkave/tool-node";
import { createMapTool as createPortableMapTool } from "@spellkave/tool-player";
import type { NodeMapPort } from "@spellkave/tool-runtime";
import { describe, expect, it, vi } from "vitest";
import { createMapTool } from "../tools";

// Smallest valid 1x1 transparent PNG (well-known minimal fixture bytes) —
// stands in for a real ccc3-maps/elven-tower asset without depending on a
// sibling package's committed art.
const TINY_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

/**
 * JPEG mode shells out to ffmpeg (spatial-graph/jpeg-write.ts) — absent on
 * this repo's CI runners (sk-dms.42, the SAME finding
 * `packages/spellkave-srd-cc/src/author/elven-mini/generate.ts`'s own
 * `SRD_CC_AUTHOR_CHECK_TEXT_ONLY` env-var skip documents). Companion-agent's
 * `test` script (unlike the live-preseeded adventure suite) runs UNGATED in
 * CI (`.github/workflows/js-packages.yml`), so these tests skip themselves
 * on a runner without ffmpeg rather than failing with ENOENT — the plumbing
 * they prove (output_dir/output_name, churn guard, path returned) is
 * exercised for real on any machine that does have it, including this one.
 */
function hasFfmpeg(): boolean {
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
}
const FFMPEG_AVAILABLE = hasFfmpeg();

// Fog-of-war fixture (sk-adr8.7): the module's `visible_place_*` views already
// admit only what this caller may see — `town/inn` + `town/road` and the edge
// between them. An unseen `town/dungeon` (and any edge into it) never appears
// in the view rows at all; the client no longer filters against
// `visible_observer_place_knowledge`.
function fogOfWarDb() {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		world_time: [{ tick: 5n }],
		visible_place_graph_definition: [
			{ placeGraphId: "town", description: "A small town.", scale: 1 },
		],
		visible_place_node: [
			{
				nodeId: "town/inn",
				placeGraphId: "town",
				localId: "inn",
				displayName: "Inn",
				substrateId: "outdoor",
				posX: 0,
				posY: 0,
				posPresent: true,
			},
			{
				nodeId: "town/road",
				placeGraphId: "town",
				localId: "road",
				displayName: "Road",
				substrateId: "outdoor",
				posX: 1,
				posY: 0,
				posPresent: true,
			},
		],
		visible_place_edge: [
			{ edgeId: 1n, placeGraphId: "town", fromNodeId: "town/inn", toNodeId: "town/road" },
		],
	});
}

describe("spellkave_map (fog-of-war)", () => {
	it("draws only the actor's known nodes and known-to-known edges", async () => {
		const context = { db: fogOfWarDb(), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("t1", { graph: "town" });
		const details = result.details as {
			places: number;
			routes: number;
			known_nodes: number;
			has_layout: boolean;
			inventory: string;
		};
		expect(details.known_nodes).toBe(2);
		expect(details.places).toBe(2);
		expect(details.routes).toBe(1);
		expect(details.has_layout).toBe(true);
		// The dungeon must not leak through the text inventory's EDGES section
		// either (the leak `renderSpatialGraphTextInventory`'s flat edge list
		// would otherwise reopen — see mapToolDef's header note).
		expect(details.inventory).not.toContain("dungeon");
		expect(details.inventory).toContain("town/inn");
		expect(details.inventory).toContain("town/road");
	});

	it("returns an empty map when the module admitted no place rows", async () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 5n }],
			visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
			visible_place_node: [],
			visible_place_edge: [],
		});
		const context = { db, act: { actorId: "1" } };
		const result = await createMapTool(context).execute("t2", { graph: "town" });
		const details = result.details as { places: number; known_nodes: number; has_layout: boolean };
		expect(details.known_nodes).toBe(0);
		expect(details.places).toBe(0);
		expect(details.has_layout).toBe(false);
	});

	// sk-adr8.7: fog-of-war is module-side. A PLAYER connection's cache only
	// holds admitted `visible_place_*` rows — the map tool draws that cache
	// regardless of the actorId string shape (manifest-key or numeric). This
	// pins that a real host's manifest-key actorId still renders the admitted
	// topology (session-grid composition still needs actorId for roster/grid).
	it("draws the module-admitted topology for a manifest-key actorId", async () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 5n }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{
					manifestKey: "elven_mini:elven_mini/adventure/hero_1",
					bundleId: "elven_mini",
					entityId: 7n,
				},
			],
			visible_place_graph_definition: [
				{ placeGraphId: "town", description: "A small town.", scale: 1 },
			],
			visible_place_node: [
				{
					nodeId: "town/inn",
					placeGraphId: "town",
					localId: "inn",
					displayName: "Inn",
					substrateId: "outdoor",
					posX: 0,
					posY: 0,
					posPresent: true,
				},
				{
					nodeId: "town/road",
					placeGraphId: "town",
					localId: "road",
					displayName: "Road",
					substrateId: "outdoor",
					posX: 1,
					posY: 0,
					posPresent: true,
				},
			],
			visible_place_edge: [
				{ edgeId: 1n, placeGraphId: "town", fromNodeId: "town/inn", toNodeId: "town/road" },
			],
		});
		const context = { db, act: { actorId: "elven_mini/adventure/hero_1" } };
		const result = await createMapTool(context).execute("t4", { graph: "town" });
		const details = result.details as {
			known_nodes: number;
			places: number;
			routes: number;
			has_layout: boolean;
		};
		expect(details.known_nodes).toBe(2);
		expect(details.places).toBe(2);
		expect(details.routes).toBe(1);
		expect(details.has_layout).toBe(true);
	});

	// Module filtering is per-connection: a PLAYER cache never holds another
	// observer's nodes. Fixture the empty admitted set and pin no leak.
	it("must never leak 'dungeon' when the module did not admit it", async () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 5n }],
			// Empty admitted geometry for this caller — another observer's dungeon
			// is not on this connection's wire.
			visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
			visible_place_node: [],
			visible_place_edge: [],
		});
		const context = { db, act: { actorId: "1" } };
		const result = await createMapTool(context).execute("t3", { graph: "town" });
		const details = result.details as { known_nodes: number; places: number; inventory: string };
		expect(details.known_nodes).toBe(0);
		expect(details.places).toBe(0);
		expect(details.inventory).not.toContain("dungeon");
	});
});

// sk-pej D-2: an ephemeral session tactical grid composes over its parent
// location's own (fog-of-war-scoped) topology by default when graph= names
// it. Exercises the REAL tools.ts row-sourcing path (readPlaceTopology +
// module-admitted visible_place_* rows), not just the spatial-graph engine directly.
/** The crypt-plus-session-grid fixture TABLES, shared by the D-2 composition
 * tests and the D-3 auto-selection tests below (which layer `session` /
 * `session_participant` rows on top). Kept as a plain object rather than a
 * built db precisely so D-3 can spread it. */
function cryptGridFixture(knownExtra: string[] = []) {
	const gridCellIds = [0, 1, 2].flatMap((y) => [0, 1, 2].map((x) => `session_grid_9/c_${x}_${y}`));
	const known = ["dungeon/crypt/center", "dungeon/crypt/altar", ...gridCellIds, ...knownExtra];
	return {
		world_time: [{ tick: 5n }],
		visible_observer_place_knowledge: known.map((knownNodeId, i) => ({
			knowledgeId: BigInt(i + 1),
			observerEntityId: 1n,
			knownNodeId,
			learnedAtTick: 1n,
		})),
		visible_place_graph_definition: [
			{
				placeGraphId: "dungeon/crypt",
				displayName: "Crypt",
				substrateId: "indoor",
				scale: 5,
				anchorNodeId: "dungeon/crypt/center",
			},
			{
				placeGraphId: "session_grid_9",
				displayName: "Session 9 tactical grid",
				substrateId: "tactical",
				scale: 5,
				bearing: 0,
				parentGraphId: "dungeon/crypt",
				anchorNodeId: "dungeon/crypt/center",
				isEphemeralInstance: true,
			},
		],
		visible_place_node: [
			{
				nodeId: "dungeon/crypt/center",
				placeGraphId: "dungeon/crypt",
				localId: "center",
				displayName: "Center",
				substrateId: "indoor",
				posX: 10,
				posY: 10,
				posPresent: true,
				poseElevation: -1,
				poseElevationPresent: true,
			},
			{
				nodeId: "dungeon/crypt/altar",
				placeGraphId: "dungeon/crypt",
				localId: "altar",
				displayName: "Altar",
				substrateId: "indoor",
				posX: 14,
				posY: 10,
				posPresent: true,
				poseElevation: -1,
				poseElevationPresent: true,
			},
			...[0, 1, 2].flatMap((y) =>
				[0, 1, 2].map((x) => ({
					nodeId: `session_grid_9/c_${x}_${y}`,
					placeGraphId: "session_grid_9",
					localId: `c_${x}_${y}`,
					displayName: `Cell ${x},${y}`,
					substrateId: "tactical",
					posX: x,
					posY: y,
					posPresent: true,
					poseElevation: 0,
					poseElevationPresent: true,
				})),
			),
		],
		visible_place_edge: [
			{
				edgeId: 1n,
				placeGraphId: "dungeon/crypt",
				fromNodeId: "dungeon/crypt/center",
				toNodeId: "dungeon/crypt/altar",
			},
		],
	};
}

// open: add an isolated live cellar-map scenario when a rig slot is available.
// These tool-boundary regressions inject already-admitted topology; they do not
// prove server view delivery. The raster port is injected to inspect its SVG.
describe("spellkave_map (session grid anchor floor, sk-jay0.1.76.15.8)", () => {
	function floorFixture(elevation = -3) {
		const fixture = cryptGridFixture();
		for (const node of fixture.visible_place_node) {
			if (node.placeGraphId === "dungeon/crypt") node.poseElevation = elevation;
		}
		const anchor = fixture.visible_place_node[0];
		if (anchor === undefined) throw new Error("Missing fixture anchor");
		fixture.visible_place_node.push({
			...anchor,
			nodeId: "dungeon/crypt/upper",
			localId: "upper",
			displayName: "Upper room",
			poseElevation: 0,
		});
		return {
			...fixture,
			session: [
				{ sessionId: 9n, sessionDefId: "srd/combat", lifecycle: "active", currentActor: "1" },
			],
			session_participant: [
				{ sessionId: 9n, actorId: "1", ordinal: 0 },
				{ sessionId: 9n, actorId: "2", ordinal: 1 },
			],
			visible_actor_spatial_location: [
				{ entityId: 1n, placeNodeId: "session_grid_9/c_0_0" },
				{ entityId: 2n, placeNodeId: "session_grid_9/c_1_0" },
			],
		};
	}

	const tokenCells = ["session_grid_9/c_0_0", "session_grid_9/c_1_0"];
	const context = (fixture = floorFixture()) => ({
		db: snapshotDbFromFixture(fixture),
		act: { actorId: "1" },
	});
	const detailsOf = (result: { details?: unknown }) =>
		result.details as { svg: string; session_tokens: { node_id: string }[] };

	it.each([
		{ elevation: -3, graph: undefined },
		{ elevation: -3, graph: "session_grid_9" },
		{ elevation: 3, graph: undefined },
		{ elevation: 3, graph: "session_grid_9" },
	])("keeps fighters on floor $elevation with graph=$graph and omitted z", async ({
		elevation,
		graph,
	}) => {
		const result = await createMapTool(context(floorFixture(elevation))).execute("floor", {
			output_type: "svg",
			...(graph === undefined ? {} : { graph }),
		});
		const details = detailsOf(result);
		expect(details.svg).toContain('data-node-id="session_grid_9/c_0_0"');
		expect(details.svg).toContain('data-node-id="dungeon/crypt/center"');
		expect(details.svg).not.toContain('data-node-id="dungeon/crypt/upper"');
		expect(details.session_tokens.map((token) => token.node_id)).toEqual(tokenCells);
	});

	it("honors an explicit z=0 instead of following the anchor", async () => {
		const details = detailsOf(await createMapTool(context()).execute("explicit-floor", { z: 0 }));
		expect(details.svg).toContain('data-node-id="dungeon/crypt/upper"');
		expect(details.svg).not.toContain('data-node-id="session_grid_9/c_0_0"');
		expect(details.session_tokens).toEqual([]);
	});

	it("keeps the bare grid's own zero elevation when parent composition is disabled", async () => {
		const details = detailsOf(
			await createMapTool(context()).execute("bare-grid", {
				compose_parent: false,
				slice: "elevation_band",
			}),
		);
		expect(details.svg).toContain('data-node-id="session_grid_9/c_0_0"');
		expect(details.svg).not.toContain('data-node-id="dungeon/crypt/center"');
		expect(details.session_tokens.map((token) => token.node_id)).toEqual(tokenCells);
	});

	it("preserves the default floor for an explicitly requested authored parent graph", async () => {
		const details = detailsOf(
			await createMapTool(context()).execute("parent", { graph: "dungeon/crypt" }),
		);
		expect(details.svg).toContain('data-node-id="dungeon/crypt/upper"');
		expect(details.svg).not.toContain('data-node-id="dungeon/crypt/center"');
		expect(details.session_tokens).toEqual([]);
	});

	it("keeps the grid's own floor when the anchor is not admitted", async () => {
		const fixture = floorFixture();
		fixture.visible_place_node = fixture.visible_place_node.filter(
			(node) => node.nodeId !== "dungeon/crypt/center",
		);
		const details = detailsOf(await createMapTool(context(fixture)).execute("missing-anchor", {}));
		expect(details.svg).toContain('data-node-id="session_grid_9/c_0_0"');
		expect(details.session_tokens.map((token) => token.node_id)).toEqual(tokenCells);
	});

	// keep(K2): injected raster persistence exposes the JPEG input without ffmpeg or filesystem output.
	it("uses the same anchor floor for JPEG input and session tokens", async () => {
		const writeJpeg = vi.fn<NodeMapPort["writeJpeg"]>(async () => ({ jpgPath: "map.jpg" }));
		const result = await createPortableMapTool(context(), {
			node: {
				...nodeToolCapability,
				map: {
					...nodeToolCapability.map,
					writeJpeg,
					attachSpatialGraphImage: async (result) => result,
				},
			},
		}).execute("floor-jpeg", { output_type: "jpg" });
		expect(writeJpeg).toHaveBeenCalledOnce();
		const svg = writeJpeg.mock.calls[0]?.[0].svg;
		expect(svg).toContain('data-node-id="session_grid_9/c_0_0"');
		expect(svg).not.toContain('data-node-id="dungeon/crypt/upper"');
		expect(detailsOf(result).session_tokens.map((token) => token.node_id)).toEqual(tokenCells);
	});
});

describe("spellkave_map (session-grid composition, sk-pej D-2)", () => {
	function cryptGridDb(knownExtra: string[] = []) {
		return snapshotDbFromFixture(cryptGridFixture(knownExtra));
	}

	it("draws the grid composed over the crypt's own known topology by default", async () => {
		const context = { db: cryptGridDb(), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("grid1", { graph: "session_grid_9" });
		const details = result.details as { places: number; routes: number; has_layout: boolean };
		// 2 crypt rooms; the 9 grid cells group under one GRID layer (sk-zz8).
		expect(details.places).toBe(2);
		expect(details.routes).toBe(1);
		expect(details.has_layout).toBe(true);
	});

	it("compose_parent: false is the escape hatch back to the grid alone", async () => {
		const context = { db: cryptGridDb(), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("grid2", {
			graph: "session_grid_9",
			compose_parent: false,
		});
		const details = result.details as { places: number; routes: number };
		expect(details.places).toBe(1);
		expect(details.routes).toBe(0);
	});

	it("an unresolvable parent (crypt's own nodes not yet perceived) degrades to the grid alone, not a crash", async () => {
		// Fog-of-war-realistic: the participant knows the grid (D-1) but never
		// separately explored the room, so the crypt's own nodes are unknown —
		// the anchor itself is absent from the composed candidate set.
		const gridCellIds = [0, 1, 2].flatMap((y) =>
			[0, 1, 2].map((x) => `session_grid_9/c_${x}_${y}`),
		);
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 5n }],
			visible_observer_place_knowledge: gridCellIds.map((knownNodeId, i) => ({
				knowledgeId: BigInt(i + 1),
				observerEntityId: 1n,
				knownNodeId,
				learnedAtTick: 1n,
			})),
			visible_place_graph_definition: [
				{ placeGraphId: "dungeon/crypt", substrateId: "indoor", scale: 5 },
				{
					placeGraphId: "session_grid_9",
					substrateId: "tactical",
					scale: 5,
					parentGraphId: "dungeon/crypt",
					anchorNodeId: "dungeon/crypt/center",
					isEphemeralInstance: true,
				},
			],
			visible_place_node: [0, 1, 2].flatMap((y) =>
				[0, 1, 2].map((x) => ({
					nodeId: `session_grid_9/c_${x}_${y}`,
					placeGraphId: "session_grid_9",
					localId: `c_${x}_${y}`,
					substrateId: "tactical",
					posX: x,
					posY: y,
					posPresent: true,
				})),
			),
			visible_place_edge: [],
		});
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("grid3", {
			graph: "session_grid_9",
		});
		const details = result.details as { places: number; has_layout: boolean };
		expect(details.has_layout).toBe(true);
		expect(details.places).toBe(1);
	});
});

// sk-pej D-3 — "the map picks the fight for you".
//
// D-2 composed a grid over its parent, but ONLY when the caller named the grid
// in graph=. A player asking for "the map" mid-fight names nothing, so the
// composition never fired on the surface it exists for: you had to know the
// server-minted `session_grid_<id>` string. These tests pin the default AND,
// more importantly, the three cases where the default must NOT engage.
describe("spellkave_map (auto-selects the session's grid, sk-pej D-3)", () => {
	/** Adds the rows `readParticipantSessionStatus` needs to see an active
	 * session for entity 1, on top of the D-2 crypt/grid fixture. */
	function cryptGridDbInSession(sessionId = 9n) {
		return snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			...cryptGridFixture(),
			session: [
				{
					sessionId,
					sessionDefId: "srd/combat",
					lifecycle: "active",
					currentActor: "1",
				},
			],
			session_participant: [
				{ sessionId, actorId: "1", ordinal: 0 },
				{ sessionId, actorId: "2", ordinal: 1 },
			],
		});
	}

	it("draws the grid composed over the crypt when NO graph is named", async () => {
		const context = { db: cryptGridDbInSession(), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("auto1", {});
		const details = result.details as { places: number; has_layout: boolean };
		// Same 2 named crypt places the D-2 test gets when it spells
		// out graph: "session_grid_9" — the point is that it needed no id.
		expect(details.has_layout).toBe(true);
		expect(details.places).toBe(2);
	});

	it("does NOT override an explicit graph= naming the parent location", async () => {
		// The on-demand escape hatch: "show me the region, I know I'm fighting."
		const context = { db: cryptGridDbInSession(), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("auto2", { graph: "dungeon/crypt" });
		const details = result.details as { places: number };
		expect(details.places).toBe(2);
	});

	it("leaves the world map alone when the actor is in no session", async () => {
		// Regression guard: a player NOT fighting must see exactly the pre-D-3
		// behaviour, not a grid leaked in from somebody else's session.
		const context = { db: snapshotDbFromFixture(cryptGridFixture()), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("auto3", {});
		const explicit = await createMapTool(context).execute("auto3b", { graph: "dungeon/crypt" });
		expect((result.details as { inventory: string }).inventory).not.toContain("session_grid");
		expect((explicit.details as { places: number }).places).toBe(2);
	});

	it("falls back cleanly when the session opened no tactical grid", async () => {
		// A session_definition need NOT materialise a grid. The derived
		// `session_grid_<id>` then matches no place_graph row, and the tool must
		// draw the ordinary map rather than error or render nothing.
		const context = { db: cryptGridDbInSession(404n), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("auto4", {});
		const details = result.details as { inventory: string };
		expect(details.inventory).not.toContain("session_grid");
	});
});

// JPEG-with-backdrop mode (output_dir/output_name) — the second
// spellkave_player_map call each srd-cc adventure story turn now records
// (packages/spellkave-tool-player/docs/player-scoped-map-view.md,
// extended for map-art output). The ascii/terminal-mode tests above are
// UNCHANGED by this mode's existence — proven again here by never setting
// output_dir in them. The backdrop art itself renders UNMASKED/in full
// (operator decision 2026-08-12) — only the GRAPH (place_nodes/place_edges)
// stays fog-of-war-scoped; a masked variant is deferred to bead sk-ubx. JPEG,
// not PNG (operator decision 2026-08-13) — a full-resolution PNG exceeds the
// repo's committed-file size gate; see spatial-graph/jpeg-write.ts.
describe("spellkave_map (JPEG-with-backdrop mode)", () => {
	function mapLayerRows(assetPath: string) {
		return [
			{
				mapLayerId: "town/backdrop",
				bundleId: "town",
				placeGraphId: "town",
				displayName: "Town backdrop",
				assetModule: "",
				assetPath,
				sourceKind: "test",
				state: "aligned",
				posture: "cc-by-4.0",
				imageWidthPx: 100,
				imageHeightPx: 100,
				gridSizePx: 50,
				gridDistanceM: 5,
				localWidthCells: 4,
				localHeightCells: 4,
				imageOriginX: -1,
				imageOriginY: -1,
				rotationDeg: 0,
				minZoom: 0,
				maxZoom: 0,
			},
		];
	}

	function jpegModeDb(assetPath: string) {
		return snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 5n }],
			visible_observer_place_knowledge: [
				{ knowledgeId: 1n, observerEntityId: 1n, knownNodeId: "town/inn", learnedAtTick: 1n },
				{ knowledgeId: 2n, observerEntityId: 1n, knownNodeId: "town/road", learnedAtTick: 2n },
			],
			visible_place_graph_definition: [
				{ placeGraphId: "town", description: "A small town.", scale: 1 },
			],
			visible_place_node: [
				{
					nodeId: "town/inn",
					placeGraphId: "town",
					localId: "inn",
					displayName: "Inn",
					substrateId: "indoor",
					posX: 0,
					posY: 0,
					posPresent: true,
				},
				{
					nodeId: "town/road",
					placeGraphId: "town",
					localId: "road",
					displayName: "Road",
					substrateId: "indoor",
					posX: 1,
					posY: 0,
					posPresent: true,
				},
			],
			visible_place_edge: [
				{ edgeId: 1n, placeGraphId: "town", fromNodeId: "town/inn", toNodeId: "town/road" },
			],
			visible_map_layer: mapLayerRows(assetPath),
		});
	}

	it.skipIf(!FFMPEG_AVAILABLE)(
		"writes a backdrop-composed JPEG under output_dir and returns its path",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "player-map-jpeg-"));
			const assetPath = join(dir, "asset.png");
			writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, "base64"));
			try {
				const context = { db: jpegModeDb(assetPath), act: { actorId: "1" } };
				const result = await createMapTool(context).execute("jpg1", {
					output_type: "jpg",
					graph: "town",
					output_dir: dir,
					output_name: "turn-1",
				});
				const details = result.details as { jpg_path?: string | null; has_layout: boolean };
				const expectedPath = join(dir, "turn-1.jpg");
				expect(details.has_layout).toBe(true);
				expect(details.jpg_path).toBe(expectedPath);
				expect(existsSync(expectedPath)).toBe(true);
				const bytes = readFileSync(expectedPath);
				expect(bytes.length).toBeGreaterThan(0);
				expect(bytes[0]).toBe(0xff); // JPEG magic bytes (SOI marker: FF D8)
				expect(bytes[1]).toBe(0xd8);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	// Regression (operator finding, 2026-08-13): a machine-local ABSOLUTE
	// output_dir leaked into the srd-cc adventure story's recorded artifacts
	// (the caller passed adventureStoryRoot(), itself absolute) — every
	// chapter and the JSONL carried the recording machine's own checkout
	// path, breaking the churn-guard determinism proof across checkouts. The
	// fix: a relative output_dir resolves against process.cwd() for the
	// actual write ONLY; the response's own jpg_path echoes back the
	// caller's ORIGINAL (relative) string, never the resolved absolute path.
	it.skipIf(!FFMPEG_AVAILABLE)(
		"keeps output_dir relative in the response when the caller passes a relative path, resolving only for the actual write",
		async () => {
			const absDir = mkdtempSync(join(tmpdir(), "player-map-jpeg-relative-"));
			const assetPath = join(absDir, "asset.png");
			writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, "base64"));
			// A relative path FROM cwd TO the temp dir — whatever that happens to
			// be, `path.relative` computes it honestly; the point under test is
			// that the tool never turns it back into an absolute path.
			const relDir = relative(process.cwd(), absDir);
			try {
				const context = { db: jpegModeDb(assetPath), act: { actorId: "1" } };
				const result = await createMapTool(context).execute("jpg-rel", {
					output_type: "jpg",
					graph: "town",
					output_dir: relDir,
					output_name: "turn-1",
				});
				const details = result.details as { jpg_path?: string | null; has_layout: boolean };
				expect(details.has_layout).toBe(true);
				// Echoed back verbatim (joined with the filename) — NOT resolved.
				expect(details.jpg_path).toBe(join(relDir, "turn-1.jpg"));
				expect(isAbsolute(details.jpg_path ?? "")).toBe(false);
				// The file was still really written, resolved against cwd.
				const resolvedPath = join(absDir, "turn-1.jpg");
				expect(existsSync(resolvedPath)).toBe(true);
				const bytes = readFileSync(resolvedPath);
				expect(bytes[0]).toBe(0xff);
				expect(bytes[1]).toBe(0xd8);
			} finally {
				rmSync(absDir, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(!FFMPEG_AVAILABLE)(
		"composes the full, unmasked backdrop art — a resolvable asset produces a visibly larger JPEG than no backdrop at all",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "player-map-jpeg-backdrop-proof-"));
			const assetPath = join(dir, "asset.png");
			writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, "base64"));
			try {
				// Same graph/known-nodes either way — only the map_layer asset path
				// differs (resolvable vs. deliberately missing), isolating the
				// backdrop's own contribution to the rendered JPEG's byte size (the
				// backdrop asset is embedded as a base64 data URI in the SVG source
				// the tool rasterizes — see backdropAssetDataHref).
				const withBackdrop = await createMapTool({
					db: jpegModeDb(assetPath),
					act: { actorId: "1" },
				}).execute("jpg-with", {
					output_type: "jpg",
					graph: "town",
					output_dir: dir,
					output_name: "with-backdrop",
				});
				const noBackdropDb = jpegModeDb(join(dir, "does-not-exist.png"));
				const withoutBackdrop = await createMapTool({
					db: noBackdropDb,
					act: { actorId: "1" },
				}).execute("jpg-without", {
					output_type: "jpg",
					graph: "town",
					output_dir: dir,
					output_name: "without-backdrop",
				});
				expect((withBackdrop.details as { has_layout: boolean }).has_layout).toBe(true);
				expect((withoutBackdrop.details as { has_layout: boolean }).has_layout).toBe(true);
				const withBytes = readFileSync(join(dir, "with-backdrop.jpg"));
				const withoutBytes = readFileSync(join(dir, "without-backdrop.jpg"));
				expect(withBytes.length).toBeGreaterThan(withoutBytes.length);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(!FFMPEG_AVAILABLE)(
		"is churn-guarded: an identical re-record leaves the written JPEG byte-for-byte untouched",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "player-map-jpeg-churn-"));
			const assetPath = join(dir, "asset.png");
			writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, "base64"));
			try {
				const context = { db: jpegModeDb(assetPath), act: { actorId: "1" } };
				const params = {
					output_type: "jpg" as const,
					graph: "town",
					output_dir: dir,
					output_name: "turn-1",
				};
				await createMapTool(context).execute("jpg1", params);
				const expectedPath = join(dir, "turn-1.jpg");
				// Deliberately corrupt the file — a churn-guarded second call with the
				// SAME deterministic source (svg + width) must skip the rewrite, so
				// the corruption survives; a real rewrite would clobber it back to a
				// valid JPEG.
				writeFileSync(expectedPath, Buffer.from("corrupted"));
				const result2 = await createMapTool(context).execute("jpg2", params);
				expect((result2.details as { jpg_path?: string | null }).jpg_path).toBe(expectedPath);
				expect(readFileSync(expectedPath).toString()).toBe("corrupted");
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	it.skipIf(!FFMPEG_AVAILABLE)(
		"rewrites the JPEG once the deterministic source actually changes (a newly known node)",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "player-map-jpeg-rewrite-"));
			const assetPath = join(dir, "asset.png");
			writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, "base64"));
			try {
				const oneNodeDb = snapshotDbFromFixture({
					visible_entity_tag: [],
					visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
					world_time: [{ tick: 5n }],
					visible_observer_place_knowledge: [
						{ knowledgeId: 1n, observerEntityId: 1n, knownNodeId: "town/inn", learnedAtTick: 1n },
					],
					visible_place_graph_definition: [
						{ placeGraphId: "town", description: "A small town.", scale: 1 },
					],
					visible_place_node: [
						{
							nodeId: "town/inn",
							placeGraphId: "town",
							localId: "inn",
							displayName: "Inn",
							substrateId: "indoor",
							posX: 0,
							posY: 0,
							posPresent: true,
						},
					],
					visible_place_edge: [],
					visible_map_layer: mapLayerRows(assetPath),
				});
				const params = {
					output_type: "jpg" as const,
					graph: "town",
					output_dir: dir,
					output_name: "turn-1",
				};
				await createMapTool({ db: oneNodeDb, act: { actorId: "1" } }).execute("jpg1", params);
				const expectedPath = join(dir, "turn-1.jpg");
				const firstBytes = readFileSync(expectedPath);

				const twoNodeDb = jpegModeDb(assetPath);
				const result2 = await createMapTool({
					db: twoNodeDb,
					act: { actorId: "1" },
				}).execute("jpg2", params);
				expect((result2.details as { jpg_path?: string | null }).jpg_path).toBe(expectedPath);
				// Different known-node set -> different SVG source -> different bytes
				// (host-independent proxy: byte length changes with an extra node +
				// edge drawn; exact-byte comparison would be host-font-dependent).
				const secondBytes = readFileSync(expectedPath);
				expect(secondBytes.equals(firstBytes)).toBe(false);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	// output_dir/output_name both stay OPTIONAL under output_type=jpg (bead
	// sk-due) — an omitted output_name derives one from `graph` instead of
	// throwing (the tool's OLD behavior, back when output_dir's mere presence
	// was what triggered JPEG mode and output_name was its one required
	// partner).
	it.skipIf(!FFMPEG_AVAILABLE)(
		"derives output_name from graph when output_dir is set without output_name",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "player-map-jpeg-derived-name-"));
			const assetPath = join(dir, "asset.png");
			writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, "base64"));
			try {
				const context = { db: jpegModeDb(assetPath), act: { actorId: "1" } };
				const result = await createMapTool(context).execute("jpg-derived-name", {
					output_type: "jpg",
					graph: "town",
					output_dir: dir,
				});
				const details = result.details as { jpg_path?: string | null };
				const expectedPath = join(dir, "town.jpg");
				expect(details.jpg_path).toBe(expectedPath);
				expect(existsSync(expectedPath)).toBe(true);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	// output_dir ALSO stays optional (bead sk-due) — omitting it entirely
	// falls back to a fresh temp directory (mkdtemp) rather than requiring the
	// caller to invent a path just to get "a JPEG, anywhere".
	it.skipIf(!FFMPEG_AVAILABLE)(
		"defaults output_dir to a fresh temp directory when omitted entirely",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "player-map-jpeg-asset-"));
			const assetPath = join(dir, "asset.png");
			writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, "base64"));
			try {
				const context = { db: jpegModeDb(assetPath), act: { actorId: "1" } };
				const result = await createMapTool(context).execute("jpg-default-dir", {
					output_type: "jpg",
					graph: "town",
				});
				const details = result.details as { jpg_path?: string | null; has_layout: boolean };
				expect(details.has_layout).toBe(true);
				expect(details.jpg_path).toMatch(/spellkave-map-.*[/\\]town\.jpg$/);
				expect(existsSync(details.jpg_path ?? "")).toBe(true);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);

	// sk-pej D-2: an ephemeral session grid authors no [[map_layers]] of its
	// own — the JPEG's backdrop must resolve through parent_graph_id to the
	// PARENT's own map_layer row (tools.ts's graphChain resolution, the
	// tools.ts-specific half of the "parent-backdrop fallback resolution"
	// this bead's tests cover — the spatial-graph engine half is covered
	// directly in spatial-graph.test.ts).
	it.skipIf(!FFMPEG_AVAILABLE)(
		"a session grid's JPEG resolves its backdrop through the parent graph, and compose_parent=false suppresses it",
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "player-map-jpeg-grid-backdrop-"));
			const assetPath = join(dir, "asset.png");
			writeFileSync(assetPath, Buffer.from(TINY_PNG_BASE64, "base64"));
			try {
				const gridCellIds = [0, 1, 2].flatMap((y) =>
					[0, 1, 2].map((x) => `session_grid_9/c_${x}_${y}`),
				);
				const known = ["dungeon/crypt/center", ...gridCellIds];
				const db = snapshotDbFromFixture({
					visible_entity_tag: [],
					visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
					world_time: [{ tick: 5n }],
					visible_observer_place_knowledge: known.map((knownNodeId, i) => ({
						knowledgeId: BigInt(i + 1),
						observerEntityId: 1n,
						knownNodeId,
						learnedAtTick: 1n,
					})),
					visible_place_graph_definition: [
						{ placeGraphId: "dungeon/crypt", substrateId: "indoor", scale: 5 },
						{
							placeGraphId: "session_grid_9",
							substrateId: "tactical",
							scale: 5,
							parentGraphId: "dungeon/crypt",
							anchorNodeId: "dungeon/crypt/center",
							isEphemeralInstance: true,
						},
					],
					visible_place_node: [
						{
							nodeId: "dungeon/crypt/center",
							placeGraphId: "dungeon/crypt",
							localId: "center",
							substrateId: "indoor",
							posX: 10,
							posY: 10,
							posPresent: true,
						},
						...[0, 1, 2].flatMap((y) =>
							[0, 1, 2].map((x) => ({
								nodeId: `session_grid_9/c_${x}_${y}`,
								placeGraphId: "session_grid_9",
								localId: `c_${x}_${y}`,
								substrateId: "tactical",
								posX: x,
								posY: y,
								posPresent: true,
							})),
						),
					],
					visible_place_edge: [],
					visible_map_layer: mapLayerRows(assetPath).map((row) => ({
						...row,
						mapLayerId: "crypt/backdrop",
						placeGraphId: "dungeon/crypt",
					})),
				});
				const composed = await createMapTool({ db, act: { actorId: "1" } }).execute("grid-jpg-1", {
					output_type: "jpg",
					graph: "session_grid_9",
					output_dir: dir,
					output_name: "composed",
				});
				const alone = await createMapTool({ db, act: { actorId: "1" } }).execute("grid-jpg-2", {
					output_type: "jpg",
					graph: "session_grid_9",
					compose_parent: false,
					output_dir: dir,
					output_name: "alone",
				});
				expect((composed.details as { has_layout: boolean }).has_layout).toBe(true);
				expect((alone.details as { has_layout: boolean }).has_layout).toBe(true);
				const composedBytes = readFileSync(join(dir, "composed.jpg"));
				const aloneBytes = readFileSync(join(dir, "alone.jpg"));
				// This used to assert composed.length > alone.length, on the theory
				// that the embedded backdrop makes the composed render strictly
				// bigger. That was never what it measured: this fixture's backdrop
				// is a 1x1 transparent PNG contributing ~100 bytes, so the ordering
				// actually rode on the composed view drawing MORE TEXT. sk-pej D-3
				// suppresses labels on composed grid cells (100 "Cell 4,7" strings
				// smear across real artwork), which flipped the comparison and
				// exposed the proxy. Assert the claim itself instead:
				//   - composition happened: the crypt's own known node joined the
				//     grid's cells (1 crypt + 9 cells vs 9 cells alone — this
				//     fixture's known set holds only `dungeon/crypt/center`);
				//   - the two renders genuinely differ, so compose_parent=false is
				//     not a silent no-op.
				// Whether a backdrop was embedded is not observable through the jpg
				// path at all; the SVG-level backdrop tests in spatial-graph.test.ts
				// are where that claim belongs, and they cover it.
				expect((composed.details as { places: number; inventory: string }).places).toBe(1);
				expect((alone.details as { places: number; inventory: string }).places).toBe(1);
				expect((composed.details as { inventory: string }).inventory).toContain(
					"  dungeon/crypt/center",
				);
				expect((alone.details as { inventory: string }).inventory).not.toContain(
					"  dungeon/crypt/center",
				);
				expect(composedBytes.equals(aloneBytes)).toBe(false);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});

// Selectivity (bead sk-due): buildSpatialGraphView used to render
// svg + utf8 + ascii + braille unconditionally, and the tool returned all
// four regardless of what was asked. output_type now restricts the engine to
// computing (and the response to carrying) exactly ONE artifact.
describe("spellkave_map (output_type selectivity)", () => {
	function singleGraphDb() {
		return snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 5n }],
			visible_observer_place_knowledge: [
				{ knowledgeId: 1n, observerEntityId: 1n, knownNodeId: "town/inn", learnedAtTick: 1n },
				{ knowledgeId: 2n, observerEntityId: 1n, knownNodeId: "town/road", learnedAtTick: 2n },
			],
			visible_place_graph_definition: [
				{ placeGraphId: "town", description: "A small town.", scale: 1 },
			],
			visible_place_node: [
				{
					nodeId: "town/inn",
					placeGraphId: "town",
					localId: "inn",
					substrateId: "outdoor",
					posX: 0,
					posY: 0,
					posPresent: true,
				},
				{
					nodeId: "town/road",
					placeGraphId: "town",
					localId: "road",
					substrateId: "outdoor",
					posX: 1,
					posY: 0,
					posPresent: true,
				},
			],
			visible_place_edge: [
				{ edgeId: 1n, placeGraphId: "town", fromNodeId: "town/inn", toNodeId: "town/road" },
			],
		});
	}

	const OUTPUT_ARTIFACT_KEYS = ["svg", "utf8", "ascii", "braille"] as const;

	it.each([
		["utf8" as const, "utf8"],
		["ascii" as const, "ascii"],
		["braille" as const, "braille"],
		["svg" as const, "svg"],
	])("output_type=%s returns ONLY details.%s among the text/svg artifacts", async (outputType, key) => {
		const context = { db: singleGraphDb(), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("sel", {
			graph: "town",
			output_type: outputType,
		});
		const details = result.details as Record<string, unknown>;
		expect(typeof details[key]).toBe("string");
		for (const other of OUTPUT_ARTIFACT_KEYS) {
			if (other === key) continue;
			expect(details[other]).toBeUndefined();
		}
		// jpg_path never appears outside output_type=jpg.
		expect(details.jpg_path).toBeUndefined();
	});

	it("output_type=inventory carries none of svg/utf8/ascii/braille, only details.inventory", async () => {
		const context = { db: singleGraphDb(), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("sel-inv", {
			graph: "town",
			output_type: "inventory",
		});
		const details = result.details as Record<string, unknown>;
		for (const key of OUTPUT_ARTIFACT_KEYS) {
			expect(details[key]).toBeUndefined();
		}
		expect(typeof details.inventory).toBe("string");
		expect(details.has_layout).toBe(true);
		expect(details.places).toBe(2);
	});

	// Same default as the author twin: the output surface must not differ by
	// role. A PLAYER agent runs in the same Pi TUI an author does (the
	// `playtest` skill hosts one), and that host paints its inline picture from
	// details.svg — a text default would leave the player without the map.
	it("defaults to output_type=svg when omitted, matching spellkave_map_graph", async () => {
		const context = { db: singleGraphDb(), act: { actorId: "1" } };
		const result = await createMapTool(context).execute("sel-default", { graph: "town" });
		const details = result.details as Record<string, unknown>;
		expect(typeof details.svg).toBe("string");
		expect(details.utf8).toBeUndefined();
		expect(details.ascii).toBeUndefined();
		expect(details.braille).toBeUndefined();
	});
});

// sk-e7n: spellkave_map draws combatants — `model.actorClusters` (a count per
// node, never an identity; the SAME "actors=N" badge AUTHOR's own
// spellkave_map_graph uses) is now sourced from the connected actor's own
// open-session roster (operator decision, sk-e7n NOTES: "while a session is
// open, show ALL of that session's participants at their cells"). Reuses
// cryptGridFixture (D-2/D-3 above): grid cells `session_grid_9/c_<x>_<y>` are
// already known/drawn by entity 1.
describe("spellkave_map (session-roster occupants, sk-e7n)", () => {
	function cryptGridDbWithOccupants(
		locations: { entityId: bigint; placeNodeId: string }[],
		participants: { actorId: string; ordinal: number }[] = [
			{ actorId: "1", ordinal: 0 },
			{ actorId: "2", ordinal: 1 },
		],
	) {
		const sessionId = 9n;
		return snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			...cryptGridFixture(),
			session: [{ sessionId, sessionDefId: "srd/combat", lifecycle: "active", currentActor: "1" }],
			session_participant: participants.map((p) => ({
				sessionId,
				actorId: p.actorId,
				ordinal: p.ordinal,
			})),
			visible_actor_spatial_location: locations.map((l) => ({
				entityId: l.entityId,
				placeNodeId: l.placeNodeId,
			})),
		});
	}

	it("draws each session participant at its own cell", async () => {
		const db = cryptGridDbWithOccupants([
			{ entityId: 1n, placeNodeId: "session_grid_9/c_0_0" },
			{ entityId: 2n, placeNodeId: "session_grid_9/c_1_0" },
		]);
		// No graph named: sk-pej D-3 auto-selects the open session's own grid.
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("occ1", {});
		const details = result.details as { places: number; inventory: string };
		expect(details.places).toBe(2);
		expect(details.inventory).toContain("session_grid_9/c_0_0  actors=1");
		expect(details.inventory).toContain("session_grid_9/c_1_0  actors=1");
	});

	it("a session participant standing outside the drawn grid does not break anything", async () => {
		const db = cryptGridDbWithOccupants([
			{ entityId: 1n, placeNodeId: "session_grid_9/c_0_0" },
			// A participant, but staged at the crypt's altar — compose_parent:
			// false below draws the grid alone, so the altar node is never part
			// of the drawn set this call renders.
			{ entityId: 2n, placeNodeId: "dungeon/crypt/altar" },
		]);
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("occ2", {
			graph: "session_grid_9",
			compose_parent: false,
		});
		const details = result.details as { places: number; has_layout: boolean; inventory: string };
		expect(details.has_layout).toBe(true);
		expect(details.places).toBe(1);
		expect(details.inventory).toContain("session_grid_9/c_0_0  actors=1");
		expect(details.inventory).not.toContain("altar");
	});

	it("an actor NOT in the session does not appear even when co-located on the grid", async () => {
		const db = cryptGridDbWithOccupants([
			{ entityId: 1n, placeNodeId: "session_grid_9/c_0_0" },
			// entity 3 has a location on the grid but never joined session 9's
			// session_participant roster.
			{ entityId: 3n, placeNodeId: "session_grid_9/c_2_2" },
		]);
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("occ3", {});
		const details = result.details as { inventory: string };
		expect(details.inventory).toContain("session_grid_9/c_0_0  actors=1");
		expect(details.inventory).not.toMatch(/session_grid_9\/c_2_2.*actors=/);
	});

	it("no open session means no occupants (pre-change behaviour, unchanged)", async () => {
		const db = snapshotDbFromFixture(cryptGridFixture());
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("occ4", {
			graph: "session_grid_9",
		});
		const details = result.details as { inventory: string };
		expect(details.inventory).not.toContain("actors=");
	});
});

// sk-jay0.4.2: spellkave_map names the session roster's tokens per grid
// cell (actor_id, name, is_me) — additive to the count badge above, same
// roster-bounded source (sessionRosterOccupants), never a wider scan.
describe("spellkave_map (session_tokens, sk-jay0.4.2)", () => {
	function cryptGridDbWithNamedOccupants(
		locations: { entityId: bigint; placeNodeId: string }[],
		participants: { actorId: string; ordinal: number }[] = [
			{ actorId: "1", ordinal: 0 },
			{ actorId: "2", ordinal: 1 },
		],
		entityNames: { entityId: bigint; name: string }[] = [],
	) {
		const sessionId = 9n;
		return snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			...cryptGridFixture(),
			session: [{ sessionId, sessionDefId: "srd/combat", lifecycle: "active", currentActor: "1" }],
			session_participant: participants.map((p) => ({
				sessionId,
				actorId: p.actorId,
				ordinal: p.ordinal,
			})),
			visible_actor_spatial_location: locations.map((l) => ({
				entityId: l.entityId,
				placeNodeId: l.placeNodeId,
			})),
			entity: entityNames.map((e) => ({ entityId: e.entityId, name: e.name })),
		});
	}

	it("carries node_id/actor_id/name/is_me for every roster member on a drawn cell, the caller's own row marked", async () => {
		const db = cryptGridDbWithNamedOccupants(
			[
				{ entityId: 1n, placeNodeId: "session_grid_9/c_0_0" },
				{ entityId: 2n, placeNodeId: "session_grid_9/c_1_0" },
			],
			undefined,
			[
				{ entityId: 1n, name: "Hero" },
				{ entityId: 2n, name: "Cellar Rat" },
			],
		);
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("tok1", {});
		const details = result.details as {
			session_tokens?: { node_id: string; actor_id: string; name: string; is_me: boolean }[];
		};
		expect(details.session_tokens).toEqual([
			{ node_id: "session_grid_9/c_0_0", actor_id: "1", name: "Hero", is_me: true },
			{ node_id: "session_grid_9/c_1_0", actor_id: "2", name: "Cellar Rat", is_me: false },
		]);
	});

	it("two roster members sharing one cell both appear", async () => {
		const db = cryptGridDbWithNamedOccupants(
			[
				{ entityId: 1n, placeNodeId: "session_grid_9/c_0_0" },
				{ entityId: 2n, placeNodeId: "session_grid_9/c_0_0" },
			],
			undefined,
			[
				{ entityId: 1n, name: "Hero" },
				{ entityId: 2n, name: "Cellar Rat" },
			],
		);
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("tok2", {});
		const details = result.details as { session_tokens?: { node_id: string }[] };
		expect(details.session_tokens).toHaveLength(2);
		expect(details.session_tokens?.every((t) => t.node_id === "session_grid_9/c_0_0")).toBe(true);
	});

	// A participant the roster reader could not name (no `entity.name` row)
	// falls back to its own id — session_tokens documents `name` as always a
	// string, never `null`.
	it("falls back to the actor id when the roster carries no name for a participant", async () => {
		const db = cryptGridDbWithNamedOccupants([
			{ entityId: 2n, placeNodeId: "session_grid_9/c_0_0" },
		]);
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("tok3", {});
		const details = result.details as { session_tokens?: { actor_id: string; name: string }[] };
		expect(details.session_tokens).toContainEqual({
			node_id: "session_grid_9/c_0_0",
			actor_id: "2",
			name: "2",
			is_me: false,
		});
	});

	// Roster-bounded, same as the count badge: an actor with a location row
	// but no session_participant membership never appears in session_tokens
	// either, even though it is co-located on the drawn grid.
	it("an actor NOT in the session never appears in session_tokens", async () => {
		const db = cryptGridDbWithNamedOccupants([
			{ entityId: 1n, placeNodeId: "session_grid_9/c_0_0" },
			{ entityId: 3n, placeNodeId: "session_grid_9/c_2_2" },
		]);
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("tok4", {});
		const details = result.details as { session_tokens?: { actor_id: string }[] };
		expect(details.session_tokens?.some((t) => t.actor_id === "3")).toBe(false);
	});

	// The count aggregation drops a roster member staged outside the drawn
	// set (model.ts's own nodeIds.has guard) — session_tokens must drop the
	// SAME row, not draw a token the picture never places anywhere.
	it("drops a roster member staged outside the drawn set, same as the count badge", async () => {
		const db = cryptGridDbWithNamedOccupants([
			{ entityId: 1n, placeNodeId: "session_grid_9/c_0_0" },
			{ entityId: 2n, placeNodeId: "dungeon/crypt/altar" },
		]);
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("tok5", {
			graph: "session_grid_9",
			compose_parent: false,
		});
		const details = result.details as { session_tokens?: { node_id: string }[] };
		expect(details.session_tokens).toEqual([
			{ node_id: "session_grid_9/c_0_0", actor_id: "1", name: "1", is_me: true },
		]);
	});

	// Field presence itself is the "in a session" signal: absent (never an
	// empty array) when the caller is in no session at all.
	it("is absent (not an empty array) when the caller is in no session", async () => {
		const db = snapshotDbFromFixture(cryptGridFixture());
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("tok6", {
			graph: "session_grid_9",
		});
		const details = result.details as { session_tokens?: unknown };
		expect(details.session_tokens).toBeUndefined();
	});

	// A session open with nobody placed on a drawn cell is the honest empty
	// case: the field is present, just empty — distinct from "no session".
	it("is an empty array when the session has no participant placed on a drawn cell", async () => {
		const db = cryptGridDbWithNamedOccupants([]);
		const result = await createMapTool({ db, act: { actorId: "1" } }).execute("tok7", {});
		const details = result.details as { session_tokens?: unknown[] };
		expect(details.session_tokens).toEqual([]);
	});
});
