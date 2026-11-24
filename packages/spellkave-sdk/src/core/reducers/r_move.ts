// Per-reducer wrapper for r_move.
// Ported from actor_control.ts; Phase 4 lagWarning + observedAtTick threaded.

import { type SnapshotDb, snapshotFromDb } from "../../connection";
import { observeReducerAttempt } from "../../provenance";
import type { RMoveFn } from "../actor_control_source";
import type { EntityRef } from "../ids";
import type { PlaceEdgeRow } from "../movement";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import { readActorSnapshot } from "../readers/actor_snapshot";
import { travelSessionForActor } from "../readers/travel_session";
import type { TickIntervalEstimator } from "../tick_cadence";
import type {
	ActorMoveRejected,
	ActorMoveResult,
	ActorMoveSuccess,
	ActorMoveTravelling,
	ActorMoveUnobservable,
	ActorMoveUnobservedNoProvenance,
	ActorMoveUnobservedTimeout,
} from "../types";
import { actorEntityId } from "./transport";

// snapshotFromDb normalises camelCase binding rows to snake_case PlaceEdgeRow —
// keeps lookup host-neutral for both live DbConnection.db and SnapshotDb fakes.
function lookupEdge(db: SnapshotDb, edgeId: string): PlaceEdgeRow | undefined {
	for (const e of snapshotFromDb(db).movement.edges()) {
		if (e.edge_id === edgeId) return e;
	}
	return undefined;
}

export async function rMoveWrapper(
	actorId: EntityRef,
	edgeId: string,
	snapshotDb: () => SnapshotDb,
	rMove: RMoveFn,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
): Promise<ActorMoveResult> {
	const edgeLookup = lookupEdge(snapshotDb(), edgeId);
	const fromNode = edgeLookup?.from_node_id ?? "";
	const toNode = edgeLookup?.to_node_id ?? "";

	const result = await observeReducerAttempt({
		db: snapshotDb,
		subjectId: actorId,
		invoke: () => rMove({ actorId: actorEntityId(actorId), fromNode, toNode, edgeId }),
		successPredicate: (db) =>
			toNode !== "" && readActorSnapshot(db, actorId)?.current_node_id === toNode,
		collectSnapshot: (db) => readActorSnapshot(db, actorId),
		// Stop waiting the moment the world has promoted this into a walk: the
		// actor cannot arrive within `timeoutMs` and the server has already
		// priced the journey, so burning the full timeout only delays an answer
		// that is available now (feat/travel-eta, 2026-08-18).
		settledEarly: (db) => travelSessionForActor(db as never, actorId) !== null,
		timeoutMs,
		pollMs,
		tickEstimator,
		provenanceBuffer,
		// Both instant-move success and movement rejection are emitted with
		// next_provenance_id(ctx, "r_move") in layer2/r_move.rs. Promoted travel
		// emits a session instead (long_running_move.rs::begin_over_reach_travel).
		// A same-subject claim_released row is an independent clock-sweep or
		// explicit-release event, even if it arrives after this attempt's baseline.
		provenancePredicate: (row) => row.id.startsWith("r_move:"),
	});

	if (result.status === "success") {
		return {
			status: "success",
			actor_id: actorId,
			edge_id: edgeId,
			from_node: fromNode,
			to_node: toNode,
			// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
			actor_snapshot: result.snapshot!,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		} satisfies ActorMoveSuccess;
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			actor_id: actorId,
			edge_id: edgeId,
			from_node: fromNode,
			to_node: toNode,
			actor_snapshot: result.snapshot,
			reason: `r_move rejected by server`,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		} satisfies ActorMoveRejected;
	}

	// The actor is not at `toNode` — but "did not arrive" and "was refused" are
	// not the only two answers. A move longer than the actor's reach is ADMITTED
	// and promoted into a session that walks them one tick at a time, and the
	// server priced that walk at admission. Ask before reporting a non-arrival:
	// otherwise every long journey is reported as a 2000ms timeout on a move
	// that in fact succeeded in starting (feat/travel-eta, 2026-08-18).
	const travel = travelSessionForActor(snapshotDb() as never, actorId);
	if (travel !== null) {
		return {
			status: "travelling",
			actor_id: actorId,
			edge_id: edgeId,
			from_node: fromNode,
			to_node: toNode,
			actor_snapshot: result.snapshot,
			arrives_in_ticks: Number(travel.arrivesInTicks),
			arrives_at_tick: Number(travel.arrivesAtTick),
			session_id: String(travel.sessionId),
			reason:
				`travelling to '${toNode}' — arrives in ${travel.arrivesInTicks} ` +
				`tick${travel.arrivesInTicks === 1n ? "" : "s"} (at tick ${travel.arrivesAtTick})`,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		} satisfies ActorMoveTravelling;
	}

	if (result.status === "unobserved_timeout") {
		return {
			status: "unobserved_timeout",
			actor_id: actorId,
			edge_id: edgeId,
			from_node: fromNode,
			to_node: toNode,
			actor_snapshot: result.snapshot,
			reason: `actor '${actorId}' did not reach '${toNode}' within ${timeoutMs}ms`,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		} satisfies ActorMoveUnobservedTimeout;
	}

	return {
		status: result.status,
		actor_id: actorId,
		edge_id: edgeId,
		from_node: fromNode,
		to_node: toNode,
		actor_snapshot: result.snapshot,
		reason: `actor '${actorId}' did not reach '${toNode}' within ${timeoutMs}ms`,
		provenance: result.provenance ?? undefined,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	} satisfies ActorMoveUnobservedNoProvenance | ActorMoveUnobservable;
}
