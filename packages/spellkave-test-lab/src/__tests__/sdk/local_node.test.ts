import {
	asEntityRef,
	connect,
	createActorClient,
	readActorSnapshot,
	readLocationSnapshot,
	readRecentEvents,
	readWorldStatus,
	snapshot,
	suggestNextAction,
} from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { simpleGraph } from "./helpers/manifest";
import { Scenario } from "./helpers/scenario";

const describeLocal = process.env.SPELLKAVE_LOCAL_NODE === "1" ? describe : describe.skip;

// ── Seeded-fixture tests ──────────────────────────────────────────────────────
// These tests consume the canonical `core/*` graph plus `core-baseline`
// (#1968: core ships no place nodes / connectable actor of its own — see
// packages/spellkave-mechanics/fixtures-baseline).

describeLocal("SDK live local-node integration — seeded fixture", () => {
	let s: Scenario;

	beforeAll(async () => {
		s = await Scenario.create("seeded");
		await s.applyCoreFixture();
		await s.applyCoreBaselineFixture();
	}, 15_000);

	afterAll(async () => {
		await s.dispose();
	});

	it("moves seeded actor via ActorClient and observes a public r_move transition", async () => {
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		await s.placeActor(actorId, "core_baseline_outdoor/plaza");
		await s.waitForActorAt(actorId, "core_baseline_outdoor/plaza", 6_000);

		const client = createActorClient(s.session, actorId, {
			observationTimeoutMs: 4_000,
			observationPollMs: 40,
		});

		const move = client.adjacentMoves().find((entry) => entry.to_node === "core_baseline/interior");
		expect(move).not.toBeUndefined();
		if (move === undefined) return;

		const result = await client.move(move.edge_id);
		expect(result.status).toBe("success");
		expect(result.to_node).toBe("core_baseline/interior");
		expect(result.actor_snapshot?.current_node_id).toBe("core_baseline/interior");
	}, 12_000);

	it("fails closed before dispatch for an unknown actor", async () => {
		const unknownId = s.freshActorId();

		const client = createActorClient(s.session, unknownId, {
			observationTimeoutMs: 2_000,
			observationPollMs: 40,
		});

		expect(() => client.move("any-edge")).toThrow(
			`actor '${unknownId}' not found in live actor_spatial_location`,
		);
	}, 8_000);

	it("routes non-adjacent edge move to reducer (server-authoritative under strict actor model)", async () => {
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		await s.placeActor(actorId, "core_baseline_outdoor/market");
		await s.waitForActorAt(actorId, "core_baseline_outdoor/market", 6_000);

		const allEdges = Array.from(snapshot(s.session.conn).movement.edges());
		// The actor is at market, while this directed edge starts at plaza.
		// Its destination differs from the actor's current node, avoiding a
		// false success from the wrapper's already-at-destination predicate.
		const nonAdjEdge = allEdges.find((e) => {
			const from = String(e.from_node_id ?? "");
			const to = String(e.to_node_id ?? "");
			return from === "core_baseline_outdoor/plaza" && to === "core_baseline/interior";
		});
		expect(nonAdjEdge).not.toBeUndefined();
		if (!nonAdjEdge) return;

		const client = createActorClient(s.session, actorId, {
			observationTimeoutMs: 2_000,
			observationPollMs: 40,
		});

		// SDK passes non-adjacent edge to reducer; server is authoritative
		const edgeId = String(nonAdjEdge.edge_id ?? "");
		expect(edgeId).not.toBe("");
		const result = await client.move(edgeId);
		expect([
			"rejected",
			"unobserved_timeout",
			"unobserved_no_provenance",
			"unobservable",
		]).toContain(result.status);
		expect(result.actor_id).toBe(actorId);
	}, 10_000);
});

// ── Synthetic-graph tests ─────────────────────────────────────────────────────
// These tests build their own namespaced graphs via simpleGraph() + applyManifest().
// Graph ids are namespaced under the scenario's bundleId for dirty-DB safety;
// the actor intentionally comes from the shared core-baseline fixture.

