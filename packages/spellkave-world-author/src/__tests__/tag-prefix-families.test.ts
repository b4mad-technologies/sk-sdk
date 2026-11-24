import { describe, expect, it } from "vitest";
import { manifestTagPrefixFamilies, resolveTagPrefixFamily } from "../tag-prefix-families";

// `manifestTagPrefixFamilies` is the manifest-read SOURCE for `RefTagFamily[]`
// (`tag-vocabulary-declaration` change, Slice A, task 2.2) — it reads a
// parsed manifest's own `[[bundle.tag_prefixes]]` declarations instead of a
// caller hand-writing the array (`@spellkave/srd-cc`'s `ref-tag-families.ts`
// remains a valid, unaffected alternative source for the same argument).

describe("manifestTagPrefixFamilies", () => {
	it("builds a family from a bundle's single-segment ref-typed prefix", () => {
		const manifest = {
			bundles: [
				{
					bundle_id: "srd",
					display_name: "SRD",
					author: "spellkave",
					version: "1.0.0",
					tag_prefixes: [
						{
							prefix: "srd5e",
							target_kind: "resource_definitions",
							natural_key_field: "resource_definition_id",
						},
					],
				},
			],
		};
		expect(manifestTagPrefixFamilies(manifest)).toEqual([
			{
				prefix: "srd5e.",
				targetKind: "resource_definitions",
				naturalKeyField: "resource_definition_id",
				declaringBundleId: "srd",
			},
		]);
	});

	it("builds a family from a bundle's multi-segment ref-typed prefix", () => {
		const manifest = {
			bundles: [
				{
					bundle_id: "srd",
					display_name: "SRD",
					author: "spellkave",
					version: "1.0.0",
					tag_prefixes: [
						{
							prefix: "srd.ability",
							target_kind: "resource_definitions",
							natural_key_field: "resource_definition_id",
						},
					],
				},
			],
		};
		expect(manifestTagPrefixFamilies(manifest)).toEqual([
			{
				prefix: "srd.ability.",
				targetKind: "resource_definitions",
				naturalKeyField: "resource_definition_id",
				declaringBundleId: "srd",
			},
		]);
	});

	it("a bundle declaring no tag_prefixes yields an empty list, not a fallback", () => {
		const manifest = {
			bundles: [{ bundle_id: "core", display_name: "Core", author: "spellkave", version: "1.0.0" }],
		};
		expect(manifestTagPrefixFamilies(manifest)).toEqual([]);
	});

	it("a manifest with no bundles at all yields an empty list", () => {
		expect(manifestTagPrefixFamilies({})).toEqual([]);
	});

	it("a namespace-only entry (no target_kind/natural_key_field) contributes no family", () => {
		const manifest = {
			bundles: [
				{
					bundle_id: "srd",
					display_name: "SRD",
					author: "spellkave",
					version: "1.0.0",
					tag_prefixes: [{ prefix: "srd5e" }],
				},
			],
		};
		expect(manifestTagPrefixFamilies(manifest)).toEqual([]);
	});

	it("sorts longest-prefix-first when a bundle declares overlapping ref-typed prefixes", () => {
		const manifest = {
			bundles: [
				{
					bundle_id: "srd",
					display_name: "SRD",
					author: "spellkave",
					version: "1.0.0",
					tag_prefixes: [
						{
							prefix: "srd",
							target_kind: "entity_definitions",
							natural_key_field: "entity_def_id",
						},
						{
							prefix: "srd.ability",
							target_kind: "resource_definitions",
							natural_key_field: "resource_definition_id",
						},
					],
				},
			],
		};
		const families = manifestTagPrefixFamilies(manifest);
		expect(families.map((f) => f.prefix)).toEqual(["srd.ability.", "srd."]);
	});
});

describe("resolveTagPrefixFamily — longest matching declared prefix wins", () => {
	it("prefers the more specific declared prefix for a tag matching both", () => {
		const families = manifestTagPrefixFamilies({
			bundles: [
				{
					bundle_id: "srd",
					display_name: "SRD",
					author: "spellkave",
					version: "1.0.0",
					tag_prefixes: [
						{
							prefix: "srd",
							target_kind: "entity_definitions",
							natural_key_field: "entity_def_id",
						},
						{
							prefix: "srd.ability",
							target_kind: "resource_definitions",
							natural_key_field: "resource_definition_id",
						},
					],
				},
			],
		});
		const resolved = resolveTagPrefixFamily("srd.ability.wis", families);
		expect(resolved?.targetKind).toBe("resource_definitions");
	});

	it("falls back to the only matching (general) prefix for a tag outside the specific one", () => {
		const families = manifestTagPrefixFamilies({
			bundles: [
				{
					bundle_id: "srd",
					display_name: "SRD",
					author: "spellkave",
					version: "1.0.0",
					tag_prefixes: [
						{
							prefix: "srd",
							target_kind: "entity_definitions",
							natural_key_field: "entity_def_id",
						},
						{
							prefix: "srd.ability",
							target_kind: "resource_definitions",
							natural_key_field: "resource_definition_id",
						},
					],
				},
			],
		});
		const resolved = resolveTagPrefixFamily("srd.race.elf", families);
		expect(resolved?.targetKind).toBe("entity_definitions");
	});

	it("returns undefined when no declared family matches", () => {
		expect(resolveTagPrefixFamily("core.actor", [])).toBeUndefined();
	});

	it("breaks equal-prefix ties by the complete declaration key, not input order", () => {
		const first = {
			prefix: "demo.value.",
			targetKind: "z_rows",
			naturalKeyField: "id",
			declaringBundleId: "z_bundle",
		};
		const second = {
			prefix: "demo.value.",
			targetKind: "a_rows",
			naturalKeyField: "id",
			declaringBundleId: "a_bundle",
		};
		for (const families of [
			[first, second],
			[second, first],
		]) {
			expect(resolveTagPrefixFamily("demo.value.x", families)?.declaringBundleId).toBe("a_bundle");
		}
	});
});
