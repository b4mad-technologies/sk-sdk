// Keep one builder per session. Its first call establishes a snapshot baseline.

import {
	isCausedByActor as runtimeIsCausedByActor,
	type WorldEvent,
	type WorldEventBuilder,
} from "@spellkave/world-events";
import { asEntityRef, type EntityRef } from "../core/ids";
import {
	buildEntityNameMap,
	readActiveSessionWithRosterForParticipant,
	readCurrentScene,
	readInterventionWindowsForActor,
	readManipulationContext,
	readReactionOptionsForActor,
	readRecentConditionDeltas,
	readRecentResourceDeltas,
	readRecentTraces,
	readTurnState,
	readWorldStatus,
	resolveEntityId,
	type SnapshotDb,
	type TraceRow,
} from "../readers";

export type {
	AdvancementAvailableEvent,
	DealtConditionEvent,
	DealtHitEvent,
	ReactionWindowEvent,
	SelfConditionChangedEvent,
	SelfHitEvent,
	SelfResourceSpentEvent,
	SessionLifecycleEvent,
	SpeechHeardEvent,
	TurnTransitionEvent,
	WorldEvent,
	WorldEventBuilder,
	XpGainedEvent,
} from "@spellkave/world-events";

// The portable WorldEvent vocabulary is authored in @spellkave/tool-runtime.
// This SDK-owning module only produces those events from subscribed deltas.

/** Last `/`-separated stem of a resource id (`srd/hp` → `hp`). Classification
 * is structural — never a `"srd/…"` literal (module header). */
function resourceStem(resourceId: string): string {
	const slash = resourceId.lastIndexOf("/");
	return slash < 0 ? resourceId : resourceId.slice(slash + 1);
}

/** Hit-point-shaped pools: the only resources that may ride `self_hit` /
 * `dealt_hit`. `temp_hp` is the same durability idiom as `hp`; `hp_per_level`
 * is a catalog fact, not a wound. */
function isHitPointResource(resourceId: string): boolean {
	const stem = resourceStem(resourceId);
	return stem === "hp" || stem === "temp_hp";
}

/** The actor's own experience pool (`srd/xp`). Distinct from a corpse's
 * `xp_value` latch, which is another body's sheet and never pushed. */
function isOwnXpResource(resourceId: string): boolean {
	return resourceStem(resourceId) === "xp";
}

/** Reader-bounded read window for the resource-delta event log per call —
 * large enough to catch a burst (e.g. several hits in one tick) without
 * scanning the whole unbounded log every cycle. */
const RESOURCE_DELTA_SCAN_WINDOW = 200;

/** Same shape as `RESOURCE_DELTA_SCAN_WINDOW` over `readRecentConditionDeltas`
 * (K-B Part B). */
const CONDITION_DELTA_SCAN_WINDOW = 200;

/** Same shape as `RESOURCE_DELTA_SCAN_WINDOW` over `readRecentTraces`
 * (module header: `visible_trace` is already per-caller bounded by
 * perception, ADR-0040 — this is a defensive cap on a burst of several
 * traces landing in one tick, not a correctness-load-bearing filter). */
const TRACE_SCAN_WINDOW = 200;

export interface WorldEventBuilderOptions {
	/**
	 * Manipulate `action_id`s to watch for an appearance in the
	 * actor's own factored manipulation context (module header: no default vocabulary —
	 * empty/omitted means this kind never fires, matching every builder built
	 * before this option existed). A watched id fires `advancement_available`
	 * the moment it transitions from absent to present, and may fire again
	 * later if it disappears (the XP gate closing again, e.g. after the
	 * action is used) and later reappears (a further threshold crossing) —
	 * each transition is a discrete occurrence, same as every other kind this
	 * builder emits.
	 */
	watchedAdvancementActionIds?: readonly string[];
}

interface ReactionWindowSnapshotEntry {
	windowKind: "reaction" | "intervention";
	originatingActionId: string;
	originatingActor: string;
}

/**
 * Call-time diff builder over a companion tool context's live subscription
 * cache — the D-2 event-builder sibling of `createDeltaTracker`
 * (`delta-tracker.ts`). Same lazy `db`/`actorId` accessor shape, same
 * primed-exactly-once contract (D-5, extended here to D-2): a builder
 * recreated mid-session silently reports nothing new on its next call. `db`/
 * `actorId` are read lazily so a builder can be constructed before a host's
 * session connects, matching `createDeltaTracker`'s own rationale.
 */
