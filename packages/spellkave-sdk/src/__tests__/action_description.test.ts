import { expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readManipulationContext } from "../core/readers/manipulation_context";

// K2: world-public prose precedence and honest absence at the reader boundary.
it.each([
	["Action words", "", "Action words"],
	["Action words", "Template words", "Template words"],
	["", "", undefined],
])("projects action prose with a template override: %s / %s", (actionText, templateText, expected) => {
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manipulation_context: [
			{ perceiverEntityId: 7n, ready: true, schemaVersion: 1, revision: 1n },
		],
		visible_manipulation_available_action: [
			{ perceiverEntityId: 7n, actionId: "action", nicheIds: [], templateIds: ["template"] },
		],
		action_definition: [{ actionId: "action", displayName: "Act", description: actionText }],
		affordance_template: [{ templateId: "template", description: templateText }],
		outcome_template: [{ manipulationActionId: "action" }],
	});
	const context = readManipulationContext(db, asEntityRef("entity:7"));
	expect(context.status === "ready" ? context.actions[0]?.description : null).toBe(expected);
});
