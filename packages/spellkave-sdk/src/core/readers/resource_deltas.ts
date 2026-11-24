import type { EventResourceDeltaRow as DbEventResourceDeltaRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, optionNumber, optString, rows } from "./_helpers";

// `event_resource_delta` is private (ADR-0120, #915) — the single
// highest-sensitivity table in the sweep. Subscribe + read the per-caller
// `visible_event_resource_delta` view instead (owner/DM-extent-bounded).
export const requiredTables: RequiredTables<["visible_event_resource_delta"]> = [
	"visible_event_resource_delta",
];
registerReaderManifest({ requiredTables });

export interface ResourceDeltaEventRow {
	event_id: string;
	entity_id: string;
	resource_id: string;
	delta: number;
	/** Remaining resource after the delta. `undefined` when the view redacted
	 * it (caller admitted only as source — ADR-0120 / T29 / #2215). */
	new_value?: number;
	template_id: string;
	/** ADR-0093 B2: the attacker/actor entity that caused this delta, denormalised
	 * onto the row at emit time (mirrors `event_apply_consequence`'s
	 * `source_entity_ref`). `undefined` for an ambient/ownerless delta — the
	 * server carries this as an empty string (`String`, not `Option<u64>`), so an
	 * empty value maps to `undefined` here, never `""`. */
	source_entity_ref?: string;
}

export function readRecentResourceDeltas(db: SnapshotDb, n: number): ResourceDeltaEventRow[] {
	if (n <= 0) return [];
	const all = rows<DbEventResourceDeltaRow>(db, "visible_event_resource_delta").map((row) => ({
		event_id: asString(row.eventId),
		entity_id: asString(row.entityId),
		resource_id: row.resourceId,
		delta: asNumber(row.delta),
		new_value: optionNumber(row.newValue),
		template_id: row.templateId,
		source_entity_ref: optString(row.sourceEntityRef),
	}));
	all.sort((a, b) => b.event_id.localeCompare(a.event_id, undefined, { numeric: true }));
	return all.slice(0, n);
}
