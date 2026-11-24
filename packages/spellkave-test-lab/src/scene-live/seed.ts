/**
 * Package-level seed for the test-lab scene live tests (`pnpm test:live`).
 *
 * One database per run, seeded once: gatekeeper first (scene() needs the owner
 * bound to it, and it must be the first thing that creates actors), then only
 * the `core` substrate the scenes depend on. Re-running against an already
 * seeded database is a no-op, so the test phases can be repeated on the same
 * DB. Never wipes or publishes.
 *
 *   source scripts/dev/node-env.sh
 *   SPELLKAVE_LOCAL_NODE=1 pnpm exec tsx packages/spellkave-test-lab/src/scene-live/seed.ts
 */
import {
	applyManifestDelta,
	applyManifestFixture,
	connectTestWorld,
	ensureWorldAuthority,
} from "../live";
import { promptKitSource } from "./prompt-kit";
import { liveWorldRef } from "./support";
import { us9KitSource } from "./us9-kit";

const CORE_FIXTURE = "packages/spellkave-mechanics/fixtures/core";
// Neutral mechanics fixtures whose DEFINITIONS the kernel-claim scenes use; their fixed actors are never used.
const CLAIM_FIXTURES = [
	"budgetgate",
	"mech_threshold_progression",
	"mech_priced_exchange",
	"mech_failure_recovery",
	"economy_projection",
];

async function main(): Promise<void> {
	const ref = liveWorldRef();
	const world = await connectTestWorld({ url: ref.url, db: ref.db, token: ref.token });
	try {
		await ensureWorldAuthority(world, { publisherToken: ref.token });
		try {
			await applyManifestFixture(world, CORE_FIXTURE, { tolerateAlreadyApplied: true });
			console.log("scene-live seed: gatekeeper + core applied (or already present)");
		} catch (error) {
			if (!String((error as Error).message).includes("MF-APPLYSET-EXISTS")) throw error;
			console.log("scene-live seed: core already applied, nothing to do");
		}
		// Generic prompt vocabulary (definitions only, no state) the prompt-gate scenes build on.
		await applyManifestDelta(world, promptKitSource(), {
			tolerateAlreadyApplied: true,
			label: "scene-live prompt kit",
		});
		console.log("scene-live seed: prompt kit applied (or already present)");
		for (const name of CLAIM_FIXTURES) {
			try {
				await applyManifestFixture(world, `packages/spellkave-mechanics/fixtures/${name}`, {
					tolerateAlreadyApplied: true,
				});
			} catch (error) {
				if (!String((error as Error).message).includes("MF-APPLYSET-EXISTS")) throw error;
			}
		}
		await applyManifestDelta(world, us9KitSource(), {
			tolerateAlreadyApplied: true,
			label: "scene-live us9 kit",
		});
		console.log("scene-live seed: kernel-claim fixtures + us9 kit applied (or already present)");
	} finally {
		world.disconnect();
	}
}

main().then(
	() => process.exit(0),
	(error: unknown) => {
		console.error(error);
		process.exit(1);
	},
);
