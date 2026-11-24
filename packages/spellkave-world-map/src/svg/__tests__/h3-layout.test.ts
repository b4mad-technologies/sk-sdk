// An outdoor world map places each graph on its H3 cell and nests inner graphs
// at their portal, with the same clockwise bearing the server uses (ADR-0029).
// Pure functions over tool-shaped rows.
// keep-file(K1): rule cases of the pure H3 layout; the CLI renders no SVG
import { describe, expect, it } from "vitest";

import {
	cellRes10ToHex,
	layoutOutdoorWorldByComposition,
	shouldUseH3WorldLayout,
} from "../h3-layout.ts";
import { buildSpatialGraphView, projectLocalPosition } from "../index.ts";
import type { SpatialGraphMeta, SpatialGraphNode } from "../types.ts";

const ORIGIN = "622215095455350783";
const N1 = "622215095455547391";

describe("h3-layout + ADR-0029 composition", () => {
	it("parses decimal cell strings", () => {
		expect(cellRes10ToHex(ORIGIN)).toMatch(/^[0-9a-f]+$/);
		expect(cellRes10ToHex("0")).toBeNull();
	});

	it("projectLocalPosition matches server clockwise bearing contract", () => {
		// bearing 90°, scale 2: (1,0) → east 0, north -2
		const a = projectLocalPosition({ bearing_deg: 90, scale: 2 }, 1, 0);
		expect(a.east_m).toBeCloseTo(0, 6);
		expect(a.north_m).toBeCloseTo(-2, 6);
	});

	it("nests hamlet into region at portal and emits hex footprints", () => {
		const nodes: SpatialGraphNode[] = [
			{
				id: "region/crossroads",
				label: "Crossroads",
				graphId: "region",
				x: 0,
				y: 0,
				elevation: 0,
				elevationPresent: true,
				substrateId: "outdoor",
				cellRes10Hex: cellRes10ToHex(ORIGIN),
			},
			{
				id: "region/road_south",
				label: "South",
				graphId: "region",
				x: 0,
				y: 4,
				elevation: 0,
				elevationPresent: true,
				substrateId: "outdoor",
				cellRes10Hex: cellRes10ToHex(N1),
			},
			{
				id: "hamlet/gate",
				label: "Gate",
				graphId: "hamlet",
				x: 0,
				y: 0,
				elevation: 0,
				elevationPresent: true,
				substrateId: "outdoor",
				cellRes10Hex: cellRes10ToHex(N1),
			},
			{
				id: "hamlet/square",
				label: "Square",
				graphId: "hamlet",
				x: 3,
				y: 0,
				elevation: 0,
				elevationPresent: true,
				substrateId: "outdoor",
				cellRes10Hex: cellRes10ToHex(N1),
			},
		];
		const graphs: SpatialGraphMeta[] = [
			{
				graphId: "region",
				metresPerUnit: 1.524,
				substrateId: "outdoor",
				displayName: "Region",
				parentGraphId: "",
				originCellRes10Hex: cellRes10ToHex(ORIGIN),
				bearing: 0,
				anchorNodeId: "region/crossroads",
			},
			{
				graphId: "hamlet",
				metresPerUnit: 1.524,
				substrateId: "outdoor",
				displayName: "Hamlet",
				parentGraphId: "region",
				originCellRes10Hex: null,
				bearing: 0,
				anchorNodeId: "hamlet/gate",
			},
		];
		const edges = [
			{ from: "region/road_south", to: "hamlet/gate", graphId: "" },
			{ from: "hamlet/gate", to: "hamlet/square", graphId: "hamlet" },
		];
		const result = layoutOutdoorWorldByComposition(nodes, edges, graphs);
		if (result === null) throw new Error("layoutOutdoorWorldByComposition returned null");
		expect(result.usedComposition).toBe(true);
		expect(result.nodes.length).toBe(4);
		expect(result.hexes.length).toBeGreaterThanOrEqual(1);
		const byId = (id: string) => {
			const node = result.nodes.find((n) => n.id === id);
			if (node === undefined) throw new Error(`node ${id} missing from layout`);
			return node;
		};
		// Gate sits at road_south nest (same world after compose with gate local 0,0)
		const south = byId("region/road_south");
		const gate = byId("hamlet/gate");
		expect(gate.x).toBeCloseTo(south.x, 5);
		expect(gate.y).toBeCloseTo(south.y, 5);
		// Square is offset from gate along +x in parent frame
		const square = byId("hamlet/square");
		expect(Math.hypot(square.x - gate.x, square.y - gate.y)).toBeGreaterThan(1);
	});

	it("buildSpatialGraphView outdoor compose uses h3_world with hexes", () => {
		const view = buildSpatialGraphView(
			{
				place_graphs: [
					{
						place_graph_id: "region",
						substrate_id: "outdoor",
						metres_per_unit: 1.524,
						bearing: 0,
						display_name: "Region",
						origin_cell_res10: ORIGIN,
						parent_graph_id: "",
						anchor_node_id: "region/crossroads",
					},
					{
						place_graph_id: "hamlet",
						substrate_id: "outdoor",
						metres_per_unit: 1.524,
						bearing: 0,
						display_name: "Hamlet",
						parent_graph_id: "region",
						origin_cell_res10: 0,
						anchor_node_id: "hamlet/gate",
					},
				],
				place_nodes: [
					{
						node_id: "region/crossroads",
						place_graph_id: "region",
						display_name: "Crossroads",
						substrate_id: "outdoor",
						pos_x: 0,
						pos_y: 0,
						pos_present: true,
						cell_res10: ORIGIN,
					},
					{
						node_id: "region/road_south",
						place_graph_id: "region",
						display_name: "South",
						substrate_id: "outdoor",
						pos_x: 0,
						pos_y: 4,
						pos_present: true,
						cell_res10: N1,
					},
					{
						node_id: "hamlet/gate",
						place_graph_id: "hamlet",
						display_name: "Gate",
						substrate_id: "outdoor",
						pos_x: 0,
						pos_y: 0,
						pos_present: true,
						cell_res10: N1,
					},
					{
						node_id: "hamlet/square",
						place_graph_id: "hamlet",
						display_name: "Square",
						substrate_id: "outdoor",
						pos_x: 5,
						pos_y: 0,
						pos_present: true,
						cell_res10: N1,
					},
				],
				place_edges: [
					{
						from_node_id: "region/road_south",
						to_node_id: "hamlet/gate",
						place_graph_id: "",
					},
					{
						from_node_id: "hamlet/gate",
						to_node_id: "hamlet/square",
						place_graph_id: "hamlet",
					},
				],
			},
			{ preferH3World: true, slice: "h3_world", terminal: "ascii", width: 48, height: 20 },
		);
		expect(view.hasLayout).toBe(true);
		expect(view.model.sliceLabel).toContain("h3");
		expect(view.svg).toContain("h3-cell");
		expect(view.model.nodes.length).toBe(4);
	});

	it("shouldUseH3WorldLayout prefers root origin", () => {
		const nodes: SpatialGraphNode[] = [
			{
				id: "a",
				label: "a",
				graphId: "region",
				x: 0,
				y: 0,
				elevation: 0,
				elevationPresent: false,
				substrateId: "outdoor",
			},
			{
				id: "b",
				label: "b",
				graphId: "hamlet",
				x: 1,
				y: 0,
				elevation: 0,
				elevationPresent: false,
				substrateId: "outdoor",
			},
		];
		expect(
			shouldUseH3WorldLayout(false, nodes, new Map(), [
				{
					graphId: "region",
					metresPerUnit: 1,
					substrateId: "outdoor",
					displayName: null,
					originCellRes10Hex: cellRes10ToHex(ORIGIN),
					parentGraphId: "",
				},
			]),
		).toBe(true);
	});
});
