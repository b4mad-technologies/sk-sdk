import type {
	ActionDefinitionRow,
	EntityRow,
	SessionDefinitionRow,
	SessionRow,
	WorldTimeRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { targetRefToString } from "../reducers/transport";
import { asString, resolveEntityId, rows } from "./_helpers";
import { readInventoryProjection } from "./inventory_query";
import { readObserverKnowledge } from "./observer_knowledge";
import { readObserverPlaceKnowledge } from "./observer_place_knowledge";
import { readSessionParticipants } from "./session";

export const requiredTables: RequiredTables<
	["visible_session", "session_definition", "action_definition"]
> = ["visible_session", "session_definition", "action_definition"];
registerReaderManifest({ requiredTables });

const TERMINAL_PHASES = new Set(["completed", "failed", "abandoned"]);

export interface ParticipantSessionSummary {
	session_id: string;
	lifecycle: string;
	label: string | null;
}

/** Stable authorized domain rows; PLAYER tools own bounded pagination. */
export function readParticipantSessionSummaries(
	db: SnapshotDb,
	actor: EntityRef,
): ParticipantSessionSummary[] {
	const resolved = resolveEntityId(db, actor);
	if (resolved === undefined) return [];
	const actorId = String(resolved);
	const actions = new Map(
		rows<ActionDefinitionRow>(db, "action_definition").map((row) => [row.actionId, row]),
	);
	return rows<SessionRow>(db, "visible_session", "session")
		.filter(
			(row) =>
				!TERMINAL_PHASES.has(row.lifecycle) &&
				readSessionParticipants(db, row.sessionId).some(
					(participant) => participant.actorId === actorId,
				),
		)
		.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0))
		.map((row) => ({
			session_id: String(row.sessionId),
			lifecycle: row.lifecycle,
			label: actions.get(row.originatingAction)?.displayName?.trim() || null,
		}));
}

export interface ParticipantSessionDetail {
	session_id: string;
	session_definition_id: string;
	lifecycle: string;
	label: string | null;
	description: string | null;
	turn_rule: string | null;
	round_duration_ms: string | null;
	opened_by: string | null;
	/** `name` is the participant's entity name when the caller can see that
	 * entity (`visible_entity`), else `null` — a client renders the id
	 * otherwise, which is what a fight roster of "145, 143, 147" looked like. */
	roster: Array<{ actor_id: string; ordinal: number; name: string | null }>;
	current_actor: string | null;
	my_turn: boolean;
	originating_action: string | null;
	originating_target: string | null;
	timing: {
		basis: "world_ticks";
		observed_at: string | null;
		last_tick_at_micros: string | null;
		opened_at: string | null;
		last_advanced_at: string | null;
		duration_ticks: string | null;
		estimated_completion_at: string | null;
		estimated_remaining_ticks: string | null;
	};
}

/** Missing snapshot fields are unknown, never fabricated tick zero. */
function tick(value: unknown): bigint | null {
	if (typeof value === "bigint") return value >= 0n ? value : null;
	if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
	if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
	return null;
}

function knownOriginTarget(
	db: SnapshotDb,
	actor: EntityRef,
	actorId: string,
	row: SessionRow,
): string | null {
	const target = row.originatingTarget;
	if (!target) return null;
	if (target.tag === "World") return "world";
	if (target.tag === "Entity" || target.tag === "Item") {
		const id = String(target.value);
		const known =
			id === actorId ||
			readObserverKnowledge(db, actorId).some((entry) => entry.known_entity_id === id) ||
			readInventoryProjection(db, actor)?.items.some((item) => item.entity_id === id);
		return known ? targetRefToString(target) : null;
	}
	if (target.tag === "PlaceNode") {
		return readObserverPlaceKnowledge(db, actorId).some(
			(entry) => entry.known_node_id === target.value,
		)
			? targetRefToString(target)
			: null;
	}
	// Other target variants need an equivalent authorized disclosure reader.
	return null;
}

