import type { SnapshotDb } from "@spellkave/sdk";
import { snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import type { SpellkaveActorContext, SpellkaveToolContext } from "../tools";
import {
	createMoveTool,
	createSceneDetailTool,
	createSceneTool,
	createSpellkaveTools,
} from "../tools";

const db = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	world_time: [{ tick: 1n }],
	visible_actor_spatial_location: [
		{ entityId: 1n, placeNodeId: "inn" },
		{ entityId: 2n, placeNodeId: "inn" },
	],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	visible_place_node: [
		{ nodeId: "inn", placeGraphId: "town", description: "Warm light.", posPresent: false },
		{ nodeId: "road", placeGraphId: "town", description: "Remote.", posPresent: false },
	],
	visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
	visible_place_edge: [{ edgeId: 7n, fromNodeId: "inn", toNodeId: "road" }],
	// Movement is attempt-based (ADR-0091): no `visible_affordance` row is ever
	// materialized for a place edge, so this fixture carries none — the exit
	// dispatches through spellkave_move's rev+handle attempt path unconditionally.
	visible_affordance: [],
	affordance_template: [],
	entity: [
		{ entityId: 1n, name: "Hero", kind: "actor", quantity: 1n },
		{ entityId: 2n, name: "Innkeeper", kind: "actor", quantity: 1n },
		{ entityId: 10n, name: "Lantern", kind: "item", quantity: 1n },
	],
	visible_entity_tag: [],
	visible_entity_location: [{ entityId: 10n, placeNodeId: "inn" }],
	visible_trace: [
		{
			traceId: 4n,
			kind: "smoke",
			locationKind: "place_node",
			locationRef: "inn",
			payloadJson: "{}",
			inscribedAt: 1n,
			visibility: { tag: "Local" },
			bundleId: "test",
		},
	],
});
const context = { db, act: { actorId: "1" } };

// #1931 falsifier fixture: a scene with 13-40 targets. If the complete/paginated
// cutoff were wrongly anchored on SUMMARY_GROUP_LIMIT (12, a histogram-axis
// constant unrelated to page row count) this scene would wrongly fall to
// "paginated" and resurrect the two-call round trip the merge exists to kill.
const MANY_TARGET_COUNT = 20;
const manyDb = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	world_time: [{ tick: 1n }],
	visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "market" }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	visible_place_node: [
		{ nodeId: "market", placeGraphId: "town", description: "A crowded square.", posPresent: false },
	],
	visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
	visible_place_edge: [],
	visible_affordance: [],
	affordance_template: [],
	entity: [
		{ entityId: 1n, name: "Hero", kind: "actor", quantity: 1n },
		...Array.from({ length: MANY_TARGET_COUNT }, (_, index) => ({
			entityId: BigInt(100 + index),
			name: `Crate ${index}`,
			kind: "item",
			quantity: 1n,
		})),
	],
	visible_entity_tag: [],
	visible_entity_location: Array.from({ length: MANY_TARGET_COUNT }, (_, index) => ({
		entityId: BigInt(100 + index),
		placeNodeId: "market",
	})),
	visible_trace: [],
});
const manyContext = { db: manyDb, act: { actorId: "1" } };

// ADR-0091: an ungated exit — raw `place_edge` geometry with no
// `place_edge_affordance` gate attached. No `visible_affordance` row is ever
// materialized for it either (movement is attempt-based, never cached), which
// used to be a special "stale cache" shape a `$sender`-bound actor's cache
// could be left in; it is now simply how every exit looks, always.
const ungatedExitDb = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	world_time: [{ tick: 1n }],
	visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "cell" }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	visible_place_node: [
		{ nodeId: "cell", placeGraphId: "grid", description: "", posPresent: false },
	],
	visible_place_graph_definition: [{ placeGraphId: "grid", description: "" }],
	visible_place_edge: [{ edgeId: 9n, fromNodeId: "cell", toNodeId: "next_cell" }],
	visible_affordance: [],
	affordance_template: [],
	entity: [{ entityId: 1n, name: "Guard", kind: "actor", quantity: 1n }],
	visible_entity_tag: [],
	visible_entity_location: [],
	visible_trace: [],
});
const ungatedExitContext = { db: ungatedExitDb, act: { actorId: "1" } };

