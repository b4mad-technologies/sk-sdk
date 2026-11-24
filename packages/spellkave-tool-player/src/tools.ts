import {
	asEntityRef,
	composeFactoredManipulationAttempt,
	type EntityRef,
	type SpellkaveSession,
	travelSessionForActor,
} from "@spellkave/sdk";
import type { ControlReducerPort } from "@spellkave/sdk/actor-control";
import {
	type ActorClient,
	type AdvanceTurnResult,
	createActorClient,
	type RActorWakeUpFn,
	type RAdvanceTurnFn,
	type RManipulateFn,
	type RMoveFn,
	type RReactFn,
	type RReleaseClaimFn,
	type RSenseFn,
	type RSessionCloseFn,
	type RSessionMoveFn,
	type RSessionOpenFn,
	resolveObservationTimeoutMs,
} from "@spellkave/sdk/actor-control";
import {
	type ActorPrincipalRow,
	type AffordanceInputSchema,
	boundedCollection,
	captureDriverToken,
	type InventoryQueryItem,
	readActiveSessionWithRosterForParticipant,
	readActorCoLocation,
	readActorConditions,
	readActorIdentityBindings,
	readActorPrincipals,
	readActorSnapshot,
	readAuthorizedItemDetail,
	readContainerContents,
	readCurrentScene,
	readCurrentTraceProjection,
	readDriverControl,
	readEntity,
	readEntityBody,
	readEntityContainer,
	readEquipment,
	readEventApplyConsequences,
	readInterventionWindowsForActor,
	readInventoryProjection,
	readManipulationContext,
	readMapLayers,
	readObserverKnowledge,
	readObserverPlaceKnowledge,
	readObserverTraceKnowledge,
	readParticipantSessionDetail,
	readParticipantSessionStatus,
	readParticipantSessionSummaries,
	readPlaceTopology,
	readReactionOptionsForActor,
	readRecentEvents,
	readSelfCapabilities,
	readSelfConditions,
	readSelfEconomyBudget,
	readSelfEconomyChannelSpends,
	readSelfEvaluationById,
	readSelfIdentity,
	readSelfRecentEvaluations,
	readSelfStates,
	readSelfSummary,
	readSenseContext,
	readVisibleSpatialNicheAttachments,
	readWorldStatus,
	resolveEntityId,
	type SceneTarget,
	type SnapshotDb,
	suggestNextAction,
} from "@spellkave/sdk/readers";
import { DM_TOOL_NAMES, PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import {
	ACTOR_PRINCIPALS_PARAMS,
	COMMUNICATE_PARAMS,
	END_TURN_PARAMS,
	ENTITY_BODY_PARAMS,
	ENTITY_CONTAINER_PARAMS,
	ENTITY_PARAMS,
	EVENTS_PARAMS,
	INTERVENTION_WINDOWS_PARAMS,
	INVENTORY_PARAMS,
	ITEM_DETAIL_PARAMS,
	MANIPULATE_PARAMS,
	MANIPULATION_CONTEXT_PARAMS,
	MAP_PARAMS,
	MOVE_PARAMS,
	OBSERVER_KNOWLEDGE_PARAMS,
	OBSERVER_PLACE_KNOWLEDGE_PARAMS,
	OBSERVER_TRACE_KNOWLEDGE_PARAMS,
	OFFER_CONTROL_PARAMS,
	ORIENT_PARAMS,
	REACT_OPTION_PARAMS,
	REACTION_OPTIONS_PARAMS,
	RELEASE_CLAIM_PARAMS,
	RETURN_NPC_CONTROL_PARAMS,
	SCENE_DETAIL_PARAMS,
	SCENE_TARGETS_PARAMS,
	SELF_STATES_PARAMS,
	SELF_SUMMARY_PARAMS,
	SENSE_CONTEXT_PARAMS,
	SENSE_PARAMS,
	SESSION_CLOSE_PARAMS,
	SESSION_MOVE_PARAMS,
	SESSION_OPEN_PARAMS,
	SESSION_STATUS_PARAMS,
	SPELLKAVE_ACTOR_PRINCIPALS_TOOL,
	SPELLKAVE_COMMUNICATE_TOOL,
	SPELLKAVE_END_TURN_TOOL,
	SPELLKAVE_ENTITY_BODY_TOOL,
	SPELLKAVE_ENTITY_CONTAINER_TOOL,
	SPELLKAVE_ENTITY_TOOL,
	SPELLKAVE_EVENTS_TOOL,
	SPELLKAVE_INTERVENTION_WINDOWS_TOOL,
	SPELLKAVE_INVENTORY_TOOL,
	SPELLKAVE_ITEM_DETAIL_TOOL,
	SPELLKAVE_MANIPULATE_TOOL,
	SPELLKAVE_MANIPULATION_CONTEXT_TOOL,
	SPELLKAVE_MAP_TOOL,
	SPELLKAVE_MOVE_TOOL,
	SPELLKAVE_OBSERVER_KNOWLEDGE_TOOL,
	SPELLKAVE_OBSERVER_PLACE_KNOWLEDGE_TOOL,
	SPELLKAVE_OBSERVER_TRACE_KNOWLEDGE_TOOL,
	SPELLKAVE_OFFER_CONTROL_TOOL,
	SPELLKAVE_ORIENT_TOOL,
	SPELLKAVE_REACT_OPTION_TOOL,
	SPELLKAVE_REACTION_OPTIONS_TOOL,
	SPELLKAVE_RELEASE_CLAIM_TOOL,
	SPELLKAVE_RETURN_NPC_CONTROL_TOOL,
	SPELLKAVE_SCENE_DETAIL_TOOL,
	SPELLKAVE_SCENE_TOOL,
	SPELLKAVE_SELF_STATES_TOOL,
	SPELLKAVE_SELF_SUMMARY_TOOL,
	SPELLKAVE_SENSE_CONTEXT_TOOL,
	SPELLKAVE_SENSE_TOOL,
	SPELLKAVE_SESSION_CLOSE_TOOL,
	SPELLKAVE_SESSION_MOVE_TOOL,
	SPELLKAVE_SESSION_OPEN_TOOL,
	SPELLKAVE_SESSION_STATUS_TOOL,
	SPELLKAVE_STATUS_TOOL,
	SPELLKAVE_SUGGEST_NEXT_ACTION_TOOL,
	SPELLKAVE_TAKE_NPC_CONTROL_TOOL,
	SPELLKAVE_TRACE_DETAIL_TOOL,
	SPELLKAVE_TRACES_TOOL,
	SPELLKAVE_WAKE_UP_TOOL,
	SPELLKAVE_WITHDRAW_CONTROL_TOOL,
	STATUS_PARAMS,
	SUGGEST_NEXT_ACTION_PARAMS,
	TAKE_NPC_CONTROL_PARAMS,
	TRACE_DETAIL_PARAMS,
	TRACE_ENTRIES_PARAMS,
	WAKE_UP_PARAMS,
	WITHDRAW_CONTROL_PARAMS,
} from "@spellkave/tool-contracts/schemas";
import {
	type BoundTool,
	bindTool,
	coordinateWorldDeltas,
	createWorldDeltaTracker,
	type DeltaTracker,
	type NodeToolCapabilities,
	shapeConsequences,
	ToolCapabilityUnavailableError,
	type ToolRunEmitter,
	truncateSceneNodePathPrefix,
	type WorldEvent,
	type WorldEventCoordinatorPort,
} from "@spellkave/tool-runtime";
import type { Static, TSchema } from "typebox";
import { isUnobservedActStatus } from "./act-uncertainty";
import { auditArgsJson, ignoredArgsHint } from "./args-json-audit";
import { createCompanionWorldDeltaSource } from "./delta-tracker";
import {
	ARRIVAL_NO_DESCRIPTION_GAP,
	buildActObservation,
	buildConversationResult,
	buildObservation,
	type ConversationReply,
	describeArrival,
	describeDeparture,
	describeOutcomeTemplate,
	describeSelfResourceDelta,
	describeSpawnedCreatures,
	graphPrefix,
} from "./observation";
import {
	manipulationContextSummaryForPlayer,
	orientationForPlayer,
} from "./orient-player-projection";
import { createWorldEventBuilder, type WorldEventBuilder } from "./push-events";
import {
	contentFingerprint,
	parseQueryHandle,
	parseStableHandle,
	type QueryDomain,
	QueryProtocolError,
	queryHandle,
	queryPage,
	queryRevision,
	stableHandle,
} from "./query-protocol";
import { reactionWindowKey } from "./reaction-window-key";
import { realReplyWindowClock, waitForReply } from "./reply-window";

type ManipulationPromptRow = NonNullable<
	Extract<ReturnType<typeof readManipulationContext>, { status: "ready" }>["prompts"]
>[number];

import {
	describeResolutionOutcome,
	parseResolutionSummary,
	slimActResultForPlayer,
	slimMoveResultForPlayer,
} from "./resolution";
import { observeOfferedResources, type ResourceObservation } from "./resource-observation";
import { resolveSpawnedCreatures } from "./spawn-observation";
import { defineTool, type ToolDefinition, type ToolResult } from "./tool-registry";

/**
 * The canonical transport-neutral bound PLAYER execution shape. Session
 * hosting and Pi adaptation deliberately live outside this package.
 */
type PlayerBoundTool<P extends TSchema, R> = BoundTool<P, ToolResult<R>>;

/**
 * Minimal transport-neutral execution surface used by result decorators.
 * It intentionally omits Pi-only and runtime-only descriptor fields so a
 * host may adapt a bound tool before applying the preserved decorations.
 */
export interface PlayerExecutionTool<P extends TSchema, R> {
	readonly name: string;
	execute(toolCallId: string, params: Static<P>): Promise<ToolResult<R>>;
}

export {
	createWorldEventBuilder,
	isCausedByActor,
	type WorldEvent,
	type WorldEventBuilder,
	type WorldEventBuilderOptions,
} from "./push-events";

export interface SpellkaveToolContext {
	/** Optional host artifact witness; never modifies query or dispatch results. */
	observeQueryRevision?: (input: {
		domain: string;
		revision: string;
		rows: readonly unknown[];
	}) => void;
	/** Connection-owned transport for consent, generation previews and NPC holds. */
	controlReducers?: ControlReducerPort;

	db: SnapshotDb | (() => SnapshotDb);
	defaultEventLimit?: number;
	move?: SpellkaveMoveContext;
	act?: SpellkaveActorContext;
	/**
	 * sk-0m4.74: renamed from `conversation` (sk-0m4.73) — the SAME
	 * host-injected builder now backs TWO features, not one: the `communicate`
	 * reply window ({@link awaitConversationReply}) AND the `consequences`
	 * register every act tool takes from after a successful dispatch
	 * ({@link takeConsequences}). `worldEvents` is the general name; every
	 * in-repo host (session daemon, pi extension) and test now wires this
	 * field directly — there is no `conversation` alias to keep working, all
	 * references were in-repo at rename time.
	 */
	worldEvents?: SpellkaveWorldEventsContext;
}

/**
 * Host-injected world-event dependency (sk-0m4.73, broadened sk-0m4.74) for
 * every act tool's post-dispatch reads: `spellkave_communicate`'s
 * reply window, and the `consequences` register every
 * act tool takes from on a successful dispatch. Absent ⇒ behavior is
 * UNCHANGED from before sk-0m4.73: `conversation.response` stays `null`,
 * `awaiting_response` stays `true`, and `consequences` is omitted entirely
 * from every act result — same as a host that never wired push events at
 * all.
 *
 * `builder` must be the host's ONE long-lived `WorldEventBuilder` (the same
 * recreate-trap discipline `push-events.ts`'s module header documents for
 * every other consumer) — never a fresh one constructed per tool call, which
 * would prime quiet and report no reply/consequence ever.
 */
export interface SpellkaveWorldEventsContext {
	builder: WorldEventBuilder;
	/** Bundling saves round trips for clients without an event return channel.
	 * Event-stream clients select `events` and return after confirmed dispatch. */
	replyDelivery?: "bundled" | "events";
	/** Cache-delivery notification; required when waiting for a bundled reply. */
	onUpdate?: (notify: () => void) => () => void;
	/** Controls only the reply deadline, never SDK transport timers. */
	replyClock?: import("./reply-window").ReplyWindowClock;
	/** Host connection lifetime; cancellation removes pending reply listeners. */
	replySignal?: AbortSignal;
	/**
	 * Bounded reply window in ms, for the `communicate` reply window only —
	 * `consequences` never polls or waits (module header: ONE `takeWhere`,
	 * same tick, no window). An explicit host override wins, uncapped;
	 * otherwise the companion layer computes the SAME tick-scaled default as
	 * a fresh `ActorClient` via `resolveObservationTimeoutMs(estimator)`,
	 * bounded by {@link replyWindowCapMs} when the host gives one. The SDK's
	 * inner fallback still applies when no estimator is available.
	 *
	 * TODO(later bead): reserve a slot for an author-driven per-action hint
	 * (e.g. an action definition's own expected-reply-latency) to override
	 * this per dispatch — not implemented here.
	 */
	replyWindowMs?: number;
	/** The live session's tick estimator. A thunk supports hosts whose tools
	 * outlive individual connections (for example the pi extension). */
	estimator?: SpellkaveSession["estimator"] | (() => SpellkaveSession["estimator"] | undefined);
	/** @deprecated Ignored: reply waiting is event-driven. Retained for source
	 * compatibility; use onUpdate and replyClock to control delivery. */
	pollMs?: number;
	/**
	 * sk-0m4.121: called exactly once per `communicate` dispatch, AFTER the
	 * reducer call settled and the same-tick `consequences` were taken, and
	 * AFTER the reply listener is registered. A host that serialises tool
	 * invokes (the session daemon's `enqueueInvoke`) uses it to let the next
	 * invoke run while this one waits for a reply: the wait only reads the
	 * shared builder synchronously on cache notifications. Later drains may
	 * consume unclaimed events, using the same cursor. Never called on a rejected
	 * dispatch (no window opens). Absent ⇒ the host keeps whatever
	 * serialisation it has for the whole call, as before.
	 */
	releaseInvokeLock?: () => void;
	/**
	 * sk-0m4.121: host-supplied upper bound on the DEFAULT (tick-scaled) reply
	 * window, applied as `min(default, cap)`. Ignored when `replyWindowMs` is
	 * set (an explicit override is never capped). Only a host whose callers
	 * stop waiting earlier than the tick-scaled default should pass one — the
	 * session daemon does (`DAEMON_REPLY_WINDOW_CAP_MS`,
	 * `packages/spellkave-session/src/node/daemon.ts`) because the hosted
	 * gateway fast-fails its invokes at 12 s. In-process hosts (the pi
	 * extension, the adventure story recorder) pass nothing and keep the
	 * full tick-scaled default, so a slow NPC reply still lands synchronously
	 * in `conversation.response` there.
	 */
	replyWindowCapMs?: number;
}

/**
 * Reducer-call callbacks for the actor's provenance-observed verbs. Each is
 * optional; a tool whose callback is absent throws "not configured". Mirrors
 * the `move` context shape — the host brings its own reducer caller (binding).
 */
export type SpellkaveActorClient = Partial<
	Pick<
		ActorClient,
		| "withDriverToken"
		| "manipulate"
		| "move"
		| "sessionClose"
		| "sessionMove"
		| "advanceTurn"
		| "endTurn"
		| "sense"
		| "react"
		| "releaseClaim"
	>
>;

export interface SpellkaveActorContext {
	actorId: string | (() => string);
	/**
	 * Optional pre-wired ActorClient supplied by the host. When present, the
	 * act-verb tools delegate to it instead of reconstructing an ActorClient from a
	 * bare-snapshot source + low-level reducer callback. This covers every
	 * provenance-affected verb: `manipulate`, `move`, `sessionClose`,
	 * `sessionMove`, `endTurn`, `sense`, and `react`. Each tool falls back to
	 * its `callR*` reducer callback only when the corresponding client method is
	 * absent, so a host may wire either path per verb.
	 *
	 * Why this is the correct layer: provenance observation needs the session's
	 * `provenanceBuffer`, which lives on the live `SpellkaveSession`. A
	 * `SnapshotDb` (what `context.db` yields) legitimately has no provenance
	 * history, so for provenance-only verbs (sense/react — no subscribed state) a
	 * snapshot-sourced ActorClient reports `unobserved_no_provenance` even on
	 * success. (manipulate is also state-observed, but delegating
	 * still sharpens rejected/unobserved classification.) ActorClient construction
	 * + provenance observation stay in `@spellkave/sdk` + the host; companion stays
	 * host-neutral and just calls the client the host already wired (tracker #504,
	 * L1 wiring task).
	 */
	actorClient?: SpellkaveActorClient | (() => SpellkaveActorClient);
	callRSense?: RSenseFn;
	callRSessionOpen?: RSessionOpenFn;
	callRSessionClose?: RSessionCloseFn;
	callRSessionMove?: RSessionMoveFn;
	callRAdvanceTurn?: RAdvanceTurnFn;
	callRManipulate?: RManipulateFn;
	callRReact?: RReactFn;
	callRReleaseClaim?: RReleaseClaimFn;
	callRActorWakeUp?: RActorWakeUpFn;
}

export interface SpellkaveMoveContext {
	actorId: string | (() => string);
	state?: SpellkaveMoveState;
	callRMove: RMoveFn;
}

export interface SpellkaveMoveState {
	inFlight: boolean;
}

// Exported (ADR-0093 D-5): the seat's own `WorldEventBuilder` construction
// (`@spellkave/npc`'s `seat.ts`) needs the SAME `db`/`act.actorId`
// function-or-value normalization `createDeltaTracker`'s construction sites
// use below — reusing this rather than a second private copy.
export function currentDb(context: SpellkaveToolContext): SnapshotDb {
	return typeof context.db === "function" ? context.db() : context.db;
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit)) return 20;
	return Math.max(1, Math.min(100, Math.trunc(limit)));
}

// Default bounded view for self-orientation readers whose unfiltered payload
// dominates episode token cost. Only this tool layer applies the default; the
// underlying SDK readers stay unbounded for other consumers.
const DEFAULT_ORIENTATION_LIMIT = 40;
const SUMMARY_GROUP_LIMIT = 12;
// sk-0m4.120.34: identity facets describe what a character IS (species, class,
// background, creature, communication, language…) — an inherently small set. The
// glance shows the WHOLE set so the answer to "who am I" is never truncated
// (a hero measured at 8); the shared 4-item example bound dropped species. A
// pathological set beyond this still paginates through to `self_states
// kind=identity`.
const IDENTITY_GLANCE_BOUND = 16;
const SUMMARY_ROSTER_LIMIT = 12;
// #1931: complete/paginated cutoff for the merged spellkave_scene/spellkave_traces
// dual-shape tools — same reader class and same default as the two above, not the
// histogram-axis SUMMARY_GROUP_LIMIT (adjudicated against the code in the #1931
// dual-shape note; a market-square/tavern-common-room scene must still fit
// "complete" at 40, and would falsely paginate at 12).
const SCENE_TARGET_LIMIT = DEFAULT_ORIENTATION_LIMIT;
const TRACE_LIMIT = DEFAULT_ORIENTATION_LIMIT;

function boundRecord<T>(record: Record<string, T>, limit = SUMMARY_GROUP_LIMIT) {
	// Numeric-aware order (sk-0m4.120.27): a plain codepoint sort puts "Answer 10"
	// before "Answer 2", so truncating a numbered dialogue menu at `limit` dropped
	// arbitrary middle options (and the contract handles) instead of the tail.
	// Fixed "en-US" locale keeps the order deterministic across runners. The cut
	// now lands at the menu END; callers surface `omitted` so nothing that was
	// dropped is silent.
	const entries = Object.entries(record).sort(([left], [right]) =>
		left.localeCompare(right, "en-US", { numeric: true, sensitivity: "base" }),
	);
	return {
		values: Object.fromEntries(entries.slice(0, limit)) as Record<string, T>,
		total: entries.length,
		shown: Math.min(entries.length, limit),
		truncated: entries.length > limit,
		omitted: entries.slice(limit).map(([key]) => key),
	};
}

function toolResult<T>(details: T): ToolResult<T> {
	const serialized = stringify(details);
	return {
		content: [{ type: "text", text: serialized }],
		details: JSON.parse(serialized) as T,
	};
}

// Compact on purpose: this text is what a model host reads back verbatim
// (`content[0].text`), and the same payload rides again in `details` /
// `structuredContent`. Two-space indentation cost 27 KB of a 58 KB orient
// text block (sandbox/live-patch-loop/README.md, run 7); a machine reader
// gains nothing from it and a human reader gets `sk --format human`.
function stringify(value: unknown): string {
	return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
}

// ADR-0083 D-3.2 (Postscript, 2026-08-04) originally trimmed a move
// receipt's FULL `actor_snapshot` resend (~40% of a typical elven-mini
// transcript by token share) — state changes now travel exclusively through
// the piggybacked `world_deltas` note (see the tool-registry wrapper below).
// U2 (receipt-slimming, operator ruling 2026-08-10) widens that strip to the
// full PLAYER-register treatment (`lagWarning`/`observedAtTick`/raw
// `provenance`, `failure_detail` promoted) via `slimMoveResultForPlayer`
// (resolution.ts) — see that function's doc comment for the full two-register
// rationale, including why this is not an ADR postscript.

// --- Shared act-tool dispatch (issue #1380). ---
//
// Every provenance-observed actor verb prefers the host's pre-wired
// ActorClient method (see `SpellkaveActorContext.actorClient` above) and falls
// back to a snapshot-sourced ActorClient built from the bare `callR*` reducer
// callback. That branch used to be hand-copied near-verbatim across every verb
// tool; `dispatchAct` is the ONE place it lives now.
function dispatchAct<T>(preferred: T | undefined, buildFallback: () => T): T {
	return preferred ?? buildFallback();
}

function currentActorClient(
	act: SpellkaveActorContext | undefined,
): SpellkaveActorClient | undefined {
	if (act?.actorClient === undefined) return undefined;
	return typeof act.actorClient === "function" ? act.actorClient() : act.actorClient;
}

/** A reducer callback that always reports the given tool as unconfigured. Used
 * as the innermost fallback inside `dispatchAct`'s fallback-client construction
 * — it is only ever invoked (throwing) if the host wired neither the ActorClient
 * method nor the bare `callR*` callback for that verb. */
function notConfigured(toolName: string): () => never {
	return () => {
		throw new Error(`${toolName} is not configured`);
	};
}

function steeringOffered(context: SpellkaveToolContext): boolean {
	const db = currentDb(context);
	const owned = new Set(
		readActorIdentityBindings(db)
			.filter((row) => row.role !== "co-pilot")
			.map((row) => row.actor_id),
	);
	return readActorPrincipals(db).some(
		(row) =>
			owned.has(row.actor_id) &&
			readSelfCapabilities(db, asEntityRef(String(row.current_body))).some(
				(cap) => cap.capability_id === "frontier.impersonate",
			),
	);
}

/** Schema offering shared by portable binders and dynamically connected hosts. */
export function offeredActToolParameters<P extends TSchema>(
	parameters: P,
	context: SpellkaveToolContext,
): P {
	const properties = (parameters as TSchema & { properties?: Record<string, TSchema> }).properties;
	if (properties?.as_body_id === undefined || steeringOffered(context)) return parameters;
	const offered = structuredClone(parameters) as P & { properties: Record<string, TSchema> };
	delete offered.properties.as_body_id;
	delete offered.properties.control_token;
	return offered;
}

type OriginalControlToken = {
	world_instance_id: string;
	generation: string;
	actor_id: string;
	body_entity_id: string;
};
async function steeringContext(
	context: SpellkaveToolContext,
	params: { as_body_id?: string; control_token?: OriginalControlToken },
): Promise<SpellkaveToolContext> {
	if (params.as_body_id === undefined) return context;
	if (!steeringOffered(context)) throw new Error("frontier.impersonate is required for as_body_id");
	const reducers = context.controlReducers;
	if (reducers === undefined) throw new Error("steering transport is not configured");
	const body = BigInt(params.as_body_id.replace(/^entity:/, ""));
	const token = params.control_token;
	const driverToken =
		token === undefined
			? undefined
			: {
					worldInstanceId: token.world_instance_id,
					generation: BigInt(token.generation),
					actorId: BigInt(token.actor_id),
					bodyEntityId: BigInt(token.body_entity_id),
				};
	// The preview admits consent and extent and refreshes derived discovery. The
	// act always carries the caller's original token; this seam never refreshes it.
	await reducers.rPrepareSteeredActor({ bodyEntityId: body });
	const actorId = String(body);
	const actorClient = createActorClient(currentDb(context), actorId, {
		driverToken,
		rMove: (args) => reducers.rMove(args),
		rManipulate: (args) => reducers.rManipulate(args),
		rSense: (args) => reducers.rSense(args),
		successOnProvenance: true,
	});
	return {
		...context,
		act: { ...context.act, actorId, actorClient },
		move: { actorId, callRMove: (args) => reducers.rMove({ ...args, driverToken }) },
	};
}

function requireActorId(context: SpellkaveToolContext): {
	act: SpellkaveActorContext;
	actorId: EntityRef;
} {
	const act = context.act;
	if (act === undefined) {
		throw new Error("actor verbs are not configured (context.act missing)");
	}
	const actorId = typeof act.actorId === "function" ? act.actorId() : act.actorId;
	return { act, actorId: asEntityRef(actorId) };
}

/** Non-throwing sibling of {@link requireActorId} for the world_deltas
 * wrapper (ADR-0083 Stage 2, below): a tracker binds per tool-context
 * regardless of whether `context.act` is configured, and simply skips the
 * `self` domain when it isn't. */
// Exported alongside `currentDb` above for the same ADR-0093 D-5 reason.
export function contextActorId(context: SpellkaveToolContext): EntityRef | undefined {
	const act = context.act;
	if (act === undefined) return undefined;
	const actorId = typeof act.actorId === "function" ? act.actorId() : act.actorId;
	const actorRef = asEntityRef(actorId);
	// A session's actor id is often the bare numeric body id ("4"), whereas
	// manipulation target facts are typed references ("entity:4"). Preserve
	// authored/stable keys when they cannot be resolved, but canonicalize a
	// resolved live body so a self-directed factored attempt can select its own
	// target without reconstructing an action×target cache.
	const entityId = resolveEntityId(currentDb(context), actorRef);
	return entityId === undefined ? actorRef : asEntityRef(`entity:${entityId}`);
}

// --- Shared actionable-error helpers (#1932). Five recurring failure shapes,
// built once each rather than as ~40 bespoke strings — see
// docs/research/player-tool-error-audit.md Patterns §1-§5. ---

/** Domain -> the PLAYER orientation tool name(s) to name in a stale/bad-handle
 * guidance string. A call site may still pass a tighter retry pointer than the
 * domain default when the caller has more specific context. */
const DOMAIN_ORIENTATION_TOOLS: Record<QueryDomain, string> = {
	self: SPELLKAVE_SELF_STATES_TOOL,
	scene: SPELLKAVE_SCENE_TOOL,
	inventory: SPELLKAVE_INVENTORY_TOOL,
	trace: SPELLKAVE_TRACES_TOOL,
	reaction: SPELLKAVE_REACTION_OPTIONS_TOOL,
	intervention: SPELLKAVE_INTERVENTION_WINDOWS_TOOL,
	session: SPELLKAVE_SESSION_STATUS_TOOL,
};

