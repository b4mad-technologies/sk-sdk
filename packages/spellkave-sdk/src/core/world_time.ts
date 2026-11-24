import type { WorldTimeRow } from "../binding_rows";
import type { SnapshotDb } from "../connection";

function readTick(db: SnapshotDb): bigint | null {
	const handle = db.world_time;
	if (!handle) return null;
	for (const row of handle.iter()) {
		const r = row as unknown as WorldTimeRow;
		return typeof r.tick === "bigint" ? r.tick : BigInt(String(r.tick ?? 0));
	}
	return null;
}

/** Returns the current world tick, or null when the world_time row is absent. */
export function currentWorldTick(db: SnapshotDb): bigint | null {
	return readTick(db);
}

/** Returns the current world tick, or 0n when the world_time row is absent. */
export function currentWorldTickOrZero(db: SnapshotDb): bigint {
	return readTick(db) ?? 0n;
}
