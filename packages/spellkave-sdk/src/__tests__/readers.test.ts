// Deterministic unit coverage for the read-first SDK API surface (3.3).
// All tests feed pre-shaped fake `SnapshotDb` rows — no live SpacetimeDB
// node required. Snake/camel access is exercised by interleaving the two
// shapes across rows.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { type SnapshotDb, snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { setLogSink } from "../core/log";
import { buildEntityFactionMap } from "../core/readers/_helpers";
import {
	readConditionBoundaryExpiries,
	readRecentActionRechargeFirings,
	readRecentBoundaryFirings,
	readRecentChannelSpends,
	readRecentChannelWindowRefreshes,
} from "../core/readers/action_economy_events";
import { readActorBodySwapEvents } from "../core/readers/actor_body_swaps";
import { readActorConditions, readActorSnapshot } from "../core/readers/actor_snapshot";
import { readActorStates } from "../core/readers/actor_states";
import { readEntityBody, readObjectStatesForEntity } from "../core/readers/actors_and_bodies";
import {
	readCapabilityDefinition,
	readResourceDefinition,
} from "../core/readers/bundle_definitions";
import { readEntity, readItem } from "../core/readers/bundle_entities";
import { readCombatSessionView } from "../core/readers/combat_session";
import { readEntityContainer, readEntityContainment } from "../core/readers/entity_containment";
import { readEquipment } from "../core/readers/equipment";
import { readLocationSnapshot } from "../core/readers/location_snapshot";
import { readManipulationContext } from "../core/readers/manipulation_context";
import { readSenseContext } from "../core/readers/sense_context";
import { readActiveSessionForActor } from "../core/readers/session";
import { suggestNextAction } from "../core/readers/suggest_next_action";
import { readEntityFaction } from "../core/readers/tag_reads";
import { readRecentTraces, readTracesAt } from "../core/readers/traces";
import { readRecentEvents } from "../core/readers/world_events";
import { readWorldStatus } from "../core/readers/world_status";

interface FakeRow {
	[k: string]: unknown;
}

function makeDb(parts: Record<string, FakeRow[]>): SnapshotDb {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		...parts,
	});
}

