import type {
	CapabilityDefinitionRow,
	ConditionDefinitionRow,
	EntityDefinitionTagRow,
	EntityRow,
	TagCapabilityGrantRow,
	TargetConditionRow,
	VisibleCapabilityRow,
	WorldTimeRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asString, optNumber, resolveEntityId, rows, tagString } from "./_helpers";
import { isDirectlyControlled } from "./self";
import { readEntityTags } from "./tag_reads";

export const requiredTables: RequiredTables<
	[
		"visible_capability",
		"capability_definition",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"directly_controlled_actor_spatial_location",
		"actor",
		"entity",
		"entity_definition_tag",
		"tag_capability_grant",
		"visible_entity_tag",
		"visible_entity_tag_coverage",
		"visible_target_condition",
		"condition_definition",
		"world_time",
		"visible_actor_identity",
	]
> = [
	"visible_capability",
	"capability_definition",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"directly_controlled_actor_spatial_location",
	"actor",
	"entity",
	"entity_definition_tag",
	"tag_capability_grant",
	"visible_entity_tag",
	"visible_entity_tag_coverage",
	"visible_target_condition",
	"condition_definition",
	"world_time",
	"visible_actor_identity",
];
registerReaderManifest({ requiredTables });

export interface CompactSelfCapability {
	capability_id: string;
	display_name: string;
	/** Authored catalog prose; absent when unavailable or blank. */
	description?: string;
	source: string;
	extent_ref?: string;
	extent_kind_ref?: string;
	elevation_class?: string;
	expires_at_tick?: number;
}

export interface SelfCapabilityReadOptions {
	/** Include authored grant scope needed by account navigation. Off by default
	 * so existing player-facing projections keep their stable compact shape. */
	includeAuthoredGrantMetadata?: boolean;
}

/** Descriptive self-capability projection: direct grants and grants from this
 * body's admitted tags, blueprint tags and active conditions. The server still
 * decides whether an attempted act is admitted. Joins the public
 * `capability_definition` catalog for `display_name`. Falls back to the bare
 * `capability_id` when no catalog row exists (never drops the row).
 * Gated behind `isDirectlyControlled`, matching `readSelfStates`/
 * `readSelfConditions`'s own posture — perceiving a capability grant is
 * self-perception of the body's own affordance-relevant properties, the
 * same category `self_states` already occupies for resource pools
 * (finding #11, `ledger/findings.md`). */
export function readSelfCapabilities(
	db: SnapshotDb,
	actorId: EntityRef,
	options: SelfCapabilityReadOptions = {},
): CompactSelfCapability[] {
	if (!isDirectlyControlled(db, actorId)) return [];
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return [];
	const definitions = rows<CapabilityDefinitionRow>(db, "capability_definition");
	const direct = rows<VisibleCapabilityRow>(db, "visible_capability")
		.filter((row) => String(row.entityId) === String(entityId))
		.map((row) => {
			const def = definitions.find((d) => d.capabilityId === row.capabilityId);
			const expires = optNumber(row.expiresAtTick);
			const description = asString(def?.description);
			const grantMetadata = options.includeAuthoredGrantMetadata
				? {
						extent_ref: asString(row.extentRef),
						extent_kind_ref: asString(row.extentKindRef),
						elevation_class: tagString(row.elevationClass),
					}
				: {};
			return {
				capability_id: asString(row.capabilityId),
				display_name: def ? asString(def.displayName) : asString(row.capabilityId),
				...(description.trim() ? { description } : {}),
				source: asString(row.source),
				...grantMetadata,
				...(expires === undefined ? {} : { expires_at_tick: expires }),
			};
		});
	const compact = (id: string, source: string): CompactSelfCapability => {
		const def = definitions.find((row) => row.capabilityId === id);
		const description = asString(def?.description);
		return {
			capability_id: id,
			display_name: def ? asString(def.displayName) : id,
			...(description.trim() ? { description } : {}),
			source,
		};
	};
	const body = rows<EntityRow>(db, "entity").find(
		(row) => String(row.entityId) === String(entityId),
	);
	const tags = new Set(readEntityTags(db, String(entityId)));
	if (body)
		for (const row of rows<EntityDefinitionTagRow>(db, "entity_definition_tag")) {
			if (row.entityDefId === body.entityDefId) tags.add(row.tag);
		}
	const derived: CompactSelfCapability[] = [];
	for (const row of rows<TagCapabilityGrantRow>(db, "tag_capability_grant")) {
		if (tags.has(row.tag)) derived.push(compact(row.capabilityId, `tag:${row.tag}`));
	}
	const tick = rows<WorldTimeRow>(db, "world_time")[0]?.tick;
	const conditions = rows<ConditionDefinitionRow>(db, "condition_definition");
	for (const row of rows<TargetConditionRow>(db, "visible_target_condition")) {
		if (
			tagString(row.targetKind) !== "Entity" ||
			String(row.targetId) !== String(entityId) ||
			row.stackCount <= 0
		)
			continue;
		if (row.expiresAtTick !== 0n && (tick === undefined || row.expiresAtTick <= tick)) continue;
		const definition = conditions.find(
			(def) => def.conditionDefinitionId === row.conditionDefinitionId,
		);
		for (const id of definition?.grantsCapabilityWhileActive ?? []) {
			derived.push(compact(id, `condition:${row.conditionDefinitionId}`));
		}
	}
	return [...direct, ...derived].sort(
		(a, b) => a.capability_id.localeCompare(b.capability_id) || a.source.localeCompare(b.source),
	);
}
