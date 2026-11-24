// embedded-manifest: {"category": "handwritten_toml_oracle", "rationale": "executable documentation examples use a deliberately invalid counterexample", "signatures": ["toml_version", "schema_directive", "schema_shape"]}
// Doc-evidence declarations for the 8 packaged authoring examples that had
// no behaviour anchor before this change (authoring-doc-evidence task 4,
// sk-e0u.4; design D7). `definition-seed-statblock` is the pre-existing
// live-preseeded precedent (`packages/spellkave-test-lab/src/__tests__/sdk/doc_example_behaviour.test.ts`);
// this file records the per-example decision for the remaining 8 as a
// docEvidence/docGap declaration so the generated `ledger/claims.md` carries
// them, and formalizes `aoe-damage-spell`'s existing native citation
// (`corpus.test.ts`) as a declaration alongside it.
//
// Two anchor shapes (design D7):
//
//   OFFLINE — the claim is reachable without a live node: a validator/lint
//   diagnostic against the committed example bytes, or — for
//   action-economy-gated claims (the `aoe-damage-spell` precedent: firing the
//   cast needs an NPC caster no connecting SDK session can drive through
//   `r_manipulate`, since neither example's caster carries an
//   `[[actor_identities]] identity = "$sender"` row) — the DSL/frame-write
//   SHAPE the example authors, cited against the Rust unit test that proves
//   the underlying kernel mechanism actually applies it.
//
//   LIVE — SPELLKAVE_LOCAL_NODE=1-gated, using `@spellkave/test-lab`
//   (the public cross-package live-test surface, ADR-0088 D-2; not
//   test-lab's internal `src/__tests__/sdk/helpers/scenario.ts`, which is not
//   exported). Reports "not run" in the normal offline lane (the whole
//   `describe` is `.skip`'d, propagating to every declared test) and
//   "proven"/"failed"/"reproduced" only when the lead runs
//   `SPELLKAVE_LOCAL_NODE=1 pnpm --filter @spellkave/world-author run test:doc-evidence`
//   against this worktree's `sk dev` node using its publisher credential. The SAME four claims also
//   get a full anchor in
//   `packages/spellkave-test-lab/src/__tests__/sdk/doc_example_behaviour.test.ts`
//   (task 4.2, the `Scenario` pattern) — this file reuses `test-lab` instead
//   of duplicating `Scenario` plumbing, so the ledger reports a REAL verdict
//   here too, not an inert marker.
//
// No reporter tweak was needed: `docEvidenceStateForTest` (reporter.ts)
// already maps a `describe.skip`-propagated `mode: "skip"` to `"not-run"`,
// which is exactly what a `describeLocal`-gated block produces offline.

// ci-allow(embedded-manifest-schema): documentation counterexamples - deliberately invalid TOML under test
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	actorIdForBody,
	applyManifestDelta,
	applyManifestFixture,
	bindActorAsOperator,
	connectDedicatedClaimWorld,
	connectTestWorld,
	ensureApplyManifestAuthority,
	entityIdByManifestKey,
	hasHiddenCapability,
	manipulatePlaceNodeAction,
	readFixtureSource,
	type TestWorld,
	waitFor,
} from "@spellkave/test-lab";
import { describe, expect } from "vitest";
import { inspectManifest } from "../inspect";
import { lintManifest } from "../lint";
import { docEvidence } from "../test/doc-evidence/evidence";
import { validateManifestToml } from "../validate";

const EXAMPLES_DIR = fileURLToPath(new URL("../../docs/examples/", import.meta.url));

function exampleToml(id: string): string {
	return readFileSync(`${EXAMPLES_DIR}${id}.toml`, "utf8");
}

// ---------------------------------------------------------------------------
// Offline anchors
// ---------------------------------------------------------------------------

