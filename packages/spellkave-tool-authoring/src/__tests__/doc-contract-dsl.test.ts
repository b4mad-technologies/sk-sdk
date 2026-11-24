// embedded-manifest: {"category": "exact_text_oracle", "rationale": "DSL documentation tests require exact valid examples and malformed counterexamples"}
// Doc-contract test suite, "DSL + interaction authoring" slice (#1968 "docs
// as testable promises" — the DOC-PROMISE follow-up pass over
// `dsl-grammar.md` + `interaction-dsl-and-world-authoring.md`). A SEPARATE
// file from `doc-contract.test.ts`/`doc-contract-live.test.ts` (not this
// agent's to edit — the `doc-promises` skgate registry gate scans EVERY
// `doc-contract*.test.ts` under a package's `src/__tests__/`, so a new file
// joins the SAME gate without touching another agent's).
//
// OFFLINE ONLY, same posture as `doc-contract.test.ts`'s own header: every
// promise here is proven by calling `validateManifestToml` directly (the
// in-process wasm validator, no fs, no live node, no model) against a
// minimal, hand-authored manifest — the SAME "same validator the server
// runs" guarantee `doc-contract.test.ts` already documents. This file goes
// DIRECT to `validateManifestToml` rather than through the companion-agent
// verb layer (`spellkave_write_rows` et al.): every claim under test here is
// about the SHARED wasm validator's own grammar/diagnostic behavior
// (`crates/spellkave-validate`/`crates/spellkave-dsl`), which the verb layer
// calls internally without adding anything the DSL-grammar promise itself
// needs proven — the verb layer's own value-add (natural-key upsert,
// scratch-workspace merge) is exercised separately by
// `doc-contract-fixture-correctness.test.ts`'s sweep. Mirrors the existing
// MF-VAL-271 precedent in `doc-contract.test.ts` (also direct-to-validator).
//
// Each `it` below carries a `DOC-PROMISE: <doc-id>#<heading-slug>` comment —
// see `doc-contract.test.ts`'s own header for the full anchor-convention
// explanation; the `doc-promises` gate is the other half of this
// honesty contract.
//
// SCOPE NOTE on `dsl-grammar.md`: that whole file is machine-generated
// top-to-bottom from `spellkave_dsl::dsl_reference()`
// (`scripts/generate-authoring-reference-docs.ts`) — every word in it,
// including the per-operator prose notes, is Rust-sourced. This pass is
// docs+tests only (server/crate Rust is off-limits), so this file tests the
// GENERATED doc's claims exactly as written rather than editing them; one
// genuine gap surfaced below (bare Int/Text/Bool-literal-return examples are
// not independently pastable as complete `predicate_source` text — see the
// "operand fragments" describe block) is reported in the PR/report rather
// than hand-edited into a file the generator will silently overwrite on its
// next run.
// ci-allow(embedded-manifest-schema): DSL documentation counterexamples - the TOML here is what the docs tell authors NOT to write
import { validateManifestToml } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";

const SCHEMA = "#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json";

/** One `[[bundles]]` header + one `[[affordance_templates]]` row carrying `predicate`
 * as its `predicate_source` — the minimal manifest shape every grammar probe below
 * needs. The referenced `niche_id`/`capability_id`/`outcome_template_id` are
 * deliberately left UNRESOLVED (dangling) — this suite only asserts about
 * grammar/parse diagnostics (`MF-VAL-201` and friends), never ref-integrity ones,
 * so a real niche/capability/outcome would just be unexercised ballast. */
function affordanceToml(predicate: string): string {
	return `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[affordance_templates]]
template_id = "probe/aff"
bundle_id = "probe"
niche_id = "probe/niche"
capability_id = "probe/cap"
display_name = "Aff"
predicate_source = ${JSON.stringify(predicate)}
outcome_template_id = "probe/outcome"
range_m = 0
`;
}

