import type { SpellkaveSession } from "@spellkave/sdk";
import type { WorldEventFanout } from "@spellkave/world-events";

/**
 * Shim over `SpellkaveSession.worldEvents` (`ledger/designs/session-owns-the-world-event-cursor.md`,
 * slice B2). Construction and memoization — one cursor per session, first
 * access constructs and does not prime — now live on the SDK session itself;
 * this function just forwards to the getter so existing importers keep
 * working. Prime with `diffAndAdvance()` after `session.ready`, at whatever
 * moment your host considers itself "arrived".
 */
export function worldEventsFor(session: SpellkaveSession): WorldEventFanout {
	return session.worldEvents;
}
