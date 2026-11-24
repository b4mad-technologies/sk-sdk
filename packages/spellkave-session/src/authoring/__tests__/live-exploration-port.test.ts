import { describe, expect, it } from "vitest";
import { explorationCoverageFromScoped, keepVisiblePlaceLinks } from "../live-exploration-port";

describe("WE-06 scoped reader coverage codes leak nothing about inaccessible rows", () => {
	it.each([
		"complete",
		"masked",
		"outside_read_scope",
	])("retains the same fixed authored projection limit for '%s', without forwarding the code", (status) => {
		expect(explorationCoverageFromScoped("entities", status, true)).toEqual({
			family: "entities",
			state: "incomplete",
			reason: "authored_entities_only",
		});
	});
	it("keeps the examined-row bound and unknown codes incomplete with fixed reasons", () => {
		expect(explorationCoverageFromScoped("entities", "incomplete", true)).toEqual({
			family: "entities",
			state: "incomplete",
			reason: "examined_row_bound",
		});
		for (const status of [undefined, "reader_unavailable", "something_new"])
			expect(explorationCoverageFromScoped("entities", status, true)).toEqual({
				family: "entities",
				state: "incomplete",
				reason: "reader_unavailable",
			});
	});
	it("WE-07 never reads a caller without any scope as complete, whatever code the server sends", () => {
		for (const status of ["complete", "masked", "outside_read_scope", "incomplete"])
			expect(explorationCoverageFromScoped("entities", status, false)).toEqual({
				family: "entities",
				state: "incomplete",
				reason: "reader_unavailable",
			});
	});
});

describe("WE-06 public place links never name a hidden graph or edge", () => {
	it("keeps bundle-wide defaults and rows on visible places, drops the rest", () => {
		const manifest: Record<string, unknown> = {
			place_graphs: [{ place_graph_id: "b/forest" }],
			place_edges: [{ edge_key: "b/forest/root->b/forest/clearing" }],
			movement_defaults: [
				{ place_graph_id: "", affordance_template_id: "b/step" },
				{ place_graph_id: "b/forest", affordance_template_id: "b/step" },
				{ place_graph_id: "b/village", affordance_template_id: "b/step" },
				{ affordance_template_id: "b/step" },
			],
			place_edge_affordance: [
				{ edge_key: "b/forest/root->b/forest/clearing", affordance_template_id: "b/step" },
				{ edge_key: "b/village/root->b/village/crypt", affordance_template_id: "b/step" },
			],
		};
		keepVisiblePlaceLinks(manifest);
		expect(manifest.movement_defaults).toEqual([
			{ place_graph_id: "", affordance_template_id: "b/step" },
			{ place_graph_id: "b/forest", affordance_template_id: "b/step" },
		]);
		expect(manifest.place_edge_affordance).toEqual([
			{ edge_key: "b/forest/root->b/forest/clearing", affordance_template_id: "b/step" },
		]);
		expect(JSON.stringify(manifest)).not.toContain("village/root->");
	});
});
