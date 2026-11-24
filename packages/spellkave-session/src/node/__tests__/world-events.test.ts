// sk-0m4.22: the session daemon holds ONE WorldEventBuilder for its whole
// lifetime and drains it on every invoke. Recreating the builder per call
// is finding #98 — a freshly constructed builder primes quiet and silently
// drops everything that happened between calls. These cases prove the
// accumulation + one-builder invariant without a live node: a fake feed
// (or the real `createWorldEventBuilder` over a SnapshotDb fixture) is
// enough, matching the legacy push-events tests.

import type { WorldActorSpan, WorldActorTracer } from "@spellkave/agent-observability";
import { asEntityRef, type SnapshotDb } from "@spellkave/sdk";
import { SPELLKAVE_ORIENT_TOOL } from "@spellkave/tool-contracts/schemas";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import type { SessionBinding } from "../../binding.ts";
import {
	createWorldEventBuilder,
	type WorldEvent,
	type WorldEventBuilder,
} from "../../player-tools/push-events.ts";
import { type InvokableTool, SessionDispatcher } from "../daemon.ts";
import { createSessionWorldEventFeed, type SessionWorldEventFeed } from "../world-events.ts";

const binding: SessionBinding = {
	url: "http://127.0.0.1:3000",
	db: "spellkave-dev",
	identity: "tok-abc",
	actorId: "1",
};

const ACTOR_ID = asEntityRef("1");

const dealtHit: WorldEvent = {
	kind: "dealt_hit",
	target_name: "Slime Scout",
	amount: 3,
	attacker_id: ACTOR_ID,
	observed_at_tick: 17,
};

const selfHit: WorldEvent = {
	kind: "self_hit",
	resource_id: "srd/hp",
	amount: 4,
	new_value: 7,
	attack_kind: "srd/attack/melee/outcome",
	attacker_id: "2",
	observed_at_tick: 18,
};

function echoTool(name: string): InvokableTool {
	return {
		name,
		parameters: Type.Object({}),
		execute: async () => ({
			content: [{ type: "text", text: "ok" }],
			details: {},
		}),
	};
}

class FakeTracer implements WorldActorTracer {
	readonly events: Array<{ name: string; attributes?: Record<string, unknown> }> = [];

	startSpan(): WorldActorSpan {
		return {
			addEvent: (name, attributes) => this.events.push({ name, attributes }),
			end() {},
		};
	}

	async flush(): Promise<void> {}
}

function scriptedBuilder(batches: WorldEvent[][]): WorldEventBuilder {
	const remaining = [...batches];
	return {
		diffAndAdvance: () => remaining.shift() ?? [],
		takeWhere: (predicate) => (remaining.shift() ?? []).filter(predicate),
	};
}

function scriptedFeed(batches: WorldEvent[][]): SessionWorldEventFeed {
	const remaining = [...batches];
	return {
		drain(): WorldEvent[] {
			return remaining.shift() ?? [];
		},
		// sk-0m4.73: `builder` is part of the interface (the daemon injects it
		// into the companion tools' reply-window option) but no case in this
		// file exercises it — a stub is enough to satisfy the type.
		builder: {
			diffAndAdvance: () => remaining.shift() ?? [],
			takeWhere: () => [],
		},
	};
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

/** Minimal SnapshotDb fixture matching `push-events.test.ts`'s own harness. */
function baseFixture(): {
	db: SnapshotDb;
	resourceDeltaRows: Record<string, unknown>[];
} {
	const resourceDeltaRows: Record<string, unknown>[] = [];
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
		visible_event_resource_delta: resourceDeltaRows,
		visible_affordance: [],
		affordance_template: [],
		visible_trace: [],
		entity: [],
		visible_entity_tag: [],
	});
	return { db, resourceDeltaRows };
}

