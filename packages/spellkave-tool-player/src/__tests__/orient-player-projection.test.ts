// sk-jay0.1.46.2 (run 7 of sandbox/live-patch-loop): the orientation a model
// host reads carries a bounded, snake_case manipulation context instead of
// the whole camelCase registry.
import type { ManipulationActionDescriptor, ManipulationContext } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import {
	manipulationContextSummaryForPlayer,
	ORIENT_ACTIONS_LIMIT,
	orientationForPlayer,
	orientManipulationContextForPlayer,
	SUMMARY_ACTIONS_LIMIT,
	SUMMARY_REQUESTED_ACTIONS_LIMIT,
} from "../orient-player-projection";

function action(
	id: string,
	overrides: Partial<ManipulationActionDescriptor> = {},
): ManipulationActionDescriptor {
	return {
		action_id: id,
		display_name: id,
		tags: ["srd.item"],
		niche_requirements: [
			{
				niche_id: "srd.creature",
				requires_spatial_attachment: false,
				admits_targets_without_membership: false,
			},
		],
		template_ids: [`${id}/affordance`],
		groups: ["combat"],
		self_only: true,
		self_eligible: true,
		...overrides,
	};
}

function ready(
	actions: ManipulationActionDescriptor[],
	prompts: Extract<ManipulationContext, { status: "ready" }>["prompts"] = [],
): ManipulationContext {
	return {
		status: "ready",
		schema_version: 1,
		revision: 7,
		actions,
		targets: [
			{
				target_fact_id: "target:1:entity:2",
				target_ref: "entity:2",
				tags: [],
				niche_ids: ["core/contained"],
			},
		],
		participants: [],
		prompts,
	};
}

describe("orientManipulationContextForPlayer", () => {
	it("bounds the action list, ranks open-prompt answers first and counts the rest", () => {
		const actions = [
			...Array.from({ length: 20 }, (_, index) =>
				action(`srd/check/${String(index).padStart(2, "0")}`),
			),
			action("dm/dialog/choice/2", { communication_speech_act_id: "dm/dialog/choice/2/speech" }),
			action("srd/pickup", { cue: { rank: 1, hint: "Take it" } }),
			action("dm/creation/input/name", {
				input: { fields: [{ name: "name", label: "Name", control: "text" }] },
			}),
		];
		const prompts = [
			{
				occurrence_id: "101",
				prompt_def_id: "dm/creation/class",
				contract_version: 1,
				source_ref: "entity:3",
				response_action_ids: ["dm/dialog/choice/2"],
				opened_at_tick: 2,
				consumed: false,
			},
		];
		const projected = orientManipulationContextForPlayer(ready(actions, prompts));
		if (projected.status !== "ready") throw new Error("expected ready");
		expect(projected.actions).toHaveLength(ORIENT_ACTIONS_LIMIT);
		expect(projected.actions.map((row) => row.action_id).slice(0, 3)).toEqual([
			"dm/dialog/choice/2",
			"srd/pickup",
			"dm/creation/input/name",
		]);
		expect(projected.actions_total).toBe(23);
		expect(projected.actions_more).toBe(23 - ORIENT_ACTIONS_LIMIT);
		expect(projected.actions_by_niche).toEqual([{ niche_id: "srd.creature", count: 23 }]);
		expect(projected.full_listing).toBe("spellkave_manipulation_context");
		expect(projected.prompts).toEqual(prompts);
		expect(projected.targets[0]?.niche_ids).toEqual(["core/contained"]);
	});

	it("slims each row to composition syntax and keeps niche ids", () => {
		const projected = orientManipulationContextForPlayer(
			ready([action("srd/item/potion-of-healing/consume", { description: "Drink it." })]),
		);
		if (projected.status !== "ready") throw new Error("expected ready");
		expect(projected.actions[0]).toEqual({
			action_id: "srd/item/potion-of-healing/consume",
			display_name: "srd/item/potion-of-healing/consume",
			description: "Drink it.",
			niche_ids: ["srd.creature"],
			self_only: true,
		});
		expect(projected.actions[0]).not.toHaveProperty("template_ids");
		expect(projected.actions[0]).not.toHaveProperty("niche_requirements");
	});

	it("passes an unavailable context through", () => {
		expect(orientManipulationContextForPlayer({ status: "unavailable" })).toEqual({
			status: "unavailable",
		});
	});
});

