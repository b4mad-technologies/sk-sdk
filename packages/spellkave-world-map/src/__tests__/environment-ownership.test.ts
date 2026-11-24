// A world's environment states (open, locked, flooded) can come both from the
// adventure bundle and from a live override; the map must show only the value
// that wins, whichever row the world lists first. Pure rows, no node.
// keep-file(K3): order independence of the dedupe; the scenarios feed one row per state
import { describe, expect, it } from "vitest";
import { normalizeWorldOsmInput } from "../rows";

describe("map environment ownership", () => {
	it("keeps only the effective node and edge values", () => {
		const row = {
			bundle_id: "adventure",
			state_id: "open",
			state_row_id: 2,
			updated_tick: 99,
			cell_res4: 100,
			value: false,
		};
		const node = { ...row, place_node_id: "world/root" };
		const edge = { ...row, edge_id: 7 };
		const nodeOverride = {
			...node,
			bundle_id: "",
			state_row_id: 1,
			updated_tick: 0,
			cell_res4: 200,
			value: true,
		};
		const edgeOverride = {
			...edge,
			bundle_id: "",
			state_row_id: 1,
			updated_tick: 0,
			cell_res4: 200,
			value: true,
		};
		for (const reverse of [false, true]) {
			const nodes = [nodeOverride, node],
				edges = [edgeOverride, edge];
			if (reverse) {
				nodes.reverse();
				edges.reverse();
			}
			const result = normalizeWorldOsmInput({
				spatial_environment_states: nodes,
				edge_states: edges,
			});
			expect(result.node_states).toHaveLength(1);
			expect(result.edge_states).toHaveLength(1);
			expect(result.node_states[0]?.value).toBe(true);
			expect(result.edge_states[0]?.value).toBe(true);
		}
	});
});
