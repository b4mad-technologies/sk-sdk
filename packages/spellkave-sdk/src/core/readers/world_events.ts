// Reader: recent world events.
// Mechanical split from readers.ts; no new functionality.

import type { WorldEventRow as DbWorldEventRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, kindToString, optString, rows } from "./_helpers";

// `world_event` is private (#915 PR-8); read the per-caller
// `visible_world_event` dispatch view instead.
export const requiredTables: RequiredTables<["visible_world_event"]> = ["visible_world_event"];
registerReaderManifest({ requiredTables });

export interface WorldEventRow {
	id: string;
	tick: number;
	kind: string;
	summary?: string;
}

/**
 * Return the most recent `n` events ordered newest-first by tick (id-desc tiebreaker).
 */
export function readRecentEvents(db: SnapshotDb, n: number): WorldEventRow[] {
	if (n <= 0) return [];
	const all = rows<DbWorldEventRow>(db, "visible_world_event").map(toEventRow);
	all.sort((a, b) => (b.tick !== a.tick ? b.tick - a.tick : b.id.localeCompare(a.id)));
	return all.slice(0, n);
}

function toEventRow(r: DbWorldEventRow): WorldEventRow {
	const summary = optString(r.summary);
	const out: WorldEventRow = {
		id: asString(r.id),
		tick: asNumber(r.tick),
		kind: kindToString(r.kind),
	};
	if (summary !== undefined) out.summary = summary;
	return out;
}