export function createWorldEventBuilder(
	db: () => SnapshotDb,
	actorId: () => string | undefined,
	options: WorldEventBuilderOptions = {},
): WorldEventBuilder {
	const watchedAdvancementActionIds = options.watchedAdvancementActionIds ?? [];
	let primed = false;
	let openSessionId: string | null = null;
	let openSessionOpenedBy: string | null = null;
	let lastTurnKey: string | null = null; // `${sessionId}:${currentActor}`
	let lastTurnActor: string | null = null;
	let lastReactionWindows = new Map<string, ReactionWindowSnapshotEntry>();
	let seenResourceDeltaEventIds = new Set<string>();
	/** K-B Part B: same event_id dedupe discipline as
	 * `seenResourceDeltaEventIds`, shared across both `self_condition_changed`
	 * and `dealt_condition`. */
	let seenConditionDeltaEventIds = new Set<string>();
	let lastAdvancementActions = new Map<string, string>();
	let seenTextTraceIds = new Set<string>();
	let seenAddressedTraceIds = new Set<string>();
	let seenDepartureTraceIds = new Set<string>();

	function currentTick(currentDb: SnapshotDb): number {
		return readWorldStatus(currentDb)?.tick ?? 0;
	}

	function reactionSnapshot(
		currentDb: SnapshotDb,
		currentActorId: EntityRef,
	): Map<string, ReactionWindowSnapshotEntry> {
		const map = new Map<string, ReactionWindowSnapshotEntry>();
		for (const row of readReactionOptionsForActor(currentDb, currentActorId)) {
			map.set(String(row.pending_id), {
				windowKind: "reaction",
				originatingActionId: row.originating_action_id,
				originatingActor: row.originating_actor,
			});
		}
		for (const row of readInterventionWindowsForActor(currentDb, currentActorId)) {
			map.set(String(row.pending_id), {
				windowKind: "intervention",
				originatingActionId: row.originating_action_id,
				originatingActor: row.originating_actor,
			});
		}
		return map;
	}

	function ownNegativeResourceDeltaEventIds(
		currentDb: SnapshotDb,
		currentActorId: EntityRef,
	): Map<
		string,
		{
			resourceId: string;
			amount: number;
			newValue: number | undefined;
			templateId: string;
			attackerId: string | undefined;
		}
	> {
		const entityId = resolveEntityId(currentDb, currentActorId);
		const out = new Map<
			string,
			{
				resourceId: string;
				amount: number;
				newValue: number | undefined;
				templateId: string;
				attackerId: string | undefined;
			}
		>();
		if (entityId === undefined) return out;
		const entityIdText = String(entityId);
		for (const row of readRecentResourceDeltas(currentDb, RESOURCE_DELTA_SCAN_WINDOW)) {
			if (row.entity_id !== entityIdText || row.delta >= 0) continue;
			out.set(row.event_id, {
				resourceId: row.resource_id,
				amount: -row.delta,
				newValue: row.new_value,
				templateId: row.template_id,
				attackerId: row.source_entity_ref,
			});
		}
		return out;
	}

	/** Own-pool XP awards (claim-victory). Positive-only — a spend of XP is
	 * not a gain, and a foreign `xp_value` latch never matches this scan. */
	function ownXpGainEventIds(
		currentDb: SnapshotDb,
		currentActorId: EntityRef,
	): Map<string, { amount: number; newValue: number | undefined }> {
		const entityId = resolveEntityId(currentDb, currentActorId);
		const out = new Map<string, { amount: number; newValue: number | undefined }>();
		if (entityId === undefined) return out;
		const entityIdText = String(entityId);
		for (const row of readRecentResourceDeltas(currentDb, RESOURCE_DELTA_SCAN_WINDOW)) {
			if (row.entity_id !== entityIdText || row.delta <= 0) continue;
			if (!isOwnXpResource(row.resource_id)) continue;
			out.set(row.event_id, { amount: row.delta, newValue: row.new_value });
		}
		return out;
	}

	/** Negative deltas this actor CAUSED on another body's hit-point pool
	 * (sk-dms.29). Non-HP resources on another body — a corpse's XP-worth
	 * latch — are that body's sheet and stay off this channel (sk-0m4.15). */
	function dealtNegativeResourceDeltaEventIds(
		currentDb: SnapshotDb,
		currentActorId: EntityRef,
	): Map<string, { targetName: string; amount: number; attackerId: string | undefined }> {
		const entityId = resolveEntityId(currentDb, currentActorId);
		const out = new Map<
			string,
			{ targetName: string; amount: number; attackerId: string | undefined }
		>();
		if (entityId === undefined) return out;
		const entityIdText = String(entityId);
		const names = buildEntityNameMap(currentDb);
		for (const row of readRecentResourceDeltas(currentDb, RESOURCE_DELTA_SCAN_WINDOW)) {
			if (row.source_entity_ref !== entityIdText) continue;
			if (row.entity_id === entityIdText || row.delta >= 0) continue;
			if (!isHitPointResource(row.resource_id)) continue;
			out.set(row.event_id, {
				targetName: names.get(row.entity_id) || "them",
				amount: -row.delta,
				// Always `entityIdText` given the filter above (module header's
				// DealtHitEvent doc comment) — carried through the row rather than
				// hardcoded, matching self_hit's own discipline.
				attackerId: row.source_entity_ref,
			});
		}
		return out;
	}

	/** `event_condition_delta` rows on the connected actor's own body —
	 * K-B Part B, the {@link ownNegativeResourceDeltaEventIds} sibling for
	 * conditions. Both applies and removals ride the same
	 * `SelfConditionChangedEvent` kind (`applied` is the discriminator), so
	 * this scan (unlike the resource-delta pair above) makes no sign check. */
	function ownConditionDeltaEventIds(
		currentDb: SnapshotDb,
		currentActorId: EntityRef,
	): Map<string, { conditionId: string; applied: boolean; sourceEntityId: string | undefined }> {
		const entityId = resolveEntityId(currentDb, currentActorId);
		const out = new Map<
			string,
			{ conditionId: string; applied: boolean; sourceEntityId: string | undefined }
		>();
		if (entityId === undefined) return out;
		const entityIdText = String(entityId);
		for (const row of readRecentConditionDeltas(currentDb, CONDITION_DELTA_SCAN_WINDOW)) {
			if (row.entity_id !== entityIdText) continue;
			out.set(row.event_id, {
				conditionId: row.condition_definition_id,
				applied: row.applied,
				sourceEntityId: row.source_entity_ref,
			});
		}
		return out;
	}

	/** Condition changes this actor CAUSED on another body — the
	 * {@link dealtNegativeResourceDeltaEventIds} sibling for conditions. */
	function dealtConditionDeltaEventIds(
		currentDb: SnapshotDb,
		currentActorId: EntityRef,
	): Map<
		string,
		{
			targetName: string;
			conditionId: string;
			applied: boolean;
			sourceEntityId: string | undefined;
		}
	> {
		const entityId = resolveEntityId(currentDb, currentActorId);
		const out = new Map<
			string,
			{
				targetName: string;
				conditionId: string;
				applied: boolean;
				sourceEntityId: string | undefined;
			}
		>();
		if (entityId === undefined) return out;
		const entityIdText = String(entityId);
		const names = buildEntityNameMap(currentDb);
		for (const row of readRecentConditionDeltas(currentDb, CONDITION_DELTA_SCAN_WINDOW)) {
			if (row.source_entity_ref !== entityIdText) continue;
			if (row.entity_id === entityIdText) continue;
			out.set(row.event_id, {
				targetName: names.get(row.entity_id) || "them",
				conditionId: row.condition_definition_id,
				applied: row.applied,
				// Always `entityIdText` given the filter above (DealtConditionEvent's
				// own doc comment) — carried through the row rather than hardcoded,
				// matching dealt_hit's own discipline.
				sourceEntityId: row.source_entity_ref,
			});
		}
		return out;
	}

	/** Disclosed action descriptors among `watchedAdvancementActionIds` (module
	 * header: caller-named allow-list, empty by default), keyed by `action_id`.
	 * Target identity is deliberately irrelevant: authored advancement may be
	 * self-targeted or offered through a co-located trainer. Empty when the
	 * watch-list is empty, so this is a no-op scan for every builder built
	 * before this option existed. */
	function watchedAdvancementSnapshot(
		currentDb: SnapshotDb,
		currentActorId: EntityRef,
	): Map<string, string> {
		const map = new Map<string, string>();
		if (watchedAdvancementActionIds.length === 0) return map;
		const context = readManipulationContext(currentDb, currentActorId);
		if (context.status !== "ready") return map;
		for (const action of context.actions) {
			if (!watchedAdvancementActionIds.includes(action.action_id)) continue;
			map.set(action.action_id, action.display_name);
		}
		return map;
	}

	/** `readActiveSessionWithRosterForParticipant`/`readSessionParticipants`
	 * (unlike `readReactionOptionsForActor`/`readInterventionWindowsForActor`,
	 * which self-resolve) expect an already-RESOLVED numeric entity id string,
	 * not a manifest ref (`combat_session.ts`'s own `heroId =
	 * String(resolveEntityId(db, actorRef))` precedent) — resolved once per
	 * call and reused for every session-scoped domain below. */
	function resolvedEntityIdText(
		currentDb: SnapshotDb,
		currentActorId: EntityRef,
	): string | undefined {
		const resolved = resolveEntityId(currentDb, currentActorId);
		return resolved === undefined ? undefined : String(resolved);
	}

	/** Traces this actor currently perceives (module header: `readRecentTraces`'s
	 * own per-caller `visible_trace` bound, ADR-0040) whose payload carries a
	 * `text` key — keyed by `trace_id`, the same discriminator every other
	 * domain's snapshot uses. Content-agnostic by construction: no `row.kind`/
	 * `row.bundle_id` check, matching the module header's `carry_dispatch_text`
	 * framing. */
	function textCarryingTraceSnapshot(currentDb: SnapshotDb): Map<string, TraceRow> {
		const map = new Map<string, TraceRow>();
		for (const row of readRecentTraces(currentDb, TRACE_SCAN_WINDOW)) {
			if (!hasTextPayload(row.payload)) continue;
			map.set(row.trace_id, row);
		}
		return map;
	}

	/** The `speech_heard` snapshot's exact mirror for NON-text addressed rows:
	 * a payload object with a finite numeric `addressee` and no string `text`.
	 * The two snapshots partition the perceivable rows this builder reports —
	 * a row carrying both keys belongs to `textCarryingTraceSnapshot` only. */
	function addressedTraceSnapshot(currentDb: SnapshotDb): Map<string, TraceRow> {
		const map = new Map<string, TraceRow>();
		for (const row of readRecentTraces(currentDb, TRACE_SCAN_WINDOW)) {
			if (hasTextPayload(row.payload)) continue;
			if (!hasAddresseePayload(row.payload)) continue;
			map.set(row.trace_id, row);
		}
		return map;
	}

	/** The third and last snapshot of the trace family: a payload with neither
	 * `text` nor `addressee`, carrying a numeric `mover` and a string
	 * `via_place_edge_id` — a `core/departure` row. Ordered AFTER the other
	 * two on purpose (module header): the three predicates are applied in one
	 * fixed sequence so a row can land in at most one snapshot. */
	function departureTraceSnapshot(currentDb: SnapshotDb): Map<string, TraceRow> {
		const map = new Map<string, TraceRow>();
		for (const row of readRecentTraces(currentDb, TRACE_SCAN_WINDOW)) {
			if (hasTextPayload(row.payload)) continue;
			if (hasAddresseePayload(row.payload)) continue;
			if (!hasDeparturePayload(row.payload)) continue;
			map.set(row.trace_id, row);
		}
		return map;
	}

	function prime(): void {
		const currentDb = db();
		const rawActorId = actorId();
		if (rawActorId === undefined) {
			primed = true;
			return;
		}
		const currentActorId = asEntityRef(rawActorId);
		const entityIdText = resolvedEntityIdText(currentDb, currentActorId);
		const active =
			entityIdText === undefined
				? null
				: readActiveSessionWithRosterForParticipant(currentDb, entityIdText);
		openSessionId = active === null ? null : String(active.session.sessionId);
		openSessionOpenedBy = active === null ? null : active.session.openedBy;
		const turnState = readTurnState(currentDb);
		if (
			turnState !== null &&
			openSessionId !== null &&
			turnState.scope_session_id === openSessionId
		) {
			lastTurnKey = `${openSessionId}:${turnState.current_actor}`;
			lastTurnActor = turnState.current_actor;
		} else {
			lastTurnKey = null;
			lastTurnActor = null;
		}
		lastReactionWindows = reactionSnapshot(currentDb, currentActorId);
		seenResourceDeltaEventIds = new Set([
			...ownNegativeResourceDeltaEventIds(currentDb, currentActorId).keys(),
			...ownXpGainEventIds(currentDb, currentActorId).keys(),
		]);
		seenConditionDeltaEventIds = new Set(
			ownConditionDeltaEventIds(currentDb, currentActorId).keys(),
		);
		lastAdvancementActions = watchedAdvancementSnapshot(currentDb, currentActorId);
		seenTextTraceIds = new Set(textCarryingTraceSnapshot(currentDb).keys());
		seenAddressedTraceIds = new Set(addressedTraceSnapshot(currentDb).keys());
		seenDepartureTraceIds = new Set(departureTraceSnapshot(currentDb).keys());
		primed = true;
	}

	// sk-0m4.73: events a prior `takeWhere` call left unmatched. Prepended,
	// oldest-first, ahead of whatever the next `diffAndAdvance`/`takeWhere`
	// call newly observes — the single buffer that makes "delivered exactly
	// once" true across both entry points (see `WorldEventBuilder`'s doc
	// comment).
	let carry: WorldEvent[] = [];

	/** The unbuffered diff-and-advance step both `diffAndAdvance` and
	 * `takeWhere` share. The carry handling lives in the two public entry
	 * points. Push order of one drain: `session_lifecycle` opened ->
	 * `turn_transition` -> `reaction_window` -> the resource and condition
	 * delta kinds, sorted together oldest-first by event id ->
	 * `advancement_available` -> the trace kinds (reader order) ->
	 * `session_lifecycle` closed, always last (module header). */
	function computeNewEvents(): WorldEvent[] {
		if (!primed) {
			prime();
			return [];
		}

		const rawActorId = actorId();
		if (rawActorId === undefined) return [];
		const currentActorId = asEntityRef(rawActorId);
		const currentDb = db();
		const tick = currentTick(currentDb);
		const events: WorldEvent[] = [];
		// A session that closed in this drain. The state is forgotten at once
		// (below), but the event itself is pushed LAST: whatever ended the
		// session — the killing blow, the experience award — is told first.
		let deferredClosed: WorldEvent | undefined;

		// --- session_lifecycle ---
		const entityIdText = resolvedEntityIdText(currentDb, currentActorId);
		const active =
			entityIdText === undefined
				? null
				: readActiveSessionWithRosterForParticipant(currentDb, entityIdText);
		const activeSessionId = active === null ? null : String(active.session.sessionId);
		if (activeSessionId !== null && activeSessionId !== openSessionId) {
			events.push({
				kind: "session_lifecycle",
				session_id: activeSessionId,
				phase: "opened",
				participants: active === null ? [] : active.participants.map((p) => p.actorId),
				opened_by: active === null ? "" : active.session.openedBy,
				observed_at_tick: tick,
			});
			openSessionId = activeSessionId;
			openSessionOpenedBy = active === null ? null : active.session.openedBy;
		} else if (activeSessionId === null && openSessionId !== null) {
			deferredClosed = {
				kind: "session_lifecycle",
				session_id: openSessionId,
				phase: "closed",
				participants: [],
				opened_by: openSessionOpenedBy ?? "",
				observed_at_tick: tick,
			};
			openSessionId = null;
			openSessionOpenedBy = null;
			lastTurnKey = null;
			lastTurnActor = null;
		}

		// --- turn_transition (turn_state singleton, D-6). `openSessionId` is
		// already scoped to a session this actor is a roster participant of
		// (established just above via `readActiveSessionWithRosterForParticipant`),
		// so matching `turn_state.scope_session_id` against it is sufficient —
		// no second participant-membership read needed. ---
		if (openSessionId !== null) {
			const turnState = readTurnState(currentDb);
			if (turnState !== null && turnState.scope_session_id === openSessionId) {
				const turnKey = `${openSessionId}:${turnState.current_actor}`;
				if (turnKey !== lastTurnKey) {
					events.push({
						kind: "turn_transition",
						session_id: openSessionId,
						from_actor: lastTurnActor,
						to_actor: turnState.current_actor,
						observed_at_tick: tick,
					});
					lastTurnKey = turnKey;
					lastTurnActor = turnState.current_actor;
				}
			}
		}

		// --- reaction_window (opened / closed) ---
		const nextReactionWindows = reactionSnapshot(currentDb, currentActorId);
		for (const [pendingId, entry] of nextReactionWindows) {
			if (lastReactionWindows.has(pendingId)) continue;
			events.push({
				kind: "reaction_window",
				window_kind: entry.windowKind,
				phase: "opened",
				pending_id: pendingId,
				originating_action_id: entry.originatingActionId,
				originating_actor: entry.originatingActor,
				observed_at_tick: tick,
			});
		}
		for (const [pendingId, entry] of lastReactionWindows) {
			if (nextReactionWindows.has(pendingId)) continue;
			events.push({
				kind: "reaction_window",
				window_kind: entry.windowKind,
				phase: "closed",
				pending_id: pendingId,
				originating_action_id: entry.originatingActionId,
				originating_actor: entry.originatingActor,
				observed_at_tick: tick,
			});
		}
		lastReactionWindows = nextReactionWindows;

		// --- self_hit / self_resource_spent / xp_gained / dealt_hit
		// (semantic dedupe by event_id — never row/handle identity,
		// matching `delta-tracker.ts`'s own fingerprint discipline).
		// Classification is the resource STEM, never a bundle prefix:
		// hp/temp_hp stay combat hits; own `xp` gains are awards; every
		// other own negative delta is a spend. A foreign `xp_value`
		// latch is another body's sheet and is never pushed (sk-0m4.15).
		//
		// A spend is only a spend when its source is the actor: an own
		// non-hit-point delta whose `source_entity_ref` names ANOTHER entity (a
		// DM sheet write, a drain) is not pushed at all. An empty source and the
		// actor's own id keep the event. `self_hit` is never filtered this way.
		// The source is the frame's `Actor` binding, which a
		// `ForEachActorInRadius` body rebinds to each target: a radius-applied
		// delta reads as self-caused here and stays.
		//
		// Nothing here is pushed directly. Resource and condition events of
		// one drain are collected, then sorted together oldest-first by event
		// id (module header) — the two logs draw from one id space. ---
		const deltaEvents: Array<{ eventId: string; order: number; event: WorldEvent }> = [];
		const collect = (eventId: string, event: WorldEvent): void => {
			deltaEvents.push({ eventId, order: deltaEvents.length, event });
		};
		// Resolved at most once per drain, and only when a new `self_hit`
		// carries an attacker other than the actor.
		let entityNames: Map<string, string> | undefined;
		const attackerNameOf = (attackerId: string | undefined): string | undefined => {
			if (attackerId === undefined || attackerId === entityIdText) return undefined;
			entityNames ??= buildEntityNameMap(currentDb);
			const name = entityNames.get(attackerId);
			return name === undefined || name.length === 0 ? undefined : name;
		};
		const nextDeltas = ownNegativeResourceDeltaEventIds(currentDb, currentActorId);
		const nextXpGains = ownXpGainEventIds(currentDb, currentActorId);
		const nextDealt = dealtNegativeResourceDeltaEventIds(currentDb, currentActorId);
		const nextSeen = new Set<string>();
		for (const [eventId, delta] of nextDeltas) {
			nextSeen.add(eventId);
			if (seenResourceDeltaEventIds.has(eventId)) continue;
			if (isHitPointResource(delta.resourceId)) {
				const attackerName = attackerNameOf(delta.attackerId);
				collect(eventId, {
					kind: "self_hit",
					resource_id: delta.resourceId,
					amount: delta.amount,
					new_value: delta.newValue,
					attack_kind: delta.templateId,
					// ADR-0093 B2: populated from `event_resource_delta.source_entity_ref`
					// when the server attributed one; `null` only for a genuinely
					// ambient/ownerless delta (module header).
					attacker_id: delta.attackerId ?? null,
					...(attackerName !== undefined ? { attacker_name: attackerName } : {}),
					observed_at_tick: tick,
				});
			} else {
				// Caused by another entity: not this actor's spend. Skipped AFTER
				// the seen-set insert above, so it is never reconsidered.
				if (
					delta.attackerId !== undefined &&
					entityIdText !== undefined &&
					delta.attackerId !== entityIdText
				) {
					continue;
				}
				collect(eventId, {
					kind: "self_resource_spent",
					resource_id: delta.resourceId,
					amount: delta.amount,
					new_value: delta.newValue,
					source: delta.templateId,
					observed_at_tick: tick,
				});
			}
		}
		for (const [eventId, gain] of nextXpGains) {
			nextSeen.add(eventId);
			if (seenResourceDeltaEventIds.has(eventId)) continue;
			collect(eventId, {
				kind: "xp_gained",
				amount: gain.amount,
				new_value: gain.newValue,
				observed_at_tick: tick,
			});
		}
		for (const [eventId, dealt] of nextDealt) {
			nextSeen.add(eventId);
			if (seenResourceDeltaEventIds.has(eventId)) continue;
			collect(eventId, {
				kind: "dealt_hit",
				target_name: dealt.targetName,
				amount: dealt.amount,
				attacker_id: dealt.attackerId ?? null,
				observed_at_tick: tick,
			});
		}
		seenResourceDeltaEventIds = nextSeen;

		// --- self_condition_changed / dealt_condition (K-B Part B — same
		// semantic dedupe-by-event_id discipline as the resource-delta block
		// above, in its own Set since a condition_delta event_id and a
		// resource_delta event_id are drawn from the same world_event id
		// space and must not collide in one shared Set). ---
		const nextConditionChanges = ownConditionDeltaEventIds(currentDb, currentActorId);
		const nextDealtConditions = dealtConditionDeltaEventIds(currentDb, currentActorId);
		const nextConditionSeen = new Set<string>();
		for (const [eventId, change] of nextConditionChanges) {
			nextConditionSeen.add(eventId);
			if (seenConditionDeltaEventIds.has(eventId)) continue;
			collect(eventId, {
				kind: "self_condition_changed",
				condition_id: change.conditionId,
				applied: change.applied,
				source_entity_id: change.sourceEntityId ?? null,
				observed_at_tick: tick,
			});
		}
		for (const [eventId, dealt] of nextDealtConditions) {
			nextConditionSeen.add(eventId);
			if (seenConditionDeltaEventIds.has(eventId)) continue;
			collect(eventId, {
				kind: "dealt_condition",
				target_name: dealt.targetName,
				condition_id: dealt.conditionId,
				applied: dealt.applied,
				source_entity_id: dealt.sourceEntityId ?? null,
				observed_at_tick: tick,
			});
		}
		seenConditionDeltaEventIds = nextConditionSeen;

		// Oldest-first by event id, with the SAME numeric-aware comparator the
		// readers sort by (inverted). Ids are compared as text on purpose: a
		// host may hand over non-numeric ids. Equal ids (one resource row and
		// one condition row of the same world event) keep collection order.
		deltaEvents.sort(
			(a, b) =>
				a.eventId.localeCompare(b.eventId, undefined, { numeric: true }) || a.order - b.order,
		);
		for (const entry of deltaEvents) events.push(entry.event);

		// --- advancement_available (watched factored manipulation action,
		// absent -> present; module header + `watchedAdvancementSnapshot`) ---
		const nextAdvancementActions = watchedAdvancementSnapshot(currentDb, currentActorId);
		for (const [actionId, displayName] of nextAdvancementActions) {
			if (lastAdvancementActions.has(actionId)) continue;
			events.push({
				kind: "advancement_available",
				action_id: actionId,
				display_name: displayName,
				observed_at_tick: tick,
			});
		}
		lastAdvancementActions = nextAdvancementActions;

		// --- speech_heard (a NEW text-carrying trace becomes perceivable;
		// semantic dedupe by trace_id, same discipline as self_hit's
		// event_id dedupe — a trace that stays visible across calls is never
		// re-reported) ---
		const nextTextTraces = textCarryingTraceSnapshot(currentDb);
		const nextSeenTraceIds = new Set<string>();
		// Resolved at most once per drain, and only if a new trace actually
		// needs a speaker name — most drains carry none.
		const hearerActorId = currentActorId;
		let perceivedNames: Map<string, string> | undefined;
		const nameOf = (entityId: string | null): string | null => {
			if (entityId === null) return null;
			perceivedNames ??= perceivedActorNames(currentDb, hearerActorId, entityIdText);
			const name = perceivedNames.get(entityId);
			return name === undefined || name.length === 0 ? null : name;
		};
		for (const [traceId, row] of nextTextTraces) {
			nextSeenTraceIds.add(traceId);
			if (seenTextTraceIds.has(traceId)) continue;
			// sk-dms.17: the actor's OWN utterance is not world news. The
			// discriminator here is structural (a new text-carrying row in the
			// actor's own `visible_trace`) and therefore also matches what the
			// actor just said itself — but the act's own result already echoes
			// that back (`conversation.spoken_by_player`), and the 🌍 register is
			// the world speaking, not the actor. Skipped AFTER the seen-set
			// insert above, so it is never re-considered on a later drain.
			if (
				row.inscribed_by !== null &&
				entityIdText !== undefined &&
				row.inscribed_by === entityIdText
			) {
				continue;
			}
			const payload = row.payload as { text: string; action_id?: unknown; addressee?: unknown };
			const actionId =
				typeof payload.action_id === "string" && payload.action_id.length > 0
					? payload.action_id
					: undefined;
			// `srd/speech`'s schema (`speech-and-traces.md`) declares `addressee`
			// as an optional integer — present only on addressee-anchored chains
			// (`srd/speak-to`, telepathy), absent on broadcast/self-shaped speech.
			// A present-but-non-finite value is treated the same as absent rather
			// than surfaced as a bogus id.
			const addressee =
				typeof payload.addressee === "number" && Number.isFinite(payload.addressee)
					? payload.addressee
					: undefined;
			events.push({
				kind: "speech_heard",
				trace_id: traceId,
				trace_kind: row.kind,
				// `hasTextPayload` already narrowed `row.payload` to `{ text: string }`
				// at snapshot time; re-asserted here since the Map value type is
				// the wider `TraceRow`.
				text: payload.text,
				...(actionId !== undefined ? { action_id: actionId } : {}),
				...(row.response === undefined ? {} : { response: row.response }),
				inscribed_by: row.inscribed_by,
				inscribed_by_name: nameOf(row.inscribed_by),
				// Same epistemics as `inscribed_by_name`: a name only when the
				// hearer currently perceives the addressee (`nameOf` is the SAME
				// scene-projection lookup, just keyed by the addressee's id).
				...(addressee !== undefined
					? { addressee, addressee_name: nameOf(String(addressee)) }
					: {}),
				inscribed_at: row.inscribed_at,
				location_kind: row.location_kind,
				location_ref: row.location_ref,
				observed_at_tick: tick,
			});
		}
		seenTextTraceIds = nextSeenTraceIds;

		// --- trace_addressed (a NEW addressed non-text trace becomes
		// perceivable) — the same dedupe, the same own-inscription skip, and
		// the same `nameOf` epistemics as speech_heard above. ---
		const nextAddressedTraces = addressedTraceSnapshot(currentDb);
		const nextSeenAddressedIds = new Set<string>();
		for (const [traceId, row] of nextAddressedTraces) {
			nextSeenAddressedIds.add(traceId);
			if (seenAddressedTraceIds.has(traceId)) continue;
			// Same sk-dms.17 rule as speech_heard: the actor's own inscription
			// is not world news, skipped AFTER the seen-set insert so it is
			// never reconsidered on a later drain.
			if (
				row.inscribed_by !== null &&
				entityIdText !== undefined &&
				row.inscribed_by === entityIdText
			) {
				continue;
			}
			const payload = row.payload as Record<string, unknown>;
			const addressee = payload.addressee as number;
			// sk-jay0.1.8.63.40: `label` is the one well-known, generic payload
			// key this builder reads out of an otherwise payload-blind trace
			// (`@spellkave/world-events`'s `TraceAddressedEvent.label` doc
			// comment) — extracted the same defensive way `speech_heard`'s
			// `action_id` already is, just above. `addressed_at_self` is a
			// structural id comparison, never a payload read: this actor IS the
			// addressee exactly when the resolved current-actor id matches.
			const label =
				typeof payload.label === "string" && payload.label.length > 0 ? payload.label : undefined;
			events.push({
				kind: "trace_addressed",
				trace_id: traceId,
				trace_kind: row.kind,
				payload,
				inscribed_by: row.inscribed_by,
				inscribed_by_name: nameOf(row.inscribed_by),
				inscribed_at: row.inscribed_at,
				addressee,
				addressee_name: nameOf(String(addressee)),
				addressed_at_self: entityIdText !== undefined && String(addressee) === entityIdText,
				...(label !== undefined ? { label } : {}),
				location_kind: row.location_kind,
				location_ref: row.location_ref,
				observed_at_tick: tick,
			});
		}
		seenAddressedTraceIds = nextSeenAddressedIds;

		// --- trace_departure (a NEW departure trace becomes perceivable) —
		// the same dedupe, the same own-inscription skip, and the same
		// `nameOf` epistemics as the two kinds above. The mover's name is a
		// name only when this actor can still perceive them, which after a
		// departure is usually not the case: `null` is the ordinary reading
		// here, not a failure. ---
		const nextDepartureTraces = departureTraceSnapshot(currentDb);
		const nextSeenDepartureIds = new Set<string>();
		for (const [traceId, row] of nextDepartureTraces) {
			nextSeenDepartureIds.add(traceId);
			if (seenDepartureTraceIds.has(traceId)) continue;
			// Same sk-dms.17 rule: an actor's own departure is not world news
			// to itself, skipped AFTER the seen-set insert. (The kernel also
			// declines to record the mover as a perceiver of its own trace, so
			// this is a second, independent guard rather than the only one.)
			if (
				row.inscribed_by !== null &&
				entityIdText !== undefined &&
				row.inscribed_by === entityIdText
			) {
				continue;
			}
			const payload = row.payload as {
				mover: number;
				via_place_edge_id: string;
				exit_label?: unknown;
			};
			events.push({
				kind: "trace_departure",
				trace_id: traceId,
				trace_kind: row.kind,
				mover: payload.mover,
				mover_name: nameOf(String(payload.mover)),
				from_place_node_id: row.location_ref,
				via_place_edge_id: payload.via_place_edge_id,
				// Payload-declared but not part of the discriminator: an
				// absent or non-string label reads as "no label", never as a
				// stringified object.
				exit_label: typeof payload.exit_label === "string" ? payload.exit_label : "",
				inscribed_at: row.inscribed_at,
				location_kind: row.location_kind,
				location_ref: row.location_ref,
				observed_at_tick: tick,
			});
		}
		seenDepartureTraceIds = nextSeenDepartureIds;

		if (deferredClosed !== undefined) events.push(deferredClosed);
		return events;
	}

	return {
		diffAndAdvance(): WorldEvent[] {
			const fresh = computeNewEvents();
			if (carry.length === 0) return fresh;
			const combined = [...carry, ...fresh];
			carry = [];
			return combined;
		},
		takeWhere(predicate: (event: WorldEvent) => boolean): WorldEvent[] {
			const fresh = computeNewEvents();
			const combined = carry.length === 0 ? fresh : [...carry, ...fresh];
			const matched: WorldEvent[] = [];
			const unmatched: WorldEvent[] = [];
			for (const event of combined) {
				if (predicate(event)) matched.push(event);
				else unmatched.push(event);
			}
			carry = unmatched;
			return matched;
		},
	};
}

