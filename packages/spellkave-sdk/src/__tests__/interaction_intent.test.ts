import { describe, expect, it } from "vitest";

import type { AffordanceInputSchema } from "../core/readers/affordance_input";
import {
	type CommunicateDraft,
	checkDraft,
	inputValuesToText,
	type ManipulateDraft,
	nextContextGeneration,
	observationEpoch,
	utteranceFromInputValues,
} from "../index";

describe("checkDraft", () => {
	it("requires action_id and target_ref for manipulate", () => {
		expect(checkDraft({ kind: "manipulate" })).toEqual({
			status: "incomplete",
			missing: ["action", "target"],
			malformed: [],
		});
		expect(checkDraft({ kind: "manipulate", action_id: "  ", target_ref: "item:1" })).toEqual({
			status: "incomplete",
			missing: ["action"],
			malformed: [],
		});
		expect(checkDraft({ kind: "manipulate", action_id: "a", target_ref: "item:1" })).toEqual({
			status: "complete",
		});
	});

	it("requires speech_act_id and target_ref for communicate", () => {
		expect(checkDraft({ kind: "communicate" })).toEqual({
			status: "incomplete",
			missing: ["action", "target"],
			malformed: [],
		});
		expect(
			checkDraft({ kind: "communicate", speech_act_id: "greet", target_ref: "npc:1" }),
		).toEqual({
			status: "complete",
		});
	});

	it("never yields required_input without a schema or with an empty fields array", () => {
		expect(checkDraft({ kind: "manipulate", action_id: "a", target_ref: "t" })).toEqual({
			status: "complete",
		});
		const emptySchema: AffordanceInputSchema = { fields: [] };
		expect(
			checkDraft({ kind: "manipulate", action_id: "a", target_ref: "t" }, emptySchema),
		).toEqual({
			status: "complete",
		});
	});

	it("checks required schema fields against input_values first, then utterance, then args_json", () => {
		const schema: AffordanceInputSchema = {
			fields: [
				{ name: "message", label: "Message", control: "text", required: true },
				{ name: "quantity", label: "Quantity", control: "number", required: true },
			],
		};
		const base: CommunicateDraft = { kind: "communicate", speech_act_id: "s", target_ref: "t" };

		expect(checkDraft(base, schema)).toEqual({
			status: "incomplete",
			missing: ["required_input"],
			malformed: [],
			missing_fields: ["message", "quantity"],
		});
		expect(checkDraft({ ...base, input_values: { message: "hi", quantity: 2 } }, schema)).toEqual({
			status: "complete",
		});
		expect(
			checkDraft({ ...base, utterance: JSON.stringify({ message: "hi", quantity: 2 }) }, schema),
		).toEqual({ status: "complete" });
		expect(
			checkDraft({ ...base, args_json: JSON.stringify({ message: "hi", quantity: 2 }) }, schema),
		).toEqual({ status: "complete" });

		// input_values wins over utterance for the same field, and a blank
		// input_values value does not fall through to utterance for that field.
		expect(
			checkDraft(
				{
					...base,
					input_values: { message: "" },
					utterance: JSON.stringify({ message: "from utterance", quantity: 2 }),
				},
				schema,
			),
		).toEqual({
			status: "incomplete",
			missing: ["required_input"],
			malformed: [],
			missing_fields: ["message"],
		});

		// missing fields fall through per-field: input_values -> utterance -> args_json.
		expect(
			checkDraft(
				{
					...base,
					input_values: { message: "hi" },
					args_json: JSON.stringify({ quantity: 2 }),
				},
				schema,
			),
		).toEqual({ status: "complete" });
	});

	it("does not use utterance as a field source for manipulate (no such field)", () => {
		const schema: AffordanceInputSchema = {
			fields: [{ name: "message", label: "Message", control: "text", required: true }],
		};
		const draft: ManipulateDraft = {
			kind: "manipulate",
			action_id: "a",
			target_ref: "t",
			args_json: JSON.stringify({ message: "hi" }),
		};
		expect(checkDraft(draft, schema)).toEqual({ status: "complete" });
	});

	it("flags args_json that is present and not a JSON object as malformed, not missing", () => {
		const draft: ManipulateDraft = {
			kind: "manipulate",
			action_id: "a",
			target_ref: "t",
			args_json: "[1,2,3]",
		};
		expect(checkDraft(draft)).toEqual({
			status: "incomplete",
			missing: [],
			malformed: ["args_json"],
		});

		const invalidSyntax: ManipulateDraft = { ...draft, args_json: "{not json" };
		expect(checkDraft(invalidSyntax)).toEqual({
			status: "incomplete",
			missing: [],
			malformed: ["args_json"],
		});
	});

	it("never treats a plain-speech utterance as malformed", () => {
		const schema: AffordanceInputSchema = {
			fields: [{ name: "message", label: "Message", control: "text", required: true }],
		};
		const draft: CommunicateDraft = {
			kind: "communicate",
			speech_act_id: "s",
			target_ref: "t",
			utterance: "Hello there, friend!",
		};
		expect(checkDraft(draft, schema)).toEqual({
			status: "incomplete",
			missing: ["required_input"],
			malformed: [],
			missing_fields: ["message"],
		});
		expect(
			checkDraft(
				{
					...draft,
					utterance: "Hello there, friend!",
					args_json: JSON.stringify({ message: "hi" }),
				},
				schema,
			),
		).toEqual({ status: "complete" });
	});
});

