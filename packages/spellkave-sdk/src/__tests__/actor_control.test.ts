// Unit tests for actor_control that require mocking (cannot be reproduced live).
//
// "unobserved_no_provenance" cases: reducer fires but subscription state does not change.
// "rejected" cases: reducer throws (simulating server-side structured rejection).
// "manipulate" cases: cover the new generic manipulation verb.
//
// Happy-path move() and live-rejection cases live in
// packages/spellkave-test-lab/src/__tests__/sdk/local_node.test.ts.
import { describe, expect, it } from "vitest";
import type { SnapshotDb } from "../connection";
import {
	createActorClient,
	DEFAULT_OBSERVATION_TIMEOUT_MS,
	resolveObservationTimeoutMs,
} from "../core/actor_control";
import { TickIntervalEstimator } from "../core/tick_cadence";

interface FakeRow {
	[k: string]: unknown;
}

type MutableRows = FakeRow[];

function table(rows: MutableRows): { iter: () => Iterable<FakeRow> } {
	return { iter: () => rows };
}

function makeDb(parts: Record<string, MutableRows>): SnapshotDb {
	const db: SnapshotDb = {
		visible_entity_tag: table([]),
		visible_entity_tag_coverage: table([{ status: "complete", projectionVersion: 1 }]),
	};
	for (const [accessor, rows] of Object.entries(parts)) {
		db[accessor] = table(rows);
	}
	return db;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── move() unobserved ────────────────────────────────────────────────────────

describe("createActorClient — move() unobserved (mocked, cannot be reproduced live)", () => {
	it("returns unobserved when reducer returns without observed movement", async () => {
		const actorRow = {
			entityId: 1n,
			placeNodeId: "tavern",
		};
		const db = makeDb({
			visible_actor_spatial_location: [actorRow],
			visible_place_node: [{ nodeId: "tavern" }, { nodeId: "hall" }],
			visible_place_edge: [
				{
					edgeId: "1",
					fromNodeId: "tavern",
					toNodeId: "hall",
				},
			],
		});

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 120,
			observationPollMs: 20,
			rMove: async () => {
				// No-op intentionally: simulates reducer that fires but does not move actor.
				await wait(10);
			},
		});

		const out = await actor.move("1");
		expect(out.status).toBe("unobservable");
		expect(out.actor_snapshot?.current_node_id).toBe("tavern");
		if (out.status === "unobservable") {
			expect(out.reason).toContain("did not reach 'hall'");
		}
	});
});

// ── move() strict actor model ─────────────────────────────────────────────────

describe("createActorClient — move() strict actor model (mocked)", () => {
	it("fails closed before reducer for an unresolved actor", async () => {
		const db = makeDb({
			visible_actor_spatial_location: [],
			visible_place_node: [],
			visible_place_edge: [],
		});

		let reducerCalled = false;
		const actor = createActorClient(db, "ghost-actor", {
			observationTimeoutMs: 80,
			observationPollMs: 20,
			rMove: async () => {
				reducerCalled = true;
				await wait(10);
			},
		});

		expect(() => actor.move("any-edge")).toThrow("not found in live actor_spatial_location");
		expect(reducerCalled).toBe(false);
	});

	it("passes through to reducer even for non-adjacent edge (server-authoritative)", async () => {
		const actorRow = { entityId: 1n, placeNodeId: "tavern" };
		const db = makeDb({
			visible_actor_spatial_location: [actorRow],
			visible_place_node: [{ nodeId: "tavern" }, { nodeId: "hall" }, { nodeId: "vault" }],
			visible_place_edge: [
				{ edgeId: "1", fromNodeId: "tavern", toNodeId: "hall" },
				{ edgeId: "2", fromNodeId: "hall", toNodeId: "vault" },
			],
		});

		let reducerCalled = false;
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 80,
			observationPollMs: 20,
			rMove: async () => {
				reducerCalled = true;
				await wait(10);
			},
		});

		// edge "2" is not adjacent to tavern — under strict model, still calls reducer
		const out = await actor.move("2");
		expect(reducerCalled).toBe(true);
		expect(out.status).toBe("unobservable");
	});

	it("returns rejected when reducer throws", async () => {
		const actorRow = { entityId: 1n, placeNodeId: "tavern" };
		const db = makeDb({
			visible_actor_spatial_location: [actorRow],
			visible_place_node: [{ nodeId: "tavern" }, { nodeId: "hall" }],
			visible_place_edge: [{ edgeId: "1", fromNodeId: "tavern", toNodeId: "hall" }],
		});

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 80,
			observationPollMs: 20,
			rMove: async () => {
				throw new Error("server rejected move");
			},
		});

		const out = await actor.move("1");
		expect(out.status).toBe("rejected");
	});
});

