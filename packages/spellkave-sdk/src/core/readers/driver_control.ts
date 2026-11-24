import type { DbConnection } from "@spellkave/bindings";
import { registerReaderManifest, type SnapshotDb } from "../../reader-manifest";
import type { DriverToken } from "../driver_control";
import { rows } from "./_helpers";

export const requiredTables = [
	"visible_actor_driver_control",
	"visible_actor_control_transition",
	"visible_control_continuation",
	"visible_control_continuation_refusal",
	"visible_event_steering",
] as const;
registerReaderManifest({ requiredTables });
type RowOf<T> = T extends { iter(): Iterable<infer R> } ? R : never;
export type DriverControlRow = RowOf<DbConnection["db"]["visibleActorDriverControl"]>;
export function readDriverControl(db: SnapshotDb, body?: string | bigint): DriverControlRow[] {
	return rows<DriverControlRow>(
		db,
		"visibleActorDriverControl",
		"visible_actor_driver_control",
	).filter(
		(row) =>
			body === undefined || String(row.bodyEntityId) === String(body).replace(/^entity:/, ""),
	);
}
/** Call with the perception snapshot, then carry the returned immutable value with the decision. */
export function captureDriverToken(db: SnapshotDb, body: string | bigint): DriverToken | undefined {
	const row = readDriverControl(db, body)[0];
	if (row === undefined || row.tombstone) return undefined;
	return Object.freeze({
		worldInstanceId: row.worldInstanceId,
		actorId: row.actorId,
		bodyEntityId: row.bodyEntityId,
		generation: row.generation,
	});
}
export function readSteeringEvents(db: SnapshotDb) {
	return rows<RowOf<DbConnection["db"]["visibleEventSteering"]>>(
		db,
		"visibleEventSteering",
		"visible_event_steering",
	);
}
export function readControlTransitions(db: SnapshotDb) {
	return rows<RowOf<DbConnection["db"]["visibleActorControlTransition"]>>(
		db,
		"visibleActorControlTransition",
		"visible_actor_control_transition",
	);
}
export function readControlContinuations(db: SnapshotDb) {
	return rows<RowOf<DbConnection["db"]["visibleControlContinuation"]>>(
		db,
		"visibleControlContinuation",
		"visible_control_continuation",
	);
}
export function readControlContinuationRefusals(db: SnapshotDb) {
	return rows<RowOf<DbConnection["db"]["visibleControlContinuationRefusal"]>>(
		db,
		"visibleControlContinuationRefusal",
		"visible_control_continuation_refusal",
	);
}
