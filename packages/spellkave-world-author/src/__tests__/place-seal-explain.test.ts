import { describe, expect, it } from "vitest";
import { explainVocabularyWith, type VocabularyLookup } from "../explain-core";

const lookup: VocabularyLookup = (kind) =>
	({
		place_graphs: [
			{ place_graph_id: "root", parent_graph_id: "" },
			{ place_graph_id: "child", parent_graph_id: "root" },
		],
		place_nodes: [{ node_id: "landing", place_graph_id: "child" }],
		place_seals: [{ place_graph_id: "root" }],
	})[kind] ?? [];
describe("place seal explanations", () => {
	it("names the sealing ancestor for a destination node", () => {
		expect(explainVocabularyWith("place", "landing", "files", lookup, () => [])).toMatchObject({
			ok: true,
			seal_state: "sealed",
			sealing_graph: "root",
		});
	});
	it("leaves private live policy to the server", () => {
		expect(explainVocabularyWith("place", "child", "live", lookup, () => [])).toMatchObject({
			ok: true,
			seal_state: "server decides",
		});
	});
	it("fails closed on a dangling sealed ancestry", () => {
		const dangling: VocabularyLookup = (kind) =>
			kind === "place_graphs"
				? [{ place_graph_id: "child", parent_graph_id: "missing" }]
				: lookup(kind);
		expect(explainVocabularyWith("place", "child", "files", dangling, () => [])).toMatchObject({
			ok: true,
			seal_state: "seal_unknown",
			sealing_graph: "missing",
		});
	});
});
