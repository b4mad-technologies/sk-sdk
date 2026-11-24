// Session-daemon push feed (sk-0m4.22): drains the session's ONE world-event
// cursor (`session.worldEvents` — one per session, SDK-owned, see
// `ledger/designs/session-owns-the-world-event-cursor.md`) on demand so a
// PLAYER driving the world through `sk` finally sees incoming hits, damage
// dealt, XP, and turn transitions.
//
// Mirrors `.pi/extensions/spellkave/src/extension/world-events.ts` (sk-dms.16)
// — same ADR-0093 D-2 vocabulary, same D-5 recreate-trap contract. Before the
// cursor moved onto the session, this feed constructed its own builder;
// recreating one per `invoke` would be finding #98: a freshly constructed
// builder primes quiet on its first `diffAndAdvance()` and silently drops
// everything that happened between calls. That risk is now structural, not
// discipline-enforced — `createSessionWorldEventFeed` takes the session's
// cursor as its `builder` (`startDaemon` passes `live.session.worldEvents`),
// and the daemon holds one session for its whole process lifetime, so there
// is no per-invoke construction left to get wrong.
//
// THE PROTOCOL DOES NOT BREAK: pending events ride an additive `pushes`
// field on every response (`protocol.ts`). No unsolicited daemon→client
// frames, no `PROTOCOL_VERSION` bump. A drain that throws must never turn a
// working tool call into a failed one — events are a courtesy channel; the
// tool's own result is the contract (same posture as the pi feed).
//
// PRIMING happens at construction, not on the first invoke: `startDaemon`
// only builds this feed after `openSession` has subscribed, so the snapshot
// is live. Leaving the first `diffAndAdvance()` to the first `sk act` would
// swallow that act's own dealt_hit / self_hit as "already true".

import type { WorldActorTracer } from "@spellkave/agent-observability";
import { type EntityRef, resolveEntityId, type SnapshotDb } from "@spellkave/sdk";
import { readRecentTraces } from "@spellkave/sdk/readers";
import {
	createWorldEventBuilder,
	type WorldEvent,
	type WorldEventBuilder,
} from "../player-tools/push-events.ts";

const MAX_TRACKED_WORLD_EVENT_IDS = 1_024;
const TRACE_SCAN_WINDOW = 200;

type WorldEventIdentityKind = "trace_id" | "event_id";

interface WorldEventIdentity {
	kind: WorldEventIdentityKind;
	id: string;
}

interface WorldEventAnomaly {
	name: "world_event_duplicate" | "world_event_unreported";
	identity: WorldEventIdentity;
}

class BoundedStringSet {
	private readonly values = new Set<string>();

	constructor(private readonly capacity: number) {}

	has(value: string): boolean {
		return this.values.has(value);
	}

	add(value: string): void {
		if (this.values.delete(value)) this.values.add(value);
		else {
			this.values.add(value);
			if (this.values.size > this.capacity) {
				const oldest = this.values.values().next().value;
				if (oldest !== undefined) this.values.delete(oldest);
			}
		}
	}

	delete(value: string): void {
		this.values.delete(value);
	}

	entries(): string[] {
		return [...this.values];
	}
}

function eventIdentity(event: WorldEvent): WorldEventIdentity | undefined {
	const record = event as unknown as Record<string, unknown>;
	if (typeof record.trace_id === "string" && record.trace_id.length > 0) {
		return { kind: "trace_id", id: record.trace_id };
	}
	// Honor a source event id structurally when a projection supplies one. This
	// keeps the failsafe log-only: it never adds identifiers to delivery payloads.
	if (typeof record.event_id === "string" && record.event_id.length > 0) {
		return { kind: "event_id", id: record.event_id };
	}
	return undefined;
}

function identityKey(identity: WorldEventIdentity): string {
	return `${identity.kind}:${identity.id}`;
}

export interface SessionWorldEventFeedDeps {
	/** Live snapshot of the daemon's open session. */
	db: () => SnapshotDb;
	/** The connected body entity ref (branded at the daemon / fixture door). */
	actorId: () => EntityRef | undefined;
	/** Existing world-actor OTLP tracer; no new telemetry projection/table. */
	telemetry?: WorldActorTracer;
	/** Injectable builder for live-node-free failsafe tests. */
	builder?: WorldEventBuilder;
	/** Injectable bound for eviction tests; production defaults to 1,024 ids. */
	maxTrackedIds?: number;
}

export interface SessionWorldEventDrainOptions {
	/** Compare visible reportable traces with delivered ids on an orient drain. */
	auditVisibleTraces?: boolean;
}

export interface SessionWorldEventFeed {
	/**
	 * Drain whatever the world has done to this actor since the last drain
	 * (or since construction-time priming). Returns `[]` whenever nothing
	 * happened and when the snapshot read races a disconnect — the common
	 * case, so callers can attach the result unconditionally.
	 */
	drain(options?: SessionWorldEventDrainOptions): WorldEvent[];
	/**
	 * sk-0m4.73: the SAME underlying `WorldEventBuilder` `drain()` calls
	 * `diffAndAdvance()` on — exposed so `startDaemon` can inject it into the
	 * companion tools' `conversation.builder` option (the `communicate` reply
	 * window). MUST NOT be used to construct a second builder; there is only
	 * ever this one for the daemon's whole lifetime (module header).
	 */
	readonly builder: WorldEventBuilder;
}

