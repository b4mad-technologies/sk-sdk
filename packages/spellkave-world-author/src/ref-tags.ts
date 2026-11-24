// Ref-typed tag values (srd-cc finding ledger finding #2,
// `packages/spellkave-srd-cc/ledger/findings.md`; design draft:
// `packages/spellkave-srd-cc/ledger/designs/finding-02-typed-tag-refs.md`).
//
// `*_tag` rows (`capability_definition_tag`, `resource_definition_tag`, and
// nine siblings) carry a single free-string `tag` field. Some content
// bundles use a dotted `<prefix>.<value>` convention inside that string for
// identity-only groupings that have no first-class column — e.g.
// `srd.ability.wis` on a skill capability (`@spellkave/srd-cc`'s own bundle-
// private prefix; see that package's `src/ref-tag-families.ts`). Nothing
// resolves the value after the prefix against a real row today: no validator
// parses a tag's VALUE, and `./inspection.ts`'s `isRefField` heuristic only
// recognizes `*_id`/`*_key`/`*_ref`/bare `id` FIELD NAMES, never a field's
// string CONTENT — the field is literally named `tag`, so it never qualifies
// regardless of what its value encodes.
//
// This file declares the MECHANISM for a caller-supplied, explicit,
// hand-maintained vocabulary of which tag-key prefixes are ref-typed and
// what they resolve against — consumed by `./lint.ts`'s `dangling-ref-tag`
// rule (typo protection at author time) and `./inspection.ts`'s
// `refTagOutboundRefs` (ref-graph traversal, wired into `spellkave_query`'s
// composite-key detail path). Neither function seeds any family itself —
// see the interface's own doc comment below for why. Advisory tooling
// metadata about a content CONVENTION, not a structural
// manifest fact — deliberately NOT colocated in `./row-kinds.ts`, which is
// Rust-owned/wasm-mirrored (see that file's own header) for a DIFFERENT
// reason: `./row-kinds.ts` is loaded via a synchronous nodejs-only
// `spellkave-authoring-wasm` import, eagerly evaluated at module-import time
// (its `ROW_KIND_NATURAL_KEY`/`ROW_KIND_COMPOSITE_KEY` consts are computed as
// soon as the module loads, not lazily). `./lint.ts` and `./inspection.ts`
// are BOTH statically imported by `./browser.ts` (the wasm-web/browser
// entry point) — importing `./row-kinds.ts` from either would drag that
// nodejs wasm binding into the browser bundle, which `./row-kinds.ts`'s own
// header flags as a real gap ("no browser-bundle consumer today"). This
// module therefore hand-carries each family's natural-key field directly
// (`naturalKeyField`) instead of deriving it from `ROW_KIND_NATURAL_KEY` at
// call time — a small, deliberate duplication in exchange for keeping the
// browser entry point wasm-web-only.
//
// NO SEEDED VOCABULARY HERE (2026-07-27 correction — see `packages/spellkave-
// srd-cc/ledger/findings.md` finding #2's rename addendum). This module
// used to export a shared `REF_TAG_FAMILIES` const seeding 5e-shaped keys
// (`ability=`, `spellcasting=`) directly into this game-agnostic engine —
// wrong on two counts: (1) it baked content vocabulary into
// `@spellkave/world-author`, which every OTHER content bundle also depends
// on, even though only `@spellkave/srd-cc` ever populated a resolvable
// family; (2) the `key=value` string-tag grammar it validated is itself a
// documented anti-pattern (`docs/data-model-concepts/tagging.md`'s "A tag is
// membership, not a behaviour parameter" section: "a `key=value` 'tag'
// smuggles a typed parameter into the membership table"). The MECHANISM
// (this interface + `resolveRefTagValue`, plus `./lint.ts`'s
// `dangling-ref-tag` rule and `./inspection.ts`'s `refTagOutboundRefs`) stays
// here and stays generic; the FAMILY LIST is now caller-supplied at every
// call site (`lintManifest`'s `options.refTagFamilies`, `refTagOutboundRefs`'s
// own parameter) — this package declares zero families of its own. A content
// bundle wanting typo protection / ref-graph traversal for its own
// `key=value` tag convention declares its own `RefTagFamily[]` and passes it
// in (see `@spellkave/srd-cc`'s `src/ref-tag-families.ts` for the first such
// declaration, using the canonical dotted grammar — `srd.ability.<code>`,
// not `ability=<code>` — per the tagging.md convention above).
//
// A manifest-level declaration surface (a bundle stating its own tag
// prefixes IN the manifest — the `tag_prefixes`/`allow_flat_tags` concept
// `docs/data-model-concepts/tagging.md` already documents but that remains
// unimplemented) is a SEPARATE, larger change proposed via OpenSpec — this
// module is deliberately NOT that: it is the smallest mechanism a caller can
// drive today with a hand-written family list.
export interface RefTagFamily {
	/** e.g. "srd.ability." or "ability=" — the tag value's leading key, INCLUDING the trailing delimiter. */
	readonly prefix: string;
	/** The row kind the value after the prefix should resolve against. */
	readonly targetKind: string;
	/** `targetKind`'s natural-key field (mirrors `ROW_KIND_NATURAL_KEY[targetKind]` — see header for why it's hand-carried here rather than looked up). */
	readonly naturalKeyField: string;
	/** Bundle that declared this manifest-sourced family; absent for legacy callers. */
	readonly declaringBundleId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Does `targetKind`'s natural-key id space contain a row matching `value`,
 * either exactly or as its final `/`-segment (e.g. "wis" matches "srd/wis")?
 * Suffix match, not prefix/substring — deliberately loose about the
 * bundle-namespace prefix so this works across any content bundle's own id
 * scheme, not just "srd/*". Returns the resolved row's FULL id, or
 * `undefined` if nothing matches.
 */
export type RefTagResolution =
	| { readonly kind: "resolved"; readonly value: string }
	| { readonly kind: "unresolved" }
	| { readonly kind: "ambiguous"; readonly candidates: readonly string[] };

export function resolveRefTagValueOutcome(
	manifest: Record<string, unknown>,
	targetKind: string,
	naturalKeyField: string,
	value: string,
	fullTag = value,
	visibleBundleIds?: ReadonlySet<string>,
): RefTagResolution {
	const table = manifest[targetKind];
	if (!Array.isArray(table)) return { kind: "unresolved" };
	const ids = table
		.filter(isRecord)
		.filter(
			(row) =>
				visibleBundleIds === undefined ||
				(typeof row.bundle_id === "string" && visibleBundleIds.has(row.bundle_id)),
		)
		.map((row) => row[naturalKeyField])
		.filter((id): id is string => typeof id === "string");
	for (const candidates of [
		new Set(ids.filter((id) => id === fullTag)),
		new Set(ids.filter((id) => id === value)),
		new Set(ids.filter((id) => id.slice(id.lastIndexOf("/") + 1) === value)),
	]) {
		if (candidates.size === 0) continue;
		const sorted = [...candidates].sort();
		if (sorted.length === 1) {
			const [resolved] = sorted;
			if (resolved !== undefined) return { kind: "resolved", value: resolved };
		}
		return { kind: "ambiguous", candidates: sorted };
	}
	return { kind: "unresolved" };
}

/** Compatibility helper for callers that only need a safe outbound target. */
export function resolveRefTagValue(
	manifest: Record<string, unknown>,
	targetKind: string,
	naturalKeyField: string,
	value: string,
	fullTag = value,
	visibleBundleIds?: ReadonlySet<string>,
): string | undefined {
	const outcome = resolveRefTagValueOutcome(
		manifest,
		targetKind,
		naturalKeyField,
		value,
		fullTag,
		visibleBundleIds,
	);
	return outcome.kind === "resolved" ? outcome.value : undefined;
}
