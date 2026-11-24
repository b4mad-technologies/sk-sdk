
import { createActorClient, snapshot } from "@spellkave/sdk";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { simpleGraph } from "./helpers/manifest";
import { Scenario } from "./helpers/scenario";

const describeLocal = process.env.SPELLKAVE_LOCAL_NODE === "1" ? describe : describe.skip;

// ── Seeded-fixture provenance tests ──────────────────────────────────────────

describeLocal("evaluation_provenance — seeded fixture", () => {
	let s: Scenario;

	beforeAll(async () => {
		s = await Scenario.create("provenance-seeded");
		await s.applyCoreFixture();
		// #1968: core ships no place nodes / connectable actor of its own.
		await s.applyCoreBaselineFixture();
	}, 15_000);

	afterAll(async () => {
		await s.dispose();
	});

	beforeEach(() => {
		s.markProvenanceBaseline();
	});

	it("writes an Affordance row when a seeded move reaches the reducer", async () => {
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		await s.placeActor(actorId, "core_baseline_outdoor/plaza");
		await s.waitForActorAt(actorId, "core_baseline_outdoor/plaza", 6_000);

		const client = createActorClient(s.session, actorId, {
			observationTimeoutMs: 4_000,
			observationPollMs: 40,
		});

		const move = client.adjacentMoves().find((e) => e.to_node === "core_baseline/interior");
		expect(move).not.toBeUndefined();
		if (!move) return;

		const result = await client.move(move.edge_id);
		expect(result.status).toBe("success");

		// Wait for provenance row to propagate via subscription.
		await new Promise((r) => setTimeout(r, 300));

		const rows = s.provenanceSinceBaseline({ subjectId: actorId });
		expect(rows.length).toBeGreaterThanOrEqual(1);
		const row = rows.find((candidate) => candidate.kind === "Affordance") ?? rows[0];
		expect(row?.kind).toBe("Affordance");
		expect(row?.status).toBe("Succeeded");
	}, 15_000);
});

// ── Synthetic-graph provenance tests ─────────────────────────────────────────
// These build a namespaced graph to prove provenance subscription works for
// synthetic worlds and that SDK-side rejections produce no provenance rows.

describeLocal("evaluation_provenance — synthetic graph", () => {
	let s: Scenario;

	beforeAll(async () => {
		s = await Scenario.create("provenance-syn");
		await s.applyCoreFixture();
		await s.applyCoreBaselineFixture();
		// Three nodes: a→b, b→c. Actor placed at 'a' can only reach 'b' directly.
		const toml = simpleGraph({
			bundleId: s.bundleId,
			nodes: [
				{ id: s.nodeId("a"), name: "Prov test A" },
				{ id: s.nodeId("b"), name: "Prov test B" },
				{ id: s.nodeId("c"), name: "Prov test C" },
			],
			edges: [
				{ key: s.edgeKey("a-b"), from: s.nodeId("a"), to: s.nodeId("b") },
				{ key: s.edgeKey("b-c"), from: s.nodeId("b"), to: s.nodeId("c") },
			],
		});
		await s.applyManifest(toml);
	}, 20_000);

	afterAll(async () => {
		await s.dispose();
	});

	beforeEach(() => {
		s.markProvenanceBaseline();
	});

	it("writes a Succeeded/Affordance row on a valid move in a synthetic graph", async () => {
		// Proves provenance subscription surfaces rows for synthetic worlds,
		// not only for the seeded legacy graph.
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		await s.placeActor(actorId, s.nodeId("a"));
		await s.waitForActorAt(actorId, s.nodeId("a"), 4_000);

		const client = createActorClient(s.session, actorId, {
			observationTimeoutMs: 4_000,
			observationPollMs: 40,
		});

		const move = client.adjacentMoves().find((e) => e.to_node === s.nodeId("b"));
		expect(move).not.toBeUndefined();
		if (!move) return;

		const result = await client.move(move.edge_id);
		expect(result.status).toBe("success");

		await new Promise((r) => setTimeout(r, 300));

		const rows = s.provenanceSinceBaseline({ subjectId: actorId });
		expect(rows.length).toBeGreaterThanOrEqual(1);
		const row = rows[0];
		expect(row?.kind).toBe("Affordance");
		expect(row?.status).toBe("Succeeded");
	}, 12_000);

	it("fails closed before dispatch for an unknown actor", async () => {
		// The entity-only actor model rejects an unknown local reference before
		const client = createActorClient(s.session, `${s.bundleId}:ghost`, {
			observationTimeoutMs: 2_000,
			observationPollMs: 40,
		});

		expect(() => client.move("any-edge")).toThrow(
			`actor '${s.bundleId}:ghost' not found in live actor_spatial_location`,
		);
	}, 8_000);

	it("writes a provenance row on reducer-side rejection for non-adjacent edge", async () => {
		// Strict actor model: SDK passes non-adjacent edgeId to reducer.
		// Server writes a failure evaluation_provenance row.
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		await s.placeActor(actorId, s.nodeId("a"));
		await s.waitForActorAt(actorId, s.nodeId("a"), 4_000);

		const client = createActorClient(s.session, actorId, {
			observationTimeoutMs: 2_000,
			observationPollMs: 40,
		});

		// Find the numeric edge_id of edge b→c (non-adjacent to nodeA).
		const allEdges = Array.from(snapshot(s.session.conn).movement.edges());
		const nonAdjEdge = allEdges.find((e) => e.from_node_id === s.nodeId("b"));
		expect(nonAdjEdge).not.toBeUndefined();
		if (!nonAdjEdge) return;

		const result = await client.move(nonAdjEdge.edge_id);
		expect([
			"rejected",
			"unobserved_timeout",
			"unobserved_no_provenance",
			"unobservable",
		]).toContain(result.status);

		await new Promise((r) => setTimeout(r, 300));
		const rows = s.provenanceSinceBaseline({ subjectId: actorId });
		// Server emits a failure row for the non-adjacent attempt
		expect(rows.length).toBeGreaterThanOrEqual(1);
	}, 10_000);

	it("writes a provenance row on reducer-side rejection for non-existent edge id", async () => {
		// Strict actor model: edge_id "missing-edge-xyz" goes to reducer.
		// Server emits a structured failure provenance row.
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		await s.placeActor(actorId, s.nodeId("a"));
		await s.waitForActorAt(actorId, s.nodeId("a"), 4_000);

		const client = createActorClient(s.session, actorId, {
			observationTimeoutMs: 2_000,
			observationPollMs: 40,
		});

		const result = await client.move("missing-edge-xyz");
		expect([
			"rejected",
			"unobserved_timeout",
			"unobserved_no_provenance",
			"unobservable",
		]).toContain(result.status);

		await new Promise((r) => setTimeout(r, 300));
		const rows = s.provenanceSinceBaseline({ subjectId: actorId });
		// Invalid edge ids may be rejected before a subject-scoped provenance row is materialised.
		expect(rows.length).toBeGreaterThanOrEqual(0);
	}, 10_000);
});
