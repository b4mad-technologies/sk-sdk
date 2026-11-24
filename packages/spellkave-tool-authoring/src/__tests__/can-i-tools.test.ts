import { describe, expect, it } from "vitest";
import {
	type CanIVerdict,
	disagreementNote,
	renderCanIHuman,
	resultFromProbe,
} from "../can-i-tools";

const admitted: CanIVerdict = {
	admitted: true,
	checks: [
		{ label: "actor_inhabits_body", result: "passed" },
		{ label: "resolution", result: "not_run" },
	],
	refusing_check: "",
	failure_kind: "",
	errored_check: "",
	template_id: "core/mark/affordance",
	niche_id: "core/mark",
	draws: [],
	repeat_may_differ: false,
	disclosed: false,
};

describe("can-i result mapping", () => {
	it("reports an admitted attempt and the disclosure note", () => {
		const result = resultFromProbe({ kind: "verdict", verdict: admitted }, undefined);
		expect(result.ok).toBe(true);
		expect(result.answer).toBe("admitted");
		expect(result.note).toBe(disagreementNote(true, false));
	});

	it("treats refused as an answer", () => {
		const result = resultFromProbe(
			{
				kind: "verdict",
				verdict: {
					...admitted,
					admitted: false,
					refusing_check: "reachability",
					failure_kind: "out_of_range",
					disclosed: true,
				},
			},
			undefined,
		);
		expect(result.ok).toBe(true);
		expect(result.admitted).toBe(false);
		expect(result.refusing_check).toBe("reachability");
	});

	it("rejects an expectation that does not hold", () => {
		const result = resultFromProbe({ kind: "verdict", verdict: admitted }, "refused");
		expect(result.ok).toBe(false);
		expect(result.expected).toBe("refused");
		expect(result.actual).toBe("admitted");
	});

	it("names a refused caller and carries no verdict", () => {
		const result = resultFromProbe({ kind: "refused_caller" }, undefined);
		expect(result.ok).toBe(false);
		expect(result.cause).toContain("frontier.apply_manifest");
		expect(result.checks).toBeUndefined();
	});

	it("renders one line per check", () => {
		expect(
			renderCanIHuman(resultFromProbe({ kind: "verdict", verdict: admitted }, undefined)),
		).toBe(
			[
				"admitted",
				"admitted is true and disclosed is false; neither is a fault.",
				"actor_inhabits_body passed",
				"resolution not_run",
			].join("\n"),
		);
	});

	it("renders a refused verdict without amounts", () => {
		expect(
			renderCanIHuman(
				resultFromProbe(
					{
						kind: "verdict",
						verdict: {
							...admitted,
							admitted: false,
							disclosed: false,
							refusing_check: "budget",
							failure_kind: "budget_exhausted",
						},
					},
					undefined,
				),
			),
		).toBe(["refused", "actor_inhabits_body passed", "resolution not_run"].join("\n"));
	});

	it("renders an errored verdict with no error text", () => {
		expect(
			renderCanIHuman(
				resultFromProbe(
					{
						kind: "verdict",
						verdict: {
							...admitted,
							admitted: false,
							disclosed: false,
							errored_check: "busy",
							checks: [],
						},
					},
					undefined,
				),
			),
		).toBe("errored\nbusy errored");
	});
});
