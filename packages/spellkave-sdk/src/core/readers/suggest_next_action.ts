// Reader: suggested next action — deterministic movement hint from live state.
// Direct action attempts are intentionally not pre-composed here: clients use
// actor-scoped factual context and let the reducer admit each typed attempt.

import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { readActorSnapshot } from "./actor_snapshot";
import { readLocationSnapshot } from "./location_snapshot";

export const requiredTables: RequiredTables<
	[
		"visible_actor_spatial_location",
		"visible_target_condition",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"visible_place_node",
		"visible_place_edge",
		"place_edge_affordance",
		"visible_place_graph_definition",
		// Read transitively via readActorSnapshot, which now surfaces the actor's own
		// object-state pools enriched with definitions + tags (#1229).
		"owned_object_state",
		"resource_definition",
		"resource_definition_tag",
		// Read transitively via readActorSnapshot.
		"entity",
		"visible_entity_tag",
		"visible_entity_tag_coverage",
	]
> = [
	"visible_actor_spatial_location",
	"visible_target_condition",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"visible_place_node",
	"visible_place_edge",
	"place_edge_affordance",
	"visible_place_graph_definition",
	"owned_object_state",
	"resource_definition",
	"resource_definition_tag",
	"entity",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
];
registerReaderManifest({ requiredTables });

export type SuggestedNextAction = { kind: "move"; edge_id: string; to_node_id: string };

/**
 * Deterministic read-first suggestion. DOES NOT submit a reducer. Callers approve+invoke.
 *
 * Priority: first outgoing edge from the actor's current node (alphabetical
 * edge id), or null when there is none.
 */
export function suggestNextAction(
	db: SnapshotDb,
	perceiverEntityId: EntityRef,
): SuggestedNextAction | null {
	const actor = readActorSnapshot(db, perceiverEntityId);
	if (actor === null || actor.current_node_id === undefined) return null;
	const loc = readLocationSnapshot(db, actor.current_node_id);
	if (loc === null || loc.outgoing_edges.length === 0) return null;
	const sortedEdges = loc.outgoing_edges.slice().sort((a, b) => a.edge_id.localeCompare(b.edge_id));
	const first = sortedEdges[0];
	if (first === undefined) return null;
	return { kind: "move", edge_id: first.edge_id, to_node_id: first.to_node_id };
}
