import { describe, expect, it } from "vitest";
import {
	classifyWorldAdded,
	collectLivePlaces,
	collectWorldRows,
	equipmentSlotsFromEntries,
	type MemoryEntityView,
	memoryViewFromEntries,
	seedsFromCollected,
	snapshotFromTables,
} from "../applyset-world-rows.ts";

const OWNER_TABLE_PINS = [
	{ table: "entity_location", key: "a/elsewhere" },
	{ table: "entity_containment", key: "content:99" },
	{ table: "object_state", key: "a/bonus" },
	{ table: "capability", key: "a/grant" },
	{ table: "actor_identity", key: "7" },
	{ table: "actor_spatial_location", key: "a/moved" },
	{ table: "entity_equipment_slot", key: "wearer:ring" },
	{ table: "target_condition", key: "a/hex" },
] as const;

const ENTITY: MemoryEntityView = {
	entityKey: "a/hero",
	placeNodeId: "a/cell",
};

function added(
	tables: Record<string, Record<string, unknown>[]>,
	memory: MemoryEntityView = ENTITY,
	seeds?: Parameters<typeof classifyWorldAdded>[0]["seeds"],
) {
	return classifyWorldAdded({
		collected: collectWorldRows(snapshotFromTables(tables), "10"),
		memory,
		seeds,
	});
}

