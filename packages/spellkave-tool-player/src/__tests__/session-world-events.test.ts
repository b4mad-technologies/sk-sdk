import type { SpellkaveSession } from "@spellkave/sdk";
import type { WorldEventFanout } from "@spellkave/world-events";
import { describe, expect, it } from "vitest";
import { worldEventsFor } from "../session-world-events.ts";

/**
 * Construction and memoization of `session.worldEvents` now live on the SDK
 * session itself (`connection.ts`'s `connect()`), not in this shim —
 * `ledger/designs/session-owns-the-world-event-cursor.md` slice B2. This
 * fake reproduces that lazy-getter shape (construct once on first access,
 * memoize thereafter) so the tests below keep proving what a
 * `worldEventsFor` caller actually depends on: the shim forwards to the
 * session's own cursor without constructing a second one, and different
 * sessions never share a cursor.
 */
function fakeSession(actorId: string): { session: SpellkaveSession; constructions: () => number } {
	let cached: WorldEventFanout | undefined;
	let constructions = 0;
	const session = {
		connectedActorId: actorId,
		get worldEvents(): WorldEventFanout {
			if (cached === undefined) {
				constructions += 1;
				cached = {} as WorldEventFanout;
			}
			return cached;
		},
	} as SpellkaveSession;
	return { session, constructions: () => constructions };
}

describe("worldEventsFor", () => {
	it("forwards to session.worldEvents without constructing a second cursor", () => {
		const { session, constructions } = fakeSession("actor:play");
		const first = worldEventsFor(session);
		const second = worldEventsFor(session);
		expect(first).toBe(second);
		expect(first).toBe(session.worldEvents);
		// The session's own getter is the one and only constructor: the shim
		// must not re-wrap or re-derive a fanout of its own.
		expect(constructions()).toBe(1);
	});

	it("does not share a cursor across sessions", () => {
		const a = fakeSession("actor:play");
		const b = fakeSession("actor:other");
		expect(worldEventsFor(a.session)).not.toBe(worldEventsFor(b.session));
	});
});
