import type { DbConnection } from "@spellkave/bindings";
import type { SnapshotDb } from "../../connection";
import { observeReducerAttempt } from "../../provenance";
import type { EntityRef } from "../ids";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import type { TickIntervalEstimator } from "../tick_cadence";
import type { ActorSenseResult } from "../types";
import { actorEntityId } from "./transport";

export type RSenseFn = DbConnection["reducers"]["rSense"];

export async function rSenseWrapper(
	actorId: EntityRef,
	queryKind: string,
	visibilityClass: string,
	snapshotDb: () => SnapshotDb,
	rSense: RSenseFn,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
): Promise<ActorSenseResult> {
	const result = await observeReducerAttempt<null>({
		db: snapshotDb,
		subjectId: actorId,
		invoke: () => rSense({ actorId: actorEntityId(actorId), queryKind, visibilityClass }),
		successPredicate: () => false,
		collectSnapshot: () => null,
		timeoutMs,
		pollMs,
		tickEstimator,
		successOnProvenance: true,
		provenanceBuffer,
	});

	if (result.status === "success") {
		return {
			status: "success",
			actor_id: actorId,
			query_kind: queryKind,
			visibility_class: visibilityClass,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			actor_id: actorId,
			query_kind: queryKind,
			visibility_class: visibilityClass,
			reason: "r_sense rejected by server",
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "unobserved_timeout") {
		return {
			status: "unobserved_timeout",
			actor_id: actorId,
			query_kind: queryKind,
			visibility_class: visibilityClass,
			reason: `r_sense '${queryKind}' not observed within ${timeoutMs}ms`,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	return {
		status: result.status,
		actor_id: actorId,
		query_kind: queryKind,
		visibility_class: visibilityClass,
		reason: `r_sense '${queryKind}' not observed within ${timeoutMs}ms`,
		provenance: result.provenance ?? undefined,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	};
}
