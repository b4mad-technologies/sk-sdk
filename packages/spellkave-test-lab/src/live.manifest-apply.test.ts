import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	applyManifestDelta,
	applyManifestSourceWithReceipt,
	isManifestAlreadyApplied,
	type TestWorld,
} from "./live";

function applyWorld(enqueue: () => Promise<void>, synchronize: () => void = () => {}) {
	const tables = () => {
		const rows: Record<string, unknown>[] = [];
		const listeners = new Set<() => void>();
		return {
			iter: () => rows,
			onInsert: (notify: () => void) => listeners.add(notify),
			removeOnInsert: (notify: () => void) => listeners.delete(notify),
			insert(row: Record<string, unknown>) {
				rows.push(row);
				for (const notify of listeners) notify();
			},
			listeners,
		};
	};
	const db = { manifestApplyDigest: tables(), manifestApplyOutcome: tables() };
	const unsubscribe = vi.fn();
	const world = {
		conn: {
			db,
			reducers: { rApplyManifestDelta: enqueue, rApplyWorldManifest: enqueue },
			subscriptionBuilder: () => {
				let ended = false;
				let applied = () => {};
				let failed = (_ctx: unknown) => {};
				const builder = {
					onApplied(fn: () => void) {
						applied = fn;
						return builder;
					},
					onError(fn: (ctx: unknown) => void) {
						failed = fn;
						return builder;
					},
					subscribe() {
						queueMicrotask(() => {
							try {
								synchronize();
								applied();
							} catch (cause) {
								ended = true;
								failed({ event: cause });
							}
						});
						return { unsubscribe, isEnded: () => ended };
					},
				};
				return builder;
			},
		},
		db: () => db,
	} as unknown as TestWorld;
	return { world, db, unsubscribe };
}

