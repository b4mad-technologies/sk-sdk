import { cluster_rows_json } from "@spellkave/authoring-wasm";
import { describe, expect, it } from "vitest";
import { type ActorBehavior, type BehaviorConfig, clusterRows } from "../index";

// #1968 R7 slice 4.10 (ADR-0087): the FINAL parity proof before compose.ts's
// hand-written clusterRows body is deleted. Every prior slice (4.1-4.9)
// proved its OWN piece byte-identical; this suite proves the fully-assembled
// Rust orchestrator (compose::cluster_rows, which calls those same pieces
// internally) reproduces clusterRows' complete output — across one
// representative behavior per shape, plus every cross-cutting modifier
// (attacks, resourceCost, communicationSpeechActId, bindToDefinition/
// defInstance) and the bundle-generic idNamespace override — before the
// swap in this same slice makes cluster_rows_json the SOLE implementation.

const BASE_CFG: BehaviorConfig = {
	bundleId: "srd",
	manifestPath: "world-fixtures/srd/manifest.toml",
	capPrefix: "test",
	actionPrefix: "cast_",
	defaultCaster: "srd/regdar",
	defaultCasterNode: "srd_outdoor/cell_a",
};

function assertParity(behaviors: ActorBehavior[], cfg: BehaviorConfig) {
	const tsRows = clusterRows(behaviors, cfg);
	const wasmRows = JSON.parse(cluster_rows_json(JSON.stringify(behaviors), JSON.stringify(cfg)));
	expect(wasmRows).toEqual(tsRows);
}

