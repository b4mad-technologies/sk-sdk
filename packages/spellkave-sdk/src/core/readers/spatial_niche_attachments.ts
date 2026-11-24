// Caller-visible spatial niche attachments. Consumers may join a visible row
// to public topology geometry without promoting its anchor into perceived map
// knowledge.
import type { VisibleSpatialNicheAttachmentRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString, rows } from "./_helpers";

export const requiredTables: RequiredTables<["visible_spatial_niche_attachment"]> = [
	"visible_spatial_niche_attachment",
];
registerReaderManifest({ requiredTables });

export function readVisibleSpatialNicheAttachments(db: SnapshotDb): Record<string, unknown>[] {
	return rows<VisibleSpatialNicheAttachmentRow>(db, "visible_spatial_niche_attachment").map(
		(row) => ({
			attachment_id: row.attachmentId,
			niche_id: asString(row.nicheId),
			place_node_id: asString(row.placeNodeId),
			place_edge_id: row.placeEdgeId,
			target_kind: asString(row.targetKind),
			visibility: row.visibility,
		}),
	);
}
