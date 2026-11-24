import { describe, expect, it } from "vitest";
import { invoke } from "../tools.ts";

describe("invoke() tool_call telemetry", () => {
	function collect() {
		const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
		return {
			events,
			emitter: {
				emit(kind: string, payload: Record<string, unknown>) {
					events.push({ kind, payload });
				},
			},
		};
	}

	it("records factual context results with the invoked parameters", async () => {
		const { events, emitter } = collect();
		const details = {
			manipulation_context: { status: "ready", actions: [], targets: [], participants: [] },
		};
		await invoke(
			{ name: "spellkave_manipulation_context", execute: async () => ({ details }) },
			{},
			emitter,
		);
		expect(events).toHaveLength(1);
		expect(events[0]?.payload).toMatchObject({
			tool_name: "spellkave_manipulation_context",
			is_error: false,
			params: {},
			observation: details,
		});
	});

	it("adds nothing for other tools", async () => {
		const { events, emitter } = collect();
		await invoke(
			{
				name: "spellkave_scene",
				execute: async () => ({
					details: { total_rows: 5, matched: 5, shown: 5, truncated: false },
				}),
			},
			{},
			emitter,
		);
		expect(events[0]?.payload).not.toHaveProperty("total_rows");
	});
});
