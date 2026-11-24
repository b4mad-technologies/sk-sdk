// Semantic manifest diff by row identity (sk-0m4.46).
//
// Two SchemaManifests (the snake_case shape `filter-manifest.ts` / export
// uses) are compared order-insensitively: each row kind is indexed by its
// natural or composite key, then reported as onlyLeft (in the reference,
// missing from the export ⇒ GAP), onlyRight (export-only ⇒ SNAPSHOT/PLAY),
// or changed (same key, field-level differences).
//
// Identity sources, in order:
//   1. ROW_KIND_NATURAL_KEY (Rust-owned single-column keys)
//   2. ROW_KIND_COMPOSITE_KEY (Rust-owned `*_tag` pairs + tag_capability_grant)
//   3. DIFF_JUNCTION_IDENTITY — junction kinds the Rust tables deliberately
//      omit (non-uniform satellites). Each entry cites the server upsert key.
//
// `identityOf` is NOT used here: for `entities`/`actors` it demands a LIVE
// surrogate id. A manifest-to-manifest diff keys those kinds on `entity_key`
// (ROW_KIND_NATURAL_KEY), which is the authoring-time identity.

import { parse as parseToml } from "smol-toml";

import type { SchemaManifest } from "./filter-manifest";
import {
	exportNotRoundTrippedFields,
	rowKindCompositeKey,
	rowKindNaturalKey,
} from "./row-kinds-data";

/**
 * Junction / satellite kinds with no entry in ROW_KIND_NATURAL_KEY or
 * ROW_KIND_COMPOSITE_KEY. Cited against the server upsert, not invented.
 *
 * - actor_capabilities: commit.rs ADR-0085 D-1 upsert on (entity_id, capability_id)
 * - object_state: entity_authoring.rs matches (target_id, state_id)
 * - entity_containment: brief asks container+entity (export identity); the
 *   live upsert is entity_id PK (one container per contained entity)
 * - actor_equipment_slots: commit.rs ADR-0085 G-1 (entity_id, slot_id)
 * - actor_spatial_locations: commit.rs keyed on entity_id
 */
export const DIFF_JUNCTION_IDENTITY: Readonly<Record<string, readonly string[]>> = Object.freeze({
	actor_capabilities: Object.freeze(["actor_entity_key", "capability_id"]),
	object_state: Object.freeze(["entity_key", "state_id"]),
	entity_containment: Object.freeze(["container_entity_key", "entity_key"]),
	actor_equipment_slots: Object.freeze(["actor_entity_key", "slot_id"]),
	actor_spatial_locations: Object.freeze(["entity_key"]),
});

/**
 * Snapshot / enrichment noise every diff ignores by default: the fields
 * `r_export_manifest` does not round-trip, read from the Rust-owned list
 * (`spellkave_schema::export_round_trip`, sk-jay0.7.174.15) that
 * `sk diff -k` masks with too.
 */
export function defaultDiffIgnoreFields(kind: string): readonly string[] {
	return exportNotRoundTrippedFields(kind);
}

/**
 * Parse a manifest or include-fragment TOML into SchemaManifest (snake_case).
 *
 * Integers above 2^53 (H3 cell ids such as `cell_res10 = 622215095455449087`
 * in every elven-mini world fragment) are read as BigInt and then carried as
 * their decimal string, so a diff or subset check compares them exactly
 * instead of refusing the whole file ("integer value cannot be represented
 * losslessly", sk-jay0.7.171.2). This parser feeds read-only comparisons
 * (`sk diff`, the `live-delta-subset` gate); nothing re-renders its output
 * as TOML, which is why a string stands in for the wide integer here.
 */
export function parseSchemaManifestToml(toml: string): SchemaManifest {
	const parsed = widenBigInts(parseToml(toml, { integersAsBigInt: "asNeeded" }));
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("parseSchemaManifestToml: TOML root is not a table");
	}
	return parsed as SchemaManifest;
}

function widenBigInts(value: unknown): unknown {
	if (typeof value === "bigint") return value.toString();
	if (Array.isArray(value)) return value.map(widenBigInts);
	if (value !== null && typeof value === "object") {
		const out: Record<string, unknown> = {};
		for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
			out[key] = widenBigInts(inner);
		}
		return out;
	}
	return value;
}

export type DiffIgnoreFields = {
	global?: readonly string[];
	byKind?: Readonly<Record<string, readonly string[]>>;
};

export type KeyMap = {
	from: string;
	to: string;
};

export type DiffManifestsOpts = {
	/** Extra ignores, merged with the default snapshot/enrichment list. */
	ignoreFields?: DiffIgnoreFields;
	/** Restrict the report to these kinds (sorted). */
	kinds?: readonly string[];
	/** Rewrite entity/actor key prefixes (and fields that carry them) before compare. */
	mapKeys?: readonly KeyMap[];
};

export type FieldChange = {
	field: string;
	left: unknown;
	right: unknown;
};

