// Reader: location snapshot (place_node + place_edge + actor_spatial_location).
// Mechanical split from readers.ts; no new functionality.

import type {
	ActorSpatialLocationRow,
	PlaceEdgeAffordanceRow,
	PlaceEdgeRow,
	PlaceGraphDefinitionRow,
	PlaceNodeRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString, buildEntityFactionMap, buildEntityNameMap, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"visible_place_node",
		"visible_place_edge",
		"place_edge_affordance",
		"visible_actor_spatial_location",
		"visible_place_graph_definition",
		"entity",
		"visible_entity_tag",
		"visible_entity_tag_coverage",
	]
> = [
	"visible_place_node",
	"visible_place_edge",
	"place_edge_affordance",
	"visible_actor_spatial_location",
	"visible_place_graph_definition",
	"entity",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
];
registerReaderManifest({ requiredTables });

/**
 * One `place_edge_affordance` row paired with an edge — ADR-0101 D-1 added
 * `mode_id` (open author-chosen traversal-mode id; `""` = the implicit
 * default mode) alongside the template it names.
 */
export interface EdgeAffordanceBinding {
	template_id: string;
	mode_id: string;
}

export interface LocationOutgoingEdge {
	edge_id: string;
	to_node_id: string;
	direction: string | null;
	/**
	 * Affordance templates paired with this edge (`place_edge_affordance`),
	 * i.e. what an actor would have to satisfy to traverse it (#1987), each
	 * with its `mode_id` (ADR-0101 D-1) — rows sharing one `mode_id` AND-join;
	 * distinct `mode_id`s on the same edge are alternatives (OR, the kernel
	 * picks the cheapest passing one). NOTE: this reads ONLY authored
	 * `place_edge_affordance` rows on the edge itself — a `movement_default`
	 * resolved via edge > graph > bundle inheritance (ADR-0101 D-2) is NOT
	 * projected here yet, so a zero-per-edge-row edge (A-1's own idiom) shows
	 * an empty array even though it may still be traversable.
	 *
	 * TOPOLOGY, not permission: this says which gate stands here, never whether
	 * a given actor passes it — that answer lives in the actor's affordance
	 * palette, which is deliberately a different question and a different
	 * layer. A caller joins the two to tell "there is a way, currently shut"
	 * apart from "there is no way", which was previously indistinguishable.
	 *
	 * Empty for an edge with no paired template.
	 */
	affordance_bindings: EdgeAffordanceBinding[];
}

/**
 * An actor present at this node, enriched with authored identity (#1849).
 * Sibling of the bare `actors_here` id list (kept for existing identity/
 * co-location callers — SDK CLAUDE.md §2 host-neutral row types stay stable);
 * this is the display-oriented view for a perceiver that needs to know WHO is
 * here, not just that someone is.
 */
export interface LocationActorEntry {
	entity_id: string;
	/** Authored instance name from the `entity` table. */
	name: string;
	/** First `faction:<name>` tag suffix on this entity, or `null` if untagged. */
	faction: string | null;
}

export interface LocationSnapshot {
	node_id: string;
	/**
	 * Authored display name for this place node (`place_node.display_name`) —
	 * e.g. for `{place_name}` interpolation in authored observation prose
	 * (#1968 B-9). Distinct from `node_description`: a name, not atmospheric
	 * prose.
	 */
	node_display_name: string;
	/**
	 * Authored atmospheric prose for this place node. Graph-static authored
	 * content; empty string when no description has been authored.
	 * NOT a hidden-state channel — conditional reveals use affordance +
	 * observer_knowledge, never gated description text (ADR-0021 perception
	 * residual).
	 */
	node_description: string;
	/**
	 * Authored atmospheric prose for the graph containing this node. Empty
	 * string when no description has been authored on the graph.
	 * Same static-prose guarantee as node_description.
	 */
	graph_description: string;
	/**
	 * Authored Z-axis elevation of the node in world units (positive = above
	 * ground, negative = underground). `null` when `pose_elevation_present=false`
	 * (elevation not authored for this node).
	 */
	pose_elevation: number | null;
	outgoing_edges: LocationOutgoingEdge[];
	/** Bare entity ids of actors present — the identity/co-location list existing
	 * callers filter/compare against. */
	actors_here: string[];
	/** Same actors as `actors_here`, enriched with name + faction (#1849) — the
	 * display list for surfaces that must not leave a target anonymous. */
	actor_details: LocationActorEntry[];
}

