// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "documentation sweep supplies a minimal malformed validator counterexample", "signatures": ["toml_version", "schema_directive", "schema_shape"]}
// DOC-PROMISE sweep declarations (authoring-doc-evidence task 6.1, sk-e0u.6).
// Each wraps a real offline assertion — reusing the SAME behavior the
// package's own unit suites (damage.test.ts, compose.test.ts, spell.test.ts,
// lint.test.ts) already prove structurally — through the doc-evidence
// protocol so the generated `ledger/claims.md` carries a row for it. These
// are claims from prose docs that had zero anchors before this sweep; see
// openspec/changes/authoring-doc-evidence/tasks.md 6.1.

// ci-allow(embedded-manifest-schema): deliberately incomplete documentation probes - partial TOML by design
import { describe, expect } from "vitest";
import {
	type ActorBehavior,
	type BehaviorConfig,
	clusterRows,
	emitSpell,
	lintManifest,
	routeDamage,
	routeDamageMagnitude,
	validateManifestToml,
} from "../index";
import { docEvidence } from "../test/doc-evidence/evidence";

describe("doc-evidence sweep declarations", () => {
	// -------------------------------------------------------------------
	// damage-type-routing.md
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: "damage-type-routing",
			tier: "offline",
			claim:
				"routeDamage('8d6', 'fire') emits the documented negated immune/resist/vulnerable/normal ladder exactly",
		},
		() => {
			expect(routeDamage("8d6", "fire")).toBe(
				"let dmg = 8d6; -cond(target.has_tag('damage_immune:fire'), 0, cond(target.has_tag('damage_resist:fire'), dmg / 2, cond(target.has_tag('damage_vulnerable:fire'), dmg * 2, dmg)))",
			);
		},
	);

	docEvidence(
		{
			doc: "damage-type-routing",
			tier: "offline",
			claim:
				"routeDamageMagnitude emits the SAME ladder un-negated — routeDamage is exactly that magnitude with a leading '-' spliced in front",
		},
		() => {
			const magnitude = routeDamageMagnitude("1d8 + 3", "piercing");
			expect(magnitude).toBe(
				"let dmg = 1d8 + 3; cond(target.has_tag('damage_immune:piercing'), 0, cond(target.has_tag('damage_resist:piercing'), dmg / 2, cond(target.has_tag('damage_vulnerable:piercing'), dmg * 2, dmg)))",
			);
			expect(routeDamage("1d8 + 3", "piercing")).toBe(magnitude.replace("cond(", "-cond("));
		},
	);

	// -------------------------------------------------------------------
	// behavior-composition.md
	// -------------------------------------------------------------------

	const COMPOSE_CFG: BehaviorConfig = {
		bundleId: "srd",
		manifestPath: "world-fixtures/srd/manifest.toml",
		capPrefix: "test",
		actionPrefix: "",
		defaultCaster: "srd/regdar",
		defaultCasterNode: "srd_outdoor/cell_a",
	};

	docEvidence(
		{
			doc: "behavior-composition",
			tier: "offline",
			claim:
				"resolutionMode / resolutionPredicateSource / onFailure map 1:1 onto action_definitions.resolution_mode / .resolution_predicate_source / .on_failure, and the empty predicateSource renders as an ungated (predicate_bool: true) offer",
		},
		() => {
			const behavior: ActorBehavior = {
				key: "doc-evidence-goblin-scimitar",
				displayName: "Doc Evidence Goblin Scimitar",
				emitCapability: true,
				actionTags: ["srd", "monster-action"],
				shape: "single-target",
				predicateSource: "",
				deltaSource: "0 - (1d6 + 2)",
				resolutionMode: "Stochastic",
				resolutionPredicateSource: "d20 >= 15",
				onFailure: "srd/doc-evidence-goblin-scimitar/miss",
			};
			const rows = clusterRows([behavior], COMPOSE_CFG) as Record<
				string,
				Array<Record<string, unknown>>
			>;
			expect(rows.action_definitions?.[0]).toMatchObject({
				resolution_mode: "Stochastic",
				resolution_predicate_source: "d20 >= 15",
				on_failure: "srd/doc-evidence-goblin-scimitar/miss",
			});
			expect(rows.affordance_templates?.[0]).toMatchObject({ predicate_bool: true });
		},
	);

	docEvidence(
		{
			doc: "behavior-composition",
			tier: "offline",
			claim:
				"the three resolution fields are optional and additive — a behavior that omits them renders an action_definitions row with none of resolution_mode/resolution_predicate_source/on_failure present, byte-identical to the pre-#1891 shape",
		},
		() => {
			const behavior: ActorBehavior = {
				key: "doc-evidence-test-strike",
				displayName: "Doc Evidence Test Strike",
				emitCapability: true,
				actionTags: ["test"],
				shape: "single-target",
				predicateSource: "d20 >= 13",
				deltaSource: "0 - 1d6",
			};
			const rows = clusterRows([behavior], COMPOSE_CFG) as Record<
				string,
				Array<Record<string, unknown>>
			>;
			const row = rows.action_definitions?.[0] ?? {};
			expect(Object.keys(row)).not.toContain("resolution_mode");
			expect(Object.keys(row)).not.toContain("resolution_predicate_source");
			expect(Object.keys(row)).not.toContain("on_failure");
		},
	);

	// -------------------------------------------------------------------
	// dm-oversight.md
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: "dm-oversight",
			tier: "offline",
			claim:
				"a non-empty actor_capabilities.extent_ref that names no declared place_graph is a FATAL MF-VAL-101 diagnostic at manifest apply (the doc's own MF-VAL-FK-CLOSURE label names the check's Rust constant, MF_VAL_FK_CLOSURE — its emitted code string is MF-VAL-101, corrected in this sweep)",
		},
		() => {
			const toml = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[metadata]
profile = "doc_evidence_dm_oversight"

[[bundles]]
bundle_id = "doc_evidence_dm_oversight"
display_name = "Doc Evidence DM Oversight"
author = "test"
version = "1.0.0"
depends_on = []
description = "dangling extent_ref fixture"

[[actor_capabilities]]
actor_entity_key = "dm"
bundle_id = "doc_evidence_dm_oversight"
capability_id = "doc_evidence_dm_oversight/oversee"
extent_ref = "doc_evidence_dm_oversight/no-such-region"
extent_kind_ref = "place_graph"
elevation_class = "internal"
source = "doc_evidence_dm_oversight"
`;
			const diags = validateManifestToml(toml);
			expect(
				diags.some(
					(d) =>
						d.code === "MF-VAL-101" &&
						d.severity === "fatal" &&
						d.path === "actor_capabilities.extent_ref",
				),
			).toBe(true);
		},
	);

	// -------------------------------------------------------------------
	// spell-authoring-best-practices.md
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: "spell-authoring-best-practices",
			tier: "offline",
			claim:
				"emitSpell asserts the catalog entity exists when catalogEntityIds is supplied (the author-time MF-VAL-264 guard) — throws for a missing catalog entity, passes for a present one",
		},
		() => {
			expect(() =>
				emitSpell(
					{
						capabilityId: "srd/spell/doc-evidence-ghost",
						actionId: "srd/cast_doc_evidence_ghost",
						bundleId: "srd",
						displayName: "Doc Evidence Ghost",
					},
					{ catalogEntityIds: ["srd/spell/doc-evidence-known"] },
				),
			).toThrow(/no matching catalog entity_definition/);
			expect(() =>
				emitSpell(
					{
						capabilityId: "srd/spell/doc-evidence-known",
						actionId: "srd/cast_doc_evidence_known",
						bundleId: "srd",
						displayName: "Doc Evidence Known",
					},
					{ catalogEntityIds: ["srd/spell/doc-evidence-known"] },
				),
			).not.toThrow();
		},
	);

	docEvidence(
		{
			doc: "spell-authoring-best-practices",
			tier: "offline",
			claim:
				"the author-time lint's twin-action rule flags an action byte-identical to another except its id, at 'warning' severity — lint never fatals the run the way manifest validate does",
		},
		() => {
			const manifest = {
				action_definitions: [
					{
						action_id: "srd/cast_doc_evidence_x",
						required_capability: "srd/spell/doc-evidence-x",
						on_success: "out",
					},
					{
						action_id: "srd/cast_doc_evidence_x/affordance",
						required_capability: "srd/spell/doc-evidence-x",
						on_success: "out",
					},
				],
				capability_definitions: [{ capability_id: "srd/spell/doc-evidence-x" }],
			};
			const findings = lintManifest(manifest).filter((f) => f.rule === "twin-action");
			expect(findings).toHaveLength(1);
			expect(findings[0]?.severity).toBe("warning");
		},
	);
});
