import type {
	ActorSpatialLocationRow,
	EntityLocationRow,
	ObjectStateRow,
	PlaceEdgeRow,
	PlaceNodeRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import {
	asString,
	buildEntityDescriptionMap,
	buildEntitySummaryMap,
	type EntitySummary,
	resolveEntityId,
	rows,
	tagString,
} from "./_helpers";
import { type ActorConditionRow, buildEntityConditionsMap } from "./actor_snapshot";
import {
	buildPublicArtIndex,
	type EntityArt,
	lookupPublicEntityArt,
	lookupPublicSubjectArt,
} from "./entity_art";
import { type LocationSnapshot, readLocationSnapshot } from "./location_snapshot";
import { readTracesAt } from "./traces";

/** Public hero-owned appearance prose (creation adopt → object_state Text). */
const APPEARANCE_STATE_ID = "srd/appearance";

export const requiredTables: RequiredTables<
	[
		"visible_actor_spatial_location",
		"visible_place_node",
		"visible_place_edge",
		"place_edge_affordance",
		"visible_place_graph_definition",
		"entity",
		"visible_entity_tag",
		"visible_entity_tag_coverage",
		"visible_entity_location",
		"visible_trace",
		"visible_target_condition",
		"entity_description",
		"visible_object_state",
		"public_metadata_attachment",
		"visible_metadata_attachment",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
	]
> = [
	"visible_actor_spatial_location",
	"visible_place_node",
	"visible_place_edge",
	"place_edge_affordance",
	"visible_place_graph_definition",
	"entity",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
	"visible_entity_location",
	"visible_trace",
	"visible_target_condition",
	"entity_description",
	"visible_object_state",
	"public_metadata_attachment",
	"visible_metadata_attachment",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
];
registerReaderManifest({ requiredTables });

export type SceneTargetKind = "actor" | "entity" | "exit" | "trace";

export interface SceneTarget {
	kind: SceneTargetKind;
	id: string;
	label: string;
	detail: Record<string, unknown>;
}

export interface CurrentSceneProjection {
	node_id: string;
	/** Authored display name of the current place ("" when the node has none). */
	node_display_name: string;
	node_description: string;
	graph_description: string;
	pose_elevation: number | null;
	/** Public place art (`place_node` wins over `place_graph`). */
	art?: EntityArt;
	counts: Record<SceneTargetKind, number>;
	targets: SceneTarget[];
}

// U4 (tool-ux-decision-log.md): scene_detail on a co-located actor used to
// deliver only {entity_id, name, faction} — nothing beyond the listing row,
// so the drill-down call cost but never paid off. `description` (authored
// sideband prose, `entity_description`, #1968), `appearance` (Public Text
// object_state `srd/appearance` from character creation), and `conditions`
// (the SAME visibility-filtered view `readActorSnapshot` surfaces for the
// connected actor's OWN body) close that gap for a THIRD-PARTY target: all
// three fields are always present (never omitted), "" / [] being the
// canonical "nothing authored/applied" shapes — never an error, matching
// every other always-present field on this target (e.g. `faction: null`).
// `entity_def_id` (sk-jay0.1.8.63.9) is no new disclosure — the `entity`
// scene target already carries it via the same `summaries` map below; this
// only closes the gap for the `actor` target.
function actorTargets(
	location: LocationSnapshot,
	selfEntityId: string,
	descriptions: Map<string, string>,
	conditions: Map<string, ActorConditionRow[]>,
	appearances: Map<string, string>,
	summaries: Map<string, EntitySummary>,
): SceneTarget[] {
	return location.actor_details
		.filter((actor) => actor.entity_id !== selfEntityId)
		.map((actor) => ({
			kind: "actor" as const,
			id: actor.entity_id,
			label: actor.name || `entity:${actor.entity_id}`,
			detail: {
				entity_id: actor.entity_id,
				name: actor.name,
				faction: actor.faction,
				entity_def_id: summaries.get(actor.entity_id)?.entity_def_id ?? "",
				description: descriptions.get(actor.entity_id) ?? "",
				appearance: appearances.get(actor.entity_id) ?? "",
				conditions: conditions.get(actor.entity_id) ?? [],
			},
		}));
}

function dslTextValue(value: unknown): string | null {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (tagString(record.tag) === "Text") {
		const inner = record.value;
		return inner === undefined || inner === null ? "" : String(inner);
	}
	if ("Text" in record) {
		const inner = record.Text;
		return inner === undefined || inner === null ? "" : String(inner);
	}
	return null;
}

function buildAppearanceMap(db: SnapshotDb): Map<string, string> {
	const out = new Map<string, string>();
	for (const row of rows<ObjectStateRow>(db, "visible_object_state")) {
		if (asString(row.stateId) !== APPEARANCE_STATE_ID) continue;
		const targetKind = tagString(row.targetKind);
		if (targetKind !== "entity" && targetKind !== "Entity") continue;
		const text = dslTextValue(row.value);
		if (text === null || text.length === 0) continue;
		out.set(String(row.targetId), text);
	}
	return out;
}

/** Current authorized scene. No caller-supplied node is accepted. */
export function readCurrentScene(
	db: SnapshotDb,
	actorId: EntityRef,
): CurrentSceneProjection | null {
	const selfId = resolveEntityId(db, actorId);
	if (selfId === undefined) return null;
	const locationRow = rows<ActorSpatialLocationRow>(db, "visible_actor_spatial_location").find(
		(row) => String(row.entityId) === String(selfId),
	);
	if (locationRow === undefined) return null;
	const nodeId = String(locationRow.placeNodeId);
	const location = readLocationSnapshot(db, nodeId);
	if (location === null) return null;

	const summaries = buildEntitySummaryMap(db);
	const actors = actorTargets(
		location,
		String(selfId),
		buildEntityDescriptionMap(db),
		buildEntityConditionsMap(db),
		buildAppearanceMap(db),
		summaries,
	);
	const actorIds = new Set(location.actors_here);
	const entities: SceneTarget[] = rows<EntityLocationRow>(db, "visible_entity_location")
		.filter((row) => String(row.placeNodeId) === nodeId)
		.filter((row) => !actorIds.has(String(row.entityId)))
		.map((row) => {
			const id = String(row.entityId);
			const summary = summaries.get(id);
			return {
				kind: "entity" as const,
				id,
				label: summary?.name || `entity:${id}`,
				detail: {
					entity_id: id,
					name: summary?.name ?? "",
					entity_def_id: summary?.entity_def_id ?? "",
					entity_kind: summary?.kind ?? "",
					quantity: summary?.quantity ?? 0,
				},
			};
		});
	const exits: SceneTarget[] = location.outgoing_edges.map((edge) => ({
		kind: "exit",
		id: edge.edge_id,
		label: edge.direction ?? edge.to_node_id,
		detail: {
			...(edge as unknown as Record<string, unknown>),
			// Destination display name, so a listing can say "Common Room" instead
			// of a node id (hosts used to pay a scene_detail round trip for this).
			to_display_name: readLocationSnapshot(db, edge.to_node_id)?.node_display_name ?? "",
		},
	}));
	const traces: SceneTarget[] = readTracesAt(db, "place_node", nodeId).map((trace) => ({
		kind: "trace",
		id: trace.trace_id,
		label: trace.kind,
		detail: trace as unknown as Record<string, unknown>,
	}));
	const targets = [...actors, ...entities, ...exits, ...traces].sort(
		(a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
	);
	// One art index per scene read: a per-target scan of `metadata_attachment`
	// was a third of npc-host CPU at rest (sk-jay0.6.15.56.24.5).
	const artIndex = buildPublicArtIndex(db);
	for (const target of targets) {
		if (target.kind === "actor" || target.kind === "entity") {
			const art = lookupPublicEntityArt(
				artIndex,
				target.id,
				summaries.get(target.id)?.entity_def_id ?? "",
			);
			if (art) target.detail.art = art;
			continue;
		}
		if (target.kind === "exit") {
			const edge = rows<PlaceEdgeRow>(db, "visible_place_edge").find(
				(row) => asString(row.edgeId) === target.id,
			);
			const edgeKey = edge ? asString(edge.edgeKey) : "";
			const art = lookupPublicSubjectArt(artIndex, [
				{ kind: "place_edge", ref: target.id },
				...(edgeKey !== "" ? [{ kind: "place_edge", ref: edgeKey }] : []),
			]);
			if (art) target.detail.art = art;
		}
	}
	const graphId = asString(
		rows<PlaceNodeRow>(db, "visible_place_node").find((row) => asString(row.nodeId) === nodeId)
			?.placeGraphId,
	);
	const placeArt = lookupPublicSubjectArt(artIndex, [
		{ kind: "place_node", ref: nodeId },
		...(graphId !== "" ? [{ kind: "place_graph", ref: graphId }] : []),
	]);
	const counts: Record<SceneTargetKind, number> = { actor: 0, entity: 0, exit: 0, trace: 0 };
	for (const target of targets) counts[target.kind] += 1;
	return {
		node_id: nodeId,
		node_display_name: location.node_display_name,
		node_description: location.node_description,
		graph_description: location.graph_description,
		pose_elevation: location.pose_elevation,
		...(placeArt ? { art: placeArt } : {}),
		counts,
		targets,
	};
}