const DOMAIN_NOUN: Record<QueryDomain, string> = {
	self: "Self state pool",
	scene: "Scene",
	inventory: "Inventory",
	trace: "Trace projection",
	reaction: "Reaction window",
	intervention: "Intervention window",
	session: "Ongoing session",
};

/** Shared shape for every revision-bound handle rejection (scene/item/trace
 * detail, react_option). Folds the formerly-divergent
 * `stale_handle`/`stale_window` status vocabulary into one name (Patterns
 * §1) — every call site names the domain's orientation tool(s) in `reason`. */
function staleHandleResult(
	domain: QueryDomain,
	expectedRev: string,
	providedRev: string | null,
	orientationTools: string = DOMAIN_ORIENTATION_TOOLS[domain],
) {
	return {
		status: "stale_handle" as const,
		expected_rev: expectedRev,
		provided_rev: providedRev,
		reason: `${DOMAIN_NOUN[domain]} changed since this handle was issued; call ${orientationTools} and reselect.`,
	};
}

/** T12 (tool-ux-decision-log.md; BL-3 stable-handles half): resolve a stable
 * identity handle against CURRENT rows, gating freshness per-TARGET rather
 * than per-domain — the fix for the churn class U4 hit live (widening one
 * actor's own detail fields busted `spellkave_scene`'s whole-domain hash,
 * invalidating every OTHER handle on the page too; see that commit's own
 * note). Three distinct outcomes, kept distinct rather than folded:
 *   - malformed/cross-domain handle -> `unknown_handle`/`cross_domain`
 *     (parseStableHandle's own errors, unchanged vocabulary)
 *   - well-formed handle, no row with that identity in the CURRENT,
 *     authorized row set -> `unknown_handle` (this identity is not, or no
 *     longer, in the caller's view — same name existing positional-handle
 *     out-of-range already used for "doesn't resolve")
 *   - row found, but its own content-fingerprint no longer matches the rev
 *     the caller copied -> `stale_handle` (the ONE thing named by this
 *     handle actually changed since — the genuine staleness case, never a
 *     false positive from an unrelated sibling row changing)
 * A caller-supplied `key` extracts the identity from a row (plain id for a
 * homogeneous domain, `${kind}:${id}` for scene's mixed kinds). */
function resolveHandle<T>(
	domain: QueryDomain,
	handle: string,
	providedRev: string,
	rows: readonly T[],
	key: (row: T) => string,
	orientationTools?: string,
):
	| { status: "ok"; target: T; rev: string }
	| { status: "error"; payload: Record<string, unknown> } {
	const tools = orientationTools ?? DOMAIN_ORIENTATION_TOOLS[domain];
	let id: string;
	try {
		id = parseStableHandle(handle, domain);
	} catch (error) {
		if (error instanceof QueryProtocolError) {
			return {
				status: "error",
				payload: {
					status: error.code,
					handle,
					reason: `Handle '${handle}' is not a valid ${DOMAIN_NOUN[domain].toLocaleLowerCase()} handle; call ${tools} and copy a fresh handle.`,
				},
			};
		}
		throw error;
	}
	const target = rows.find((row) => key(row) === id);
	if (target === undefined) {
		return {
			status: "error",
			payload: {
				status: "unknown_handle" as const,
				handle,
				reason: `Handle '${handle}' does not resolve to a current, authorized ${DOMAIN_NOUN[domain].toLocaleLowerCase()} target; call ${tools} for a fresh handle.`,
			},
		};
	}
	const rev = contentFingerprint(target);
	if (rev !== providedRev) {
		return { status: "error", payload: staleHandleResult(domain, rev, providedRev, tools) };
	}
	return { status: "ok", target, rev };
}

/** `queryPage()` throws `QueryProtocolError` (via `decodeCursor`) on a stale,
 * invalid, or cross-domain cursor. Every LIST tool called `queryPage` bare, so
 * the exception propagated uncaught past `toolResult()` and surfaced to the
 * model as an unstructured `isError` string equal to the raw code (Patterns
 * §2). This wraps every one of those call sites: same success envelope on the
 * happy path, same structured `{status, rev, reason}` shape the `*_detail`
 * tools already use for handle rejections on the error path. */
function safeQueryPage<T>(
	options: Parameters<typeof queryPage<T>>[0],
): ReturnType<typeof queryPage<T>> | { status: string; rev: string; reason: string } {
	const rev = options.revision ?? queryRevision(options.domain, options.rows);
	try {
		return queryPage({ ...options, revision: rev });
	} catch (error) {
		if (error instanceof QueryProtocolError) {
			return {
				status: error.code,
				rev,
				reason: `Cursor no longer matches the current page; call ${DOMAIN_ORIENTATION_TOOLS[options.domain]} again without a cursor to restart from the top.`,
			};
		}
		throw error;
	}
}

/** Distinct values `extract` reads off `rows`, for "no rows matched — here is
 * what IS present" guidance (Patterns §3). `extract` may return one value or
 * several (e.g. self_states' `tags` array) — both flatten into one sorted,
 * deduplicated list. Attach only when a filter matched zero rows; every
 * filtered LIST tool already holds the unfiltered row array in scope, so this
 * costs nothing extra and needs no server change. */
function presentValues<T>(
	rows: readonly T[],
	extract: (row: T) => string | readonly string[],
): string[] {
	const values = new Set<string>();
	for (const row of rows) {
		const extracted = extract(row);
		if (Array.isArray(extracted)) for (const value of extracted) values.add(value);
		else values.add(extracted as string);
	}
	return [...values].sort((a, b) => a.localeCompare(b));
}

/** Lift a nested act-verb result's `status` into a top-level `outcome` so a
 * caller checking only the outer field can tell accept from reject without
 * inspecting the nested verb result (Patterns §4). The reason TEXT stays
 * server-controlled (the reducer's own rejection string) — only the shape
 * that makes success/failure visible at the top level is a tool-layer change. */
function actOutcome(verbStatus: string): "accepted" | "rejected" | "unobserved" | "travelling" {
	if (verbStatus === "success") return "accepted";
	if (verbStatus === "rejected") return "rejected";
	// A promoted long-running move was ADMITTED and is under way — neither
	// accepted (the actor is not there yet) nor unobserved (we know exactly
	// where they are going and when they arrive). feat/travel-eta 2026-08-18.
	if (verbStatus === "travelling") return "travelling";
	return "unobserved"; // unobserved_timeout / unobserved_no_provenance / unobservable
}

/** #1923 (extended by the carry_dispatch_text gap fix): fold
 * `spellkave_communicate`'s dedicated `utterance` param into the opaque
 * `args_json` blob forwarded to `r_manipulate`, under a `dispatch_text` key —
 * the kernel-wire vocabulary `ManipulationArgs.dispatch_text` reads back out
 * (ADR-0021 naming rule: the kernel mints no domain vocabulary; `utterance`
 * stays a tool-boundary word, translated here, never carried past this
 * function). Still 1:1-forwarded like every other args_json field (Patterns
 * §4's "server-controlled" rule), just no longer requiring the caller to
 * hand-author the JSON shape for the one field that matters for a
 * communicate call. Malformed caller JSON in `args_json` falls back to an
 * empty base rather than rejecting the whole dispatch — the text still
 * needs to reach r_manipulate even if the rest of the blob was junk. */
function withUtterance(argsJson: string | undefined, utterance: string | undefined): string {
	if (utterance === undefined) return argsJson ?? "{}";
	let base: Record<string, unknown> = {};
	if (argsJson !== undefined && argsJson.trim() !== "") {
		try {
			const parsed: unknown = JSON.parse(argsJson);
			if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
				base = parsed as Record<string, unknown>;
			}
		} catch {
			// malformed args_json: fall through with an empty base.
		}
	}
	return JSON.stringify({ ...base, dispatch_text: utterance });
}

// --- Tool definitions. Each is ONE `defineTool` call — the single place to add
// a Spellkave companion tool (see `./CLAUDE.md` "How to add a tool"). Runtime
// registration (`createSpellkaveTools`) and the derived `SpellkaveCompanionTool`
// union below are both produced from the `spellkaveToolDefinitions` array, so
// nothing else needs editing. ---

const statusToolDef = defineTool({
	contract: SPELLKAVE_STATUS_TOOL,
	schema: STATUS_PARAMS,
	run: async (context: SpellkaveToolContext) =>
		toolResult({ status: readWorldStatus(currentDb(context)) }),
});

const eventsToolDef = defineTool({
	contract: SPELLKAVE_EVENTS_TOOL,
	schema: EVENTS_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof EVENTS_PARAMS>) => {
		const limit = clampLimit(params.limit ?? context.defaultEventLimit ?? 20);
		return toolResult({ events: readRecentEvents(currentDb(context), limit) });
	},
});

const selfSummaryToolDef = defineTool<SpellkaveToolContext, typeof SELF_SUMMARY_PARAMS, unknown>({
	contract: SPELLKAVE_SELF_SUMMARY_TOOL,
	schema: SELF_SUMMARY_PARAMS,
	run: async (context: SpellkaveToolContext) => {
		const { actorId } = requireActorId(context);
		const db = currentDb(context);
		const self = readSelfSummary(db, actorId);
		if (self === null) return toolResult({ self: null });
		return toolResult({
			self: {
				...self,
				capabilities: boundedCollection(readSelfCapabilities(db, actorId), {
					tool: "spellkave_self_states",
					args: { kind: "capability" },
				}),
				// sk-0m4.120.34: a player who reads self_summary could not tell their
				// own class/species/background — those facets had been moved off the
				// recurring glance to `self_states kind=identity` (#2119), and live
				// play showed nobody made the extra call. Re-surface the authored
				// identity facets here, but COMPACT (tag + catalog prefix, no
				// description) and with a bound sized to show a whole character.
				//
				// WHY COMPACT (reversed from carrying the full LEFT-joined rows). Live
				// proof: a hero has ~8 facets and `readSelfIdentity` sorts them
				// alphabetically, so at the shared 4-item bound with descriptions the
				// glance spent its budget on `srd.communication.vocal` (a 50-word
				// paragraph) and `srd.creature` and dropped `srd.species.*` — the one
				// facet the player wanted. Dropping the verbose descriptions (which is
				// also #2119's no-prose-on-the-glance intent) makes every facet cheap
				// enough to show, so species is always present; the descriptions stay
				// one call away at `self_states kind=identity`. Still no field names
				// minted — a bundle's own `<facet>.<value>` tags get the same treatment.
				// Level is not here: it is an authored `vitals` state already on `self`.
				identity: boundedCollection(
					readSelfIdentity(db, actorId).map(({ tag, prefix }) =>
						prefix === undefined ? { tag } : { tag, prefix },
					),
					{ tool: "spellkave_self_states", args: { kind: "identity" } },
					IDENTITY_GLANCE_BOUND,
				),
			},
		});
	},
});

const selfStatesToolDef = defineTool<SpellkaveToolContext, typeof SELF_STATES_PARAMS, unknown>({
	contract: SPELLKAVE_SELF_STATES_TOOL,
	schema: SELF_STATES_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof SELF_STATES_PARAMS>) => {
		const { actorId } = requireActorId(context);
		const db = currentDb(context);
		const kind = params.kind ?? "state";

		if (params.provenance_id !== undefined && kind !== "evaluation") {
			return toolResult({
				status: "invalid_filter" as const,
				reason:
					"provenance_id applies only to kind=evaluation; set kind=evaluation to use it, or drop the filter.",
			});
		}

		let all: unknown[];
		let matched: unknown[];
		switch (kind) {
			case "economy_budget": {
				if (params.state_prefix !== undefined || params.state_tag !== undefined) {
					return toolResult({
						status: "invalid_filter" as const,
						reason:
							"state_prefix/state_tag apply only to kind=state; omit kind or set kind=state to use them, or drop the filters to page conditions/capabilities/evaluations/economy/identity.",
					});
				}
				const budget = readSelfEconomyBudget(db, actorId);
				if (budget.status === "unavailable") {
					return toolResult({
						status: "unavailable" as const,
						reason: budget.reason ?? "world_time",
						shown: 0,
						matched: 0,
						truncated: false,
						items: [],
					});
				}
				all = budget.channels;
				matched = budget.channels;
				const page = safeQueryPage({
					domain: "self",
					rows: matched,
					limit: params.limit,
					cursor: params.cursor,
					revision: queryRevision("self", [{ kind }, ...all]),
				});
				if (!("listing" in page)) return toolResult(page);
				return toolResult({ ...page, status: budget.status });
			}
			case "condition":
			case "capability":
			case "evaluation":
			case "economy":
			case "identity": {
				if (params.state_prefix !== undefined || params.state_tag !== undefined) {
					return toolResult({
						status: "invalid_filter" as const,
						reason:
							"state_prefix/state_tag apply only to kind=state; omit kind or set kind=state to use them, or drop the filters to page conditions/capabilities/evaluations/economy/identity.",
					});
				}
				if (kind === "evaluation" && params.provenance_id !== undefined) {
					const row = readSelfEvaluationById(db, actorId, params.provenance_id);
					all = row ? [row] : [];
					matched = all;
					break;
				}
				all =
					kind === "condition"
						? readSelfConditions(db, actorId)
						: kind === "capability"
							? readSelfCapabilities(db, actorId)
							: kind === "evaluation"
								? readSelfRecentEvaluations(db, actorId)
								: kind === "economy"
									? readSelfEconomyChannelSpends(db, actorId)
									: readSelfIdentity(db, actorId);
				matched = all;
				break;
			}
			default:
				all = readSelfStates(db, actorId);
				matched = readSelfStates(db, actorId, {
					statePrefix: params.state_prefix,
					stateTag: params.state_tag,
				});
		}
		const page = safeQueryPage({
			domain: "self",
			rows: matched,
			limit: params.limit,
			cursor: params.cursor,
			revision: queryRevision("self", [{ kind }, ...all]),
		});
		if (!("listing" in page)) return toolResult(page);
		if (page.matched === 0 && kind === "state" && params.state_tag !== undefined) {
			const tagsPresent = presentValues(all as { tags: string[] }[], (row) => row.tags);
			return toolResult({
				...page,
				values_present: tagsPresent,
				reason: `No rows with state_tag='${params.state_tag}'; tags present for this actor: [${tagsPresent.join(", ")}].`,
			});
		}
		return toolResult(page);
	},
});

/**
 * sk-jay0.1.46.7: a move longer than the actor's reach is a journey of several
 * world ticks, and the scene stays on the departure place until it ends. A
 * model player could only poll: 81 of 141 calls in the measured run
 * (sk-jay0.1.75) were scene and session-status reads waiting for arrival or a
 * turn. This waits for the travel session to close on the same cache
 * notifications the prompt wait and the communicate reply window use, bounded
 * by the host's reply cap. It reads only the caller's own visible session
 * rows and decides nothing: the server ends the journey.
 */
type JourneyWait =
	| { status: "not_travelling"; waited_ms: 0 }
	| { status: "ended"; waited_ms: number; window_ms: number }
	| {
			status: "timed_out" | "unsupported";
			waited_ms: number;
			window_ms?: number;
			arrives_in_ticks: number;
			arrives_at_tick: number;
	  };

function journeyOf(context: SpellkaveToolContext) {
	const { actorId } = requireActorId(context);
	return travelSessionForActor(currentDb(context), String(actorId));
}

async function waitForJourneyEnd(
	context: SpellkaveToolContext,
	requestedMs: number,
): Promise<JourneyWait> {
	const journey = journeyOf(context);
	if (journey === null) return { status: "not_travelling", waited_ms: 0 };
	const eta = (current: NonNullable<ReturnType<typeof journeyOf>>) => ({
		arrives_in_ticks: Number(current.arrivesInTicks),
		arrives_at_tick: Number(current.arrivesAtTick),
	});
	const worldEvents = context.worldEvents;
	if (worldEvents?.onUpdate === undefined) {
		return { status: "unsupported", waited_ms: 0, ...eta(journey) };
	}
	const windowMs =
		worldEvents.replyWindowCapMs === undefined
			? requestedMs
			: Math.min(requestedMs, worldEvents.replyWindowCapMs);
	const clock = worldEvents.replyClock ?? realReplyWindowClock;
	const startedAt = clock.now();
	// Same lane discipline as the other bounded waits: only synchronous
	// snapshot reads happen while waiting.
	worldEvents.releaseInvokeLock?.();
	const ended = await waitForReply({
		windowMs,
		subscribe: worldEvents.onUpdate,
		clock: worldEvents.replyClock,
		signal: worldEvents.replySignal,
		read: () => (journeyOf(context) === null ? true : undefined),
	});
	const waitedMs = Math.max(0, Math.round(clock.now() - startedAt));
	if (ended !== null) return { status: "ended", waited_ms: waitedMs, window_ms: windowMs };
	const still = journeyOf(context);
	if (still === null) return { status: "ended", waited_ms: waitedMs, window_ms: windowMs };
	return { status: "timed_out", waited_ms: waitedMs, window_ms: windowMs, ...eta(still) };
}

/** What a scene read says about a journey in progress. */
function journeyFields(context: SpellkaveToolContext, wait: JourneyWait | undefined) {
	const journey = journeyOf(context);
	return {
		...(journey === null
			? {}
			: {
					journey: {
						status: "travelling" as const,
						arrives_in_ticks: Number(journey.arrivesInTicks),
						arrives_at_tick: Number(journey.arrivesAtTick),
						note: "You are on a journey: this is still the place you left. Pass wait_for_arrival_ms to wait for the arrival.",
					},
				}),
		...(wait === undefined ? {} : { journey_wait: wait }),
	};
}

function currentScene(context: SpellkaveToolContext) {
	const { actorId } = requireActorId(context);
	const db = currentDb(context);
	const scene = readCurrentScene(db, actorId);
	if (scene === null) return { scene: null, rev: queryRevision("scene", []) };
	const targets = annotateSceneTargets(db, actorId, scene.targets);
	const projected = { ...scene, targets };
	return { scene: projected, rev: queryRevision("scene", targets) };
}

/** One entry of the advisory `traversal_gates` shape (ADR-0101 D-1). */
interface TraversalGate {
	template_id: string;
	/** Open author-chosen traversal-mode id; "" = the implicit default mode. */
	mode_id: string;
}

// Movement is attempt-based (ADR-0091): the affordance cache never
// materializes a movement row, so there is no cache opinion to annotate an
// exit with here. `traversal_gates` is graph-derived (`place_edge_affordance`,
// independent of the cache) and stays as advisory "what stands here" map
// info — never a permission signal; r_move (via spellkave_move) gives
// the authoritative verdict on any attempt. (T26: renamed from `blocked_by`,
// which read as a permission verdict post-ADR-0091 even though every ordinary
// walkable edge carries the universal `srd/affordance/step` template.)
//
// ADR-0101 D-1: each gate now carries its `mode_id` alongside the template
// (`LocationOutgoingEdge.affordance_bindings`, `@spellkave/sdk`'s
// `location_snapshot.ts`) — distinct `mode_id`s on one edge are OR
// alternatives (e.g. a fly-only chasm), rows sharing one carry an AND-joined
// gate set. NOTE: this reads only the edge's OWN `place_edge_affordance`
// rows — a resolved bundle/graph `movement_default` (ADR-0101 D-2, the A-1
// zero-per-edge-row idiom) is not projected onto `detail` yet, so a walkable
// edge authored via a bundle default alone shows an empty `traversal_gates`
// even though `spellkave_move` will still admit it.
function annotateSceneExits(targets: SceneTarget[]): SceneTarget[] {
	return targets.map((target) => {
		if (target.kind !== "exit") return target;
		const bindings = target.detail.affordance_bindings;
		const gates: TraversalGate[] = Array.isArray(bindings)
			? bindings.map((b) => {
					const binding = b as { template_id?: unknown; mode_id?: unknown };
					return {
						template_id: typeof binding.template_id === "string" ? binding.template_id : "",
						mode_id: typeof binding.mode_id === "string" ? binding.mode_id : "",
					};
				})
			: [];
		return {
			...target,
			detail: {
				...target.detail,
				traversal_gates: gates,
			},
		};
	});
}

/** Scene targets for one actor, WITH the same `traversal_gates` exit annotation
 * `currentScene()` applies — the exact array `spellkave_scene`/
 * `spellkave_move` hash into a rev/handle pair. Exported so a host UI
 * can replicate that hash locally to resolve a move intent's
 * `{rev, handle}` without round-tripping the scene tool itself. */
export function sceneTargetsForActor(db: SnapshotDb, actorId: EntityRef): SceneTarget[] {
	const scene = readCurrentScene(db, actorId);
	return scene === null ? [] : annotateSceneTargets(db, actorId, scene.targets);
}

function annotateSceneTargets(
	db: SnapshotDb,
	actorId: EntityRef,
	targets: SceneTarget[],
): SceneTarget[] {
	return annotateSceneExits(targets).map((target) =>
		target.kind === "entity" || target.kind === "actor"
			? {
					...target,
					detail: {
						...target.detail,
						contents: readContainerContents(db, actorId, `entity:${target.id}`),
					},
				}
			: target,
	);
}

/** Detail-only candidates follow admitted direct edges. They never become room occupants,
 * and never acquire inventory state or public identity through a raw entity lookup. */
function observedSceneChildren(db: SnapshotDb, actorId: EntityRef, roots: SceneTarget[]) {
	const children: Array<Omit<SceneTarget, "kind"> & { kind: "item" }> = [];
	const seen = new Set(
		roots.filter((row) => row.kind === "entity" || row.kind === "actor").map((row) => row.id),
	);
	const queue = roots
		.filter((row) => row.kind === "entity" || row.kind === "actor")
		.map((row) => `entity:${row.id}`);
	for (let index = 0; index < queue.length && children.length < 512; index += 1) {
		const containerRef = queue[index];
		if (containerRef === undefined) break;
		for (const item of readContainerContents(db, actorId, containerRef).items) {
			const id = item.target_ref.slice("item:".length);
			if (seen.has(id)) continue;
			seen.add(id);
			children.push({
				kind: "item",
				id,
				label: item.name,
				detail: {
					entity_id: id,
					entity_def_id: item.entity_def_id,
					quantity: item.quantity,
					target_ref: item.target_ref,
					parent_ref: item.parent_ref,
					contents: readContainerContents(db, actorId, item.target_ref),
				},
			});
			queue.push(item.target_ref);
		}
	}
	return children;
}

// #1931: merges the former sceneSummaryToolDef + sceneTargetsToolDef pair into
// one dual-shape tool, reusing the exact inventoryToolDef pattern (unfiltered +
// under-bound => "complete"; kind filter, cursor, or over-bound => "paginated").
// Node prose/counts ship in BOTH branches (cheap; dropping it on the paginated
// branch would silently reintroduce the two-call cost the merge exists to kill).
const sceneToolDef = defineTool<SpellkaveToolContext, typeof SCENE_TARGETS_PARAMS, unknown>({
	contract: SPELLKAVE_SCENE_TOOL,
	schema: SCENE_TARGETS_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof SCENE_TARGETS_PARAMS>) => {
		const journeyWait =
			params.wait_for_arrival_ms === undefined || params.wait_for_arrival_ms <= 0
				? undefined
				: await waitForJourneyEnd(context, params.wait_for_arrival_ms);
		const journey = journeyFields(context, journeyWait);
		const { scene, rev } = currentScene(context);
		const full = scene?.targets ?? [];
		const limit = Math.max(1, Math.min(100, Math.trunc(params.limit ?? SCENE_TARGET_LIMIT)));
		const nodeProse = {
			node_id: scene?.node_id ?? null,
			node_display_name: scene?.node_display_name ?? null,
			node_description: scene?.node_description ?? null,
			graph_description: scene?.graph_description ?? null,
			pose_elevation: scene?.pose_elevation ?? null,
			...(scene?.art ? { art: scene.art } : {}),
			counts: scene?.counts ?? { actor: 0, entity: 0, exit: 0, trace: 0 },
			// #1932 (audit rows 28/30): the raw target array can't distinguish "scene
			// resolved, zero targets" from "no scene resolved at all" — an empty-but-
			// complete page reads as the former either way. Surface the distinction
			// explicitly instead of leaving the caller to infer it from node_id: null.
			scene_resolved: scene !== null,
			...(scene === null
				? {
						reason:
							"No current scene resolved for this actor; confirm the actor is placed (spellkave_self_summary).",
					}
				: {}),
		};

		if (params.kind === undefined && params.cursor === undefined && full.length <= limit) {
			return toolResult({
				...nodeProse,
				...journey,
				rev,
				listing: "complete" as const,
				items: full.map((target) => sceneListItem(target, nodeProse.node_id)),
			});
		}

		const matched =
			params.kind === undefined ? full : full.filter((target) => target.kind === params.kind);
		const page = safeQueryPage({
			domain: "scene",
			rows: matched,
			limit,
			cursor: params.cursor,
			revision: rev,
		});
		if (!("listing" in page)) return toolResult(page);
		const presented = {
			...page,
			...nodeProse,
			...journey,
			items: page.items.map((target) => sceneListItem(target, nodeProse.node_id)),
		};
		if (page.matched === 0 && params.kind !== undefined && scene !== null) {
			return toolResult({
				...presented,
				values_present: presentValues(full, (target) => target.kind),
				reason: `No targets with kind='${params.kind}'; kinds present: [${presentValues(full, (target) => target.kind).join(", ")}].`,
			});
		}
		return toolResult(presented);
	},
});

// #1987: a blocked exit must be legible in the LISTING, not only via
// `spellkave_scene_detail`. An agent scanning its exits has to see "there is a
// way here and it is shut" at a glance — needing a per-handle detail fetch to
// discover it would leave the blocked route effectively invisible again, which
// is the failure this change exists to end. Non-exit targets are untouched.
//
// T2 (operator-review dry-run, 2026-08-04): an exit row also carries `to`,
// the destination node id truncated by `truncateSceneNodePathPrefix`
// (delta-tracker.ts) — elven-mini evidence: ~44/~90 story steps were the
// scene -> scene_detail (per exit candidate, only to learn to_node_id) -> act
// triplet, worst with duplicate exit labels (two "west" exits at one node).
// `to_node_id` is not new disclosure — `spellkave_scene_detail` already
// returns it canonically, uncut, per handle; this only moves the SAME
// authorized information one call earlier. `spellkave_scene_detail` stays
// UNCHANGED (the canonical full id); the truncation here is listing economy
// only, and `scene_detail` remains the tool for an exit's affordance
// template/handle detail.
// T12 (stable identity handles): a scene domain mixes four kinds (actor/
// entity/exit/trace) in one array, so the raw `id` alone (an entity_id and
// an edge_id can collide numerically) is not a safe identity — `kind:id` is,
// and matches the target_ref-style example the decision log names
// (`exit:32`). Handle+rev are both derived from the target ALONE: the
// handle never changes for as long as this exact thing exists, and the rev
// changes only when THIS thing's own content does — an unrelated sibling
// target changing (another actor's HP, a different exit's gate) never
// busts this one's handle or rev.
function sceneTargetKey(target: { kind: string; id: string }): string {
	return `${target.kind}:${target.id}`;
}

