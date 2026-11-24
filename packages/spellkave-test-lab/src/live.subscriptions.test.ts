import { READER_SCOPED_TABLES } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import {
	MANIFEST_SETUP_READER_MANIFEST,
	operatorScopeManifest,
	resolveInitialReaderManifests,
} from "./live";

// Ledger finding #12 (`packages/spellkave-srd-cc/ledger/findings.md`):
// passing a custom `readerManifests` array to `connectTestWorld` used to
// REPLACE the default set outright, silently dropping `manifest_apply_digest`
// — a production apply-wait table (`MANIFEST_APPLY_WAIT_TABLES`) that
// test-lab's throwing wrappers (`applyManifestSource`/`applyManifestDelta`)
// still need subscribed. A caller that narrowed manifests for its own test
// (with no idea that table mattered) got every later manifest-apply drain-wait
// hanging forever. This is the pure seam that decision lives in — no live
// node needed to prove it.
describe("resolveInitialReaderManifests", () => {
	it("returns the full reader-scoped catalog default when no manifests are given", () => {
		const resolved = resolveInitialReaderManifests(undefined);
		expect(resolved).toContain(MANIFEST_SETUP_READER_MANIFEST);
		const tables = new Set(resolved.flatMap((m) => m.requiredTables));
		expect(tables.has("manifest_apply_digest")).toBe(true);
		// The full default carries far more than the core manifest alone.
		expect(tables.size).toBeGreaterThan(1);
		for (const t of READER_SCOPED_TABLES) expect(tables.has(t)).toBe(true);
		// Registered-reader tables that live ONLY in reader registrations, not
		// in the static catalog. Their absence from the first manifest-only
		// default blinded the srd-cc arena proofs (positions, turn roster) on
		// the live tier (#2080) — pin them so the default can never narrow
		// below production `connect()`'s no-manifests fallback again.
		expect(tables.has("visible_entity_location")).toBe(true);
		expect(tables.has("visible_session_participant")).toBe(true);
	});

	it("extends a caller-supplied narrow set with the always-on core manifest", () => {
		const resolved = resolveInitialReaderManifests([{ requiredTables: ["resource_definition"] }]);
		const tables = new Set(resolved.flatMap((m) => m.requiredTables));
		expect(tables.has("resource_definition")).toBe(true);
		// The exact bug ledger finding #12 hit: a narrow custom set must never
		// come back without manifest_apply_digest.
		expect(tables.has("manifest_apply_digest")).toBe(true);
		expect(resolved).toHaveLength(2);
	});

	it("tolerates the caller already naming manifest_apply_digest — table union stays deduped", () => {
		const resolved = resolveInitialReaderManifests([MANIFEST_SETUP_READER_MANIFEST]);
		// Two manifest entries (caller's + the always-appended core one) are
		// harmless: `buildSubscribeSet` dedupes the table union via `Set` when
		// the connect-time subscribe query list is built.
		expect(resolved).toEqual([MANIFEST_SETUP_READER_MANIFEST, MANIFEST_SETUP_READER_MANIFEST]);
		const tables = new Set(resolved.flatMap((m) => m.requiredTables));
		expect([...tables]).toEqual(["manifest_apply_digest", "manifest_apply_outcome"]);
	});
});

describe("operatorScopeManifest", () => {
	it("builds a manifest from arbitrary table names outside the TableName catalog", () => {
		const manifest = operatorScopeManifest("srd-cc-god-view", [
			"effect_definition",
			"modifier_template",
		]);
		expect(manifest.requiredTables).toEqual(["effect_definition", "modifier_template"]);
	});

	it("rejects an empty table list", () => {
		expect(() => operatorScopeManifest("empty", [])).toThrow(/must not be empty/);
	});
});
