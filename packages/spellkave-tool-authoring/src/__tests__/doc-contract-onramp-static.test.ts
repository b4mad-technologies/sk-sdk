// embedded-manifest: {"category": "exact_text_oracle", "rationale": "authoring on-ramp tests pin exact lint and validator documentation counterexamples"}
// Doc-contract test suite, "onramp README gotchas" STATIC slice (#1968 "docs
// as testable promises" — companion to `doc-contract-live-onramp.test.ts`'s
// LIVE sweep). A SEPARATE file from every other `doc-contract*.test.ts` (not
// this agent's to edit — the `doc-promises` skgate registry gate scans EVERY
// `doc-contract*.test.ts` under a package's `src/__tests__/`, so a new file
// joins the SAME gate without touching another agent's).
//
// OFFLINE ONLY — every promise here is proven by a STATIC mechanism
// (`lintManifest` or `validateManifestToml`, both `@spellkave/world-author`
// exports, no fs, no live node, no model). These 4 gotchas were triaged OUT
// of the live sweep specifically BECAUSE they already have a deterministic
// offline oracle:
//   - `target.has_capability(...)` is caught by `spellkave-author manifest
//     lint`'s own `dead-target-capability` rule (#1846). Two sibling rules
//     were RETIRED when the constructs they warned about became real —
//     `dead-grants-capability-while-active` by sk-syo, and
//     `dead-manipulate-has-item` by sk-vjh.7, which populated the DSL
//     `items` fact pool inside `manipulation_facts`. The tests below now pin
//     the opposite promise for both — that authoring them is clean.
//   - "a self_eligible action needs a ModifyResource write" is the static
//     VALIDATOR's own `MF-VAL-263` (Fatal), not a lint at all.
// Re-proving any of these live would just re-derive what the deterministic
// gate already guarantees — this file proves the SAME claims through the
// SAME mechanism the doc itself names, which is the more honest test.
//
// Each `it` carries a `DOC-PROMISE: onramp#<heading-slug>` comment — see
// `doc-contract.test.ts`'s own header for the full anchor-convention
// explanation; the `doc-promises` gate is the other half of this
// honesty contract.
// ci-allow(embedded-manifest-schema): authoring on-ramp counterexamples - deliberately incorrect TOML
import { inspectManifest, lintManifest, validateManifestToml } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";

const SCHEMA = "#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json";

function lintFindings(toml: string) {
	const manifest = inspectManifest(toml).manifest as Record<string, unknown>;
	return lintManifest(manifest);
}

describe("onramp README — actor-identity-bindings: target.has_capability(...) is dead (lint dead-target-capability)", () => {
	// DOC-PROMISE: target-has-capability-dead#targethas_capability-is-dead-capability-facts-are-actor-only-gate-a-targets-kind-via-targethas_niche-an-entity-def-tag-instead
	it("a predicate_source containing target.has_capability(...) is flagged by the manifest lint — parses/seeds cleanly (no validator diagnostic), caught only by lint, exactly as the doc claims", () => {
		const toml = `${SCHEMA}
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
predicate_source = "target.has_capability('probe/thing')"
outcome_template_id = "probe/outcome"
range_m = 0
`;
		// The validator itself has NO opinion on this — the doc's own point.
		const diags = validateManifestToml(toml);
		expect(diags.filter((d) => d.severity === "fatal")).toEqual([]);

		const findings = lintFindings(toml);
		const finding = findings.find((f) => f.rule === "dead-target-capability");
		expect(finding, JSON.stringify(findings)).toBeDefined();
		expect(finding?.severity).toBe("warning");
		expect(finding?.id).toBe("probe/aff");
	});
});

describe("onramp README — has_item is a live possession gate in a manipulate predicate (sk-vjh.7)", () => {
	// DOC-PROMISE: has-item-dead-in-manipulate#has_item-works-inside-a-manipulate-predicate-retired-gotcha-kept-for-readers-of-old-manifests
	it("a has_item(...) predicate on a manipulate-only affordance_template validates clean and draws no lint finding — the retired dead-predicate warning must not come back", () => {
		const toml = `${SCHEMA}
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
predicate_source = "actor.has_item('probe/torch')"
outcome_template_id = "probe/outcome"
range_m = 0
`;
		const diags = validateManifestToml(toml);
		expect(diags.filter((d) => d.severity === "fatal")).toEqual([]);
		expect(lintFindings(toml)).toEqual([]);
	});
});