const PREDICATE_PARSE_CODE = "MF-VAL-201";

/** True iff `predicate` is a SYNTACTICALLY COMPLETE predicate — no
 * MF-VAL-201 (predicate parse error) diagnostic, regardless of what OTHER
 * (ref-integrity / locality-annotation) diagnostics an unresolved id or an
 * un-annotated Global predicate might also produce. */
function parsesAsPredicate(predicate: string): boolean {
	const diags = validateManifestToml(affordanceToml(predicate));
	return !diags.some((d) => d.code === PREDICATE_PARSE_CODE);
}

// ---------------------------------------------------------------------------
// dsl-grammar.md — Bool-native operators are complete standalone predicates
// ---------------------------------------------------------------------------

describe("dsl-grammar.md — Bool-returning operators parse as COMPLETE standalone predicate_source text", () => {
	// DOC-PROMISE: dsl-grammar#hascapability
	// DOC-PROMISE: dsl-grammar#hasitem
	// DOC-PROMISE: dsl-grammar#hasniche
	// DOC-PROMISE: dsl-grammar#hastag
	it("HasCapability/HasItem/HasNiche/HasTag — each doc example parses with no predicate-parse diagnostic", () => {
		expect(parsesAsPredicate("actor.has_capability('core/open')")).toBe(true);
		expect(parsesAsPredicate("actor.has_item('core/torch')")).toBe(true);
		expect(parsesAsPredicate("target.has_niche('core/container')")).toBe(true);
		expect(parsesAsPredicate("target.has_tag('locked')")).toBe(true);
	});

	// DOC-PROMISE: dsl-grammar#sharestag
	// DOC-PROMISE: dsl-grammar#tracepresent
	// DOC-PROMISE: dsl-grammar#knowsentity
	it("SharesTag/TracePresent/KnowsEntity — each doc example parses with no predicate-parse diagnostic", () => {
		expect(parsesAsPredicate("shares_tag(actor, target, 'actor.language.')")).toBe(true);
		expect(parsesAsPredicate("target.trace('core/opened')")).toBe(true);
		expect(parsesAsPredicate("actor.knows_entity($bindings.required_entity_id)")).toBe(true);
	});

	// DOC-PROMISE: dsl-grammar#hasstatus
	// DOC-PROMISE: dsl-grammar#readbool
	it("HasStatus/ReadBool — each doc example (both ALREADY a Compare/native-Bool form in the doc's own text) parses with no predicate-parse diagnostic", () => {
		expect(parsesAsPredicate("actor.status('core/poisoned') == true")).toBe(true);
		expect(parsesAsPredicate("target.state('is_open')")).toBe(true);
	});

	// DOC-PROMISE: dsl-grammar#and
	// DOC-PROMISE: dsl-grammar#or
	// DOC-PROMISE: dsl-grammar#not
	// DOC-PROMISE: dsl-grammar#compare
	// DOC-PROMISE: dsl-grammar#rollunder
	// DOC-PROMISE: dsl-grammar#let
	it("And/Or/Not/Compare/RollUnder/Let — each doc example parses with no predicate-parse diagnostic", () => {
		expect(parsesAsPredicate("actor.has_capability('core/open') && target.has_tag('locked')")).toBe(
			true,
		);
		expect(parsesAsPredicate("target.has_tag('door') || target.has_tag('chest')")).toBe(true);
		expect(parsesAsPredicate("target.has_tag('sealed') == false")).toBe(true);
		expect(parsesAsPredicate("actor.stat('core/strength') >= 10")).toBe(true);
		expect(parsesAsPredicate("roll_under(1d20, actor.stat('core/dexterity'))")).toBe(true);
		expect(parsesAsPredicate("let difficulty = 10 ; 1d20 >= difficulty")).toBe(true);
	});

	// DOC-PROMISE: dsl-grammar#compare
	it("a well-formed rejection counter-example still fails: an unterminated call is MF-VAL-201, not silently accepted", () => {
		expect(parsesAsPredicate("actor.has_capability('core/open'")).toBe(false);
		const diags = validateManifestToml(affordanceToml("actor.has_capability('core/open'"));
		const diag = diags.find((d) => d.code === PREDICATE_PARSE_CODE);
		expect(diag?.severity).toBe("fatal");
	});
});

