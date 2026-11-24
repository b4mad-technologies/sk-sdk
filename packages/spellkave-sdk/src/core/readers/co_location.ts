// Reader: actor co-location snapshot — the two place-node values a perceiver
// occupies in the spatial vs. the entity track. The co-evolution Verifier
// (packages/world-explorer) compares these BEFORE trusting any affordance/
// perception query, because the round-13 #655 false-negative slipped in when
// the perceiver's `actor_spatial_location` (market_lane) diverged from its
// `entity_location`. This reader only READS both rows; it does NOT judge — the
// divergence verdict is the Verifier's pure `assertCoLocation` (SDK CLAUDE.md §1:
// no runtime state-dependent decision in the SDK).

import type { ActorSpatialLocationRow, EntityLocationRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { resolveEntityId, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"visible_actor_spatial_location",
		"visible_entity_location",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
	]
> = [
	"visible_actor_spatial_location",
	"visible_entity_location",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
];
registerReaderManifest({ requiredTables });

/**
 * The two place-node ids a perceiver is recorded at. `null` for either track
 * means no row exists there for the entity (which `assertCoLocation` treats as
 * a divergence, never as a silent match).
 */
export interface ActorCoLocation {
	/** The entity id this snapshot is for (resolved from the ref). */
	entity_id: string;
	/** `actor_spatial_location.placeNodeId`, or `null` if no row. */
	actor_spatial_location: string | null;
	/** `entity_location.placeNodeId`, or `null` if no row. */
	entity_location: string | null;
}

/**
 * Read the perceiver's co-location across both tracks. Returns `null` only when
 * the ref does not resolve to an entity id at all; an existing entity with no
 * row in one track yields that track as `null` (a divergence the Verifier
 * withholds on). Accepts the same ref forms as the other perceive readers
 * (numeric, `entity:N`, or a manifest authored-entity key).
 */
export function readActorCoLocation(db: SnapshotDb, entityRef: EntityRef): ActorCoLocation | null {
	const entityId = resolveEntityId(db, entityRef);
	if (entityId === undefined) return null;

	const spatial = rows<ActorSpatialLocationRow>(db, "visible_actor_spatial_location").find(
		(r) => String(r.entityId) === String(entityId),
	);
	const entity = rows<EntityLocationRow>(db, "visible_entity_location").find(
		(r) => String(r.entityId) === String(entityId),
	);

	return {
		entity_id: String(entityId),
		actor_spatial_location: spatial ? String(spatial.placeNodeId) : null,
		entity_location: entity ? String(entity.placeNodeId) : null,
	};
}
