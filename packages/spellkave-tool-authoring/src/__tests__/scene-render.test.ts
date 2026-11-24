// embedded-manifest: {"category": "schema_object_oracle", "rationale": "Typed dependency objects prove distinct scene names, shared definitions and the real validator boundary."}
import {
	parseSchemaManifestToml,
	renderSchemaManifest,
	validateManifestToml,
} from "@spellkave/world-author/tooling";
import { describe, expect, it } from "vitest";
import { renderScene, type ScenePackage } from "../scene-render";

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
	id: "target-room",
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
			max_count: 12,
		},
	],
};
const input = () => ({
	package: structuredClone(pkg),
	setup_name: "trial-a",
	values: { anchor_id: "catalog/room/entry" },
	dependencies: [dependency],
});
describe("data-only scene render", () => {
	it("AUTH-50-01 renders distinct instances sharing catalog definitions through the authoritative validator", async () => {
		const a = await renderScene(input());
		const b = await renderScene({
			...input(),
			setup_name: "trial-b",
			values: { anchor_id: "catalog/room/entry", counts: { targets: 2 }, bearing_deg: 90 },
		});
		expect(a.generated.graph_id).not.toBe(b.generated.graph_id);
		expect(a.generated.entity_keys).toHaveLength(1);
		expect(b.generated.entity_keys).toHaveLength(2);
		for (const plan of [a, b])
			for (const phase of plan.phases) {
				expect(
					validateManifestToml(phase.validation_toml).filter((d) => d.severity === "fatal"),
				).toEqual([]);
			}
		const entities = parseSchemaManifestToml(b.phases[1]!.toml).entities as Array<
			Record<string, unknown>
		>;
		expect(
			entities.every(
				(row) =>
					row.entity_def_id === "catalog/target" && row.place_node_id === "trials/trial-b/entry",
			),
		).toBe(true);
		expect(b.controllable).toBe(false);
		expect(await renderScene(input())).toEqual(a);
	});
	it.each([
		[
			"unsupported values",
			(i: ReturnType<typeof input>) => Object.assign(i.values, { respawn: true }),
			"values.respawn",
		],
		[
			"invalid counts",
			(i: ReturnType<typeof input>) => Object.assign(i.values, { counts: { targets: -1 } }),
			"values.counts.targets",
		],
		[
			"unknown group",
			(i: ReturnType<typeof input>) => Object.assign(i.values, { counts: { wolves: 1 } }),
			"values.counts.wolves",
		],
		[
			"dangling definition",
			(i: ReturnType<typeof input>) => {
				i.package.figures[0]!.entity_def_id = "missing";
			},
			"entity_def_id",
		],
		[
			"dangling node",
			(i: ReturnType<typeof input>) => {
				i.package.figures[0]!.node_local_id = "missing";
			},
			"node_local_id",
		],
		[
			"duplicate key",
			(i: ReturnType<typeof input>) => {
				i.package.figures.push(i.package.figures[0]!);
			},
			"key",
		],
		[
			"missing dependency",
			(i: ReturnType<typeof input>) => {
				i.dependencies = [];
			},
			"dependencies",
		],
	])("rejects %s before any connected operation", async (_, mutate, path) => {
		const i = input();
		mutate(i);
		await expect(renderScene(i)).rejects.toThrow(path);
	});
	it("pins package and dependency bytes", async () => {
		const a = await renderScene(input());
		const b = await renderScene({
			...input(),
			dependencies: [`${dependency}\n# reviewed revision\n`],
		});
		expect(a.package_digest).toBe(b.package_digest);
		expect(a.dependencies).not.toEqual(b.dependencies);
		expect(a.plan_digest).not.toBe(b.plan_digest);
	});
});
