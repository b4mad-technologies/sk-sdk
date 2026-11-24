// Offline SDK-wrapper unit tests for the two actor verbs promoted to full
// ActorClient methods (parity with already-implemented server reducers):
//   - inscribeTrace (#510) — STATE-OBSERVED via the subscribed `visible_trace` view.
//   - react (#509)        — STATE-OBSERVED via the subscribed
//                           `visible_pending_resolution_reactor` view.
//
// Mirrors the SnapshotDb fake pattern in actor_control.test.ts: drive the
// reducer override, mutate the fake subscribed cache, assert the observed verdict.
import { describe, expect, it } from "vitest";
import type { SnapshotDb } from "../connection";
import { createActorClient } from "../core/actor_control";

interface FakeRow {
	[k: string]: unknown;
}
type MutableRows = FakeRow[];

function table(rows: MutableRows): { iter: () => Iterable<FakeRow> } {
	return { iter: () => rows };
}

function makeDb(parts: Record<string, MutableRows>): SnapshotDb {
	const db: SnapshotDb = {};
	for (const [accessor, rows] of Object.entries(parts)) {
		db[accessor] = table(rows);
	}
	return db;
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── inscribeTrace() — state-observed ─────────────────────────────────────────

describe("createActorClient — inscribeTrace() (mocked, state-observed)", () => {
	it("returns success when the trace row appears in the subscribed visible_trace view", async () => {
		const traceRows: MutableRows = [];
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			visible_trace: traceRows,
		});

		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 500,
			observationPollMs: 20,
			rInscribeTrace: async (args) => {
				// Args pass 1:1; inscribed_by is the resolved acting actor.
				expect(args.kind).toBe("scratch");
				expect(args.locationRef).toBe("village/green");
				expect(args.inscribedBy).toBe("1");
				expect(args.expiresAtTick).toBeUndefined();
				await wait(10);
				traceRows.push({
					traceId: 42n,
					kind: "scratch",
					locationRef: "village/green",
					inscribedBy: "1",
				});
			},
		});

		const out = await actor.inscribeTrace(
			"scratch",
			"place_node",
			"village/green",
			"{}",
			{ tag: "Public" },
			"core",
		);

		expect(out.status).toBe("success");
		if (out.status === "success") {
			expect(out.trace_id).toBe(42n);
			expect(out.inscribed_by).toBe("1");
		}
	});

	it("passes expiresAtTick through to the reducer", async () => {
		const traceRows: MutableRows = [];
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			visible_trace: traceRows,
		});

		let seenExpiry: bigint | undefined;
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 500,
			observationPollMs: 20,
			rInscribeTrace: async (args) => {
				seenExpiry = args.expiresAtTick;
				await wait(5);
				traceRows.push({ traceId: 7n, kind: "ward", locationRef: "x", inscribedBy: "1" });
			},
		});

		await actor.inscribeTrace("ward", "place_node", "x", "{}", { tag: "Local" }, "core", 999n);
		expect(seenExpiry).toBe(999n);
	});

	it("returns rejected when the reducer throws", async () => {
		const db = makeDb({ visible_actor_spatial_location: [{ entityId: 1n }], visible_trace: [] });
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 100,
			observationPollMs: 20,
			rInscribeTrace: async () => {
				throw new Error("predicate_rejected: cannot inscribe here");
			},
		});

		const out = await actor.inscribeTrace(
			"scratch",
			"place_node",
			"x",
			"{}",
			{ tag: "Public" },
			"core",
		);
		expect(out.status).toBe("rejected");
	});

	it("returns unobservable when the trace never appears after the reducer returns", async () => {
		const db = makeDb({ visible_actor_spatial_location: [{ entityId: 1n }], visible_trace: [] });
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 80,
			observationPollMs: 20,
			rInscribeTrace: async () => {
				await wait(5); // fires but no row materializes in subscribed state
			},
		});

		const out = await actor.inscribeTrace(
			"scratch",
			"place_node",
			"x",
			"{}",
			{ tag: "Public" },
			"core",
		);
		expect(out.status).toBe("unobservable");
	});
});

// ── react() — state-observed ─────────────────────────────────────────────────

