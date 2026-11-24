import { afterEach, describe, expect, it, vi } from "vitest";

// Issue #1260: a connect-time row-deserialization error in the SpacetimeDB TS
// SDK is thrown from inside an `async` WebSocket `onmessage` handler that
// nobody awaits (`WebsocketDecompressAdapter#onmessage` wraps the real
// handler in an `async` callback assigned as a WS event-handler property).
// The throw surfaces only as a Node `unhandledRejection` — it hits neither
// `onConnectError` nor the subscription's `onApplied` callback, so
// `connectTestWorld`'s `ready` promise would otherwise never settle. This
// mocks the canonical SDK connect seam to reproduce exactly that shape
// (fire-and-forget rejection while `session.ready` never settles) without a
// live node or a real schema mismatch.
const { connectMock } = vi.hoisted(() => ({
	connectMock: vi.fn(),
}));

vi.mock("@spellkave/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@spellkave/sdk")>()),
	connect: connectMock,
}));

const { connectTestWorld } = await import("./live");

describe("connectTestWorld connect-time async failure (#1260)", () => {
	afterEach(() => {
		connectMock.mockReset();
	});

	it("rejects with the real SDK error instead of hanging until the outer hook timeout", async () => {
		connectMock.mockImplementation(async () => {
			void Promise.resolve().then(() => {
				throw new RangeError("simulated connect-time BSATN deserialization error");
			});
			return {
				conn: {},
				ready: new Promise<void>(() => {}),
				disconnect: vi.fn(),
			};
		});
		const started = Date.now();
		await expect(connectTestWorld({ connectTimeoutMs: 5_000 })).rejects.toThrow(
			/simulated connect-time BSATN deserialization error/,
		);
		// The whole point of #1260: this must fail in ~milliseconds via the
		// unhandledRejection route, not wait out the 5s connect deadline.
		expect(Date.now() - started).toBeLessThan(1_000);
	});
});