function sceneListItem(
	target: { kind: string; id: string; label: string; detail: Record<string, unknown> },
	currentNodeId: string | null,
) {
	const base = {
		handle: stableHandle("scene", sceneTargetKey(target)),
		rev: contentFingerprint(target),
		kind: target.kind,
		id: target.id,
		label: target.label,
		...(target.detail.art ? { art: target.detail.art } : {}),
	};
	if (target.kind === "actor") {
		// sk-0m4.120.40: the listing dropped every actor's `detail` (kept only for
		// scene_detail), so a corpse and a threat read identically — the player
		// could not tell a killed Cellar Rat from a live one without a per-actor
		// scene_detail round-trip. Surface the actor's conditions COMPACTLY here
		// (the condition ids only; scene_detail keeps the full stack/tick rows).
		// This is the SAME visibility-filtered view the SDK reader already put on
		// `detail.conditions` — no new disclosure. Content-neutral by construction:
		// a downed actor is distinguished by carrying e.g. `srd/condition/dead`, and
		// the tool never interprets that id — reading "dead vs alive" stays the
		// consumer's job, exactly as scene_detail already leaves it.
		const conditions = target.detail.conditions;
		const conditionIds = Array.isArray(conditions)
			? conditions
					.map((row) => (row as { condition_definition_id?: unknown }).condition_definition_id)
					.filter((id): id is string => typeof id === "string")
			: [];
		// sk-jay0.1.8.63.9: `entity_def_id` is the SAME field the `entity` scene
		// target already lists (no new disclosure); surfacing it here lets a
		// host resolve a public compendium reference by definition id without a
		// scene_detail round trip.
		const entityDefId = target.detail.entity_def_id;
		return {
			...base,
			...(conditionIds.length > 0 ? { conditions: conditionIds } : {}),
			...(typeof entityDefId === "string" && entityDefId !== ""
				? { entity_def_id: entityDefId }
				: {}),
		};
	}
	if (target.kind !== "exit") return base;
	const gates = target.detail.traversal_gates;
	const toNodeId = target.detail.to_node_id;
	const toDisplayName = target.detail.to_display_name;
	return {
		...base,
		...(typeof toNodeId === "string" && currentNodeId !== null
			? { to: truncateSceneNodePathPrefix(currentNodeId, toNodeId), to_node_id: toNodeId }
			: {}),
		...(typeof toDisplayName === "string" && toDisplayName !== ""
			? { to_name: toDisplayName }
			: {}),
		...(Array.isArray(gates) && gates.length > 0 ? { traversal_gates: gates } : {}),
	};
}

/**
 * sk-jay0.1.46 (runs 6-8 of the live-patch loop): every fresh player tried
 * `--target-id` on the detail tools first, by analogy with manipulate and
 * communicate, and paid one usage error. The detail tools now take the same
 * typed id as a second addressing mode. Without a rev there is nothing to
 * gate freshness against, so the CURRENT row is read and its rev returned;
 * {handle, rev} keeps the stale-read guard for callers that copied a row.
 */
function detailAddressing(
	params: { handle?: string; rev?: string; target_id?: string },
	domain: QueryDomain,
):
	| { mode: "handle"; handle: string; rev: string }
	| { mode: "target_id"; targetId: string }
	| { mode: "error"; payload: Record<string, unknown> } {
	const byHandle = params.handle !== undefined || params.rev !== undefined;
	if (params.target_id !== undefined && !byHandle) {
		return { mode: "target_id", targetId: params.target_id };
	}
	if (params.handle !== undefined && params.rev !== undefined && params.target_id === undefined) {
		return { mode: "handle", handle: params.handle, rev: params.rev };
	}
	return {
		mode: "error",
		payload: {
			status: "invalid_detail_params" as const,
			reason: `Pass exactly one addressing mode: {handle, rev} copied from ${DOMAIN_ORIENTATION_TOOLS[domain]}, or target_id (entity:<n>, item:<n>, actor:<n>) as spellkave_manipulate takes it.`,
		},
	};
}

/** The numeric tail of a typed target id (`entity:156` -> `156`), or undefined. */
function typedTargetNumber(targetId: string): string | undefined {
	const match = /^(?:entity|item|actor):(\d+)$/.exec(targetId.trim());
	return match?.[1];
}

const sceneDetailToolDef = defineTool<SpellkaveToolContext, typeof SCENE_DETAIL_PARAMS, unknown>({
	contract: SPELLKAVE_SCENE_DETAIL_TOOL,
	schema: SCENE_DETAIL_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof SCENE_DETAIL_PARAMS>) => {
		const { scene } = currentScene(context);
		const db = currentDb(context);
		const { actorId } = requireActorId(context);
		const targets = [
			...(scene?.targets ?? []),
			...observedSceneChildren(db, actorId, scene?.targets ?? []),
		];
		const addressing = detailAddressing(params, "scene");
		if (addressing.mode === "error") return toolResult(addressing.payload);
		if (addressing.mode === "target_id") {
			const number = typedTargetNumber(addressing.targetId);
			// A scene lists the same entity under its scene kind (actor, entity,
			// exit); the typed id's own kind is preferred, any kind with that id
			// is accepted, so entity:7 finds the actor row s:actor:7.
			const kind = addressing.targetId.split(":")[0];
			const target =
				number === undefined
					? undefined
					: (targets.find((row) => row.kind === kind && row.id === number) ??
						targets.find((row) => row.id === number && row.kind !== "exit"));
			if (target === undefined) {
				return toolResult({
					status: "unknown_target" as const,
					target_id: addressing.targetId,
					reason: `'${addressing.targetId}' is not a current scene target; call ${SPELLKAVE_SCENE_TOOL} for the current targets.`,
				});
			}
			return toolResult({
				status: "ok",
				rev: contentFingerprint(target),
				handle: stableHandle("scene", sceneTargetKey(target)),
				target,
			});
		}
		const resolved = resolveHandle(
			"scene",
			addressing.handle,
			addressing.rev,
			targets,
			sceneTargetKey,
		);
		if (resolved.status === "error") return toolResult(resolved.payload);
		return toolResult({
			status: "ok",
			rev: resolved.rev,
			handle: addressing.handle,
			target: resolved.target,
		});
	},
});

// T7 (act_scene -> spellkave_move rename, absorbing the deprecated raw
// edge-id spellkave_move wrapper): one movement tool, two mutually exclusive
// addressing modes. Preferred: {rev, handle}, a revision-bound scene exit
// handle (the former spellkave_move contract, unchanged). Compatibility:
// {edge_id}, a raw place_edge id for general/operator callers outside the
// scene-handle flow (the former deprecated raw spellkave_move contract,
// unchanged, via dispatchRawEdgeMove below). Since ADR-0091/0092 + slice 1b,
// this tool dispatches exclusively movement in both modes — the name says
// what it does.
/**
 * `wait_for_arrival_ms` on `spellkave_move`: when the dispatch started a
 * journey, wait for it to end and say where the actor stands. The dispatch
 * receipt is left as it was (`outcome: "travelling"` is what the act did);
 * only the observation and the added `journey` block describe the ending.
 */
async function settleJourney<T extends object>(
	context: SpellkaveToolContext,
	requestedMs: number | undefined,
	result: T,
): Promise<T | (T & Record<string, unknown>)> {
	if (requestedMs === undefined || requestedMs <= 0) return result;
	const receipt = (
		result as { receipt?: { outcome?: string; move?: { to_node?: string; from_node?: string } } }
	).receipt;
	if (receipt?.outcome !== "travelling") return result;
	const wait = await waitForJourneyEnd(context, requestedMs);
	if (wait.status !== "ended" && wait.status !== "not_travelling") {
		return { ...result, journey: wait };
	}
	const toNode = receipt.move?.to_node;
	const here = currentScene(context).scene?.node_id ?? null;
	if (toNode === undefined || here !== toNode) {
		return {
			...result,
			journey: { status: "ended_elsewhere" as const, waited_ms: wait.waited_ms, node_id: here },
			observation: null,
			observation_gap:
				"The journey ended before its destination; read spellkave_scene for where you stand.",
		};
	}
	return {
		...result,
		journey: { status: "arrived" as const, waited_ms: wait.waited_ms },
		...buildObservation(
			true,
			describeArrival(currentDb(context), toNode, receipt.move?.from_node ?? toNode),
			ARRIVAL_NO_DESCRIPTION_GAP,
		),
	};
}

const moveToolDef = defineTool<SpellkaveToolContext, typeof MOVE_PARAMS, unknown>({
	contract: SPELLKAVE_MOVE_TOOL,
	schema: MOVE_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof MOVE_PARAMS>) => {
		context = await steeringContext(context, params);
		const edgeGiven = params.edge_id !== undefined;
		const sceneGiven = params.rev !== undefined || params.handle !== undefined;
		if (edgeGiven && sceneGiven) {
			return toolResult({
				status: "invalid_move_params",
				reason:
					"Pass exactly one addressing mode: {rev, handle} (a scene exit handle) or {edge_id} (an adjacent-exit identifier), never both.",
			});
		}
		if (edgeGiven) {
			// biome-ignore lint/style/noNonNullAssertion: edgeGiven guarantees this.
			return dispatchRawEdgeMove(context, params.edge_id!);
		}
		if (params.rev === undefined || params.handle === undefined) {
			return toolResult({
				status: "invalid_move_params",
				reason:
					"Pass exactly one addressing mode: {rev, handle} (preferred, copied from spellkave_scene) or {edge_id} (an adjacent-exit identifier).",
			});
		}
		const { rev: sceneRev, handle } = params;
		const { scene } = currentScene(context);
		const targets = scene?.targets ?? [];
		const resolved = resolveHandle("scene", handle, sceneRev, targets, sceneTargetKey);
		if (resolved.status === "error") return toolResult(resolved.payload);
		const target = resolved.target;
		if (target.kind !== "exit") {
			return toolResult({
				status: "unsupported_scene_action",
				rev: resolved.rev,
				handle,
				reason: `Handle '${handle}' is not an exit; inspect it with ${SPELLKAVE_SCENE_DETAIL_TOOL} and use the relevant direct action tool.`,
			});
		}
		// Movement is attempt-based (ADR-0091): there is never a materialized
		// affordance handle for an exit, so every exit dispatches straight to
		// r_move via dispatchMovementByEdge.
		// `traversal_gates` is graph-derived advisory context only, never a
		// reason to refuse dispatch client-side.
		const traversalGates = target.detail.traversal_gates;
		const gates: TraversalGate[] = Array.isArray(traversalGates)
			? traversalGates.filter(
					(g): g is TraversalGate =>
						typeof g === "object" &&
						g !== null &&
						typeof (g as TraversalGate).template_id === "string" &&
						typeof (g as TraversalGate).mode_id === "string",
				)
			: [];
		const advisory = gates.length > 0 ? { traversal_gates: gates } : {};
		const result = await dispatchMovementByEdge(context, target.id, handle);
		const settled = await settleJourney(context, params.wait_for_arrival_ms, result);
		return toolResult({ ...settled, ...advisory });
	},
});

function currentInventory(context: SpellkaveToolContext, maxDepth?: number) {
	const { actorId } = requireActorId(context);
	const projection = readInventoryProjection(currentDb(context), actorId, { maxDepth });
	const items = projection?.items ?? [];
	return { projection, items, rev: queryRevision("inventory", items) };
}

/** Contained-entity id -> the equipment slot it fills, for the connected actor.
 * `entity_equipment_slot` carries one row per FILLED slot (no empty-slot rows),
 * so every row present means something is equipped. */
function equippedSlotMap(db: SnapshotDb, actorId: EntityRef): Map<string, string> {
	const equipment = readEquipment(db, actorId);
	return new Map((equipment?.slots ?? []).map((slot) => [slot.equipped_entity_id, slot.slot_id]));
}

interface InventoryTreeNode {
	/** Same authored identity exposed by the flat inventory listing. */
	entity_def_id: string;
	handle: string;
	rev: string;
	name: string;
	kind: string;
	quantity: number;
	equipped_slot?: string;
	contents?: InventoryTreeNode[];
}

/** Group the flat, depth-sorted inventory projection into a nested tree rooted
 * at the connected actor: each node's `contents` holds the items whose
 * `container_id` matches that node's own entity id. T12 (stable identity
 * handles): a handle is the item's own `entity_id` — stable for as long as
 * the item exists, regardless of position in the tree or what else in the
 * inventory changed — and `rev` is that item's OWN content fingerprint, so
 * the SAME item carries the SAME handle+rev whether read from the tree or
 * the flat paged fallback below. */
function buildInventoryTree(
	items: InventoryQueryItem[],
	rootEntityId: string,
	equipped: Map<string, string>,
): InventoryTreeNode[] {
	const byContainer = new Map<string, InventoryQueryItem[]>();
	for (const item of items) {
		const bucket = byContainer.get(item.container_id) ?? [];
		bucket.push(item);
		byContainer.set(item.container_id, bucket);
	}
	const node = (item: InventoryQueryItem): InventoryTreeNode => {
		const slot = equipped.get(item.entity_id);
		const contents = byContainer.get(item.entity_id);
		return {
			entity_def_id: item.entity_def_id,
			handle: stableHandle("inventory", item.entity_id),
			rev: contentFingerprint(item),
			name: item.name,
			kind: item.kind,
			quantity: item.quantity,
			...(slot === undefined ? {} : { equipped_slot: slot }),
			...(contents === undefined ? {} : { contents: contents.map(node) }),
		};
	};
	return (byContainer.get(rootEntityId) ?? []).map(node);
}

const DEFAULT_INVENTORY_LIMIT = 50;

const inventoryToolDef = defineTool<SpellkaveToolContext, typeof INVENTORY_PARAMS, unknown>({
	contract: SPELLKAVE_INVENTORY_TOOL,
	schema: INVENTORY_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof INVENTORY_PARAMS>) => {
		const { actorId } = requireActorId(context);
		const { projection, items: full, rev } = currentInventory(context);
		const rootEntityId = projection?.root_entity_id ?? actorId;
		const namePrefix = params.name_prefix?.toLocaleLowerCase();
		const filtered = params.kind !== undefined || namePrefix !== undefined;
		const limit = Math.max(1, Math.min(100, Math.trunc(params.limit ?? DEFAULT_INVENTORY_LIMIT)));

		if (!filtered && params.cursor === undefined && full.length <= limit) {
			const equipped = equippedSlotMap(currentDb(context), actorId);
			return toolResult({
				rev,
				root_entity_id: rootEntityId,
				count: full.length,
				total_quantity: full.reduce((sum, item) => sum + item.quantity, 0),
				traversal_truncated: projection?.truncated ?? false,
				listing: "complete" as const,
				items: buildInventoryTree(full, rootEntityId, equipped),
			});
		}

		const matched = full.filter(
			(item) =>
				(params.kind === undefined || item.kind === params.kind) &&
				(namePrefix === undefined || item.name.toLocaleLowerCase().startsWith(namePrefix)),
		);
		const equipped = equippedSlotMap(currentDb(context), actorId);
		const page = safeQueryPage({
			domain: "inventory",
			rows: matched,
			limit,
			cursor: params.cursor,
			revision: rev,
		});
		if (!("listing" in page)) return toolResult(page);
		const presented = {
			...page,
			total_items: full.length,
			traversal_truncated: projection?.truncated ?? false,
			kind: params.kind ?? null,
			name_prefix: params.name_prefix ?? null,
			items: page.items.map((item) => {
				const slot = equipped.get(item.entity_id);
				return {
					...item,
					handle: stableHandle("inventory", item.entity_id),
					rev: contentFingerprint(item),
					...(slot === undefined ? {} : { equipped_slot: slot }),
				};
			}),
		};
		if (page.matched === 0 && filtered) {
			const kindsPresent = presentValues(full, (item) => item.kind);
			const filterDescription = [
				params.kind === undefined ? undefined : `kind='${params.kind}'`,
				params.name_prefix === undefined ? undefined : `name_prefix='${params.name_prefix}'`,
			]
				.filter((part): part is string => part !== undefined)
				.join(" ");
			return toolResult({
				...presented,
				values_present: kindsPresent,
				reason: `No items with ${filterDescription}; kinds carried: [${kindsPresent.join(", ")}].`,
			});
		}
		return toolResult(presented);
	},
});

const itemDetailToolDef = defineTool<SpellkaveToolContext, typeof ITEM_DETAIL_PARAMS, unknown>({
	contract: SPELLKAVE_ITEM_DETAIL_TOOL,
	schema: ITEM_DETAIL_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof ITEM_DETAIL_PARAMS>) => {
		const { actorId } = requireActorId(context);
		const { items } = currentInventory(context);
		const addressing = detailAddressing(params, "inventory");
		if (addressing.mode === "error") return toolResult(addressing.payload);
		let item: (typeof items)[number];
		let rev: string;
		let handle: string;
		if (addressing.mode === "target_id") {
			const number = typedTargetNumber(addressing.targetId);
			const found =
				number === undefined ? undefined : items.find((row) => row.entity_id === number);
			if (found === undefined) {
				return toolResult({
					status: "unknown_target" as const,
					target_id: addressing.targetId,
					reason: `'${addressing.targetId}' is not in your inventory; call ${SPELLKAVE_INVENTORY_TOOL} for the current items.`,
				});
			}
			item = found;
			rev = contentFingerprint(found);
			handle = stableHandle("inventory", found.entity_id);
		} else {
			const resolved = resolveHandle(
				"inventory",
				addressing.handle,
				addressing.rev,
				items,
				(row) => row.entity_id,
			);
			if (resolved.status === "error") return toolResult(resolved.payload);
			item = resolved.target;
			rev = resolved.rev;
			handle = addressing.handle;
		}
		const detail = readAuthorizedItemDetail(currentDb(context), actorId, item.entity_id);
		return detail === null
			? toolResult({
					status: "item_unavailable" as const,
					rev,
					handle,
					reason: `Item no longer resolves (removed, consumed, or no longer authorized); call ${SPELLKAVE_INVENTORY_TOOL} for a fresh handle.`,
				})
			: toolResult({ status: "ok", rev, handle, item: detail });
	},
});

function currentTraces(context: SpellkaveToolContext) {
	const { actorId } = requireActorId(context);
	const projection = readCurrentTraceProjection(currentDb(context), actorId);
	// sk-0m4.97: PLAYER-facing pages are most-recent-first (same as orient).
	// `readCurrentTraceProjection` sorts oldest-first; reverse once here so
	// spellkave_traces and spellkave_orient share order + revision-bound cursors.
	const entries = [...(projection?.entries ?? [])].reverse();
	return { projection, entries, rev: queryRevision("trace", entries) };
}

const traceDetailToolDef = defineTool<SpellkaveToolContext, typeof TRACE_DETAIL_PARAMS, unknown>({
	contract: SPELLKAVE_TRACE_DETAIL_TOOL,
	schema: TRACE_DETAIL_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof TRACE_DETAIL_PARAMS>) => {
		const { entries } = currentTraces(context);
		const resolved = resolveHandle(
			"trace",
			params.handle,
			params.rev,
			entries,
			(entry) => entry.trace_id,
		);
		if (resolved.status === "error") return toolResult(resolved.payload);
		const { payload_json: _payloadJson, ...entry } = resolved.target;
		return toolResult({ status: "ok", rev: resolved.rev, handle: params.handle, trace: entry });
	},
});

const sessionStatusToolDef = defineTool<
	SpellkaveToolContext,
	typeof SESSION_STATUS_PARAMS,
	unknown
>({
	contract: SPELLKAVE_SESSION_STATUS_TOOL,
	schema: SESSION_STATUS_PARAMS,
	run: async (context: SpellkaveToolContext, params) => {
		const { actorId } = requireActorId(context);
		const db = currentDb(context);
		if (
			params.detail ||
			params.session_id !== undefined ||
			params.cursor !== undefined ||
			params.limit !== undefined
		) {
			if (resolveEntityId(db, actorId) === undefined) {
				return toolResult({ status: "actor_unresolved", session: null });
			}
			const ongoing = safeQueryPage({
				domain: "session",
				rows: readParticipantSessionSummaries(db, actorId),
				limit: params.limit,
				cursor: params.cursor,
			});
			if (!("listing" in ongoing)) return toolResult(ongoing);
			const detail = readParticipantSessionDetail(db, actorId, params.session_id);
			return toolResult({
				status: detail === null ? "no_session_detail" : "session_detail",
				session:
					detail === null
						? null
						: {
								...detail,
								roster: detail.roster.slice(0, 12),
								roster_total: detail.roster.length,
								roster_shown: Math.min(detail.roster.length, 12),
								roster_truncated: detail.roster.length > 12,
							},
				ongoing,
			});
		}
		const session = readParticipantSessionStatus(db, actorId);
		if (session === null) {
			// #1932 (audit row 53): `readParticipantSessionStatus` returns the same
			// `null` whether the actor legitimately has no active session or its
			// alias never resolved to an entity at all (a host identity-binding
			// bug). `resolveEntityId` is the same resolution step the reader runs
			// internally, so re-running it here at the tool layer distinguishes the
			// two without any SDK change.
			if (resolveEntityId(db, actorId) === undefined) {
				return toolResult({
					status: "actor_unresolved" as const,
					session: null,
					reason:
						"The connected actor id did not resolve; this is a host identity-binding problem, not an absence of session.",
				});
			}
			{
				const details = { status: "no_session" as const, session: null };
				return {
					content: [
						{
							type: "text" as const,
							text:
								"No active turn is selected. This does not establish whether another operation is pending or an action is allowed. Request detail for ongoing or waiting sessions. This is not the MCP connection.\n\n" +
								stringify(details),
						},
					],
					details,
				};
			}
		}
		const rosterTotal = session.roster.length;
		return toolResult({
			status: "active" as const,
			session: {
				...session,
				roster: session.roster.slice(0, SUMMARY_ROSTER_LIMIT),
				roster_total: rosterTotal,
				roster_shown: Math.min(rosterTotal, SUMMARY_ROSTER_LIMIT),
				roster_truncated: rosterTotal > SUMMARY_ROSTER_LIMIT,
			},
		});
	},
});

function currentReactionOptions(context: SpellkaveToolContext) {
	const { actorId } = requireActorId(context);
	const options = readReactionOptionsForActor(currentDb(context), actorId);
	const rev = queryRevision("reaction", options);
	if (context.observeQueryRevision) {
		try {
			const rows = structuredClone(options).map((row) => Object.freeze(row));
			context.observeQueryRevision(
				Object.freeze({ domain: "reaction", revision: rev, rows: Object.freeze(rows) }),
			);
		} catch {
			/* Artifact observation must never change a tool result. */
		}
	}
	return { actorId, options, rev };
}

async function presentReactionOption(
	option: ReturnType<typeof readReactionOptionsForActor>[number],
	handle: string,
) {
	return {
		handle,
		window_key: await reactionWindowKey("reaction", option.pending_id),
		originating_action_id: option.originating_action_id,
		originating_actor: option.originating_actor,
		target_actor: option.target_actor,
		target_entity_faction: option.target_entity_faction,
		session_id: option.session_id,
		window_opens_at_micros: option.window_opens_at_micros,
		window_closes_at_micros: option.window_closes_at_micros,
		depth: option.depth,
	};
}

const reactionOptionsToolDef = defineTool<
	SpellkaveToolContext,
	typeof REACTION_OPTIONS_PARAMS,
	unknown
>({
	contract: SPELLKAVE_REACTION_OPTIONS_TOOL,
	schema: REACTION_OPTIONS_PARAMS,
	run: async (context, params: Static<typeof REACTION_OPTIONS_PARAMS>) => {
		const { options, rev } = currentReactionOptions(context);
		const page = safeQueryPage({
			domain: "reaction",
			rows: options,
			limit: params.limit,
			cursor: params.cursor,
			revision: rev,
		});
		if (!("listing" in page)) return toolResult(page);
		const presented = {
			...page,
			items: await Promise.all(
				page.items.map((option) =>
					presentReactionOption(option, queryHandle("reaction", options.indexOf(option))),
				),
			),
		};
		if (page.matched === 0) {
			return toolResult({
				...presented,
				reason: `No reaction seats open; use ${SPELLKAVE_MANIPULATION_CONTEXT_TOOL} and a direct attempt to act instead.`,
			});
		}
		return toolResult(presented);
	},
});

function currentInterventionWindows(context: SpellkaveToolContext) {
	const { actorId } = requireActorId(context);
	const windows = readInterventionWindowsForActor(currentDb(context), actorId);
	return { actorId, windows, rev: queryRevision("intervention", windows) };
}

async function presentInterventionWindow(
	window: ReturnType<typeof readInterventionWindowsForActor>[number],
	handle: string,
) {
	return {
		handle,
		window_key: await reactionWindowKey("intervention", window.pending_id),
		originating_action_id: window.originating_action_id,
		session_id: window.session_id,
		window_opens_at_micros: window.window_opens_at_micros,
		window_closes_at_micros: window.window_closes_at_micros,
		// Wall-clock estimate only (server micros are Unix-epoch, per
		// `ctx.timestamp.to_duration_since_unix_epoch()`); a caller with lag
		// between its own clock and the node's should treat this as advisory,
		// not authoritative — window_closes_at_micros is the source of truth.
		remaining_ms: Math.max(0, Math.round(window.window_closes_at_micros / 1000 - Date.now())),
		faces: window.faces,
	};
}

const interventionWindowsToolDef = defineTool<
	SpellkaveToolContext,
	typeof INTERVENTION_WINDOWS_PARAMS,
	unknown
>({
	contract: SPELLKAVE_INTERVENTION_WINDOWS_TOOL,
	schema: INTERVENTION_WINDOWS_PARAMS,
	run: async (context, params: Static<typeof INTERVENTION_WINDOWS_PARAMS>) => {
		const { windows, rev } = currentInterventionWindows(context);
		const page = safeQueryPage({
			domain: "intervention",
			rows: windows,
			limit: params.limit,
			cursor: params.cursor,
			revision: rev,
		});
		if (!("listing" in page)) return toolResult(page);
		const presented = {
			...page,
			items: await Promise.all(
				page.items.map((window) =>
					presentInterventionWindow(window, queryHandle("intervention", windows.indexOf(window))),
				),
			),
		};
		if (page.matched === 0) {
			return toolResult({
				...presented,
				reason: "No intervention windows open right now; nothing to respond to.",
			});
		}
		return toolResult(presented);
	},
});

/** True for a handle minted by {@link interventionWindowsToolDef} (prefix "w"),
 * false otherwise — including malformed handles, which fall through to the
 * existing reaction-domain path below and get its `unknown_handle`/
 * `cross_domain` rejection unchanged. */
function isInterventionHandle(handle: string): boolean {
	return /^w\d+$/.test(handle);
}

