import type { SnapshotDb } from "@spellkave/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";

import { createSpellkaveTools, type SpellkaveMoveState, type SpellkaveToolContext } from "../tools";

interface FakeRow {
	[k: string]: unknown;
}

function table(rows: FakeRow[]): { iter: () => Iterable<FakeRow> } {
	return { iter: () => rows.values() };
}

function makeDb(parts: Record<string, FakeRow[]>): SnapshotDb {
	const out: SnapshotDb = {
		visible_entity_tag: { iter: () => [] },
		visible_entity_tag_coverage: { iter: () => [{ status: "complete", projectionVersion: 1 }] },
	};
	for (const [accessor, rows] of Object.entries(parts)) {
		out[accessor] = table(rows);
	}
	return out;
}

function fixtureDb(): SnapshotDb {
	// SnapshotDb accessors are snake_case (readers do `db["snake_name"]`
	// verbatim); row FIELDS are camelCase binding shapes. Post-entity-unification:
	// actor placement and affordances are entity-id-keyed, not actor-id-keyed.
	return makeDb({
		world_time: [{ tick: 42n }],
		config: [{ worldName: "Spellkave", agentsEnabled: true, eventRetentionLimit: 100 }],
		visible_world_event: [
			{ id: 1n, tick: 40, kind: { tag: "Tick" }, summary: "world warmed" },
			{ id: 2n, tick: 42, kind: { tag: "ActorMoved" }, summary: "scout moved" },
		],
		visible_actor_spatial_location: [{ entityId: 11n, placeNodeId: "tavern" }],
		// spellkave_self_summary/self_states (the PLAYER replacements for the
		// deleted spellkave_actor_snapshot) additionally require the actor to be
		// "directly controlled" by the connection.
		directly_controlled_actor_spatial_location: [{ entityId: 11n, placeNodeId: "tavern" }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "core:actor:scout", bundleId: "core", entityId: 11n },
		],
		visible_target_condition: [
			{
				rowId: 1n,
				targetKind: { tag: "Entity" },
				targetId: 11n,
				conditionDefinitionId: "rested",
				sourceId: "test",
				appliedAtTick: 30n,
				stackCount: 1,
				bundleId: "core",
			},
		],
		owned_object_state: [
			{
				rowId: 1n,
				targetKind: "entity",
				targetId: 11n,
				stateId: "srd/hp",
				value: 18n,
				setAtTick: 10n,
			},
			{
				rowId: 2n,
				targetKind: "entity",
				targetId: 11n,
				stateId: "story/objective",
				value: 0n,
				setAtTick: 11n,
			},
		],
		resource_definition: [],
		resource_definition_tag: [
			{ resourceDefinitionId: "srd/hp", tag: "core" },
			{ resourceDefinitionId: "story/objective", tag: "quest" },
		],
		visible_place_node: [{ nodeId: "tavern" }, { nodeId: "square" }],
		visible_place_edge: [{ edgeId: 7n, fromNodeId: "tavern", toNodeId: "square" }],
		visible_affordance: [
			{
				affordanceId: 5n,
				perceiverEntityId: 11n,
				targetEntityId: 7n,
				targetRef: { tag: "Entity", value: 7n },
				derivedByTemplateId: "core/listen/affordance",
				derivedFrom: "core/listen/affordance",
				expiresAtTick: undefined,
				derivedAtTick: 0,
				bundleId: "core",
			},
		],
		affordance_template: [
			{ templateId: "core/listen/affordance", displayName: "Listen", capabilityId: "core/sense" },
		],
	});
}

function toolsByName(context: SpellkaveToolContext): Map<string, AgentTool> {
	return new Map(createSpellkaveTools(context).map((tool) => [tool.name, tool]));
}

