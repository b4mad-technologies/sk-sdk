import { metadata_target_kinds_json } from "@spellkave/validate-wasm";
import { describe, expect, it } from "vitest";
import { METADATA_TARGET_KINDS } from "../src/core/readers/entity_art";

// sk-jay0.3.8: `METADATA_TARGET_KINDS` in `entity_art.ts` is a hand-mirror of
// `spellkave_validate::METADATA_TARGET_KINDS`, which is itself pinned to the
// server's `TARGET_KINDS`. The mirror had no guard: a kind added on the Rust
// side simply never reached `PublicArtTargetKind`, and public subject art on
// that kind read as an unknown target here.
//
// `spellkave-validate-wasm` is a devDependency only. The runtime const stays
// a plain literal array — this package keeps no extra runtime deps (see
// packages/spellkave-sdk/CLAUDE.md §4, host-neutrality) — so the wasm module
// is loaded by the test, never by a consumer.

describe("METADATA_TARGET_KINDS", () => {
	it("mirrors the kinds the Rust validator admits", () => {
		const admitted = JSON.parse(metadata_target_kinds_json()) as string[];
		expect([...METADATA_TARGET_KINDS].sort()).toEqual([...admitted].sort());
	});

	it("reads a non-empty list from the wasm export", () => {
		// Without this, a broken export returning its "[]" fallback would
		// make the comparison above pass on two empty lists.
		const admitted = JSON.parse(metadata_target_kinds_json()) as string[];
		expect(admitted.length).toBeGreaterThan(0);
		expect(admitted).toContain("bundle");
	});
});
