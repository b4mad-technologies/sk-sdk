import type { SessionParticipantRow, SessionRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, rows } from "./_helpers";

// Reader over the (already-subscribed) `visible_session` view (raw `session` is
// private, ADR-0057 / sk-2qt). The turn kernel mirrors
// the active turn's actor onto `session.current_actor` (server
// `r_advance_turn` D-2), so a turn-gated client can answer "is it my turn?"
// from this reader alone, without needing `turn_state` for that specific
// question. `turn_state` itself now has its own reader (`core/readers/
// turn_state.ts`, ADR-0093 D-6) — the push-event builder's `turn_transition`
// domain reads the kernel-authoritative singleton directly rather than this
// mirror. Type-level read only — no runtime semantic validation (SDK §1).

export const requiredTables: RequiredTables<["visible_session"]> = ["visible_session"];
registerReaderManifest({ requiredTables });

export interface SessionSnapshot {
	sessionId: bigint;
	sessionDefId: string;
	lifecycle: string;
	/** The actor whose turn it currently is (the kernel-mirrored active actor). */
	currentActor: string;
	/** Raw session state. On a session terminated by the authored
	 * `termination_pred`, `state_json.termination` carries the neutral winner
	 * facts (participant tag-group counts + winner_predicate result) that
	 * clients derive outcome labels from — the substrate never names them. */
	stateJson: string;
	/** Actor entity id that originated the session open. */
	openedBy: string;
	/** Monotonic turn-advance marker written with current_actor (u64).
	 * `null` when the row has not projected the field yet — 0 is a real tick. */
	lastAdvancedAt?: bigint | null;
}

function lastAdvancedAtFromRow(value: unknown): bigint | null {
	if (value === undefined || value === null) return null;
	if (typeof value === "bigint") return value;
	if (typeof value === "number" && Number.isFinite(value)) return BigInt(value);
	if (typeof value === "string" && value.length > 0) {
		try {
			return BigInt(value);
		} catch {
			return null;
		}
	}
	return null;
}

function toSnapshot(row: SessionRow): SessionSnapshot {
	const r = row as unknown as {
		sessionId: unknown;
		sessionDefId: string;
		lifecycle: string;
		currentActor: string;
		stateJson: unknown;
		openedBy: unknown;
		lastAdvancedAt: unknown;
	};
	return {
		sessionId: typeof r.sessionId === "bigint" ? r.sessionId : BigInt(String(r.sessionId ?? 0)),
		sessionDefId: r.sessionDefId,
		lifecycle: r.lifecycle,
		currentActor: r.currentActor,
		stateJson: asString(r.stateJson),
		openedBy: asString(r.openedBy),
		lastAdvancedAt: lastAdvancedAtFromRow(r.lastAdvancedAt),
	};
}

/** Session lifecycles in which the actor is still IN the session: the world is
 * waiting on a turn or a reaction, not finished. A reader that collapses any of
 * these to "no session" tells a player mid-fight there is no fight — the
 * player-facing dishonesty measured in sk-awlo.16, where `awaiting-reactions`
 * (a 5e opportunity-attack window opened by walking away) read as a closed
 * session. The complement — `completed` / `abandoned` / `failed` — is terminal.
 *
 * Deliberately EXCLUDES two of the eight canonical lifecycles: `initiated` (a
 * pre-validation transient, not yet accepting moves) and `waiting-on-external`
 * (§7 external-process deferral, not part of the measured player surface —
 * whether it should also read as live is filed as a follow-up, not silently
 * decided here). Canonical vocabulary: server
 * `world_interaction/layer3/session.rs` module docstring. */
export const LIVE_SESSION_LIFECYCLES = ["active", "awaiting-turn", "awaiting-reactions"] as const;

/** True when a session lifecycle means the actor is still in the session. */
export function isLiveSessionLifecycle(lifecycle: string): boolean {
	return (LIVE_SESSION_LIFECYCLES as readonly string[]).includes(lifecycle);
}

/** Sessions in a terminal lifecycle (`completed` / `failed`), most recent
 * first. Pure read over subscribed rows (SDK §1). */
export function readTerminalSessions(db: SnapshotDb): SessionSnapshot[] {
	return rows<SessionRow>(db, "visible_session", "session")
		.map(toSnapshot)
		.filter((s) => s.lifecycle === "completed" || s.lifecycle === "failed")
		.sort((a, b) => (a.sessionId < b.sessionId ? 1 : a.sessionId > b.sessionId ? -1 : 0));
}