describe("createActorClient — react() (mocked, state-observed)", () => {
	function seat(reacted = false): FakeRow {
		return { rowId: 1n, pendingId: 5n, entityRef: "1", reacted };
	}

	it("returns success when the subscribed seat flips to reacted", async () => {
		const seats: MutableRows = [seat()];
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			visible_pending_resolution_reactor: seats,
		});
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 500,
			observationPollMs: 20,
			rReact: async (args) => {
				expect(args).toEqual({ reactorId: 1n, pendingId: 5n, responseIntent: "aid" });
				await wait(10);
				seats[0] = seat(true);
			},
		});

		const out = await actor.react(5n, "aid");
		expect(out).toMatchObject({
			status: "success",
			actor_id: "1",
			pending_id: 5n,
			response_intent: "aid",
		});
	});

	it("returns success when closing the window removes the subscribed seat", async () => {
		const seats: MutableRows = [seat()];
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			visible_pending_resolution_reactor: seats,
		});
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 500,
			observationPollMs: 20,
			rReact: async () => {
				await wait(10);
				seats.splice(0);
			},
		});

		expect((await actor.react(5n, "aid")).status).toBe("success");
	});

	it("returns rejected when the reducer throws", async () => {
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			visible_pending_resolution_reactor: [seat()],
		});
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 100,
			observationPollMs: 20,
			rReact: async () => {
				throw new Error("r_react: reactor '1' not in eligible set");
			},
		});

		expect((await actor.react(5n, "aid")).status).toBe("rejected");
	});

	it("returns unobservable when an eligible seat never changes", async () => {
		const db = makeDb({
			visible_actor_spatial_location: [{ entityId: 1n }],
			visible_pending_resolution_reactor: [seat()],
		});
		const actor = createActorClient(db, "1", {
			observationTimeoutMs: 80,
			observationPollMs: 20,
			rReact: async () => {
				await wait(5);
			},
		});

		expect((await actor.react(5n, "aid")).status).toBe("unobservable");
	});

	// #2058: post-roll intervention windows carry NO reactor-seat row at all —
	// the eligible responder is `target_actor` on `visible_pending_resolution`
	// itself. Success there is observed as that row disappearing outright.
	describe("no-seat (post-roll intervention window) shape", () => {
		function pendingRow(): FakeRow {
			return { pendingId: 5n, targetActor: "1" };
		}

		it("returns success when the pending_resolution row disappears, with no seat table at all", async () => {
			const pendingRows: MutableRows = [pendingRow()];
			const db = makeDb({
				visible_actor_spatial_location: [{ entityId: 1n }],
				visible_pending_resolution: pendingRows,
			});
			const actor = createActorClient(db, "1", {
				observationTimeoutMs: 500,
				observationPollMs: 20,
				rReact: async (args) => {
					expect(args).toEqual({
						reactorId: 1n,
						pendingId: 5n,
						responseIntent: "DECLINE",
						selectedDrawIndex: undefined,
					});
					await wait(10);
					pendingRows.splice(0);
				},
			});

			const out = await actor.react(5n, "DECLINE");
			expect(out).toMatchObject({
				status: "success",
				actor_id: "1",
				pending_id: 5n,
				response_intent: "DECLINE",
			});
			expect(out).not.toHaveProperty("selected_draw_index");
		});

		it("forwards selectedDrawIndex to the reducer and echoes it on success", async () => {
			const pendingRows: MutableRows = [pendingRow()];
			const db = makeDb({
				visible_actor_spatial_location: [{ entityId: 1n }],
				visible_pending_resolution: pendingRows,
			});
			const actor = createActorClient(db, "1", {
				observationTimeoutMs: 500,
				observationPollMs: 20,
				rReact: async (args) => {
					expect(args).toEqual({
						reactorId: 1n,
						pendingId: 5n,
						responseIntent: "ACCEPT",
						selectedDrawIndex: 0,
					});
					await wait(10);
					pendingRows.splice(0);
				},
			});

			const out = await actor.react(5n, "ACCEPT", 0);
			expect(out).toMatchObject({ status: "success", selected_draw_index: 0 });
		});

		it("returns unobservable when the row never disappears (no seat to fall back on)", async () => {
			const db = makeDb({
				visible_actor_spatial_location: [{ entityId: 1n }],
				visible_pending_resolution: [pendingRow()],
			});
			const actor = createActorClient(db, "1", {
				observationTimeoutMs: 80,
				observationPollMs: 20,
				rReact: async () => {
					await wait(5);
				},
			});

			expect((await actor.react(5n, "DECLINE")).status).toBe("unobservable");
		});

		it("never reports success when no matching pending row existed at baseline", async () => {
			const db = makeDb({
				visible_actor_spatial_location: [{ entityId: 1n }],
				visible_pending_resolution: [],
			});
			const actor = createActorClient(db, "1", {
				observationTimeoutMs: 80,
				observationPollMs: 20,
				rReact: async () => {
					await wait(5);
				},
			});

			expect((await actor.react(5n, "DECLINE")).status).not.toBe("success");
		});
	});
});
