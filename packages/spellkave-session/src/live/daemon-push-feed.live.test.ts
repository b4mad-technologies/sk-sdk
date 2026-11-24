/**
 * `startDaemon` builds ONE primed push feed on a real subscribe-on-connect session and keeps it
 * across invokes (sk-jay0.7.123.20.48; the feed logic itself is proven offline in
 * `node/__tests__/world-events.test.ts`, only the `startDaemon` wiring needs a node). The actor
 * is a hero of this test's own scene, so no `SPELLKAVE_ACTOR` is needed and a second run on the
 * same database passes. The two `drain_pushes` calls are the probe's one action.
 */
import { probe, type Scene, scene } from "@spellkave/test-lab";
import { afterAll, describe, expect, it } from "vitest";
import { startDaemon } from "../node/daemon";
import { closeExtrasOwner, liveWorldRef, localNode } from "./support";

describe.skipIf(!localNode)("startDaemon push feed (live node)", () => {
	const scenes: Scene[] = [];
	afterAll(async () => {
		for (const s of scenes) await s.close();
		await closeExtrasOwner();
	});

	it("startDaemon constructs one feed that survives across invokes", async () => {
		const w = liveWorldRef();
		const s = await scene(w);
		scenes.push(s);
		s.place("yard").hero("walker", { at: "yard", capabilities: ["core/walk"] });
		await s.apply();
		const walker = s.heroOf("walker");
		const handle = await startDaemon({
			binding: {
				url: w.url,
				db: w.db,
				identity: walker.identity,
				actorId: String(walker.entityId),
			},
			token: walker.world.token,
		});
		try {
			const { verdict } = await probe({
				scene: s,
				act: async () => ({
					primed: await handle.dispatcher.handle({ id: 1, op: "drain_pushes" }),
					again: await handle.dispatcher.handle({ id: 2, op: "drain_pushes" }),
				}),
			});
			if (!verdict.ok) throw verdict.error;
			const { primed, again } = verdict.value;
			expect(primed).toMatchObject({ id: 1, ok: true });
			expect("pushes" in primed).toBe(false);
			expect(again).toMatchObject({ id: 2, ok: true });
		} finally {
			await handle.close();
		}
	}, 90_000);
});
