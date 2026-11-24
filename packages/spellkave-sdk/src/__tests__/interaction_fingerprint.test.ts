import { describe, expect, it } from "vitest";

import {
	attemptFingerprint,
	type CommunicateDraft,
	type IntentDraft,
	type ManipulateDraft,
} from "../index";

const epoch = "w1|actor:1|3|0";

function draft(overrides: Partial<ManipulateDraft>): ManipulateDraft {
	return {
		kind: "manipulate",
		action_id: "author/open-action",
		target_ref: "item:44",
		...overrides,
	};
}

function communicateDraft(overrides: Partial<CommunicateDraft>): CommunicateDraft {
	return { kind: "communicate", speech_act_id: "greet", target_ref: "npc:1", ...overrides };
}

describe("attemptFingerprint", () => {
	it("is stable for the same draft and epoch", () => {
		expect(attemptFingerprint(draft({}), epoch)).toBe(attemptFingerprint(draft({}), epoch));
	});

	it("is equal across differing args_json key order", () => {
		const a = draft({ args_json: JSON.stringify({ b: 2, a: 1 }) });
		const b = draft({ args_json: JSON.stringify({ a: 1, b: 2 }) });
		expect(attemptFingerprint(a, epoch)).toBe(attemptFingerprint(b, epoch));
	});

	it("is equal across nested key order but preserves array order", () => {
		const a = draft({ args_json: JSON.stringify({ outer: { y: 2, x: 1 }, list: [1, 2, 3] }) });
		const b = draft({ args_json: JSON.stringify({ outer: { x: 1, y: 2 }, list: [1, 2, 3] }) });
		const reordered = draft({
			args_json: JSON.stringify({ outer: { x: 1, y: 2 }, list: [3, 2, 1] }),
		});
		expect(attemptFingerprint(a, epoch)).toBe(attemptFingerprint(b, epoch));
		expect(attemptFingerprint(a, epoch)).not.toBe(attemptFingerprint(reordered, epoch));
	});

	it("is equal across differing input_values key order", () => {
		const a = draft({ input_values: { b: 2, a: 1 } });
		const b = draft({ input_values: { a: 1, b: 2 } });
		expect(attemptFingerprint(a, epoch)).toBe(attemptFingerprint(b, epoch));
	});

	it("distinguishes an absent field from its explicitly-empty presence", () => {
		const absentArgs = draft({ args_json: undefined });
		const emptyArgsText = draft({ args_json: "{}" });
		expect(attemptFingerprint(absentArgs, epoch)).not.toBe(
			attemptFingerprint(emptyArgsText, epoch),
		);

		const absentInputValues = draft({ input_values: undefined });
		const emptyInputValues = draft({ input_values: {} });
		expect(attemptFingerprint(absentInputValues, epoch)).not.toBe(
			attemptFingerprint(emptyInputValues, epoch),
		);

		const absentUtterance = communicateDraft({ utterance: undefined });
		const emptyUtterance = communicateDraft({ utterance: "" });
		expect(attemptFingerprint(absentUtterance, epoch)).not.toBe(
			attemptFingerprint(emptyUtterance, epoch),
		);
	});

	it("trims ids before fingerprinting", () => {
		const a = draft({ action_id: "author/open-action", target_ref: "item:44" });
		const b = draft({ action_id: "  author/open-action  ", target_ref: " item:44 " });
		expect(attemptFingerprint(a, epoch)).toBe(attemptFingerprint(b, epoch));
	});

	it("unifies participant_context carried as a draft field or an args_json key", () => {
		const asField = draft({ participant_context: "mpc:17", args_json: JSON.stringify({ q: 2 }) });
		const asArg = draft({ args_json: JSON.stringify({ q: 2, participant_context: "mpc:17" }) });
		expect(attemptFingerprint(asField, epoch)).toBe(attemptFingerprint(asArg, epoch));
	});

	it("prefers the draft field when both spellings are present but differ", () => {
		const fromField = draft({
			participant_context: "mpc:17",
			args_json: JSON.stringify({ q: 2, participant_context: "mpc:18" }),
		});
		const asField = draft({ participant_context: "mpc:17", args_json: JSON.stringify({ q: 2 }) });
		expect(attemptFingerprint(fromField, epoch)).toBe(attemptFingerprint(asField, epoch));
	});

	it("differs for different utterance", () => {
		const base = communicateDraft({});
		expect(attemptFingerprint(communicateDraft({ utterance: "hi" }), epoch)).not.toBe(
			attemptFingerprint(base, epoch),
		);
		expect(attemptFingerprint(communicateDraft({ utterance: "hi" }), epoch)).not.toBe(
			attemptFingerprint(communicateDraft({ utterance: "bye" }), epoch),
		);
	});

	it("differs for different target, semantic_context, or epoch", () => {
		const base = draft({});
		expect(attemptFingerprint(draft({ target_ref: "item:45" }), epoch)).not.toBe(
			attemptFingerprint(base, epoch),
		);
		expect(
			attemptFingerprint(
				draft({ semantic_context: { source_ref: "npc:1", occurrence_id: "1" } }),
				epoch,
			),
		).not.toBe(attemptFingerprint(base, epoch));
		expect(attemptFingerprint(base, "w1|actor:1|4|0")).not.toBe(attemptFingerprint(base, epoch));
	});

	it("includes both parts of semantic_context", () => {
		const a = draft({ semantic_context: { source_ref: "npc:1", occurrence_id: "1" } });
		const differentSpeaker = draft({
			semantic_context: { source_ref: "npc:2", occurrence_id: "1" },
		});
		const differentPrompt = draft({
			semantic_context: { source_ref: "npc:1", occurrence_id: "2" },
		});
		expect(attemptFingerprint(a, epoch)).not.toBe(attemptFingerprint(differentSpeaker, epoch));
		expect(attemptFingerprint(a, epoch)).not.toBe(attemptFingerprint(differentPrompt, epoch));
	});

	it("treats malformed args_json as distinct from well-formed args", () => {
		const malformed = draft({ args_json: "{not json" });
		const wellFormed = draft({ args_json: "{}" });
		expect(attemptFingerprint(malformed, epoch)).not.toBe(attemptFingerprint(wellFormed, epoch));
		expect(attemptFingerprint(malformed, epoch)).toBe(
			attemptFingerprint(draft({ args_json: "{not json" }), epoch),
		);
	});

	it("does not include facts_revision (not a parameter of this function)", () => {
		// attemptFingerprint's signature takes only (draft, epoch) -- there is no
		// facts_revision parameter to vary, which is the point: the ledger pairs
		// revision with fingerprint separately.
		const a: IntentDraft = draft({});
		expect(attemptFingerprint(a, epoch)).toBe(attemptFingerprint(a, epoch));
	});
});
