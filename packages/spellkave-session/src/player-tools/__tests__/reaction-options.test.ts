import { asEntityRef, type SnapshotDb, snapshotDbFromFixture } from "@spellkave/sdk";
import { REACT_OPTION_PARAMS, REACTION_OPTIONS_PARAMS } from "@spellkave/tool-contracts/schemas";
import { describe, expect, it, vi } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";
import { createSpellkaveTools, type SpellkaveToolContext } from "../tools";

const ACTOR_ID = asEntityRef("1");

function fixture(includeSecond = true): SnapshotDb {
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
			...(includeSecond
				? [
						{
							pendingId: 8n,
							originatingActionId: "core/counter",
							originatingActor: "3",
							targetActor: "1",
							computedOutcomeTemplate: "core/counter/outcome",
							sessionId: 4n,
							windowOpensAtMicros: 100n,
							windowClosesAtMicros: 300n,
							depth: 1n,
							bundleId: "core",
						},
					]
				: []),
		],
		visible_pending_resolution_reactor: [
			{
				rowId: 1n,
				pendingId: 7n,
				entityRef: "1",
				reacted: false,
				windowedAt: 1n,
				bundleId: "core",
			},
			...(includeSecond
				? [
						{
							rowId: 2n,
							pendingId: 8n,
							entityRef: "1",
							reacted: false,
							windowedAt: 1n,
							bundleId: "core",
						},
					]
				: []),
		],
	});
}

it("keeps window identity stable when unrelated open windows change the listing", async () => {
	const list = async (includeSecond: boolean) =>
		(
			await tool(
				{ db: fixture(includeSecond), act: { actorId: "1" } },
				"spellkave_reaction_options",
			).execute("list", {})
		).details as { rev: string; items: { handle: string; window_key: string }[] };
	const before = await list(false);
	const after = await list(true);
	const original = before.items[0];
	const same = after.items[0];
	const different = after.items[1];
	if (original === undefined || same === undefined || different === undefined)
		throw new Error("Missing fixture reaction window");
	expect(after.rev).not.toBe(before.rev);
	expect(same.window_key).toBe(original.window_key);
	expect(same.window_key).toMatch(/^window:[a-f0-9]{64}$/);
	expect(different.window_key).not.toBe(same.window_key);
});

function tool(context: SpellkaveToolContext, name: string): AgentTool {
	const found = createSpellkaveTools(context).find((candidate) => candidate.name === name);
	if (found === undefined) throw new Error(`missing ${name}`);
	return found;
}

