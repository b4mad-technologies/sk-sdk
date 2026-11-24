import type {
	ActorSpatialLocationRow,
	EntityRow,
	EvaluationProvenanceRow,
	ObjectStateRow,
	PlaceEdgeAffordanceRow,
	PlaceEdgeRow,
	PlaceGraphDefinitionRow,
	PlaceNodeRow,
	WorldEventRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString, resolveEntityId, rows } from "./_helpers";
import { activeSessionForParticipant } from "./combat_session_active";
import { latestFeedback } from "./combat_session_feedback";
import { gridForSession } from "./combat_session_grid";
import { buildRoster, nextRosterEntry } from "./combat_session_roster";

export type {
	CombatFeedback,
	CombatGridCell,
	CombatMove,
	CombatRosterEntry,
	CombatSessionView,
} from "./combat_session_types";

import type { EntityRef } from "../ids";
import type { CombatSessionView } from "./combat_session_types";

export const requiredTables: RequiredTables<
	[
		"visible_session",
		"visible_session_participant",
		"visible_actor_spatial_location",
		"entity",
		"visible_object_state",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"visible_place_graph_definition",
		"visible_place_node",
		"visible_place_edge",
		"place_edge_affordance",
		"visible_evaluation_provenance",
		"visible_world_event",
	]
> = [
	"visible_session",
	"visible_session_participant",
	"visible_actor_spatial_location",
	"entity",
	"visible_object_state",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"visible_place_graph_definition",
	"visible_place_node",
	"visible_place_edge",
	"place_edge_affordance",
	"visible_evaluation_provenance",
	// `world_event` is private (#915 PR-8); read the per-caller dispatch view.
	"visible_world_event",
];
registerReaderManifest({ requiredTables });

export function readCombatSessionView(
	db: SnapshotDb,
	actorRef: EntityRef,
): CombatSessionView | null {
	const heroEntity = resolveEntityId(db, actorRef);
	const graphs = rows<PlaceGraphDefinitionRow>(db, "visible_place_graph_definition");
	const nodes = rows<PlaceNodeRow>(db, "visible_place_node");
	const edges = rows<PlaceEdgeRow>(db, "visible_place_edge");
	const edgeAffordances = rows<PlaceEdgeAffordanceRow>(db, "place_edge_affordance");
	const spatialRows = rows<ActorSpatialLocationRow>(db, "visible_actor_spatial_location");
	const entityRows = rows<EntityRow>(db, "entity");
	const stateRows = rows<ObjectStateRow>(db, "visible_object_state");
	const provenanceRows = rows<EvaluationProvenanceRow>(db, "visible_evaluation_provenance");
	const eventRows = rows<WorldEventRow>(db, "visible_world_event");
	const heroId = heroEntity === undefined ? undefined : String(heroEntity);
	if (heroId === undefined) return null;

	const active = activeSessionForParticipant(db, heroId);
	if (active === null) return null;

	const positions = new Map(
		spatialRows.map((row) => [String(row.entityId), asString(row.placeNodeId)]),
	);
	const roster = buildRoster(
		active.participants,
		active.session.currentActor,
		heroId,
		entityRows,
		stateRows,
		positions,
		nodes,
	);
	const currentActorName =
		roster.find((entry) => entry.isCurrent)?.name ?? `entity:${active.session.currentActor}`;
	const nextActorName = nextRosterEntry(roster, active.session.currentActor)?.name ?? null;
	const isHeroTurn = active.session.currentActor === heroId;

	return {
		session: active.session,
		roster,
		currentActorName,
		nextActorName,
		isHeroTurn,
		waitingReason: isHeroTurn ? null : `Waiting for ${currentActorName}. It is not your turn.`,
		grid: gridForSession(
			active.session.sessionId,
			heroId,
			graphs,
			nodes,
			edges,
			edgeAffordances,
			roster,
			positions,
		),
		feedback: latestFeedback(heroId, provenanceRows, eventRows),
	};
}
