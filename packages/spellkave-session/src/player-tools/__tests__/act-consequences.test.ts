// sk-0m4.74: integration-level proof of the `consequences` register —
// `spellkave_act_affordance` (manipulate) and `spellkave_move` take
// same-tick, caused-by-me `WorldEvent`s off the host-injected builder right
// after a successful dispatch, distinct from the `pushes` register the SAME
// builder later drains (reaction/world news) and from the reducer's own
// `receipt`/`observation` (outcome). Uses the REAL `createWorldEventBuilder`,
// not a mock — same harness discipline as `push-events.test.ts` and
// `act-affordance-communicate-reply.test.ts` (its `communicate` reply-window
// sibling).

import { asEntityRef, type SnapshotDb } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import { createWorldEventBuilder, type WorldEvent } from "../push-events";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";
import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

const ACTOR_ID = asEntityRef("1");
const OTHER_ATTACKER_ID = "9";

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

function toolByName(context: SpellkaveToolContext, name: string): AgentTool {
	const tool = createSpellkaveTools(context).find((t) => t.name === name);
	if (!tool) throw new Error(`tool not found: ${name}`);
	return tool as AgentTool;
}

/**
 * One manipulate affordance targeting entity "2" ("Crypt Warden"), plus every table
 * `createWorldEventBuilder`'s domain scans unconditionally read every call —
 * same table set `act-affordance-communicate-reply.test.ts`'s `fixture()`
 * uses, minus communicate-specific rows, plus `entity` rows for both the
 * actor and its target (`dealt_hit`'s `target_name` resolves through
 * `buildEntityNameMap`).
 */
