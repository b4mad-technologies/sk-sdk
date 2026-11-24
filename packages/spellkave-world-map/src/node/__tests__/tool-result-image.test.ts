// Agent hosts (sk, pi) show a spatial-graph tool result as a picture: the
// tool result gains one PNG image block, keeps the SVG and inventory in its
// details, and adding it twice changes nothing. Renders with resvg; no node.
// keep-file(K5): the tool-result shape is a contract with the agent hosts, which this suite does not drive
import { describe, expect, it } from "vitest";
import { buildSpatialGraphView } from "../../svg/index.ts";
import { attachSpatialGraphImageToToolResult } from "../index.ts";

const rows = {
	place_nodes: [
		{
			node_id: "g/a",
			place_graph_id: "g",
			display_name: "A",
			substrate_id: "outdoor",
			pos_present: true,
			pos_x: 0,
			pos_y: 0,
		},
		{
			node_id: "g/b",
			place_graph_id: "g",
			display_name: "B",
			substrate_id: "outdoor",
			pos_present: true,
			pos_x: 5,
			pos_y: 0,
		},
	],
	place_edges: [{ from_node_id: "g/a", to_node_id: "g/b", place_graph_id: "g" }],
};

describe("attachSpatialGraphImageToToolResult", () => {
	it("appends PNG ImageContent and keeps svg in details for sk hosts", async () => {
		const view = buildSpatialGraphView(rows);
		expect(view.svg).toBeTruthy();
		const result = await attachSpatialGraphImageToToolResult({
			content: [{ type: "text", text: "hello" }],
			details: {
				places: view.model.nodes.length,
				svg: view.svg,
				inventory: view.inventory,
			},
		});
		expect(result.content.some((b) => b.type === "image")).toBe(true);
		const image = result.content.find((b) => b.type === "image") as
			| { type: "image"; data?: string; mimeType?: string }
			| undefined;
		expect(image?.mimeType).toBe("image/png");
		expect(image?.data?.length).toBeGreaterThan(100);
		expect((result.details as { svg?: string }).svg).toBe(view.svg);
		expect((result.details as { inventory: string }).inventory).toMatch(/NODES/i);
	});

	it("no-ops when details have no svg", async () => {
		const result = await attachSpatialGraphImageToToolResult({
			content: [{ type: "text", text: "x" }],
			details: { places: 0 },
		});
		expect(result.content).toEqual([{ type: "text", text: "x" }]);
	});

	it("is idempotent when an image block is already present", async () => {
		const view = buildSpatialGraphView(rows);
		const first = await attachSpatialGraphImageToToolResult({
			content: [{ type: "text", text: "hello" }],
			details: { svg: view.svg, inventory: view.inventory },
		});
		const second = await attachSpatialGraphImageToToolResult(first);
		expect(second.content.filter((b) => b.type === "image")).toHaveLength(1);
		expect(second).toBe(first);
	});
});
