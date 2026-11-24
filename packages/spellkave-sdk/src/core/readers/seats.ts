// Playable in-world seats. Occupant identity is never on this row (ADR-0084).
import type { SeatRow as DbSeatRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { type ActorId, asActorId, asEntityId, type EntityId } from "../ids";
import { asString, rows } from "./_helpers";

export const requiredTables: RequiredTables<["seat"]> = ["seat"];
registerReaderManifest({ requiredTables });

export interface SeatRow {
	actor_id: ActorId;
	entity_id: EntityId;
	name: string;
	embodied: boolean;
	/** True when any actor_identity binding exists. Not a live-connection flag. */
	claimed: boolean;
}

export function readSeats(db: SnapshotDb): SeatRow[] {
	return rows<DbSeatRow>(db, "seat")
		.map((row) => ({
			actor_id: asActorId(String(row.actorId)),
			entity_id: asEntityId(String(row.entityId)),
			name: asString(row.name),
			embodied: Boolean(row.embodied),
			claimed: Boolean(row.claimed),
		}))
		.sort((a, b) => Number(a.actor_id) - Number(b.actor_id));
}
