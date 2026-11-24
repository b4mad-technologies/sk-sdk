import { AUTHOR_TOOL_NAMES, getToolContract } from "@spellkave/tool-contracts";
import { describe, expect, it } from "vitest";

import { AUTHOR_FACING_TOOL_NAMES, authorFacingToolDefinitions } from "../authoring.ts";

describe("canonical AUTHOR execution", () => {
	it("binds every contract exactly once in canonical roster and schema order", () => {
		expect(AUTHOR_FACING_TOOL_NAMES).toEqual(AUTHOR_TOOL_NAMES);
		expect(authorFacingToolDefinitions.map((definition) => definition.name)).toEqual(
			AUTHOR_TOOL_NAMES,
		);
		for (const definition of authorFacingToolDefinitions) {
			const contract = getToolContract(definition.name);
			expect(definition.roles).toEqual(contract.roles);
			expect(JSON.stringify(definition.parameters)).toBe(JSON.stringify(contract.parameters));
		}
	});
});
