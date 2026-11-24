// Manifest-read source for `./ref-tags.ts`'s caller-supplied `RefTagFamily[]`
// argument (`tag-vocabulary-declaration` change, design.md Decisions 1/3;
// `openspec/changes/tag-vocabulary-declaration/`). Every existing caller of
// `lintManifest`'s `dangling-ref-tag` rule and `refTagOutboundRefs` hand-writes
// its own `RefTagFamily[]` today (`@spellkave/srd-cc`'s `ref-tag-families.ts`
// is the first, and at time of writing only, such declaration — see `./ref-
// tags.ts`'s own header). This module adds a SECOND source for that same
// argument: a bundle's own manifest-declared `[[bundle.tag_prefixes]]` rows
// (`crates/spellkave-schema`'s `TagPrefixDeclaration`). It does not change
// `RefTagFamily`'s shape or retire the hand-written-array path — a content
// bundle may still declare its own family list by hand; this is an
// additional, additive source a caller can use instead.

import type { RefTagFamily } from "./ref-tags";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(row: Record<string, unknown>, key: string): string | undefined {
	const value = row[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Builds the `RefTagFamily[]` argument `lintManifest`'s `dangling-ref-tag`
 * rule and `inspection.ts`'s `refTagOutboundRefs` already accept, sourced
 * from every `[[bundles]]` row's own `tag_prefixes` entries in `manifest`.
 *
 * **Scope: BundleScope.** Consumers filter manifest-derived families through
 * the tagging row's `bundle_id` dependency closure before prefix selection;
 * legacy hand-supplied families remain eligible for backward compatibility.
 *
 * **Only ref-semantics-complete entries become a family.** A `tag_prefixes`
 * entry declaring a bare namespace (`target_kind`/`natural_key_field` both
 * absent) is namespace-only metadata for Slice B's undeclared-prefix warning
 * (`spellkave-validate`) — it carries nothing `RefTagFamily` (a ref-
 * *resolution* mechanism) can act on, so it contributes no entry here. A
 * manifest declaring no ref-semantics `tag_prefixes` anywhere returns `[]` —
 * the exact zero-default behavior every caller already gets today when it
 * passes no families at all, not a regression (`./lint.ts`'s own
 * `LintManifestOptions.refTagFamilies` doc comment).
 *
 * **Sorted longest-`prefix`-first** (design.md Decision 2/3's "the longest
 * matching declared prefix wins" specificity rule, restated for this TS
 * mechanism): a bundle declaring BOTH a `"srd"` and a `"srd.ability"` ref-
 * typed prefix puts the `"srd.ability."` family ahead of `"srd."` in the
 * returned array, so {@link resolveTagPrefixFamily} below — which takes the
 * FIRST matching entry — prefers the more specific declaration for any tag
 * that could match both.
 */
export function manifestTagPrefixFamilies(manifest: Record<string, unknown>): RefTagFamily[] {
	const bundles = manifest.bundles;
	if (!Array.isArray(bundles)) return [];
	const families: RefTagFamily[] = [];
	for (const bundle of bundles) {
		if (!isRecord(bundle)) continue;
		const tagPrefixes = bundle.tag_prefixes;
		if (!Array.isArray(tagPrefixes)) continue;
		for (const entry of tagPrefixes) {
			if (!isRecord(entry)) continue;
			const prefix = nonEmptyString(entry, "prefix");
			const targetKind = nonEmptyString(entry, "target_kind");
			const naturalKeyField = nonEmptyString(entry, "natural_key_field");
			if (!prefix || !targetKind || !naturalKeyField) continue;
			const bundleId = nonEmptyString(bundle, "bundle_id");
			families.push({
				prefix: `${prefix}.`,
				targetKind,
				naturalKeyField,
				declaringBundleId: bundleId,
			});
		}
	}
	return families.sort(compareFamilies);
}

function compareOptional(a: string | undefined, b: string | undefined): number {
	if (a === b) return 0;
	if (a === undefined) return -1;
	if (b === undefined) return 1;
	return a.localeCompare(b);
}

/** Mirrors Rust's length then complete declaration-key tie-break. */
function compareFamilies(a: RefTagFamily, b: RefTagFamily): number {
	return (
		b.prefix.length - a.prefix.length ||
		compareOptional(a.declaringBundleId, b.declaringBundleId) ||
		a.prefix.localeCompare(b.prefix) ||
		a.targetKind.localeCompare(b.targetKind) ||
		a.naturalKeyField.localeCompare(b.naturalKeyField)
	);
}

/**
 * Resolve the single family governing `tag` under design.md's "longest
 * matching declared prefix wins" rule: the first entry in `families` whose
 * `prefix` `tag` starts with. Correct as long as `families` is sorted
 * longest-prefix-first (as {@link manifestTagPrefixFamilies} returns it) —
 * callers building their own list some other way must sort it first.
 * Returns `undefined` when no declared family matches `tag` at all.
 */
export function resolveTagPrefixFamily(
	tag: string,
	families: readonly RefTagFamily[],
): RefTagFamily | undefined {
	return families.filter((family) => tag.startsWith(family.prefix)).sort(compareFamilies)[0];
}

/** Families visible to a tagging row. Manifest declarations obey BundleScope;
 * legacy hand-supplied families (no declaring bundle) remain globally eligible. */
export function visibleRefTagFamilies(
	manifest: Record<string, unknown>,
	taggingBundleId: string | undefined,
	families: readonly RefTagFamily[],
): readonly RefTagFamily[] {
	if (taggingBundleId === undefined)
		return families.filter((family) => family.declaringBundleId === undefined);
	const visible = bundleScope(manifest, taggingBundleId);
	return families.filter(
		(family) => family.declaringBundleId === undefined || visible.has(family.declaringBundleId),
	);
}

/** Declaring bundle plus its transitive dependencies, matching Rust BundleScope. */
export function bundleScope(manifest: Record<string, unknown>, bundleId: string): Set<string> {
	const byId = new Map<string, Record<string, unknown>>();
	for (const bundle of Array.isArray(manifest.bundles) ? manifest.bundles : []) {
		if (!isRecord(bundle)) continue;
		const id = nonEmptyString(bundle, "bundle_id");
		if (id) byId.set(id, bundle);
	}
	const visible = new Set<string>();
	const visit = (id: string) => {
		if (visible.has(id)) return;
		visible.add(id);
		const deps = byId.get(id)?.depends_on;
		if (Array.isArray(deps)) for (const dep of deps) if (typeof dep === "string") visit(dep);
	};
	visit(bundleId);
	return visible;
}
