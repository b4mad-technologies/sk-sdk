import { describe, expect, it, vi } from "vitest";

const wasm = vi.hoisted(() => ({
	authoringInit: vi.fn(async () => undefined),
	validateInit: vi.fn(async () => undefined),
}));

vi.mock("@spellkave/authoring-wasm/browser", () => ({
	default: wasm.authoringInit,
	row_kind_natural_key_json: () =>
		JSON.stringify({ bundles: "bundle_id", entities: "entity_key", actors: "entity_key" }),
	row_kind_composite_key_json: () => JSON.stringify({ entity_tag: ["entity_key", "tag"] }),
	export_not_round_tripped_json: () => JSON.stringify({ "*": ["visibility"] }),
	row_kind_storage_key_json: () =>
		JSON.stringify({ entity_tag: ["entity_key", "tag", "bundle_id", "source"] }),
	patch_manifest_json: (manifestJson: string, op: string, payloadJson: string) => {
		const manifest = JSON.parse(manifestJson) as Record<string, unknown[]>;
		const payload = JSON.parse(payloadJson) as Record<string, unknown>;
		if (op !== "add-entity") throw new Error(`unknown patch op: ${op}`);
		return JSON.stringify({ entities: [...(manifest.entities ?? []), payload] });
	},
	cluster_rows_json: () => JSON.stringify({ action_definitions: [{ action_id: "demo/strike" }] }),
	extra_rows_by_natural_key_json: () => "[]",
	shape_params_json: () => "{}",
}));

vi.mock("@spellkave/validate-wasm/browser", () => ({
	default: wasm.validateInit,
	manifest_schema_json: () => JSON.stringify({ entities: { fields: ["entity_key"] } }),
	parse_manifest_toml_to_json: () =>
		JSON.stringify({
			bundles: [{ bundle_id: "demo" }],
			entities: [{ entity_key: "demo/hero" }],
			actors: [{ entity_key: "demo/hero" }],
		}),
	render_manifest_json_to_toml: (json: string) => `rendered:${json}`,
	validate_manifest_toml: () => "[]",
	evaluate_dsl_expression_json: () =>
		JSON.stringify({
			ok: true,
			value: { type: "Bool", value: true },
			draws: [],
			trace: [],
		}),
}));

import * as browser from "../tooling.browser";

describe("browser AUTHOR tooling", () => {
	it("executes the same corpus, patch/write, query/diff/cluster, and schema/reference operations", async () => {
		await browser.loadBrowserAuthorTooling();
		expect(wasm.validateInit).toHaveBeenCalledOnce();
		expect(wasm.authoringInit).toHaveBeenCalledOnce();
		expect(browser.listAuthoringDocs().length).toBeGreaterThan(20);
		expect(browser.queryAuthoringDocs("damage routing")[0]?.item.id).toBe("damage-type-routing");
		expect(browser.extractAuthoringDocSection("# Intro\nbody\n", "intro")?.body).toContain("body");
		expect(browser.describeManifestSchema()).toEqual({ entities: { fields: ["entity_key"] } });
		const minimalToml = ["schema", '_version = "1.0.0"'].join("");
		expect(browser.parseSchemaManifestToml(minimalToml).schema_version).toBe("1.0.0");
		expect(browser.inspectManifest("ignored").manifest.entities).toEqual([
			{ entity_key: "demo/hero" },
		]);
		expect(browser.renderSchemaManifest({ entities: [] })).toContain('"entities":[]');

		const manifest: Record<string, unknown> = { entities: [] };
		browser.patchManifest(manifest, "add-entity", { entity_key: "demo/hero", name: "Hero" });
		expect(manifest.entities).toEqual([{ entity_key: "demo/hero", name: "Hero" }]);
		expect(
			browser.clusterRows([], {
				bundleId: "demo",
				manifestPath: "demo/manifest.toml",
				capPrefix: "test",
				actionPrefix: "act_",
				defaultCaster: "demo/hero",
				defaultCasterNode: "demo/room",
			}),
		).toEqual({
			action_definitions: [{ action_id: "demo/strike" }],
		});
		expect(
			browser.diffManifests(
				{ entities: [{ entity_key: "demo/a", name: "A" }] },
				{ entities: [{ entity_key: "demo/a", name: "B" }] },
			).kinds[0]?.changed,
		).toEqual([{ key: "demo/a", fields: [{ field: "name", left: "A", right: "B" }] }]);
		expect(
			browser.filterManifestForActor(
				{ entities: [{ entity_key: "demo/hero" }], actors: [{ entity_key: "demo/hero" }] },
				"demo/hero",
			).entities,
		).toEqual([{ entity_key: "demo/hero" }]);
		expect(
			browser.inspectRowReferences(
				{ entities: [{ entity_key: "demo/hero", place_node_id: "demo/room" }] },
				"entities",
				"demo/hero",
			).outbound,
		).toEqual([{ field: "place_node_id", value: "demo/room" }]);
		expect(
			browser.resolveRefTagValue(
				{ resource_definitions: [{ resource_id: "demo/hp" }] },
				"resource_definitions",
				"resource_id",
				"hp",
				"demo.hp",
			),
		).toBe("demo/hp");
		expect(browser.evaluateDslExpression({ expression: "1 == 1", kind: "predicate" })).toEqual({
			ok: true,
			value: { type: "Bool", value: true },
			draws: [],
			trace: [],
		});
	});
});