describe("test-lab manifest observation", () => {
	afterEach(() => vi.useRealTimers());
	it("preserves a snapshot failure without enqueueing or unsubscribing an ended handle", async () => {
		vi.useFakeTimers();
		const cause = new Error("subscription rejected");
		const enqueue = vi.fn(async () => {});
		const { world, unsubscribe } = applyWorld(enqueue, () => {
			throw cause;
		});
		await expect(applyManifestDelta(world, "manifest")).rejects.toMatchObject({ cause });
		expect(enqueue).not.toHaveBeenCalled();
		expect(unsubscribe).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
	it("does not mistake a previous connection's delayed seal for the next apply", async () => {
		vi.useFakeTimers();
		const first = applyWorld(async () =>
			first.db.manifestApplyDigest.insert({ manifestDigest: "first" }),
		);
		await applyManifestDelta(first.world, "first manifest");
		const deliverPreviousSeal = () => {
			if (second.db.manifestApplyDigest.iter().length === 0)
				second.db.manifestApplyDigest.insert({ manifestDigest: "first" });
		};
		const second = applyWorld(async () => deliverPreviousSeal(), deliverPreviousSeal);
		let settled = false;
		const waiting = applyManifestDelta(second.world, "second manifest").then(() => {
			settled = true;
		});
		await vi.advanceTimersByTimeAsync(0);
		const settledBeforeOwnSeal = settled;
		second.db.manifestApplyDigest.insert({ manifestDigest: "second" });
		await waiting;
		expect(settledBeforeOwnSeal).toBe(false);
		expect(vi.getTimerCount()).toBe(0);
	});
	it("captures exact submitted bytes and a confirmed seal without timers advancing", async () => {
		vi.useFakeTimers();
		const toml = "# Unicode fixture: ä\n";
		const digest = createHash("sha256").update(toml).digest("hex");
		const { world, db } = applyWorld(async () => {
			db.manifestApplyDigest.insert({ manifestDigest: digest });
		});
		await expect(applyManifestSourceWithReceipt(world, toml)).resolves.toEqual({
			toml,
			submittedSha256: digest,
			digest,
			alreadyApplied: false,
		});
		expect(vi.getTimerCount()).toBe(0);
	});

	it("retains the server seal independently from submitted bytes after sender substitution", async () => {
		const { world, db } = applyWorld(async () => {
			db.manifestApplyDigest.insert({ manifestDigest: "server-rendered-digest" });
		});
		await expect(
			applyManifestSourceWithReceipt(world, 'identity = "$sender"'),
		).resolves.toMatchObject({
			digest: "server-rendered-digest",
			submittedSha256: createHash("sha256").update('identity = "$sender"').digest("hex"),
		});
	});

	it("does not invent a new seal for a tolerated re-admission", async () => {
		const toml = "previously admitted";
		const digest = createHash("sha256").update(toml).digest("hex");
		const { world, db } = applyWorld(async () => {
			throw new Error("MF-APPLY-012: manifest already applied");
		});
		db.manifestApplyDigest.insert({ manifestDigest: digest });
		await expect(
			applyManifestSourceWithReceipt(world, toml, { tolerateAlreadyApplied: true }),
		).resolves.toEqual({ toml, submittedSha256: digest, digest: null, alreadyApplied: true });
	});
	it("waits for the inserted seal without polling and removes both listeners", async () => {
		vi.useFakeTimers();
		const enqueue = vi.fn(async () => {});
		const { world, db } = applyWorld(enqueue);
		const waiting = applyManifestDelta(world, "test manifest");
		// Drain only the lane and enqueue microtasks, never a wall-clock timer.
		await vi.advanceTimersByTimeAsync(0);
		expect(enqueue).toHaveBeenCalledTimes(1);
		expect(db.manifestApplyDigest.listeners.size).toBe(1);
		expect(db.manifestApplyOutcome.listeners.size).toBe(1);
		expect(vi.getTimerCount()).toBe(1);
		db.manifestApplyDigest.insert({ manifestDigest: "accepted" });
		await waiting;
		expect(vi.getTimerCount()).toBe(0);
		expect(db.manifestApplyDigest.listeners.size).toBe(0);
		expect(db.manifestApplyOutcome.listeners.size).toBe(0);
	});

	it("holds the local apply lane until the first seal, even after enqueue completed", async () => {
		vi.useFakeTimers();
		const enqueue = vi.fn(async () => {});
		const { world, db } = applyWorld(enqueue);
		const first = applyManifestDelta(world, "first");
		const second = applyManifestDelta(world, "second");
		await vi.advanceTimersByTimeAsync(0);
		// Enqueue acceptance and partial authored rows are not completion signals.
		expect(enqueue).toHaveBeenCalledTimes(1);
		db.manifestApplyDigest.insert({ manifestDigest: "first-sealed" });
		await first;
		await vi.advanceTimersByTimeAsync(0);
		expect(enqueue).toHaveBeenCalledTimes(2);
		db.manifestApplyDigest.insert({ manifestDigest: "second-sealed" });
		await second;
		expect(vi.getTimerCount()).toBe(0);
	});

	it("fails an external in-flight collision after exactly one enqueue", async () => {
		vi.useFakeTimers();
		const cause = new Error("MF-APPLY-013: already draining");
		const enqueue = vi.fn(async () => {
			throw cause;
		});
		const { world } = applyWorld(enqueue);
		const failure = expect(applyManifestDelta(world, "test manifest")).rejects.toMatchObject({
			cause,
		});
		await vi.runAllTimersAsync();
		await failure;
		expect(enqueue).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("retains a notified failure row and removes listeners without retrying", async () => {
		vi.useFakeTimers();
		const enqueue = vi.fn(async () => {});
		const { world, db } = applyWorld(enqueue);
		const waiting = applyManifestDelta(world, "test manifest");
		const outcome = {
			applyId: "42",
			digest: "rejected",
			code: "MF-APPLY-029",
			message: "manifest drain aborted before seal",
		};
		const failure = expect(waiting).rejects.toMatchObject({ outcome });
		await vi.advanceTimersByTimeAsync(0);
		db.manifestApplyOutcome.insert(outcome);
		await failure;
		expect(enqueue).toHaveBeenCalledTimes(1);
		expect(db.manifestApplyDigest.listeners.size).toBe(0);
		expect(db.manifestApplyOutcome.listeners.size).toBe(0);
		expect(vi.getTimerCount()).toBe(0);
	});
});

// Ledger finding #15 (`packages/spellkave-srd-cc/ledger/findings.md`):
// three packages (spellkave-srd, spellkave-phandelver, spellkave-srd-cc) each
// reimplemented the same "does this error mean MF-APPLY-012 (an exact
// byte-identical resubmit)" check to decide whether `ApplyManifestOptions.
// tolerateAlreadyApplied` should swallow it. This is the pure seam that
// decision lives in — no live node needed to prove it.
describe("isManifestAlreadyApplied", () => {
	it("recognizes the MF-APPLY-012 code embedded in an Error message", () => {
		expect(
			isManifestAlreadyApplied(new Error(`rejected: MF-APPLY-012 manifest already applied`)),
		).toBe(true);
	});

	it("recognizes the plain-text 'already applied' phrasing some transports surface", () => {
		expect(isManifestAlreadyApplied(new Error("manifest already applied"))).toBe(true);
	});

	it("recognizes a non-Error thrown value (e.g. a raw string rejection)", () => {
		expect(isManifestAlreadyApplied("MF-APPLY-012: already applied")).toBe(true);
	});

	it("does not tolerate an unrelated failure", () => {
		expect(
			isManifestAlreadyApplied(new Error("MF-APPLY-013: a manifest apply is already draining")),
		).toBe(false);
		expect(isManifestAlreadyApplied(new Error("network error"))).toBe(false);
	});
});
