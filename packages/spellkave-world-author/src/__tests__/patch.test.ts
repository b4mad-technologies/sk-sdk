// embedded-manifest: {"category": "schema_object_oracle", "rationale": "compact base rows are direct algorithm oracles for generic patch operations", "signatures": ["schema_object", "schema_shape"]}
// Roll-table patch ops (#1577) — add-roll-table / add-roll-table-entry /
// add-roll-table-tag / add-roll-table-entry-tag. Covers upsert semantics,
// cascade, idempotency, the number-vs-string field guards the canon-warden
// pre-ruling made load-bearing (deny_unknown_fields on every RollTable* row),
// and a render+validate round trip through the same wasm validator the
// server runs.

import { describe, expect, it } from "vitest";
import { renderSchemaManifestJson } from "../manifest";
import { patchManifest } from "../patch";
import { validateManifestToml } from "../validate";

function baseManifest(bundleId = "test_bundle"): Record<string, unknown> {
	return {
		schema_version: "1.0.0",
		metadata: { profile: bundleId },
		bundles: [
			{
				bundle_id: bundleId,
				display_name: "Test",
				author: "test",
				version: "1.0.0",
				depends_on: [],
				description: "roll-table patch op fixture",
			},
		],
	};
}

describe("add-roll-table", () => {
	it("upserts by roll_table_id, replacing an existing row rather than duplicating", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table", {
			roll_table_id: "test_bundle/d6",
			display_name: "d6 (first)",
			result_kind: "int",
		});
		patchManifest(manifest, "add-roll-table", {
			roll_table_id: "test_bundle/d6",
			display_name: "d6 (second)",
			result_kind: "int",
		});
		const rows = manifest.roll_tables as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.display_name).toBe("d6 (second)");
	});

	it("falls back to the first bundle_id when omitted", () => {
		const manifest = baseManifest("author-fallback-bundle");
		patchManifest(manifest, "add-roll-table", {
			roll_table_id: "author-fallback-bundle/d6",
			display_name: "d6",
			result_kind: "int",
		});
		const rows = manifest.roll_tables as Record<string, unknown>[];
		expect(rows[0]?.bundle_id).toBe("author-fallback-bundle");
	});

	it("cascades to roll_table_tag: re-authoring without tags drops the prior tag rows", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table", {
			roll_table_id: "test_bundle/d6",
			display_name: "d6",
			result_kind: "int",
			tags: ["core", "die"],
		});
		expect((manifest.roll_table_tag as unknown[]).length).toBe(2);

		patchManifest(manifest, "add-roll-table", {
			roll_table_id: "test_bundle/d6",
			display_name: "d6",
			result_kind: "int",
		});
		expect(manifest.roll_table_tag as unknown[]).toEqual([]);
	});

	it("requires the four schema-exact fields (no extras, no defaults)", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-roll-table", { roll_table_id: "test_bundle/d6" }),
		).toThrow(/display_name/);
		patchManifest(manifest, "add-roll-table", {
			roll_table_id: "test_bundle/d6",
			display_name: "d6",
			result_kind: "int",
		});
		const row = (manifest.roll_tables as Record<string, unknown>[])[0];
		expect(Object.keys(row ?? {}).sort()).toEqual([
			"bundle_id",
			"display_name",
			"result_kind",
			"roll_table_id",
		]);
	});
});

describe("add-roll-table-entry", () => {
	it("upserts by roll_table_entry_id, replacing an existing row rather than duplicating", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table-entry", {
			roll_table_entry_id: "test_bundle/d6:1",
			roll_table_id: "test_bundle/d6",
			authored_order: 1,
			weight: 1,
			result_ref: "1",
		});
		patchManifest(manifest, "add-roll-table-entry", {
			roll_table_entry_id: "test_bundle/d6:1",
			roll_table_id: "test_bundle/d6",
			authored_order: 1,
			weight: 5,
			result_ref: "1",
		});
		const rows = manifest.roll_table_entries as Record<string, unknown>[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.weight).toBe(5);
	});

	it("never emits bundle_id — RollTableEntryRow has none and deny_unknown_fields rejects it", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table-entry", {
			roll_table_entry_id: "test_bundle/d6:1",
			roll_table_id: "test_bundle/d6",
			authored_order: 1,
			weight: 1,
			result_ref: "1",
		});
		const row = (manifest.roll_table_entries as Record<string, unknown>[])[0];
		expect(row).not.toHaveProperty("bundle_id");
		expect(Object.keys(row ?? {}).sort()).toEqual([
			"authored_order",
			"result_ref",
			"roll_table_entry_id",
			"roll_table_id",
			"weight",
		]);
	});

	it("does not synthesize roll_table_entry_id — it is a required field, not derived", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-roll-table-entry", {
				roll_table_id: "test_bundle/d6",
				authored_order: 1,
				weight: 1,
				result_ref: "1",
			}),
		).toThrow(/roll_table_entry_id/);
	});

	it("guards authored_order/weight as numbers, rejecting string values", () => {
		const manifest = baseManifest();
		expect(() =>
			patchManifest(manifest, "add-roll-table-entry", {
				roll_table_entry_id: "test_bundle/d6:1",
				roll_table_id: "test_bundle/d6",
				authored_order: "1",
				weight: 1,
				result_ref: "1",
			}),
		).toThrow(/authored_order/);
		expect(() =>
			patchManifest(manifest, "add-roll-table-entry", {
				roll_table_entry_id: "test_bundle/d6:1",
				roll_table_id: "test_bundle/d6",
				authored_order: 1,
				weight: "1",
				result_ref: "1",
			}),
		).toThrow(/weight/);
	});

	it("stringifies result_ref even when authored as a number (result_kind == 'int')", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table-entry", {
			roll_table_entry_id: "test_bundle/d6:1",
			roll_table_id: "test_bundle/d6",
			authored_order: 1,
			weight: 1,
			result_ref: 1,
		});
		const row = (manifest.roll_table_entries as Record<string, unknown>[])[0];
		expect(row?.result_ref).toBe("1");
		expect(typeof row?.result_ref).toBe("string");
	});
});

