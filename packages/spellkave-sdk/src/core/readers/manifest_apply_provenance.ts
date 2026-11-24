// Authenticated audit view: the server exposes only the applier's rows or all rows to its publisher.
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, rows } from "./_helpers";
export const requiredTables: RequiredTables<["visible_manifest_apply_provenance"]> = [
	"visible_manifest_apply_provenance",
];
registerReaderManifest({ requiredTables });
export interface ManifestApplyProvenanceRow {
	key: string;
	digest: string;
	appliedBy: string;
	appliedVia: string[];
	appliedAtTick: number;
}
/** Missing rows mean unavailable audit metadata; they never imply the caller was the publisher. */
export function readManifestApplyProvenance(db: SnapshotDb): ManifestApplyProvenanceRow[] {
	return rows<Record<string, unknown>>(
		db,
		"visibleManifestApplyProvenance",
		"visible_manifest_apply_provenance",
	).map((row) => ({
		key: asString(row.key),
		digest: asString(row.digest),
		appliedBy: asString(row.appliedBy ?? row.applied_by),
		appliedVia: ((row.appliedVia ?? row.applied_via) as string[] | undefined) ?? [],
		appliedAtTick: asNumber(row.appliedAtTick ?? row.applied_at_tick),
	}));
}
