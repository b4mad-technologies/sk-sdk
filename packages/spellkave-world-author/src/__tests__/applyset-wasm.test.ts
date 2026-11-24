// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "minimal applyset roots with and without `applyset` pin the wasm part builder and the refusal", "signatures": ["toml_version", "schema_directive", "schema_shape"]}
import { describe, expect, it } from "vitest";

import { buildApplysetParts, manifestRowIdentities } from "../applyset";

const HEADER = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
`;

const SPELL = `[[capability_definitions]]
capability_id = "demo/spark"
bundle_id = "demo"
display_name = "Spark"
actor_kind = "entity"
default_visibility = "Public"
description = "Test capability"
`;

describe("row identities through wasm", () => {
	it("assigns stable identities to authored capability rows", () => {
		const ids = manifestRowIdentities(SPELL, false);
		expect(ids.rows).toEqual([
			expect.objectContaining({ kind: "capability_definitions", key: "demo/spark", hash: expect.stringMatching(/^[a-f0-9]{64}$/) }),
		]);
		expect(manifestRowIdentities(SPELL, false)).toEqual(ids);
		expect(ids.untrackable).toEqual([]);
	});
});

describe("applyset parts through wasm", () => {
	it("builds parts, keeps the last duplicate and names the applyset", () => {
		const parts = buildApplysetParts(
			{ path: "manifest.toml", toml: HEADER.concat('applyset = "spells"\n') },
			[
				{ path: "a.toml", toml: SPELL },
				{ path: "b.toml", toml: SPELL },
			],
		);
		expect(parts.applyset).toBe("spells");
		expect(parts.parts.map((p) => [p.path, p.entries.length])).toEqual([
			["manifest.toml", 0],
			["a.toml", 0],
			["b.toml", 1],
		]);
		expect(parts.duplicates).toHaveLength(1);
		expect(parts.duplicates.every((d) => d.identical)).toBe(true);
	});

	it("refuses a root without an applyset", () => {
		expect(() => buildApplysetParts({ path: "manifest.toml", toml: HEADER }, [])).toThrow(
			/declares no .applyset./,
		);
	});
});

describe("withRootApplyset", () => {
	it("inserts after schema_version and replaces an existing name", async () => {
		const { withRootApplyset } = await import("../manifest");
		const once = withRootApplyset(HEADER, "srd");
		expect(once).toBe(HEADER.replace('"1.0.0"\n', '"1.0.0"\napplyset = "srd"\n'));
		expect(withRootApplyset(once, "other")).toContain('applyset = "other"');
		expect(withRootApplyset(once, "other")).not.toContain('applyset = "srd"');
		expect(() => withRootApplyset("x = 1\n", "srd")).toThrow(/not a root/);
		expect(() => withRootApplyset(HEADER, "Bad Name")).toThrow(/invalid applyset name/);
	});
});