const reactOptionToolDef = defineTool<SpellkaveToolContext, typeof REACT_OPTION_PARAMS, unknown>({
	contract: SPELLKAVE_REACT_OPTION_TOOL,
	schema: REACT_OPTION_PARAMS,
	run: async (context, params: Static<typeof REACT_OPTION_PARAMS>) => {
		const { act, actorId } = requireActorId(context);
		let pendingId: bigint;
		let rev: string;
		if (isInterventionHandle(params.handle)) {
			const current = currentInterventionWindows(context);
			rev = current.rev;
			if (params.rev !== rev) {
				return toolResult(staleHandleResult("intervention", rev, params.rev));
			}
			let index: number;
			try {
				index = parseQueryHandle(params.handle, "intervention", current.windows.length);
			} catch (error) {
				if (error instanceof QueryProtocolError) {
					return toolResult({
						status: error.code,
						rev,
						handle: params.handle,
						reason: `Handle '${params.handle}' is not an intervention handle for this revision; re-run ${SPELLKAVE_INTERVENTION_WINDOWS_TOOL} and copy a fresh handle.`,
					});
				}
				throw error;
			}
			const window = current.windows[index];
			if (window === undefined) {
				return toolResult({
					status: "option_unavailable" as const,
					rev,
					handle: params.handle,
					reason: `This intervention window is no longer open; call ${SPELLKAVE_INTERVENTION_WINDOWS_TOOL} for the current state.`,
				});
			}
			pendingId = window.pending_id;
		} else {
			const current = currentReactionOptions(context);
			rev = current.rev;
			if (params.rev !== rev) {
				return toolResult(staleHandleResult("reaction", rev, params.rev));
			}
			const badHandleReason = `Handle '${params.handle}' is not a reaction handle for this revision; re-run ${SPELLKAVE_REACTION_OPTIONS_TOOL} and copy a fresh handle.`;
			let index: number;
			try {
				index = parseQueryHandle(params.handle, "reaction", current.options.length);
			} catch (error) {
				if (error instanceof QueryProtocolError) {
					return toolResult({
						status: error.code,
						rev,
						handle: params.handle,
						reason: badHandleReason,
					});
				}
				throw error;
			}
			const option = current.options[index];
			if (option === undefined) {
				// #1932 (audit row 58): the rev matched, so this is not staleness — the
				// option itself vanished (window closed, already resolved) between the
				// listing and this call. Distinct status from the rev-mismatch case above.
				return toolResult({
					status: "option_unavailable" as const,
					rev,
					handle: params.handle,
					reason: `This reaction option is no longer open; call ${SPELLKAVE_REACTION_OPTIONS_TOOL} for the current window.`,
				});
			}
			pendingId = option.pending_id;
		}
		const react = dispatchAct(
			currentActorClient(act)?.react,
			() =>
				createActorClient(currentDb(context), actorId, {
					rReact: act.callRReact ?? notConfigured(SPELLKAVE_REACT_OPTION_TOOL),
				}).react,
		);
		const statesBeforeReact = readSelfStates(currentDb(context), actorId);
		const result = await react(pendingId, params.response_intent, params.selected_draw_index);
		const { pending_id: _pendingId, ...presented } = result;
		const accepted = presented.status === "success";
		// U1 minimal fix — same readable resolution summary as the manipulate
		// direct manipulation receipt (resolution.ts); omitted for a non-stochastic
		// reaction outcome.
		const resolution = parseResolutionSummary(presented.provenance?.selected_template_ids);
		// sk-0m4.74: consequences taken ONLY on a successful dispatch, same gate
		// every other act tool uses.
		const reactConsequences = accepted
			? shapeConsequences({}, worldEventCoordinator(context, actorId))
			: {};
		return toolResult({
			receipt: {
				status: "dispatched",
				outcome: actOutcome(presented.status),
				rev,
				handle: params.handle,
				// U2: PLAYER register — see slimActResultForPlayer's doc comment.
				reaction: slimActResultForPlayer(presented),
				...(resolution === null ? {} : { resolution }),
			},
			...buildObservation(
				accepted,
				accepted
					? describeSelfResourceDelta(
							statesBeforeReact,
							readSelfStates(currentDb(context), actorId),
						)
					: null,
				"No authored per-reaction outcome narrative exists yet and no owned resource state changed.",
			),
			...reactConsequences,
		});
	},
});

const suggestNextActionToolDef = defineTool({
	contract: SPELLKAVE_SUGGEST_NEXT_ACTION_TOOL,
	schema: SUGGEST_NEXT_ACTION_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof SUGGEST_NEXT_ACTION_PARAMS>) =>
		toolResult({
			suggestion: suggestNextAction(currentDb(context), asEntityRef(params.entity_ref)),
		}),
});

// T7: the compatibility edge_id branch of the unified spellkave_move tool
// (above), absorbed verbatim from the deprecated raw spellkave_move wrapper.
// Kept as its own function (rather than inlined) so the flat
// status/actor_id/edge_id/from_node/to_node/observed_at_tick shape stays
// legible against the rev+handle branch's receipt/observation shape.
async function dispatchRawEdgeMove(
	context: SpellkaveToolContext,
	rawEdgeId: string,
): Promise<
	ToolResult<{
		status: string;
		actor_id: string;
		edge_id: string;
		from_node: string;
		to_node: string;
		observed_at_tick: string;
		reason?: string;
		failure_detail?: string | null;
		provenance_id?: string;
	}>
> {
	const edgeId = rawEdgeId.trim();
	// Prefer the host's pre-wired ActorClient (session-backed, consistent with
	// the manipulate delegation shape). Fall back to the snapshot path
	// (SpellkaveMoveContext) when the host supplies only a reducer callback —
	// the fallback owns its own concurrency guard (`inFlight`), which does not
	// apply on the ActorClient path.
	const move = dispatchAct(currentActorClient(context.act)?.move, () => {
		const moveContext = context.move;
		if (moveContext === undefined) {
			throw new Error("spellkave_move is not configured");
		}
		const actorId =
			typeof moveContext.actorId === "function" ? moveContext.actorId() : moveContext.actorId;
		const state = moveContext.state ?? { inFlight: false };
		return async (edgeId: string) => {
			if (state.inFlight) {
				throw new Error(
					`concurrent move rejected: another spellkave_move is already in flight for actor '${actorId}'`,
				);
			}
			state.inFlight = true;
			try {
				const actorClient = createActorClient(currentDb(context), actorId, {
					rMove: (args) => moveContext.callRMove(args),
				});
				return await actorClient.move(edgeId);
			} finally {
				state.inFlight = false;
			}
		};
	});
	const result = await move(edgeId);
	if (result.status !== "success") {
		// Return structured rejection so the LLM sees WHY the move was blocked
		// (provenance.failure_detail carries the template id + predicate detail —
		// e.g. "affordance_template=X;predicate …"). Throwing discards this
		// signal; an agent cannot recover from an opaque error.
		const provenanceId = result.provenance?.provenance_id ?? result.provenance?.id;
		return toolResult({
			status: result.status,
			actor_id: result.actor_id,
			edge_id: result.edge_id,
			from_node: result.from_node ?? "",
			to_node: result.to_node ?? "",
			observed_at_tick: result.observedAtTick.toString(),
			reason: result.reason,
			failure_detail: result.provenance?.failure_detail ?? null,
			...(provenanceId !== undefined ? { provenance_id: provenanceId } : {}),
		});
	}
	const provenanceId = result.provenance?.provenance_id ?? result.provenance?.id;
	return toolResult({
		status: "success" as const,
		actor_id: result.actor_id,
		edge_id: result.edge_id,
		from_node: result.from_node ?? "",
		to_node: result.to_node ?? "",
		observed_at_tick: result.observedAtTick.toString(),
		...(provenanceId !== undefined ? { provenance_id: provenanceId } : {}),
	});
}

// --- Perceive tools: read-only views over existing @spellkave/sdk readers. ---

/** Turn/session facts shared by direct attempts and the session read surface. */
export interface SessionTurnState {
	in_session: boolean;
	current_actor: string | null;
	my_turn: boolean;
}

type ActiveSessionWithRoster = NonNullable<
	ReturnType<typeof readActiveSessionWithRosterForParticipant>
>;

function sessionTurnStateFromActive(
	active: ActiveSessionWithRoster | null,
	actorEntityId: bigint | undefined,
): SessionTurnState {
	if (active === null) return { in_session: false, current_actor: null, my_turn: false };
	return {
		in_session: true,
		current_actor: active.session.currentActor,
		my_turn: active.session.currentActor === String(actorEntityId),
	};
}

/**
 * ADR-0139 discovery exposes independent facts, not action-target offers.
 * A caller may rank and compose one ordinary attempt; r_manipulate remains
 * the authority for selection and admission.
 */
/** ADR-0142 D-6: an open prompt the actor has not answered yet. */
function hasOpenPrompt(context: {
	status: string;
	prompts?: readonly { consumed: boolean }[];
}): boolean {
	return context.status === "ready" && (context.prompts ?? []).some((prompt) => !prompt.consumed);
}

/**
 * sk-jay0.1.46 (run 2): a prompt opens one to three ticks after the answer
 * that leads to it, so a caller that reads the context right after answering
 * sees `prompts: []` and polls (17 of 65 calls in the measured run, ~25 KB
 * each). `wait_for_prompt_ms` turns that into one call: the same
 * cache-notification wait `spellkave_communicate` uses for its bounded reply
 * (`waitForReply`, `worldEvents.onUpdate`), bounded by the host's reply cap
 * (the daemon's 8 s, below the hosted gateway's 12 s invoke limit). No wait
 * happens when a prompt is already open, when the caller omits the field, or
 * when the host wired no cache-update subscription; the result says which.
 */
const manipulationContextToolDef = defineTool({
	contract: SPELLKAVE_MANIPULATION_CONTEXT_TOOL,
	schema: MANIPULATION_CONTEXT_PARAMS,
	run: async (
		context: SpellkaveToolContext,
		params: Static<typeof MANIPULATION_CONTEXT_PARAMS>,
	) => {
		context = await steeringContext(context, params);
		const { actorId } = requireActorId(context);
		const read = () => {
			const registry = readManipulationContext(currentDb(context), actorId);
			// sk-jay0.1.46.4: a model host reads this answer on every call, so the
			// default is the bounded summary; `detail: "full"` is the registry.
			const discovery =
				params.detail === "full"
					? registry
					: manipulationContextSummaryForPlayer(registry, { actionIds: params.action_ids });
			const token = captureDriverToken(currentDb(context), actorId);
			if (params.as_body_id === undefined || token === undefined) return discovery;
			return {
				...discovery,
				control_token: {
					world_instance_id: token.worldInstanceId,
					generation: String(token.generation),
					actor_id: String(token.actorId),
					body_entity_id: String(token.bodyEntityId),
				},
			};
		};
		const immediate = read();
		const requestedMs = params.wait_for_prompt_ms;
		if (requestedMs === undefined) return toolResult({ manipulation_context: immediate });
		if (hasOpenPrompt(immediate) || requestedMs <= 0) {
			return toolResult({
				manipulation_context: immediate,
				prompt_wait: { status: "already_open" as const, waited_ms: 0 },
			});
		}
		const worldEvents = context.worldEvents;
		if (worldEvents?.onUpdate === undefined) {
			return toolResult({
				manipulation_context: immediate,
				prompt_wait: { status: "unsupported" as const, waited_ms: 0 },
			});
		}
		const windowMs =
			worldEvents.replyWindowCapMs === undefined
				? requestedMs
				: Math.min(requestedMs, worldEvents.replyWindowCapMs);
		const clock = worldEvents.replyClock ?? realReplyWindowClock;
		const startedAt = clock.now();
		// Same lane discipline as the communicate reply window: the wait only
		// reads the snapshot synchronously on cache notifications.
		worldEvents.releaseInvokeLock?.();
		const opened = await waitForReply({
			windowMs,
			subscribe: worldEvents.onUpdate,
			clock: worldEvents.replyClock,
			signal: worldEvents.replySignal,
			read: () => {
				const fresh = read();
				return hasOpenPrompt(fresh) ? fresh : undefined;
			},
		});
		return toolResult({
			manipulation_context: opened ?? read(),
			prompt_wait: {
				status: opened === null ? ("timed_out" as const) : ("opened" as const),
				waited_ms: Math.max(0, Math.round(clock.now() - startedAt)),
				window_ms: windowMs,
			},
		});
	},
});

/**
 * ADR-0141 sensing discovery is a factual read: visible place/niches, the
 * actor's capabilities, and public authored query syntax. It deliberately
 * does not evaluate an eligibility predicate; a direct r_sense attempt does.
 */
const senseContextToolDef = defineTool({
	contract: SPELLKAVE_SENSE_CONTEXT_TOOL,
	schema: SENSE_CONTEXT_PARAMS,
	run: async (context: SpellkaveToolContext) => {
		const { actorId } = requireActorId(context);
		return toolResult({ sense_context: readSenseContext(currentDb(context), actorId) });
	},
});

// T8 slice 1a (extraction), slice 1b (sole remaining caller): dispatches
// r_move for a given edge and shapes the receipt + observation. Movement is
// attempt-based (ADR-0091) — the affordance cache never materializes a
// movement row, so moveToolDef's rev+handle branch (T7: the former
// actSceneToolDef) is this function's only caller.
// `handle` is the scene handle the caller passed in; it is echoed back on
// the receipt, never used to look anything up here.
async function dispatchMovementByEdge(
	context: SpellkaveToolContext,
	edgeId: string,
	handle: string,
) {
	const { act, actorId } = requireActorId(context);
	const move = dispatchAct(currentActorClient(act)?.move, () => {
		const moveContext = context.move;
		if (moveContext === undefined) throw new Error("spellkave_move movement is not configured");
		const moveActorId =
			typeof moveContext.actorId === "function" ? moveContext.actorId() : moveContext.actorId;
		const state = moveContext.state ?? { inFlight: false };
		return async (edgeId: string) => {
			if (state.inFlight) {
				throw new Error(
					`concurrent move rejected: another spellkave_move is already in flight for actor '${moveActorId}'`,
				);
			}
			state.inFlight = true;
			try {
				const actorClient = createActorClient(currentDb(context), moveActorId, {
					rMove: (args) => moveContext.callRMove(args),
				});
				return await actorClient.move(edgeId);
			} finally {
				state.inFlight = false;
			}
		};
	});
	let moveResult: Awaited<ReturnType<typeof move>>;
	try {
		moveResult = await move(edgeId);
	} catch (error) {
		// #1932 (audit row 74): concurrent-move rejection used to throw a raw
		// `Error`, which becomes a generic `isError` string instead of the
		// structured shape every sibling failure in this tool uses.
		if (error instanceof Error && error.message.startsWith("concurrent move rejected")) {
			return {
				status: "move_in_flight" as const,
				verb_class: "movement" as const,
				handle,
				reason:
					"Another move is already in progress for this actor; wait for it to resolve before retrying.",
			};
		}
		throw error;
	}
	const movedSuccessfully = moveResult.status === "success";
	// A promoted long-running move (feat/travel-eta, 2026-08-18). The actor is
	// walking and the server already priced the walk, so this is the one
	// non-success outcome that still has something TRUE to say. Reporting
	// "Nothing happens." here — which is what the `unobservable` path did — told
	// a player their step had failed when it had in fact been admitted.
	const travelling = moveResult.status === "travelling" ? moveResult : undefined;
	const arrivedAtNode = movedSuccessfully ? moveResult.to_node : undefined;
	// T5 (Gruppe A follow-up, operator review 2026-08-04): describeArrival
	// now needs the ORIGIN node too, to tell a within-graph hop (no
	// graph_description repeat) from a genuine graph crossing (see its
	// own doc comment, observation.ts) — the gap reason differs by WHY
	// there's no observation: a move that never resolved a destination
	// vs. one that arrived somewhere honestly undescribed.
	const arrivalObservation =
		arrivedAtNode !== undefined
			? describeArrival(currentDb(context), arrivedAtNode, moveResult.from_node)
			: null;
	// sk-0m4.74: consequences taken whenever the dispatch was ADMITTED — both
	// an immediate arrival ("success") and a promoted long-running walk
	// ("travelling") are an accepted r_move transaction that may have caused a
	// same-tick effect (e.g. a travel-cost resource spend); every other
	// non-success status (rejected/unobserved/move_in_flight) caused nothing.
	const moveConsequences =
		movedSuccessfully || travelling !== undefined
			? shapeConsequences({}, worldEventCoordinator(context, actorId))
			: {};
	const slimMove = slimMoveResultForPlayer(moveResult);
	return {
		receipt: {
			status: "dispatched" as const,
			verb_class: "movement" as const,
			handle,
			outcome: actOutcome(moveResult.status),
			...(slimMove.provenance_id !== undefined ? { provenance_id: slimMove.provenance_id } : {}),
			move: slimMove,
		},
		...(travelling === undefined
			? buildObservation(
					movedSuccessfully,
					arrivalObservation,
					arrivedAtNode === undefined
						? "Move did not resolve a destination node to describe."
						: ARRIVAL_NO_DESCRIPTION_GAP,
				)
			: { observation: describeDeparture(travelling.to_node, travelling.arrives_in_ticks) }),
		...moveConsequences,
	};
}

/**
 * Host-selected reply delivery for a dispatched `communicate` affordance.
 * Event-stream mode returns without claiming speech. Bundled mode claims
 * through the SAME builder used by pushes, waking on cache notifications
 * until a reply arrives or the bounded deadline expires.
 *
 * Return values are three-way, not boolean-shaped, because "no host builder"
 * and "no bundled reply" are different facts a caller needs told apart —
 * `buildConversationResult` (`observation.ts`) reads exactly this
 * distinction to decide `awaiting_response`:
 * - `undefined` — no host builder was injected; behavior is UNCHANGED from
 *   before this bead (the host never wired push events at all).
 * - `null` — event-stream mode was selected, or the bundled window expired;
 *   the reply, if any, still arrives exactly once via a LATER `pushes` drain
 *   (never silently dropped — see `takeWhere`'s carry contract).
 * - a filled {@link ConversationReply} — the FIRST matching `speech_heard`
 *   within the window. `isReply`'s `matched` flag stops it accepting a
 *   second simultaneous reply in the same `takeWhere` call, so a second line
 *   from the same speaker stays buffered for `pushes` rather than being
 *   silently swallowed here (zero-loss) or returned twice (zero-dup).
 *
 * `row.target_scope === "entity"` narrows `isReply` to that addressee's own
 * `inscribed_by` (a directed `srd/speak-to`); a world-scoped/broadcast
 * communicate (`target_scope === "world"`) accepts any speaker — the
 * builder already excludes the actor's OWN utterance (sk-dms.17,
 * `push-events.ts`'s speech_heard doc comment), so "any speaker" here can
 * never mean "hearing myself". ADR-0137: the one call site below now skips
 * calling this fn at all for `target_scope === "world"` (an addressee-less
 * shout has nobody in particular to reply, so it never opens a wait) — the
 * `undefined` branch here is kept defensive/generic rather than assuming
 * "entity" is the only reachable scope, in case a future caller (e.g. a
 * group-addressed communicate) legitimately wants to await any reply.
 */
/** The bounded reply window: the host's explicit window, else the observation
 * estimate capped by the host's reply cap (the daemon's 8 s). */
function resolveReplyWindowMs(
	context: SpellkaveToolContext,
	worldEvents: NonNullable<SpellkaveToolContext["worldEvents"]>,
): number {
	const estimator =
		typeof worldEvents.estimator === "function" ? worldEvents.estimator() : worldEvents.estimator;
	const authoredTickIntervalMs = (() => {
		const secs = readWorldStatus(currentDb(context))?.tickIntervalSecs;
		if (secs === undefined || !Number.isFinite(secs) || secs <= 0) return undefined;
		return secs * 1000;
	})();
	const defaultWindowMs = resolveObservationTimeoutMs(estimator, undefined, authoredTickIntervalMs);
	return (
		worldEvents.replyWindowMs ??
		(worldEvents.replyWindowCapMs === undefined
			? defaultWindowMs
			: Math.min(defaultWindowMs, worldEvents.replyWindowCapMs))
	);
}

/**
 * sk-jay0.1.47 (run 3): after a prompt-bound answer the next question's
 * prompt row opens one to three ticks later, so every creation choice cost
 * two calls — communicate, then manipulation_context with
 * `wait_for_prompt_ms`. The communicate receipt now carries that row itself:
 * once the bounded reply has landed (or its window closed) the same
 * cache-notification wait watches for a new open prompt row for whatever is
 * left of the reply window, never longer. The answered occurrence is
 * excluded: its row reads `consumed` only after the next snapshot, and a
 * stale copy must not be returned as "next". Plain speech (no
 * `semantic_context` in args_json) is untouched: no wait, no field.
 */
async function awaitNextPrompt(
	context: SpellkaveToolContext,
	actorId: Parameters<typeof readManipulationContext>[1],
	answeredOccurrenceId: string | undefined,
	deadline: { startedAt: number; windowMs: number },
): Promise<
	| { status: "unsupported"; waited_ms: 0 }
	| {
			status: "already_open" | "opened" | "timed_out";
			waited_ms: number;
			window_ms: number;
			prompts: ManipulationPromptRow[];
	  }
> {
	const worldEvents = context.worldEvents;
	if (worldEvents?.onUpdate === undefined) return { status: "unsupported", waited_ms: 0 };
	const read = (): ManipulationPromptRow[] | undefined => {
		const fresh = readManipulationContext(currentDb(context), actorId);
		if (fresh.status !== "ready") return undefined;
		const open = (fresh.prompts ?? []).filter(
			(prompt) => !prompt.consumed && prompt.occurrence_id !== answeredOccurrenceId,
		);
		return open.length === 0 ? undefined : open;
	};
	const clock = worldEvents.replyClock ?? realReplyWindowClock;
	const immediate = read();
	// Run 4 of the live patch loop (2026-09-26): when Aldwin's reply used up
	// the whole reply window, the prompt wait got `window_ms: 0` and every
	// answer still cost a second call. The prompt opens one to three ticks
	// after the answer, so the wait keeps a short grace floor beyond the
	// reply deadline; the sum stays under the hosted gateway's invoke limit
	// (8 s reply cap + 3 s grace < 12 s).
	// Run 5 (2026-09-26): with the grace measured from the reply DEADLINE, a
	// reply that itself took two ticks left three seconds for a prompt that
	// opens two ticks after it, and 7 of 13 answers still timed out. The
	// grace is now measured from the reply: up to NEXT_PROMPT_GRACE_MS after
	// it, cut so that the whole call (reply wait + grace) stays under the
	// hosted gateway's invoke budget.
	const elapsedMs = Math.max(0, clock.now() - deadline.startedAt);
	const graceMs = Math.max(
		NEXT_PROMPT_GRACE_FLOOR_MS,
		Math.min(NEXT_PROMPT_GRACE_MS, INVOKE_BUDGET_MS - elapsedMs),
	);
	const remainingMs = Math.max(graceMs, deadline.windowMs - elapsedMs);
	if (immediate !== undefined) {
		return { status: "already_open", waited_ms: 0, window_ms: remainingMs, prompts: immediate };
	}
	const waitStartedAt = clock.now();
	const opened = await waitForReply({
		windowMs: remainingMs,
		subscribe: worldEvents.onUpdate,
		clock: worldEvents.replyClock,
		signal: worldEvents.replySignal,
		read,
	});
	return {
		status: opened === null ? "timed_out" : "opened",
		waited_ms: Math.max(0, Math.round(clock.now() - waitStartedAt)),
		window_ms: remainingMs,
		prompts: opened ?? [],
	};
}

/** Grace the next-prompt wait keeps after the reply (see {@link awaitNextPrompt}):
 * two ticks at the default 2.5 s cadence. */
const NEXT_PROMPT_GRACE_MS = 5000;
/** Never less than this, even when the reply used the whole invoke budget. */
const NEXT_PROMPT_GRACE_FLOOR_MS = 3000;
/** The hosted gateway aborts an invoke at 12 s; keep the reply wait plus grace under it. */
const INVOKE_BUDGET_MS = 11_500;

/** Whether the disclosed action row for this speech act carries an authored
 * input form (`ui.affordance_input` with at least one field). */
function speechActHasInputForm(
	db: SnapshotDb,
	actorId: Parameters<typeof readManipulationContext>[1],
	speechActId: string,
): boolean {
	const fresh = readManipulationContext(db, actorId);
	if (fresh.status !== "ready") return false;
	const action = fresh.actions.find((row) => row.action_id === speechActId);
	return (action?.input?.fields.length ?? 0) > 0;
}

/**
 * sk-jay0.1.46 (runs 6-8 of the live-patch loop): every fresh player answered
 * `dm/creation/input/name` through `args_json {"name": ...}` once, because the
 * authored form field looked like any other field. The author now says which
 * transport carries a field (`input.fields[].channel`); this returns the
 * args_json keys that name an utterance-channel field of `actionId`, so the
 * tool can refuse BEFORE the world drops them.
 */
function utteranceChannelKeys(
	db: SnapshotDb,
	actorId: Parameters<typeof readManipulationContext>[1],
	actionId: string,
	argsJson: string | undefined,
): string[] {
	if (argsJson === undefined || argsJson.trim().length === 0) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(argsJson);
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return [];
	const fresh = readManipulationContext(db, actorId);
	if (fresh.status !== "ready") return [];
	const fields = fresh.actions.find((row) => row.action_id === actionId)?.input?.fields ?? [];
	const utteranceFields = new Set(
		fields.filter((field) => field.channel === "utterance").map((field) => field.name),
	);
	return Object.keys(parsed).filter((key) => utteranceFields.has(key));
}

function utteranceRequiredHint(actionId: string, keys: readonly string[]): string {
	return (
		`args_json keys ${JSON.stringify(keys)} name input fields of '${actionId}' whose channel is "utterance": ` +
		"the world reads their value from what you SAY. Send spellkave_communicate with " +
		`speech_act_id '${actionId}' and the value as utterance (plain text for one field, ` +
		"or a JSON object keyed by field name for several); leave args_json empty."
	);
}

/** The occurrence a prompt-bound answer names, or `undefined` for plain speech. */
function answeredPromptOccurrence(argsJson: string | undefined): string | undefined {
	if (argsJson === undefined || argsJson.trim().length === 0) return undefined;
	try {
		const parsed: unknown = JSON.parse(argsJson);
		if (typeof parsed !== "object" || parsed === null) return undefined;
		const semantic = (parsed as Record<string, unknown>).semantic_context;
		if (typeof semantic !== "object" || semantic === null) return undefined;
		const occurrence = (semantic as Record<string, unknown>).occurrence_id;
		return occurrence === undefined || occurrence === null ? "" : String(occurrence);
	} catch {
		return undefined;
	}
}

async function awaitConversationReply(
	context: SpellkaveToolContext,
	target: { scope: "world" | "entity"; entityId?: string },
): Promise<ConversationReply | null | undefined> {
	const worldEvents = context.worldEvents;
	if (worldEvents === undefined) return undefined;
	if (worldEvents.replyDelivery === "events") return null;
	const addresseeEntityId = target.scope === "entity" ? target.entityId : undefined;
	let matched = false;
	const isReply = (event: WorldEvent): boolean => {
		if (matched) return false;
		if (event.kind !== "speech_heard") return false;
		if (addresseeEntityId !== undefined && event.inscribed_by !== addresseeEntityId) return false;
		matched = true;
		return true;
	};
	const windowMs = resolveReplyWindowMs(context, worldEvents);
	if (worldEvents.onUpdate === undefined) {
		throw new Error("Bundled conversation replies require a host cache-update subscription");
	}
	// Register before releasing the host lane. Reads claim from the same cursor
	// used by subsequent pushes; the notification never advances another cursor.
	const waiting = waitForReply({
		windowMs,
		subscribe: worldEvents.onUpdate,
		clock: worldEvents.replyClock,
		signal: worldEvents.replySignal,
		read: () => {
			const [hit] = worldEvents.builder.takeWhere(isReply);
			if (hit === undefined || hit.kind !== "speech_heard") return undefined;
			return {
				speaker: hit.inscribed_by,
				speaker_name: hit.inscribed_by_name,
				// sk-jay0.1.11: `hit.addressee`/`addressee_name` are absent (not
				// `null`) on untargeted speech (`world-events.ts`'s
				// `SpeechHeardEvent` doc comment) — normalized to `null` here, the
				// same "no addressee named" reading either way.
				addressee: hit.addressee ?? null,
				addressee_name: hit.addressee_name ?? null,
				text: hit.text,
				trace_id: hit.trace_id,
			};
		},
	});
	worldEvents.releaseInvokeLock?.();
	return waiting;
}