function attackFixture(): {
	db: SnapshotDb;
	resourceDeltaRows: Record<string, unknown>[];
} {
	const resourceDeltaRows: Record<string, unknown>[] = [];
	const db = makeDb({
		world_time: [{ tick: 3n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		session: [],
		session_participant: [],
		visible_turn_state: [],
		visible_pending_resolution: [],
		visible_pending_resolution_reactor: [],
		visible_pending_stochastic_resolution: [],
		visible_event_resource_delta: resourceDeltaRows,
		visible_affordance: [
			{
				affordanceId: 8n,
				perceiverEntityId: 1n,
				targetEntityId: 2n,
				targetRef: { tag: "Entity", value: 2n },
				derivedByTemplateId: "srd/attack/melee/affordance",
				actionId: "srd/attack/melee",
				interactionDescriptor: "manipulation.action_id=srd/attack/melee",
				derivedFrom: "",
				expiresAtTick: undefined,
				derivedAtTick: 0,
				bundleId: "test",
			},
		],
		affordance_template: [
			{
				templateId: "srd/attack/melee/affordance",
				displayName: "Attack",
				capabilityId: "srd/attack/melee",
			},
		],
		visible_trace: [],
		entity: [
			{ entityId: 1n, name: "Hero" },
			{ entityId: 2n, name: "Crypt Warden" },
		],
		visible_entity_tag: [],
	});
	return { db, resourceDeltaRows };
}

/** Same shape as {@link attackFixture}, but the one affordance is a
 * self-targeted no-op ("brace") — used for the "another actor's same-tick
 * hit lands during my act" scenario, where MY dispatch itself causes
 * nothing. */
function braceFixture(): {
	db: SnapshotDb;
	resourceDeltaRows: Record<string, unknown>[];
} {
	const resourceDeltaRows: Record<string, unknown>[] = [];
	const db = makeDb({
		world_time: [{ tick: 3n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		session: [],
		session_participant: [],
		visible_turn_state: [],
		visible_pending_resolution: [],
		visible_pending_resolution_reactor: [],
		visible_pending_stochastic_resolution: [],
		visible_event_resource_delta: resourceDeltaRows,
		visible_affordance: [
			{
				affordanceId: 9n,
				perceiverEntityId: 1n,
				targetEntityId: 1n,
				targetRef: { tag: "Entity", value: 1n },
				derivedByTemplateId: "test/brace/affordance",
				actionId: "test/brace",
				interactionDescriptor: "manipulation.action_id=test/brace",
				derivedFrom: "",
				expiresAtTick: undefined,
				derivedAtTick: 0,
				bundleId: "test",
			},
		],
		affordance_template: [
			{ templateId: "test/brace/affordance", displayName: "Brace", capabilityId: "test/brace" },
		],
		visible_trace: [],
		entity: [{ entityId: 1n, name: "Hero" }],
		visible_entity_tag: [],
	});
	return { db, resourceDeltaRows };
}

describe("sk-0m4.74: spellkave_manipulate consequences register", () => {
	it("attack: consequences holds dealt_hit + self_resource_spent, and a subsequent drain does NOT repeat them", async () => {
		const { db, resourceDeltaRows } = attackFixture();
		const builder = createWorldEventBuilder(
			() => db,
			() => ACTOR_ID,
		);
		builder.diffAndAdvance(); // host priming, same as startDaemon's construction-time call

		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: ACTOR_ID,
				actorClient: {
					manipulate: async <T>(target: string, action: string) => {
						// Two same-tick, same-transaction effects of MY OWN dispatch: a
						// dealt hit on the target, and a self resource spend (e.g. a
						// combat maneuver resource). Pushed SYNCHRONOUSLY — consequences
						// never poll or wait (module header).
						resourceDeltaRows.push(
							{
								eventId: "d1",
								entityId: 2n,
								resourceId: "srd/hp",
								delta: -6,
								newValue: 4,
								templateId: "srd/attack/melee/success",
								sourceEntityRef: "1",
							},
							{
								eventId: "d2",
								entityId: 1n,
								resourceId: "test/maneuver-uses",
								delta: -1,
								newValue: 2,
								templateId: "test/maneuver/success",
								sourceEntityRef: "1",
							},
						);
						return {
							status: "success" as const,
							actor_id: ACTOR_ID,
							target_id: target,
							action_id: action,
							snapshot: null as T,
							lagWarning: false,
							observedAtTick: 3n,
						};
					},
				},
			},
			worldEvents: { builder },
		};

		const result = await toolByName(context, "spellkave_manipulate").execute("act", {
			target_id: "entity:2",
			action_id: "srd/attack/melee",
			args_json: "{}",
		});

		const details = result.details as { consequences?: WorldEvent[] };
		// Oldest-first by event id within one drain (2026-11-12 compatibility
		// decision, `ledger/designs/unified-world-event-stream.md`): the hit
		// (d1) is told before the spend (d2). Before that decision the order
		// was kind by kind, spend first.
		expect(details.consequences).toEqual<WorldEvent[]>([
			{
				kind: "dealt_hit",
				target_name: "Crypt Warden",
				amount: 6,
				attacker_id: "1",
				observed_at_tick: 3,
			},
			{
				kind: "self_resource_spent",
				resource_id: "test/maneuver-uses",
				amount: 1,
				new_value: 2,
				source: "test/maneuver/success",
				observed_at_tick: 3,
			},
		]);

		// The daemon drains the SAME builder right after the invoke resolves
		// (`SessionDispatcher.withPushes`). That later drain must NOT re-deliver
		// what `consequences` already took.
		const pushes = builder.diffAndAdvance();
		expect(pushes).toEqual([]);
	});

	it("another actor's same-tick hit on me: stays in the drain as self_hit, never in consequences", async () => {
		const { db, resourceDeltaRows } = braceFixture();
		const builder = createWorldEventBuilder(
			() => db,
			() => ACTOR_ID,
		);
		builder.diffAndAdvance(); // priming

		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: ACTOR_ID,
				actorClient: {
					manipulate: async <T>(target: string, action: string) => {
						// MY act itself caused nothing — but another entity's hit on ME
						// lands in the SAME tick (e.g. a simultaneous retaliation). This
						// must never be attributed to my own act.
						resourceDeltaRows.push({
							eventId: "h1",
							entityId: 1n,
							resourceId: "srd/hp",
							delta: -3,
							newValue: 9,
							templateId: "srd/attack/melee/success",
							sourceEntityRef: OTHER_ATTACKER_ID,
						});
						return {
							status: "success" as const,
							actor_id: ACTOR_ID,
							target_id: target,
							action_id: action,
							snapshot: null as T,
							lagWarning: false,
							observedAtTick: 3n,
						};
					},
				},
			},
			worldEvents: { builder },
		};

		const result = await toolByName(context, "spellkave_manipulate").execute("act", {
			target_id: "entity:1",
			action_id: "test/brace",
			args_json: "{}",
		});

		const details = result.details as { consequences?: WorldEvent[] };
		expect(details.consequences).toEqual([]);

		// Never dropped: the self_hit surfaces on the very next drain, exactly
		// once, attributed to the actual attacker.
		const pushes = builder.diffAndAdvance();
		expect(pushes).toEqual<WorldEvent[]>([
			{
				kind: "self_hit",
				resource_id: "srd/hp",
				amount: 3,
				new_value: 9,
				attack_kind: "srd/attack/melee/success",
				attacker_id: OTHER_ATTACKER_ID,
				observed_at_tick: 3,
			},
		]);
		expect(builder.diffAndAdvance()).toEqual([]);
	});

	it("no host builder injected: consequences is OMITTED entirely, byte-identical to before this bead", async () => {
		const { db } = attackFixture();
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: ACTOR_ID,
				actorClient: {
					manipulate: async <T>(target: string, action: string) => ({
						status: "success" as const,
						actor_id: ACTOR_ID,
						target_id: target,
						action_id: action,
						snapshot: null as T,
						lagWarning: false,
						observedAtTick: 3n,
					}),
				},
			},
			// No `worldEvents` context at all.
		};

		const result = await toolByName(context, "spellkave_manipulate").execute("act", {
			target_id: "entity:2",
			action_id: "srd/attack/melee",
			args_json: "{}",
		});

		expect(result.details).not.toHaveProperty("consequences");
	});
});

