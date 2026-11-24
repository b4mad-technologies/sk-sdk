import { describe, expect, it } from "vitest";
import {
	describeDsl,
	describeManifestSchema,
	inspectManifest,
	inspectRowReferences,
	renderManifest,
} from "../index";

const header = {
	bundleId: "inspect_demo",
	displayName: "Inspect Demo",
	author: "world-author-agent",
	version: "1.0.0",
	dependsOn: [],
	description: "inspection fixture",
};

describe("structured reference", () => {
	it("describes the manifest schema and DSL operators through wasm", () => {
		expect(describeManifestSchema().title).toBe("Manifest");
		expect(describeDsl().operators.some((op) => op.operator === "HasTag")).toBe(true);
	});
});

describe("inspectManifest", () => {
	it("parses TOML to typed rows and returns a compact summary", () => {
		const toml = renderManifest({
			header,
			entities: [
				{
					entityKey: "inspect_demo/guide",
					name: "Guide",
					kind: "npc",
					placeNodeId: "inspect_demo/green",
				},
			],
		});

		const inspection = inspectManifest(toml);
		expect(inspection.summary.bundleIds).toEqual(["inspect_demo"]);
		expect(inspection.summary.rowKinds.entities).toBe(1);
		expect(inspection.summary.rowRefs.entities).toContain("entity_key=inspect_demo/guide");
	});
});

// #1968 spellkave_query: the inbound/outbound ref-graph walk behind the
// definition-lookup gap's detail shape. Plain object manifests (no TOML/wasm
// needed — `inspectRowReferences` is a pure walk over already-parsed rows).
describe("inspectRowReferences", () => {
	const manifest = {
		capability_definitions: [
			{
				capability_id: "aoe_blast/firebloom",
				bundle_id: "aoe_blast",
				actor_kind: "npc",
				display_name: "Firebloom",
				description: "",
			},
		],
		affordance_templates: [
			{
				template_id: "aoe_blast/firebloom/cast",
				bundle_id: "aoe_blast",
				niche_id: "capability:aoe_blast/firebloom",
				capability_id: "aoe_blast/firebloom",
				display_name: "Cast Firebloom",
				outcome_template_id: "aoe_blast/firebloom/outcome",
			},
		],
	};

	it("outbound: fields on the row pointing elsewhere, excluding the row's own natural-key field", () => {
		const { outbound } = inspectRowReferences(
			manifest,
			"affordance_templates",
			"aoe_blast/firebloom/cast",
		);
		expect(outbound).toContainEqual({ field: "capability_id", value: "aoe_blast/firebloom" });
		expect(outbound).toContainEqual({
			field: "outcome_template_id",
			value: "aoe_blast/firebloom/outcome",
		});
		// `template_id` is this row's OWN natural key — identity, not a ref.
		expect(outbound.some((r) => r.field === "template_id")).toBe(false);
	});

	it("inbound: every other row anywhere in the manifest whose own outbound ref points at this row", () => {
		const { inbound } = inspectRowReferences(
			manifest,
			"capability_definitions",
			"aoe_blast/firebloom",
		);
		expect(inbound).toContainEqual({
			kind: "affordance_templates",
			id: "aoe_blast/firebloom/cast",
			field: "capability_id",
		});
	});

	it("a row never lists itself as its own inbound referrer (self-ref exclusion)", () => {
		const { inbound } = inspectRowReferences(
			manifest,
			"affordance_templates",
			"aoe_blast/firebloom/cast",
		);
		expect(
			inbound.some((r) => r.kind === "affordance_templates" && r.id === "aoe_blast/firebloom/cast"),
		).toBe(false);
	});

	it("an id with no authored row returns empty outbound, but still walks inbound refs (a dangling ref can still be pointed at)", () => {
		const manifestWithDanglingRef = {
			...manifest,
			affordance_templates: [
				...manifest.affordance_templates,
				{
					template_id: "aoe_blast/orphan/cast",
					bundle_id: "aoe_blast",
					capability_id: "aoe_blast/does_not_exist",
					display_name: "Orphan",
				},
			],
		};
		const { outbound, inbound } = inspectRowReferences(
			manifestWithDanglingRef,
			"capability_definitions",
			"aoe_blast/does_not_exist",
		);
		expect(outbound).toEqual([]);
		expect(inbound).toContainEqual({
			kind: "affordance_templates",
			id: "aoe_blast/orphan/cast",
			field: "capability_id",
		});
	});
});
