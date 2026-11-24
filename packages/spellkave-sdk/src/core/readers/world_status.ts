// Reader: world status (world_time + config).
// Mechanical split from readers.ts; no new functionality.

import type { ConfigRow, WorldTimeRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, optNumber, optString, rows } from "./_helpers";

export const requiredTables: RequiredTables<["world_time", "config"]> = ["world_time", "config"];
registerReaderManifest({ requiredTables });

export interface WorldStatus {
	tick: number;
	worldName?: string;
	// agentsEnabled removed — Item 1 (01-remove-agents-enabled.md) dropped this
	// config column; it no longer appears in the generated config_table binding.
	eventRetentionLimit?: number;
	// The live autonomous-tick cadence (config.tick_interval_secs). Lets a control
	// reflect the server's actual interval instead of a hardcoded default (#1133).
	tickIntervalSecs?: number;
	/**
	 * Identity of THIS world instance (`config.world_instance_id`), minted once
	 * by the kernel's `init` reducer: preserved by a re-publish and a host
	 * restart, rotated by every wipe/reset that re-creates the database
	 * (sk-jay0.1.23.35.5).
	 *
	 * Absent when the module predates the column, or when the row carries the
	 * empty sentinel. Durable state kept OUTSIDE the database (npc brain
	 * checkpoints) treats absence as an unknown world and refuses to reuse
	 * memory bound to it — the same answer as a mismatch.
	 */
	worldInstanceId?: string;
}

/**
 * Read the world status header. Returns `null` only if neither `world_time`
 * nor `config` have applied yet — callers should treat that as "still connecting".
 */
export function readWorldStatus(db: SnapshotDb): WorldStatus | null {
	const timeRows = rows<WorldTimeRow>(db, "world_time");
	const configRows = rows<ConfigRow>(db, "config");
	if (timeRows.length === 0 && configRows.length === 0) return null;

	const t = timeRows[0];
	const c = configRows[0];
	const status: WorldStatus = { tick: t ? asNumber(t.tick) : 0 };
	if (c) {
		const worldName = optString(c.worldName);
		if (worldName !== undefined) status.worldName = worldName;
		const evtLimit = optNumber(c.eventRetentionLimit);
		if (evtLimit !== undefined && Number.isFinite(evtLimit)) status.eventRetentionLimit = evtLimit;
		const interval = optNumber(c.tickIntervalSecs);
		if (interval !== undefined && Number.isFinite(interval)) status.tickIntervalSecs = interval;
		const instance = optString(c.worldInstanceId);
		// The empty sentinel means "minted before this column existed"; report
		// it as absent rather than as an instance nobody can match.
		if (instance !== undefined && instance.length > 0) status.worldInstanceId = instance;
	}
	return status;
}
