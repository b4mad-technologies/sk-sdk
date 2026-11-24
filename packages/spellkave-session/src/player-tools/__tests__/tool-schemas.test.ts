import {
	MOVE_PARAMS,
	READ_ONLY_TOOL_NAMES,
	SELF_STATES_PARAMS,
	SPELLKAVE_MOVE_TOOL,
	SPELLKAVE_STATUS_TOOL,
	TOOL_SCHEMAS,
} from "@spellkave/tool-contracts/schemas";
import { describe, expect, it } from "vitest";

describe("canonical player schemas", () => {
	it("exposes TypeBox-compatible schemas for read tools and approved movement", () => {
		expect(READ_ONLY_TOOL_NAMES).toEqual([
			"spellkave_status",
			"spellkave_events",
			"spellkave_suggest_next_action",
			"spellkave_manipulation_context",
			"spellkave_sense_context",
			"spellkave_entity_container",
			"spellkave_observer_knowledge",
			"spellkave_observer_place_knowledge",
			"spellkave_observer_trace_knowledge",
			"spellkave_traces",
			"spellkave_trace_detail",
			"spellkave_session_status",
			"spellkave_reaction_options",
			"spellkave_intervention_windows",
			"spellkave_entity_body",
			"spellkave_actor_principals",
		]);
		expect(TOOL_SCHEMAS[SPELLKAVE_STATUS_TOOL]).toMatchObject({
			type: "object",
			properties: {},
		});
		expect(TOOL_SCHEMAS[SPELLKAVE_MOVE_TOOL]).toBe(MOVE_PARAMS);
		expect(MOVE_PARAMS).toMatchObject({
			type: "object",
			properties: {
				edge_id: { type: "string" },
			},
		});
	});

	it("keeps orientation selectors author-defined", () => {
		expect(SELF_STATES_PARAMS).toMatchObject({
			properties: { state_tag: { type: "string" } },
		});
	});
});
