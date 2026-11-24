import { describe, expect, it } from "vitest";

import { createAttempt, createRejectionLedger, type IntentDraft, type Outcome } from "../index";

const epoch = "w1|actor:1|3|0";
const draft: IntentDraft = {
	kind: "manipulate",
	action_id: "author/open-action",
	target_ref: "item:44",
};

describe("RejectionLedger", () => {
	it("suppresses only after a rejection at the same facts_revision", () => {
		const ledger = createRejectionLedger();
		expect(ledger.isSuppressed(draft, epoch, 1)).toBe(false);

		const attempt = createAttempt(draft, epoch, 1);
		ledger.record(attempt, { status: "rejected", reason: "no_target" });

		expect(ledger.isSuppressed(draft, epoch, 1)).toBe(true);
		expect(ledger.isSuppressed(draft, epoch, 2)).toBe(false);
	});

	it("treats null facts_revision as its own value, null equals null", () => {
		const ledger = createRejectionLedger();
		const attempt = createAttempt(draft, epoch, null);
		ledger.record(attempt, { status: "rejected" });

		expect(ledger.isSuppressed(draft, epoch, null)).toBe(true);
		expect(ledger.isSuppressed(draft, epoch, 1)).toBe(false);
	});

	it("only records status rejected; every other outcome is a no-op", () => {
		const ledger = createRejectionLedger();
		const attempt = createAttempt(draft, epoch, 1);
		const nonRejections: Outcome[] = [
			{ status: "sent" },
			{ status: "unobserved" },
			{ status: "accepted" },
			{ status: "pending" },
			{ status: "observed_result" },
			{ status: "transport_error", message: "boom" },
		];
		for (const outcome of nonRejections) ledger.record(attempt, outcome);

		expect(ledger.isSuppressed(draft, epoch, 1)).toBe(false);
		expect(ledger.rejectionCount(draft, epoch)).toBe(0);
		expect(ledger.lastRejection(draft, epoch)).toBeUndefined();
	});

	it("overwrites the recorded revision on a later rejection but keeps counting all of them", () => {
		const ledger = createRejectionLedger();
		ledger.record(createAttempt(draft, epoch, 1), { status: "rejected" });
		ledger.record(createAttempt(draft, epoch, 2), { status: "rejected" });

		expect(ledger.isSuppressed(draft, epoch, 1)).toBe(false);
		expect(ledger.isSuppressed(draft, epoch, 2)).toBe(true);
		expect(ledger.rejectionCount(draft, epoch)).toBe(2);
	});

	it("resetEpoch drops every recorded rejection for that epoch only", () => {
		const ledger = createRejectionLedger();
		const otherEpoch = "w1|actor:1|4|0";
		ledger.record(createAttempt(draft, epoch, 1), { status: "rejected" });
		ledger.record(createAttempt(draft, otherEpoch, 1), { status: "rejected" });

		ledger.resetEpoch(epoch);

		expect(ledger.isSuppressed(draft, epoch, 1)).toBe(false);
		expect(ledger.rejectionCount(draft, epoch)).toBe(0);
		expect(ledger.isSuppressed(draft, otherEpoch, 1)).toBe(true);
	});

	it("does not suppress a different fingerprint in the same epoch", () => {
		const ledger = createRejectionLedger();
		ledger.record(createAttempt(draft, epoch, 1), { status: "rejected" });
		const otherDraft: IntentDraft = { ...draft, target_ref: "item:45" };
		expect(ledger.isSuppressed(otherDraft, epoch, 1)).toBe(false);
	});

	it("lastRejection reports the most recent refusal for display/ranking, undefined when none", () => {
		const ledger = createRejectionLedger();
		expect(ledger.lastRejection(draft, epoch)).toBeUndefined();

		ledger.record(createAttempt(draft, epoch, 1), { status: "rejected", reason: "no_target" });
		expect(ledger.lastRejection(draft, epoch)).toEqual({ reason: "no_target", facts_revision: 1 });

		ledger.record(createAttempt(draft, epoch, 2), {
			status: "rejected",
			reason: "budget_exhausted",
			failure_detail: "insufficient action points",
		});
		expect(ledger.lastRejection(draft, epoch)).toEqual({
			reason: "budget_exhausted",
			failure_detail: "insufficient action points",
			facts_revision: 2,
		});
	});
});
