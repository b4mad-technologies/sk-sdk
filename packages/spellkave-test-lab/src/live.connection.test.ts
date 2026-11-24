import { afterEach, describe, expect, it, vi } from "vitest";

const { connectMock } = vi.hoisted(() => ({
	connectMock: vi.fn(),
}));

vi.mock("@spellkave/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@spellkave/sdk")>()),
	connect: connectMock,
}));

const { connectTestWorld } = await import("./live");

afterEach(() => {
	connectMock.mockReset();
});

describe("connectTestWorld SDK lifecycle", () => {
	it("adapts sdk.connect without changing the TestWorld contract", async () => {
		const dynamicSubscriptions: (readonly string[])[] = [];
		const db = { actor: { iter: () => [] } };
		const disconnect = vi.fn();
		const conn = {
			db,
			subscriptionBuilder() {
				let onApplied: (() => void) | undefined;
				const builder = {
					onApplied(callback: () => void) {
						onApplied = callback;
						return builder;
					},
					onError() {
						return builder;
					},
					subscribe(queries: readonly string[]) {
						dynamicSubscriptions.push(queries);
						onApplied?.();
						return builder;
					},
				};
				return builder;
			},
		};
		connectMock.mockResolvedValue({
			conn,
			ready: Promise.resolve(),
			authenticatedIdentity: "claimed-identity",
			authenticatedToken: "issued-token",
			disconnect,
		});

		const world = await connectTestWorld({
			url: "http://node.test",
			db: "test-db",
			connectedActorId: "proof/hero",
			readerManifests: [{ requiredTables: ["actor"] }],
			token: null,
		});

		expect(connectMock).toHaveBeenCalledWith(
			{
				url: "http://node.test",
				db: "test-db",
				connectedActorId: "proof/hero",
				readerManifests: [
					{ requiredTables: ["actor"] },
					{ requiredTables: ["manifest_apply_digest", "manifest_apply_outcome"] },
				],
				token: null,
			},
			{
				onDisconnect: expect.any(Function),
				onError: expect.any(Function),
				onUpdate: expect.any(Function),
			},
		);
		expect(world.conn).toBe(conn);
		expect(world.db()).toBe(db);
		expect(world.identity).toBe("claimed-identity");
		expect(world.token).toBe("issued-token");

		await world.subscribeReaders([{ requiredTables: ["actor", "visible_object_state"] }]);
		await world.subscribeReaders([{ requiredTables: ["visible_object_state"] }]);
		// ci-allow(raw-sql): asserts subscribeReaders()'s derived top-up query - an expected value, not a subscription call
		expect(dynamicSubscriptions).toEqual([["SELECT * FROM visible_object_state"]]);

		world.disconnect();
		expect(disconnect).toHaveBeenCalledOnce();
	});

	it("times out a stalled SDK preflight and closes a connection that arrives late", async () => {
		const disconnect = vi.fn();
		let resolveConnect:
			| ((session: { conn: object; ready: Promise<void>; disconnect(): void }) => void)
			| undefined;
		connectMock.mockReturnValue(
			new Promise((resolve) => {
				resolveConnect = resolve;
			}),
		);

		await expect(connectTestWorld({ connectTimeoutMs: 5 })).rejects.toThrow(
			/connect\/subscribe did not settle within 5ms/,
		);

		resolveConnect?.({
			conn: {},
			ready: Promise.resolve(),
			disconnect,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		expect(disconnect).toHaveBeenCalledOnce();
	});
});
