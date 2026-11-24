/**
 * Browser-safe vocabulary for host-observed world consequences (ADR-0093
 * D-2). This closed union is a delivery protocol over already-authorized host
 * projections, not a gameplay or authoring vocabulary: event producers remain
 * responsible for perception and row admission, while this package owns one
 * exhaustive portable result/renderer shape.
 *
 * Zero runtime dependencies so both `@spellkave/sdk` and
 * `@spellkave/tool-runtime` can import it without inverting their graph.
 */
export interface SessionLifecycleEvent {
	kind: "session_lifecycle";
	session_id: string;
	phase: "opened" | "closed";
	participants: string[];
	opened_by: string;
	observed_at_tick: number;
}

export interface TurnTransitionEvent {
	kind: "turn_transition";
	session_id: string;
	from_actor: string | null;
	to_actor: string;
	observed_at_tick: number;
}

export interface SelfHitEvent {
	kind: "self_hit";
	resource_id: string;
	amount: number;
	new_value?: number;
	attack_kind: string;
	attacker_id: string | null;
	/**
	 * The attacker's name, resolved by the producer when the event is emitted,
	 * from the same name source `dealt_hit.target_name` uses. Optional and
	 * additive: the key is ABSENT when the producer resolved no name, when
	 * `attacker_id` is `null`, and when the attacker is this actor itself.
	 * Never an id and never a placeholder.
	 */
	attacker_name?: string;
	observed_at_tick: number;
}

export interface DealtHitEvent {
	kind: "dealt_hit";
	target_name: string;
	amount: number;
	attacker_id: string | null;
	observed_at_tick: number;
}

export interface SelfConditionChangedEvent {
	kind: "self_condition_changed";
	condition_id: string;
	applied: boolean;
	source_entity_id: string | null;
	observed_at_tick: number;
}

export interface DealtConditionEvent {
	kind: "dealt_condition";
	target_name: string;
	condition_id: string;
	applied: boolean;
	source_entity_id: string | null;
	observed_at_tick: number;
}

export interface XpGainedEvent {
	kind: "xp_gained";
	amount: number;
	new_value?: number;
	observed_at_tick: number;
}

/**
 * This actor's own pool went down and the actor caused it (or nobody is named
 * as the cause). A change another entity caused on this actor's pool is not a
 * spend and the producer does not emit it.
 */
export interface SelfResourceSpentEvent {
	kind: "self_resource_spent";
	resource_id: string;
	amount: number;
	new_value?: number;
	source: string;
	observed_at_tick: number;
}

export interface ReactionWindowEvent {
	kind: "reaction_window";
	window_kind: "reaction" | "intervention";
	phase: "opened" | "closed";
	pending_id: string;
	originating_action_id: string;
	originating_actor: string;
	observed_at_tick: number;
}

export interface AdvancementAvailableEvent {
	kind: "advancement_available";
	action_id: string;
	display_name: string;
	observed_at_tick: number;
}

export interface SpeechHeardEvent {
	kind: "speech_heard";
	trace_id: string;
	trace_kind: string;
	text: string;
	action_id?: string;
	/** Optional causal response history, disclosed from visible occurrence facts. */
	response?: { action_id: string; slot: number; occurrence_id?: string; label?: string };
	/**
	 * The tick the trace was INSCRIBED, straight off the row — never the tick
	 * the hearer observed it (`observed_at_tick`). The two differ whenever a
	 * drain lags behind the world clock, so an age rule that wants "how old is
	 * this utterance" must read this field.
	 */
	inscribed_at: number;
	inscribed_by: string | null;
	/**
	 * A name only when the hearer can currently perceive the speaker. A known
	 * raw id without a perceivable name stays anonymous in the renderer.
	 */
	inscribed_by_name: string | null;
	/**
	 * The entity id this trace's payload named as addressee (`srd/speak-to`'s
	 * `carry_addressee` — payload only, never routing: an addressed hearer
	 * perceives this the same as anyone else at the anchor,
	 * `directed-speech-anchor.md`). `undefined` when the underlying speech
	 * carried no addressee at all (broadcast/self-shaped speech, e.g.
	 * `srd/speak-aloud`) — a genuinely absent key, not a known-but-unaddressed
	 * `null`.
	 */
	addressee?: number | null;
	/**
	 * A name only when the hearer can currently perceive the addressee — same
	 * "honest absence, never fabricated" rule as `inscribed_by_name`. Present
	 * (possibly `null`) exactly when `addressee` is present.
	 */
	addressee_name?: string | null;
	location_kind: string;
	location_ref: string;
	observed_at_tick: number;
}

