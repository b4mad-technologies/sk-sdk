// Movement-tool validation against a live snapshot.
//
// The LLM-callable `spellkave_move` tool accepts ONLY an adjacent move
// identifier (`edge_id`). It does NOT accept arbitrary actor_id, source
// node, or placement parameters. Source and destination are derived from
// the live snapshot here; if anything has gone stale between the LLM
// reading widget context and the tool firing, validation rejects the
// move BEFORE invoking `r_move`. We never call `actor_spatial_location_set`
// as a fallback — that path is reserved for authoring/placement, not
// gameplay.

import type { ResolvedActor } from "./actor";

export interface PlaceEdgeRow {
	/** Stringified `edge_id`. The generated table column is `u64`, but
	 * `r_move` accepts a string `edgeId` in its reducer schema. We carry the
	 * stringified form throughout so widget rendering, LLM tool input, and
	 * reducer invocation all share one identifier shape. */
	edge_id: string;
	from_node_id: string;
	to_node_id: string;
}

export interface PlaceNodeRow {
	node_id: string;
}

export interface LiveMovementReader {
	edges(): Iterable<PlaceEdgeRow>;
	nodes(): Iterable<PlaceNodeRow>;
}

export interface MoveCall {
	actor_id: string;
	from_node: string;
	to_node: string;
	edge_id: string;
}

/**
 * Validate an LLM-supplied edge against the actor's current location and
 * the live edge/node graph. Returns the concrete `r_move` call, or throws
 * with a structured message that the tool reports back to the LLM.
 */
export function validateMove(
	actor: ResolvedActor,
	edgeId: string,
	reader: LiveMovementReader,
): MoveCall {
	if (edgeId.trim().length === 0) {
		throw new Error("edge_id is empty");
	}
	if (actor.current_node_id === undefined) {
		throw new Error(
			`actor '${actor.body_entity_id}' has no current place node; movement requires a starting node`,
		);
	}
	let edge: PlaceEdgeRow | undefined;
	for (const e of reader.edges()) {
		if (e.edge_id === edgeId) {
			edge = e;
			break;
		}
	}
	if (edge === undefined) {
		throw new Error(`edge '${edgeId}' not found in live world state`);
	}
	const from = actor.current_node_id;
	if (edge.from_node_id !== from) {
		throw new Error(
			`edge '${edgeId}' is not adjacent to actor's current node '${from}' (edge runs ${edge.from_node_id} → ${edge.to_node_id})`,
		);
	}
	const to = edge.to_node_id;
	// Confirm destination node still exists in the live snapshot.
	let destOk = false;
	for (const n of reader.nodes()) {
		if (n.node_id === to) {
			destOk = true;
			break;
		}
	}
	if (!destOk) {
		throw new Error(`destination node '${to}' not found in live world state`);
	}
	return {
		actor_id: actor.body_entity_id,
		from_node: from,
		to_node: to,
		edge_id: edgeId,
	};
}

/**
 * Enumerate adjacent moves for the active actor. The widget displays this
 * read-only context so the LLM can pick a valid `edge_id` to feed the tool.
 */
export function listAdjacentMoves(
	actor: ResolvedActor,
	reader: LiveMovementReader,
): Array<{ edge_id: string; to_node: string }> {
	if (actor.current_node_id === undefined) return [];
	const from = actor.current_node_id;
	const out: Array<{ edge_id: string; to_node: string }> = [];
	for (const e of reader.edges()) {
		if (e.from_node_id === from) {
			out.push({ edge_id: e.edge_id, to_node: e.to_node_id });
		}
	}
	return out;
}
