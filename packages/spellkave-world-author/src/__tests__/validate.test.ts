// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "validator tests require exact minimal inputs and malformed counterexamples", "signatures": ["toml_version", "schema_directive", "schema_shape"]}
// Proves the authoring SDK's pre-flight validation works OFFLINE via the vendored
// validate-wasm package — the same Rust validator the server runs, in-process. If
// the vendored pkg/ is missing or broken, this test fails under `just ci-js`.

// ci-allow(embedded-manifest-schema): validator malformed-input oracle - broken TOML is the whole point
import { describe, expect, it } from "vitest";
import { renderManifest, type WorldManifest } from "../manifest";
import {
	isValid,
	validateActorCapabilityRows,
	validateCapabilityNicheProvider,
	validateManifest,
	validateManifestToml,
} from "../validate";

const SCHEMA = "#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json";

describe("validateManifestToml — same-validator pre-flight", () => {
	it("returns [] for a well-formed manifest", () => {
		const diags = validateManifestToml(`${SCHEMA}\nschema_version = "1.0.0"\n`);
		expect(diags).toEqual([]);
		expect(isValid(diags)).toBe(true);
	});

	it("flags a missing schema directive with MF-FMT-001", () => {
		const diags = validateManifestToml('schema_version = "1.0.0"\n');
		expect(diags).not.toHaveLength(0);
		expect(diags[0]?.code).toBe("MF-FMT-001");
		expect(diags[0]?.severity).toBe("fatal");
		expect(isValid(diags)).toBe(false);
	});

	it("flags a malformed schema version with a validator code (not a parse error)", () => {
		const diags = validateManifestToml(`${SCHEMA}\nschema_version = "9.9.9"\n`);
		expect(diags.some((d) => d.code.startsWith("MF-"))).toBe(true);
	});

	it("maps span snake_case → camelCase when the validator reports one", () => {
		// Every diagnostic that carries a span must expose camelCase fields, never
		// the raw start_line/start_col the wasm emits.
		for (const d of validateManifestToml('schema_version = "1.0.0"\n')) {
			if (d.span) {
				expect(d.span).toHaveProperty("startLine");
				expect(d.span).not.toHaveProperty("start_line");
			}
		}
	});

	const validMetadataPayloads: Array<[string, unknown]> = [
		["provenance.source", { work: "Lost Mine of Phandelver", page: "7" }],
		["editorial.note", { text: "verify later" }],
		["observer.summary", { text: "Watcher-facing summary." }],
		["art.prompt", { prompt: "A wooded trail bend." }],
		["art.image", { path: "assets/cragmaw-castle.png", license: "private-reconstruction" }],
		["narration.read_aloud", { text: "Read this aloud.", trigger: "first_entry" }],
		["driver.persona", { personality: "blustering", goals: ["rule"], secrets: ["fear"] }],
	];

	for (const [namespace, payload] of validMetadataPayloads) {
		it(`accepts metadata namespace ${namespace}`, () => {
			const diags = validateManifestToml(metadataToml(namespace, payload));
			expect(diags.filter((d) => d.code === "WA-META-001")).toEqual([]);
		});
	}

	const authorDefinedMetadataPayloads: Array<[string, unknown]> = [
		["provenance.source", { page: "7" }],
		["editorial.note", { note: "wrong key" }],
		["observer.summary", { text: 42 }],
		["art.prompt", { prompt: "" }],
		["art.image", { path: ["bad"] }],
		["narration.read_aloud", { trigger: "first_entry" }],
		["driver.persona", { personality: "quiet", goals: "not-array" }],
	];

	for (const [namespace, payload] of authorDefinedMetadataPayloads) {
		it(`accepts author-defined metadata payload shape for ${namespace}`, () => {
			const diags = validateManifestToml(metadataToml(namespace, payload));
			expect(diags.filter((d) => d.code === "WA-META-001")).toEqual([]);
		});
	}

	it("rejects metadata payloads that are not JSON objects", () => {
		const diags = validateManifestToml(metadataToml("art.prompt", ["not", "an", "object"]));
		expect(diags.some((d) => d.code === "WA-META-001" && d.message.includes("JSON object"))).toBe(
			true,
		);
	});

	it("rejects an unknown metadata namespace offline", () => {
		const diags = validateManifestToml(metadataToml("map.anchor", { x: 1 }));
		expect(diags.some((d) => d.code === "WA-META-001" && d.message.includes("unknown"))).toBe(true);
	});
});

