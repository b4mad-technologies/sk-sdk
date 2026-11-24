// Cache-row conversion helpers shared across reader files.
// Mechanical split from readers.ts; no new functionality.
// Snake-case-only: camelCase fallback removed in Phase 2 (D-C).
// NOT subject to per-reader LOC ceiling (D4, design.md:112).

import type {
	EntityDescriptionRow,
	EntityRow,
	EntityTagRow,
	ManifestAuthoredEntityRow,
} from "../../binding_rows";
import type { SnapshotDb } from "../../reader-manifest";
import type { EntityRef } from "../ids";

export function asString(v: unknown): string {
	return v === undefined || v === null ? "" : String(v);
}

export function optString(v: unknown): string | undefined {
	if (v === undefined || v === null) return undefined;
	if (v && typeof v === "object") {
		const some = (v as { some?: unknown }).some;
		if (some !== undefined && some !== null) return String(some);
	}
	const s = String(v);
	return s.length > 0 ? s : undefined;
}

export function asNumber(v: unknown, fallback = 0): number {
	if (typeof v === "number") return v;
	if (typeof v === "bigint") return Number(v);
	if (typeof v === "string") {
		const n = Number(v);
		return Number.isFinite(n) ? n : fallback;
	}
	return fallback;
}

export function optNumber(v: unknown): number | undefined {
	if (v === undefined || v === null) return undefined;
	return asNumber(v, NaN);
}

/** SpacetimeDB `Option<i64>` / tagged `{tag:'some', value}` / bare number. */
export function optionNumber(v: unknown): number | undefined {
	if (v === undefined || v === null) return undefined;
	if (typeof v === "number" || typeof v === "bigint") return asNumber(v);
	if (typeof v === "string") {
		const n = Number(v);
		return Number.isFinite(n) ? n : undefined;
	}
	if (typeof v === "object") {
		const record = v as { tag?: unknown; value?: unknown; some?: unknown };
		if (record.tag === "none" || record.tag === "None") return undefined;
		if (record.tag === "some" || record.tag === "Some")
			return optionNumber(record.value ?? record.some);
		if ("some" in record) return optionNumber(record.some);
	}
	return undefined;
}

export function rows<T>(db: SnapshotDb, ...accessors: string[]): T[] {
	if (accessors.includes("visible_manifest_authored_entity")) {
		const coverage = Array.from(db.visible_manifest_authored_entity_coverage?.iter() ?? []);
		if (
			!db.visible_manifest_authored_entity ||
			coverage.length !== 1 ||
			coverage[0]?.status !== "complete" ||
			coverage[0]?.projectionVersion !== 1
		)
			throw new Error("reader_unavailable: authored mapping coverage missing or incomplete");
	}
	if (accessors.includes("visible_entity_tag")) {
		const coverage = Array.from(db.visible_entity_tag_coverage?.iter() ?? []);
		if (
			!db.visible_entity_tag ||
			coverage.length !== 1 ||
			coverage[0]?.status !== "complete" ||
			coverage[0]?.projectionVersion !== 1
		)
			throw new Error(
				"reader_unavailable: runtime tag membership coverage is missing or incomplete",
			);
	}
	let empty: T[] | undefined;
	for (const a of accessors) {
		const handle = db[a];
		if (!handle) continue;
		const out = Array.from(handle.iter()) as T[];
		// Prefer the first populated handle so unit fixtures that still
		// inject the pre-privacy `session` / `session_participant` names keep
		// working against always-present empty proxies, while live clients
		// (only `visible_*` subscribed) stay on the view.
		if (out.length > 0 || accessors.length === 1) return out;
		empty = out;
	}
	return empty ?? [];
}

// SpacetimeDB tagged-enum shape: `{ tag: "VariantName", value?: ... }`.
// Used by world_event.kind, evaluation_provenance.kind/status, etc.
export function tagString(v: unknown): string {
	if (typeof v === "string") return v;
	if (v && typeof v === "object") {
		const tag = (v as { tag?: unknown }).tag;
		if (typeof tag === "string") return tag;
	}
	return asString(v);
}

// Alias: readers.ts uses kindToString; connection.ts uses tagString. Same logic.
export const kindToString = tagString;

export function verbClassFromDescriptor(descriptor: string): string {
	const key = descriptor.split("=")[0] ?? "";
	const namespace = key.split(".")[0] ?? "";
	switch (namespace) {
		case "manipulation":
		case "action_id":
			return "manipulate";
		case "communication":
			return "communicate";
		default:
			return namespace || "unknown";
	}
}

/** The descriptor's value (the part after the first `=`); "" if none. */
export function descriptorValue(descriptor: string): string {
	const eq = descriptor.indexOf("=");
	return eq >= 0 ? descriptor.slice(eq + 1) : "";
}

/**
 * Resolve an agent-facing entity reference to its numeric entity id.
 *
 * Accepts a numeric id (`"11"`), an `entity:`-prefixed numeric ref
 * (`"entity:11"`), or a manifest authored-entity key suffix (`"core/player"`,
 * matched against `visible_manifest_authored_entity.manifestKey` after its `bundle:`
 * prefix). Complete delivery with no matching key returns `undefined`; missing,
 * incomplete, or unsupported mapping coverage throws `reader_unavailable`.
 *
 * Shared because every perceive reader that takes such a ref needs it: the
 * per-reader `BigInt(ref)` reimplementation threw on manifest keys and the
 * helper had drifted into three private copies (tracker #504, L1 finding #1).
 * Readers declare both admitted mapping and coverage tables. Numeric references
 * remain usable when authored-key delivery is unavailable.
 */
