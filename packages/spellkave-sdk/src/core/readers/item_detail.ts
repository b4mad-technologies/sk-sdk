import type {
	EntityDefinitionRow,
	EntityDescriptionRow,
	EntityEquipmentSlotRow,
	EquipmentSlotDefinitionRow,
	ObjectStateDefinitionRow,
	ObjectStateRow,
	ResourceDefinitionRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asNumber, asString, rows } from "./_helpers";
import { type EntityArt, readPublicEntityArt } from "./entity_art";
import { readInventoryProjection } from "./inventory_query";

export const requiredTables: RequiredTables<
	[
		"visible_entity_containment",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"entity",
		"visible_entity_equipment_slot",
		"equipment_slot_definition",
		"owned_object_state",
		"entity_definition",
		"entity_description",
		"object_state_definition",
		"resource_definition",
		"public_metadata_attachment",
		"visible_metadata_attachment",
	]
> = [
	"visible_entity_containment",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"entity",
	"visible_entity_equipment_slot",
	"equipment_slot_definition",
	"owned_object_state",
	"entity_definition",
	"entity_description",
	"object_state_definition",
	"resource_definition",
	"public_metadata_attachment",
	"visible_metadata_attachment",
];
registerReaderManifest({ requiredTables });

export interface ItemStateSlice {
	state_id: string;
	display_name?: string;
	/** Authored resource prose for this owned state; absent when unavailable. */
	description?: string;
	value: string;
	source_template_id: string;
	set_at_tick: number;
	expires_at_tick: number;
	bundle_id: string;
}

export interface ItemEquipmentRole {
	owner_entity_id: string;
	slot_id: string;
	slot_label: string;
	equipped_at_tick: number;
}

export interface ItemDetailProjection {
	entity_id: string;
	art?: EntityArt;
	/** Authored instance prose, falling back to its definition; absent when unauthored. */
	description?: string;
	name: string;
	entity_def_id: string;
	kind: string;
	quantity: number;
	containment: {
		container_id: string;
		depth: number;
		container_path: string[];
		slot_id: string;
		/** Authored attach direction. Omitted (not "") when unauthored. */
		direction?: string;
	};
	equipment: ItemEquipmentRole | null;
	states: ItemStateSlice[];
}

/**
 * Resolve one item only after it appears in the actor's authorized recursive
 * containment projection. Static entity rows never grant item-detail access.
 */
export function readAuthorizedItemDetail(
	db: SnapshotDb,
	actorId: EntityRef,
	itemEntityId: string,
): ItemDetailProjection | null {
	const inventory = readInventoryProjection(db, actorId);
	const item = inventory?.items.find((candidate) => candidate.entity_id === itemEntityId);
	if (item === undefined) return null;
	const description =
		asString(
			rows<EntityDescriptionRow>(db, "entity_description").find(
				(row) => String(row.entityId) === item.entity_id,
			)?.description,
		) ||
		asString(
			rows<EntityDefinitionRow>(db, "entity_definition").find(
				(row) => row.entityDefId === item.entity_def_id,
			)?.description,
		);
	const labels = new Map(
		rows<ObjectStateDefinitionRow>(db, "object_state_definition").map((row) => [
			row.stateId,
			row.displayName,
		]),
	);
	const descriptions = new Map<string, string>();
	for (const row of rows<ResourceDefinitionRow>(db, "resource_definition")) {
		if (row.displayName) labels.set(row.resourceDefinitionId, row.displayName);
		const prose = asString(row.description);
		if (prose.trim()) descriptions.set(row.resourceDefinitionId, prose);
	}

	// #915 PR-6: entity_equipment_slot is private; the caller's own root body
	// is always within its own visible_entity_equipment_slot subset (a caller
	// is always in its own directly-controlled-bodies scope), so this lookup
	// is unaffected in shape — only the source table changed.
	const equipmentRow = rows<EntityEquipmentSlotRow>(db, "visible_entity_equipment_slot").find(
		(row) =>
			String(row.entityId) === inventory?.root_entity_id &&
			String(row.equippedEntityId) === item.entity_id,
	);
	const slotDefinition = equipmentRow
		? rows<EquipmentSlotDefinitionRow>(db, "equipment_slot_definition").find(
				(row) => asString(row.slotId) === asString(equipmentRow.slotId),
			)
		: undefined;

	const states = rows<ObjectStateRow>(db, "owned_object_state")
		.filter(
			(row) => asString(row.targetKind) === "entity" && asString(row.targetId) === item.entity_id,
		)
		.map((row) => ({
			state_id: asString(row.stateId),
			...(labels.get(asString(row.stateId))
				? { display_name: labels.get(asString(row.stateId)) }
				: {}),
			...(descriptions.has(asString(row.stateId))
				? { description: descriptions.get(asString(row.stateId)) }
				: {}),
			value: stringifyValue(row.value),
			source_template_id: asString(row.sourceTemplateId),
			set_at_tick: asNumber(row.setAtTick),
			expires_at_tick: asNumber(row.expiresAtTick),
			bundle_id: asString(row.bundleId),
		}))
		.sort((a, b) => a.state_id.localeCompare(b.state_id));

	const art = readPublicEntityArt(db, item.entity_id, item.entity_def_id);
	return {
		entity_id: item.entity_id,
		...(art ? { art } : {}),
		...(description ? { description } : {}),
		name: item.name,
		entity_def_id: item.entity_def_id,
		kind: item.kind,
		quantity: item.quantity,
		containment: {
			container_id: item.container_id,
			depth: item.depth,
			container_path: item.container_path,
			slot_id: item.slot_id,
			...(item.direction === undefined ? {} : { direction: item.direction }),
		},
		equipment: equipmentRow
			? {
					owner_entity_id: String(equipmentRow.entityId),
					slot_id: asString(equipmentRow.slotId),
					slot_label: slotDefinition ? asString(slotDefinition.label) : "",
					equipped_at_tick: asNumber(equipmentRow.equippedAtTick),
				}
			: null,
		states,
	};
}

function stringifyValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (typeof value !== "object") return String(value);
	return JSON.stringify(value, (_key, part: unknown) =>
		typeof part === "bigint" ? part.toString() : part,
	);
}
