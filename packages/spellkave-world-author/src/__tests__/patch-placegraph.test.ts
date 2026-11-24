// embedded-manifest: {"category": "schema_object_oracle", "rationale": "compact place graph is the direct algorithm oracle for graph patching", "signatures": ["schema_object", "schema_shape"]}
import { describe, expect, it } from "vitest";
import { patchManifest, renderSchemaManifestJson, validateManifestToml } from "../index";

const BUNDLE_ID = "patch_ops_test";

function baseManifest(): Record<string, unknown> {
	return {
		schema_version: "1.0.0",
		bundles: [
			{
				bundle_id: BUNDLE_ID,
				display_name: "Patch Ops Test",
				author: "world-author tests",
				version: "0.0.0",
				depends_on: [],
			},
		],
	};
}

describe("patchManifest — add-place-graph (#1578)", () => {
	it("upserts by place_graph_id, mirroring PlaceGraphRow columns exactly", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-graph", {
			place_graph_id: `${BUNDLE_ID}/hall`,
			bundle_id: BUNDLE_ID,
			substrate_id: "indoor",
			display_name: "The Hall",
			anchor_node_id: `${BUNDLE_ID}/hall/entry`,
		});
		expect(manifest.place_graphs).toEqual([
			{
				place_graph_id: `${BUNDLE_ID}/hall`,
				bundle_id: BUNDLE_ID,
				substrate_id: "indoor",
				display_name: "The Hall",
				anchor_node_id: `${BUNDLE_ID}/hall/entry`,
			},
		]);

		// Re-authoring the same id replaces rather than duplicates.
		patchManifest(manifest, "add-place-graph", {
			place_graph_id: `${BUNDLE_ID}/hall`,
			bundle_id: BUNDLE_ID,
			substrate_id: "indoor",
			display_name: "The Hall (renamed)",
			anchor_node_id: `${BUNDLE_ID}/hall/entry`,
			description: "a drafty hall",
			bearing: 45,
			metres_per_unit: 2.5,
			parent_graph_id: `${BUNDLE_ID}/keep`,
			blueprint_id: `${BUNDLE_ID}/hall_blueprint`,
			origin_cell_res10: 12,
			origin_cell_res7: 3,
			origin_cell_res4: 1,
		});
		expect(manifest.place_graphs).toHaveLength(1);
		expect(manifest.place_graphs).toEqual([
			{
				place_graph_id: `${BUNDLE_ID}/hall`,
				bundle_id: BUNDLE_ID,
				substrate_id: "indoor",
				display_name: "The Hall (renamed)",
				anchor_node_id: `${BUNDLE_ID}/hall/entry`,
				description: "a drafty hall",
				bearing: 45,
				metres_per_unit: 2.5,
				parent_graph_id: `${BUNDLE_ID}/keep`,
				blueprint_id: `${BUNDLE_ID}/hall_blueprint`,
				origin_cell_res10: 12,
				origin_cell_res7: 3,
				origin_cell_res4: 1,
			},
		]);
	});

	it("requires place_graph_id, substrate_id, display_name, and anchor_node_id", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-place-graph", {
				bundle_id: BUNDLE_ID,
				substrate_id: "indoor",
				display_name: "No id",
				anchor_node_id: "x/y",
			}),
		).toThrow(/place_graph_id/);
		expect(() =>
			patchManifest(manifest, "add-place-graph", {
				place_graph_id: `${BUNDLE_ID}/no_anchor`,
				bundle_id: BUNDLE_ID,
				substrate_id: "indoor",
				display_name: "No anchor",
			}),
		).toThrow(/anchor_node_id/);
	});

	it("ignores malformed optional fields (typeof guards)", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-graph", {
			place_graph_id: `${BUNDLE_ID}/hall2`,
			bundle_id: BUNDLE_ID,
			substrate_id: "indoor",
			display_name: "Hall 2",
			anchor_node_id: `${BUNDLE_ID}/hall2/entry`,
			bearing: "not-a-number",
			metres_per_unit: null,
			description: 12345,
		});
		const row = (manifest.place_graphs as Record<string, unknown>[])[0]!;
		expect(row.bearing).toBeUndefined();
		expect(row.metres_per_unit).toBeUndefined();
		expect(row.description).toBeUndefined();
	});
});

