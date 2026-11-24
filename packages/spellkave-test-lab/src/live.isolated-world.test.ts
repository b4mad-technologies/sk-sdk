import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";

import { isolatedWorldManifestSource } from "./live";

/** MF-FMT-001 allowlist for `[[place_nodes]]` after size_h/size_w retirement. */
const PLACE_NODE_FIELDS = new Set([
	"node_id",
	"bundle_id",
	"place_graph_id",
	"local_id",
	"substrate_id",
	"display_name",
	"description",
	"cell_res10",
	"cell_res7",
	"cell_res4",
	"pose_elevation",
	"pose_elevation_present",
	"pos_x",
	"pos_y",
	"pos_present",
	"extent_shape_id",
	"extent_params_json",
	"is_ephemeral",
]);

describe("isolatedWorld Isolated Cell TOML", () => {
	it("does not mint an undeclared legacy default capability and preserves explicit grants", () => {
		const defaults = parse(isolatedWorldManifestSource([{ slug: "default-vocabulary" }])) as Record<
			string,
			unknown
		>;
		expect(defaults.actor_capabilities ?? []).toEqual([]);
		const explicit = parse(
			isolatedWorldManifestSource([
				{
					slug: "explicit-vocabulary",
					options: { capabilityIds: ["frontier.pace_time"] },
				},
			]),
		) as { actor_capabilities?: Record<string, unknown>[] };
		expect(explicit.actor_capabilities?.map((row) => row.capability_id)).toEqual([
			"frontier.pace_time",
		]);
	});
	it("authors each equipped item after its owner with scene-local containment", () => {
		const parsed = parse(
			isolatedWorldManifestSource([
				{
					slug: "gear",
					options: {
						casterEquipment: [
							{
								entityDefId: "probe/item",
								slotId: "probe/grip",
								stateSeeds: [{ stateId: "probe/budget", valueInt: 1 }],
							},
						],
					},
				},
			]),
		) as Record<string, Record<string, unknown>[]>;
		const entities = parsed.entities ?? [];
		const owner = entities.findIndex((row) => row.entity_key === "test-isolated-world-gear/caster");
		const item = entities.findIndex(
			(row) => row.entity_key === "test-isolated-world-gear/caster/equipment/0",
		);
		expect(owner).toBeGreaterThanOrEqual(0);
		expect(item).toBeGreaterThan(owner);
		expect(entities[item]?.owned_by_entity_key).toBe(entities[owner]?.entity_key);
		expect(parsed.entity_containment).toContainEqual({
			entity_key: entities[item]?.entity_key,
			container_entity_key: entities[owner]?.entity_key,
		});
		expect(parsed.actor_equipment_slots).toContainEqual({
			actor_entity_key: entities[owner]?.entity_key,
			slot_id: "probe/grip",
			item_key: entities[item]?.entity_key,
		});
	});
	it("authors current place_node fields instead of retired size_h/size_w", () => {
		const toml = isolatedWorldManifestSource([
			{ slug: "extent-probe" },
			{ slug: "extent-probe-instanced", options: { instanced: true, includePortal: true } },
		]);
		expect(toml).not.toMatch(/\bsize_h\b/);
		expect(toml).not.toMatch(/\bsize_w\b/);

		const parsed = parse(toml) as { place_nodes?: Record<string, unknown>[] };
		const nodes = parsed.place_nodes ?? [];
		expect(nodes.length).toBeGreaterThan(0);
		for (const node of nodes) {
			expect(Object.keys(node).sort()).toEqual(
				[...Object.keys(node)].filter((key) => PLACE_NODE_FIELDS.has(key)).sort(),
			);
			expect(node).toMatchObject({
				display_name: "Isolated Cell",
				extent_shape_id: "core/area/cube",
				extent_params_json: '{"extent_m": 0.5}',
			});
		}
	});
});
