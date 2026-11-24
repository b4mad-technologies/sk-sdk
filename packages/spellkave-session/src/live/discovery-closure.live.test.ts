/**
 * The `spellkave_query` discovery funnel against a REAL node, in the package that owns the live
 * author target (`createLiveAuthorTarget`). Re-homed from the srd-cc live-preseeded
 * `discovery-closure` (ledger/designs/rehome-map-kernel-sdk.md): the funnel is content-agnostic,
 * so it needs no srd bundle; the shared package DB carries `core` plus every scene any live test
 * of this package built. The test builds its OWN scene first and asserts that scene closes too.
 */
import type { SnapshotDb } from "@spellkave/sdk/replay";
import {
	connectTestWorld,
	operatorScopeManifest,
	type Scene,
	scene,
	syncConnection,
	type TestWorld,
} from "@spellkave/test-lab";
import type { AuthorToolContext, AuthorWorkspace } from "@spellkave/tool-authoring";
import { createAuthorFacingBoundTools } from "@spellkave/tool-authoring";
import { nodeToolCapability } from "@spellkave/tool-node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLiveAuthorTarget } from "../authoring";
import {
	type DiscoveryDetailResult,
	type DiscoveryListResult,
	type DiscoveryQueryResult,
	runDiscoveryClosureWalk,
} from "./discovery-closure-walk";
import { liveWorldRef, localNode } from "./support";

// Every live table `LIVE_TABLE_ACCESSORS` (`author-target.ts`) can resolve. Omitting one would
// silently starve the walk of rows the SDK never received, masquerading as a smaller world.
// These are definition tables outside the player reader catalog, so the operator-scope manifest
// (god view, never for player data) is the bridge.
const DEFINITION_TABLES = [
	"area_shape_definition",
	"resource_definition",
	"entity_definition",
	"visible_place_node",
	"visible_place_graph_definition",
	"substrate_definition",
	"coordinate_kind_definition",
	"session_definition",
	"turn_scheduler",
	"combat_grid_blueprint",
	"capability_definition",
	"affordance_template",
	"action_definition",
	"outcome_template",
	"mod_bundle",
	"condition_definition",
	"consequence_template",
	"modifier_target_definition",
	"modifier_template",
	"capability_definition_tag",
	"resource_definition_tag",
	"entity_definition_tag",
	"modifier_template_tag",
] as const;

const emptyWorkspace = (): AuthorWorkspace => ({
	readToml: () => null,
	writeToml: () => "(unused)",
});

describe.skipIf(!localNode)("discovery funnel (live) - content-agnostic closure walk", () => {
	let world: TestWorld;
	let mine: Scene;
	let query: (params: Record<string, unknown>) => Promise<DiscoveryQueryResult>;

	beforeAll(async () => {
		// Self-seeded rows: this test's own scene (places, an edge) lands before the walk starts.
		mine = await scene(liveWorldRef());
		mine.place("hall", { exits: ["yard"] }).place("yard");
		await mine.apply();
		const w = liveWorldRef();
		world = await connectTestWorld({
			url: w.url,
			db: w.db,
			readerManifests: [operatorScopeManifest("session-discovery-closure-live", DEFINITION_TABLES)],
			// Operator scope needs the owner credential: the spatial catalog tables are private.
			token: w.token,
		});
		// The sync barrier: this connection's cache holds the scene applied above.
		await syncConnection(world);
		// `cacheRows`: the walk is read-only over a world nothing writes to during the test;
		// uncached, every one of its queries re-copies whole tables.
		const target = createLiveAuthorTarget({
			db: () => world.db() as unknown as SnapshotDb,
			cacheRows: true,
		});
		const context: AuthorToolContext = { workspace: emptyWorkspace(), target };
		const tools = createAuthorFacingBoundTools(context, { node: nodeToolCapability });
		const tool = tools.find((t) => t.name === "spellkave_query");
		if (tool === undefined) throw new Error("spellkave_query not registered");
		query = async (params) =>
			((await tool.execute("session-discovery-closure-live", params)) as { details: unknown })
				.details as DiscoveryQueryResult;
	}, 120_000);

	afterAll(async () => {
		world?.disconnect();
		await mine?.close();
	});

	it("summary -> list -> detail -> ref closure -> schema vocabulary holds for every kind/id/ref (full walk)", async () => {
		// from discovery-closure.test.ts (shared 273-287, 293-308, 350-358), cacheRows true + operator
		// scope (:146,161-166); the walk asserts list counts == summary counts, every listed id
		// found:true, every outbound ref closing or grounded-excepted, schema superset of summary kinds.
		const report = await runDiscoveryClosureWalk(query, { expectBundle: "core" });
		// from discovery-closure.test.ts:99-136,191-193 (anti-vacuity): a walk that visits nothing
		// proves nothing, and it must have visited this test's own scene.
		expect(report.bundleIds).toContain(mine.prefix);
		// The scene's own place node is listed, found by detail and carries a ref the funnel can
		// chase (anti-vacuity: the walk covers rows this test built, not only the shared world).
		const hall = mine.reads.nodeId("hall");
		const list = (await query({ kind: "place_nodes" })) as DiscoveryListResult;
		expect(list.shape).toBe("list");
		expect(list.items.map((i) => i.id)).toContain(hall);
		const detail = (await query({
			kind: "place_nodes",
			id: hall,
			refs: "outbound",
		})) as DiscoveryDetailResult;
		expect(detail.found).toBe(true);
		expect((detail.outbound_refs ?? []).length).toBeGreaterThan(0);
		expect(report.totalRowsWalked).toBeGreaterThan(Object.keys(report.kindCounts).length);
		expect(report.totalOutboundRefs).toBeGreaterThan(0);
		// Diagnostic only (counts for the operator), not an assertion.
		console.log(
			"[discovery-closure/live]",
			JSON.stringify({ ...report, bundleIds: report.bundleIds.length }),
		);
	}, 120_000);
});
