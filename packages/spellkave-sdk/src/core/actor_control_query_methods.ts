import type { SnapshotDb } from "../connection";
import { resolveActor } from "./actor";
import { type ActorClientReducers, actorReaders } from "./actor_control_source";
import type { EntityId } from "./ids";
import { listAdjacentMoves } from "./movement";
import type { ProvenanceRingBuffer } from "./provenance_buffer";
import { readActorSnapshot } from "./readers/actor_snapshot";
import { readLocationSnapshot } from "./readers/location_snapshot";
import { suggestNextAction } from "./readers/suggest_next_action";
import { rManipulateWrapper } from "./reducers/r_manipulate";
import { rMoveWrapper } from "./reducers/r_move";
import type { TickIntervalEstimator } from "./tick_cadence";
import type { ActorClientOptions, ActorManipulateResult, ActorMoveResult } from "./types";

/** Shared plumbing for the read/query + move/manipulate half of ActorClient. */
export interface ActorQueryMethodContext {
	reducers?: ActorClientReducers;
	options?: ActorClientOptions;
	actorId: string;
	resolvedActorId: () => EntityId;
	resolvedManipulationActorId: () => EntityId;
	snapshotDb: () => SnapshotDb;
	timeoutMs: number;
	pollMs: number;
	estimator?: TickIntervalEstimator;
	provenanceBuffer?: ProvenanceRingBuffer;
}

export function createActorClientQueryMethods(context: ActorQueryMethodContext) {
	const rMove =
		context.options?.rMove ??
		context.reducers?.rMove ??
		(async () => {
			throw new Error("rMove reducer is not configured");
		});
	const rManipulate =
		context.options?.rManipulate ??
		context.reducers?.rManipulate ??
		(async () => {
			throw new Error("rManipulate reducer is not configured");
		});

	return {
		actorSnapshot() {
			const snap = readActorSnapshot(context.snapshotDb(), context.resolvedActorId());
			if (!snap)
				throw new Error(
					`actor '${context.actorId}' not found in live actor_spatial_location — fail closed`,
				);
			return snap;
		},
		locationSnapshot() {
			const a = resolveActor(context.actorId, actorReaders(context.snapshotDb()).actors);
			return a.current_node_id
				? readLocationSnapshot(context.snapshotDb(), a.current_node_id)
				: null;
		},
		adjacentMoves() {
			const s = actorReaders(context.snapshotDb());
			return listAdjacentMoves(resolveActor(context.actorId, s.actors), s.movement);
		},
		suggestNextAction() {
			return suggestNextAction(context.snapshotDb(), context.resolvedActorId());
		},
		move: (edgeId: string): Promise<ActorMoveResult> =>
			rMoveWrapper(
				context.resolvedActorId(),
				edgeId,
				context.snapshotDb,
				rMove,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
			),
		manipulate<T>(
			targetId: string,
			actionId: string,
			argsJson: string,
			sp: (db: SnapshotDb) => boolean,
			cs: (db: SnapshotDb) => T | null,
		): Promise<ActorManipulateResult<T>> {
			return rManipulateWrapper(
				context.resolvedManipulationActorId(),
				targetId,
				actionId,
				argsJson,
				context.snapshotDb,
				rManipulate,
				sp,
				cs,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
				context.options?.successOnProvenance ?? false,
				context.options?.reducerAttemptTelemetry,
			);
		},
	};
}
