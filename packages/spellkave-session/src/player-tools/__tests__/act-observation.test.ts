// #1921: integration-level proof that the observation register is wired
// through the live act-tool dispatch path (not just the pure `observation.ts`
// helpers, covered separately in observation.test.ts) — including the
// authorization boundary: a resource change on a CO-LOCATED but different
// entity must never leak into the acting actor's observation.

import { asEntityRef, type SnapshotDb, snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";

import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

const ACTOR_ID = asEntityRef("1");

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

async function manipulate(
	context: SpellkaveToolContext,
	params: { target_id?: string; action_id?: string } = {},
) {
	return toolByName(context, "spellkave_manipulate").execute("act", {
		target_id: params.target_id ?? "item:9",
		action_id: params.action_id ?? "core/inspect",
	});
}

async function nonManipulationHandle(context: SpellkaveToolContext): Promise<string> {
	const targets = await toolByName(context, "spellkave_affordance_targets").execute("a", {});
	const handle = (targets.details as { items: Array<{ handle: string }> }).items[0]?.handle;
	if (handle === undefined) throw new Error("expected a bounded non-manipulation handle");
	return handle;
}

const DIRECT_MANIPULATION_ROWS = {
	world_time: [{ tick: 1n }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	// readSelfStates (the before/after resource-delta source) gates on
	// directly_controlled_actor_spatial_location, distinct from the
	// perceiver-scoped visible_affordance rows below.
	directly_controlled_actor_spatial_location: [{ entityId: 1n }],
};

describe("#1921 observation register — live act-tool dispatch", () => {
	it("spellkave_manipulate reports the acting actor's own resource delta", async () => {
		// A mutable row shared by reference between the "before" and "after"
		// reads — the mock manipulate callback mutates it in place, the same way
		// a live node's subscription cache updates once the reducer's write is
		// observed.
		const heroHp = {
			targetKind: "entity",
			targetId: "1",
			stateId: "srd/hp",
			value: 7,
			sourceTemplateId: "",
			setAtTick: 0,
			expiresAtTick: 0,
			bundleId: "core",
			rowId: 1n,
		};
		const db = makeDb({
			...DIRECT_MANIPULATION_ROWS,
			owned_object_state: [heroHp],
			resource_definition: [
				{ resourceDefinitionId: "srd/hp", displayName: "Hit Points", valueKind: "int" },
			],
		});
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					manipulate: async <T>(target: string, action: string, _args: string) => {
						heroHp.value = 3; // the "reducer" wrote a new HP value
						return {
							status: "success" as const,
							actor_id: ACTOR_ID,
							target_id: target,
							action_id: action,
							snapshot: null as T,
							lagWarning: false,
							observedAtTick: 1n,
						};
					},
				},
			},
		};
		const result = await manipulate(context);
		expect(result.details).toMatchObject({
			receipt: { status: "dispatched", outcome: "accepted" },
			observation: "Hit Points: 7 → 3.",
		});
		expect((result.details as { observation_gap?: string }).observation_gap).toBeUndefined();
	});

	// U1 minimal fix (operator quick-fix 2026-08-04): the manipulate branch's
	// receipt carries a readable `resolution` summary parsed from the SAME
	// provenance.selected_template_ids the receipt already returns, instead of
	// hit/miss being legible only by parsing raw DSL text.
	it("carries a readable resolution summary parsed from provenance.selected_template_ids", async () => {
		const db = makeDb(DIRECT_MANIPULATION_ROWS);
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					manipulate: async <T>(target: string, action: string, _args: string) => ({
						status: "success" as const,
						actor_id: ACTOR_ID,
						target_id: target,
						action_id: action,
						snapshot: null as T,
						provenance: {
							id: "r_manipulate:1:1",
							kind: "Affordance",
							status: "Succeeded",
							subject_id: "1",
							failure_kind: "",
							failure_detail: "",
							selected_template_ids: [
								"srd/attack/melee/affordance",
								"resolution_mode:stochastic:predicate=x",
								"resolution_result:true",
								"resolution_branch:on_success",
								"resolution_consequence:srd/attack/melee/success",
							],
							created_at_tick: 1n,
							bundle_id: "srd",
						},
						lagWarning: false,
						observedAtTick: 1n,
					}),
				},
			},
		};
		const result = await manipulate(context);
		expect(result.details).toMatchObject({
			receipt: {
				status: "dispatched",
				resolution: {
					mode: "stochastic",
					result: "success",
					consequence: "srd/attack/melee/success",
				},
			},
		});
	});

	it("omits `resolution` for a non-stochastic manipulate outcome (no resolution_* lines)", async () => {
		const db = makeDb(DIRECT_MANIPULATION_ROWS);
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					manipulate: async <T>(target: string, action: string, _args: string) => ({
						status: "success" as const,
						actor_id: ACTOR_ID,
						target_id: target,
						action_id: action,
						snapshot: null as T,
						provenance: {
							id: "r_manipulate:1:1",
							kind: "Affordance",
							status: "Succeeded",
							subject_id: "1",
							failure_kind: "",
							failure_detail: "",
							selected_template_ids: ["core/inspect/affordance", "precondition:visibility"],
							created_at_tick: 1n,
							bundle_id: "core",
						},
						lagWarning: false,
						observedAtTick: 1n,
					}),
				},
			},
		};
		const result = await manipulate(context);
		expect(result.details).toMatchObject({ receipt: { status: "dispatched" } });
		expect((result.details as { receipt: Record<string, unknown> }).receipt).not.toHaveProperty(
			"resolution",
		);
		expect(
			(result.details as { receipt: { manipulate?: { player_message?: string } } }).receipt
				.manipulate?.player_message,
		).toBeUndefined();
	});

	it("sk-dms.38: a hit receipt carries player_message 'lands' without printing a template id", async () => {
		const db = makeDb({
			...DIRECT_MANIPULATION_ROWS,
			entity: [{ entityId: 10n, name: "Crypt Warden" }],
			visible_manipulation_context: [
				{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true, nicheIds: [] },
			],
			action_definition: [
				{
					actionId: "srd/attack/melee",
					displayName: "Melee Attack",
					selfOnly: false,
					selfEligible: false,
				},
			],
			outcome_template: [
				{ outcomeTemplateId: "srd/attack/melee/outcome", manipulationActionId: "srd/attack/melee" },
			],
			// The action label comes from the actor-scoped factored context,
			// rather than the retired eager affordance cache.
			visible_manipulation_available_action: [
				{
					actionFactId: "action:1:srd/attack/melee",
					perceiverEntityId: 1n,
					actionId: "srd/attack/melee",
					nicheIds: [],
					templateIds: ["srd/attack/melee/affordance"],
				},
			],
			visible_manipulation_observed_target: [
				{
					targetFactId: "target:1:entity:10",
					nicheIds: [],
					perceiverEntityId: 1n,
					targetRef: { tag: "Entity", value: 10n },
				},
			],
			visible_affordance: [
				{
					affordanceId: 8n,
					perceiverEntityId: 1n,
					targetEntityId: 10n,
					targetRef: { tag: "Entity", value: 10n },
					derivedByTemplateId: "srd/attack/melee/affordance",
					actionId: "srd/attack/melee",
					interactionDescriptor: "manipulation.action_id=srd/attack/melee",
					derivedFrom: "",
					expiresAtTick: undefined,
					derivedAtTick: 0,
					bundleId: "srd",
				},
			],
			affordance_template: [
				{
					templateId: "srd/attack/melee/affordance",
					displayName: "Melee Attack",
					capabilityId: "srd/attack",
				},
			],
		});
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					manipulate: async <T>(target: string, action: string, _args: string) => ({
						status: "success" as const,
						actor_id: ACTOR_ID,
						target_id: target,
						action_id: action,
						snapshot: null as T,
						provenance: {
							id: "r_manipulate:1:1",
							kind: "Affordance",
							status: "Succeeded",
							subject_id: "1",
							failure_kind: "",
							failure_detail: "",
							selected_template_ids: [
								"srd/attack/melee/affordance",
								"resolution_mode:stochastic:predicate=x",
								"resolution_result:true",
								"resolution_branch:on_success",
								"resolution_consequence:srd/attack/melee/success",
							],
							created_at_tick: 1n,
							bundle_id: "srd",
						},
						lagWarning: false,
						observedAtTick: 1n,
					}),
				},
			},
		};
		const result = await manipulate(context, {
			target_id: "entity:10",
			action_id: "srd/attack/melee",
		});
		const message = (result.details as { receipt: { manipulate: { player_message?: string } } })
			.receipt.manipulate.player_message;
		expect(message).toBe("Your Melee Attack lands on Crypt Warden.");
		expect(message).toContain("lands");
		expect(message).not.toContain("srd/attack");
	});

	it("sk-dms.38: a miss receipt carries player_message 'misses'", async () => {
		const db = makeDb({
			...DIRECT_MANIPULATION_ROWS,
			entity: [{ entityId: 10n, name: "Crypt Warden" }],
			visible_manipulation_context: [
				{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true, nicheIds: [] },
			],
			action_definition: [
				{
					actionId: "srd/attack/melee",
					displayName: "Melee Attack",
					selfOnly: false,
					selfEligible: false,
				},
			],
			outcome_template: [
				{ outcomeTemplateId: "srd/attack/melee/outcome", manipulationActionId: "srd/attack/melee" },
			],
			// The action label comes from the actor-scoped factored context,
			// rather than the retired eager affordance cache.
			visible_manipulation_available_action: [
				{
					actionFactId: "action:1:srd/attack/melee",
					perceiverEntityId: 1n,
					actionId: "srd/attack/melee",
					nicheIds: [],
					templateIds: ["srd/attack/melee/affordance"],
				},
			],
			visible_manipulation_observed_target: [
				{
					targetFactId: "target:1:entity:10",
					nicheIds: [],
					perceiverEntityId: 1n,
					targetRef: { tag: "Entity", value: 10n },
				},
			],
			visible_affordance: [
				{
					affordanceId: 8n,
					perceiverEntityId: 1n,
					targetEntityId: 10n,
					targetRef: { tag: "Entity", value: 10n },
					derivedByTemplateId: "srd/attack/melee/affordance",
					actionId: "srd/attack/melee",
					interactionDescriptor: "manipulation.action_id=srd/attack/melee",
					derivedFrom: "",
					expiresAtTick: undefined,
					derivedAtTick: 0,
					bundleId: "srd",
				},
			],
			affordance_template: [
				{
					templateId: "srd/attack/melee/affordance",
					displayName: "Melee Attack",
					capabilityId: "srd/attack",
				},
			],
		});
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					manipulate: async <T>(target: string, action: string, _args: string) => ({
						status: "success" as const,
						actor_id: ACTOR_ID,
						target_id: target,
						action_id: action,
						snapshot: null as T,
						provenance: {
							id: "r_manipulate:1:1",
							kind: "Affordance",
							status: "Succeeded",
							subject_id: "1",
							failure_kind: "",
							failure_detail: "",
							selected_template_ids: [
								"srd/attack/melee/affordance",
								"resolution_mode:stochastic:predicate=x",
								"resolution_result:false",
								"resolution_branch:on_failure",
								"resolution_consequence:srd/attack/melee/miss",
							],
							created_at_tick: 1n,
							bundle_id: "srd",
						},
						lagWarning: false,
						observedAtTick: 1n,
					}),
				},
			},
		};
		const result = await manipulate(context, {
			target_id: "entity:10",
			action_id: "srd/attack/melee",
		});
		expect(
			(result.details as { receipt: { manipulate: { player_message?: string } } }).receipt
				.manipulate.player_message,
		).toBe("Your Melee Attack misses Crypt Warden.");
	});

	it("does NOT leak a co-located but different entity's resource change into the actor's observation (authorization boundary)", async () => {
		// Entity 99 is co-located and its own resource pool changes during the
		// same call, but the acting actor is entity 1 — only entity 1's owned
		// state may back an observation (ADR-0040 perception/range for a third
		// party's state is explicitly out of scope for #1921).
		const heroHp = {
			targetKind: "entity",
			targetId: "1",
			stateId: "srd/hp",
			value: 7,
			sourceTemplateId: "",
			setAtTick: 0,
			expiresAtTick: 0,
			bundleId: "core",
			rowId: 1n,
		};
		const otherEntityCounter = {
			targetKind: "entity",
			targetId: "99",
			stateId: "phandelver/escort_stage",
			value: 1,
			sourceTemplateId: "",
			setAtTick: 0,
			expiresAtTick: 0,
			bundleId: "phandelver",
			rowId: 2n,
		};
		const db = makeDb({
			...DIRECT_MANIPULATION_ROWS,
			owned_object_state: [heroHp, otherEntityCounter],
			resource_definition: [
				{ resourceDefinitionId: "srd/hp", displayName: "Hit Points", valueKind: "int" },
				{
					resourceDefinitionId: "phandelver/escort_stage",
					displayName: "Escort Stage",
					valueKind: "int",
				},
			],
		});
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					manipulate: async <T>(target: string, action: string, _args: string) => {
						// Only the CO-LOCATED OTHER entity's state changes; the acting
						// actor's own hero HP is untouched.
						otherEntityCounter.value = 2;
						return {
							status: "success" as const,
							actor_id: ACTOR_ID,
							target_id: target,
							action_id: action,
							snapshot: null as T,
							lagWarning: false,
							observedAtTick: 1n,
						};
					},
				},
			},
		};
		const result = await manipulate(context);
		expect(result.details).toMatchObject({
			receipt: { status: "dispatched", outcome: "accepted" },
			observation: null,
		});
		const details = result.details as { observation_gap?: string };
		expect(details.observation_gap).toBeDefined();
		expect(JSON.stringify(result.details)).not.toContain("Escort Stage");
		expect(JSON.stringify(result.details)).not.toContain("phandelver/escort_stage");
	});

	it("spellkave_manipulate prefers the authored outcome_template narrative (#1968 B-9) over the resource-delta fallback", async () => {
		const heroHp = {
			targetKind: "entity",
			targetId: "1",
			stateId: "srd/hp",
			value: 7,
			sourceTemplateId: "",
			setAtTick: 0,
			expiresAtTick: 0,
			bundleId: "core",
			rowId: 1n,
		};
		const db = makeDb({
			...DIRECT_MANIPULATION_ROWS,
			owned_object_state: [heroHp],
			resource_definition: [
				{ resourceDefinitionId: "srd/hp", displayName: "Hit Points", valueKind: "int" },
			],
			outcome_template: [
				{
					outcomeTemplateId: "core/inspect/outcome",
					description: "You find nothing of note.",
				},
			],
			entity: [{ entityId: 1n, name: "Lyra" }],
			visible_entity_tag: [],
			visible_target_condition: [],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
		});
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					manipulate: async <T>(target: string, action: string, _args: string) => {
						heroHp.value = 3; // a resource DID also change this dispatch
						return {
							status: "success" as const,
							actor_id: ACTOR_ID,
							target_id: target,
							action_id: action,
							snapshot: null as T,
							lagWarning: false,
							observedAtTick: 1n,
							provenance: {
								id: "eval:1",
								kind: "Affordance",
								status: "Succeeded",
								subject_id: "1",
								failure_kind: "",
								failure_detail: "",
								selected_template_ids: [
									"core/inspect/affordance",
									"core/inspect/outcome",
									"core/inspect",
								],
								created_at_tick: 1n,
								bundle_id: "core",
							},
						};
					},
				},
			},
		};
		const result = await manipulate(context);
		// The authored narrative wins even though a resource ALSO changed this
		// dispatch — see the tools.ts call-site comment: an authored description
		// that intentionally omits mechanical detail is not second-guessed by a
		// mechanical diff.
		expect(result.details).toMatchObject({
			receipt: { status: "dispatched", outcome: "accepted" },
			observation: "You find nothing of note.",
		});
		expect((result.details as { observation_gap?: string }).observation_gap).toBeUndefined();
	});

	/* retired affordance-handle sensing coverage removed; direct typed sensing is
	 * covered by the sense-context tests. */
	/*
		const db = makeDb({
			world_time: [{ tick: 1n }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "graph/a" }],
			visible_target_condition: [],
			entity: [],
			visible_entity_tag: [],
			owned_object_state: [],
			resource_definition: [],
			resource_definition_tag: [],
			visible_place_node: [],
			visible_place_graph_definition: [],
			visible_place_edge: [],
			outcome_template: [
				{ outcomeTemplateId: "core/look/outcome", description: "Dust motes drift in the light." },
			],
			visible_affordance: [
				{
					affordanceId: 8n,
					perceiverEntityId: 1n,
					targetEntityId: 0n,
					targetRef: { tag: "World" },
					derivedByTemplateId: "core/look/affordance",
					actionId: "",
					interactionDescriptor: "sensing.query=core/look",
					sensingVisibility: { tag: "Local" },
					derivedFrom: "",
					expiresAtTick: undefined,
					derivedAtTick: 0,
					bundleId: "core",
				},
			],
			affordance_template: [
				{ templateId: "core/look/affordance", displayName: "Look", capabilityId: "core/sense" },
			],
		});
		const context: SpellkaveToolContext = {
			db,
			act: {
				actorId: "1",
				actorClient: {
					// biome-ignore lint/suspicious/noExplicitAny: minimal success-shaped verdict; the tool only forwards the fields it reads.
					sense: async (queryKind: string, visibilityClass: string): Promise<any> => ({
						status: "success",
						actor_id: ACTOR_ID,
						query_kind: queryKind,
						visibility_class: visibilityClass,
						lagWarning: false,
						observedAtTick: 1n,
						provenance: {
							id: "eval:2",
							kind: "Affordance",
							status: "Succeeded",
							subject_id: "1",
							failure_kind: "",
							failure_detail: "",
							selected_template_ids: ["core/look/affordance", "core/look/outcome"],
							created_at_tick: 1n,
							bundle_id: "core",
						},
					}),
				},
			},
		};
		const handle = await nonManipulationHandle(context);
		const result = await toolByName(context, "spellkave_act_affordance").execute("act", {
			handle,
		});
		expect(result.details).toMatchObject({
			receipt: { status: "dispatched", verb_class: "sensing", outcome: "accepted" },
			observation: "Dust motes drift in the light.",
		});
		expect((result.details as { observation_gap?: string }).observation_gap).toBeUndefined();
	});
	*/

	it("spellkave_move (rev+handle mode) reports the destination's authored node_description on a successful move", async () => {
		// Mirrors scene-tools.test.ts's working "executes exits through the
		// shared canonical affordance dispatcher" fixture shape: a scene exit
		// only survives spellkave_scene's filter once it has a backing
		// materialised movement affordance, not just raw place_edge geometry.
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
					// biome-ignore lint/suspicious/noExplicitAny: minimal success-shaped verdict; the tool only forwards the fields it reads.
					move: async (edgeId: string): Promise<any> => ({
						status: "success",
						actor_id: ACTOR_ID,
						edge_id: edgeId,
						from_node: "tavern",
						to_node: "square",
						observedAtTick: 1n,
					}),
				},
			},
		};
		const scene = await toolByName(context, "spellkave_scene").execute("scene", { kind: "exit" });
		const { items } = scene.details as { items: { rev: string; handle: string }[] };
		const result = await toolByName(context, "spellkave_move").execute("act", {
			rev: items[0]?.rev ?? "",
			handle: items[0]?.handle ?? "",
		});
		expect(result.details).toMatchObject({
			receipt: { status: "dispatched", verb_class: "movement", outcome: "accepted" },
			observation: "A bustling market square.",
		});
	});
});
