// ADR-0130 D-6: "SDK readers read `public_metadata_attachment` together with
// `visible_metadata_attachment` through one shared helper." This is that
// helper. `metadata_attachment` is now a private table (D-1); every reader
// that used to declare it now declares these two play views instead and
// reads through `readMetadataAttachmentRows`. Reference consumers
// (character creation, advancement, authoring tools) declare
// `public_reference_metadata` and read through `readPublicReferenceMetadataRows`.

import type {
	PublicMetadataAttachmentRow,
	PublicReferenceMetadataRow,
	VisibleMetadataAttachmentRow,
} from "../../binding_rows";
import type { SnapshotDb } from "../../reader-manifest";
import { rows } from "./_helpers";

/** The three metadata views share this column shape (D-5). */
export type MetadataAttachmentRow = PublicMetadataAttachmentRow;

/**
 * Union of `public_metadata_attachment` and `visible_metadata_attachment`,
 * deduped by `row_id`. The two views are disjoint by construction (a row's
 * `(audience, on_demand, target_kind)` selects exactly one), so the dedupe is
 * defensive rather than load-bearing — it keeps this helper correct even if
 * a future view definition narrows and a row transiently satisfies both.
 */
export function readMetadataAttachmentRows(
	db: SnapshotDb,
): (PublicMetadataAttachmentRow | VisibleMetadataAttachmentRow)[] {
	const seen = new Set<string>();
	const out: (PublicMetadataAttachmentRow | VisibleMetadataAttachmentRow)[] = [];
	for (const row of [
		...rows<PublicMetadataAttachmentRow>(db, "public_metadata_attachment"),
		...rows<VisibleMetadataAttachmentRow>(db, "visible_metadata_attachment"),
	]) {
		// Only a row that actually carries a key takes part in the dedupe. A
		// server row always has one (ADR-0146 storage key); a unit fixture may
		// leave it out, and treating several key-less rows as one would
		// silently drop annotations.
		if (row.key === undefined || row.key === null || row.key === "") {
			out.push(row);
			continue;
		}
		const key = String(row.key);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(row);
	}
	return out;
}

/** ADR-0130 D-6: reference consumers declare `public_reference_metadata`
 * directly rather than going through the play-session union above. */
export function readPublicReferenceMetadataRows(db: SnapshotDb): PublicReferenceMetadataRow[] {
	return rows<PublicReferenceMetadataRow>(db, "public_reference_metadata");
}
