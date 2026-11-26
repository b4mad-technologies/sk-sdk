import { describe, expect, it } from "vitest";
import { type LintManifestOptions, type LintRule, lintManifest } from "../index";

// lintManifest reasons over a PARSED manifest (row-kind → row arrays), the same
// object inspectManifest(...).manifest yields. Tests build minimal manifests per
// rule so each smell is isolated.

function rulesFired(manifest: Record<string, unknown>, options?: LintManifestOptions): LintRule[] {
	return lintManifest(manifest, options).map((f) => f.rule);
}

// A hand-declared family, standing in for a content bundle's own
// `RefTagFamily[]` (`@spellkave/world-author` seeds none of its own —
// `ref-tags.ts`'s header). Mirrors `@spellkave/srd-cc`'s real
// `SRD_REF_TAG_FAMILIES` shape/prefix convention without depending on that
// package.
const ABILITY_FAMILY = {
	prefix: "srd.ability.",
	targetKind: "resource_definitions",
	naturalKeyField: "resource_definition_id",
};

describe("lintManifest — author-time duplication / binding smells (#836 Part C)", () => {
	it("carries the subject row bundle even for unscoped and generic row labels", () => {
		const findings = lintManifest({
			action_definitions: [{ action_id: "plain", bundle_id: "dep", required_capability: "absent" }],
			custom_rows: [{ bundle_id: "root", predicate_source: 'target.has_capability("x")' }],
		});
		expect(findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "plain",
					bundleId: "dep",
					rule: "dangling-required-capability",
				}),
				expect.objectContaining({
					id: "custom_rows",
					bundleId: "root",
					rule: "dead-target-capability",
				}),
			]),
		);
	});

	it("a clean bundle produces no findings", () => {
		const manifest = {
			entity_definitions: [{ entity_def_id: "srd/spell/fire-bolt" }],
			capability_definitions: [{ capability_id: "srd/spell/fire-bolt" }],
			action_definitions: [
				{
					action_id: "srd/cast_fire_bolt",
					required_capability: "srd/spell/fire-bolt",
					on_success: "x",
				},
			],
			capability_definition_tag: [{ capability_id: "srd/spell/fire-bolt", tag: "spell" }],
			action_definition_tag: [{ action_id: "srd/cast_fire_bolt", tag: "cantrip" }],
		};
		expect(lintManifest(manifest)).toEqual([]);
	});

	it("R1 twin-action: flags actions byte-identical except their id", () => {
		const manifest = {
			action_definitions: [
				{ action_id: "srd/cast_x", required_capability: "srd/spell/x", on_success: "out" },
				{
					action_id: "srd/cast_x/affordance",
					required_capability: "srd/spell/x",
					on_success: "out",
				},
				// a genuinely-different action must NOT collide.
				{ action_id: "srd/cast_y", required_capability: "srd/spell/y", on_success: "other" },
			],
			capability_definitions: [{ capability_id: "srd/spell/x" }, { capability_id: "srd/spell/y" }],
		};
		const findings = lintManifest(manifest).filter((f) => f.rule === "twin-action");
		expect(findings).toHaveLength(1);
		// the redundant sibling is reported, naming the kept canonical action.
		expect(findings[0]?.id).toBe("srd/cast_x/affordance");
		expect(findings[0]?.message).toContain("srd/cast_x");
		expect(findings[0]?.severity).toBe("warning");
	});

	it("R2 dangling-required-capability: flags a required_capability with no capability_definition", () => {
		const manifest = {
			action_definitions: [{ action_id: "srd/cast_ghost", required_capability: "srd/spell/ghost" }],
			capability_definitions: [{ capability_id: "srd/spell/known" }],
		};
		const findings = lintManifest(manifest).filter(
			(f) => f.rule === "dangling-required-capability",
		);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.id).toBe("srd/cast_ghost");
		expect(findings[0]?.message).toContain("srd/spell/ghost");
	});

	it("R3 orphan-spell-capability: flags a srd/spell capability with no catalog entity; exempts non-srd/spell", () => {
		const manifest = {
			entity_definitions: [{ entity_def_id: "srd/spell/present" }],
			capability_definitions: [
				{ capability_id: "srd/spell/present" }, // bound → no finding
				{ capability_id: "srd/spell/orphan" }, // srd/spell, no entity → finding
				{ capability_id: "srd/buff/blessed_strike" }, // synthetic → exempt
				{ capability_id: "srd/monster-action/goblin" }, // monster action → exempt
			],
		};
		const findings = lintManifest(manifest).filter((f) => f.rule === "orphan-spell-capability");
		expect(findings.map((f) => f.id)).toEqual(["srd/spell/orphan"]);
	});

	it("R4 spell-delimiter-drift: flags a srd/spell slug with an underscore, deduped across carriers", () => {
		const manifest = {
			entity_definitions: [{ entity_def_id: "srd/spell/magic_missile" }],
			capability_definitions: [{ capability_id: "srd/spell/magic_missile" }],
			action_definitions: [
				{ action_id: "srd/cast_magic_missile", required_capability: "srd/spell/magic_missile" },
			],
		};
		const findings = lintManifest(manifest).filter((f) => f.rule === "spell-delimiter-drift");
		// same id seen on 3 carriers → ONE finding (deduped by id).
		expect(findings).toHaveLength(1);
		expect(findings[0]?.id).toBe("srd/spell/magic_missile");
		expect(findings[0]?.message).toContain("srd/spell/magic-missile");
		// a hyphenated catalog slug is clean.
		expect(
			rulesFired({ capability_definitions: [{ capability_id: "srd/spell/magic-missile" }] }),
		).not.toContain("spell-delimiter-drift");
	});

	it("R5 tag-repetition: flags catalog IDENTITY tags re-carried on a behavior carrier", () => {
		// entity (catalog identity) + capability carry the IDENTICAL tag set → the
		// identity tags leaked onto behavior (the #836 evidence #3 smell).
		const manifest = {
			entity_definitions: [{ entity_def_id: "srd/spell/bless" }],
			capability_definitions: [{ capability_id: "srd/spell/bless" }],
			action_definitions: [{ action_id: "srd/bless", required_capability: "srd/spell/bless" }],
			entity_definition_tag: [
				{ entity_def_id: "srd/spell/bless", tag: "spell" },
				{ entity_def_id: "srd/spell/bless", tag: "level-1" },
			],
			capability_definition_tag: [
				{ capability_id: "srd/spell/bless", tag: "spell" },
				{ capability_id: "srd/spell/bless", tag: "level-1" },
			],
		};
		const findings = lintManifest(manifest).filter((f) => f.rule === "tag-repetition");
		expect(findings).toHaveLength(1);
		expect(findings[0]?.id).toBe("srd/spell/bless");
		expect(findings[0]?.message).toContain("identity tag set");
	});

	it("R5 does NOT fire on the emitSpell shape (capability+action tags, no catalog identity tags)", () => {
		// `emitSpell` single-sources tags from one declaration onto BOTH the capability
		// and the action — the blessed primitive's normal output. With no catalog
		// entity_definition_tag to leak, this must stay clean (no cry-wolf).
		const manifest = {
			capability_definitions: [{ capability_id: "srd/buff/blessed_strike" }],
			action_definitions: [
				{ action_id: "srd/blessed_strike", required_capability: "srd/buff/blessed_strike" },
			],
			capability_definition_tag: [{ capability_id: "srd/buff/blessed_strike", tag: "buff" }],
			action_definition_tag: [{ action_id: "srd/blessed_strike", tag: "buff" }],
		};
		expect(rulesFired(manifest)).not.toContain("tag-repetition");
	});

	it("R6 dead-target-capability: flags target.has_capability(...) in any *predicate_source field", () => {
		const manifest = {
			affordance_templates: [
				{
					template_id: "phandelver/affordance/mount_ride",
					predicate_source:
						'actor.has_capability("core/walk") && target.has_capability("core/mountable")',
				},
			],
		};
		const findings = lintManifest(manifest).filter((f) => f.rule === "dead-target-capability");
		expect(findings).toHaveLength(1);
		expect(findings[0]?.id).toBe("phandelver/affordance/mount_ride");
		expect(findings[0]?.message).toContain("target.has_niche");
	});

	it("R6 does NOT fire on actor.has_capability or target.has_niche", () => {
		const manifest = {
			affordance_templates: [
				{
					template_id: "core/affordance/traverse_known_threshold",
					predicate_source:
						'actor.has_capability("core/walk") && target.has_niche("core/passable_portal")',
				},
			],
		};
		expect(rulesFired(manifest)).not.toContain("dead-target-capability");
	});

	// R7 was `dead-manipulate-has-item` (#1846). sk-vjh.7 made the DSL `items`
	// fact pool real inside `manipulation_facts` (carried items of the acting
	// body, equipped or loose), so `actor.has_item(...)` now gates a manipulate
	// affordance at offer and act time and the rule was RETIRED rather than
	// inverted. These pin that a possession gate draws no finding any more,
	// whether or not the template is edge-attached.
	it("R7 retired: has_item(...) on a manipulate-only affordance_template is not flagged", () => {
		const manifest = {
			affordance_templates: [
				{
					template_id: "srd/affordance/attack_ranged",
					predicate_source:
						'actor.has_capability("core/attack") && actor.has_item("srd/item/ammo")',
				},
			],
		};
		expect(rulesFired(manifest)).not.toContain("dead-manipulate-has-item");
		expect(lintManifest(manifest)).toEqual([]);
	});

	it("R7 retired: an edge-attached has_item template is not flagged either", () => {
		const manifest = {
			affordance_templates: [
				{
					template_id: "core/affordance/traverse_locked_portal",
					predicate_source:
						'actor.has_capability("core/walk") && target.has_niche("core/passable_portal") && actor.has_item($bindings.required_key)',
				},
			],
			place_edge_affordance: [
				{
					edge_key: "phandelver/edge/a-b",
					affordance_template_id: "core/affordance/traverse_locked_portal",
				},
			],
		};
		expect(rulesFired(manifest)).not.toContain("dead-manipulate-has-item");
	});

	// R8 was `dead-grants-capability-while-active` (#1846). sk-syo made the
	// field real (enforced in `capability_ids_for_actor`) and added its
	// suppressing twin, so the rule was RETIRED rather than inverted — a lint
	// that fires on a working field trains authors to ignore the linter.
	// These pin that neither capability field draws a finding any more; a
	// resurrected rule fails here rather than silently warning every author
	// who uses the feature.
	it("R8 retired: authoring a capability grant on a condition draws no finding", () => {
		const manifest = {
			condition_definitions: [
				{
					condition_definition_id: "srd/ring-of-fireball/attuned",
					grants_capability_while_active: ["srd/spell/fireball"],
				},
			],
		};
		expect(rulesFired(manifest)).not.toContain("dead-grants-capability-while-active");
	});

	it("R8 retired: authoring a capability suppression draws no finding either", () => {
		const manifest = {
			condition_definitions: [
				{
					condition_definition_id: "srd/condition/incapacitated",
					suppresses_capability_while_active: ["srd/action/communicate/speak"],
				},
			],
		};
		expect(rulesFired(manifest)).toHaveLength(0);
	});

	it("R9 dangling-ref-tag: a clean tag resolving to an authored resource_definitions row produces no finding (family passed by the caller)", () => {
		const manifest = {
			resource_definitions: [{ resource_definition_id: "srd/wis" }],
			capability_definition_tag: [
				{ capability_id: "srd/skill/acrobatics", tag: "srd.ability.wis" },
			],
		};
		expect(rulesFired(manifest, { refTagFamilies: [ABILITY_FAMILY] })).not.toContain(
			"dangling-ref-tag",
		);
	});

	it("R9 dangling-ref-tag: a typo'd value fires exactly one finding naming the capability and the bad value", () => {
		const manifest = {
			resource_definitions: [{ resource_definition_id: "srd/wis" }],
			capability_definition_tag: [
				{ capability_id: "srd/skill/acrobatics", tag: "srd.ability.wsi" },
			],
		};
		const findings = lintManifest(manifest, { refTagFamilies: [ABILITY_FAMILY] }).filter(
			(f) => f.rule === "dangling-ref-tag",
		);
		expect(findings).toHaveLength(1);
		expect(findings[0]?.id).toBe("srd/skill/acrobatics");
		expect(findings[0]?.message).toContain("srd.ability.wsi");
		expect(findings[0]?.message).toContain("wsi");
	});

	it("R9 ambiguity emits MF-VAL-303-equivalent warning deterministically, not dangling", () => {
		const manifest = {
			resource_definitions: [
				{ resource_definition_id: "two/wis" },
				{ resource_definition_id: "one/wis" },
			],
			capability_definition_tag: [
				{ capability_id: "srd/skill/acrobatics", tag: "srd.ability.wis" },
			],
		};
		const findings = lintManifest(manifest, { refTagFamilies: [ABILITY_FAMILY] });
		expect(findings.map((finding) => finding.rule)).toContain("ambiguous-ref-tag");
		expect(findings.map((finding) => finding.rule)).not.toContain("dangling-ref-tag");
		expect(findings[0]?.message).toContain("one/wis, two/wis");
	});

	it("R9 dangling-ref-tag: an undeclared family (alignment=) never fires — not in the caller's declared list", () => {
		const manifest = {
			entity_definition_tag: [
				{ entity_def_id: "srd/monster/boss-dragon", tag: "alignment=chaotic_evil" },
			],
		};
		expect(rulesFired(manifest, { refTagFamilies: [ABILITY_FAMILY] })).not.toContain(
			"dangling-ref-tag",
		);
	});

	it("R9 dangling-ref-tag: with no refTagFamilies supplied (the default), the rule fires on nothing — the mechanism is caller-supplied, `@spellkave/world-author` seeds no vocabulary of its own", () => {
		const manifest = {
			resource_definitions: [{ resource_definition_id: "srd/wis" }],
			capability_definition_tag: [
				{ capability_id: "srd/skill/acrobatics", tag: "srd.ability.wsi" },
			],
		};
		// Same typo'd manifest as the test above, but called exactly the way
		// `sk lint`/`@spellkave/cli`'s `bundle.ts` and the legacy `spellkave-
		// author-cli` both call `lintManifest` today (no options object) — a
		// typo in a bundle's ref-typed tag produces no warning until that
		// caller starts passing its own `refTagFamilies`.
		expect(rulesFired(manifest)).not.toContain("dangling-ref-tag");
	});

	// T3 (kavemouth tool-UX campaign, operator mandate 2026-08-04): the
	// player-visible exit label is `direction ?? to_node_id`, where `direction`
	// mirrors `packages/spellkave-sdk/src/core/readers/location_snapshot.ts`'s
	// `metricDirection` (atan2 -> 8-way compass over authored pos_x/pos_y).
	it("R10 duplicate-exit-label: flags two exits from the same node sharing the identical compass direction", () => {
		const manifest = {
			place_nodes: [
				{ node_id: "hamlet/square", pos_present: true, pos_x: 0, pos_y: 0 },
				{ node_id: "hamlet/west_house", pos_present: true, pos_x: -5, pos_y: 0 },
				{ node_id: "tomb/entrance", pos_present: true, pos_x: -4, pos_y: 0 },
				{ node_id: "hamlet/gate", pos_present: true, pos_x: 5, pos_y: 0 },
			],
			place_edges: [
				{
					edge_key: "square->west_house",
					from_node_id: "hamlet/square",
					to_node_id: "hamlet/west_house",
				},
				{
					edge_key: "square->tomb_entrance",
					from_node_id: "hamlet/square",
					to_node_id: "tomb/entrance",
				},
				// a genuinely different direction from the SAME node must not collide.
				{ edge_key: "square->gate", from_node_id: "hamlet/square", to_node_id: "hamlet/gate" },
			],
		};
		const findings = lintManifest(manifest).filter((f) => f.rule === "duplicate-exit-label");
		expect(findings.map((f) => f.id)).toEqual(["square->tomb_entrance", "square->west_house"]);
		expect(findings[0]?.message).toContain("west");
		expect(findings[0]?.message).toContain("hamlet/square");
		expect(findings[0]?.message).toContain("square->west_house");
	});

	it("R10 does NOT fire when exits from the same node point in genuinely different directions", () => {
		const manifest = {
			place_nodes: [
				{ node_id: "square", pos_present: true, pos_x: 0, pos_y: 0 },
				{ node_id: "west_house", pos_present: true, pos_x: -5, pos_y: 0 },
				{ node_id: "gate", pos_present: true, pos_x: 5, pos_y: 0 },
			],
			place_edges: [
				{ edge_key: "square->west_house", from_node_id: "square", to_node_id: "west_house" },
				{ edge_key: "square->gate", from_node_id: "square", to_node_id: "gate" },
			],
		};
		expect(lintManifest(manifest).filter((f) => f.rule === "duplicate-exit-label")).toEqual([]);
	});

	it("R10 falls back to to_node_id when a position is missing, and stays quiet when destinations differ", () => {
		const manifest = {
			place_nodes: [
				{ node_id: "cell", pos_present: false, pos_x: 0, pos_y: 0 },
				{ node_id: "next_cell", pos_present: false, pos_x: 0, pos_y: 0 },
				{ node_id: "other_cell", pos_present: false, pos_x: 0, pos_y: 0 },
			],
			place_edges: [
				{ edge_key: "cell->next", from_node_id: "cell", to_node_id: "next_cell" },
				{ edge_key: "cell->other", from_node_id: "cell", to_node_id: "other_cell" },
			],
		};
		expect(lintManifest(manifest).filter((f) => f.rule === "duplicate-exit-label")).toEqual([]);
	});

	it("findings are sorted deterministically by (rule, id)", () => {
		const manifest = {
			capability_definitions: [
				{ capability_id: "srd/spell/z_orphan" },
				{ capability_id: "srd/spell/a_orphan" },
			],
		};
		const findings = lintManifest(manifest);
		const rules = findings.map((f) => f.rule);
		// rules are non-decreasing.
		expect([...rules]).toEqual([...rules].sort());
		// within orphan-spell-capability, ids are ascending.
		const orphans = findings.filter((f) => f.rule === "orphan-spell-capability").map((f) => f.id);
		expect(orphans).toEqual([...orphans].sort());
	});
});