describeLocal("SDK live local-node integration — synthetic graph", () => {
	let s: Scenario;

	beforeAll(async () => {
		s = await Scenario.create("synthetic");
		// #1968: the actor used below (`core_baseline/player`) needs core +
		// core-baseline applied — don't rely on file-order coupling with an
		// earlier describe block seeding the same dirty DB.
		await s.applyCoreFixture();
		await s.applyCoreBaselineFixture();
		const toml = simpleGraph({
			bundleId: s.bundleId,
			nodes: [
				{ id: s.nodeId("a"), name: "SDK live test A" },
				{ id: s.nodeId("b"), name: "SDK live test B" },
			],
			edges: [{ key: s.edgeKey("a-b"), from: s.nodeId("a"), to: s.nodeId("b") }],
		});
		await s.applyManifest(toml);
	}, 15_000);

	afterAll(async () => {
		await s.dispose();
	});

	it("connects to a local node and reads live status/events/snapshots", async () => {
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		const nodeA = s.nodeId("a");
		const nodeB = s.nodeId("b");

		await s.placeActor(actorId, nodeA);
		await s.manualTick();

		await s.waitForActorAt(actorId, nodeA, 4_000);

		const db = s.session.conn.db as unknown as import("@spellkave/sdk").SnapshotDb;

		const worldEvents = readRecentEvents(db, 1);
		// Wait for events to propagate if not yet available
		if (worldEvents.length === 0) {
			await new Promise((resolve) => setTimeout(resolve, 200));
		}

		const status = readWorldStatus(db);
		expect(status).not.toBeNull();
		expect(status?.worldName).toBe("Spellkave");
		expect(status?.tick).toBeGreaterThanOrEqual(1);

		const events = readRecentEvents(db, 5);
		expect(events.length).toBeGreaterThan(0);
		const firstEvent = events[0];
		expect(firstEvent?.tick).toBeGreaterThanOrEqual(1);

		const actor = readActorSnapshot(db, asEntityRef(actorId));
		expect(actor).toMatchObject({
			actor_id: actorId,
			current_node_id: nodeA,
		});

		const location = readLocationSnapshot(db, nodeA);
		expect(location?.actors_here).toContain(actorId);
		expect(location?.outgoing_edges).toEqual(
			expect.arrayContaining([expect.objectContaining({ to_node_id: nodeB })]),
		);

		const suggestion = suggestNextAction(db, asEntityRef(actorId));
		if (suggestion?.kind === "move") {
			expect(suggestion).toMatchObject({ to_node_id: nodeB });
		} else {
			expect(suggestion).toMatchObject({ kind: "affordance" });
		}

		const movement = snapshot(s.session.conn).movement;
		expect(Array.from(movement.nodes()).map((n) => n.node_id)).toContain(nodeA);
	}, 10_000);
});

// ── manipulate() live tests ───────────────────────────────────────────────────
// Exercises core/pickup affordance against a real node. #1968: core ships no
// grounded item instances or connectable actor of its own — core-baseline's
// `core_baseline/player` has core/pickup capability, `core_baseline/sword`
// (referencing core's `core/item/sword` type vocabulary) is grounded at
// `core_baseline_outdoor/plaza`.

describeLocal("SDK live local-node integration — manipulate()", () => {
	let s: Scenario;

	beforeAll(async () => {
		s = await Scenario.create("manipulate");
		await s.applyCoreFixture();
		await s.applyCoreBaselineFixture();
	}, 15_000);

	afterAll(async () => {
		await s.dispose();
	});

	it("actorClient.manipulate picks up sword into core_baseline/player inventory", async () => {
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		await s.placeActor(actorId, "core_baseline_outdoor/plaza");
		await s.waitForActorAt(actorId, "core_baseline_outdoor/plaza", 6_000);

		const swordItemId = s.authoredItemId("core_baseline:core_baseline/sword");

		const client = createActorClient(s.session, actorId, {
			observationTimeoutMs: 4_000,
			observationPollMs: 40,
		});

		const result = await client.manipulate(
			`item:${swordItemId}`,
			"core/pickup",
			"{}",
			(liveDb) => {
				const handle = liveDb.visibleEntityContainment ?? liveDb.visible_entity_containment;
				if (!handle) return false;
				for (const row of handle.iter() as Iterable<Record<string, unknown>>) {
					const entityId = String(row.entityId ?? row.entity_id ?? "");
					if (entityId === swordItemId) return true;
				}
				return false;
			},
			(liveDb) => {
				const handle = liveDb.visibleEntityContainment ?? liveDb.visible_entity_containment;
				if (!handle) return null;
				const items: string[] = [];
				for (const row of handle.iter() as Iterable<Record<string, unknown>>) {
					items.push(String(row.entityId ?? row.entity_id ?? ""));
				}
				return { inventoryItems: items };
			},
		);

		expect(result.status).toBe("success");
		const snap = result.snapshot as { inventoryItems: string[] };
		expect(snap.inventoryItems).toContain(swordItemId);
	}, 15_000);

	it("actorClient.manipulate returns rejected for item at wrong location", async () => {
		// Actor at plaza; torch is at market, so it is unreachable.
		const actorId = s.authoredEntityId("core_baseline:core_baseline/player");
		await s.placeActor(actorId, "core_baseline_outdoor/plaza");
		await s.waitForActorAt(actorId, "core_baseline_outdoor/plaza", 6_000);
		const torchItemId = s.authoredItemId("core_baseline:core_baseline/torch");

		const client = createActorClient(s.session, actorId, {
			observationTimeoutMs: 2_000,
			observationPollMs: 40,
		});

		const result = await client.manipulate(
			`item:${torchItemId}`,
			"core/pickup",
			"{}",
			() => false,
			() => null,
		);

		// Server rejects because the torch is not co-located with the actor.
		expect([
			"rejected",
			"unobserved_timeout",
			"unobserved_no_provenance",
			"unobservable",
		]).toContain(result.status);
	}, 10_000);
});