describe("onramp README — the condition capability fields are enforced, not dead (sk-syo)", () => {
	// DOC-PROMISE: condition-capability-grant-and-suppression#grants_capability_while_active-grants-a-capability-while-a-condition-holds-and-suppresses_capability_while_active-takes-one-away
	it("a condition_definition granting AND suppressing capabilities validates clean and draws no lint finding — the retired dead-field warning must not come back", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[capability_definitions]]
capability_id = "probe/granted_cap"
bundle_id = "probe"
actor_kind = "entity"
display_name = "Granted Cap"
description = "probe"

[[capability_definitions]]
capability_id = "probe/silenced_cap"
bundle_id = "probe"
actor_kind = "entity"
display_name = "Silenced Cap"
description = "probe"

[[condition_definitions]]
condition_definition_id = "probe/buffed"
bundle_id = "probe"
display_name = "Buffed"
stacking_rule = "core/stacking/single"
remove_time_policy = "core/remove_policy/reference_counted"
gate_predicate_source = ""
modifier_template_id = ""
grants_capability_while_active = ["probe/granted_cap"]
suppresses_capability_while_active = ["probe/silenced_cap"]
hooks = []
observable = true
implies = []
`;
		const diags = validateManifestToml(toml);
		expect(diags.filter((d) => d.severity === "fatal")).toEqual([]);

		// The retired rule cannot be named here any more: `LintRule` no longer
		// contains "dead-grants-capability-while-active", so comparing against
		// it is a compile error (TS2367), not a runtime assertion. The type is
		// now the stronger guard — a resurrected rule would have to re-enter
		// the union, and `lint.test.ts`'s own R8-retired cases cover the
		// behaviour. What is left to assert here is the doc-promise itself:
		// authoring both capability fields draws NO finding at all.
		const findings = lintFindings(toml);
		expect(findings, JSON.stringify(findings)).toEqual([]);
	});
});

describe("onramp README — a self-eligible REACTION needs a ModifyResource write (MF-VAL-263, narrowed by PR #2079)", () => {
	// DOC-PROMISE: actor-identity-bindings#actor-identity-bindings
	it("a self_eligible action_definition WITH reaction wiring whose on_success consequence has NO ModifyResource frame write is refused — Fatal, static, before any node", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[capability_definitions]]
capability_id = "probe/cap"
bundle_id = "probe"
actor_kind = "entity"
display_name = "Cap"
description = "probe"

[[condition_definitions]]
condition_definition_id = "probe/tagged"
bundle_id = "probe"
display_name = "Tagged"
stacking_rule = "core/stacking/single"
remove_time_policy = "core/remove_policy/reference_counted"
gate_predicate_source = ""
modifier_template_id = ""
hooks = []
observable = true
implies = []

[[consequence_templates]]
template_id = "probe/act/success"
bundle_id = "probe"

[[consequence_frame_writes]]
template_id = "probe/act/success"
ordinal = 0
frame_write = { ApplyStatus = { target_kind = "entity", target_ref = "Actor", condition_definition_id = "probe/tagged" } }

[[action_definitions]]
action_id = "probe/act"
bundle_id = "probe"
required_capability = "probe/cap"
on_success = "probe/act/success"
display_name = "Act"
cost_time_ms = 1000
resolution_mode = "Deterministic"
self_eligible = true
reaction_eligibility = "actor.has_capability('probe/cap')"
reaction_trigger = "$event.kind == 'r_move'"
reaction_window_ms = 1000
`;
		const diags = validateManifestToml(toml);
		const diag = diags.find((d) => d.code === "MF-VAL-263");
		expect(diag, JSON.stringify(diags)).toBeDefined();
		expect(diag?.severity).toBe("fatal");
		expect(diag?.message).toContain("no ModifyResource budget resource");
	});

	it("a plain self_eligible action WITHOUT reaction wiring and no budget validates — the genuinely-free self action (Dropping Prone shape, PR #2079)", () => {
		const toml = `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "probe"
author = "test"
display_name = "Probe"
version = "0.0.1"

[[capability_definitions]]
capability_id = "probe/cap"
bundle_id = "probe"
actor_kind = "entity"
display_name = "Cap"
description = "probe"

[[condition_definitions]]
condition_definition_id = "probe/tagged"
bundle_id = "probe"
display_name = "Tagged"
stacking_rule = "core/stacking/single"
remove_time_policy = "core/remove_policy/reference_counted"
gate_predicate_source = ""
modifier_template_id = ""
hooks = []
observable = true
implies = []

[[consequence_templates]]
template_id = "probe/act/success"
bundle_id = "probe"

[[consequence_frame_writes]]
template_id = "probe/act/success"
ordinal = 0
frame_write = { ApplyStatus = { target_kind = "entity", target_ref = "Actor", condition_definition_id = "probe/tagged" } }

[[action_definitions]]
action_id = "probe/act"
bundle_id = "probe"
required_capability = "probe/cap"
on_success = "probe/act/success"
display_name = "Act"
cost_time_ms = 1000
resolution_mode = "Deterministic"
self_eligible = true
`;
		const diags = validateManifestToml(toml);
		expect(diags.filter((d) => d.code === "MF-VAL-263")).toEqual([]);
		expect(diags.filter((d) => d.severity === "fatal")).toEqual([]);
	});
});
