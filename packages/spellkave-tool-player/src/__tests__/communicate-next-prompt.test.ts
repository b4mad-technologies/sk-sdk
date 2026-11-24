// sk-jay0.1.47 (run 3): a prompt-bound answer through spellkave_communicate
// carries the next open prompt row on its receipt, waited for inside what is
// left of the reply window, so a creation choice costs one call instead of
// communicate + manipulation_context(wait_for_prompt_ms). Same fake clock and
// fake cache notification as manipulation-context-wait.test.ts.
import { snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";
import type { ReplyWindowClock } from "../reply-window";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

const ANSWERED = {
	promptFactId: "prompt:1:101",
	perceiverEntityId: 1n,
	occurrenceId: 101n,
	promptDefId: "dm/creation/name",
	contractVersion: 1,
	sourceRef: "entity:3",
	responseActionIds: ["dm/creation/input/name"],
	openedAtTick: 2n,
	consumed: false,
};
const NEXT = {
	...ANSWERED,
	promptFactId: "prompt:1:102",
	occurrenceId: 102n,
	promptDefId: "dm/creation/class",
};

function snapshot(prompts: (typeof ANSWERED)[]) {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		world_time: [{ tick: 1n }],
		entity: [
			{ entityId: 1n, name: "Actor" },
			{ entityId: 3n, name: "Aldwin" },
		],
		visible_manipulation_context: [
			{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true },
		],
		visible_manipulation_prompt: prompts,
		// The name step is an authored input form (ui.affordance_input), the
		// greeting is plain speech.
		affordance_template: [
			{ templateId: "dm/creation/input/name/template", displayName: "Name" },
			{ templateId: "dm/dialog/greet/template", displayName: "Greet" },
		],
		action_definition: [
			{
				actionId: "dm/creation/input/name",
				displayName: "Name your character",
				selfOnly: false,
				selfEligible: false,
			},
			{ actionId: "dm/dialog/greet", displayName: "Greet", selfOnly: false, selfEligible: false },
		],
		outcome_template: [
			{
				outcomeTemplateId: "dm/creation/input/name/outcome",
				manipulationActionId: "dm/creation/input/name",
			},
			{ outcomeTemplateId: "dm/dialog/greet/outcome", manipulationActionId: "dm/dialog/greet" },
		],
		visible_manipulation_available_action: [
			{
				perceiverEntityId: 1n,
				actionId: "dm/creation/input/name",
				templateIds: ["dm/creation/input/name/template"],
				nicheIds: [],
			},
			{
				perceiverEntityId: 1n,
				actionId: "dm/dialog/greet",
				templateIds: ["dm/dialog/greet/template"],
				nicheIds: [],
			},
		],
		public_metadata_attachment: [
			{
				rowId: 1n,
				namespace: "ui.affordance_input",
				targetKind: "affordance_template",
				targetRef: "dm/creation/input/name/template",
				audience: "public",
				payloadJson: JSON.stringify({
					fields: [{ name: "name", label: "Name", control: "text" }],
				}),
			},
		],
		visible_metadata_attachment: [],
	});
}

