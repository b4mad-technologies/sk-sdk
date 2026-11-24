import { describe, expect, it } from "vitest";
import {
	type ActorBehavior,
	type BehaviorConfig,
	clusterRows,
	INSTANCE_ROW_TABLES,
	mergeRowTables,
} from "../index";

// ADR-0072 D-1 / #1526: the composition layer is a package export. This guards
// the promoted entry point's contract — one declarative ActorBehavior expands
// into the full behavior chain — so a regression here fails in the package,
// not first in a packages/spellkave-srd/src/author driver run.

const CFG: BehaviorConfig = {
	bundleId: "srd",
	manifestPath: "world-fixtures/srd/manifest.toml",
	capPrefix: "test",
	actionPrefix: "",
	defaultCaster: "srd/regdar",
	defaultCasterNode: "srd_outdoor/cell_a",
};

const STRIKE: ActorBehavior = {
	key: "test-strike",
	displayName: "Test Strike",
	emitCapability: true,
	actionTags: ["test"],
	shape: "single-target",
	predicateSource: "d20 >= 13",
	deltaSource: "0 - 1d6",
};

describe("compose (behavior chain builder)", () => {
	it("expands one single-target ActorBehavior into the full chain", () => {
		const rows = clusterRows([STRIKE], CFG) as Record<string, Array<Record<string, unknown>>>;
		for (const table of [
			"capability_definitions",
			"outcome_templates",
			"affordance_templates",
			"action_definitions",
			"consequence_templates",
			"consequence_frame_writes",
			"actor_capabilities",
			"spatial_niche_attachments",
		]) {
			expect(rows[table], table).toHaveLength(1);
		}
		expect(rows.capability_definitions?.[0]).toMatchObject({
			capability_id: "srd/test/test-strike",
		});
		// The chain is wired, not just present: the action requires the emitted
		// capability, and the attack roll sits on the affordance predicate.
		expect(rows.action_definitions?.[0]).toMatchObject({
			required_capability: "srd/test/test-strike",
		});
		expect(rows.affordance_templates?.[0]).toMatchObject({ predicate_source: "d20 >= 13" });
	});

	// Byte-stability regression (composer-resolution-fields ledger contract
	// §4): STRIKE sets none of resolutionMode/resolutionPredicateSource/
	// onFailure — the emitted action_definitions row must carry EXACTLY the
	// pre-existing key set, with no resolution_mode/resolution_predicate_source/
	// on_failure key sneaking in (even at a default value). Pinned literally so
	// a future "always emit with a default" edit fails loudly, not silently.
	it("omitting the new resolution fields keeps action_definitions byte-identical to today", () => {
		const rows = clusterRows([STRIKE], CFG) as Record<string, Array<Record<string, unknown>>>;
		expect(rows.action_definitions?.[0]).toStrictEqual({
			action_id: "srd/test-strike",
			bundle_id: "srd",
			required_capability: "srd/test/test-strike",
			on_success: "srd/test-strike/success",
			display_name: "Test Strike",
			cost_time_ms: 1000,
			self_eligible: false,
		});
	});

	// #1891/#2075 composer-resolution-fields: the canon-ideal split for a
	// single-target attack — the OFFER predicate (`predicateSource`, on
	// affordance_templates) stays deterministic eligibility-only, while the
	// die roll moves to `resolutionPredicateSource` (act-time, re-evaluated by
	// r_manipulate for real) alongside an explicit miss consequence.
	it("resolutionMode/resolutionPredicateSource/onFailure map 1:1 onto the action_definitions row", () => {
		const behavior: ActorBehavior = {
			key: "goblin-scimitar",
			displayName: "Goblin Scimitar",
			emitCapability: true,
			actionTags: ["srd", "monster-action"],
			shape: "single-target",
			predicateSource: "", // deterministic eligibility only — the die no longer gates the offer (#1891)
			deltaSource: "0 - (1d6 + 2)",
			resolutionMode: "Stochastic",
			resolutionPredicateSource: "d20 >= 15",
			onFailure: "srd/goblin-scimitar/miss",
		};
		const rows = clusterRows([behavior], CFG) as Record<string, Array<Record<string, unknown>>>;
		expect(rows.action_definitions?.[0]).toMatchObject({
			resolution_mode: "Stochastic",
			resolution_predicate_source: "d20 >= 15",
			on_failure: "srd/goblin-scimitar/miss",
			// on_success stays the composer's own always-derived identity —
			// unaffected by the new fields.
			on_success: "srd/goblin-scimitar/success",
		});
		// The offer predicate itself is untouched — still deterministic
		// eligibility only (empty here = ungated, `predicate_bool: true`).
		expect(rows.affordance_templates?.[0]).toMatchObject({ predicate_bool: true });
	});

	it("mergeRowTables concatenates per-table across behaviors", () => {
		const a = clusterRows([STRIKE], CFG);
		const b = clusterRows([{ ...STRIKE, key: "test-strike-2", displayName: "Test Strike 2" }], CFG);
		const merged = mergeRowTables(a, b) as Record<string, Array<Record<string, unknown>>>;
		expect(merged.capability_definitions).toHaveLength(2);
	});

	it("keeps the instance-row partition set covering the live-wiring tables", () => {
		// The dual-output split (base definitions vs proof instances) keys on
		// this set; the wiring rows clusterRows emits must be classified as
		// instance rows or they leak into a definitions-only base bundle.
		expect(INSTANCE_ROW_TABLES.has("actor_capabilities")).toBe(true);
		expect(INSTANCE_ROW_TABLES.has("spatial_niche_attachments")).toBe(true);
		expect(INSTANCE_ROW_TABLES.has("capability_definitions")).toBe(false);
	});

	// #1968 FIX③ (de-fork): `idNamespace` + the aoe-shape overrides let a
	// bundle-generic caller (companion-agent's `spellkave_define_behavior`) reuse
	// this SAME builder instead of hand-mirroring its "aoe" wiring. Every field here
	// is additive/optional — the two tests above (CFG never sets any of them) are
	// the byte-identical-default proof; this test proves the override path itself.
	it("idNamespace + areaShapeId/areaShapeParamsJson/aoeResource override the srd-default derivation", () => {
		const cfg: BehaviorConfig = { ...CFG, idNamespace: "aoe_blast" };
		const behavior: ActorBehavior = {
			key: "firebloom",
			displayName: "Cast Firebloom",
			emitCapability: true,
			actionTags: ["spell"],
			shape: "aoe",
			predicateSource: "d20 < 13",
			deltaSource: "-d6",
			areaShapeId: "core/area/node_ball",
			areaShapeParamsJson: '{"ball_radius": 0}',
			aoeResource: "aoe_blast/hp",
		};
		const rows = clusterRows([behavior], cfg) as Record<string, Array<Record<string, unknown>>>;
		expect(rows.capability_definitions?.[0]).toMatchObject({
			capability_id: "aoe_blast/test/firebloom",
		});
		expect(rows.action_definitions?.[0]).toMatchObject({
			action_id: "aoe_blast/firebloom",
			required_capability: "aoe_blast/test/firebloom",
		});
		expect(rows.consequence_frame_writes?.[0]?.frame_write).toMatchObject({
			ForEachActorInRadius: {
				center_ref: "ActorSpatialRef",
				shape_id: "core/area/node_ball",
				shape_params_json: '{"ball_radius": 0}',
				predicate_source: "d20 < 13",
				body: [
					{ ModifyResource: { actor: "Actor", resource: "aoe_blast/hp", delta_source: "-d6" } },
				],
			},
		});
	});

	// #1968 finding C2 — "clock" (the death-saves shape): a SELF-TARGETED
	// multi-ordinal tally/threshold pattern. Proven against
	// world-fixtures/srd/base/death-saves.toml's own committed roll consequence
	// (minus the nat-1/nat-20 boundary ordinals, the same documented trim the
	// fast-lane's buildDeathSavesManifest already carries) — see this suite's
	// companion equivalence test in authoring-verbs.test.ts for the FULL proof
	// against the committed fixture rows.
	describe("clock shape (#1968 finding C2)", () => {
		const CLOCK_CFG: BehaviorConfig = { ...CFG, idNamespace: "srd" };
		const clockBehavior: ActorBehavior = {
			key: "death_save/roll",
			displayName: "Roll a Death Saving Throw",
			emitCapability: true,
			actionTags: ["clock"],
			shape: "clock",
			predicateSource:
				"actor.status('srd/dying') == true && actor.status('srd/stable') == false && actor.status('srd/dead') == false",
			deltaSource: "", // ignored for clock
			selfEligible: true,
			clockTallies: [
				{
					resource: "srd/death_save_last_roll",
					delta: "d20 - actor.stat('srd/death_save_last_roll')",
				},
				{
					resource: "srd/death_save_successes",
					predicate: "actor.stat('srd/death_save_last_roll') >= 10",
				},
				{
					resource: "srd/death_save_failures",
					predicate: "actor.stat('srd/death_save_last_roll') < 10",
				},
			],
			clockThresholds: [
				{ when: "actor.stat('srd/death_save_successes') >= 3", applyStatus: "srd/stable" },
				{ when: "actor.stat('srd/death_save_failures') >= 3", applyStatus: "srd/dead" },
			],
		};

		it("folds tallies (array order = ordinal order) then thresholds, every write targeting Actor alone", () => {
			const rows = clusterRows([clockBehavior], CLOCK_CFG) as Record<
				string,
				Array<Record<string, unknown>>
			>;
			const frameWrites = rows.consequence_frame_writes;
			expect(frameWrites).toHaveLength(5);
			expect(frameWrites?.[0]?.ordinal).toBe(0);
			expect(frameWrites?.[0]?.frame_write).toMatchObject({
				ModifyResource: {
					actor: "Actor",
					resource: "srd/death_save_last_roll",
					delta_source: "d20 - actor.stat('srd/death_save_last_roll')",
				},
			});
			expect(frameWrites?.[1]?.frame_write).toMatchObject({
				ModifyResource: {
					actor: "Actor",
					resource: "srd/death_save_successes",
					delta_source: "cond(actor.stat('srd/death_save_last_roll') >= 10, 1, 0)",
				},
			});
			expect(frameWrites?.[2]?.frame_write).toMatchObject({
				ModifyResource: {
					actor: "Actor",
					resource: "srd/death_save_failures",
					delta_source: "cond(actor.stat('srd/death_save_last_roll') < 10, 1, 0)",
				},
			});
			// Threshold ordinals come AFTER every tally, wrapped in a radius-0
			// ForEachActorInRadius targeting "Actor" (never TargetActor).
			expect(frameWrites?.[3]?.ordinal).toBe(3);
			expect(frameWrites?.[3]?.frame_write).toMatchObject({
				ForEachActorInRadius: {
					center_ref: "ActorSpatialRef",
					shape_id: "core/area/node_ball",
					shape_params_json: '{"ball_radius": 0}',
					predicate_source: "actor.stat('srd/death_save_successes') >= 3",
					body: [
						{
							ApplyStatus: {
								target_kind: "entity",
								target_ref: "Actor",
								condition_definition_id: "srd/stable",
							},
						},
					],
				},
			});
			expect(frameWrites?.[4]?.frame_write).toMatchObject({
				ForEachActorInRadius: {
					predicate_source: "actor.stat('srd/death_save_failures') >= 3",
					body: [
						{
							ApplyStatus: {
								target_kind: "entity",
								target_ref: "Actor",
								condition_definition_id: "srd/dead",
							},
						},
					],
				},
			});
			// The affordance's own eligibility gate, NOT any threshold's `when`.
			expect(rows.affordance_templates?.[0]).toMatchObject({
				predicate_source:
					"actor.status('srd/dying') == true && actor.status('srd/stable') == false && actor.status('srd/dead') == false",
			});
			expect(rows.action_definitions?.[0]).toMatchObject({ self_eligible: true });
		});

		it("is idempotent: re-clustering the SAME behavior reproduces byte-identical rows", () => {
			const first = clusterRows([clockBehavior], CLOCK_CFG);
			const second = clusterRows([clockBehavior], CLOCK_CFG);
			expect(second).toEqual(first);
		});

		it("shrink: dropping a tally or threshold changes ONLY the frame_write count and ordinals, never leaking the dropped entry's shape", () => {
			const shrunk: ActorBehavior = {
				...clockBehavior,
				clockTallies: clockBehavior.clockTallies?.slice(0, 1),
				clockThresholds: clockBehavior.clockThresholds?.slice(0, 1),
			};
			const rows = clusterRows([shrunk], CLOCK_CFG) as Record<
				string,
				Array<Record<string, unknown>>
			>;
			const frameWrites = rows.consequence_frame_writes;
			expect(frameWrites).toHaveLength(2);
			expect(frameWrites?.[0]?.frame_write).toMatchObject({
				ModifyResource: { resource: "srd/death_save_last_roll" },
			});
			expect(frameWrites?.[1]?.frame_write).toMatchObject({
				ForEachActorInRadius: { predicate_source: "actor.stat('srd/death_save_successes') >= 3" },
			});
			// No trace of the dropped failures tally / dead threshold anywhere.
			const rendered = JSON.stringify(frameWrites);
			expect(rendered).not.toContain("srd/death_save_failures");
			expect(rendered).not.toContain("srd/dead");
		});

		it("rename: renaming a tally's resource id changes the emitted frame_write, no stale id survives", () => {
			const renamed: ActorBehavior = {
				...clockBehavior,
				clockTallies: clockBehavior.clockTallies?.map((t) =>
					t.resource === "srd/death_save_successes" ? { ...t, resource: "srd/death_save_wins" } : t,
				),
			};
			const rows = clusterRows([renamed], CLOCK_CFG) as Record<
				string,
				Array<Record<string, unknown>>
			>;
			// Only the RENAMED tally's own frame_write changes — the threshold's `when`
			// string is independent authored text, untouched by a tally rename (this
			// builder never cross-derives one from the other).
			expect(rows.consequence_frame_writes?.[1]?.frame_write).toMatchObject({
				ModifyResource: { resource: "srd/death_save_wins" },
			});
			const tallyFrameWrites = rows.consequence_frame_writes?.slice(0, 3);
			expect(JSON.stringify(tallyFrameWrites)).not.toContain("srd/death_save_successes");
		});

		it("compose-equivalence: a RemoveCondition threshold folds to the SAME shape single-target's removeCondition body uses", () => {
			const cleanseBehavior: ActorBehavior = {
				key: "cleanse_clock",
				displayName: "Cleanse Clock",
				emitCapability: true,
				actionTags: ["clock"],
				shape: "clock",
				predicateSource: "",
				deltaSource: "",
				selfEligible: true,
				clockTallies: [{ resource: "srd/curse_stacks", delta: "0 - 1" }],
				clockThresholds: [
					{
						when: "actor.stat('srd/curse_stacks') <= 0",
						removeCondition: "srd/cursed",
						removeConditionSource: "srd/curse_source",
					},
				],
			};
			const rows = clusterRows([cleanseBehavior], CLOCK_CFG) as Record<
				string,
				Array<Record<string, unknown>>
			>;
			expect(rows.consequence_frame_writes?.[1]?.frame_write).toMatchObject({
				ForEachActorInRadius: {
					body: [
						{
							RemoveCondition: {
								target_kind: "entity",
								target_ref: "Actor",
								condition_definition_id: "srd/cursed",
								source_match: { Exact: "srd/curse_source" },
							},
						},
					],
				},
			});
		});
	});
});
