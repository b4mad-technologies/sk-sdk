// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "documentation snippets need a minimal bundle envelope for validation", "signatures": ["toml_version", "schema_directive", "schema_shape"]}
// Doc-evidence declarations for authoring-doc-evidence task 5.1 (sk-e0u.5):
// converts `interaction-dsl-and-world-authoring.md`'s hand-typed TOML/DSL
// snippets to test-extracted form. Each declaration below pulls a fenced
// block's RAW bytes straight out of the committed doc (via `extractSnippet`,
// keyed by the `<!-- snippet: <id> -->` marker the doc now carries above
// that fence) and merges it into a minimal manifest skeleton, then runs the
// SAME wasm validator the server admits with (`validateManifestToml`). A
// snippet can no longer silently drift from the schema without turning this
// suite red — the committed doc bytes are the test input, not a hand-typed
// copy of them.
//
// Scope note: these are MECHANICAL claims ("the committed snippet, merged
// with FK-satisfying scaffolding, parses and validates with zero fatal
// diagnostics") — distinct from the BEHAVIORAL claims
// `doc-contract-dsl.test.ts`/`doc-contract-fixture-correctness.test.ts`
// already prove under 5 DOC-PROMISE-anchored headings in this same doc
// (from-spatial-rows-to-affordances, area-of-effect-frame-writes,
// modifier-expiry-is-an-absolute-tick-not-a-runtime-offset,
// epistemic-read-visibility-internal-discoverable-revealstate,
// weapons-carry-their-own-damage-attacker-sourced). Those suites author
// their OWN synthetic probes to prove a mechanism applies; this suite proves
// the doc's OWN literal bytes are well-formed. No claim here duplicates one
// of theirs.
//
// Not every fenced block in the doc gets a marker + declaration — see the
// per-snippet classification table in the implementer report for the ~5
// blocks left as-is (illustrative fragments per the doc-truth norm: a
// deliberately partial TOML fragment, three alternative example lines
// shown together, pseudo-JSON internal-representation sketches, or a CLI
// transcript).

// ci-allow(embedded-manifest-schema): DSL snippet counterexamples - deliberately invalid TOML under test
import { describe, expect } from "vitest";
import { docEvidence } from "../test/doc-evidence/evidence";
import { extractSnippet } from "../test/doc-evidence/snippets";
import { validateManifestToml } from "../validate";

const DOC = "interaction-dsl-and-world-authoring";
const SCHEMA = "#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json";

function snippet(id: string): string {
	return extractSnippet(DOC, id).content;
}

function bundleHeader(bundleId: string): string {
	return `${SCHEMA}
schema_version = "1.0.0"

[[bundles]]
bundle_id = "${bundleId}"
author = "test"
display_name = "Probe"
version = "0.0.1"
`;
}

/** Fatal diagnostics only — a snippet may carry an expected non-fatal
 * tag-namespace warning (a doc fragment authored without a bundle's own
 * `tag_prefixes`/`allow_flat_tags` declaration) without that being a schema
 * drift. Fatal-clean is the "the server would admit the shape this snippet
 * teaches" bar; a namespace-hygiene warning is a separate, pre-existing
 * concern (MF-VAL-297/298) unrelated to whether the snippet still matches
 * the schema. */
function fatalDiagnostics(toml: string) {
	return validateManifestToml(toml).filter((d) => d.severity === "fatal");
}

