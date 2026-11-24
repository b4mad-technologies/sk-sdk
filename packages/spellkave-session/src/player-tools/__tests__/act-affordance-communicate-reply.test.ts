// sk-0m4.73: integration-level proof that `spellkave_communicate` fills
// `conversation.response` synchronously from a
// bounded event-driven reply window against a host-injected `WorldEventBuilder`
// (`tools.ts`'s `awaitConversationReply`) — and that doing so never
// duplicates or drops the underlying `speech_heard` event against the SAME
// builder's `pushes` feed (`push-events.ts`'s `takeWhere` carry contract).
// Uses the REAL `createWorldEventBuilder`, not a mock, so the zero-dup/
// zero-loss invariant is proven against the actual production primitive,
// exactly like `push-events.test.ts`'s own harness.

import {
	type ActorManipulateResult,
	asEntityRef,
	type SnapshotDb,
	type SpellkaveSession,
} from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import { createWorldEventBuilder } from "../push-events";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";
import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

/** What the session daemon passes (`DAEMON_REPLY_WINDOW_CAP_MS`, daemon.ts). */
const HOST_REPLY_WINDOW_CAP_MS = 8_000;

const ACTOR_ID = asEntityRef("1");
const NPC_ENTITY_ID = "2";

function slowTickEstimator(): SpellkaveSession["estimator"] {
	return { estimateMs: () => 1_500 } as SpellkaveSession["estimator"];
}

function makeDb(parts: Record<string, Array<Record<string, unknown>>>): SnapshotDb {
	const out: SnapshotDb = {
		visible_entity_tag: { iter: () => [] },
		visible_entity_tag_coverage: { iter: () => [{ status: "complete", projectionVersion: 1 }] },
	};
	for (const [accessor, rows] of Object.entries(parts)) {
		out[accessor] = { iter: () => rows.values() };
	}
	return out;
}

function textTraceRow(
	traceId: number,
	overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		traceId: BigInt(traceId),
		kind: "test/speech",
		locationKind: "entity",
		locationRef: ACTOR_ID,
		payloadJson: JSON.stringify({ text: "Well met, traveler." }),
		inscribedAt: 1n,
		expiresAt: undefined,
		inscribedBy: NPC_ENTITY_ID,
		visibility: "Local",
		bundleId: "test",
		...overrides,
	};
}

/**
 * One direct communicate target plus every table `createWorldEventBuilder`'s
 * domain scans unconditionally read every call
 * (same table set `push-events.test.ts`'s `baseFixture()` uses) — this
 * harness shares ONE db between the act-tool dispatch and the reply-window
 * builder, matching how a live host wires the daemon's ONE builder.
 */
