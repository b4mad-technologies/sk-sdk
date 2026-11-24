import { describe, expect, it } from "vitest";

import { composeFactoredManipulationAttempt, type ManipulationContext } from "../index";

const readyContext: ManipulationContext = {
	status: "ready",
	schema_version: 1,
	revision: 4,
	actions: [
		{
			action_id: "author/open-action",
			display_name: "Open action",
			tags: [],
			niche_requirements: [],
			template_ids: [],
			groups: [],
			self_only: false,
			self_eligible: false,
		},
	],
	targets: [{ target_fact_id: "target:7:item:44", target_ref: "item:44", tags: [], niche_ids: [] }],
	participants: [
		{
			context_id: "mpc:17",
			action_id: "author/open-action",
			binding_count: 1,
			bindings: [{ role_id: "author/tool", entity_id: "44" }],
		},
	],
	prompts: [],
};

describe("composeFactoredManipulationAttempt", () => {
	it("builds one not-assessed attempt from disclosed facts without pair input", () => {
		expect(
			composeFactoredManipulationAttempt(readyContext, {
				action_id: "author/open-action",
				target_ref: "item:044",
				args_json: JSON.stringify({ quantity: 2, expected_participants: [] }),
			}),
		).toEqual({
			status: "not_assessed",
			action_id: "author/open-action",
			target_ref: "item:44",
			args_json: JSON.stringify({ quantity: 2, participant_context: "mpc:17" }),
			participant_context: "mpc:17",
		});
	});

	it("does not turn unavailable context or unknown disclosed facts into attempts", () => {
		expect(
			composeFactoredManipulationAttempt(
				{ status: "unavailable" },
				{
					action_id: "author/open-action",
					target_ref: "item:44",
				},
			),
		).toEqual({ status: "context_unavailable" });
		expect(
			composeFactoredManipulationAttempt(readyContext, {
				action_id: "author/other-action",
				target_ref: "item:44",
			}),
		).toEqual({ status: "unknown_action", action_id: "author/other-action" });
		expect(
			composeFactoredManipulationAttempt(readyContext, {
				action_id: "author/open-action",
				target_ref: "entity:99",
			}),
		).toEqual({ status: "undisclosed_target", target_ref: "entity:99" });
	});

	it("requires an explicit action-scoped participant choice only when needed", () => {
		const ready = readyContext as Extract<ManipulationContext, { status: "ready" }>;
		const firstParticipant = ready.participants[0];
		if (firstParticipant === undefined) throw new Error("ready fixture requires a participant");
		const context: ManipulationContext = {
			...ready,
			participants: [...ready.participants, { ...firstParticipant, context_id: "mpc:18" }],
		};
		expect(
			composeFactoredManipulationAttempt(context, {
				action_id: "author/open-action",
				target_ref: "item:44",
			}),
		).toEqual({
			status: "participant_context_required",
			action_id: "author/open-action",
			choices: ["mpc:17", "mpc:18"],
		});
		expect(
			composeFactoredManipulationAttempt(context, {
				action_id: "author/open-action",
				target_ref: "item:44",
				participant_context: "mpc:18",
			}),
		).toMatchObject({ status: "not_assessed", participant_context: "mpc:18" });
	});

	it("rejects malformed arguments and foreign participant contexts before dispatch", () => {
		expect(
			composeFactoredManipulationAttempt(readyContext, {
				action_id: "author/open-action",
				target_ref: "item:44",
				args_json: "[]",
			}),
		).toEqual({ status: "malformed_args", reason: "manipulation args must be a JSON object" });
		expect(
			composeFactoredManipulationAttempt(readyContext, {
				action_id: "author/open-action",
				target_ref: "item:44",
				participant_context: "apc:old-pair",
			}),
		).toEqual({ status: "unknown_participant_context", participant_context: "apc:old-pair" });
	});
});
