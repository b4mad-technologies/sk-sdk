// sk-jay0.1.46.7: a move longer than the actor's reach is a journey of
// several ticks. `wait_for_arrival_ms` on `spellkave_move` and
// `spellkave_scene` waits for the travel session to close instead of leaving
// the player to poll (81 of 141 calls in the run measured for sk-jay0.1.75).
// The wait rides the cache-notification window the prompt wait uses, so these
// cases drive a fake clock and a fake `onUpdate`, and mutate the row arrays
// the snapshot reads exactly as a cache delivery would.

import { asEntityRef, type SnapshotDb } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import { createWorldEventBuilder } from "../push-events";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";
import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

const ACTOR_ID = asEntityRef("1");

type Rows = Record<string, unknown>[];

function makeDb(parts: Record<string, Rows>): SnapshotDb {
	const out: SnapshotDb = {
		visible_entity_tag: { iter: () => [] },
		visible_entity_tag_coverage: { iter: () => [{ status: "complete", projectionVersion: 1 }] },
	};
	for (const [accessor, rows] of Object.entries(parts)) {
		out[accessor] = { iter: () => rows.values() };
	}
	return out;
}

function toolByName(context: SpellkaveToolContext, name: string): AgentTool {
	const tool = createSpellkaveTools(context).find((t) => t.name === name);
	if (!tool) throw new Error(`tool not found: ${name}`);
	return tool as AgentTool;
}