export interface TraceAddressedEvent {
	kind: "trace_addressed";
	trace_id: string;
	/** The authored trace kind, carried verbatim. Consumers that care about a
	 *  specific vocabulary match on this; this package never does. */
	trace_kind: string;
	/**
	 * The payload as inscribed. Always includes `addressee`; never includes a
	 * string `text` (such rows are `speech_heard`).
	 */
	payload: Readonly<Record<string, unknown>>;
	inscribed_by: string | null;
	/**
	 * A name only when this actor can currently perceive the inscriber. Same
	 * "honest absence, never fabricated" rule as `SpeechHeardEvent`.
	 */
	inscribed_by_name: string | null;
	/**
	 * The tick the trace was INSCRIBED. Never conflate with
	 * `observed_at_tick`: an age or staleness rule reads this field, because
	 * observation can lag inscription by an unbounded number of ticks.
	 */
	inscribed_at: number;
	/** The entity id the payload named as addressee (payload, not routing). */
	addressee: number;
	/** A name only when this actor can currently perceive the addressee. */
	addressee_name: string | null;
	/**
	 * True when THIS actor — the one this event was built for — IS the
	 * addressee (`addressee` resolves to the drain's own connected actor).
	 * Structural: derived by the producer from comparing ids, never read out
	 * of the payload. The renderer below reads this instead of
	 * `addressee_name` so a trace directed at the perceiving actor reads
	 * "…you" rather than reflecting their own third-person name back at them
	 * (sk-jay0.1.8.63.40 — a gap `SpeechHeardEvent`'s `addressee_name` still
	 * carries, out of scope here).
	 */
	addressed_at_self: boolean;
	/**
	 * An optional authored display string from the payload's `label` key —
	 * the ONE well-known, generic key this otherwise payload-blind event
	 * reads, the same "one deliberate escape hatch" idiom
	 * `AdvancementAvailableEvent.display_name` already uses. A bundle opts
	 * into a legible line by inscribing a fixed, non-SRD-specific string here
	 * (e.g. an action's own display name plus its outcome, "Ranged Attack
	 * misses") — every OTHER payload key stays unread by this renderer
	 * (module header's PAYLOAD-BLIND rule, unchanged for anything but this
	 * key). `undefined` when the payload carried no string `label` — never
	 * fabricated, and the renderer falls back to the generic `trace_kind`
	 * line below.
	 */
	label?: string;
	location_kind: string;
	location_ref: string;
	observed_at_tick: number;
}

export interface TraceDepartureEvent {
	kind: "trace_departure";
	trace_id: string;
	/** The authored trace kind, carried verbatim. Consumers that care about a
	 *  specific vocabulary match on this; this package never does. */
	trace_kind: string;
	/** Entity id of the body that left (payload `mover`). */
	mover: number;
	/**
	 * A name only when this actor can currently perceive the mover — the same
	 * "honest absence, never fabricated" rule as `SpeechHeardEvent`'s
	 * `inscribed_by_name`. A body that walked out of sight is often exactly
	 * the case where this is `null`.
	 */
	mover_name: string | null;
	/** The node the departure was inscribed at — the node LEFT. Equal to
	 *  `location_ref`, named for the consumer that reads it as a place. */
	from_place_node_id: string;
	/** The place edge taken, as the payload's opaque string handle. */
	via_place_edge_id: string;
	/** The exit's label as the kernel knew it (a pose-derived direction).
	 *  Empty string when the world could not derive one. */
	exit_label: string;
	/**
	 * The tick the trace was INSCRIBED. Never conflate with
	 * `observed_at_tick`: a trail perceived on arrival can be several ticks
	 * old, and a staleness or ordering rule must read this field.
	 */
	inscribed_at: number;
	location_kind: string;
	location_ref: string;
	observed_at_tick: number;
}

