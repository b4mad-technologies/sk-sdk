import {
	applyManifestSourceWithReceipt,
	ensureApplyManifestAuthority,
	entityIdByManifestKey,
	freshIsolatedWorld,
	readFixtureSource,
	type TestWorld,
} from "./live";

const bundle = "test_pending_probe";
export const PENDING_PROBE_ACTION = `${bundle}/roll`;
export const PENDING_PROBE_SLOT = `${bundle}/grip`;
export const PENDING_PROBE_BUDGET = `${bundle}/budget`;
const capability = `${bundle}/probe`;
/** Read the shared catalog without introducing an SDK-to-mechanics package dependency. */
export function pendingProbeCatalog(): string {
	return readFixtureSource("packages/spellkave-mechanics/fixtures/test_pending_probe");
}

/** Fresh scene and bound actors come from Isolated Cell; its owner exists before the item. */
export async function stagePendingProbe(world: TestWorld) {
	await ensureApplyManifestAuthority(world);
	const core = await applyManifestSourceWithReceipt(
		world,
		readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
		{ tolerateAlreadyApplied: true },
	);
	const catalog = await applyManifestSourceWithReceipt(world, pendingProbeCatalog(), {
		tolerateAlreadyApplied: true,
	});
	const options = {
		bundleDeps: ["core", bundle],
		capabilityIds: [capability],
		includeSupport: true,
		casterObjectStateSeeds: [{ stateId: PENDING_PROBE_BUDGET, valueInt: 1 }],
		casterEquipment: [
			{
				entityDefId: `${bundle}/instrument`,
				slotId: PENDING_PROBE_SLOT,
				stateSeeds: [{ stateId: PENDING_PROBE_BUDGET, valueInt: 1 }],
			},
		],
	};
	const scene = await freshIsolatedWorld(world, "pending-probe", options);
	const itemKey = `test-isolated-world-${scene.slug}/caster/equipment/0`;
	const itemId = entityIdByManifestKey(world.db(), `${scene.bundleId}:${itemKey}`);
	if (itemId === null) throw new Error(`Probe item missing in admitted scene ${scene.bundleId}`);
	return { scene, itemId, receipts: { core, catalog, scene: scene.manifestReceipt } };
}
