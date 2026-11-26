import { describe, expect, it } from "vitest";
import {
	normalizeWorldActorCausalContext,
	worldActorCausalAttributes,
	worldActorCausalEventData,
} from "../correlation.ts";

describe("world-actor causal context", () => {
	it("retains bounded safe references and drops unknown or nested values", () => {
		const context = normalizeWorldActorCausalContext({
			correlation_id: " corr-1 ",
			world_slug: "kavemouth",
			cause_kind: "visible_trace",
			cause_id: "trace-9",
			action_id: "equip",
			unknown: "secret",
			target_ref: { nested: "private" },
		});
		expect(context).toEqual({
			correlation_id: "corr-1",
			world_slug: "kavemouth",
			cause_kind: "visible_trace",
			cause_id: "trace-9",
			action_id: "equip",
		});
		expect(worldActorCausalEventData(context)).toEqual(context);
		expect(worldActorCausalAttributes(context)).toEqual({
			"spellkave.correlation_id": "corr-1",
			"spellkave.world_slug": "kavemouth",
			"spellkave.cause_kind": "visible_trace",
			"spellkave.cause_id": "trace-9",
			"spellkave.action_id": "equip",
		});
	});

	it("omits incomplete world-cause links instead of fabricating causality", () => {
		expect(
			normalizeWorldActorCausalContext({ correlation_id: "corr-2", cause_kind: "event" }),
		).toEqual({ correlation_id: "corr-2" });
		expect(normalizeWorldActorCausalContext({ cause_id: "event-1" })).toBeUndefined();
	});

	it("bounds high-cardinality identifiers", () => {
		const context = normalizeWorldActorCausalContext({ correlation_id: "x".repeat(300) });
		expect(context?.correlation_id).toHaveLength(256);
	});
});
