// ADR-0047 G-1 — behaviour anchor for a packages/spellkave-world-author/docs worked example.
//
// The index guards (corpus byte-equality, coverage) prove the example is
// *shaped* right; this proves it *behaves* right — the one drift edge no string
// guard can reach (a server change that silently falsifies a documented claim).
// It seeds the ACTUAL `packages/spellkave-world-author/docs/examples/<id>.toml` bytes against a live node
// and asserts the claimed effect, so the doc, the corpus, and the server cannot
// drift apart without this going red.
//
// Live-node only (Tier-3): SPELLKAVE_LOCAL_NODE=1 + a running node
// (`just spacetime-start && just publish`). Skipped in the offline lane.
//
// Scope note: `definition-seed-statblock` is anchored here because its claim
// (definition-level state inherited by the placed instance at admission, #729)
// is reachable by apply+read alone. The `aoe-damage-spell` claim is action-
// economy-gated — firing it needs NPC turn/session activation, so its behaviour
// is anchored natively instead (the ForEachActorInRadius + ModifyResource
// apply-slice is unit-tested in `server/.../for_each_actor_in_radius.rs`, and the
// example's frame-write structure is asserted in the world-author corpus tests).

import { readFileSync } from "node:fs";
import path from "node:path";
import type { SnapshotDb } from "@spellkave/sdk";
import { readObjectStateInt } from "@spellkave/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	actorIdForBody,
	applyManifestFixture,
	bindActor,
	connectDedicatedClaimWorld,
	connectTestWorld,
	ensureApplyManifestAuthority,
	entityIdByManifestKey,
	hasHiddenCapability,
	manipulatePlaceNodeAction,
	type TestWorld,
	waitFor,
} from "../../index";
import { localOperatorToken, Scenario } from "./helpers/scenario";

// HARNESS GAP (bead sk-e0u.9): the three multi-actor observation scenarios
// below need reader choreography the shared-dev-DB harness cannot provide yet
// — examples that $sender-bind their own actors at admission cannot be
// claimed by a second connection ("actor N already has 1 identity binding"),
// even though operator setup now shares the seeder identity. Proving these
// PLAYER claims needs binding-aware scene isolation, not an operator read
// path that bypasses the visibility claim. Skipped (the
// ledger reports them "not run"), NOT proven and NOT a doc gap.
const describeLocal = process.env.SPELLKAVE_LOCAL_NODE === "1" ? describe : describe.skip;

function docExampleToml(id: string): string {
	const candidates = [
		path.resolve(process.cwd(), `packages/spellkave-world-author/docs/examples/${id}.toml`),
		path.resolve(
			process.cwd(),
			"../..",
			`packages/spellkave-world-author/docs/examples/${id}.toml`,
		),
	];
	for (const candidate of candidates) {
		try {
			return readFileSync(candidate, "utf8");
		} catch {
			// try the next candidate
		}
	}
	throw new Error(`doc example toml not found: ${id}`);
}

describeLocal("packaged authoring-doc example behaviour anchor (live)", () => {
	let s: Scenario;

	beforeAll(async () => {
		s = await Scenario.create("doc-example-statblock");
		await s.applyCoreFixture();
		try {
			await s.applyManifest(docExampleToml("definition-seed-statblock"));
		} catch (error) {
			// idempotent on a dirty DB: the bundle may already be applied.
			if (!String(error).includes("MF-APPLY-012")) throw error;
		}
	}, 20_000);

	afterAll(async () => {
		await s?.dispose();
	});

	it("definition-seed-statblock: the placed ghoul inherits HP 22 from its definition at admission (#729)", async () => {
		// The example claims: a creature definition carries its own HP via
		// entity_definition_initial_state, and every placed instance inherits it
		// at admission — no per-instance object_state row authored.
		const ghoulEntityId = s.authoredEntityId("example_statblock:example_statblock/ghoul-1");
		const db = s.session.conn.db as unknown as SnapshotDb;

		let hp: bigint | null = null;
		const deadline = Date.now() + 4_000;
		while (Date.now() < deadline) {
			hp = readObjectStateInt(db, {
				targetKind: "entity",
				targetId: ghoulEntityId,
				stateId: "example_statblock/hp",
			});
			if (hp !== null) break;
			await new Promise((resolve) => setTimeout(resolve, 50));
		}

		expect(hp).toBe(22n);
	}, 12_000);
});