// ── Tick estimator integration ────────────────────────────────────────────────

const URL = process.env.SPELLKAVE_URL ?? "http://127.0.0.1:3000";
const DB = process.env.SPELLKAVE_DB ?? "spellkave-dev";

describeLocal("SDK tick estimator — live node", () => {
	it("observes explicit manual ticks and produces a positive estimate", async () => {
		const session = await connect(
			{ url: URL, db: DB, token: undefined, connectedActorId: "core_baseline/player" },
			{ onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} },
		);
		await session.ready;

		const token = resolveSpacetimeConfigPathToken();
		if (!token) throw new Error("local tick producer requires the publisher credential");
		const producer = await connect(
			{ url: URL, db: DB, token, connectedActorId: "tick-estimator-producer" },
			{ onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} },
		);
		await producer.ready;

		// Before 5 ticks have been fed, floor applies.
		expect(session.estimator.estimateMs()).toBe(200);

		// The local recipe leaves the automatic scheduler paused. Drive the six
		// observed ticks explicitly so this proves the subscription hook rather
		// than waiting for an unavailable timer.
		const observed = new Promise<void>((resolve) => {
			let count = 0;
			const origRecord = session.estimator.record.bind(session.estimator);
			session.estimator.record = (tick, ms) => {
				origRecord(tick, ms);
				count++;
				if (count >= 6) resolve();
			};
		});
		for (let tick = 0; tick < 6; tick += 1) {
			await (
				producer.conn.reducers as { manualTick(args: Record<string, never>): Promise<void> }
			).manualTick({});
		}
		await observed;

		const estimate = session.estimator.estimateMs();
		// Explicit ticks prove subscription observation without depending on wall-clock cadence.
		expect(estimate).toBeGreaterThan(0);
		// currentWorldTick returns a positive bigint after ticks have applied.
		expect(session.currentWorldTick()).toBeGreaterThan(0n);

		producer.disconnect();
		session.disconnect();
	}, 30_000);
});

// ── Acceptance scenario A — r_session_open SDK-helper reducer ────────────────
// Spec: D1 SDK-helper bucket. Proves:
//   (a) call dispatches through core/reducers/r_session_open (import-path assertion)
//   (b) result carries lagWarning + observedAtTick fields from the typed wrapper
//   (c) status is server-authoritative (rejected when no session_definition exists)

describeLocal("Acceptance scenario A — r_session_open SDK-helper reducer", () => {
	let s: Scenario;

	beforeAll(async () => {
		s = await Scenario.create("session-open-a");
		await s.applyCoreFixture();
	}, 15_000);

	afterAll(async () => {
		await s.dispose();
	});

	it("ActorClient.sessionOpen dispatches through r_session_open wrapper and returns typed result", async () => {
		const client = createActorClient(s.session, "core_baseline/player", {
			observationTimeoutMs: 3_000,
			observationPollMs: 40,
		});

		// No session_definition exists in fixture — server will reject.
		// The test proves: call goes through the typed wrapper and result
		// has lagWarning + observedAtTick (D7 fields). Status is
		// server-authoritative (rejected or unobserved — not a client-side throw).
		const result = await client.sessionOpen("nonexistent-session-def");

		// D1 wrapper contract: result always has lagWarning + observedAtTick.
		expect(typeof result.lagWarning).toBe("boolean");
		expect(typeof result.observedAtTick).toBe("bigint");

		// Server-authoritative verdict.
		expect([
			"rejected",
			"unobserved_timeout",
			"unobserved_no_provenance",
			"unobservable",
		]).toContain(result.status);
		expect(result.sessionDefId).toBe("nonexistent-session-def");
	}, 10_000);
});
