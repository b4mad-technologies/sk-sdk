import type { SnapshotDb } from "../connection";
import type { ActorClientReducers } from "./actor_control_source";
import type { EntityId } from "./ids";
import type { ProvenanceRingBuffer } from "./provenance_buffer";
import {
	type RInscribeTraceFn,
	rInscribeTraceWrapper,
	type VisibilityClass,
} from "./reducers/r_inscribe_trace";
import { type RSenseFn, rSenseWrapper } from "./reducers/r_sense";
import type { TickIntervalEstimator } from "./tick_cadence";
import type { ActorClientOptions, ActorSenseResult, InscribeTraceResult } from "./types";

/** Shared plumbing for the sense + inscribeTrace half of ActorClient. */
export interface ActorSenseMethodContext {
	reducers?: ActorClientReducers;
	options?: ActorClientOptions;
	resolvedActorId: () => EntityId;
	snapshotDb: () => SnapshotDb;
	timeoutMs: number;
	pollMs: number;
	estimator?: TickIntervalEstimator;
	provenanceBuffer?: ProvenanceRingBuffer;
}

export function createActorClientSenseMethods(context: ActorSenseMethodContext) {
	const rSense: RSenseFn =
		context.options?.rSense ??
		context.reducers?.rSense ??
		(async () => {
			throw new Error("rSense reducer is not configured");
		});
	const rInscribeTrace: RInscribeTraceFn =
		context.options?.rInscribeTrace ??
		context.reducers?.rInscribeTrace ??
		(async () => {
			throw new Error("rInscribeTrace reducer is not configured");
		});

	return {
		sense(queryKind: string, visibilityClass: string): Promise<ActorSenseResult> {
			return rSenseWrapper(
				context.resolvedActorId(),
				queryKind,
				visibilityClass,
				context.snapshotDb,
				rSense,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
			);
		},
		inscribeTrace(
			kind: string,
			locationKind: string,
			locationRef: string,
			payloadJson: string,
			visibility: VisibilityClass,
			bundleId: string,
			expiresAtTick?: bigint,
		): Promise<InscribeTraceResult> {
			return rInscribeTraceWrapper(
				context.resolvedActorId(),
				kind,
				locationKind,
				locationRef,
				payloadJson,
				expiresAtTick,
				visibility,
				bundleId,
				context.snapshotDb,
				rInscribeTrace,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
			);
		},
	};
}
