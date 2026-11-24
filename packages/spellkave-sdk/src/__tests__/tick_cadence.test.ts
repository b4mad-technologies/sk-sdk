import { afterEach, describe, expect, it, vi } from "vitest";
import type { SnapshotDb } from "../connection";
import { TickIntervalEstimator } from "../core/tick_cadence";
import { currentWorldTick, currentWorldTickOrZero } from "../core/world_time";
import { observeReducerAttempt } from "../provenance";

describe("TickIntervalEstimator", () => {
	it("returns 200ms floor with only 1 observation", () => {
		const e = new TickIntervalEstimator();
		e.record(1n, 0);
		expect(e.hasMeasuredCadence()).toBe(false);
		expect(e.estimateMs()).toBe(200);
	});

	it("returns 200ms floor with fewer than 5 deltas recorded", () => {
		const e = new TickIntervalEstimator();
		for (let i = 0; i < 4; i++) {
			e.record(BigInt(i), i * 80);
		}
		expect(e.estimateMs()).toBe(200);
	});

	it("returns median interval once 5 deltas recorded (5 × 80ms → 80ms)", () => {
		const e = new TickIntervalEstimator();
		for (let i = 0; i <= 5; i++) {
			e.record(BigInt(i), i * 80);
		}
		expect(e.hasMeasuredCadence()).toBe(true);
		expect(e.estimateMs()).toBe(80);
	});

	it("returns 200ms floor before 5 deltas even when intervals are small", () => {
		const e = new TickIntervalEstimator();
		for (let i = 0; i < 4; i++) {
			e.record(BigInt(i), i * 10); // 3 deltas — still under threshold
		}
		expect(e.estimateMs()).toBe(200);
	});

	it("returns raw median after 5 deltas even when below 200ms", () => {
		const e = new TickIntervalEstimator();
		for (let i = 0; i <= 5; i++) {
			e.record(BigInt(i), i * 10); // 10ms intervals
		}
		expect(e.estimateMs()).toBe(10);
	});

	it("outlier does not shift median (4 × 80ms + 1 × 5000ms → 80ms)", () => {
		const e = new TickIntervalEstimator();
		// 5 normal deltas of 80ms, then one giant outlier
		const times = [0, 80, 160, 240, 320, 400, 5400];
		for (let i = 0; i < times.length; i++) {
			// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
			e.record(BigInt(i), times[i]!);
		}
		// Window holds last 6 obs → 5 deltas: [80,80,80,80,4000] → sorted [80,80,80,80,4000] → median=80
		expect(e.estimateMs()).toBe(80);
	});

	it("handles multi-tick jumps by normalising per tick", () => {
		const e = new TickIntervalEstimator();
		// Tick jumps of 2 with 160ms wall time each → 80ms per tick
		for (let i = 0; i <= 10; i += 2) {
			e.record(BigInt(i), (i / 2) * 160);
		}
		expect(e.estimateMs()).toBe(80);
	});

	it("lastObservedAtMs returns null with no observations", () => {
		const e = new TickIntervalEstimator();
		expect(e.lastObservedAtMs()).toBeNull();
	});

	it("lastObservedAtMs returns the most recent observation wall time", () => {
		const e = new TickIntervalEstimator();
		e.record(1n, 100);
		e.record(2n, 200);
		e.record(3n, 300);
		expect(e.lastObservedAtMs()).toBe(300);
	});
});

// ── currentWorldTick / currentWorldTickOrZero ─────────────────────────────────

function makeWorldTimeDb(tick: bigint): SnapshotDb {
	return {
		world_time: { iter: () => [{ tick }] },
	} as unknown as SnapshotDb;
}

describe("currentWorldTick", () => {
	it("returns null when world_time row is absent", () => {
		expect(currentWorldTick({})).toBeNull();
	});

	it("returns the tick when world_time row is present", () => {
		expect(currentWorldTick(makeWorldTimeDb(42n))).toBe(42n);
	});
});

describe("currentWorldTickOrZero", () => {
	it("returns 0n when world_time row is absent", () => {
		expect(currentWorldTickOrZero({})).toBe(0n);
	});

	it("returns the tick when world_time row is present", () => {
		expect(currentWorldTickOrZero(makeWorldTimeDb(7n))).toBe(7n);
	});
});

// ── Lag-warning scenarios ─────────────────────────────────────────────────────

function makeEmptyDb(): SnapshotDb {
	return {};
}