describe("sk-0m4.74: spellkave_move consequences register", () => {
	function moveDb(): {
		db: SnapshotDb;
		resourceDeltaRows: Record<string, unknown>[];
		worldTimeRows: Record<string, unknown>[];
	} {
		const resourceDeltaRows: Record<string, unknown>[] = [];
		const worldTimeRows: Record<string, unknown>[] = [{ tick: 3n }];
		const db = makeDb({
			world_time: worldTimeRows,
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			session: [],
			session_participant: [],
			visible_turn_state: [],
			visible_pending_resolution: [],
			visible_pending_resolution_reactor: [],
			visible_pending_stochastic_resolution: [],
			visible_event_resource_delta: resourceDeltaRows,
			visible_affordance: [],
			affordance_template: [],
			visible_trace: [],
			entity: [{ entityId: 1n, name: "Hero" }],
			visible_entity_tag: [],
			visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "inn" }],
			visible_place_node: [
				{ nodeId: "inn", placeGraphId: "town", description: "Warm light.", posPresent: false },
				{ nodeId: "road", placeGraphId: "town", description: "Remote.", posPresent: false },
			],
			visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
			visible_place_edge: [{ edgeId: 7n, fromNodeId: "inn", toNodeId: "road" }],
		});
		return { db, resourceDeltaRows, worldTimeRows };
	}

	async function exitHandle(
		context: SpellkaveToolContext,
	): Promise<{ rev: string; handle: string }> {
		const listed = await toolByName(context, "spellkave_scene").execute("exits", { kind: "exit" });
		const item = (listed.details as { items: Array<{ handle: string; rev: string }> }).items[0];
		if (item === undefined) throw new Error("expected an exit handle");
		return item;
	}

	it("a promoted long-running move ('travelling'): consequences is present (taken on the ADMITTED dispatch), the travelling result is otherwise unchanged, and a later arrival still arrives exactly once via the drain", async () => {
		const { db, resourceDeltaRows, worldTimeRows } = moveDb();
		const builder = createWorldEventBuilder(
			() => db,
			() => ACTOR_ID,
		);
		builder.diffAndAdvance(); // priming

		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: ACTOR_ID,
				actorClient: {
					move: async () => {
						// A same-tick, same-transaction travel-cost spend the admitted
						// (not yet arrived) dispatch already priced.
						resourceDeltaRows.push({
							eventId: "m1",
							entityId: 1n,
							resourceId: "test/stamina",
							delta: -1,
							newValue: 4,
							templateId: "core/walk_edge/success",
							sourceEntityRef: "1",
						});
						return {
							status: "travelling" as const,
							actor_id: ACTOR_ID,
							edge_id: "7",
							from_node: "inn",
							to_node: "road",
							actor_snapshot: null,
							lagWarning: false,
							observedAtTick: 3n,
							arrives_in_ticks: 4,
							arrives_at_tick: 7,
							session_id: "99",
							reason: "travelling to 'road' — arrives in 4 ticks",
						};
					},
				},
			},
			worldEvents: { builder },
		};

		const { rev, handle } = await exitHandle(context);
		const result = await toolByName(context, "spellkave_move").execute("move", { rev, handle });
		const details = result.details as {
			receipt: { status: string; move: { status: string } };
			observation: string | null;
			consequences?: WorldEvent[];
		};

		// The travelling result itself is unchanged by this bead.
		expect(details.receipt.move.status).toBe("travelling");
		expect(details.observation).toBe("You set off toward road — a journey of about 4 ticks.");

		expect(details.consequences).toEqual<WorldEvent[]>([
			{
				kind: "self_resource_spent",
				resource_id: "test/stamina",
				amount: 1,
				new_value: 4,
				source: "core/walk_edge/success",
				observed_at_tick: 3,
			},
		]);

		// The actor arrives later, at a LATER tick — a session_lifecycle-free,
		// unrelated resource delta landing at that later tick is still delivered
		// exactly once via the ordinary drain, never lost behind the earlier take.
		resourceDeltaRows.push({
			eventId: "m2",
			entityId: 1n,
			resourceId: "srd/xp",
			delta: 1,
			newValue: 1,
			templateId: "test/arrival-bonus/success",
			sourceEntityRef: "1",
		});
		worldTimeRows[0] = { tick: 7n };
		const arrival = builder.diffAndAdvance();
		expect(arrival).toEqual<WorldEvent[]>([
			{
				kind: "xp_gained",
				amount: 1,
				new_value: 1,
				observed_at_tick: 7,
			},
		]);
		expect(builder.diffAndAdvance()).toEqual([]);
	});
});