/**
 * sk-0m4.74: the CONSEQUENCE predicate — a `WorldEvent` this actor's OWN act
 * deterministically caused, in the SAME reducer transaction as that act, as
 * opposed to an Outcome (the reducer's own `receipt`/`observation`, already
 * returned synchronously by the dispatching tool) or a Reaction (another
 * agent's later action, e.g. a bounded `communicate` reply window,
 * sk-0m4.73). Callers take with `builder.takeWhere((e) =>
 * isCausedByActor(e, actorEntityId, tick))` right after a successful dispatch
 * — never on a rejected/unobserved one, since nothing was caused.
 *
 * `actorEntityId` is the RESOLVED entity id string (module header's
 * `resolveEntityId` discipline — `attacker_id`/`originating_actor`/
 * `participants` are all resolved entity ids, never a manifest actor ref).
 * `tick` is the act's own tick; when the caller cannot cheaply learn that
 * (this bead's assumption, `tools.ts`'s `takeConsequences`), the CURRENT
 * tick read from the db right after the outcome stands in for it — correct
 * under ordinary turn-based single-actor-per-transaction semantics, where
 * "what changed in this tick, for this actor" and "what my just-dispatched
 * act changed" coincide.
 *
 * Gated to `event.observed_at_tick === tick` for EVERY kind — same-tick
 * alone is not sufficient for a kind another actor can also cause (a
 * same-tick `self_hit` from someone else's attack), so every arm below
 * layers a same-actor check on top; the kinds this predicate NEVER accepts
 * (`self_hit`, `turn_transition`, `speech_heard`, `advancement_available`,
 * a `reaction_window`/`session_lifecycle` `"closed"` phase) stay honest
 * pushes even at the right tick, because tick alone cannot attribute them to
 * THIS actor's own act (module header's "loss is impossible" carry
 * semantics: whatever this predicate rejects is never dropped, only
 * buffered for a later `pushes` drain).
 *
 * - `dealt_hit`: `attacker_id === actorEntityId` — in practice always true
 *   for THIS actor's own builder (see {@link DealtHitEvent}'s doc comment),
 *   kept explicit rather than assumed.
 * - `dealt_condition`: `source_entity_id === actorEntityId` — same shape as
 *   `dealt_hit`, one level removed (a condition applied/removed instead of
 *   a resource delta). `self_condition_changed` is NEVER accepted (like
 *   `self_hit`): a same-tick condition change on this actor's OWN body can
 *   just as easily be another actor's attack landing a status effect.
 * - `self_resource_spent` / `xp_gained`: both are already scoped to the
 *   CONNECTED actor's own pool by construction (every other actor's pool
 *   changes are invisible to this builder) — no further identity check
 *   needed, only the tick gate. Since 2026-11-12 the builder does not emit
 *   a `self_resource_spent` another entity caused, so such a change is
 *   neither a consequence nor a push.
 * - `reaction_window`, `phase === "opened"`: `originating_actor ===
 *   actorEntityId` — a window THIS actor's own act just opened (for itself
 *   or another eligible reactor), not one another actor's act opened that
 *   merely happens to list this actor as reactor.
 * - `session_lifecycle`, `phase === "opened"`: `opened_by ===
 *   actorEntityId` — this actor's own act opened the session, not a session
 *   another actor's act opened that this actor was merely seated into.
 */