describe("doc-evidence: interaction-dsl-and-world-authoring.md snippet conversion (sk-e0u.5)", () => {
	// -------------------------------------------------------------------
	// From Spatial Rows To Affordances — two companion snippets that
	// compose (edge topology, then the affordance_template it references).
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'traverse-edge-topology' + 'traverse-edge-affordance' snippets, extracted verbatim and composed as the doc narrates (edge topology first, its affordance_template second), merged onto a minimal graph+node scaffold, validate with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("my_bundle")}
[[place_graphs]]
place_graph_id = "my_bundle/graph"
bundle_id = "my_bundle"
display_name = "Graph"
anchor_node_id = "my_bundle/graph/a"
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
node_id = "my_bundle/graph/a"
bundle_id = "my_bundle"
place_graph_id = "my_bundle/graph"
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
extent_shape_id = ""
extent_params_json = ""
is_ephemeral = false

[[place_nodes]]
node_id = "my_bundle/graph/b"
bundle_id = "my_bundle"
place_graph_id = "my_bundle/graph"
local_id = "b"
display_name = "B"
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
extent_shape_id = ""
extent_params_json = ""
is_ephemeral = false

${snippet("traverse-edge-topology")}

${snippet("traverse-edge-affordance")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	// -------------------------------------------------------------------
	// Actor↔Target Distance predicate — a bare `predicate_source` line,
	// embedded into a synthetic affordance_templates row (same idiom
	// doc-contract-dsl.test.ts's `affordanceToml` helper uses).
	// -------------------------------------------------------------------

	function affordanceRowAround(predicateLine: string): string {
		return `${bundleHeader("probe")}
[[affordance_templates]]
template_id = "probe/aff"
bundle_id = "probe"
niche_id = "probe/niche"
capability_id = "probe/cap"
display_name = "Aff"
${predicateLine}
outcome_template_id = "probe/outcome"
range_m = 0
`;
	}

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'distance-to-actor-predicate' snippet (a bare predicate_source line), embedded verbatim into a synthetic affordance_templates row, validates with zero fatal diagnostics — the DSL text itself is well-formed",
		},
		() => {
			expect(fatalDiagnostics(affordanceRowAround(snippet("distance-to-actor-predicate")))).toEqual(
				[],
			);
		},
	);

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'darkness-gated-predicate' snippet (a bare predicate_source line combining has_capability/has_niche/state/has_capability), embedded verbatim into a synthetic affordance_templates row, validates with zero fatal diagnostics",
		},
		() => {
			expect(fatalDiagnostics(affordanceRowAround(snippet("darkness-gated-predicate")))).toEqual(
				[],
			);
		},
	);

	// -------------------------------------------------------------------
	// Runtime Ambient State On Incident Edges — Inscribe(spatial_environment_state).
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'actor-incident-edges-inscribe' snippet (a full consequence_frame_writes row), extracted verbatim, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("my_bundle")}
${snippet("actor-incident-edges-inscribe")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	// -------------------------------------------------------------------
	// Trace Inscription — carry_dispatch_text / entity anchor / TargetEntityRef.
	// Each snippet is only the `[consequence_frame_writes.frame_write.Inscribe]`
	// sub-table; the parent `[[consequence_frame_writes]]` array header +
	// template_id/ordinal is scaffolding, not part of the extracted bytes.
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'carry-dispatch-text-inscribe' snippet, extracted verbatim and attached to a minimal consequence_frame_writes row + a matching place_node-scoped trace_kind_definitions row, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("probe")}
[[trace_kind_definitions]]
kind_id = "srd/speech_heard"
bundle_id = "probe"
description = "Speech heard"
location_kinds = "place_node"

[[consequence_templates]]
template_id = "probe/speak/success"
bundle_id = "probe"

[[consequence_frame_writes]]
template_id = "probe/speak/success"
ordinal = 0

${snippet("carry-dispatch-text-inscribe")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'entity-anchor-inscribe' snippet, extracted verbatim and attached to a minimal consequence_frame_writes row + a matching entity-scoped trace_kind_definitions row, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("my_bundle")}
[[trace_kind_definitions]]
kind_id = "my_bundle/tamper_mark"
bundle_id = "my_bundle"
description = "Tamper mark"
location_kinds = "entity"

[[consequence_templates]]
template_id = "my_bundle/mark/success"
bundle_id = "my_bundle"

[[consequence_frame_writes]]
template_id = "my_bundle/mark/success"
ordinal = 0

${snippet("entity-anchor-inscribe")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'target-entity-ref-inscribe' snippet, extracted verbatim and attached to a minimal consequence_frame_writes row + a matching entity-scoped trace_kind_definitions row, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("probe")}
[[trace_kind_definitions]]
kind_id = "srd/speech_heard"
bundle_id = "probe"
description = "Speech heard"
location_kinds = "entity"

[[consequence_templates]]
template_id = "probe/speak_to/success"
bundle_id = "probe"

[[consequence_frame_writes]]
template_id = "probe/speak_to/success"
ordinal = 0

${snippet("target-entity-ref-inscribe")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	// -------------------------------------------------------------------
	// Conditions And Modifiers — ApplyStatus / RemoveCondition.
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'apply-status-frame-write' snippet (a full consequence_frame_writes row), extracted verbatim and attached to a matching condition_definitions row, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("core")}
[[condition_definitions]]
condition_definition_id = "core/poisoned"
bundle_id = "core"
display_name = "Poisoned"
gate_predicate_source = ""
observable = true