describe("queryable reaction tools", () => {
	it("schemas accept implicit identity and never expose a raw pending id argument", () => {
		expect(Object.keys(REACTION_OPTIONS_PARAMS.properties)).toEqual(["limit", "cursor"]);
		expect(Object.keys(REACT_OPTION_PARAMS.properties)).toEqual([
			"rev",
			"handle",
			"response_intent",
			"selected_draw_index",
		]);
		expect("pending_id" in REACT_OPTION_PARAMS.properties).toBe(false);
	});

	it("pages deadline/context summaries with opaque reaction handles", async () => {
		const result = await tool(
			{ db: fixture(), act: { actorId: "1" } },
			"spellkave_reaction_options",
		).execute("options", { limit: 1 });
		expect(result.details).toMatchObject({
			shown: 1,
			matched: 2,
			truncated: true,
			items: [
				{
					handle: "r0",
					originating_action_id: "core/shield",
					originating_actor: "2",
					target_actor: "1",
					target_entity_faction: null,
					window_closes_at_micros: 200,
					session_id: "4",
				},
			],
		});
		expect(JSON.stringify(result.details)).not.toContain("pending_id");
	});

	it("executes the selected typed ActorClient.react call without returning the raw id", async () => {
		const react = vi.fn(async (pending_id: bigint, response_intent: string) => ({
			status: "success" as const,
			actor_id: ACTOR_ID,
			pending_id,
			response_intent,
			lagWarning: false,
			observedAtTick: 3n,
		}));
		const context = { db: fixture(), act: { actorId: "core/hero", actorClient: { react } } };
		const options = await tool(context, "spellkave_reaction_options").execute("options", {});
		const rev = (options.details as { rev: string }).rev;
		const result = await tool(context, "spellkave_react_option").execute("react", {
			rev,
			handle: "r0",
			response_intent: "raise shield",
		});
		expect(react).toHaveBeenCalledWith(7n, "raise shield", undefined);
		expect(result.details).toMatchObject({
			// #1921: the receipt nests under `receipt`, sibling to `observation`.
			receipt: {
				status: "dispatched",
				// #1932 (audit row 59/Patterns §4): top-level outcome, not just the
				// nested reaction.status, so a caller need not inspect the nested field.
				outcome: "accepted",
				reaction: { status: "success", actor_id: ACTOR_ID, response_intent: "raise shield" },
			},
			// This fixture's actor has no owned resource state to diff and
			// reactions carry no authored outcome narrative yet — the documented
			// gap, not a fabricated sentence.
			observation: null,
		});
		expect(JSON.stringify(result.details)).not.toContain("pending_id");
	});

	// U1 minimal fix (operator quick-fix 2026-08-04): react_option's receipt
	// carries the same readable `resolution` summary as act_affordance's
	// manipulate branch, parsed from provenance.selected_template_ids.
	it("carries a readable resolution summary when react's provenance names one", async () => {
		const react = vi.fn(async (pending_id: bigint, response_intent: string) => ({
			status: "success" as const,
			actor_id: ACTOR_ID,
			pending_id,
			response_intent,
			provenance: {
				id: "r_react:1:1",
				kind: "Reaction",
				status: "Succeeded",
				subject_id: "1",
				failure_kind: "",
				failure_detail: "",
				selected_template_ids: [
					"core/shield/outcome",
					"resolution_mode:stochastic:predicate=x",
					"resolution_result:true",
					"resolution_branch:on_success",
					"resolution_consequence:core/shield/success",
				],
				created_at_tick: 1n,
				bundle_id: "core",
			},
			lagWarning: false,
			observedAtTick: 3n,
		}));
		const context = { db: fixture(), act: { actorId: "1", actorClient: { react } } };
		const options = await tool(context, "spellkave_reaction_options").execute("options", {});
		const rev = (options.details as { rev: string }).rev;
		const result = await tool(context, "spellkave_react_option").execute("react", {
			rev,
			handle: "r0",
			response_intent: "raise shield",
		});
		expect(result.details).toMatchObject({
			receipt: {
				status: "dispatched",
				resolution: { mode: "stochastic", result: "success", consequence: "core/shield/success" },
			},
		});
	});

	it("omits `resolution` for a react outcome with no resolution_* provenance lines", async () => {
		const react = vi.fn(async (pending_id: bigint, response_intent: string) => ({
			status: "success" as const,
			actor_id: ACTOR_ID,
			pending_id,
			response_intent,
			lagWarning: false,
			observedAtTick: 3n,
		}));
		const context = { db: fixture(), act: { actorId: "1", actorClient: { react } } };
		const options = await tool(context, "spellkave_reaction_options").execute("options", {});
		const rev = (options.details as { rev: string }).rev;
		const result = await tool(context, "spellkave_react_option").execute("react", {
			rev,
			handle: "r0",
			response_intent: "raise shield",
		});
		expect((result.details as { receipt: Record<string, unknown> }).receipt).not.toHaveProperty(
			"resolution",
		);
	});

	// Sibling of the actorClient-preferred coverage above (moved from the
	// retired spellkave_react raw wrapper, act-tools.test.ts): when no
	// actorClient is wired, dispatch falls back to reconstructing a
	// bare-snapshot ActorClient via callRReact — passing reactorId/pendingId/
	// responseIntent through 1:1.
	it("falls back to callRReact (reactorId/pendingId/responseIntent) when no actorClient is wired", async () => {
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
		const options = await tool(context, "spellkave_reaction_options").execute("options", {});
		const rev = (options.details as { rev: string }).rev;
		const result = await tool(context, "spellkave_react_option").execute("react", {
			rev,
			handle: "r0",
			response_intent: "raise shield",
		});
		expect(calls).toEqual([{ reactorId: 1n, pendingId: 7n, responseIntent: "raise shield" }]);
		expect(
			(result.details as { receipt: { reaction: { status: string } } }).receipt.reaction.status,
		).toBe("rejected");
	});

	// #1932 (audit row 54): an empty reaction-seat list now steers the caller to
	// the act tools instead of a bare shown:0.
	it("steers toward the act tools when no reaction seats are open", async () => {
		const context = { db: fixture(false), act: { actorId: "2" } }; // actor 2 has no pending reaction row
		const result = await tool(context, "spellkave_reaction_options").execute("empty", {});
		expect(result.details).toMatchObject({
			shown: 0,
			matched: 0,
			reason: expect.stringContaining("spellkave_manipulation_context"),
		});
	});

	it("fails closed for an unresolved actor alias without reducer dispatch", async () => {
		const react = vi.fn();
		const context = {
			db: fixture(),
			act: { actorId: "core/missing", actorClient: { react } },
		};
		const options = await tool(context, "spellkave_reaction_options").execute("options", {});
		expect(options.details).toMatchObject({ shown: 0, matched: 0, items: [] });
		const result = await tool(context, "spellkave_react_option").execute("react", {
			rev: (options.details as { rev: string }).rev,
			handle: "r0",
			response_intent: "raise shield",
		});
		expect(result.details).toMatchObject({ status: "unknown_handle" });
		expect(react).not.toHaveBeenCalled();
	});

	it("rejects stale windows and cross-domain handles before reducer dispatch", async () => {
		let db = fixture();
		const react = vi.fn();
		const context = { db: () => db, act: { actorId: "1", actorClient: { react } } };
		const options = await tool(context, "spellkave_reaction_options").execute("options", {});
		const rev = (options.details as { rev: string }).rev;
		db = fixture(false);
		const stale = await tool(context, "spellkave_react_option").execute("stale", {
			rev,
			handle: "r1",
			response_intent: "counter",
		});
		// #1932: folded into the shared `stale_handle` vocabulary (Patterns §1) —
		// react_option no longer has its own divergent "stale_window" status.
		expect(stale.details).toMatchObject({
			status: "stale_handle",
			reason: expect.stringContaining("spellkave_reaction_options"),
		});
		const current = await tool(context, "spellkave_reaction_options").execute("current", {});
		const cross = await tool(context, "spellkave_react_option").execute("cross", {
			rev: (current.details as { rev: string }).rev,
			handle: "t0",
			response_intent: "counter",
		});
		expect(cross.details).toMatchObject({ status: "cross_domain" });
		expect(react).not.toHaveBeenCalled();
	});
});

