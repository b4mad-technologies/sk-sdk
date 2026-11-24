import type { SnapshotDb } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";

import {
	createSpellkaveTools,
	type SpellkaveActorContext,
	type SpellkaveToolContext,
} from "../tools";

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

// A db where "actor:scout" resolves (via visible_manifest_authored_entity alias) to
// entity 11 with a spatial location, so the SDK's resolvedActorId() succeeds.
function actorDb(): SnapshotDb {
	return makeDb({
		world_time: [{ tick: 1n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "core:actor:scout", bundleId: "core", entityId: 11n },
		],
		visible_actor_spatial_location: [{ entityId: 11n, placeNodeId: "tavern" }],
		visible_place_node: [{ nodeId: "tavern" }],
		visible_place_edge: [],
	});
}

function toolByName(context: SpellkaveToolContext, name: string): AgentTool {
	const tool = createSpellkaveTools(context).find((t) => t.name === name);
	if (!tool) throw new Error(`tool not found: ${name}`);
	return tool as AgentTool;
}

describe("companion act tools", () => {
	// spellkave_sense's raw-wrapper dispatch (dispatchAct fallback: prefer
	// actorClient.sense, fall back to callRSense) is now exercised through the
	// PLAYER replacement, spellkave_act_affordance's "sensing" verb_class branch
	// — see perceive-tools.test.ts ("spellkave_act_affordance dispatches sensing
	// through the same callRSense fallback...").

	it("spellkave_communicate submits the speech act through r_manipulate", async () => {
		const calls: unknown[] = [];
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRManipulate: async (args) => {
				calls.push(args);
				throw new Error("stop-observation");
			},
		};
		const tool = toolByName({ db: actorDb(), act }, "spellkave_communicate");
		await tool.execute("c", { target_id: "entity:9", speech_act_id: "greet" });
		expect(calls).toEqual([
			{
				actorId: 11n,
				targetRef: { tag: "Entity", value: 9n },
				actionId: "greet",
				args: {
					selectedItems: [],
					quantity: undefined,
					destination: undefined,
					stationRef: undefined,
					buildTarget: undefined,
					requiredAbsentStateIds: [],
				},
			},
		]);
	});

	it("spellkave_session_open passes args 1:1 (default participants '')", async () => {
		const calls: unknown[] = [];
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRSessionOpen: async (args) => {
				calls.push(args);
				throw new Error("stop-observation");
			},
		};
		const tool = toolByName({ db: actorDb(), act }, "spellkave_session_open");
		await tool.execute("o", { session_def_id: "core/session/parley" });
		expect(calls).toEqual([
			{
				sessionDefId: "core/session/parley",
				participants: [11n],
				gridExtentJson: "",
				driverTokens: [],
			},
		]);
	});

	it("spellkave_session_close passes args 1:1", async () => {
		const calls: unknown[] = [];
		const db = actorDb();
		db.session = {
			iter: () => [{ sessionId: 7n, lifecycle: "active", lastAdvancedAt: 1n }].values(),
		};
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRSessionClose: async (args) => {
				calls.push(args);
				throw new Error("stop-observation");
			},
		};
		const tool = toolByName({ db, act }, "spellkave_session_close");
		const result = await tool.execute("sc", { session_id: 7, outcome: "completed" });
		expect(calls).toEqual([{ sessionId: 7n, outcome: "completed" }]);
		expect((result.details as { session: { status: string } }).session.status).toBe("rejected");
	});

	it("spellkave_session_close carries original multi-Service observations", async () => {
		const calls: unknown[] = [];
		const db = actorDb();
		db.session = {
			iter: () => [{ sessionId: 7n, lifecycle: "active", lastAdvancedAt: 1n }].values(),
		};
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRSessionClose: async (args) => {
				calls.push(args);
				throw new Error("stop-observation");
			},
		};
		const tool = toolByName({ db, act }, "spellkave_session_close");
		await tool.execute("sc", {
			session_id: 7,
			outcome: "completed",
			control_tokens: [
				{ world_instance_id: "world", generation: "2", actor_id: "5", body_entity_id: "11" },
				{ world_instance_id: "world", generation: "4", actor_id: "6", body_entity_id: "12" },
			],
		});
		expect(calls).toEqual([
			{
				sessionId: 7n,
				outcome: "completed",
				driverTokens: [
					{ worldInstanceId: "world", generation: 2n, actorId: 5n, bodyEntityId: 11n },
					{ worldInstanceId: "world", generation: 4n, actorId: 6n, bodyEntityId: 12n },
				],
			},
		]);
	});

	it("spellkave_session_move passes args 1:1", async () => {
		const calls: unknown[] = [];
		const db = actorDb();
		db.session = {
			iter: () => [{ sessionId: 7n, lifecycle: "active", lastAdvancedAt: 1n }].values(),
		};
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRSessionMove: async (args) => {
				calls.push(args);
				throw new Error("stop-observation");
			},
		};
		const tool = toolByName({ db, act }, "spellkave_session_move");
		const result = await tool.execute("sm", {
			session_id: 7,
			move_template_id: "core/session/advance",
		});
		expect(calls).toEqual([{ sessionId: 7n, moveTemplateId: "core/session/advance" }]);
		expect((result.details as { session: { status: string } }).session.status).toBe("rejected");
	});

	it("spellkave_manipulate passes args 1:1 to r_manipulate (default args_json '{}')", async () => {
		const calls: unknown[] = [];
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRManipulate: async (args) => {
				calls.push(args);
				throw new Error("stop-observation");
			},
		};
		const tool = toolByName({ db: actorDb(), act }, "spellkave_manipulate");
		const result = await tool.execute("m", {
			target_id: "entity:9",
			action_id: "core/pickup_item",
		});
		expect(calls).toEqual([
			{
				actorId: 11n,
				targetRef: { tag: "Entity", value: 9n },
				actionId: "core/pickup_item",
				args: {
					selectedItems: [],
					quantity: undefined,
					destination: undefined,
					stationRef: undefined,
					buildTarget: undefined,
					requiredAbsentStateIds: [],
				},
			},
		]);
		expect(
			(result.details as { receipt: { manipulate: { status: string } } }).receipt.manipulate.status,
		).toBe("rejected");
	});

	it("spellkave_manipulate delegates to a host-supplied actorClient (provenance-correct path)", async () => {
		// The host pre-wires an ActorClient that carries the session's
		// provenanceBuffer. When present, the tool must delegate to it and NOT
		// reconstruct a bare-snapshot client (which could not observe provenance).
		const manipulateCalls: unknown[] = [];
		let reducerCalled = false;
		const actorClient: SpellkaveActorContext["actorClient"] = {
			// biome-ignore lint/suspicious/noExplicitAny: minimal success-shaped verdict; the tool only forwards `.status`.
			manipulate: async (targetId: string, actionId: string, argsJson: string): Promise<any> => {
				manipulateCalls.push({ targetId, actionId, argsJson });
				return { status: "success" };
			},
			// biome-ignore lint/suspicious/noExplicitAny: stub — this test exercises manipulate only.
			move: async (_edgeId: string): Promise<any> => ({ status: "success" }),
		};
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRManipulate: async () => {
				reducerCalled = true;
			},
			actorClient,
		};
		const tool = toolByName({ db: actorDb(), act }, "spellkave_manipulate");
		const result = await tool.execute("m", { target_id: "entity:9", action_id: "x/pull" });
		expect(manipulateCalls).toEqual([{ targetId: "entity:9", actionId: "x/pull", argsJson: "{}" }]);
		expect(reducerCalled).toBe(false);
		expect(
			(result.details as { receipt: { manipulate: { status: string } } }).receipt.manipulate.status,
		).toBe("success");
	});

	it("spellkave_release_claim passes args 1:1 and reports the observed status", async () => {
		const calls: unknown[] = [];
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRReleaseClaim: async (args) => {
				calls.push(args);
				throw new Error("stop-observation");
			},
		};
		const tool = toolByName({ db: actorDb(), act }, "spellkave_release_claim");
		const result = await tool.execute("r", { target_id: "entity:9" });
		expect(calls).toEqual([{ actorId: "11", targetId: "entity:9" }]);
		expect((result.details as { release_claim: { status: string } }).release_claim.status).toBe(
			"rejected",
		);
	});

	// spellkave_inscribe_trace (raw capability-gated inscription wrapper) is
	// deleted with no shared PLAYER tool runtime-level replacement: PLAYER trace creation
	// now happens exclusively through an authored affordance action's
	// on_success consequence (spellkave_act_affordance), which is a
	// manifest/fixture concern proven by the srd/phandelver twin suite and
	// world-fixtures snapshot tests, not this unit-level dispatch suite. No raw
	// `kind`/`location_kind`/`location_ref`/`visibility` wrapper survives to
	// unit-test at this layer.

	// spellkave_react's raw-wrapper dispatch (dispatchAct fallback: prefer
	// actorClient.react, fall back to callRReact) is now exercised through the
	// PLAYER replacement, spellkave_react_option — see reaction-options.test.ts
	// ("executes the selected typed ActorClient.react call...") for the
	// actorClient-preferred path and its callRReact-fallback sibling.

	it("spellkave_wake_up submits for the active actor (fire-and-confirm)", async () => {
		const calls: unknown[] = [];
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRActorWakeUp: async (args) => {
				calls.push(args);
			},
		};
		const tool = toolByName({ db: actorDb(), act }, "spellkave_wake_up");
		const result = await tool.execute("w", {});
		expect(calls).toEqual([{ actorId: 11n }]);
		expect((result.details as { wake_up: { status: string } }).wake_up.status).toBe("submitted");
	});

	it("throws a clear error when the act context is not configured", async () => {
		const tool = toolByName({ db: actorDb() }, "spellkave_communicate");
		await expect(
			tool.execute("c", { target_id: "entity:9", speech_act_id: "greet" }),
		).rejects.toThrow(/not configured/);
	});

	// spellkave_move's raw edge_id compatibility-mode dispatch (actorClient
	// delegation + the context.move snapshot-path fallback) moved with the
	// T7 act_scene -> spellkave_move rename to scene-tools.test.ts's
	// "spellkave_move raw edge_id compatibility mode (T7)" describe block,
	// alongside the tool's other (rev+handle) addressing mode.

	// spellkave_sense's / spellkave_react's actorClient-preferred-over-reducer
	// provenance contract (the sibling coverage that used to live here) now
	// lives with their PLAYER replacements: perceive-tools.test.ts
	// ("spellkave_act_affordance dispatches sensing through the same
	// callRSense fallback...") and reaction-options.test.ts ("executes the
	// selected typed ActorClient.react call..." plus its callRReact-fallback
	// sibling). spellkave_inscribe_trace's actorClient.inscribeTrace path has
	// no surviving shared PLAYER tool runtime-level caller to redirect to — see the
	// retirement note above.
});

