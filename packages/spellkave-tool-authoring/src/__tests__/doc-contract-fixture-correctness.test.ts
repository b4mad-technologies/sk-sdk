// embedded-manifest: {"category": "exact_text_oracle", "rationale": "fixture-correctness documentation tests require exact duplicate-row counterexamples"}
// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "verb-authored manifests directly exercise fixture-correctness documentation promises"}
// Doc-contract test suite, "fixture-correctness catalog" slice (#1968 "docs
// as testable promises" — the DOC-PROMISE follow-up pass sweeping the
// remaining `MF-VAL-*` rows in `fixture-correctness.md`'s catalog). A
// SEPARATE file from `doc-contract.test.ts`/`doc-contract-live.test.ts`/
// `doc-contract-dsl.test.ts` (not this agent's to edit —
// the `doc-promises` skgate registry gate scans EVERY `doc-contract*.test.ts`
// under a package's `src/__tests__/`, so a new file joins the SAME gate
// without touching another agent's).
//
// OFFLINE ONLY, same posture as `doc-contract.test.ts`'s own header. Each row
// claims "a diagnostic fires under a condition" — proven here through the
// AUTHOR-facing verb layer (`spellkave_write_rows` via
// `createAuthorFacingBoundTools`) EXACTLY where the MF-VAL-254/271 tests already
// in `doc-contract.test.ts` templated it: attempt the offending write,
// observe the graceful `{ ok: false, diagnostics: [...] }` result (never a
// thrown exception), confirm nothing new persists.
//
// THREE codes (MF-VAL-266, MF-VAL-272, MF-VAL-270) go DIRECT to
// `validateManifestToml` instead, and this is a genuine finding, not a style
// choice: `spellkave_write_rows`'s own workspace-idempotency upsert REPLACES
// a row sharing a key instead of duplicating it — by design (closes
// MF-VAL-272 on a re-run, the tool's own doc comment says so explicitly).
// For MF-VAL-266/272 that key is `ROW_KIND_NATURAL_KEY` (`capability_id`/
// `resource_definition_id`/...); for MF-VAL-270 (ADR-0146,
// sk-jay0.7.174.30) it is `object_state`'s own `ROW_KIND_STORAGE_KEY` entry
// `(entity_key, state_id)`. That means an author driving ONLY the verb layer
// can never actually manufacture a same-key duplicate within one workspace —
// for MF-VAL-266/272 the failure mode is a MULTI-BUNDLE-MERGE hazard (a
// generator + a hand-authored sibling both emitting the same id, R3's own
// catalog text); for MF-VAL-270 it is TWO rows in a single `write_rows` call
// (the shipped Bat-HP-clobbered-to-30 shape the catalog names) — a case
// `spellkave_write_rows` now resolves silently by upsert (last row wins, one
// row persists) rather than ever handing the duplicate to the validator. In
// either case, direct `validateManifestToml` against a hand-composed
// manifest is the only way to reproduce the condition these rows actually
// describe.
//
// STAYS HERE (#1968 srd-content-package, tasks.md 1.1/7.3, design.md D-3):
// classified substrate-tier, not content-mechanics. Every case drives the
// generic `spellkave_write_rows`/`validateManifestToml` MF-VAL diagnostic
// catalog against synthetic scratch-workspace bundles (`probe_a`, `probe_b`,
// `onramp_probe`, `probe`); the two cases below using `bundle: "srd"`
// (MF-VAL-268 weapon-tag, MF-VAL-264 spell-capability) use `"srd"` only as a
// plausible bundle-id string for the convention check, asserting nothing
// about actual SRD-authored fixture content. This is a doc-contract test for
// the generic manifest validator (sibling of `doc-contract.test.ts`/
// `doc-contract-live.test.ts`/`doc-contract-dsl.test.ts`), not a
// content-mechanics claim about the SRD bundle, so it did not move with the
// SRD twins into `@spellkave/srd`.
// ci-allow(embedded-manifest-schema): fixture-correctness counterexamples - deliberately incorrect TOML the docs warn about
import { inspectManifest, validateManifestToml } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";

import type { AuthorToolContext, AuthorWorkspace } from "../authoring";
import { createAuthorFacingBoundTools } from "../authoring";
import type { VerbResult } from "../authoring-verbs";

const SCHEMA = "#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json";