export function isCausedByActor(event: WorldEvent, actorEntityId: string, tick: number): boolean {
	return runtimeIsCausedByActor(event, actorEntityId, tick);
}

/**
 * Entity id -> perceived display name for every actor CO-LOCATED with the
 * hearer. Deliberately the scene projection and nothing wider: `readCurrentScene`
 * is already the perception-gated surface the player's own `spellkave_scene`
 * reads, so a name reaches an event only when the hearer could have seen whose
 * mouth it came out of. A raw `actor`-table lookup would name speakers the
 * hearer has never perceived. `self_hit` does not hold that line: its
 * `attacker_id` and `attacker_name` are disclosed ungated, and suppression is
 * the deferred ADR-0082 D-6 item (module header, T29).
 */
function perceivedActorNames(
	db: SnapshotDb,
	actorId: EntityRef,
	entityIdText: string | undefined,
): Map<string, string> {
	const names = new Map<string, string>();
	const scene = readCurrentScene(db, actorId);
	if (scene !== null) {
		for (const target of scene.targets) {
			if (target.kind !== "actor") continue;
			const name = target.detail.name;
			if (typeof name === "string" && name.length > 0) names.set(String(target.id), name);
		}
	}
	// The one widening: the roster of the hearer's OWN active session. On a
	// tactical grid every participant stands on a cell of its own, so nobody
	// is "co-located" and the scene names no one — the creature shooting at
	// the hearer from two cells away read as "an unseen figure" (seen live,
	// sk-jay0.1.8.63.40). `visible_session_participant` is already
	// participant-scoped, and `spellkave_session_status` already tells this
	// same actor these same names, so this names nobody the hearer has not
	// been shown. Co-located names win; the roster only fills the gaps.
	const mine =
		entityIdText === undefined ? null : readActiveSessionWithRosterForParticipant(db, entityIdText);
	if (mine !== null) {
		const entityNames = buildEntityNameMap(db);
		for (const participant of mine.participants) {
			if (names.has(participant.actorId) || participant.actorId === entityIdText) continue;
			const name = entityNames.get(participant.actorId);
			if (name !== undefined && name.length > 0) names.set(participant.actorId, name);
		}
	}
	return names;
}