/**
 * sk-0m4.74: the `consequences` register — after a SUCCESSFUL act dispatch,
 * take (`WorldEventBuilder.takeWhere`, ONE call, no polling, no window) every
 * event {@link isCausedByActor} (`push-events.ts`) attributes to THIS actor's
 * own act at THIS tick. Returns:
 * - `undefined` when no host builder was injected — the `consequences` field
 *   is OMITTED entirely from the act result, byte-identical to a host that
 *   never wired one (no `worldEvents` context ⇒ no behavior change at all).
 * - `[]` when a builder was injected but nothing matched (the common case:
 *   most dispatches cause no same-tick dealt_hit/resource-spend/window-open).
 * - the matched events otherwise, in occurrence order.
 *
 * NEVER called for a rejected/unobserved dispatch (every call site gates on
 * its own `accepted`/`movedSuccessfully` boolean first) — nothing was caused,
 * so nothing is taken; whatever the builder holds stays buffered for a later
 * `pushes` drain, same as any other rejected act.
 *
 * Tick assumption (module header of `isCausedByActor`): the act's own tick is
 * not cheaply available at these call sites, so the CURRENT tick — read from
 * the SAME `db` right after the outcome, i.e. within this same reducer
 * transaction under ordinary turn-based single-actor-per-transaction
 * semantics — stands in for it.
 */
function worldEventCoordinator(
	context: SpellkaveToolContext,
	actorId: EntityRef,
): WorldEventCoordinatorPort | undefined {
	const worldEvents = context.worldEvents;
	if (worldEvents === undefined) return undefined;
	const db = currentDb(context);
	const actorEntityId = resolveEntityId(db, actorId);
	if (actorEntityId === undefined) {
		// Preserve the established "applicable but empty" field without draining
		// a builder that cannot be attributed to this actor.
		return { source: { takeWhere: () => [] }, actorEntityId: "", tick: 0 };
	}
	const actorEntityIdText = String(actorEntityId);
	const tick = readWorldStatus(db)?.tick ?? 0;
	return {
		source: worldEvents.builder,
		actorEntityId: actorEntityIdText,
		tick,
	};
}

/**
 * Execute the one direct manipulation transport and build the PLAYER receipt.
 * Discovery is deliberately absent here: callers may have composed from a
 * factored context or may be making a direct trial-and-error attempt. In both
 * cases this function consults no eager action×target cache row.
 */
async function dispatchManipulationForPlayer(
	context: SpellkaveToolContext,
	act: SpellkaveActorContext,
	actorId: EntityRef,
	request: {
		targetRef: string;
		actionId: string;
		argsJson: string;
		actionLabel?: string;
		/** Caller keys the wire parser will not read (`auditArgsJson`); named on the receipt. */
		ignoredArgs?: readonly string[];
	},
) {
	const db = currentDb(context);
	const manipulate = dispatchAct(
		currentActorClient(act)?.manipulate,
		() =>
			createActorClient(currentDb(context), actorId, {
				rManipulate: act.callRManipulate ?? notConfigured(SPELLKAVE_MANIPULATE_TOOL),
				successOnProvenance: true,
			}).manipulate,
	);
	const statesBeforeManipulate = readSelfStates(db, actorId);
	const sceneBeforeManipulate = readCurrentScene(db, actorId)?.targets ?? [];
	const applyEventsBefore = readEventApplyConsequences(db);
	const manipulateResult = await manipulate(
		request.targetRef,
		request.actionId,
		request.argsJson,
		() => false,
		() => null,
	);
	const accepted = manipulateResult.status === "success";
	const outcomeTemplateId = manipulateResult.provenance?.selected_template_ids?.[1];
	const outcomeTemplateObservation =
		accepted && outcomeTemplateId !== undefined
			? await describeOutcomeTemplate(currentDb(context), outcomeTemplateId, {
					actorId,
					targetRef: asEntityRef(request.targetRef),
				})
			: null;
	const dbAfterManipulate = currentDb(context);
	const targetEntityId = resolveEntityId(db, asEntityRef(request.targetRef));
	const targetEntity =
		targetEntityId === undefined
			? undefined
			: readEntity(dbAfterManipulate, asEntityRef(request.targetRef));
	const spawned = accepted
		? resolveSpawnedCreatures({
				serverEventsBefore: applyEventsBefore,
				serverEventsAfter: readEventApplyConsequences(dbAfterManipulate),
				originalTargetEntityId: targetEntityId === undefined ? undefined : String(targetEntityId),
				sceneBefore: sceneBeforeManipulate,
				sceneAfter: readCurrentScene(dbAfterManipulate, actorId)?.targets ?? [],
			})
		: [];
	const resolvedObservation = accepted
		? (outcomeTemplateObservation ??
			describeSelfResourceDelta(
				statesBeforeManipulate,
				readSelfStates(dbAfterManipulate, actorId),
			) ??
			describeSpawnedCreatures(spawned))
		: null;
	const resolution = isUnobservedActStatus(manipulateResult.status)
		? null
		: parseResolutionSummary(manipulateResult.provenance?.selected_template_ids);
	const targetConditions = accepted
		? readActorConditions(dbAfterManipulate, asEntityRef(request.targetRef))
		: null;
	const resolutionMessage =
		resolution === null
			? undefined
			: describeResolutionOutcome(resolution, {
					action: request.actionLabel || request.actionId || "action",
					target: targetEntity?.name || request.targetRef,
				});
	const slimmedManipulate = slimActResultForPlayer(manipulateResult);
	const manipulateConsequences = accepted
		? shapeConsequences({}, worldEventCoordinator(context, actorId))
		: {};
	return toolResult({
		receipt: {
			status: "dispatched" as const,
			verb_class: "manipulate",
			outcome: actOutcome(manipulateResult.status),
			...(slimmedManipulate.provenance_id !== undefined
				? { provenance_id: slimmedManipulate.provenance_id }
				: {}),
			manipulate: {
				...slimmedManipulate,
				...(slimmedManipulate.player_message === undefined && resolutionMessage !== undefined
					? { player_message: resolutionMessage }
					: {}),
				...(request.ignoredArgs === undefined || request.ignoredArgs.length === 0
					? {}
					: {
							ignored_args: [...request.ignoredArgs],
							tool_hint: ignoredArgsHint(request.ignoredArgs),
						}),
			},
			...(resolution === null ? {} : { resolution }),
			...(targetConditions === null ? {} : { target_conditions: targetConditions }),
			...(spawned.length === 0 ? {} : { spawned }),
		},
		...buildActObservation(
			manipulateResult.status,
			resolvedObservation,
			"Nothing you can perceive changed, and this action has no narrative of its own.",
		),
		...manipulateConsequences,
	});
}

const entityToolDef = defineTool({
	contract: SPELLKAVE_ENTITY_TOOL,
	schema: ENTITY_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof ENTITY_PARAMS>) =>
		toolResult({ entity: readEntity(currentDb(context), asEntityRef(params.entity_id)) }),
});

const entityContainerToolDef = defineTool({
	contract: SPELLKAVE_ENTITY_CONTAINER_TOOL,
	schema: ENTITY_CONTAINER_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof ENTITY_CONTAINER_PARAMS>) =>
		toolResult({
			container: readEntityContainer(currentDb(context), asEntityRef(params.entity_id)),
		}),
});

const observerKnowledgeToolDef = defineTool({
	contract: SPELLKAVE_OBSERVER_KNOWLEDGE_TOOL,
	schema: OBSERVER_KNOWLEDGE_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof OBSERVER_KNOWLEDGE_PARAMS>) =>
		toolResult({ knowledge: readObserverKnowledge(currentDb(context), params.observer_id) }),
});

const observerPlaceKnowledgeToolDef = defineTool({
	contract: SPELLKAVE_OBSERVER_PLACE_KNOWLEDGE_TOOL,
	schema: OBSERVER_PLACE_KNOWLEDGE_PARAMS,
	run: async (
		context: SpellkaveToolContext,
		params: Static<typeof OBSERVER_PLACE_KNOWLEDGE_PARAMS>,
	) =>
		toolResult({
			place_knowledge: readObserverPlaceKnowledge(currentDb(context), params.observer_id),
		}),
});

const observerTraceKnowledgeToolDef = defineTool({
	contract: SPELLKAVE_OBSERVER_TRACE_KNOWLEDGE_TOOL,
	schema: OBSERVER_TRACE_KNOWLEDGE_PARAMS,
	run: async (
		context: SpellkaveToolContext,
		params: Static<typeof OBSERVER_TRACE_KNOWLEDGE_PARAMS>,
	) =>
		toolResult({
			trace_knowledge: readObserverTraceKnowledge(currentDb(context), params.observer_id),
		}),
});

// #1931: merges the former traceSummaryToolDef + traceEntriesToolDef pair into
// one dual-shape tool, taking over the `spellkave_traces` name (the deprecated
// general-compatibility location-keyed reader that name used to belong to is
// retired outright — early-stage posture, no alias/shim). Same pattern as
// sceneToolDef above. `by_kind` (and its truncation companions) is computed
// over ALL perceived traces and stays GLOBAL under a kind/kind_prefix filter in
// BOTH branches — it is the field that answers "what else is here", and losing
// it on first filter would defeat part of the merge's own value proposition.
const tracesToolDef = defineTool<SpellkaveToolContext, typeof TRACE_ENTRIES_PARAMS, unknown>({
	contract: SPELLKAVE_TRACES_TOOL,
	schema: TRACE_ENTRIES_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof TRACE_ENTRIES_PARAMS>) => {
		const { projection, entries: full, rev } = currentTraces(context);
		const byKind: Record<string, number> = {};
		for (const entry of full) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
		const kindGroups = boundRecord(byKind);
		const filtered =
			params.kind !== undefined ||
			params.kind_prefix !== undefined ||
			params.inscribed_by !== undefined ||
			params.visibility !== undefined;
		const limit = Math.max(1, Math.min(100, Math.trunc(params.limit ?? TRACE_LIMIT)));
		const summary = {
			current_node_id: projection?.current_node_id ?? null,
			total_traces: full.length,
			by_kind: kindGroups.values,
			kind_groups_total: kindGroups.total,
			kind_groups_shown: kindGroups.shown,
			kind_groups_truncated: kindGroups.truncated,
		};

		if (!filtered && params.cursor === undefined && full.length <= limit) {
			return toolResult({
				...summary,
				rev,
				listing: "complete" as const,
				items: full.map((entry) => ({
					handle: stableHandle("trace", entry.trace_id),
					rev: contentFingerprint(entry),
					kind: entry.kind,
					inscribed_at: entry.inscribed_at,
					expires_at: entry.expires_at,
					inscribed_by: entry.inscribed_by,
					visibility: entry.visibility,
				})),
			});
		}

		const matched = full.filter(
			(entry) =>
				(params.kind === undefined || entry.kind === params.kind) &&
				(params.kind_prefix === undefined || entry.kind.startsWith(params.kind_prefix)) &&
				(params.inscribed_by === undefined || entry.inscribed_by === params.inscribed_by) &&
				(params.visibility === undefined || entry.visibility === params.visibility),
		);
		const page = safeQueryPage({
			domain: "trace",
			rows: matched,
			limit,
			cursor: params.cursor,
			revision: rev,
		});
		if (!("listing" in page)) return toolResult(page);
		const presented = {
			...page,
			...summary,
			items: page.items.map((entry) => ({
				handle: stableHandle("trace", entry.trace_id),
				rev: contentFingerprint(entry),
				kind: entry.kind,
				inscribed_at: entry.inscribed_at,
				expires_at: entry.expires_at,
				inscribed_by: entry.inscribed_by,
				visibility: entry.visibility,
			})),
		};
		if (page.matched === 0 && filtered) {
			const kindsPresent = presentValues(full, (entry) => entry.kind);
			const visibilitiesPresent = presentValues(full, (entry) => entry.visibility);
			return toolResult({
				...presented,
				values_present: { kind: kindsPresent, visibility: visibilitiesPresent },
				reason: `No traces matched the given filter; kinds present: [${kindsPresent.join(", ")}]; visibilities present: [${visibilitiesPresent.join(", ")}].`,
			});
		}
		return toolResult(presented);
	},
});

const entityBodyToolDef = defineTool({
	contract: SPELLKAVE_ENTITY_BODY_TOOL,
	schema: ENTITY_BODY_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof ENTITY_BODY_PARAMS>) =>
		toolResult({ body: readEntityBody(currentDb(context), asEntityRef(params.entity_id)) }),
});

const actorPrincipalsToolDef = defineTool({
	contract: SPELLKAVE_ACTOR_PRINCIPALS_TOOL,
	schema: ACTOR_PRINCIPALS_PARAMS,
	run: async (context: SpellkaveToolContext) =>
		toolResult({ principals: readActorPrincipals(currentDb(context)) }),
});

// --- Act tools: provenance-observed actor verbs over the SDK ActorClient. ---
//
// Each needs the host to supply the reducer caller in `context.act` (the host
// brings its own binding, exactly like `move`). The verbs are provenance-observed
// by the SDK — no client-side success predicate — so the tool returns the
// observed status (success | rejected | unobserved_timeout | unobserved_no_provenance).

const communicateToolDef = defineTool<SpellkaveToolContext, typeof COMMUNICATE_PARAMS, unknown>({
	contract: SPELLKAVE_COMMUNICATE_TOOL,
	schema: COMMUNICATE_PARAMS,
	run: async (context, params) => {
		const { act, actorId } = requireActorId(context);
		const targetScope = params.target_id === "world" ? "world" : "entity";
		if (
			targetScope !== "world" &&
			context.worldEvents !== undefined &&
			context.worldEvents.replyDelivery !== "events" &&
			context.worldEvents.onUpdate === undefined
		) {
			throw new Error("Bundled conversation replies require a host cache-update subscription");
		}
		// Prefer the host's pre-wired ActorClient (session-backed, carries the
		// provenanceBuffer so the provenance verdict is actually observed). Fall
		// back to the bare-snapshot path when the host supplies only a reducer
		// callback.
		const manipulate = dispatchAct(
			currentActorClient(act)?.manipulate,
			() =>
				createActorClient(currentDb(context), actorId, {
					rManipulate: act.callRManipulate ?? notConfigured(SPELLKAVE_COMMUNICATE_TOOL),
					successOnProvenance: true,
				}).manipulate,
		);
		const utterance = params.utterance?.trim() || undefined;
		// sk-jay0.1.46: a malformed blob used to fall through as `{}` and come
		// back from the server as an unclassified rejection with no detail.
		const argsAudit = auditArgsJson(params.args_json);
		if (argsAudit.status === "malformed") {
			return toolResult({
				receipt: {
					status: "rejected" as const,
					verb_class: "communicate",
					outcome: "malformed_args",
					reason: argsAudit.reason,
				},
			});
		}
		const ignoredArgs =
			argsAudit.ignored_keys.length === 0
				? {}
				: {
						ignored_args: argsAudit.ignored_keys,
						tool_hint: ignoredArgsHint(argsAudit.ignored_keys),
					};
		if (utterance === undefined) {
			const utteranceKeys = utteranceChannelKeys(
				currentDb(context),
				actorId,
				params.speech_act_id,
				params.args_json,
			);
			if (utteranceKeys.length > 0) {
				return toolResult({
					receipt: {
						status: "rejected" as const,
						verb_class: "communicate",
						outcome: "utterance_required",
						reason: `'${params.speech_act_id}' reads ${JSON.stringify(utteranceKeys)} from the utterance, and none was given.`,
					},
					tool_hint: utteranceRequiredHint(params.speech_act_id, utteranceKeys),
				});
			}
		}
		const communicateResult = await manipulate(
			params.target_id,
			params.speech_act_id,
			withUtterance(params.args_json, utterance),
			() => false,
			() => null,
		);
		const accepted = communicateResult.status === "success";
		const communicateConsequences = accepted
			? shapeConsequences({}, worldEventCoordinator(context, actorId))
			: {};
		const targetEntityId = resolveEntityId(currentDb(context), asEntityRef(params.target_id));
		const answeredOccurrence = answeredPromptOccurrence(params.args_json);
		const replyClock = context.worldEvents?.replyClock ?? realReplyWindowClock;
		const replyStartedAt = replyClock.now();
		const reply =
			accepted && targetScope !== "world"
				? await awaitConversationReply(context, {
						scope: targetScope,
						entityId: targetEntityId === undefined ? undefined : String(targetEntityId),
					})
				: undefined;
		// sk-jay0.1.47: a prompt-bound answer also returns the next open prompt
		// row, waited for inside what is left of the same reply window. Run 6:
		// so does an accepted utterance on an authored input form (the name
		// step): the DM answers it with a prompt (the adoption offer), and
		// without the wait that step cost a manipulation_context read.
		const inputFormAnswer =
			accepted &&
			answeredOccurrence === undefined &&
			utterance !== undefined &&
			speechActHasInputForm(currentDb(context), actorId, params.speech_act_id);
		const nextPrompt =
			accepted &&
			(answeredOccurrence !== undefined || inputFormAnswer) &&
			context.worldEvents !== undefined
				? {
						next_prompt: await awaitNextPrompt(context, actorId, answeredOccurrence, {
							startedAt: replyStartedAt,
							windowMs: resolveReplyWindowMs(context, context.worldEvents),
						}),
					}
				: {};
		return toolResult({
			receipt: {
				status: "dispatched" as const,
				verb_class: "communicate",
				outcome: actOutcome(communicateResult.status),
				communicate: { ...slimActResultForPlayer(communicateResult), ...ignoredArgs },
				...nextPrompt,
			},
			...buildActObservation(
				communicateResult.status,
				accepted && utterance !== undefined ? `You say: "${utterance}"` : null,
				"No spoken utterance was supplied (pass `utterance` to speak aloud); communicate outcomes carry no authored per-action narrative otherwise.",
			),
			conversation: buildConversationResult(accepted, accepted ? (utterance ?? null) : null, reply),
			...communicateConsequences,
		});
	},
});

const senseToolDef = defineTool({
	contract: SPELLKAVE_SENSE_TOOL,
	schema: SENSE_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof SENSE_PARAMS>) => {
		context = await steeringContext(context, params);
		const { act, actorId } = requireActorId(context);
		const sense = dispatchAct(
			currentActorClient(act)?.sense,
			() =>
				createActorClient(currentDb(context), actorId, {
					rSense: act.callRSense ?? notConfigured(SPELLKAVE_SENSE_TOOL),
					successOnProvenance: true,
				}).sense,
		);
		const senseResult = await sense(params.query_kind, params.visibility);
		const accepted = senseResult.status === "success";
		const outcomeTemplateId = senseResult.provenance?.selected_template_ids?.[1];
		const observation =
			accepted && outcomeTemplateId !== undefined
				? await describeOutcomeTemplate(currentDb(context), outcomeTemplateId, { actorId })
				: null;
		const consequences = accepted
			? shapeConsequences({}, worldEventCoordinator(context, actorId))
			: {};
		return toolResult({
			receipt: {
				status: "dispatched" as const,
				verb_class: "sensing",
				outcome: actOutcome(senseResult.status),
				sense: slimActResultForPlayer(senseResult),
			},
			...buildObservation(accepted, observation, "This action has no narrative of its own."),
			...consequences,
		});
	},
});

const sessionOpenToolDef = defineTool({
	contract: SPELLKAVE_SESSION_OPEN_TOOL,
	schema: SESSION_OPEN_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof SESSION_OPEN_PARAMS>) => {
		const { act, actorId } = requireActorId(context);
		// No host ActorClient carries a bindable `sessionOpen` in
		// `SpellkaveActorContext.actorClient` (it opens a NEW session, so there is
		// no existing session-scoped client method to prefer) — always the bare
		// reducer callback.
		if (act.callRSessionOpen === undefined) {
			throw new Error("spellkave_session_open is not configured");
		}
		const client = createActorClient(currentDb(context), actorId, {
			rSessionOpen: act.callRSessionOpen,
		});
		return toolResult({
			session: await client.sessionOpen(params.session_def_id, params.participants_csv ?? ""),
		});
	},
});

const sessionCloseToolDef = defineTool({
	contract: SPELLKAVE_SESSION_CLOSE_TOOL,
	schema: SESSION_CLOSE_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof SESSION_CLOSE_PARAMS>) => {
		const { act, actorId } = requireActorId(context);
		const sessionId = BigInt(params.session_id);
		const sessionClose = dispatchAct(
			currentActorClient(act)?.sessionClose,
			() =>
				createActorClient(currentDb(context), actorId, {
					rSessionClose: act.callRSessionClose ?? notConfigured(SPELLKAVE_SESSION_CLOSE_TOOL),
				}).sessionClose,
		);
		const observations = params.control_tokens?.map((token) => ({
			worldInstanceId: token.world_instance_id,
			generation: BigInt(token.generation),
			actorId: BigInt(token.actor_id),
			bodyEntityId: BigInt(token.body_entity_id),
		}));
		return toolResult({ session: await sessionClose(sessionId, params.outcome, observations) });
	},
});

const sessionMoveToolDef = defineTool({
	contract: SPELLKAVE_SESSION_MOVE_TOOL,
	schema: SESSION_MOVE_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof SESSION_MOVE_PARAMS>) => {
		const { act, actorId } = requireActorId(context);
		const sessionId = BigInt(params.session_id);
		const sessionMove = dispatchAct(
			currentActorClient(act)?.sessionMove,
			() =>
				createActorClient(currentDb(context), actorId, {
					rSessionMove: act.callRSessionMove ?? notConfigured(SPELLKAVE_SESSION_MOVE_TOOL),
				}).sessionMove,
		);
		return toolResult({ session: await sessionMove(sessionId, params.move_template_id) });
	},
});

const endTurnToolDef = defineTool({
	contract: SPELLKAVE_END_TURN_TOOL,
	schema: END_TURN_PARAMS,
	run: async (context: SpellkaveToolContext) => {
		const { act, actorId } = requireActorId(context);
		const endTurn = dispatchAct(
			currentActorClient(act)?.endTurn,
			() =>
				createActorClient(currentDb(context), actorId, {
					rAdvanceTurn: act.callRAdvanceTurn ?? notConfigured(SPELLKAVE_END_TURN_TOOL),
				}).endTurn,
		);
		const advance = await endTurn();
		const accepted = advance.status === "success";
		// U3 follow-up (end_turn piggyback, operator review 2026-08-04): read
		// the session state fresh AFTER the advance committed — this is the
		// NEW current actor, not the one who just ended their turn. Only
		// meaningful on a successful advance; a rejected end_turn changed
		// nothing worth re-reading.
		const db = currentDb(context);
		const entityId = accepted ? resolveEntityId(db, actorId) : undefined;
		const active =
			entityId === undefined
				? null
				: readActiveSessionWithRosterForParticipant(db, String(entityId));
		// #1932 (audit row 60): previously no top-level `status` at all — a caller
		// had to inspect `advance.status` with zero signal anything could fail.
		return toolResult({
			receipt: {
				status: accepted ? ("dispatched" as const) : ("rejected" as const),
				outcome: actOutcome(advance.status),
				advance,
				...(accepted
					? {}
					: {
							reason:
								"Call spellkave_session_status to confirm whose turn it currently is in the in-world turn/scene (not the MCP connection).",
						}),
			},
			...(accepted ? { session: sessionTurnStateFromActive(active, entityId) } : {}),
			// #1921: ending one's own turn is always-true bookkeeping the actor
			// certainly perceives — not speculative narrative, so a fixed line is
			// honest, not fabricated. No resource-delta/location source applies
			// (end_turn moves no one and applies no consequence of its own).
			...buildObservation(accepted, accepted ? "Your turn ends." : null, ""),
		});
	},
});

/**
 * A carried item is an `item:` target, not an `entity:` one: the kernel reaches
 * it through inventory ownership (sk-jay0.3.26.29). spellkave_inventory prints
 * a carried item as the handle `i:<n>`, so that handle is read as `item:<n>`.
 * A pure rewrite of the reference: no world state is read. Every other target
 * passes unchanged.
 */
function carriedItemTarget(targetId: string): string {
	const handle = /^i:(\d+)$/.exec(targetId);
	return handle ? `item:${handle[1]}` : targetId;
}

const manipulateToolDef = defineTool<SpellkaveToolContext, typeof MANIPULATE_PARAMS, unknown>({
	contract: SPELLKAVE_MANIPULATE_TOOL,
	schema: MANIPULATE_PARAMS,
	run: async (context, params) => {
		context = await steeringContext(context, params);
		params = { ...params, target_id: carriedItemTarget(params.target_id) };
		const { act, actorId } = requireActorId(context);
		// ADR-0139 migration path: when the caller has a complete factored
		// context for this exact action and disclosed target, use its mpc token
		// without consulting an eager pair. Every other direct attempt remains
		// dispatchable as an explicit trial-and-error attempt: direct tools
		// intentionally preserve reducer-authoritative experimentation.
		const manipulationContext = readManipulationContext(currentDb(context), actorId);
		const factored = composeFactoredManipulationAttempt(manipulationContext, {
			action_id: params.action_id,
			target_ref: params.target_id,
			args_json: params.args_json,
			...(params.participant_context === undefined
				? {}
				: { participant_context: params.participant_context }),
		});
		if (
			factored.status === "participant_context_required" ||
			factored.status === "participant_context_conflict" ||
			factored.status === "unknown_participant_context" ||
			factored.status === "malformed_args"
		) {
			return toolResult({
				receipt: {
					status: "rejected" as const,
					outcome: factored.status,
					reason:
						factored.status === "participant_context_required"
							? "This action needs a participant_context mpc token from spellkave_manipulation_context.participants."
							: `Manipulation composer rejected the attempt (${factored.status}).`,
					composer: factored,
				},
			});
		}
		const targetId = factored.status === "not_assessed" ? factored.target_ref : params.target_id;
		const actionId = factored.status === "not_assessed" ? factored.action_id : params.action_id;
		const argsJson =
			factored.status === "not_assessed" ? factored.args_json : (params.args_json ?? "{}");
		const actionLabel =
			factored.status === "not_assessed" && manipulationContext.status === "ready"
				? manipulationContext.actions.find((action) => action.action_id === actionId)?.display_name
				: undefined;
		const argsAudit = auditArgsJson(params.args_json);
		const utteranceKeys = utteranceChannelKeys(currentDb(context), actorId, actionId, argsJson);
		if (utteranceKeys.length > 0) {
			return toolResult({
				receipt: {
					status: "rejected" as const,
					outcome: "utterance_required",
					reason: `'${actionId}' reads ${JSON.stringify(utteranceKeys)} from the utterance; spellkave_manipulate has none.`,
				},
				tool_hint: utteranceRequiredHint(actionId, utteranceKeys),
			});
		}
		return dispatchManipulationForPlayer(context, act, actorId, {
			targetRef: targetId,
			actionId,
			argsJson,
			actionLabel,
			ignoredArgs: argsAudit.status === "ok" ? argsAudit.ignored_keys : [],
		});
	},
});

