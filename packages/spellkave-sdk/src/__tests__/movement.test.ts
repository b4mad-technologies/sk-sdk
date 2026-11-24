import { describe, expect, it } from "vitest";
import type { ResolvedActor } from "../core/actor";
import { asEntityId } from "../core/ids";
import {
	type LiveMovementReader,
	listAdjacentMoves,
	type PlaceEdgeRow,
	type PlaceNodeRow,
	validateMove,
} from "../core/movement";

function reader(edges: PlaceEdgeRow[], nodes: PlaceNodeRow[]): LiveMovementReader {
	return {
		edges: () => edges,
		nodes: () => nodes,
	};
}

const SCOUT: ResolvedActor = {
	body_entity_id: asEntityId("scout-01"),
	current_node_id: "tavern",
};
const SCOUT_NOWHERE: ResolvedActor = {
	body_entity_id: asEntityId("scout-01"),
	current_node_id: undefined,
};

describe("validateMove", () => {
	it("returns the concrete r_move call for an adjacent edge", () => {
		const call = validateMove(
			SCOUT,
			"tavern-to-square",
			reader(
				[
					{
						edge_id: "tavern-to-square",
						from_node_id: "tavern",
						to_node_id: "square",
					},
				],
				[{ node_id: "square" }],
			),
		);
		expect(call).toEqual({
			actor_id: "scout-01",
			from_node: "tavern",
			to_node: "square",
			edge_id: "tavern-to-square",
		});
	});

	it("rejects an empty edge_id", () => {
		expect(() => validateMove(SCOUT, "  ", reader([], []))).toThrow(/empty/);
	});

	it("rejects a stale edge that no longer exists", () => {
		expect(() => validateMove(SCOUT, "ghost-edge", reader([], []))).toThrow(/not found/);
	});

	it("rejects an edge that is not adjacent to the actor's current node", () => {
		expect(() =>
			validateMove(
				SCOUT,
				"elsewhere",
				reader(
					[
						{
							edge_id: "elsewhere",
							from_node_id: "forest",
							to_node_id: "river",
						},
					],
					[{ node_id: "river" }],
				),
			),
		).toThrow(/not adjacent/);
	});

	it("rejects a one-way edge traversed against direction", () => {
		// `place_edge` rows have no `bidirectional` column in the schema; every
		// edge is treated one-way (from → to). A reverse traversal is stale by
		// construction.
		expect(() =>
			validateMove(
				SCOUT,
				"one-way",
				reader(
					[
						{
							edge_id: "one-way",
							from_node_id: "square",
							to_node_id: "tavern",
						},
					],
					[{ node_id: "square" }],
				),
			),
		).toThrow(/not adjacent/);
	});

	it("rejects when destination node is missing from live state", () => {
		expect(() =>
			validateMove(
				SCOUT,
				"tavern-to-square",
				reader(
					[
						{
							edge_id: "tavern-to-square",
							from_node_id: "tavern",
							to_node_id: "square",
						},
					],
					[], // no nodes — destination missing
				),
			),
		).toThrow(/destination node/);
	});

	it("rejects when actor has no current node", () => {
		expect(() => validateMove(SCOUT_NOWHERE, "any", reader([], []))).toThrow(
			/no current place node/,
		);
	});
});

describe("listAdjacentMoves", () => {
	it("enumerates outgoing edges only", () => {
		const out = listAdjacentMoves(
			SCOUT,
			reader(
				[
					{ edge_id: "a", from_node_id: "tavern", to_node_id: "square" },
					{ edge_id: "b", from_node_id: "forest", to_node_id: "tavern" },
				],
				[],
			),
		);
		expect(out).toEqual([{ edge_id: "a", to_node: "square" }]);
	});

	it("returns [] when actor has no current node", () => {
		expect(listAdjacentMoves(SCOUT_NOWHERE, reader([], []))).toEqual([]);
	});
});