describe("readManipulationContext", () => {
	const actionRows = [
		{ actionId: "demo/z", displayName: "Z", selfOnly: false, selfEligible: false },
		{ actionId: "demo/a", displayName: "A", selfOnly: true, selfEligible: true },
		{
			actionId: "demo/not-manipulation",
			displayName: "Ignore",
			selfOnly: false,
			selfEligible: false,
		},
	];
	const outcomeRows = [
		{ outcomeTemplateId: "demo/z/outcome", manipulationActionId: "demo/z" },
		{ outcomeTemplateId: "demo/a/outcome", manipulationActionId: "demo/a" },
		{ outcomeTemplateId: "demo/sense/outcome", manipulationActionId: "" },
	];

	it("distinguishes unavailable context from a ready empty action catalog", () => {
		expect(readManipulationContext(makeDb({}), asEntityRef("7"))).toEqual({
			status: "unavailable",
		});
		expect(
			readManipulationContext(
				makeDb({
					visible_manipulation_context: [
						{ perceiverEntityId: 7n, schemaVersion: 1, revision: 3n, ready: true },
					],
				}),
				asEntityRef("7"),
			),
		).toEqual({
			status: "ready",
			schema_version: 1,
			revision: 3,
			actions: [],
			targets: [],
			participants: [],
			prompts: [],
		});
	});

	it("uses caller-scoped action facts and shared definitions, never pairs", () => {
		const context = readManipulationContext(
			makeDb({
				visible_manipulation_context: [
					{ perceiverEntityId: 7n, schemaVersion: 1, revision: 3n, ready: true },
					{ perceiverEntityId: 8n, schemaVersion: 1, revision: 99n, ready: true },
				],
				action_definition: actionRows,
				action_definition_tag: [
					{ actionId: "demo/a", tag: "communication" },
					{ actionId: "demo/a", tag: "communication" },
					{ actionId: "demo/z", tag: "combat/attack" },
				],
				visible_entity_tag: [
					{ entityId: 9n, tag: "srd.faction.hostile" },
					{ entityId: 9n, tag: "srd.faction.hostile" },
				],
				outcome_template: outcomeRows,
				// An eager pair must have no effect on this read model.
				visible_affordance: [
					{ perceiverEntityId: 7n, targetEntityId: 9n, actionId: "demo/not-manipulation" },
				],
				visible_manipulation_available_action: [
					{
						actionFactId: "action:7:demo/a",
						perceiverEntityId: 7n,
						actionId: "demo/a",
						nicheIds: ["demo/niche"],
					},
					{
						actionFactId: "action:7:demo/z",
						perceiverEntityId: 7n,
						actionId: "demo/z",
						nicheIds: [],
					},
					{
						actionFactId: "action:8:demo/hidden",
						perceiverEntityId: 8n,
						actionId: "demo/hidden",
						nicheIds: [],
					},
				],
				visible_manipulation_observed_target: [
					{
						targetFactId: "target:7:entity:9",
						perceiverEntityId: 7n,
						targetRef: { tag: "Entity", value: 9n },
						nicheIds: ["demo/niche"],
					},
					{
						targetFactId: "target:7:item:44",
						perceiverEntityId: 7n,
						targetRef: { tag: "Item", value: 44n },
						nicheIds: [],
					},
					{
						targetFactId: "target:8:entity:99",
						perceiverEntityId: 8n,
						targetRef: { tag: "Entity", value: 99n },
						nicheIds: [],
					},
				],
				visible_manipulation_participant_context: [
					{ contextId: 12n, perceiverEntityId: 7n, actionId: "demo/a", bindingCount: 1 },
					{ contextId: 99n, perceiverEntityId: 8n, actionId: "demo/z", bindingCount: 0 },
				],
				visible_manipulation_participant_binding: [
					{ rowId: 1n, contextId: 12n, roleId: "demo/tool", entityId: 44n },
					{ rowId: 2n, contextId: 99n, roleId: "demo/hidden", entityId: 55n },
				],
			}),
			asEntityRef("7"),
		);
		expect(context).toEqual({
			status: "ready",
			schema_version: 1,
			revision: 3,
			actions: [
				{
					action_id: "demo/a",
					display_name: "A",
					tags: ["communication"],
					template_ids: [],
					groups: [],
					niche_requirements: [
						{
							niche_id: "demo/niche",
							requires_spatial_attachment: true,
							admits_targets_without_membership: false,
						},
					],
					self_only: true,
					self_eligible: true,
				},
				{
					action_id: "demo/z",
					display_name: "Z",
					tags: ["combat/attack"],
					template_ids: [],
					groups: [],
					niche_requirements: [],
					self_only: false,
					self_eligible: false,
				},
			],
			targets: [
				{
					target_fact_id: "target:7:entity:9",
					target_ref: "entity:9",
					tags: ["srd.faction.hostile"],
					niche_ids: ["demo/niche"],
				},
				{
					target_fact_id: "target:7:item:44",
					target_ref: "item:44",
					tags: [],
					niche_ids: [],
				},
			],
			participants: [
				{
					context_id: "mpc:12",
					action_id: "demo/a",
					binding_count: 1,
					bindings: [{ role_id: "demo/tool", entity_id: "44" }],
				},
			],
			prompts: [],
		});
	});

	it("projects only a valid public template cue onto its action", () => {
		const context = readManipulationContext(
			makeDb({
				visible_manipulation_context: [
					{ perceiverEntityId: 7n, schemaVersion: 1, revision: 3n, ready: true },
				],
				action_definition: [
					{ actionId: "demo/speak", displayName: "Speak", selfOnly: false, selfEligible: false },
				],
				outcome_template: [
					{ outcomeTemplateId: "demo/speak/outcome", manipulationActionId: "demo/speak" },
				],
				visible_manipulation_available_action: [
					{
						actionFactId: "action:7:demo/speak",
						perceiverEntityId: 7n,
						actionId: "demo/speak",
						nicheIds: [],
						templateIds: ["demo/speak/template"],
					},
				],
				public_metadata_attachment: [
					{
						targetKind: "affordance_template",
						targetRef: "demo/speak/template",
						namespace: "ui.affordance_cue",
						audience: "public",
						payloadJson: JSON.stringify({ rank: 4, hint: "Speak directly." }),
					},
				],
			}),
			asEntityRef("7"),
		);
		expect(context).toMatchObject({
			status: "ready",
			actions: [{ action_id: "demo/speak", cue: { rank: 4, hint: "Speak directly." } }],
		});
	});

	it("resolves author-published defaults only from caller-scoped facts", () => {
		const context = readManipulationContext(
			makeDb({
				visible_manipulation_context: [
					{ perceiverEntityId: 7n, schemaVersion: 1, revision: 3n, ready: true },
				],
				action_definition: [
					{ actionId: "demo/dodge", displayName: "Dodge", selfOnly: true, selfEligible: true },
				],
				outcome_template: [
					{ outcomeTemplateId: "demo/dodge/outcome", manipulationActionId: "demo/dodge" },
				],
				visible_manipulation_available_action: [
					{
						actionFactId: "action:7:demo/dodge",
						perceiverEntityId: 7n,
						actionId: "demo/dodge",
						nicheIds: [],
						templateIds: ["demo/dodge/template"],
					},
				],
				public_metadata_attachment: [
					{
						key: "2",
						setAtTick: 4n,
						targetKind: "affordance_template",
						targetRef: "demo/dodge/template",
						namespace: "ui.affordance_defaults",
						audience: "public",
						payloadJson: '{"version":1,"target":{"kind":"actor"}}',
					},
				],
			}),
			asEntityRef("7"),
		);
		expect(context).toMatchObject({
			status: "ready",
			actions: [
				{
					action_id: "demo/dodge",
					defaults: {
						target: { kind: "actor", target_ref: "entity:7" },
						provenance: { template_id: "demo/dodge/template", attachment_id: "2" },
					},
				},
			],
		});
	});

	it("unions target definition tags (e.g. srd.cr.2) onto instance tags, sorted and deduplicated", () => {
		const context = readManipulationContext(
			makeDb({
				visible_manipulation_context: [
					{ perceiverEntityId: 7n, schemaVersion: 1, revision: 3n, ready: true },
				],
				entity: [{ entityId: 9n, entityDefId: "srd/creature/priest", name: "Sister Maelis" }],
				visible_entity_tag: [
					{ entityId: 9n, tag: "srd.faction.monsters" },
					{ entityId: 9n, tag: "srd.creature.role.leader" },
				],
				entity_definition_tag: [
					{ entityDefId: "srd/creature/priest", tag: "srd.cr.2" },
					// A definition tag already present as an instance tag must not
					// duplicate in the union.
					{ entityDefId: "srd/creature/priest", tag: "srd.faction.monsters" },
				],
				visible_manipulation_observed_target: [
					{
						targetFactId: "target:7:entity:9",
						perceiverEntityId: 7n,
						targetRef: { tag: "Entity", value: 9n },
						nicheIds: [],
					},
				],
			}),
			asEntityRef("7"),
		);
		expect(context).toMatchObject({
			status: "ready",
			targets: [
				{
					target_fact_id: "target:7:entity:9",
					target_ref: "entity:9",
					tags: ["srd.cr.2", "srd.creature.role.leader", "srd.faction.monsters"],
				},
			],
		});
	});

	it("treats not-ready caller context as unavailable", () => {
		expect(
			readManipulationContext(
				makeDb({
					visible_manipulation_context: [
						{ perceiverEntityId: 7n, schemaVersion: 1, revision: 3n, ready: false },
					],
					action_definition: actionRows,
					outcome_template: outcomeRows,
				}),
				asEntityRef("7"),
			),
		).toEqual({ status: "unavailable" });
	});

	it("preserves a typed communication descriptor without consulting an eager pair", () => {
		const context = readManipulationContext(
			makeDb({
				visible_manipulation_context: [
					{ perceiverEntityId: 7n, schemaVersion: 1, revision: 3n, ready: true },
				],
				action_definition: [
					{ actionId: "demo/speak", displayName: "Speak", selfOnly: false, selfEligible: false },
				],
				outcome_template: [
					{
						outcomeTemplateId: "demo/speak/outcome",
						manipulationActionId: "demo/speak",
						communicationSpeechActId: "demo/speak",
					},
				],
				visible_manipulation_available_action: [
					{
						actionFactId: "action:7:demo/speak",
						perceiverEntityId: 7n,
						actionId: "demo/speak",
						nicheIds: ["demo/speech"],
					},
				],
			}),
			asEntityRef("7"),
		);
		expect(context).toMatchObject({
			status: "ready",
			actions: [{ action_id: "demo/speak", communication_speech_act_id: "demo/speak" }],
		});
	});

	it("uses the server's actor-scoped action facts instead of raw visible capabilities", () => {
		const context = readManipulationContext(
			makeDb({
				visible_manipulation_context: [
					{ perceiverEntityId: 7n, schemaVersion: 1, revision: 3n, ready: true },
				],
				action_definition: [
					{
						actionId: "demo/allowed",
						displayName: "Allowed",
						requiredCapability: "demo/can-act",
						selfOnly: false,
						selfEligible: false,
					},
					{
						actionId: "demo/hidden",
						displayName: "Hidden",
						requiredCapability: "demo/cannot-act",
						selfOnly: false,
						selfEligible: false,
					},
				],
				outcome_template: [
					{ outcomeTemplateId: "allowed", manipulationActionId: "demo/allowed" },
					{ outcomeTemplateId: "hidden", manipulationActionId: "demo/hidden" },
				],
				visible_manipulation_available_action: [
					{
						actionFactId: "action:7:demo/allowed",
						perceiverEntityId: 7n,
						actionId: "demo/allowed",
						nicheIds: [],
					},
					{
						actionFactId: "action:7:demo/hidden",
						perceiverEntityId: 7n,
						actionId: "demo/hidden",
						nicheIds: [],
					},
				],
				visible_capability: [{ entityId: 7n, capabilityId: "demo/can-act" }],
			}),
			asEntityRef("7"),
		);
		expect(context).toMatchObject({
			status: "ready",
			actions: [{ action_id: "demo/allowed" }, { action_id: "demo/hidden" }],
		});
	});

	it("projects caller-scoped dialogue prompts: directed, broadcast, excluded, and consumed (ADR-0142 D-6)", () => {
		const context = readManipulationContext(
			makeDb({
				visible_manipulation_context: [
					{ perceiverEntityId: 7n, schemaVersion: 1, revision: 5n, ready: true },
				],
				// A row scoped to a DIFFERENT perceiver (9) never reaches this
				// caller's read — the server's own visibility_subject filter
				// already excludes it before it ever lands in the view, and the
				// reader's own perceiverEntityId filter is the second guard.
				visible_manipulation_prompt: [
					{
						promptFactId: "prompt:7:101",
						perceiverEntityId: 7n,
						occurrenceId: 101n,
						promptDefId: "dm/creation/class",
						contractVersion: 1,
						sourceRef: "entity:3",
						responseActionIds: ["dm/dialog/choice/1", "dm/dialog/choice/2"],
						openedAtTick: 40n,
						consumed: false,
					},
					{
						promptFactId: "prompt:7:102",
						perceiverEntityId: 7n,
						occurrenceId: 102n,
						promptDefId: "dm/quest/offer",
						contractVersion: 2,
						sourceRef: "entity:5",
						responseActionIds: ["dm/dialog/choice/1"],
						openedAtTick: 41n,
						consumed: true,
					},
					{
						promptFactId: "prompt:9:103",
						perceiverEntityId: 9n,
						occurrenceId: 103n,
						promptDefId: "dm/creation/class",
						contractVersion: 1,
						sourceRef: "entity:3",
						responseActionIds: ["dm/dialog/choice/1"],
						openedAtTick: 42n,
						consumed: false,
					},
				],
				// ADR-0142 D-6 follow-up: authored presentation for occurrence 101's
				// prompt_def_id only — occurrence 102's "dm/quest/offer" carries none,
				// so its `presentation` stays undefined.
				public_metadata_attachment: [
					{
						rowId: 1n,
						targetKind: "prompt_definition",
						targetRef: "dm/creation/class",
						namespace: "dialogue.prompt",
						payloadJson: JSON.stringify({
							question: "Which class?",
							responses: { "dm/dialog/choice/1": "Barbarian", "dm/dialog/choice/2": "Rogue" },
						}),
						audience: "public",
						bundleId: "dm",
						source: "manifest",
						setAtTick: 0n,
					},
				],
			}),
			asEntityRef("7"),
		);
		expect(context).toMatchObject({
			status: "ready",
			prompts: [
				{
					occurrence_id: "101",
					prompt_def_id: "dm/creation/class",
					contract_version: 1,
					source_ref: "entity:3",
					response_action_ids: ["dm/dialog/choice/1", "dm/dialog/choice/2"],
					opened_at_tick: 40,
					consumed: false,
					presentation: {
						question: "Which class?",
						labels: { "dm/dialog/choice/1": "Barbarian", "dm/dialog/choice/2": "Rogue" },
					},
				},
				{
					occurrence_id: "102",
					prompt_def_id: "dm/quest/offer",
					contract_version: 2,
					source_ref: "entity:5",
					response_action_ids: ["dm/dialog/choice/1"],
					opened_at_tick: 41,
					consumed: true,
				},
			],
		});
		const ready = context as Extract<
			ReturnType<typeof readManipulationContext>,
			{ status: "ready" }
		>;
		expect(ready.prompts).toHaveLength(2);
		expect(ready.prompts?.some((prompt) => prompt.occurrence_id === "103")).toBe(false);
		expect(ready.prompts?.[1]).not.toHaveProperty("presentation");
	});
});

