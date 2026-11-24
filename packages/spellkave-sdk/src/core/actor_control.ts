import type { SnapshotDb, SpellkaveSession } from "../connection";
import { resolveActor } from "./actor";
import { createActorClientQueryMethods } from "./actor_control_query_methods";
import { createActorClientReactionMethods } from "./actor_control_reaction_methods";
import { createActorClientSenseMethods } from "./actor_control_sense_methods";
import { type ActorClientSource, actorReaders, toConnDb } from "./actor_control_source";
import { createActorSessionMethods } from "./actor_session_methods";
import { freezeDriverReducers } from "./driver_control";
import { parseEntityIdRef } from "./readers/_helpers";
import { readActorIdentityBindings, readActorPrincipals } from "./readers/actors_and_bodies";
import { readWorldStatus } from "./readers/world_status";
import type { TickIntervalEstimator } from "./tick_cadence";

export type {
	ActorClientReducers,
	ActorClientSource,
	RActorWakeUpFn,
	RAdvanceTurnFn,
	RInscribeTraceFn,
	RManipulateFn,
	RMoveFn,
	RReactFn,
	RReleaseClaimFn,
	RSenseFn,
	RSessionCloseFn,
	RSessionMoveFn,
	RSessionOpenFn,
} from "./actor_control_source";
export type {
	ActorAttemptStatus,
	ActorClient,
	ActorClientOptions,
	ActorManipulateRejected,
	ActorManipulateResult,
	ActorManipulateSuccess,
	ActorManipulateUnobservedNoProvenance,
	ActorManipulateUnobservedTimeout,
	ActorMoveCall,
	ActorMoveRejected,
	ActorMoveResult,
	ActorMoveSuccess,
	ActorMoveUnobservedNoProvenance,
	ActorMoveUnobservedTimeout,
	ActorReactResult,
	ActorReleaseClaimResult,
	ActorSenseRejected,
	ActorSenseResult,
	ActorSenseSuccess,
	ActorSenseUnobservedNoProvenance,
	ActorSenseUnobservedTimeout,
	ActorWakeUpResult,
	AdjacentMove,
	AdvanceTurnResult,
	InscribeTraceResult,
	SessionCloseResult,
	SessionMoveResult,
	SessionOpenResult,
	VisibilityClass,
} from "./types";

import type { ActorClient, ActorClientOptions } from "./types";

/** Default bounded-observation timeout and snapshot-host fallback poll (`observeReducerAttempt`'s own
 * shape, `provenance.ts`) — exported (sk-0m4.73) so a caller outside this
 * module can reuse the SAME default a fresh `ActorClient` would compute,
 * instead of hand-rolling a second hard-coded latency. */
export const DEFAULT_OBSERVATION_TIMEOUT_MS = 2_000;
export const DEFAULT_OBSERVATION_POLL_MS = 40;
const TIMEOUT_MULTIPLIER = 2;
const TIMEOUT_MIN_MS = 200;

/**
 * The exact timeout `createActorClient` would compute for `estimator`/
 * `overrideMs` — factored out (sk-0m4.73) so a host that wants "the same
 * default this actor's ActorClient uses" (e.g. the shared tool runtime reply
 * window) can call this instead of re-deriving the tick-scaling formula.
 *
 * `overrideMs` wins when supplied (clamped to >=1ms). Otherwise a *measured*
 * estimator cadence (five tick deltas) tick-scales (`2 × estimateMs()`,
 * floored at `TIMEOUT_MIN_MS`). A cold estimator reports its 200ms floor,
 * which is worse than having no estimator — treat it as unknown. When the
 * world has published `config.tick_interval_secs`, that authored cadence
 * scales the same way and beats the no-estimator default. Otherwise
 * {@link DEFAULT_OBSERVATION_TIMEOUT_MS}.
 */
