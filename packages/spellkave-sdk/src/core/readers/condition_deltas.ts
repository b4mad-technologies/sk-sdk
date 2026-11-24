import type { EventConditionDeltaRow as DbEventConditionDeltaRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, optString, rows } from "./_helpers";

// `event_condition_delta` is private (ADR-0120, K-B Part B — #1332-precedent
// sibling of event_resource_delta). Subscribe + read the per-caller
// `visible_event_condition_delta` view instead (owner/DM-extent-bounded),
// same shape as resource_deltas.ts.
export const requiredTables: RequiredTables<["visible_event_condition_delta"]> = [
	"visible_event_condition_delta",
];
registerReaderManifest({ requiredTables });

export interface ConditionDeltaEventRow {
	event_id: string;
	entity_id: string;
	condition_definition_id: string;
	/** `true` for an insert/reapply, `false` for a removal (explicit, cascade,
	 * or expiry — one shape, server side). */
	applied: boolean;
	/** ADR-0093 B2-style attribution: the acting entity that caused this
	 * change, denormalised onto the row at emit time (mirrors
	 * `event_resource_delta.source_entity_ref`). `undefined` for an
	 * ambient/ownerless change (expiry sweep, cascade child, seed/clone —
	 * those never reach this table at all) — the server carries this as an
	 * empty string (`String`, not `Option<u64>`), so an empty value maps to
	 * `undefined` here, never `""`. */
	source_entity_ref?: string;
	/** The `consequence_template` that authored this write, when one exists.
	 * Empty for an implicit/cascade/expiry write with no originating
	 * template. */
	template_id: string;
	expires_at_tick: number;
}

export function readRecentConditionDeltas(db: SnapshotDb, n: number): ConditionDeltaEventRow[] {
	if (n <= 0) return [];
	const all = rows<DbEventConditionDeltaRow>(db, "visible_event_condition_delta").map((row) => ({
		event_id: asString(row.eventId),
		entity_id: asString(row.entityId),
		condition_definition_id: row.conditionDefinitionId,
		applied: Boolean(row.applied),
		source_entity_ref: optString(row.sourceEntityRef),
		template_id: row.templateId,
		expires_at_tick: asNumber(row.expiresAtTick),
	}));
	all.sort((a, b) => b.event_id.localeCompare(a.event_id, undefined, { numeric: true }));
	return all.slice(0, n);
}