// ADR-0047 G-1 — the remaining packaged authoring-doc examples without a
// behaviour anchor (authoring-doc-evidence task 4.2, sk-e0u.4). Per-example
// decision (design D7), recorded alongside the docEvidence declarations in
// packages/spellkave-world-author/src/__tests__/doc-evidence-examples.test.ts:
//   - aoe-damage-spell, damage-type-routing: anchored NATIVELY (offline) —
//     both casters are unbound NPCs (no `[[actor_identities]] identity =
//     "$sender"` row), so no connecting session can drive `r_manipulate` as
//     them; the damage mechanism is proven against the kernel's Rust unit
//     tests instead. Not repeated here.
//   - dm-oversight, authored-dark-cave, spatial-minimal-cell: LIVE, below.
//   - communicate-with-actor: LIVE, below — seeds on top of core onto this
//     example's own communicate_with_actor/green.


describeLocal.skip("packaged authoring-doc example behaviour anchor (live) — dm-oversight", () => {
	let operatorWorld: TestWorld;
	let dmClaimWorld: TestWorld;
	let dmEntityId: bigint | null;
	let guardianEntityId: bigint | null;

	beforeAll(async () => {
		operatorWorld = await connectTestWorld({ token: localOperatorToken() });
		await ensureApplyManifestAuthority(operatorWorld);
		await applyManifestFixture(operatorWorld, "packages/spellkave-mechanics/fixtures/core", {
			tolerateAlreadyApplied: true,
		});
		await applyManifestFixture(
			operatorWorld,
			"packages/spellkave-world-author/docs/examples/dm-oversight.toml",
			{ tolerateAlreadyApplied: true },
		);
		dmEntityId = entityIdByManifestKey(operatorWorld.db(), "dm_oversight:dm_oversight/dm");
		guardianEntityId = entityIdByManifestKey(
			operatorWorld.db(),
			"dm_oversight:dm_oversight/guardian",
		);

		// `visible_capability` is caller-scoped row-level security — a
		// manifest-authored `[[actor_identities]] identity = "$sender"` row does
		// NOT reliably push a re-evaluated result to an ALREADY-SUBSCRIBED
		// connection for rows that existed before the binding landed. The
		// proven live-self-seeding idiom (packages/spellkave-srd-cc's
		// `dm-creation-harness.ts`, `bindActor`'s own doc comment) is a
		// DEDICATED connection that live-claims the body via the real
		// `r_claim_actor` reducer instead.
		dmClaimWorld = await connectDedicatedClaimWorld({}, "sdk-doc-example-dm-oversight-dm");
	}, 60_000);

	afterAll(() => {
		dmClaimWorld?.disconnect();
		operatorWorld?.disconnect();
	});

	it("dm-oversight: the DM sees the guardian's Hidden secret_trait capability inside the oversight extent (ADR-0007 D-4)", async () => {
		expect(dmEntityId).not.toBeNull();
		expect(guardianEntityId).not.toBeNull();

		await waitFor(
			() => actorIdForBody(dmClaimWorld.db(), dmEntityId as bigint) !== null,
			"dm_oversight/dm has no actor row on the claim connection",
			8_000,
		);
		const dmActorId = actorIdForBody(dmClaimWorld.db(), dmEntityId as bigint);
		if (dmActorId === null) {
			throw new Error("unreachable: dm_oversight/dm actor row vanished after waitFor");
		}
		await bindActor(dmClaimWorld, dmActorId);

		await waitFor(
			() => hasHiddenCapability(dmClaimWorld.db(), guardianEntityId as bigint),
			"the DM never saw the guardian's Hidden capability",
			8_000,
		);
		expect(hasHiddenCapability(dmClaimWorld.db(), guardianEntityId as bigint)).toBe(true);
	}, 60_000);
});

