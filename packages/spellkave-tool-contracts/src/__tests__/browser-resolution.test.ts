import { describe, expect, it } from "vitest";

import { getToolParameters, TOOL_CONTRACTS } from "../index";

describe("browser-safe contract entry", () => {
	it("rehydrates every JSON-only TypeBox schema without changing its serialization", () => {
		for (const contract of TOOL_CONTRACTS) {
			expect(JSON.parse(JSON.stringify(getToolParameters(contract.name)))).toEqual(
				contract.parameters,
			);
		}
	});
});
