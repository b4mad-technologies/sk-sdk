// The admission probe behind `sk can-i` is for world authors only: the
// shipped PLAYER tools, the DM seat (`DmSeatPort`) and the non-author part
// of the tool contracts never call it. This test reads those files and fails
// when one of them names the probe. Reads repository files; no node.
// Decided in ADR-0148 D-4.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

function callsProbe(source: string): boolean {
	return source.includes("probe_manipulate") || source.includes("probeManipulate");
}

describe("shipped surfaces do not call the probe", () => {
	it("fails when a fixture adds the call", () => {
		expect(callsProbe("await conn.procedures.probeManipulate({})")).toBe(true);
	});

	it("passes on the PLAYER tools, the DM roster source, and DmSeatPort", () => {
		for (const rel of [
			"packages/spellkave-tool-player/src/tools.ts",
			"packages/spellkave-tool-contracts/src/contracts-metadata.json",
		]) {
			const source = readFileSync(resolve(repo, rel), "utf8");
			const playerAndSeat = rel.endsWith("contracts-metadata.json")
				? source.slice(0, source.indexOf('"AUTHOR"'))
				: source;
			expect(callsProbe(playerAndSeat), rel).toBe(false);
		}
	});
});
