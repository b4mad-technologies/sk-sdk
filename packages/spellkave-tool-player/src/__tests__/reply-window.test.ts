import { describe, expect, it } from "vitest";
import { type ReplyWindowClock, waitForReply } from "../reply-window";

function harness() {
	let now = 0;
	const timers = new Set<{ at: number; callback: () => void }>();
	const listeners = new Set<() => void>();
	const replies: string[] = [];
	const clock: ReplyWindowClock = {
		now: () => now,
		schedule(callback, delayMs) {
			const timer = { at: now + delayMs, callback };
			timers.add(timer);
			return () => timers.delete(timer);
		},
	};
	const options = {
		clock,
		windowMs: 25,
		read: () => replies.shift(),
		subscribe(notify: () => void) {
			listeners.add(notify);
			return () => {
				listeners.delete(notify);
			};
		},
	};
	return {
		options,
		replies,
		timers,
		listeners,
		deliver(reply: string) {
			replies.push(reply);
			for (const notify of [...listeners]) notify();
		},
		advance(ms: number, fire = true) {
			now += ms;
			if (fire) for (const timer of [...timers]) if (timer.at <= now) timer.callback();
		},
	};
}

describe("event-driven reply window", () => {
	it("returns a buffered reply and removes its listener without scheduling", async () => {
		const h = harness();
		h.replies.push("early");
		expect(await waitForReply(h.options)).toBe("early");
		expect(h.listeners.size).toBe(0);
		expect(h.timers.size).toBe(0);
	});

	it("wakes on delivery, cancels the deadline and leaves a second reply untouched", async () => {
		const h = harness();
		const result = waitForReply(h.options);
		h.deliver("first");
		h.deliver("second");
		expect(await result).toBe("first");
		expect(h.replies).toEqual(["second"]);
		expect(h.listeners.size).toBe(0);
		expect(h.timers.size).toBe(0);
	});

	it("expires without another event and leaves late replies unclaimed", async () => {
		const h = harness();
		const result = waitForReply(h.options);
		h.advance(25);
		h.deliver("late");
		expect(await result).toBeNull();
		expect(h.replies).toEqual(["late"]);
		expect(h.listeners.size).toBe(0);
		expect(h.timers.size).toBe(0);
	});

	it("does not claim at the deadline even when timer delivery is congested", async () => {
		const h = harness();
		const result = waitForReply(h.options);
		h.advance(25, false);
		h.deliver("boundary");
		expect(await result).toBeNull();
		expect(h.replies).toEqual(["boundary"]);
		expect(h.timers.size).toBe(0);
	});

	it("cleans up on cancellation without consuming a later reply", async () => {
		const h = harness();
		const controller = new AbortController();
		const result = waitForReply({ ...h.options, signal: controller.signal });
		controller.abort(new Error("connection closed"));
		await expect(result).rejects.toThrow("connection closed");
		expect(h.listeners.size).toBe(0);
		expect(h.timers.size).toBe(0);
	});

	it("unsubscribes when a synchronous registration notification finds the reply", async () => {
		const h = harness();
		h.replies.push("during registration");
		const result = waitForReply({
			...h.options,
			subscribe(notify) {
				const cleanup = h.options.subscribe(notify);
				notify();
				return cleanup;
			},
		});
		expect(await result).toBe("during registration");
		expect(h.listeners.size).toBe(0);
	});

	it("cleans up when reading the event source fails", async () => {
		const h = harness();
		await expect(
			waitForReply({
				...h.options,
				read() {
					throw new Error("disconnected");
				},
			}),
		).rejects.toThrow("disconnected");
		expect(h.listeners.size).toBe(0);
		expect(h.timers.size).toBe(0);
	});
});
