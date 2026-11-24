// embedded-manifest: {"category": "schema_object_oracle", "rationale": "compact valid bundle directly proves browser web-WASM and Node authoring parity", "signatures": ["schema_object", "schema_shape"]}
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

import { initSync as initAuthoring } from "@spellkave/authoring-wasm/browser";
import {
	manifest_schema_json as manifestSchemaJsonNode,
	render_manifest_include as renderManifestIncludeNode,
	split_manifest_fragment as splitManifestFragmentNode,
} from "@spellkave/validate-wasm";
import {
	initSync as initValidate,
	manifest_schema_json as manifestSchemaJsonWeb,
	render_manifest_include as renderManifestIncludeWeb,
	split_manifest_fragment as splitManifestFragmentWeb,
} from "@spellkave/validate-wasm/browser";
import { describe, expect, it } from "vitest";

import * as nodeTooling from "../tooling";

const authoringWasm = createRequire(import.meta.url).resolve("@spellkave/authoring-wasm/browser/wasm");
const validateWasm = createRequire(import.meta.url).resolve("@spellkave/validate-wasm/browser/wasm");

function initializeWebWasm(): void {
	initAuthoring({ module: readFileSync(authoringWasm) });
	initValidate({ module: readFileSync(validateWasm) });
}

const manifest = {
	schema_version: "1.0.0",
	metadata: { profile: "demo" },
	bundles: [
		{
			bundle_id: "demo",
			display_name: "Demo",
			author: "test",
			version: "1.0.0",
			description: "web parity",
			depends_on: [],
		},
	],
	entities: [
		{ entity_key: "demo/hero", bundle_id: "demo", name: "Hero", kind: "player", place_node_id: "" },
	],
	actors: [{ entity_key: "demo/hero", bundle_id: "demo", name: "Hero" }],
};