const COMPASS = [
	"east",
	"northeast",
	"north",
	"northwest",
	"west",
	"southwest",
	"south",
	"southeast",
] as const;

function metricDirection(fromX: number, fromY: number, toX: number, toY: number): string {
	const dx = toX - fromX;
	const dy = toY - fromY;
	const deg = Math.atan2(dy, dx) * (180 / Math.PI);
	const normalised = deg < 0 ? deg + 360 : deg;
	const sector = Math.floor((normalised + 22.5) / 45) % 8;
	// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
	return COMPASS[sector]!; // sector is always 0–7 via % 8
}

/**
 * Read per-location snapshot. Returns `null` if `visible_place_node` does not contain `nodeId`.
 */
export function readLocationSnapshot(db: SnapshotDb, nodeId: string): LocationSnapshot | null {
	const allNodes = rows<PlaceNodeRow>(db, "visible_place_node");
	const nodeMap = new Map(allNodes.map((n) => [n.nodeId, n]));
	const node = nodeMap.get(nodeId);
	if (!node) return null;

	const graphRow = rows<PlaceGraphDefinitionRow>(db, "visible_place_graph_definition").find(
		(g) => g.placeGraphId === node.placeGraphId,
	);

	// `place_edge_affordance` keys by the AUTHORED `edge_key`, not the runtime
	// `edge_id`, so the join goes through `place_edge`'s own `edge_key` column.
	const bindingsByEdgeKey = new Map<string, EdgeAffordanceBinding[]>();
	for (const row of rows<PlaceEdgeAffordanceRow>(db, "place_edge_affordance")) {
		const key = asString(row.edgeKey);
		const binding: EdgeAffordanceBinding = {
			template_id: asString(row.affordanceTemplateId),
			mode_id: asString(row.modeId),
		};
		const list = bindingsByEdgeKey.get(key);
		if (list === undefined) bindingsByEdgeKey.set(key, [binding]);
		else list.push(binding);
	}

	const outgoing_edges = rows<PlaceEdgeRow>(db, "visible_place_edge")
		.filter((r) => r.fromNodeId === nodeId)
		.map((r): LocationOutgoingEdge => {
			const toNode = nodeMap.get(r.toNodeId);
			const direction =
				node.posPresent && toNode?.posPresent
					? metricDirection(node.posX, node.posY, toNode.posX, toNode.posY)
					: null;
			return {
				edge_id: asString(r.edgeId),
				to_node_id: r.toNodeId,
				direction,
				affordance_bindings: bindingsByEdgeKey.get(asString(r.edgeKey)) ?? [],
			};
		});

	const entityNames = buildEntityNameMap(db);
	const entityFactions = buildEntityFactionMap(db);
	const actors_here = rows<ActorSpatialLocationRow>(db, "visible_actor_spatial_location")
		.filter((r) => r.placeNodeId === nodeId)
		.map((r) => String(r.entityId))
		.filter((s) => s.length > 0);
	const actor_details: LocationActorEntry[] = actors_here.map((entityId) => ({
		entity_id: entityId,
		name: entityNames.get(entityId) ?? "",
		faction: entityFactions.get(entityId) ?? null,
	}));

	return {
		node_id: nodeId,
		node_display_name: node.displayName ?? "",
		node_description: node.description ?? "",
		graph_description: graphRow?.description ?? "",
		pose_elevation: node.poseElevationPresent ? node.poseElevation : null,
		outgoing_edges,
		actors_here,
		actor_details,
	};
}
