import type { SessionRow } from "../../binding_rows";
import type { SnapshotDb } from "../../reader-manifest";
import { rows } from "./_helpers";
import {
	isLiveSessionLifecycle,
	readSessionParticipants,
	type SessionParticipant,
	type SessionSnapshot,
} from "./session";

/** Find the active session (if any) that `actorId` participates in. */
export function activeSessionForParticipant(
	db: SnapshotDb,
	actorId: string,
): { session: SessionSnapshot; participants: SessionParticipant[] } | null {
	const active = rows<SessionRow>(db, "visible_session", "session")
		.map((row) => {
			const r = row as unknown as {
				sessionId: unknown;
				sessionDefId: string;
				lifecycle: string;
				currentActor: string;
				stateJson: unknown;
				openedBy: unknown;
			};
			return {
				sessionId: typeof r.sessionId === "bigint" ? r.sessionId : BigInt(String(r.sessionId ?? 0)),
				sessionDefId: r.sessionDefId,
				lifecycle: r.lifecycle,
				currentActor: r.currentActor,
				stateJson: String(r.stateJson ?? ""),
				openedBy: String(r.openedBy ?? ""),
			};
		})
		.filter((session) => isLiveSessionLifecycle(session.lifecycle))
		.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
	for (const session of active) {
		const participants = readSessionParticipants(db, session.sessionId);
		if (participants.some((participant) => participant.actorId === actorId)) {
			return { session, participants };
		}
	}
	return null;
}