function fakeWorkspace(initial: string | null = null): AuthorWorkspace & {
	current(): string | null;
} {
	let current = initial;
	return {
		readToml: () => current,
		writeToml: (toml: string) => {
			current = toml;
			return "/scratch/doc-contract-fixture-correctness-test";
		},
		current: () => current,
	};
}

function contextWith(overrides: Partial<AuthorToolContext> = {}): AuthorToolContext {
	return { workspace: fakeWorkspace(), ...overrides };
}

function toolByName(context: AuthorToolContext, name: string) {
	const tool = createAuthorFacingBoundTools(context).find((t) => t.name === name);
	if (tool === undefined) throw new Error(`missing AUTHOR tool ${name}`);
	return tool;
}

function diagCodes(details: unknown): string[] {
	const d = (details as VerbResult).diagnostics ?? [];
	return d.map((diag) => diag.code);
}

// ---------------------------------------------------------------------------
// STRUCTURAL / ref-integrity
// ---------------------------------------------------------------------------

describe("fixture-correctness.md — R1: cross-bundle scope ref (MF-VAL-214)", () => {
	// DOC-PROMISE: fixture-correctness#structural-ref-integrity
	it("a definition-level seed row referencing another bundle's definition, where the owning bundle does NOT depend on it, is refused gracefully — MF-VAL-214, Fatal, nothing persists beyond what was already valid", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		// Bundle A defines a capability. Bundle B (a SEPARATE write_rows bundle,
		// auto-scaffolded with depends_on=["core"] only — never "probe_a") defines
		// an entity and then tries to seed an initial capability pointing at A's.
		const capSeed = await writeRows.execute("seed-cap", {
			bundle: "probe_a",
			kind: "capability_definitions",
			rows: [
				{
					capability_id: "probe_a/cap",
					bundle_id: "probe_a",
					actor_kind: "entity",
					display_name: "Cap",
					description: "probe",
				},
			],
		});
		expect((capSeed.details as VerbResult).ok, JSON.stringify(capSeed.details)).toBe(true);

		const entitySeed = await writeRows.execute("seed-entity", {
			bundle: "probe_b",
			kind: "entity_definitions",
			rows: [{ entity_def_id: "probe_b/thing", bundle_id: "probe_b", display_name: "Thing" }],
		});
		expect((entitySeed.details as VerbResult).ok, JSON.stringify(entitySeed.details)).toBe(true);
		const beforeFailedCall = workspace.current();

		const result = await writeRows.execute("seed-cross-scope", {
			bundle: "probe_b",
			kind: "entity_definition_initial_capability",
			rows: [{ entity_def_id: "probe_b/thing", capability_id: "probe_a/cap" }],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(diagCodes(details)).toContain("MF-VAL-214");
		const diag = details.diagnostics?.find((d) => d.code === "MF-VAL-214");
		expect(diag?.severity).toBe("fatal");
		expect(workspace.current()).toBe(beforeFailedCall);
	});
});

describe("fixture-correctness.md — R4: definition-level seed refs (MF-VAL-252/253/255) — 254's own siblings", () => {
	// DOC-PROMISE: fixture-correctness#structural-ref-integrity
	it("entity_definition_initial_capability.entity_def_id dangling (a REAL capability_id, a MISSING entity_def_id) is MF-VAL-252, not 254 — the two halves of the same seed row map to DISTINCT codes", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		const capSeed = await writeRows.execute("seed-cap", {
			bundle: "onramp_probe",
			kind: "capability_definitions",
			rows: [
				{
					capability_id: "onramp_probe/cap",
					bundle_id: "onramp_probe",
					actor_kind: "entity",
					display_name: "Cap",
					description: "probe",
				},
			],
		});
		expect((capSeed.details as VerbResult).ok, JSON.stringify(capSeed.details)).toBe(true);
		const beforeFailedCall = workspace.current();

		const result = await writeRows.execute("write", {
			bundle: "onramp_probe",
			kind: "entity_definition_initial_capability",
			rows: [{ entity_def_id: "onramp_probe/does_not_exist", capability_id: "onramp_probe/cap" }],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(diagCodes(details)).toContain("MF-VAL-252");
		expect(diagCodes(details)).not.toContain("MF-VAL-254");
		expect(workspace.current()).toBe(beforeFailedCall);
	});

	// DOC-PROMISE: fixture-correctness#structural-ref-integrity
	it("entity_definition_initial_state.state_id dangling is MF-VAL-253", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		const entitySeed = await writeRows.execute("seed-entity", {
			bundle: "onramp_probe",
			kind: "entity_definitions",
			rows: [
				{ entity_def_id: "onramp_probe/thing", bundle_id: "onramp_probe", display_name: "Thing" },
			],
		});
		expect((entitySeed.details as VerbResult).ok, JSON.stringify(entitySeed.details)).toBe(true);
		const beforeFailedCall = workspace.current();

		const result = await writeRows.execute("write", {
			bundle: "onramp_probe",
			kind: "entity_definition_initial_state",
			rows: [
				{
					entity_def_id: "onramp_probe/thing",
					state_id: "onramp_probe/does_not_exist",
					value_int: 0,
					value_bool: true,
				},
			],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(diagCodes(details)).toContain("MF-VAL-253");
		expect(workspace.current()).toBe(beforeFailedCall);
	});

	// DOC-PROMISE: fixture-correctness#structural-ref-integrity
	it("entity_definition_initial_condition.condition_definition_id dangling is MF-VAL-255", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		const entitySeed = await writeRows.execute("seed-entity", {
			bundle: "onramp_probe",
			kind: "entity_definitions",
			rows: [
				{ entity_def_id: "onramp_probe/thing", bundle_id: "onramp_probe", display_name: "Thing" },
			],
		});
		expect((entitySeed.details as VerbResult).ok, JSON.stringify(entitySeed.details)).toBe(true);
		const beforeFailedCall = workspace.current();

		const result = await writeRows.execute("write", {
			bundle: "onramp_probe",
			kind: "entity_definition_initial_condition",
			rows: [
				{
					entity_def_id: "onramp_probe/thing",
					condition_definition_id: "onramp_probe/does_not_exist",
				},
			],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(diagCodes(details)).toContain("MF-VAL-255");
		expect(workspace.current()).toBe(beforeFailedCall);
	});
});

describe("fixture-correctness.md — R2/R3: capability + generic duplicate-id (MF-VAL-266/272) — a multi-bundle-merge hazard the verb layer cannot manufacture", () => {
	// DOC-PROMISE: fixture-correctness#structural-ref-integrity
	it("MF-VAL-266: the SAME capability_id defined by two DIFFERENT bundles — direct validateManifestToml, since spellkave_write_rows's own natural-key upsert would silently replace rather than duplicate", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe_a"
author = "test"
display_name = "Probe A"
version = "0.0.1"

[[bundles]]
bundle_id = "probe_b"
author = "test"
display_name = "Probe B"
version = "0.0.1"
depends_on = ["probe_a"]

[[capability_definitions]]
capability_id = "probe_a/dup_cap"
bundle_id = "probe_a"
actor_kind = "entity"
display_name = "Dup Cap A"
description = "probe"

[[capability_definitions]]
capability_id = "probe_a/dup_cap"
bundle_id = "probe_b"
actor_kind = "entity"
display_name = "Dup Cap B"
description = "probe"
`;
		const diags = validateManifestToml(toml);
		const diag = diags.find((d) => d.code === "MF-VAL-266");
		expect(diag, JSON.stringify(diags)).toBeDefined();
		expect(diag?.severity).toBe("fatal");
	});

	// DOC-PROMISE: fixture-correctness#structural-ref-integrity
	it("MF-VAL-272: the SAME resource_definition_id emitted by a generator AND a hand-authored sibling bundle", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe_a"
author = "test"
display_name = "Probe A"
version = "0.0.1"

[[bundles]]
bundle_id = "probe_b"
author = "test"
display_name = "Probe B"
version = "0.0.1"
depends_on = ["probe_a"]

[[resource_definitions]]
resource_definition_id = "probe_a/hp"
bundle_id = "probe_a"
display_name = "HP A"
value_kind = "int"
min_value = 0
max_value = 10
recovery_rule = "long_rest"

[[resource_definitions]]
resource_definition_id = "probe_a/hp"
bundle_id = "probe_b"
display_name = "HP B"
value_kind = "int"
min_value = 0
max_value = 10
recovery_rule = "long_rest"
`;
		const diags = validateManifestToml(toml);
		const diag = diags.find((d) => d.code === "MF-VAL-272");
		expect(diag, JSON.stringify(diags)).toBeDefined();
		expect(diag?.severity).toBe("fatal");
	});
});

describe("fixture-correctness.md — R6: duplicate (entity, state) seed (MF-VAL-270)", () => {
	// DOC-PROMISE: fixture-correctness#structural-ref-integrity
	it("two object_state rows for the SAME (entity_key, state_id) in a hand-composed manifest — the Bat-HP-clobbered-to-30 shape the catalog names — is refused: Fatal, direct validateManifestToml since spellkave_write_rows's own ROW_KIND_STORAGE_KEY upsert (ADR-0146, sk-jay0.7.174.30) would silently replace rather than duplicate", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "onramp_probe"
author = "test"
display_name = "Onramp Probe"
version = "0.0.1"

[[object_state]]
entity_key = "onramp_probe/bat"
state_id = "onramp_probe/hp"
source_template_id = "onramp_probe/bat"
bundle_id = "onramp_probe"
value_int = 5
value_bool = true
visibility = "Public"
expires_at_tick = 0

[[object_state]]
entity_key = "onramp_probe/bat"
state_id = "onramp_probe/hp"
source_template_id = "onramp_probe/bat"
bundle_id = "onramp_probe"
value_int = 30
value_bool = true
visibility = "Public"
expires_at_tick = 0
`;
		const diags = validateManifestToml(toml);
		const diag = diags.find((d) => d.code === "MF-VAL-270");
		expect(diag, JSON.stringify(diags)).toBeDefined();
		expect(diag?.severity).toBe("fatal");
	});

	// DOC-PROMISE: fixture-correctness#structural-ref-integrity
	it("spellkave_write_rows re-authoring the SAME (entity_key, state_id) upserts instead of manufacturing the R6 duplicate (ADR-0146, sk-jay0.7.174.30)", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		const setup = await writeRows.execute("setup", {
			bundle: "onramp_probe",
			kind: "resource_definitions",
			rows: [
				{
					resource_definition_id: "onramp_probe/hp",
					display_name: "HP",
					value_kind: "int",
					min_value: 0,
					max_value: 30,
					recovery_rule: "long_rest",
				},
			],
		});
		expect((setup.details as VerbResult).ok, JSON.stringify(setup.details)).toBe(true);
		const entitySetup = await writeRows.execute("setup-entity", {
			bundle: "onramp_probe",
			kind: "entities",
			rows: [
				{
					entity_key: "onramp_probe/bat",
					entity_def_id: "",
					name: "Bat",
					kind: "npc",
					place_node_id: "",
					quantity: 1,
					owned_by_entity_key: "",
				},
			],
		});
		expect((entitySetup.details as VerbResult).ok, JSON.stringify(entitySetup.details)).toBe(true);

		const objectStateRow = (valueInt: number) => ({
			entity_key: "onramp_probe/bat",
			state_id: "onramp_probe/hp",
			source_template_id: "onramp_probe/bat",
			value_int: valueInt,
			value_bool: true,
			visibility: "Public",
			expires_at_tick: 0,
		});
		await writeRows.execute("seed-5", {
			bundle: "onramp_probe",
			kind: "object_state",
			rows: [objectStateRow(5)],
		});
		const result = await writeRows.execute("reseed-30", {
			bundle: "onramp_probe",
			kind: "object_state",
			rows: [objectStateRow(30)],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(details.rows_replaced).toBe(1);
		const manifest = inspectManifest(workspace.current() ?? "").manifest as Record<string, unknown>;
		const rows = (manifest.object_state as Record<string, unknown>[]).filter(
			(r) => r.entity_key === "onramp_probe/bat" && r.state_id === "onramp_probe/hp",
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ value_int: 30 });
	});
});

// ---------------------------------------------------------------------------
// CONVENTION
// ---------------------------------------------------------------------------

describe("fixture-correctness.md — C3: srd.weapon tag with no srd/damage slot (MF-VAL-268)", () => {
	// DOC-PROMISE: fixture-correctness#convention
	// DOC-PROMISE: interaction-dsl-and-world-authoring#weapons-carry-their-own-damage-attacker-sourced
	it("an srd.weapon-tagged entity_definition with no srd/damage item DSL-source is a Warning (never a rejection — the runtime already fails closed at MissingItemDslSource), and DOES persist", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		const entitySeed = await writeRows.execute("seed-entity", {
			bundle: "srd",
			kind: "entity_definitions",
			rows: [
				{ entity_def_id: "srd/item/probe_sword", bundle_id: "srd", display_name: "Probe Sword" },
			],
		});
		expect((entitySeed.details as VerbResult).ok, JSON.stringify(entitySeed.details)).toBe(true);

		const result = await writeRows.execute("tag", {
			bundle: "srd",
			kind: "entity_definition_tag",
			rows: [{ entity_def_id: "srd/item/probe_sword", tag: "srd.weapon", source: "manifest" }],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(diagCodes(details)).toContain("MF-VAL-268");
		const diag = details.diagnostics?.find((d) => d.code === "MF-VAL-268");
		expect(diag?.severity).toBe("warning");
		expect(diag?.message).toMatch(/srd\/damage/);
	});
});

describe("fixture-correctness.md — C4: srd/spell/<slug> capability with no matching entity_definition (MF-VAL-264)", () => {
	// DOC-PROMISE: fixture-correctness#convention
	it("a catalog spell capability whose id has no matching entity_definition of the SAME id is a Warning, and DOES persist", async () => {
		const context = contextWith();
		const writeRows = toolByName(context, "spellkave_write_rows");

		const result = await writeRows.execute("write", {
			bundle: "srd",
			kind: "capability_definitions",
			rows: [
				{
					capability_id: "srd/spell/probe_bolt",
					actor_kind: "entity",
					display_name: "Probe Bolt",
					description: "probe",
				},
			],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(diagCodes(details)).toContain("MF-VAL-264");
		const diag = details.diagnostics?.find((d) => d.code === "MF-VAL-264");
		expect(diag?.severity).toBe("warning");
	});
});

describe("fixture-correctness.md — C5: deprecated descriptor tags (MF-VAL-227) — 220/224/228/229 deliberately skipped, see report", () => {
	// DOC-PROMISE: fixture-correctness#convention
	it("an outcome_template_tag of 'manipulation.action_id=...' (the deprecated descriptor form) on an outcome an affordance_template selects is a Fatal MF-VAL-227, naming the typed field to use instead", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		const outcomeSeed = await writeRows.execute("seed-outcome", {
			bundle: "probe",
			kind: "outcome_templates",
			rows: [
				{
					outcome_template_id: "probe/outcome",
					consequence_template_id: "",
					display_name: "Outcome",
					manipulation_action_id: "",
					outcome_bool: true,
					sense_visibility: "local",
				},
			],
		});
		expect((outcomeSeed.details as VerbResult).ok, JSON.stringify(outcomeSeed.details)).toBe(true);

		const affSeed = await writeRows.execute("seed-aff", {
			bundle: "probe",
			kind: "affordance_templates",
			rows: [
				{
					template_id: "probe/aff",
					niche_id: "probe/niche",
					capability_id: "probe/cap",
					display_name: "Aff",
					predicate_bool: true,
					outcome_template_id: "probe/outcome",
					range_m: 0,
				},
			],
		});
		expect((affSeed.details as VerbResult).ok, JSON.stringify(affSeed.details)).toBe(true);
		const beforeFailedCall = workspace.current();

		const result = await writeRows.execute("legacy-tag", {
			bundle: "probe",
			kind: "outcome_template_tag",
			rows: [{ outcome_template_id: "probe/outcome", tag: "manipulation.action_id=probe/legacy" }],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(diagCodes(details)).toContain("MF-VAL-227");
		const diag = details.diagnostics?.find((d) => d.code === "MF-VAL-227");
		expect(diag?.severity).toBe("fatal");
		expect(diag?.message).toContain("manipulation_action_id");
		expect(workspace.current()).toBe(beforeFailedCall);
	});
});

describe("fixture-correctness.md — C6: seeded state value outside resource bounds (MF-VAL-269)", () => {
	// DOC-PROMISE: fixture-correctness#convention
	it("an entity_definition_initial_state value outside its resource_definition's [min, max] is refused — Fatal, the runtime would otherwise silently clamp it", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		const resourceSeed = await writeRows.execute("seed-resource", {
			bundle: "onramp_probe",
			kind: "resource_definitions",
			rows: [
				{
					resource_definition_id: "onramp_probe/hp",
					display_name: "HP",
					value_kind: "int",
					min_value: 0,
					max_value: 30,
					recovery_rule: "long_rest",
				},
			],
		});
		expect((resourceSeed.details as VerbResult).ok, JSON.stringify(resourceSeed.details)).toBe(
			true,
		);
		const entitySeed = await writeRows.execute("seed-entity", {
			bundle: "onramp_probe",
			kind: "entity_definitions",
			rows: [
				{
					entity_def_id: "onramp_probe/monster",
					bundle_id: "onramp_probe",
					display_name: "Monster",
				},
			],
		});
		expect((entitySeed.details as VerbResult).ok, JSON.stringify(entitySeed.details)).toBe(true);
		const beforeFailedCall = workspace.current();

		const result = await writeRows.execute("out-of-bounds", {
			bundle: "onramp_probe",
			kind: "entity_definition_initial_state",
			rows: [
				{
					entity_def_id: "onramp_probe/monster",
					state_id: "onramp_probe/hp",
					value_int: 999,
					value_bool: true,
				},
			],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(false);
		expect(diagCodes(details)).toContain("MF-VAL-269");
		const diag = details.diagnostics?.find((d) => d.code === "MF-VAL-269");
		expect(diag?.severity).toBe("fatal");
		expect(workspace.current()).toBe(beforeFailedCall);
	});
});

// ---------------------------------------------------------------------------
// SEMANTIC / modelling
// ---------------------------------------------------------------------------

describe("fixture-correctness.md — S3: id defined outside its own bundle's namespace (MF-VAL-291)", () => {
	// DOC-PROMISE: fixture-correctness#semantic-modelling
	it("a bundle DEFINING an id outside its own namespace is a Warning (a reference into another bundle's namespace is fine and unrelated) — DOES persist", async () => {
		const context = contextWith();
		const writeRows = toolByName(context, "spellkave_write_rows");

		const result = await writeRows.execute("write", {
			bundle: "probe_a",
			kind: "entity_definitions",
			rows: [{ entity_def_id: "other_ns/thing", display_name: "Thing" }],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(diagCodes(details)).toContain("MF-VAL-291");
		const diag = details.diagnostics?.find((d) => d.code === "MF-VAL-291");
		expect(diag?.severity).toBe("warning");
	});
});

describe("fixture-correctness.md — S4: cross-niche stochastic affordance overlap (MF-VAL-273)", () => {
	// DOC-PROMISE: fixture-correctness#semantic-modelling
	it("two affordance_templates at DIFFERENT niches resolving the SAME action, each with an independently stochastic predicate, is a Warning naming both template ids — DOES persist (the #1556 root-cause shape)", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		const outcomeSeed = await writeRows.execute("seed-outcomes", {
			bundle: "probe",
			kind: "outcome_templates",
			rows: [
				{
					outcome_template_id: "probe/outcome_x",
					consequence_template_id: "",
					display_name: "Outcome X",
					manipulation_action_id: "probe/strike",
					outcome_bool: true,
					sense_visibility: "local",
				},
				{
					outcome_template_id: "probe/outcome_y",
					consequence_template_id: "",
					display_name: "Outcome Y",
					manipulation_action_id: "probe/strike",
					outcome_bool: true,
					sense_visibility: "local",
				},
			],
		});
		expect((outcomeSeed.details as VerbResult).ok, JSON.stringify(outcomeSeed.details)).toBe(true);

		const result = await writeRows.execute("seed-affs", {
			bundle: "probe",
			kind: "affordance_templates",
			rows: [
				{
					template_id: "probe/aff_x",
					niche_id: "probe/niche_x",
					capability_id: "probe/cap",
					display_name: "Aff X",
					predicate_source: "1d20 >= 10",
					outcome_template_id: "probe/outcome_x",
					range_m: 0,
				},
				{
					template_id: "probe/aff_y",
					niche_id: "probe/niche_y",
					capability_id: "probe/cap",
					display_name: "Aff Y",
					predicate_source: "1d20 >= 15",
					outcome_template_id: "probe/outcome_y",
					range_m: 0,
				},
			],
		});
		const details = result.details as VerbResult;
		expect(details.ok, JSON.stringify(details)).toBe(true);
		expect(diagCodes(details)).toContain("MF-VAL-273");
		const diag = details.diagnostics?.find((d) => d.code === "MF-VAL-273");
		expect(diag?.severity).toBe("warning");
		expect(diag?.message).toContain("probe/aff_x");
		expect(diag?.message).toContain("probe/aff_y");

		// Both rows genuinely persisted (Warning, never blocking) — confirms the
		// "DOES persist" half of the promise, not just the diagnostic shape.
		const manifest = inspectManifest(workspace.current() as string).manifest as Record<
			string,
			unknown
		>;
		const affordances = manifest.affordance_templates as Array<Record<string, unknown>>;
		expect(affordances.map((a) => a.template_id).sort()).toEqual(["probe/aff_x", "probe/aff_y"]);
	});
});