// ---------------------------------------------------------------------------
// dsl-grammar.md — Int/Text/Bool-literal-RETURN operators are OPERAND
// fragments, never complete standalone predicate_source text on their own.
// ---------------------------------------------------------------------------

describe("dsl-grammar.md — literal/int/text-returning operators are illustrative OPERAND fragments, not complete predicate_source text by themselves", () => {
	// DOC-PROMISE: dsl-grammar#boolliteral
	// DOC-PROMISE: dsl-grammar#intliteral
	// DOC-PROMISE: dsl-grammar#readint
	// DOC-PROMISE: dsl-grammar#readeffectiveint
	// DOC-PROMISE: dsl-grammar#readtext
	// DOC-PROMISE: dsl-grammar#arithmetic
	// DOC-PROMISE: dsl-grammar#cond
	// DOC-PROMISE: dsl-grammar#roll
	it("the doc's own bare fragment examples (`true`, `10`, `actor.stat(...)`, `actor.effective(...)`, `$event.detail.speech_act`, `max(...)`, `cond(...)`, `1d20`) each fail predicate_source parse on their own — MF-VAL-201 'expected comparison operator'", () => {
		const bareFragments = [
			"true", // BoolLiteral's own doc example, pasted verbatim.
			"10", // IntLiteral's own doc example, pasted verbatim.
			"actor.stat('core/strength')", // ReadInt's own doc example, pasted verbatim.
			"actor.effective('homebrew/Momentum')", // ReadEffectiveInt's own doc example.
			"$event.detail.speech_act", // ReadText's own doc example.
			"max(actor.stat('core/strength'), 2)", // Arithmetic's own doc example.
			"cond(d20 >= 13, 0, 0 - d6)", // Cond's own doc example.
			"1d20", // Roll's own doc example.
		];
		for (const fragment of bareFragments) {
			expect(parsesAsPredicate(fragment), `expected '${fragment}' to fail bare`).toBe(false);
			const diags = validateManifestToml(affordanceToml(fragment));
			const diag = diags.find((d) => d.code === PREDICATE_PARSE_CODE);
			expect(diag?.message, fragment).toContain("expected comparison operator");
		}
	});

	// DOC-PROMISE: dsl-grammar#boolliteral
	// DOC-PROMISE: dsl-grammar#intliteral
	// DOC-PROMISE: dsl-grammar#compare
	it("the SAME fragments parse cleanly once completed into a Compare — exactly the shape the doc's own Compare/RollUnder examples already demonstrate", () => {
		expect(parsesAsPredicate("true == true")).toBe(true);
		expect(parsesAsPredicate("10 == 10")).toBe(true);
		expect(parsesAsPredicate("actor.stat('core/strength') >= 10")).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// dsl-grammar.md — Compare: "same comparable value type" is an EVALUATION-
// time invariant (spellkave_dsl::eval::EvaluationError::TypeMismatch), never
// a static validator diagnostic. `parse_predicate` accepts the mismatch —
// only run-time `RuntimeValue` comparison rejects it.
// ---------------------------------------------------------------------------

describe("dsl-grammar.md — Compare (#compare): 'same comparable value type' is checked at evaluation, not parse", () => {
	// DOC-PROMISE: dsl-grammar#compare
	it("an Int-vs-Text Compare parses and static-validates CLEAN of any predicate-parse/type diagnostic — the doc's 'same comparable value type' rule is a RUNTIME invariant the static validator does not enforce", () => {
		const toml = affordanceToml("actor.stat('core/strength') == 'ten'");
		const diags = validateManifestToml(toml);
		expect(diags.filter((d) => d.code === PREDICATE_PARSE_CODE)).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// dsl-grammar.md — frame-write primitives (ModifyResource/ApplyStatus/...):
// structured `[[consequence_frame_writes]]` rows, never DSL text at the row
// level — but their OWN `delta_source`/`predicate_source` sub-fields ARE
// parseable DSL text, checked by MF-VAL-256 (parse)/MF-VAL-257 (root type).
// ---------------------------------------------------------------------------

function modifyResourceToml(deltaSource: string): string {
	return `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[resource_definitions]]
resource_definition_id = "probe/hp"
bundle_id = "probe"
display_name = "HP"
value_kind = "int"
min_value = 0
max_value = 30
recovery_rule = "long_rest"

[[consequence_templates]]
template_id = "probe/cast/success"
bundle_id = "probe"

[[consequence_frame_writes]]
template_id = "probe/cast/success"
ordinal = 0
frame_write = { ModifyResource = { actor = "Actor", resource = "probe/hp", delta_source = ${JSON.stringify(deltaSource)} } }
`;
}

describe("dsl-grammar.md — ModifyResource (#modifyresource): a structured frame-write row whose delta_source IS parseable DSL text", () => {
	// DOC-PROMISE: dsl-grammar#modifyresource
	// DOC-PROMISE: dsl-grammar#roll
	it("a dice-roll Int expression (the doc's own Roll example, composed exactly as the aoe-damage-spell worked example does) validates clean", () => {
		const diags = validateManifestToml(modifyResourceToml("0 - 1d6"));
		expect(diags).toEqual([]);
	});

	// DOC-PROMISE: dsl-grammar#modifyresource
	it("a malformed delta_source is MF-VAL-256 (Fatal, parse failure) — never a silent no-op or a thrown exception", () => {
		const diags = validateManifestToml(modifyResourceToml("0 - "));
		const diag = diags.find((d) => d.code === "MF-VAL-256");
		expect(diag, JSON.stringify(diags)).toBeDefined();
		expect(diag?.severity).toBe("fatal");
	});

	// DOC-PROMISE: dsl-grammar#modifyresource
	it("a well-formed but wrong-root-type delta_source (a Bool literal where delta_source needs Int) is MF-VAL-257 (Fatal), distinct from the parse-failure code", () => {
		const diags = validateManifestToml(modifyResourceToml("true"));
		const diag = diags.find((d) => d.code === "MF-VAL-257");
		expect(diag, JSON.stringify(diags)).toBeDefined();
		expect(diag?.severity).toBe("fatal");
		expect(diags.some((d) => d.code === "MF-VAL-256")).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// interaction-dsl-and-world-authoring.md
// ---------------------------------------------------------------------------

describe("interaction-dsl-and-world-authoring.md — edge endpoints must resolve", () => {
	// DOC-PROMISE: interaction-dsl-and-world-authoring#from-spatial-rows-to-affordances
	it("a place_edge endpoint absent from both this manifest's place_nodes AND (offline, no live world) the committed world is a fatal MF-VAL-105", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[place_graphs]]
place_graph_id = "probe/graph"
bundle_id = "probe"
display_name = "Graph"
anchor_node_id = "probe/graph/a"
bearing = 0.0
blueprint_id = ""
description = ""
is_ephemeral_instance = false
origin_cell_res10 = 0
origin_cell_res4 = 0
origin_cell_res7 = 0
parent_graph_id = ""
metres_per_unit = 1.0
substrate_id = ""

[[place_nodes]]
node_id = "probe/graph/a"
bundle_id = "probe"
place_graph_id = "probe/graph"
local_id = "a"
display_name = "A"
description = ""
substrate_id = ""
cell_res10 = 0
cell_res7 = 0
cell_res4 = 0
pos_present = false
pos_x = 0
pos_y = 0
pose_elevation = 0.0
pose_elevation_present = false
is_ephemeral = false

[[place_edges]]
edge_key = "probe/edge/a-b"
bundle_id = "probe"
place_graph_id = "probe/graph"
from_node_id = "probe/graph/a"
to_node_id = "probe/graph/does_not_exist"
`;
		const diags = validateManifestToml(toml);
		const diag = diags.find((d) => d.code === "MF-VAL-105");
		expect(diag, JSON.stringify(diags)).toBeDefined();
		expect(diag?.severity).toBe("fatal");
	});
});

describe("interaction-dsl-and-world-authoring.md — a ModifyResource resource ref must resolve", () => {
	// DOC-PROMISE: interaction-dsl-and-world-authoring#area-of-effect-frame-writes
	it("ModifyResource.resource naming an id with no resource_definitions row is rejected (MF-VAL-217), not a silent no-op spell", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[consequence_templates]]
template_id = "probe/cast/success"
bundle_id = "probe"

[[consequence_frame_writes]]
template_id = "probe/cast/success"
ordinal = 0
frame_write = { ModifyResource = { actor = "Actor", resource = "probe/does_not_exist", delta_source = "-3" } }
`;
		const diags = validateManifestToml(toml);
		const diag = diags.find((d) => d.code === "MF-VAL-217");
		expect(diag, JSON.stringify(diags)).toBeDefined();
		// The doc-promise is "not a silent no-op": the dangling ref must be
		// REPORTED. It is — and in a single-file pass like this one the
		// validator reports it as `info`, because it cannot tell a typo from
		// an id that a not-yet-loaded dependency declares
		// (`RefResolution::Trusted` in `crates/spellkave-validate/src/refs.rs`,
		// whose message and hint both say so and point at the full-closure
		// pass `just check-manifest-refs`). The fatal verdict is reserved for
		// the pass that has the whole closure — and for live-world admission.
		//
		// This assertion read `fatal` until sk-syo, and passed, because the
		// VENDORED `crates/spellkave-validate-wasm/pkg` wasm was stale: it
		// predated the Trusted downgrade. Rebuilding it surfaced the gap.
		// The behavioral-only drift check of the day (predating the sk-8u4
		// source fingerprint now in `validate-wasm-drift`) did NOT catch the
		// staleness — recorded on sk-syo, not fixed here.
		expect(diag?.severity).toBe("info");
		expect(diag?.message).toContain("is not declared in this manifest");
		expect(diag?.hint).toContain("check-manifest-refs");
	});
});

describe("interaction-dsl-and-world-authoring.md — modifier expiry has no 'N ticks from now' DSL expression", () => {
	// DOC-PROMISE: interaction-dsl-and-world-authoring#modifier-expiry-is-an-absolute-tick-not-a-runtime-offset
	it("a fictional current_tick()-style call is not a recognized DSL function — it fails to parse rather than silently resolving", () => {
		const diags = validateManifestToml(affordanceToml("current_tick() > 0"));
		const diag = diags.find((d) => d.code === PREDICATE_PARSE_CODE);
		expect(diag, JSON.stringify(diags)).toBeDefined();
		expect(diag?.severity).toBe("fatal");
	});
});

describe("interaction-dsl-and-world-authoring.md — Discoverable's authoring footgun: no static diagnostic for a missing RevealState", () => {
	// DOC-PROMISE: interaction-dsl-and-world-authoring#epistemic-read-visibility-internal-discoverable-revealstate
	it("a Discoverable object_state_definition with NO RevealState write anywhere in the bundle validates CLEAN — the doc's own claim ('no validator diagnostic, this is a live-prove concern') holds exactly as stated", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[object_state_definitions]]
bundle_id = "probe"
state_id = "probe/hidden_passage_found"
target_kind = "entity"
display_name = "Hidden passage found"
default_visibility = "Discoverable"
`;
		expect(validateManifestToml(toml)).toEqual([]);
	});
});