export type WorldEvent =
	| SessionLifecycleEvent
	| TurnTransitionEvent
	| SelfHitEvent
	| DealtHitEvent
	| XpGainedEvent
	| SelfResourceSpentEvent
	| ReactionWindowEvent
	| AdvancementAvailableEvent
	| SpeechHeardEvent
	| TraceAddressedEvent
	| TraceDepartureEvent
	| SelfConditionChangedEvent
	| DealtConditionEvent;

/** The single serialized delta source supplied by an SDK-owning host. */
export interface WorldEventDeltaSource {
	takeWhere(predicate: (event: WorldEvent) => boolean): WorldEvent[];
}

/** Compatibility-friendly name for a host's event-delta source. */
export type WorldEventSource = WorldEventDeltaSource;

/**
 * Single-consumer cursor over derived world events. `takeWhere` and
 * `diffAndAdvance` compete for the same sequence: an event flows through
 * exactly once.
 */
export interface WorldEventBuilder extends WorldEventDeltaSource {
	diffAndAdvance(): WorldEvent[];
	takeWhere(predicate: (event: WorldEvent) => boolean): WorldEvent[];
}

/** Runtime-facing capability port for collecting events caused by one call. */
export interface WorldEventCoordinatorPort {
	source: WorldEventDeltaSource;
	actorEntityId: string;
	tick: number;
}

/**
 * Take each matching event exactly once from the host source. The source owns
 * subscriptions and buffering; the runtime owns common attribution and result
 * shaping without importing the SDK or a transport.
 */
export function collectConsequences(port: WorldEventCoordinatorPort): WorldEvent[] {
	return port.source.takeWhere((event) => isCausedByActor(event, port.actorEntityId, port.tick));
}

/** Add the stable `consequences` result field only when a host wired a port. */
export function shapeConsequences<TResult extends object>(
	result: TResult,
	port: WorldEventCoordinatorPort | undefined,
): TResult | (TResult & { consequences: WorldEvent[] }) {
	return port === undefined ? result : { ...result, consequences: collectConsequences(port) };
}

export function isCausedByActor(event: WorldEvent, actorEntityId: string, tick: number): boolean {
	// Attribution is deliberately stricter than temporal coincidence. Own-body
	// observations, heard speech, turn changes, and newly visible affordances
	// never become consequences merely because they share the reducer tick.
	if (event.observed_at_tick !== tick) return false;
	switch (event.kind) {
		case "dealt_hit":
			return event.attacker_id === actorEntityId;
		case "dealt_condition":
			return event.source_entity_id === actorEntityId;
		case "self_resource_spent":
		case "xp_gained":
			return true;
		case "reaction_window":
			return event.phase === "opened" && event.originating_actor === actorEntityId;
		case "session_lifecycle":
			return event.phase === "opened" && event.opened_by === actorEntityId;
		case "self_hit":
		case "self_condition_changed":
		case "turn_transition":
		case "advancement_available":
		case "speech_heard":
		case "trace_addressed":
		case "trace_departure":
			return false;
	}
}

/**
 * One terse 🌍-voiced line per event, shared by browser and Node hosts.
 * The exhaustive switch keeps the world's narration distinct from agent
 * thought and tool detail. It never invents redacted values or exposes a raw
 * speaker id: an attributed but unperceivable speaker remains "unseen".
 */