describe("readSenseContext", () => {
	it("joins place, visible niche, capability and authored query without evaluating a predicate", () => {
		expect(
			readSenseContext(
				makeDb({
					visible_actor_spatial_location: [{ entityId: 7n, placeNodeId: "inn/bar" }],
					visible_spatial_niche_attachment: [{ nicheId: "place:inn/bar", placeNodeId: "inn/bar" }],
					visible_capability: [{ entityId: 7n, capabilityId: "demo/observe" }],
					affordance_template: [
						{
							templateId: "demo/look",
							nicheId: "place:inn/bar",
							capabilityId: "demo/observe",
							outcomeTemplateId: "demo/look/outcome",
						},
						{
							templateId: "demo/hidden",
							nicheId: "place:inn/bar",
							capabilityId: "demo/other",
							outcomeTemplateId: "demo/hidden/outcome",
						},
					],
					outcome_template: [
						{
							outcomeTemplateId: "demo/look/outcome",
							senseQueryKind: "look",
							senseVisibility: { tag: "Local" },
							displayName: "Look Around",
						},
						{
							outcomeTemplateId: "demo/hidden/outcome",
							senseQueryKind: "listen",
							senseVisibility: "Local",
							displayName: "Listen",
						},
					],
				}),
				asEntityRef("7"),
			),
		).toEqual({
			status: "ready",
			queries: [
				{
					query_kind: "look",
					visibility: "Local",
					display_name: "Look Around",
					outcome_template_id: "demo/look/outcome",
				},
			],
		});
	});

	it("publishes a capability-free unbound query without inventing a place offer", () => {
		expect(
			readSenseContext(
				makeDb({
					visible_actor_spatial_location: [{ entityId: 7n, placeNodeId: "inn/bar" }],
					affordance_template: [
						{
							templateId: "demo/look-anywhere",
							nicheId: "demo/unbound-sense",
							capabilityId: "",
							outcomeTemplateId: "demo/look-anywhere/outcome",
						},
					],
					outcome_template: [
						{
							outcomeTemplateId: "demo/look-anywhere/outcome",
							senseQueryKind: "look",
							senseVisibility: "Local",
							displayName: "Look Around",
						},
					],
				}),
				asEntityRef("7"),
			),
		).toMatchObject({ status: "ready", queries: [{ query_kind: "look" }] });
	});
});

// A `visible_object_state` row holding an int pool, in the live tagged-DSL shape
// (`value: { tag: "Int", value }`) so the reader's value parsing is exercised.
function ostate(_rowId: bigint, targetId: bigint, stateId: string, value: number): FakeRow {
	return {
		// ADR-0146 storage key `[target_kind, target_id, state_id]`.
		key: JSON.stringify(["entity", String(targetId), stateId]),
		targetKind: "entity",
		targetId,
		stateId,
		value: { tag: "Int", value: BigInt(value) },
		sourceTemplateId: "t",
		setAtTick: 0n,
		expiresAtTick: 0n,
		bundleId: "phandelver",
	};
}

// A `resource_definition` row (an int pool by default).
function rdef(resourceDefinitionId: string, displayName: string): FakeRow {
	return {
		resourceDefinitionId,
		bundleId: "phandelver",
		displayName,
		valueKind: "int",
		minValue: 0n,
		maxValue: 100n,
		recoveryRule: "persistent",
		initialValue: 0n,
	};
}

describe("readWorldStatus", () => {
	it("returns null when neither world_time nor config has applied", () => {
		expect(readWorldStatus(makeDb({}))).toBeNull();
	});

	it("merges world_time + config rows", () => {
		// agentsEnabled removed — Item 1 (01-remove-agents-enabled.md) dropped
		// this config column.
		const db = makeDb({
			world_time: [{ tick: 42n }],
			config: [
				{
					worldName: "Aerith",
					eventRetentionLimit: 100,
				},
			],
		});
		expect(readWorldStatus(db)).toEqual({
			tick: 42,
			worldName: "Aerith",
			eventRetentionLimit: 100,
		});
	});
});

describe("readRecentEvents", () => {
	// `readRecentEvents` decodes whatever row it is given — it has no notion of
	// server-side view admission. These `Tick`/`tick`-tagged rows are decode
	// samples only (tag stringification, Option-summary unwrap, tie-break
	// ordering); since scope-tick-event-visibility, the live server never
	// writes a `Tick` row into `visible_world_event`, but a replayed capture
	// recorded before that change still can, so the decoder must keep handling
	// the shape.
	const db = makeDb({
		visible_world_event: [
			{ id: 1n, tick: 10, kind: { tag: "Tick" }, summary: "a" },
			{ id: 2n, tick: 12, kind: "ActorMoved", summary: undefined },
			{ id: 3n, tick: 12, kind: { tag: "ActorMoved" } },
		],
	});

	it("returns empty for n<=0", () => {
		expect(readRecentEvents(db, 0)).toEqual([]);
	});

	it("orders newest-first, breaks ties by id desc, drops undefined summary", () => {
		const out = readRecentEvents(db, 2);
		expect(out).toEqual([
			{ id: "3", tick: 12, kind: "ActorMoved" },
			{ id: "2", tick: 12, kind: "ActorMoved" },
		]);
	});

	it("stringifies tagged-enum kind", () => {
		const out = readRecentEvents(db, 5);
		expect(out[0]?.kind).toBe("ActorMoved");
		expect(out[2]?.kind).toBe("Tick");
	});

	it("decodes generated option summary shape", () => {
		const out = readRecentEvents(
			makeDb({
				visible_world_event: [
					{ id: 1n, tick: 10, kind: { tag: "tick" }, summary: { some: "World tick 10" } },
				],
			}),
			1,
		);

		expect(out).toEqual([{ id: "1", tick: 10, kind: "tick", summary: "World tick 10" }]);
	});
});

describe("action-economy event readers", () => {
	const db = makeDb({
		event_channel_spend: [
			{
				eventId: 9n,
				actor: 42n,
				channel: "core/action_class/primary",
				costMs: 3_000n,
				remainingMs: 3_000n,
				window: 6_000n,
			},
			{
				eventId: 11n,
				actor: 42n,
				channel: "core/action_class/primary",
				costMs: 3_000n,
				remainingMs: 0n,
				window: 6_000n,
			},
		],
		event_boundary_fired: [
			{
				eventId: 12n,
				boundary: "turn_start",
				owner: 42n,
				source: "rotation",
				window: 6_000n,
			},
		],
		event_channel_window_refresh: [
			{
				eventId: 13n,
				actor: 42n,
				boundary: "turn_start",
				window: 12_000n,
			},
		],
		event_action_recharge_fired: [
			{
				eventId: 14n,
				actor: 42n,
				affordance: "srd/dragon/cold_breath",
				boundary: "turn_start",
			},
		],
		visible_condition_boundary_expiry: [
			{
				targetConditionRowId: 7n,
				ownerActor: 42n,
				boundaryId: "turn_end",
				armedAtWindowMs: 6_000n,
				outOfSessionDueTick: 9n,
			},
		],
	});

	it("decodes exact spend deltas newest-first without lossy bigint coercion", () => {
		expect(readRecentChannelSpends(db, 1)).toEqual([
			{
				event_id: "11",
				actor: "42",
				channel: "core/action_class/primary",
				cost_ms: "3000",
				remaining_ms: "0",
				window: "6000",
			},
		]);
	});

	it("decodes owner, boundary, and source", () => {
		expect(readRecentBoundaryFirings(db, 5)).toEqual([
			{
				event_id: "12",
				boundary: "turn_start",
				owner: "42",
				source: "rotation",
				window: "6000",
			},
		]);
	});

	it("decodes refreshes and recharge firings from their own detail tables", () => {
		expect(readRecentChannelWindowRefreshes(db, 5)).toEqual([
			{ event_id: "13", actor: "42", boundary: "turn_start", window: "12000" },
		]);
		expect(readRecentActionRechargeFirings(db, 5)).toEqual([
			{
				event_id: "14",
				actor: "42",
				affordance: "srd/dragon/cold_breath",
				boundary: "turn_start",
			},
		]);
	});

	it("decodes owner-scoped boundary expiry arms without bigint coercion", () => {
		expect(readConditionBoundaryExpiries(db)).toEqual([
			{
				target_condition_row_id: "7",
				owner_actor: "42",
				boundary_id: "turn_end",
				armed_at_window_ms: "6000",
				out_of_session_due_tick: "9",
			},
		]);
	});
});

