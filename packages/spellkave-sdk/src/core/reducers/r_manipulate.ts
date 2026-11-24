// Per-reducer wrapper for r_manipulate.
// Ported from actor_control.ts; Phase 4 lagWarning + observedAtTick threaded.

import type { SnapshotDb } from "../../connection";
import { observeReducerAttempt, type ReducerAttemptTelemetry } from "../../provenance";
import type { RManipulateFn } from "../actor_control_source";
import type { EntityRef } from "../ids";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import type { TickIntervalEstimator } from "../tick_cadence";
import type {
	ActorManipulateRejected,
	ActorManipulateResult,
	ActorManipulateSuccess,
	ActorManipulateUnobservable,
	ActorManipulateUnobservedNoProvenance,
	ActorManipulateUnobservedTimeout,
} from "../types";
import { manipulationArgsFromJson } from "./manipulation_args";
import { manipulationReceipt } from "./manipulation_receipt";
import { actorEntityId, targetRefFromString } from "./transport";

export async function rManipulateWrapper<T>(
	actorId: EntityRef,
	targetId: string,
	actionId: string,
	argsJson: string,
	snapshotDb: () => SnapshotDb,
	rManipulate: RManipulateFn,
	successPredicate: (db: SnapshotDb) => boolean,
	collectSnapshot: (db: SnapshotDb) => T | null,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
	successOnProvenance = false,
	telemetry?: ReducerAttemptTelemetry,
): Promise<ActorManipulateResult<T>> {
	// Keep malformed JSON on the existing observed-rejection path. Only a
	// well-formed enrollment request requires protocol discovery before dispatch.
	let args: ReturnType<typeof manipulationArgsFromJson> | undefined;
	try {
		args = manipulationArgsFromJson(argsJson);
	} catch {
		/* invoke reports parsing failure */
	}
	if (args?.participantEntityIds !== undefined) {
		const db = snapshotDb();
		const contract = db.manipulationContract ?? db.manipulation_contract;
		if (
			![...(contract?.iter() ?? [])].some(
				(row) =>
					row.argumentId === "participant_entity_ids" ||
					row.argument_id === "participant_entity_ids",
			)
		) {
			throw new Error(
				"OpenSession: module does not support participant_entity_ids; publish the compatible module before activating session setup",
			);
		}
	}
	const receipt = manipulationReceipt(snapshotDb(), actorId, () => args);
	const result = await (async () => {
		try {
			return await observeReducerAttempt<T>({
				db: snapshotDb,
				subjectId: actorId,
				invoke: async () => {
					try {
						args ??= manipulationArgsFromJson(argsJson);
						await rManipulate({
							actorId: actorEntityId(actorId),
							targetRef: targetRefFromString(targetId),
							actionId,
							args,
						});
						receipt.settle();
					} catch (error) {
						receipt.fail();
						throw error;
					}
				},
				provenancePredicate: receipt.matches,
				settledEarly: (_db, invokeSettled) => invokeSettled && receipt.unattributable(),
				successPredicate: (db) =>
					receipt.succeeded() && (successOnProvenance || successPredicate(db)),
				collectSnapshot,
				timeoutMs,
				pollMs,
				tickEstimator,
				provenanceBuffer,
				successOnProvenance: false,
				telemetry,
				telemetryAttributes: {
					"spellkave.reducer": "r_manipulate",
					"spellkave.actor_id": actorId,
					"spellkave.action_id": actionId,
					"spellkave.target_ref": targetId,
				},
			});
		} finally {
			receipt.close();
		}
	})();

	if (result.status === "success") {
		return {
			status: "success",
			actor_id: actorId,
			target_id: targetId,
			action_id: actionId,
			// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
			snapshot: result.snapshot!,
			// #1968 B-9: was dropped here — every other ActorManipulateResult
			// variant already carries it (see rejected/unobserved branches below).
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		} satisfies ActorManipulateSuccess<T>;
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			actor_id: actorId,
			target_id: targetId,
			action_id: actionId,
			snapshot: result.snapshot,
			reason: `r_manipulate rejected by server`,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		} satisfies ActorManipulateRejected<T>;
	}

	if (result.status === "unobserved_timeout") {
		return {
			status: "unobserved_timeout",
			actor_id: actorId,
			target_id: targetId,
			action_id: actionId,
			snapshot: result.snapshot,
			reason: `manipulate '${actionId}' on '${targetId}' not observed within ${timeoutMs}ms`,
			provenance: result.provenance ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		} satisfies ActorManipulateUnobservedTimeout<T>;
	}

	return {
		status: result.status,
		actor_id: actorId,
		target_id: targetId,
		action_id: actionId,
		snapshot: result.snapshot,
		reason:
			result.status === "unobservable"
				? `manipulate '${actionId}' on '${targetId}' settled without an attributable receipt`
				: `manipulate '${actionId}' on '${targetId}' not observed within ${timeoutMs}ms`,
		provenance: result.provenance ?? undefined,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	} satisfies ActorManipulateUnobservedNoProvenance<T> | ActorManipulateUnobservable<T>;
}