// #1987: the LOOK-ALIKE of the fixture above — same absent gate — differing
// only in that the edge is paired with a gate template. Before #1987 this
// exit was DROPPED, so the actor could not learn a trail existed at all. It
// is now listed, naming what stands there.
const gatedExitDb = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	world_time: [{ tick: 1n }],
	visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "camp" }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	visible_place_node: [
		{ nodeId: "camp", placeGraphId: "trail", description: "", posPresent: false },
	],
	visible_place_graph_definition: [{ placeGraphId: "trail", description: "" }],
	visible_place_edge: [
		{ edgeId: 47n, edgeKey: "demo/edge/camp-approach", fromNodeId: "camp", toNodeId: "approach" },
	],
	place_edge_affordance: [
		{ key: "k1", edgeKey: "demo/edge/camp-approach", affordanceTemplateId: "demo/gate_template" },
	],
	visible_affordance: [],
	affordance_template: [],
	entity: [{ entityId: 1n, name: "Hero", kind: "actor", quantity: 1n }],
	visible_entity_tag: [],
	visible_entity_location: [],
	visible_trace: [],
});
const gatedExitContext = { db: gatedExitDb, act: { actorId: "1" } };

// T2 (operator-review dry-run, 2026-08-04): a node id's first `/`-segment
// names its graph/session — this fixture models both the same-graph
// (truncated `to`) and cross-graph (full path kept) cases the truncation
// rule distinguishes. Elven-mini evidence: ~44/~90 story steps were the
// scene -> scene_detail (per exit candidate, only to learn to_node_id) -> act
// triplet; `to_node_id` is not new disclosure (scene_detail already returns
// it canonically), this only moves the same authorized information a call
// earlier.
const truncationDb = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	world_time: [{ tick: 1n }],
	visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "town/inn" }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	visible_place_node: [
		{ nodeId: "town/inn", placeGraphId: "town", description: "", posPresent: false },
	],
	visible_place_graph_definition: [{ placeGraphId: "town", description: "" }],
	visible_place_edge: [
		{ edgeId: 1n, fromNodeId: "town/inn", toNodeId: "town/stairs" },
		{ edgeId: 2n, fromNodeId: "town/inn", toNodeId: "dungeon/entrance" },
	],
	visible_affordance: [],
	affordance_template: [],
	entity: [{ entityId: 1n, name: "Hero", kind: "actor", quantity: 1n }],
	visible_entity_tag: [],
	visible_entity_location: [],
	visible_trace: [],
});
const truncationContext = { db: truncationDb, act: { actorId: "1" } };

// U4 (tool-ux-decision-log.md): scene_detail on a co-located actor used to
// deliver only {entity_id, name, faction} — nothing beyond the listing row.
// Marked (authored description + a live visible condition) and Plain
// (neither) prove the enrichment surfaces what IS there and gracefully shows
// nothing (never an error) for what is not.
const conditionDetailDb = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	world_time: [{ tick: 1n }],
	visible_actor_spatial_location: [
		{ entityId: 1n, placeNodeId: "inn" },
		{ entityId: 2n, placeNodeId: "inn" },
		{ entityId: 3n, placeNodeId: "inn" },
	],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	visible_place_node: [
		{ nodeId: "inn", placeGraphId: "town", description: "Warm light.", posPresent: false },
	],
	visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
	visible_place_edge: [],
	visible_affordance: [],
	affordance_template: [],
	entity: [
		{ entityId: 1n, name: "Hero", kind: "actor", quantity: 1n },
		{ entityId: 2n, name: "Marked", kind: "actor", quantity: 1n },
		{ entityId: 3n, name: "Plain", kind: "actor", quantity: 1n },
	],
	visible_entity_tag: [],
	entity_description: [
		{ entityId: 2n, description: "A weary traveler bearing a strange rune-mark on their brow." },
	],
	visible_target_condition: [
		{
			targetKind: { tag: "Entity" },
			targetId: 2n,
			conditionDefinitionId: "test/condition/marked",
			appliedAtTick: 1n,
			expiresAtTick: undefined,
			stackCount: 1n,
			bundleId: "test",
			sourceId: "test/source",
		},
	],
	visible_entity_location: [],
	visible_trace: [],
});
const conditionDetailContext = { db: conditionDetailDb, act: { actorId: "1" } };

