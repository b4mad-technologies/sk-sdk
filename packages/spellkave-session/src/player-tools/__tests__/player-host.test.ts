import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionController } from "../../node/connection-controller.ts";
import { createPlayerHost } from "../player-host.ts";

const choices = vi.hoisted(() => ({ rows: [] as Array<{ kind: string; bodyId: string }> }));
vi.mock("../../acting-context.ts", () => ({
	createActingContextSelector: () => ({
		read: () => choices.rows,
		resolve: () => ({ bodyId: "other" }),
	}),
}));

describe("bound player host", () => {
	beforeEach(() => {
		choices.rows = [
			{ kind: "character", bodyId: "hero" },
			{ kind: "presence", bodyId: "other" },
		];
	});
	// K1: this fence prevents a different controlled body from receiving actions.
	it("pins actions to the connected character and fails closed when it disappears", () => {
		let disconnected = () => {};
		const session = { conn: { reducers: {} } };
		const controller = {
			active: () => ({ session, actor: "hero" }),
			onDisconnected: (fn: () => void) => {
				disconnected = fn;
				return () => {};
			},
		} as unknown as ConnectionController;
		const host = createPlayerHost(controller, { boundCharacter: true });
		const actorId = host.context.act?.actorId as () => string;
		expect(actorId()).toBe("hero");
		const signal = host.context.worldEvents?.replySignal;
		disconnected();
		expect(signal?.aborted).toBe(true);
		choices.rows = [{ kind: "presence", bodyId: "other" }];
		expect(() => actorId()).toThrow("acting_context_unavailable");
		host.dispose();
	});
});
