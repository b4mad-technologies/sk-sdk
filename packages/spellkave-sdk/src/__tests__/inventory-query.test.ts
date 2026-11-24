import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readInventoryProjection } from "../core/readers/inventory_query";

const db = snapshotDbFromFixture({
	visible_entity_tag: [],
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [
		{ manifestKey: "test:test/hero", entityId: 1n },
		{ manifestKey: "test:test/remote", entityId: 99n },
	],
	entity: [
		{
			entityId: 2n,
			name: "Backpack",
			entityDefId: "test/backpack",
			kind: "container",
			quantity: 1n,
		},
		{ entityId: 3n, name: "Rope", entityDefId: "test/rope", kind: "item", quantity: 1n },
		{ entityId: 4n, name: "Potion", entityDefId: "test/potion", kind: "item", quantity: 2n },
		{ entityId: 90n, name: "Remote Sword", entityDefId: "test/sword", kind: "item", quantity: 1n },
	],
	visible_entity_containment: [
		{ entityId: 3n, containerId: 2n, slotId: "", direction: "", insertedAtTick: 2n },
		{ entityId: 4n, containerId: 1n, slotId: "belt", direction: "", insertedAtTick: 3n },
		{ entityId: 2n, containerId: 1n, slotId: "", direction: "", insertedAtTick: 1n },
	],
});

describe("authorized inventory projection", () => {
	it("walks nested containment deterministically from the connected root", () => {
		const result = readInventoryProjection(db, asEntityRef("test/hero"));
		expect(result?.items.map((item) => [item.entity_id, item.depth])).toEqual([
			["2", 0],
			["4", 0],
			["3", 1],
		]);
		expect(result?.items[2]).toMatchObject({ name: "Rope", container_path: ["1", "2", "3"] });
	});

	it("reports depth truncation without crossing the bound", () => {
		const result = readInventoryProjection(db, asEntityRef("1"), { maxDepth: 0 });
		expect(result).toMatchObject({ truncated: true, max_depth: 0 });
		expect(result?.items.map((item) => item.entity_id)).toEqual(["2", "4"]);
	});

	it("returns no rows for a known remote body absent from the server view", () => {
		expect(readInventoryProjection(db, asEntityRef("test/remote"))).toMatchObject({
			root_entity_id: "99",
			items: [],
		});
	});
});
