import { snapshotDbFromFixture } from "@spellkave/sdk";
import { expect, it } from "vitest";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

it("carries only owned state prose and available affordance explanations through PLAYER tools", async () => {
	const templates = [
		{
			templateId: "test/inspect",
			displayName: "Inspect",
			description: "Study the visible markings.",
		},
	];
	const groupRows = [
		{
			rowId: 1n,
			namespace: "ui.affordance_group",
			targetKind: "affordance_template",
			targetRef: "test/inspect",
			audience: "public",
			payloadJson: '{"group":"survey"}',
		},
		{
			rowId: 2n,
			namespace: "ui.affordance_group",
			targetKind: "affordance_template",
			targetRef: "test/inspect",
			audience: "public",
			payloadJson: '{"group":"orbital-maintenance"}',
		},
		{
			rowId: 3n,
			namespace: "ui.affordance_group",
			targetKind: "affordance_template",
			targetRef: "test/inspect",
			audience: "private",
			payloadJson: '{"group":"hidden-operator"}',
		},
	];
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		public_metadata_attachment: groupRows,
		world_time: [{ tick: 1n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		directly_controlled_actor_spatial_location: [{ entityId: 1n }],
		owned_object_state: [
			{ targetKind: "entity", targetId: "1", stateId: "test/beacon", value: 0n },
		],
		resource_definition: [
			{
				resourceDefinitionId: "test/beacon",
				displayName: "Beacon",
				description: "Restore the distant beacon.",
			},
			{ resourceDefinitionId: "test/unowned", description: "Unowned state prose" },
		],
		resource_definition_tag: [{ resourceDefinitionId: "test/beacon", tag: "quest" }],
		affordance_template: templates,
		visible_manipulation_context: [
			{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true },
		],
		action_definition: [
			{ actionId: "test/inspect", displayName: "Inspect", selfOnly: false, selfEligible: false },
		],
		outcome_template: [
			{ outcomeTemplateId: "test/inspect/outcome", manipulationActionId: "test/inspect" },
		],
		visible_manipulation_available_action: [
			{
				perceiverEntityId: 1n,
				actionId: "test/inspect",
				templateIds: ["test/inspect"],
				nicheIds: [],
			},
		],
		visible_manipulation_observed_target: [
			{
				targetFactId: "target:1:entity:2",
				perceiverEntityId: 1n,
				targetRef: { tag: "Entity", value: 2n },
				nicheIds: [],
			},
		],
	});
	const map = createPlayerFacingToolMap({ db, act: { actorId: "1" } } as SpellkaveToolContext);
	const states = await map.selfStates.execute("states", { kind: "state", state_tag: "quest" });
	expect(states).toMatchObject({
		details: { items: [{ state_id: "test/beacon", description: "Restore the distant beacon." }] },
	});
	expect(JSON.stringify(states)).not.toContain("Unowned state prose");
	const context = await map.manipulationContext.execute("context", { detail: "full" });
	expect(context).toMatchObject({
		details: {
			manipulation_context: {
				actions: [
					{
						action_id: "test/inspect",
						display_name: "Inspect",
						description: "Study the visible markings.",
						groups: ["orbital-maintenance", "survey"],
					},
				],
			},
		},
	});
	expect(JSON.stringify(context)).not.toContain("hidden-operator");
});