/** Type guard: `payload` is a JSON object carrying a string `text` key — the
 * kernel-level `carry_dispatch_text` discriminator (ADR-0021), never a
 * `kind`/`bundle_id` check (module header). */
function hasTextPayload(payload: unknown): payload is { text: string } {
	return (
		payload !== null &&
		typeof payload === "object" &&
		typeof (payload as { text?: unknown }).text === "string"
	);
}

/** Type guard: `payload` is a JSON object carrying a finite numeric `mover`
 * AND a string `via_place_edge_id` — the kernel-written structural keys of a
 * `core/departure` row, the third sibling of `hasTextPayload` /
 * `hasAddresseePayload`. BOTH keys are required: one alone is not this
 * contract, and a payload that merely happens to name a mover must not be
 * reported as a departure with an empty exit. */
function hasDeparturePayload(
	payload: unknown,
): payload is { mover: number; via_place_edge_id: string } {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
	const { mover, via_place_edge_id: edge } = payload as {
		mover?: unknown;
		via_place_edge_id?: unknown;
	};
	return typeof mover === "number" && Number.isFinite(mover) && typeof edge === "string";
}

/** Type guard: `payload` is a JSON object carrying a finite numeric
 * `addressee` key — the kernel-level `carry_addressee` discriminator, the
 * structural sibling of `hasTextPayload`. A present-but-non-finite value is
 * treated as absent rather than surfaced as a bogus id. Arrays are rejected:
 * an inscribed payload is an object or it is not this contract. */
function hasAddresseePayload(payload: unknown): payload is { addressee: number } {
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return false;
	const addressee = (payload as { addressee?: unknown }).addressee;
	return typeof addressee === "number" && Number.isFinite(addressee);
}
