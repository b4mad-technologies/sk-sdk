import { describe, expect, it, vi } from "vitest";
import { INSTANCE_ROW_KINDS } from "../filter-manifest-core";
import { createOwnerInstanceRead, type OwnerSnapshot } from "../owner-instance-read";

function table(rows: Record<string, unknown>[]): { iter: () => Iterable<Record<string, unknown>> } {
	return { iter: () => rows };
}

function snap(parts: Record<string, Record<string, unknown>[]>): OwnerSnapshot {
	const out: OwnerSnapshot = {};
	for (const [k, v] of Object.entries(parts)) out[k] = table(v);
	return out;
}

describe("INSTANCE_ROW_KINDS", () => {
	it("is the eight instance kinds, bundles left out", () => {
		expect([...INSTANCE_ROW_KINDS]).toEqual([
			"entities",
			"actors",
			"actor_spatial_locations",
			"actor_capabilities",
			"actor_equipment_slots",
			"entity_containment",
			"entity_tag",
			"object_state",
		]);
	});
});

describe("createOwnerInstanceRead", () => {
	const maeChest = {
		manifestKey: "kavemouth:kavemouth/adventure/item/loft_chest_1",
		bundleId: "kavemouth",
		entityId: 10n,
	};
	const maePotion = {
		manifestKey: "kavemouth:kavemouth/adventure/item/loft_chest_potion_1",
		bundleId: "kavemouth",
		entityId: 11n,
	};
	const maeHeroBody = {
		manifestKey: "kavemouth:kavemouth/hero",
		bundleId: "kavemouth",
		entityId: 20n,
	};
	const maeOwned = {
		manifestKey: "kavemouth:kavemouth/owned",
		bundleId: "kavemouth",
		entityId: 30n,
	};

	// keep(K2): an injected snapshot proves refusal precedes any owner-cache access.
	it("get and describe return not_publisher without consulting or exposing the snapshot", () => {
		const snapshot = vi.fn((): OwnerSnapshot => {
			throw new Error("a non-publisher must not consult the owner snapshot");
		});
		const port = createOwnerInstanceRead({
			snapshot,
			worldTick: () => 3n,
			readsAsPublisher: false,
		});
		expect(port.get({ kind: "entities" })).toMatchObject({ ok: false, code: "not_publisher" });
		const got = port.get({ kind: "entities", key: "kavemouth/adventure/item/loft_chest_1" });
		expect(got.ok).toBe(false);
		if (!got.ok) {
			expect(got.code).toBe("not_publisher");
			expect(got).not.toHaveProperty("row");
			expect(got).not.toHaveProperty("rows");
		}
		const described = port.describe({
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
		});
		expect(described.ok).toBe(false);
		if (!described.ok) {
			expect(described.code).toBe("not_publisher");
			expect(described).not.toHaveProperty("row");
			expect(described).not.toHaveProperty("slices");
			expect(described).not.toHaveProperty("belonging");
		}
		expect(snapshot).not.toHaveBeenCalled();
	});

	it("never emits manifestKey as entity_key", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest", entityDefId: "srd/item/chest", kind: "item" }],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
				}),
			worldTick: () => 9n,
			readsAsPublisher: true,
		});
		const answer = port.get({ kind: "entities", key: "kavemouth/adventure/item/loft_chest_1" });
		expect(answer.ok).toBe(true);
		if (answer.ok) {
			expect(answer.row?.entity_key).toBe("kavemouth/adventure/item/loft_chest_1");
			expect(JSON.stringify(answer)).not.toContain("kavemouth:kavemouth/");
			expect(answer.tick).toBe("9");
			expect(answer.labels).toContain("authored_entities_only");
			expect(answer.row?.place_node_id).toBe("inn/loft");
		}
	});

	it("refuses two bundles for one stripped key", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [
						{ manifestKey: "a:hero", bundleId: "a", entityId: 1n },
						{ manifestKey: "b:hero", bundleId: "b", entityId: 2n },
					],
					entity: [
						{ entityId: 1n, name: "A" },
						{ entityId: 2n, name: "B" },
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		expect(port.get({ kind: "entities", key: "hero" })).toMatchObject({
			ok: false,
			code: "ambiguous_bundle",
		});
	});

	it("finds actors by currentBody, never actorId", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeHeroBody],
					entity: [{ entityId: 20n, name: "Hero", kind: "player" }],
					actor: [{ actorId: 99n, currentBody: 20n, name: "Hero" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const hit = port.get({ kind: "actors", key: "kavemouth/hero" });
		expect(hit.ok).toBe(true);
		if (hit.ok) expect(hit.row?.actor_id).toBe("99");
		const miss = port.get({ kind: "actors", key: "99" });
		expect(miss.ok).toBe(false);
	});

	it("after swap, new body key hits and old body key does not", () => {
		const oldBody = { manifestKey: "kavemouth:old", bundleId: "kavemouth", entityId: 1n };
		const newBody = { manifestKey: "kavemouth:new", bundleId: "kavemouth", entityId: 2n };
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [oldBody, newBody],
					entity: [
						{ entityId: 1n, name: "Old" },
						{ entityId: 2n, name: "New" },
					],
					actor: [{ actorId: 7n, currentBody: 2n, name: "Swap" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		expect(port.get({ kind: "actors", key: "new" }).ok).toBe(true);
		expect(port.get({ kind: "actors", key: "old" }).ok).toBe(false);
		expect(port.get({ kind: "entities", key: "old" }).ok).toBe(true);
	});

	it("skips object_state unless targetKind is entity", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest" }],
					object_state: [
						{ targetKind: "place_node", targetId: "10", stateId: "x" },
						{ targetKind: "entity", targetId: "10", stateId: "hp" },
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const answer = port.get({ kind: "object_state" });
		expect(answer.ok).toBe(true);
		if (answer.ok) {
			expect(answer.rows).toHaveLength(1);
			expect(answer.rows?.[0]?.state_id).toBe("hp");
		}
	});

	it("owned entity keeps place A while owner is at B", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeHeroBody, maeOwned],
					entity: [
						{ entityId: 20n, name: "Hero", kind: "player" },
						{ entityId: 30n, name: "Pet", kind: "npc", ownedByEntityId: 20n },
					],
					entity_location: [
						{ entityId: 20n, placeNodeId: "place/B" },
						{ entityId: 30n, placeNodeId: "place/A" },
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const described = port.describe({ kind: "entities", key: "kavemouth/owned" });
		expect(described.ok).toBe(true);
		if (described.ok) expect(described.place).toBe("place/A");
		const owner = port.describe({ kind: "entities", key: "kavemouth/hero" });
		expect(owner.ok).toBe(true);
		if (owner.ok) {
			expect(
				owner.belonging.some(
					(b) => b.relation === "ownership" && b.entity_key === "kavemouth/owned",
				),
			).toBe(true);
		}
	});

	it("lists authored descendants through an unkeyed intermediate and omits the unkeyed row", () => {
		const maeInner = {
			manifestKey: "kavemouth:inner",
			bundleId: "kavemouth",
			entityId: 12n,
		};
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest, maeInner],
					entity: [
						{ entityId: 10n, name: "Chest" },
						{ entityId: 99n, name: "Unkeyed" },
						{ entityId: 12n, name: "Inner" },
					],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
					entity_containment: [
						{ entityId: 99n, containerId: 10n },
						{ entityId: 12n, containerId: 99n },
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const described = port.describe({
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
		});
		expect(described.ok).toBe(true);
		if (described.ok) {
			expect(described.belonging.map((b) => b.entity_key)).toEqual(["inner"]);
			expect(described.belonging[0]?.belongs_to_key).toBeUndefined();
			expect(described.belonging[0]?.belongs_to_numeric_id).toBe("99");
		}
	});

	it("refuses a non-instance kind as usage", () => {
		const port = createOwnerInstanceRead({
			snapshot: () => snap({}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		expect(port.get({ kind: "place_nodes" })).toMatchObject({ ok: false, code: "usage" });
		expect(port.describe({ kind: "actors", key: "x" })).toMatchObject({ ok: false, code: "usage" });
	});

	it("matches entity_tag by four storage fields, not entity_key alone", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest" }],
					entity_tag: [
						{
							entityId: 10n,
							tag: "srd.item.container",
							bundleId: "kavemouth",
							source: "manifest",
						},
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const miss = port.get({
			kind: "entity_tag",
			key: "kavemouth/adventure/item/loft_chest_1",
		});
		expect(miss.ok).toBe(false);
		const hit = port.get({
			kind: "entity_tag",
			key: "kavemouth/adventure/item/loft_chest_1::srd.item.container::kavemouth::manifest",
		});
		expect(hit.ok).toBe(true);
		if (hit.ok) {
			expect(hit.row?.tag).toBe("srd.item.container");
			expect(hit.row).not.toHaveProperty("_key");
		}
	});

	it("matches object_state by entity_key::state_id", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest" }],
					object_state: [{ targetKind: "entity", targetId: "10", stateId: "hp" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		expect(
			port.get({ kind: "object_state", key: "kavemouth/adventure/item/loft_chest_1" }).ok,
		).toBe(false);
		const hit = port.get({
			kind: "object_state",
			key: "kavemouth/adventure/item/loft_chest_1::hp",
		});
		expect(hit.ok).toBe(true);
		if (hit.ok) expect(hit.row?.state_id).toBe("hp");
	});

	it("matches entity_containment by container_entity_key::entity_key", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest, maePotion],
					entity: [
						{ entityId: 10n, name: "Chest" },
						{ entityId: 11n, name: "Potion" },
					],
					entity_containment: [{ entityId: 11n, containerId: 10n }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		expect(
			port.get({ kind: "entity_containment", key: "kavemouth/adventure/item/loft_chest_potion_1" })
				.ok,
		).toBe(false);
		const hit = port.get({
			kind: "entity_containment",
			key: "kavemouth/adventure/item/loft_chest_1::kavemouth/adventure/item/loft_chest_potion_1",
		});
		expect(hit.ok).toBe(true);
		if (hit.ok) {
			expect(hit.row?.entity_key).toBe("kavemouth/adventure/item/loft_chest_potion_1");
			expect(hit.row?.container_entity_key).toBe("kavemouth/adventure/item/loft_chest_1");
		}
	});

	it("keyed get returns the whole row even when fields is set", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest", quantity: 2n, entityDefId: "srd/item/chest" }],
					entity_description: [{ entityId: 10n, description: "plain chest" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const hit = port.get({
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
			fields: ["name"],
		});
		expect(hit.ok).toBe(true);
		if (hit.ok) {
			expect(hit.row?.quantity).toBe(2n);
			expect(hit.row?.description).toBe("plain chest");
			expect(hit.row?.entity_def_id).toBe("srd/item/chest");
		}
	});

	it("projects object_state value, source, expiry, visibility, bundle", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest" }],
					object_state: [
						{
							targetKind: "entity",
							targetId: "10",
							stateId: "hp",
							value: { tag: "Int", value: 12 },
							sourceTemplateId: "srd/hp",
							expiresAtTick: 0n,
							visibility: { tag: "Public" },
							bundleId: "kavemouth",
						},
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const hit = port.get({
			kind: "object_state",
			key: "kavemouth/adventure/item/loft_chest_1::hp",
		});
		expect(hit.ok).toBe(true);
		if (hit.ok) {
			expect(hit.row?.value_int).toBe("12");
			expect(hit.row?.source_template_id).toBe("srd/hp");
			expect(hit.row?.visibility).toBe("Public");
			expect(hit.row?.bundle_id).toBe("kavemouth");
		}
	});

	it("projects capability extent, visibility, elevation", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeHeroBody],
					entity: [{ entityId: 20n, name: "Hero" }],
					capability: [
						{
							entityId: 20n,
							capabilityId: "core/walk",
							source: "manifest",
							sourceArgsHash: "",
							visibility: { tag: "Public" },
							extentRef: "graph/a",
							extentKindRef: "place_graph",
							elevationClass: { tag: "Hidden" },
							bundleId: "kavemouth",
						},
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const hit = port.get({
			kind: "actor_capabilities",
			key: "kavemouth/hero::core/walk::manifest::",
		});
		expect(hit.ok).toBe(true);
		if (hit.ok) {
			expect(hit.row?.extent_ref).toBe("graph/a");
			expect(hit.row?.visibility).toBe("Public");
			expect(hit.row?.elevation_class).toBe("Hidden");
		}
	});

	it("describe includes subject slices and bounds belonging", () => {
		const extras = Array.from({ length: 3 }, (_, i) => ({
			manifestKey: `kavemouth:kid${i}`,
			bundleId: "kavemouth",
			entityId: BigInt(40 + i),
		}));
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest, ...extras],
					entity: [
						{ entityId: 10n, name: "Chest" },
						...extras.map((e, i) => ({ entityId: e.entityId, name: `K${i}` })),
					],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
					entity_containment: extras.map((e) => ({ entityId: e.entityId, containerId: 10n })),
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const described = port.describe({
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
			limit: 1,
		});
		expect(described.ok).toBe(true);
		if (described.ok) {
			expect(described.slices.entities?.length).toBe(1);
			expect(described.slices.entity_containment?.length).toBe(3);
			expect(described.belonging).toHaveLength(1);
			expect(described.match_count).toBe(3);
			expect(described.left_out).toBe(2);
		}
	});

	it("queues ownership children so nested authored descendants appear", () => {
		const maeMid = { manifestKey: "kavemouth:mid", bundleId: "kavemouth", entityId: 50n };
		const maeLeaf = { manifestKey: "kavemouth:leaf", bundleId: "kavemouth", entityId: 51n };
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeHeroBody, maeMid, maeLeaf],
					entity: [
						{ entityId: 20n, name: "Hero" },
						{ entityId: 50n, name: "Mid", ownedByEntityId: 20n },
						{ entityId: 51n, name: "Leaf", ownedByEntityId: 50n },
					],
					entity_location: [{ entityId: 20n, placeNodeId: "inn/loft" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const described = port.describe({ kind: "entities", key: "kavemouth/hero" });
		expect(described.ok).toBe(true);
		if (described.ok) {
			expect(described.belonging.map((b) => b.entity_key).sort()).toEqual(["leaf", "mid"]);
		}
	});

	it("infers bundle from composite key entity_key field, not the whole :: string", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [
						{ manifestKey: "a:hero", bundleId: "a", entityId: 1n },
						{ manifestKey: "b:hero", bundleId: "b", entityId: 2n },
					],
					entity: [
						{ entityId: 1n, name: "A" },
						{ entityId: 2n, name: "B" },
					],
					object_state: [{ targetKind: "entity", targetId: "1", stateId: "hp" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		expect(port.get({ kind: "object_state", key: "hero::hp" })).toMatchObject({
			ok: false,
			code: "ambiguous_bundle",
		});
	});

	it("keeps listing identity fields when fields omits them", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest" }],
					object_state: [
						{
							targetKind: "entity",
							targetId: "10",
							stateId: "hp",
							value: { tag: "Int", value: 1 },
						},
						{
							targetKind: "entity",
							targetId: "10",
							stateId: "ac",
							value: { tag: "Int", value: 2 },
						},
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const listed = port.get({ kind: "object_state", fields: ["name"] });
		expect(listed.ok).toBe(true);
		if (listed.ok) {
			expect(listed.rows?.map((r) => r.state_id).sort()).toEqual(["ac", "hp"]);
			expect(
				listed.rows?.every((r) => r.entity_key === "kavemouth/adventure/item/loft_chest_1"),
			).toBe(true);
		}
	});

	it("listings use preferred columns; keyed get is the whole row", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest", kind: "item", entityDefId: "srd/item/chest" }],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
					object_state: [
						{
							targetKind: "entity",
							targetId: "10",
							stateId: "srd/hp",
							value: { tag: "Int", value: 12 },
						},
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const listed = port.get({ kind: "entities" });
		const keyed = port.get({
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
		});
		expect(listed.ok && keyed.ok).toBe(true);
		if (listed.ok && keyed.ok) {
			const row = listed.rows?.[0];
			expect(row?.entity_key).toBe("kavemouth/adventure/item/loft_chest_1");
			expect(row?.numeric_id).toBe("10");
			expect(row?.bundle_id).toBe("kavemouth");
			expect(row?.place_node_id).toBe("inn/loft");
			expect(row).not.toHaveProperty("description");
			expect(keyed.row).toHaveProperty("description");
			expect(keyed.row?.place_node_id).toBe("inn/loft");
		}
		const hp = port.get({ kind: "object_state", pattern: "srd/hp" });
		expect(hp.ok).toBe(true);
		if (hp.ok) {
			expect(hp.rows?.[0]?.value_int).toBe("12");
			expect(hp.rows?.[0]).not.toHaveProperty("value_text");
		}
	});

	it("bounds 51 authored children with left_out", () => {
		const extras = Array.from({ length: 51 }, (_, i) => ({
			manifestKey: `kavemouth:c${i}`,
			bundleId: "kavemouth",
			entityId: BigInt(100 + i),
		}));
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest, ...extras],
					entity: [
						{ entityId: 10n, name: "Chest" },
						...extras.map((e) => ({ entityId: e.entityId, name: "x" })),
					],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
					entity_containment: extras.map((e) => ({ entityId: e.entityId, containerId: 10n })),
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const described = port.describe({
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
		});
		expect(described.ok).toBe(true);
		if (described.ok) {
			expect(described.belonging).toHaveLength(50);
			expect(described.match_count).toBe(51);
			expect(described.left_out).toBe(1);
			expect(described.chain_end.reason).toBe("place");
		}
	});

	it("keeps containment and equipment on the same item", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeHeroBody, maePotion],
					entity: [
						{ entityId: 20n, name: "Hero" },
						{ entityId: 11n, name: "Potion" },
					],
					entity_location: [{ entityId: 20n, placeNodeId: "inn/loft" }],
					entity_containment: [{ entityId: 11n, containerId: 20n, slotId: "", direction: "" }],
					entity_equipment_slot: [{ entityId: 20n, equippedEntityId: 11n, slotId: "main_hand" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const described = port.describe({ kind: "entities", key: "kavemouth/hero" });
		expect(described.ok).toBe(true);
		if (described.ok) {
			const rels = described.belonging
				.filter((b) => b.entity_key === "kavemouth/adventure/item/loft_chest_potion_1")
				.map((b) => b.relation)
				.sort();
			expect(rels).toEqual(["containment", "equipment"]);
		}
	});

	it("describe slices include actor when actorId differs from body", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeHeroBody],
					entity: [{ entityId: 20n, name: "Hero" }],
					actor: [{ actorId: 99n, currentBody: 20n, name: "Hero" }],
					actor_spatial_location: [{ entityId: 20n, placeNodeId: "inn/loft", selectionPath: "p" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const described = port.describe({ kind: "entities", key: "kavemouth/hero" });
		expect(described.ok).toBe(true);
		if (described.ok) {
			expect(described.slices.actors?.[0]?.actor_id).toBe("99");
			expect(described.slices.actor_spatial_locations?.[0]?.selection_path).toBe("p");
		}
	});

	it("reports chain_end none and cycle without listing the subject as ancestor", () => {
		const portNone = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const none = portNone.describe({
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
		});
		expect(none.ok && none.chain_end.reason === "none").toBe(true);
		if (none.ok) expect(none.container_chain.map((c) => c.numeric_id)).not.toContain("10");

		const portCycle = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest, maePotion],
					entity: [
						{ entityId: 10n, name: "Chest" },
						{ entityId: 11n, name: "Potion" },
					],
					entity_containment: [
						{ entityId: 10n, containerId: 11n },
						{ entityId: 11n, containerId: 10n },
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const cyc = portCycle.describe({
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
		});
		expect(cyc.ok && cyc.chain_end.reason === "cycle").toBe(true);
		if (cyc.ok) {
			expect(cyc.container_chain.some((c) => c.numeric_id === "10")).toBe(false);
			expect(cyc.belonging.some((b) => b.numeric_id === "10")).toBe(false);
		}
	});

	it("describe slices include cross-bundle containment by numeric identity", () => {
		const chest = { manifestKey: "a:chest", bundleId: "a", entityId: 10n };
		const item = { manifestKey: "b:item", bundleId: "b", entityId: 11n };
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [chest, item],
					entity: [
						{ entityId: 10n, name: "Chest" },
						{ entityId: 11n, name: "Item" },
					],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
					entity_containment: [{ entityId: 11n, containerId: 10n }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const described = port.describe({ kind: "entities", key: "chest" });
		expect(described.ok).toBe(true);
		if (described.ok) {
			expect(described.slices.entity_containment?.some((r) => r.numeric_id === "11")).toBe(true);
			expect(described.belonging.map((b) => b.entity_key)).toContain("item");
		}
	});

	it("JSONL keeps i64/u64 digits beyond MAX_SAFE_INTEGER", () => {
		const bigPos = 9223372036854775807n;
		const bigNeg = -9223372036854775808n;
		const bigU64 = 18446744073709551615n;
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest" }],
					object_state: [
						{
							targetKind: "entity",
							targetId: "10",
							stateId: "big",
							value: { tag: "Int", value: bigPos },
							expiresAtTick: bigU64,
						},
						{
							targetKind: "entity",
							targetId: "10",
							stateId: "neg",
							value: { tag: "Int", value: bigNeg },
							expiresAtTick: 0n,
						},
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const pos = port.get({
			kind: "object_state",
			key: "kavemouth/adventure/item/loft_chest_1::big",
		});
		const neg = port.get({
			kind: "object_state",
			key: "kavemouth/adventure/item/loft_chest_1::neg",
		});
		expect(pos.ok && pos.row?.value_int).toBe(bigPos.toString());
		expect(pos.ok && pos.row?.expires_at_tick).toBe(bigU64.toString());
		expect(neg.ok && neg.row?.value_int).toBe(bigNeg.toString());
		const jsonl = JSON.stringify(pos);
		expect(jsonl).toContain(bigPos.toString());
		expect(jsonl).toContain(bigU64.toString());
		expect(jsonl).not.toContain(String(Number(bigPos)));
	});

	it("describe --bundle a selects that bundle for a shared key", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [
						{ manifestKey: "a:shared", bundleId: "a", entityId: 1n },
						{ manifestKey: "b:shared", bundleId: "b", entityId: 2n },
					],
					entity: [
						{ entityId: 1n, name: "A" },
						{ entityId: 2n, name: "B" },
					],
					entity_location: [{ entityId: 1n, placeNodeId: "a/place" }],
				}),
			worldTick: () => 7n,
			readsAsPublisher: true,
		});
		const selected = port.describe({ kind: "entities", key: "shared", bundle: "a" });
		expect(selected.ok).toBe(true);
		if (selected.ok) {
			expect(selected.numeric_id).toBe("1");
			expect(selected.bundle).toBe("a");
		}
	});

	it("describe numeric id plus a mismatched bundle does not select the other bundle", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [
						{ manifestKey: "a:shared", bundleId: "a", entityId: 1n },
						{ manifestKey: "b:shared", bundleId: "b", entityId: 2n },
					],
					entity: [
						{ entityId: 1n, name: "A" },
						{ entityId: 2n, name: "B" },
					],
				}),
			worldTick: () => 7n,
			readsAsPublisher: true,
		});
		const mismatch = port.describe({ kind: "entities", key: "1", bundle: "b" });
		expect(mismatch.ok).toBe(false);
		if (!mismatch.ok) expect(mismatch.code).toBe("unknown_key");
	});

	it("refuses when entity_key and numeric_id name different authored entities", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [
						{ manifestKey: "demo:2", bundleId: "demo", entityId: 1n },
						{ manifestKey: "demo:demo/other", bundleId: "demo", entityId: 2n },
					],
					entity: [
						{ entityId: 1n, name: "NumericKey" },
						{ entityId: 2n, name: "Other" },
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const got = port.get({ kind: "entities", key: "2" });
		expect(got).toMatchObject({ ok: false, code: "usage" });
		if (!got.ok) {
			expect(got.message).toContain("entity_key '2'");
			expect(got.message).toContain("numeric_id 1");
			expect(got.message).toContain("demo/other");
		}
		const described = port.describe({ kind: "entities", key: "2", bundle: "demo" });
		expect(described).toMatchObject({ ok: false, code: "usage" });
		const byKey = port.get({ kind: "entities", key: "demo/other" });
		expect(byKey.ok).toBe(true);
		if (byKey.ok) expect(byKey.row?.numeric_id).toBe("2");
		const byId = port.describe({ kind: "entities", key: "1" });
		expect(byId.ok).toBe(true);
		if (byId.ok) expect(byId.row.entity_key).toBe("2");
	});

	it("describe with --bundle ignores another bundle's numeric id and uses the entity_key", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [
						{ manifestKey: "a:2", bundleId: "a", entityId: 1n },
						{ manifestKey: "b:other", bundleId: "b", entityId: 2n },
					],
					entity: [
						{ entityId: 1n, name: "NumericKey" },
						{ entityId: 2n, name: "Other" },
					],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		const got = port.get({ kind: "entities", key: "2", bundle: "a" });
		expect(got.ok).toBe(true);
		if (got.ok) expect(got.row?.numeric_id).toBe("1");
		const described = port.describe({ kind: "entities", key: "2", bundle: "a" });
		expect(described.ok).toBe(true);
		if (described.ok) {
			expect(described.numeric_id).toBe("1");
			expect(described.row.entity_key).toBe("2");
		}
		const noKey = port.describe({ kind: "entities", key: "1", bundle: "b" });
		expect(noKey).toMatchObject({ ok: false, code: "unknown_key" });
	});

	it("refuses a negative limit instead of slicing to empty", () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [maeChest],
					entity: [{ entityId: 10n, name: "Chest" }],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
				}),
			worldTick: () => 1n,
			readsAsPublisher: true,
		});
		expect(port.get({ kind: "entities", limit: -1 })).toMatchObject({
			ok: false,
			code: "usage",
		});
		expect(
			port.describe({
				kind: "entities",
				key: "kavemouth/adventure/item/loft_chest_1",
				limit: -1,
			}),
		).toMatchObject({ ok: false, code: "usage" });
	});
});
