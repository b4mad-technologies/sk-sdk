import type {
	EntityEquipmentSlotRow,
	EntityRow,
	EquipmentSlotDefinitionRow,
} from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asNumber, asString, resolveEntityId, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"visible_entity_equipment_slot",
		"equipment_slot_definition",
		"entity",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
	]
> = [
	"visible_entity_equipment_slot",
	"equipment_slot_definition",
	"entity",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
];
registerReaderManifest({ requiredTables });

export interface EquipmentSlotRow {
	slot_id: string;
	label: string;
	default_compatibility_predicate: string;
	slot_bundle_id: string;
	equipped_entity_id: string;
	equipped_entity_key: string | null;
	equipped_entity_def_id: string;
	equipped_entity_name: string;
	equipped_at_tick: number;
}

export interface EquipmentSnapshot {
	actor_key: string;
	actor_entity_id: string;
	slots: EquipmentSlotRow[];
}

export function readEquipment(db: SnapshotDb, actorKey: EntityRef): EquipmentSnapshot | null {
	const actorEntityId = resolveEntityId(db, actorKey);
	const equipmentRows = rows<EntityEquipmentSlotRow>(db, "visible_entity_equipment_slot");
	const slotDefs = new Map(
		rows<EquipmentSlotDefinitionRow>(db, "equipment_slot_definition").map((r) => [r.slotId, r]),
	);
	const entities = rows<EntityRow>(db, "entity");
	const authored = rows<{ manifestKey: string; entityId: bigint }>(
		db,
		"visible_manifest_authored_entity",
	);
	if (actorEntityId === undefined) return null;

	return {
		actor_key: actorKey,
		actor_entity_id: String(actorEntityId),
		slots: equipmentRows
			.filter((r) => r.entityId === actorEntityId)
			.map((r) => toEquipmentSlotRow(r, slotDefs.get(r.slotId), entities, authored)),
	};
}

function toEquipmentSlotRow(
	row: EntityEquipmentSlotRow,
	slotDef: EquipmentSlotDefinitionRow | undefined,
	entities: EntityRow[],
	authored: { manifestKey: string; entityId: bigint }[],
): EquipmentSlotRow {
	const equipped = entities.find((r) => r.entityId === row.equippedEntityId);
	return {
		slot_id: asString(row.slotId),
		label: slotDef ? asString(slotDef.label) : "",
		default_compatibility_predicate: slotDef ? asString(slotDef.defaultCompatibilityPredicate) : "",
		slot_bundle_id: slotDef ? asString(slotDef.bundleId) : "",
		equipped_entity_id: String(row.equippedEntityId),
		equipped_entity_key: entityKeyFor(authored, row.equippedEntityId),
		equipped_entity_def_id: equipped ? asString(equipped.entityDefId) : "",
		equipped_entity_name: equipped ? asString(equipped.name) : "",
		equipped_at_tick: asNumber(row.equippedAtTick),
	};
}

function entityKeyFor(
	authored: { manifestKey: string; entityId: bigint }[],
	entityId: bigint,
): string | null {
	const row = authored.find((r) => r.entityId === entityId);
	if (!row) return null;
	const idx = row.manifestKey.indexOf(":");
	return idx >= 0 ? row.manifestKey.slice(idx + 1) : row.manifestKey;
}
