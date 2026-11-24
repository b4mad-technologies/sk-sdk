// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "minimal manifest inputs directly exercise damage-route validation", "signatures": ["toml_version", "schema_directive", "schema_shape"]}
import { describe, expect, it } from "vitest";
import {
	getAuthoringExample,
	routeDamage,
	routeDamageMagnitude,
	validateManifestToml,
} from "../index";

describe("damage helpers", () => {
	it("emits the canonical damage routing delta_source", () => {
		expect(routeDamage("8d6", "fire")).toBe(
			"let dmg = 8d6; -cond(target.has_tag('damage_immune:fire'), 0, cond(target.has_tag('damage_resist:fire'), dmg / 2, cond(target.has_tag('damage_vulnerable:fire'), dmg * 2, dmg)))",
		);
	});

	it("routeDamageMagnitude emits the SAME ladder without the leading negation", () => {
		expect(routeDamageMagnitude("8d6", "fire")).toBe(
			"let dmg = 8d6; cond(target.has_tag('damage_immune:fire'), 0, cond(target.has_tag('damage_resist:fire'), dmg / 2, cond(target.has_tag('damage_vulnerable:fire'), dmg * 2, dmg)))",
		);
		// routeDamage is exactly routeDamageMagnitude with a leading "-" spliced
		// in front of the ladder — never two independently-typed ladders.
		expect(routeDamage("8d6", "fire")).toBe(
			routeDamageMagnitude("8d6", "fire").replace("cond(", "-cond("),
		);
	});

	it("routeDamageMagnitude validates as an Int-typed entity_definition_item_dsl_source slot source", () => {
		const source = routeDamageMagnitude("1d6 + (0)", "slashing");
		const toml = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[metadata]
profile = "route_damage_magnitude_test"
bundle = "route_damage_magnitude_test"

[[bundles]]
bundle_id = "route_damage_magnitude_test"
display_name = "Route Damage Magnitude Test"
author = "world-author tests"
version = "0.0.0"
depends_on = []

[[entity_definitions]]
entity_def_id = "route_damage_magnitude_test/weapon/scimitar"
bundle_id = "route_damage_magnitude_test"
display_name = "Scimitar"

[[entity_definition_item_dsl_source]]
bundle_id = "route_damage_magnitude_test"
entity_def_id = "route_damage_magnitude_test/weapon/scimitar"
slot = "srd/damage"
source = "${source}"
`;

		expect(validateManifestToml(toml)).toEqual([]);
	});

	it("emits an Int DSL expression accepted by the wasm validator", () => {
		const deltaSource = routeDamage("8d6", "fire");
		const toml = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[metadata]
profile = "route_damage_test"
bundle = "route_damage_test"

[[bundles]]
bundle_id = "route_damage_test"
display_name = "Route Damage Test"
author = "world-author tests"
version = "0.0.0"
depends_on = []

[[resource_definitions]]
resource_definition_id = "route_damage_test/hp"
bundle_id = "route_damage_test"
display_name = "Hit Points"
value_kind = "int"
min_value = 0
max_value = 100
recovery_rule = "long_rest"
initial_value = 100

[[consequence_templates]]
template_id = "route_damage_test/success"
bundle_id = "route_damage_test"

[[consequence_frame_writes]]
template_id = "route_damage_test/success"
ordinal = 0
frame_write = { ModifyResource = { actor = "TargetActor", resource = "route_damage_test/hp", delta_source = "${deltaSource}" } }
`;

		expect(validateManifestToml(toml)).toEqual([]);
	});

	it("serves the damage-type-routing corpus example by id", () => {
		const example = getAuthoringExample("damage-type-routing");

		expect(example?.toml).toContain("damage_immune:fire");
		// This doc example's flat/kv-shaped tags (e.g. "spell", "damage:fire")
		// predate the tag-vocabulary-declaration change's staged-advisory
		// grammar checks; they now draw Warning-severity diagnostics
		// (MF-VAL-296/297/298), not the empty diagnostics this example
		// produced before those checks existed. This does not affect
		// `routeDamage`'s own delta_source correctness, covered above.
		expect(example?.expectedDiagnostics).toEqual([
			"MF-VAL-296",
			"MF-VAL-296",
			"MF-VAL-296",
			"MF-VAL-296",
			"MF-VAL-296",
			"MF-VAL-297",
			"MF-VAL-297",
			"MF-VAL-297",
			"MF-VAL-297",
			"MF-VAL-297",
			"MF-VAL-297",
			"MF-VAL-297",
			"MF-VAL-298",
			"MF-VAL-298",
			"MF-VAL-298",
			"MF-VAL-298",
			"MF-VAL-298",
			"MF-VAL-298",
			"MF-VAL-298",
		]);
	});
});