// sk-jay0.1.46.4 / sk-jay0.1.75: the default `spellkave_manipulation_context`
// answer. A level-1 cleric's registry measured 200 rows and 100 KB; the
// summary keeps the rows a player acts on next and names the rest by id.
describe("manipulationContextSummaryForPlayer", () => {
	const registry = () => [
		...Array.from({ length: 200 }, (_, index) =>
			action(`srd/spell/spell-${String(index).padStart(3, "0")}/cast`, {
				description: "You cast a spell, choosing its targets and effects as the spell describes.",
			}),
		),
		action("dm/dialog/choice/2", { communication_speech_act_id: "dm/dialog/choice/2/speech" }),
		action("srd/pickup", { cue: { rank: 1, hint: "Take it" } }),
	];
	const prompts = [
		{
			occurrence_id: "101",
			prompt_def_id: "dm/creation/class",
			contract_version: 1,
			source_ref: "entity:3",
			response_action_ids: ["dm/dialog/choice/2"],
			opened_at_tick: 2,
			consumed: false,
		},
	];

	it("shows the ranked rows as syntax and names every other action by id", () => {
		const summary = manipulationContextSummaryForPlayer(ready(registry(), prompts));
		if (summary.status !== "ready") throw new Error("expected ready");
		expect(summary.detail).toBe("summary");
		expect(summary.actions).toHaveLength(SUMMARY_ACTIONS_LIMIT);
		expect(summary.actions.slice(0, 2).map((row) => row.action_id)).toEqual([
			"dm/dialog/choice/2",
			"srd/pickup",
		]);
		expect(summary.actions[0]).not.toHaveProperty("niche_requirements");
		expect(summary.actions[0]).not.toHaveProperty("template_ids");
		expect(summary.actions_total).toBe(202);
		expect(summary.more_action_ids).toHaveLength(202 - SUMMARY_ACTIONS_LIMIT);
		const shown = new Set(summary.actions.map((row) => row.action_id));
		expect(summary.more_action_ids.some((id) => shown.has(id))).toBe(false);
		expect(summary.prompts).toEqual(prompts);
		expect(summary.targets[0]?.target_ref).toBe("entity:2");
		expect(summary).not.toHaveProperty("unknown_action_ids");
	});

	it("stays an order of magnitude below the registry it summarizes", () => {
		const context = ready(registry(), prompts);
		const summaryBytes = JSON.stringify(manipulationContextSummaryForPlayer(context)).length;
		const registryBytes = JSON.stringify(context).length;
		expect(registryBytes).toBeGreaterThan(60_000);
		expect(summaryBytes).toBeLessThan(16_000);
	});

	it("puts requested rows first, inside the same bound, and reports unknown ids", () => {
		const summary = manipulationContextSummaryForPlayer(ready(registry(), prompts), {
			actionIds: ["srd/spell/spell-150/cast", "srd/nope", "srd/spell/spell-150/cast"],
		});
		if (summary.status !== "ready") throw new Error("expected ready");
		expect(summary.actions[0]?.action_id).toBe("srd/spell/spell-150/cast");
		expect(summary.actions[0]?.description).toContain("You cast a spell");
		expect(summary.actions).toHaveLength(SUMMARY_ACTIONS_LIMIT);
		expect(summary.actions[1]?.action_id).toBe("dm/dialog/choice/2");
		expect(summary.more_action_ids).not.toContain("srd/spell/spell-150/cast");
		expect(summary.unknown_action_ids).toEqual(["srd/nope"]);
	});

	it("returns every requested row even beyond the default bound, up to the request cap", () => {
		const wanted = Array.from(
			{ length: SUMMARY_REQUESTED_ACTIONS_LIMIT + 5 },
			(_, index) => `srd/spell/spell-${String(index).padStart(3, "0")}/cast`,
		);
		const summary = manipulationContextSummaryForPlayer(ready(registry()), { actionIds: wanted });
		if (summary.status !== "ready") throw new Error("expected ready");
		expect(summary.actions).toHaveLength(SUMMARY_REQUESTED_ACTIONS_LIMIT);
		expect(summary.actions.map((row) => row.action_id)).toEqual(
			wanted.slice(0, SUMMARY_REQUESTED_ACTIONS_LIMIT),
		);
		expect(summary.actions.length + summary.more_action_ids.length).toBe(202);
	});

	it("passes an unavailable context through", () => {
		expect(manipulationContextSummaryForPlayer({ status: "unavailable" })).toEqual({
			status: "unavailable",
		});
	});
});

describe("orientationForPlayer", () => {
	it("replaces the camelCase context and drops the duplicated inventory page on a turn view", () => {
		const projected = orientationForPlayer(
			{
				actorId: "1",
				view: {
					kind: "turn",
					actorId: "1",
					manipulationContext: { status: "ready", actions: [{ actionId: "x" }] },
					inventory: { items: [1] },
					scene: null,
				},
				inventory: { items: [1] },
				traces: { items: [] },
			},
			ready([action("srd/pickup")]),
		);
		expect(projected.view).not.toHaveProperty("manipulationContext");
		expect(projected.view).not.toHaveProperty("inventory");
		expect(projected.inventory).toEqual({ items: [1] });
		expect(
			"manipulation_context" in projected.view && projected.view.manipulation_context.status,
		).toBe("ready");
	});

	it("leaves a reaction view without a manipulation context", () => {
		const projected = orientationForPlayer(
			{ actorId: "1", view: { kind: "reaction", actorId: "1" }, inventory: null, traces: null },
			ready([]),
		);
		expect(projected.view).toEqual({ kind: "reaction", actorId: "1" });
	});
});