describeLocal.skip(
	"packaged authoring-doc example behaviour anchor (live) — authored-dark-cave",
	() => {
		let operatorWorld: TestWorld;
		let scoutClaimWorld: TestWorld;
		let delverClaimWorld: TestWorld;
		let scoutId: bigint | null;
		let delverId: bigint | null;

		beforeAll(async () => {
			operatorWorld = await connectTestWorld({ token: localOperatorToken() });
			await ensureApplyManifestAuthority(operatorWorld);
			await applyManifestFixture(operatorWorld, "packages/spellkave-mechanics/fixtures/core", {
				tolerateAlreadyApplied: true,
			});
			await applyManifestFixture(
				operatorWorld,
				"packages/spellkave-world-author/docs/examples/authored-dark-cave.toml",
				{ tolerateAlreadyApplied: true },
			);
			scoutId = entityIdByManifestKey(
				operatorWorld.db(),
				"authored_dark_cave:authored_dark_cave/scout",
			);
			delverId = entityIdByManifestKey(
				operatorWorld.db(),
				"authored_dark_cave:authored_dark_cave/delver",
			);

			// `visible_affordance` is caller-scoped the same way `visible_capability`
			// is (see the dm-oversight scenario above) — dedicated claim connections
			// instead of a manifest-authored `$sender` row.
			scoutClaimWorld = await connectDedicatedClaimWorld({}, "sdk-doc-example-dark-cave-scout");
			delverClaimWorld = await connectDedicatedClaimWorld({}, "sdk-doc-example-dark-cave-delver");
		}, 60_000);

		afterAll(() => {
			scoutClaimWorld?.disconnect();
			delverClaimWorld?.disconnect();
			operatorWorld?.disconnect();
		});

		it("authored-dark-cave: darkness rejects the scout's direct inspection attempt and permits the delver's", async () => {
			expect(scoutId).not.toBeNull();
			expect(delverId).not.toBeNull();

			await waitFor(
				() => actorIdForBody(scoutClaimWorld.db(), scoutId as bigint) !== null,
				"authored_dark_cave/scout has no actor row on the claim connection",
				8_000,
			);
			await waitFor(
				() => actorIdForBody(delverClaimWorld.db(), delverId as bigint) !== null,
				"authored_dark_cave/delver has no actor row on the claim connection",
				8_000,
			);
			const scoutActorId = actorIdForBody(scoutClaimWorld.db(), scoutId as bigint);
			const delverActorId = actorIdForBody(delverClaimWorld.db(), delverId as bigint);
			if (scoutActorId === null || delverActorId === null) {
				throw new Error("unreachable: scout/delver actor row vanished after waitFor");
			}
			await bindActor(scoutClaimWorld, scoutActorId);
			await bindActor(delverClaimWorld, delverActorId);

			const actionId = "authored_dark_cave/affordance/inspect_dark_passage";
			const targetNodeId = "authored_dark_cave/dark_passage";
			await expect(
				manipulatePlaceNodeAction(scoutClaimWorld, scoutId as bigint, targetNodeId, actionId),
			).rejects.toThrow();
			await expect(
				manipulatePlaceNodeAction(delverClaimWorld, delverId as bigint, targetNodeId, actionId),
			).resolves.toBeUndefined();
		}, 60_000);
	},
);

describeLocal(
	"packaged authoring-doc example behaviour anchor (live) — communicate-with-actor",
	() => {
		let world: TestWorld;

		beforeAll(async () => {
			world = await connectTestWorld({ token: localOperatorToken() });
			await ensureApplyManifestAuthority(world);
			await applyManifestFixture(world, "packages/spellkave-mechanics/fixtures/core", {
				tolerateAlreadyApplied: true,
			});
		}, 60_000);

		afterAll(() => {
			world?.disconnect();
		});

		// The example authors communicate_with_actor/green; seeding on top of
		// core must resolve the Village Herald at that live place.
		it("communicate-with-actor: seeding the committed example on top of core succeeds and the Village Herald becomes resolvable", async () => {
			await applyManifestFixture(
				world,
				"packages/spellkave-world-author/docs/examples/communicate-with-actor.toml",
				{ tolerateAlreadyApplied: true },
			);
			const heraldId = entityIdByManifestKey(
				world.db(),
				"communicate_with_actor:communicate_with_actor/herald",
			);
			expect(heraldId).not.toBeNull();
		}, 60_000);
	},
);

describeLocal.skip(
	"packaged authoring-doc example behaviour anchor (live) — spatial-minimal-cell",
	() => {
		let world: TestWorld;

		beforeAll(async () => {
			world = await connectTestWorld({ token: localOperatorToken() });
			await ensureApplyManifestAuthority(world);
			await applyManifestFixture(world, "packages/spellkave-mechanics/fixtures/core", {
				tolerateAlreadyApplied: true,
			});
			await applyManifestFixture(
				world,
				"packages/spellkave-world-author/docs/examples/spatial-minimal-cell.toml",
				{ tolerateAlreadyApplied: true },
			);
		}, 60_000);

		afterAll(() => {
			world?.disconnect();
		});

		it("spatial-minimal-cell: the authored place node lands and is observable, with zero outgoing edges", async () => {
			const NODE_ID = "example_spatial_cell/cell_a";
			// Dual accessor name (camelCase generated binding, snake_case
			// fallback) — matches test-lab's own `table()` helper convention.
			const db = world.db() as unknown as Record<
				string,
				{ iter(): Iterable<Record<string, unknown>> } | undefined
			>;
			const nodes = () => db.visiblePlaceNode ?? db.visible_place_node;
			const edges = () => db.visiblePlaceEdge ?? db.visible_place_edge;

			await waitFor(
				() =>
					[...(nodes()?.iter() ?? [])].some((row) => String(row.nodeId ?? row.node_id) === NODE_ID),
				"example_spatial_cell/cell_a never appeared in place_node",
				8_000,
			);

			const outgoingEdges = [...(edges()?.iter() ?? [])].filter(
				(row) => String(row.fromNodeId ?? row.from_node_id) === NODE_ID,
			);
			expect(outgoingEdges).toHaveLength(0);
		}, 60_000);
	},
);