const releaseClaimToolDef = defineTool({
	contract: SPELLKAVE_RELEASE_CLAIM_TOOL,
	schema: RELEASE_CLAIM_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof RELEASE_CLAIM_PARAMS>) => {
		const { act, actorId } = requireActorId(context);
		const releaseClaim = dispatchAct(
			currentActorClient(act)?.releaseClaim,
			() =>
				createActorClient(currentDb(context), actorId, {
					rReleaseClaim: act.callRReleaseClaim ?? notConfigured(SPELLKAVE_RELEASE_CLAIM_TOOL),
				}).releaseClaim,
		);
		return toolResult({ release_claim: await releaseClaim(params.target_id) });
	},
});

const wakeUpToolDef = defineTool({
	contract: SPELLKAVE_WAKE_UP_TOOL,
	schema: WAKE_UP_PARAMS,
	run: async (context: SpellkaveToolContext) => {
		const { act, actorId } = requireActorId(context);
		// No host ActorClient carries a bindable `wakeUp` in
		// `SpellkaveActorContext.actorClient` — always the bare reducer callback.
		if (act.callRActorWakeUp === undefined) {
			throw new Error("spellkave_wake_up is not configured");
		}
		const client = createActorClient(currentDb(context), actorId, {
			rActorWakeUp: act.callRActorWakeUp,
		});
		return toolResult({ wake_up: await client.wakeUp() });
	},
});

const MAP_JPEG_WIDTH_PX = 900;

/**
 * sk-pej D-3: pick the graph `spellkave_map` should draw when the caller named
 * none — the actor's own session tactical grid, if it is in one.
 *
 * WHY this exists: D-2 composes a grid over its parent location, but only when
 * the REQUESTED graph is that grid. A player asking "show me the map" mid-fight
 * passes no `graph` at all, so before this the composition never fired for the
 * surface it was built for; you had to know the server-minted
 * `session_grid_<session_id>` string and type it. The operator's decision was
 * "compose by default, and be able to request either single view on demand" —
 * this is the "by default" half.
 *
 * An explicit `graph=` always wins, including `graph=` naming the parent
 * location: that is the on-demand escape hatch to see the region while a fight
 * is open, and it must not be overridden.
 *
 * Fails OPEN in every uncertain case — no session, no grid materialised for
 * this session (a session_definition need not open one), or an id that matches
 * no `place_graph_definition` row. In all of those the caller gets exactly the
 * pre-D-3 behaviour rather than an error, because "I could not find a grid" is
 * never a reason to refuse to draw a map.
 */
function resolveSessionGridGraph(
	db: SnapshotDb,
	actorId: EntityRef,
	requestedGraph: string | undefined,
	placeGraphRows: readonly Record<string, unknown>[],
): string | undefined {
	if (requestedGraph !== undefined && requestedGraph.trim() !== "") return requestedGraph;
	const session = readParticipantSessionStatus(db, actorId);
	if (session === null) return requestedGraph;
	// Mirrors r_session_open.rs:323's `format!("session_grid_{session_id}")` —
	// the ONE production site that mints a tactical grid's place_graph_id. The
	// existence check below is what keeps this from being a blind string guess:
	// a derived id that matches no row is discarded, not drawn.
	const candidate = `session_grid_${session.session_id}`;
	const exists = placeGraphRows.some((row) => row.place_graph_id === candidate);
	return exists ? candidate : requestedGraph;
}

/** One session-roster participant, placed at a cell — the shape both the
 * count-based badge (`place_node_id` alone, via `actor_spatial_locations`)
 * and `session_tokens` (sk-jay0.4.2) draw from. */
interface SessionRosterOccupant {
	place_node_id: string;
	actor_id: string;
	name: string;
	[key: string]: unknown;
}

/**
 * sk-e7n: the connected actor's OWN open-session roster, projected to each
 * member's current place-node id (when it has one) — the ONLY occupant
 * source `spellkave_map` draws combatants from.
 *
 * Framing chosen by the operator (sk-e7n NOTES, 2026-08-13): while a session
 * is open, show ALL of that session's participants at their cells and
 * nothing else. A fight's roster is already common knowledge to its own
 * participants — spellkave_session_status hands every participant the full
 * roster today — so showing where those SAME actors stand discloses
 * nothing new; no perception filtering in this pass. Deliberately sourced
 * from the roster, never from a raw unfiltered actor_spatial_location scan:
 * invisibility (a later mechanic, explicitly deferred) becomes ONE
 * subtraction from this roster rather than a rewrite, because the shown set
 * is already roster-bounded, never world-wide. No open session (or none of
 * its members resolving a location) yields the pre-change behaviour: no
 * occupants.
 *
 * A roster member with no location row, or one whose place isn't among the
 * nodes this call actually draws (e.g. staged outside the grid), is
 * harmless here — `buildSpatialGraphModel`'s own `nodeIds.has(place)` guard
 * (model.ts) silently drops it; this function only supplies candidates.
 *
 * sk-jay0.4.2: each occupant now keeps `actor_id`/`name` alongside its cell
 * — still the SAME roster-bounded source (no wider scan), but no longer
 * dropped to an anonymous count before the caller sees it. `sessionOpen`
 * is threaded back out so `spellkave_map` can tell "no session" (the
 * `session_tokens` field must be absent) from "session open, nobody placed
 * yet" (the field must be an empty array) without a second session read.
 */
function sessionRosterOccupants(
	db: SnapshotDb,
	actorId: EntityRef,
): { sessionOpen: boolean; occupants: SessionRosterOccupant[] } {
	const session = readParticipantSessionStatus(db, actorId);
	if (session === null) return { sessionOpen: false, occupants: [] };
	const occupants = session.roster.flatMap((participant) => {
		const placeNodeId = readActorCoLocation(
			db,
			asEntityRef(participant.actor_id),
		)?.actor_spatial_location;
		return placeNodeId === null || placeNodeId === undefined
			? []
			: [
					{
						place_node_id: placeNodeId,
						actor_id: String(participant.actor_id),
						// participant.name is null for an entity the roster reader
						// could not name (readParticipantSessionStatus's own doc
						// comment) — fall back to the id rather than leak `null`
						// into a field session_tokens documents as always a string.
						name: participant.name ?? String(participant.actor_id),
					},
				];
	});
	return { sessionOpen: true, occupants };
}

const mapToolDef = defineTool<
	SpellkaveToolContext,
	typeof MAP_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: SPELLKAVE_MAP_TOOL,
	schema: MAP_PARAMS,
	run: async (
		context: SpellkaveToolContext,
		params: Static<typeof MAP_PARAMS>,
		_toolCallId,
		capabilities,
	): Promise<
		ToolResult<{
			graph: string | null;
			has_layout: boolean;
			places: number;
			routes: number;
			known_nodes: number;
			unreachable: string[];
			inventory: string;
			svg?: string | null;
			ascii?: string | null;
			utf8?: string | null;
			braille?: string | null;
			/** output_type='jpg' only — the written file's path, or null when the
			 * layout never resolved (nothing to render). */
			jpg_path?: string | null;
			/** sk-jay0.4.2: which roster participant stands in which drawn cell,
			 * present only while a tactical session is open for this caller (see
			 * `sessionRosterOccupants`'s own doc comment for the roster-bounded
			 * disclosure rule this reuses verbatim — no wider scan than the
			 * count badge already drew from). Absent outside a session; an empty
			 * array when the session has no participant placed on a drawn cell.
			 * Multiple tokens may share one `node_id`. */
			session_tokens?: { node_id: string; actor_id: string; name: string; is_me: boolean }[];
		}>
	> => {
		const map = capabilities?.node?.map;
		const {
			buildSpatialGraphView,
			countMapPlaces,
			isEphemeralInstanceGraph,
			resolveGraphAncestorChain,
			spatialRenderPlanForOutputType,
		} = await import("@spellkave/world-map/svg");
		const { actorId } = requireActorId(context);
		const db = currentDb(context);
		const topology = readPlaceTopology(db);
		// Module-side fog-of-war (sk-adr8.7): topology/map_layers already carry
		// only the caller's admitted rows. Session-grid composition and
		// notable_anchor_nodes still compose on the client.
		const mapLayerRows = readMapLayers(db);
		// sk-e7n: session-roster-scoped occupants — see sessionRosterOccupants's
		// own doc comment for the epistemic framing (operator decision, NOTES).
		const { sessionOpen, occupants: sessionRoster } = sessionRosterOccupants(db, actorId);
		const rows = {
			place_graphs: topology.place_graphs,
			place_nodes: topology.place_nodes,
			place_edges: topology.place_edges,
			map_layers: mapLayerRows,
			actor_spatial_locations: sessionRoster,
			visible_spatial_niche_attachments: readVisibleSpatialNicheAttachments(db),
			// Admitted geometry only: attachment-scope anchors from the same view.
			notable_anchor_nodes: topology.place_nodes,
		};
		// Same default as the author twin (spellkave_map_graph), deliberately:
		// the output surface must not differ by role. A PLAYER agent runs in the
		// same Pi TUI an author does — the `playtest` skill hosts one — and that
		// host paints its inline picture from `details.svg`, so defaulting the
		// player map to text would leave a player staring at ascii where an
		// author sees a map. Cheaper reads stay one explicit output_type away.
		const outputType = params.output_type ?? "svg";
		const { renderOnly, terminal } = spatialRenderPlanForOutputType(outputType);
		// sk-pej D-3: asking for "the map" mid-fight means the FIGHT. Without
		// this, composition only fires when the caller already knows the
		// session grid's id and names it in graph= — which no player does, so
		// the feature was unreachable from the player surface it exists for.
		// Resolving here (not in the view layer) keeps buildSpatialGraphView
		// pure over rows: the session lookup is a db read, and this is the
		// only place in the map path that already holds `db` and `actorId`.
		const effectiveGraph = resolveSessionGridGraph(db, actorId, params.graph, rows.place_graphs);
		// Composed cells inherit the anchor's elevation. With multiple floors,
		// the renderer otherwise defaults to z=0 and drops a cellar/upper-floor
		// fight, including its tokens. Resolve the omitted floor once for both
		// render paths; an explicit z and the bare grid keep their own defaults.
		const selectedGraphId = effectiveGraph?.trim();
		const grid = rows.place_graphs.find((row) => row.place_graph_id === selectedGraphId);
		const anchor =
			params.compose_parent !== false &&
			grid !== undefined &&
			selectedGraphId !== undefined &&
			isEphemeralInstanceGraph(grid, selectedGraphId) &&
			rows.place_graphs.some((row) => row.place_graph_id === grid.parent_graph_id)
				? rows.place_nodes.find(
						(row) =>
							row.node_id === grid.anchor_node_id && row.place_graph_id === grid.parent_graph_id,
					)
				: undefined;
		const effectiveZ =
			params.z ??
			(typeof anchor?.pos_x === "number" &&
			typeof anchor.pos_y === "number" &&
			typeof anchor.pose_elevation === "number" &&
			Number.isFinite(anchor.pose_elevation)
				? anchor.pose_elevation
				: undefined);
		const view = buildSpatialGraphView(rows, {
			graphId: effectiveGraph,
			slice: params.slice,
			z: effectiveZ,
			zTolerance: params.z_tolerance,
			preferH3World: effectiveGraph === undefined || effectiveGraph.trim() === "",
			// sk-pej D-2: compose a session tactical grid over its parent
			// location by default; compose_parent=false is the escape hatch
			// back to the grid alone. No effect for a non-grid graph=.
			composeParent: params.compose_parent,
			terminal,
			renderOnly,
		});
		// Primary text variant for the ONE requested text output_type — null for
		// svg/jpg/inventory (those bodies are header+inventory only, below).
		const primaryText =
			outputType === "utf8"
				? view.utf8
				: outputType === "ascii"
					? view.ascii
					: outputType === "braille"
						? view.braille
						: null;
		const placeCount = countMapPlaces(view.model);
		const text = view.hasLayout
			? [
					`Spatial graph (${placeCount} places, ${view.model.edges.length} routes).`,
					primaryText ?? "",
					"",
					"--- inventory ---",
					view.inventory,
				]
					.filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
					.join("\n")
			: view.inventory;

		// output_type='jpg' — writes a backdrop-composed map-art JPEG
		// (the legacy player-scoped map documentation's
		// own design). full, unmasked backdrop art per operator decision
		// 2026-08-12; masking deferred to bead sk-ubx. Renders a SECOND,
		// dedicated view (sheet-aligned, with backdrops) — the plain `view`
		// above never carries one, so it stays byte-identical to a non-jpg call.
		// JPEG, not PNG (operator decision 2026-08-13): a full-resolution
		// backdrop PNG runs 1.1-1.4 MB, over the repo's committed-file size gate
		// — see writeJpegWithChurnGuard's own header for the ffmpeg -q:v 4
		// encode step. output_dir/output_name both stay OPTIONAL (bead sk-due):
		// `resolveMapJpegOutput` defaults an omitted output_dir to a fresh temp
		// directory and an omitted output_name to one derived from `graph`.
		//
		// output_dir may be RELATIVE (operator decision 2026-08-13, sk-ubx
		// follow-up finding): a caller recording a machine-portable artifact
		// (the srd-cc adventure story) must not let an absolute, checkout-path-
		// specific directory leak into what gets committed. A relative
		// output_dir is resolved against `process.cwd()` for the actual
		// filesystem write ONLY — the response's own `jpg_path` is built from
		// the ORIGINAL caller-supplied output_dir, never the resolved absolute
		// path, so a relative input always yields a relative output.
		let jpgPath: string | null | undefined;
		if (outputType === "jpg") {
			if (map === undefined) {
				throw new ToolCapabilityUnavailableError(SPELLKAVE_MAP_TOOL, "node");
			}
			jpgPath = null;
			if (view.hasLayout) {
				const graphId = effectiveGraph?.trim();
				// Sheet backdrops only when drawing a single graph (mirrors AUTHOR's
				// own `spellkave_map_graph` gate, authoring-verbs.ts) — a world-map
				// compose has no single image-cell space to align art against.
				//
				// sk-pej D-2: an ephemeral session grid authors no [[map_layers]] of
				// its own (materialise_tactical_grid only inserts place_node/
				// place_edge rows) — resolveGraphAncestorChain walks
				// parent_graph_id so its PARENT's backdrop resolves instead. A no-op
				// for a non-nested graphId (chain = [graphId] alone). Gated on the
				// SAME compose_parent escape hatch as the topology composition
				// above, so `compose_parent=false` yields the grid alone with no
				// backdrop, matching the topology-only single view.
				const graphChain =
					graphId === undefined || graphId.length === 0
						? []
						: params.compose_parent === false
							? [graphId]
							: resolveGraphAncestorChain(rows.place_graphs, graphId);
				const layerRows =
					graphChain.length > 0
						? mapLayerRows.filter((row) => graphChain.includes(String(row.place_graph_id)))
						: [];
				const { backdrops } = map.mapLayersToBackdrops(layerRows);
				// Operator decision (2026-08-12): the backdrop art itself renders
				// UNMASKED/full — only the GRAPH (place_nodes/place_edges, already
				// fog-of-war-filtered above) is scoped to what the actor knows. A
				// mask clipping the art to known nodes is deferred to bead sk-ubx.
				const jpegView = buildSpatialGraphView(rows, {
					graphId: effectiveGraph,
					slice: params.slice,
					z: effectiveZ,
					zTolerance: params.z_tolerance,
					preferH3World: effectiveGraph === undefined || effectiveGraph.trim() === "",
					composeParent: params.compose_parent,
					renderOnly: ["svg"],
					sheetAlign: true,
					backdrops: backdrops as never,
					backdropHref: (backdrop) => map.backdropAssetDataHref(backdrop),
					showExtentDepth: true,
				});
				if (jpegView.svg !== null) {
					const output = await map.writeJpeg({
						outputDir: params.output_dir,
						outputName: params.output_name,
						graph: effectiveGraph,
						svg: jpegView.svg,
						width: MAP_JPEG_WIDTH_PX,
						layerRows,
					});
					// NEVER the resolved absolute path — the caller's own output_dir
					// (or the actual temp dir when defaulted), verbatim, so a relative
					// input stays relative in the response.
					jpgPath = output.jpgPath;
				}
			}
		}

		// sk-jay0.4.2: session_tokens names each roster participant's own drawn
		// cell — additive to the count badge above, same roster-bounded source
		// (sessionRoster), filtered to the SAME nodes the count badge itself
		// draws from (`drawnNodeIds`, mirroring model.ts's own `nodeIds.has`
		// guard) so a participant staged outside the drawn set is silently
		// dropped here exactly as it already is from the count. `undefined`
		// (never an empty array) when no session is open — see
		// sessionRosterOccupants's own doc comment.
		const drawnNodeIds = new Set(view.model.nodes.map((node) => node.id));
		const callerEntityId = resolveEntityId(db, actorId)?.toString();
		const sessionTokens = sessionOpen
			? sessionRoster
					.filter((occupant) => drawnNodeIds.has(occupant.place_node_id))
					.map((occupant) => ({
						node_id: occupant.place_node_id,
						actor_id: occupant.actor_id,
						name: occupant.name,
						is_me: occupant.actor_id === callerEntityId,
					}))
			: undefined;

		const result = {
			content: [{ type: "text" as const, text }],
			details: {
				graph: params.graph?.trim() || null,
				has_layout: view.hasLayout,
				places: placeCount,
				routes: view.model.edges.length,
				known_nodes: topology.place_nodes.length,
				unreachable: view.model.unreachable,
				inventory: view.inventory,
				...(outputType === "utf8" ? { utf8: view.utf8 } : {}),
				...(outputType === "ascii" ? { ascii: view.ascii } : {}),
				...(outputType === "braille" ? { braille: view.braille } : {}),
				...(outputType === "svg" ? { svg: view.svg } : {}),
				...(outputType === "jpg" ? { jpg_path: jpgPath } : {}),
				...(sessionTokens !== undefined ? { session_tokens: sessionTokens } : {}),
			},
		};
		return map === undefined ? result : await map.attachSpatialGraphImage(result);
	},
});

// --- Single registration point (issue #1380). ---
//
// This array IS the registry: it drives both runtime registration
// (`createSpellkaveTools`, below) and the derived `SpellkaveCompanionTool`
// union type. Adding a tool means adding ONE `defineTool` call above and ONE
// entry here — there is no third place (a hand-maintained union arm) to keep
// in sync.
// --- Orientation (bead sk-cdi): one cycle's worth of PLAYER perception, read
// in one shot — self/scene/session/factual contexts (the SAME discriminated view
// shape a `SeatBrain` decides from, `@spellkave/npc`'s `seat/types.ts`)
// alongside inventory and a PAGED window of traces. Composed here, in
// shared PLAYER tools, rather than in `@spellkave/npc` where the
// prior version of this composition lived: `@spellkave/npc` already depends
// on this package for `createPlayerFacingToolMap` (its own `seat.ts` header:
// "the SEAT speaks ONLY the canonical PLAYER-facing tool
// surface") — a reverse edge back into `@spellkave/npc` from here would make
// the two packages mutually dependent for no reason beyond convenience.
// `orientSeatFromContext` below is the ONE implementation; `@spellkave/npc`'s
// `seat.ts` imports it back (an existing, one-directional edge, not a new
// one) for both `just play-orient` (`orientSeat`, LiveSession-flavored) and
// its own cycle engine's `perceive`/`invoke`. `spellkave_orient` (this
// package's own PLAYER tool, below) is the third customer, calling this
// composition directly — zero cross-package call for that path.
//
// `PlayerOrientationView` is this package's OWN copy of `SeatView`'s SHAPE
// (not an import of that type — see the paragraph above for why the
// dependency edge runs from host adapters to this tool layer). The two are
// structurally identical by construction, both shaped from the exact same
// PLAYER-tool responses parsed below, and both are pinned by
// `@spellkave/npc`'s `seat.test.ts`: a drift between them fails loudly, at
// typecheck time (assignability), the moment `@spellkave/npc` assigns this
// function's return value to its own `SeatView`-typed variables.

interface OrientSessionStatus {
	inSession: boolean;
	myTurn: boolean;
	currentActor: string | null;
}

const ORIENT_DEFAULT_SESSION_STATUS: OrientSessionStatus = {
	inSession: false,
	myTurn: false,
	currentActor: null,
};

interface OrientSceneExit {
	handle: string;
	rev: string;
	label: string;
	to: string | null;
	toNodeId: string | null;
	traversalGates: readonly TraversalGate[];
}

interface OrientSceneItem {
	handle: string;
	rev: string;
	kind: string;
	id: string;
	label: string;
	conditions?: readonly string[];
}

interface OrientSceneView {
	rev: string;
	nodeDescription: string | null;
	exits: readonly OrientSceneExit[];
	items: readonly OrientSceneItem[];
}

/** Factored ordinary-manipulation discovery. No field claims a valid
 * action-target combination. */
type OrientManipulationContext =
	| { status: "unavailable" }
	| {
			status: "ready";
			schemaVersion: number;
			revision: number;
			actions: readonly {
				actionId: string;
				displayName: string;
				communicationSpeechActId?: string;
				responseSlot?: number;
				tags: readonly string[];
				nicheRequirements: readonly {
					nicheId: string;
					requiresSpatialAttachment: boolean;
					admitsTargetsWithoutMembership: boolean;
				}[];
				/** Public `ui.affordance_group` attachments on this action's source templates. */
				groups: readonly string[];
				/** Deterministic presentation prose from the public authored templates. */
				description?: string;
				/** Public `ui.affordance_input` on the first authored source template.
				 * Absent means no authored schema; present with empty `fields` means an
				 * authored complete invocation with no form — the two are distinct. */
				input?: AffordanceInputSchema;
				/** Exact `ui.affordance_reference` definition, when a source template authors one. */
				definitionRef?: string;
				cue?: { rank?: number; hint?: string };
				defaults?: {
					target?: { targetRef: string; kind: "actor" | "reference" };
					inputValues?: Record<string, string | number>;
					provenance: {
						namespace: string;
						templateId: string;
						attachmentId: string;
						contentKey: string;
					};
				};
				/** Public authored source templates behind this syntax fact. */
				templateIds: readonly string[];
				selfOnly: boolean;
				selfEligible: boolean;
			}[];
			targets: readonly {
				targetFactId: string;
				targetRef: string;
				tags: readonly string[];
				nicheIds: readonly string[];
			}[];
			participants: readonly {
				contextId: string;
				actionId: string;
				bindingCount: number;
				bindings: readonly { roleId: string; entityId: string }[];
			}[];
			/** ADR-0142 D-6: open dialogue prompts this actor may currently answer.
			 * Additive migration field (like `manipulationContext?:` on
			 * `PlayerOrientationView`): always populated by `orientManipulationContextFrom`,
			 * optional on the type so an older fixture stays valid. */
			prompts?: readonly {
				occurrenceId: string;
				promptDefId: string;
				contractVersion: number;
				sourceRef: string;
				responseActionIds: readonly string[];
				openedAtTick: number;
				consumed: boolean;
				/** Authored `dialogue.prompt` question/response-label text (public
				 * audience only); absent when the world authors none. */
				presentation?: {
					question?: string;
					labels: Readonly<Record<string, string>>;
				};
			}[];
	  };

type OrientSenseContext =
	| { status: "unavailable" }
	| {
			status: "ready";
			queries: readonly {
				queryKind: string;
				visibility: string;
				displayName: string;
				outcomeTemplateId: string;
			}[];
	  };

interface OrientPendingReaction {
	windowKey?: string;
	windowKind: "reaction" | "intervention";
	handle: string;
	rev: string;
	originatingActionId: string;
	targetActor?: string;
	originatingActor?: string;
	targetFaction?: string | null;
	faces?: readonly unknown[];
}

export type PlayerOrientationView =
	| {
			kind: "reaction";
			actorId: string;
			pending: OrientPendingReaction;
			events: readonly WorldEvent[];
	  }
	| {
			kind: "turn";
			actorId: string;
			session: OrientSessionStatus;
			selfSummary: unknown;
			/** Actor-bound inventory listing; incomplete pages remain incomplete. */
			inventory?: unknown;
			resourceStates?: unknown;
			/** Current actor-bound PLAYER economy projection; absence remains unknown. */
			economyBudget?: unknown;
			scene: OrientSceneView | null;
			/** Additive migration field. Undefined only for an older tool host. */
			manipulationContext?: OrientManipulationContext;
			senseContext?: OrientSenseContext;
			events: readonly WorldEvent[];
	  };

// biome-ignore lint/suspicious/noExplicitAny: the entries this composition calls (PlayerFacingToolMap tools, plus the synthetic traces-page tool below) have distinct parameter schemas; this is the one shape a call site widens to, mirroring `SpellkaveCompanionTool`'s own widening above.
type OrientToolExecute = (toolCallId: string, toolParams: any) => Promise<{ details: unknown }>;

/** Every PLAYER-tool invocation this composition makes goes through here, so
 * telemetry stays uniform (T9 convention: `tool_call`, `params` carried
 * verbatim, `is_error` set on throw) even for the synthetic traces-page call
 * below, which never reaches a real tool registry. Exported: `@spellkave/npc`'s
 * `seat.ts` (`dispatch`) imports this back for its OWN cycle engine's
 * PLAYER-tool calls (bead sk-cdi — see that file's module note). */
export async function invoke(
	tool: { name: string; execute: OrientToolExecute },
	params: Record<string, unknown>,
	emitter: ToolRunEmitter,
): Promise<unknown> {
	const startedAt = Date.now();
	try {
		const result = await tool.execute(`orient:${tool.name}`, params);
		emitter.emit("tool_call", {
			tool_name: tool.name,
			params,
			observation: result.details,
			is_error: false,
			duration_ms: Math.max(0, Date.now() - startedAt),
		});
		return result.details;
	} catch (error) {
		emitter.emit("tool_call", {
			tool_name: tool.name,
			params,
			is_error: true,
			duration_ms: Math.max(0, Date.now() - startedAt),
			summary: error instanceof Error ? error.message : String(error),
		});
		throw error;
	}
}

interface OrientRawSessionBlock {
	in_session: boolean;
	current_actor: string | null;
	my_turn: boolean;
}

function orientSessionStatusFrom(details: unknown): OrientSessionStatus | null {
	const session = (details as { session?: OrientRawSessionBlock } | undefined)?.session;
	if (session === null || session === undefined) return null;
	return {
		inSession: session.in_session,
		myTurn: session.my_turn,
		currentActor: session.current_actor,
	};
}

function orientSelfSummaryFrom(details: unknown): unknown {
	return (details as { self?: unknown } | undefined)?.self ?? null;
}

interface OrientRawSceneItem {
	handle: string;
	rev: string;
	kind: string;
	id: string;
	label: string;
	to?: string;
	to_node_id?: string;
	traversal_gates?: TraversalGate[];
	conditions?: string[];
}

interface OrientRawSceneResult {
	rev?: string;
	node_description?: string | null;
	scene_resolved?: boolean;
	items?: OrientRawSceneItem[];
}

