import { bindTool } from "@spellkave/tool-runtime";
import { describe, expect, it } from "vitest";
import { type AuthorTarget, queryToolDef } from "../index.ts";

function query(kind: AuthorTarget["kind"]) {
	const target: AuthorTarget = {
		kind,
		lookup: () => [],
		resolveRef: () => false,
		applyBatch: async () => ({ ok: true }),
	};
	return bindTool(queryToolDef, {
		context: {
			workspace: { readToml: () => null, writeToml: () => "unused" },
			target,
		},
		capabilities: {},
	});
}

describe("DM act references to genesis vocabulary", () => {
	it.each([
		undefined,
		"local",
	] as const)("resolves the actual genesis capability from file targets (%s)", async (target) => {
		const result = await query("local").execute("genesis", {
			kind: "capability_definitions",
			id: "frontier.afflict",
			...(target === undefined ? {} : { target }),
		});
		expect(result.details).toMatchObject({
			shape: "detail",
			found: true,
			row: { capability_id: "frontier.afflict" },
		});
	});
	it("does not invent genesis rows in live reads", async () => {
		const result = await query("live").execute("live", {
			kind: "capability_definitions",
			id: "frontier.afflict",
		});
		expect(result.details).toMatchObject({ found: false });
	});
	it("keeps an explicit workspace read confined to authored rows", async () => {
		const result = await query("local").execute("workspace", {
			kind: "capability_definitions",
			id: "frontier.afflict",
			target: "workspace",
		});
		expect(result.details).toMatchObject({ found: false });
	});
});