describe("patchManifest — add-place-node (#1578)", () => {
	it("upserts by node_id and takes node_id as an explicit field (never synthesized)", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-node", {
			node_id: `${BUNDLE_ID}/hall/entry`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			local_id: "entry",
			substrate_id: "indoor",
			display_name: "Entry",
		});
		expect(manifest.place_nodes).toEqual([
			{
				node_id: `${BUNDLE_ID}/hall/entry`,
				bundle_id: BUNDLE_ID,
				place_graph_id: `${BUNDLE_ID}/hall`,
				local_id: "entry",
				substrate_id: "indoor",
				display_name: "Entry",
			},
		]);

		patchManifest(manifest, "add-place-node", {
			node_id: `${BUNDLE_ID}/hall/entry`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			local_id: "entry",
			substrate_id: "indoor",
			display_name: "Entry (redecorated)",
			description: "a drafty doorway",
			pos_x: 3,
			pos_y: 4,
			pos_present: true,
			pose_elevation: 1.5,
			pose_elevation_present: true,
			extent_shape_id: "core/area/cube",
			extent_params_json: '{"extent_m":2}',
		});
		expect(manifest.place_nodes).toHaveLength(1);
		expect((manifest.place_nodes as Record<string, unknown>[])[0]!).toMatchObject({
			display_name: "Entry (redecorated)",
			description: "a drafty doorway",
			pos_x: 3,
			pos_y: 4,
			pos_present: true,
			pose_elevation: 1.5,
			pose_elevation_present: true,
			extent_shape_id: "core/area/cube",
			extent_params_json: '{"extent_m":2}',
		});
	});

	it("requires node_id, place_graph_id, local_id, substrate_id, display_name", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-place-node", {
				bundle_id: BUNDLE_ID,
				place_graph_id: `${BUNDLE_ID}/hall`,
				local_id: "entry",
				substrate_id: "indoor",
				display_name: "Entry",
			}),
		).toThrow(/node_id/);
		expect(() =>
			patchManifest(manifest, "add-place-node", {
				node_id: `${BUNDLE_ID}/hall/entry`,
				bundle_id: BUNDLE_ID,
				local_id: "entry",
				substrate_id: "indoor",
				display_name: "Entry",
			}),
		).toThrow(/place_graph_id/);
	});

	it("ignores malformed optional fields (typeof guards)", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-node", {
			node_id: `${BUNDLE_ID}/hall/window`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			local_id: "window",
			substrate_id: "indoor",
			display_name: "Window",
			pos_x: "three",
			pos_present: "yes",
		});
		const row = (manifest.place_nodes as Record<string, unknown>[])[0]!;
		expect(row.pos_x).toBeUndefined();
		expect(row.pos_present).toBeUndefined();
	});
});

