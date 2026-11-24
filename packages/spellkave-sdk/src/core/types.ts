// Shared result types for actor-control verbs.
//
// Extracted from actor_control.ts as part of the D4 mechanical split.
// These discriminated unions are shared across per-reducer wrapper files;
// keeping them here avoids re-exporting via multiple files and prevents drift.
// NOT subject to per-file LOC ceiling (D4, design.md:112).

import type { SnapshotDb } from "../connection";
import type { ProvenanceRow, ReducerAttemptTelemetry } from "../provenance";
import type {
	RActorWakeUpFn,
	RAdvanceTurnFn,
	RManipulateFn,
	RMoveFn,
	RReactFn,
	RReleaseClaimFn,
	RSenseFn,
	RSessionCloseFn,
	RSessionMoveFn,
	RSessionOpenFn,
} from "./actor_control_source";
import type { EntityRef } from "./ids";
import type { ActorSnapshot } from "./readers/actor_snapshot";
import type { LocationSnapshot } from "./readers/location_snapshot";
import type { SuggestedNextAction } from "./readers/suggest_next_action";
import type { ActorWakeUpResult } from "./reducers/r_actor_wake_up";
import type { InscribeTraceResult, VisibilityClass } from "./reducers/r_inscribe_trace";
import type { ActorReleaseClaimResult } from "./reducers/r_release_claim";
import type { SessionCloseResult } from "./reducers/r_session_close";
import type { SessionMoveResult } from "./reducers/r_session_move";
import type { SessionOpenResult } from "./reducers/r_session_open";
import type { TickIntervalEstimator } from "./tick_cadence";

/**
 * Outcome status shared by all actor-control verbs.
 *
 * - `success`    — reducer accepted and the verb's success predicate observed in subscribed state.
 * - `rejected`   — reducer threw or the server emitted a failure `evaluation_provenance` row.
 * - `unobserved_timeout` — observation window expired before success state was observed.
 * - `unobserved_no_provenance` — reducer returned but no success state or provenance row was observed.
 * - `unobservable` — reducer returned but no provenance row was visible to this identity.
 */
export type ActorAttemptStatus =
	| "success"
	| "rejected"
	| "unobserved_timeout"
	| "unobserved_no_provenance"
	| "unobservable";

// ---------------------------------------------------------------------------
// Move result types
// ---------------------------------------------------------------------------

export interface ActorMoveCall {
	actor_id: EntityRef;
	from_node: string;
	to_node: string;
	edge_id: string;
}