function makeDbWithProvenance(
	rows: Array<{
		subjectId: string;
		createdAtTick: bigint;
		provenanceId: string;
		status?: "Succeeded" | "Failed";
		failureKind?: string;
		failureDetail?: string;
	}>,
): SnapshotDb {
	return {
		evaluation_provenance: {
			iter: () =>
				rows.map((r) => ({
					provenanceId: r.provenanceId,
					kind: { tag: "Affordance" },
					status: { tag: r.status ?? "Succeeded" },
					subjectId: r.subjectId,
					failureKind: r.failureKind ?? "",
					failureDetail: r.failureDetail ?? "",
					selectedTemplateIds: [],
					createdAtTick: r.createdAtTick,
					bundleId: "core",
				})),
		},
	} as unknown as SnapshotDb;
}

describe("lag warning — observeReducerAttempt", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("lagWarning=true when estimator=80ms and cache stale 250ms at unobservable result", async () => {
		vi.useFakeTimers();

		const estimator = new TickIntervalEstimator();
		// Seed 6 observations at 80ms intervals (produces 5 deltas → estimateMs()=80).
		for (let i = 0; i <= 5; i++) {
			estimator.record(BigInt(i), i * 80);
		}
		// Last observation was at ms=400. Advance time so cache age = 250ms (> 2×80=160ms).
		vi.setSystemTime(400 + 250);

		const db = makeEmptyDb();

		const resultPromise = observeReducerAttempt<null>({
			db: () => db,
			subjectId: "actor-a",
			invoke: async () => {
				// Reducer returns but successPredicate never satisfies and no provenance is visible.
			},
			successPredicate: () => false,
			collectSnapshot: () => null,
			timeoutMs: 1,
			pollMs: 1,
			tickEstimator: estimator,
		});

		// Advance timers to trigger the timeout poll.
		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.status).toBe("unobservable");
		expect(result.lagWarning).toBe(true);
	});

	it("lagWarning=false when estimator=80ms and cache stale only 50ms at unobservable result", async () => {
		vi.useFakeTimers();

		const estimator = new TickIntervalEstimator();
		// Seed 6 observations at 80ms intervals.
		for (let i = 0; i <= 5; i++) {
			estimator.record(BigInt(i), i * 80);
		}
		// Last observation at ms=400. Advance only 50ms (< 2×80=160ms).
		vi.setSystemTime(400 + 50);

		const db = makeEmptyDb();

		const resultPromise = observeReducerAttempt<null>({
			db: () => db,
			subjectId: "actor-b",
			invoke: async () => {},
			successPredicate: () => false,
			collectSnapshot: () => null,
			timeoutMs: 1,
			pollMs: 1,
			tickEstimator: estimator,
		});

		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.status).toBe("unobservable");
		expect(result.lagWarning).toBe(false);
	});

	it("returns unobserved_timeout while the reducer call is still pending at the deadline", async () => {
		vi.useFakeTimers();

		const db = makeEmptyDb();
		const resultPromise = observeReducerAttempt<null>({
			db: () => db,
			subjectId: "actor-pending",
			invoke: () => new Promise(() => {}),
			successPredicate: () => false,
			collectSnapshot: () => null,
			timeoutMs: 5,
			pollMs: 1,
		});

		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.status).toBe("unobserved_timeout");
	});

	it("lagWarning=false on success regardless of cache age", async () => {
		vi.useFakeTimers();

		const estimator = new TickIntervalEstimator();
		for (let i = 0; i <= 5; i++) {
			estimator.record(BigInt(i), i * 80);
		}
		vi.setSystemTime(400 + 500); // stale by 500ms > 160ms

		let called = false;
		const db = makeEmptyDb();

		const resultPromise = observeReducerAttempt<null>({
			db: () => db,
			subjectId: "actor-c",
			invoke: async () => {
				called = true;
			},
			successPredicate: () => called,
			collectSnapshot: () => null,
			timeoutMs: 100,
			pollMs: 1,
			tickEstimator: estimator,
		});

		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.status).toBe("success");
		expect(result.lagWarning).toBe(false);
	});

	it("returns unobserved_no_provenance when a non-failure provenance row is observed before timeout expiry", async () => {
		vi.useFakeTimers();

		const rows: Array<{
			subjectId: string;
			createdAtTick: bigint;
			provenanceId: string;
			status?: "Succeeded" | "Failed";
		}> = [];
		const db = makeDbWithProvenance(rows);

		const resultPromise = observeReducerAttempt<null>({
			db: () => db,
			subjectId: "actor-d",
			invoke: async () => {
				setTimeout(() => {
					rows.push({ subjectId: "actor-d", createdAtTick: 10n, provenanceId: "p-1" });
				}, 1);
			},
			successPredicate: () => false,
			collectSnapshot: () => null,
			timeoutMs: 5,
			pollMs: 1,
		});

		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.status).toBe("unobserved_no_provenance");
		expect(result.provenance?.id).toBe("p-1");
	});

	it("returns success when success provenance arrives at the timeout edge", async () => {
		vi.useFakeTimers();

		const rows: Array<{
			subjectId: string;
			createdAtTick: bigint;
			provenanceId: string;
			status?: "Succeeded" | "Failed";
		}> = [];
		const db = makeDbWithProvenance(rows);

		const resultPromise = observeReducerAttempt<null>({
			db: () => db,
			subjectId: "actor-edge",
			invoke: async () => {
				setTimeout(() => {
					rows.push({
						subjectId: "actor-edge",
						createdAtTick: 10n,
						provenanceId: "p-edge",
						status: "Succeeded",
					});
				}, 5);
			},
			successPredicate: () => false,
			collectSnapshot: () => null,
			timeoutMs: 5,
			pollMs: 10,
			successOnProvenance: true,
		});

		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.status).toBe("success");
		expect(result.provenance?.id).toBe("p-edge");
		expect(result.lagWarning).toBe(false);
	});

	it("returns rejected when a failed provenance row is observed before timeout expiry", async () => {
		vi.useFakeTimers();

		const rows: Array<{
			subjectId: string;
			createdAtTick: bigint;
			provenanceId: string;
			status?: "Succeeded" | "Failed";
		}> = [];
		const db = makeDbWithProvenance(rows);

		const resultPromise = observeReducerAttempt<null>({
			db: () => db,
			subjectId: "actor-e",
			invoke: async () => {
				setTimeout(() => {
					rows.push({
						subjectId: "actor-e",
						createdAtTick: 11n,
						provenanceId: "p-2",
						status: "Failed",
					});
				}, 1);
			},
			successPredicate: () => false,
			collectSnapshot: () => null,
			timeoutMs: 5,
			pollMs: 1,
		});

		await vi.runAllTimersAsync();
		const result = await resultPromise;

		expect(result.status).toBe("rejected");
		expect(result.provenance?.status).toBe("Failed");
	});

	it("emits bounded safe correlation and failure classification without failure detail", async () => {
		vi.useFakeTimers();
		const canary = "SECRET-FAILURE-DETAIL";
		const rows: Array<{
			subjectId: string;
			createdAtTick: bigint;
			provenanceId: string;
			status?: "Succeeded" | "Failed";
			failureKind?: string;
			failureDetail?: string;
		}> = [];
		const db = makeDbWithProvenance(rows);
		const observed: unknown[] = [];
		const telemetry = {
			startSpan: (_name: string, attributes?: Record<string, unknown>) => {
				observed.push(attributes);
				return {
					addEvent: (_event: string, attributes?: Record<string, unknown>) =>
						observed.push(attributes),
					end: () => {},
				};
			},
		};
		const resultPromise = observeReducerAttempt<null>({
			db: () => db,
			subjectId: "actor-safe",
			invoke: async () => {
				setTimeout(() => {
					rows.push({
						subjectId: "actor-safe",
						createdAtTick: 12n,
						provenanceId: "p-safe",
						status: "Failed",
						failureKind: "missing_equipment_slot",
						failureDetail: canary,
					});
				}, 1);
			},
			successPredicate: () => false,
			collectSnapshot: () => null,
			timeoutMs: 5,
			pollMs: 1,
			telemetry,
			telemetryAttributes: {
				"spellkave.correlation_id": "corr-safe",
				"spellkave.world_slug": "elven-mini",
			},
		});
		await vi.runAllTimersAsync();
		expect((await resultPromise).status).toBe("rejected");
		const serialized = JSON.stringify(observed);
		expect(serialized).toContain("corr-safe");
		expect(serialized).toContain("missing_equipment_slot");
		expect(serialized).not.toContain(canary);
	});

	it("telemetry exceptions cannot change an authoritative reducer result", async () => {
		vi.useFakeTimers();
		let succeeded = false;
		const resultPromise = observeReducerAttempt<null>({
			db: () => makeEmptyDb(),
			subjectId: "actor-telemetry-fails",
			invoke: async () => {
				succeeded = true;
			},
			successPredicate: () => succeeded,
			collectSnapshot: () => null,
			timeoutMs: 5,
			pollMs: 1,
			telemetry: {
				startSpan: () => {
					throw new Error("projection failed");
				},
			},
		});
		await vi.runAllTimersAsync();
		expect((await resultPromise).status).toBe("success");
	});
});
