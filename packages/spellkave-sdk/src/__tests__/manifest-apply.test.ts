import { afterEach, describe, expect, it, vi } from "vitest";

import {
	applyManifestDeltaOrThrow,
	createManifestApplyLane,
	enqueueAndWaitManifestApply,
	enqueueManifestApplyObserved,
	formatManifestApplyFailure,
	ManifestApplyError,
	verdictFromManifestApplySnapshots,
	waitForManifestApplyVerdict,
} from "../manifest-apply";

describe("verdictFromManifestApplySnapshots", () => {
	it("stays pending when nothing new has landed", () => {
		expect(
			verdictFromManifestApplySnapshots({
				beforeDigests: new Set(["abc"]),
				currentDigests: ["abc"],
				beforeOutcomeIds: new Set(),
				currentOutcomes: [],
			}),
		).toEqual({ status: "pending" });
	});

	it("seals on a new digest", () => {
		expect(
			verdictFromManifestApplySnapshots({
				beforeDigests: new Set(["abc"]),
				currentDigests: ["abc", "def"],
				beforeOutcomeIds: new Set(),
				currentOutcomes: [],
			}),
		).toEqual({ status: "sealed", digest: "def" });
	});

	it("ignores an old success outcome even when its digest already exists", () => {
		expect(
			verdictFromManifestApplySnapshots({
				beforeDigests: new Set(["abc"]),
				currentDigests: ["abc"],
				beforeOutcomeIds: new Set(["old"]),
				currentOutcomes: [{ applyId: "old", ok: true, digest: "abc", code: "", message: "" }],
			}),
		).toEqual({ status: "pending" });
	});

	it("fails on a new outcome with the MF-APPLY code", () => {
		expect(
			verdictFromManifestApplySnapshots({
				beforeDigests: new Set(["abc"]),
				currentDigests: ["abc"],
				beforeOutcomeIds: new Set(),
				currentOutcomes: [
					{ applyId: "7", code: "MF-APPLY-027", message: "manifest commit failed during drain" },
				],
			}),
		).toEqual({
			status: "failed",
			code: "MF-APPLY-027",
			message: "manifest commit failed during drain",
			outcome: {
				applyId: "7",
				code: "MF-APPLY-027",
				message: "manifest commit failed during drain",
			},
		});
	});
});

