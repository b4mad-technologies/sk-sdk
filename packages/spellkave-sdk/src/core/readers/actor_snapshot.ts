// Reader: actor snapshot (actor_spatial_location + visible_target_condition).
// Conditions on an actor are stored in the server-filtered `visible_target_condition`
// table keyed by (target_kind="entity", target_id=<entity_id u64>). The
// reader resolves the caller's actor_id string to a numeric entity_id by
// accepting "entity:N", bare N, or a manifest-authored entity key suffix.

import type { ActorSpatialLocationRow, TargetConditionRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import {
	asNumber,
	buildEntityFactionMap,
	buildEntityNameMap,
	optNumber,
	optString,
	resolveEntityId,
	rows,
} from "./_helpers";
import { type ActorStateEntry, type ReadActorStatesOptions, readActorStates } from "./actor_states";

export const requiredTables: RequiredTables<
	[
		"visible_actor_spatial_location",
		"visible_target_condition",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"owned_object_state",
		"resource_definition",
		"resource_definition_tag",
		"entity",
		"visible_entity_tag",
		"visible_entity_tag_coverage",
	]
> = [
	"visible_actor_spatial_location",
	"visible_target_condition",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"owned_object_state",
	"resource_definition",
	"resource_definition_tag",
	"entity",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
];
registerReaderManifest({ requiredTables });

// §11.8 (2026-05-23): the server now types `target_kind` as the SpacetimeType
// enum `TargetKind { Entity, Item, WorldObject }`. The generated SDK binding
// represents the column as a tagged union `{ tag: "Entity" | "Item" |
// "WorldObject" }` rather than a lowercase string. Comparison uses the tag
// PascalCase, not the legacy "entity"/"item"/"world_object" wire form.
const TARGET_KIND_ENTITY_TAG = "Entity" as const;

export interface ActorConditionRow {
	condition_definition_id: string;
	applied_at_tick: number;
	expires_at_tick?: number;
	stack_count: number;
	bundle_id: string;
	source_id: string;
}

export interface ActorSnapshot {
	actor_id: EntityRef;
	current_node_id?: string;
	/**
	 * Authored instance name from the `entity` table (#1849). Empty string is
	 * unreachable in practice — every seeded entity carries a name — but is the
	 * fallback if a snapshot host somehow lacks the row.
	 */
	entity_name: string;
	/**
	 * The actor's first `faction:<name>` tag suffix (e.g. "cragmaw"), or `null`
	 * if it carries no faction tag (#1849 — was previously unreadable from this
	 * snapshot, leaving combat targets anonymous/faction-blind).
	 */
	faction: string | null;
	conditions: ActorConditionRow[];
	/**
	 * The actor's own object-state pools (hp, ability scores, quest stages, …),
	 * enumerated and enriched with authored display names + tags (#1229). Lets a
	 * player read its own sheet — including a `quest`-tagged objective's progress
	 * — without already knowing any state-id. Empty when the actor carries none.
	 */
	states: ActorStateEntry[];
}

/**
 * Read per-actor snapshot. Returns `null` if actor has no `actor_spatial_location` row.
 * `stateOpts` passes through to {@link readActorStates} (#1839 bounded view) —
 * omitted by default, so existing callers see the full `states` list unchanged.
 */
export function readActorSnapshot(
	db: SnapshotDb,
	actorId: EntityRef,
	stateOpts: ReadActorStatesOptions = {},
): ActorSnapshot | null {
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return null;
	const locRows = rows<ActorSpatialLocationRow>(db, "visible_actor_spatial_location");
	const entityIdText = String(entityId);
	const loc = locRows.find((r) => String(r.entityId) === entityIdText);
	if (!loc) return null;

	const conditions = buildEntityConditionsMap(db).get(entityIdText) ?? [];

	const node = optString(loc.placeNodeId);
	const entityName = buildEntityNameMap(db).get(entityIdText) ?? "";
	const faction = buildEntityFactionMap(db).get(entityIdText) ?? null;
	const out: ActorSnapshot = {
		actor_id: actorId,
		entity_name: entityName,
		faction,
		conditions,
		states: readActorStates(db, actorId, stateOpts),
	};
	if (node !== undefined) out.current_node_id = node;
	return out;
}

/**
 * Server-filtered conditions on an entity, independent of whether its place
 * node is currently in the caller's location projection.
 *
 * `readActorSnapshot` is location-gated (co-located scene roster). Act receipts
 * must not be: targeting reach can outrun co-location (ranged), while
 * `visible_target_condition` already discloses what the caller is entitled to
 * know about that body (Public/`observable` conditions such as `dead`).
 * Returns `null` only when `actorId` does not resolve to an entity id.
 */
export function readActorConditions(
	db: SnapshotDb,
	actorId: EntityRef,
): ActorConditionRow[] | null {
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return null;
	return buildEntityConditionsMap(db).get(String(entityId)) ?? [];
}

/**
 * Map of entity id (string) -> its visible conditions, built once from
 * `visible_target_condition` — batch form of the per-entity filter above
 * (same "batch join" pattern as `buildEntityFactionMap`/`buildEntityNameMap`,
 * `_helpers.ts`), for a reader that enriches many entities per call (scene
 * actor detail, U4 — `tool-ux-decision-log.md`). `readActorSnapshot` itself
 * uses this too rather than duplicating the filter.
 */
export function buildEntityConditionsMap(db: SnapshotDb): Map<string, ActorConditionRow[]> {
	const out = new Map<string, ActorConditionRow[]>();
	for (const r of rows<TargetConditionRow>(db, "visible_target_condition")) {
		const tk = r.targetKind as unknown as { tag?: string } | string;
		// Accept either the new tagged shape (live SDK) or the legacy
		// lowercase string (snapshot-host fakes that haven't regenerated).
		const tag = typeof tk === "string" ? tk : (tk?.tag ?? "");
		if (tag !== TARGET_KIND_ENTITY_TAG && tag !== "entity") continue;
		const id = String(r.targetId);
		const bucket = out.get(id);
		if (bucket === undefined) out.set(id, [toConditionRow(r)]);
		else bucket.push(toConditionRow(r));
	}
	for (const bucket of out.values()) bucket.sort(compareConditionRows);
	return out;
}

function compareText(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function compareConditionRows(left: ActorConditionRow, right: ActorConditionRow): number {
	return (
		compareText(left.condition_definition_id, right.condition_definition_id) ||
		left.applied_at_tick - right.applied_at_tick ||
		compareText(left.bundle_id, right.bundle_id) ||
		compareText(left.source_id, right.source_id) ||
		left.stack_count - right.stack_count ||
		(left.expires_at_tick ?? Number.MAX_SAFE_INTEGER) -
			(right.expires_at_tick ?? Number.MAX_SAFE_INTEGER)
	);
}

function toConditionRow(r: TargetConditionRow): ActorConditionRow {
	const expires = optNumber(r.expiresAtTick);
	const out: ActorConditionRow = {
		condition_definition_id: r.conditionDefinitionId,
		applied_at_tick: asNumber(r.appliedAtTick),
		stack_count: asNumber(r.stackCount),
		bundle_id: r.bundleId,
		source_id: r.sourceId,
	};
	if (expires !== undefined && Number.isFinite(expires)) out.expires_at_tick = expires;
	return out;
}