describe("world-added expected set", () => {
	it("returns empty when the world holds only the memory rows", () => {
		expect(
			added({
				entity: [{ entityId: "10", entityDefId: "a/hero-def" }],
				entityLocation: [{ entityId: "10", placeNodeId: "a/cell" }],
			}),
		).toEqual([]);
	});

	it("returns empty for a placed entity whose location is the entities row", () => {
		expect(
			added(
				{
					entity: [{ entityId: "10", entityDefId: "a/hero-def" }],
					entityLocation: [{ entityId: "10", placeNodeId: "a/yard" }],
				},
				{ entityKey: "a/hero", placeNodeId: "a/yard" },
			),
		).toEqual([]);
	});

	it("returns empty when definition seeds cover capability, state, condition, and equipment", () => {
		expect(
			added(
				{
					entity: [{ entityId: "10", entityDefId: "a/hero-def" }],
					entityLocation: [{ entityId: "10", placeNodeId: "a/cell" }],
					capability: [{ entityId: "10", capabilityId: "a/walk" }],
					objectState: [{ targetId: "10", stateId: "a/hp" }],
					targetCondition: [{ targetId: "10", conditionDefinitionId: "a/blessed" }],
					entityEquipmentSlot: [{ entityId: "10", slotId: "main_hand", equippedEntityId: "11" }],
					entityDefinitionInitialCapability: [
						{ entityDefId: "a/hero-def", capabilityId: "a/walk" },
					],
					entityDefinitionInitialState: [{ entityDefId: "a/hero-def", stateId: "a/hp" }],
					entityDefinitionInitialCondition: [
						{ entityDefId: "a/hero-def", conditionDefinitionId: "a/blessed" },
					],
					entityDefinitionInitialEquipment: [
						{ entityDefId: "a/hero-def", equippedEntityDefId: "a/sword", slotId: "main_hand" },
					],
				},
				ENTITY,
				{
					capabilities: ["a/walk"],
					states: ["a/hp"],
					conditions: ["a/blessed"],
					equipment: [{ slot: "main_hand" }],
				},
			),
		).toEqual([]);
	});

	it("returns empty for an authored equipped item on the item side of the slot", () => {
		const entries = [
			{ kind: "actor_equipment_slots", key: JSON.stringify(["a/hero", "main_hand"]) },
		];
		const collected = collectWorldRows(
			snapshotFromTables({
				entity: [{ entityId: "11", entityDefId: "a/sword" }],
				operatorManifestAuthoredEntity: [
					{ entityId: "10", manifestKey: "a:a/hero" },
					{ entityId: "11", manifestKey: "a:a/sword-1" },
				],
				entityEquipmentSlot: [{ entityId: "10", slotId: "main_hand", equippedEntityId: "11" }],
			}),
			"11",
		);
		expect(
			classifyWorldAdded({
				collected,
				memory: memoryViewFromEntries(entries, "a/sword-1"),
				equipmentSlots: equipmentSlotsFromEntries(entries),
			}).filter((row) => row.table === "entity_equipment_slot"),
		).toEqual([]);
	});

	it("lists an item held by another wearer than the memory names", () => {
		const entries = [
			{ kind: "actor_equipment_slots", key: JSON.stringify(["a/hero", "main_hand"]) },
		];
		const collected = collectWorldRows(
			snapshotFromTables({
				entity: [{ entityId: "11", entityDefId: "a/sword" }],
				operatorManifestAuthoredEntity: [
					{ entityId: "9", manifestKey: "a:a/other" },
					{ entityId: "11", manifestKey: "a:a/sword-1" },
				],
				entityEquipmentSlot: [{ entityId: "9", slotId: "main_hand", equippedEntityId: "11" }],
			}),
			"11",
		);
		expect(
			classifyWorldAdded({
				collected,
				memory: memoryViewFromEntries(entries, "a/sword-1"),
				equipmentSlots: equipmentSlotsFromEntries(entries),
			}).filter((row) => row.table === "entity_equipment_slot"),
		).toEqual([
			{
				table: "entity_equipment_slot",
				key: "item:main_hand@a/other",
				heading: "taken",
			},
		]);
	});

	it("returns empty for an authored chest with its authored potion", () => {
		const entries = [
			{
				kind: "entity_containment",
				key: JSON.stringify(["a/chest", "a/potion-1"]),
			},
		];
		const collected = collectWorldRows(
			snapshotFromTables({
				entity: [
					{ entityId: "10", entityDefId: "a:a/chest" },
					{ entityId: "11", entityDefId: "a:a/potion-1" },
				],
				operatorManifestAuthoredEntity: [
					{ entityId: "10", manifestKey: "a:a/chest" },
					{ entityId: "11", manifestKey: "a:a/potion-1" },
				],
				entityContainment: [{ entityId: "11", containerId: "10" }],
			}),
			"10",
		);
		expect(
			classifyWorldAdded({
				collected,
				memory: memoryViewFromEntries(entries, "a/chest"),
				seeds: seedsFromCollected(collected),
			}),
		).toEqual([]);
	});

	it("lists containment in a body the memory does not hold as taken", () => {
		expect(
			added({
				entity: [{ entityId: "10", entityDefId: "a/hero-def" }],
				entityLocation: [{ entityId: "10", placeNodeId: "a/cell" }],
				entityContainment: [{ entityId: "10", containerId: "99" }],
			}),
		).toEqual([{ table: "entity_containment", key: "content:99", heading: "taken" }]);
	});

	it("lists a world-applied condition and an extra occupant as left behind", () => {
		expect(
			added({
				entity: [{ entityId: "10", entityDefId: "a/chest" }],
				entityContainment: [{ entityId: "22", containerId: "10" }],
				targetCondition: [{ targetId: "10", conditionDefinitionId: "a/wet" }],
			}),
		).toEqual(
			expect.arrayContaining([
				{ table: "target_condition", key: "a/wet", heading: "left_behind" },
				{ table: "entity_containment", key: "container:22", heading: "left_behind" },
			]),
		);
	});

	it("finds identity via actor.current_body, not a coincidental actor_id == body id", () => {
		const collected = collectWorldRows(
			snapshotFromTables({
				entity: [{ entityId: "10", entityDefId: "a/hero-def" }],
				actor: [
					{ actorId: "7", currentBody: "10" },
					{ actorId: "10", currentBody: "99" },
				],
				actorIdentity: [
					{ actorId: "7", identity: "aa" },
					{ actorId: "10", identity: "bb" },
				],
			}),
			"10",
		);
		const identities = collected.rows.filter((row) => row.table === "actor_identity");
		expect(identities).toEqual([{ table: "actor_identity", key: "aa" }]);
	});

	it("pins one world-added row per owner table except place rows the builder owns", () => {
		const added = classifyWorldAdded({
			collected: { entityId: "10", entityDefId: "a/hero-def", rows: [...OWNER_TABLE_PINS] },
			memory: { entityKey: "a/hero", placeNodeId: "" },
		});
		const listed = OWNER_TABLE_PINS.filter(
			(row) => row.table !== "entity_location" && row.table !== "actor_spatial_location",
		);
		expect(added).toHaveLength(listed.length);
		expect(added.map((row) => row.table).sort()).toEqual(listed.map((row) => row.table).sort());
		expect(added.filter((row) => row.heading === "left_behind")).toEqual([
			{ table: "target_condition", key: "a/hex", heading: "left_behind" },
		]);
	});

	it("does not classify place rows; the builder reconstructed-hash owns them", () => {
		expect(
			added({
				entity: [{ entityId: "10", entityDefId: "a/hero-def" }],
				entityLocation: [{ entityId: "10", placeNodeId: "a/elsewhere" }],
			}),
		).toEqual([]);
	});

	it("does not list a $sender identity that is the applying publisher", () => {
		expect(
			classifyWorldAdded({
				collected: {
					entityId: "10",
					entityDefId: "a/hero-def",
					rows: [{ table: "actor_identity", key: "pubhex" }],
				},
				memory: { entityKey: "a/hero", placeNodeId: "", identities: ["$sender"] },
				publisherIdentity: "pubhex",
			}),
		).toEqual([]);
	});

	it("lists a foreign identity on a body that only authored $sender", () => {
		expect(
			classifyWorldAdded({
				collected: {
					entityId: "10",
					entityDefId: "a/hero-def",
					rows: [
						{ table: "actor_identity", key: "pubhex" },
						{ table: "actor_identity", key: "claimed" },
					],
				},
				memory: { entityKey: "a/hero", placeNodeId: "", identities: ["$sender"] },
				publisherIdentity: "pubhex",
			}),
		).toEqual([{ table: "actor_identity", key: "claimed", heading: "taken" }]);
	});

	it("lists a second same-def item in a seeded container", () => {
		const collected = collectWorldRows(
			snapshotFromTables({
				entity: [
					{ entityId: "10", entityDefId: "a/chest" },
					{ entityId: "11", entityDefId: "a/potion" },
					{ entityId: "12", entityDefId: "a/potion" },
				],
				entityContainment: [
					{ entityId: "11", containerId: "10" },
					{ entityId: "12", containerId: "10" },
				],
				entityDefinitionInitialContainment: [
					{
						entityDefId: "a/chest",
						containedEntityDefId: "a/potion",
						quantity: 1,
					},
				],
			}),
			"10",
		);
		expect(
			classifyWorldAdded({
				collected,
				memory: memoryViewFromEntries([], "a/chest"),
				seeds: seedsFromCollected(collected),
			}),
		).toEqual([{ table: "entity_containment", key: "container:a/potion", heading: "left_behind" }]);
	});

	it("does not treat bundle B equipment memory as expected for bundle A's slot", () => {
		const entries = [
			{
				kind: "actor_equipment_slots",
				key: JSON.stringify(["a/hero", "main_hand"]),
				bundle_id: "b",
			},
		];
		expect(equipmentSlotsFromEntries(entries, "a")).toEqual([]);
	});

	it("does not treat bundle B memory as expected for bundle A's entity key", () => {
		const entries = [
			{
				kind: "object_state",
				key: JSON.stringify(["shared/item", "a/bonus"]),
				bundle_id: "b",
			},
		];
		const collected = collectWorldRows(
			snapshotFromTables({
				entity: [{ entityId: "10", entityDefId: "a/def" }],
				objectState: [{ targetId: "10", stateId: "a/bonus" }],
			}),
			"10",
		);
		expect(
			classifyWorldAdded({
				collected,
				memory: memoryViewFromEntries(entries, "shared/item", "a"),
			}),
		).toEqual([{ table: "object_state", key: "a/bonus", heading: "taken" }]);
	});

	it("collectLivePlaces uses empty place for a contained entity", () => {
		expect(
			collectLivePlaces(
				snapshotFromTables({
					operatorManifestAuthoredEntity: [
						{ entityId: "11", manifestKey: "a:a/potion" },
						{ entityId: "10", manifestKey: "a:a/chest" },
					],
					entityContainment: [{ entityId: "11", containerId: "10" }],
				}),
			),
		).toEqual(expect.arrayContaining([{ kind: "entities", key: "a/potion", place_node_id: "" }]));
	});

	it("lists a claimed seat through memoryViewFromEntries $sender identities", () => {
		const entries = [
			{
				kind: "actor_identities",
				key: JSON.stringify(["a/hero", "$sender"]),
				bundle_id: "a",
			},
		];
		expect(
			classifyWorldAdded({
				collected: {
					entityId: "10",
					entityDefId: "a/hero-def",
					rows: [
						{ table: "actor_identity", key: "pubhex" },
						{ table: "actor_identity", key: "claimed" },
					],
				},
				memory: memoryViewFromEntries(entries, "a/hero", "a"),
				publisherIdentity: "pubhex",
			}),
		).toEqual([{ table: "actor_identity", key: "claimed", heading: "taken" }]);
	});
});
