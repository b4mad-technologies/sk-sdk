import { asEntityRef, type SnapshotDb, snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";
import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

const ACTOR_ID = asEntityRef("1");

function fixture(includeReactionSeat = false): SnapshotDb {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
		],
		visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "arena" }],
		visible_pending_resolution: [
			{
				pendingId: 7n,
				originatingActionId: "srd/wisdom_check",
				originatingActor: "1",
				targetActor: "1",
				computedOutcomeTemplate: "srd/wisdom_check/outcome",
				sessionId: 0n,
				windowOpensAtMicros: 0n,
				windowClosesAtMicros: BigInt(Date.now() + 30_000) * 1000n,
				depth: 0n,
				bundleId: "srd",
			},
			// A plain multi-actor reaction seat window (no stochastic sibling) —
			// must never surface via spellkave_intervention_windows.
			...(includeReactionSeat
				? [
						{
							pendingId: 8n,
							originatingActionId: "core/shield",
							originatingActor: "2",
							targetActor: "1",
							computedOutcomeTemplate: "core/shield/outcome",
							sessionId: 4n,
							windowOpensAtMicros: 100n,
							windowClosesAtMicros: 200n,
							depth: 1n,
							bundleId: "core",
						},
					]
				: []),
		],
		visible_pending_resolution_reactor: includeReactionSeat
			? [
					{
						rowId: 1n,
						pendingId: 8n,
						entityRef: "1",
						reacted: false,
						windowedAt: 1n,
						bundleId: "core",
					},
				]
			: [],
		visible_pending_stochastic_resolution: [
			{
				pendingId: 7n,
				draws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 6 }],
				predicateSource: "d20 >= 11",
				rollBiasJson: "{}",
				frozenFactsJson: "{}",
				commitTailJson: "{}",
				originalProvenanceId: "p0",
				bundleId: "srd",
			},
		],
	});
}

function tool(context: SpellkaveToolContext, name: string): AgentTool {
	const found = createSpellkaveTools(context).find((candidate) => candidate.name === name);
	if (found === undefined) throw new Error(`missing ${name}`);
	return found;
}

