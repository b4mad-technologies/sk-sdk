import { expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { readTraceResponse } from "../core/readers/trace_response";

const action = "some/response";
function fixture(audience = true) {
	return snapshotDbFromFixture({
		action_definition_tag: [{ actionId: action, tag: "ui.response-slot=2" }],
		visible_prompt_occurrence: audience
			? [
					{
						occurrenceId: 11n,
						promptDefId: "menu",
						audienceTraceId: 101n,
						responseActionIds: ["other", action],
						closedAtTick: 5n,
					},
					{
						occurrenceId: 12n,
						promptDefId: "menu",
						audienceTraceId: 102n,
						responseActionIds: ["other", action],
						closedAtTick: undefined,
					},
				]
			: [],
		public_metadata_attachment: [
			{
				targetKind: "prompt_definition",
				targetRef: "menu",
				namespace: "dialogue.prompt",
				audience: "public",
				payloadJson: '{"presentation":"audience_trace"}',
			},
		],
		visible_trace: [
			{ traceId: 101n, payloadJson: '{"options":["First","Answered words"]}' },
			{ traceId: 102n, payloadJson: '{"options":["Later","Successor words"]}' },
		],
	});
}
// K2: causal wire identity must survive delayed delivery and absent historical facts.
it("a delayed answer resolves the answered occurrence after the reused response opens again", () => {
	expect(readTraceResponse(fixture(), { action_id: action, occurrence_id: "11" })).toEqual({
		action_id: action,
		slot: 2,
		occurrence_id: "11",
		label: "Answered words",
	});
});
// K2: an overhearer lacks the audience occurrence, even if it heard both questions.
it("a reader outside the audience gets only the neutral response number", () => {
	expect(readTraceResponse(fixture(false), { action_id: action, occurrence_id: "11" })).toEqual({
		action_id: action,
		slot: 2,
		occurrence_id: "11",
	});
});
// K2: no carry_occurrence is deliberately neutral, never the newest matching slot.
it("an answer without carry_occurrence stays neutral", () => {
	expect(readTraceResponse(fixture(), { action_id: action })).toEqual({
		action_id: action,
		slot: 2,
	});
});

// K2: omitted causal history must not be repaired even from a singleton retained prompt.
it("does not trust private raw occurrences when the visible audience view is empty", () => {
	const db = snapshotDbFromFixture({
		action_definition_tag: [{ actionId: action, tag: "ui.response-slot=2" }],
		prompt_occurrence: [
			{
				occurrenceId: 11n,
				promptDefId: "menu",
				audienceTraceId: 101n,
				responseActionIds: ["other", action],
			},
		],
	});
	expect(readTraceResponse(db, { action_id: action, occurrence_id: "11" })).toEqual({
		action_id: action,
		slot: 2,
		occurrence_id: "11",
	});
});

// K2: authored static prompts share the causal identity path with trace-presented menus.
it("resolves closed authored prompts by exact response identity, regardless of the response name", () => {
	const db = snapshotDbFromFixture({
		action_definition_tag: [{ actionId: action, tag: "ui.response-slot=2" }],
		visible_prompt_occurrence: [
			{
				occurrenceId: 11n,
				promptDefId: "static",
				audienceTraceId: 0n,
				responseActionIds: ["other", action],
				closedAtTick: 5n,
			},
		],
		public_metadata_attachment: [
			{
				targetKind: "prompt_definition",
				targetRef: "static",
				namespace: "dialogue.prompt",
				audience: "public",
				payloadJson: JSON.stringify({ responses: { [action]: "Authored answer" } }),
			},
		],
	});
	expect(readTraceResponse(db, { action_id: action, occurrence_id: "11" })?.label).toBe(
		"Authored answer",
	);
});
