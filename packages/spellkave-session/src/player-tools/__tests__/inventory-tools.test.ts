import { snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import { createInventoryTool, createItemDetailTool } from "../tools";

const db = snapshotDbFromFixture({
	visible_entity_tag: [],
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
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
	],
	visible_entity_containment: [
		{ entityId: 2n, containerId: 1n, slotId: "", direction: "", insertedAtTick: 1n },
		{ entityId: 3n, containerId: 2n, slotId: "", direction: "", insertedAtTick: 2n },
		{ entityId: 4n, containerId: 1n, slotId: "belt", direction: "", insertedAtTick: 3n },
	],
});
const context = { db, act: { actorId: "1" } };

const detailDb = snapshotDbFromFixture({
	visible_entity_tag: [],
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	resource_definition: [
		{ resourceDefinitionId: "srd/charges", description: "Remaining doses in this item." },
	],
	entity: [
		{ entityId: 2n, name: "Longsword", entityDefId: "srd/longsword", kind: "item", quantity: 1n },
		{ entityId: 3n, name: "Healing Potion", entityDefId: "srd/potion", kind: "item", quantity: 2n },
		{ entityId: 4n, name: "Torch", entityDefId: "srd/torch", kind: "item", quantity: 1n },
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
const detailContext = { db: detailDb, act: { actorId: "1" } };

async function itemHandles() {
	const result = await createInventoryTool(detailContext).execute("items", { kind: "item" });
	return result.details as {
		items: { handle: string; rev: string; name: string }[];
	};
}

describe("queryable inventory tool", () => {
	it("groups the implicit self inventory into a nested tree when unfiltered and under the bound", async () => {
		const tool = createInventoryTool(context);
		expect((tool.parameters as { properties?: object }).properties).not.toHaveProperty("actor_id");
		const result = await tool.execute("tree", {});
		expect(result.details).toMatchObject({
			root_entity_id: "1",
			count: 3,
			total_quantity: 4,
			traversal_truncated: false,
			listing: "complete",
		});
		const details = result.details as {
			items: { name: string; kind: string; quantity: number; contents?: unknown[] }[];
		};
		const backpack = details.items.find((item) => item.name === "Backpack");
		expect(backpack).toMatchObject({
			kind: "container",
			quantity: 1,
			contents: [{ name: "Rope", entity_def_id: "test/rope" }],
		});
		const potion = details.items.find((item) => item.name === "Potion");
		expect(potion).toMatchObject({ kind: "item", quantity: 2, entity_def_id: "test/potion" });
		expect(potion).not.toHaveProperty("contents");
	});

	it("marks the equipped item with its slot id and leaves others unmarked", async () => {
		const tool = createInventoryTool(detailContext);
		const result = await tool.execute("equipped", {});
		const details = result.details as {
			items: { name: string; equipped_slot?: string }[];
		};
		const sword = details.items.find((item) => item.name === "Longsword");
		expect(sword).toMatchObject({ equipped_slot: "srd/main_hand" });
		const torch = details.items.find((item) => item.name === "Torch");
		expect(torch).not.toHaveProperty("equipped_slot");
	});

	it("falls back to the flat paged list when a filter is applied, echoing it back", async () => {
		const tool = createInventoryTool(context);
		const result = await tool.execute("filtered", { kind: "item" });
		expect(result.details).toMatchObject({
			listing: "paginated",
			shown: 2,
			matched: 2,
			truncated: false,
			kind: "item",
			name_prefix: null,
		});
		const details = result.details as { items: { handle: string; name: string }[] };
		expect(details.items.map((item) => item.name).sort()).toEqual(["Potion", "Rope"]);
		expect(details.items[0]).not.toHaveProperty("direction");
	});

	it("falls back to the flat paged list when the unfiltered count exceeds the limit", async () => {
		const tool = createInventoryTool(context);
		const first = await tool.execute("paged-1", { limit: 1 });
		expect(first.details).toMatchObject({
			listing: "paginated",
			shown: 1,
			matched: 3,
			truncated: true,
		});
		const second = await tool.execute("paged-2", {
			limit: 1,
			cursor: (first.details as { next_cursor: string }).next_cursor,
		});
		expect(second.details).toMatchObject({
			listing: "paginated",
			shown: 1,
			matched: 3,
			truncated: true,
		});
		const third = await tool.execute("paged-3", {
			limit: 1,
			cursor: (second.details as { next_cursor: string }).next_cursor,
		});
		expect(third.details).toMatchObject({
			listing: "paginated",
			shown: 1,
			matched: 3,
			truncated: false,
		});
	});

	it("keeps handle/rev alignment between the tree/paged listing and item detail", async () => {
		const listed = await itemHandles();
		const weapon = listed.items.find((item) => item.name === "Longsword");
		const tool = createItemDetailTool(detailContext);
		expect((tool.parameters as { properties?: object }).properties).toEqual({
			rev: expect.anything(),
			handle: expect.anything(),
			target_id: expect.anything(),
		});
		const result = await tool.execute("weapon", {
			rev: weapon?.rev ?? "",
			handle: weapon?.handle ?? "",
		});
		expect(result.details).toMatchObject({
			status: "ok",
			item: {
				name: "Longsword",
				quantity: 1,
				equipment: { slot_id: "srd/main_hand", slot_label: "Main hand" },
				states: [],
			},
		});
	});

	it("returns potion state without another object-state call", async () => {
		const listed = await itemHandles();
		const potion = listed.items.find((item) => item.name === "Healing Potion");
		const result = await createItemDetailTool(detailContext).execute("potion", {
			rev: potion?.rev ?? "",
			handle: potion?.handle ?? "",
		});
		expect(result.details).toMatchObject({
			status: "ok",
			item: {
				name: "Healing Potion",
				quantity: 2,
				states: [{ state_id: "srd/charges", description: "Remaining doses in this item." }],
			},
		});
	});

	it("cannot read a remote inventory absent from the caller view", async () => {
		const remote = { db, act: { actorId: "99" } };
		expect((await createInventoryTool(remote).execute("remote", {})).details).toMatchObject({
			root_entity_id: "99",
			count: 0,
			listing: "complete",
			items: [],
		});
	});

	it("rejects stale, cross-domain, and remote handles", async () => {
		const listed = await itemHandles();
		const tool = createItemDetailTool(detailContext);
		// biome-ignore lint/style/noNonNullAssertion: fixture guarantees at least one item
		const first = listed.items[0]!;
		// T12: a REAL handle with a WRONG (caller-stale-copied) rev — the
		// genuine per-target staleness case, not a made-up unknown identity.
		expect(
			(await tool.execute("stale", { rev: "old", handle: first.handle })).details,
		).toMatchObject({
			status: "stale_handle",
			// #1932: guidance names the tool to re-read for a fresh handle.
			reason: expect.stringContaining("spellkave_inventory"),
		});
		expect((await tool.execute("cross", { rev: first.rev, handle: "s:0" })).details).toMatchObject({
			status: "cross_domain",
			reason: expect.stringContaining("spellkave_inventory"),
		});
		const remote = { db: detailDb, act: { actorId: "99" } };
		expect(
			(await createItemDetailTool(remote).execute("remote", { rev: "irrelevant", handle: "i:0" }))
				.details,
		).toMatchObject({
			status: "unknown_handle",
			reason: expect.stringContaining("spellkave_inventory"),
		});
	});

	// #1932 (audit row 39): a kind/name_prefix filter matching nothing now says
	// what kinds ARE carried, instead of a silent shown:0.
	it("names the kinds actually carried when a filter matches nothing", async () => {
		const tool = createInventoryTool(context);
		const result = await tool.execute("kind-miss", { kind: "weapon" });
		expect(result.details).toMatchObject({
			listing: "paginated",
			matched: 0,
			values_present: ["container", "item"],
			reason: "No items with kind='weapon'; kinds carried: [container, item].",
		});
	});
});