describe("inputValuesToText", () => {
	it("produces key-sorted JSON text", () => {
		expect(inputValuesToText({ b: 2, a: "x", c: true })).toBe(
			JSON.stringify({ a: "x", b: 2, c: true }),
		);
	});
});

describe("observationEpoch", () => {
	it("joins its parts stably", () => {
		const parts = {
			world_instance_id: "w1",
			actor_id: "actor:1",
			connection_generation: 3,
			context_generation: 0,
		};
		expect(observationEpoch(parts)).toBe(observationEpoch(parts));
		expect(observationEpoch(parts)).toBe(
			observationEpoch({ ...parts, connection_generation: "3" }),
		);
	});

	it("does not collide when a part carries the join separator", () => {
		const a = observationEpoch({
			world_instance_id: "w1|w2",
			actor_id: "a",
			connection_generation: 1,
			context_generation: 0,
		});
		const b = observationEpoch({
			world_instance_id: "w1",
			actor_id: "w2|a",
			connection_generation: 1,
			context_generation: 0,
		});
		expect(a).not.toBe(b);
	});

	it("differs when context_generation changes", () => {
		const parts = {
			world_instance_id: "w1",
			actor_id: "actor:1",
			connection_generation: 3,
			context_generation: 0,
		};
		expect(observationEpoch(parts)).not.toBe(observationEpoch({ ...parts, context_generation: 1 }));
	});
});

describe("nextContextGeneration", () => {
	it("returns 0 for an undefined previous", () => {
		expect(nextContextGeneration(undefined, { status: "ready", revision: 1 })).toBe(0);
	});

	it("keeps the generation on an ordinary revision advance", () => {
		const previous = { generation: 2, status: "ready" as const, revision: 5 };
		expect(nextContextGeneration(previous, { status: "ready", revision: 6 })).toBe(2);
	});

	it("bumps the generation when the context goes unavailable -> ready", () => {
		const previous = { generation: 2, status: "unavailable" as const, revision: null };
		expect(nextContextGeneration(previous, { status: "ready", revision: 1 })).toBe(3);
	});

	it("bumps the generation when the revision moves backwards", () => {
		const previous = { generation: 2, status: "ready" as const, revision: 5 };
		expect(nextContextGeneration(previous, { status: "ready", revision: 3 })).toBe(3);
	});

	it("does not bump on ready -> unavailable, or when a revision is null on either side", () => {
		const readyPrevious = { generation: 2, status: "ready" as const, revision: 5 };
		expect(nextContextGeneration(readyPrevious, { status: "unavailable", revision: null })).toBe(2);

		const nullPrevious = { generation: 1, status: "ready" as const, revision: null };
		expect(nextContextGeneration(nullPrevious, { status: "ready", revision: 5 })).toBe(1);
	});
});

describe("checkDraft missing_fields", () => {
	it("names only the missing required fields, in schema order", () => {
		const schema: AffordanceInputSchema = {
			fields: [
				{ name: "a", label: "A", control: "text", required: true },
				{ name: "b", label: "B", control: "text", required: true },
				{ name: "c", label: "C", control: "text" },
			],
		};
		const draft: CommunicateDraft = {
			kind: "communicate",
			speech_act_id: "s",
			target_ref: "t",
			input_values: { a: "x" },
		};
		expect(checkDraft(draft, schema)).toEqual({
			status: "incomplete",
			missing: ["required_input"],
			malformed: [],
			missing_fields: ["b"],
		});
		expect(checkDraft({ ...draft, kind: "communicate", target_ref: "" }, schema)).toMatchObject({
			missing: ["target", "required_input"],
			missing_fields: ["b"],
		});
	});
});

describe("utteranceFromInputValues", () => {
	const fields: AffordanceInputSchema["fields"] = [
		{ name: "name", label: "Name", control: "text", channel: "utterance" },
		{ name: "note", label: "Note", control: "text", channel: "utterance" },
		{ name: "qty", label: "Qty", control: "number", channel: "args_json" },
	];

	it("returns the bare text for exactly one utterance-channel value", () => {
		expect(utteranceFromInputValues(fields, { name: "Brannoch", qty: 2 })).toBe("Brannoch");
		expect(utteranceFromInputValues(fields, { name: "Brannoch", note: "  " })).toBe("Brannoch");
	});

	it("returns a key-sorted JSON object string for several", () => {
		expect(utteranceFromInputValues(fields, { note: "n", name: "B", qty: 2 })).toBe(
			JSON.stringify({ name: "B", note: "n" }),
		);
	});

	it("returns an empty string when no utterance field has a value", () => {
		expect(utteranceFromInputValues(fields, { qty: 2 })).toBe("");
	});
});
