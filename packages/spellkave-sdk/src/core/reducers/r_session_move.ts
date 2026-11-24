// Per-reducer wrapper for r_session_move.
// Success predicate: the session row advances from its pre-call lifecycle clock
// or transitions lifecycle, as observed in the subscribed session table.

import type { DbConnection } from "@spellkave/bindings";
import type { SnapshotDb } from "../../connection";
import { observeReducerAttempt } from "../../provenance";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import type { TickIntervalEstimator } from "../tick_cadence";
import { firstPopulatedHandle } from "./session_lookup";

export type RSessionMoveFn = DbConnection["reducers"]["rSessionMove"];

export interface SessionMoveSnapshot {
	sessionId: bigint;
	lifecycle: string;
	lastAdvancedAt: bigint;
}

export interface SessionMoveResult {
	status:
		| "success"
		| "rejected"
		| "unobserved_timeout"
		| "unobserved_no_provenance"
		| "unobservable";
	sessionId: bigint;
	moveTemplateId: string;
	session: SessionMoveSnapshot | null;
	reason?: string;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export async function rSessionMoveWrapper(
	actorId: string,
	sessionId: bigint,
	moveTemplateId: string,
	snapshotDb: () => SnapshotDb,
	rSessionMove: RSessionMoveFn,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
): Promise<SessionMoveResult> {
	const before = findSession(snapshotDb(), sessionId);
	const result = await observeReducerAttempt<SessionMoveSnapshot | null>({
		db: snapshotDb,
		subjectId: actorId,
		invoke: () => rSessionMove({ sessionId, moveTemplateId }),
		successPredicate: (db) => {
			if (before === undefined) return false;
			const row = findSession(db, sessionId);
			if (row === undefined) return false;
			return row.lastAdvancedAt !== before.lastAdvancedAt || row.lifecycle !== before.lifecycle;
		},
		collectSnapshot: (db) => findSession(db, sessionId) ?? null,
		timeoutMs,
		pollMs,
		tickEstimator,
		provenanceBuffer,
	});

	if (result.status === "success") {
		return {
			status: "success",
			sessionId,
			moveTemplateId,
			session: result.snapshot,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			sessionId,
			moveTemplateId,
			session: result.snapshot,
			reason: "r_session_move rejected by server",
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	return {
		status: result.status,
		sessionId,
		moveTemplateId,
		session: result.snapshot,
		reason: `r_session_move '${moveTemplateId}' for session '${sessionId}' not observed within ${timeoutMs}ms`,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	};
}

function findSession(db: SnapshotDb, sessionId: bigint): SessionMoveSnapshot | undefined {
	const handle = firstPopulatedHandle(db, "visible_session", "session");
	if (!handle) return undefined;
	for (const raw of handle.iter()) {
		const r = raw as unknown as { sessionId: unknown; lifecycle: string; lastAdvancedAt: unknown };
		if (toBigInt(r.sessionId) === sessionId) {
			return {
				sessionId,
				lifecycle: r.lifecycle,
				lastAdvancedAt: toBigInt(r.lastAdvancedAt),
			};
		}
	}
	return undefined;
}

function toBigInt(value: unknown): bigint {
	return typeof value === "bigint" ? value : BigInt(String(value ?? 0));
}