describe("add-roll-table-tag", () => {
	it("idempotent upsert by (roll_table_id, tag, source): re-authoring the same triple does not duplicate", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table-tag", { roll_table_id: "test_bundle/d6", tag: "die" });
		patchManifest(manifest, "add-roll-table-tag", { roll_table_id: "test_bundle/d6", tag: "die" });
		expect((manifest.roll_table_tag as unknown[]).length).toBe(1);
	});

	it("a different source on the same (roll_table_id, tag) is a distinct row", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table-tag", { roll_table_id: "test_bundle/d6", tag: "die" });
		patchManifest(manifest, "add-roll-table-tag", {
			roll_table_id: "test_bundle/d6",
			tag: "die",
			source: "import",
		});
		expect((manifest.roll_table_tag as unknown[]).length).toBe(2);
	});

	it("defaults source to 'manifest'", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table-tag", { roll_table_id: "test_bundle/d6", tag: "die" });
		const row = (manifest.roll_table_tag as Record<string, unknown>[])[0];
		expect(row?.source).toBe("manifest");
	});
});

describe("add-roll-table-entry-tag", () => {
	it("idempotent upsert by (roll_table_entry_id, tag, source): re-authoring the same triple does not duplicate", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table-entry-tag", {
			roll_table_entry_id: "test_bundle/d6:1",
			tag: "die",
		});
		patchManifest(manifest, "add-roll-table-entry-tag", {
			roll_table_entry_id: "test_bundle/d6:1",
			tag: "die",
		});
		expect((manifest.roll_table_entry_tag as unknown[]).length).toBe(1);
	});

	it("a different source on the same (roll_table_entry_id, tag) is a distinct row", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table-entry-tag", {
			roll_table_entry_id: "test_bundle/d6:1",
			tag: "die",
		});
		patchManifest(manifest, "add-roll-table-entry-tag", {
			roll_table_entry_id: "test_bundle/d6:1",
			tag: "die",
			source: "import",
		});
		expect((manifest.roll_table_entry_tag as unknown[]).length).toBe(2);
	});

	it("carries bundle_id (unlike the entry row itself) via the shared fallback", () => {
		const manifest = baseManifest("author-fallback-bundle");
		patchManifest(manifest, "add-roll-table-entry-tag", {
			roll_table_entry_id: "author-fallback-bundle/d6:1",
			tag: "die",
		});
		const row = (manifest.roll_table_entry_tag as Record<string, unknown>[])[0];
		expect(row?.bundle_id).toBe("author-fallback-bundle");
	});
});

describe("render + validate round trip", () => {
	it("a minimal manifest built purely from the four ops renders and validates clean", () => {
		const manifest = baseManifest();
		patchManifest(manifest, "add-roll-table", {
			roll_table_id: "test_bundle/d6",
			display_name: "d6",
			result_kind: "int",
			tags: ["die"],
		});
		for (let i = 1; i <= 6; i++) {
			patchManifest(manifest, "add-roll-table-entry", {
				roll_table_entry_id: `test_bundle/d6:${i}`,
				roll_table_id: "test_bundle/d6",
				authored_order: i,
				weight: 1,
				result_ref: i,
			});
			patchManifest(manifest, "add-roll-table-entry-tag", {
				roll_table_entry_id: `test_bundle/d6:${i}`,
				tag: "die",
			});
		}
		patchManifest(manifest, "add-roll-table-tag", { roll_table_id: "test_bundle/d6", tag: "core" });

		const toml = renderSchemaManifestJson(JSON.stringify(manifest));
		expect(toml).toContain('roll_table_id = "test_bundle/d6"');
		expect(toml).toContain('result_ref = "6"');

		const diagnostics = validateManifestToml(toml);
		const fatal = diagnostics.filter((d) => d.severity === "fatal");
		expect(fatal).toEqual([]);
	});
});
