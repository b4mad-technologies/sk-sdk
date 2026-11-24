/** Internal carrier facet. Roots must already have passed publisher admission.
 * This projection supplies no proof of full duty reference closure or readiness. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type Row = { [key: string]: Json };

export interface DmAuthorityWorld {
	role_definitions: Row[];
	role_aggregations: Row[];
	role_bindings: { binding_id: string; role_id: string }[];
	action_definitions: { required_capability: string }[];
	actor_capabilities: { actor_entity_key: string; capability_id: string }[];
	metadata_namespaces: Row[];
	capability_definitions: Row[];
	bundles: { bundle_id: string }[];
	entities: { entity_key: string; bundle_id: string }[];
}

// Same existing Job/facet bound as dm_document_authority::MAX_ARTIFACT_BYTES.
const MAX_AUTHORITY_BYTES = 8 * 1024 * 1024;

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Copy JSON without dropping undefined/NaN or invoking class serialization. */
function copyJson(value: unknown, ancestors = new Set<object>()): Json {
	if (value === null || typeof value === "string" || typeof value === "boolean") return value;
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value !== "object" || ancestors.has(value))
		throw new Error("DM authority projection requires acyclic JSON rows");
	const prototype: unknown = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
		throw new Error("DM authority projection requires plain JSON rows");
	ancestors.add(value);
	try {
		return Array.isArray(value)
			? value.map((item) => copyJson(item, ancestors))
			: Object.fromEntries(
					Object.entries(value).map(([key, item]) => [key, copyJson(item, ancestors)]),
				);
	} finally {
		ancestors.delete(value);
	}
}

function rows(world: Record<string, unknown>, table: string): Record<string, unknown>[] {
	if (!Object.hasOwn(world, table)) return [];
	const value = world[table];
	if (!Array.isArray(value) || !value.every(object))
		throw new Error(`Invalid DM authority table: ${table}`);
	return value;
}

function field(row: Record<string, unknown>, key: string): string {
	const value = row[key];
	if (typeof value !== "string") throw new Error(`Invalid DM authority column: ${key}`);
	return value;
}

/** Preserve the complete authority population from every admitted root. No
 * bundle/role/actor filtering or identity deduplication occurs here. Full rows
 * retain optional-column distinctions for shared Rust collision checks.
 * Duplicate raw JSON keys must be refused before roots reach this adapter. */
export function projectDmAuthorityWorlds(canonicalWorlds: readonly unknown[]): DmAuthorityWorld[] {
	if (!canonicalWorlds.length) throw new Error("DM authority requires canonical roots");
	const projection = canonicalWorlds.map((world): DmAuthorityWorld => {
		if (!object(world)) throw new Error("Invalid DM authority canonical root");
		const full = (table: string): Row[] => rows(world, table).map((row) => copyJson(row) as Row);
		return {
			role_definitions: full("role_definitions"),
			role_aggregations: full("role_aggregations"),
			role_bindings: rows(world, "role_bindings").map((row) => ({
				binding_id: field(row, "binding_id"),
				role_id: field(row, "role_id"),
			})),
			action_definitions: rows(world, "action_definitions").map((row) => ({
				required_capability: field(row, "required_capability"),
			})),
			actor_capabilities: rows(world, "actor_capabilities").map((row) => ({
				actor_entity_key: field(row, "actor_entity_key"),
				capability_id: field(row, "capability_id"),
			})),
			metadata_namespaces: full("metadata_namespaces"),
			capability_definitions: full("capability_definitions"),
			bundles: rows(world, "bundles").map((row) => ({ bundle_id: field(row, "bundle_id") })),
			entities: rows(world, "entities").map((row) => ({
				entity_key: field(row, "entity_key"),
				bundle_id: field(row, "bundle_id"),
			})),
		};
	});
	if (new TextEncoder().encode(JSON.stringify(projection)).byteLength > MAX_AUTHORITY_BYTES)
		throw new Error("DM authority projection exceeds 8 MiB");
	return projection;
}