describe("SessionDispatcher push piggyback (sk-0m4.22)", () => {
	it("omits `pushes` when no feed is wired (fake-registry test seam)", async () => {
		const dispatcher = new SessionDispatcher({ binding, tools: [echoTool("spellkave_scene")] });
		await expect(
			dispatcher.handle({ id: 1, op: "invoke", tool: "spellkave_scene", args: {} }),
		).resolves.toEqual({
			id: 1,
			ok: true,
			result: { content: [{ type: "text", text: "ok" }], details: {} },
		});
	});

	it("omits `pushes` when the feed drains empty", async () => {
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [echoTool("spellkave_scene")],
			pushes: scriptedFeed([[]]),
		});
		const response = await dispatcher.handle({
			id: 2,
			op: "invoke",
			tool: "spellkave_scene",
			args: {},
		});
		expect(response).toEqual({
			id: 2,
			ok: true,
			result: { content: [{ type: "text", text: "ok" }], details: {} },
		});
		expect("pushes" in response).toBe(false);
	});

	it("piggybacks pending events on a successful invoke", async () => {
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [echoTool("spellkave_scene")],
			pushes: scriptedFeed([[dealtHit, selfHit]]),
		});
		await expect(
			dispatcher.handle({ id: 3, op: "invoke", tool: "spellkave_scene", args: {} }),
		).resolves.toEqual({
			id: 3,
			ok: true,
			result: { content: [{ type: "text", text: "ok" }], details: {} },
			pushes: [dealtHit, selfHit],
		});
	});

	it("piggybacks pending events on a throwing tool (tool_error must not swallow them)", async () => {
		const throwing: InvokableTool = {
			name: "spellkave_boom",
			parameters: Type.Object({}),
			execute: async () => {
				throw new Error("kaboom");
			},
		};
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [throwing],
			pushes: scriptedFeed([[dealtHit]]),
		});
		await expect(
			dispatcher.handle({ id: 4, op: "invoke", tool: "spellkave_boom", args: {} }),
		).resolves.toEqual({
			id: 4,
			ok: false,
			error: { message: "kaboom", code: "tool_error" },
			pushes: [dealtHit],
		});
	});

	it("hello / status do not drain — a session-list probe must not swallow pending events", async () => {
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [],
			pushes: scriptedFeed([[dealtHit]]),
		});
		const hello = await dispatcher.handle({ id: 8, op: "hello" });
		const status = await dispatcher.handle({ id: 9, op: "status" });
		expect("pushes" in hello).toBe(false);
		expect("pushes" in status).toBe(false);
		await expect(dispatcher.handle({ id: 10, op: "drain_pushes" })).resolves.toMatchObject({
			id: 10,
			ok: true,
			pushes: [dealtHit],
		});
	});

	it("drain_pushes returns the same piggyback without inventing a PLAYER tool", async () => {
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [],
			pushes: scriptedFeed([[selfHit]]),
		});
		await expect(dispatcher.handle({ id: 5, op: "drain_pushes" })).resolves.toEqual({
			id: 5,
			ok: true,
			result: {},
			pushes: [selfHit],
		});
	});

	it("holds ONE feed across invokes: a second call sees only what arrived after the first drain", async () => {
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [echoTool("spellkave_scene")],
			pushes: scriptedFeed([[dealtHit], [selfHit]]),
		});
		const first = await dispatcher.handle({
			id: 6,
			op: "invoke",
			tool: "spellkave_scene",
			args: {},
		});
		const second = await dispatcher.handle({
			id: 7,
			op: "invoke",
			tool: "spellkave_scene",
			args: {},
		});
		expect(first).toMatchObject({ id: 6, ok: true, pushes: [dealtHit] });
		expect(second).toMatchObject({ id: 7, ok: true, pushes: [selfHit] });
	});
});