describe("readActorBodySwapEvents", () => {
	it("joins body-swap detail rows to world_event headers", () => {
		const db = makeDb({
			visible_world_event: [
				// Unmatched header (no swap detail row) — proves the join filters
				// rather than decodes; `ActorMoved` stands in for "any other kind",
				// deliberately not `Tick` since the server no longer admits that
				// kind to this view at all (scope-tick-event-visibility).
				{ id: 1n, tick: 10, kind: { tag: "ActorMoved" } },
				{ id: 2n, tick: 12, kind: { tag: "Layer2", value: { tag: "ApplyConsequence" } } },
			],
			visible_event_actor_body_swapped: [
				{
					eventId: 2n,
					actorId: 7n,
					previousBodyEntityId: 1n,
					newBodyEntityId: 42n,
					consequenceTemplateId: "demos/swap-into-spare",
				},
			],
		});

		expect(readActorBodySwapEvents(db)).toEqual([
			{
				event_id: "2",
				tick: 12,
				event_kind: "Layer2",
				actor_id: "7",
				previous_body_entity_id: "1",
				new_body_entity_id: "42",
				consequence_template_id: "demos/swap-into-spare",
			},
		]);
	});
});

describe("readActorSnapshot", () => {
	const db = makeDb({
		visible_actor_spatial_location: [
			{ entityId: 42n, placeNodeId: "tavern" },
			{ entityId: 43n, placeNodeId: undefined },
		],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "core:scout", bundleId: "core", entityId: 42n },
			{ manifestKey: "core:ghost", bundleId: "core", entityId: 43n },
			{ manifestKey: "core:other", bundleId: "core", entityId: 99n },
		],
		visible_target_condition: [
			{
				rowId: 1n,
				targetKind: "entity",
				targetId: 42n,
				conditionDefinitionId: "rested",
				sourceId: "test",
				appliedAtTick: 100n,
				expiresAtTick: 200n,
				stackCount: 1,
				bundleId: "core",
			},
			{
				rowId: 2n,
				targetKind: "entity",
				targetId: 42n,
				conditionDefinitionId: "fed",
				sourceId: "test",
				appliedAtTick: 150n,
				expiresAtTick: undefined,
				stackCount: 2,
				bundleId: "core",
			},
			{
				rowId: 3n,
				targetKind: "entity",
				targetId: 99n,
				conditionDefinitionId: "should_not_appear",
				sourceId: "test",
				appliedAtTick: 1n,
				stackCount: 1,
				bundleId: "core",
			},
			{
				rowId: 4n,
				targetKind: "entity",
				targetId: 42,
				conditionDefinitionId: "number_id_buff",
				sourceId: "test",
				appliedAtTick: 175n,
				stackCount: 1,
				bundleId: "core",
			},
		],
	});

	it("returns null when actor has no spatial-location row", () => {
		expect(readActorSnapshot(db, asEntityRef("missing"))).toBeNull();
	});

	it("includes node + filtered condition entries; preserves expires when present", () => {
		const snap = readActorSnapshot(db, asEntityRef("42"));
		expect(snap?.actor_id).toBe("42");
		expect(snap?.current_node_id).toBe("tavern");
		expect(snap?.conditions).toHaveLength(3);
		expect(snap?.conditions.map((s) => s.condition_definition_id).sort()).toEqual([
			"fed",
			"number_id_buff",
			"rested",
		]);
		const rested = snap?.conditions.find((s) => s.condition_definition_id === "rested");
		expect(rested?.expires_at_tick).toBe(200);
		const fed = snap?.conditions.find((s) => s.condition_definition_id === "fed");
		expect(fed?.expires_at_tick).toBeUndefined();
	});

	it("omits current_node_id when placeNodeId is undefined", () => {
		const snap = readActorSnapshot(db, asEntityRef("43"));
		expect(snap).not.toBeNull();
		expect(snap?.current_node_id).toBeUndefined();
	});

	it("enumerates the actor's own state pools, enriched with display_name + tags (#1229)", () => {
		// Mirrors the seeded Phandelver hero: an int hp pool and a `quest`-tagged
		// escort-stage pool. The player must read both WITHOUT knowing the ids.
		const heroDb = makeDb({
			visible_actor_spatial_location: [{ entityId: 257n, placeNodeId: "gate" }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "phandelver:phandelver/hero", bundleId: "phandelver", entityId: 257n },
			],
			owned_object_state: [
				ostate(1n, 257n, "srd/hp", 18),
				ostate(2n, 257n, "phandelver/escort_stage", 0),
			],
			resource_definition: [
				rdef("srd/hp", "Hit Points"),
				rdef("phandelver/escort_stage", "Gundren's Escort Contract"),
			],
			resource_definition_tag: [
				{
					rowId: 1n,
					resourceDefinitionId: "phandelver/escort_stage",
					tag: "quest",
					bundleId: "phandelver",
					source: "manifest",
					setAtTick: 0n,
				},
			],
		});
		const snap = readActorSnapshot(heroDb, asEntityRef("phandelver/hero"));
		expect(snap?.states).toEqual([
			{
				state_id: "phandelver/escort_stage",
				display_name: "Gundren's Escort Contract",
				value_kind: "int",
				value_int: 0,
				value: "0",
				tags: ["quest"],
			},
			{
				state_id: "srd/hp",
				display_name: "Hit Points",
				value_kind: "int",
				value_int: 18,
				value: "18",
				tags: [],
			},
		]);
	});
});

// sk-0m4.2: act receipts must disclose conditions on a target the caller can
// act on even when that body is outside the co-located location projection
// (ranged kill one place-node away). `readActorSnapshot` stays location-gated;
// `readActorConditions` is the location-independent channel.
describe("readActorConditions (sk-0m4.2 location-independent)", () => {
	it("returns null when the entity ref does not resolve", () => {
		const empty = makeDb({
			visible_target_condition: [],
			visible_manifest_authored_entity: [],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		});
		expect(readActorConditions(empty, asEntityRef("missing"))).toBeNull();
	});

	it("returns visible conditions without requiring a spatial-location row", () => {
		const remote = makeDb({
			// Deliberately NO visible_actor_spatial_location — the target is
			// one node away and outside the caller's co-located projection.
			visible_actor_spatial_location: [],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			visible_target_condition: [
				{
					rowId: 1n,
					targetKind: "entity",
					targetId: 10n,
					conditionDefinitionId: "srd/condition/dead",
					sourceId: "actor_ref:entity:10",
					appliedAtTick: 127n,
					stackCount: 1,
					bundleId: "srd",
				},
			],
		});
		expect(readActorSnapshot(remote, asEntityRef("entity:10"))).toBeNull();
		expect(readActorConditions(remote, asEntityRef("entity:10"))).toEqual([
			expect.objectContaining({ condition_definition_id: "srd/condition/dead" }),
		]);
	});

	it("returns an empty list when the entity resolves but carries no conditions", () => {
		const bare = makeDb({
			visible_target_condition: [],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
		});
		expect(readActorConditions(bare, asEntityRef("entity:10"))).toEqual([]);
	});
});

