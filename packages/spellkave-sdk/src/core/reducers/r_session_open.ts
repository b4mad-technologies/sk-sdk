// Per-reducer wrapper for r_session_open (real wrapper — Phase 9 scenario A).
// Success predicate: a session row with matching sessionDefId appears in the
// session table cache (subscribed via READER_SCOPED_TABLES).

import type { DbConnection } from "@spellkave/bindings";
import type { SnapshotDb } from "../../connection";
import { observeReducerAttempt } from "../../provenance";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import type { TickIntervalEstimator } from "../tick_cadence";
import { findSessionId } from "./session_lookup";
import { actorEntityId } from "./transport";

type RSessionOpenFn = DbConnection["reducers"]["rSessionOpen"];

export interface SessionOpenResult {
	status:
		| "success"
		| "rejected"
		| "unobserved_timeout"
		| "unobserved_no_provenance"
		| "unobservable";
	sessionDefId: string;
	/** Session id from the session table row, if observable. */
	sessionId?: bigint;
	reason?: string;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export async function rSessionOpenWrapper(
	actorId: string,
	sessionDefId: string,
	participantsCsv: string,
	snapshotDb: () => SnapshotDb,
	rSessionOpen: RSessionOpenFn,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
): Promise<SessionOpenResult> {
	const participants = participantIds(actorId, participantsCsv);
	const result = await observeReducerAttempt<bigint | null>({
		db: snapshotDb,
		subjectId: actorId,
		invoke: () =>
			rSessionOpen({ driverTokens: [], sessionDefId, participants, gridExtentJson: "" }),
		successPredicate: (db) => findSessionId(db, sessionDefId, participants) !== undefined,
		collectSnapshot: (db) => findSessionId(db, sessionDefId, participants) ?? null,
		timeoutMs,
		pollMs,
		tickEstimator,
		provenanceBuffer,
	});

	if (result.status === "success") {
		return {
			status: "success",
			sessionDefId,
			sessionId: result.snapshot ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			sessionDefId,
			reason: `r_session_open rejected by server`,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	return {
		status: result.status,
		sessionDefId,
		reason: `r_session_open for '${sessionDefId}' not observed within ${timeoutMs}ms`,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	};
}

function participantIds(actorId: string, participantsCsv: string): bigint[] {
	const explicit = participantsCsv
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0)
		.map(actorEntityId);
	return explicit.length > 0 ? explicit : [actorEntityId(actorId)];
}