/** The open session for a given definition id, if one exists. */
export function readSession(db: SnapshotDb, sessionDefId: string): SessionSnapshot | null {
	const row = rows<SessionRow>(db, "visible_session", "session").find(
		(candidate) => (candidate as unknown as { sessionDefId: string }).sessionDefId === sessionDefId,
	);
	return row ? toSnapshot(row) : null;
}

/** The session row by its numeric id, if present. */
export function readSessionById(db: SnapshotDb, sessionId: bigint): SessionSnapshot | null {
	const row = rows<SessionRow>(db, "visible_session", "session").find((candidate) => {
		const raw = (candidate as unknown as { sessionId: unknown }).sessionId;
		const id = typeof raw === "bigint" ? raw : BigInt(String(raw ?? 0));
		return id === sessionId;
	});
	return row ? toSnapshot(row) : null;
}

/** The actor whose turn it currently is in the named session, or null if the
 * session is absent. The turn-gating predicate compares this to the caller's
 * own actor id. */
export function readSessionCurrentActor(db: SnapshotDb, sessionDefId: string): string | null {
	return readSession(db, sessionDefId)?.currentActor ?? null;
}

/** The active session in which it is currently `actorEntityId`'s turn, if any.
 *
 * Pure read over subscribed `visible_session` rows (SDK §1 — no validation). Lets a host
 * resolve "the session I am taking my turn in" without knowing its numeric id:
 * `r_advance_turn` is scoped to a specific session, and an actor can only end the
 * turn of a session where it is the current actor, so matching on `current_actor`
 * picks that session unambiguously even if several sessions are open. Returns the
 * lowest-id match for determinism. */
export function readActiveSessionForActor(
	db: SnapshotDb,
	actorEntityId: string,
): SessionSnapshot | null {
	const matches = rows<SessionRow>(db, "visible_session", "session")
		.map(toSnapshot)
		.filter((s) => isLiveSessionLifecycle(s.lifecycle) && s.currentActor === String(actorEntityId))
		.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
	return matches[0] ?? null;
}

// session_participant carries the turn roster (ordinal order). A turn-gated
// client reads it to render "who is in this fight and in what order" — the
// current actor is `session.current_actor`, mirrored by the turn kernel.
export const participantRequiredTables: RequiredTables<["visible_session_participant"]> = [
	"visible_session_participant",
];
registerReaderManifest({ requiredTables: participantRequiredTables });

export interface SessionParticipant {
	actorId: string;
	ordinal: number;
	joinedAt: number;
}

/** Participants of a session, sorted by the authoritative `(ordinal ASC,
 * actor_id ASC)` turn order (server D-I3). Pure read over subscribed rows. */
export function readSessionParticipants(db: SnapshotDb, sessionId: bigint): SessionParticipant[] {
	const wanted = String(sessionId);
	return rows<SessionParticipantRow>(db, "visible_session_participant", "session_participant")
		.filter((row) => String((row as unknown as { sessionId: unknown }).sessionId) === wanted)
		.map((row) => {
			const r = row as unknown as { actorId: unknown; ordinal: unknown; joinedAt: unknown };
			return {
				actorId: asString(r.actorId),
				ordinal: asNumber(r.ordinal),
				joinedAt: asNumber(r.joinedAt),
			};
		})
		.sort((a, b) =>
			a.ordinal !== b.ordinal
				? a.ordinal - b.ordinal
				: a.actorId < b.actorId
					? -1
					: a.actorId > b.actorId
						? 1
						: 0,
		);
}

/** The active session a given actor is a PARTICIPANT of (whether or not it is
 * currently their turn), with its participant roster. Lets the combat panel
 * render the fight the player is in even while a goblin is acting. Returns the
 * lowest-id active match. */
export function readActiveSessionWithRosterForParticipant(
	db: SnapshotDb,
	actorEntityId: string,
): { session: SessionSnapshot; participants: SessionParticipant[] } | null {
	const wanted = String(actorEntityId);
	const active = rows<SessionRow>(db, "visible_session", "session")
		.map(toSnapshot)
		.filter((s) => isLiveSessionLifecycle(s.lifecycle))
		.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
	for (const session of active) {
		const participants = readSessionParticipants(db, session.sessionId);
		if (participants.some((p) => p.actorId === wanted)) {
			return { session, participants };
		}
	}
	return null;
}
