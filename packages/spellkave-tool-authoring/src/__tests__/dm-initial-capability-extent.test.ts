// embedded-manifest: {"category": "schema_object_oracle", "rationale": "Typed capability and party vocabulary directly proves the entity blueprint verb preserves an authored initial extent."}
import { inspectManifest, renderSchemaManifest } from "@spellkave/world-author";
import { expect, it } from "vitest";
import { createAuthorFacingBoundTools } from "../index.ts";

it("preserves the authored party extent through the entity blueprint verb", async () => {
	let toml = renderSchemaManifest({
		schema_version: "1.0.0",
		bundles: [
			{
				bundle_id: "house",
				display_name: "House",
				author: "test",
				version: "1",
				depends_on: [],
				tag_prefixes: [
					{ prefix: "house", target_kind: "tag_value_definitions", natural_key_field: "tag" },
				],
			},
		],
		tag_value_definitions: [
			{ tag: "house.party", prefix: "house", bundle_id: "house", description: "Party membership." },
		],
		capability_definitions: [
			{
				capability_id: "house/sight",
				bundle_id: "house",
				actor_kind: "entity",
				display_name: "Party sight",
				description: "See members of the authored party.",
			},
		],
	});
	const tool = createAuthorFacingBoundTools(
		{
			workspace: {
				readToml: () => toml,
				writeToml: (value) => {
					toml = value;
					return "memory";
				},
			},
			defaultBundle: "house",
		},
		{},
	).find((tool) => tool.name === "spellkave_define_entity_type");
	if (tool === undefined) throw new Error("entity blueprint verb absent");
	const result = (await tool.execute("extent", {
		bundle: "house",
		id: "hero",
		display_name: "Hero",
		initial_capabilities: [
			{ capability: "house/sight", extent_kind_ref: "party", extent_ref: "house.party" },
		],
	})) as { details: { ok: boolean; diagnostics?: unknown } };
	expect(result.details.ok, JSON.stringify(result.details.diagnostics)).toBe(true);
	expect(inspectManifest(toml).manifest.entity_definition_initial_capability).toEqual([
		{
			entity_def_id: "house/hero",
			capability_id: "house/sight",
			bundle_id: "house",
			extent_kind_ref: "party",
			extent_ref: "house.party",
		},
	]);
});