// ── manipulate() ──────────────────────────────────────────────────────────────

describe("createActorClient — manipulate() (mocked)", () => {
	it("refuses enrollment against an older contract before any RPC", async () => {
		let called = false;
		const actor = createActorClient(
			makeDb({ visible_actor_spatial_location: [{ entityId: 1n }] }),
			"1",
			{
				rManipulate: async () => {
					called = true;
				},
			},
		);
		await expect(
			actor.manipulate(
				"place_node:lab/room",
				"lab/open",
				'{"participant_entity_ids":["2"]}',
				() => true,
				() => null,
			),
		).rejects.toThrow("module does not support participant_entity_ids");
		expect(called).toBe(false);
	});
	it("returns uncertainty when snapshot-only host cannot attribute the changed state", async () => {
		let itemInInventory = false;
		const db = makeDb({ visible_actor_spatial_location: [{ entityId: 1n }] });

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 500,
			observationPollMs: 20,
			rManipulate: async () => {
				await wait(10);
				itemInInventory = true;
			},
		});

		const out = await actor.manipulate(
			"entity:2",
			"core/pickup",
			"{}",
			() => itemInInventory,
			() => ({ pickedUp: true }),
		);

		expect(itemInInventory).toBe(true);
		expect(out).toMatchObject({
			status: "unobservable",
			snapshot: { pickedUp: true },
			actor_id: "1",
			target_id: "entity:2",
			action_id: "core/pickup",
		});
	});

	it("returns rejected when reducer throws (server-side failure)", async () => {
		const db = makeDb({ visible_actor_spatial_location: [{ entityId: 1n }] });

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 200,
			observationPollMs: 20,
			rManipulate: async () => {
				throw new Error("predicate_rejected: no affordance");
			},
		});

		const out = await actor.manipulate(
			"entity:404",
			"core/pickup",
			"{}",
			() => false,
			() => null,
		);

		expect(out.status).toBe("rejected");
		if (out.status === "rejected") {
			expect(out.reason).toContain("rejected");
		}
	});

	it("returns rejected when reducer throws for unknown target", async () => {
		const db = makeDb({ visible_actor_spatial_location: [{ entityId: 1n }] });

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 200,
			observationPollMs: 20,
			rManipulate: async () => {
				throw new Error("stale_target: target not found");
			},
		});

		const out = await actor.manipulate(
			"entity:404",
			"core/pickup",
			"{}",
			() => false,
			() => null,
		);

		expect(out.status).toBe("rejected");
	});

	it("returns rejected when reducer throws for bad args_json", async () => {
		const db = makeDb({ visible_actor_spatial_location: [{ entityId: 1n }] });

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 200,
			observationPollMs: 20,
			rManipulate: async () => {
				throw new Error("invalid_args: invalid args_json");
			},
		});

		const out = await actor.manipulate(
			"entity:2",
			"core/pickup",
			"not-valid-json",
			() => false,
			() => null,
		);

		expect(out.status).toBe("rejected");
	});

	it("returns unobserved when reducer fires but successPredicate never satisfies", async () => {
		const db = makeDb({ visible_actor_spatial_location: [{ entityId: 1n }] });

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 100,
			observationPollMs: 20,
			rManipulate: async () => {
				await wait(10);
				// Reducer fires but world state never updates in subscription.
			},
		});

		const out = await actor.manipulate(
			"entity:2",
			"core/pickup",
			"{}",
			() => false,
			() => null,
		);

		expect(out.status).toBe("unobservable");
		if (out.status === "unobservable") {
			expect(out.reason).toContain("core/pickup");
		}
	});
});

// ── session close / move ─────────────────────────────────────────────────────

