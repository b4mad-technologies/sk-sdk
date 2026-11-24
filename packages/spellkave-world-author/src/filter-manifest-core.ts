// Browser-safe actor-export selection. Filesystem output remains in
// filter-manifest.ts; this module only transforms manifest data.

export interface SchemaManifest {
	bundles?: Array<{ bundle_id: string; [key: string]: unknown }>;
	entities?: Array<{
		entity_key: string;
		bundle_id?: string;
		owned_by_entity_key?: string;
		[key: string]: unknown;
	}>;
	actors?: Array<{ entity_key: string; [key: string]: unknown }>;
	actor_capabilities?: Array<{ actor_entity_key: string; [key: string]: unknown }>;
	actor_spatial_locations?: Array<{ entity_key: string; [key: string]: unknown }>;
	actor_equipment_slots?: Array<{
		actor_entity_key: string;
		item_key: string;
		[key: string]: unknown;
	}>;
	entity_containment?: Array<{
		entity_key: string;
		container_entity_key: string;
		[key: string]: unknown;
	}>;
	entity_tag?: Array<{ entity_key: string; [key: string]: unknown }>;
	object_state?: Array<{ entity_key: string; expires_at_tick?: number; [key: string]: unknown }>;
	[key: string]: unknown;
}

export function filterManifestForActor(src: SchemaManifest, actorKey: string): SchemaManifest {
	const entities = src.entities ?? [];
	const actors = src.actors ?? [];
	if (
		!entities.some((row) => row.entity_key === actorKey) &&
		!actors.some((row) => row.entity_key === actorKey)
	) {
		throw new Error(`manifest export: actor '${actorKey}' not found in exported bundle`);
	}
	const keep = collectActorEntityKeys(src, actorKey);
	const kept = (key: string | undefined) => key !== undefined && keep.has(key);
	const schemaVersionKey = "schema_version";
	const out: SchemaManifest = { metadata: src.metadata };
	out[schemaVersionKey] = src[schemaVersionKey];
	const bundleIds = new Set(
		entities.filter((row) => keep.has(row.entity_key)).map((row) => row.bundle_id ?? ""),
	);
	out.bundles = (src.bundles ?? []).filter(
		(row) => bundleIds.size === 0 || bundleIds.has(row.bundle_id),
	);
	out.entities = entities.filter((row) => keep.has(row.entity_key));
	out.actors = actors.filter((row) => keep.has(row.entity_key));
	out.actor_capabilities = (src.actor_capabilities ?? []).filter((row) =>
		kept(row.actor_entity_key),
	);
	out.actor_spatial_locations = (src.actor_spatial_locations ?? []).filter((row) =>
		keep.has(row.entity_key),
	);
	out.actor_equipment_slots = (src.actor_equipment_slots ?? []).filter((row) =>
		kept(row.actor_entity_key),
	);
	out.entity_containment = (src.entity_containment ?? []).filter(
		(row) => keep.has(row.container_entity_key) && keep.has(row.entity_key),
	);
	out.entity_tag = (src.entity_tag ?? []).filter((row) => keep.has(row.entity_key));
	out.object_state = (src.object_state ?? []).filter((row) => keep.has(row.entity_key));
	return out;
}

/** Instance row kinds `filterManifestForActor` keeps (not `bundles`). */
export const INSTANCE_ROW_KINDS = [
	"entities",
	"actors",
	"actor_spatial_locations",
	"actor_capabilities",
	"actor_equipment_slots",
	"entity_containment",
	"entity_tag",
	"object_state",
] as const;

export type InstanceRowKind = (typeof INSTANCE_ROW_KINDS)[number];

export function filteredRowCount(manifest: SchemaManifest): number {
	let n = manifest.bundles?.length ?? 0;
	for (const kind of INSTANCE_ROW_KINDS) {
		const rows = manifest[kind];
		n += Array.isArray(rows) ? rows.length : 0;
	}
	return n;
}

function collectActorEntityKeys(src: SchemaManifest, actorKey: string): Set<string> {
	const keep = new Set<string>([actorKey]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const row of src.entity_containment ?? []) {
			if (keep.has(row.container_entity_key) && !keep.has(row.entity_key)) {
				keep.add(row.entity_key);
				grew = true;
			}
		}
		for (const row of src.entities ?? []) {
			if (
				row.owned_by_entity_key !== undefined &&
				row.owned_by_entity_key !== "" &&
				keep.has(row.owned_by_entity_key) &&
				!keep.has(row.entity_key)
			) {
				keep.add(row.entity_key);
				grew = true;
			}
		}
		for (const row of src.actor_equipment_slots ?? []) {
			if (keep.has(row.actor_entity_key) && !keep.has(row.item_key)) {
				keep.add(row.item_key);
				grew = true;
			}
		}
	}
	return keep;
}
