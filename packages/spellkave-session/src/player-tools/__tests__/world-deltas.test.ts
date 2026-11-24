// ADR-0083 Stage 2 (piggyback delta channel) — proves the registry wrapper
// (`withWorldDeltas` in tools.ts, backed by `delta-tracker.ts`'s
// `createDeltaTracker`) against the actual wired tool surface, not the
// tracker in isolation: baseline priming stays quiet (D-5), a wholesale
// rematerialization with identical semantic content stays QUIET (the
// operator-review refinement's central "stay calm" guarantee — a semantic
// fingerprint, not row/handle identity, is what makes this possible), and a
// move receipt no longer resends `actor_snapshot` (D-3.2, W1's companion
// strip).
//
// ADR-0093 D-3 (2026-08-06, amends the shape above): the channel is now
// TRIMMED to changes attributable to the carrying call's OWN receipt — a
// successful own move or manipulate. `spellkave_self_states` (a pure read,
// no receipt) is this file's canonical NON-attributable fixture from here
// on: several tests below that used to prove a self_states call surfaces a
// real domain change now prove the OPPOSITE — the change is real, the
// tracker's cursor advances past it (never double-reported later), but
// `world_deltas` reports nothing, because nothing about a plain read's own
// result explains the change. The `spellkave_move` fixtures stay the file's
// attributable case; one test below extends that fixture to show `self`
// (not just `scene`) rides on an attributable call too — the trim is
// domain-wide, not scene-only.
//
// Calling `createSpellkaveTools`/`createSpellkaveTools(...).find(...)` fresh
// per assertion (the `toolByName` idiom other test files in this directory
// use) would prime a NEW tracker on every call — this file grabs the tool
// reference ONCE per test and calls `.execute` on that SAME reference across
// turns, matching how a real session reuses one bound tool.

