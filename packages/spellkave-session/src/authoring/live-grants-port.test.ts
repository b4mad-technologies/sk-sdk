import type { SpellkaveSession } from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";
import { createLiveGrantsPort } from "./live-grants-port";

function session(supported = true) {
	const row = {
		protocolVersion: 1,
		roleId: "dm",
		extentKindRef: "place_graph",
		extentRef: "forest",
		canBind: true,
		expansionMember: true,
		expansionComplete: true,
		worldInstanceId: "epoch",
		observedTick: 90n,
		publisher: false,
	};
	const subscribe = vi.fn();
	const builder = {
		onApplied(fn: () => void) {
			this.applied = fn;
			return this;
		},
		applied: () => {},
		onError() {
			return this;
		},
		subscribe(query: unknown) {
			subscribe(query);
			this.applied();
			return {};
		},
	};
	const value = {
		grantProtocolSupported: supported,
		authenticatedIdentity: { toHexString: () => "a".repeat(64) },
		conn: {
			subscriptionBuilder: () => builder,
			db: {
				grant_inventory: { iter: () => [row] },
				visible_role_binding: {
					iter: () => [
						{
							bindingId: "own",
							bundleId: "",
							subject: "a".repeat(64),
							roleId: "dm",
							extentKindRef: "place_graph",
							extentRef: "forest",
							expiresAtTick: 0n,
							description: "",
						},
					],
				},
			},
		},
	} as unknown as SpellkaveSession;
	return { value, row, subscribe };
}
describe("caller grant port", () => {
	it("uses only the current caller views, normalizes permanent expiry and caches a session subscription", async () => {
		let current = session();
		const apply = vi.fn(async () => ({ ok: true }));
		const port = createLiveGrantsPort({
			session: () => current.value,
			endpoint: () => "http://local/world",
			apply,
		});
		const first = await port.snapshot();
		expect(first.identity).toBe("a".repeat(64));
		expect(first.publisher).toBe(false);
		expect(first.bindings[0]?.expires_at_tick).toBeNull();
		await port.snapshot();
		expect(current.subscribe).toHaveBeenCalledTimes(1);
		current = session();
		await port.snapshot();
		expect(current.subscribe).toHaveBeenCalledTimes(1);
		await port.apply("caller delta");
		expect(apply).toHaveBeenCalledWith("caller delta");
	});
	it("feature disables older modules without subscribing or falling back to publisher credentials", async () => {
		const current = session(false),
			apply = vi.fn(async () => ({ ok: true }));
		const port = createLiveGrantsPort({
			session: () => current.value,
			endpoint: () => "local",
			apply,
		});
		await expect(port.snapshot()).rejects.toThrow("unsupported");
		expect(current.subscribe).not.toHaveBeenCalled();
		expect(apply).not.toHaveBeenCalled();
	});
});
