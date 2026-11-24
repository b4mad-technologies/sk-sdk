import { describe, expect, it } from "vitest";
import { manipulationArgsFromJson } from "./manipulation_args";

describe("coordinated authority arguments", () => {
	it("preserves all four arguments at the reducer boundary", () => {
		const args = manipulationArgsFromJson(
			JSON.stringify({
				definition_ref: "test/wolf",
				participant_entity_ids: ["7"],
				private_input_ref: "input:opaque",
				dispatch_options: [],
			}),
		);
		expect(args.definitionRef).toBe("test/wolf");
		expect(args.participantEntityIds).toEqual([7n]);
		expect(args.privateInputRef).toBe("input:opaque");
		expect(args.dispatchOptions).toEqual([]);
	});
	it.each([
		0,
		-1,
		1.5,
		Number.MAX_SAFE_INTEGER + 1,
		"-2",
		"1.5",
		"18446744073709551616",
		{},
		null,
	])("refuses malformed enrollment entity id %j", (id) => {
		expect(() =>
			manipulationArgsFromJson(JSON.stringify({ participant_entity_ids: [id] })),
		).toThrow();
	});
	it("keeps enrollment separate from disclosed participant roles", () => {
		const args = manipulationArgsFromJson(
			JSON.stringify({
				participant_entity_ids: ["7"],
				expected_participants: [{ role_id: "defender", entity_id: "8" }],
			}),
		);
		expect(args.participantEntityIds).toEqual([7n]);
		expect(args.expectedParticipants).toEqual([{ roleId: "defender", entityId: 8n }]);
	});
	it("keeps omitted reserved arguments absent", () => {
		const args = manipulationArgsFromJson("{}");
		expect(args.participantEntityIds).toBeUndefined();
		expect(args.dispatchOptions).toBeUndefined();
	});
	it("rejects malformed option arrays instead of dropping them", () => {
		expect(() => manipulationArgsFromJson('{"dispatch_options":"bad"}')).toThrow(
			"must be an array",
		);
	});
});

// K2: typed BSATN options preserve null slots while JSON tool callers use explicit nulls.
it("carries optional parallel definition refs without losing absent slots", () => {
	const args = manipulationArgsFromJson(
		'{"dispatch_options":["First","Second"],"dispatch_option_refs":["exact/definition",null]}',
	);
	expect(args.dispatchOptionRefs).toEqual(["exact/definition", undefined]);
	expect(manipulationArgsFromJson("{}").dispatchOptionRefs).toBeUndefined();
	expect(() => manipulationArgsFromJson('{"dispatch_option_refs":[7]}')).toThrow(
		"definition refs or null",
	);
});
