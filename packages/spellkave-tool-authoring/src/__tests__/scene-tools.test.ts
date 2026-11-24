// embedded-manifest: {"category": "schema_object_oracle", "rationale": "Typed neutral dependencies prove receipt orchestration and do not replace live server admission evidence."}
import { renderSchemaManifest } from "@spellkave/world-author/tooling";
import { describe, expect, it, vi } from "vitest";
import type { AuthorToolContext } from "../authoring";
import { type ScenePackage, sceneTextDigest } from "../scene-render";
import { previewScene, type SceneSourceSnapshot, stageScene } from "../scene-tools";

const dependency = renderSchemaManifest({
	schema_version: "1.0.0",
	bundles: [{ bundle_id: "catalog", display_name: "Catalog", author: "test", version: "1.0.0" }],
	place_graphs: [
		{
			bundle_id: "catalog",
			place_graph_id: "catalog/room",
			substrate_id: "indoor",
			display_name: "Room",
			anchor_node_id: "catalog/room/entry",
		},
	],
	place_nodes: [
		{
			bundle_id: "catalog",
			node_id: "catalog/room/entry",
			place_graph_id: "catalog/room",
			local_id: "entry",
			substrate_id: "indoor",
			display_name: "Entry",
		},
	],
	entity_definitions: [
		{ bundle_id: "catalog", entity_def_id: "catalog/target", display_name: "Target" },
	],
});
const pkg: ScenePackage = {
	format: "spellkave-scene/v1",
	id: "room",
	version: "1.0.0",
	bundle_id: "trials",
	blueprint_id: "catalog/room",
	dependencies: ["catalog"],
	figures: [
		{
			key: "targets",
			entity_def_id: "catalog/target",
			node_local_id: "entry",
			kind: "npc",
			name: "Target",
			default_count: 1,
			max_count: 2,
		},
	],
};
async function fixture() {
	const source: SceneSourceSnapshot = {
		protocol_version: 1,
		caller: "caller",
		endpoint: "world",
		world_instance_id: "epoch",
		source_digest: "a".repeat(64),
		snapshot_json: JSON.stringify({
			graph: { place_graph_id: "catalog/room" },
			nodes: [{ node_id: "catalog/room/entry" }],
		}),
	};
	source.source_digest = await sceneTextDigest(source.snapshot_json);
	const apply = vi.fn(
		async (_toml: string): Promise<{ ok: boolean; detail?: string }> => ({ ok: true }),
	);
	const context: AuthorToolContext = {
		workspace: { readToml: () => null, writeToml: (text) => text },
		scenes: { snapshot: async () => ({ ...source }), apply },
	};
	const input = {
		package: pkg,
		values: { anchor_id: "catalog/room/entry" },
		setup_name: "trial-a",
		dependencies: [dependency],
	};
	return { context, source, apply, input };
}
describe("scene receipt orchestration (live server admission is separately proven)", () => {
	it("AUTH-50-01 pins the selected source and guards every phase", async () => {
		const { context, apply, input } = await fixture();
		const plan = await previewScene(context, input);
		const receipt = await stageScene(context, { plan, expected_world_instance_id: "epoch" });
		expect(receipt.ok).toBe(true);
		expect(receipt.phases.map((phase) => phase.outcome)).toEqual(["committed", "committed"]);
		expect(apply).toHaveBeenCalledTimes(2);
		for (const [toml] of apply.mock.calls)
			expect(toml).toContain('expected_world_instance_id = "epoch"');
		expect(apply.mock.calls[0]?.[0]).toContain("scene_source_preconditions");
		expect(receipt.controllable).toBe(false);
		expect(receipt.cleanup.complete).toBe(false);
	});
	it("AUTH-50-02 preserves graph success after population refusal", async () => {
		const { context, apply, input } = await fixture();
		apply
			.mockResolvedValueOnce({ ok: true })
			.mockResolvedValueOnce({ ok: false, detail: "MF-APPLY-041" });
		const plan = await previewScene(context, input);
		const receipt = await stageScene(context, { plan, expected_world_instance_id: "epoch" });
		expect(receipt.ok).toBe(false);
		expect(receipt.phases.map((phase) => phase.outcome)).toEqual(["committed", "refused"]);
		expect(receipt.generated.graph_id).toBe("trials/trial-a");
		expect(receipt.cleanup.guidance).toContain("ejects occupants");
	});
	it("does not retry an unknown graph outcome or populate after disconnect", async () => {
		const { context, apply, input } = await fixture();
		apply.mockRejectedValueOnce(new Error("connection lost"));
		const plan = await previewScene(context, input);
		const receipt = await stageScene(context, { plan, expected_world_instance_id: "epoch" });
		expect(receipt.ok).toBe(false);
		expect(receipt.phases).toMatchObject([{ name: "graph", outcome: "unknown" }]);
		expect(apply).toHaveBeenCalledTimes(1);
	});
	it("refuses a changed world between graph and population", async () => {
		const { context, apply, source, input } = await fixture();
		const plan = await previewScene(context, input);
		apply.mockImplementationOnce(async () => {
			source.world_instance_id = "reset";
			return { ok: true };
		});
		const receipt = await stageScene(context, { plan, expected_world_instance_id: "epoch" });
		expect(receipt.phases.map((phase) => phase.outcome)).toEqual(["committed", "refused"]);
		expect(apply).toHaveBeenCalledTimes(1);
	});
	it("offline rendering cannot substitute for source admission", async () => {
		const { context, input, apply } = await fixture();
		const plan = await previewScene({ workspace: context.workspace }, input);
		await expect(
			stageScene(context, { plan, expected_world_instance_id: "epoch" }),
		).rejects.toThrow("offline render");
		expect(apply).not.toHaveBeenCalled();
	});
	it("rebuilds the plan and rejects changed phase rows before dispatch", async () => {
		const { context, input, apply } = await fixture();
		const plan = await previewScene(context, input);
		plan.phases[0]!.toml += '\n[[role_bindings]]\nbinding_id = "rogue"\n';
		await expect(
			stageScene(context, { plan, expected_world_instance_id: "epoch" }),
		).rejects.toThrow("changed");
		expect(apply).not.toHaveBeenCalled();
	});
});
