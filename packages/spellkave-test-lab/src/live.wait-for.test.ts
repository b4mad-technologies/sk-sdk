// keep-file(K2): injected subscription hooks expose listener lifetime and delivery races without a node.
import { afterEach, describe, expect, it, vi } from "vitest";

import { WaitForTimeoutError, waitForEvent } from "./live";

type Callback = () => void;

function deferred(): { promise: Promise<void>; resolve: () => void } {
	let settle: (() => void) | undefined;
	let settled = false;
	const promise = new Promise<void>((resolve) => {
		settle = resolve;
	});
	return {
		promise,
		resolve() {
			if (settled) return;
			settled = true;
			settle?.();
		},
	};
}

function testWorld() {
	const inserts = new Set<Callback>();
	const updates = new Set<Callback>();
	const deletes = new Set<Callback>();
	let subscribeCount = 0;
	const table = {
		onInsert(callback: Callback) {
			subscribeCount += 1;
			inserts.add(callback);
		},
		removeOnInsert(callback: Callback) {
			inserts.delete(callback);
		},
		onUpdate(callback: Callback) {
			updates.add(callback);
		},
		removeOnUpdate(callback: Callback) {
			updates.delete(callback);
		},
		onDelete(callback: Callback) {
			deletes.add(callback);
		},
		removeOnDelete(callback: Callback) {
			deletes.delete(callback);
		},
	};
	return {
		world: { conn: { db: { testTable: table } } } as never,
		table,
		insert() {
			for (const callback of inserts) callback();
		},
		subscribeCount() {
			return subscribeCount;
		},
		listenerCount() {
			return inserts.size + updates.size + deletes.size;
		},
	};
}