import { type SnapshotDb, snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";

import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

function makeDb(parts: Record<string, Array<Record<string, unknown>>>): SnapshotDb {
	const out: SnapshotDb = {
		visible_entity_tag: { iter: () => [] },
		visible_entity_tag_coverage: { iter: () => [{ status: "complete", projectionVersion: 1 }] },
	};
	for (const [accessor, rows] of Object.entries(parts)) {
		out[accessor] = { iter: () => rows.values() };
	}
	return out;
}

/** One `visible_affordance` row shape matching `readAffordances`'
 * expectations (act-observation.test.ts's working movement-affordance
 * fixture, adapted to a manipulate verb): `affordanceId`/`derivedAtTick`
 * are the churny, handle/rev-like fields a semantic fingerprint must
 * ignore — `derivedByTemplateId` (-> display_name) and `targetEntityId` (->
 * target_ref/target_entity_name) are the stable identity two DIFFERENT
 * affordance rows can still share. */
function affordanceRow(
	affordanceId: bigint,
	templateId: string,
	targetEntityId: bigint,
	derivedAtTick: bigint,
): Record<string, unknown> {
	return {
		affordanceId,
		perceiverEntityId: 11n,
		targetEntityId,
		targetRef: { tag: "Entity", value: targetEntityId },
		derivedByTemplateId: templateId,
		actionId: "core/attack",
		interactionDescriptor: "manipulation.action_id=core/attack",
		derivedFrom: "",
		expiresAtTick: undefined,
		derivedAtTick,
		bundleId: "test",
	};
}

/** Actor "11" = entity 11, directly controlled, seated at "tavern", one
 * `srd/hp` state pool, one manipulate affordance targeting "Slime Scout"
 * (entity 99). Callers mutate the passed-in arrays/objects between
 * `.execute()` calls to simulate a world change landing in the subscription
 * cache. */
function baseFixture(): {
	db: SnapshotDb;
	affordanceRows: Array<Record<string, unknown>>;
	hpRow: Record<string, unknown>;
} {
	const affordanceRows: Array<Record<string, unknown>> = [
		affordanceRow(1n, "test/attack", 99n, 1n),
	];
	const hpRow: Record<string, unknown> = {
		rowId: 1n,
		targetKind: "entity",
		targetId: "11",
		stateId: "srd/hp",
		value: { tag: "Int", value: 11n },
		setAtTick: 1n,
	};
	const db = makeDb({
		world_time: [{ tick: 1n }],
		directly_controlled_actor_spatial_location: [{ entityId: 11n, placeNodeId: "tavern" }],
		visible_actor_spatial_location: [{ entityId: 11n, placeNodeId: "tavern" }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		owned_object_state: [hpRow],
		resource_definition: [
			{ resourceDefinitionId: "srd/hp", displayName: "Hit Points", valueKind: "int" },
		],
		resource_definition_tag: [],
		entity: [
			{
				entityId: 99n,
				name: "Slime Scout",
				entityDefId: "test/slime",
				kind: "actor",
				quantity: 1n,
			},
		],
		visible_entity_tag: [],
		visible_affordance: affordanceRows,
		affordance_template: [
			{ templateId: "test/attack", displayName: "Melee Attack", capabilityId: "" },
			{ templateId: "test/bandage", displayName: "Bandage Wound", capabilityId: "" },
			{ templateId: "test/walk/affordance", displayName: "Take road", capabilityId: "" },
		],
		visible_entity_containment: [],
		visible_trace: [],
	});
	return { db, affordanceRows, hpRow };
}

function boundSelfStatesTool(context: SpellkaveToolContext): AgentTool {
	const found = createSpellkaveTools(context).find((t) => t.name === "spellkave_self_states");
	if (!found) throw new Error("tool not found: spellkave_self_states");
	return found as AgentTool;
}

describe("ADR-0083 Stage 2: world_deltas piggyback channel", () => {
	it("baseline priming: the first call after construction reports no world_deltas (D-5)", async () => {
		const { db } = baseFixture();
		const context: SpellkaveToolContext = { db, act: { actorId: "11" } };
		const selfStates = boundSelfStatesTool(context);

		const first = await selfStates.execute("c1", {});

		expect((first.details as { world_deltas?: unknown }).world_deltas).toBeUndefined();
		expect(first.content).toHaveLength(1);
	});

	it("ADR-0093 D-3: a NEW affordance is real but reports NOTHING on a non-attributable (read-only) call", async () => {
		const { db, affordanceRows } = baseFixture();
		const context: SpellkaveToolContext = { db, act: { actorId: "11" } };
		const selfStates = boundSelfStatesTool(context);

		await selfStates.execute("c1", {});

		// A genuinely NEW affordance (different template -> different
		// display_name, same target) — not a rematerialization of the
		// existing one (that is the separate "stays quiet" test below). The
		// change is real; `spellkave_self_states` is a pure read with no
		// receipt of its own to attribute it to, so D-3 trims it to push
		// (P2) instead of this piggyback note.
		affordanceRows.push(affordanceRow(2n, "test/bandage", 99n, 2n));
		const second = await selfStates.execute("c2", {});

		expect((second.details as { world_deltas?: unknown }).world_deltas).toBeUndefined();
		expect(second.content).toHaveLength(1);

		// The cursor still advanced past the change (delta-tracker.ts's own
		// `receiptAttributable` contract: trim at the reporting edge, never by
		// skipping the diff) — a later non-attributable call sees no NEW change
		// either, since there was nothing left to catch up on.
		const third = await selfStates.execute("c3", {});
		expect((third.details as { world_deltas?: unknown }).world_deltas).toBeUndefined();
		expect(third.content).toHaveLength(1);
	});

	it("a wholesale rematerialization with IDENTICAL semantic content stays quiet (semantic fingerprint, not row identity — doubly true post-D-3, since this call is also non-attributable)", async () => {
		// The refinement's central guarantee: `visible_affordance` rematerializes
		// almost wholesale on nearly every manipulate (ADR-0083 Context, spike
		// finding) — every row gets a NEW affordanceId/derivedAtTick even when
		// the palette's meaning is unchanged. A fingerprint keyed on
		// affordanceId/handle/rev would misreport that as permanent churn; one
		// keyed on verb_class+display_name+target_ref must not.
		const { db, affordanceRows } = baseFixture();
		const context: SpellkaveToolContext = { db, act: { actorId: "11" } };
		const selfStates = boundSelfStatesTool(context);

		await selfStates.execute("c1", {});

		// Wholesale replace: same template (-> same display_name), same target,
		// but a brand-new affordanceId and derivedAtTick — as if the entire
		// palette re-derived from scratch.
		affordanceRows.length = 0;
		affordanceRows.push(affordanceRow(999n, "test/attack", 99n, 42n));
		const second = await selfStates.execute("c2", {});

		expect((second.details as { world_deltas?: unknown }).world_deltas).toBeUndefined();
		expect(second.content).toHaveLength(1);
	});

	it("ADR-0093 D-3: a self-state change (HP 11 -> 9) is real but reports NOTHING on a non-attributable call (was: surfaced via `self`, #1936/G-2 — now trimmed to push, the exact mechanism finding #98's regression probe migrates to)", async () => {
		const { db, hpRow } = baseFixture();
		const context: SpellkaveToolContext = { db, act: { actorId: "11" } };
		const selfStates = boundSelfStatesTool(context);

		await selfStates.execute("c1", {});

		hpRow.value = { tag: "Int", value: 9n };
		const second = await selfStates.execute("c2", {});

		expect((second.details as { world_deltas?: unknown }).world_deltas).toBeUndefined();
	});

	it("ADR-0093 D-3: a self-state change DOES ride world_deltas.self on a receipt-attributable successful own move (the trim is domain-wide, not scene-only)", async () => {
		const { db, heroLocationRow, hpRow } = moveFixtureWithHp();
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					// biome-ignore lint/suspicious/noExplicitAny: minimal success-shaped verdict.
					move: async (edgeId: string): Promise<any> => {
						heroLocationRow.placeNodeId = "square";
						hpRow.value = { tag: "Int", value: 9n }; // e.g. a hazardous crossing
						return {
							status: "success",
							actor_id: "1",
							edge_id: edgeId,
							from_node: "tavern",
							to_node: "square",
							lagWarning: false,
							observedAtTick: 1n,
						};
					},
				},
			},
		};
		const tools = createSpellkaveTools(context);
		const scene = tools.find((t) => t.name === "spellkave_scene");
		const moveTool = tools.find((t) => t.name === "spellkave_move");
		if (!scene || !moveTool) throw new Error("expected spellkave_scene/spellkave_move");

		const sceneResult = await scene.execute("s", { kind: "exit" });
		const { items } = sceneResult.details as { items: { rev: string; handle: string }[] };
		const result = await moveTool.execute("a", {
			rev: items[0]?.rev ?? "",
			handle: items[0]?.handle ?? "",
		});

		const deltas = (
			result.details as {
				world_deltas?: { self?: Array<{ state_id: string; prev: string | null; value: string }> };
			}
		).world_deltas;
		expect(deltas?.self).toEqual([{ state_id: "srd/hp", prev: "11", value: "9" }]);
	});

	it("spellkave_move (rev+handle mode) receipt no longer resends actor_snapshot (D-3.2)", async () => {
		// Same working exit fixture shape as
		// act-observation.test.ts's "spellkave_move (rev+handle mode) reports the
		// destination's authored node_description on a successful move".
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 1n }],
			visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "tavern" }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			visible_place_node: [
				{ nodeId: "tavern", placeGraphId: "town", description: "", posPresent: false },
				{
					nodeId: "square",
					placeGraphId: "town",
					description: "A bustling market square.",
					posPresent: false,
				},
			],
			visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
			visible_place_edge: [{ edgeId: 7n, fromNodeId: "tavern", toNodeId: "square" }],
			visible_affordance: [
				{
					affordanceId: 70n,
					perceiverEntityId: 1n,
					targetEntityId: 0n,
					targetRef: { tag: "PlaceEdge", value: 7n },
					derivedByTemplateId: "test/walk/affordance",
					actionId: "",
					interactionDescriptor: "movement.descriptor=test/walk",
					derivedFrom: "",
					expiresAtTick: undefined,
					derivedAtTick: 1n,
					bundleId: "test",
				},
			],
			affordance_template: [
				{ templateId: "test/walk/affordance", displayName: "Take road", capabilityId: "" },
			],
		});
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					// biome-ignore lint/suspicious/noExplicitAny: stub client returning the full ActorMoveSuccess shape, including the actor_snapshot the tool must strip (W1) — this test exercises the tool surface, not the receipt shape.
					move: async (edgeId: string): Promise<any> => ({
						status: "success",
						actor_id: "1",
						edge_id: edgeId,
						from_node: "tavern",
						to_node: "square",
						actor_snapshot: {
							current_node_id: "square",
							states: [{ state_id: "srd/hp", display_name: "Hit Points", value: "11" }],
							conditions: [],
						},
						lagWarning: false,
						observedAtTick: 1n,
					}),
				},
			},
		};
		const tools = createSpellkaveTools(context);
		const scene = tools.find((t) => t.name === "spellkave_scene");
		const moveTool = tools.find((t) => t.name === "spellkave_move");
		if (!scene || !moveTool) throw new Error("expected spellkave_scene/spellkave_move");

		const sceneResult = await scene.execute("s", { kind: "exit" });
		const { items } = sceneResult.details as { items: { rev: string; handle: string }[] };
		const result = await moveTool.execute("a", {
			rev: items[0]?.rev ?? "",
			handle: items[0]?.handle ?? "",
		});

		const receipt = (result.details as { receipt: { move: Record<string, unknown> } }).receipt;
		expect(receipt.move).not.toHaveProperty("actor_snapshot");
		expect(receipt.move).toMatchObject({
			status: "success",
			to_node: "square",
			from_node: "tavern",
		});
	});

	// Filter 2 (operator review, 2026-08-04): a two-node world where "tavern"
	// carries a co-located actor (removed after the move away) and "square"
	// carries a different actor (added after arrival) — the shape that would
	// otherwise report a full "old room's stuff gone, new room's stuff here"
	// swap on every single move.
	function moveFixture(): {
		db: SnapshotDb;
		heroLocationRow: Record<string, unknown>;
		companionLocationRow: Record<string, unknown>;
	} {
		const heroLocationRow: Record<string, unknown> = { entityId: 1n, placeNodeId: "tavern" };
		const companionLocationRow: Record<string, unknown> = { entityId: 22n, placeNodeId: "tavern" };
		const db = snapshotDbFromFixture({
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 1n }],
			visible_actor_spatial_location: [
				heroLocationRow,
				companionLocationRow,
				{ entityId: 99n, placeNodeId: "square" },
			],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			entity: [
				{ entityId: 22n, name: "Old Companion", kind: "actor", quantity: 1n },
				{ entityId: 99n, name: "Slime Scout", kind: "actor", quantity: 1n },
			],
			visible_entity_tag: [],
			visible_place_node: [
				{ nodeId: "tavern", placeGraphId: "town", description: "", posPresent: false },
				{
					nodeId: "square",
					placeGraphId: "town",
					description: "A bustling market square.",
					posPresent: false,
				},
			],
			visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
			visible_place_edge: [{ edgeId: 7n, fromNodeId: "tavern", toNodeId: "square" }],
			visible_affordance: [
				{
					affordanceId: 70n,
					perceiverEntityId: 1n,
					targetEntityId: 0n,
					targetRef: { tag: "PlaceEdge", value: 7n },
					derivedByTemplateId: "test/walk/affordance",
					actionId: "",
					interactionDescriptor: "movement.descriptor=test/walk",
					derivedFrom: "",
					expiresAtTick: undefined,
					derivedAtTick: 1n,
					bundleId: "test",
				},
			],
			affordance_template: [
				{ templateId: "test/walk/affordance", displayName: "Take road", capabilityId: "" },
			],
			visible_entity_containment: [],
			visible_trace: [],
		});
		return { db, heroLocationRow, companionLocationRow };
	}

	/** ADR-0093 D-3: `moveFixture()` plus an `srd/hp` self-state row for the
	 * connected actor — proves the trim's `self` domain generalization rides
	 * on the SAME receipt-attributable move a scene delta already does,
	 * without a bespoke manipulate-receipt fixture. `SnapshotDb` is a plain
	 * index type (`replay.ts`), so layering extra table accessors onto an
	 * already-built `snapshotDbFromFixture` result needs no cast. */
	function moveFixtureWithHp(): ReturnType<typeof moveFixture> & {
		hpRow: Record<string, unknown>;
	} {
		const base = moveFixture();
		const hpRow: Record<string, unknown> = {
			rowId: 1n,
			targetKind: "entity",
			targetId: "1",
			stateId: "srd/hp",
			value: { tag: "Int", value: 11n },
			setAtTick: 1n,
		};
		base.db.owned_object_state = { iter: () => [hpRow] };
		base.db.resource_definition = {
			iter: () => [{ resourceDefinitionId: "srd/hp", displayName: "Hit Points", valueKind: "int" }],
		};
		base.db.resource_definition_tag = { iter: () => [] };
		// `readSelfStates` gates on `isDirectlyControlled` (self.ts) — absent from
		// `moveFixture()`'s own db (it never needed self-state reads before D-3).
		base.db.directly_controlled_actor_spatial_location = {
			iter: () => [{ entityId: 1n, placeNodeId: "tavern" }],
		};
		return { ...base, hpRow };
	}

	it("Filter 2: a successful own move suppresses scene 'removed', keeps 'added'", async () => {
		const { db, heroLocationRow } = moveFixture();
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					// biome-ignore lint/suspicious/noExplicitAny: minimal success-shaped verdict.
					move: async (edgeId: string): Promise<any> => {
						heroLocationRow.placeNodeId = "square"; // the "reducer" moved the actor
						return {
							status: "success",
							actor_id: "1",
							edge_id: edgeId,
							from_node: "tavern",
							to_node: "square",
							lagWarning: false,
							observedAtTick: 1n,
						};
					},
				},
			},
		};
		const tools = createSpellkaveTools(context);
		const scene = tools.find((t) => t.name === "spellkave_scene");
		const moveTool = tools.find((t) => t.name === "spellkave_move");
		if (!scene || !moveTool) throw new Error("expected spellkave_scene/spellkave_move");

		const sceneResult = await scene.execute("s", { kind: "exit" });
		const { items } = sceneResult.details as { items: { rev: string; handle: string }[] };
		const result = await moveTool.execute("a", {
			rev: items[0]?.rev ?? "",
			handle: items[0]?.handle ?? "",
		});

		const deltas = (
			result.details as {
				world_deltas?: { scene?: { added: string[]; removed: string[]; more: number } };
			}
		).world_deltas;
		expect(deltas?.scene).toEqual({ added: ['actor "Slime Scout"'], removed: [], more: 0 });
	});

	it("ADR-0093 D-3: a foreign scene change with no own move now reports NOTHING (was: still reported 'removed' under the pre-D-3 Filter 2 shape)", async () => {
		const { db, companionLocationRow } = moveFixture();
		const context: SpellkaveToolContext = { db, act: { actorId: "1" } };
		const tools = createSpellkaveTools(context);
		const scene = tools.find((t) => t.name === "spellkave_scene");
		if (!scene) throw new Error("expected spellkave_scene");

		await scene.execute("s1", {});

		// The OTHER actor leaves — not the connected actor's own move, and
		// `spellkave_scene` is a pure read with no receipt of its own. D-3:
		// this change is real, but no longer attributable to any call's own
		// receipt, so it travels push (P2) instead of this piggyback note.
		companionLocationRow.placeNodeId = "elsewhere";
		const second = await scene.execute("s2", {});

		expect((second.details as { world_deltas?: unknown }).world_deltas).toBeUndefined();
	});
});
