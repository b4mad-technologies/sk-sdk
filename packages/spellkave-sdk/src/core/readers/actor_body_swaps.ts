// Reader: typed body-swap event details joined to their world_event headers.

import type {
	EventActorBodySwappedRow as DbEventActorBodySwappedRow,
	WorldEventRow as DbWorldEventRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { type ActorId, asActorId, asEntityId, type EntityId } from "../ids";
import { asNumber, asString, kindToString, rows } from "./_helpers";

// `event_actor_body_swapped` is private (ADR-0120, #915) — subscribe + read
// the per-caller `visible_event_actor_body_swapped` view instead
// (owner/DM-extent-bounded on the previous/new body). `world_event` is also
// private (#915 PR-8); its per-caller dispatch view admits the header
// whenever the caller is admitted to this detail row (same OR-set the
// header side reuses), so joining the two here stays consistent.
export const requiredTables: RequiredTables<
	["visible_event_actor_body_swapped", "visible_world_event"]
> = ["visible_event_actor_body_swapped", "visible_world_event"];
registerReaderManifest({ requiredTables });

export interface ActorBodySwapEventRow {
	event_id: string;
	tick: number;
	event_kind: string;
	actor_id: ActorId;
	previous_body_entity_id: EntityId;
	new_body_entity_id: EntityId;
	consequence_template_id: string;
}

/**
 * Read body-swap event details ordered by event tick, then event id.
 */
export function readActorBodySwapEvents(db: SnapshotDb): ActorBodySwapEventRow[] {
	const eventsById = new Map(
		rows<DbWorldEventRow>(db, "visible_world_event").map((row) => [asString(row.id), row]),
	);

	return rows<DbEventActorBodySwappedRow>(db, "visible_event_actor_body_swapped")
		.map((row) => toActorBodySwapEventRow(row, eventsById.get(asString(row.eventId))))
		.sort((a, b) => a.tick - b.tick || a.event_id.localeCompare(b.event_id));
}

function toActorBodySwapEventRow(
	row: DbEventActorBodySwappedRow,
	event: DbWorldEventRow | undefined,
): ActorBodySwapEventRow {
	return {
		event_id: asString(row.eventId),
		tick: event ? asNumber(event.tick) : 0,
		event_kind: event ? kindToString(event.kind) : "",
		actor_id: asActorId(asString(row.actorId)),
		previous_body_entity_id: asEntityId(asString(row.previousBodyEntityId)),
		new_body_entity_id: asEntityId(asString(row.newBodyEntityId)),
		consequence_template_id: asString(row.consequenceTemplateId),
	};
}
