import type { EvaluationProvenanceRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asNumber, asString, resolveEntityId, rows, tagString } from "./_helpers";
import { isDirectlyControlled } from "./self";

export const requiredTables: RequiredTables<
	[
		"visible_evaluation_provenance",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"directly_controlled_actor_spatial_location",
	]
> = [
	"visible_evaluation_provenance",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"directly_controlled_actor_spatial_location",
];
registerReaderManifest({ requiredTables });

/** `evaluation_provenance` grows unboundedly (a row per action-evaluation,
 * forever) — unlike a capability grant set, there is no natural cap. This is
 * a reader-level safety ceiling, applied before the caller's own paging/
 * bounded-collection slicing, most-recent-first. */
const SELF_EVALUATION_HISTORY_CAP = 50;

export interface CompactSelfEvaluationDraw {
	source_id: string;
	draw_index: number;
	value: number;
}

export interface CompactSelfEvaluation {
	provenance_id: string;
	created_at_tick: number;
	status: string;
	subject_id: string;
	selected_template_ids: string[];
	draws: CompactSelfEvaluationDraw[];
	record_kind?: string;
	expression_ids?: string[];
	failure_kind?: string;
	failure_detail?: string;
}

export function toCompactSelfEvaluation(row: EvaluationProvenanceRow): CompactSelfEvaluation {
	const recordKind = tagString(row.kind);
	const expressionIds = Array.isArray(row.expressionIds)
		? row.expressionIds.map((id) => String(id)).filter((id) => id.length > 0)
		: [];
	const failureKind = asString(row.failureKind);
	const failureDetail = asString(row.failureDetail);

	return {
		provenance_id: asString(row.provenanceId),
		created_at_tick: asNumber(row.createdAtTick),
		status: tagString(row.status),
		subject_id: asString(row.subjectId),
		selected_template_ids: Array.isArray(row.selectedTemplateIds)
			? row.selectedTemplateIds.map((id) => String(id))
			: [],
		draws: Array.isArray(row.stochasticDraws)
			? row.stochasticDraws.map((draw) => ({
					source_id: asString(draw.sourceId),
					draw_index: asNumber(draw.drawIndex),
					value: asNumber(draw.value),
				}))
			: [],
		...(recordKind ? { record_kind: recordKind } : {}),
		...(expressionIds.length > 0 ? { expression_ids: expressionIds } : {}),
		...(failureKind ? { failure_kind: failureKind } : {}),
		...(failureDetail ? { failure_detail: failureDetail } : {}),
	};
}

/** Full authorized self-evaluation projection: the connected actor's OWN
 * body's recent `visible_evaluation_provenance` rows, most-recent-first,
 * capped at `SELF_EVALUATION_HISTORY_CAP`. Content-neutral — projects
 * whatever `stochastic_draws` the row carries (possibly empty) without
 * interpreting them; the consumer knows whether a draw is a d20 or
 * something else. Gated behind `isDirectlyControlled`, matching
 * `readSelfCapabilities`/`readSelfStates`'s own posture — perceiving the
 * die faces behind one's own recent checks is self-perception of the body's
 * own affordance resolution (finding #22(b), `ledger/findings.md`). Scopes
 * on `owner_body_entity_id`, not `subject_id`: every `r_manipulate` call site
 * writes the ACTOR's own entity id there, on both success and failure rows
 * (finding #22(a)'s own grounding). */
export function readSelfRecentEvaluations(
	db: SnapshotDb,
	actorId: EntityRef,
): CompactSelfEvaluation[] {
	if (!isDirectlyControlled(db, actorId)) return [];
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return [];
	return rows<EvaluationProvenanceRow>(db, "visible_evaluation_provenance")
		.filter((row) => String(row.ownerBodyEntityId) === String(entityId))
		.map(toCompactSelfEvaluation)
		.sort((a, b) => {
			if (a.created_at_tick !== b.created_at_tick) return b.created_at_tick - a.created_at_tick;
			return a.provenance_id < b.provenance_id ? 1 : a.provenance_id > b.provenance_id ? -1 : 0;
		})
		.slice(0, SELF_EVALUATION_HISTORY_CAP);
}

/**
 * Lookup one evaluation row by provenance_id over all evaluation rows the
 * client holds for the connected body (not capped to history ceiling).
 */
export function readSelfEvaluationById(
	db: SnapshotDb,
	actorId: EntityRef,
	provenanceId: string,
): CompactSelfEvaluation | null {
	if (!isDirectlyControlled(db, actorId)) return null;
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return null;
	const targetId = provenanceId.trim();
	const match = rows<EvaluationProvenanceRow>(db, "visible_evaluation_provenance").find(
		(row) =>
			String(row.ownerBodyEntityId) === String(entityId) && asString(row.provenanceId) === targetId,
	);
	return match ? toCompactSelfEvaluation(match) : null;
}
