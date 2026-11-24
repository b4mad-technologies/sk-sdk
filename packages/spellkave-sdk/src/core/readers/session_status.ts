import type { EntityRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asEntityRef, type EntityRef } from "../ids";
import { asString, resolveEntityId, rows } from "./_helpers";
import { readActiveSessionWithRosterForParticipant } from "./session";

export const requiredTables: RequiredTables<
	["visible_manifest_authored_entity", "visible_manifest_authored_entity_coverage"]
> = ["visible_manifest_authored_entity", "visible_manifest_authored_entity_coverage"];
registerReaderManifest({ requiredTables });

export interface ParticipantSessionStatus {
	/** Explicitly distinguishes an active session from the `null` no-session result.
	 * PLAYER orientation consumes this field directly, rather than inferring it
	 * from a presentation status string. */
	in_session: true;
	session_id: string;
	session_definition_id: string;
	lifecycle: string;
	current_actor: string;
	my_turn: boolean;
	participant_count: number;
	/** `name` is the participant's entity name when the caller can see that
	 * entity, else `null` — without it a client's fight roster read
	 * "145, 143, 147". */
	roster: Array<{ actor_id: EntityRef; ordinal: number; name: string | null }>;
}

/** Compact active-session projection for one participant.
 *
 * The caller supplies its already-authenticated actor/body id. No session id is
 * accepted: the lowest-id active session containing that participant is selected
 * deterministically, and its roster keeps authoritative ordinal/actor ordering.
 */
export function readParticipantSessionStatus(
	db: SnapshotDb,
	actorEntityRef: EntityRef,
): ParticipantSessionStatus | null {
	const actorEntityId = resolveEntityId(db, actorEntityRef);
	const entityRows = rows<EntityRow>(db, "entity");
	if (actorEntityId === undefined) return null;
	const actorEntityIdText = String(actorEntityId);
	const active = readActiveSessionWithRosterForParticipant(db, actorEntityIdText);
	if (active === null) return null;
	return {
		in_session: true,
		session_id: String(active.session.sessionId),
		session_definition_id: active.session.sessionDefId,
		lifecycle: active.session.lifecycle,
		current_actor: active.session.currentActor,
		my_turn: active.session.currentActor === actorEntityIdText,
		participant_count: active.participants.length,
		roster: active.participants.map((participant) => ({
			actor_id: asEntityRef(participant.actorId),
			ordinal: participant.ordinal,
			name: participantName(entityRows, participant.actorId),
		})),
	};
}

function participantName(entityRows: readonly EntityRow[], actorId: string): string | null {
	const name = asString(entityRows.find((row) => String(row.entityId) === actorId)?.name);
	return name === "" ? null : name;
}