export interface ActorMoveSuccess {
	status: "success";
	actor_id: EntityRef;
	edge_id: string;
	from_node: string;
	to_node: string;
	actor_snapshot: ActorSnapshot;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorMoveRejected {
	status: "rejected";
	actor_id: EntityRef;
	edge_id: string;
	from_node?: string;
	to_node?: string;
	actor_snapshot: ActorSnapshot | null;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorMoveUnobservedTimeout {
	status: "unobserved_timeout";
	actor_id: EntityRef;
	edge_id: string;
	from_node: string;
	to_node: string;
	actor_snapshot: ActorSnapshot | null;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorMoveUnobservedNoProvenance {
	status: "unobserved_no_provenance";
	actor_id: EntityRef;
	edge_id: string;
	from_node: string;
	to_node: string;
	actor_snapshot: ActorSnapshot | null;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorMoveUnobservable extends Omit<ActorMoveUnobservedNoProvenance, "status"> {
	status: "unobservable";
}

export interface ActorMoveTravelling
	extends Omit<ActorMoveUnobservedNoProvenance, "status" | "reason"> {
	status: "travelling";
	/** Ticks still to go when this result was built. */
	arrives_in_ticks: number;
	/** Absolute world tick the actor is put down at `to_node`. */
	arrives_at_tick: number;
	/** The long-running-move session doing the walking. */
	session_id: string;
	/** Human-readable, e.g. "travelling to 'inn/stairs' — arrives in 4 ticks". */
	reason: string;
}

export type ActorMoveResult =
	| ActorMoveSuccess
	| ActorMoveRejected
	| ActorMoveTravelling
	| ActorMoveUnobservedTimeout
	| ActorMoveUnobservedNoProvenance
	| ActorMoveUnobservable;

// ---------------------------------------------------------------------------
// Manipulate result types
// ---------------------------------------------------------------------------

export interface ActorManipulateSuccess<T> {
	status: "success";
	actor_id: EntityRef;
	target_id: string;
	action_id: string;
	snapshot: T;
	/**
	 * #1968 B-9: the `evaluation_provenance` row `r_manipulate` recorded for
	 * THIS dispatch — previously dropped on the success branch (every other
	 * `ActorManipulateResult`/`ActorSenseResult` variant already carries it).
	 * `provenance.selected_template_ids[1]` is the fired `outcome_template_id`,
	 * the join key `describeOutcomeTemplate` (shared tool runtime `observation.ts`)
	 * resolves the authored observation narrative from.
	 */
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorManipulateRejected<T> {
	status: "rejected";
	actor_id: EntityRef;
	target_id: string;
	action_id: string;
	snapshot: T | null;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorManipulateUnobservedTimeout<T> {
	status: "unobserved_timeout";
	actor_id: EntityRef;
	target_id: string;
	action_id: string;
	snapshot: T | null;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorManipulateUnobservedNoProvenance<T> {
	status: "unobserved_no_provenance";
	actor_id: EntityRef;
	target_id: string;
	action_id: string;
	snapshot: T | null;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorManipulateUnobservable<T>
	extends Omit<ActorManipulateUnobservedNoProvenance<T>, "status"> {
	status: "unobservable";
}

export type ActorManipulateResult<T> =
	| ActorManipulateSuccess<T>
	| ActorManipulateRejected<T>
	| ActorManipulateUnobservedTimeout<T>
	| ActorManipulateUnobservedNoProvenance<T>
	| ActorManipulateUnobservable<T>;

// ---------------------------------------------------------------------------
// Session result types (re-export from per-reducer wrappers)
// ---------------------------------------------------------------------------

export type { InscribeTraceResult, VisibilityClass } from "./reducers/r_inscribe_trace";
export type { ActorReleaseClaimResult } from "./reducers/r_release_claim";
export type { SessionCloseResult } from "./reducers/r_session_close";
export type { SessionMoveResult } from "./reducers/r_session_move";
export type { SessionOpenResult } from "./reducers/r_session_open";

/** Result of r_advance_turn: fire-and-await (no state-observed snapshot). */
export type AdvanceTurnResult =
	| { status: "success"; sessionId: bigint }
	| { status: "rejected"; sessionId: bigint; reason: string };
export type { ActorWakeUpResult } from "./reducers/r_actor_wake_up";

export interface ActorSenseSuccess {
	status: "success";
	actor_id: EntityRef;
	query_kind: string;
	visibility_class: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorSenseRejected {
	status: "rejected";
	actor_id: EntityRef;
	query_kind: string;
	visibility_class: string;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorSenseUnobservedTimeout {
	status: "unobserved_timeout";
	actor_id: EntityRef;
	query_kind: string;
	visibility_class: string;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorSenseUnobservedNoProvenance {
	status: "unobserved_no_provenance";
	actor_id: EntityRef;
	query_kind: string;
	visibility_class: string;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorSenseUnobservable extends Omit<ActorSenseUnobservedNoProvenance, "status"> {
	status: "unobservable";
}

export type ActorSenseResult =
	| ActorSenseSuccess
	| ActorSenseRejected
	| ActorSenseUnobservedTimeout
	| ActorSenseUnobservedNoProvenance
	| ActorSenseUnobservable;

// ── r_react (#509) — provenance-observed (reacted-state lives on the
// unsubscribed pending_resolution_reactor table; see reducers/r_react.ts). ──

export interface ActorReactSuccess {
	status: "success";
	actor_id: EntityRef;
	pending_id: bigint;
	response_intent: string;
	/** The frozen-draw index this react replaced, when the caller selected one
	 * (post-roll intervention windows, #2058). Absent for a plain decline or a
	 * non-stochastic reaction seat. */
	selected_draw_index?: number;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorReactRejected {
	status: "rejected";
	actor_id: EntityRef;
	pending_id: bigint;
	response_intent: string;
	selected_draw_index?: number;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorReactUnobservedTimeout {
	status: "unobserved_timeout";
	actor_id: EntityRef;
	pending_id: bigint;
	response_intent: string;
	selected_draw_index?: number;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorReactUnobservedNoProvenance {
	status: "unobserved_no_provenance";
	actor_id: EntityRef;
	pending_id: bigint;
	response_intent: string;
	selected_draw_index?: number;
	reason: string;
	provenance?: ProvenanceRow;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ActorReactUnobservable extends Omit<ActorReactUnobservedNoProvenance, "status"> {
	status: "unobservable";
}

export type ActorReactResult =
	| ActorReactSuccess
	| ActorReactRejected
	| ActorReactUnobservedTimeout
	| ActorReactUnobservedNoProvenance
	| ActorReactUnobservable;

// ---------------------------------------------------------------------------
// Shared verb helpers
// ---------------------------------------------------------------------------

export interface AdjacentMove {
	edge_id: string;
	to_node: string;
}

export interface ActorClientOptions {
	/** Original control generation captured with the perception used to decide.
	 * Never refreshed by dispatch; a stale refusal requires a new perception and decision. */
	driverToken?: import("./driver_control").DriverToken;

	/**
	 * Milliseconds to wait for observed destination.
	 * Default: 2 × a measured estimator cadence (or 2 × config.tick_interval_secs when the snapshot has it); a cold estimator is treated as unknown and falls back to 2000ms. Overrides estimator when supplied.
	 */
	observationTimeoutMs?: number;
	/** Fallback poll interval for snapshot hosts without cache callbacks. Default: 40 ms. */
	observationPollMs?: number;
	/** Tick-interval estimator for dynamic timeout default computation. */
	tickEstimator?: TickIntervalEstimator;
	/** Optional override for where move actually invokes `r_move`. */
	rMove?: RMoveFn;
	/** Optional override for where manipulate actually invokes `r_manipulate`. */
	rManipulate?: RManipulateFn;
	/** Optional host-provided tracer for reducer observation attempts. */
	reducerAttemptTelemetry?: ReducerAttemptTelemetry;
	/** Optional override for where sessionOpen actually invokes `r_session_open`. */
	rSessionOpen?: RSessionOpenFn;
	/** Optional override for where sessionClose actually invokes `r_session_close`. */
	rSessionClose?: RSessionCloseFn;
	/** Optional override for where sessionMove actually invokes `r_session_move`. */
	rSessionMove?: RSessionMoveFn;
	/** Optional override for where sense actually invokes `r_sense`. */
	rSense?: RSenseFn;
	/**
	 * When true, `manipulate` treats its invocation-attributed success receipt as success
	 * even if `successPredicate` never fires. For callers (e.g. generic agent
	 * tool hosts) that cannot express a world-state predicate and want to rely on
	 * the server's own verdict. Default: false (also requires the state predicate). Both modes await the
	 * own reducer result and require an attributable terminal receipt. Snapshot-only
	 * hosts without reducer delivery context return unobservable. A settled call
	 * without a unique terminal receipt returns uncertainty immediately; only a
	 * still-pending reducer or state observation retains the deadline.
	 */
	successOnProvenance?: boolean;
	/** Optional override for where inscribeTrace actually invokes `r_inscribe_trace`. */
	rInscribeTrace?: (args: {
		kind: string;
		locationKind: string;
		locationRef: string;
		payloadJson: string;
		expiresAtTick?: bigint;
		inscribedBy: string;
		visibility: VisibilityClass;
		bundleId: string;
	}) => Promise<void>;
	/** Optional override for where react actually invokes `r_react`. */
	rReact?: RReactFn;
	/** Optional override for where releaseClaim actually invokes `r_release_claim`. */
	rReleaseClaim?: RReleaseClaimFn;
	/** Optional override for where wakeUp actually invokes `r_actor_wake_up`. */
	rActorWakeUp?: RActorWakeUpFn;
	/** Optional override for where advanceTurn actually invokes `r_advance_turn`. */
	rAdvanceTurn?: RAdvanceTurnFn;
}

export interface ActorClient {
	/** Rebind a decision to its original observed generation without reading live state. */
	withDriverToken?(token: import("./driver_control").DriverToken): ActorClient;
	/** Canonical actor id bound at construction time. */
	readonly actorId: string;
	/** Current actor snapshot from live subscription state. */
	actorSnapshot(): ActorSnapshot;
	/** Live location snapshot for the actor's current place node. */
	locationSnapshot(): LocationSnapshot | null;
	/** Adjacent edges from the actor's current live node. */
	adjacentMoves(): AdjacentMove[];
	/** Deterministic suggestion from live snapshot state. */
	suggestNextAction(): SuggestedNextAction | null;
	/**
	 * Attempt movement over one adjacent edge id from live state.
	 * Reducer callback success alone is insufficient; destination must be
	 * observed in subscribed state before success is reported.
	 */
	move(edgeId: string): Promise<ActorMoveResult>;
	/**
	 * Attempt a generic manipulation action against a target entity.
	 * SDK does NO argument validation — all args pass 1:1 to r_manipulate.
	 * The server is authoritative; outcome is observed via successPredicate.
	 */
	manipulate<T>(
		targetId: string,
		actionId: string,
		argsJson: string,
		successPredicate: (db: SnapshotDb) => boolean,
		collectSnapshot: (db: SnapshotDb) => T | null,
	): Promise<ActorManipulateResult<T>>;
	/** Attempt to open a session for this actor. Dispatches through r_session_open wrapper. */
	sessionOpen(sessionDefId: string, participantsCsv?: string): Promise<SessionOpenResult>;
	/** Attempt to close a session. Dispatches through r_session_close wrapper. */
	sessionClose(
		sessionId: bigint,
		outcome: string,
		driverTokens?: readonly import("./driver_control").DriverToken[],
	): Promise<SessionCloseResult>;
	/** Attempt a move within a session. Dispatches through r_session_move wrapper. */
	sessionMove(sessionId: bigint, moveTemplateId: string): Promise<SessionMoveResult>;
	/** Advance the turn in an active session. Dispatches r_advance_turn (fire-and-await). */
	advanceTurn(sessionId: bigint): Promise<AdvanceTurnResult>;
	/** Resolve this actor's active participant session and end its current turn. */
	endTurn(): Promise<AdvanceTurnResult>;
	/** Attempt passive/active sensing. Success is provenance-observed because r_sense writes no state. */
	sense(queryKind: string, visibilityClass: string): Promise<ActorSenseResult>;
	/**
	 * Inscribe a trace (leave-a-mark, #510). The acting actor is the trace's
	 * `inscribed_by`. State-observed: success when the trace row appears in the
	 * subscribed `visible_trace` view. `expiresAtTick` is optional (None = permanent).
	 * SDK does NO argument validation — all args pass 1:1 to r_inscribe_trace.
	 */
	inscribeTrace(
		kind: string,
		locationKind: string,
		locationRef: string,
		payloadJson: string,
		visibility: VisibilityClass,
		bundleId: string,
		expiresAtTick?: bigint,
	): Promise<InscribeTraceResult>;
	/**
	 * React to a pending_resolution (#509). The acting actor is the reactor.
	 * Success is observed one of two ways depending on shape: a multi-actor
	 * reaction seat (unsubscribed pending_resolution_reactor table) flipping
	 * or disappearing, or — when this reactor holds no seat row at all, the
	 * shape a post-roll intervention window takes (#2058: the eligible
	 * responder is `target_actor` on `pending_resolution` itself, not a seat)
	 * — the matching `visible_pending_resolution` row disappearing. SDK does
	 * NO argument validation — all args pass 1:1 to r_react. `selectedDrawIndex`
	 * is the intervention-window accept case: which already-drawn face to
	 * replace; omit it to decline (keep the original result, spend nothing).
	 */
	react(
		pendingId: bigint,
		responseIntent: string,
		selectedDrawIndex?: number,
	): Promise<ActorReactResult>;
	/**
	 * Release a claim/lock this actor holds on a target (multiplayer contention).
	 * Provenance-observed (the claim module emits evaluation_provenance).
	 */
	releaseClaim(targetId: string): Promise<ActorReleaseClaimResult>;
	/**
	 * Seed wake-up perception for the actor's current node (connect-path, design
	 * D-3). Idempotent and fire-and-confirm: reports "submitted" once invoked, as
	 * the reducer emits no terminal signal. Read observer_knowledge to confirm.
	 */
	wakeUp(): Promise<ActorWakeUpResult>;
}
