// An operator or client author reads the PLAYER MCP gateway's README and
// behaviour guide to learn its routes and how it answers; this file checks
// that those documents still match their sources (the .feature files, the
// header comments, the unit-test markers). Offline: it reads files and needs
// no node, network or last behaviour run. Checks from @spellkave/behaviour
// (ADR-0156).

import { resolve } from "node:path";

import {
	danglingCodeTags,
	guideDrift,
	loadDocsConfig,
	readmeDrift,
} from "@spellkave/behaviour/docs";
import { expect, it } from "vitest";

const PKG = resolve(import.meta.dirname, "../..");

// keep(K4): README, guide and code-link drift gate
it("README, guide and @code tags match the .feature files and the source", async () => {
	expect(readmeDrift(PKG, await loadDocsConfig(PKG))).toEqual([]);
	expect(guideDrift(PKG)).toEqual([]);
	expect(danglingCodeTags(PKG)).toEqual([]);
});