describe("spellkave_manipulate targets a carried item as item: (sk-jay0.3.26.29)", () => {
	// Actor 11 carries entity 3 (visible_entity_containment); entity 9 lies elsewhere.
	function carryingDb(): SnapshotDb {
		const base = actorDb();
		return {
			...base,
			visible_entity_containment: {
				iter: () =>
					[
						{ entityId: 3n, containerId: 11n, slotId: "", direction: "", insertedAtTick: 1n },
					].values(),
			},
		};
	}
	async function dispatched(targetId: string): Promise<unknown> {
		const calls: Array<{ targetRef: unknown }> = [];
		const act: SpellkaveActorContext = {
			actorId: "11",
			callRManipulate: async (args) => {
				calls.push(args as { targetRef: unknown });
				throw new Error("stop-observation");
			},
		};
		await toolByName({ db: carryingDb(), act }, "spellkave_manipulate").execute("m", {
			target_id: targetId,
			action_id: "playtest_mini/act/wield",
		});
		return calls[0]?.targetRef;
	}

	it.each([
		["the inventory handle i:3", "i:3"],
		["item:3 as given", "item:3"],
	])("sends %s as an Item target", async (_case, targetId) => {
		expect(await dispatched(targetId)).toEqual({ tag: "Item", value: 3n });
	});

	it("passes entity: targets unchanged, carried or not: no guess from world state", async () => {
		expect(await dispatched("entity:3")).toEqual({ tag: "Entity", value: 3n });
		expect(await dispatched("entity:9")).toEqual({ tag: "Entity", value: 9n });
	});
});
