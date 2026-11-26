// embedded-manifest: {"category": "schema_object_oracle", "rationale": "compact two-actor graph is the direct algorithm oracle for actor filtering", "signatures": ["schema_object", "schema_shape"]}
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
	filteredRowCount,
	filterManifestForActor,
	prepareActorExportToml,
	type SchemaManifest,
	writeActorExport,
	zeroObjectStateExpiry,
} from "../filter-manifest";
import { renderSchemaManifest } from "../manifest";
import { validateManifestToml } from "../validate";

const HERO = "kavemouth/adventure/hero_1";
const OTHER = "kavemouth/adventure/mira_1";
const SWORD = "kavemouth/adventure/item/longsword_1";
const BAG = "kavemouth/adventure/item/bag_1";
const COIN = "kavemouth/adventure/item/coin_1";
const OWNED = "kavemouth/adventure/item/deed_1";
const OTHER_AXE = "kavemouth/adventure/item/axe_1";

function state(
	key: string,
	stateId: string,
	value: number,
): NonNullable<SchemaManifest["object_state"]>[0] {
	return {
		entity_key: key,
		state_id: stateId,
		value_bool: true,
		value_int: value,
		source_template_id: "",
		bundle_id: "kavemouth",
		expires_at_tick: 0,
	};
}

function entity(
	key: string,
	kind: string,
	ownedBy = "",
): NonNullable<SchemaManifest["entities"]>[0] {
	return {
		entity_key: key,
		bundle_id: "kavemouth",
		entity_def_id: "",
		name: key,
		kind,
		place_node_id: "",
		quantity: 1,
		owned_by_entity_key: ownedBy,
	};
}

function twoActorWorld(): SchemaManifest {
	return {
		schema_version: "1.0.0",
		bundles: [
			{
				bundle_id: "kavemouth",
				display_name: "Kavemouth",
				author: "test",
				version: "0.0.0",
				depends_on: [],
				description: "",
			},
		],
		entities: [
			entity(HERO, "player"),
			entity(OTHER, "npc"),
			entity(SWORD, "item"),
			entity(BAG, "item"),
			entity(COIN, "item"),
			entity(OWNED, "item", HERO),
			entity(OTHER_AXE, "item"),
		],
		actors: [
			{ entity_key: HERO, bundle_id: "kavemouth", name: HERO },
			{ entity_key: OTHER, bundle_id: "kavemouth", name: OTHER },
		],
		actor_capabilities: [
			{
				actor_entity_key: HERO,
				capability_id: "srd/skill/athletics",
				source: "kavemouth",
				bundle_id: "kavemouth",
			},
			{
				actor_entity_key: OTHER,
				capability_id: "srd/skill/persuasion",
				source: "kavemouth",
				bundle_id: "kavemouth",
			},
		],
		actor_spatial_locations: [
			{
				entity_key: HERO,
				place_node_id: "kavemouth/inn/loft",
				bundle_id: "kavemouth",
			},
			{
				entity_key: OTHER,
				place_node_id: "kavemouth/inn/bar",
				bundle_id: "kavemouth",
			},
		],
		actor_equipment_slots: [
			{ actor_entity_key: HERO, slot_id: "srd/slot/main-hand", item_key: SWORD },
			{ actor_entity_key: OTHER, slot_id: "srd/slot/main-hand", item_key: OTHER_AXE },
		],
		entity_containment: [
			{ entity_key: SWORD, container_entity_key: HERO, slot_id: "", direction: "in" },
			{ entity_key: BAG, container_entity_key: HERO, slot_id: "", direction: "in" },
			{ entity_key: COIN, container_entity_key: BAG, slot_id: "", direction: "in" },
			{ entity_key: OTHER_AXE, container_entity_key: OTHER, slot_id: "", direction: "in" },
		],
		entity_tag: [
			{ entity_key: HERO, tag: "srd.class.fighter", bundle_id: "kavemouth", source: "manifest" },
			{ entity_key: OTHER, tag: "srd.class.cleric", bundle_id: "kavemouth", source: "manifest" },
			{ entity_key: SWORD, tag: "srd.item.weapon", bundle_id: "kavemouth", source: "manifest" },
			{
				entity_key: OTHER_AXE,
				tag: "srd.item.weapon",
				bundle_id: "kavemouth",
				source: "manifest",
			},
		],
		object_state: [
			state(HERO, "hp", 12),
			state(OTHER, "hp", 8),
			state(SWORD, "qty", 1),
			state(OTHER_AXE, "qty", 1),
		],
	};
}

