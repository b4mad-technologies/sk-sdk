// Reader: outcome_template description (#1968 B-9).
// Mechanical, single-field reader: no new functionality beyond exposing the
// authored `outcome_template.description` column, mirroring
// `readLocationSnapshot`'s `node_description`/`graph_description` pattern —
// `outcome_template` is public/definition-shaped (like `niche_definition`,
// `action_definition`), not a hidden-state or per-caller-gated table, so no
// view/visibility split is needed here.

import type { OutcomeTemplateRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { rows } from "./_helpers";

export const requiredTables: RequiredTables<["outcome_template"]> = ["outcome_template"];
registerReaderManifest({ requiredTables });

/**
 * Read the RAW authored `outcome_template.description` for one
 * `outcomeTemplateId` — uninterpolated, placeholder tokens (`{target_name}`
 * etc.) left verbatim. Returns `null` when the row does not exist or its
 * description is unauthored (empty string), so callers fall back to their
 * own honest gap rather than treating "" as a valid observation.
 *
 * Interpolation and epistemic composition (which data resolves each
 * placeholder) is a shared tool runtime concern
 * (`packages/spellkave-tool-player/src/observation.ts`), not this reader
 * — SDK readers stay pure reads, no business logic.
 */
export function readOutcomeTemplateDescription(
	db: SnapshotDb,
	outcomeTemplateId: string,
): string | null {
	const row = rows<OutcomeTemplateRow>(db, "outcome_template").find(
		(r) => r.outcomeTemplateId === outcomeTemplateId,
	);
	const description = row?.description ?? "";
	return description !== "" ? description : null;
}
