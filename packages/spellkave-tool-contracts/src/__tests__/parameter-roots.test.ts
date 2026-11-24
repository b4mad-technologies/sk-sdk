import { describe, expect, it } from "vitest";

import { RAW_TOOL_CONTRACT_DATA } from "../contract-data";
import { TOOL_CONTRACTS } from "../metadata";

/**
 * OpenAI-backed hosts reject a tool whose `parameters` root is an anyOf/oneOf
 * union, and Pi forwards our TypeBox schema verbatim — a union root took down
 * every prompt that carried the AUTHOR roster (sk-jay0.7.90). Unions below the
 * root are fine; only the root is constrained.
 */
describe("tool parameter roots", () => {
	const serialised = TOOL_CONTRACTS.map((contract) => ({
		name: contract.name,
		schema: JSON.parse(JSON.stringify(contract.parameters)) as Record<string, unknown>,
	}));

	it("exposes every live contract as a plain object root", () => {
		const offenders = serialised.filter(
			({ schema }) =>
				schema.type !== "object" ||
				schema.anyOf !== undefined ||
				schema.oneOf !== undefined ||
				schema.allOf !== undefined,
		);
		expect(offenders.map(({ name }) => name)).toEqual([]);
	});

	it("keeps the serialised contract fixture on object roots too", () => {
		const offenders = RAW_TOOL_CONTRACT_DATA.tools.filter(
			(contract) =>
				contract.parameters.type !== "object" ||
				contract.parameters.anyOf !== undefined ||
				contract.parameters.oneOf !== undefined ||
				contract.parameters.allOf !== undefined,
		);
		expect(offenders.map((contract) => contract.name)).toEqual([]);
	});
});
