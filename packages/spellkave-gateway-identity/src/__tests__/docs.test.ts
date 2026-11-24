// A reader of this package's README and behaviour guide can trust them: the
// README is what `behaviour-docs readme` writes from the sources today, the
// guide came from the current .feature files, and every @code tag names code
// that exists. Reads files only; the guide itself needs a behaviour run, so it
// is checked against the features it came from, not re-run.

import { resolve } from "node:path";

import {
	danglingCodeTags,
	guideDrift,
	loadDocsConfig,
	readmeDrift,
} from "@spellkave/behaviour/docs";
import { expect, it } from "vitest";

const PKG = resolve(import.meta.dirname, "../..");

// keep(K4): README drift gate
it("README.md is what behaviour-docs readme writes", async () => {
	expect(readmeDrift(PKG, await loadDocsConfig(PKG))).toEqual([]);
});

// keep(K4): guide drift gate
it("docs/guide.md and docs/scenarios.md were generated from the current .feature files", () => {
	expect(guideDrift(PKG)).toEqual([]);
});

// keep(K4): every scenario's code link names code that exists
it("every @code tag in the .feature files names an existing file and symbol", () => {
	expect(danglingCodeTags(PKG)).toEqual([]);
});