/** Read only a caller-visible session in which this actor participates.
 * Explicit selection follows a session through terminal states; the default
 * selects the lowest-id nonterminal session, including external waits.
 * This does not broaden the compact combat reader or decide action admission.
 */
export function readParticipantSessionDetail(
	db: SnapshotDb,
	actor: EntityRef,
	sessionId?: string,
): ParticipantSessionDetail | null {
	const resolved = resolveEntityId(db, actor);
	if (resolved === undefined) return null;
	const actorId = String(resolved);
	const candidates = rows<SessionRow>(db, "visible_session", "session")
		.filter((row) =>
			sessionId === undefined
				? !TERMINAL_PHASES.has(row.lifecycle)
				: String(row.sessionId) === sessionId,
		)
		.sort((a, b) => (a.sessionId < b.sessionId ? -1 : a.sessionId > b.sessionId ? 1 : 0));
	const row = candidates.find((candidate) =>
		readSessionParticipants(db, candidate.sessionId).some(
			(participant) => participant.actorId === actorId,
		),
	);
	if (!row) return null;
	const definition = rows<SessionDefinitionRow>(db, "session_definition").find(
		(candidate) => candidate.sessionDefId === row.sessionDefId,
	);
	const action = rows<ActionDefinitionRow>(db, "action_definition").find(
		(candidate) => candidate.actionId === row.originatingAction,
	);
	const worldTime = rows<WorldTimeRow>(db, "world_time")[0];
	const now = tick(worldTime?.tick);
	const participants = readSessionParticipants(db, row.sessionId);
	const entityRows = rows<EntityRow>(db, "entity");
	const openedBy = row.openedBy;
	const knownOpener =
		openedBy === actorId ||
		participants.some((entry) => entry.actorId === openedBy) ||
		readObserverKnowledge(db, actorId).some((entry) => entry.known_entity_id === openedBy);
	const roundDuration = tick(definition?.roundDurationMs);
	const opened = tick(row.openedAt);
	const duration = tick(row.promotedDurationTicks);
	const positiveDuration = duration !== null && duration > 0n ? duration : null;
	const completion =
		opened !== null && positiveDuration !== null ? opened + positiveDuration : null;
	const remaining =
		completion !== null && now !== null ? (completion > now ? completion - now : 0n) : null;
	return {
		session_id: String(row.sessionId),
		session_definition_id: row.sessionDefId,
		lifecycle: row.lifecycle,
		label: action?.displayName?.trim() || null,
		// Neither SessionDefinition nor ActionDefinition persists description prose.
		description: null,
		turn_rule: definition?.turnRule || null,
		round_duration_ms: roundDuration !== null && roundDuration > 0n ? String(roundDuration) : null,
		opened_by: openedBy && knownOpener ? openedBy : null,
		roster: participants.map((entry) => ({
			actor_id: entry.actorId,
			ordinal: entry.ordinal,
			name: participantName(entityRows, entry.actorId),
		})),
		current_actor: row.currentActor || null,
		my_turn: row.currentActor === actorId,
		originating_action: row.originatingAction || null,
		originating_target: row.originatingAction ? knownOriginTarget(db, actor, actorId, row) : null,
		timing: {
			basis: "world_ticks",
			observed_at: now?.toString() ?? null,
			last_tick_at_micros: worldTime?.lastTickAt?.microsSinceUnixEpoch?.toString() ?? null,
			opened_at: opened?.toString() ?? null,
			last_advanced_at: tick(row.lastAdvancedAt)?.toString() ?? null,
			duration_ticks: positiveDuration?.toString() ?? null,
			estimated_completion_at: completion?.toString() ?? null,
			estimated_remaining_ticks: remaining?.toString() ?? null,
		},
	};
}

function participantName(entityRows: readonly EntityRow[], actorId: string): string | null {
	const name = entityRows.find((row) => String(row.entityId) === actorId)?.name;
	const text = asString(name);
	return text === "" ? null : text;
}
