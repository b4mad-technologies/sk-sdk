// Reader: entity containment (post Phase 2 entity-unification, Item 3).
//
// `entity_containment` replaces the dissolved `entity_inventory` table.
// Each row records that an entity (`entity_id`) is held inside a container
// entity (`container_id`). Items in an actor's loose inventory have an empty
// `slot_id`; items slotted into equipment have a non-empty `slot_id`.

import type { EntityContainmentRow as DbEntityContainmentRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import {
	asNumber,
	asString,
	buildEntitySummaryMap,
	optString,
	resolveEntityId,
	rows,
} from "./_helpers";

// visible_manifest_authored_entity is required so a caller may pass a manifest key
// (e.g. "core/player") instead of a numeric entity id — resolveEntityId reads it.
// entity is required for the #1227 name/kind/entity_def_id/quantity join below.
export const requiredTables: RequiredTables<
	[
		"visible_entity_containment",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"entity",
	]
> = [
	"visible_entity_containment",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"entity",
];
registerReaderManifest({ requiredTables });

const EMPTY_SUMMARY = { name: "", entity_def_id: "", kind: "", quantity: 0 };

export interface EntityContainmentRow {
	entity_id: string;
	container_id: string;
	slot_id: string;
	/** Authored attach direction, e.g. for a mounted/anchored container slot.
	 * Omitted (not "") when unauthored. */
	direction?: string;
	inserted_at_tick: number;
	/**
	 * The contained entity's identity, joined from the `entity` table (#1227:
	 * a bare `entity_id` forced a caller into a per-item follow-up call —
	 * `spellkave_object_state`, which dead-ends on `[]` for gear with no
	 * state pools — just to learn what it was holding). Falls back to the
	 * empty-string/zero shape on the defensive case of a dangling containment
	 * row with no matching `entity` row.
	 */
	name: string;
	entity_def_id: string;
	kind: string;
	quantity: number;
}

/**
 * Read all containment rows for a given container entity (i.e., all entities
 * held by `containerEntityId`). Accepts a numeric id, `entity:N`, or a manifest
 * key ("core/player"). Returns `[]` when the table is empty, the ref does not
 * resolve, or the container has no contents.
 */
export function readEntityContainment(
	db: SnapshotDb,
	containerEntityId: EntityRef,
): EntityContainmentRow[] {
	const containerIdBigInt = resolveEntityId(db, containerEntityId);
	if (containerIdBigInt === undefined) return [];
	const summaries = buildEntitySummaryMap(db);
	return rows<DbEntityContainmentRow>(db, "visible_entity_containment")
		.filter((r) => r.containerId === containerIdBigInt)
		.map((r) => {
			const direction = optString(r.direction);
			return {
				entity_id: String(r.entityId),
				container_id: String(r.containerId),
				slot_id: asString(r.slotId),
				...(direction === undefined ? {} : { direction }),
				inserted_at_tick: asNumber(r.insertedAtTick),
				...(summaries.get(String(r.entityId)) ?? EMPTY_SUMMARY),
			};
		});
}

/**
 * Read the containment row for a specific entity, if it is contained.
 * Accepts a numeric id, `entity:N`, or a manifest key. Returns `null` when the
 * ref does not resolve or `entityId` is not in any container.
 */
export function readEntityContainer(
	db: SnapshotDb,
	entityId: EntityRef,
): EntityContainmentRow | null {
	const entityIdBigInt = resolveEntityId(db, entityId);
	if (entityIdBigInt === undefined) return null;
	const found = rows<DbEntityContainmentRow>(db, "visible_entity_containment").find(
		(r) => r.entityId === entityIdBigInt,
	);
	if (!found) return null;
	const summary = buildEntitySummaryMap(db).get(String(found.entityId)) ?? EMPTY_SUMMARY;
	const direction = optString(found.direction);
	return {
		entity_id: String(found.entityId),
		container_id: String(found.containerId),
		slot_id: asString(found.slotId),
		...(direction === undefined ? {} : { direction }),
		inserted_at_tick: asNumber(found.insertedAtTick),
		...summary,
	};
}