function orientSceneViewFrom(details: unknown): OrientSceneView | null {
	const raw = details as OrientRawSceneResult | undefined;
	if (raw === undefined || raw.rev === undefined || raw.scene_resolved === false) return null;
	const exits: OrientSceneExit[] = [];
	const items: OrientSceneItem[] = [];
	for (const item of raw.items ?? []) {
		if (item.kind === "exit") {
			exits.push({
				handle: item.handle,
				rev: item.rev,
				label: item.label,
				to: item.to ?? null,
				toNodeId: item.to_node_id ?? null,
				traversalGates: item.traversal_gates ?? [],
			});
		} else {
			items.push({
				handle: item.handle,
				rev: item.rev,
				kind: item.kind,
				id: item.id,
				label: item.label,
				...(item.conditions ? { conditions: item.conditions } : {}),
			});
		}
	}
	return { rev: raw.rev, nodeDescription: raw.node_description ?? null, exits, items };
}

function orientManipulationContextFrom(details: unknown): OrientManipulationContext {
	const context = (
		details as
			| {
					manipulation_context?: {
						status?: string;
						schema_version?: number;
						revision?: number;
						actions?: Array<{
							action_id: string;
							display_name: string;
							communication_speech_act_id?: string;
							response_slot?: number;
							tags?: string[];
							niche_requirements?: Array<{
								niche_id: string;
								requires_spatial_attachment: boolean;
								admits_targets_without_membership: boolean;
							}>;
							groups?: string[];
							description?: string;
							input?: AffordanceInputSchema;
							definition_ref?: string;
							cue?: { rank?: number; hint?: string };
							defaults?: {
								target?: { target_ref: string; kind: "actor" | "reference" };
								input_values?: Record<string, string | number>;
								provenance: {
									namespace: string;
									template_id: string;
									attachment_id: string;
									content_key: string;
								};
							};
							template_ids?: string[];
							self_only: boolean;
							self_eligible: boolean;
						}>;
						targets?: Array<{
							target_fact_id: string;
							target_ref: string;
							tags?: string[];
							niche_ids?: string[];
						}>;
						participants?: Array<{
							context_id: string;
							action_id: string;
							binding_count: number;
							bindings: Array<{ role_id: string; entity_id: string }>;
						}>;
						prompts?: Array<{
							occurrence_id: string;
							prompt_def_id: string;
							contract_version: number;
							source_ref: string;
							response_action_ids: string[];
							opened_at_tick: number;
							consumed: boolean;
							presentation?: {
								question?: string;
								labels: Record<string, string>;
								response_refs?: Record<string, string>;
								guide?: unknown;
							};
						}>;
					};
			  }
			| undefined
	)?.manipulation_context;
	if (context?.status !== "ready") return { status: "unavailable" };
	return {
		status: "ready",
		schemaVersion: context.schema_version ?? 0,
		revision: context.revision ?? 0,
		actions: (context.actions ?? []).map((action) => ({
			actionId: action.action_id,
			...(action.response_slot === undefined ? {} : { responseSlot: action.response_slot }),
			displayName: action.display_name,
			...(action.communication_speech_act_id === undefined
				? {}
				: { communicationSpeechActId: action.communication_speech_act_id }),
			tags: action.tags ?? [],
			nicheRequirements: (action.niche_requirements ?? []).map((niche) => ({
				nicheId: niche.niche_id,
				requiresSpatialAttachment: niche.requires_spatial_attachment,
				admitsTargetsWithoutMembership: niche.admits_targets_without_membership,
			})),
			groups: action.groups ?? [],
			...(action.description === undefined ? {} : { description: action.description }),
			...(action.input === undefined ? {} : { input: action.input }),
			...(action.definition_ref === undefined ? {} : { definitionRef: action.definition_ref }),
			...(action.cue === undefined ? {} : { cue: action.cue }),
			...(action.defaults === undefined
				? {}
				: {
						defaults: {
							...(action.defaults.target === undefined
								? {}
								: {
										target: {
											targetRef: action.defaults.target.target_ref,
											kind: action.defaults.target.kind,
										},
									}),
							...(action.defaults.input_values === undefined
								? {}
								: { inputValues: action.defaults.input_values }),
							provenance: {
								namespace: action.defaults.provenance.namespace,
								templateId: action.defaults.provenance.template_id,
								attachmentId: action.defaults.provenance.attachment_id,
								contentKey: action.defaults.provenance.content_key,
							},
						},
					}),
			templateIds: action.template_ids ?? [],
			selfOnly: action.self_only,
			selfEligible: action.self_eligible,
		})),
		targets: (context.targets ?? []).map((target) => ({
			targetFactId: target.target_fact_id,
			targetRef: target.target_ref,
			tags: target.tags ?? [],
			nicheIds: target.niche_ids ?? [],
		})),
		participants: (context.participants ?? []).map((participant) => ({
			contextId: participant.context_id,
			actionId: participant.action_id,
			bindingCount: participant.binding_count,
			bindings: participant.bindings.map((binding) => ({
				roleId: binding.role_id,
				entityId: binding.entity_id,
			})),
		})),
		prompts: (context.prompts ?? []).map((prompt) => ({
			occurrenceId: prompt.occurrence_id,
			promptDefId: prompt.prompt_def_id,
			contractVersion: prompt.contract_version,
			sourceRef: prompt.source_ref,
			responseActionIds: prompt.response_action_ids,
			openedAtTick: prompt.opened_at_tick,
			consumed: prompt.consumed,
			...(prompt.presentation === undefined ? {} : { presentation: prompt.presentation }),
		})),
	};
}

function orientSenseContextFrom(details: unknown): OrientSenseContext {
	const context = (
		details as {
			sense_context?: {
				status?: string;
				queries?: Array<{
					query_kind: string;
					visibility: string;
					display_name: string;
					outcome_template_id: string;
				}>;
			};
		}
	).sense_context;
	if (context?.status !== "ready") return { status: "unavailable" };
	return {
		status: "ready",
		queries: (context.queries ?? []).map((query) => ({
			queryKind: query.query_kind,
			visibility: query.visibility,
			displayName: query.display_name,
			outcomeTemplateId: query.outcome_template_id,
		})),
	};
}

interface OrientRawWindowItem {
	window_key?: string;
	handle: string;
	originating_action_id: string;
	originating_actor?: string;
	target_actor?: string;
	target_entity_faction?: string | null;
	faces?: unknown[];
}

interface OrientRawWindowPage {
	rev?: string;
	items?: OrientRawWindowItem[];
}

/** First open reaction/intervention window for this actor, or `null`. Plain
 * reaction seats are checked before intervention windows (arbitrary but
 * stable tie-break) — one orientation surfaces one pending window; the rest
 * wait for a later call, same as a seat cycle waits for a later cycle. */
function orientFirstPendingReaction(
	reactionDetails: unknown,
	interventionDetails: unknown,
): OrientPendingReaction | null {
	const reaction = reactionDetails as OrientRawWindowPage | undefined;
	const reactionItem = reaction?.items?.[0];
	if (reactionItem !== undefined && reaction?.rev !== undefined) {
		return {
			windowKind: "reaction",
			windowKey: reactionItem.window_key,
			handle: reactionItem.handle,
			rev: reaction.rev,
			originatingActionId: reactionItem.originating_action_id,
			...(reactionItem.target_actor !== undefined
				? { targetActor: reactionItem.target_actor }
				: {}),
			...(reactionItem.originating_actor !== undefined
				? { originatingActor: reactionItem.originating_actor }
				: {}),
			...(reactionItem.target_entity_faction !== undefined
				? { targetFaction: reactionItem.target_entity_faction }
				: {}),
		};
	}
	const intervention = interventionDetails as OrientRawWindowPage | undefined;
	const interventionItem = intervention?.items?.[0];
	if (interventionItem !== undefined && intervention?.rev !== undefined) {
		return {
			windowKind: "intervention",
			windowKey: interventionItem.window_key,
			handle: interventionItem.handle,
			rev: intervention.rev,
			originatingActionId: interventionItem.originating_action_id,
			...(interventionItem.faces === undefined ? {} : { faces: interventionItem.faces }),
		};
	}
	return null;
}

/** PLAYER-tool responses -> {@link PlayerOrientationView}. Mirrors
 * `@spellkave/npc`'s former `perceive()` exactly (moved here, see the module
 * note above) — every narrowing helper above reads only the JSON shape
 * documented on the corresponding tool in THIS file, never a table row.
 * Exported: `@spellkave/npc`'s `seat.ts` (`runCycle`, the async self-driven
 * path) imports this back for its own cycle engine (bead sk-cdi). */
export async function perceive(
	actorId: string,
	toolMap: PlayerFacingToolMap,
	emitter: ToolRunEmitter,
	events?: WorldEventBuilder,
	resourceObservations: readonly ResourceObservation[] = [],
	selfTargetRef?: string,
): Promise<PlayerOrientationView> {
	// Revalidation after an awaited durable write needs fresh offers without
	// consuming the seat's event cursor. The next decision cycle remains the
	// sole owner of event delivery.
	const observedEvents = events?.diffAndAdvance() ?? [];

	const reactionDetails = await invoke(toolMap.reactionOptions, {}, emitter);
	const interventionDetails = await invoke(toolMap.interventionWindows, {}, emitter);
	const pending = orientFirstPendingReaction(reactionDetails, interventionDetails);
	if (pending !== null) {
		return { kind: "reaction", actorId, pending, events: observedEvents };
	}

	const selfDetails = await invoke(toolMap.selfSummary, {}, emitter);
	const sessionDetails = await invoke(toolMap.sessionStatus, {}, emitter);
	const inventory = await invoke(toolMap.inventory, { limit: 100 }, emitter);
	const economyBudget = await invoke(
		toolMap.selfStates,
		{ kind: "economy_budget", limit: 100 },
		emitter,
	);
	const sceneDetails = await invoke(toolMap.scene, {}, emitter);
	// The in-process view ranks on provider flags and template ids: full rows.
	const manipulationContextDetails = await invoke(
		toolMap.manipulationContext,
		{ detail: "full" },
		emitter,
	);
	const manipulationContext = orientManipulationContextFrom(manipulationContextDetails);
	const senseContextDetails = await invoke(toolMap.senseContext, {}, emitter);
	const senseContext = orientSenseContextFrom(senseContextDetails);
	const resourceStates =
		resourceObservations.length === 0
			? undefined
			: await observeOfferedResources(
					resourceObservations,
					(manipulationContext.status === "ready" ? manipulationContext.actions : []).map(
						(action) => ({ actionId: action.actionId }),
					),
					(stateId) =>
						invoke(
							toolMap.selfStates,
							{ kind: "state", state_prefix: stateId, limit: 100 },
							emitter,
						),
				);

	return {
		kind: "turn",
		actorId,
		...(selfTargetRef === undefined ? {} : { selfTargetRef }),
		session: orientSessionStatusFrom(sessionDetails) ?? ORIENT_DEFAULT_SESSION_STATUS,
		selfSummary: orientSelfSummaryFrom(selfDetails),
		inventory,
		...(resourceStates === undefined ? {} : { resourceStates }),
		economyBudget,
		scene: orientSceneViewFrom(sceneDetails),
		manipulationContext,
		senseContext,
		events: observedEvents,
	};
}

// bead sk-cdi Scope B, the operator's explicit requirement: traces page by
// CURSOR, most-recent-first, never a fixed time window and never the whole
// history in one call. Default page size is DELIBERATELY smaller than
// `spellkave_traces`' own default (`TRACE_LIMIT` = 40): orient already bundles
// self+scene+inventory+traces in ONE call, so its own traces slice stays
// small enough that the bundle itself stays cheap; a caller who wants a WIDE
// trace read already has `spellkave_traces` for that. 10 is enough recent
// history to stand alone as a usable orientation (what just happened here);
// going further back costs another call, on purpose — recall should cost
// turns, not one unbounded dump. Capped at 25 (matches the schema's own
// `maximum`) so even an explicit wide ask stays bounded.
const ORIENT_TRACES_DEFAULT_LIMIT = 10;
const ORIENT_TRACES_MAX_LIMIT = 25;

/**
 * One page of `spellkave_traces`-shaped trace entries, MOST-RECENT-FIRST.
 * `currentTraces` already reverses the projection (sk-0m4.97), so orientation
 * pages the SAME ordered array through the SAME cursor/offset mechanics
 * (`safeQueryPage`, `query-protocol.ts`): page 0 (no cursor) is the most
 * recent `limit` traces, `next_cursor` reaches the `limit` before those.
 * Interchange-safe with `spellkave_traces`' own cursors by construction —
 * both hash the same most-recent-first row order into `queryRevision`.
 */
function orientTracesPage(
	context: SpellkaveToolContext,
	params: { cursor?: string; limit?: number },
): unknown {
	const { entries } = currentTraces(context);
	const limit = Math.max(
		1,
		Math.min(ORIENT_TRACES_MAX_LIMIT, Math.trunc(params.limit ?? ORIENT_TRACES_DEFAULT_LIMIT)),
	);
	const page = safeQueryPage({
		domain: "trace",
		rows: entries,
		limit,
		cursor: params.cursor,
		maxLimit: ORIENT_TRACES_MAX_LIMIT,
	});
	if (!("listing" in page)) return page;
	return {
		...page,
		items: page.items.map((entry) => ({
			handle: stableHandle("trace", entry.trace_id),
			rev: contentFingerprint(entry),
			kind: entry.kind,
			inscribed_at: entry.inscribed_at,
			expires_at: entry.expires_at,
			inscribed_by: entry.inscribed_by,
			visibility: entry.visibility,
		})),
	};
}

export interface OrientOptions {
	/** Opaque `next_cursor` copied from a prior orientation's `traces.next_cursor`
	 * — fetches the next (OLDER) page of traces. Omit for the first call: the
	 * most recent page, which stands alone as a usable orientation. */
	cursor?: string;
	/** Traces per page. Defaults to {@link ORIENT_TRACES_DEFAULT_LIMIT}, capped
	 * at {@link ORIENT_TRACES_MAX_LIMIT}. */
	limit?: number;
}

/**
 * Everything an actor can currently establish about its own situation, read
 * in one shot. A {@link PlayerOrientationView} (what a brain perceives every
 * cycle) plus the two standing PLAYER reads a cycle deliberately skips:
 * `inventory` (what I carry) and `traces` (the world's own record of what
 * happened here, ONE page of it — Scope B, bead sk-cdi).
 */
export interface SeatOrientation {
	actorId: string;
	view: PlayerOrientationView;
	inventory: unknown;
	traces: unknown;
}

/**
 * Rebuild an actor's situation from the WORLD, for a consumer that has no
 * history of its own — a player agent whose conversation was discarded (every
 * `just play-load` invalidates one), an LLM-brained seat whose host
 * restarted, or (bead sk-cdi) a live PLAYER agent mid-run that just wants a
 * situation refresh. Structured, not prose: a consuming agent derives its own
 * narration.
 *
 * BLIND BY CONSTRUCTION — the entire payload comes from the PLAYER-facing
 * tool map, so it can contain nothing the actor may not perceive. Two honest
 * limits: `view.events` is always `[]` (a fresh `WorldEventBuilder` primes on
 * its first read, so an oriented agent has no event history — its history is
 * the world state itself, plus `traces`), and orientation restores SITUATION,
 * never INTENT.
 *
 * ONE function, three customers (bead sk-cdi): `@spellkave/npc`'s `orientSeat`
 * (session-flavored, `just play-orient`), an LLM-brained NPC host restart, and
 * this package's own `spellkave_orient` PLAYER tool below.
 */
export async function orientSeatFromContext(
	actorId: string,
	context: SpellkaveToolContext,
	emitter: ToolRunEmitter,
	options: OrientOptions = {},
): Promise<SeatOrientation> {
	const toolMap = createPlayerFacingToolMap(context);
	// One-shot: this builder is created and dropped here, which is exactly the
	// "recreate trap" a long-lived seat must avoid and exactly what orientation
	// wants — no claim about deltas, no cursor to corrupt for whoever holds
	// the long-lived one.
	const events = createWorldEventBuilder(
		() => currentDb(context),
		() => contextActorId(context),
	);
	const view = await perceive(actorId, toolMap, emitter, events, [], contextActorId(context));
	const inventory =
		view.kind === "turn" ? view.inventory : await invoke(toolMap.inventory, {}, emitter);
	const traces = await invoke(
		{
			name: SPELLKAVE_TRACES_TOOL,
			execute: async (_toolCallId: string, params: { cursor?: string; limit?: number }) => ({
				details: orientTracesPage(context, params),
			}),
		},
		{ cursor: options.cursor, limit: options.limit },
		emitter,
	);
	return { actorId, view, inventory, traces };
}

const orientToolDef = defineTool<
	SpellkaveToolContext,
	typeof ORIENT_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: SPELLKAVE_ORIENT_TOOL,
	schema: ORIENT_PARAMS,
	run: async (
		context: SpellkaveToolContext,
		params: Static<typeof ORIENT_PARAMS>,
		_toolCallId,
		capabilities,
	) => {
		const { actorId } = requireActorId(context);
		const telemetry = capabilities?.node?.telemetry;
		// Telemetry sink for the PLAYER-tool sub-calls this composition makes
		// internally (`invoke`, above) — dropped, never the host's own run
		// stream: from the CALLING agent's perspective there was exactly one
		// tool call (`spellkave_orient`), already observed at that layer: same
		// one-shot pattern `orient-adventure.ts` uses for the operator read.
		const emitter = telemetry?.createRunEmitter({
			run_id: `orient-${actorId}`,
			run_kind: "world_observation",
			actor_id: actorId,
			role: "PLAYER",
			controller_kind: "companion",
			driver: SPELLKAVE_ORIENT_TOOL,
			deterministic: true,
		}) ?? { emit: () => undefined };
		const orientation = await orientSeatFromContext(actorId, context, emitter, {
			cursor: params.cursor,
			limit: params.limit,
		});
		// The tool answer is projected for a model host (bounded, snake_case
		// manipulation context); `orientSeatFromContext` itself keeps the full
		// in-process view for seats and the operator read. The context is read
		// again here from the same snapshot the composition just read.
		return toolResult(
			orientationForPlayer(orientation, readManipulationContext(currentDb(context), actorId)),
		);
	},
});

export function createOrientTool(
	context: SpellkaveToolContext,
	capabilities: NodeToolCapabilities = {},
	validateArguments = true,
): PlayerBoundTool<typeof ORIENT_PARAMS, unknown> {
	return bindPlayerTool(orientToolDef, context, capabilities, validateArguments);
}

function primaryActor(context: SpellkaveToolContext): bigint {
	const db = currentDb(context);
	const { actorId } = requireActorId(context);
	const body = resolveEntityId(db, actorId);
	const primary = new Set(
		readActorIdentityBindings(db)
			.filter((row) => row.role === "primary")
			.map((row) => row.actor_id),
	);
	const row = readActorPrincipals(db).find(
		(row) => primary.has(row.actor_id) && String(row.current_body) === String(body),
	);
	if (row === undefined) throw new Error("consent requires this connection's primary actor");
	return BigInt(row.actor_id);
}
const offerControlToolDef = defineTool({
	contract: SPELLKAVE_OFFER_CONTROL_TOOL,
	schema: OFFER_CONTROL_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof OFFER_CONTROL_PARAMS>) => {
		if (!context.controlReducers) throw new Error("consent transport is not configured");
		await context.controlReducers.rOfferControl({
			actorId: primaryActor(context),
			identityHex: params.identity,
		});
		return toolResult({ status: "offered", identity: params.identity });
	},
});
const withdrawControlToolDef = defineTool({
	contract: SPELLKAVE_WITHDRAW_CONTROL_TOOL,
	schema: WITHDRAW_CONTROL_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof WITHDRAW_CONTROL_PARAMS>) => {
		if (!context.controlReducers) throw new Error("consent transport is not configured");
		await context.controlReducers.rWithdrawControl({
			actorId: primaryActor(context),
			identityHex: params.identity,
		});
		return toolResult({ status: "withdrawn", identity: params.identity });
	},
});
const takeNpcControlToolDef = defineTool({
	contract: SPELLKAVE_TAKE_NPC_CONTROL_TOOL,
	schema: TAKE_NPC_CONTROL_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof TAKE_NPC_CONTROL_PARAMS>) => {
		if (!context.controlReducers) throw new Error("NPC control transport is not configured");
		await context.controlReducers.rTakeNpcControl({
			actorId: BigInt(params.actor_id),
			presenceActorId: BigInt(params.presence_actor_id),
			expectedGeneration: BigInt(params.expected_generation),
			worldInstanceId: params.world_instance_id,
			requestId: params.request_id,
			reason: params.reason,
		});
		return toolResult({
			status: "held",
			request_id: params.request_id,
			control:
				readDriverControl(currentDb(context)).find(
					(row) => String(row.actorId) === params.actor_id,
				) ?? null,
		});
	},
});
const returnNpcControlToolDef = defineTool({
	contract: SPELLKAVE_RETURN_NPC_CONTROL_TOOL,
	schema: RETURN_NPC_CONTROL_PARAMS,
	run: async (context: SpellkaveToolContext, params: Static<typeof RETURN_NPC_CONTROL_PARAMS>) => {
		if (!context.controlReducers) throw new Error("NPC control transport is not configured");
		await context.controlReducers.rReturnNpcControl({
			actorId: BigInt(params.actor_id),
			expectedGeneration: BigInt(params.expected_generation),
			worldInstanceId: params.world_instance_id,
			requestId: params.request_id,
			reason: params.reason,
		});
		return toolResult({
			status: "returned",
			request_id: params.request_id,
			control:
				readDriverControl(currentDb(context)).find(
					(row) => String(row.actorId) === params.actor_id,
				) ?? null,
		});
	},
});

export const spellkaveToolDefinitions = [
	// Exported (not just module-private) so a docs generator can walk the FULL
	// registry structurally (companion tool-reference.md, #1968) the same way
	// `authorFacingToolDefinitions` already is — see
	// `scripts/generate-companion-tool-reference.ts`.
	orientToolDef,
	statusToolDef,
	eventsToolDef,
	selfSummaryToolDef,
	selfStatesToolDef,
	sceneToolDef,
	sceneDetailToolDef,
	mapToolDef,
	moveToolDef,
	inventoryToolDef,
	itemDetailToolDef,
	traceDetailToolDef,
	sessionStatusToolDef,
	reactionOptionsToolDef,
	interventionWindowsToolDef,
	reactOptionToolDef,
	suggestNextActionToolDef,
	manipulationContextToolDef,
	entityToolDef,
	entityContainerToolDef,
	observerKnowledgeToolDef,
	observerPlaceKnowledgeToolDef,
	observerTraceKnowledgeToolDef,
	tracesToolDef,
	entityBodyToolDef,
	actorPrincipalsToolDef,
	communicateToolDef,
	senseContextToolDef,
	senseToolDef,
	sessionOpenToolDef,
	sessionCloseToolDef,
	sessionMoveToolDef,
	endTurnToolDef,
	manipulateToolDef,
	releaseClaimToolDef,
	wakeUpToolDef,
	offerControlToolDef,
	withdrawControlToolDef,
	takeNpcControlToolDef,
	returnNpcControlToolDef,
] as const;

type SpellkaveToolDefinition = (typeof spellkaveToolDefinitions)[number];

/**
 * Derived from {@link spellkaveToolDefinitions} — the single registration point —
 * rather than hand-maintained arm by arm. Adding a tool to that array
 * automatically both registers it at runtime (`createSpellkaveTools`) and
 * widens this type.
 */
export type SpellkaveCompanionTool = PlayerBoundTool<
	SpellkaveToolDefinition["parameters"],
	unknown
>;

/** Bind a canonical definition for the session daemon without a Pi adapter. */
function bindPlayerTool<TContext, P extends TSchema, R>(
	definition: ToolDefinition<TContext, P, R>,
	context: TContext,
	capabilities: NodeToolCapabilities = {},
	validateArguments = true,
): PlayerBoundTool<P, R> {
	const playerContext = context as unknown as SpellkaveToolContext;
	// Read-only/unconfigured registries can be constructed before a connection
	// exists. They have no acting transport and offer no steering arguments.
	const offeringContext =
		playerContext.act === undefined && playerContext.controlReducers === undefined
			? { ...playerContext, db: {} }
			: playerContext;
	const parameters = offeredActToolParameters(definition.parameters, offeringContext);
	if (parameters !== definition.parameters) definition = { ...definition, parameters };
	return bindTool(definition, {
		context,
		capabilities,
		validateArguments,
	});
}

// --- ADR-0083 Stage 2: piggyback `world_deltas` on every tool response. ---
//
// One `DeltaTracker` per tool-context (session) — created here, at the SAME
// point a host binds its context to the registry, so its baseline is primed
// (D-5) exactly once per session, never mid-session. Every tool this
// registry hands out gets wrapped; hosts that bind individual factories
// directly (`createSceneTool(context)` etc., below) do NOT get this — only
// the three registry entry points do, per the ADR-0083 postscript's
// tool-layer-decorator scope (no driver-contract surface touched).
/**
 * Filter 2 (operator review, 2026-08-04): true when this tool call's OWN
 * result is a dispatched movement receipt whose move succeeded —
 * `spellkave_move`'s rev+handle branch, which calls
 * `dispatchMovementByEdge`, returns this shape,
 * `{receipt: {move: {status: "success", ...}}}`. Pure inspection of the
 * result already in hand, no extra read and no state beyond the tracker's
 * own baseline — the wrapper knows which tool it just ran and can look at
 * what that tool returned.
 */
function isSuccessfulOwnMove(details: unknown): boolean {
	if (typeof details !== "object" || details === null) return false;
	const receipt = (details as { receipt?: unknown }).receipt;
	if (typeof receipt !== "object" || receipt === null) return false;
	const move = (receipt as { move?: unknown }).move;
	if (typeof move !== "object" || move === null) return false;
	return (move as { status?: unknown }).status === "success";
}

/**
 * ADR-0093 D-3: `isSuccessfulOwnMove`'s sibling for the OTHER receipt shape a
 * PLAYER tool result can carry — `spellkave_manipulate`'s dispatched
 * direct attempt, `{receipt: {manipulate: {...}, resolution: {result:
 * "success"|"failure", ...}}}` (`resolution.ts`, the same field
 * `summarizeAct`'s own manipulate branch reads). Together the two cover every
 * receipt-bearing PLAYER tool in this registry — every other tool is a pure
 * read whose result carries no `receipt` at all, so it is never
 * receipt-attributable by construction, with no third discriminator needed.
 */
function isSuccessfulOwnManipulate(details: unknown): boolean {
	if (typeof details !== "object" || details === null) return false;
	const receipt = (details as { receipt?: unknown }).receipt;
	if (typeof receipt !== "object" || receipt === null) return false;
	const manipulate = (receipt as { manipulate?: unknown }).manipulate;
	if (typeof manipulate !== "object" || manipulate === null) return false;
	const resolution = (receipt as { resolution?: unknown }).resolution;
	if (typeof resolution !== "object" || resolution === null) return false;
	return (resolution as { result?: unknown }).result === "success";
}

