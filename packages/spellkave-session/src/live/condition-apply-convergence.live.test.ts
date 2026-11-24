/**
 * Kernel-convergence twin, CONDITION-APPLY shape: a passive observer's socket-fed cache sees the
 * caster's buff land on the ally while the caster does not gain it, in causal order. Ported from
 * `kernel-convergence/srd-condition-modified-roll-twin.test.ts` onto a private scene (caster and
 * ally are this test's own heroes; the ally is also the observer, as in the original), so a
 * second run on the same database passes. One cast is the probe's one action; `probe` syncs both
 * connections and every assertion reads their caches right after.
 *
 *  - C1 passive convergence: the ally's own cache shows the buff it never caused;
 *  - C2 negative control: the caster, never the target of its own buff, does not gain it;
 *  - C3 causal ordering: the buff row was applied at or after the pre-cast clock;
 *  - C4 no write client: the ally connection is only ever read (structural, below).
 */
import { READER_SCOPED_TABLES } from "@spellkave/sdk";
import { manipulateAction, probe, type Scene, scene, syncConnection } from "@spellkave/test-lab";
import { afterAll, describe, expect, it } from "vitest";
import {
	attachCapabilityNiche,
	BUFF_ACTION,
	BUFF_CAPABILITY,
	BUFF_CONDITION,
	conditionsOf,
	hasCondition,
	KC_DEPS,
	tickOf,
} from "./kernel-convergence-support";
import { closeExtrasOwner, liveWorldRef, localNode } from "./support";

describe.skipIf(!localNode)("kernel-convergence condition-apply twin - buff convergence", () => {
	const scenes: Scene[] = [];
	afterAll(async () => {
		for (const s of scenes) await s.close();
		await closeExtrasOwner();
	});

	it("a passive observer sees the caster's buff converge on the ally (C1-C4)", async () => {
		const s = await scene(liveWorldRef(), undefined, { bundleDeps: KC_DEPS });
		scenes.push(s);
		s.place("arena")
			.hero("caster", { at: "arena", capabilities: [BUFF_CAPABILITY] })
			.hero("ally", { at: "arena" });
		await s.apply();
		await attachCapabilityNiche(s, "arena", BUFF_CAPABILITY);
		const caster = s.heroOf("caster");
		const ally = s.heroOf("ally");
		await ally.world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
		await syncConnection(ally.world);

		// Baselines on the observer's own cache: the ally starts unbuffed, and the caster is
		// visible to it (so "the caster has no buff" below is not an empty read of a blind cache).
		expect(hasCondition(ally.world, ally.entityId, BUFF_CONDITION)).toBe(false);
		expect(
			conditionsOf(ally.world, caster.entityId),
			"the ally cannot see the caster",
		).not.toBeNull();
		expect(hasCondition(ally.world, caster.entityId, BUFF_CONDITION)).toBe(false);
		const tickBefore = tickOf(ally.world);

		const { verdict } = await probe({
			scene: s,
			act: () => manipulateAction(caster.world, caster.entityId, ally.entityId, BUFF_ACTION),
		});
		expect(verdict.ok, verdict.ok ? "" : String(verdict.error)).toBe(true);

		// C1: the buff converged on the ally's own cache.
		const buff = conditionsOf(ally.world, ally.entityId)?.find(
			(c) => c.condition_definition_id === BUFF_CONDITION,
		);
		expect(buff, "the ally's cache never received the buff").toBeDefined();
		// C2: the effect did not leak onto the caster.
		expect(hasCondition(ally.world, caster.entityId, BUFF_CONDITION)).toBe(false);
		// C3: a live transition, not a pre-seeded row.
		expect(buff?.applied_at_tick as number).toBeGreaterThanOrEqual(tickBefore);
	}, 90_000);
});