function harness(options: { prompts?: (typeof ANSWERED)[] } = {}) {
	let now = 0;
	let db = snapshot(options.prompts ?? [ANSWERED]);
	const timers = new Set<{ at: number; callback: () => void }>();
	const listeners = new Set<() => void>();
	let replyEvent: Record<string, unknown> | undefined;
	const clock: ReplyWindowClock = {
		now: () => now,
		schedule(callback, delayMs) {
			const timer = { at: now + delayMs, callback };
			timers.add(timer);
			return () => timers.delete(timer);
		},
	};
	const manipulate = vi.fn(async () => ({ status: "success" as const }));
	const context = {
		db: () => db,
		act: { actorId: "1", actorClient: { manipulate } },
		worldEvents: {
			builder: {
				takeWhere(predicate: (event: Record<string, unknown>) => boolean) {
					if (replyEvent !== undefined && predicate(replyEvent)) {
						const hit = replyEvent;
						replyEvent = undefined;
						return [hit];
					}
					return [];
				},
			},
			onUpdate(notify: () => void) {
				listeners.add(notify);
				return () => {
					listeners.delete(notify);
				};
			},
			replyClock: clock,
			replyWindowMs: 5000,
			releaseInvokeLock: () => {},
		},
	} as unknown as SpellkaveToolContext;
	const map = createPlayerFacingToolMap(context);
	const notifyAll = () => {
		for (const notify of [...listeners]) notify();
	};
	return {
		map,
		listeners,
		timers,
		advance(ms: number) {
			now += ms;
			for (const timer of [...timers]) if (timer.at <= now) timer.callback();
		},
		deliverReply() {
			replyEvent = {
				kind: "speech_heard",
				inscribed_by: "3",
				inscribed_by_name: "Aldwin",
				text: "And your class?",
				trace_id: "t1",
			};
			notifyAll();
		},
		deliverPrompts(prompts: (typeof ANSWERED)[]) {
			db = snapshot(prompts);
			notifyAll();
		},
	};
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

const ANSWER_ARGS = JSON.stringify({
	semantic_context: { source_ref: "entity:3", occurrence_id: "101" },
	dispatch_text: "Brannoc",
});

describe("spellkave_communicate next_prompt", () => {
	it("plain speech carries no next_prompt and opens no prompt wait", async () => {
		const h = harness();
		const pending = h.map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/dialog/greet",
			utterance: "Hello",
		});
		await settle();
		h.deliverReply();
		const result = await pending;
		expect(JSON.stringify(result)).not.toContain("next_prompt");
		expect(h.listeners.size).toBe(0);
	});

	it("returns the next open prompt row that opens after the reply, inside the reply window", async () => {
		const h = harness();
		const pending = h.map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			args_json: ANSWER_ARGS,
		});
		await settle();
		h.advance(1000);
		h.deliverReply();
		await settle();
		// The answered row is still unconsumed in this stale snapshot: it must
		// not be returned as "next".
		expect(h.listeners.size).toBe(1);
		h.advance(1500);
		h.deliverPrompts([{ ...ANSWERED, consumed: true }, NEXT]);
		const result = await pending;
		expect(result).toMatchObject({
			details: {
				receipt: {
					communicate: { status: "success" },
					next_prompt: {
						status: "opened",
						waited_ms: 1500,
						window_ms: 5000,
						prompts: [{ occurrence_id: "102", prompt_def_id: "dm/creation/class" }],
					},
				},
				conversation: { response: { text: "And your class?" } },
			},
		});
		expect(h.listeners.size).toBe(0);
		expect(h.timers.size).toBe(0);
	});

	it("reports already_open without waiting when the next row is there at reply time", async () => {
		const h = harness();
		const pending = h.map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			args_json: ANSWER_ARGS,
		});
		await settle();
		h.deliverPrompts([ANSWERED, NEXT]);
		h.deliverReply();
		const result = await pending;
		expect(result).toMatchObject({
			details: {
				receipt: {
					next_prompt: {
						status: "already_open",
						waited_ms: 0,
						prompts: [{ occurrence_id: "102" }],
					},
				},
			},
		});
	});

	it("keeps a grace floor after a reply that used the whole window (run 4: window_ms 0)", async () => {
		const h = harness();
		const pending = h.map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			args_json: ANSWER_ARGS,
		});
		await settle();
		h.advance(5000);
		h.deliverReply();
		await settle();
		expect(h.listeners.size).toBe(1);
		h.advance(1000);
		h.deliverPrompts([{ ...ANSWERED, consumed: true }, NEXT]);
		const result = await pending;
		expect(result).toMatchObject({
			details: {
				receipt: {
					next_prompt: {
						status: "opened",
						waited_ms: 1000,
						window_ms: 5000,
						prompts: [{ occurrence_id: "102" }],
					},
				},
			},
		});
	});

	it("measures the grace from the reply: a reply at two ticks still leaves five seconds for the prompt", async () => {
		const h = harness();
		const pending = h.map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			args_json: ANSWER_ARGS,
		});
		await settle();
		h.advance(4000);
		h.deliverReply();
		await settle();
		h.advance(4500);
		h.deliverPrompts([{ ...ANSWERED, consumed: true }, NEXT]);
		const result = await pending;
		expect(result).toMatchObject({
			details: {
				receipt: {
					next_prompt: { status: "opened", waited_ms: 4500, window_ms: 5000 },
				},
			},
		});
	});

	it("an accepted utterance on an authored input form also waits for the next prompt (run 6: the name step)", async () => {
		// No prompt is open when the name is spoken; the adoption offer opens later.
		const h = harness({ prompts: [] });
		const pending = h.map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			utterance: "Borin",
		});
		await settle();
		h.advance(1000);
		h.deliverReply();
		await settle();
		expect(h.listeners.size).toBe(1);
		h.advance(2000);
		h.deliverPrompts([NEXT]);
		const result = await pending;
		expect(result).toMatchObject({
			details: {
				receipt: {
					next_prompt: { status: "opened", waited_ms: 2000, prompts: [{ occurrence_id: "102" }] },
				},
			},
		});
	});

	it("times out at the end of the shared window and returns no rows", async () => {
		const h = harness();
		const pending = h.map.communicate.execute("communicate", {
			target_id: "entity:3",
			speech_act_id: "dm/creation/input/name",
			args_json: ANSWER_ARGS,
		});
		await settle();
		h.advance(2000);
		h.deliverReply();
		await settle();
		h.advance(5000);
		const result = await pending;
		expect(result).toMatchObject({
			details: {
				receipt: {
					next_prompt: { status: "timed_out", waited_ms: 5000, window_ms: 5000, prompts: [] },
				},
			},
		});
		expect(h.listeners.size).toBe(0);
	});
});