${snippet("apply-status-frame-write")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'remove-condition-frame-write' snippet, extracted verbatim and attached to a minimal consequence_frame_writes row + a matching condition_definitions row, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("srd")}
[[condition_definitions]]
condition_definition_id = "srd/poisoned"
bundle_id = "srd"
display_name = "Poisoned"
gate_predicate_source = ""
observable = true

[[consequence_templates]]
template_id = "srd/cure/success"
bundle_id = "srd"

[[consequence_frame_writes]]
template_id = "srd/cure/success"
ordinal = 0

${snippet("remove-condition-frame-write")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	// -------------------------------------------------------------------
	// Creating Tagged World Objects — CreateWorldObject.
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'create-world-object-frame-write' snippet (a full consequence_frame_writes row), extracted verbatim and attached to a matching entity_definitions row, validates with zero fatal diagnostics (a flat-tag namespace warning is expected and not a schema drift — the fragment authors no bundle.tag_prefixes/allow_flat_tags of its own)",
		},
		() => {
			const toml = `${bundleHeader("my_bundle")}
[[entity_definitions]]
entity_def_id = "my_bundle/brick_wall"
bundle_id = "my_bundle"
display_name = "Brick wall"

${snippet("create-world-object-frame-write")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	// -------------------------------------------------------------------
	// Epistemic Read Visibility — object_state_definitions(Discoverable) / RevealState.
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'discoverable-object-state-definition' snippet (a full object_state_definitions row), extracted verbatim, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("my_bundle")}
${snippet("discoverable-object-state-definition")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'reveal-state-frame-write' snippet, extracted verbatim and attached to the same discoverable object_state_definitions row the doc pairs it with, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("my_bundle")}
${snippet("discoverable-object-state-definition")}

${snippet("reveal-state-frame-write")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	// -------------------------------------------------------------------
	// Area-of-effect frame writes — ForEachActorInRadius.
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'aoe-for-each-actor-in-radius' snippet (a full consequence_frame_writes row), extracted verbatim and attached to matching resource_definitions + area_shape_definitions rows, validates with zero fatal diagnostics (the doc's own hyphenated 'aoe-blast' bundle id in this teaching fragment triggers a non-fatal MF-VAL-271 snake_case-style warning, not a schema drift)",
		},
		() => {
			const toml = `${bundleHeader("aoe-blast")}
[[resource_definitions]]
resource_definition_id = "aoe-blast/hp"
bundle_id = "aoe-blast"
display_name = "HP"
value_kind = "int"
min_value = 0
max_value = 30
recovery_rule = "long_rest"

[[area_shape_definitions]]
shape_id = "core/area/node_ball"
bundle_id = "aoe-blast"
parameter_schema_json = "{}"

${snippet("aoe-for-each-actor-in-radius")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	// -------------------------------------------------------------------
	// Equipment — actor_equipment_slots.
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'actor-equipment-slot' snippet (a full actor_equipment_slots row), extracted verbatim and attached to a matching slot definition + actor/item entity pair, validates with zero fatal diagnostics",
		},
		() => {
			const toml = `${bundleHeader("srd")}
[[equipment_slot_definitions]]
slot_id = "srd/main_hand"
bundle_id = "srd"
label = "Main hand"

[[entity_definitions]]
entity_def_id = "srd/item/dagger"
bundle_id = "srd"
display_name = "Dagger"

[[entities]]
entity_key = "srd/regdar"
bundle_id = "srd"
kind = "npc"
name = "Regdar"
place_node_id = ""

[[entities]]
entity_key = "srd/item/dagger"
bundle_id = "srd"
kind = "item"
entity_def_id = "srd/item/dagger"
name = "Dagger"
place_node_id = ""

${snippet("actor-equipment-slot")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);

	// -------------------------------------------------------------------
	// Weapons carry their own damage (attacker-sourced).
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: DOC,
			tier: "offline",
			claim:
				"the 'weapon-damage-source' snippet (entity_definition_tag + entity_definition_item_dsl_source rows), extracted verbatim and attached to a matching entity_definitions row, validates with zero fatal diagnostics (a tag-namespace warning is expected — this teaching fragment authors no bundle.tag_prefixes of its own)",
		},
		() => {
			const toml = `${bundleHeader("srd")}
[[entity_definitions]]
entity_def_id = "srd/item/longsword"
bundle_id = "srd"
display_name = "Longsword"

${snippet("weapon-damage-source")}
`;
			expect(fatalDiagnostics(toml)).toEqual([]);
		},
	);
});
