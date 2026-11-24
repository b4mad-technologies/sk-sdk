import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import { expect, it } from "vitest";
import { getAuthoringDoc } from "../corpus";


it("persona matrix preserves all task lenses and separates repository governance", () => {
	const doc = getAuthoringDoc("personas/access");
	for (const lens of [
		"Game System Author",
		"Adventure Author",
		"DM",
		"Elevated Player",
		"Player",
		"AI Inhabitant",
		"Observer",
		"Publisher/operator",
		"Kernel developer/CI maintainer",
		"Reviewer/canon steward",
	])
		expect(doc?.body).toContain(lens);
	expect(doc?.source_path).toBe("packages/spellkave-cli/docs/persona-routes.md");
	expect(doc?.body).toContain("not a grant");
	expect(doc?.body).toContain("repository skills");
});
it("PLAYER owns its loop and every named gameplay tool belongs to the canonical roster", () => {
	const doc = getAuthoringDoc("player/workflows");
	expect(doc?.source_path).toBe("packages/spellkave-tool-player/docs/player-loop.md");
	const names = [...(doc?.body ?? "").matchAll(/`(spellkave_[a-z_]+)`/g)].map((match) => match[1]);
	for (const name of names)
		if (name !== "spellkave_docs") expect(PLAYER_TOOL_NAMES).toContain(name);
});