describe("spellkave_scene_detail surfaces actor description + conditions (U4)", () => {
	it("surfaces an authored description and a visible condition for an actor that carries them", async () => {
		const listed = await createSceneTool(conditionDetailContext).execute("u4-detail-list", {
			kind: "actor",
		});
		const { items } = listed.details as {
			items: { handle: string; rev: string; id: string }[];
		};
		// biome-ignore lint/style/noNonNullAssertion: fixture guarantees this target
		const target = items.find((item) => item.id === "2")!;
		const detail = await createSceneDetailTool(conditionDetailContext).execute("u4-detail-marked", {
			rev: target.rev,
			handle: target.handle,
		});
		expect(detail.details).toMatchObject({
			status: "ok",
			target: {
				kind: "actor",
				detail: {
					description: "A weary traveler bearing a strange rune-mark on their brow.",
					appearance: "",
					conditions: [
						expect.objectContaining({ condition_definition_id: "test/condition/marked" }),
					],
				},
			},
		});
	});

	it("gracefully shows empty description/conditions for an actor with neither authored", async () => {
		const listed = await createSceneTool(conditionDetailContext).execute("u4-detail-list-plain", {
			kind: "actor",
		});
		const { items } = listed.details as {
			items: { handle: string; rev: string; id: string }[];
		};
		// biome-ignore lint/style/noNonNullAssertion: fixture guarantees this target
		const target = items.find((item) => item.id === "3")!;
		const detail = await createSceneDetailTool(conditionDetailContext).execute("u4-detail-plain", {
			rev: target.rev,
			handle: target.handle,
		});
		expect(detail.details).toMatchObject({
			status: "ok",
			target: { kind: "actor", detail: { description: "", appearance: "", conditions: [] } },
		});
	});
});