describe("waitForManifestApplyVerdict", () => {
	afterEach(() => vi.useRealTimers());
	it("resolves a failure without waiting for the watchdog", async () => {
		vi.useFakeTimers();
		const verdict = await waitForManifestApplyVerdict(
			() => ({ status: "failed", code: "MF-APPLY-027", message: "drain" }),
			{ watchdogMs: 60_000 },
		);
		expect(verdict).toEqual({ status: "failed", code: "MF-APPLY-027", message: "drain" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("subscribes before reading and removes a synchronously notified subscription", async () => {
		vi.useFakeTimers();
		const remove = vi.fn();
		let visible = false;
		const result = await waitForManifestApplyVerdict(
			() => (visible ? { status: "sealed" } : { status: "pending" }),
			{
				onUpdate: (notify) => {
					visible = true;
					notify();
					return remove;
				},
			},
		);
		expect(result).toEqual({ status: "sealed" });
		expect(remove).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("cleans up the observer and watchdog when reading throws", async () => {
		vi.useFakeTimers();
		const cause = new Error("broken cache");
		const remove = vi.fn();
		await expect(
			waitForManifestApplyVerdict(
				() => {
					throw cause;
				},
				{
					onUpdate: () => remove,
				},
			),
		).rejects.toBe(cause);
		expect(remove).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("times out a silent source without polling its cache", async () => {
		vi.useFakeTimers();
		const read = vi.fn(() => ({ status: "pending" as const }));
		const remove = vi.fn();
		const waiting = waitForManifestApplyVerdict(read, {
			onUpdate: () => remove,
			watchdogMs: 40,
			label: "fixture A",
		});
		const failure = expect(waiting).rejects.toThrow(
			"fixture A: manifest apply watchdog: no seal or failure outcome within 40ms",
		);
		expect(vi.getTimerCount()).toBe(1);
		await vi.advanceTimersByTimeAsync(40);
		await failure;
		expect(read).toHaveBeenCalledTimes(1);
		expect(remove).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});
});

describe("formatManifestApplyFailure", () => {
	it("prefixes the stable code", () => {
		expect(formatManifestApplyFailure("MF-APPLY-027", "drain")).toBe("MF-APPLY-027: drain");
	});
});

function handle(rows: Record<string, unknown>[]) {
	return { iter: () => rows };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}

describe("enqueueAndWaitManifestApply retry snapshot", () => {
	it("retakes the digest/outcome snapshot on every in-flight retry", async () => {
		const digests: Record<string, unknown>[] = [];
		const outcomes: Record<string, unknown>[] = [];
		let attempts = 0;
		const result = await enqueueAndWaitManifestApply({
			digestHandle: handle(digests),
			outcomeHandle: handle(outcomes),
			retryInFlight: { attempts: 2, delayMs: 0 },
			enqueue: async () => {
				attempts += 1;
				if (attempts === 1) {
					// Unrelated apply seals between attempt 1 and 2. If the snapshot
					// were taken once at entry, this digest would be attributed to us.
					digests.push({ manifestDigest: "unrelated-seal" });
					throw new Error("MF-APPLY-013: a manifest apply is already draining");
				}
				outcomes.push({
					applyId: "this-call",
					code: "MF-APPLY-027",
					message: "manifest commit failed during drain",
				});
			},
		});
		expect(attempts).toBe(2);
		expect(result).toEqual({
			ok: false,
			detail: "MF-APPLY-027: manifest commit failed during drain",
			outcome: {
				applyId: "this-call",
				digest: "",
				code: "MF-APPLY-027",
				message: "manifest commit failed during drain",
			},
		});
	});
});

describe("enqueueAndWaitManifestApply repeated seal", () => {
	it("observes a successful repeat outcome without requiring a new digest", async () => {
		const outcomes: Record<string, unknown>[] = [
			{ applyId: "old", ok: true, digest: "same-digest", code: "", message: "" },
		];
		const result = await enqueueAndWaitManifestApply({
			digestHandle: handle([{ manifestDigest: "same-digest" }]),
			outcomeHandle: handle(outcomes),
			enqueue: async () => {
				outcomes.push({
					applyId: "repeat",
					ok: true,
					digest: "same-digest",
					code: "",
					message: "",
				});
			},
		});
		expect(result).toEqual({ ok: true, digest: "same-digest" });
	});

	it("fails a rejected repeat even when its digest was previously sealed", async () => {
		const outcomes: Record<string, unknown>[] = [];
		const result = await enqueueAndWaitManifestApply({
			digestHandle: handle([{ manifestDigest: "same-digest" }]),
			outcomeHandle: handle(outcomes),
			enqueue: async () => {
				outcomes.push({
					applyId: "rejected",
					ok: false,
					digest: "same-digest",
					code: "MF-APPLY-027",
					message: "authority revoked",
				});
			},
		});
		expect(result).toEqual({
			ok: false,
			detail: "MF-APPLY-027: authority revoked",
			outcome: {
				applyId: "rejected",
				ok: false,
				digest: "same-digest",
				code: "MF-APPLY-027",
				message: "authority revoked",
			},
		});
	});
});

describe("enqueueAndWaitManifestApply tolerateAlreadyApplied", () => {
	it("resolves already-applied as success when opted in", async () => {
		const result = await enqueueAndWaitManifestApply({
			digestHandle: handle([]),
			outcomeHandle: handle([]),
			tolerateAlreadyApplied: true,
			enqueue: async () => {
				throw new Error("rejected: MF-APPLY-012 manifest already applied");
			},
		});
		expect(result).toEqual({ ok: true, alreadyApplied: true });
	});

	it("fails loud on already-applied when the option is off", async () => {
		const result = await enqueueAndWaitManifestApply({
			digestHandle: handle([]),
			outcomeHandle: handle([]),
			enqueue: async () => {
				throw new Error("rejected: MF-APPLY-012 manifest already applied");
			},
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.detail).toContain("MF-APPLY-012");
	});
});

describe("applyManifestDeltaOrThrow", () => {
	it("preserves the original enqueue exception as its cause", async () => {
		const cause = new Error("MF-APPLY-015: sender lacks frontier.apply_manifest");
		const failure = await applyManifestDeltaOrThrow(
			{
				digestHandle: handle([]),
				outcomeHandle: handle([]),
				enqueueDelta: async () => {
					throw cause;
				},
			},
			"manifest",
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(ManifestApplyError);
		expect((failure as Error).cause).toBe(cause);
	});

	it.each(["camel", "snake"])("retains outcome correlation from %s bindings", async (shape) => {
		const rows: Record<string, unknown>[] = [];
		const failure = await applyManifestDeltaOrThrow(
			{
				digestHandle: handle([]),
				outcomeHandle: handle(rows),
				enqueueDelta: async () => {
					rows.push({
						[shape === "camel" ? "applyId" : "apply_id"]: 42n,
						digest: "rejected-digest",
						code: "MF-APPLY-029",
						message: "manifest drain aborted before seal",
					});
				},
			},
			"manifest",
		).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(ManifestApplyError);
		expect(failure).toMatchObject({
			outcome: { applyId: "42", digest: "rejected-digest", code: "MF-APPLY-029" },
		});
		expect((failure as Error).message).toContain("apply_id=42, digest=rejected-digest");
	});

	it("rethrows with the MF code from a failed result", async () => {
		const port = {
			digestHandle: handle([]),
			outcomeHandle: handle([]),
			enqueueDelta: async () => {
				throw new Error("MF-APPLY-015: sender lacks frontier.apply_manifest");
			},
		};
		await expect(applyManifestDeltaOrThrow(port, '[bundle]\nid = "x"')).rejects.toThrow(
			/MF-APPLY-015/,
		);
	});
});

describe("createManifestApplyLane", () => {
	it("serializes two callers on one lane", async () => {
		const lane = createManifestApplyLane();
		const order: string[] = [];
		const holdA = deferred();
		let aStarted!: () => void;
		const aHasStarted = new Promise<void>((r) => {
			aStarted = r;
		});

		const run = (name: string, hold: Promise<void>, onStart?: () => void) => {
			const digests: Record<string, unknown>[] = [];
			return enqueueAndWaitManifestApply({
				digestHandle: handle(digests),
				outcomeHandle: handle([]),
				lane,
				enqueue: async () => {
					order.push(`${name}-start`);
					onStart?.();
					await hold;
					digests.push({ manifestDigest: `seal-${name}` });
					order.push(`${name}-end`);
				},
			});
		};

		const pA = run("a", holdA.promise, aStarted);
		await aHasStarted;
		const pB = run("b", Promise.resolve());
		await Promise.resolve();
		await Promise.resolve();
		expect(order).toEqual(["a-start"]);
		holdA.resolve();
		await Promise.all([pA, pB]);
		expect(order).toEqual(["a-start", "a-end", "b-start", "b-end"]);
	});

	it("does not serialize callers on two different lanes", async () => {
		const laneA = createManifestApplyLane();
		const laneB = createManifestApplyLane();
		const order: string[] = [];
		const holdA = deferred();
		let aStarted!: () => void;
		const aHasStarted = new Promise<void>((r) => {
			aStarted = r;
		});
		let bStarted!: () => void;
		const bHasStarted = new Promise<void>((r) => {
			bStarted = r;
		});

		const run = (
			name: string,
			lane: ReturnType<typeof createManifestApplyLane>,
			hold: Promise<void>,
			onStart: () => void,
		) => {
			const digests: Record<string, unknown>[] = [];
			return enqueueAndWaitManifestApply({
				digestHandle: handle(digests),
				outcomeHandle: handle([]),
				lane,
				enqueue: async () => {
					order.push(`${name}-start`);
					onStart();
					await hold;
					digests.push({ manifestDigest: `seal-${name}` });
					order.push(`${name}-end`);
				},
			});
		};

		const pA = run("a", laneA, holdA.promise, aStarted);
		await aHasStarted;
		const pB = run("b", laneB, Promise.resolve(), bStarted);
		await bHasStarted;
		expect(order).toContain("a-start");
		expect(order).toContain("b-start");
		expect(order).not.toContain("a-end");
		holdA.resolve();
		await Promise.all([pA, pB]);
	});
});

function updateBus() {
	const listeners = new Set<(table?: string) => void>();
	return {
		onUpdate(listener: (table?: string) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		fire(table?: string) {
			for (const listener of listeners) listener(table);
		},
	};
}

describe("enqueueManifestApplyObserved", () => {
	afterEach(() => vi.useRealTimers());
	it("returns immediately and seals when the digest lands on the update stream", async () => {
		const bus = updateBus();
		const digests: Record<string, unknown>[] = [];
		const hold = deferred();
		const ticket = enqueueManifestApplyObserved({
			digestHandle: handle(digests),
			outcomeHandle: handle([]),
			onUpdate: bus.onUpdate,
			enqueue: async () => {
				await hold.promise;
			},
		});
		let settled = false;
		void ticket.result.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);
		hold.resolve();
		await Promise.resolve();
		await Promise.resolve();
		expect(settled).toBe(false);
		digests.push({ manifestDigest: "seal-a" });
		bus.fire("manifest_apply_digest");
		await expect(ticket.result).resolves.toEqual({ ok: true, digest: "seal-a" });
		expect(settled).toBe(true);
	});

	it("re-enqueues on MF-APPLY-013 from the observer, never from a sleep loop", async () => {
		vi.useFakeTimers();
		const bus = updateBus();
		const digests: Record<string, unknown>[] = [];
		let attempts = 0;
		const ticket = enqueueManifestApplyObserved({
			digestHandle: handle(digests),
			outcomeHandle: handle([]),
			onUpdate: bus.onUpdate,
			enqueue: async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new Error("MF-APPLY-013: a manifest apply is already draining");
				}
				digests.push({ manifestDigest: "seal-after-foreign" });
			},
		});
		await Promise.resolve();
		expect(attempts).toBe(1);
		bus.fire("manifest_apply_digest");
		await expect(ticket.result).resolves.toEqual({ ok: true, digest: "seal-after-foreign" });
		expect(attempts).toBe(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("done unwraps a failed result into a thrown MF code", async () => {
		const bus = updateBus();
		const ticket = enqueueManifestApplyObserved({
			digestHandle: handle([]),
			outcomeHandle: handle([]),
			onUpdate: bus.onUpdate,
			enqueue: async () => {
				throw new Error("MF-APPLY-015: sender lacks frontier.apply_manifest");
			},
		});
		await expect(ticket.done).rejects.toThrow(/MF-APPLY-015/);
	});

	it("ignores a premature signal and seals on the cache-applied notification", async () => {
		vi.useFakeTimers();
		const bus = updateBus();
		const digests: Record<string, unknown>[] = [];
		const ticket = enqueueManifestApplyObserved({
			digestHandle: handle(digests),
			outcomeHandle: handle([]),
			onUpdate: bus.onUpdate,
			enqueue: async () => {},
		});
		await Promise.resolve();
		await Promise.resolve();
		bus.fire("manifest_apply_digest");
		await Promise.resolve();
		digests.push({ manifestDigest: "seal-after-signal" });
		bus.fire("__applied");
		await expect(ticket.result).resolves.toEqual({ ok: true, digest: "seal-after-signal" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("seals when the only fire uses a table name the wait filter used to reject", async () => {
		vi.useFakeTimers();
		const bus = updateBus();
		const digests: Record<string, unknown>[] = [];
		const ticket = enqueueManifestApplyObserved({
			digestHandle: handle(digests),
			outcomeHandle: handle([]),
			onUpdate: bus.onUpdate,
			enqueue: async () => {},
		});
		await Promise.resolve();
		await Promise.resolve();
		digests.push({ manifestDigest: "seal-camel" });
		bus.fire("manifestApplyDigest");
		await expect(ticket.result).resolves.toEqual({ ok: true, digest: "seal-camel" });
		expect(vi.getTimerCount()).toBe(0);
	});

	it("does not poll silent cache changes after an unrelated update", async () => {
		vi.useFakeTimers();
		const bus = updateBus();
		const digests: Record<string, unknown>[] = [];
		const ticket = enqueueManifestApplyObserved({
			digestHandle: handle(digests),
			outcomeHandle: handle([]),
			onUpdate: bus.onUpdate,
			enqueue: async () => {},
		});
		await Promise.resolve();
		await Promise.resolve();
		let settled = false;
		void ticket.result.then(() => {
			settled = true;
		});
		bus.fire("world_time");
		digests.push({ manifestDigest: "seal-missed-tag" });
		await vi.advanceTimersByTimeAsync(1_000);
		expect(settled).toBe(false);
		expect(vi.getTimerCount()).toBe(1);
		bus.fire("manifest_apply_digest");
		await expect(ticket.result).resolves.toEqual({ ok: true, digest: "seal-missed-tag" });
		expect(vi.getTimerCount()).toBe(0);
	});
});