describe("createActorClient — sessionClose() (mocked)", () => {
	it("returns success when the session lifecycle reaches the requested outcome", async () => {
		const sessionRow = { sessionId: 7n, lifecycle: "active", lastAdvancedAt: 10n };
		const db = makeDb({
			world_time: [{ tick: 11n }],
			visible_actor_spatial_location: [{ entityId: 1n }],
			session: [sessionRow],
		});

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 500,
			observationPollMs: 20,
			rSessionClose: async (args) => {
				expect(args).toEqual({ sessionId: 7n, outcome: "completed" });
				await wait(10);
				sessionRow.lifecycle = "completed";
				sessionRow.lastAdvancedAt = 11n;
			},
		});

		const out = await actor.sessionClose(7n, "completed");
		expect(out.status).toBe("success");
		expect(out.session?.lifecycle).toBe("completed");
	});
});

describe("createActorClient — immutable multi-Service close observations", () => {
	it("carries the original deciding-body and participant observations without refreshing them", async () => {
		const sessionRow = { sessionId: 7n, lifecycle: "active", lastAdvancedAt: 10n };
		const db = makeDb({
			world_time: [{ tick: 11n }],
			visible_actor_spatial_location: [{ entityId: 1n }],
			session: [sessionRow],
		});
		const original = { worldInstanceId: "world", actorId: 1n, bodyEntityId: 1n, generation: 2n };
		const other = { ...original, actorId: 2n, bodyEntityId: 2n, generation: 4n };
		let dispatched:
			| { driverToken?: typeof original; driverTokens?: (typeof original)[] }
			| undefined;
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 500,
			observationPollMs: 20,
			driverToken: original,
			rSessionClose: async (args) => {
				dispatched = args;
				await wait(10);
				sessionRow.lifecycle = "completed";
			},
		});
		const pending = actor.sessionClose(7n, "completed", [original, other]);
		original.generation = 3n;
		other.generation = 5n;
		expect((await pending).status).toBe("success");
		expect(dispatched?.driverToken?.generation).toBe(2n);
		expect(dispatched?.driverTokens?.map((token) => token.generation)).toEqual([2n, 4n]);
	});
});