export type KindDiff = {
	kind: string;
	onlyLeft: Array<{ key: string; row: Record<string, unknown> }>;
	onlyRight: Array<{ key: string; row: Record<string, unknown> }>;
	changed: Array<{ key: string; fields: FieldChange[] }>;
};

export type ManifestDiff = {
	kinds: KindDiff[];
	/** Array-valued kinds present in either side with no registered identity. */
	unkeyedKinds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one `--map-key from=to` token. First `=` splits; both sides required. */
export function parseMapKey(token: string): KeyMap {
	const eq = token.indexOf("=");
	if (eq <= 0 || eq === token.length - 1) {
		throw new Error(`map-key: expected from=to, got ${JSON.stringify(token)}`);
	}
	return { from: token.slice(0, eq), to: token.slice(eq + 1) };
}

function rewriteKeyString(value: string, from: string, to: string): string {
	if (value === from) return to;
	if (value.startsWith(`${from}/`)) return to + value.slice(from.length);
	const embed = `:${from}`;
	if (value.includes(embed)) return value.split(embed).join(`:${to}`);
	return value;
}

/** Rewrite every string field that is, or embeds, a mapped entity/actor key. */
export function applyKeyMaps(manifest: SchemaManifest, maps: readonly KeyMap[]): SchemaManifest {
	if (maps.length === 0) return manifest;
	const ordered = [...maps].sort((a, b) => b.from.length - a.from.length);
	const out: SchemaManifest = { ...manifest };
	for (const [kind, rows] of Object.entries(manifest)) {
		if (!Array.isArray(rows)) continue;
		out[kind] = rows.map((row) => {
			if (!isRecord(row)) return row;
			const next: Record<string, unknown> = { ...row };
			for (const [field, value] of Object.entries(row)) {
				if (typeof value !== "string") continue;
				let mapped = value;
				for (const { from, to } of ordered) {
					mapped = rewriteKeyString(mapped, from, to);
				}
				next[field] = mapped;
			}
			return next;
		});
	}
	return out;
}

/** Identity field list for `kind`, or undefined if the kind is unkeyed. */
export function identityFieldsOf(kind: string): readonly string[] | undefined {
	const natural = rowKindNaturalKey()[kind];
	if (natural !== undefined) return [natural];
	const composite = rowKindCompositeKey()[kind];
	if (composite !== undefined) return composite;
	return DIFF_JUNCTION_IDENTITY[kind];
}

export function rowIdentityKey(kind: string, row: Record<string, unknown>): string | undefined {
	const fields = identityFieldsOf(kind);
	if (fields === undefined) return undefined;
	return fields.map((field) => String(row[field] ?? "")).join("::");
}

function rowKindsIn(manifest: SchemaManifest): string[] {
	const kinds: string[] = [];
	for (const [key, value] of Object.entries(manifest)) {
		if (Array.isArray(value)) kinds.push(key);
	}
	return kinds;
}

function rowsOf(manifest: SchemaManifest, kind: string): Record<string, unknown>[] {
	const value = manifest[kind];
	if (!Array.isArray(value)) return [];
	return value.filter(isRecord);
}

function indexByKey(
	kind: string,
	rows: Record<string, unknown>[],
): Map<string, Record<string, unknown>> {
	const index = new Map<string, Record<string, unknown>>();
	for (const row of rows) {
		const key = rowIdentityKey(kind, row);
		if (key === undefined) continue;
		index.set(key, row);
	}
	return index;
}

function ignoreSet(kind: string, extra: DiffIgnoreFields | undefined): Set<string> {
	const set = new Set<string>(defaultDiffIgnoreFields(kind));
	for (const field of extra?.global ?? []) set.add(field);
	for (const field of extra?.byKind?.[kind] ?? []) set.add(field);
	for (const field of identityFieldsOf(kind) ?? []) set.add(field);
	return set;
}

function carriesValueIntOrText(row: Record<string, unknown>): boolean {
	if (row.value_int !== undefined && row.value_int !== null) return true;
	return typeof row.value_text === "string" && row.value_text.length > 0;
}

function comparableFields(
	_kind: string,
	row: Record<string, unknown>,
	ignored: Set<string>,
): string[] {
	const fields = Object.keys(row).filter((field) => !ignored.has(field));
	if (fields.includes("value_bool") && carriesValueIntOrText(row)) {
		return fields.filter((field) => field !== "value_bool");
	}
	return fields;
}

function valuesEqual(left: unknown, right: unknown): boolean {
	if (left === right) return true;
	if (left === undefined || right === undefined) return left === right;
	if (typeof left === "bigint" || typeof right === "bigint") return String(left) === String(right);
	if (typeof left === "object" || typeof right === "object") {
		return JSON.stringify(left) === JSON.stringify(right);
	}
	return false;
}

function fieldChanges(
	kind: string,
	left: Record<string, unknown>,
	right: Record<string, unknown>,
	ignored: Set<string>,
): FieldChange[] {
	const names = new Set([
		...comparableFields(kind, left, ignored),
		...comparableFields(kind, right, ignored),
	]);
	const changes: FieldChange[] = [];
	for (const field of [...names].sort()) {
		if (valuesEqual(left[field], right[field])) continue;
		changes.push({ field, left: left[field], right: right[field] });
	}
	return changes;
}

/**
 * Order-insensitive semantic diff. Empty `kinds` in the result means the two
 * manifests agree under the ignore list. Report order is sorted by kind, then
 * by identity key.
 */
export function diffManifests(
	left: SchemaManifest,
	right: SchemaManifest,
	opts: DiffManifestsOpts = {},
): ManifestDiff {
	const mappedLeft = applyKeyMaps(left, opts.mapKeys ?? []);
	const mappedRight = applyKeyMaps(right, opts.mapKeys ?? []);
	const requested = opts.kinds === undefined ? undefined : new Set(opts.kinds);
	const allKinds = new Set([...rowKindsIn(mappedLeft), ...rowKindsIn(mappedRight)]);
	const unkeyedKinds: string[] = [];
	const kinds: KindDiff[] = [];

	for (const kind of [...allKinds].sort()) {
		if (requested !== undefined && !requested.has(kind)) continue;
		if (identityFieldsOf(kind) === undefined) {
			if (
				(mappedLeft[kind] as unknown[] | undefined)?.length ||
				(mappedRight[kind] as unknown[] | undefined)?.length
			) {
				unkeyedKinds.push(kind);
			}
			continue;
		}

		const leftIndex = indexByKey(kind, rowsOf(mappedLeft, kind));
		const rightIndex = indexByKey(kind, rowsOf(mappedRight, kind));
		const ignored = ignoreSet(kind, opts.ignoreFields);

		const onlyLeft: KindDiff["onlyLeft"] = [];
		const onlyRight: KindDiff["onlyRight"] = [];
		const changed: KindDiff["changed"] = [];

		for (const key of [...leftIndex.keys()].sort()) {
			const leftRow = leftIndex.get(key) as Record<string, unknown>;
			const rightRow = rightIndex.get(key);
			if (rightRow === undefined) {
				onlyLeft.push({ key, row: leftRow });
				continue;
			}
			const fields = fieldChanges(kind, leftRow, rightRow, ignored);
			if (fields.length > 0) changed.push({ key, fields });
		}
		for (const key of [...rightIndex.keys()].sort()) {
			if (!leftIndex.has(key)) {
				onlyRight.push({ key, row: rightIndex.get(key) as Record<string, unknown> });
			}
		}

		if (onlyLeft.length === 0 && onlyRight.length === 0 && changed.length === 0) continue;
		kinds.push({ kind, onlyLeft, onlyRight, changed });
	}

	return { kinds, unkeyedKinds };
}

export type DiffOnlyFilter = "gaps" | "snapshot" | "changed";

/** Flatten a ManifestDiff into the compact tables `sk diff` prints. */
export function flattenManifestDiff(
	diff: ManifestDiff,
	only?: DiffOnlyFilter,
): {
	gaps: Array<{ kind: string; key: string }>;
	snapshot: Array<{ kind: string; key: string }>;
	changes: Array<{ kind: string; key: string; field: string; left: unknown; right: unknown }>;
	kindCounts: Array<{
		kind: string;
		only_left: number;
		only_right: number;
		changed: number;
	}>;
} {
	const gaps: Array<{ kind: string; key: string }> = [];
	const snapshot: Array<{ kind: string; key: string }> = [];
	const changes: Array<{
		kind: string;
		key: string;
		field: string;
		left: unknown;
		right: unknown;
	}> = [];
	const kindCounts: Array<{
		kind: string;
		only_left: number;
		only_right: number;
		changed: number;
	}> = [];

	for (const entry of diff.kinds) {
		if (only === undefined || only === "gaps") {
			for (const row of entry.onlyLeft) gaps.push({ kind: entry.kind, key: row.key });
		}
		if (only === undefined || only === "snapshot") {
			for (const row of entry.onlyRight) snapshot.push({ kind: entry.kind, key: row.key });
		}
		if (only === undefined || only === "changed") {
			for (const row of entry.changed) {
				for (const field of row.fields) {
					changes.push({
						kind: entry.kind,
						key: row.key,
						field: field.field,
						left: field.left,
						right: field.right,
					});
				}
			}
		}
		const onlyLeft = only === undefined || only === "gaps" ? entry.onlyLeft.length : 0;
		const onlyRight = only === undefined || only === "snapshot" ? entry.onlyRight.length : 0;
		const changed = only === undefined || only === "changed" ? entry.changed.length : 0;
		if (onlyLeft === 0 && onlyRight === 0 && changed === 0) continue;
		kindCounts.push({
			kind: entry.kind,
			only_left: onlyLeft,
			only_right: onlyRight,
			changed,
		});
	}

	return { gaps, snapshot, changes, kindCounts };
}
