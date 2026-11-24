/**
 * Shared pieces of the kernel-convergence live twins (`pnpm test:live`). The mechanic DEFINITIONS
 * (damage, buff and cure actions, the hp pool, the poisoned-equivalent condition) come from the
 * seeded `mech_kernel_convergence` bundle; every twin builds its OWN scene entities and attaches
 * the capability niche it needs to its own arena, so nothing is shared between tests or runs.
 */
import {
	type EntityRef,
	readActorSnapshot,
	readObjectStateInt,
	readWorldStatus,
} from "@spellkave/sdk";
import type { SnapshotDb } from "@spellkave/sdk/replay";
import type { Scene, TestWorld } from "@spellkave/test-lab";
import { applySceneExtras } from "./support";

export const KC_BUNDLE = "mech_kernel_convergence";
export const KC_DEPS = ["core", KC_BUNDLE] as const;

export const HP_RESOURCE = `${KC_BUNDLE}/hp`;
export const HP_INITIAL = 50;
export const HP_SEEDED_TARGET_DEF = `${KC_BUNDLE}/hp_seeded_target_def`;
export const POISON_TARGET_DEF = `${KC_BUNDLE}/poisoned_equiv_target_def`;

export const DAMAGE_CAPABILITY = `${KC_BUNDLE}/capability/damage`;
export const DAMAGE_ACTION = `${KC_BUNDLE}/cast_damage`;
/** `1d10 + 5` (see `DAMAGE_DELTA_SOURCE` in `@spellkave/mechanics`): the bound of one cast. */
export const DAMAGE_RANGE: readonly [number, number] = [6, 15];

export const BUFF_CAPABILITY = `${KC_BUNDLE}/capability/buff`;
export const BUFF_ACTION = `${KC_BUNDLE}/cast_buff`;
export const BUFF_CONDITION = `${KC_BUNDLE}/buffed`;

export const CURE_CAPABILITY = `${KC_BUNDLE}/capability/cure`;
export const CURE_ACTION = `${KC_BUNDLE}/cast_cure`;
export const POISON_CONDITION = `${KC_BUNDLE}/poisoned_equiv`;
/** The claim condition `r_manipulate` commits; anchors causal ordering of a removal. */
export const CONTROLLED_CONDITION = "core/condition/controlled";

/** Attach the place-provided capability niche to the scene's arena (the niche itself is seeded). */
export async function attachCapabilityNiche(
	s: Scene,
	place: string,
	capabilityId: string,
): Promise<void> {
	await applySceneExtras(
		s,
		`[[spatial_niche_attachments]]
bundle_id = "${s.prefix}"
place_node_id = "${s.reads.nodeId(place)}"
niche_id = "capability:${capabilityId}"
condition_bool = true
ecological_invariant = false
visibility = "Public"
`,
		KC_DEPS,
	);
}

/** An integer object state as one connection's own cache holds it; `null` when it holds no row. */
export function stateOf(world: TestWorld, entityId: bigint, stateId: string): number | null {
	const value = readObjectStateInt(world.db() as unknown as SnapshotDb, {
		targetKind: "entity",
		targetId: String(entityId),
		stateId,
	});
	return value === null ? null : Number(value);
}

export interface SeenCondition {
	condition_definition_id: string;
	applied_at_tick: number;
}

/**
 * The conditions one connection's cache shows on an entity (player-facing snapshot reader), or
 * `null` when that cache cannot see the entity at all (so an empty list is never a vacuous pass).
 */
export function conditionsOf(world: TestWorld, entityId: bigint): SeenCondition[] | null {
	const snapshot = readActorSnapshot(
		world.db() as unknown as SnapshotDb,
		String(entityId) as EntityRef,
	);
	return snapshot === null ? null : (snapshot.conditions as unknown as SeenCondition[]);
}

export function hasCondition(world: TestWorld, entityId: bigint, conditionId: string): boolean {
	return (conditionsOf(world, entityId) ?? []).some(
		(c) => c.condition_definition_id === conditionId,
	);
}

/** The world tick one connection's cache holds. */
export function tickOf(world: TestWorld): number {
	return Number(readWorldStatus(world.db() as unknown as SnapshotDb)?.tick ?? 0);
}

export interface SeenProvenance {
	provenanceId: string;
	subjectId: string;
	draws: number[];
}

/** Provenance rows one connection's cache holds, or `null` when its cache has no such table. */
export function provenanceOf(world: TestWorld): SeenProvenance[] | null {
	const db = world.db() as unknown as Record<
		string,
		{ iter(): Iterable<Record<string, unknown>> } | undefined
	>;
	const handle = db.visibleEvaluationProvenance ?? db.visible_evaluation_provenance;
	if (handle === undefined) return null;
	return [...handle.iter()].map((row) => {
		const draws = (row.stochasticDraws ?? row.stochastic_draws ?? []) as {
			value: number | bigint;
		}[];
		return {
			provenanceId: String(row.provenanceId ?? row.provenance_id),
			subjectId: String(row.subjectId ?? row.subject_id),
			draws: draws.map((draw) => Number(draw.value)),
		};
	});
}