export function resolveEntityId(db: SnapshotDb, entityRef: EntityRef): bigint | undefined {
	// Read the authored-entity table unconditionally (not lazily after the
	// numeric fast-path): a reader that *declares* visible_manifest_authored_entity in
	// requiredTables must *access* it on every call, or the manifest-completeness
	// proxy harness flags it as under-declared and the subscription is unhonest.
	const authoredHandle = db.visible_manifest_authored_entity;
	const coverage = Array.from(db.visible_manifest_authored_entity_coverage?.iter() ?? []);
	const numeric = parseEntityIdRef(entityRef);
	if (numeric !== undefined) return numeric;
	if (
		!authoredHandle ||
		coverage.length !== 1 ||
		coverage[0]?.status !== "complete" ||
		coverage[0]?.projectionVersion !== 1
	)
		throw new Error("reader_unavailable: authored mapping coverage missing or incomplete");
	const authoredRows = Array.from(authoredHandle.iter()) as ManifestAuthoredEntityRow[];
	const authored = authoredRows.find((r) => {
		const idx = r.manifestKey.indexOf(":");
		return idx >= 0 && r.manifestKey.slice(idx + 1) === entityRef;
	});
	return authored ? toBigInt(authored.entityId) : undefined;
}

export function parseEntityIdRef(ref: string): bigint | undefined {
	// ADR-0033 typed target refs: entity:<id> and item:<id> both name a body
	// entity id (Item is still an entity row). sk-h13: inspect on inventory
	// targets arrives as item:N — leaving the prefix stripped is required so
	// observation `{target_name}` can resolve via buildEntityNameMap.
	let trimmed = ref;
	if (trimmed.startsWith("entity:")) trimmed = trimmed.slice("entity:".length);
	else if (trimmed.startsWith("item:")) trimmed = trimmed.slice("item:".length);
	if (trimmed === "" || !/^\d+$/.test(trimmed)) return undefined;
	try {
		return BigInt(trimmed);
	} catch {
		return undefined;
	}
}

function toBigInt(v: number | bigint): bigint {
	return typeof v === "bigint" ? v : BigInt(v);
}

const FACTION_TAG_PREFIX = "srd.faction.";
const LEGACY_FACTION_TAG_PREFIX = "faction:";

/**
 * Map of entity id (string) -> authored instance name, from the `entity` table.
 * Batch join for a reader that enriches many entities per call (actor list,
 * location roster, affordance targets — #1849); single-entity callers should
 * use `readActorSnapshot`'s own lookup pattern instead of building a whole map.
 */
export function buildEntityNameMap(db: SnapshotDb): Map<string, string> {
	const out = new Map<string, string>();
	for (const e of rows<EntityRow>(db, "entity")) {
		out.set(String(e.entityId), asString(e.name));
	}
	return out;
}

/**
 * Map of entity id (string) -> its first `srd.faction.<name>` or legacy `faction:<name>`
 * tag suffix (e.g. "monsters", "cragmaw"), built from admitted `visible_entity_tag` rows.
 * Batch form of `readEntityFaction` (tag_reads.ts) for readers that enrich many entities
 * per call. Entities with no faction tag are absent from the map.
 */
export function buildEntityFactionMap(db: SnapshotDb): Map<string, string> {
	const out = new Map<string, string>();
	for (const t of rows<EntityTagRow>(db, "visible_entity_tag")) {
		const id = String(t.entityId);
		if (out.has(id)) continue;
		const tag = asString(t.tag);
		if (tag.startsWith(FACTION_TAG_PREFIX)) {
			out.set(id, tag.slice(FACTION_TAG_PREFIX.length));
		} else if (tag.startsWith(LEGACY_FACTION_TAG_PREFIX)) {
			out.set(id, tag.slice(LEGACY_FACTION_TAG_PREFIX.length));
		}
	}
	return out;
}

/**
 * Map of entity id (string) -> authored sideband description (`entity_description`,
 * #1968), from the `entity_description` table. Batch join for a reader that
 * enriches many entities per call — same pattern as `buildEntityNameMap`.
 * An entity with no authored row is absent from the map (server's own
 * "absent row -> empty description" canonical shape); callers default with
 * `?? ""`.
 */
export function buildEntityDescriptionMap(db: SnapshotDb): Map<string, string> {
	const out = new Map<string, string>();
	for (const e of rows<EntityDescriptionRow>(db, "entity_description")) {
		out.set(String(e.entityId), asString(e.description));
	}
	return out;
}

export interface EntitySummary {
	name: string;
	entity_def_id: string;
	kind: string;
	quantity: number;
}

/**
 * Map of entity id (string) -> identity summary (name/entity_def_id/kind/
 * quantity), from the `entity` table. Batch join for a reader that enriches
 * many entities per call — e.g. containment rows (#1227: `spellkave_inventory`
 * returned bare ids, forcing a per-item `spellkave_object_state` follow-up
 * loop that dead-ends on `[]` for unnamed items and burns a session's dry-streak
 * budget before combat).
 */
export function buildEntitySummaryMap(db: SnapshotDb): Map<string, EntitySummary> {
	const out = new Map<string, EntitySummary>();
	for (const e of rows<EntityRow>(db, "entity")) {
		out.set(String(e.entityId), {
			name: asString(e.name),
			entity_def_id: asString(e.entityDefId),
			kind: asString(e.kind),
			quantity: asNumber(e.quantity),
		});
	}
	return out;
}