export function renderWorldEventLine(event: WorldEvent): string {
	switch (event.kind) {
		case "session_lifecycle":
			return event.phase === "opened"
				? `🌍 A session opens (${event.participants.length} participant${event.participants.length === 1 ? "" : "s"}).`
				: "🌍 The session closes.";
		case "turn_transition":
			return event.from_actor === null
				? `🌍 The turn opens with ${event.to_actor}.`
				: `🌍 The turn passes from ${event.from_actor} to ${event.to_actor}.`;
		case "self_hit": {
			// `attack_kind` is a template id and stays out of the sentence; it
			// is still on the event. Without a producer-resolved name the line
			// names nobody: the raw `attacker_id` is never printed.
			const remaining = event.new_value === undefined ? "." : ` — now at ${event.new_value}.`;
			return event.attacker_name !== undefined && event.attacker_name.length > 0
				? `🌍 ${event.attacker_name} hits you for ${event.amount} ${event.resource_id} damage${remaining}`
				: `🌍 You take ${event.amount} ${event.resource_id} damage${remaining}`;
		}
		case "dealt_hit":
			return `🌍 You hit ${event.target_name} for ${event.amount} damage.`;
		case "self_condition_changed":
			return event.applied
				? `🌍 You are now affected by ${event.condition_id}.`
				: `🌍 You are no longer affected by ${event.condition_id}.`;
		case "dealt_condition":
			return event.applied
				? `🌍 ${event.target_name} is now affected by ${event.condition_id}.`
				: `🌍 ${event.target_name} is no longer affected by ${event.condition_id}.`;
		case "xp_gained": {
			const remaining = event.new_value === undefined ? "" : ` — now at ${event.new_value}.`;
			return `🌍 You gain ${event.amount} experience${remaining === "" ? "." : remaining}`;
		}
		case "self_resource_spent": {
			const remaining = event.new_value === undefined ? "" : ` — now at ${event.new_value}.`;
			return `🌍 You spend ${event.amount} ${event.resource_id} (${event.source})${remaining === "" ? "." : remaining}`;
		}
		case "reaction_window":
			return event.phase === "opened"
				? `🌍 A ${event.window_kind} window opens — ${event.originating_actor}'s ${event.originating_action_id}.`
				: `🌍 The ${event.window_kind} window closes.`;
		case "advancement_available":
			return `🌍 A new advancement is available: ${event.display_name}.`;
		case "speech_heard": {
			// `addressee` is `undefined` for untargeted speech (no "to …" clause
			// at all) — never rendered as if it were a known-but-unperceivable
			// addressee (which reads "to someone").
			const toClause =
				event.addressee === undefined || event.addressee === null
					? ""
					: event.addressee_name !== null && event.addressee_name !== undefined
						? ` to ${event.addressee_name}`
						: " to someone";
			if (event.inscribed_by_name !== null)
				return `🌍 ${event.inscribed_by_name} says${toClause}: "${event.text}"`;
			return event.inscribed_by === null
				? `🌍 Something speaks${toClause}: "${event.text}"`
				: `🌍 An unseen speaker says${toClause}: "${event.text}"`;
		}
		case "trace_departure": {
			// PAYLOAD-BLIND beyond the named keys, the same rule as
			// `trace_addressed`: the line is built from `mover_name` and
			// `exit_label` only. The destination is not in the event and is
			// never guessed at — "this way" is the honest line when the world
			// could derive no direction for the exit.
			const way = event.exit_label === "" ? "this way" : `to the ${event.exit_label}`;
			return event.mover_name === null
				? `🌍 Someone leaves ${way}.`
				: `🌍 ${event.mover_name} leaves ${way}.`;
		}
		case "trace_addressed": {
			// PAYLOAD-BLIND ON PURPOSE, with exactly one authored escape hatch:
			// `label` (module header on `TraceAddressedEvent`). Every other
			// payload key stays unread here — dumping the rest would leak an
			// unbounded, unreviewed shape into the world's voice and make this
			// renderer change whenever an author changed a key. The addressee
			// reads "you" when this actor IS the addressee (`addressed_at_self`,
			// a producer-derived id comparison, never a payload key), else the
			// same way `speech_heard` does — a name only when perceived,
			// "someone" otherwise.
			const to = event.addressed_at_self ? "you" : (event.addressee_name ?? "someone");
			if (event.label !== undefined) {
				return event.inscribed_by_name !== null
					? `🌍 ${event.inscribed_by_name}'s ${event.label} ${to}.`
					: event.inscribed_by === null
						? `🌍 Something's ${event.label} ${to}.`
						: `🌍 An unseen figure's ${event.label} ${to}.`;
			}
			const what = event.trace_kind;
			return event.inscribed_by_name !== null
				? `🌍 ${event.inscribed_by_name} signals ${to} (${what}).`
				: event.inscribed_by === null
					? `🌍 Something signals ${to} (${what}).`
					: `🌍 An unseen figure signals ${to} (${what}).`;
		}
	}
}
