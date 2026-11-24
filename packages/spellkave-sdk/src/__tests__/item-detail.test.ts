import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readAuthorizedItemDetail } from "../core/readers/item_detail";

const db = snapshotDbFromFixture({
	visible_entity_tag: [],
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	public_metadata_attachment: [
		{
			namespace: "test.art.image",
			audience: "public",
			bundleId: "test",
			targetKind: "entity_definition",
			targetRef: "srd/torch",
			payloadJson: JSON.stringify({
				path: "test/torch.webp",
				hash: "a".repeat(64),
				license: "CC0-1.0",
			}),
		},
	],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	entity_definition: [{ entityDefId: "srd/longsword", description: "A versatile steel blade." }],
	entity_description: [{ entityId: 3n, description: "A small blue bottle." }],
	resource_definition: [
		{
			resourceDefinitionId: "srd/charges",
			displayName: "Remaining doses",
			description: "How many doses remain in this item.",
		},
	],
	object_state_definition: [],
	entity: [
		{ entityId: 2n, name: "Longsword", entityDefId: "srd/longsword", kind: "item", quantity: 1n },
		{ entityId: 3n, name: "Healing Potion", entityDefId: "srd/potion", kind: "item", quantity: 2n },
		{ entityId: 4n, name: "Torch", entityDefId: "srd/torch", kind: "item", quantity: 1n },
		{ entityId: 9n, name: "Remote Key", entityDefId: "test/key", kind: "item", quantity: 1n },
	],
	visible_entity_containment: [
		{ entityId: 2n, containerId: 1n, slotId: "", direction: "", insertedAtTick: 1n },
		{ entityId: 3n, containerId: 1n, slotId: "belt", direction: "", insertedAtTick: 2n },
		{ entityId: 4n, containerId: 1n, slotId: "", direction: "", insertedAtTick: 3n },
	],
	equipment_slot_definition: [
		{
			slotId: "srd/main_hand",
			bundleId: "srd",
			label: "Main hand",
			defaultCompatibilityPredicate: "",
		},
	],
	visible_entity_equipment_slot: [
		{ rowId: 1n, entityId: 1n, slotId: "srd/main_hand", equippedEntityId: 2n, equippedAtTick: 4n },
	],
	owned_object_state: [
		{
			rowId: 1n,
			targetKind: "entity",
			targetId: "3",
			stateId: "srd/charges",
			value: { tag: "Int", value: 1n },
			sourceTemplateId: "srd/potion",
			setAtTick: 5n,
			expiresAtTick: 0n,
			bundleId: "srd",
		},
	],
});

describe("authorized item detail projection", () => {
	it("joins weapon identity, quantity, containment and equipment role", () => {
		expect(readAuthorizedItemDetail(db, asEntityRef("1"), "2")).toMatchObject({
			entity_id: "2",
			name: "Longsword",
			description: "A versatile steel blade.",
			quantity: 1,
			containment: { container_id: "1", depth: 0 },
			equipment: { owner_entity_id: "1", slot_id: "srd/main_hand", slot_label: "Main hand" },
			states: [],
		});
	});

	it("returns potion state in the same read", () => {
		expect(readAuthorizedItemDetail(db, asEntityRef("1"), "3")).toMatchObject({
			name: "Healing Potion",
			description: "A small blue bottle.",
			quantity: 2,
			containment: { slot_id: "belt" },
			equipment: null,
			states: [
				{
					state_id: "srd/charges",
					display_name: "Remaining doses",
					description: "How many doses remain in this item.",
					value: '{"tag":"Int","value":"1"}',
				},
			],
		});
	});

	it("returns an explicit empty state slice", () => {
		expect(readAuthorizedItemDetail(db, asEntityRef("1"), "4")?.states).toEqual([]);
		expect(readAuthorizedItemDetail(db, asEntityRef("1"), "4")).not.toHaveProperty("description");
		expect(readAuthorizedItemDetail(db, asEntityRef("1"), "4")?.art?.path).toBe("test/torch.webp");
	});

	it("denies a remote item absent from authorized containment", () => {
		expect(readAuthorizedItemDetail(db, asEntityRef("1"), "9")).toBeNull();
	});
});
