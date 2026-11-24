// Per-reducer wrapper for r_inscribe_trace (#510 — leave-a-mark).
//
// STATE-OBSERVED. The reducer inserts into private `trace`; success is observed
// through subscribed `visible_trace` when the matching row reaches the cache.

import type { DbConnection } from "@spellkave/bindings";
import type { SnapshotDb } from "../../connection";
import { observeReducerAttempt } from "../../provenance";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import type { TickIntervalEstimator } from "../tick_cadence";
import { findTraceId } from "./trace_lookup";

export type RInscribeTraceFn = DbConnection["reducers"]["rInscribeTrace"];

// Derive the VisibilityClass enum shape from the generated reducer accessor's
// argument type rather than reaching into a non-barrel submodule (CLAUDE.md §5,
// §2 — types flow from generated bindings, drift-free).
export type VisibilityClass = Parameters<RInscribeTraceFn>[0]["visibility"];

export interface InscribeTraceResult {
	status:
		| "success"
		| "rejected"
		| "unobserved_timeout"
		| "unobserved_no_provenance"
		| "unobservable";
	kind: string;
	location_ref: string;
	inscribed_by: string;
	/** trace_id of the inscribed row, if observable. */
	trace_id?: bigint;
	reason?: string;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export async function rInscribeTraceWrapper(
	actorId: string,
	kind: string,
	locationKind: string,
	locationRef: string,
	payloadJson: string,
	expiresAtTick: bigint | undefined,
	visibility: VisibilityClass,
	bundleId: string,
	snapshotDb: () => SnapshotDb,
	rInscribeTrace: RInscribeTraceFn,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
): Promise<InscribeTraceResult> {
	const inscribedBy = actorId;
	const result = await observeReducerAttempt<bigint | null>({
		db: snapshotDb,
		subjectId: actorId,
		invoke: () =>
			rInscribeTrace({
				kind,
				locationKind,
				locationRef,
				payloadJson,
				expiresAtTick: expiresAtTick ?? undefined,
				inscribedBy,
				visibility,
				bundleId,
			}),
		successPredicate: (db) => findTraceId(db, kind, locationRef, inscribedBy) !== undefined,
		collectSnapshot: (db) => findTraceId(db, kind, locationRef, inscribedBy) ?? null,
		timeoutMs,
		pollMs,
		tickEstimator,
		provenanceBuffer,
	});

	if (result.status === "success") {
		return {
			status: "success",
			kind,
			location_ref: locationRef,
			inscribed_by: inscribedBy,
			trace_id: result.snapshot ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			kind,
			location_ref: locationRef,
			inscribed_by: inscribedBy,
			reason: "r_inscribe_trace rejected by server",
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	return {
		status: result.status,
		kind,
		location_ref: locationRef,
		inscribed_by: inscribedBy,
		reason: `r_inscribe_trace '${kind}@${locationRef}' not observed within ${timeoutMs}ms`,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	};
}