function harness(options: { replyWindowCapMs?: number; withUpdates?: boolean } = {}) {
	let now = 0;
	const timers = new Set<{ at: number; callback: () => void }>();
	const listeners = new Set<() => void>();
	let released = 0;
	const sessions: Rows = [];
	const participants: Rows = [];
	const location: Rows = [{ entityId: 1n, placeNodeId: "inn" }];
	const worldTime: Rows = [{ tick: 3n }];
	const db = makeDb({
		world_time: worldTime,
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		visible_session: sessions,
		visible_session_participant: participants,
		session: [],
		session_participant: [],
		visible_turn_state: [],
		visible_pending_resolution: [],
		visible_pending_resolution_reactor: [],
		visible_pending_stochastic_resolution: [],
		visible_event_resource_delta: [],
		visible_affordance: [],
		affordance_template: [],
		visible_trace: [],
		entity: [{ entityId: 1n, name: "Hero" }],
		visible_actor_spatial_location: location,
		visible_place_node: [
			{ nodeId: "inn", placeGraphId: "town", description: "Warm light.", posPresent: false },
			{ nodeId: "road", placeGraphId: "town", description: "Remote.", posPresent: false },
		],
		visible_place_graph_definition: [{ placeGraphId: "town", description: "A small town." }],
		visible_place_edge: [{ edgeId: 7n, fromNodeId: "inn", toNodeId: "road" }],
	});
	const startJourney = () => {
		sessions.push({
			sessionId: 99n,
			sessionDefId: "core/long_running_action",
			lifecycle: "active",
			currentActor: "1",
			stateJson: "{}",
			openedAt: 3n,
			promotedDurationTicks: 4n,
			originatingAction: "core/walk",
		});
		participants.push({ sessionId: 99n, actorId: "1", ordinal: 0, joinedAt: 3n });
	};
	const builder = createWorldEventBuilder(
		() => db,
		() => ACTOR_ID,
	);
	builder.diffAndAdvance();
	const context: SpellkaveToolContext = {
		db,
		act: {
			actorId: ACTOR_ID,
			actorClient: {
				move: async () => {
					startJourney();
					return {
						status: "travelling" as const,
						actor_id: ACTOR_ID,
						edge_id: "7",
						from_node: "inn",
						to_node: "road",
						actor_snapshot: null,
						lagWarning: false,
						observedAtTick: 3n,
						arrives_in_ticks: 4,
						arrives_at_tick: 7,
						session_id: "99",
						reason: "travelling to 'road' — arrives in 4 ticks",
					};
				},
			},
		},
		worldEvents: {
			builder,
			...(options.withUpdates === false
				? {}
				: {
						onUpdate(notify: () => void) {
							listeners.add(notify);
							return () => {
								listeners.delete(notify);
							};
						},
					}),
			replyClock: {
				now: () => now,
				schedule(callback: () => void, delayMs: number) {
					const timer = { at: now + delayMs, callback };
					timers.add(timer);
					return () => timers.delete(timer);
				},
			},
			releaseInvokeLock: () => {
				released += 1;
			},
			...(options.replyWindowCapMs === undefined
				? {}
				: { replyWindowCapMs: options.replyWindowCapMs }),
		},
	} as unknown as SpellkaveToolContext;
	const notify = () => {
		for (const listener of [...listeners]) listener();
	};
	return {
		context,
		listeners,
		released: () => released,
		startJourney,
		/** The server put the actor down: session closed, location moved. */
		arrive(nodeId = "road") {
			sessions.length = 0;
			participants.length = 0;
			location[0] = { entityId: 1n, placeNodeId: nodeId };
			worldTime[0] = { tick: 7n };
			notify();
		},
		tick(tick: bigint) {
			worldTime[0] = { tick };
			notify();
		},
		advance(ms: number) {
			now += ms;
			for (const timer of [...timers]) if (timer.at <= now) timer.callback();
		},
		async exitHandle() {
			const listed = await toolByName(context, "spellkave_scene").execute("exits", {
				kind: "exit",
			});
			const item = (listed.details as { items: Array<{ handle: string; rev: string }> }).items[0];
			if (item === undefined) throw new Error("expected an exit handle");
			return item;
		},
	};
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

interface MoveDetails {
	receipt: { outcome: string; move: { status: string } };
	observation: string | null;
	observation_gap?: string;
	journey?: {
		status: string;
		waited_ms: number;
		window_ms?: number;
		arrives_in_ticks?: number;
		arrives_at_tick?: number;
		node_id?: string | null;
	};
}

describe("spellkave_move wait_for_arrival_ms", () => {
	it("returns as soon as the journey starts when the field is omitted", async () => {
		const h = harness();
		const exit = await h.exitHandle();
		const result = await toolByName(h.context, "spellkave_move").execute("move", exit);
		const details = result.details as MoveDetails;
		expect(details.receipt.outcome).toBe("travelling");
		expect(details.observation).toBe("You set off toward road — a journey of about 4 ticks.");
		expect(details).not.toHaveProperty("journey");
		expect(h.listeners.size).toBe(0);
	});

	it("waits for the arrival and describes the place reached", async () => {
		const h = harness();
		const exit = await h.exitHandle();
		const pending = toolByName(h.context, "spellkave_move").execute("move", {
			...exit,
			wait_for_arrival_ms: 20000,
		});
		await settle();
		expect(h.listeners.size).toBe(1);
		expect(h.released()).toBe(1);
		h.tick(5n);
		await settle();
		expect(h.listeners.size).toBe(1);
		h.advance(9000);
		h.arrive();
		const details = (await pending).details as MoveDetails;
		// The dispatch receipt still says what the act did.
		expect(details.receipt.outcome).toBe("travelling");
		expect(details.receipt.move.status).toBe("travelling");
		expect(details.journey).toEqual({ status: "arrived", waited_ms: 9000 });
		expect(details.observation).toContain("Remote.");
		expect(h.listeners.size).toBe(0);
	});

	it("reports the remaining journey when the host cap ends the wait first", async () => {
		const h = harness({ replyWindowCapMs: 8000 });
		const exit = await h.exitHandle();
		const pending = toolByName(h.context, "spellkave_move").execute("move", {
			...exit,
			wait_for_arrival_ms: 30000,
		});
		await settle();
		h.tick(5n);
		h.advance(8000);
		const details = (await pending).details as MoveDetails;
		expect(details.journey).toEqual({
			status: "timed_out",
			waited_ms: 8000,
			window_ms: 8000,
			arrives_in_ticks: 2,
			arrives_at_tick: 7,
		});
		expect(details.observation).toBe("You set off toward road — a journey of about 4 ticks.");
	});

	it("says so when the journey ends somewhere else", async () => {
		const h = harness();
		const exit = await h.exitHandle();
		const pending = toolByName(h.context, "spellkave_move").execute("move", {
			...exit,
			wait_for_arrival_ms: 20000,
		});
		await settle();
		h.arrive("inn");
		const details = (await pending).details as MoveDetails;
		expect(details.journey).toMatchObject({ status: "ended_elsewhere", node_id: "inn" });
		expect(details.observation).toBeNull();
		expect(details.observation_gap).toContain("spellkave_scene");
	});

	it("does not wait when the host wires no cache updates", async () => {
		const h = harness({ withUpdates: false });
		const exit = await h.exitHandle();
		const result = await toolByName(h.context, "spellkave_move").execute("move", {
			...exit,
			wait_for_arrival_ms: 20000,
		});
		expect((result.details as MoveDetails).journey).toEqual({
			status: "unsupported",
			waited_ms: 0,
			arrives_in_ticks: 4,
			arrives_at_tick: 7,
		});
	});
});

interface SceneDetails {
	node_id: string | null;
	journey?: { status: string; arrives_in_ticks: number; arrives_at_tick: number };
	journey_wait?: { status: string; waited_ms: number };
}

describe("spellkave_scene during a journey", () => {
	it("says nothing about journeys when the actor is not travelling", async () => {
		const h = harness();
		const plain = (await toolByName(h.context, "spellkave_scene").execute("scene", {}))
			.details as SceneDetails;
		expect(plain).not.toHaveProperty("journey");
		expect(plain).not.toHaveProperty("journey_wait");
		const waited = (
			await toolByName(h.context, "spellkave_scene").execute("scene", {
				wait_for_arrival_ms: 5000,
			})
		).details as SceneDetails;
		expect(waited.journey_wait).toEqual({ status: "not_travelling", waited_ms: 0 });
		expect(h.listeners.size).toBe(0);
	});

	it("marks the departure scene as a journey in progress", async () => {
		const h = harness();
		h.startJourney();
		const scene = (await toolByName(h.context, "spellkave_scene").execute("scene", {}))
			.details as SceneDetails;
		expect(scene.node_id).toBe("inn");
		expect(scene.journey).toMatchObject({
			status: "travelling",
			arrives_in_ticks: 4,
			arrives_at_tick: 7,
		});
		expect(scene).not.toHaveProperty("journey_wait");
	});

	it("waits for the arrival and answers with the arrival scene", async () => {
		const h = harness();
		h.startJourney();
		const pending = toolByName(h.context, "spellkave_scene").execute("scene", {
			wait_for_arrival_ms: 20000,
		});
		await settle();
		expect(h.listeners.size).toBe(1);
		h.advance(4000);
		h.arrive();
		const scene = (await pending).details as SceneDetails;
		expect(scene.node_id).toBe("road");
		expect(scene.journey_wait).toMatchObject({ status: "ended", waited_ms: 4000 });
		expect(scene).not.toHaveProperty("journey");
	});

	it("answers with the departure scene and the remaining journey at the deadline", async () => {
		const h = harness({ replyWindowCapMs: 8000 });
		h.startJourney();
		const pending = toolByName(h.context, "spellkave_scene").execute("scene", {
			wait_for_arrival_ms: 30000,
		});
		await settle();
		h.advance(8000);
		const scene = (await pending).details as SceneDetails;
		expect(scene.node_id).toBe("inn");
		expect(scene.journey_wait).toMatchObject({ status: "timed_out", window_ms: 8000 });
		expect(scene.journey).toMatchObject({ status: "travelling", arrives_in_ticks: 4 });
	});
});
