// Per-reducer wrapper for r_session_close.
// Success predicate: the existing session row disappears or reaches the
// requested terminal lifecycle in the subscribed session table.

import type { DbConnection } from "@spellkave/bindings";
import type { SnapshotDb } from "../../connection";
import { observeReducerAttempt } from "../../provenance";
import type { DriverToken } from "../driver_control";
import type { ProvenanceRingBuffer } from "../provenance_buffer";
import type { TickIntervalEstimator } from "../tick_cadence";
import { firstPopulatedHandle } from "./session_lookup";

export type RSessionCloseFn = DbConnection["reducers"]["rSessionClose"];

export interface SessionCloseSnapshot {
	sessionId: bigint;
	lifecycle: string;
	lastAdvancedAt: bigint;
}

export interface SessionCloseResult {
	status:
		| "success"
		| "rejected"
		| "unobserved_timeout"
		| "unobserved_no_provenance"
		| "unobservable";
	sessionId: bigint;
	outcome: string;
	session?: SessionCloseSnapshot;
	reason?: string;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export async function rSessionCloseWrapper(
	actorId: string,
	sessionId: bigint,
	outcome: string,
	snapshotDb: () => SnapshotDb,
	rSessionClose: RSessionCloseFn,
	timeoutMs: number,
	pollMs: number,
	tickEstimator?: TickIntervalEstimator,
	provenanceBuffer?: ProvenanceRingBuffer,
	driverToken?: DriverToken,
	driverTokens?: readonly DriverToken[],
): Promise<SessionCloseResult> {
	// Copy the observations supplied with this decision. Never refresh them
	// from the live reader during dispatch or while polling the outcome.
	const frozenToken = driverToken ? Object.freeze({ ...driverToken }) : undefined;
	const frozenTokens = driverTokens?.map((token) => Object.freeze({ ...token }));
	const existedBeforeInvoke = findSession(snapshotDb(), sessionId) !== undefined;
	const result = await observeReducerAttempt<SessionCloseSnapshot | null>({
		db: snapshotDb,
		subjectId: actorId,
		invoke: () =>
			rSessionClose({
				sessionId,
				outcome,
				...(frozenToken ? { driverToken: frozenToken } : {}),
				...(frozenTokens ? { driverTokens: frozenTokens } : {}),
			}),
		successPredicate: (db) => {
			if (!existedBeforeInvoke) return false;
			const row = findSession(db, sessionId);
			// Current server behavior updates the session in place; disappearance is
			// reserved for a future terminal-row cleanup path.
			return row === undefined || row.lifecycle === outcome;
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
			outcome,
			session: result.snapshot ?? undefined,
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	if (result.status === "rejected") {
		return {
			status: "rejected",
			sessionId,
			outcome,
			session: result.snapshot ?? undefined,
			reason: "r_session_close rejected by server",
			lagWarning: result.lagWarning,
			observedAtTick: result.observedAtTick,
		};
	}

	return {
		status: result.status,
		sessionId,
		outcome,
		session: result.snapshot ?? undefined,
		reason: `r_session_close for session '${sessionId}' not observed within ${timeoutMs}ms`,
		lagWarning: result.lagWarning,
		observedAtTick: result.observedAtTick,
	};
}

function findSession(db: SnapshotDb, sessionId: bigint): SessionCloseSnapshot | undefined {
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
