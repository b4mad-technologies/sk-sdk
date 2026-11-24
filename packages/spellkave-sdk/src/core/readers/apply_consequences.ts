import type { EventApplyConsequenceRow as DbEventApplyConsequenceRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, optString, rows } from "./_helpers";

// `event_apply_consequence` is private (ADR-0120, #915) — subscribe + read
// the per-caller `visible_event_apply_consequence` view instead
// (owner/DM-extent-bounded on target/source body).
export const requiredTables: RequiredTables<["visible_event_apply_consequence"]> = [
	"visible_event_apply_consequence",
];
registerReaderManifest({ requiredTables });

export interface EventApplyConsequenceEntry {
	event_id: string;
	template_id: string;
	target_entity_id?: string;
	/** ADR-0093 B2: the acting/source entity, denormalised onto the row at emit
	 * time (`EventApplyConsequence.source_entity_ref`). `undefined` for an
	 * ambient/ownerless consequence — the server carries this as an empty
	 * string (`String`, not `Option<u64>`), so an empty value maps to
	 * `undefined` here, never `""`. Was previously dropped by this reader even
	 * though the server has always carried it. */
	source_entity_ref?: string;
	frame_writes_count: number;
	traces_inscribed_count: number;
}

export function readEventApplyConsequences(db: SnapshotDb): EventApplyConsequenceEntry[] {
	return rows<DbEventApplyConsequenceRow>(db, "visible_event_apply_consequence").map((row) => ({
		event_id: asString(row.eventId),
		template_id: row.templateId,
		target_entity_id: optionString(row.targetEntityId),
		source_entity_ref: optString(row.sourceEntityRef),
		frame_writes_count: asNumber(row.frameWritesCount),
		traces_inscribed_count: asNumber(row.tracesInscribedCount),
	}));
}

function optionString(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === "bigint" || typeof value === "number" || typeof value === "string")
		return String(value);
	if (typeof value === "object") {
		const record = value as { tag?: unknown; value?: unknown; some?: unknown };
		if (record.tag === "some" || record.tag === "Some")
			return optionString(record.value ?? record.some);
		if ("some" in record) return optionString(record.some);
	}
	return undefined;
}