describe("readActorStates (#1229 enumerate-own-state)", () => {
	const db = makeDb({
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "phandelver:phandelver/hero", bundleId: "phandelver", entityId: 257n },
		],
		owned_object_state: [
			ostate(1n, 257n, "srd/hp", 18),
			ostate(2n, 257n, "phandelver/escort_stage", 0),
			// A pool on a DIFFERENT entity must not leak into the hero's sheet.
			ostate(3n, 999n, "srd/hp", 5),
		],
		resource_definition: [
			rdef("phandelver/escort_stage", "Gundren's Escort Contract"),
			// srd/hp has no resource_definition row here → display_name falls back to id.
		],
		resource_definition_tag: [
			{
				rowId: 1n,
				resourceDefinitionId: "phandelver/escort_stage",
				tag: "quest",
				bundleId: "phandelver",
				source: "manifest",
				setAtTick: 0n,
			},
		],
	});

	it("resolves a manifest key and lists only that actor's pools", () => {
		expect(readActorStates(db, asEntityRef("phandelver/hero")).map((s) => s.state_id)).toEqual([
			"phandelver/escort_stage",
			"srd/hp",
		]);
		expect(readActorStates(db, asEntityRef("257")).map((s) => s.state_id)).toEqual([
			"phandelver/escort_stage",
			"srd/hp",
		]);
	});

	it("surfaces the `quest` tag and authored display_name on the objective pool", () => {
		const escort = readActorStates(db, asEntityRef("phandelver/hero")).find(
			(s) => s.state_id === "phandelver/escort_stage",
		);
		expect(escort?.tags).toEqual(["quest"]);
		expect(escort?.display_name).toBe("Gundren's Escort Contract");
		expect(escort?.value_int).toBe(0);
	});

	it("falls back to the state_id and empty tags when no definition is authored", () => {
		const hp = readActorStates(db, asEntityRef("phandelver/hero")).find(
			(s) => s.state_id === "srd/hp",
		);
		expect(hp?.display_name).toBe("srd/hp");
		expect(hp?.tags).toEqual([]);
		expect(hp?.value_int).toBe(18);
	});

	it("returns [] for an unresolvable actor ref", () => {
		expect(readActorStates(db, asEntityRef("no/such/key"))).toEqual([]);
	});
});

describe("readActorStates bounded view (#1839)", () => {
	// 3 pools on one hero: two written at tick 5 (older), one at tick 10 (newest).
	const boundedDb = makeDb({
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "phandelver:phandelver/hero", bundleId: "phandelver", entityId: 257n },
		],
		owned_object_state: [
			{ ...ostate(1n, 257n, "phandelver/old_a", 1), setAtTick: 5n },
			{ ...ostate(2n, 257n, "phandelver/old_b", 2), setAtTick: 5n },
			{ ...ostate(3n, 257n, "srd/hp", 18), setAtTick: 10n },
		],
		resource_definition_tag: [
			{ resourceDefinitionId: "phandelver/old_a", tag: "quest" },
			{ resourceDefinitionId: "phandelver/old_b", tag: "quest" },
			{ resourceDefinitionId: "srd/hp", tag: "core" },
		],
	});

	it("no options: unchanged full unfiltered dump (existing callers see no change)", () => {
		expect(
			readActorStates(boundedDb, asEntityRef("phandelver/hero")).map((s) => s.state_id),
		).toEqual(["phandelver/old_a", "phandelver/old_b", "srd/hp"]);
	});

	it("limit caps to the most-recently-written rows (set_at_tick desc, key tiebreak)", () => {
		const out = readActorStates(boundedDb, asEntityRef("phandelver/hero"), { limit: 2 });
		// srd/hp (tick 10) always survives; row_id 2 beats row_id 1 among the tick-5 tie.
		expect(out.map((s) => s.state_id)).toEqual(["phandelver/old_b", "srd/hp"]);
	});

	it("limit: 0 is the escape hatch — unbounded, same as omitting options", () => {
		expect(
			readActorStates(boundedDb, asEntityRef("phandelver/hero"), { limit: 0 }).map(
				(s) => s.state_id,
			),
		).toEqual(["phandelver/old_a", "phandelver/old_b", "srd/hp"]);
	});

	it("statePrefix filters before the limit applies", () => {
		const out = readActorStates(boundedDb, asEntityRef("phandelver/hero"), {
			statePrefix: "phandelver/",
		});
		expect(out.map((s) => s.state_id)).toEqual(["phandelver/old_a", "phandelver/old_b"]);
	});

	it("stateTag filters by exact authored tag before the limit applies", () => {
		expect(
			readActorStates(boundedDb, asEntityRef("phandelver/hero"), {
				stateTag: "quest",
				limit: 1,
			}).map((s) => s.state_id),
		).toEqual(["phandelver/old_b"]);
		expect(
			readActorStates(boundedDb, asEntityRef("phandelver/hero"), { stateTag: "missing" }),
		).toEqual([]);
		expect(
			readActorStates(boundedDb, asEntityRef("phandelver/hero"), {
				stateTag: "quest",
				limit: 0,
			}).map((s) => s.state_id),
		).toEqual(["phandelver/old_a", "phandelver/old_b"]);
	});
});

describe("readLocationSnapshot", () => {
	const db = makeDb({
		visible_place_node: [
			{ nodeId: "tavern", placeGraphId: "inn", description: "A warm hearth glows here." },
			{ nodeId: "road" },
		],
		visible_place_edge: [
			{ edgeId: 1n, fromNodeId: "tavern", toNodeId: "road" },
			{ edgeId: 2n, fromNodeId: "road", toNodeId: "tavern" },
		],
		visible_actor_spatial_location: [
			{ entityId: 42n, placeNodeId: "tavern" },
			{ entityId: 43n, placeNodeId: "tavern" },
			{ entityId: 99n, placeNodeId: "road" },
		],
		visible_place_graph_definition: [
			{ placeGraphId: "inn", description: "The Sleeping Giant tavern." },
		],
		entity: [
			{
				entityId: 42n,
				entityDefId: "phandelver/toblen",
				name: "Toblen Stonehill",
				kind: "humanoid",
			},
			{
				entityId: 43n,
				entityDefId: "phandelver/redbrand",
				name: "Redbrand Thug",
				kind: "humanoid",
			},
		],
		visible_entity_tag: [
			{ key: "k1", entityId: 43n, tag: "faction:redbrand", bundleId: "phandelver" },
		],
	});

	it("returns null for unknown node", () => {
		expect(readLocationSnapshot(db, "void")).toBeNull();
	});

	it("returns outgoing edges and actors at the node", () => {
		const loc = readLocationSnapshot(db, "tavern");
		expect(loc?.node_id).toBe("tavern");
		expect(loc?.outgoing_edges).toEqual([
			{ edge_id: "1", to_node_id: "road", direction: null, affordance_bindings: [] },
		]);
		expect(loc?.actors_here.sort()).toEqual(["42", "43"]);
	});

	it("projects each place_edge_affordance's mode_id alongside its template (ADR-0101 D-1)", () => {
		const modedDb = makeDb({
			visible_place_node: [{ nodeId: "chasm/ledge" }, { nodeId: "chasm/far_ledge" }],
			visible_place_edge: [
				{
					edgeId: 5n,
					edgeKey: "chasm/ledge->far_ledge",
					fromNodeId: "chasm/ledge",
					toNodeId: "chasm/far_ledge",
				},
			],
			place_edge_affordance: [
				{
					rowId: 1n,
					edgeKey: "chasm/ledge->far_ledge",
					affordanceTemplateId: "srd/affordance/fly",
					modeId: "fly",
				},
				{
					rowId: 2n,
					edgeKey: "chasm/ledge->far_ledge",
					affordanceTemplateId: "srd/affordance/swim",
					modeId: "swim",
				},
			],
		});
		const loc = readLocationSnapshot(modedDb, "chasm/ledge");
		expect(loc?.outgoing_edges).toEqual([
			{
				edge_id: "5",
				to_node_id: "chasm/far_ledge",
				direction: null,
				affordance_bindings: [
					{ template_id: "srd/affordance/fly", mode_id: "fly" },
					{ template_id: "srd/affordance/swim", mode_id: "swim" },
				],
			},
		]);
	});

	it("enriches actor_details with authored name + faction (#1849)", () => {
		const loc = readLocationSnapshot(db, "tavern");
		expect(
			[...(loc?.actor_details ?? [])].sort((a, b) => (a.entity_id < b.entity_id ? -1 : 1)),
		).toEqual([
			{ entity_id: "42", name: "Toblen Stonehill", faction: null },
			{ entity_id: "43", name: "Redbrand Thug", faction: "redbrand" },
		]);
	});

	it("surfaces node and graph description unconditionally", () => {
		const loc = readLocationSnapshot(db, "tavern");
		expect(loc?.node_description).toBe("A warm hearth glows here.");
		expect(loc?.graph_description).toBe("The Sleeping Giant tavern.");
	});

	it("returns empty strings when no description authored", () => {
		const loc = readLocationSnapshot(db, "road");
		expect(loc?.node_description).toBe("");
		expect(loc?.graph_description).toBe("");
	});

	it("replays a plain fixture through the package fixture adapter", () => {
		const fixtureDb = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_place_node: [
				{
					nodeId: "triboar_trail/neverwinter_gate",
					placeGraphId: "triboar_trail",
					posPresent: true,
					posX: 0,
					posY: 0,
					poseElevationPresent: false,
				},
				{
					nodeId: "triboar_trail/high_road_south",
					placeGraphId: "triboar_trail",
					posPresent: true,
					posX: 0,
					posY: -10,
					poseElevationPresent: false,
				},
			],
			visible_place_edge: [
				{
					edgeId: 101n,
					fromNodeId: "triboar_trail/neverwinter_gate",
					toNodeId: "triboar_trail/high_road_south",
					direction: "south",
				},
			],
		});

		expect(readLocationSnapshot(fixtureDb, "triboar_trail/neverwinter_gate")).toMatchObject({
			node_id: "triboar_trail/neverwinter_gate",
			outgoing_edges: [
				{
					edge_id: "101",
					to_node_id: "triboar_trail/high_road_south",
					direction: "south",
				},
			],
		});
	});

	it("derives east and southeast metric directions from authored node positions", () => {
		const fixtureDb = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_place_node: [
				{
					nodeId: "triboar_trail/neverwinter_gate",
					placeGraphId: "triboar_trail",
					posPresent: true,
					posX: 0,
					posY: 0,
					poseElevationPresent: false,
				},
				{
					nodeId: "triboar_trail/eastern_track",
					placeGraphId: "triboar_trail",
					posPresent: true,
					posX: 10,
					posY: 0,
					poseElevationPresent: false,
				},
				{
					nodeId: "triboar_trail/southeast_track",
					placeGraphId: "triboar_trail",
					posPresent: true,
					posX: 10,
					posY: -10,
					poseElevationPresent: false,
				},
			],
			visible_place_edge: [
				{
					edgeId: 201n,
					fromNodeId: "triboar_trail/neverwinter_gate",
					toNodeId: "triboar_trail/eastern_track",
				},
				{
					edgeId: 202n,
					fromNodeId: "triboar_trail/neverwinter_gate",
					toNodeId: "triboar_trail/southeast_track",
				},
			],
		});

		expect(
			readLocationSnapshot(fixtureDb, "triboar_trail/neverwinter_gate")?.outgoing_edges,
		).toEqual([
			{
				edge_id: "201",
				to_node_id: "triboar_trail/eastern_track",
				direction: "east",
				affordance_bindings: [],
			},
			{
				edge_id: "202",
				to_node_id: "triboar_trail/southeast_track",
				direction: "southeast",
				affordance_bindings: [],
			},
		]);
	});
});

