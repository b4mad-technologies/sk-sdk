// embedded-manifest: {"category": "schema_object_oracle", "rationale": "compact spell rows directly verify the spell authoring helper output", "signatures": ["schema_object", "schema_shape"]}
import { describe, expect, it } from "vitest";
import {
	assertSpellCatalogBinding,
	emitSpell,
	renderSchemaManifestJson,
	validateManifestToml,
} from "../index";

describe("emitSpell — one spell, one identity (#835)", () => {
	it("binds capability_id == required_capability == the catalog id, single-sourcing tags", () => {
		const rows = emitSpell({
			capabilityId: "srd/spell/fire-bolt",
			actionId: "srd/cast_fire_bolt",
			bundleId: "srd",
			displayName: "Cast Fire Bolt",
			description: "a ranged spell attack",
			tags: ["spell", "cantrip", "evocation"],
		});

		expect(rows.capability_definitions[0]?.capability_id).toBe("srd/spell/fire-bolt");
		// the cast verb is distinct from the identity, but it REQUIRES the identity.
		expect(rows.action_definitions[0]?.action_id).toBe("srd/cast_fire_bolt");
		expect(rows.action_definitions[0]?.required_capability).toBe("srd/spell/fire-bolt");
		// on_success defaults to <actionId>/outcome and the outcome points back at the action.
		expect(rows.action_definitions[0]?.on_success).toBe("srd/cast_fire_bolt/outcome");
		expect(rows.outcome_templates[0]?.manipulation_action_id).toBe("srd/cast_fire_bolt");
		// one tag list → both the capability and the action (no 3× repetition).
		expect(rows.capability_definition_tag).toHaveLength(3);
		expect(rows.action_definition_tag).toHaveLength(3);
		expect(rows.capability_definition_tag.map((t) => t.tag)).toEqual(
			rows.action_definition_tag.map((t) => t.tag),
		);
	});

	it("asserts the catalog entity exists when ids are supplied (the author-time MF-VAL-264 guard)", () => {
		// Missing catalog entity → immediate throw (the #835 drift, surfaced at author time).
		expect(() =>
			emitSpell(
				{
					capabilityId: "srd/spell/ghost",
					actionId: "srd/cast_ghost",
					bundleId: "srd",
					displayName: "Ghost",
				},
				{ catalogEntityIds: ["srd/spell/fire-bolt"] },
			),
		).toThrow(/no matching catalog entity_definition/);

		// Present catalog entity → no throw.
		expect(() =>
			emitSpell(
				{
					capabilityId: "srd/spell/fire-bolt",
					actionId: "srd/cast_fire_bolt",
					bundleId: "srd",
					displayName: "FB",
				},
				{ catalogEntityIds: ["srd/spell/fire-bolt"] },
			),
		).not.toThrow();
	});

	it("never asserts a non-srd/spell capability (synthetic affordances / monster actions are exempt)", () => {
		expect(() => assertSpellCatalogBinding("srd/buff/blessed_strike", [])).not.toThrow();
		expect(() => assertSpellCatalogBinding("srd/monster-action/goblin_scimitar", [])).not.toThrow();
		expect(() => assertSpellCatalogBinding("srd/spell/known", ["srd/spell/known"])).not.toThrow();
		expect(() => assertSpellCatalogBinding("srd/spell/missing", ["srd/spell/known"])).toThrow();
	});

	it("emits rows the wasm validator admits (with a matching catalog entity present)", () => {
		// Authored under the `srd` bundle itself: `srd/*` ids defined by any other
		// bundle would (correctly) draw the MF-VAL-291 foreign-namespace warning.
		// Tags are dot-namespaced under the bundle's own declared `srd` prefix
		// (tag-vocabulary-declaration MF-VAL-297/298) rather than flat, so this
		// stays a genuine zero-diagnostic assertion.
		const rows = emitSpell({
			capabilityId: "srd/spell/fire-bolt",
			actionId: "srd/cast_fire_bolt",
			bundleId: "srd",
			displayName: "Cast Fire Bolt",
			tags: ["srd.spell", "srd.cantrip"],
		});
		const manifest = {
			schema_version: "1.0.0",
			bundles: [
				{
					bundle_id: "srd",
					display_name: "Emit Spell Test (srd namespace)",
					author: "world-author tests",
					version: "0.0.0",
					depends_on: [],
					tag_prefixes: [{ prefix: "srd" }],
				},
			],
			entity_definitions: [
				{
					entity_def_id: "srd/spell/fire-bolt",
					bundle_id: "srd",
					display_name: "Fire Bolt",
				},
			],
			...rows,
		};
		const toml = renderSchemaManifestJson(JSON.stringify(manifest));
		expect(validateManifestToml(toml)).toEqual([]);
	});
});
