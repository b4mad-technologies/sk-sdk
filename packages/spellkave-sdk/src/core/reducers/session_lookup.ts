// Session-row lookup for r_session_open — split out to keep the wrapper
// itself under the sdk_loc_ceiling (LR-102).

import type { SnapshotDb } from "../../connection";

const TERMINAL_SESSION_LIFECYCLES = new Set(["completed", "abandoned", "failed"]);

/** First subscribed handle that already has rows, else the first existing
 * empty handle. Live clients only subscribe `visible_session` / `visible_session_participant`
 * (raw `session` is private, ADR-0057 / sk-2qt); unit fixtures may still inject
 * the pre-privacy names. */
export function firstPopulatedHandle(db: SnapshotDb, ...accessors: string[]) {
	let empty: { iter(): Iterable<unknown> } | undefined;
	for (const name of accessors) {
		const handle = db[name];
		if (!handle) continue;
		const rows = Array.from(handle.iter());
		if (rows.length > 0) return handle;
		empty = handle;
	}
	return empty;
}

export function findSessionId(
	db: SnapshotDb,
	sessionDefId: string,
	participants: readonly bigint[],
): bigint | undefined {
	const handle = firstPopulatedHandle(db, "visible_session", "session");
	if (!handle) return undefined;
	const wanted = new Set(participants.map((participant) => String(participant)));
	const participantHandle = firstPopulatedHandle(
		db,
		"visible_session_participant",
		"session_participant",
	);
	const participantRows = participantHandle ? Array.from(participantHandle.iter()) : [];
	const matching: bigint[] = [];
	for (const raw of handle.iter()) {
		const r = raw as unknown as { sessionDefId: string; sessionId: unknown; lifecycle?: unknown };
		if (r.sessionDefId === sessionDefId && !TERMINAL_SESSION_LIFECYCLES.has(String(r.lifecycle))) {
			const sessionId =
				typeof r.sessionId === "bigint" ? r.sessionId : BigInt(String(r.sessionId ?? 0));
			if (participantRows.length === 0) {
				matching.push(sessionId);
				continue;
			}
			const sessionIdText = String(sessionId);
			const actual = new Set(
				participantRows
					.map((row) => row as unknown as { sessionId: unknown; actorId: unknown })
					.filter((row) => String(row.sessionId) === sessionIdText)
					.map((row) => String(row.actorId)),
			);
			if (
				actual.size === wanted.size &&
				[...wanted].every((participant) => actual.has(participant))
			) {
				matching.push(sessionId);
			}
		}
	}
	return matching.sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))[0];
}