describe("doc-evidence: packaged example behaviour anchors (offline)", () => {
	// -------------------------------------------------------------------
	// aoe-damage-spell.md — native anchor (existing precedent, formalized).
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: "aoe-damage-spell",
			tier: "offline",
			claim:
				"casting is action-economy-gated (the caster is an unbound NPC — no r_manipulate path from a connecting SDK session), so the damage mechanism is anchored natively: the example's ForEachActorInRadius + negative-delta ModifyResource frame write, unit-tested against the kernel's ForEachActorInRadius apply slice in the world API",
		},
		() => {
			const toml = exampleToml("aoe-damage-spell");
			expect(toml).toContain("ForEachActorInRadius");
			expect(toml).toContain("ModifyResource");
			expect(toml).toMatch(/delta_source\s*=\s*"\s*-/);
		},
	);


	docEvidence(
		{
			doc: "damage-type-routing",
			tier: "offline",
			claim:
				"casting is action-economy-gated (the caster is an unbound NPC, same as aoe-damage-spell), so the has_tag/cond damage-routing ladder is anchored natively against modify_resource.rs's wielded_item_damage_source_honors_target_slashing_resistance_and_immunity, which proves the identical immune/resist/vulnerable/normal has_tag(...)-gated cond(...) ladder actually applies at the kernel's ModifyResource apply slice",
		},
		() => {
			const toml = exampleToml("damage-type-routing");
			expect(toml).toContain(
				"let dmg = 8d6; -cond(target.has_tag('damage_immune:fire'), 0, cond(target.has_tag('damage_resist:fire'), dmg / 2, cond(target.has_tag('damage_vulnerable:fire'), dmg * 2, dmg)))",
			);
		},
	);

	// -------------------------------------------------------------------
	// weighted-int-roll-table.md — validator-diagnostic claims, reachable
	// without a live node (the wasm validator, not r_apply_world_manifest).
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: "weighted-int-roll-table",
			tier: "offline",
			claim:
				"the committed weighted-int-roll-table.toml (weights 6:3:1, non-identity) validates clean",
		},
		() => {
			const diags = validateManifestToml(exampleToml("weighted-int-roll-table"));
			expect(diags.filter((d) => d.severity === "fatal")).toEqual([]);
		},
	);

	docEvidence(
		{
			doc: "weighted-int-roll-table",
			tier: "offline",
			claim:
				"the doc's own negative case holds: an identity-mapped uniform 1..N weight-1 int table (the shape the doc says NOT to author) is rejected with MF-VAL-317 Fatal",
		},
		() => {
			const badToml = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[metadata]
bundle = "doc_evidence_bad_roll_table"
profile = "doc_evidence_bad_roll_table"

[[bundles]]
allow_flat_tags = false
author = "world-author-agent"
bundle_id = "doc_evidence_bad_roll_table"
depends_on = []
description = "Negative case for MF-VAL-317 (weighted-int-roll-table.md)."
display_name = "Doc Evidence Bad Roll Table"
tag_prefixes = []
version = "1.0.0"

[[roll_tables]]
roll_table_id = "doc_evidence_bad_roll_table/d4"
bundle_id = "doc_evidence_bad_roll_table"
display_name = "Fake d4"
result_kind = "int"

[[roll_table_entries]]
roll_table_entry_id = "doc_evidence_bad_roll_table/d4:1"
roll_table_id = "doc_evidence_bad_roll_table/d4"
authored_order = 1
weight = 1
result_ref = "1"

[[roll_table_entries]]
roll_table_entry_id = "doc_evidence_bad_roll_table/d4:2"
roll_table_id = "doc_evidence_bad_roll_table/d4"
authored_order = 2
weight = 1
result_ref = "2"

[[roll_table_entries]]
roll_table_entry_id = "doc_evidence_bad_roll_table/d4:3"
roll_table_id = "doc_evidence_bad_roll_table/d4"
authored_order = 3
weight = 1
result_ref = "3"

[[roll_table_entries]]
roll_table_entry_id = "doc_evidence_bad_roll_table/d4:4"
roll_table_id = "doc_evidence_bad_roll_table/d4"
authored_order = 4
weight = 1
result_ref = "4"
`;
			const diags = validateManifestToml(badToml);
			expect(diags.some((d) => d.code === "MF-VAL-317" && d.severity === "fatal")).toBe(true);
		},
	);

	// -------------------------------------------------------------------
	// spell-identity-minimal.md — author-time lint claim.
	// -------------------------------------------------------------------

	docEvidence(
		{
			doc: "spell-identity-minimal",
			tier: "offline",
			claim:
				"`manifest lint` reports the committed spell-identity-minimal.toml clean (zero findings) — the twin-action, tag-repetition, spell-delimiter-drift, orphan-spell-capability, and dangling-required-capability rules all pass",
		},
		() => {
			const manifest = inspectManifest(exampleToml("spell-identity-minimal")).manifest as Record<
				string,
				unknown
			>;
			expect(lintManifest(manifest)).toEqual([]);
		},
	);
});

// ---------------------------------------------------------------------------
// Live anchors
// ---------------------------------------------------------------------------

// HARNESS GAP (bead sk-e0u.9): the three multi-actor observation scenarios
// below need reader choreography the shared-dev-DB harness cannot provide yet
// — examples that $sender-bind their own actors need separate observer
// subscriptions and identities. Publisher staging below retains existing core
// role grants through delta admission; it does not provide the
// multi-reader choreography needed to establish these three observations.
// Proving them live needs isolated scenarios and explicit reader setup. Skipped (the
// ledger reports them "not run"), NOT proven and NOT a doc gap.
async function connectExamplePublisher(): Promise<TestWorld> {
	const token = resolveSpacetimeConfigPathToken();
	if (!token) throw new Error("owned publisher credential required for example staging");
	const world = await connectTestWorld({ token });
	try {
		await ensureApplyManifestAuthority(world);
		return world;
	} catch (error) {
		world.disconnect();
		throw error;
	}
}

const describeLocal = process.env.SPELLKAVE_LOCAL_NODE === "1" ? describe : describe.skip;

describeLocal("doc-evidence: packaged example behaviour anchors (live)", () => {
	// -------------------------------------------------------------------
	// dm-oversight.md
	// -------------------------------------------------------------------

	// HARNESS GAP (bead sk-e0u.9, see the block comment above `describeLocal`):
	// this scenario needs a dedicated operator-bound connection observing a body
	// that already existed before the operator binding landed; the shared-dev-DB harness
	// can't isolate that yet. Skipped even under SPELLKAVE_LOCAL_NODE=1, not
	// just offline — re-enable together with the other two below once sk-e0u.9
	// lands.
	describe.skip("dm-oversight", () => {
		let operatorWorld: TestWorld;
		let dmClaimWorld: TestWorld;

		docEvidence(
			{
				doc: "dm-oversight",
				tier: "live-self-seeding",
				claim:
					"a body holding the region-oversight grant (extent_kind_ref = 'place_graph', elevation_class = 'internal') sees the Hidden dm_oversight/secret_trait capability on the guardian inside the extent, via visible_capability",
			},
			async () => {
				operatorWorld = await connectExamplePublisher();
				try {
					// Staging uses an upsert so existing role-derived grants survive.
					await applyManifestDelta(
						operatorWorld,
						readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
						{ tolerateAlreadyApplied: true },
					);
					await applyManifestFixture(
						operatorWorld,
						"packages/spellkave-world-author/docs/examples/dm-oversight.toml",
						{ tolerateAlreadyApplied: true },
					);
					const dmEntityId = entityIdByManifestKey(
						operatorWorld.db(),
						"dm_oversight:dm_oversight/dm",
					);
					const guardianId = entityIdByManifestKey(
						operatorWorld.db(),
						"dm_oversight:dm_oversight/guardian",
					);
					expect(dmEntityId).not.toBeNull();
					expect(guardianId).not.toBeNull();

					// Separate human fixture identity for the unoffered DM body.
					// The publisher installs an explicit Person binding; runtime
					// claims are reserved for already offered player bodies.
					dmClaimWorld = await connectDedicatedClaimWorld(
						{},
						"world-author-doc-evidence-dm-oversight-dm",
					);
					await waitFor(
						() => actorIdForBody(dmClaimWorld.db(), dmEntityId as bigint) !== null,
						"dm_oversight/dm has no actor row on the claim connection",
						8_000,
					);
					const dmActorId = actorIdForBody(dmClaimWorld.db(), dmEntityId as bigint);
					if (dmActorId === null) {
						throw new Error("unreachable: dm_oversight/dm actor row vanished after waitFor");
					}
					await bindActorAsOperator(dmClaimWorld, dmActorId);

					await waitFor(
						() => hasHiddenCapability(dmClaimWorld.db(), guardianId as bigint),
						"the DM never saw the guardian's Hidden capability",
						8_000,
					);
					expect(hasHiddenCapability(dmClaimWorld.db(), guardianId as bigint)).toBe(true);
				} finally {
					dmClaimWorld?.disconnect();
					operatorWorld?.disconnect();
				}
			},
			60_000,
		);
	});

	// -------------------------------------------------------------------
	// authored-dark-cave.md
	// -------------------------------------------------------------------

	// HARNESS GAP (bead sk-e0u.9, see the block comment above `describeLocal`):
	// needs two dedicated operator-bound connections (scout + delver) plus the same
	// pre-existing-body observation gap as dm-oversight above. Skipped even
	// under SPELLKAVE_LOCAL_NODE=1.
	describe.skip("authored-dark-cave", () => {
		let operatorWorld: TestWorld;
		let scoutClaimWorld: TestWorld;
		let delverClaimWorld: TestWorld;

		docEvidence(
			{
				doc: "authored-dark-cave",
				tier: "live-self-seeding",
				claim:
					"the authored darkness predicate rejects a direct inspection attempt by the scout and accepts the same action and passage target for the darkvision-holding delver",
			},
			async () => {
				operatorWorld = await connectExamplePublisher();
				try {
					// Staging uses an upsert so existing role-derived grants survive.
					await applyManifestDelta(
						operatorWorld,
						readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
						{ tolerateAlreadyApplied: true },
					);
					await applyManifestFixture(
						operatorWorld,
						"packages/spellkave-world-author/docs/examples/authored-dark-cave.toml",
						{ tolerateAlreadyApplied: true },
					);
					const scoutId = entityIdByManifestKey(
						operatorWorld.db(),
						"authored_dark_cave:authored_dark_cave/scout",
					);
					const delverId = entityIdByManifestKey(
						operatorWorld.db(),
						"authored_dark_cave:authored_dark_cave/delver",
					);
					expect(scoutId).not.toBeNull();
					expect(delverId).not.toBeNull();

					// Action attempts use the actual actor identity (see the
					// dm-oversight declaration above) —
					// dedicated claim connections instead of a manifest-authored
					// `$sender` row.
					scoutClaimWorld = await connectDedicatedClaimWorld(
						{},
						"world-author-doc-evidence-dark-cave-scout",
					);
					delverClaimWorld = await connectDedicatedClaimWorld(
						{},
						"world-author-doc-evidence-dark-cave-delver",
					);
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
					await bindActorAsOperator(scoutClaimWorld, scoutActorId);
					await bindActorAsOperator(delverClaimWorld, delverActorId);

					// Syntax is not an eligibility assertion. The same authored attempt
					// supplies a negative and positive control against authoritative predicates.
					const actionId = "authored_dark_cave/affordance/inspect_dark_passage";
					const targetNodeId = "authored_dark_cave/dark_passage";
					await expect(
						manipulatePlaceNodeAction(scoutClaimWorld, scoutId as bigint, targetNodeId, actionId),
					).rejects.toThrow();
					await expect(
						manipulatePlaceNodeAction(delverClaimWorld, delverId as bigint, targetNodeId, actionId),
					).resolves.toBeUndefined();
				} finally {
					scoutClaimWorld?.disconnect();
					delverClaimWorld?.disconnect();
					operatorWorld?.disconnect();
				}
			},
			60_000,
		);
	});

	// -------------------------------------------------------------------
	// communicate-with-actor.md — the example authors its own green
	// (`communicate_with_actor/green`) so seeding on top of core no longer
	// dangles on the retired village place.
	// -------------------------------------------------------------------

	describe("communicate-with-actor", () => {
		let world: TestWorld;

		docEvidence(
			{
				doc: "communicate-with-actor",
				tier: "live-self-seeding",
				claim:
					"seeding the committed communicate-with-actor.toml on top of core succeeds and the Village Herald becomes resolvable at communicate_with_actor/green",
			},
			async () => {
				world = await connectExamplePublisher();
				try {
					// Staging uses an upsert so existing role-derived grants survive.
					await applyManifestDelta(
						world,
						readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
						{ tolerateAlreadyApplied: true },
					);
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
				} finally {
					world?.disconnect();
				}
			},
			60_000,
		);
	});

	// -------------------------------------------------------------------
	// spatial-minimal-cell.md
	// -------------------------------------------------------------------

	// HARNESS GAP (bead sk-e0u.9, see the block comment above `describeLocal`):
	// same per-scenario-isolated-DB / operator-identity-read gap as the two
	// scenarios above — this one needs to observe a place_node authored by a
	// manifest apply from a connection with no actor of its own. Skipped even
	// under SPELLKAVE_LOCAL_NODE=1.
	describe.skip("spatial-minimal-cell", () => {
		let world: TestWorld;

		docEvidence(
			{
				doc: "spatial-minimal-cell",
				tier: "live-self-seeding",
				claim:
					"the place_node authored by spatial-minimal-cell.toml lands and is observable, with zero outgoing edges (a disconnected single-cell topology by design — the example authors no place_edges rows)",
			},
			async () => {
				world = await connectExamplePublisher();
				try {
					// Staging uses an upsert so existing role-derived grants survive.
					await applyManifestDelta(
						world,
						readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
						{ tolerateAlreadyApplied: true },
					);
					await applyManifestFixture(
						world,
						"packages/spellkave-world-author/docs/examples/spatial-minimal-cell.toml",
						{ tolerateAlreadyApplied: true },
					);
					const NODE_ID = "example_spatial_cell/cell_a";
					const db = world.db() as unknown as Record<
						string,
						{ iter(): Iterable<Record<string, unknown>> } | undefined
					>;
					// Dual accessor name (camelCase generated binding, snake_case
					// fallback) — matches every other raw table read in this file
					// (test-lab's own `table()` helper does the same).
					const nodes = () => db.visiblePlaceNode ?? db.visible_place_node;
					const edges = () => db.visiblePlaceEdge ?? db.visible_place_edge;
					await waitFor(
						() =>
							[...(nodes()?.iter() ?? [])].some(
								(row) => String(row.nodeId ?? row.node_id) === NODE_ID,
							),
						"example_spatial_cell/cell_a never appeared in place_node",
						8_000,
					);
					const outgoingEdges = [...(edges()?.iter() ?? [])].filter(
						(row) => String(row.fromNodeId ?? row.from_node_id) === NODE_ID,
					);
					expect(outgoingEdges).toHaveLength(0);
				} finally {
					world?.disconnect();
				}
			},
			60_000,
		);
	});
});
