// A behaviour guide quotes what a tool answered under each recipe. When a
// run was refused, the quote is the refusal a person sees; when it was not,
// the guide must not quote stderr noise as one. These tests pin which text
// counts as the refusal of one run's transcript. Pure; no tool runs.
import { expect, it } from "vitest";

import { refusalOf } from "./guide.ts";

// keep-file(K1): rule cases of one pure function over a transcript

const run = (stdout: string[], stderr: string[], exit: number) =>
	["$ sk diff -k world", ...stdout, "[stderr]", ...stderr, `[exit ${exit}]`].join("\n");

it("quotes the message of an error record on stdout", () => {
	expect(refusalOf(run(['{"kind":"error","message":"usage: sk apply -k <dir>"}'], [], 1))).toBe(
		"usage: sk apply -k <dir>",
	);
});

it("quotes the first stderr line of a refused run, skipping JSON diagnostics", () => {
	const body = run([], ['{"kind":"binding_drift_additive"}', "refused: no authority"], 2);
	expect(refusalOf(body)).toBe("refused: no authority");
});

it("treats an exit the suite names as an answer, not a refusal", () => {
	const body = run(
		['{"kind":"diff_result","differences":true}'],
		['{"kind":"binding_drift_additive"}'],
		3,
	);
	expect(refusalOf(body, [3])).toBeUndefined();
	expect(refusalOf(body)).toBeUndefined();
});

it("finds no refusal in a run that succeeded", () => {
	expect(refusalOf(run(['{"kind":"apply_result"}'], ["a warning"], 0))).toBeUndefined();
});