describe("bundle inspection readers", () => {
	const db = makeDb({
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "srd:srd/actor/polar-bear", bundleId: "srd", entityId: 20n },
			{ manifestKey: "srd:srd/regdar/dagger-01", bundleId: "srd", entityId: 21n },
		],
		entity: [
			{
				entityId: 20n,
				entityDefId: "srd/monster/polar-bear",
				name: "Polar Bear",
				kind: "npc",
				createdAtTick: 7n,
				quantity: 1n,
				ownedByEntityId: 0n,
			},
			{
				entityId: 21n,
				entityDefId: "srd/item/dagger",
				name: "Dagger",
				kind: "item",
				createdAtTick: 7n,
				quantity: 1n,
				ownedByEntityId: 20n,
			},
		],
		capability_definition: [
			{
				capabilityId: "srd/capability/cast-acid-splash",
				bundleId: "srd",
				actorKind: "actor",
				displayName: "Cast Acid Splash",
				description: "Cast the Acid Splash cantrip",
			},
		],
		resource_definition: [
			{
				resourceDefinitionId: "srd/hp",
				bundleId: "srd",
				displayName: "Hit Points",
				valueKind: "integer",
				minValue: 0n,
				maxValue: 99n,
				recoveryRule: "rest",
				initialValue: 11n,
			},
		],
		equipment_slot_definition: [
			{
				slotId: "srd/main_hand",
				bundleId: "srd",
				label: "Main hand",
				defaultCompatibilityPredicate: "tag('weapon')",
			},
		],
		visible_entity_equipment_slot: [
			{
				rowId: 1n,
				entityId: 20n,
				slotId: "srd/main_hand",
				equippedEntityId: 21n,
				equippedAtTick: 9n,
			},
		],
	});

	it("readEntity resolves manifest keys without perception gating", () => {
		expect(readEntity(db, asEntityRef("srd/actor/polar-bear"))).toMatchObject({
			entity_id: "20",
			entity_key: "srd/actor/polar-bear",
			entity_def_id: "srd/monster/polar-bear",
			name: "Polar Bear",
			kind: "npc",
			created_at_tick: 7,
		});
		expect(readEntity(db, asEntityRef("missing"))).toBeNull();
	});

	it("readItem returns item entities only", () => {
		expect(readItem(db, asEntityRef("srd/regdar/dagger-01"))).toMatchObject({
			entity_id: "21",
			entity_def_id: "srd/item/dagger",
			kind: "item",
		});
		expect(readItem(db, asEntityRef("srd/actor/polar-bear"))).toBeNull();
	});

	it("readCapabilityDefinition reads non-observer capability definitions", () => {
		expect(readCapabilityDefinition(db, "srd/capability/cast-acid-splash")).toEqual({
			capability_id: "srd/capability/cast-acid-splash",
			bundle_id: "srd",
			actor_kind: "actor",
			display_name: "Cast Acid Splash",
			description: "Cast the Acid Splash cantrip",
		});
		expect(readCapabilityDefinition(db, "missing")).toBeNull();
	});

	it("readResourceDefinition reads resource bounds and initial values", () => {
		expect(readResourceDefinition(db, "srd/hp")).toEqual({
			resource_definition_id: "srd/hp",
			bundle_id: "srd",
			display_name: "Hit Points",
			value_kind: "integer",
			min_value: 0,
			max_value: 99,
			recovery_rule: "rest",
			initial_value: 11,
		});
		expect(readResourceDefinition(db, "missing")).toBeNull();
	});

	it("readEquipment joins slots and equipped item entities", () => {
		expect(readEquipment(db, asEntityRef("srd/actor/polar-bear"))).toEqual({
			actor_key: "srd/actor/polar-bear",
			actor_entity_id: "20",
			slots: [
				{
					slot_id: "srd/main_hand",
					label: "Main hand",
					default_compatibility_predicate: "tag('weapon')",
					slot_bundle_id: "srd",
					equipped_entity_id: "21",
					equipped_entity_key: "srd/regdar/dagger-01",
					equipped_entity_def_id: "srd/item/dagger",
					equipped_entity_name: "Dagger",
					equipped_at_tick: 9,
				},
			],
		});
		expect(readEquipment(db, asEntityRef("missing"))).toBeNull();
	});
});

// Post Phase 3 (Brief 11 Gibson-affordance-substrate refactor): the affordance
// table is entity-keyed (perceiverEntityId / targetEntityId) and template-derived
// (derivedByTemplateId FK → affordance_template). Old actorId / actionDefId /
// targetRef / confidence / derivedFromCsv fields are removed.

describe("readTracesAt", () => {
	const db = makeDb({
		visible_trace: [
			{
				traceId: 2n,
				kind: "handled",
				locationKind: "place_node",
				locationRef: "well",
				payloadJson: `{"item":"sword"}`,
				inscribedAt: 20n,
				expiresAt: 40n,
				inscribedBy: "scout",
				visibility: "public",
				bundleId: "core",
			},
			{
				traceId: 1n,
				kind: "ambient",
				locationKind: "place_node",
				locationRef: "well",
				payloadJson: "{}",
				inscribedAt: 10n,
				expiresAt: undefined,
				inscribedBy: "",
				visibility: "public",
				bundleId: "core",
			},
			{
				traceId: 3n,
				kind: "handled",
				locationKind: "place_node",
				locationRef: "road",
				payloadJson: "{}",
				inscribedAt: 30n,
				inscribedBy: "scout",
				visibility: "public",
				bundleId: "core",
			},
		],
	});

	it("filters by location and parses payloads", () => {
		const out = readTracesAt(db, "place_node", "well");
		expect(out.map((t) => t.trace_id)).toEqual(["1", "2"]);
		expect(out[0]?.inscribed_by).toBeNull();
		expect(out[1]?.payload).toEqual({ item: "sword" });
		expect(out[1]?.expires_at).toBe(40);
	});

	it("filters by kind and inscribed actor", () => {
		const out = readTracesAt(db, "place_node", "well", {
			kind: "handled",
			inscribedBy: "scout",
		});
		expect(out).toHaveLength(1);
		expect(out[0]?.kind).toBe("handled");
	});

	it("decodes the visibility tagged enum to its variant name (not [object Object])", () => {
		// The live binding emits `visible_trace.visibility` as the `VisibilityClass`
		// tagged enum ({ tag: "Public" }); the reader must surface the variant
		// name, not String()-coerce the object.
		const taggedDb = makeDb({
			visible_trace: [
				{
					traceId: 1n,
					kind: "wanderer_note",
					locationKind: "place_node",
					locationRef: "green",
					payloadJson: "{}",
					inscribedAt: 0n,
					inscribedBy: "1",
					visibility: { tag: "Public" },
					bundleId: "core",
				},
			],
		});
		const out = readTracesAt(taggedDb, "place_node", "green");
		expect(out[0]?.visibility).toBe("Public");
	});
});

