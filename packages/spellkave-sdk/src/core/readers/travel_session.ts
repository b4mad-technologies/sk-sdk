import type { SessionRow } from "../../binding_rows";
import type { SnapshotDb } from "../../reader-manifest";
import { rows } from "./_helpers";
import { isLiveSessionLifecycle, readSessionParticipants } from "./session";

export interface TravelSession {
	/** The session walking this actor. */
	sessionId: bigint;
	/** World tick the walk was admitted on. */
	openedAt: bigint;
	/** Total ticks the server priced the walk at, computed once at admission. */
	durationTicks: bigint;
	/** `openedAt + durationTicks` — the tick the actor is put down on. */
	arrivesAtTick: bigint;
	/** Ticks still to go from `now`, floored at 0. */
	arrivesInTicks: bigint;
	/** The action that was promoted into this session, when the server named one. */
	originatingAction: string;
}

/** The open long-running session `actorId` is currently being walked by, or
 * `null` when they are not in transit.
 *
 * A session qualifies only when `promotedDurationTicks > 0`: that field is the
 * §5.10 auto-promotion marker, and a session opened directly through
 * `r_session_open` (a combat, say) always carries 0. So this never mistakes a
 * fight for a walk.
 *
 * `now` defaults to the world tick this snapshot can see. Pass it explicitly
 * when the caller already holds a tick it wants the answer relative to. */
/** The world tick this snapshot can see. Read straight off `world_time`
 * rather than through `currentWorldTickOrZero` — that helper is typed against
 * the root entry's `SnapshotDb`, and this reader lives on the browser-safe
 * reader subpath, which names a different (structurally compatible) one. */
function visibleWorldTick(db: SnapshotDb): bigint {
	for (const row of rows<{ tick?: bigint | number | string }>(db, "world_time")) {
		const tick = (row as { tick?: bigint | number | string }).tick;
		return typeof tick === "bigint" ? tick : BigInt(String(tick ?? 0));
	}
	return 0n;
}

export function travelSessionForActor(
	db: SnapshotDb,
	actorId: string,
	now?: bigint,
): TravelSession | null {
	const tick = now ?? visibleWorldTick(db);
	const candidates = rows<SessionRow>(db, "visible_session", "session")
		.map((row) => {
			const r = row as unknown as {
				sessionId: unknown;
				lifecycle: string;
				openedAt: unknown;
				promotedDurationTicks: unknown;
				originatingAction: unknown;
			};
			const big = (value: unknown): bigint =>
				typeof value === "bigint" ? value : BigInt(String(value ?? 0));
			return {
				sessionId: big(r.sessionId),
				lifecycle: r.lifecycle,
				openedAt: big(r.openedAt),
				durationTicks: big(r.promotedDurationTicks),
				originatingAction: String(r.originatingAction ?? ""),
			};
		})
		.filter((session) => isLiveSessionLifecycle(session.lifecycle) && session.durationTicks > 0n)
		// Newest first: an actor should never be in two walks at once, but if a
		// stale row ever lingered, the walk they just started is the honest answer.
		.sort((a, b) => (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0));

	for (const session of candidates) {
		const participants = readSessionParticipants(db, session.sessionId);
		if (!participants.some((participant) => participant.actorId === actorId)) continue;
		const arrivesAtTick = session.openedAt + session.durationTicks;
		const remaining = arrivesAtTick - tick;
		return {
			sessionId: session.sessionId,
			openedAt: session.openedAt,
			durationTicks: session.durationTicks,
			arrivesAtTick,
			arrivesInTicks: remaining > 0n ? remaining : 0n,
			originatingAction: session.originatingAction,
		};
	}
	return null;
}