// sk-jay0.7.23.29: `validateManifestToml` memoizes by exact `toml` text (the
// world-author tool boundary's fix for `commitOrReport` re-validating the
// same target-augmented content on every author call). These tests pin the
// two properties that memoization must never break: a cache hit returns the
// SAME diagnostics a fresh call would (proven directly, not just "truthy"),
// and no caller can corrupt a later cache hit by mutating the array it got
// back — `commitOrReport`/`dropTargetDeferredDiagnostics` filter and map the
// result but never mutate in place, and this pins that contract at the
// module boundary too so a future caller can't silently violate it.
describe("validateManifestToml — memoization", () => {
	it("a cache hit for identical input equals a fresh call's diagnostics", () => {
		const toml = metadataToml("map.anchor", { x: 1 });
		const first = validateManifestToml(toml);
		const second = validateManifestToml(toml);
		expect(second).toEqual(first);
		expect(second).not.toHaveLength(0);
	});

	it("mutating a returned array does not corrupt the next call's result", () => {
		const toml = metadataToml("map.anchor", { x: 1 });
		const first = validateManifestToml(toml);
		const originalLength = first.length;
		first.push({ code: "TEST-ONLY", severity: "fatal", message: "mutated", path: "$" });
		first.length = 0;
		const second = validateManifestToml(toml);
		expect(second).toHaveLength(originalLength);
	});

	it("different input never reuses another input's cached diagnostics", () => {
		const clean = validateManifestToml(`${SCHEMA}\nschema_version = "1.0.0"\n`);
		const broken = validateManifestToml('schema_version = "1.0.0"\n');
		expect(clean).toEqual([]);
		expect(broken[0]?.code).toBe("MF-FMT-001");
	});
});

describe("validateManifest — render + validate in one step", () => {
	const minimal: WorldManifest = {
		header: {
			bundleId: "test_bundle",
			displayName: "Test",
			author: "test",
			version: "1.0.0",
			dependsOn: [],
			description: "round-trip fixture",
		},
	};

	it("renders a typed manifest and validates the rendered TOML", () => {
		// Sanity: the rendered TOML is what the validator sees.
		expect(renderManifest(minimal)).toContain('bundle_id = "test_bundle"');
		// A header-only bundle is structurally clean (no cross-row refs to dangle).
		expect(validateManifest(minimal)).toEqual([]);
	});
});

