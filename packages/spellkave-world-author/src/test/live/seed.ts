/**
 * Package-level seed for the world-author live tests (`pnpm test:live`).
 *
 * One database per run, seeded once: gatekeeper first (scene() needs the owner bound to it
 * and it must be the first thing that creates actors), then only the `core` substrate the
 * scenes depend on. Re-running against a seeded database is a no-op. Never wipes or publishes.
 */
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	applyManifestSource,
	connectTestWorld,
	ensureApplyManifestAuthority,
	readFixtureSource,
} from "@spellkave/test-lab";

const token = resolveSpacetimeConfigPathToken();
if (!token) throw new Error("publisher credential required (SPACETIME_CONFIG_PATH)");
const world = await connectTestWorld({ token });
try {
	await ensureApplyManifestAuthority(world);
	await applyManifestSource(
		world,
		readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
		{
			tolerateAlreadyApplied: true,
		},
	);
	console.log("world-author live seed: gatekeeper + mechanics core (or already present)");
} finally {
	world.disconnect();
}
process.exit(0);
