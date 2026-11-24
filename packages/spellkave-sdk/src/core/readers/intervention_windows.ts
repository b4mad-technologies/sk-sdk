import type { PendingResolutionRow, PendingStochasticResolutionRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asNumber, asString, resolveEntityId, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"visible_pending_resolution",
		"visible_pending_stochastic_resolution",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
	]
> = [
	"visible_pending_resolution",
	"visible_pending_stochastic_resolution",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
];
registerReaderManifest({ requiredTables });

/** One already-drawn, already-visible die face recorded on the parked window,
 * in draw order (index 0 first). Two entries mean the underlying roll was
 * made with Advantage/Disadvantage (two independent draws land before any
 * decision); one entry is the common case. */
export interface InterventionWindowFace {
	source_id: string;
	value: number;
}

/** A currently OPEN post-roll intervention window belonging to one of the
 * connected actor's own stochastic actions — the pause between a stochastic
 * roll parking and its outcome committing. Distinct from the general
 * multi-actor reaction-seat mechanism ({@link ReactionOptionProjection}):
 * this row has no `visible_pending_resolution_reactor` seat at all — the
 * eligible responder is `target_actor` on the parked `pending_resolution`
 * row itself. */
export interface InterventionWindowProjection {
	/** Internal typed reducer argument. Presentation layers must hide this id. */
	pending_id: bigint;
	originating_action_id: string;
	originating_actor: string;
	target_actor: string;
	session_id: bigint;
	window_opens_at_micros: number;
	window_closes_at_micros: number;
	depth: number;
	bundle_id: string;
	/** The face(s) already drawn for this window, in draw order. */
	faces: InterventionWindowFace[];
}

function bigint(value: unknown): bigint {
	return typeof value === "bigint" ? value : BigInt(String(value ?? 0));
}

/**
 * Return every currently open intervention window the connected actor is
 * eligible to respond to: a `visible_pending_resolution` row whose
 * `target_actor` resolves to this actor AND that has a sibling
 * `visible_pending_stochastic_resolution` row (the frozen draws — what makes
 * this an interveneable stochastic window rather than a plain multi-actor
 * reaction seat, which this reader deliberately does not surface; that shape
 * stays `readReactionOptionsForActor`'s job).
 */
export function readInterventionWindowsForActor(
	db: SnapshotDb,
	actorEntityRef: EntityRef,
): InterventionWindowProjection[] {
	const actorEntityId = resolveEntityId(db, actorEntityRef);
	if (actorEntityId === undefined) return [];
	const actorEntityIdText = String(actorEntityId);

	const stochasticByPendingId = new Map<string, PendingStochasticResolutionRow>();
	for (const row of rows<PendingStochasticResolutionRow>(
		db,
		"visible_pending_stochastic_resolution",
	)) {
		const raw = row as unknown as { pendingId: unknown };
		stochasticByPendingId.set(String(raw.pendingId), row);
	}

	const windows: InterventionWindowProjection[] = [];
	for (const pending of rows<PendingResolutionRow>(db, "visible_pending_resolution")) {
		const row = pending as unknown as {
			pendingId: unknown;
			originatingActionId: unknown;
			originatingActor: unknown;
			targetActor: unknown;
			sessionId: unknown;
			windowOpensAtMicros: unknown;
			windowClosesAtMicros: unknown;
			depth: unknown;
			bundleId: unknown;
		};
		if (asString(row.targetActor) !== actorEntityIdText) continue;
		const stochastic = stochasticByPendingId.get(String(row.pendingId));
		if (stochastic === undefined) continue;
		const stochasticRaw = stochastic as unknown as { draws: unknown };
		const draws = Array.isArray(stochasticRaw.draws) ? stochasticRaw.draws : [];
		windows.push({
			pending_id: bigint(row.pendingId),
			originating_action_id: asString(row.originatingActionId),
			originating_actor: asString(row.originatingActor),
			target_actor: asString(row.targetActor),
			session_id: bigint(row.sessionId),
			window_opens_at_micros: asNumber(row.windowOpensAtMicros),
			window_closes_at_micros: asNumber(row.windowClosesAtMicros),
			depth: asNumber(row.depth),
			bundle_id: asString(row.bundleId),
			faces: draws
				.map((draw) => {
					const d = draw as { sourceId?: unknown; drawIndex?: unknown; value?: unknown };
					return {
						drawIndex: asNumber(d.drawIndex),
						source_id: asString(d.sourceId),
						value: asNumber(d.value),
					};
				})
				.sort((a, b) => a.drawIndex - b.drawIndex)
				.map(({ source_id, value }) => ({ source_id, value })),
		});
	}
	return windows.sort((a, b) =>
		a.window_closes_at_micros !== b.window_closes_at_micros
			? a.window_closes_at_micros - b.window_closes_at_micros
			: a.pending_id < b.pending_id
				? -1
				: a.pending_id > b.pending_id
					? 1
					: 0,
	);
}
