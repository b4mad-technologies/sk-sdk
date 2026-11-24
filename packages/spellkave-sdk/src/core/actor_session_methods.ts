import type { SnapshotDb } from "../connection";
import { observeReducerAttempt } from "../provenance";
import type {
	ActorClientReducers,
	RAdvanceTurnFn,
	RSessionCloseFn,
	RSessionMoveFn,
	RSessionOpenFn,
} from "./actor_control_source";
import type { DriverToken } from "./driver_control";
import type { ProvenanceRingBuffer } from "./provenance_buffer";
import { readActiveSessionWithRosterForParticipant } from "./readers/session";
import { rSessionCloseWrapper } from "./reducers/r_session_close";
import { rSessionMoveWrapper } from "./reducers/r_session_move";
import { rSessionOpenWrapper } from "./reducers/r_session_open";
import { firstPopulatedHandle } from "./reducers/session_lookup";
import type { TickIntervalEstimator } from "./tick_cadence";
import type {
	ActorClientOptions,
	AdvanceTurnResult,
	SessionCloseResult,
	SessionMoveResult,
	SessionOpenResult,
} from "./types";

export interface ActorSessionMethodContext {
	reducers?: ActorClientReducers;
	options?: ActorClientOptions;
	resolvedActorId: () => string;
	snapshotDb: () => SnapshotDb;
	timeoutMs: number;
	pollMs: number;
	estimator?: TickIntervalEstimator;
	provenanceBuffer?: ProvenanceRingBuffer;
}

export function createActorSessionMethods(context: ActorSessionMethodContext) {
	const rSessionOpen: RSessionOpenFn =
		context.options?.rSessionOpen ??
		context.reducers?.rSessionOpen ??
		(async () => {
			throw new Error("rSessionOpen reducer is not configured");
		});
	const rSessionClose: RSessionCloseFn =
		context.options?.rSessionClose ??
		context.reducers?.rSessionClose ??
		(async () => {
			throw new Error("rSessionClose reducer is not configured");
		});
	const rSessionMove: RSessionMoveFn =
		context.options?.rSessionMove ??
		context.reducers?.rSessionMove ??
		(async () => {
			throw new Error("rSessionMove reducer is not configured");
		});
	const rAdvanceTurn: RAdvanceTurnFn | undefined =
		context.options?.rAdvanceTurn ?? context.reducers?.rAdvanceTurn;

	const advanceTurn = async (sessionId: bigint): Promise<AdvanceTurnResult> => {
		if (rAdvanceTurn === undefined) {
			return { status: "rejected", sessionId, reason: "rAdvanceTurn reducer is not configured" };
		}
		if (sessionId !== 0n) {
			const before = findSession(context.snapshotDb(), sessionId);
			const result = await observeReducerAttempt<AdvanceTurnSnapshot | null>({
				db: context.snapshotDb,
				subjectId: context.resolvedActorId(),
				invoke: () => rAdvanceTurn({ sessionId }),
				successPredicate: (db) => {
					const after = findSession(db, sessionId);
					if (before === undefined) return after !== undefined;
					// An advance is observed when the turn moved to someone else, the
					// session re-stamped its advance tick, the advance terminated the
					// session (lifecycle), or the turn counter moved. The last two
					// matter under an authored turn_eligibility_pred (ADR-0143): when
					// the caller is the only eligible participant it is handed its own
					// turn back in the same tick, so neither currentActor nor
					// lastAdvancedAt changes.
					return (
						after !== undefined &&
						(after.currentActor !== before.currentActor ||
							after.lastAdvancedAt !== before.lastAdvancedAt ||
							after.lifecycle !== before.lifecycle ||
							after.turn !== before.turn)
					);
				},
				collectSnapshot: (db) => findSession(db, sessionId) ?? null,
				timeoutMs: context.timeoutMs,
				pollMs: context.pollMs,
				tickEstimator: context.estimator,
				provenanceBuffer: context.provenanceBuffer,
				telemetry: context.options?.reducerAttemptTelemetry,
				telemetryAttributes: {
					"spellkave.reducer": "r_advance_turn",
					"spellkave.actor_id": context.resolvedActorId(),
				},
			});
			if (result.status === "success") return { status: "success", sessionId };
			return {
				status: "rejected",
				sessionId,
				reason:
					result.status === "rejected"
						? "r_advance_turn rejected by server"
						: `r_advance_turn for session '${sessionId}' not observed within ${context.timeoutMs}ms`,
			};
		}
		try {
			await rAdvanceTurn({ sessionId });
			return { status: "success", sessionId };
		} catch (err) {
			return { status: "rejected", sessionId, reason: String(err) };
		}
	};

	return {
		sessionOpen(sessionDefId: string, participantsCsv = ""): Promise<SessionOpenResult> {
			return rSessionOpenWrapper(
				context.resolvedActorId(),
				sessionDefId,
				participantsCsv,
				context.snapshotDb,
				rSessionOpen,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
			);
		},
		sessionClose(
			sessionId: bigint,
			outcome: string,
			driverTokens?: readonly DriverToken[],
		): Promise<SessionCloseResult> {
			return rSessionCloseWrapper(
				context.resolvedActorId(),
				sessionId,
				outcome,
				context.snapshotDb,
				rSessionClose,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
				context.options?.driverToken,
				driverTokens,
			);
		},
		sessionMove(sessionId: bigint, moveTemplateId: string): Promise<SessionMoveResult> {
			return rSessionMoveWrapper(
				context.resolvedActorId(),
				sessionId,
				moveTemplateId,
				context.snapshotDb,
				rSessionMove,
				context.timeoutMs,
				context.pollMs,
				context.estimator,
				context.provenanceBuffer,
			);
		},
		advanceTurn,
		async endTurn(): Promise<AdvanceTurnResult> {
			const actorId = context.resolvedActorId();
			const active = readActiveSessionWithRosterForParticipant(context.snapshotDb(), actorId);
			if (active === null) {
				return { status: "rejected", sessionId: 0n, reason: "no active participant session" };
			}
			if (active.session.currentActor !== actorId) {
				return {
					status: "rejected",
					sessionId: active.session.sessionId,
					reason: "not your turn",
				};
			}
			return advanceTurn(active.session.sessionId);
		},
	};
}