/**
 * Construct the daemon's ONE builder. Call this exactly once per
 * `startDaemon` lifetime and hand the returned feed to the dispatcher —
 * never call `createWorldEventBuilder` again for the same live actor.
 */
export function createSessionWorldEventFeed(
	deps: SessionWorldEventFeedDeps,
): SessionWorldEventFeed {
	const rawBuilder: WorldEventBuilder =
		deps.builder ??
		createWorldEventBuilder(
			() => deps.db(),
			() => deps.actorId(),
		);
	const capacity = Math.max(1, deps.maxTrackedIds ?? MAX_TRACKED_WORLD_EVENT_IDS);
	const deliveredIds = new BoundedStringSet(capacity);
	const knownVisibleTraceIds = new BoundedStringSet(capacity);
	const pendingVisibleTraceIds = new BoundedStringSet(capacity);

	function visibleReportableTraceIds(): string[] {
		try {
			const currentDb = deps.db();
			const currentActorId = deps.actorId();
			const ownEntityId =
				currentActorId === undefined ? undefined : resolveEntityId(currentDb, currentActorId);
			return readRecentTraces(currentDb, TRACE_SCAN_WINDOW)
				.filter(
					(trace) =>
						trace.inscribed_by !== String(ownEntityId) &&
						typeof trace.payload === "object" &&
						trace.payload !== null &&
						typeof (trace.payload as { text?: unknown }).text === "string",
				)
				.map((trace) => trace.trace_id);
		} catch {
			return [];
		}
	}

	for (const traceId of visibleReportableTraceIds()) knownVisibleTraceIds.add(traceId);

	function emitAnomalies(anomalies: readonly WorldEventAnomaly[]): void {
		if (anomalies.length === 0) return;
		try {
			const span = deps.telemetry?.startSpan("spellkave.world_event_delivery", {
				"spellkave.actor_id": deps.actorId() ?? "",
			});
			for (const anomaly of anomalies) {
				try {
					span?.addEvent(anomaly.name, {
						"spellkave.cause_kind": anomaly.identity.kind,
						"spellkave.cause_id": anomaly.identity.id,
					});
				} catch {
					// A failing projection loses only its own diagnostic event.
				}
			}
			try {
				span?.end("error");
			} catch {
				// Observability cannot change world-event delivery.
			}
		} catch {
			// Same optional-observability posture as observeReducerAttempt.
		}
	}

	function observeReturnedEvents(
		events: WorldEvent[],
		options: SessionWorldEventDrainOptions = {},
	): WorldEvent[] {
		const anomalies: WorldEventAnomaly[] = [];
		for (const event of events) {
			const identity = eventIdentity(event);
			if (identity === undefined) continue;
			const key = identityKey(identity);
			if (deliveredIds.has(key)) anomalies.push({ name: "world_event_duplicate", identity });
			deliveredIds.add(key);
			if (identity.kind === "trace_id") pendingVisibleTraceIds.delete(identity.id);
		}

		for (const traceId of visibleReportableTraceIds()) {
			if (knownVisibleTraceIds.has(traceId)) continue;
			knownVisibleTraceIds.add(traceId);
			if (!deliveredIds.has(identityKey({ kind: "trace_id", id: traceId }))) {
				pendingVisibleTraceIds.add(traceId);
			}
		}
		if (options.auditVisibleTraces === true) {
			for (const traceId of pendingVisibleTraceIds.entries()) {
				anomalies.push({
					name: "world_event_unreported",
					identity: { kind: "trace_id", id: traceId },
				});
				pendingVisibleTraceIds.delete(traceId);
			}
		}
		emitAnomalies(anomalies);
		return events;
	}

	// Proxy both builder entry points. Companion tools consume takeWhere()
	// directly for synchronous replies/consequences; observing only daemon
	// drains would falsely call those deliberately-taken events unreported.
	const builder: WorldEventBuilder = {
		diffAndAdvance: () => observeReturnedEvents(rawBuilder.diffAndAdvance()),
		takeWhere: (predicate) => observeReturnedEvents(rawBuilder.takeWhere(predicate)),
	};
	// Prime NOW, not on the first invoke. `startDaemon` only constructs this
	// feed after `openSession` has subscribed, so the snapshot is live. If we
	// left priming to the first `sk act`, that act's own dealt_hit / self_hit
	// would be swallowed as "already true" — the exact player-visible gap
	// this change exists to close. The world as it stands at daemon start is
	// not news; everything after this call is.
	try {
		rawBuilder.diffAndAdvance();
	} catch {
		// Same courtesy-channel posture as drain(): a snapshot race at
		// construction must not refuse to start the daemon. The next drain
		// will be the priming call in that case.
	}

	return {
		drain(options: SessionWorldEventDrainOptions = {}): WorldEvent[] {
			try {
				return observeReturnedEvents(rawBuilder.diffAndAdvance(), options);
			} catch {
				// A drain must never turn a working invoke into a failed one: the
				// events are a courtesy channel, the tool's own result is the contract.
				// A disconnect racing the drain is the expected case here.
				return [];
			}
		},
		builder,
	};
}
