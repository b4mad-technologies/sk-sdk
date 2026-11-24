import { asEntityRef, snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import { createCompanionWorldDeltaSource } from "../delta-tracker";

// The delta tracker derives its affordance domain from factual manipulation
// context, so ordinary authored metadata cannot create a delta item.
describe("companion world-delta source affordance sample", () => {
	const templateId = "srd/cast_acid_splash/affordance";
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		world_time: [{ tick: 999n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		affordance_template: [
			{
				templateId,
				bundleId: "srd",
				nicheId: "srd/cast",
				capabilityId: "srd/cast",
				displayName: "Cast Acid Splash",
				outcomeTemplateId: "srd/cast/outcome",
				priority: 0,
			},
		],
		visible_manipulation_context: [
			{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true },
		],
		action_definition: [
			{
				actionId: "srd/cast",
				displayName: "Cast Acid Splash",
				selfOnly: false,
				selfEligible: false,
			},
		],
		outcome_template: [{ outcomeTemplateId: "srd/cast/outcome", manipulationActionId: "srd/cast" }],
		visible_manipulation_available_action: [
			{ perceiverEntityId: 1n, actionId: "srd/cast", templateIds: [templateId], nicheIds: [] },
		],
		visible_manipulation_observed_target: [
			{
				targetFactId: "target:1:entity:5",
				perceiverEntityId: 1n,
				targetRef: { tag: "Entity", value: 5n },
				nicheIds: [],
			},
		],
		public_metadata_attachment: [
			{
				namespace: "srd.art.image",
				audience: "public",
				bundleId: "srd",
				targetKind: "affordance_template",
				targetRef: templateId,
				payloadJson: JSON.stringify({
					path: "srd-art/affordances/acid-splash.webp",
					hash: "c".repeat(64),
					license: "CC-BY-4.0",
				}),
			},
		],
	});

	it("samples factual manipulation actions and targets without reading authored art", () => {
		const actor = asEntityRef("1");
		const source = createCompanionWorldDeltaSource(
			() => db,
			() => actor,
		);
		const projection = source.sample();
		expect(projection.affordance).toEqual([
			{ fingerprint: "action:srd/cast", name: "Cast Acid Splash" },
			{ fingerprint: "target:target:1:entity:5", name: "entity:5" },
		]);
	});
});