describe("waitForEvent", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves immediately when the cache already satisfies the predicate", async () => {
		const source = testWorld();
		let calls = 0;
		await waitForEvent(
			source.world,
			() => {
				calls += 1;
				return true;
			},
			"subscription did not settle",
		);
		expect(calls).toBe(1);
		expect(source.subscribeCount()).toBe(0);
		expect(source.listenerCount()).toBe(0);
	});

	it("re-evaluates when a subscribed table delivers an event", async () => {
		const source = testWorld();
		const postSubscribeFalse = deferred();
		let delivered = false;
		const waiting = waitForEvent(
			source.world,
			() => {
				if (delivered) return true;
				if (source.subscribeCount() > 0) postSubscribeFalse.resolve();
				return false;
			},
			"subscription did not settle",
		);
		await Promise.race([
			postSubscribeFalse.promise,
			waiting.then(() => {
				throw new Error("wait resolved before post-subscribe false");
			}),
		]);
		delivered = true;
		source.insert();
		await waiting;
		expect(source.listenerCount()).toBe(0);
	});

	it("uses an explicit ceiling only when requested", async () => {
		vi.useFakeTimers();
		try {
			const source = testWorld();
			const waiting = waitForEvent(source.world, () => false, "subscription did not settle", 5_000);
			const assertion = expect(waiting).rejects.toThrow(WaitForTimeoutError);
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(5_000);
			await assertion;
			expect(source.listenerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("rejects when the predicate throws on the first inspect", async () => {
		const source = testWorld();
		await expect(
			waitForEvent(
				source.world,
				() => {
					throw new Error("predicate boom");
				},
				"subscription did not settle",
			),
		).rejects.toThrow("predicate boom");
		expect(source.listenerCount()).toBe(0);
	});

	it("rejects when the predicate throws on a later event", async () => {
		const source = testWorld();
		const postSubscribeFalse = deferred();
		let blows = false;
		const waiting = waitForEvent(
			source.world,
			() => {
				if (blows) throw new Error("later boom");
				if (source.subscribeCount() > 0) postSubscribeFalse.resolve();
				return false;
			},
			"subscription did not settle",
		);
		const assertion = expect(waiting).rejects.toThrow("later boom");
		await Promise.race([
			postSubscribeFalse.promise,
			waiting.then(() => {
				throw new Error("wait resolved before later event");
			}),
		]);
		blows = true;
		source.insert();
		await assertion;
		expect(source.listenerCount()).toBe(0);
	});

	it("sees a value that arrives between first inspect and hook subscribe", async () => {
		const source = testWorld();
		let ready = false;
		const waiting = waitForEvent(source.world, () => ready, "subscription did not settle");
		ready = true;
		await waiting;
	});

	it("resolves a two-world wait when only the first world delivers", async () => {
		const first = testWorld();
		const second = testWorld();
		const postSubscribeFalse = deferred();
		let left = "15";
		const right = "16";
		const waiting = waitForEvent(
			[first.world, second.world],
			() => {
				if (left === right) return true;
				if (first.subscribeCount() > 0 && second.subscribeCount() > 0) {
					postSubscribeFalse.resolve();
				}
				return false;
			},
			"caches did not agree",
		);
		await Promise.race([
			postSubscribeFalse.promise,
			waiting.then(() => {
				throw new Error("wait resolved before post-subscribe false");
			}),
		]);
		expect(first.subscribeCount()).toBe(1);
		expect(second.subscribeCount()).toBe(1);
		left = "16";
		first.insert();
		await waiting;
		expect(first.listenerCount()).toBe(0);
		expect(second.listenerCount()).toBe(0);
	});

	it("resolves a two-world wait when only the second world delivers", async () => {
		const first = testWorld();
		const second = testWorld();
		const postSubscribeFalse = deferred();
		const left = "15";
		let right = "16";
		const waiting = waitForEvent(
			[first.world, second.world],
			() => {
				if (left === right) return true;
				if (first.subscribeCount() > 0 && second.subscribeCount() > 0) {
					postSubscribeFalse.resolve();
				}
				return false;
			},
			"caches did not agree",
		);
		await Promise.race([
			postSubscribeFalse.promise,
			waiting.then(() => {
				throw new Error("wait resolved before post-subscribe false");
			}),
		]);
		expect(first.subscribeCount()).toBe(1);
		expect(second.subscribeCount()).toBe(1);
		right = "15";
		second.insert();
		await waiting;
	});

	it("subscribes a duplicated world/table handle once", async () => {
		const source = testWorld();
		const postSubscribeFalse = deferred();
		let ready = false;
		const waiting = waitForEvent(
			[source.world, source.world],
			() => {
				if (ready) return true;
				if (source.subscribeCount() > 0) postSubscribeFalse.resolve();
				return false;
			},
			"subscription did not settle",
		);
		await Promise.race([
			postSubscribeFalse.promise,
			waiting.then(() => {
				throw new Error("wait resolved before post-subscribe false");
			}),
		]);
		expect(source.subscribeCount()).toBe(1);
		ready = true;
		source.insert();
		await waiting;
	});

	it("times out a two-world wait with one deadline", async () => {
		vi.useFakeTimers();
		try {
			const first = testWorld();
			const second = testWorld();
			const waiting = waitForEvent(
				[first.world, second.world],
				() => false,
				"caches did not agree",
				5_000,
			);
			const assertion = expect(waiting).rejects.toThrow(WaitForTimeoutError);
			await Promise.resolve();
			await vi.advanceTimersByTimeAsync(5_000);
			await assertion;
			expect(first.listenerCount()).toBe(0);
			expect(second.listenerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});

	it("settling one wait preserves another wait's hooks on the same table", async () => {
		const source = testWorld();
		const installed = deferred();
		let firstReady = false;
		let secondReady = false;
		const first = waitForEvent(source.world, () => firstReady, "first row did not arrive");
		const second = waitForEvent(
			source.world,
			() => {
				if (source.listenerCount() === 6) installed.resolve();
				return secondReady;
			},
			"second row did not arrive",
		);
		await installed.promise;
		firstReady = true;
		source.insert();
		await first;
		expect(source.listenerCount()).toBe(3);
		secondReady = true;
		source.insert();
		await second;
		expect(source.listenerCount()).toBe(0);
	});

	it("coalesces events during an async predicate and cleans up after its final inspection", async () => {
		const source = testWorld();
		const inspecting = deferred();
		const release = deferred();
		let ready = false;
		let calls = 0;
		const waiting = waitForEvent(
			source.world,
			async () => {
				calls += 1;
				if (calls === 2) {
					inspecting.resolve();
					await release.promise;
					return false;
				}
				return ready;
			},
			"async cache inspection did not settle",
		);
		await inspecting.promise;
		ready = true;
		for (let i = 0; i < 5; i++) source.insert();
		expect(calls).toBe(2);
		release.resolve();
		await waiting;
		expect(calls).toBe(3);
		expect(source.listenerCount()).toBe(0);
	});

	it("removes partially installed hooks if a later registration fails", async () => {
		const source = testWorld();
		source.table.onUpdate = () => {
			throw new Error("update hook unavailable");
		};
		await expect(waitForEvent(source.world, () => false, "not ready")).rejects.toThrow(
			"update hook unavailable",
		);
		expect(source.listenerCount()).toBe(0);
	});
});
