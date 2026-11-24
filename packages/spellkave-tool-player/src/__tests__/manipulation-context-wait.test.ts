// sk-jay0.1.46 (run 2): `spellkave_manipulation_context` can wait for the next
// open prompt instead of being polled. The wait rides the same cache
// notification the communicate reply window uses (`waitForReply`), so these
// cases drive a fake clock and a fake `onUpdate` and swap the snapshot the
// tool reads between notifications, exactly as a cache delivery would.
import { snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import type { ReplyWindowClock } from "../reply-window";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

const PROMPT_ROW = {
	promptFactId: "prompt:1:101",
	perceiverEntityId: 1n,
	occurrenceId: 101n,
	promptDefId: "dm/creation/class",
	contractVersion: 1,
	sourceRef: "entity:3",
	responseActionIds: ["dm/dialog/choice/1"],
	openedAtTick: 2n,
	consumed: false,
};

function snapshot(prompts: (typeof PROMPT_ROW)[]) {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		world_time: [{ tick: 1n }],
		entity: [{ entityId: 1n, name: "Actor" }],
		visible_manipulation_context: [
			{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true },
		],
		visible_manipulation_prompt: prompts,
	});
}

function harness(options: { prompts?: (typeof PROMPT_ROW)[]; replyWindowCapMs?: number } = {}) {
	let now = 0;
	let db = snapshot(options.prompts ?? []);
	const timers = new Set<{ at: number; callback: () => void }>();
	const listeners = new Set<() => void>();
	let released = 0;
	const clock: ReplyWindowClock = {
		now: () => now,
		schedule(callback, delayMs) {
			const timer = { at: now + delayMs, callback };
			timers.add(timer);
			return () => timers.delete(timer);
		},
	};
	const context = {
		db: () => db,
		act: { actorId: "1" },
		worldEvents: {
			builder: {},
			onUpdate(notify: () => void) {
				listeners.add(notify);
				return () => {
					listeners.delete(notify);
				};
			},
			replyClock: clock,
			releaseInvokeLock: () => {
				released += 1;
			},
			...(options.replyWindowCapMs === undefined
				? {}
				: { replyWindowCapMs: options.replyWindowCapMs }),
		},
	} as unknown as SpellkaveToolContext;
	const map = createPlayerFacingToolMap(context);
	return {
		map,
		listeners,
		timers,
		released: () => released,
		deliver(prompts: (typeof PROMPT_ROW)[]) {
			db = snapshot(prompts);
			for (const notify of [...listeners]) notify();
		},
		advance(ms: number) {
			now += ms;
			for (const timer of [...timers]) if (timer.at <= now) timer.callback();
		},
	};
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("spellkave_manipulation_context wait_for_prompt_ms", () => {
	it("reads immediately and reports nothing about waiting when the field is omitted", async () => {
		const h = harness();
		const result = await h.map.manipulationContext.execute("context", {});
		expect(result).toMatchObject({ details: { manipulation_context: { prompts: [] } } });
		expect(JSON.stringify(result)).not.toContain("prompt_wait");
		expect(h.listeners.size).toBe(0);
		expect(h.released()).toBe(0);
	});

	it("answers with the bounded summary by default and the registry on detail=full", async () => {
		const h = harness({ prompts: [PROMPT_ROW] });
		const summary = await h.map.manipulationContext.execute("context", {});
		expect(summary).toMatchObject({
			details: {
				manipulation_context: {
					status: "ready",
					detail: "summary",
					actions_total: 0,
					more_action_ids: [],
					prompts: [{ occurrence_id: "101" }],
				},
			},
		});
		const full = await h.map.manipulationContext.execute("context", { detail: "full" });
		expect(full).toMatchObject({ details: { manipulation_context: { status: "ready" } } });
		expect(JSON.stringify(full)).not.toContain("more_action_ids");
		expect(JSON.stringify(full)).not.toContain('"detail"');
	});

	it("returns at once when a prompt is already open", async () => {
		const h = harness({ prompts: [PROMPT_ROW] });
		const result = await h.map.manipulationContext.execute("context", {
			wait_for_prompt_ms: 5000,
		});
		expect(result).toMatchObject({
			details: {
				manipulation_context: { prompts: [{ occurrence_id: "101" }] },
				prompt_wait: { status: "already_open", waited_ms: 0 },
			},
		});
		expect(h.listeners.size).toBe(0);
	});

	it("wakes on the cache delivery that opens the prompt and returns the fresh context", async () => {
		const h = harness();
		const pending = h.map.manipulationContext.execute("context", { wait_for_prompt_ms: 5000 });
		await settle();
		expect(h.listeners.size).toBe(1);
		expect(h.released()).toBe(1);
		h.advance(1500);
		h.deliver([PROMPT_ROW]);
		const result = await pending;
		expect(result).toMatchObject({
			details: {
				manipulation_context: {
					prompts: [{ occurrence_id: "101", response_action_ids: ["dm/dialog/choice/1"] }],
				},
				prompt_wait: { status: "opened", waited_ms: 1500, window_ms: 5000 },
			},
		});
		expect(h.listeners.size).toBe(0);
		expect(h.timers.size).toBe(0);
	});

	it("ignores a delivery that opens no prompt and keeps waiting", async () => {
		const h = harness();
		const pending = h.map.manipulationContext.execute("context", { wait_for_prompt_ms: 5000 });
		await settle();
		h.advance(500);
		h.deliver([]);
		h.advance(500);
		h.deliver([{ ...PROMPT_ROW, consumed: true }]);
		await settle();
		expect(h.listeners.size).toBe(1);
		h.advance(500);
		h.deliver([
			{ ...PROMPT_ROW, consumed: true },
			{ ...PROMPT_ROW, occurrenceId: 102n },
		]);
		const result = await pending;
		expect(result).toMatchObject({
			details: { prompt_wait: { status: "opened", waited_ms: 1500 } },
		});
	});

	it("returns the current context at the deadline when no prompt opened", async () => {
		const h = harness();
		const pending = h.map.manipulationContext.execute("context", { wait_for_prompt_ms: 3000 });
		await settle();
		h.advance(3000);
		const result = await pending;
		expect(result).toMatchObject({
			details: {
				manipulation_context: { prompts: [] },
				prompt_wait: { status: "timed_out", waited_ms: 3000, window_ms: 3000 },
			},
		});
		expect(h.listeners.size).toBe(0);
	});

	it("bounds the wait by the host's reply window cap", async () => {
		const h = harness({ replyWindowCapMs: 8000 });
		const pending = h.map.manipulationContext.execute("context", { wait_for_prompt_ms: 30000 });
		await settle();
		h.advance(8000);
		const result = await pending;
		expect(result).toMatchObject({
			details: { prompt_wait: { status: "timed_out", window_ms: 8000 } },
		});
	});

	it("says so instead of waiting when the host wired no cache-update subscription", async () => {
		const map = createPlayerFacingToolMap({
			db: snapshot([]),
			act: { actorId: "1" },
		} as unknown as SpellkaveToolContext);
		const result = await map.manipulationContext.execute("context", { wait_for_prompt_ms: 5000 });
		expect(result).toMatchObject({
			details: { prompt_wait: { status: "unsupported", waited_ms: 0 } },
		});
	});
});