describe("createActorClient — endTurn() (mocked)", () => {
	function activeSession(currentActor: string) {
		return {
			sessionId: 7n,
			sessionDefId: "core/combat",
			lifecycle: "active",
			currentActor,
			lastAdvancedAt: 10n,
		};
	}

	it("resolves its participant session and advances only on its turn", async () => {
		const session = activeSession("1");
		let calls = 0;
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			session: [session],
			session_participant: [{ sessionId: 7n, actorId: "1", ordinal: 0, joinedAt: 1n }],
		});
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 100,
			observationPollMs: 5,
			rAdvanceTurn: async ({ sessionId }) => {
				expect(sessionId).toBe(7n);
				calls += 1;
				session.currentActor = "2";
				session.lastAdvancedAt = 11n;
			},
		});

		expect(await actor.endTurn()).toEqual({ status: "success", sessionId: 7n });
		expect(calls).toBe(1);
	});

	it("observes an advance that terminates the session on a hand-back (ADR-0143)", async () => {
		// The caller is the only eligible participant: the kernel hands it its
		// own turn back in the same tick and the termination predicate closes
		// the session. currentActor and lastAdvancedAt stay the same.
		const session = activeSession("1");
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			session: [session],
			session_participant: [{ sessionId: 7n, actorId: "1", ordinal: 0, joinedAt: 1n }],
		});
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 100,
			observationPollMs: 5,
			rAdvanceTurn: async () => {
				session.lifecycle = "completed";
			},
		});

		expect(await actor.endTurn()).toEqual({ status: "success", sessionId: 7n });
	});

	it("observes a same-tick hand-back through the session-scoped turn counter (ADR-0143)", async () => {
		const session = activeSession("1");
		const turnState = { id: 0, turn: 5n, currentActor: 1n, scopeSessionId: 7n };
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			session: [session],
			session_participant: [{ sessionId: 7n, actorId: "1", ordinal: 0, joinedAt: 1n }],
			turn_state: [turnState],
		});
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 100,
			observationPollMs: 5,
			rAdvanceTurn: async () => {
				turnState.turn = 6n;
			},
		});

		expect(await actor.endTurn()).toEqual({ status: "success", sessionId: 7n });
	});

	it("emits reducer-attempt telemetry for end-turn", async () => {
		const session = activeSession("1");
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			session: [session],
			session_participant: [{ sessionId: 7n, actorId: "1", ordinal: 0, joinedAt: 1n }],
		});
		const starts: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
		const events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 100,
			observationPollMs: 5,
			reducerAttemptTelemetry: {
				startSpan: (name, attributes) => {
					starts.push({ name, attributes });
					return {
						addEvent: (eventName, eventAttributes) =>
							events.push({ name: eventName, attributes: eventAttributes }),
						end: () => {},
					};
				},
			},
			rAdvanceTurn: async () => {
				session.lastAdvancedAt = 11n;
			},
		});

		expect(await actor.endTurn()).toEqual({ status: "success", sessionId: 7n });
		expect(starts).toEqual([
			{
				name: "spellkave.reducer_attempt",
				attributes: expect.objectContaining({
					"spellkave.reducer": "r_advance_turn",
					"spellkave.actor_id": "1",
				}),
			},
		]);
		expect(events).toContainEqual({
			name: "classified",
			attributes: expect.objectContaining({ "spellkave.result_status": "success" }),
		});
	});

	it("rejects off-turn and no-session calls before the reducer", async () => {
		let calls = 0;
		const offTurn = createActorClient(
			makeDb({
				visible_actor_spatial_location: [{ entityId: 1n }],
				session: [activeSession("2")],
				session_participant: [{ sessionId: 7n, actorId: "1", ordinal: 0, joinedAt: 1n }],
			}),
			"1",
			{
				rAdvanceTurn: async () => {
					calls += 1;
				},
			},
		);
		expect(await offTurn.endTurn()).toMatchObject({ status: "rejected", reason: "not your turn" });

		const noSession = createActorClient(
			makeDb({
				visible_actor_spatial_location: [{ entityId: 1n }],
				session: [],
				session_participant: [],
			}),
			"1",
			{
				rAdvanceTurn: async () => {
					calls += 1;
				},
			},
		);
		expect(await noSession.endTurn()).toMatchObject({
			status: "rejected",
			reason: "no active participant session",
		});
		expect(calls).toBe(0);
	});

	it("does not treat DM see-as visibility as participation or control", async () => {
		let called = false;
		const dm = createActorClient(
			makeDb({
				visible_actor_spatial_location: [{ entityId: 99n }, { entityId: 1n }],
				session: [activeSession("1")],
				session_participant: [{ sessionId: 7n, actorId: "1", ordinal: 0, joinedAt: 1n }],
			}),
			"99",
			{
				rAdvanceTurn: async () => {
					called = true;
				},
			},
		);
		expect(await dm.endTurn()).toMatchObject({
			status: "rejected",
			reason: "no active participant session",
		});
		expect(called).toBe(false);
	});
});

describe("createActorClient — sessionMove() (mocked)", () => {
	it("returns success when the session advancement is observed", async () => {
		const sessionRow = { sessionId: 9n, lifecycle: "active", lastAdvancedAt: 20n };
		const db = makeDb({
			world_time: [{ tick: 21n }],
			visible_actor_spatial_location: [{ entityId: 1n }],
			session: [sessionRow],
		});

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 500,
			observationPollMs: 20,
			rSessionMove: async (args) => {
				expect(args).toEqual({ sessionId: 9n, moveTemplateId: "core/session/advance" });
				await wait(10);
				sessionRow.lastAdvancedAt = 21n;
			},
		});

		const out = await actor.sessionMove(9n, "core/session/advance");
		expect(out.status).toBe("success");
		expect(out.session?.lastAdvancedAt).toBe(21n);
	});
});