// --- T5 extension (PR #2115 review thread, operator-approved 2026-08-06). ---
//
// The original T5 fix (0c3d98958) suppressed the repeated `graph_description`
// blurb only on the move-ARRIVAL observation path (`describeArrival`,
// observation.ts) — the destination node's own from/to pair is known within
// that ONE call, so no persistent state was needed there. `spellkave_scene`'s
// own orientation read still repeated the identical blurb on EVERY call,
// unconditionally (`currentScene()` above) — a plain read has no from/to pair
// of its own to compare within one call, so suppressing it needs a per-context
// "have I shown this graph's blurb before" cursor instead.
//
// Same construction-site discipline as the `DeltaTracker` above (D-5,
// primed exactly once, never recreated mid-session): built at the SAME three
// registry-entry-point call sites, as a plain closure variable rather than a
// context-keyed map, so a cursor recreated mid-session is structurally
// impossible here (there is no map to accidentally re-key) — the tradeoff is
// that `withSceneGraphSuppression`, like `withWorldDeltas`, only reaches
// tools handed out through the registry; the individual-factory path
// (`createSceneTool(context)` used directly by scene-tools.test.ts and
// CLI/test callers) intentionally stays unwrapped, same boundary the
// `DeltaTracker` comment above already draws — a bare factory call has no
// registry-entry-point construction site to prime a cursor at, and baking
// this into `currentScene()` itself would leak cursor state across every
// caller sharing one fixture/context object (exactly the scene-tools.test.ts
// shape: one `context` const reused across many independent `it()` blocks).
function withSceneGraphSuppression<T extends PlayerExecutionTool<TSchema, unknown>>(tool: T): T {
	if (tool.name !== SPELLKAVE_SCENE_TOOL) return tool;
	// Mirrors describeArrival's own "no prior origin -> treat as a crossing"
	// safer default: the FIRST scene read of a session has nothing to compare
	// against, so it shows the blurb rather than silently gapping.
	let lastGraphId: string | undefined;
	return {
		...tool,
		execute: async (toolCallId, params) => {
			const result = await tool.execute(toolCallId, params);
			const details = result.details;
			if (typeof details !== "object" || details === null || !("node_id" in details)) {
				return result;
			}
			const nodeId = (details as { node_id?: unknown }).node_id;
			if (typeof nodeId !== "string") return result;
			const graphId = graphPrefix(nodeId);
			const changed = lastGraphId === undefined || lastGraphId !== graphId;
			lastGraphId = graphId;
			if (changed) return result;
			return toolResult({ ...(details as object), graph_description: null }) as ToolResult<unknown>;
		},
	} as T;
}

function withWorldDeltas<T extends PlayerExecutionTool<TSchema, unknown>>(
	tool: T,
	tracker: DeltaTracker,
): T {
	return {
		...tool,
		execute: async (toolCallId, params) => {
			const result = await tool.execute(toolCallId, params);
			// Filter 2: leaving the old node is IMPLIED by a move the actor just
			// made themselves — suppress only the scene domain's `removed` side,
			// keep `added` (what's here now) and every other domain untouched.
			const ownMove = isSuccessfulOwnMove(result.details);
			// ADR-0093 D-3: world_deltas rides at all ONLY when this call's own
			// receipt reports a successful own action (move or manipulate) —
			// every other call (a plain read, or a failed action) reports nothing,
			// regardless of what actually changed; see delta-tracker.ts's
			// `receiptAttributable` doc comment for the cursor-still-advances
			// contract this depends on.
			return coordinateWorldDeltas(
				result,
				{
					receiptAttributable: ownMove || isSuccessfulOwnManipulate(result.details),
					suppressSceneRemoved: ownMove,
				},
				{
					tracker,
					contentFor: (worldDeltas): ToolResult<unknown>["content"][number] => ({
						type: "text" as const,
						text: stringify({ world_deltas: worldDeltas }),
					}),
				},
			);
		},
	} as T;
}

/**
 * Appends, never re-serializes, the tool's own first content block — the
 * Stage-2 cache argument (ADR-0083): a cached prompt prefix built from a
 * tool's JSON output stays byte-identical whether or not a delta note
 * follows it. `details.world_deltas` carries the same payload for
 * consumers that read structured `details` instead of `content` text.
 *
 * Known, accepted limitation (recorded in the ADR-0083 postscript, not a
 * bug): the note can restate a change THIS response already shows (the
 * agent's own move appears as a `scene` delta), and a change caused by this
 * very call but not yet reflected in the subscription cache surfaces on the
 * NEXT call instead of this one.
 */
// --- U2 (BL-2, 2026-08-06 decision log): a non-silent session end. ---
//
// The decision log's own U2 observation: `end_turn` -> `session_status` ->
// `no_session` is the ONLY signal a PLAYER tool gives when a session closes —
// victory is recognizable only by absence, no terminal event, no outcome.
// This decorator composes an honest closing line from channels that already
// exist and are already visible to the connected actor: `spellkave_session_
// status`'s own roster (captured while the session is still active — the
// closed session's row is gone by the time absence is observable, so there is
// nothing left server-side to read a "reason" off), plus each once-rostered
// participant's own `visible_target_condition` (the SAME channel the U1
// `target_conditions` field above reads, `observable: true` per condition).
// No new epistemic disclosure: a defeated participant's `condition/dead` was
// already visible to a co-located actor before this decorator existed — this
// only composes it into the ONE receipt that first observes the session's
// absence, instead of requiring a second manual lookup.
const DEAD_CONDITION_SUFFIX = "condition/dead";

function isDeadCondition(row: { condition_definition_id: string }): boolean {
	return row.condition_definition_id.endsWith(DEAD_CONDITION_SUFFIX);
}

export interface SessionEndedOutcome {
	session_id: string;
	/** `"victory"`/`"defeat"` when a `condition/dead` row on a known
	 * participant (self or a former roster-mate) explains the closure;
	 * `"unknown"` when the session ended without one — an honest gap, never a
	 * guessed verdict (a fled/withdrawn opponent looks identical to this
	 * decorator today). */
	outcome: "victory" | "defeat" | "unknown";
	/** Former roster-mates (never self) whose own conditions now include
	 * `condition/dead`, read at the moment the closure was first observed. */
	defeated: Array<{ actor_id: string; name: string }>;
	reason: string;
}

/** Per-context state `withSessionTermination` mutates across calls — the
 * roster captured from the LAST `active` `spellkave_session_status` response,
 * cleared the moment the closure is reported so the line rides exactly ONE
 * receipt (the first to observe the absence), never every subsequent poll. */
interface SessionTerminationState {
	lastKnownRoster?: { session_id: string; participants: EntityRef[] };
}

function createSessionTerminationState(): SessionTerminationState {
	return {};
}

function deriveSessionEndedOutcome(
	db: SnapshotDb,
	selfActorId: EntityRef,
	sessionId: string,
	participantIds: readonly EntityRef[],
): SessionEndedOutcome {
	const selfDead = readActorSnapshot(db, selfActorId)?.conditions.some(isDeadCondition) ?? false;
	const defeated = participantIds
		.map((id) => ({ id, snapshot: readActorSnapshot(db, id) }))
		.filter(({ snapshot }) => snapshot?.conditions.some(isDeadCondition) ?? false)
		.map(({ id, snapshot }) => ({ actor_id: id, name: snapshot?.entity_name || id }));
	if (selfDead) {
		return {
			session_id: sessionId,
			outcome: "defeat",
			defeated,
			reason: "Your own body carries a lethal condition — the session ended.",
		};
	}
	if (defeated.length > 0) {
		return {
			session_id: sessionId,
			outcome: "victory",
			defeated,
			reason: `${defeated.map((d) => d.name).join(", ")} no longer stands — the session ended.`,
		};
	}
	return {
		session_id: sessionId,
		outcome: "unknown",
		defeated: [],
		reason:
			"The session ended without a lethal condition on you or any former roster-mate — no tool discloses a reason beyond that.",
	};
}

function appendSessionEnded<R>(
	result: ToolResult<R>,
	sessionEnded: SessionEndedOutcome,
): ToolResult<R> {
	const details =
		typeof result.details === "object" && result.details !== null
			? { ...(result.details as object), session_ended: sessionEnded }
			: { result: result.details, session_ended: sessionEnded };
	return {
		...result,
		content: [
			...result.content,
			{ type: "text" as const, text: stringify({ session_ended: sessionEnded }) },
		],
		details: details as R,
	};
}

function withSessionTermination<T extends PlayerExecutionTool<TSchema, unknown>>(
	tool: T,
	state: SessionTerminationState,
	context: SpellkaveToolContext,
): T {
	if (tool.name !== SPELLKAVE_SESSION_STATUS_TOOL && tool.name !== SPELLKAVE_END_TURN_TOOL) {
		return tool;
	}
	return {
		...tool,
		execute: async (toolCallId, params) => {
			const result = await tool.execute(toolCallId, params);
			const details = result.details;
			if (typeof details !== "object" || details === null) return result;
			const record = details as Record<string, unknown>;

			if (tool.name === SPELLKAVE_SESSION_STATUS_TOOL) {
				if (record.status === "active") {
					const session = record.session as
						| { session_id?: unknown; roster?: Array<{ actor_id?: unknown }> }
						| null
						| undefined;
					if (typeof session?.session_id === "string" && Array.isArray(session.roster)) {
						const selfId = contextActorId(context);
						const selfEntityId =
							selfId === undefined ? undefined : resolveEntityId(currentDb(context), selfId);
						const selfEntityIdText = selfEntityId === undefined ? undefined : String(selfEntityId);
						state.lastKnownRoster = {
							session_id: session.session_id,
							participants: session.roster
								.map((p) => (typeof p.actor_id === "string" ? asEntityRef(p.actor_id) : undefined))
								.filter((id): id is EntityRef => id !== undefined && id !== selfEntityIdText),
						};
					}
					return result;
				}
				if (record.status !== "no_session" || state.lastKnownRoster === undefined) return result;
			} else {
				// spellkave_end_turn: `session` is present only on an accepted
				// advance (tools.ts's own endTurnToolDef); a rejected call carries
				// no session state at all and is left untouched.
				const session = record.session as { in_session?: unknown } | undefined;
				if (
					session === undefined ||
					session.in_session !== false ||
					state.lastKnownRoster === undefined
				) {
					return result;
				}
			}

			const roster = state.lastKnownRoster;
			state.lastKnownRoster = undefined;
			const selfId = contextActorId(context);
			if (selfId === undefined) return result;
			const outcome = deriveSessionEndedOutcome(
				currentDb(context),
				selfId,
				roster.session_id,
				roster.participants,
			);
			return appendSessionEnded(result, outcome);
		},
	} as T;
}

function wrapToolsWithWorldDeltas<T extends PlayerExecutionTool<TSchema, unknown>>(
	tools: T[],
	context: SpellkaveToolContext,
): T[] {
	const tracker = createWorldDeltaTracker(
		createCompanionWorldDeltaSource(
			() => currentDb(context),
			() => contextActorId(context),
		),
	);
	const sessionTermination = createSessionTerminationState();
	return tools.map((tool) =>
		withSessionTermination(
			withWorldDeltas(withSceneGraphSuppression(tool), tracker),
			sessionTermination,
			context,
		),
	);
}

/**
 * Transitional result decoration for hosts that bind through the Pi-adaptation
 * boundary. This preserves the historical PLAYER/DM
 * delta, scene, and session-result envelopes without owning Pi conversion.
 */
export function wrapRoleTools<T extends PlayerExecutionTool<TSchema, unknown>>(
	tools: T[],
	context: SpellkaveToolContext,
): T[] {
	return wrapToolsWithWorldDeltas(tools, context);
}

export function createSpellkaveTools(
	context: SpellkaveToolContext,
	capabilities: NodeToolCapabilities = {},
	validateArguments = true,
): SpellkaveCompanionTool[] {
	// `spellkaveToolDefinitions` is a tuple of distinct `ToolDefinition<SpellkaveToolContext,
	// P_n, R_n>` types (one per tool) so the union derivation above stays precise.
	// `Array#map`'s generic signature can only instantiate ONE (P, R) pair per
	// call, so it cannot follow that per-element precision across a heterogeneous
	// tuple; widen to the common `TSchema`/`unknown` shape here (matching
	// `SpellkaveCompanionTool`'s own looser `PlayerBoundTool<..., unknown>` shape) and
	// let `bindPlayerTool` do the real per-element work at runtime.
	const tools = spellkaveToolDefinitions.map((def) =>
		bindPlayerTool(
			def as ToolDefinition<SpellkaveToolContext, TSchema, unknown>,
			context,
			capabilities,
			validateArguments,
		),
	) as SpellkaveCompanionTool[];
	return wrapToolsWithWorldDeltas(tools, context);
}

// --- Role-scoped subsets (ADR-0074, #1857 S1). Tool MEMBERSHIP is exported by
// the registry, never curated by consumers: hosts consume these named subsets,
// so adding a tool to a subset here
// propagates to every host with zero further edits. `spellkaveToolDefinitions` above
// stays the superset. ---

/**
 * The player-facing tool subset: the perceive + act surface a PLAYER-role
 * agent gets, excluding the operator/observability tools (status, events,
 * observer_knowledge, session lifecycle, ...). Order is the registration
 * order hosts present to the model.
 */
export const playerFacingToolDefinitions = PLAYER_TOOL_NAMES.map((name) => {
	const definition = spellkaveToolDefinitions.find((candidate) => candidate.name === name);
	if (definition === undefined)
		throw new Error(`PLAYER contract '${name}' has no companion execution body.`);
	return definition;
});

export type PlayerFacingToolDefinition = (typeof playerFacingToolDefinitions)[number];

/** Names of the player-facing subset, in registration order. */
export const PLAYER_FACING_TOOL_NAMES: readonly string[] = PLAYER_TOOL_NAMES;

/** Bind the player-facing subset to one host context (see {@link createSpellkaveTools}). */
export function createPlayerFacingTools(
	context: SpellkaveToolContext,
	capabilities: NodeToolCapabilities = {},
	validateArguments = true,
): SpellkaveCompanionTool[] {
	// Same heterogeneous-tuple widening as `createSpellkaveTools` above.
	const tools = playerFacingToolDefinitions.map((def) =>
		bindPlayerTool(
			def as ToolDefinition<SpellkaveToolContext, TSchema, unknown>,
			context,
			capabilities,
			validateArguments,
		),
	) as SpellkaveCompanionTool[];
	return wrapToolsWithWorldDeltas(tools, context);
}

/**
 * The DM-role EXTENSION over the PLAYER subset (sk-hfj): every tool
 * `spellkaveToolDefinitions` carries that `playerFacingToolDefinitions` does
 * NOT — the global/omniscient reads a live DM steering a session needs and a
 * PLAYER must not have as an ambient menu item (world status/events,
 * per-actor fog-of-war `observer_*_knowledge`, arbitrary entity/actor
 * inspection, and the retained-deprecated general-registry duplicates).
 * DERIVED, never a hand-listed id set (ADR-0074): membership is the FULL
 * registry minus the PLAYER roster, so a new companion tool added to
 * `spellkaveToolDefinitions` and left out of `playerFacingToolDefinitions`
 * becomes a DM tool automatically — it can never land assigned to no role.
 * Carries zero AUTHOR tools: those live in the entirely separate
 * `authorFacingToolDefinitions` registry (`authoring.ts`), never this one.
 */
export const dmExtensionToolDefinitions = DM_TOOL_NAMES.map((name) => {
	const definition = spellkaveToolDefinitions.find((candidate) => candidate.name === name);
	if (definition === undefined)
		throw new Error(`DM contract '${name}' has no companion execution body.`);
	return definition;
});

export type DmExtensionToolDefinition = (typeof dmExtensionToolDefinitions)[number];

/** Names of the DM-role extension subset, in registration order. */
export const DM_EXTENSION_TOOL_NAMES: readonly string[] = DM_TOOL_NAMES;

/** Bind the DM-role extension subset to one host context (see {@link createSpellkaveTools}). */
export function createDmExtensionTools(
	context: SpellkaveToolContext,
	capabilities: NodeToolCapabilities = {},
	validateArguments = true,
): SpellkaveCompanionTool[] {
	// Same heterogeneous-tuple widening as `createSpellkaveTools` above.
	const tools = dmExtensionToolDefinitions.map((def) =>
		bindPlayerTool(
			def as ToolDefinition<SpellkaveToolContext, TSchema, unknown>,
			context,
			capabilities,
			validateArguments,
		),
	) as SpellkaveCompanionTool[];
	return wrapToolsWithWorldDeltas(tools, context);
}

/**
 * Typed bag of the same PLAYER tools as {@link createPlayerFacingTools}, keyed
 * for IDE autocomplete (no magic-string lookup). Each value is the bound
 * `PlayerBoundTool` — call `tool.execute(id, params)`; use `tool.name` when a host
 * needs the registry string (telemetry, session invoke).
 *
 * Prefer this over `createPlayerFacingTools(...).find(t => t.name === "…")`
 * in tests and typed hosts. Array form stays for agent registration order.
 */
/** Observation cursors belong to the seat/session, even when act clients change. */
export function createPlayerToolState(context: SpellkaveToolContext) {
	const tracker = createWorldDeltaTracker(
		createCompanionWorldDeltaSource(
			() => currentDb(context),
			() => contextActorId(context),
		),
	);
	const sessionTermination = createSessionTerminationState();
	return { tracker, sessionTermination };
}
export type PlayerToolState = ReturnType<typeof createPlayerToolState>;

export function createPlayerFacingToolMap(
	context: SpellkaveToolContext,
	capabilities: NodeToolCapabilities = {},
	validateArguments = true,
	state: PlayerToolState = createPlayerToolState(context),
) {
	// Same one-tracker-per-context binding as `createSpellkaveTools`/
	// `createPlayerFacingTools` above, applied per map entry: `wrap` is a
	// type-preserving identity over each entry's own (P, R) pair (unlike
	// `wrapToolsWithWorldDeltas`'s array form, there is no heterogeneous-tuple
	// widening to redo here — each factory call already has its own precise type).
	const { tracker, sessionTermination } = state;
	const wrap = <P extends TSchema, R>(tool: PlayerBoundTool<P, R>): PlayerBoundTool<P, R> =>
		withSessionTermination(
			withWorldDeltas(withSceneGraphSuppression(tool), tracker),
			sessionTermination,
			context,
		);
	const bind = <P extends TSchema, R>(definition: ToolDefinition<SpellkaveToolContext, P, R>) =>
		bindPlayerTool(definition, context, capabilities, validateArguments);
	return {
		offerControl: wrap(bind(offerControlToolDef)),
		withdrawControl: wrap(bind(withdrawControlToolDef)),
		orient: wrap(bind(orientToolDef)),
		selfSummary: wrap(bind(selfSummaryToolDef)),
		selfStates: wrap(bind(selfStatesToolDef)),
		scene: wrap(bind(sceneToolDef)),
		sceneDetail: wrap(bind(sceneDetailToolDef)),
		map: wrap(bind(mapToolDef)),
		move: wrap(bind(moveToolDef)),
		inventory: wrap(bind(inventoryToolDef)),
		itemDetail: wrap(bind(itemDetailToolDef)),
		traces: wrap(bind(tracesToolDef)),
		traceDetail: wrap(bind(traceDetailToolDef)),
		sessionStatus: wrap(bind(sessionStatusToolDef)),
		reactionOptions: wrap(bind(reactionOptionsToolDef)),
		interventionWindows: wrap(bind(interventionWindowsToolDef)),
		reactOption: wrap(bind(reactOptionToolDef)),
		endTurn: wrap(bind(endTurnToolDef)),
		manipulationContext: wrap(bind(manipulationContextToolDef)),
		senseContext: wrap(bind(senseContextToolDef)),
		// Internal seat-cycle entry: the public PLAYER roster keeps its existing
		// compatibility shape, while a factored SeatIntent dispatches the same
		// canonical direct attempt contract as MCP/CLI clients.
		manipulate: wrap(bind(manipulateToolDef)),
		communicate: wrap(bind(communicateToolDef)),
		sense: wrap(bind(senseToolDef)),
	} as const;
}

export type PlayerFacingToolMap = ReturnType<typeof createPlayerFacingToolMap>;

// --- Individual factories. Kept as named exports — beyond `createSpellkaveTools`,
// hosts (e.g. `world-explorer`'s wanderer) wire a curated subset of tools
// directly by factory rather than the full registry. Each is a thin bind of its
// `ToolDefinition` above via `bindPlayerTool`. ---

export function createStatusTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof STATUS_PARAMS, { status: ReturnType<typeof readWorldStatus> }> {
	return bindPlayerTool(statusToolDef, context);
}

export function createEventsTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof EVENTS_PARAMS, { events: ReturnType<typeof readRecentEvents> }> {
	return bindPlayerTool(eventsToolDef, context);
}

export function createSelfSummaryTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof SELF_SUMMARY_PARAMS, unknown> {
	return bindPlayerTool(selfSummaryToolDef, context);
}

export function createSelfStatesTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof SELF_STATES_PARAMS, unknown> {
	return bindPlayerTool(selfStatesToolDef, context);
}

export function createSceneTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof SCENE_TARGETS_PARAMS, unknown> {
	return bindPlayerTool(sceneToolDef, context);
}

export function createSceneDetailTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof SCENE_DETAIL_PARAMS, unknown> {
	return bindPlayerTool(sceneDetailToolDef, context);
}

export function createMapTool(
	context: SpellkaveToolContext,
	capabilities: NodeToolCapabilities = {},
	validateArguments = true,
): PlayerBoundTool<typeof MAP_PARAMS, unknown> {
	return bindPlayerTool(mapToolDef, context, capabilities, validateArguments);
}

export function createInventoryTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof INVENTORY_PARAMS, unknown> {
	return bindPlayerTool(inventoryToolDef, context);
}

export function createItemDetailTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof ITEM_DETAIL_PARAMS, unknown> {
	return bindPlayerTool(itemDetailToolDef, context);
}

export function createTraceDetailTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof TRACE_DETAIL_PARAMS, unknown> {
	return bindPlayerTool(traceDetailToolDef, context);
}

export function createSessionStatusTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof SESSION_STATUS_PARAMS, unknown> {
	return bindPlayerTool(sessionStatusToolDef, context);
}

export function createReactionOptionsTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof REACTION_OPTIONS_PARAMS, unknown> {
	return bindPlayerTool(reactionOptionsToolDef, context);
}

export function createInterventionWindowsTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof INTERVENTION_WINDOWS_PARAMS, unknown> {
	return bindPlayerTool(interventionWindowsToolDef, context);
}

export function createReactOptionTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof REACT_OPTION_PARAMS, unknown> {
	return bindPlayerTool(reactOptionToolDef, context);
}

export function createSuggestNextActionTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof SUGGEST_NEXT_ACTION_PARAMS,
	{ suggestion: ReturnType<typeof suggestNextAction> }
> {
	return bindPlayerTool(suggestNextActionToolDef, context);
}

/**
 * T7: the canonical PLAYER movement factory — bound to the unified
 * `spellkave_move` tool (rev+handle scene-exit mode, or a raw edge_id
 * compatibility mode; see `moveToolDef`'s doc comment). Formerly
 * `createActSceneTool`; the deprecated raw `spellkave_move` wrapper this name
 * used to bind is retired, absorbed as `moveToolDef`'s edge_id branch.
 */
export function createMoveTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof MOVE_PARAMS, unknown> {
	return bindPlayerTool(moveToolDef, context);
}

export function createEntityTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof ENTITY_PARAMS, { entity: ReturnType<typeof readEntity> }> {
	return bindPlayerTool(entityToolDef, context);
}

export function createEntityContainerTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof ENTITY_CONTAINER_PARAMS,
	{ container: ReturnType<typeof readEntityContainer> }
> {
	return bindPlayerTool(entityContainerToolDef, context);
}

export function createObserverKnowledgeTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof OBSERVER_KNOWLEDGE_PARAMS,
	{ knowledge: ReturnType<typeof readObserverKnowledge> }
> {
	return bindPlayerTool(observerKnowledgeToolDef, context);
}

export function createObserverPlaceKnowledgeTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof OBSERVER_PLACE_KNOWLEDGE_PARAMS,
	{ place_knowledge: ReturnType<typeof readObserverPlaceKnowledge> }
> {
	return bindPlayerTool(observerPlaceKnowledgeToolDef, context);
}

export function createObserverTraceKnowledgeTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof OBSERVER_TRACE_KNOWLEDGE_PARAMS,
	{ trace_knowledge: ReturnType<typeof readObserverTraceKnowledge> }
> {
	return bindPlayerTool(observerTraceKnowledgeToolDef, context);
}

export function createTracesTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof TRACE_ENTRIES_PARAMS, unknown> {
	return bindPlayerTool(tracesToolDef, context);
}

export function createEntityBodyTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof ENTITY_BODY_PARAMS, { body: ReturnType<typeof readEntityBody> }> {
	return bindPlayerTool(entityBodyToolDef, context);
}

export function createActorPrincipalsTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof ACTOR_PRINCIPALS_PARAMS, { principals: ActorPrincipalRow[] }> {
	return bindPlayerTool(actorPrincipalsToolDef, context);
}

export function createCommunicateTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<typeof COMMUNICATE_PARAMS, unknown> {
	return bindPlayerTool(communicateToolDef, context);
}

export function createSessionOpenTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof SESSION_OPEN_PARAMS,
	{ session: Awaited<ReturnType<ReturnType<typeof createActorClient>["sessionOpen"]>> }
> {
	return bindPlayerTool(sessionOpenToolDef, context);
}

export function createSessionCloseTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof SESSION_CLOSE_PARAMS,
	{ session: Awaited<ReturnType<ReturnType<typeof createActorClient>["sessionClose"]>> }
> {
	return bindPlayerTool(sessionCloseToolDef, context);
}

export function createSessionMoveTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof SESSION_MOVE_PARAMS,
	{ session: Awaited<ReturnType<ReturnType<typeof createActorClient>["sessionMove"]>> }
> {
	return bindPlayerTool(sessionMoveToolDef, context);
}

export function createEndTurnTool(context: SpellkaveToolContext): PlayerBoundTool<
	typeof END_TURN_PARAMS,
	{
		receipt: { advance: AdvanceTurnResult };
		observation: string | null;
		observation_gap?: string;
	}
> {
	return bindPlayerTool(endTurnToolDef, context);
}

/** Bind the canonical direct PLAYER manipulation tool. */
export function createManipulateTool(context: SpellkaveToolContext) {
	return bindPlayerTool(manipulateToolDef, context);
}

/** Bind direct factual sensing discovery. */
export function createSenseContextTool(context: SpellkaveToolContext) {
	return bindPlayerTool(senseContextToolDef, context);
}

/** Bind the canonical direct PLAYER sensing attempt. */
export function createSenseTool(context: SpellkaveToolContext) {
	return bindPlayerTool(senseToolDef, context);
}

export function createReleaseClaimTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof RELEASE_CLAIM_PARAMS,
	{ release_claim: Awaited<ReturnType<ReturnType<typeof createActorClient>["releaseClaim"]>> }
> {
	return bindPlayerTool(releaseClaimToolDef, context);
}

export function createWakeUpTool(
	context: SpellkaveToolContext,
): PlayerBoundTool<
	typeof WAKE_UP_PARAMS,
	{ wake_up: Awaited<ReturnType<ReturnType<typeof createActorClient>["wakeUp"]>> }
> {
	return bindPlayerTool(wakeUpToolDef, context);
}
