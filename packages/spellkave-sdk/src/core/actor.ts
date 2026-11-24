// Actor body-entity resolution from `profile.identity.in_world_self`.
//
// The shared SDK accepts an exact runtime `entity_id` or an exact authored
// manifest alias. It never performs nickname, role, or fuzzy lookup.
//
// World-model note: the server has no monolithic `actor` table — actors are
// component-shaped. For the first-slice movement loop, an actor exists in
// gameplay terms iff it has a row in `actor_spatial_location` (which both
// asserts presence and pins the current place node, since `r_move` requires
// a from-node). If no such row matches, we fail closed.
//
// `LiveActorReader` is a one-method seam so the live SpacetimeDB SDK and
// unit tests can both feed it.

import { asEntityId, type EntityId } from "./ids";
import { parseEntityIdRef } from "./readers/_helpers";

export interface ActorSpatialLocationRow {
	entity_id: EntityId;
	aliases?: string[];
	/** Current place node id. The generated table makes this non-nullable, but
	 * we accept undefined/empty defensively (e.g. mid-tick where a row could
	 * carry an empty string until the next reducer settles). */
	node_id?: string;
}

export interface LiveActorReader {
	/** All `actor_spatial_location` rows currently in the SDK cache. */
	locations(): Iterable<ActorSpatialLocationRow>;
}

export interface ResolvedActor {
	/** Body entity id from `actor_spatial_location.entity_id` — not `Actor.actor_id`. */
	body_entity_id: EntityId;
	/** Always defined for a successfully resolved actor — `r_move` requires
	 * a from-node, and presence in `actor_spatial_location` is what defines
	 * "exists" for this slice. May still be reported as undefined to callers
	 * if the row's `node_id` is empty, in which case movement validation
	 * fails closed at the next layer. */
	current_node_id: string | undefined;
}

/**
 * Resolve the active actor by looking up the configured `in_world_self` in
 * the live `actor_spatial_location` cache. Throws when no row matches —
 * never invents a fallback actor, never substitutes a sibling, never calls
 * an authoring/placement reducer.
 */
export function resolveActor(inWorldSelf: string, reader: LiveActorReader): ResolvedActor {
	if (inWorldSelf.trim().length === 0) {
		throw new Error("profile identity.in_world_self is empty");
	}
	const wanted = parseEntityIdRef(inWorldSelf);
	for (const loc of reader.locations()) {
		const entityId = parseEntityIdRef(loc.entity_id);
		if (entityId !== undefined && (entityId === wanted || loc.aliases?.includes(inWorldSelf))) {
			const nodeId = loc.node_id && loc.node_id.length > 0 ? loc.node_id : undefined;
			return { body_entity_id: asEntityId(String(entityId)), current_node_id: nodeId };
		}
	}
	throw new Error(`actor '${inWorldSelf}' not found in live actor_spatial_location — fail closed`);
}
