import type { EntityRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asNumber, asString, resolveEntityId, rows } from "./_helpers";

export const requiredTables: RequiredTables<
	["entity", "visible_manifest_authored_entity", "visible_manifest_authored_entity_coverage"]
> = ["entity", "visible_manifest_authored_entity", "visible_manifest_authored_entity_coverage"];
registerReaderManifest({ requiredTables });

export interface BundleEntityRow {
	entity_id: string;
	entity_key: string | null;
	entity_def_id: string;
	name: string;
	kind: string;
	created_at_tick: number;
	quantity: number;
	owned_by_entity_id: string;
}

export type BundleItemRow = BundleEntityRow & { kind: "item" };

export function readEntity(db: SnapshotDb, entityKey: EntityRef): BundleEntityRow | null {
	const entityId = resolveEntityId(db, entityKey);
	const entityRows = rows<EntityRow>(db, "entity");
	if (entityId === undefined) return null;
	const entity = entityRows.find((r) => r.entityId === entityId);
	return entity ? toEntityRow(db, entity, entityKey) : null;
}

export function readItem(db: SnapshotDb, itemKey: EntityRef): BundleItemRow | null {
	const entity = readEntity(db, itemKey);
	return entity?.kind === "item" ? (entity as BundleItemRow) : null;
}

function toEntityRow(db: SnapshotDb, row: EntityRow, lookupKey: string): BundleEntityRow {
	return {
		entity_id: String(row.entityId),
		entity_key: entityKeyFor(db, row.entityId, lookupKey),
		entity_def_id: asString(row.entityDefId),
		name: asString(row.name),
		kind: asString(row.kind),
		created_at_tick: asNumber(row.createdAtTick),
		quantity: asNumber(row.quantity),
		owned_by_entity_id: String(row.ownedByEntityId),
	};
}

function entityKeyFor(db: SnapshotDb, entityId: bigint, lookupKey: string): string | null {
	const authored = rows<{ manifestKey: string; entityId: bigint }>(
		db,
		"visible_manifest_authored_entity",
	).find((r) => r.entityId === entityId);
	if (!authored) return null;
	const idx = authored.manifestKey.indexOf(":");
	return idx >= 0 ? authored.manifestKey.slice(idx + 1) : lookupKey;
}