describe("reaction listing faction disclosure", () => {
	it("does not disclose entity_tag without a visible affordance on the target", async () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
			],
			visible_entity_tag: [
				{ key: "k1", entityId: 2n, tag: "srd.faction.monsters", bundleId: "srd" },
			],
			visible_pending_resolution: [
				{
					pendingId: 7n,
					originatingActionId: "srd/attack/opportunity-attack",
					originatingActor: "2",
					targetActor: "2",
					computedOutcomeTemplate: "srd/attack/opportunity-attack/outcome",
					sessionId: 4n,
					windowOpensAtMicros: 100n,
					windowClosesAtMicros: 200n,
					depth: 1n,
					bundleId: "srd",
				},
			],
			visible_pending_resolution_reactor: [
				{
					rowId: 1n,
					pendingId: 7n,
					entityRef: "1",
					reacted: false,
					windowedAt: 1n,
					bundleId: "srd",
				},
			],
		});
		const result = await tool({ db, act: { actorId: "1" } }, "spellkave_reaction_options").execute(
			"options",
			{},
		);
		expect(result.details).toMatchObject({
			items: [{ target_actor: "2", target_entity_faction: null }],
		});
	});

	it("copies faction only when this perceiver already has a disclosed factored target", async () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
			],
			world_time: [{ tick: 10n }],
			visible_entity_tag: [
				{ key: "k1", entityId: 2n, tag: "srd.faction.monsters", bundleId: "srd" },
			],
			visible_manipulation_observed_target: [
				{
					targetFactId: "target:1:entity:2",
					perceiverEntityId: 1n,
					targetRef: { tag: "Entity", value: 2n },
				},
			],
			visible_pending_resolution: [
				{
					pendingId: 7n,
					originatingActionId: "srd/attack/opportunity-attack",
					originatingActor: "2",
					targetActor: "2",
					computedOutcomeTemplate: "srd/attack/opportunity-attack/outcome",
					sessionId: 4n,
					windowOpensAtMicros: 100n,
					windowClosesAtMicros: 200n,
					depth: 1n,
					bundleId: "srd",
				},
			],
			visible_pending_resolution_reactor: [
				{
					rowId: 1n,
					pendingId: 7n,
					entityRef: "1",
					reacted: false,
					windowedAt: 1n,
					bundleId: "srd",
				},
			],
		});
		const result = await tool({ db, act: { actorId: "1" } }, "spellkave_reaction_options").execute(
			"options",
			{},
		);
		expect(result.details).toMatchObject({
			items: [{ target_actor: "2", target_entity_faction: "monsters" }],
		});
	});

	it("does not disclose faction when world_time is unavailable (same as readAffordances)", async () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
			],
			visible_entity_tag: [
				{ key: "k1", entityId: 2n, tag: "srd.faction.monsters", bundleId: "srd" },
			],
			visible_affordance: [
				{
					affordanceId: 100n,
					perceiverEntityId: 1n,
					targetEntityId: 2n,
					targetRef: { tag: "Entity", value: 2n },
					derivedByTemplateId: "srd/affordance/attack",
					actionId: "srd/attack/melee",
				},
			],
			visible_pending_resolution: [
				{
					pendingId: 7n,
					originatingActionId: "srd/attack/opportunity-attack",
					originatingActor: "2",
					targetActor: "2",
					computedOutcomeTemplate: "srd/attack/opportunity-attack/outcome",
					sessionId: 4n,
					windowOpensAtMicros: 100n,
					windowClosesAtMicros: 200n,
					depth: 1n,
					bundleId: "srd",
				},
			],
			visible_pending_resolution_reactor: [
				{
					rowId: 1n,
					pendingId: 7n,
					entityRef: "1",
					reacted: false,
					windowedAt: 1n,
					bundleId: "srd",
				},
			],
		});
		const result = await tool({ db, act: { actorId: "1" } }, "spellkave_reaction_options").execute(
			"options",
			{},
		);
		expect(result.details).toMatchObject({
			items: [{ target_actor: "2", target_entity_faction: null }],
		});
	});
});
