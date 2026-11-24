import { describe, expect, it } from "vitest";

import {
	docEvidenceName,
	docNotApplicableName,
	parseDocEvidenceName,
	parseDocNotApplicableName,
} from "./protocol";

describe("doc-evidence protocol — name round-trip", () => {
	it("round-trips an evidence identity through its rendered test name", () => {
		const identity = {
			doc: "manifest-format",
			tier: "offline",
			claim: "the schema directive is documented as mandatory",
		} as const;
		const name = docEvidenceName(identity);
		expect(name).toBe(
			"[doc-evidence:manifest-format][offline] the schema directive is documented as mandatory",
		);
		expect(parseDocEvidenceName(name)).toEqual(identity);
	});

	it("round-trips every tier value", () => {
		for (const tier of ["offline", "live-preseeded", "live-self-seeding"] as const) {
			const identity = { doc: "dm-oversight", tier, claim: "a claim" };
			expect(parseDocEvidenceName(docEvidenceName(identity))).toEqual(identity);
		}
	});

	it("round-trips a not-applicable identity, carrying the reason in the parsed claim field", () => {
		const identity = {
			doc: "long-running-actions",
			tier: "live-self-seeding" as const,
			reason: "this doc has no offline-provable claim",
		};
		const name = docNotApplicableName(identity);
		expect(name).toBe(
			"[doc-evidence:long-running-actions][live-self-seeding][n/a] this doc has no offline-provable claim",
		);
		expect(parseDocNotApplicableName(name)).toEqual({
			doc: identity.doc,
			tier: identity.tier,
			claim: identity.reason,
		});
	});

	it("does not cross-parse an evidence name as not-applicable or vice versa", () => {
		const evidenceName = docEvidenceName({ doc: "a", tier: "offline", claim: "c" });
		const notApplicableName = docNotApplicableName({ doc: "a", tier: "offline", reason: "r" });
		expect(parseDocNotApplicableName(evidenceName)).toBeUndefined();
		expect(parseDocEvidenceName(notApplicableName)).toBeUndefined();
	});

	it("returns undefined for names outside the doc-evidence namespace", () => {
		expect(parseDocEvidenceName("a plain test name")).toBeUndefined();
		expect(parseDocEvidenceName("[srd:chapter/unit][mechanic] a claim")).toBeUndefined();
		expect(parseDocNotApplicableName("a plain test name")).toBeUndefined();
	});

	it("rejects ']' in doc and claim fields", () => {
		expect(() => docEvidenceName({ doc: "a]b", tier: "offline", claim: "c" })).toThrow(
			/must not contain/,
		);
		expect(() => docEvidenceName({ doc: "a", tier: "offline", claim: "c]d" })).toThrow(
			/must not contain/,
		);
		expect(() => docNotApplicableName({ doc: "a]b", tier: "offline", reason: "r" })).toThrow(
			/must not contain/,
		);
	});

	it("rejects ' :: ' in claim and reason fields", () => {
		expect(() => docEvidenceName({ doc: "a", tier: "offline", claim: "c :: d" })).toThrow(
			/must not contain/,
		);
		expect(() => docNotApplicableName({ doc: "a", tier: "offline", reason: "r :: s" })).toThrow(
			/must not contain/,
		);
	});
});
