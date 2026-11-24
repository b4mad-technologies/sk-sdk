// sk-dms.16 — the hand-play player's EAR.
//
// The world already pushes: `@spellkave/tool-player`'s `push-events.ts`
// turns changes in the connected actor's own perception-gated views into a
// closed `WorldEvent` union (ADR-0093 D-2) — session lifecycle, turn
// transitions, damage taken, reaction windows, new advancements, and speech
// heard. `@spellkave/npc`'s seats consume it, and so does the autonomous
// runtime (`push-delivery.ts`). This Pi extension did not, so a human's
// player-agent was the only participant in the world without an ear: in the
// sk-dms.8 hand-play Aldwin answered in the SAME tick as the question, the
// server recorded Renn as having heard it, and the agent still reported —
// correctly, from what it could see — that nothing had been said.
//
// DELIVERY SHAPE: events are appended to the NEXT Spellkave tool result rather
// than steered in as their own message. Two reasons. It keeps a headless
// `pi --print` turn coherent (a steer mid-`-p` run has no turn boundary to
// land on), and it puts the world's line exactly where the agent is already
// looking — beside the receipt of the act that provoked it.
//
// PRIMING (D-5 recreate-trap): `session.worldEvents` on the SDK is the one
// cursor per CONNECTION (one per session, lazily memoized on first access;
// see the doc comment on `SpellkaveSession.worldEvents` in
// `packages/spellkave-sdk/src/connection.ts` and
// `ledger/designs/session-owns-the-world-event-cursor.md`). The SDK
// constructs it but never primes it — Pi's own priming moment is implicit:
// the first `drainLines()` after a connect IS the priming call and returns
// nothing by design, because everything already true when the connection was
// made is not news. `createWorldEventFeed` below returns a STABLE object for
// the extension's whole process lifetime (`main.ts` binds
// `worldEvents.builder` once at activation and cannot rebind it), but that
// object only FORWARDS to whichever cursor
// `controller.active()?.session.worldEvents` currently names — it holds no
// state of its own. A reconnect therefore reaches a FRESH cursor that primes
// quiet on the new subscription, which is the honest answer: nothing was
// observable while there was no subscription. Before this slice the builder
// was constructed ONCE per process with lazy accessors and carried its
// seen-sets ACROSS a disconnect/reconnect, so the first drain after
// reconnecting reported the whole delta accumulated while unsubscribed as
// news — a flood this fixes.
//
// KNOWN GAP — CROSS-TURN EVENTS ARE STILL LOST HEADLESS (sk-dms.20). The
// cursor above is per CONNECTION, not per TURN, so nothing is lost within one
// long-lived connection. But `just pi-handplay <session> "…"` is one PROCESS
// PER TURN, and a process boundary is also a connection boundary: each
// headless turn opens a fresh connection, whose fresh cursor primes against
// the world as it stands at that moment. An NPC's own combat turn taken
// between two player turns is already true by the time the next process
// connects, and is swallowed as not-news. This slice does not close
// sk-dms.20 — per the bead's 2026-08-11 operator steer, the gap is a property
// of ONE-PROCESS-PER-TURN, not of the wiring, and persisting seen-sets across
// processes is explicitly NOT the fix. The fix is a long-lived process
// holding the connection across turns: `pi --mode rpc`, or `herdr agent
// prompt` (the shape the playtest skill already uses — "interactive, never
// headless"). An interactive session (one long-lived process) does not have
// this gap today.

import type { WorldEvent, WorldEventBuilder } from "@spellkave/tool-player";
import { renderWorldEventLine } from "@spellkave/tool-runtime";

export interface WorldEventFeedDeps {
	/**
	 * The active connection's world-event cursor, or `undefined` while
	 * disconnected. A THUNK, not a value — it must follow
	 * `controller.active()` the same way `estimator` does in `main.ts`, so a
	 * reconnect resolves to the NEW connection's cursor instead of forwarding
	 * to one from a connection that already ended.
	 */
	active: () => WorldEventBuilder | undefined;
}

export interface WorldEventFeed {
	/**
	 * Drain whatever the world has done to this actor since the last drain,
	 * rendered one 🌍 line each. Returns `[]` while disconnected, on the priming
	 * call, and whenever nothing happened — the common case, so callers can
	 * append unconditionally.
	 */
	drainLines(): string[];
	/**
	 * sk-0m4.73: the SAME forwarding builder `drainLines()` calls
	 * `diffAndAdvance()` on — exposed so `main.ts` can inject it into
	 * `createPlayerFacingTools`'s `worldEvents.builder` option (the
	 * `communicate` reply window, and the `consequences` register every act
	 * tool takes from). This is a stable process-lifetime shim, not a cursor:
	 * it forwards each call to `deps.active()`'s CURRENT value, so every
	 * caller of `worldEvents.builder` stays correct across a reconnect without
	 * being rebound.
	 */
	readonly builder: WorldEventBuilder;
}

export function createWorldEventFeed(deps: WorldEventFeedDeps): WorldEventFeed {
	// `main.ts` binds this object once at activation and cannot rebind it, so
	// it must stay stable for the extension's whole process lifetime. It holds
	// no cursor of its own — each entry point re-reads `deps.active()` and
	// delegates, returning `[]` while disconnected.
	const builder: WorldEventBuilder = {
		diffAndAdvance(): WorldEvent[] {
			return deps.active()?.diffAndAdvance() ?? [];
		},
		takeWhere(predicate: (event: WorldEvent) => boolean): WorldEvent[] {
			return deps.active()?.takeWhere(predicate) ?? [];
		},
	};

	return {
		drainLines(): string[] {
			try {
				return builder.diffAndAdvance().map(renderWorldEventLine);
			} catch {
				// A drain must never turn a working tool call into a failed one: the
				// events are a courtesy channel, the tool's own result is the contract.
				// A disconnect racing the drain is the expected case here.
				return [];
			}
		},
		builder,
	};
}