// sk-0m4.73: `resolveObservationTimeoutMs` was factored out of
// `createActorClient`'s inline timeout computation so an external caller
// (the companion-agent `communicate` reply window default, via the session
// daemon) can reuse the EXACT SAME default a fresh `ActorClient` would
// compute, instead of re-deriving or hard-coding it. A cold estimator is
// unknown (not a 200ms world); an authored tick interval from config
// scales the same 2x formula as a measured cadence.
describe("resolveObservationTimeoutMs", () => {
	it("falls back to DEFAULT_OBSERVATION_TIMEOUT_MS with no estimator and no override", () => {
		expect(resolveObservationTimeoutMs()).toBe(DEFAULT_OBSERVATION_TIMEOUT_MS);
	});

	it("an explicit override always wins, clamped to a minimum of 1ms", () => {
		expect(resolveObservationTimeoutMs(undefined, 750)).toBe(750);
		expect(resolveObservationTimeoutMs(undefined, -5)).toBe(1);
	});

	it("a cold estimator is treated as unknown (its 200ms floor is worse than no estimator)", () => {
		const estimator = new TickIntervalEstimator();
		estimator.record(1n, 0);
		expect(estimator.hasMeasuredCadence()).toBe(false);
		expect(resolveObservationTimeoutMs(estimator)).toBe(DEFAULT_OBSERVATION_TIMEOUT_MS);
	});

	it("a measured estimator tick-scales (2x estimateMs, floored at 200ms)", () => {
		const estimator = new TickIntervalEstimator();
		for (let i = 0; i <= 5; i++) estimator.record(BigInt(i), i * 80);
		expect(estimator.hasMeasuredCadence()).toBe(true);
		expect(resolveObservationTimeoutMs(estimator)).toBe(200);
	});

	it("an authored tick interval beats a cold estimator (2x the published cadence)", () => {
		const estimator = new TickIntervalEstimator();
		estimator.record(1n, 0);
		expect(resolveObservationTimeoutMs(estimator, undefined, 2_000)).toBe(4_000);
	});

	it("an override still wins over a supplied estimator", () => {
		const estimator = new TickIntervalEstimator();
		expect(resolveObservationTimeoutMs(estimator, 900)).toBe(900);
	});
});

describe("exact owned placeless body resolution", () => {
	it("dispatches for the owned body but cannot attribute a snapshot-only receipt", async () => {
		let acted = false;
		const db = makeDb({
			actor: [{ actorId: 5n, currentBody: 9n }],
			visible_actor_identity: [{ actorId: 5n, identity: "caller", role: "presence" }],
		});
		const client = createActorClient(db, "entity:9", {
			rManipulate: async (args) => {
				expect(args.actorId).toBe(9n);
				acted = true;
			},
		});
		expect(
			(
				await client.manipulate(
					"place_node:forest",
					"core/act/plant",
					"{}",
					() => acted,
					() => null,
				)
			).status,
		).toBe("unobservable");
		expect(acted).toBe(true);
		expect(() => client.move("edge")).toThrow(/not found/);
	});
	it("releases a claim from the owned placeless body using observed provenance", async () => {
		const rows: MutableRows = [];
		const db = makeDb({
			actor: [{ actorId: 5n, currentBody: 9n }],
			visible_actor_identity: [{ actorId: 5n, identity: "caller", role: "presence" }],
			visible_evaluation_provenance: rows,
			world_time: [{ tick: 66n }],
		});
		let calls = 0;
		const client = createActorClient(db, "entity:9", {
			observationTimeoutMs: 100,
			observationPollMs: 1,
			rReleaseClaim: async (args) => {
				expect(args).toEqual({ actorId: "9", targetId: "entity:12" });
				calls++;
				rows.push({
					provenanceId: "claim_released:66:1",
					kind: "Arbitration",
					status: "Succeeded",
					subjectId: "9",
					createdAtTick: 66n,
					failureKind: "",
					failureDetail: "",
					selectedTemplateIds: ["claim_released:target:12", "release_reason:explicit"],
					bundleId: "runtime",
				});
			},
		});
		expect((await client.releaseClaim("entity:12")).status).toBe("success");
		expect(calls).toBe(1);
	});

	it("does not dispatch claim release for a placeless foreign body", () => {
		let calls = 0;
		const db = makeDb({ actor: [{ actorId: 5n, currentBody: 9n }], visible_actor_identity: [] });
		const client = createActorClient(db, "entity:9", {
			rReleaseClaim: async () => {
				calls++;
			},
		});
		expect(() => client.releaseClaim("entity:12")).toThrow(/not found/);
		expect(calls).toBe(0);
	});
	it("does not infer control of a placeless foreign body", () => {
		const db = makeDb({ actor: [{ actorId: 5n, currentBody: 9n }], visible_actor_identity: [] });
		const client = createActorClient(db, "entity:9");
		expect(() =>
			client.manipulate(
				"place_node:forest",
				"core/act/plant",
				"{}",
				() => true,
				() => null,
			),
		).toThrow(/not found/);
	});
});
