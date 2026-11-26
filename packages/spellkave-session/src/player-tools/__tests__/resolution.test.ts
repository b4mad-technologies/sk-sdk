import { describe, expect, it } from "vitest";
import { describeResolutionOutcome, parseResolutionSummary } from "../resolution";

// Modeled on the real selected_template_ids shape a stochastic attack
// dispatch writes (kavemouth fixtures/story/05-fight-slime.md) — real
// template ids, precondition/claim annotations, and the resolution_*
// prefixed lines mixed together in one flat string array.
function stochasticSuccessIds(): string[] {
	return [
		"srd/attack/melee/affordance",
		"srd/attack/melee/outcome",
		"srd/attack/melee",
		"precondition:visibility",
		"resolution_mode:stochastic:predicate=let attack_roll = d20; macro(...)",
		"resolution_predicate:let attack_roll = d20; macro(...)",
		"resolution_result:true",
		"resolution_branch:on_success",
		"resolution_consequence:srd/attack/melee/success",
	];
}

function stochasticFailureIds(): string[] {
	return [
		"srd/attack/melee/affordance",
		"resolution_mode:stochastic:predicate=let attack_roll = d20; macro(...)",
		"resolution_result:false",
		"resolution_branch:on_failure",
		"resolution_consequence:srd/attack/melee/miss",
	];
}

describe("parseResolutionSummary (U1 minimal fix)", () => {
	it("parses a success line into mode/result/consequence", () => {
		expect(parseResolutionSummary(stochasticSuccessIds())).toEqual({
			mode: "stochastic",
			result: "success",
			consequence: "srd/attack/melee/success",
		});
	});

	it("parses a failure line into mode/result/consequence", () => {
		expect(parseResolutionSummary(stochasticFailureIds())).toEqual({
			mode: "stochastic",
			result: "failure",
			consequence: "srd/attack/melee/miss",
		});
	});

	it("falls back to resolution_branch when resolution_result is absent", () => {
		const ids = [
			"resolution_mode:stochastic:predicate=x",
			"resolution_branch:on_success",
			"resolution_consequence:srd/attack/melee/success",
		];
		expect(parseResolutionSummary(ids)).toEqual({
			mode: "stochastic",
			result: "success",
			consequence: "srd/attack/melee/success",
		});
	});

	it("returns null for a non-stochastic outcome that writes none of the resolution_* lines", () => {
		expect(
			parseResolutionSummary(["core/inspect/affordance", "precondition:visibility"]),
		).toBeNull();
	});

	it("returns null for undefined selected_template_ids (no provenance at all)", () => {
		expect(parseResolutionSummary(undefined)).toBeNull();
	});

	it("returns null when only a partial set of resolution_* lines is present", () => {
		// resolution_consequence missing — an honest omission beats a guess.
		expect(
			parseResolutionSummary(["resolution_mode:stochastic:predicate=x", "resolution_result:true"]),
		).toBeNull();
	});

	it("takes only the mode's first segment, dropping the embedded :predicate=... suffix", () => {
		const ids = [
			"resolution_mode:stochastic:predicate=let attack_roll = d20; macro('a', 'b:c')",
			"resolution_result:true",
			"resolution_consequence:srd/attack/melee/success",
		];
		expect(parseResolutionSummary(ids)?.mode).toBe("stochastic");
	});

	// U1 follow-up (T16 live finding, react_option piggyback, 2026-08-04):
	// r_react's own provenance (r_react.rs) writes resolution_result/
	// resolution_branch/resolution_consequence but never a resolution_mode
	// line at all — that annotation is r_manipulate-specific. Modeled on the
	// real Opportunity Attack reaction shape (kavemouth
	// fixtures/story/05-fight-slime.md).
	function reactionSuccessIds(): string[] {
		return [
			"srd/attack/opportunity-attack/affordance",
			"srd/attack/opportunity-attack",
			"resolution_result:true",
			"resolution_branch:on_success",
			"resolution_consequence:srd/attack/opportunity-attack/success",
		];
	}

	it("resolves result/consequence for a reaction outcome that carries no resolution_mode line at all — `mode` is simply absent, not fabricated", () => {
		const summary = parseResolutionSummary(reactionSuccessIds());
		expect(summary).toEqual({
			result: "success",
			consequence: "srd/attack/opportunity-attack/success",
		});
		expect(summary).not.toBeNull();
		expect(summary && "mode" in summary).toBe(false);
	});

	it("still returns null for a reaction outcome missing consequence too — mode alone being optional does not loosen the other two", () => {
		expect(
			parseResolutionSummary(["resolution_result:true", "resolution_branch:on_success"]),
		).toBeNull();
	});
});

describe("describeResolutionOutcome (sk-dms.38)", () => {
	const labels = { action: "Melee Attack", target: "Crypt Warden" };

	it("says lands on a success resolution", () => {
		expect(
			describeResolutionOutcome(
				{ mode: "stochastic", result: "success", consequence: "srd/attack/melee/success" },
				labels,
			),
		).toBe("Your Melee Attack lands on Crypt Warden.");
	});

	it("says misses on a failure resolution", () => {
		expect(
			describeResolutionOutcome(
				{ mode: "stochastic", result: "failure", consequence: "srd/attack/melee/miss" },
				labels,
			),
		).toBe("Your Melee Attack misses Crypt Warden.");
	});
});