describe("patchManifest — add-place-edge (#1578)", () => {
	it("upserts by edge_key, never edge_id", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			edge_id: 999, // must be ignored — edge_id is server #[auto_inc], never authored
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			from_node_id: `${BUNDLE_ID}/hall/entry`,
			to_node_id: `${BUNDLE_ID}/hall/main`,
		});
		expect(manifest.place_edges).toEqual([
			{
				edge_key: `${BUNDLE_ID}/edge/entry-hall`,
				bundle_id: BUNDLE_ID,
				place_graph_id: `${BUNDLE_ID}/hall`,
				from_node_id: `${BUNDLE_ID}/hall/entry`,
				to_node_id: `${BUNDLE_ID}/hall/main`,
			},
		]);
		expect((manifest.place_edges as Record<string, unknown>[])[0]!.edge_id).toBeUndefined();

		// Re-authoring the same edge_key replaces rather than duplicates.
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			from_node_id: `${BUNDLE_ID}/hall/entry`,
			to_node_id: `${BUNDLE_ID}/hall/main`,
			pose_dt_elevation: 1.0,
			pose_dt_elevation_present: true,
			substrate_crossing: true,
			cell_anchor: 42,
			cell_anchor_u: 0.5,
			cell_anchor_v: 0.5,
			cell_anchor_present: true,
			from_anchor_side: "north",
			from_anchor_offset: 1.0,
			to_anchor_side: "south",
			to_anchor_offset: 2.0,
		});
		expect(manifest.place_edges).toHaveLength(1);
		expect((manifest.place_edges as Record<string, unknown>[])[0]!).toMatchObject({
			pose_dt_elevation: 1.0,
			substrate_crossing: true,
			cell_anchor: 42,
			from_anchor_side: "north",
			to_anchor_side: "south",
		});
	});

	it("requires a non-empty edge_key even though the table tolerates empty for runtime edges", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-place-edge", {
				edge_key: "",
				bundle_id: BUNDLE_ID,
				place_graph_id: `${BUNDLE_ID}/hall`,
				from_node_id: `${BUNDLE_ID}/hall/entry`,
				to_node_id: `${BUNDLE_ID}/hall/main`,
			}),
		).toThrow(/edge_key/);
	});

	it("requires from_node_id and to_node_id", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-place-edge", {
				edge_key: `${BUNDLE_ID}/edge/broken`,
				bundle_id: BUNDLE_ID,
				place_graph_id: `${BUNDLE_ID}/hall`,
				to_node_id: `${BUNDLE_ID}/hall/main`,
			}),
		).toThrow(/from_node_id/);
	});

	it("treats an empty place_graph_id as a legal cross-graph edge", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/cross-graph`,
			bundle_id: BUNDLE_ID,
			place_graph_id: "",
			from_node_id: `${BUNDLE_ID}/hall/entry`,
			to_node_id: `${BUNDLE_ID}/keep/gate`,
		});
		expect((manifest.place_edges as Record<string, unknown>[])[0]!.place_graph_id).toBe("");
	});

	it("defaults place_graph_id to empty (still present on the row) when omitted entirely", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/omitted-graph`,
			bundle_id: BUNDLE_ID,
			from_node_id: `${BUNDLE_ID}/hall/entry`,
			to_node_id: `${BUNDLE_ID}/keep/gate`,
		});
		const row = (manifest.place_edges as Record<string, unknown>[])[0]!;
		expect(row.place_graph_id).toBe("");
	});

	it("ADR-0101 D-1: inherit_movement_default is omitted when unset, and settable to false (the replace idiom)", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/chasm`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			from_node_id: `${BUNDLE_ID}/hall/entry`,
			to_node_id: `${BUNDLE_ID}/hall/main`,
		});
		expect(
			(manifest.place_edges as Record<string, unknown>[])[0]!.inherit_movement_default,
		).toBeUndefined();

		// Re-authoring the SAME edge_key with inherit_movement_default: false is a
		// whole-row upsert-by-edge_key — a caller wanting to keep other fields must
		// repeat them (documented on `add_place_edge`'s own doc comment).
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/chasm`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			from_node_id: `${BUNDLE_ID}/hall/entry`,
			to_node_id: `${BUNDLE_ID}/hall/main`,
			inherit_movement_default: false,
		});
		expect(manifest.place_edges).toHaveLength(1);
		expect((manifest.place_edges as Record<string, unknown>[])[0]!.inherit_movement_default).toBe(
			false,
		);
	});

	it("sk-gre: threads description onto the row, omitted when absent", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/description`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			from_node_id: `${BUNDLE_ID}/hall/entry`,
			to_node_id: `${BUNDLE_ID}/hall/main`,
			description: "a drafty doorway",
		});
		expect((manifest.place_edges as Record<string, unknown>[])[0]!.description).toBe(
			"a drafty doorway",
		);

		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/no-description`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hall`,
			from_node_id: `${BUNDLE_ID}/hall/entry`,
			to_node_id: `${BUNDLE_ID}/hall/main`,
		});
		const row = (manifest.place_edges as Record<string, unknown>[])[1]!;
		expect(row.description).toBeUndefined();
	});
});

describe("patchManifest — add-movement-default (ADR-0101 D-1/D-7)", () => {
	it("defaults place_graph_id and mode_id to the implicit bundle scope", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-movement-default", {
			affordance_template_id: "srd/affordance/step",
			bindings_json: '{"movement_reach_resource":"srd/speed-walk"}',
		});
		expect(manifest.movement_defaults).toEqual([
			{
				bundle_id: BUNDLE_ID,
				place_graph_id: "",
				mode_id: "",
				affordance_template_id: "srd/affordance/step",
				bindings_json: '{"movement_reach_resource":"srd/speed-walk"}',
			},
		]);
	});

	it("scopes to one place_graph_id when given, and never emits an implicit bundle default in its place", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-movement-default", {
			place_graph_id: `${BUNDLE_ID}/hall`,
			affordance_template_id: "srd/affordance/step",
		});
		const row = (manifest.movement_defaults as Record<string, unknown>[])[0]!;
		expect(row.place_graph_id).toBe(`${BUNDLE_ID}/hall`);
	});

	it("upserts by (bundle_id, place_graph_id, mode_id, affordance_template_id) — replace vs sibling", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-movement-default", {
			affordance_template_id: "srd/affordance/step",
			bindings_json: '{"a":"1"}',
		});
		// Re-authoring the SAME scope+mode+template replaces bindings_json.
		patchManifest(manifest, "add-movement-default", {
			affordance_template_id: "srd/affordance/step",
			bindings_json: '{"a":"2"}',
		});
		expect(manifest.movement_defaults).toHaveLength(1);
		expect((manifest.movement_defaults as Record<string, unknown>[])[0]!.bindings_json).toBe(
			'{"a":"2"}',
		);

		// A second template in the SAME (bundle, graph, mode) scope is a sibling
		// row — AND-join within the mode, mirrors place_edge_affordance.
		patchManifest(manifest, "add-movement-default", {
			affordance_template_id: "srd/affordance/locked_door",
			bindings_json: '{"required_key":"srd/item/key"}',
		});
		expect(manifest.movement_defaults).toHaveLength(2);

		// A distinct mode_id is a third alternative (OR across modes).
		patchManifest(manifest, "add-movement-default", {
			mode_id: "fly",
			affordance_template_id: "srd/affordance/fly",
			bindings_json: '{"movement_reach_resource":"srd/speed-fly"}',
		});
		expect(manifest.movement_defaults).toHaveLength(3);
	});

	it("requires affordance_template_id", () => {
		const manifest = baseManifest();
		expect(() => patchManifest(manifest, "add-movement-default", {})).toThrow(
			/affordance_template_id/,
		);
	});

	it("a bundle-scoped default + a zero-row edge validates clean and needs no per-edge affordance row (A-1)", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-graph", {
			place_graph_id: `${BUNDLE_ID}/hamlet`,
			bundle_id: BUNDLE_ID,
			substrate_id: "outdoor",
			display_name: "Hamlet",
			anchor_node_id: `${BUNDLE_ID}/hamlet/square`,
		});
		patchManifest(manifest, "add-place-node", {
			node_id: `${BUNDLE_ID}/hamlet/square`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hamlet`,
			local_id: "square",
			substrate_id: "outdoor",
			display_name: "Square",
		});
		patchManifest(manifest, "add-place-node", {
			node_id: `${BUNDLE_ID}/hamlet/inn`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hamlet`,
			local_id: "inn",
			substrate_id: "outdoor",
			display_name: "Inn",
		});
		// Zero-row edge — no place_edge_affordance authored for it at all.
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/square-inn`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/hamlet`,
			from_node_id: `${BUNDLE_ID}/hamlet/square`,
			to_node_id: `${BUNDLE_ID}/hamlet/inn`,
		});
		patchManifest(manifest, "add-movement-default", {
			affordance_template_id: "core/affordance/traverse_open_portal",
		});

		const toml = renderSchemaManifestJson(JSON.stringify(manifest));
		expect(validateManifestToml(toml)).toEqual([]);
	});
});

describe("patchManifest — add-place-edge-affordance (#1696)", () => {
	it("upserts by the composite (edge_key, affordance_template_id) and never emits bundle_id", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			bundle_id: BUNDLE_ID, // must be ignored — PlaceEdgeAffordanceRow has no bundle_id
			affordance_template_id: "core/affordance/traverse_open_portal",
		});
		expect(manifest.place_edge_affordance).toEqual([
			{
				edge_key: `${BUNDLE_ID}/edge/entry-hall`,
				affordance_template_id: "core/affordance/traverse_open_portal",
			},
		]);

		// A second template on the SAME edge is a sibling row, not a replacement.
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			affordance_template_id: "core/affordance/peek_through",
		});
		expect(manifest.place_edge_affordance).toHaveLength(2);

		// Re-authoring the same (edge, template) pairing replaces its bindings.
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			affordance_template_id: "core/affordance/traverse_open_portal",
			bindings_json: '{"dc":15}',
		});
		expect(manifest.place_edge_affordance).toHaveLength(2);
		expect(manifest.place_edge_affordance).toContainEqual({
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			affordance_template_id: "core/affordance/traverse_open_portal",
			bindings_json: '{"dc":15}',
		});
	});

	it("requires edge_key and affordance_template_id; ignores malformed bindings_json", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-place-edge-affordance", {
				affordance_template_id: "core/affordance/traverse_open_portal",
			}),
		).toThrow(/edge_key/);
		expect(() =>
			patchManifest(manifest, "add-place-edge-affordance", {
				edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			}),
		).toThrow(/affordance_template_id/);
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			affordance_template_id: "core/affordance/traverse_open_portal",
			bindings_json: { dc: 15 },
		});
		const row = (manifest.place_edge_affordance as Record<string, unknown>[])[0]!;
		expect(row.bindings_json).toBeUndefined();
	});
});

describe("patchManifest — add-place-edge-affordance mode_id widening (ADR-0101 D-1/D-5)", () => {
	it("omits mode_id from the rendered row when absent — legacy rows stay byte-identical", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			affordance_template_id: "core/affordance/traverse_open_portal",
		});
		expect(manifest.place_edge_affordance).toEqual([
			{
				edge_key: `${BUNDLE_ID}/edge/entry-hall`,
				affordance_template_id: "core/affordance/traverse_open_portal",
			},
		]);
	});

	it("the SAME (edge_key, template) under two distinct modes are siblings, not an upsert-replace", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/chasm`,
			affordance_template_id: "srd/affordance/traverse",
			mode_id: "walk",
			bindings_json: '{"movement_reach_resource":"srd/speed-walk"}',
		});
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/chasm`,
			affordance_template_id: "srd/affordance/traverse",
			mode_id: "fly",
			bindings_json: '{"movement_reach_resource":"srd/speed-fly"}',
		});
		expect(manifest.place_edge_affordance).toHaveLength(2);
		expect(manifest.place_edge_affordance).toContainEqual({
			edge_key: `${BUNDLE_ID}/edge/chasm`,
			affordance_template_id: "srd/affordance/traverse",
			mode_id: "walk",
			bindings_json: '{"movement_reach_resource":"srd/speed-walk"}',
		});
		expect(manifest.place_edge_affordance).toContainEqual({
			edge_key: `${BUNDLE_ID}/edge/chasm`,
			affordance_template_id: "srd/affordance/traverse",
			mode_id: "fly",
			bindings_json: '{"movement_reach_resource":"srd/speed-fly"}',
		});
	});

	it("re-authoring the same (edge_key, template, mode_id) triple replaces bindings_json, not appends", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/ford`,
			affordance_template_id: "srd/affordance/swim",
			mode_id: "swim",
			bindings_json: '{"dc":10}',
		});
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/ford`,
			affordance_template_id: "srd/affordance/swim",
			mode_id: "swim",
			bindings_json: '{"dc":15}',
		});
		expect(manifest.place_edge_affordance).toHaveLength(1);
		expect((manifest.place_edge_affordance as Record<string, unknown>[])[0]!.bindings_json).toBe(
			'{"dc":15}',
		);
	});

	it("an empty mode_id in the payload is treated the SAME as an omitted one for upsert matching", () => {
		const manifest = baseManifest();
		// A legacy call with no mode_id at all...
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			affordance_template_id: "core/affordance/traverse_open_portal",
			bindings_json: '{"dc":10}',
		});
		// ...is replaced by a re-authoring that explicitly passes mode_id: "".
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/entry-hall`,
			affordance_template_id: "core/affordance/traverse_open_portal",
			mode_id: "",
			bindings_json: '{"dc":15}',
		});
		expect(manifest.place_edge_affordance).toHaveLength(1);
		const row = (manifest.place_edge_affordance as Record<string, unknown>[])[0]!;
		expect(row.bindings_json).toBe('{"dc":15}');
		expect(row.mode_id).toBeUndefined();
	});
});

