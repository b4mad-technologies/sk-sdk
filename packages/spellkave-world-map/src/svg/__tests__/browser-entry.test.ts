// The maps app in the browser imports the SVG-only entry; agents and the CLI
// import the full view. Both must draw the very same SVG for the same rows.
// Pure functions, no DOM.
// keep-file(K4): byte-equality between two entry points, a drift check
import { describe, expect, it } from "vitest";
import {
	buildSpatialGraphSvgView,
	buildSpatialGraphView,
	renderSpatialGraphSvg,
	svgNodeIds,
} from "../index.ts";
import { layoutSpatialGraph } from "../layout.ts";
import { buildSpatialGraphModel, pickDefaultSlice } from "../model.ts";
import type { SpatialGraphToolRows } from "../types.ts";

const demoRows: SpatialGraphToolRows = {
	place_graphs: [
		{
			place_graph_id: "demo/graph",
			display_name: "Demo",
			substrate_id: "indoor",
			metres_per_unit: 1,
			parent_graph_id: "",
			is_ephemeral_instance: false,
		},
	],
	place_nodes: [
		{
			node_id: "demo/graph/a",
			place_graph_id: "demo/graph",
			display_name: "A",
			pos_present: true,
			pos_x: 0,
			pos_y: 0,
			pose_elevation: 0,
			pose_elevation_present: true,
			substrate_id: "indoor",
		},
		{
			node_id: "demo/graph/b",
			place_graph_id: "demo/graph",
			display_name: "B",
			pos_present: true,
			pos_x: 4,
			pos_y: 0,
			pose_elevation: 0,
			pose_elevation_present: true,
			substrate_id: "indoor",
		},
	],
	place_edges: [
		{
			from_node_id: "demo/graph/a",
			to_node_id: "demo/graph/b",
			place_graph_id: "demo/graph",
		},
	],
};

describe("spatial-graph browser entry", () => {
	it("buildSpatialGraphSvgView SVG matches index buildSpatialGraphView renderOnly:svg", () => {
		const fromBrowser = buildSpatialGraphSvgView(demoRows, { graphId: "demo/graph" });
		const fromIndex = buildSpatialGraphView(demoRows, {
			graphId: "demo/graph",
			renderOnly: ["svg"],
		});
		expect(fromBrowser.svg).not.toBeNull();
		expect(fromIndex.svg).not.toBeNull();
		expect(fromBrowser.svg).toBe(fromIndex.svg);
		expect(svgNodeIds(fromBrowser.svg ?? "")).toEqual(["demo/graph/a", "demo/graph/b"]);
	});

	it("renderSpatialGraphSvg via browser export matches direct model→layout path with same caption", () => {
		const model = buildSpatialGraphModel(demoRows, { graphId: "demo/graph" });
		const sliceMode = pickDefaultSlice(model.nodes, { graphId: "demo/graph" });
		const layout = layoutSpatialGraph(model, { graphId: "demo/graph", sliceMode });
		const direct = renderSpatialGraphSvg(model, layout, {
			sliceCaption: model.sliceLabel,
			hideOccupancy: false,
		});
		const viaView = buildSpatialGraphSvgView(demoRows, { graphId: "demo/graph" }).svg;
		expect(viaView).toBe(direct);
	});
});