describe("readRecentTraces", () => {
	const db = makeDb({
		visible_trace: [
			{
				traceId: 2n,
				kind: "handled",
				locationKind: "place_node",
				locationRef: "well",
				payloadJson: `{"item":"sword"}`,
				inscribedAt: 20n,
				expiresAt: 40n,
				inscribedBy: "scout",
				visibility: "public",
				bundleId: "core",
			},
			{
				traceId: 1n,
				kind: "ambient",
				locationKind: "place_node",
				locationRef: "well",
				payloadJson: "{}",
				inscribedAt: 10n,
				expiresAt: undefined,
				inscribedBy: "",
				visibility: "public",
				bundleId: "core",
			},
			{
				traceId: 3n,
				// entity-anchored (ADR-0095 D-1) — `readTracesAt` above cannot see
				// this without already knowing which entity to scope to; the
				// point of this reader is exactly to surface it unscoped.
				kind: "utterance",
				locationKind: "entity",
				locationRef: "6",
				payloadJson: `{"text":"a word with you"}`,
				inscribedAt: 30n,
				inscribedBy: "scout",
				visibility: "public",
				bundleId: "core",
			},
		],
	});

	it("returns every visible trace, newest trace_id first, unfiltered by location", () => {
		const out = readRecentTraces(db, 200);
		expect(out.map((t) => t.trace_id)).toEqual(["3", "2", "1"]);
		expect(out[0]?.location_kind).toBe("entity");
		expect(out[0]?.payload).toEqual({ text: "a word with you" });
	});

	it("bounds to the n most recent", () => {
		const out = readRecentTraces(db, 2);
		expect(out.map((t) => t.trace_id)).toEqual(["3", "2"]);
	});

	it("n <= 0 returns no rows", () => {
		expect(readRecentTraces(db, 0)).toEqual([]);
	});
});

describe("entity-id reference resolution (shared resolveEntityId, #504 finding #1)", () => {
	const db = makeDb({
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "core:core/player", bundleId: "core", entityId: 1n },
		],
		visible_entity_containment: [
			{ containerId: 1n, entityId: 6n, slotId: "", direction: "", insertedAtTick: 0n },
		],
		entity: [
			{
				entityId: 1n,
				entityDefId: "core/player",
				name: "Player",
				kind: "actor",
				quantity: 1,
				ownedByEntityId: 0n,
				createdAtTick: 0n,
			},
			{
				entityId: 6n,
				entityDefId: "core/item/torch",
				name: "Torch",
				kind: "item",
				quantity: 3,
				ownedByEntityId: 1n,
				createdAtTick: 0n,
			},
		],
		visible_object_state: [
			{
				rowId: 1n,
				targetKind: "entity",
				targetId: 1n,
				stateId: "x/flag",
				value: "set",
				sourceTemplateId: "t",
				setAtTick: 0n,
				expiresAtTick: 0n,
				bundleId: "core",
			},
		],
	});

	it("readEntityContainment resolves a manifest key (was: BigInt() threw)", () => {
		expect(() => readEntityContainment(db, asEntityRef("core/player"))).not.toThrow();
		expect(readEntityContainment(db, asEntityRef("core/player")).map((r) => r.entity_id)).toEqual([
			"6",
		]);
	});

	it("readEntityContainment still accepts numeric and entity: refs", () => {
		expect(readEntityContainment(db, asEntityRef("1")).map((r) => r.entity_id)).toEqual(["6"]);
		expect(readEntityContainment(db, asEntityRef("entity:1")).map((r) => r.entity_id)).toEqual([
			"6",
		]);
	});

	it("readEntityContainment returns [] (no throw) on an unresolvable ref", () => {
		expect(readEntityContainment(db, asEntityRef("no/such/key"))).toEqual([]);
	});

	it("readEntityContainment joins the contained entity's name/def/kind/quantity (#1227 — was bare ids)", () => {
		const [row] = readEntityContainment(db, asEntityRef("core/player"));
		expect(row).toMatchObject({
			entity_id: "6",
			name: "Torch",
			entity_def_id: "core/item/torch",
			kind: "item",
			quantity: 3,
		});
	});

	it("readEntityContainer resolves a manifest key for the contained entity", () => {
		expect(readEntityContainer(db, asEntityRef("6"))?.container_id).toBe("1");
		expect(readEntityContainer(db, asEntityRef("no/such/key"))).toBeNull();
	});

	it("readEntityContainer also joins the entity's identity (#1227)", () => {
		expect(readEntityContainer(db, asEntityRef("6"))).toMatchObject({
			name: "Torch",
			kind: "item",
		});
	});

	it("readEntityBody resolves a manifest key (was: BigInt() threw)", () => {
		expect(readEntityBody(db, asEntityRef("core/player"))?.entity_def_id).toBe("core/player");
		expect(readEntityBody(db, asEntityRef("no/such/key"))).toBeNull();
	});

	it("readObjectStatesForEntity resolves a manifest key (was: silent [] mismatch)", () => {
		expect(
			readObjectStatesForEntity(db, asEntityRef("core/player")).map((s) => s.state_id),
		).toEqual(["x/flag"]);
		expect(readObjectStatesForEntity(db, asEntityRef("1")).map((s) => s.state_id)).toEqual([
			"x/flag",
		]);
		expect(readObjectStatesForEntity(db, asEntityRef("no/such/key"))).toEqual([]);
	});
});



describe("readActiveSessionForActor", () => {
	// Underpins the argument-free `spellkave_end_turn` resolution: the host finds
	// "the session in which it is my turn" by matching current_actor on an ACTIVE
	// session before dispatching the session-scoped reducer.
	const db = makeDb({
		session: [
			{
				sessionId: 1n,
				sessionDefId: "srd/session/combat",
				lifecycle: "active",
				currentActor: "22",
			},
			{
				sessionId: 2n,
				sessionDefId: "srd/session/parley",
				lifecycle: "active",
				currentActor: "57",
			},
			{
				sessionId: 3n,
				sessionDefId: "srd/session/combat",
				lifecycle: "closed",
				currentActor: "22",
			},
		],
	});

	it("returns the active session whose current_actor is the given actor", () => {
		expect(readActiveSessionForActor(db, "22")?.sessionId).toBe(1n);
		expect(readActiveSessionForActor(db, "57")?.sessionId).toBe(2n);
	});

	it("ignores non-active sessions even when current_actor matches", () => {
		// actor 22 is current in session 3 too, but it is closed → only session 1.
		expect(readActiveSessionForActor(db, "22")?.lifecycle).toBe("active");
	});

	it("returns null when the actor is current in no active session", () => {
		expect(readActiveSessionForActor(db, "99")).toBeNull();
	});

	it("accepts a numeric/bigint-stringified actor id interchangeably", () => {
		expect(readActiveSessionForActor(db, String(22))?.sessionId).toBe(1n);
	});
});