describe("dual-shape scene tool (#1931 merge)", () => {
	it("orients on the implicit current scene without a remote node argument (complete branch)", async () => {
		const tool = createSceneTool(context);
		expect((tool.parameters as { properties?: object }).properties).not.toHaveProperty("node_id");
		const result = await tool.execute("scene", {});
		expect(result.details).toMatchObject({
			node_id: "inn",
			node_description: "Warm light.",
			counts: { actor: 1, entity: 1, exit: 1, trace: 1 },
			listing: "complete",
		});
		const items = (result.details as { items: { handle: string; label: string }[] }).items;
		expect(items).toHaveLength(4);
		// T12: the handle is the target's stable identity (kind:id), not a
		// list position — "actor" sorts first, and the connected actor (Hero,
		// entityId 1) is excluded from its own scene, leaving Innkeeper (id 2).
		expect(items[0]).toMatchObject({ handle: "s:actor:2", label: "Innkeeper" });
	});

	it("returns listing:'complete' for a 13-40 target scene — proves the cutoff is 40, not 12", async () => {
		const result = await createSceneTool(manyContext).execute("scene-many", {});
		expect(result.details).toMatchObject({ listing: "complete", node_id: "market" });
		const items = (result.details as { items: unknown[] }).items;
		expect(items).toHaveLength(MANY_TARGET_COUNT);
	});

	it("falls back to the paginated envelope when the bound is exceeded, carrying the same node prose", async () => {
		const first = await createSceneTool(context).execute("targets", { limit: 2 });
		expect(first.details).toMatchObject({
			listing: "paginated",
			shown: 2,
			matched: 4,
			truncated: true,
			node_id: "inn",
			node_description: "Warm light.",
		});
		const details = first.details as {
			next_cursor: string;
			items: { handle: string; rev: string }[];
		};
		const detail = await createSceneDetailTool(context).execute("detail", {
			rev: details.items[0]?.rev ?? "",
			handle: details.items[0]?.handle ?? "",
		});
		expect(detail.details).toMatchObject({
			status: "ok",
			target: { kind: "actor", label: "Innkeeper" },
		});
		const second = await createSceneTool(context).execute("targets-2", {
			limit: 2,
			cursor: details.next_cursor,
		});
		expect(second.details).toMatchObject({
			listing: "paginated",
			shown: 2,
			matched: 4,
			truncated: false,
		});
	});

	it("forces the paginated envelope on a kind filter even under the bound", async () => {
		const result = await createSceneTool(context).execute("targets-kind", { kind: "exit" });
		expect(result.details).toMatchObject({ listing: "paginated", matched: 1 });
	});

	it("rejects stale and cross-domain handles", async () => {
		const detail = createSceneDetailTool(context);
		const targets = await createSceneTool(context).execute("targets", {});
		const { items } = targets.details as { items: { handle: string; rev: string }[] };
		// biome-ignore lint/style/noNonNullAssertion: fixture guarantees at least one target
		const first = items[0]!;
		// T12: a REAL handle with a WRONG (caller-stale-copied) rev — the
		// genuine per-target staleness case, not a made-up unknown identity.
		expect(
			(await detail.execute("stale", { rev: "old", handle: first.handle })).details,
		).toMatchObject({
			status: "stale_handle",
			// #1932: guidance names the orientation tool to re-read, not just the code.
			reason: expect.stringContaining("spellkave_scene"),
		});
		expect(
			(await detail.execute("cross", { rev: first.rev, handle: "h:0" })).details,
		).toMatchObject({
			status: "unknown_handle",
			reason: expect.stringContaining("spellkave_scene"),
		});
	});

	// #1932 (audit rows 28/30): the merged tool's null-scene case used to be an
	// indistinguishable empty-but-"complete" page.
	it("surfaces a scene_resolved:false signal and reason when no current scene resolves", async () => {
		const unplacedContext = { db, act: { actorId: "99" } }; // entity 99 has no spatial location row
		const result = await createSceneTool(unplacedContext).execute("no-scene", {});
		expect(result.details).toMatchObject({
			listing: "complete",
			node_id: null,
			scene_resolved: false,
			reason: expect.stringContaining("No current scene resolved"),
		});
	});

	// Direct factories now share browser-host validation: a kind outside the
	// canonical contract is rejected before the execution body sees it.
	it("rejects a kind outside the canonical contract", async () => {
		await expect(
			createSceneTool(context).execute("kind-miss", { kind: "item" as never }),
		).rejects.toMatchObject({
			name: "ToolArgumentValidationError",
			toolName: "spellkave_scene",
		});
	});

	it("executes exits through the shared canonical affordance dispatcher", async () => {
		const calls: string[] = [];
		const actionContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					// biome-ignore lint/suspicious/noExplicitAny: stub client — this test exercises the tool surface, not the receipt shape.
					move: async (edgeId: string): Promise<any> => {
						calls.push(edgeId);
						return { status: "success" };
					},
				},
			},
		};
		const listed = await createSceneTool(actionContext).execute("exits", { kind: "exit" });
		const details = listed.details as { items: { handle: string; rev: string }[] };
		const acted = await createMoveTool(actionContext).execute("act", {
			rev: details.items[0]?.rev ?? "",
			handle: details.items[0]?.handle ?? "",
		});
		expect(calls).toEqual(["7"]);
		// #1921: the receipt nests under `receipt`, sibling to `observation`. This
		// fixture's mocked move success carries no `to_node`, so there is no
		// destination to describe — the documented gap, not a fabricated line.
		expect(acted.details).toMatchObject({
			receipt: { status: "dispatched", verb_class: "movement" },
			observation: null,
		});
	});

	it("rejects stale/cross-domain exits and preserves reducer rejection", async () => {
		const rejectingContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					// biome-ignore lint/suspicious/noExplicitAny: stub client — this test exercises the tool surface, not the receipt shape.
					move: async (): Promise<any> => ({ status: "rejected", reason: "blocked" }),
				},
			},
		};
		const listed = await createSceneTool(rejectingContext).execute("exits", {
			kind: "exit",
		});
		const details = listed.details as { items: { handle: string; rev: string }[] };
		const handle = details.items[0]?.handle ?? "";
		const rev = details.items[0]?.rev ?? "";
		const tool = createMoveTool(rejectingContext);
		expect((await tool.execute("stale", { rev: "old", handle })).details).toMatchObject({
			status: "stale_handle",
		});
		expect((await tool.execute("cross", { rev, handle: "h:0" })).details).toMatchObject({
			status: "unknown_handle",
		});
		expect((await tool.execute("blocked", { rev, handle })).details).toMatchObject({
			receipt: {
				status: "dispatched",
				// #1932 (audit row 38/Patterns §4): a caller checking only the top-level
				// field can now tell accept from reject without inspecting `move`.
				outcome: "rejected",
				move: { status: "rejected", reason: "blocked" },
			},
			// #1921: a rejected outcome perceives no world-state change.
			observation: "Nothing happens.",
		});
	});

	// #1932 (audit row 36): resolving a non-exit handle used to have no reason.
	it("names the correct follow-up tool when the resolved handle is not an exit", async () => {
		const listed = await createSceneTool(context).execute("non-exit", { kind: "actor" });
		const details = listed.details as { items: { handle: string; rev: string }[] };
		const handle = details.items[0]?.handle ?? "";
		const result = await createMoveTool(context).execute("wrong-kind", {
			rev: details.items[0]?.rev ?? "",
			handle,
		});
		expect(result.details).toMatchObject({
			status: "unsupported_scene_action",
			reason: expect.stringContaining("relevant direct action tool"),
		});
	});

	// ADR-0091 (T8 slice 1b): movement is attempt-based — no affordance cache
	// opinion ever exists for an exit, so a scene read needs no "is the cache
	// stale" signal at all. #1968 B2's zero-exit-count problem is moot: exits
	// are always read from raw place-graph geometry, unconditionally.
	it("lists an ungated exit with no cache opinion needed (ADR-0091)", async () => {
		const result = await createSceneTool(ungatedExitContext).execute("ungated-exit", {});
		expect(result.details).toMatchObject({
			scene_resolved: true,
			counts: { exit: 1 },
		});
		expect(result.details).not.toHaveProperty("reason");
		const items = (
			result.details as {
				items: { kind: string; traversal_gates?: { template_id: string; mode_id: string }[] }[];
			}
		).items;
		const exit = items.find((item) => item.kind === "exit");
		expect(exit).not.toHaveProperty("traversal_gates");
	});

	// #1987: a blocked exit is PERCEIVABLE and names what stands there — the
	// thing that was previously invisible. It does NOT claim to know why you
	// cannot pass: client-side, a failed predicate and an unbuilt palette are
	// the same absence, so the stale heuristic stays deliberately approximate.
	it("lists a gated exit as blocked and names the gate (#1987)", async () => {
		const result = await createSceneTool(gatedExitContext).execute("gated-exit", {});
		const details = result.details as {
			counts: { exit: number };
			items: { kind: string; traversal_gates?: { template_id: string; mode_id: string }[] }[];
		};

		expect(details.counts).toMatchObject({ exit: 1 });
		// Legible in the LISTING, not only via a per-handle detail fetch.
		const exit = details.items.find((item) => item.kind === "exit");
		// ADR-0101 D-1: each gate now carries its mode_id ("" = implicit default mode).
		expect(exit?.traversal_gates).toEqual([{ template_id: "demo/gate_template", mode_id: "" }]);
	});

	// T8 slice 1a: acting on a gated exit is now an ATTEMPT, not a client-side
	// refusal. The named gate travels along as `traversal_gates` — legible
	// context for why the attempt was risky — but r_move, not the cache, gives
	// the authoritative verdict; a rejection is reported honestly, never thrown.
	it("attempts a gated exit instead of refusing, carrying the gate as advisory context (T8 slice 1a)", async () => {
		const calls: string[] = [];
		const actionContext = {
			db: gatedExitDb,
			act: {
				actorId: "1",
				actorClient: {
					// biome-ignore lint/suspicious/noExplicitAny: stub client — this test exercises the tool surface, not the receipt shape.
					move: async (edgeId: string): Promise<any> => {
						calls.push(edgeId);
						return {
							status: "rejected",
							reason: "predicate_no_longer_holds",
							provenance: {
								failure_kind: "predicate_no_longer_holds",
								failure_detail: "demo/gate_template predicate unsatisfied",
							},
						};
					},
				},
			},
		};
		const listed = await createSceneTool(actionContext).execute("gated-exit", {});
		const { items } = listed.details as {
			items: { kind: string; handle: string; rev: string }[];
		};
		// biome-ignore lint/style/noNonNullAssertion: fixture guarantees the exit
		const exit = items.find((item) => item.kind === "exit")!;

		const result = await createMoveTool(actionContext).execute("act-gated", {
			rev: exit.rev,
			handle: exit.handle,
		});
		// The cache named a gate; the dispatch happens anyway — the gate is
		// advisory, never a reason to skip asking r_move.
		expect(calls).toEqual(["47"]);
		expect(result.details).toMatchObject({
			receipt: {
				status: "dispatched",
				verb_class: "movement",
				outcome: "rejected",
				move: {
					status: "rejected",
					reason: "predicate_no_longer_holds",
					failure_detail: "demo/gate_template predicate unsatisfied",
				},
			},
			traversal_gates: [{ template_id: "demo/gate_template", mode_id: "" }],
			observation: "Nothing happens.",
		});
	});

	// ADR-0091 (T8 slice 1b): an ungated exit attempts with no advisory context
	// at all — there is no gate to name and no cache opinion to caveat, so the
	// dispatch carries only the receipt/observation, nothing extra.
	it("attempts an ungated exit with no advisory context (ADR-0091)", async () => {
		const calls: string[] = [];
		const actionContext = {
			db: ungatedExitDb,
			act: {
				actorId: "1",
				actorClient: {
					// biome-ignore lint/suspicious/noExplicitAny: stub client — this test exercises the tool surface, not the receipt shape.
					move: async (edgeId: string): Promise<any> => {
						calls.push(edgeId);
						return { status: "success", to_node: "next_cell" };
					},
				},
			},
		};
		const listed = await createSceneTool(actionContext).execute("ungated-exit-act", {
			kind: "exit",
		});
		const { items } = listed.details as { items: { handle: string; rev: string }[] };
		const handle = items[0]?.handle ?? "";
		const rev = items[0]?.rev ?? "";

		const result = await createMoveTool(actionContext).execute("act-ungated", { rev, handle });
		expect(calls).toEqual(["9"]);
		expect(result.details).toMatchObject({
			receipt: { status: "dispatched", verb_class: "movement", outcome: "accepted" },
		});
		expect(result.details).not.toHaveProperty("traversal_gates");
		expect(result.details).not.toHaveProperty("advisory_note");
	});

	// T2 (operator-review dry-run, 2026-08-04): exit rows carry their
	// destination inline so an agent no longer has to round-trip through
	// spellkave_scene_detail per exit candidate just to learn to_node_id.
	it("an exit row carries `to` with its destination node id", async () => {
		const result = await createSceneTool(context).execute("scene-to", {});
		const items = (result.details as { items: { kind: string; to?: string }[] }).items;
		const exit = items.find((item) => item.kind === "exit");
		expect(exit?.to).toBe("road");
	});

	it("non-exit rows carry no `to` field", async () => {
		const result = await createSceneTool(context).execute("scene-to-non-exit", {});
		const items = (result.details as { items: { kind: string; to?: string }[] }).items;
		for (const item of items.filter((i) => i.kind !== "exit")) {
			expect(item).not.toHaveProperty("to");
		}
	});

	it("the paginated shape carries the same `to` field on exit rows", async () => {
		const result = await createSceneTool(context).execute("scene-to-paginated", { kind: "exit" });
		expect(result.details).toMatchObject({ listing: "paginated" });
		const items = (result.details as { items: { kind: string; to?: string }[] }).items;
		expect(items[0]?.to).toBe("road");
	});

	it("truncates `to` by the leading path segment shared with the current node", async () => {
		const result = await createSceneTool(truncationContext).execute("scene-to-truncate", {
			kind: "exit",
		});
		const items = (result.details as { items: { id: string; to?: string }[] }).items;
		const toStairs = items.find((item) => item.id === "1");
		expect(toStairs?.to).toBe("stairs");
	});

	it("keeps the full path when the destination belongs to a different graph", async () => {
		const result = await createSceneTool(truncationContext).execute("scene-to-cross-graph", {
			kind: "exit",
		});
		const items = (result.details as { items: { id: string; to?: string }[] }).items;
		const toDungeon = items.find((item) => item.id === "2");
		expect(toDungeon?.to).toBe("dungeon/entrance");
	});

	it("spellkave_scene_detail keeps the canonical, untruncated to_node_id", async () => {
		const listed = await createSceneTool(truncationContext).execute("scene-detail-to", {
			kind: "exit",
		});
		const { items } = listed.details as {
			items: { handle: string; rev: string; id: string }[];
		};
		const found = items.find((item) => item.id === "1");
		const detail = await createSceneDetailTool(truncationContext).execute("detail-to", {
			rev: found?.rev ?? "",
			handle: found?.handle ?? "",
		});
		expect(detail.details).toMatchObject({
			status: "ok",
			target: { detail: { to_node_id: "town/stairs" } },
		});
	});
});

