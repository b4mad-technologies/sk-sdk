// Per-reducer wrapper for r_release_claim (multiplayer claim/lock contention).
// Provenance-observed: the claim module emits evaluation_provenance, so success
// is read from the server's verdict rather than a bespoke state predicate
// (no client-side validation — @spellkave/sdk CLAUDE.md §1).

import type { DbConnection } from "@spellkave/bindings";
import type { SnapshotDb } from "../../connection";
import { observeReducerAttempt } from "../../provenance";
import type { EntityRef } from "../ids";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import type { TickIntervalEstimator } from "../tick_cadence";

type RReleaseClaimFn = DbConnection["reducers"]["rReleaseClaim"];

export interface ActorReleaseClaimResult {
	status:
		| "success"
		| "rejected"
		| "unobserved_timeout"
		| "unobserved_no_provenance"
		| "unobservable";
	actor_id: EntityRef;
	target_id: string;
	reason?: string;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export async function rReleaseClaimWrapper(
	actorId: EntityRef,
	targetId: string,
	snapshotDb: () => SnapshotDb,
	rReleaseClaim: RReleaseClaimFn,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
): Promise<ActorReleaseClaimResult> {
	const result = await observeReducerAttempt<null>({
		db: snapshotDb,
		subjectId: actorId,
		invoke: () => rReleaseClaim({ actorId, targetId }),
		successPredicate: () => false,
		collectSnapshot: () => null,
		timeoutMs,
		pollMs,
		tickEstimator,
		provenanceBuffer,
		successOnProvenance: true,
	});

	if (result.status === "success") {
		return {
			status: "success",
			actor_id: actorId,
			target_id: targetId,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			actor_id: actorId,
			target_id: targetId,
			reason: "r_release_claim rejected by server",
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	return {
		status: result.status,
		actor_id: actorId,
		target_id: targetId,
		reason: `r_release_claim on '${targetId}' not observed within ${timeoutMs}ms`,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	};
}