interface AdvanceTurnSnapshot {
	currentActor: string;
	lastAdvancedAt: bigint;
	lifecycle: string;
	/** The world turn counter when the caller's cache carries the turn_state
	 * row scoped to this session; undefined otherwise. */
	turn: bigint | undefined;
}

function findSession(db: SnapshotDb, sessionId: bigint): AdvanceTurnSnapshot | undefined {
	const handle = firstPopulatedHandle(db, "visible_session", "session");
	if (!handle) return undefined;
	for (const raw of handle.iter()) {
		const r = raw as unknown as {
			sessionId: unknown;
			currentActor: string;
			lastAdvancedAt: unknown;
			lifecycle?: string;
		};
		if (toBigInt(r.sessionId) === sessionId) {
			return {
				currentActor: r.currentActor,
				lastAdvancedAt: toBigInt(r.lastAdvancedAt),
				lifecycle: r.lifecycle ?? "",
				turn: findSessionTurn(db, sessionId),
			};
		}
	}
	return undefined;
}

function findSessionTurn(db: SnapshotDb, sessionId: bigint): bigint | undefined {
	const handle = firstPopulatedHandle(db, "visible_turn_state", "turn_state");
	if (!handle) return undefined;
	for (const raw of handle.iter()) {
		const r = raw as unknown as { turn: unknown; scopeSessionId?: unknown };
		if (r.scopeSessionId !== undefined && toBigInt(r.scopeSessionId) === sessionId) {
			return toBigInt(r.turn);
		}
	}
	return undefined;
}

function toBigInt(value: unknown): bigint {
	return typeof value === "bigint" ? value : BigInt(String(value ?? 0));
}
