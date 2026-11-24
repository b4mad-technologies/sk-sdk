import type { SnapshotDb } from "../connection";
import type { ActorClientReducers } from "./actor_control_source";
import type { EntityId } from "./ids";
import type { ProvenanceRingBuffer } from "./provenance_buffer";
import { rActorWakeUpWrapper } from "./reducers/r_actor_wake_up";
import { type RReactFn, rReactWrapper } from "./reducers/r_react";
import { rReleaseClaimWrapper } from "./reducers/r_release_claim";
import type { TickIntervalEstimator } from "./tick_cadence";
import type { ActorClientOptions, ActorReactResult } from "./types";

/** Shared plumbing for the react/releaseClaim/wakeUp half of ActorClient. */
export interface ActorReactionMethodContext {
	reducers?: ActorClientReducers;
	options?: ActorClientOptions;
	resolvedActorId: () => EntityId;
	resolvedManipulationActorId: () => EntityId;
	snapshotDb: () => SnapshotDb;
	timeoutMs: number;
	pollMs: number;
	estimator?: TickIntervalEstimator;
	provenanceBuffer?: ProvenanceRingBuffer;
}

export function createActorClientReactionMethods(context: ActorReactionMethodContext) {
	const rReact: RReactFn =
		context.options?.rReact ??
		context.reducers?.rReact ??
		(async () => {
			throw new Error("rReact reducer is not configured");
		});
	const rReleaseClaim =
		context.options?.rReleaseClaim ??
		context.reducers?.rReleaseClaim ??
		(async () => {
			throw new Error("rReleaseClaim reducer is not configured");
		});
	const rActorWakeUp =
		context.options?.rActorWakeUp ??
		context.reducers?.rActorWakeUp ??
		(async () => {
			throw new Error("rActorWakeUp reducer is not configured");
		});

	return {
		react(
			pendingId: bigint,
			responseIntent: string,
			selectedDrawIndex?: number,
		): Promise<ActorReactResult> {
			return rReactWrapper(
				context.resolvedActorId(),
				pendingId,
				responseIntent,
				context.snapshotDb,
				rReact,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
				selectedDrawIndex,
			);
		},
		releaseClaim(targetId: string) {
			return rReleaseClaimWrapper(
				context.resolvedManipulationActorId(),
				targetId,
				context.snapshotDb,
				rReleaseClaim,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
			);
		},
		wakeUp() {
			return rActorWakeUpWrapper(context.resolvedActorId(), rActorWakeUp);
		},
	};
}