describe("patchManifest — add-place-node-trace (#1696)", () => {
	it("upserts by the composite (node_id, trace_kind_id) and never emits bundle_id", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-node-trace", {
			node_id: `${BUNDLE_ID}/hall/entry`,
			bundle_id: BUNDLE_ID, // must be ignored — PlaceNodeTraceRow has no bundle_id
			trace_kind_id: "core/trace/footprints",
		});
		expect(manifest.place_node_traces).toEqual([
			{ node_id: `${BUNDLE_ID}/hall/entry`, trace_kind_id: "core/trace/footprints" },
		]);

		// A second trace kind on the SAME node is a sibling row (village/old_well precedent).
		patchManifest(manifest, "add-place-node-trace", {
			node_id: `${BUNDLE_ID}/hall/entry`,
			trace_kind_id: "core/trace/scent",
		});
		expect(manifest.place_node_traces).toHaveLength(2);

		// Re-authoring the same pairing stays one row.
		patchManifest(manifest, "add-place-node-trace", {
			node_id: `${BUNDLE_ID}/hall/entry`,
			trace_kind_id: "core/trace/footprints",
		});
		expect(manifest.place_node_traces).toHaveLength(2);
	});

	it("requires node_id and trace_kind_id", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-place-node-trace", {
				trace_kind_id: "core/trace/footprints",
			}),
		).toThrow(/node_id/);
		expect(() =>
			patchManifest(manifest, "add-place-node-trace", {
				node_id: `${BUNDLE_ID}/hall/entry`,
			}),
		).toThrow(/trace_kind_id/);
	});
});

