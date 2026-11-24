import { describe, expect, it } from "vitest";

import { attemptFingerprint, createAttempt, type ManipulateDraft } from "../index";

const epoch = "w1|actor:1|3|0";

describe("createAttempt", () => {
	it("snapshots the draft: mutating the original afterwards changes neither attempt.draft nor its fingerprint", () => {
		const original: ManipulateDraft = {
			kind: "manipulate",
			action_id: "author/open-action",
			target_ref: "item:44",
		};
		const attempt = createAttempt(original, epoch, 3);
		const fingerprintBefore = attempt.fingerprint;

		original.target_ref = "item:99";
		original.args_json = JSON.stringify({ mutated: true });

		expect(attempt.draft).toEqual({
			kind: "manipulate",
			action_id: "author/open-action",
			target_ref: "item:44",
		});
		expect(attempt.fingerprint).toBe(fingerprintBefore);
		expect(attempt.fingerprint).toBe(attemptFingerprint(attempt.draft, epoch));
	});

	it("deep-freezes the snapshot, including nested values", () => {
		const original: ManipulateDraft = {
			kind: "manipulate",
			action_id: "author/open-action",
			target_ref: "item:44",
			input_values: { quantity: 2 },
		};
		const attempt = createAttempt(original, epoch, null);

		expect(Object.isFrozen(attempt.draft)).toBe(true);
		expect(Object.isFrozen(attempt.draft.input_values)).toBe(true);
		expect(() => {
			// biome-ignore lint/suspicious/noExplicitAny: proving the frozen snapshot rejects mutation
			(attempt.draft as any).target_ref = "item:99";
		}).toThrow();
	});

	it("stamps facts_revision and epoch as given", () => {
		const draft: ManipulateDraft = { kind: "manipulate", action_id: "a", target_ref: "t" };
		const attempt = createAttempt(draft, epoch, 7);
		expect(attempt.epoch).toBe(epoch);
		expect(attempt.facts_revision).toBe(7);

		const nullRevision = createAttempt(draft, epoch, null);
		expect(nullRevision.facts_revision).toBeNull();
	});
});
