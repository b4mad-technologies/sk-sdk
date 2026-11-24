import type {
	ManipulationObservedTargetRow as DbManipulationObservedTargetRow,
	PendingResolutionReactorRow,
	PendingResolutionRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { targetRefToString } from "../reducers/transport";
import { asNumber, asString, buildEntityFactionMap, resolveEntityId, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"visible_pending_resolution",
		"visible_pending_resolution_reactor",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"visible_manipulation_observed_target",
		"visible_entity_tag",
		"visible_entity_tag_coverage",
	]
> = [
	"visible_pending_resolution",
	"visible_pending_resolution_reactor",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"visible_manipulation_observed_target",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
];
registerReaderManifest({ requiredTables });

/** Participant-visible reaction seat joined to its still-open parent window. */
export interface ReactionOptionProjection {
	/** Internal typed reducer argument. Presentation layers must hide this id. */
	pending_id: bigint;
	reactor_id: string;
	originating_action_id: string;
	originating_actor: string;
	target_actor: string;
	/**
	 * Faction suffix already disclosed on this perceiver's factored target
	 * context for `target_actor`. Null when that actor is not a disclosed target
	 * (runtime tags use admitted visible_entity_tag with coverage).
	 */
	target_entity_faction: string | null;
	computed_outcome_template: string;
	session_id: bigint;
	window_opens_at_micros: number;
	window_closes_at_micros: number;
	depth: number;
	bundle_id: string;
}

function bigint(value: unknown): bigint {
	return typeof value === "bigint" ? value : BigInt(String(value ?? 0));
}

/**
 * Return only unreacted seats belonging to `actorEntityId`. Rows without a
 * visible parent are skipped fail-closed. Sorting is deadline then pending id.
 */
export function readReactionOptionsForActor(
	db: SnapshotDb,
	actorEntityRef: EntityRef,
): ReactionOptionProjection[] {
	const actorEntityId = resolveEntityId(db, actorEntityRef);
	if (actorEntityId === undefined) return [];
	const actorEntityIdText = String(actorEntityId);
	const perceivedTargets = perceivedManipulationTargetIds(db, actorEntityId);
	const factions = buildEntityFactionMap(db);
	const parents = new Map<string, PendingResolutionRow>();
	for (const row of rows<PendingResolutionRow>(db, "visible_pending_resolution")) {
		const raw = row as unknown as { pendingId: unknown };
		parents.set(String(raw.pendingId), row);
	}

	const options: ReactionOptionProjection[] = [];
	for (const seat of rows<PendingResolutionReactorRow>(db, "visible_pending_resolution_reactor")) {
		const reactor = seat as unknown as {
			pendingId: unknown;
			entityRef: unknown;
			reacted: boolean;
		};
		if (reactor.reacted || asString(reactor.entityRef) !== actorEntityIdText) continue;
		const parent = parents.get(String(reactor.pendingId));
		if (parent === undefined) continue;
		const pending = parent as unknown as {
			pendingId: unknown;
			originatingActionId: unknown;
			originatingActor: unknown;
			targetActor: unknown;
			computedOutcomeTemplate: unknown;
			sessionId: unknown;
			windowOpensAtMicros: unknown;
			windowClosesAtMicros: unknown;
			depth: unknown;
			bundleId: unknown;
		};
		options.push({
			pending_id: bigint(pending.pendingId),
			reactor_id: asString(reactor.entityRef),
			originating_action_id: asString(pending.originatingActionId),
			originating_actor: asString(pending.originatingActor),
			target_actor: asString(pending.targetActor),
			target_entity_faction: disclosedTargetFaction(
				asString(pending.targetActor),
				perceivedTargets,
				factions,
			),
			computed_outcome_template: asString(pending.computedOutcomeTemplate),
			session_id: bigint(pending.sessionId),
			window_opens_at_micros: asNumber(pending.windowOpensAtMicros),
			window_closes_at_micros: asNumber(pending.windowClosesAtMicros),
			depth: asNumber(pending.depth),
			bundle_id: asString(pending.bundleId),
		});
	}
	return options.sort((a, b) =>
		a.window_closes_at_micros !== b.window_closes_at_micros
			? a.window_closes_at_micros - b.window_closes_at_micros
			: a.pending_id < b.pending_id
				? -1
				: a.pending_id > b.pending_id
					? 1
					: 0,
	);
}

/** Factored target facts replace the eager action × target listing for this
 * reaction-side classification. A reaction remains its own bounded surface;
 * this only avoids rebuilding ordinary offers to learn target visibility. */
function perceivedManipulationTargetIds(db: SnapshotDb, perceiverId: bigint): Set<string> {
	const out = new Set<string>();
	for (const row of rows<DbManipulationObservedTargetRow>(
		db,
		"visible_manipulation_observed_target",
	)) {
		if (row.perceiverEntityId !== perceiverId) continue;
		const targetRef = targetRefToString(row.targetRef);
		if (targetRef.startsWith("entity:")) out.add(targetRef.slice("entity:".length));
	}
	return out;
}

function disclosedTargetFaction(
	targetActor: string,
	perceivedTargets: Set<string>,
	factions: Map<string, string>,
): string | null {
	if (targetActor.length === 0 || !perceivedTargets.has(targetActor)) return null;
	return factions.get(targetActor) ?? null;
}
