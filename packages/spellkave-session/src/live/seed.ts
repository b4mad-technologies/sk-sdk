/**
 * Package-level seed for the session live tests (`pnpm test:live`).
 *
 * One database per run, seeded once: gatekeeper first (scene() needs the owner bound to it
 * and it must be the first thing that creates actors), then the `core` substrate and the two
 * mechanic bundles whose DEFINITIONS the scenes depend on (`fastlane`: strike action + combat
 * session; `mech_kernel_convergence`: damage/buff/cure actions, hp pool, poisoned-equivalent).
 * Their fixed fixture actors are never used: each test builds its own scene entities.
 * Re-running against a seeded database is a no-op. Never wipes or publishes.
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
	for (const fixture of ["core", "fastlane", "mech_kernel_convergence"]) {
		await applyManifestSource(
			world,
			readFixtureSource(`packages/spellkave-mechanics/fixtures/${fixture}`),
			{ tolerateAlreadyApplied: true },
		);
	}
	console.log(
		"session live seed: gatekeeper + mechanics core, fastlane, mech_kernel_convergence (or already present)",
	);
} finally {
	world.disconnect();
}
process.exit(0);