describe("world-event exactly-once failsafe (sk-0m4.75)", () => {
	const heard: WorldEvent = {
		kind: "speech_heard",
		inscribed_at: 2,
		trace_id: "42",
		trace_kind: "speech",
		text: "Mind the gap.",
		inscribed_by: "2",
		inscribed_by_name: "Guide",
		location_kind: "place_node",
		location_ref: "hall",
		observed_at_tick: 2,
	};

	function traceRow(traceId: bigint): Record<string, unknown> {
		return {
			traceId,
			kind: "speech",
			locationKind: "place_node",
			locationRef: "hall",
			payloadJson: JSON.stringify({ text: "Mind the gap." }),
			inscribedAt: 2,
			expiresAt: null,
			inscribedBy: 2n,
			visibility: { tag: "Public" },
			bundleId: "test",
		};
	}

	it("emits world_event_duplicate when one trace id is returned twice", () => {
		const tracer = new FakeTracer();
		const feed = createSessionWorldEventFeed({
			db: () => makeDb({ visible_trace: [] }),
			actorId: () => ACTOR_ID,
			telemetry: tracer,
			// First batch is consumed by construction-time priming.
			builder: scriptedBuilder([[], [heard], [heard]]),
		});

		expect(feed.drain()).toEqual([heard]);
		expect(feed.drain()).toEqual([heard]);
		expect(tracer.events).toEqual([
			{
				name: "world_event_duplicate",
				attributes: { "spellkave.cause_kind": "trace_id", "spellkave.cause_id": "42" },
			},
		]);
	});

	it("emits world_event_unreported on orient for a new visible reportable trace", async () => {
		const tracer = new FakeTracer();
		const rows: Record<string, unknown>[] = [];
		const db = makeDb({ visible_trace: rows });
		const feed = createSessionWorldEventFeed({
			db: () => db,
			actorId: () => ACTOR_ID,
			telemetry: tracer,
			builder: scriptedBuilder([[], []]),
		});
		rows.push(traceRow(42n));
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [echoTool(SPELLKAVE_ORIENT_TOOL)],
			pushes: feed,
		});

		await dispatcher.handle({ id: 20, op: "invoke", tool: SPELLKAVE_ORIENT_TOOL, args: {} });
		expect(tracer.events).toEqual([
			{
				name: "world_event_unreported",
				attributes: { "spellkave.cause_kind": "trace_id", "spellkave.cause_id": "42" },
			},
		]);
	});

	it("emits no failsafe event when a new visible trace is returned once", () => {
		const tracer = new FakeTracer();
		const rows: Record<string, unknown>[] = [];
		const db = makeDb({ visible_trace: rows });
		const feed = createSessionWorldEventFeed({
			db: () => db,
			actorId: () => ACTOR_ID,
			telemetry: tracer,
			builder: scriptedBuilder([[], [heard]]),
		});
		rows.push(traceRow(42n));

		expect(feed.drain({ auditVisibleTraces: true })).toEqual([heard]);
		expect(tracer.events).toEqual([]);
	});
});

describe("one-builder invariant (finding #98)", () => {
	it("already-true world state at construction is not news on the first drain", () => {
		const { db, resourceDeltaRows } = baseFixture();
		resourceDeltaRows.push({
			eventId: "preexisting",
			entityId: 1n,
			resourceId: "srd/hp",
			delta: -1,
			newValue: 10,
			templateId: "srd/attack/melee/outcome",
			sourceEntityRef: "2",
		});
		const feed = createSessionWorldEventFeed({
			db: () => db,
			actorId: () => ACTOR_ID,
		});
		expect(feed.drain()).toEqual([]);
	});

	it("createSessionWorldEventFeed primes at construction so the first invoke is not a silent swallow", () => {
		const { db, resourceDeltaRows } = baseFixture();
		const feed = createSessionWorldEventFeed({
			db: () => db,
			actorId: () => ACTOR_ID,
		});
		// Construction already primed. A hit that lands AFTER that is news on
		// the FIRST drain — the first `sk act` after daemon start.
		expect(feed.drain()).toEqual([]);

		resourceDeltaRows.push({
			eventId: "1001",
			entityId: 1n,
			resourceId: "srd/hp",
			delta: -4,
			newValue: 7,
			templateId: "srd/attack/melee/outcome",
			sourceEntityRef: "2",
		});
		expect(feed.drain()).toEqual<WorldEvent[]>([
			{
				kind: "self_hit",
				resource_id: "srd/hp",
				amount: 4,
				new_value: 7,
				attack_kind: "srd/attack/melee/outcome",
				attacker_id: "2",
				observed_at_tick: 1,
			},
		]);
		expect(feed.drain()).toEqual([]);

		// Recreating the builder NOW — the finding-#98 trap — silently reports
		// nothing, even though the same delta row is still in the snapshot.
		const recreated = createWorldEventBuilder(
			() => db,
			() => ACTOR_ID,
		);
		expect(recreated.diffAndAdvance()).toEqual([]);
		expect(recreated.diffAndAdvance()).toEqual([]);
		// The original feed still holds the seen-set and stays quiet too —
		// proving the hit was delivered exactly once, by the one builder.
		expect(feed.drain()).toEqual([]);
	});

	it("a drain that throws returns [] rather than failing the invoke", () => {
		const feed = createSessionWorldEventFeed({
			db: () => {
				throw new Error("disconnected");
			},
			actorId: () => ACTOR_ID,
		});
		expect(feed.drain()).toEqual([]);
	});
});