function fixture(): {
	db: SnapshotDb;
	traceRows: Record<string, unknown>[];
} {
	const traceRows: Record<string, unknown>[] = [];
	const db = makeDb({
		world_time: [{ tick: 1n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		session: [],
		session_participant: [],
		visible_turn_state: [],
		visible_pending_resolution: [],
		visible_pending_resolution_reactor: [],
		visible_pending_stochastic_resolution: [],
		visible_event_resource_delta: [],
		visible_trace: traceRows,
		entity: [],
		visible_entity_tag: [],
	});
	return { db, traceRows };
}

function toolByName(context: SpellkaveToolContext, name: string): AgentTool {
	const tool = createSpellkaveTools(context).find((t) => t.name === name);
	if (!tool) throw new Error(`tool not found: ${name}`);
	return tool as AgentTool;
}

function scenario(
	overrides: Partial<NonNullable<SpellkaveToolContext["worldEvents"]>> = {},
	communicate: { targetId?: string; speechActId?: string } = {},
) {
	const { db, traceRows } = fixture();
	const builder = createWorldEventBuilder(
		() => db,
		() => ACTOR_ID,
	);
	builder.diffAndAdvance();
	const listeners = new Set<() => void>();
	const deadlines = new Set<{ at: number; notify: () => void }>();
	let now = 0;
	let rejected = false;
	const order: string[] = [];
	const capturedArgs: Array<string | undefined> = [];
	let opened!: () => void;
	const windowOpened = new Promise<void>((resolve) => {
		opened = resolve;
	});
	const context: SpellkaveToolContext = {
		db,
		act: {
			actorId: ACTOR_ID,
			actorClient: {
				manipulate: async <T>(
					target: string,
					action: string,
					args?: string,
				): Promise<ActorManipulateResult<T>> => {
					order.push("dispatch");
					capturedArgs.push(args);
					const base = {
						actor_id: ACTOR_ID,
						target_id: target,
						action_id: action,
						snapshot: null as T,
						lagWarning: false,
						observedAtTick: 1n,
					};
					return rejected
						? { status: "rejected", reason: "test rejection", ...base }
						: { status: "success", ...base };
				},
			},
		},
		worldEvents: {
			builder,
			replyWindowMs: 500,
			onUpdate(notify) {
				listeners.add(notify);
				return () => {
					listeners.delete(notify);
				};
			},
			replyClock: {
				now: () => now,
				schedule(notify, delayMs) {
					const timer = { at: now + delayMs, notify };
					deadlines.add(timer);
					return () => {
						deadlines.delete(timer);
					};
				},
			},
			releaseInvokeLock() {
				order.push("release");
				opened();
			},
			...overrides,
		},
	};
	return {
		context,
		builder,
		deadlines,
		listeners,
		order,
		capturedArgs,
		windowOpened,
		rejectNext() {
			rejected = true;
		},
		async invoke() {
			return toolByName(context, "spellkave_communicate").execute("communicate", {
				target_id: communicate.targetId ?? `entity:${NPC_ENTITY_ID}`,
				speech_act_id: communicate.speechActId ?? "core/greet",
				utterance: "Hello?",
			});
		},
		deliver(traceId = 1, row: Record<string, unknown> = {}) {
			traceRows.push(textTraceRow(traceId, row));
			for (const notify of [...listeners]) notify();
		},
		advance(ms: number) {
			now += ms;
			for (const timer of [...deadlines]) if (timer.at <= now) timer.notify();
		},
	};
}

describe("client-selected conversation delivery", () => {
	it("rejects a misconfigured bundling host before dispatching a world action", async () => {
		const h = scenario({ onUpdate: undefined });
		await expect(h.invoke()).rejects.toThrow("cache-update subscription");
		expect(h.order).toEqual([]);
	});
	it("scales an absent window from the live estimator", async () => {
		const h = scenario({ replyWindowMs: undefined, estimator: slowTickEstimator() });
		const result = h.invoke();
		await h.windowOpened;
		expect([...h.deadlines].map((timer) => timer.at)).toEqual([3000]);
		h.advance(2100);
		h.deliver();
		expect((await result).details).toMatchObject({
			conversation: { response: { trace_id: "1" }, awaiting_response: false },
		});
	});

	it("bundles an in-window reply and excludes it from later pushes", async () => {
		const h = scenario();
		const result = h.invoke();
		await h.windowOpened;
		h.deliver();
		expect((await result).details).toMatchObject({
			conversation: {
				response: { speaker: NPC_ENTITY_ID, text: "Well met, traveler.", trace_id: "1" },
				awaiting_response: false,
			},
		});
		expect(h.builder.diffAndAdvance()).toEqual([]);
		expect(h.listeners.size).toBe(0);
		expect(h.deadlines.size).toBe(0);
	});

	it("expires and delivers a later reply exactly once through pushes", async () => {
		const h = scenario({ replyWindowMs: 25 });
		const result = h.invoke();
		await h.windowOpened;
		h.advance(25);
		expect((await result).details).toMatchObject({
			conversation: { response: null, awaiting_response: true },
		});
		h.deliver();
		expect(h.builder.diffAndAdvance()).toMatchObject([{ kind: "speech_heard", trace_id: "1" }]);
		expect(h.builder.diffAndAdvance()).toEqual([]);
	});

	it("preserves unrelated speech received during the window", async () => {
		const h = scenario({ replyWindowMs: 25 });
		const result = h.invoke();
		await h.windowOpened;
		h.deliver(2, { inscribedBy: "3" });
		h.advance(25);
		expect((await result).details).toMatchObject({
			conversation: { response: null, awaiting_response: true },
		});
		expect(h.builder.diffAndAdvance()).toMatchObject([{ kind: "speech_heard", trace_id: "2" }]);
		expect(h.builder.diffAndAdvance()).toEqual([]);
	});

	it("caps the estimated window at the host bound", async () => {
		const h = scenario({
			replyWindowMs: undefined,
			estimator: { estimateMs: () => 10000 } as SpellkaveSession["estimator"],
			replyWindowCapMs: HOST_REPLY_WINDOW_CAP_MS,
		});
		const result = h.invoke();
		await h.windowOpened;
		expect([...h.deadlines].map((timer) => timer.at)).toEqual([HOST_REPLY_WINDOW_CAP_MS]);
		h.advance(HOST_REPLY_WINDOW_CAP_MS);
		expect((await result).details).toMatchObject({
			conversation: { response: null, awaiting_response: true },
		});
		h.deliver();
		expect(h.builder.diffAndAdvance()).toMatchObject([{ trace_id: "1" }]);
		expect(h.builder.diffAndAdvance()).toEqual([]);
	});

	it("honors an explicit window beyond the default host cap", async () => {
		const h = scenario({
			replyWindowMs: HOST_REPLY_WINDOW_CAP_MS + 1000,
			replyWindowCapMs: HOST_REPLY_WINDOW_CAP_MS,
		});
		const result = h.invoke();
		await h.windowOpened;
		expect([...h.deadlines].map((timer) => timer.at)).toEqual([HOST_REPLY_WINDOW_CAP_MS + 1000]);
		h.advance(HOST_REPLY_WINDOW_CAP_MS + 500);
		h.deliver();
		expect((await result).details).toMatchObject({
			conversation: { response: { trace_id: "1" }, awaiting_response: false },
		});
	});

	it("releases after accepted dispatch; rejection never starts a reply wait", async () => {
		const h = scenario();
		const result = h.invoke();
		await h.windowOpened;
		expect(h.order).toEqual(["dispatch", "release"]);
		h.deliver();
		await result;
		h.rejectNext();
		await h.invoke();
		expect(h.order).toEqual(["dispatch", "release", "dispatch"]);
		expect(h.listeners.size).toBe(0);
		expect(h.deadlines.size).toBe(0);
	});

	it("event-stream mode returns without opening a window or consuming speech", async () => {
		const h = scenario({ replyDelivery: "events" });
		h.deliver();
		const result = await h.invoke();
		expect(result.details).toMatchObject({
			conversation: { response: null, awaiting_response: true },
		});
		expect(h.order).toEqual(["dispatch"]);
		expect(h.listeners.size).toBe(0);
		expect(h.deadlines.size).toBe(0);
		expect(h.builder.diffAndAdvance()).toMatchObject([{ kind: "speech_heard", trace_id: "1" }]);
		expect(h.builder.diffAndAdvance()).toEqual([]);
	});

	it("leaves a second NPC line for the subsequent event drain", async () => {
		const h = scenario();
		const result = h.invoke();
		await h.windowOpened;
		h.deliver(1);
		h.deliver(2);
		expect((await result).details).toMatchObject({ conversation: { response: { trace_id: "1" } } });
		expect(h.builder.diffAndAdvance()).toMatchObject([{ trace_id: "2" }]);
		expect(h.builder.diffAndAdvance()).toEqual([]);
	});

	it("preserves the no-builder host contract", async () => {
		const h = scenario();
		delete h.context.worldEvents;
		expect((await h.invoke()).details).toMatchObject({
			conversation: { response: null, awaiting_response: true },
		});
	});
});

/**
 * ADR-0137 (sk-men.4): an addressee-less direct communicate request
 * (`target_id = "world"`, e.g. `srd/speak-aloud`) must dispatch WITHOUT the bundled-reply
 * host-wiring precondition and WITHOUT ever opening `awaitConversationReply`'s
 * wait — there is no addressee to reply. The direct tool's target scope is
 * the only variable versus the entity-targeted suite above.
 */

describe("addressee-less communicate (ADR-0137, no reply wait)", () => {
	it("dispatches with dispatch_text folded into args and never opens a reply wait, even with no host cache-update subscription wired", async () => {
		const h = scenario(
			{ onUpdate: undefined },
			{ targetId: "world", speechActId: "srd/speak-aloud" },
		);
		// The precondition this same describe's sibling above throws on
		// ("rejects a misconfigured bundling host") does NOT fire here — no
		// `onUpdate` is wired, exactly like that rejection case, but this row's
		// `target_scope` is "world" instead of "entity".
		const result = await h.invoke();
		expect(h.order).toEqual(["dispatch"]);
		expect(h.capturedArgs).toHaveLength(1);
		expect(JSON.parse(h.capturedArgs[0] ?? "{}")).toMatchObject({ dispatch_text: "Hello?" });
		expect(result.details).toMatchObject({
			receipt: { outcome: "accepted" },
			observation: 'You say: "Hello?"',
			conversation: { response: null, awaiting_response: true },
		});
	});

	it("still never opens a reply wait even when the host DOES wire onUpdate (the wait is skipped by target_scope, not by absent host wiring)", async () => {
		const h = scenario({}, { targetId: "world", speechActId: "srd/speak-aloud" });
		const result = await h.invoke();
		// No "release" in `order` — `releaseInvokeLock` is only called from
		// inside `awaitConversationReply`'s `waitForReply` registration, which
		// this branch never reaches for a world-scoped row.
		expect(h.order).toEqual(["dispatch"]);
		expect(h.listeners.size).toBe(0);
		expect(h.deadlines.size).toBe(0);
		expect(result.details).toMatchObject({
			conversation: { response: null, awaiting_response: true },
		});
	});
});
