import type { EntityContainmentRow as DbEntityContainmentRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import {
	asNumber,
	asString,
	buildEntitySummaryMap,
	optString,
	resolveEntityId,
	rows,
} from "./_helpers";

export const requiredTables: RequiredTables<
	[
		"visible_entity_containment",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"entity",
	]
> = [
	"visible_entity_containment",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"entity",
];
registerReaderManifest({ requiredTables });

export interface InventoryQueryItem {
	entity_id: string;
	container_id: string;
	depth: number;
	container_path: string[];
	slot_id: string;
	/** Authored attach direction, e.g. for a mounted/anchored container slot.
	 * Omitted (not "") when unauthored. */
	direction?: string;
	inserted_at_tick: number;
	name: string;
	entity_def_id: string;
	kind: string;
	quantity: number;
}

export interface InventoryProjection {
	root_entity_id: string;
	items: InventoryQueryItem[];
	truncated: boolean;
	max_depth: number;
	max_items: number;
}

export interface ReadInventoryProjectionOptions {
	maxDepth?: number;
	maxItems?: number;
}

const DEFAULT_MAX_DEPTH = 8;
const DEFAULT_MAX_ITEMS = 200;

/**
 * Traverse the server-authorized containment projection from one implicit body.
 * Rows are deterministic by depth then entity id. Cycles are ignored and
 * traversal fails bounded rather than exposing unrelated roots.
 */
export function readInventoryProjection(
	db: SnapshotDb,
	actorId: EntityRef,
	options: ReadInventoryProjectionOptions = {},
): InventoryProjection | null {
	const root = resolveEntityId(db, actorId);
	if (root === undefined) return null;
	const maxDepth = Math.max(0, Math.min(32, Math.trunc(options.maxDepth ?? DEFAULT_MAX_DEPTH)));
	const maxItems = Math.max(1, Math.min(1_000, Math.trunc(options.maxItems ?? DEFAULT_MAX_ITEMS)));
	const summaries = buildEntitySummaryMap(db);
	const byContainer = new Map<string, DbEntityContainmentRow[]>();
	for (const row of rows<DbEntityContainmentRow>(db, "visible_entity_containment")) {
		const key = String(row.containerId);
		const bucket = byContainer.get(key) ?? [];
		bucket.push(row);
		byContainer.set(key, bucket);
	}
	for (const bucket of byContainer.values()) {
		bucket.sort((a, b) =>
			String(a.entityId).localeCompare(String(b.entityId), undefined, { numeric: true }),
		);
	}

	const items: InventoryQueryItem[] = [];
	const visited = new Set<string>([String(root)]);
	const queue: { containerId: string; depth: number; path: string[] }[] = [
		{ containerId: String(root), depth: 0, path: [String(root)] },
	];
	let truncated = false;
	while (queue.length > 0) {
		const current = queue.shift();
		if (current === undefined) break;
		const children = byContainer.get(current.containerId) ?? [];
		for (const row of children) {
			const entityId = String(row.entityId);
			if (visited.has(entityId)) continue;
			if (current.depth > maxDepth || items.length >= maxItems) {
				truncated = true;
				continue;
			}
			visited.add(entityId);
			const summary = summaries.get(entityId);
			const path = [...current.path, entityId];
			const direction = optString(row.direction);
			items.push({
				entity_id: entityId,
				container_id: String(row.containerId),
				depth: current.depth,
				container_path: path,
				slot_id: asString(row.slotId),
				...(direction === undefined ? {} : { direction }),
				inserted_at_tick: asNumber(row.insertedAtTick),
				name: summary?.name ?? "",
				entity_def_id: summary?.entity_def_id ?? "",
				kind: summary?.kind ?? "",
				quantity: summary?.quantity ?? 0,
			});
			if (current.depth < maxDepth) {
				queue.push({ containerId: entityId, depth: current.depth + 1, path });
			} else if ((byContainer.get(entityId)?.length ?? 0) > 0) {
				truncated = true;
			}
		}
	}

	items.sort(
		(a, b) =>
			a.depth - b.depth || a.entity_id.localeCompare(b.entity_id, undefined, { numeric: true }),
	);
	return {
		root_entity_id: String(root),
		items,
		truncated,
		max_depth: maxDepth,
		max_items: maxItems,
	};
}