describe("readCombatSessionView", () => {
	function combatDb(currentActor: string) {
		return makeDb({
			session: [
				{ sessionId: 7n, sessionDefId: "srd/session/combat", lifecycle: "active", currentActor },
			],
			session_participant: [
				{ sessionId: 7n, actorId: "11", ordinal: 0, joinedAt: 10n },
				{ sessionId: 7n, actorId: "22", ordinal: 1, joinedAt: 10n },
			],
			visible_actor_spatial_location: [
				{ entityId: 11n, placeNodeId: "session_grid_7/c_0_0" },
				{ entityId: 22n, placeNodeId: "session_grid_7/c_1_0" },
			],
			entity: [
				{
					entityId: 11n,
					entityDefId: "core:hero",
					name: "The Hero",
					kind: "actor",
					createdAtTick: 1n,
					quantity: 1n,
					ownedByEntityId: 0n,
				},
				{
					entityId: 22n,
					entityDefId: "core:goblin",
					name: "Goblin Warrior",
					kind: "actor",
					createdAtTick: 1n,
					quantity: 1n,
					ownedByEntityId: 0n,
				},
			],
			visible_object_state: [
				{
					rowId: 1n,
					targetKind: "entity",
					targetId: 11n,
					stateId: "srd/hp",
					value: { tag: "Int", value: 118n },
				},
				{
					rowId: 2n,
					targetKind: "entity",
					targetId: 22n,
					stateId: "srd/hp",
					value: { tag: "Int", value: 0n },
				},
			],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "phandelver:phandelver/hero", bundleId: "phandelver", entityId: 11n },
			],
			visible_place_graph_definition: [
				{
					placeGraphId: "session_grid_7",
					anchorNodeId: "triboar/ambush_site",
					isEphemeralInstance: true,
				},
			],
			visible_place_node: [
				{
					nodeId: "session_grid_7/c_0_0",
					placeGraphId: "session_grid_7",
					posX: 0,
					posY: 0,
					posPresent: true,
				},
				{
					nodeId: "session_grid_7/c_1_0",
					placeGraphId: "session_grid_7",
					posX: 1,
					posY: 0,
					posPresent: true,
				},
				{
					nodeId: "session_grid_7/c_0_1",
					placeGraphId: "session_grid_7",
					posX: 0,
					posY: 1,
					posPresent: true,
				},
			],
			visible_place_edge: [
				{
					edgeId: 101n,
					edgeKey: "session_grid_7/edge/c_0_0-c_1_0",
					placeGraphId: "session_grid_7",
					fromNodeId: "session_grid_7/c_0_0",
					toNodeId: "session_grid_7/c_1_0",
				},
				{
					edgeId: 102n,
					edgeKey: "session_grid_7/edge/c_0_0-c_0_1",
					placeGraphId: "session_grid_7",
					fromNodeId: "session_grid_7/c_0_0",
					toNodeId: "session_grid_7/c_0_1",
				},
			],
			place_edge_affordance: [
				{
					rowId: 1n,
					edgeKey: "session_grid_7/edge/c_0_0-c_1_0",
					affordanceTemplateId: "core/affordance/traverse_open_portal",
					bindingsJson: '{"movement_cost_cells":"2","movement_label":"Rough ground"}',
				},
				{
					rowId: 2n,
					edgeKey: "session_grid_7/edge/c_0_0-c_0_1",
					affordanceTemplateId: "core/affordance/traverse_open_portal",
					bindingsJson: '{"blocked":"true","movement_label":"Blocked brush"}',
				},
			],
			visible_evaluation_provenance: [
				{
					provenanceId: "p1",
					kind: { tag: "Predicate" },
					status: { tag: "Failed" },
					subjectId: "11",
					failureKind: "not_your_turn",
					failureDetail: "Waiting for Goblin Warrior. It is not your turn.",
					selectedTemplateIds: [],
					createdAtTick: 12n,
					bundleId: "srd",
				},
			],
			visible_world_event: [
				{ id: 1n, tick: 11n, kind: { tag: "Layer2" }, summary: "You hit Goblin Warrior for 5." },
			],
		});
	}

	it("renders roster, HP, current actor, and grid movement for the hero turn", () => {
		const view = readCombatSessionView(combatDb("11"), asEntityRef("phandelver/hero"));
		expect(view?.isHeroTurn).toBe(true);
		expect(view?.currentActorName).toBe("The Hero");
		expect(view?.waitingReason).toBeNull();
		expect(view?.roster.map((entry) => [entry.name, entry.hp, entry.defeated])).toEqual([
			["The Hero", 118, false],
			["Goblin Warrior", 0, true],
		]);
		expect(view?.grid?.cells).toHaveLength(3);
		expect(view?.grid?.moves.map((move) => [move.direction, move.edgeId])).toEqual([
			["east", "101"],
			["south", "102"],
		]);
		expect(view?.grid?.moves.map((move) => [move.label, move.costCells, move.blocked])).toEqual([
			["Rough ground", 2, false],
			["Blocked brush", 1, true],
		]);
	});

	it("turns not_your_turn into a waiting state for NPC turns", () => {
		const view = readCombatSessionView(combatDb("22"), asEntityRef("11"));
		expect(view?.isHeroTurn).toBe(false);
		expect(view?.waitingReason).toBe("Waiting for Goblin Warrior. It is not your turn.");
		expect(view?.feedback).toEqual({
			kind: "rejection",
			text: "Waiting for Goblin Warrior. It is not your turn.",
		});
	});

	it("disambiguates duplicate combatant names", () => {
		const db = makeDb({
			session: [
				{
					sessionId: 7n,
					sessionDefId: "srd/session/combat",
					lifecycle: "active",
					currentActor: "33",
				},
			],
			session_participant: [
				{ sessionId: 7n, actorId: "11", ordinal: 0, joinedAt: 10n },
				{ sessionId: 7n, actorId: "22", ordinal: 1, joinedAt: 10n },
				{ sessionId: 7n, actorId: "33", ordinal: 2, joinedAt: 10n },
			],
			visible_actor_spatial_location: [
				{ entityId: 11n, placeNodeId: "session_grid_7/c_0_0" },
				{ entityId: 22n, placeNodeId: "session_grid_7/c_1_0" },
				{ entityId: 33n, placeNodeId: "session_grid_7/c_0_1" },
			],
			entity: [
				{
					entityId: 11n,
					entityDefId: "core:hero",
					name: "The Hero",
					kind: "actor",
					createdAtTick: 1n,
					quantity: 1n,
					ownedByEntityId: 0n,
				},
				{
					entityId: 22n,
					entityDefId: "core:goblin",
					name: "Goblin Warrior",
					kind: "actor",
					createdAtTick: 1n,
					quantity: 1n,
					ownedByEntityId: 0n,
				},
				{
					entityId: 33n,
					entityDefId: "core:goblin",
					name: "Goblin Warrior",
					kind: "actor",
					createdAtTick: 1n,
					quantity: 1n,
					ownedByEntityId: 0n,
				},
			],
			visible_object_state: [],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "phandelver:phandelver/hero", bundleId: "phandelver", entityId: 11n },
			],
			visible_place_graph_definition: [
				{
					placeGraphId: "session_grid_7",
					anchorNodeId: "triboar/ambush_site",
					isEphemeralInstance: true,
				},
			],
			visible_place_node: [
				{
					nodeId: "session_grid_7/c_0_0",
					placeGraphId: "session_grid_7",
					posX: 0,
					posY: 0,
					posPresent: true,
				},
				{
					nodeId: "session_grid_7/c_1_0",
					placeGraphId: "session_grid_7",
					posX: 1,
					posY: 0,
					posPresent: true,
				},
				{
					nodeId: "session_grid_7/c_0_1",
					placeGraphId: "session_grid_7",
					posX: 0,
					posY: 1,
					posPresent: true,
				},
			],
			visible_place_edge: [],
			visible_evaluation_provenance: [],
			visible_world_event: [],
		});

		const view = readCombatSessionView(db, asEntityRef("phandelver/hero"));
		expect(view?.currentActorName).toBe("Goblin Warrior 2");
		expect(view?.roster.map((entry) => entry.name)).toEqual([
			"The Hero",
			"Goblin Warrior 1",
			"Goblin Warrior 2",
		]);
	});
});

describe("faction tag readers (sk-jay0.6.15.56.16.12.20)", () => {
	const db = makeDb({
		visible_entity_tag: [
			{ key: "k1", entityId: 10n, tag: "srd.faction.monsters", bundleId: "srd" },
			{ key: "k2", entityId: 20n, tag: "faction:redbrand", bundleId: "phandelver" },
			{ key: "k3", entityId: 30n, tag: "unrelated:tag", bundleId: "core" },
		],
	});

	it("readEntityFaction supports srd.faction.* and legacy faction:* tags", () => {
		expect(readEntityFaction(db, 10n)).toBe("monsters");
		expect(readEntityFaction(db, "10")).toBe("monsters");
		expect(readEntityFaction(db, 20n)).toBe("redbrand");
		expect(readEntityFaction(db, "20")).toBe("redbrand");
		expect(readEntityFaction(db, 30n)).toBeNull();
		expect(readEntityFaction(db, 999n)).toBeNull();
	});

	it("buildEntityFactionMap parses srd.faction.* and legacy faction:* tags", () => {
		const map = buildEntityFactionMap(db);
		expect(map.get("10")).toBe("monsters");
		expect(map.get("20")).toBe("redbrand");
		expect(map.has("30")).toBe(false);
		expect(map.has("999")).toBe(false);
	});
});
