// embedded-manifest: {"category": "schema_object_oracle", "rationale": "compact instance rows are direct patch and natural-key test inputs", "signatures": ["schema_object", "schema_shape"]}
// Instance-row patch ops (#1602) — extends add-entity (entity_def_id,
// quantity, owned_by_entity_key, affordance_cache_subscribed, relaxed
// place_node_id), fixes add-actor/add-entity to upsert (canon-warden
// condition 4), and adds the two genuinely-new ops the PHB pregen importer
// and the Phandelver hero-sheet driver already emit but patchManifest did
// not yet cover: add-entity-containment / add-actor-equipment-slot. Covers
// upsert semantics, the no-bundle_id shapes (canon-warden condition 3), and a
// render+validate round trip through the same wasm validator the server runs.

import { describe, expect, it } from "vitest";
import { renderSchemaManifestJson } from "../manifest";
import { patchManifest } from "../patch";
import { validateManifestToml } from "../validate";

const BUNDLE_ID = "test_bundle";

function baseManifest(bundleId = BUNDLE_ID): Record<string, unknown> {
	return {
		schema_version: "1.0.0",
		metadata: { profile: bundleId },
		bundles: [
			{
				bundle_id: bundleId,
				display_name: "Test",
				author: "test",
				version: "1.0.0",
				depends_on: [],
				description: "instance-row patch op fixture",
			},
		],
	};
}

describe("add-entity (#1602 extension)", () => {
	it("defaults place_node_id to '' instead of requiring it non-empty", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-entity", {
			entity_key: "test_bundle/rock",
			name: "Rock",
			kind: "item",
		});
		const row = (manifest.entities as Record<string, unknown>[])[0];
		expect(row?.place_node_id).toBe("");
	});

	it("accepts the four newly-exposed optional fields", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-entity", {
			entity_key: "test_bundle/rock",
			name: "Rock",
			kind: "item",
			place_node_id: "test_bundle/room",
			entity_def_id: "test_bundle/def/rock",
			quantity: 3,
			owned_by_entity_key: "test_bundle/hero",
		});
		const row = (manifest.entities as Record<string, unknown>[])[0];
		expect(row).toEqual({
			entity_key: "test_bundle/rock",
			bundle_id: BUNDLE_ID,
			name: "Rock",
			kind: "item",
			place_node_id: "test_bundle/room",
			entity_def_id: "test_bundle/def/rock",
			quantity: 3,
			owned_by_entity_key: "test_bundle/hero",
		});
	});

	it("upserts by entity_key, replacing rather than duplicating", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-entity", {
			entity_key: "test_bundle/rock",
			name: "Rock",
			kind: "item",
		});
		patchManifest(manifest, "add-entity", {
			entity_key: "test_bundle/rock",
			name: "Rock (moved)",
			kind: "item",
			place_node_id: "test_bundle/room",
		});
		const rows = manifest.entities as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.name).toBe("Rock (moved)");
		expect(rows[0]?.place_node_id).toBe("test_bundle/room");
	});
});

describe("add-actor (#1602 upsert fix)", () => {
	it("upserts by entity_key, replacing rather than duplicating", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-actor", { entity_key: "test_bundle/hero", name: "Hero" });
		patchManifest(manifest, "add-actor", {
			entity_key: "test_bundle/hero",
			name: "Hero (renamed)",
		});
		const rows = manifest.actors as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.name).toBe("Hero (renamed)");
	});

	it("cascades the upsert to actor_spatial_locations: re-authoring without place_node_id drops the prior location", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-actor", {
			entity_key: "test_bundle/hero",
			name: "Hero",
			place_node_id: "test_bundle/room_a",
		});
		expect((manifest.actor_spatial_locations as unknown[]).length).toBe(1);

		patchManifest(manifest, "add-actor", { entity_key: "test_bundle/hero", name: "Hero" });
		expect(manifest.actor_spatial_locations as unknown[]).toEqual([]);
	});

	it("re-authoring with a new place_node_id moves the actor rather than duplicating the location row", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-actor", {
			entity_key: "test_bundle/hero",
			name: "Hero",
			place_node_id: "test_bundle/room_a",
		});
		patchManifest(manifest, "add-actor", {
			entity_key: "test_bundle/hero",
			name: "Hero",
			place_node_id: "test_bundle/room_b",
		});
		const rows = manifest.actor_spatial_locations as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.place_node_id).toBe("test_bundle/room_b");
	});
});