describe("browser AUTHOR tooling real web-WASM parity", () => {
	it("matches the canonical Node tooling across execution operations", async () => {
		initializeWebWasm();
		const browser = await import("../tooling.browser");
		await browser.loadBrowserAuthorTooling();
		const nodeSchema = JSON.parse(manifestSchemaJsonNode()) as {
			definitions: { MetadataValue: { anyOf: Array<Record<string, unknown>> } };
		};
		const webSchema = JSON.parse(manifestSchemaJsonWeb()) as typeof nodeSchema;
		expect(nodeSchema).toEqual(webSchema);
		expect(nodeSchema.definitions.MetadataValue.anyOf[1]).toMatchObject({
			minimum: -9007199254740991,
			maximum: 9007199254740991,
		});

		const liveJson =
			'{"schema_version":"1.0.0","entities":[{"entity_key":"demo/max","bundle_id":"demo","name":"Maximum","kind":"item","place_node_id":"","quantity":18446744073709551615}]}';
		expect(browser.liveManifestRowIdentities(liveJson)).toEqual(
			nodeTooling.liveManifestRowIdentities(liveJson),
		);
		expect(() =>
			browser.liveManifestRowIdentities(
				liveJson.replace("18446744073709551615", "18446744073709551616"),
			),
		).toThrow();
		expect(browser.describeManifestSchema()).toEqual(nodeTooling.describeManifestSchema());
		const nodeToml = nodeTooling.renderSchemaManifest(manifest);
		expect(browser.renderSchemaManifest(manifest)).toBe(nodeToml);
		expect(browser.parseSchemaManifestToml(nodeToml)).toEqual(
			nodeTooling.parseSchemaManifestToml(nodeToml),
		);
		expect(browser.inspectManifest(nodeToml)).toEqual(nodeTooling.inspectManifest(nodeToml));
		expect(browser.validateManifestToml(nodeToml)).toEqual(
			nodeTooling.validateManifestToml(nodeToml),
		);
		expect(renderManifestIncludeWeb(nodeToml, true)).toBe(
			renderManifestIncludeNode(nodeToml, true),
		);
		const include = nodeTooling.renderManifestInclude(nodeToml, { retainMetadata: true });
		expect(browser.renderManifestInclude(nodeToml, { retainMetadata: true })).toBe(include);
		expect(browser.splitIncludedManifestMetadata(include)).toEqual(
			nodeTooling.splitIncludedManifestMetadata(include),
		);
		const emptyMetadataNode = splitManifestFragmentNode("[metadata]\n");
		expect(splitManifestFragmentWeb("[metadata]\n")).toBe(emptyMetadataNode);
		expect(JSON.parse(emptyMetadataNode)).toEqual({ metadata: {}, rowToml: "" });
		expect(() => splitManifestFragmentNode('[metadata]\nprofile = ["invalid"]\n')).toThrow(
			/MF-VAL-362/,
		);
		expect(() => splitManifestFragmentWeb('[metadata]\nprofile = ["invalid"]\n')).toThrow(
			/MF-VAL-362/,
		);

		const nodePatched = structuredClone(manifest) as Record<string, unknown>;
		const browserPatched = structuredClone(manifest) as Record<string, unknown>;
		const patch = { entity_key: "demo/torch", name: "Torch", kind: "item", place_node_id: "" };
		nodeTooling.patchManifest(nodePatched, "add-entity", patch);
		browser.patchManifest(browserPatched, "add-entity", patch);
		expect(browserPatched).toEqual(nodePatched);

		const behavior: nodeTooling.ActorBehavior = {
			key: "strike",
			displayName: "Strike",
			emitCapability: true,
			actionTags: ["test"],
			shape: "single-target",
			predicateSource: "",
			deltaSource: "0 - 1",
		};
		const config: nodeTooling.BehaviorConfig = {
			bundleId: "demo",
			manifestPath: "demo/manifest.toml",
			capPrefix: "test",
			actionPrefix: "act_",
			defaultCaster: "demo/hero",
			defaultCasterNode: "demo/room",
		};
		expect(browser.clusterRows([behavior], config)).toEqual(
			nodeTooling.clusterRows([behavior], config),
		);
		expect(browser.ROW_KIND_NATURAL_KEY).toEqual(nodeTooling.ROW_KIND_NATURAL_KEY);
		expect(browser.ROW_KIND_COMPOSITE_KEY).toEqual(nodeTooling.ROW_KIND_COMPOSITE_KEY);

		const changed = {
			...manifest,
			entities: [
				{
					entity_key: "demo/hero",
					bundle_id: "demo",
					name: "Renamed",
					kind: "player",
					place_node_id: "",
				},
			],
		};
		const nodeDiff = nodeTooling.diffManifests(manifest, changed);
		expect(browser.diffManifests(manifest, changed)).toEqual(nodeDiff);
		expect(browser.flattenManifestDiff(nodeDiff)).toEqual(
			nodeTooling.flattenManifestDiff(nodeDiff),
		);
		expect(browser.parseMapKey("demo=other")).toEqual(nodeTooling.parseMapKey("demo=other"));
		expect(browser.stripManifestHeaders(nodeToml)).toEqual(
			nodeTooling.stripManifestHeaders(nodeToml),
		);
		expect(browser.filterManifestForActor(manifest, "demo/hero")).toEqual(
			nodeTooling.filterManifestForActor(manifest, "demo/hero"),
		);
		expect(browser.filteredRowCount(manifest)).toBe(nodeTooling.filteredRowCount(manifest));

		const refs = { entities: [{ entity_key: "demo/hero", place_node_id: "demo/room" }] };
		expect(browser.inspectRowReferences(refs, "entities", "demo/hero")).toEqual(
			nodeTooling.inspectRowReferences(refs, "entities", "demo/hero"),
		);
		expect(browser.manifestTagPrefixFamilies(manifest)).toEqual(
			nodeTooling.manifestTagPrefixFamilies(manifest),
		);
		expect(browser.queryAuthoringDocs("damage routing")).toEqual(
			nodeTooling.queryAuthoringDocs("damage routing"),
		);

		const evalOptions: nodeTooling.EvaluateDslExpressionOptions = {
			expression: "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
			kind: "predicate",
			facts: {
				actor: { stat: { "demo/bonus": 3 } },
				target: { stat: { "demo/threshold": 15 } },
			},
			dice: [12],
		};
		const nodeEval = nodeTooling.evaluateDslExpression(evalOptions);
		expect(nodeEval.ok).toBe(true);
		expect(nodeEval.value).toEqual({ type: "Bool", value: true });
		expect(browser.evaluateDslExpression(evalOptions)).toEqual(nodeEval);
	});
});
