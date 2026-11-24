// Manifest row-kind -> single-column natural-key field.
//
// #1968 R7 (ADR-0087) slice 2: this table is now Rust-owned
// (`crates/spellkave-authoring/src/row_kinds.rs`'s `ROW_KIND_NATURAL_KEY`,
// the single source of truth) — this file is a thin wrapper that reads it
// through the vendored `spellkave-authoring-wasm` nodejs-target package
// (mirrors `manifest.ts`'s direct, synchronous import of
// `spellkave-validate-wasm`; the nodejs wasm-pack target loads its wasm
// module synchronously at `require` time, so a top-level `const` here is
// safe exactly the same way `render_manifest_json_to_toml` already is).
// Browser callers receive the same Rust-owned maps through the conditional
// `@spellkave/world-author/tooling` export. `tooling.browser.ts` initializes
// the web WASM and these maps in `loadBrowserAuthorTooling`; scoped instance
// projection imports that port so browser builds never load this Node shim.
//
// Two independent consumers share this SINGLE source of truth rather than
// each carrying its own copy:
//   1. shared tool runtime's workspace idempotency merge (upsert-by-authored-key
//      re-run proofs, `authoring-verbs.ts`'s `commitOrReport`/`clearRowsByKey`
//      callers).
//   2. this package's `AuthorTarget`-facing local-folder driver (`author-
//      target.ts` in shared tool runtime) — resolving/listing rows against a TOML
//      folder needs the SAME natural-key knowledge the workspace merge already
//      has, generically, for ANY row kind present in that folder.
//
// world-author has no dependency on shared tool runtime (see that package's own
// authoring-harness.ts header) — shared tool runtime depends on world-author, so
// this is the correct direction: the generic manifest-shape fact lives here,
// shared tool runtime imports it.
//
// The full provenance/verification history (`commit.rs`'s authored-key
// branches, `spatial_state_definitions`, `actor_identities`, …) now lives on
// the Rust `ROW_KIND_NATURAL_KEY` const's own doc comment — see
// `crates/spellkave-authoring/src/row_kinds.rs`, not duplicated here.
import {
	export_not_round_tripped_json,
	row_kind_composite_key_json,
	row_kind_natural_key_json,
	row_kind_storage_key_json,
} from "@spellkave/authoring-wasm";
import { setExportNotRoundTripped, setRowKindMaps } from "./row-kinds-data";

export const ROW_KIND_NATURAL_KEY: Readonly<Record<string, string>> = Object.freeze(
	JSON.parse(row_kind_natural_key_json()) as Record<string, string>,
);

/**
 * Manifest row-kind -> ordered composite-key fields (srd-cc battle-test
 * ledger finding #9, 2026-07-26): the `*_tag` satellite kinds, each
 * `{<parent_field>, "tag"}` — absent from `ROW_KIND_NATURAL_KEY` above
 * because a bare tag value is not a row's identity (many tag rows share the
 * same parent). Same Rust-owned single-source-of-truth discipline as
 * `ROW_KIND_NATURAL_KEY` — see `crates/spellkave-authoring/src/row_kinds.rs`'s
 * `ROW_KIND_COMPOSITE_KEY` doc comment for the full provenance note and why
 * only the uniform `*_tag` kinds are covered here (other satellite/junction
 * kinds are non-uniform and deliberately left out).
 */
export const ROW_KIND_COMPOSITE_KEY: Readonly<Record<string, readonly string[]>> = Object.freeze(
	Object.fromEntries(
		Object.entries(JSON.parse(row_kind_composite_key_json()) as Record<string, string[]>).map(
			([kind, fields]) => [kind, Object.freeze(fields)],
		),
	),
);

/**
 * Manifest row-kind -> ordered storage-key fields (ADR-0146,
 * sk-jay0.7.174.30): the wider set of kinds whose server-side identity/
 * upsert key is more than the `*_tag` uniform pair — junction/satellite rows
 * (`entity_definition_initial_*`, `actor_capabilities`, `object_state`, the
 * twelve `*_tag` kinds plus `entity_tag`, …) each verified field-by-field
 * against their own manifest row struct and server upsert. Same Rust-owned
 * single-source-of-truth discipline as `ROW_KIND_NATURAL_KEY`/
 * `ROW_KIND_COMPOSITE_KEY` above — see
 * `crates/spellkave-schema/src/row_identity.rs`'s `ROW_KIND_STORAGE_KEY` doc
 * comment for the full per-kind provenance. A kind present here and in
 * `ROW_KIND_COMPOSITE_KEY` (the `*_tag` kinds) carries the WIDER key here —
 * `ROW_KIND_COMPOSITE_KEY` stays the narrower `(parent, "tag")` shape only
 * `diff-manifest-core.ts` still reads (see `row_identity.rs`'s own doc
 * comment for why that consumer keeps the narrower shape).
 */
export const ROW_KIND_STORAGE_KEY: Readonly<Record<string, readonly string[]>> = Object.freeze(
	Object.fromEntries(
		Object.entries(JSON.parse(row_kind_storage_key_json()) as Record<string, string[]>).map(
			([kind, fields]) => [kind, Object.freeze(fields)],
		),
	),
);

setRowKindMaps(ROW_KIND_NATURAL_KEY, ROW_KIND_COMPOSITE_KEY);
setExportNotRoundTripped(
	Object.freeze(JSON.parse(export_not_round_tripped_json()) as Record<string, string[]>),
);