describe("Spellkave companion AgentTool layer", () => {
	afterEach(() => vi.useRealTimers());
	it("surfaces SDK read models as pi-agent-core tools", async () => {
		const tools = toolsByName({ db: fixtureDb() });

		await expect(tools.get("spellkave_status")?.execute("status", {})).resolves.toMatchObject({
			details: {
				status: { tick: 42, worldName: "Spellkave" },
			},
		});

		await expect(
			tools.get("spellkave_events")?.execute("events", { limit: 1 }),
		).resolves.toMatchObject({
			details: { events: [{ id: "2", tick: 42, kind: "ActorMoved" }] },
		});

		// spellkave_actor_snapshot is deleted; PLAYER callers use
		// spellkave_self_summary, which reads the CONNECTED actor implicitly
		// (context.act.actorId) rather than an arbitrary actor_id param.
		const selfTools = toolsByName({ db: fixtureDb(), act: { actorId: "actor:scout" } });
		await expect(
			selfTools.get("spellkave_self_summary")?.execute("self", {}),
		).resolves.toMatchObject({
			details: {
				self: {
					actor_id: "actor:scout",
					current_node_id: "tavern",
					conditions: { items: [{ condition_definition_id: "rested" }] },
				},
			},
		});
	});

	// spellkave_location_snapshot is deleted; PLAYER callers use
	// spellkave_scene, which — unlike the raw wrapper — only surfaces an exit
	// once its movement affordance is materialized (ADR-0032/#1968 B2), so
	// this fixture (unlike fixtureDb() above, which carries no movement
	// affordance) needs its own dedicated materialized "PlaceEdge" affordance
	// row for the tavern -> square edge.
	it("surfaces the current scene, including a materialized exit, via spellkave_scene", async () => {
		const db = makeDb({
			world_time: [{ tick: 42n }],
			config: [{ worldName: "Spellkave", agentsEnabled: true, eventRetentionLimit: 100 }],
			visible_actor_spatial_location: [{ entityId: 11n, placeNodeId: "tavern" }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "core:actor:scout", bundleId: "core", entityId: 11n },
			],
			visible_place_node: [{ nodeId: "tavern" }, { nodeId: "square" }],
			visible_place_edge: [{ edgeId: 7n, fromNodeId: "tavern", toNodeId: "square" }],
			visible_affordance: [
				{
					affordanceId: 9n,
					perceiverEntityId: 11n,
					targetEntityId: 0n,
					targetRef: { tag: "PlaceEdge", value: 7n },
					derivedByTemplateId: "test/walk/affordance",
					actionId: "",
					interactionDescriptor: "movement.descriptor=test/walk",
					derivedFrom: "",
					expiresAtTick: undefined,
					derivedAtTick: 0,
					bundleId: "test",
				},
			],
			affordance_template: [
				{ templateId: "test/walk/affordance", displayName: "Take road", capabilityId: "" },
			],
		});
		const tools = toolsByName({ db, act: { actorId: "actor:scout" } });
		const scene = await tools.get("spellkave_scene")?.execute("scene", { kind: "exit" });
		expect(scene?.details).toMatchObject({ node_id: "tavern", listing: "paginated", matched: 1 });
		const items = (scene?.details as { items: Array<{ handle: string; rev: string }> }).items;
		const detail = await tools
			.get("spellkave_scene_detail")
			?.execute("scene-detail", { rev: items[0]?.rev, handle: items[0]?.handle });
		expect(detail?.details).toMatchObject({
			target: { id: "7", detail: { edge_id: "7", to_node_id: "square" } },
		});
	});

	it("keeps spellkave_suggest_next_action read-only", async () => {
		const reducerCalls: unknown[] = [];
		const tools = toolsByName({
			db: fixtureDb(),
			move: {
				actorId: "11",
				callRMove: async (args) => {
					reducerCalls.push(args);
				},
			},
		});

		await expect(
			tools.get("spellkave_suggest_next_action")?.execute("suggest", { entity_ref: "actor:scout" }),
		).resolves.toMatchObject({
			details: {
				suggestion: {
					kind: "move",
				},
			},
		});
		expect(reducerCalls).toEqual([]);
	});

	it("filters actor state by an exact author-defined tag", async () => {
		// spellkave_actor_snapshot is deleted; PLAYER callers use
		// spellkave_self_states, whose compact row carries state_id/display_name/
		// value only (no tags echo — the filter itself proves the tag match).
		const tools = toolsByName({ db: fixtureDb(), act: { actorId: "actor:scout" } });
		const result = await tools
			.get("spellkave_self_states")
			?.execute("self-states-core", { state_tag: "core" });

		expect(result).toMatchObject({
			details: { matched: 1, items: [{ state_id: "srd/hp" }] },
		});
	});

	it("does not advertise the diagnostic full-state escape hatch to the model", () => {
		const tools = toolsByName({ db: fixtureDb() });
		for (const name of ["spellkave_self_states"]) {
			expect(tools.get(name)?.description).not.toMatch(
				/limit\s*:\s*0|full dump|unbounded|debugging escape hatch/i,
			);
		}
	});

	it("delegates movement to strict SDK actor client", async () => {
		const reducerCalls: unknown[] = [];
		const actorRow = { entityId: 11n, placeNodeId: "tavern" };
		const state: SpellkaveMoveState = { inFlight: false };
		const tools = toolsByName({
			db: makeDb({
				world_time: [{ tick: 42n }],
				config: [{ worldName: "Spellkave", agentsEnabled: true, eventRetentionLimit: 100 }],
				visible_world_event: [
					{ id: 1n, tick: 40, kind: { tag: "Tick" }, summary: "world warmed" },
					{ id: 2n, tick: 42, kind: { tag: "ActorMoved" }, summary: "scout moved" },
				],
				visible_actor_spatial_location: [actorRow],
				visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
				visible_manifest_authored_entity: [
					{ manifestKey: "core:actor:scout", bundleId: "core", entityId: 11n },
				],
				visible_place_node: [{ nodeId: "tavern" }, { nodeId: "square" }],
				visible_place_edge: [{ edgeId: 7n, fromNodeId: "tavern", toNodeId: "square" }],
			}),
			move: {
				actorId: () => "11",
				state,
				callRMove: async (args) => {
					reducerCalls.push(args);
					actorRow.placeNodeId = "square";
				},
			},
		});

		const result = await tools.get("spellkave_move")?.execute("move", { edge_id: "7" });
		expect(result).toMatchObject({
			details: {
				actor_id: "11",
				edge_id: "7",
				from_node: "tavern",
				to_node: "square",
				observed_at_tick: "42",
			},
		});
		// The compatibility register is already deliberately flat: it keeps its
		// operator-facing observation tick but never leaks the raw SDK provenance
		// object. The PLAYER rev+handle register is slimmed separately.
		expect(result?.details).not.toHaveProperty("provenance");
		expect(reducerCalls).toEqual([
			{
				actorId: 11n,
				fromNode: "tavern",
				toNode: "square",
				edgeId: "7",
			},
		]);
		expect(state.inFlight).toBe(false);
	});

	// keep(K1): companion adapter preserves literal reducer arguments and structured non-arrival at the SDK deadline.
	it("submits a stale edge 1:1 and returns a structured rejection (no client-side pre-check)", async () => {
		vi.useFakeTimers();
		// Post-ADR-0009 D-2 / @spellkave/sdk CLAUDE.md §1: the SDK performs ZERO
		// client-side adjacency validation. A stale edge_id is still passed 1:1 to
		// r_move; the rejection comes from observing that the actor never arrived,
		// not from a pre-submit guard. The tool returns a structured rejection
		// (status + reason) rather than throwing, so the LLM can read WHY the
		// move was blocked (same contract as manipulate).
		const reducerCalls: unknown[] = [];
		const tools = toolsByName({
			db: fixtureDb(),
			move: {
				actorId: "11",
				callRMove: async (args) => {
					reducerCalls.push(args);
				},
			},
		});

		let settled = false;
		const pending = tools
			.get("spellkave_move")
			?.execute("move", { edge_id: "missing" })
			.then((result) => {
				settled = true;
				return result;
			});
		await vi.advanceTimersByTimeAsync(1_999);
		expect(reducerCalls).toEqual([{ actorId: 11n, fromNode: "", toNode: "", edgeId: "missing" }]);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		// The observer checks the deadline itself without a polling overshoot.
		expect(settled).toBe(true);
		const result = await pending;
		expect(result?.details).toMatchObject({
			status: expect.stringMatching(/^(unobserved_|unobservable$)/),
			reason: expect.stringMatching(/did not reach/),
		});
		expect(reducerCalls).toEqual([{ actorId: 11n, fromNode: "", toNode: "", edgeId: "missing" }]);
	});

	it("rejects concurrent movement before invoking r_move", async () => {
		const reducerCalls: unknown[] = [];
		const tools = toolsByName({
			db: fixtureDb(),
			move: {
				actorId: "11",
				state: { inFlight: true },
				callRMove: async (args) => {
					reducerCalls.push(args);
				},
			},
		});

		await expect(tools.get("spellkave_move")?.execute("move", { edge_id: "7" })).rejects.toThrow(
			/concurrent/,
		);
		expect(reducerCalls).toEqual([]);
	});
});
