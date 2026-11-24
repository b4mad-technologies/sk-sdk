import type { SpellkaveSession } from "@spellkave/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveScenesPort } from "../live-scenes-port";

function fixture() {
	let applied: () => void = () => {};
	let failed: () => void = () => {};
	const handle = { isActive: () => true, unsubscribe: vi.fn() };
	const builder = {
		onApplied(cb: () => void) {
			applied = cb;
			return builder;
		},
		onError(cb: () => void) {
			failed = cb;
			return builder;
		},
		subscribe() {
			return handle;
		},
	};
	const conn = {
		isActive: true,
		subscriptionBuilder: () => builder,
		db: {
			scene_source: {
				iter: () => [
					{
						graphId: "room",
						protocolVersion: 1,
						status: "complete-empty",
						worldInstanceId: "world",
						sourceDigest: "digest",
						snapshotJson: "{}",
					},
				],
			},
		},
	};
	const original = {
		conn,
		authenticatedIdentity: { toHexString: () => "caller" },
	} as unknown as SpellkaveSession;
	let session = original;
	const apply = vi.fn();
	const port = createLiveScenesPort({
		session: () => session,
		endpoint: () => "local/world",
		apply,
	});
	return {
		port,
		conn,
		handle,
		apply,
		applied: () => applied(),
		failed: () => failed(),
		switchCaller: () => {
			session = { ...original, conn: { ...original.conn } } as SpellkaveSession;
		},
	};
}
afterEach(() => vi.useRealTimers());
describe("caller scene source subscription", () => {
	it("returns an applied snapshot without waiting for unsubscribe acknowledgement", async () => {
		const f = fixture();
		const pending = f.port.snapshot("room");
		f.applied();
		expect(await pending).toMatchObject({
			caller: "caller",
			endpoint: "local/world",
			world_instance_id: "world",
		});
		expect(f.handle.unsubscribe).toHaveBeenCalledOnce();
	});
	it("rejects protocol errors without applying", async () => {
		const f = fixture();
		const pending = f.port.snapshot("room");
		f.failed();
		await expect(pending).rejects.toThrow("protocol unavailable");
		expect(f.apply).not.toHaveBeenCalled();
	});
	it("rejects a disconnected parent while the subscription is pending", async () => {
		vi.useFakeTimers();
		const f = fixture();
		const pending = f.port.snapshot("room");
		const rejected = expect(pending).rejects.toThrow("disconnected");
		f.conn.isActive = false;
		await vi.advanceTimersByTimeAsync(40);
		await rejected;
		expect(f.apply).not.toHaveBeenCalled();
	});
	it("rejects a caller switch before snapshot application", async () => {
		const f = fixture();
		const pending = f.port.snapshot("room");
		f.switchCaller();
		f.applied();
		await expect(pending).rejects.toThrow("changed");
		expect(f.apply).not.toHaveBeenCalled();
	});
});
