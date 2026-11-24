import { describe, expect, it } from "vitest";
import { projectSafeEventData, toOtlpLogRecord } from "../otel.ts";
import { eventKindPath, worldTableEventData } from "../world-table-event.ts";

describe("eventKindPath", () => {
	it("flattens nested EventKind the way server event_kind_path does", () => {
		expect(eventKindPath({ tag: "Layer2", value: { tag: "ApplyConsequence" } })).toBe(
			"Layer2.ApplyConsequence",
		);
		expect(eventKindPath({ tag: "Tick" })).toBe("Tick");
		expect(eventKindPath({ tag: "Autonomy", value: {} })).toBe("Autonomy.Job");
	});
});

describe("worldTableEventData", () => {
	it("projects header scalars and drops detail-table content", () => {
		const data = worldTableEventData(
			{
				id: 4711n,
				tick: 300n,
				kind: { tag: "Layer2", value: { tag: "ApplyConsequence" } },
				summary: "Aldwin whispers the passphrase CANARY-DETAIL",
				notable: true,
				payload_json: '{"text":"CANARY-DETAIL"}',
				template_id: "core/speak",
			},
			"elven-mini",
		);
		expect(data).toEqual({
			event_id: "4711",
			tick: 300,
			event_kind: "Layer2.ApplyConsequence",
			world_slug: "elven-mini",
		});
		expect(JSON.stringify(data)).not.toContain("CANARY-DETAIL");
	});
});

describe("world_table_event OTLP disclosure", () => {
	it("admits event_id/tick/event_kind and drops detail-table content", () => {
		const canary = "CANARY-DETAIL-MUST-NOT-CROSS";
		const data = {
			...worldTableEventData({
				id: "4711",
				tick: 300,
				kind: { tag: "Layer2", value: { tag: "ApplyConsequence" } },
				summary: canary,
			}),
			summary: canary,
			payload_json: canary,
			template_id: canary,
			utterance: canary,
		};
		const projected = projectSafeEventData(data);
		expect(projected.event_id).toBe("4711");
		expect(projected.tick).toBe(300);
		expect(projected.event_kind).toBe("Layer2.ApplyConsequence");
		expect(projected).not.toHaveProperty("summary");
		expect(projected).not.toHaveProperty("payload_json");
		expect(projected).not.toHaveProperty("template_id");
		expect(JSON.stringify(projected)).not.toContain(canary);

		const record = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "adventure-host-1",
			run_kind: "world_observation",
			actor_id: "world",
			role: "ADMIN",
			controller_kind: "service",
			driver: "adventure-runtime-host",
			seed: "",
			ts: "2026-09-01T12:00:00.000Z",
			type: "world_table_event",
			data,
		});
		const serialized = JSON.stringify(record);
		expect(serialized).not.toContain(canary);
		expect(serialized).toContain("4711");
		expect(serialized).toContain("Layer2.ApplyConsequence");
	});
});