// T7 (act_scene -> spellkave_move rename, absorbing the deprecated raw
// edge-id spellkave_move wrapper): the compatibility {edge_id} addressing
// mode, ported verbatim from the retired wrapper's own coverage plus one new
// invalid-params proof for the "exactly one mode" rule.
describe("spellkave_move raw edge_id compatibility mode (T7)", () => {
	function actorDb(): SnapshotDb {
		return {
			visible_entity_tag: { iter: () => [] },
			visible_entity_tag_coverage: { iter: () => [{ status: "complete", projectionVersion: 1 }] },
			world_time: { iter: () => [{ tick: 1n }].values() },
			visible_manifest_authored_entity_coverage: {
				iter: () => [{ status: "complete", projectionVersion: 1 }],
			},
			visible_manifest_authored_entity: {
				iter: () => [{ manifestKey: "core:actor:scout", bundleId: "core", entityId: 11n }].values(),
			},
			visible_actor_spatial_location: {
				iter: () => [{ entityId: 11n, placeNodeId: "tavern" }].values(),
			},
			visible_place_node: { iter: () => [{ nodeId: "tavern" }].values() },
			visible_place_edge: { iter: () => [].values() },
		};
	}

	it("delegates to a host-supplied actorClient.move (session-wired path), returning the flat edge_id shape", async () => {
		const moveCalls: string[] = [];
		let snapshotPathCalled = false;
		const actorClient: SpellkaveActorContext["actorClient"] = {
			// biome-ignore lint/suspicious/noExplicitAny: stub — this test exercises move only.
			manipulate: async (): Promise<any> => ({ status: "success" }),
			// biome-ignore lint/suspicious/noExplicitAny: minimal success-shaped verdict
			move: async (edgeId: string): Promise<any> => {
				moveCalls.push(edgeId);
				return {
					status: "success",
					actor_id: "11",
					edge_id: edgeId,
					from_node: "tavern",
					to_node: "square",
					observedAtTick: 42n,
				};
			},
		};
		const context: SpellkaveToolContext = {
			db: actorDb(),
			act: { actorId: "11", actorClient },
			move: {
				actorId: "11",
				callRMove: async () => {
					snapshotPathCalled = true;
				},
			},
		};
		const tool = createMoveTool(context);
		const result = await tool.execute("mv", { edge_id: " 7 " });
		expect(moveCalls).toEqual(["7"]);
		expect(snapshotPathCalled).toBe(false);
		expect((result.details as { edge_id: string }).edge_id).toBe("7");
		expect((result.details as { to_node: string }).to_node).toBe("square");
		expect((result.details as { observed_at_tick: string }).observed_at_tick).toBe("42");
	});

	it("falls back to context.move snapshot path when actorClient absent", async () => {
		const reducerCalls: unknown[] = [];
		const actorRow: Record<string, unknown> = { entityId: 11n, placeNodeId: "tavern" };
		const db: SnapshotDb = {
			visible_entity_tag: { iter: () => [] },
			visible_entity_tag_coverage: { iter: () => [{ status: "complete", projectionVersion: 1 }] },
			world_time: { iter: () => [{ tick: 1n }].values() },
			visible_manifest_authored_entity_coverage: {
				iter: () => [{ status: "complete", projectionVersion: 1 }],
			},
			visible_manifest_authored_entity: {
				iter: () => [{ manifestKey: "core:actor:scout", bundleId: "core", entityId: 11n }].values(),
			},
			visible_actor_spatial_location: { iter: () => [actorRow].values() },
			visible_place_node: { iter: () => [{ nodeId: "tavern" }, { nodeId: "square" }].values() },
			visible_place_edge: {
				iter: () => [{ edgeId: 7n, fromNodeId: "tavern", toNodeId: "square" }].values(),
			},
		};
		const context: SpellkaveToolContext = {
			db,
			move: {
				actorId: "11",
				callRMove: async (args) => {
					reducerCalls.push(args);
					actorRow.placeNodeId = "square";
				},
			},
		};
		const tool = createMoveTool(context);
		const result = await tool.execute("mv", { edge_id: "7" });
		expect(reducerCalls).toHaveLength(1);
		expect((result.details as { to_node: string }).to_node).toBe("square");
	});

	it("rejects a call that gives both addressing modes at once", async () => {
		const context: SpellkaveToolContext = { db: actorDb(), act: { actorId: "11" } };
		const result = await createMoveTool(context).execute("both", {
			rev: "r0",
			handle: "s0",
			edge_id: "7",
		});
		expect(result.details).toMatchObject({ status: "invalid_move_params" });
	});

	it("rejects a call that gives neither addressing mode", async () => {
		const context: SpellkaveToolContext = { db: actorDb(), act: { actorId: "11" } };
		const result = await createMoveTool(context).execute("neither", {});
		expect(result.details).toMatchObject({ status: "invalid_move_params" });
	});
});