export function resolveObservationTimeoutMs(
	estimator?: TickIntervalEstimator,
	overrideMs?: number,
	authoredTickIntervalMs?: number,
): number {
	if (overrideMs !== undefined) return Math.max(1, overrideMs);
	const measured = measuredCadenceMs(estimator);
	if (measured !== undefined) {
		return Math.max(TIMEOUT_MULTIPLIER * measured, TIMEOUT_MIN_MS);
	}
	if (
		authoredTickIntervalMs !== undefined &&
		Number.isFinite(authoredTickIntervalMs) &&
		authoredTickIntervalMs > 0
	) {
		return Math.max(TIMEOUT_MULTIPLIER * authoredTickIntervalMs, DEFAULT_OBSERVATION_TIMEOUT_MS);
	}
	return DEFAULT_OBSERVATION_TIMEOUT_MS;
}

function measuredCadenceMs(estimator?: TickIntervalEstimator): number | undefined {
	if (estimator === undefined) return undefined;
	// Duck-typed test doubles may only implement `estimateMs`. A missing
	// `hasMeasuredCadence` means the caller already supplied a cadence.
	if (typeof estimator.hasMeasuredCadence === "function" && !estimator.hasMeasuredCadence()) {
		return undefined;
	}
	return estimator.estimateMs();
}

function authoredTickIntervalMs(db: SnapshotDb): number | undefined {
	const secs = readWorldStatus(db)?.tickIntervalSecs;
	if (secs === undefined || !Number.isFinite(secs) || secs <= 0) return undefined;
	return secs * 1000;
}

export function createActorClient(
	source: ActorClientSource,
	actorId: string,
	options?: ActorClientOptions,
): ActorClient {
	const src = toConnDb(source);
	const frozenOptions = options ? freezeDriverReducers(options, options.driverToken) : options;
	const snapshotDb = () => src.db;
	const estimator =
		options?.tickEstimator ??
		("estimator" in source
			? (source as { estimator?: TickIntervalEstimator }).estimator
			: undefined);
	const provenanceBuffer =
		"conn" in source ? (source as SpellkaveSession).provenanceBuffer : undefined;
	const pollMs =
		options?.observationPollMs !== undefined
			? Math.max(1, options.observationPollMs)
			: DEFAULT_OBSERVATION_POLL_MS;
	const resolvedActorId = () =>
		resolveActor(actorId, actorReaders(snapshotDb()).actors).body_entity_id;
	const resolvedManipulationActorId = () => {
		const wanted = parseEntityIdRef(actorId);
		const owned = new Set(
			readActorIdentityBindings(snapshotDb())
				.filter((row) => row.role !== "co-pilot")
				.map((row) => row.actor_id),
		);
		const principal = readActorPrincipals(snapshotDb()).find(
			(row) =>
				wanted !== undefined &&
				String(row.current_body) === String(wanted) &&
				owned.has(row.actor_id),
		);
		// A caller-owned placeless presence can act; movement keeps its spatial resolver.
		return principal?.current_body ?? resolvedActorId();
	};

	const context = {
		reducers: src.reducers ? freezeDriverReducers(src.reducers, options?.driverToken) : undefined,
		options: frozenOptions,
		actorId,
		resolvedActorId,
		resolvedManipulationActorId,
		snapshotDb,
		get timeoutMs() {
			// Recompute per attempt: a cold estimator at connect must not freeze
			// a 400ms window for the life of the client, and config.tick_interval_secs
			// is already in the snapshot at session.ready.
			return resolveObservationTimeoutMs(
				estimator,
				options?.observationTimeoutMs,
				authoredTickIntervalMs(snapshotDb()),
			);
		},
		pollMs,
		estimator,
		provenanceBuffer,
	};

	return {
		withDriverToken: (token) =>
			createActorClient(source, actorId, { ...options, driverToken: token }),
		actorId,
		...createActorClientQueryMethods(context),
		...createActorSessionMethods(context),
		...createActorClientSenseMethods(context),
		...createActorClientReactionMethods(context),
	};
}

export type { ControlReducerPort, DriverToken } from "./driver_control";
