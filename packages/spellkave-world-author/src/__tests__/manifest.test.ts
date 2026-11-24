// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "renderer assertions pin the exact schema directive and emitted TOML shape", "signatures": ["schema_directive"]}
// ci-allow(embedded-manifest-schema): renderer directive assertion - fragments, not a whole valid document
import { describe, expect, it } from "vitest";
import { renderManifest, type WorldManifest } from "../manifest";

const header = {
	bundleId: "explorer_scratch",
	displayName: "Explorer Scratch",
	author: "world-author-agent",
	version: "1.0.0",
	dependsOn: ["core"],
	description: "test bundle",
};

describe("renderManifest", () => {
	it("always emits the schema directive, metadata, and bundle header", () => {
		const toml = renderManifest({ header });
		expect(toml).toContain("#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json");
		expect(toml).toContain('profile = "explorer_scratch"');
		expect(toml).toMatch(/\[\[bundles\]\][\s\S]*?depends_on = \["core"\]/);
	});

	it("omits tables whose arrays are absent", () => {
		const toml = renderManifest({ header });
		expect(toml).not.toContain("[[entities]]");
		expect(toml).not.toContain("[[actor_capabilities]]");
		expect(toml).not.toContain("[[affordance_templates]]");
	});

	it("renders presence rows (entities + actors + spatial locations)", () => {
		const manifest: WorldManifest = {
			header,
			entities: [
				{
					entityKey: "explorer_scratch/guide",
					name: "Guide",
					kind: "npc",
					placeNodeId: "village/green",
				},
			],
			actors: [{ entityKey: "explorer_scratch/guide", name: "Guide" }],
			actorSpatialLocations: [
				{
					entityKey: "explorer_scratch/guide",
					placeNodeId: "village/green",
					selectionPath: "manifest:explorer_scratch/guide",
				},
			],
		};
		const toml = renderManifest(manifest);
		expect(toml).toMatch(/\[\[entities\]\][\s\S]*?kind = "npc"/);
		expect(toml).toMatch(/\[\[actors\]\][\s\S]*?name = "Guide"/);
		expect(toml).toMatch(
			/\[\[actor_spatial_locations\]\][\s\S]*?selection_path = "manifest:explorer_scratch\/guide"/,
		);
	});

	it("renders paired node-entry action bindings on spatial niches", () => {
		const toml = renderManifest({
			header,
			spatialNicheAttachments: [
				{
					placeNodeId: "explorer_scratch/hall/plate",
					nicheId: "explorer_scratch/pressure_plate",
					onEntryActionId: "explorer_scratch/pressure_plate/save",
					onEntryTargetEntityKey: "explorer_scratch/pressure_plate_1",
				},
			],
		});
		expect(toml).toContain('on_entry_action_id = "explorer_scratch/pressure_plate/save"');
		expect(toml).toContain('on_entry_target_entity_key = "explorer_scratch/pressure_plate_1"');
	});

	it("renders an outcome's action id as a typed descriptor and a SetEntityFlag write", () => {
		const toml = renderManifest({
			header,
			outcomeTemplates: [
				{
					outcomeTemplateId: "explorer_scratch/pull/outcome",
					displayName: "pull",
					actionId: "explorer_scratch/pull",
					consequenceTemplateId: "explorer_scratch/pull_success",
				},
			],
			consequences: [
				{
					templateId: "explorer_scratch/pull_success",
					writes: [{ entity: "TargetEntity", flag: "explorer_scratch/pulled", value: true }],
				},
			],
		});
		expect(toml).toContain('manipulation_action_id = "explorer_scratch/pull"');
		expect(toml).toContain('consequence_template_id = "explorer_scratch/pull_success"');
		expect(toml).toContain("[consequence_frame_writes.frame_write.SetEntityFlag]");
		expect(toml).toContain('flag = "explorer_scratch/pulled"');
	});

	it("renders metadata attachments as [[metadata_attachments]] rows (ADR-0073)", () => {
		const toml = renderManifest({
			header,
			metadataNamespaces: [
				{
					namespace: "explorer_scratch.note",
					audience: "author",
					description: "Scratch author notes.",
				},
			],
			metadataAttachments: [
				{
					targetKind: "place_graph",
					targetRef: "explorer_scratch/graph",
					namespace: "explorer_scratch.note",
					payload: { text: "needs review" },
				},
			],
		});
		expect(toml).toContain("[[metadata_namespaces]]");
		expect(toml).toContain('namespace = "explorer_scratch.note"');
		expect(toml).toContain("[[metadata_attachments]]");
		expect(toml).toContain('target_kind = "place_graph"');
		expect(toml).toContain('payload_json = \'{"text":"needs review"}\'');
	});
});