describe("clusterRows wasm parity (#1968 R7 slice 4.10, the final assembly)", () => {
	it("single-target behavior", () => {
		assertParity(
			[
				{
					key: "test-strike",
					displayName: "Test Strike",
					emitCapability: true,
					actionTags: ["test"],
					shape: "single-target",
					predicateSource: "d20 >= 13",
					deltaSource: "0 - 1d6",
				},
			],
			BASE_CFG,
		);
	});

	it("single-target with applyCondition and removeCondition variants", () => {
		assertParity(
			[
				{
					key: "hold-person",
					displayName: "Hold Person",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "single-target",
					predicateSource: "roll_under(d20, 13)",
					deltaSource: "0",
					applyCondition: "srd/paralyzed",
				},
				{
					key: "lesser-restoration",
					displayName: "Lesser Restoration",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "single-target",
					predicateSource: "",
					deltaSource: "0",
					removeCondition: "srd/blinded",
					removeConditionSource: "srd/curse_source",
				},
			],
			BASE_CFG,
		);
	});

	it("aoe behavior (default + explicit override)", () => {
		assertParity(
			[
				{
					key: "fireball",
					displayName: "Fireball",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "aoe",
					radiusM: 6,
					predicateSource: "",
					deltaSource: "cond(d20 >= 13, 0 - (8d6 / 2), 0 - 8d6)",
				},
				{
					key: "firebloom",
					displayName: "Firebloom",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "aoe",
					predicateSource: "d20 < 13",
					deltaSource: "-d6",
					areaShapeId: "core/area/node_ball",
					areaShapeParamsJson: '{"ball_radius": 0}',
					aoeResource: "aoe_blast/hp",
				},
			],
			BASE_CFG,
		);
	});

	it("attacks (Multiattack) behavior", () => {
		assertParity(
			[
				{
					key: "polar-bear-rend",
					displayName: "Polar Bear Rend",
					emitCapability: true,
					actionTags: ["monster-action"],
					shape: "single-target",
					predicateSource: "",
					deltaSource: "0",
					attacks: [
						{ deltaSource: "cond(d20 >= 15, 0 - 1d8, 0)", label: "Rend 1" },
						{ deltaSource: "cond(d20 >= 15, 0 - 1d8, 0)", label: "Rend 2" },
					],
				},
			],
			BASE_CFG,
		);
	});

	it("resourceCost modifier on top of a shape", () => {
		assertParity(
			[
				{
					key: "cure-wounds",
					displayName: "Cure Wounds",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "single-target",
					predicateSource: "",
					deltaSource: "1d8 + 3",
					resourceCost: { resource: "srd/spell_slot_1", amount: 1 },
				},
			],
			BASE_CFG,
		);
	});

	it("communicationSpeechActId sets the speech-act outcome field", () => {
		assertParity(
			[
				{
					key: "persuade",
					displayName: "Persuade",
					emitCapability: true,
					actionTags: ["social"],
					shape: "single-target",
					predicateSource: "d20 + 2 >= 13",
					deltaSource: "1",
					resourceStateId: "srd/attitude",
					communicationSpeechActId: "srd/speech-act/persuade",
				},
			],
			BASE_CFG,
		);
	});

	it("zone behavior (immediate pulse)", () => {
		assertParity(
			[
				{
					key: "spike-growth",
					displayName: "Spike Growth",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "zone",
					zoneStateId: "srd/spike-growth",
					zoneIntensity: 1,
					predicateSource: "",
					deltaSource: "0 - 2d4",
				},
			],
			BASE_CFG,
		);
	});

	it("env-state behavior (no pulse)", () => {
		assertParity(
			[
				{
					key: "darkness",
					displayName: "Darkness",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "env-state",
					zoneStateId: "srd/darkness",
					predicateSource: "",
					deltaSource: "",
				},
			],
			BASE_CFG,
		);
	});

	it("scheduled-zone behavior (autonomy-job scheduling)", () => {
		assertParity(
			[
				{
					key: "moonbeam",
					displayName: "Moonbeam",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "scheduled-zone",
					zoneStateId: "srd/moonbeam",
					zoneIntensity: 1,
					zoneCenterRef: "TargetSpatialRef",
					predicateSource: "roll_under(d20, 13)",
					deltaSource: "cond(roll_under(d20, 13), 0 - (2d10 / 2), 0 - 2d10)",
					scheduleRepeats: 10,
					scheduleFrequencyMs: 6000,
					requiresSubjectAlive: false,
				},
			],
			BASE_CFG,
		);
	});

	it("summon behavior (literal + dynamic location)", () => {
		assertParity(
			[
				{
					key: "find-familiar",
					displayName: "Find Familiar",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "summon",
					summonBlueprint: "srd/monster/cat",
					summonLocationNode: "srd_outdoor/cell_a",
					predicateSource: "",
					deltaSource: "",
				},
				{
					key: "conjure-imp",
					displayName: "Conjure Imp",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "summon",
					summonBlueprint: "srd/monster/imp",
					summonAtCaster: true,
					predicateSource: "",
					deltaSource: "",
				},
			],
			BASE_CFG,
		);
	});

	it("outcome-graph behavior (branch/edge/node emission)", () => {
		assertParity(
			[
				{
					key: "acid-arrow",
					displayName: "Melf's Acid Arrow",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "outcome-graph",
					predicateSource: "",
					deltaSource: "",
					branches: [
						{ node: "hit", guard: "d20 >= 15", deltaSource: "4d4", label: "Hit" },
						{ node: "miss", guard: "1 == 1", deltaSource: "2d4" },
					],
				},
			],
			BASE_CFG,
		);
	});

	it("clock behavior (the death-saves shape)", () => {
		assertParity(
			[
				{
					key: "death_save/roll",
					displayName: "Roll a Death Saving Throw",
					emitCapability: true,
					actionTags: ["clock"],
					shape: "clock",
					predicateSource:
						"actor.status('srd/dying') == true && actor.status('srd/stable') == false && actor.status('srd/dead') == false",
					deltaSource: "",
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
				},
			],
			BASE_CFG,
		);
	});

	it("bindToDefinition + defInstance (#728 proof-instance shape)", () => {
		assertParity(
			[
				{
					key: "test-strike",
					displayName: "Test Strike",
					emitCapability: true,
					actionTags: ["monster-action"],
					shape: "single-target",
					predicateSource: "d20 >= 13",
					deltaSource: "0 - 1d6",
					bindToDefinition: "srd/monster/cat",
					defInstance: { entityKey: "srd/proof-cat", name: "Proof Cat" },
				},
			],
			BASE_CFG,
		);
	});

	it("emitCasterEntity + emitCasterActor (monster-caster wiring)", () => {
		assertParity(
			[
				{
					key: "goblin-bite",
					displayName: "Goblin Bite",
					emitCapability: true,
					actionTags: ["monster-action"],
					shape: "single-target",
					predicateSource: "d20 >= 13",
					deltaSource: "0 - 1d6",
					caster: "srd/goblin-1",
					emitCasterEntity: true,
					emitCasterActor: true,
					casterEntityDefId: "srd/monster/goblin",
					casterName: "Goblin",
					casterKind: "npc",
				},
			],
			BASE_CFG,
		);
	});

	it("bundle-generic idNamespace override across multiple shapes in one call", () => {
		const cfg: BehaviorConfig = { ...BASE_CFG, bundleId: "aoe_blast", idNamespace: "aoe_blast" };
		assertParity(
			[
				{
					key: "firebloom",
					displayName: "Firebloom",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "aoe",
					radiusM: 6,
					predicateSource: "",
					deltaSource: "-2d6",
				},
				{
					key: "strike",
					displayName: "Strike",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "single-target",
					predicateSource: "d20 >= 13",
					deltaSource: "-1d6",
				},
			],
			cfg,
		);
	});

	it("objectStateSeeds from cfg with no behaviors", () => {
		const cfg: BehaviorConfig = {
			...BASE_CFG,
			objectStateSeeds: [
				{
					entityKey: "srd/regdar",
					stateId: "srd/hp",
					valueInt: 10,
					sourceTemplateId: "srd/seed",
				},
			],
		};
		assertParity([], cfg);
	});

	it("full mixed-shape batch in one clusterRows call", () => {
		assertParity(
			[
				{
					key: "strike",
					displayName: "Strike",
					emitCapability: true,
					actionTags: ["test"],
					shape: "single-target",
					predicateSource: "d20 >= 13",
					deltaSource: "0 - 1d6",
				},
				{
					key: "fireball",
					displayName: "Fireball",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "aoe",
					radiusM: 6,
					predicateSource: "",
					deltaSource: "-8d6",
					resourceCost: { resource: "srd/spell_slot_3", amount: 1 },
				},
				{
					key: "acid-arrow",
					displayName: "Acid Arrow",
					emitCapability: true,
					actionTags: ["spell"],
					shape: "outcome-graph",
					predicateSource: "",
					deltaSource: "",
					branches: [
						{ node: "hit", guard: "d20 >= 15", deltaSource: "4d4" },
						{ node: "miss", guard: "1 == 1", deltaSource: "2d4" },
					],
				},
			],
			BASE_CFG,
		);
	});
});
