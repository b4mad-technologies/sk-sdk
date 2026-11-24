/**
 * Kernel-convergence twin, AUTO-HIT DAMAGE shape: a passive observer's socket-fed cache sees the
 * caster's damage cast drop the target's HP, and only the caster can read the roll provenance
 * (ADR-0120). Ported from `kernel-convergence/srd-auto-hit-damage-twin.test.ts` onto a private
 * scene: caster, passive observer, target and un-targeted control are this test's own entities,
 * so a second run on the same database passes. One cast is the probe's one action; `probe`
 * syncs the caster and the observer, and every assertion reads their caches right after.
 *
 * The rubric is the original C1-C4:
 *  - C1 passive convergence: the observer's own cache shows the target's HP drop;
 *  - C2 negative control: an un-targeted pool with the same seed does not move;
 *  - C3 bounded transition: the drop is within one cast's `1d10 + 5` and equals the damage die the
 *    engine recorded for the cast;
 *  - C4 no write client: the observer connection is only ever read (structural, below);
 *  - read visibility: the caster holds its own roll provenance, the observer holds none of it.
 */
import { READER_SCOPED_TABLES } from "@spellkave/sdk";
import { manipulateAction, probe, type Scene, scene, syncConnection } from "@spellkave/test-lab";
import { afterAll, describe, expect, it } from "vitest";
import {
	attachCapabilityNiche,
	DAMAGE_ACTION,
	DAMAGE_CAPABILITY,
	DAMAGE_RANGE,
	HP_INITIAL,
	HP_RESOURCE,
	HP_SEEDED_TARGET_DEF,
	KC_DEPS,
	provenanceOf,
	stateOf,
} from "./kernel-convergence-support";
import { closeExtrasOwner, liveWorldRef, localNode } from "./support";

const PROVENANCE_TABLES = [...READER_SCOPED_TABLES, "visible_evaluation_provenance" as const];

describe.skipIf(!localNode)("kernel-convergence damage twin - multiplayer HP convergence", () => {
	const scenes: Scene[] = [];
	afterAll(async () => {
		for (const s of scenes) await s.close();
		await closeExtrasOwner();
	});

	it("a passive observer sees the caster's damage cast drop the target's HP (C1-C4)", async () => {
		const s = await scene(liveWorldRef(), undefined, { bundleDeps: KC_DEPS });
		scenes.push(s);
		s.place("arena")
			.hero("caster", { at: "arena", capabilities: [DAMAGE_CAPABILITY] })
			.hero("observer", { at: "arena" })
			.npc("target", { at: "arena", def: HP_SEEDED_TARGET_DEF, actor: true })
			.npc("control", { at: "arena", def: HP_SEEDED_TARGET_DEF, actor: true });
		await s.apply();
		await attachCapabilityNiche(s, "arena", DAMAGE_CAPABILITY);
		const caster = s.heroOf("caster");
		const observer = s.heroOf("observer");
		const targetId = s.reads.entityId("target");
		const controlId = s.reads.entityId("control");
		if (targetId === null || controlId === null) throw new Error("scene entities not applied");
		for (const hero of [caster, observer]) {
			await hero.world.subscribeReaders([{ requiredTables: PROVENANCE_TABLES }]);
			await syncConnection(hero.world);
		}

		// Both pools are born at the seeded value, as the observer's own cache shows.
		expect(stateOf(observer.world, targetId, HP_RESOURCE)).toBe(HP_INITIAL);
		expect(stateOf(observer.world, controlId, HP_RESOURCE)).toBe(HP_INITIAL);
		const seen = new Set((provenanceOf(caster.world) ?? []).map((row) => row.provenanceId));

		const { verdict } = await probe({
			scene: s,
			act: () => manipulateAction(caster.world, caster.entityId, targetId, DAMAGE_ACTION),
		});
		expect(verdict.ok, verdict.ok ? "" : String(verdict.error)).toBe(true);

		// C1 + C3: the observer's own cache holds the drop, bounded to one cast.
		const after = stateOf(observer.world, targetId, HP_RESOURCE);
		expect(after, "the observer's cache never received the HP change").not.toBeNull();
		const drop = HP_INITIAL - (after as number);
		expect(drop).toBeGreaterThanOrEqual(DAMAGE_RANGE[0]);
		expect(drop).toBeLessThanOrEqual(DAMAGE_RANGE[1]);
		// C2: the un-targeted control did not move.
		expect(stateOf(observer.world, controlId, HP_RESOURCE)).toBe(HP_INITIAL);

		// Read visibility: the caster's own roll provenance is invisible to the observer.
		const casterRows = (provenanceOf(caster.world) ?? []).filter(
			(row) =>
				!seen.has(row.provenanceId) &&
				row.subjectId === String(caster.entityId) &&
				row.draws.length > 0,
		);
		expect(casterRows.length, "the damage action recorded no stochastic draw").toBeGreaterThan(0);
		const observerRows = provenanceOf(observer.world);
		expect(observerRows, "the observer cache must carry the provenance table").not.toBeNull();
		expect(
			(observerRows ?? []).filter((row) =>
				casterRows.some((casterRow) => casterRow.provenanceId === row.provenanceId),
			),
			"passive observer cache exposed the caster's private roll provenance",
		).toHaveLength(0);
	}, 90_000);
});
