// Authoring operations over a parsed, schema-shaped manifest object.
//
// These mutate the raw `Record<string, unknown>` shape that
// `inspectManifest(...).manifest` yields and `renderSchemaManifest(...)`
// serializes — the same object the validator consumes. They live in the SDK (not
// the CLI shell) so any author — the `manifest patch` command, a bulk importer,
// a future GUI — drives one authoring surface. Adding a row kind here makes it
// available everywhere at once.
//
// #1968 R7 (ADR-0087, tasks.md section 3): all 13 manifest-mutation ops this
// module used to hand-implement (row shape, upsert-by-natural-key semantics,
// field coercion) are now Rust-owned in `spellkave-authoring::patch`, exposed
// through the `patch_manifest_json` wasm export — see that crate's
// `src/patch/mod.rs` for the op dispatcher and `src/patch/support.rs` for the
// shared read/write contract (whole-manifest JSON in, only-the-changed-
// table(s) JSON out) every op follows. This file is now a thin forwarder;
// the per-op provenance comments this file used to carry (schema line
// numbers, canon-warden conditions, deny_unknown_fields traps, upsert-key
// rationale) now live on each Rust function's own doc comment instead.

import { patch_manifest_json } from "@spellkave/authoring-wasm";

/**
 * Apply one authoring operation to a parsed schema-shaped manifest object, in
 * place. Exported so every author — the `manifest patch` CLI command and bulk
 * importers (e.g. the SRD Foundry importer) alike — drives the same authoring
 * surface, in-process, without one subprocess per row.
 *
 * Forwards to the Rust-owned `patch_manifest_json` wasm export, which reads
 * the WHOLE manifest for context (bundle_id fallback, existing rows to
 * upsert against) but returns ONLY the table(s) the op actually mutated —
 * every other table on `manifest` stays the exact same JS array it already
 * was, never round-tripped through this call. An unrecognized `op` throws
 * the same `unknown patch op: <op>` error the wasm dispatcher's own fallback
 * arm produces.
 */
export function patchManifest(
	manifest: Record<string, unknown>,
	op: string,
	payload: Record<string, unknown>,
): void {
	const patchedJson = patch_manifest_json(JSON.stringify(manifest), op, JSON.stringify(payload));
	const patched = JSON.parse(patchedJson) as Record<string, unknown[]>;
	for (const [table, rows] of Object.entries(patched)) {
		manifest[table] = rows;
	}
}