describe("filterManifestForActor", () => {
	it("keeps only the named actor and what hangs off it", () => {
		const out = filterManifestForActor(twoActorWorld(), HERO);
		expect(out.entities?.map((row) => row.entity_key)).toEqual([HERO, SWORD, BAG, COIN, OWNED]);
		expect(out.actors?.map((row) => row.entity_key)).toEqual([HERO]);
		expect(out.actor_capabilities).toHaveLength(1);
		expect(out.actor_capabilities?.[0]?.actor_entity_key).toBe(HERO);
		expect(out.actor_spatial_locations).toHaveLength(1);
		expect(out.actor_spatial_locations?.[0]?.entity_key).toBe(HERO);
		expect(out.actor_equipment_slots).toHaveLength(1);
		expect(out.actor_equipment_slots?.[0]?.item_key).toBe(SWORD);
		expect(
			out.entity_containment?.map((row) => [row.container_entity_key, row.entity_key]),
		).toEqual([
			[HERO, SWORD],
			[HERO, BAG],
			[BAG, COIN],
		]);
		expect(out.entity_tag?.map((row) => row.entity_key)).toEqual([HERO, SWORD]);
		expect(out.object_state?.map((row) => row.entity_key)).toEqual([HERO, SWORD]);
		expect(out.bundles).toHaveLength(1);
		expect(out.bundles?.[0]?.bundle_id).toBe("kavemouth");
		expect(out.place_nodes).toBeUndefined();
		expect(out.entity_definitions).toBeUndefined();
		expect(filteredRowCount(out)).toBe(17);
	});

	it("unknown actor is an error", () => {
		expect(() => filterManifestForActor(twoActorWorld(), "nobody")).toThrow(/nobody/);
	});

	it("filtered instance export needs the capability catalog closure for validation", () => {
		const out = filterManifestForActor(twoActorWorld(), HERO);
		expect(out.bundles).toHaveLength(1);
		const withSlots = validateManifestToml(renderSchemaManifest(out)).filter(
			(d) => d.severity === "fatal",
		);
		expect(withSlots.map((d) => d.code)).toEqual(["MF-VAL-319", "MF-VAL-365"]);

		const withoutSlots = { ...out, actor_equipment_slots: [] };
		const missingCatalog = validateManifestToml(renderSchemaManifest(withoutSlots)).filter(
			(d) => d.severity === "fatal",
		);
		expect(missingCatalog.map((d) => d.code)).toEqual(["MF-VAL-365"]);
		// The instance filter deliberately omits catalog rows. Compose the
		// owning dependency's declared vocabulary instead of weakening MF365.
		const withCatalog = {
			...withoutSlots,
			bundles: [
				...out.bundles!.map((row) => ({ ...row, depends_on: ["srd"] })),
				{
					bundle_id: "srd",
					display_name: "SRD catalog dependency",
					author: "test",
					version: "0.0.0",
				},
			],
			capability_definitions: [
				{
					bundle_id: "srd",
					capability_id: "srd/skill/athletics",
					display_name: "Athletics",
					actor_kind: "player",
					description: "Declared dependency vocabulary for this export fixture.",
				},
			],
		};
		expect(
			validateManifestToml(renderSchemaManifest(withCatalog)).filter((d) => d.severity === "fatal"),
		).toEqual([]);
	});

	it("prepareActorExportToml + writeActorExport write the caller-chosen file name", () => {
		const toml = prepareActorExportToml(twoActorWorld(), HERO);
		expect(toml).toContain("[[entities]]");
		expect(toml).toContain(HERO);
		expect(toml).toContain("[[bundles]]");
		expect(toml).not.toContain(OTHER);
		expect(toml).not.toMatch(/expires_at_tick = [^0]/);
		const dir = mkdtempSync(join(tmpdir(), "actor-export-"));
		const dest = writeActorExport(dir, toml, "hero.toml");
		expect(dest).toBe(join(dir, "hero.toml"));
		expect(readFileSync(dest, "utf8")).toBe(toml.endsWith("\n") ? toml : `${toml}\n`);
	});

	it("zeroObjectStateExpiry clears live ticks for a generated story fixture", () => {
		const live: SchemaManifest = {
			object_state: [{ entity_key: HERO, state_id: "hp", expires_at_tick: 42 }],
		};
		expect(zeroObjectStateExpiry(live).object_state?.[0]?.expires_at_tick).toBe(0);
	});
});