describe("validateActorCapabilityRows — sk-dms.28 ADR-0085 upsert-key blind spot", () => {
	it("returns [] for distinct (actor_entity_key, capability_id) pairs", () => {
		const diags = validateActorCapabilityRows([
			{ actor_entity_key: "a", capability_id: "cap/one" },
			{ actor_entity_key: "a", capability_id: "cap/two" },
			{ actor_entity_key: "b", capability_id: "cap/one" },
		]);
		expect(diags).toEqual([]);
	});

	it("returns [] for an undefined/empty row list", () => {
		expect(validateActorCapabilityRows(undefined)).toEqual([]);
		expect(validateActorCapabilityRows([])).toEqual([]);
	});

	it(
		"warns (WA-CAP-001) on a second row sharing (actor_entity_key, capability_id) — the exact " +
			"sk-dms.28 shape: two authored extents on one capability id, one silently dropped by the " +
			"ADR-0085 commit upsert",
		() => {
			const diags = validateActorCapabilityRows([
				{
					actor_entity_key: "kavemouth/adventure/npc/aldwin_1",
					capability_id: "kavemouth/dm/watch",
				},
				{
					actor_entity_key: "kavemouth/adventure/npc/aldwin_1",
					capability_id: "kavemouth/dm/watch",
				},
			]);
			expect(diags).toHaveLength(1);
			expect(diags[0]?.code).toBe("WA-CAP-001");
			expect(diags[0]?.severity).toBe("warning");
			expect(diags[0]?.message).toContain("kavemouth/dm/watch");
		},
	);

	it("is wired into validateManifestToml as a non-fatal warning on the rendered manifest", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "cap_test"
display_name = "Cap Test"
author = "test"
version = "1.0.0"
depends_on = []
description = "actor_capabilities dup-warning fixture"

[[capability_definitions]]
bundle_id = "cap_test"
capability_id = "cap_test/cap/one"
display_name = "Declared ordinary capability"
actor_kind = "player"
description = "Vocabulary for the duplicate-grant warning fixture."

[[actor_capabilities]]
actor_entity_key = "cap_test/actor_1"
capability_id = "cap_test/cap/one"
bundle_id = "cap_test"
source = "cap_test"
source_args_hash = ""
elevation_class = ""
extent_kind_ref = ""
extent_ref = ""

[[actor_capabilities]]
actor_entity_key = "cap_test/actor_1"
capability_id = "cap_test/cap/one"
bundle_id = "cap_test"
source = "cap_test"
source_args_hash = ""
elevation_class = ""
extent_kind_ref = ""
extent_ref = ""
`;
		const diags = validateManifestToml(toml);
		const capDiags = diags.filter((d) => d.code === "WA-CAP-001");
		expect(capDiags).toHaveLength(1);
		expect(capDiags[0]?.severity).toBe("warning");
		// A warning is not fatal — isValid stays true unless something else fails.
		expect(isValid(diags.filter((d) => d.severity === "fatal"))).toBe(true);
	});
});

describe("validateCapabilityNicheProvider — WA-CAP-002 required provider on capability:*", () => {
	it("returns [] when a capability:* niche declares an explicit provider", () => {
		const diags = validateCapabilityNicheProvider(
			[{ niche_id: "capability:srd/action/dodge", provider: "actor" }],
			[{ niche_id: "capability:srd/action/dodge", template_id: "srd/dodge/affordance" }],
		);
		expect(diags).toEqual([]);
	});

	it("returns [] for undefined/empty row lists and for ordinary (non-capability:*) niches with empty provider", () => {
		expect(validateCapabilityNicheProvider(undefined, undefined)).toEqual([]);
		expect(validateCapabilityNicheProvider([], [])).toEqual([]);
		expect(
			validateCapabilityNicheProvider(
				[{ niche_id: "kavemouth/niche/hazard_pool", provider: "" }],
				[{ niche_id: "creature" }],
			),
		).toEqual([]);
	});

	it("fatals (WA-CAP-002) on a capability:* niche_definitions row with no provider", () => {
		const diags = validateCapabilityNicheProvider(
			[{ niche_id: "capability:srd/class-feature/fighter/second-wind", provider: "" }],
			[],
		);
		expect(diags).toHaveLength(1);
		expect(diags[0]?.code).toBe("WA-CAP-002");
		expect(diags[0]?.severity).toBe("fatal");
		expect(diags[0]?.message).toContain("capability:srd/class-feature/fighter/second-wind");
	});

	it("fatals (WA-CAP-002) on a capability:* affordance with no niche_definitions row", () => {
		const diags = validateCapabilityNicheProvider(
			[],
			[
				{
					niche_id: "capability:srd/class-feature/fighter/second-wind",
					template_id: "srd/fighter/second-wind/affordance",
				},
			],
		);
		expect(diags).toHaveLength(1);
		expect(diags[0]?.code).toBe("WA-CAP-002");
		expect(diags[0]?.severity).toBe("fatal");
	});

	it("is wired into validateManifestToml as a fatal", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "niche_test"
display_name = "Niche Test"
author = "test"
version = "1.0.0"
depends_on = []
description = "capability:* niche without a definition row"

[[affordance_templates]]
template_id = "niche_test/second-wind/affordance"
bundle_id = "niche_test"
niche_id = "capability:niche_test/second-wind"
capability_id = "niche_test/second-wind"
display_name = "Use Second Wind"
predicate_source = ""
outcome_template_id = "niche_test/second-wind/outcome"
`;
		const diags = validateManifestToml(toml);
		const capDiags = diags.filter((d) => d.code === "WA-CAP-002");
		expect(capDiags).toHaveLength(1);
		expect(capDiags[0]?.severity).toBe("fatal");
		expect(isValid(diags)).toBe(false);
	});
});

function metadataToml(namespace: string, payload: unknown): string {
	return `${SCHEMA}
schema_version = "1.0.0"

[metadata]
profile = "metadata_test"

[[bundles]]
bundle_id = "metadata_test"
display_name = "Metadata Test"
author = "test"
version = "1.0.0"
depends_on = []
description = "metadata validation fixture"

[[metadata_attachments]]
target_kind = "place_graph"
target_ref = "metadata_test/graph"
namespace = "${namespace}"
payload_json = '${JSON.stringify(payload)}'
bundle_id = "metadata_test"

${
	namespace === "map.anchor"
		? ""
		: `[[metadata_namespaces]]
namespace = "${namespace}"
audience = "author"
bundle_id = "metadata_test"
`
}
`;
}
