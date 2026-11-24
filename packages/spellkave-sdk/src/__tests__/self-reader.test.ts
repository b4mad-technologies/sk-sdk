import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readSelfConditions, readSelfStates, readSelfSummary } from "../core/readers/self";

const conditions = [4, 1, 5, 0, 3, 2].map((index) => ({
	rowId: BigInt(index + 1),
	targetKind: "entity",
	targetId: 1n,
	conditionDefinitionId: `condition/${index}`,
	sourceId: `source/${index}`,
	appliedAtTick: BigInt(index),
	stackCount: 1,
	bundleId: "test",
}));

const fixture = {
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "village" }],
	visible_actor_spatial_location: [
		{ entityId: 1n, placeNodeId: "village" },
		{ entityId: 2n, placeNodeId: "village" },
	],
	visible_target_condition: conditions,
	condition_definition: [
		{ conditionDefinitionId: "condition/0" },
		{ conditionDefinitionId: "condition/1" },
		{ conditionDefinitionId: "condition/unrelated" },
	],
	condition_definition_description: [
		{ conditionDefinitionId: "condition/0", description: "An authored explanation." },
		{ conditionDefinitionId: "condition/1", description: "  " },
		{ conditionDefinitionId: "condition/unrelated", description: "An unrelated explanation." },
	],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	entity: [
		{ entityId: 1n, entityDefId: "srd/hero", name: "Hero" },
		{ entityId: 2n, entityDefId: "srd/companion", name: "Companion" },
	],
	visible_entity_tag: [],
	entity_definition_tag: [
		{
			rowId: 1n,
			entityDefId: "srd/hero",
			tag: "srd.species.human",
			bundleId: "test",
			source: "test",
		},
		{
			rowId: 2n,
			entityDefId: "srd/hero",
			tag: "srd.class.fighter",
			bundleId: "test",
			source: "test",
		},
		{
			// A different entity's own definition tag — must never leak into actor "1"'s listing.
			rowId: 3n,
			entityDefId: "srd/companion",
			tag: "srd.species.elf",
			bundleId: "test",
			source: "test",
		},
	],
	owned_object_state: [
		{
			rowId: 1n,
			targetKind: "entity",
			targetId: "1",
			stateId: "srd/hp",
			value: { tag: "Int", value: 12n },
			setAtTick: 1n,
		},
		{
			rowId: 2n,
			targetKind: "entity",
			targetId: "1",
			stateId: "story/objective",
			value: { tag: "Int", value: 1n },
			setAtTick: 2n,
		},
		{
			rowId: 3n,
			targetKind: "entity",
			targetId: "1",
			stateId: "srd/appearance",
			value: { tag: "Text", value: "Weathered cloak, grey eyes." },
			setAtTick: 3n,
		},
		{
			rowId: 4n,
			targetKind: "entity",
			targetId: "1",
			stateId: "srd/backstory",
			value: { tag: "Text", value: "Left the city after the fire." },
			setAtTick: 4n,
		},
	],
	resource_definition: [
		{ resourceDefinitionId: "srd/hp", displayName: "Hit Points", valueKind: "int" },
		{ resourceDefinitionId: "story/objective", displayName: "Objective", valueKind: "int" },
	],
	resource_definition_tag: [
		{ resourceDefinitionId: "srd/hp", tag: "core" },
		{ resourceDefinitionId: "story/objective", tag: "quest" },
	],
	// ui.self_summary membership (#2119) — author-driven, replaces the old
	// literal "core"/"quest" resource_definition_tag filter this reader used
	// to apply itself. The resource_definition_tag rows above stay in the
	// fixture: they now only back readActorStates' generic stateTag filter
	// (tested below), unrelated to self-summary bucket membership.
	public_metadata_attachment: [
		{
			rowId: 1n,
			targetKind: "resource_definition",
			targetRef: "srd/hp",
			namespace: "ui.self_summary",
			payloadJson: '{"slot":"vitals","order":10}',
			audience: "public",
			bundleId: "srd",
			source: "manifest",
			setAtTick: 0n,
		},
		{
			rowId: 2n,
			targetKind: "resource_definition",
			targetRef: "story/objective",
			namespace: "ui.self_summary",
			payloadJson: '{"slot":"quest","order":10}',
			audience: "public",
			bundleId: "srd",
			source: "manifest",
			setAtTick: 0n,
		},
	],
};

const db = snapshotDbFromFixture(fixture);

describe("self reader projections", () => {
	it("returns compact vitals and quest bucket envelopes, author-driven via ui.self_summary metadata", () => {
		expect(readSelfSummary(db, asEntityRef("1"))).toMatchObject({
			entity_name: "Hero",
			state_count: 4,
			appearance: "Weathered cloak, grey eyes.",
			backstory: "Left the city after the fire.",
			vitals: {
				count: 1,
				listing: "complete",
				items: [{ state_id: "srd/hp", value: "12" }],
			},
			quest: {
				count: 1,
				listing: "complete",
				items: [{ state_id: "story/objective", value: "1" }],
			},
		});
		// Removed 2026-08-03: identity moved off the recurring glance onto
		// `readSelfIdentity` (`self_identity.test.ts`) — static entity-definition
		// data doesn't belong here, same axis as the earlier `recent_evaluations`
		// removal.
		expect(readSelfSummary(db, asEntityRef("1"))).not.toHaveProperty("identity_tags");
	});

	it("sorts condition rows stably across cache permutations", () => {
		const reversedDb = snapshotDbFromFixture({
			...fixture,
			visible_target_condition: [...conditions].reverse(),
		});
		const expected = Array.from({ length: 6 }, (_, index) => `condition/${index}`);
		expect(
			readSelfConditions(db, asEntityRef("1")).map((row) => row.condition_definition_id),
		).toEqual(expected);
		expect(readSelfConditions(reversedDb, asEntityRef("1"))).toEqual(
			readSelfConditions(db, asEntityRef("1")),
		);
	});

	it("enriches only authorized condition detail and omits unavailable prose", () => {
		const result = readSelfConditions(db, asEntityRef("1"));
		expect(result[0]).toHaveProperty("description", "An authored explanation.");
		expect(result[1]).not.toHaveProperty("description");
		expect(result[2]).not.toHaveProperty("description");
		expect(result).toHaveLength(6);
		expect(JSON.stringify(readSelfSummary(db, asEntityRef("1")))).not.toContain(
			"An authored explanation.",
		);
	});

	it("filters state prefix and exact authored tag", () => {
		expect(readSelfStates(db, asEntityRef("1"), { statePrefix: "story/" })).toHaveLength(1);
		expect(readSelfStates(db, asEntityRef("1"), { stateTag: "core" })[0]?.state_id).toBe("srd/hp");
	});

	it("cannot read a co-located remote body's self sheet", () => {
		expect(readSelfSummary(db, asEntityRef("2"))).toBeNull();
		expect(readSelfStates(db, asEntityRef("2"))).toEqual([]);
		expect(readSelfConditions(db, asEntityRef("2"))).toEqual([]);
	});
});
