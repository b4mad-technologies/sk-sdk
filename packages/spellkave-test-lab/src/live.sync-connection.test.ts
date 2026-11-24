import { afterEach, describe, expect, it, vi } from "vitest";

import { SyncConnectionTimeoutError, syncConnection } from "./live";

function fakeWorld(debugSyncMarker: (args: object) => Promise<void>) {
	return {
		identity: "c200feed",
		conn: { reducers: { debugSyncMarker } },
	} as never;
}

describe("syncConnection", () => {
	afterEach(() => {
		vi.useRealTimers();
	});

	it("resolves only after the no-op reducer call on that connection resolves", async () => {
		let release: () => void = () => {};
		const calls: object[] = [];
		const world = fakeWorld((args) => {
			calls.push(args);
			return new Promise<void>((resolve) => {
				release = resolve;
			});
		});
		let settled = false;
		const sync = syncConnection(world).then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(calls).toEqual([{}]);
		expect(settled).toBe(false);
		release();
		await sync;
		expect(settled).toBe(true);
	});

	it("throws a loud timeout naming the connection and the timeout", async () => {
		vi.useFakeTimers();
		const world = fakeWorld(() => new Promise<void>(() => {}));
		const sync = syncConnection(world, 250);
		const assertion = expect(sync).rejects.toThrow(
			/debug_sync_marker on connection c200feed did not return within 250 ms/,
		);
		await vi.advanceTimersByTimeAsync(250);
		await assertion;
		await expect(sync).rejects.toBeInstanceOf(SyncConnectionTimeoutError);
	});

	it("surfaces a rejected reducer call with the publish hint instead of continuing", async () => {
		const world = fakeWorld(() => Promise.reject(new Error("no such reducer")));
		await expect(syncConnection(world)).rejects.toThrow(
			/debug_sync_marker failed on connection c200feed: no such reducer .*connection barrier/,
		);
	});
});