describe("spellkave_intervention_windows / extended spellkave_react_option", () => {
	it("lists the actor's own open intervention window with faces, never a plain reaction seat, and never leaks pending_id", async () => {
		const result = await tool(
			{ db: fixture(true), act: { actorId: "1" } },
			"spellkave_intervention_windows",
		).execute("windows", {});
		expect(result.details).toMatchObject({
			shown: 1,
			matched: 1,
			items: [
				{
					handle: "w0",
					originating_action_id: "srd/wisdom_check",
					faces: [{ source_id: "dsl_node:1", value: 6 }],
				},
			],
		});
		const details = result.details as { items: Array<{ remaining_ms: number }> };
		expect(details.items[0]?.remaining_ms).toBeGreaterThan(0);
		expect(JSON.stringify(result.details)).not.toContain("pending_id");
	});

	it("steers toward a follow-up when no window is open", async () => {
		const result = await tool(
			{ db: fixture(false), act: { actorId: "2" } },
			"spellkave_intervention_windows",
		).execute("empty", {});
		expect(result.details).toMatchObject({
			shown: 0,
			matched: 0,
			reason: expect.stringContaining("No intervention windows open"),
		});
	});

	it("declines via spellkave_react_option: omitting selected_draw_index forwards undefined (no spend)", async () => {
		const react = vi.fn(
			async (pending_id: bigint, response_intent: string, selected_draw_index?: number) => ({
				status: "success" as const,
				actor_id: ACTOR_ID,
				pending_id,
				response_intent,
				selected_draw_index,
				lagWarning: false,
				observedAtTick: 3n,
			}),
		);
		const context = { db: fixture(), act: { actorId: "core/hero", actorClient: { react } } };
		const windows = await tool(context, "spellkave_intervention_windows").execute("windows", {});
		const rev = (windows.details as { rev: string }).rev;
		const result = await tool(context, "spellkave_react_option").execute("decline", {
			rev,
			handle: "w0",
			response_intent: "DECLINE",
		});
		expect(react).toHaveBeenCalledWith(7n, "DECLINE", undefined);
		expect(result.details).toMatchObject({
			receipt: { status: "dispatched", outcome: "accepted" },
		});
		expect(JSON.stringify(result.details)).not.toContain("pending_id");
	});

	it("accepts via spellkave_react_option: selected_draw_index forwards through to react()", async () => {
		const react = vi.fn(
			async (pending_id: bigint, response_intent: string, selected_draw_index?: number) => ({
				status: "success" as const,
				actor_id: ACTOR_ID,
				pending_id,
				response_intent,
				selected_draw_index,
				lagWarning: false,
				observedAtTick: 3n,
			}),
		);
		const context = { db: fixture(), act: { actorId: "core/hero", actorClient: { react } } };
		const windows = await tool(context, "spellkave_intervention_windows").execute("windows", {});
		const rev = (windows.details as { rev: string }).rev;
		const result = await tool(context, "spellkave_react_option").execute("accept", {
			rev,
			handle: "w0",
			response_intent: "ACCEPT",
			selected_draw_index: 0,
		});
		expect(react).toHaveBeenCalledWith(7n, "ACCEPT", 0);
		expect(result.details).toMatchObject({
			receipt: { status: "dispatched", outcome: "accepted" },
		});
	});

	it("falls back to callRReact (reactorId/pendingId/responseIntent/selectedDrawIndex) when no actorClient is wired", async () => {
		const calls: unknown[] = [];
		const context = {
			db: fixture(),
			act: {
				actorId: "1",
				callRReact: async (args: unknown) => {
					calls.push(args);
					throw new Error("stop-observation");
				},
			},
		};
		const windows = await tool(context, "spellkave_intervention_windows").execute("windows", {});
		const rev = (windows.details as { rev: string }).rev;
		await tool(context, "spellkave_react_option").execute("react", {
			rev,
			handle: "w0",
			response_intent: "ACCEPT",
			selected_draw_index: 0,
		});
		expect(calls).toEqual([
			{ reactorId: 1n, pendingId: 7n, responseIntent: "ACCEPT", selectedDrawIndex: 0 },
		]);
	});

	it("rejects a stale intervention-window handle before dispatch", async () => {
		let db = fixture();
		const react = vi.fn();
		const context = { db: () => db, act: { actorId: "1", actorClient: { react } } };
		const windows = await tool(context, "spellkave_intervention_windows").execute("windows", {});
		const rev = (windows.details as { rev: string }).rev;
		db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
			],
		});
		const stale = await tool(context, "spellkave_react_option").execute("stale", {
			rev,
			handle: "w0",
			response_intent: "DECLINE",
		});
		expect(stale.details).toMatchObject({
			status: "stale_handle",
			reason: expect.stringContaining("spellkave_intervention_windows"),
		});
		expect(react).not.toHaveBeenCalled();
	});

	it("still dispatches an ordinary reaction-seat handle (r0) unchanged alongside intervention windows", async () => {
		const react = vi.fn(async (pending_id: bigint, response_intent: string) => ({
			status: "success" as const,
			actor_id: ACTOR_ID,
			pending_id,
			response_intent,
			lagWarning: false,
			observedAtTick: 3n,
		}));
		const context = { db: fixture(true), act: { actorId: "1", actorClient: { react } } };
		const options = await tool(context, "spellkave_reaction_options").execute("options", {});
		const rev = (options.details as { rev: string }).rev;
		const result = await tool(context, "spellkave_react_option").execute("react", {
			rev,
			handle: "r0",
			response_intent: "raise shield",
		});
		expect(react).toHaveBeenCalledWith(8n, "raise shield", undefined);
		expect(result.details).toMatchObject({ receipt: { outcome: "accepted" } });
	});
});
