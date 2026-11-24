/**
 * Kernel-convergence twin, CONDITION-REMOVE shape: a passive observer's socket-fed cache sees the
 * caster's cure remove the target's poisoned-equivalent condition while the un-cured control keeps
 * it. Ported from `kernel-convergence/srd-remove-condition-twin.test.ts` onto a private scene
 * (target, born poisoned, is also the observer as in the original; control is born poisoned and
 * never cured), so the one-shot removal does not make a second run on the same database fail.
 * One cast is the probe's one action; `probe` syncs both connections and every assertion reads
 * their caches right after.
 *
 *  - C1 passive convergence: the target's own cache shows the condition gone;
 *  - C2 negative control: the un-cured control keeps the condition;
 *  - C3 causal ordering, anchored on the manipulation's own claim condition (the poisoned
 *    condition itself is gone once the removal converges);
 *  - C4 no write client: the target connection is only ever read (structural, below).
 */
import { READER_SCOPED_TABLES } from "@spellkave/sdk";
import { manipulateAction, probe, type Scene, scene, syncConnection } from "@spellkave/test-lab";
import { afterAll, describe, expect, it } from "vitest";
import {
	attachCapabilityNiche,
	CONTROLLED_CONDITION,
	CURE_ACTION,
	CURE_CAPABILITY,
	conditionsOf,
	hasCondition,
	KC_DEPS,
	POISON_CONDITION,
	POISON_TARGET_DEF,
	tickOf,
} from "./kernel-convergence-support";
import { closeExtrasOwner, liveWorldRef, localNode } from "./support";

describe.skipIf(!localNode)("kernel-convergence condition-remove twin - cure convergence", () => {
	const scenes: Scene[] = [];
	afterAll(async () => {
		for (const s of scenes) await s.close();
		await closeExtrasOwner();
	});

	it("a passive observer sees the caster's cure remove the target's condition (C1-C4)", async () => {
		const s = await scene(liveWorldRef(), undefined, { bundleDeps: KC_DEPS });
		scenes.push(s);
		s.place("arena")
			.hero("caster", { at: "arena", capabilities: [CURE_CAPABILITY] })
			.hero("target", { at: "arena", def: POISON_TARGET_DEF })
			.npc("control", { at: "arena", def: POISON_TARGET_DEF, actor: true });
		await s.apply();
		await attachCapabilityNiche(s, "arena", CURE_CAPABILITY);
		const caster = s.heroOf("caster");
		const target = s.heroOf("target");
		const controlId = s.reads.entityId("control");
		if (controlId === null) throw new Error("scene entities not applied");
		await target.world.subscribeReaders([{ requiredTables: READER_SCOPED_TABLES }]);
		await syncConnection(target.world);

		// Baselines on the observer's own cache: target and control both start poisoned-equivalent.
		expect(hasCondition(target.world, target.entityId, POISON_CONDITION)).toBe(true);
		expect(hasCondition(target.world, controlId, POISON_CONDITION)).toBe(true);
		const tickBefore = tickOf(target.world);

		const { verdict } = await probe({
			scene: s,
			act: () => manipulateAction(caster.world, caster.entityId, target.entityId, CURE_ACTION),
		});
		expect(verdict.ok, verdict.ok ? "" : String(verdict.error)).toBe(true);

		// C1: the removal converged on the target's own cache.
		expect(
			hasCondition(target.world, target.entityId, POISON_CONDITION),
			"the target's cache still shows the condition",
		).toBe(false);
		// C2: the removal did not leak onto the un-cured control.
		expect(hasCondition(target.world, controlId, POISON_CONDITION)).toBe(true);
		// C3: a live transition, anchored on the manipulation's own claim condition.
		const claim = conditionsOf(target.world, target.entityId)?.find(
			(c) => c.condition_definition_id === CONTROLLED_CONDITION,
		);
		expect(claim, `no '${CONTROLLED_CONDITION}' row visible on the target`).toBeDefined();
		expect(claim?.applied_at_tick as number).toBeGreaterThanOrEqual(tickBefore);
	}, 90_000);
});
