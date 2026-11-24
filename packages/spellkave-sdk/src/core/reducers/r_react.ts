// Per-reducer wrapper for r_react (#509 — react to a pending_resolution;
// #2058 extended it to also cover post-roll intervention windows).
//
// STATE-OBSERVED, two shapes depending on what the caller's baseline snapshot
// shows for this pendingId:
//   - Multi-actor reaction seat (the original #509 shape): the subscribed
//     `visible_pending_resolution_reactor` view exposes the caller's own
//     reaction seat row. A successful reaction either flips that seat to
//     `reacted=true` or removes it when the pending resolution closes.
//   - Post-roll intervention window (#2058): a stochastic action parks with
//     NO reactor-seat row at all — the eligible responder is `target_actor`
//     on the `visible_pending_resolution` row itself (see
//     `readInterventionWindowsForActor`). There, success is observed as that
//     SAME pending_resolution row disappearing (decline or accept both close
//     the window outright; there is only ever one responder).
// Whichever shape the baseline snapshot shows is what this call polls for —
// the two are mutually exclusive per pendingId, so there is no ambiguity.
// The server emits no evaluation provenance for r_react either way, so these
// subscribed views are the authoritative observable success signal.

import type { DbConnection } from "@spellkave/bindings";
import type { PendingResolutionRow } from "../../binding_rows";
import type { SnapshotDb } from "../../connection";
import { observeReducerAttempt } from "../../provenance";
import type { EntityRef } from "../ids";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import { asString, rows } from "../readers/_helpers";
import type { TickIntervalEstimator } from "../tick_cadence";
import type { ActorReactResult } from "../types";
import { actorEntityId } from "./transport";

export type RReactFn = DbConnection["reducers"]["rReact"];

export async function rReactWrapper(
	actorId: EntityRef,
	pendingId: bigint,
	responseIntent: string,
	snapshotDb: () => SnapshotDb,
	rReact: RReactFn,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
	selectedDrawIndex?: number,
): Promise<ActorReactResult> {
	const reactorId = actorEntityId(actorId);
	const matchingSeat = (db: SnapshotDb) =>
		rows<Record<string, unknown>>(db, "visible_pending_resolution_reactor").find(
			(row) =>
				String(row.pendingId) === String(pendingId) &&
				asString(row.entityRef) === String(reactorId),
		);
	const pendingRowExists = (db: SnapshotDb) =>
		rows<PendingResolutionRow>(db, "visible_pending_resolution").some(
			(row) => String((row as unknown as { pendingId: unknown }).pendingId) === String(pendingId),
		);

	const baselineDb = snapshotDb();
	const baselineSeat = matchingSeat(baselineDb);
	// A seat row exists for the general multi-actor reaction shape; its absence
	// means this pendingId is (if anything) an intervention window instead —
	// there the pending_resolution row's own presence is the eligibility check.
	const seatMode = baselineSeat !== undefined;
	const baselineWasEligible = seatMode
		? baselineSeat.reacted !== true
		: pendingRowExists(baselineDb);

	// Acting actor = reactor_id. Args pass 1:1 to the generated accessor (CLAUDE.md §1).
	const result = await observeReducerAttempt<null>({
		db: snapshotDb,
		subjectId: actorId,
		invoke: () => rReact({ reactorId, pendingId, responseIntent, selectedDrawIndex }),
		successPredicate: (db) => {
			if (!baselineWasEligible) return false;
			if (seatMode) {
				const seat = matchingSeat(db);
				return seat === undefined || seat.reacted === true;
			}
			return !pendingRowExists(db);
		},
		collectSnapshot: () => null,
		timeoutMs,
		pollMs,
		tickEstimator,
		provenanceBuffer,
	});

	const selectedDrawIndexField =
		selectedDrawIndex === undefined ? {} : { selected_draw_index: selectedDrawIndex };

	if (result.status === "success") {
		return {
			status: "success",
			actor_id: actorId,
			pending_id: pendingId,
			response_intent: responseIntent,
			...selectedDrawIndexField,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			actor_id: actorId,
			pending_id: pendingId,
			response_intent: responseIntent,
			...selectedDrawIndexField,
			reason: "r_react rejected by server",
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "unobserved_timeout") {
		return {
			status: "unobserved_timeout",
			actor_id: actorId,
			pending_id: pendingId,
			response_intent: responseIntent,
			...selectedDrawIndexField,
			reason: `r_react on pending ${pendingId} not observed within ${timeoutMs}ms`,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	return {
		status: result.status,
		actor_id: actorId,
		pending_id: pendingId,
		response_intent: responseIntent,
		...selectedDrawIndexField,
		reason: `r_react on pending ${pendingId} not observed within ${timeoutMs}ms`,
		provenance: result.provenance ?? undefined,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	};
}