// T5 extension (PR #2115 review thread, operator-approved 2026-08-06): the
// original T5 fix (0c3d98958) only suppressed the repeated graph_description
// blurb on the move-ARRIVAL observation path — spellkave_scene's own
// orientation read used to repeat it on every call. Proven here through the
// REGISTRY entry point (`createSpellkaveTools`, which applies
// `withSceneGraphSuppression`), never through the bare `createSceneTool(context)`
// factory used everywhere else in this file — that individual-factory path
// deliberately stays unwrapped (same boundary `withWorldDeltas`'s own module
// comment draws in tools.ts), so a fresh cursor per test would otherwise mask
// the very behavior under test. The tool reference is grabbed ONCE and
// `.execute()`d repeatedly on that SAME reference (the `world-deltas.test.ts`
// idiom) — a fresh `createSpellkaveTools(...)` call per assertion would prime
// a brand-new cursor every time and never observe suppression.
describe("spellkave_scene graph_description suppression (T5 extension)", () => {
	function twoGraphDb(actorRow: { placeNodeId: string }): SnapshotDb {
		return snapshotDbFromFixture({
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 1n }],
			visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: actorRow.placeNodeId }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			visible_place_node: [
				{
					nodeId: "town/inn",
					placeGraphId: "town",
					description: "",
					posPresent: false,
				},
				{
					nodeId: "dungeon/hall",
					placeGraphId: "dungeon",
					description: "",
					posPresent: false,
				},
			],
			visible_place_graph_definition: [
				{ placeGraphId: "town", description: "The Mountain View Inn — three creaking floors." },
				{ placeGraphId: "dungeon", description: "A dank, cold tomb." },
			],
			visible_place_edge: [],
			visible_affordance: [],
			affordance_template: [],
			entity: [{ entityId: 1n, name: "Hero", kind: "actor", quantity: 1n }],
			visible_entity_tag: [],
			visible_entity_location: [],
			visible_trace: [],
		});
	}

	// `snapshotDbFromFixture` closes over the passed row arrays directly (no
	// clone), so mutating `actorRow.placeNodeId` between calls and re-passing
	// it through a getter-backed `context.db` simulates the actor moving
	// without needing a real move dispatch — same idiom the T7 describe block
	// above uses for `actorRow.placeNodeId = "square"`.
	it("shows the blurb once per graph, suppresses repeats, and un-suppresses on a graph switch", async () => {
		const actorRow = { placeNodeId: "town/inn" };
		const context: SpellkaveToolContext = {
			db: () => twoGraphDb(actorRow),
			act: { actorId: "1" },
		};
		const tools = createSpellkaveTools(context);
		const scene = tools.find((tool) => tool.name === "spellkave_scene");
		if (scene === undefined) throw new Error("spellkave_scene not registered");

		const first = await scene.execute("scene-1", {});
		expect(first.details).toMatchObject({
			node_id: "town/inn",
			graph_description: "The Mountain View Inn — three creaking floors.",
		});

		const second = await scene.execute("scene-2", {});
		expect(second.details).toMatchObject({ node_id: "town/inn", graph_description: null });

		actorRow.placeNodeId = "dungeon/hall";
		const third = await scene.execute("scene-3", {});
		expect(third.details).toMatchObject({
			node_id: "dungeon/hall",
			graph_description: "A dank, cold tomb.",
		});

		const fourth = await scene.execute("scene-4", {});
		expect(fourth.details).toMatchObject({ node_id: "dungeon/hall", graph_description: null });

		actorRow.placeNodeId = "town/inn";
		const fifth = await scene.execute("scene-5", {});
		expect(fifth.details).toMatchObject({
			node_id: "town/inn",
			graph_description: "The Mountain View Inn — three creaking floors.",
		});
	});

	it("bare createSceneTool(context) stays unwrapped — every call repeats the blurb", async () => {
		const context: SpellkaveToolContext = {
			db: twoGraphDb({ placeNodeId: "town/inn" }),
			act: { actorId: "1" },
		};
		const tool = createSceneTool(context);
		const first = await tool.execute("scene-1", {});
		const second = await tool.execute("scene-2", {});
		expect(first.details).toMatchObject({
			graph_description: "The Mountain View Inn — three creaking floors.",
		});
		expect(second.details).toMatchObject({
			graph_description: "The Mountain View Inn — three creaking floors.",
		});
	});
});
