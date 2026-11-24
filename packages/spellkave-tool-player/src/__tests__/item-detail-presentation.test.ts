import { snapshotDbFromFixture } from "@spellkave/sdk";
import { expect, it } from "vitest";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

it("carries authored detail through the inventory handle contract", async () => {
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		public_metadata_attachment: [
			{
				namespace: "test.art.image",
				audience: "public",
				bundleId: "test",
				targetKind: "entity_definition",
				targetRef: "test/blade",
				payloadJson: JSON.stringify({
					path: "test/blade.webp",
					hash: "a".repeat(64),
					license: "CC0-1.0",
				}),
			},
		],
		entity: [
			{ entityId: 2n, entityDefId: "test/blade", name: "Blade", kind: "item", quantity: 1n },
		],
		visible_entity_containment: [
			{ entityId: 2n, containerId: 1n, slotId: "", direction: "", insertedAtTick: 1n },
		],
		entity_definition: [{ entityDefId: "test/blade", description: "A carefully balanced blade." }],
		resource_definition: [{ resourceDefinitionId: "test/quality", displayName: "Craftsmanship" }],
		owned_object_state: [
			{ targetKind: "entity", targetId: "2", stateId: "test/quality", value: "Fine" },
		],
	});
	const map = createPlayerFacingToolMap({ db, act: { actorId: "1" } } as SpellkaveToolContext);
	const inventory = (await map.inventory.execute("inventory", {})) as {
		details: { items: { handle: string; rev: string }[] };
	};
	const item = inventory.details.items[0];
	expect(item).toBeDefined();
	const result = await map.itemDetail.execute("detail", { handle: item.handle, rev: item.rev });
	expect(result).toMatchObject({
		details: {
			status: "ok",
			item: {
				entity_id: "2",
				art: { path: "test/blade.webp", hash: "a".repeat(64), license: "CC0-1.0" },
				name: "Blade",
				entity_def_id: "test/blade",
				kind: "item",
				quantity: 1,
				containment: { container_id: "1", depth: 0 },
				equipment: null,
				description: "A carefully balanced blade.",
				states: [{ state_id: "test/quality", display_name: "Craftsmanship", value: "Fine" }],
			},
		},
	});
});

it("item_detail addresses a carried item by typed id and returns its handle and rev (sk-jay0.1.46)", async () => {
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		public_metadata_attachment: [],
		entity: [
			{ entityId: 2n, entityDefId: "test/blade", name: "Blade", kind: "item", quantity: 1n },
		],
		visible_entity_containment: [
			{ entityId: 2n, containerId: 1n, slotId: "", direction: "", insertedAtTick: 1n },
		],
		entity_definition: [{ entityDefId: "test/blade", description: "A carefully balanced blade." }],
	});
	const map = createPlayerFacingToolMap({ db, act: { actorId: "1" } } as SpellkaveToolContext);
	const byId = (await map.itemDetail.execute("detail", { target_id: "item:2" })) as {
		details: { status: string; handle: string; rev: string };
	};
	expect(byId.details.status).toBe("ok");
	expect(byId.details.handle).toBe("i:2");
	expect(
		await map.itemDetail.execute("detail", { handle: byId.details.handle, rev: byId.details.rev }),
	).toMatchObject({ details: { status: "ok", item: { entity_id: "2" } } });
	expect(await map.itemDetail.execute("detail", { target_id: "entity:9" })).toMatchObject({
		details: { status: "unknown_target" },
	});
});
