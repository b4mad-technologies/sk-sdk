import type { TurnStateRow as DbTurnStateRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, rows } from "./_helpers";

export const requiredTables: RequiredTables<["visible_turn_state"]> = ["visible_turn_state"];
registerReaderManifest({ requiredTables });

/** The kernel-authoritative turn scheduler's current state. `current_actor`/
 * `scope_session_id` are entity/session ids as decimal strings (comparison-
 * friendly, matching sibling readers' id-field convention); `turn` is the
 * monotonic turn counter. */
export interface TurnStateSnapshot {
	turn: number;
	current_actor: string;
	active_scheduler_id: string;
	scope_session_id: string;
}

/** Read the singleton turn-scheduler row, or `null` before it has applied —
 * or while its scope is a session this caller is not in. */
export function readTurnState(db: SnapshotDb): TurnStateSnapshot | null {
	const row = rows<DbTurnStateRow>(db, "visible_turn_state")[0];
	if (row === undefined) return null;
	return {
		turn: asNumber(row.turn),
		current_actor: asString(row.currentActor),
		active_scheduler_id: asString(row.activeSchedulerId),
		scope_session_id: asString(row.scopeSessionId),
	};
}
