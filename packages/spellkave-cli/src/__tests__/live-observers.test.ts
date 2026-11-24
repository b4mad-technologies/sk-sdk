import type { TestWorld } from "@spellkave/test-lab";
import { describe, expect, it, vi } from "vitest";
import { observeAfter } from "./live-observers";

function observer() {
	let applied!: () => void;
	let failed!: () => void;
	const unsubscribe = vi.fn();
	const subscription = { unsubscribe };
	const builder = {
		onApplied(fn: () => void) {
			applied = fn;
			return builder;
		},
		onError(fn: () => void) {
			failed = fn;
			return builder;
		},
		subscribe: vi.fn(() => subscription),
	};
	const world = { conn: { subscriptionBuilder: () => builder } } as unknown as TestWorld;
	return { world, builder, unsubscribe, applied: () => applied(), failed: () => failed() };
}

// keep(K5): hold socket callbacks independently to prove the live harness cannot read early.
describe("observer settlement", () => {
	it("waits for the write and every independent observer before exposing the result", async () => {
		const a = observer(),
			b = observer();
		let commit!: (result: string) => void;
		const write = new Promise<string>((resolve) => {
			commit = resolve;
		});
		let settled = false;
		const result = observeAfter(() => write, [a.world, b.world, a.world]);
		void result.then(() => {
			settled = true;
		});
		expect(a.builder.subscribe).not.toHaveBeenCalled();
		commit("receipt");
		await Promise.resolve();
		expect(a.builder.subscribe).toHaveBeenCalledTimes(1);
		expect(b.builder.subscribe).toHaveBeenCalledTimes(1);
		a.applied();
		await Promise.resolve();
		expect(settled).toBe(false);
		b.applied();
		expect(await result).toBe("receipt");
		expect(a.unsubscribe).toHaveBeenCalledOnce();
		expect(b.unsubscribe).toHaveBeenCalledOnce();
	});

	it("settles the observer before propagating a refusal to unchanged-state assertions", async () => {
		const a = observer();
		const refusal = new Error("admission refused");
		const result = observeAfter(async () => {
			throw refusal;
		}, [a.world]);
		const rejected = expect(result).rejects.toBe(refusal);
		await Promise.resolve();
		a.applied();
		await rejected;
	});

	it("fails when the observer fence fails", async () => {
		const a = observer();
		const result = observeAfter(async () => "receipt", [a.world]);
		const rejected = expect(result).rejects.toThrow("observer subscription fence failed");
		await Promise.resolve();
		a.failed();
		await rejected;
	});
});
