import { type RefTagFamily, resolveRefTagValue } from "./ref-tags";
import { bundleScope, resolveTagPrefixFamily, visibleRefTagFamilies } from "./tag-prefix-families";

export interface ManifestInspection {
	manifest: Record<string, unknown>;
	summary: ManifestSummary;
}

export interface ManifestSummary {
	bundleIds: string[];
	rowKinds: Record<string, number>;
	rowRefs: Record<string, string[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Field-name heuristic shared by outbound/inbound ref computation: an `*_id`/`*_key`/`*_ref`-suffixed (or bare `id`) string field, excluding `bundle_id`/`source` (provenance, not a reference). */
function isRefField(key: string): boolean {
	if (key === "bundle_id" || key === "source") return false;
	return key === "id" || key.endsWith("_id") || key.endsWith("_key") || key.endsWith("_ref");
}

function stringRefs(row: Record<string, unknown>): string[] {
	const refs: string[] = [];
	for (const [key, value] of Object.entries(row)) {
		if (typeof value !== "string") continue;
		if (isRefField(key)) refs.push(`${key}=${value}`);
	}
	return refs;
}

/** One row's outbound reference: a field on it pointing at another row's natural key value. */
export interface OutboundRowRef {
	field: string;
	value: string;
}

/** One row elsewhere in the manifest whose own outbound ref points AT the queried row. */
export interface InboundRowRef {
	kind: string;
	id: string;
	field: string;
}

/**
 * Both ref directions for one authored row, `{kind, id}` — the #1968
 * definition-lookup gap's ref-traversal capability (`spellkave_query`'s
 * `refs` output). `outbound`: fields on THIS row pointing elsewhere, reusing
 * `stringRefs`'s existing heuristic. `inbound`: every OTHER row anywhere in
 * `manifest` whose own outbound ref points at `id` — built by inverting the
 * outbound edge list once per call (no index persisted; a query call is not
 * a hot path).
 *
 * Both directions exclude the row's OWN natural-key field (`ROW_KIND_
 * NATURAL_KEY[kind]`) from counting as a "ref" — that field is the row's
 * identity, not a pointer to something else, so without this exclusion
 * every row would trivially "reference itself" (its own `capability_id`
 * column satisfies the same `*_id`-suffix heuristic `stringRefs` uses for
 * every other field) and inbound lookups would report a row as its own
 * referrer. This is a deliberate refinement over `stringRefs`'s raw output
 * (which the pre-existing per-kind `ManifestSummary.rowRefs` still returns
 * unfiltered, unchanged, for full backward compatibility with `spellkave_
 * manifest_inspect` callers) — see `inspectSchemaManifest` above.
 */
/**
 * Outbound refs for ONE already-resolved row, generalized over an arbitrary
 * exclusion set rather than `inspectRowRefs`'s single `rowKindNaturalKey[kind]`
 * field (finding #9, srd-cc battle-test ledger, 2026-07-26): a composite-keyed
 * satellite row (e.g. a `*_tag` row, identity = `{parent_field, "tag"}`) has
 * TWO identity fields, not one, so `inspectRowRefs`'s own single-field
 * exclusion can't be reused as-is for it. Same `isRefField` heuristic,
 * factored out so both callers (this file's `inspectRowRefs`, and
 * `spellkave_query`'s composite-key detail path) share one exclusion rule
 * rather than drifting. Inbound-ref discovery for composite-keyed rows is
 * NOT covered here — see the composite-key detail caller's own doc comment
 * for why that half is deferred.
 */
export function outboundRefsExcluding(
	row: Record<string, unknown>,
	excludeFields: readonly string[],
): OutboundRowRef[] {
	const excluded = new Set(excludeFields);
	const outbound: OutboundRowRef[] = [];
	for (const [field, value] of Object.entries(row)) {
		if (typeof value !== "string") continue;
		if (excluded.has(field)) continue; // identity, not a reference
		if (isRefField(field)) outbound.push({ field, value });
	}
	return outbound;
}

/**
 * Outbound refs for a `*_tag` satellite row's `tag` VALUE (finding #2,
 * srd-cc battle-test ledger, 2026-07-27; design draft `packages/spellkave-
 * srd-cc/ledger/designs/finding-02-typed-tag-refs.md`): `outboundRefsExcluding`'s
 * `isRefField` heuristic never recognizes `tag` as a ref field — it's a bare
 * field name, not `*_id`/`*_key`/`*_ref` — even when its STRING VALUE encodes
 * a pointer (e.g. `srd.ability.wis`) at a prefix in the CALLER-SUPPLIED
 * `refTagFamilies` list. This resolves that value against the family's
 * `targetKind` and, if it resolves, reports the RESOLVED FULL ROW ID (e.g.
 * `srd/wis`), not the bare tag value `wis` — so a caller can immediately
 * chase it by re-querying `{kind: targetKind, id: resolvedId}` (`spellkave_
 * query`'s own documented "chase a reference" idiom). Yields nothing for a
 * row with no `tag` field, an unrecognized prefix, an empty/omitted
 * `refTagFamilies` list, or a value that doesn't resolve (that last case is
 * `./lint.ts`'s `dangling-ref-tag`'s job to flag, not this function's).
 *
 * `refTagFamilies` is never seeded by this package (`./ref-tags.ts`'s
 * header) — defaults to empty, so a caller that doesn't opt in (today,
 * `@spellkave/tool-authoring`'s `spellkave_query` composite-key detail
 * path, pending a manifest-level tag-vocabulary declaration surface
 * proposed via OpenSpec) gets no ref-tag resolution, not a crash.
 */
export function refTagOutboundRefs(
	manifest: Record<string, unknown>,
	row: Record<string, unknown>,
	refTagFamilies: readonly RefTagFamily[] = [],
): OutboundRowRef[] {
	const tag = row.tag;
	if (typeof tag !== "string") return [];
	const family = resolveTagPrefixFamily(
		tag,
		visibleRefTagFamilies(
			manifest,
			typeof row.bundle_id === "string" ? row.bundle_id : undefined,
			refTagFamilies,
		),
	);
	if (family === undefined) return [];
	const visible =
		family.declaringBundleId === undefined
			? undefined
			: bundleScope(manifest, family.declaringBundleId);
	const resolved = resolveRefTagValue(
		manifest,
		family.targetKind,
		family.naturalKeyField,
		tag.slice(family.prefix.length),
		tag,
		visible,
	);
	return resolved === undefined
		? []
		: [{ field: `tag:${family.prefix.slice(0, -1)}`, value: resolved }];
}

/**
 * Find ONE row of `kind` by its ordered composite-key VALUES (finding #9,
 * srd-cc battle-test ledger, 2026-07-26) — the composite-key sibling of the
 * single-field `row[keyField] === id` lookup `inspectRowRefs`/`spellkave_
 * query`'s natural-key detail path already does. `keyParts[i]` must equal
 * `row[compositeFields[i]]` for every field, in order — an exact match, no
 * partial/prefix lookup. Manifest semantics (which row a composite key
 * resolves to), kept separate from HOW a caller encodes that key as one
 * opaque string id — that encoding is a tool-facing UX decision, not a
 * manifest fact, so it stays in the caller (`spellkave_query`'s own
 * composite-id join/split).
 */
export function findRowByCompositeKey(
	manifest: Record<string, unknown>,
	kind: string,
	compositeFields: readonly string[],
	keyParts: readonly string[],
): Record<string, unknown> | undefined {
	const rows = manifest[kind];
	if (!Array.isArray(rows)) return undefined;
	return (rows as Record<string, unknown>[]).find(
		(row) => isRecord(row) && compositeFields.every((field, i) => row[field] === keyParts[i]),
	);
}

export function inspectRowRefs(
	manifest: Record<string, unknown>,
	rowKindNaturalKey: Readonly<Record<string, string>>,
	kind: string,
	id: string,
): { outbound: OutboundRowRef[]; inbound: InboundRowRef[] } {
	const keyField = rowKindNaturalKey[kind];
	const rowsOf = (k: string): Record<string, unknown>[] => {
		const rows = manifest[k];
		return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
	};
	const own = keyField !== undefined ? rowsOf(kind).find((r) => r[keyField] === id) : undefined;

	const outbound: OutboundRowRef[] =
		own !== undefined ? outboundRefsExcluding(own, keyField !== undefined ? [keyField] : []) : [];

	const inbound: InboundRowRef[] = [];
	for (const [otherKind, rows] of Object.entries(manifest)) {
		if (!Array.isArray(rows)) continue;
		const otherKeyField = rowKindNaturalKey[otherKind];
		for (const row of rows) {
			if (!isRecord(row)) continue;
			const otherId =
				otherKeyField !== undefined && typeof row[otherKeyField] === "string"
					? (row[otherKeyField] as string)
					: undefined;
			if (otherId === undefined) continue;
			for (const [field, value] of Object.entries(row)) {
				if (typeof value !== "string" || value !== id) continue;
				if (field === otherKeyField) continue; // identity, not a reference
				if (!isRefField(field)) continue;
				if (otherKind === kind && otherId === id) continue; // never a row's own field pointing at itself
				inbound.push({ kind: otherKind, id: otherId, field });
			}
		}
	}

	return { outbound, inbound };
}

export function inspectSchemaManifest(manifest: Record<string, unknown>): ManifestInspection {
	const rowKinds: Record<string, number> = {};
	const rowRefs: Record<string, string[]> = {};

	for (const [kind, rows] of Object.entries(manifest)) {
		if (!Array.isArray(rows)) continue;
		rowKinds[kind] = rows.length;
		const refs = rows.flatMap((row) => (isRecord(row) ? stringRefs(row) : []));
		if (refs.length > 0) rowRefs[kind] = refs;
	}

	const bundles = Array.isArray(manifest.bundles) ? manifest.bundles : [];
	const bundleIds = bundles
		.filter(isRecord)
		.map((bundle) => bundle.bundle_id)
		.filter((id): id is string => typeof id === "string");

	return {
		manifest,
		summary: {
			bundleIds,
			rowKinds,
			rowRefs,
		},
	};
}
