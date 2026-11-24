// Reader: direct sensing syntax from independently observable world facts.
//
// This deliberately joins an actor's visible place, visible niche attachments,
// and public authored template/outcome metadata. It never evaluates a template
// predicate or binds a query to a target; r_sense remains the sole authority.

import type {
	ActorSpatialLocationRow,
	AffordanceTemplateRow,
	OutcomeTemplateRow,
	VisibleCapabilityRow,
	VisibleSpatialNicheAttachmentRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asString, resolveEntityId, rows, tagString } from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"visible_actor_spatial_location",
		"visible_spatial_niche_attachment",
		"visible_capability",
		"affordance_template",
		"outcome_template",
	]
> = [
	"visible_actor_spatial_location",
	"visible_spatial_niche_attachment",
	"visible_capability",
	"affordance_template",
	"outcome_template",
];
registerReaderManifest({ requiredTables });

export interface SenseQueryDescriptor {
	query_kind: string;
	visibility: string;
	display_name: string;
	outcome_template_id: string;
}

/** Missing place knowledge is unavailable, distinct from a known place with
 * no authored sensing queries. Queries are unassessed candidates, never offers. */
export function readSenseContext(
	db: SnapshotDb,
	perceiverEntityId: EntityRef,
): { status: "unavailable" } | { status: "ready"; queries: SenseQueryDescriptor[] } {
	const perceiverId = resolveEntityId(db, perceiverEntityId);
	if (perceiverId === undefined) return { status: "unavailable" };
	const location = rows<ActorSpatialLocationRow>(db, "visible_actor_spatial_location").find(
		(row) => String(row.entityId) === String(perceiverId),
	);
	if (location === undefined) return { status: "unavailable" };
	const placeNodeId = asString(location.placeNodeId);
	const visibleNiches = new Set(
		rows<VisibleSpatialNicheAttachmentRow>(db, "visible_spatial_niche_attachment")
			.filter((row) => asString(row.placeNodeId) === placeNodeId)
			.map((row) => asString(row.nicheId)),
	);
	const capabilities = new Set(
		rows<VisibleCapabilityRow>(db, "visible_capability")
			.filter((row) => String(row.entityId) === String(perceiverId))
			.map((row) => asString(row.capabilityId)),
	);
	const outcomesById = new Map(
		rows<OutcomeTemplateRow>(db, "outcome_template").map((row) => [
			asString(row.outcomeTemplateId),
			row,
		]),
	);
	const deduplicated = new Map<string, SenseQueryDescriptor>();
	for (const template of rows<AffordanceTemplateRow>(db, "affordance_template")) {
		const capability = asString(template.capabilityId).trim();
		// A capability-free sensing template is authored global syntax (the
		// baseline Look query is the concrete case). It has no hidden target or
		// predicate result to disclose, so it must not be accidentally hidden
		// behind a spatial-niche attachment. Capability-bound templates still
		// require their independently visible place/niche anchor.
		if (capability === "" && !visibleNiches.has(asString(template.nicheId))) {
			// No capability is necessary, but a world may still deliberately bind
			// the query to a visible place niche. Only the unbound form is global.
			const hasAnyPlaceAnchor = rows<VisibleSpatialNicheAttachmentRow>(
				db,
				"visible_spatial_niche_attachment",
			).some((row) => asString(row.nicheId) === asString(template.nicheId));
			if (hasAnyPlaceAnchor) continue;
		} else if (capability !== "" && !visibleNiches.has(asString(template.nicheId))) {
			continue;
		}
		if (capability !== "" && !capabilities.has(capability)) continue;
		const outcome = outcomesById.get(asString(template.outcomeTemplateId));
		if (outcome === undefined) continue;
		const queryKind = asString(outcome.senseQueryKind).trim();
		if (queryKind === "") continue;
		deduplicated.set(queryKind, {
			query_kind: queryKind,
			visibility: tagString(outcome.senseVisibility),
			display_name: asString(outcome.displayName),
			outcome_template_id: asString(outcome.outcomeTemplateId),
		});
	}
	return {
		status: "ready",
		queries: [...deduplicated.values()].sort((left, right) =>
			left.query_kind.localeCompare(right.query_kind),
		),
	};
}