describe("add-entity-containment", () => {
	it("upserts by entity_key, replacing rather than duplicating", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-entity-containment", {
			entity_key: "test_bundle/coin",
			container_entity_key: "test_bundle/hero",
		});
		patchManifest(manifest, "add-entity-containment", {
			entity_key: "test_bundle/coin",
			container_entity_key: "test_bundle/chest",
		});
		const rows = manifest.entity_containment as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.container_entity_key).toBe("test_bundle/chest");
	});

	it("never emits bundle_id — EntityContainmentRow has none and deny_unknown_fields rejects it", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-entity-containment", {
			entity_key: "test_bundle/coin",
			container_entity_key: "test_bundle/hero",
		});
		const row = (manifest.entity_containment as Record<string, unknown>[])[0];
		expect(row).not.toHaveProperty("bundle_id");
		expect(Object.keys(row ?? {}).sort()).toEqual(["container_entity_key", "entity_key"]);
	});

	it("accepts optional slot_id and direction", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-entity-containment", {
			entity_key: "test_bundle/sword",
			container_entity_key: "test_bundle/hero",
			slot_id: "test_bundle/main_hand",
			direction: "in",
		});
		const row = (manifest.entity_containment as Record<string, unknown>[])[0];
		expect(row?.slot_id).toBe("test_bundle/main_hand");
		expect(row?.direction).toBe("in");
	});

	it("does no cycle/container-exists validation — presence/type only (ADR-0023)", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-entity-containment", {
				entity_key: "test_bundle/hero",
				container_entity_key: "test_bundle/hero",
			}),
		).not.toThrow();
	});
});

describe("add-actor-equipment-slot", () => {
	it("upserts by the (actor_entity_key, slot_id) composite, replacing rather than duplicating", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-actor-equipment-slot", {
			actor_entity_key: "test_bundle/hero",
			slot_id: "test_bundle/main_hand",
			item_key: "test_bundle/sword",
		});
		patchManifest(manifest, "add-actor-equipment-slot", {
			actor_entity_key: "test_bundle/hero",
			slot_id: "test_bundle/main_hand",
			item_key: "test_bundle/spear",
		});
		const rows = manifest.actor_equipment_slots as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.item_key).toBe("test_bundle/spear");
	});

	it("a different slot_id on the same actor is a distinct row (composite key, not entity_key alone)", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-actor-equipment-slot", {
			actor_entity_key: "test_bundle/hero",
			slot_id: "test_bundle/main_hand",
			item_key: "test_bundle/sword",
		});
		patchManifest(manifest, "add-actor-equipment-slot", {
			actor_entity_key: "test_bundle/hero",
			slot_id: "test_bundle/off_hand",
			item_key: "test_bundle/shield",
		});
		expect((manifest.actor_equipment_slots as unknown[]).length).toBe(2);
	});

	it("never emits bundle_id — ActorEquipmentSlotRow has none and deny_unknown_fields rejects it", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-actor-equipment-slot", {
			actor_entity_key: "test_bundle/hero",
			slot_id: "test_bundle/main_hand",
			item_key: "test_bundle/sword",
		});
		const row = (manifest.actor_equipment_slots as Record<string, unknown>[])[0];
		expect(row).not.toHaveProperty("bundle_id");
		expect(Object.keys(row ?? {}).sort()).toEqual(["actor_entity_key", "item_key", "slot_id"]);
	});

	it("kind is never enumerated — slot_id is a pass-through open vocabulary string (ADR-0018)", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-actor-equipment-slot", {
				actor_entity_key: "test_bundle/hero",
				slot_id: "test_bundle/tail_slot",
				item_key: "test_bundle/banner",
			}),
		).not.toThrow();
	});
});

describe("render + validate round trip (#1602)", () => {
	it("a minimal manifest built purely from the four instance-row ops renders and validates clean", () => {
		const manifest = baseManifest();
		// sk-9ll.3: `add-actor-equipment-slot`'s own doc comment (`no_bundle_id_ops.rs`)
		// says it "does not validate slot-definition existence" itself — that check now
		// lives in the shared validator (`MF_VAL_ACTOR_EQUIP_SLOT_DEF_REF`), so this
		// "renders and validates clean" fixture needs a real `equipment_slot_definitions`
		// row for `test_bundle/main_hand`, exactly like every other definition kind this
		// same round trip already authors (`add-entity-definition` above).
		manifest.equipment_slot_definitions = [
			{
				slot_id: "test_bundle/main_hand",
				bundle_id: "test_bundle",
				label: "Main Hand",
			},
		];
		patchManifest(manifest, "add-entity-definition", {
			entity_def_id: "test_bundle/def/sword",
			display_name: "Sword",
		});
		patchManifest(manifest, "add-actor", { entity_key: "test_bundle/hero", name: "Hero" });
		patchManifest(manifest, "add-entity", {
			entity_key: "test_bundle/hero_sword",
			entity_def_id: "test_bundle/def/sword",
			name: "Sword",
			kind: "item",
			quantity: 1,
		});
		patchManifest(manifest, "add-entity-containment", {
			entity_key: "test_bundle/hero_sword",
			container_entity_key: "test_bundle/hero",
		});
		patchManifest(manifest, "add-actor-equipment-slot", {
			actor_entity_key: "test_bundle/hero",
			slot_id: "test_bundle/main_hand",
			item_key: "test_bundle/hero_sword",
		});

		const toml = renderSchemaManifestJson(JSON.stringify(manifest));
		expect(toml).toContain('entity_key = "test_bundle/hero_sword"');
		expect(toml).toContain('container_entity_key = "test_bundle/hero"');
		expect(toml).toContain('slot_id = "test_bundle/main_hand"');

		const diagnostics = validateManifestToml(toml);
		const fatal = diagnostics.filter((d) => d.severity === "fatal");
		expect(fatal).toEqual([]);
	});
});