describe("patchManifest — place-graph ops render + validate round trip (#1578)", () => {
	it("a graph + 2 nodes + 1 edge authored purely via patch ops renders and validates clean", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-place-graph", {
			place_graph_id: `${BUNDLE_ID}/courtyard`,
			bundle_id: BUNDLE_ID,
			substrate_id: "outdoor",
			display_name: "Courtyard",
			anchor_node_id: `${BUNDLE_ID}/courtyard/gate`,
		});
		patchManifest(manifest, "add-place-node", {
			node_id: `${BUNDLE_ID}/courtyard/gate`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/courtyard`,
			local_id: "gate",
			substrate_id: "outdoor",
			display_name: "Gate",
		});
		patchManifest(manifest, "add-place-node", {
			node_id: `${BUNDLE_ID}/courtyard/well`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/courtyard`,
			local_id: "well",
			substrate_id: "outdoor",
			display_name: "Well",
			pos_x: 2,
			pos_y: 2,
			pos_present: true,
		});
		patchManifest(manifest, "add-place-edge", {
			edge_key: `${BUNDLE_ID}/edge/gate-well`,
			bundle_id: BUNDLE_ID,
			place_graph_id: `${BUNDLE_ID}/courtyard`,
			from_node_id: `${BUNDLE_ID}/courtyard/gate`,
			to_node_id: `${BUNDLE_ID}/courtyard/well`,
		});
		// #1696 siblings: the edge's traverse affordance + a node trace ride the
		// same round trip (place_node_traces.node_id is FK-checked in-manifest,
		// so the gate node above is load-bearing for this row).
		patchManifest(manifest, "add-place-edge-affordance", {
			edge_key: `${BUNDLE_ID}/edge/gate-well`,
			affordance_template_id: "core/affordance/traverse_open_portal",
		});
		patchManifest(manifest, "add-place-node-trace", {
			node_id: `${BUNDLE_ID}/courtyard/gate`,
			trace_kind_id: "core/trace/footprints",
		});
		// sk-9ll.8: place_node_traces.trace_kind_id is now FK-checked in-manifest
		// too (MF-VAL-319) — this round trip's own trace kind needs a matching
		// trace_kind_definitions row (patchManifest has no "add-trace-kind" op;
		// pushed directly, mirroring how `baseManifest()` seeds `bundles`).
		(manifest.trace_kind_definitions as Record<string, unknown>[]) = [
			{
				kind_id: "core/trace/footprints",
				bundle_id: BUNDLE_ID,
				location_kinds: "place_node",
			},
		];

		const toml = renderSchemaManifestJson(JSON.stringify(manifest));
		expect(validateManifestToml(toml)).toEqual([]);
	});
});
