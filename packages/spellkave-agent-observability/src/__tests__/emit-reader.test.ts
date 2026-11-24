// Deterministic round-trip coverage for the agent-run-events/v1 contract
// (ADR-0074 S2): envelope stamping, sink fan-out isolation, tolerant parsing,
// and the two judge-facing aggregations.
import { describe, expect, it } from "vitest";
import {
	AGENT_RUN_EVENTS_VERSION,
	aggregateRunTotals,
	classifyTerminal,
	createGatewaySink,
	createMemorySink,
	createOtelProjectionSink,
	createRunEmitter,
	OTEL_SERVICE_NAME,
	OTEL_STREAM_NAME,
	parseRunEvents,
} from "../index.ts";

const FIXED_NOW = () => new Date("2026-07-15T12:00:00.000Z");

function fullEnvelope(runId: string) {
	return {
		v: AGENT_RUN_EVENTS_VERSION,
		run_id: runId,
		run_kind: "world_observation",
		actor_id: "core/player",
		role: "PLAYER",
		controller_kind: "llm_player",
		driver: "pi-agent",
		seed: "",
		ts: "2026-07-15T12:00:00.000Z",
	};
}

function emitterOver(sinks: Parameters<typeof createRunEmitter>[1]) {
	return createRunEmitter(
		{
			run_id: "run-1",
			run_kind: "world_observation",
			actor_id: "core/player",
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: "pi-agent",
			model: "gpt-5.5",
			seed: "42",
			now: FIXED_NOW,
		},
		sinks,
	);
}

describe("createRunEmitter", () => {
	it("stamps the mandatory v1 envelope on every event", () => {
		const sink = createMemorySink();
		const emitter = emitterOver([sink]);
		emitter.emit("run_start");
		emitter.emit("tool_call", { tool_name: "spellkave_move" });
		expect(sink.events).toHaveLength(2);
		for (const event of sink.events) {
			expect(event.v).toBe(AGENT_RUN_EVENTS_VERSION);
			expect(event.run_id).toBe("run-1");
			expect(event.run_kind).toBe("world_observation");
			expect(event.controller_kind).toBe("llm_player");
			expect(event.driver).toBe("pi-agent");
			expect(event.seed).toBe("42");
			expect(event.ts).toBe("2026-07-15T12:00:00.000Z");
		}
		expect(sink.events[1]?.data).toEqual({ tool_name: "spellkave_move" });
	});

	it("emits player_feedback with reference + bundle hash only (never the body)", () => {
		const sink = createMemorySink();
		const emitter = emitterOver([sink]);
		emitter.emit("player_feedback", {
			reference: "https://github.com/example/spellkave/issues/9999",
			category: "bug",
			message_chars: 42,
			bundle_sha256: "a".repeat(64),
			world_slug: "elven-mini",
			correlation_id: "corr-fb-1",
		});
		expect(sink.events).toHaveLength(1);
		const event = sink.events[0];
		expect(event?.type).toBe("player_feedback");
		expect(event?.run_id).toBe("run-1");
		expect(event?.data).toEqual({
			reference: "https://github.com/example/spellkave/issues/9999",
			category: "bug",
			message_chars: 42,
			bundle_sha256: "a".repeat(64),
			world_slug: "elven-mini",
			correlation_id: "corr-fb-1",
		});
		// Deterministic JSONL fixture — join keys only, no message/bundle body.
		expect(JSON.stringify(event)).toMatchSnapshot();
		expect(JSON.stringify(event)).not.toMatch(/must-gather|"message":/);
	});

	it("a throwing sink loses only its own copy — other sinks still receive", () => {
		const good = createMemorySink();
		const bad = {
			write() {
				throw new Error("sink down");
			},
		};
		const emitter = emitterOver([bad, good]);
		emitter.emit("run_start");
		expect(good.events).toHaveLength(1);
	});

	it("gateway sink hands events to the host callback", () => {
		const seen: string[] = [];
		const emitter = emitterOver([createGatewaySink((event) => seen.push(event.type))]);
		emitter.emit("turn_start");
		emitter.emit("turn_end");
		expect(seen).toEqual(["turn_start", "turn_end"]);
	});

	it("otel projection sink uses world-actor resource names (never ADR-0030 streams)", () => {
		const resources: Array<{ serviceName: string; stream: string }> = [];
		const emitter = emitterOver([
			createOtelProjectionSink({ export: (resource) => resources.push(resource) }),
		]);
		emitter.emit("run_start");
		expect(resources).toEqual([{ serviceName: OTEL_SERVICE_NAME, stream: OTEL_STREAM_NAME }]);
		expect(OTEL_STREAM_NAME).not.toBe("coding_agent_events");
		expect(OTEL_STREAM_NAME).not.toBe("agent_traces_raw");
	});

	it("deterministic: true uses a synthetic advancing clock and freezes duration_ms", () => {
		const sink = createMemorySink();
		const emitter = createRunEmitter(
			{
				run_id: "stable-run",
				run_kind: "campaign_playthrough",
				actor_id: "hero",
				role: "PLAYER",
				controller_kind: "deterministic_npc",
				driver: "test",
				deterministic: true,
			},
			[sink],
		);
		emitter.emit("run_start");
		emitter.emit("tool_call", { tool_name: "spellkave_scene", duration_ms: 42 });
		expect(sink.events[0]?.ts).toBe("2026-01-01T00:00:00.000Z");
		expect(sink.events[1]?.ts).toBe("2026-01-01T00:00:00.001Z");
		expect(sink.events[1]?.data.duration_ms).toBe(0);
	});

	it("explicit now wins over deterministic; freezeDurationMs can be forced off", () => {
		const sink = createMemorySink();
		const emitter = createRunEmitter(
			{
				run_id: "stable-run",
				run_kind: "campaign_playthrough",
				actor_id: "hero",
				role: "PLAYER",
				controller_kind: "deterministic_npc",
				driver: "test",
				deterministic: true,
				now: () => new Date("2030-06-01T00:00:00.000Z"),
				freezeDurationMs: false,
			},
			[sink],
		);
		emitter.emit("tool_call", { duration_ms: 7 });
		expect(sink.events[0]?.ts).toBe("2030-06-01T00:00:00.000Z");
		expect(sink.events[0]?.data.duration_ms).toBe(7);
	});
});

describe("createMemorySink — maxEvents cap (2026-08-06 wedged-session hardening)", () => {
	it("default (no options) stays uncapped — existing behavior byte-identical", () => {
		const sink = createMemorySink();
		const emitter = emitterOver([sink]);
		for (let i = 0; i < 25; i++) emitter.emit("tool_call", { tool_name: `t${i}` });
		expect(sink.events).toHaveLength(25);
		expect(sink.events.some((event) => event.type === "sink_truncated")).toBe(false);
	});

	it("accepts events up to maxEvents with no truncation marker", () => {
		const sink = createMemorySink({ maxEvents: 5 });
		const emitter = emitterOver([sink]);
		for (let i = 0; i < 5; i++) emitter.emit("tool_call", { tool_name: `t${i}` });
		expect(sink.events).toHaveLength(5);
		expect(sink.events.every((event) => event.type === "tool_call")).toBe(true);
	});

	it("stops appending past maxEvents and emits exactly one sink_truncated marker", () => {
		const sink = createMemorySink({ maxEvents: 5 });
		const emitter = emitterOver([sink]);
		for (let i = 0; i < 25; i++) emitter.emit("tool_call", { tool_name: `t${i}` });
		// 5 accepted + 1 truncation marker in place of the 6th — every write
		// after that is a silent no-op, never a second marker.
		expect(sink.events).toHaveLength(6);
		expect(sink.events.slice(0, 5).every((event) => event.type === "tool_call")).toBe(true);
		const marker = sink.events[5];
		expect(marker?.type).toBe("sink_truncated");
		expect(marker?.data).toEqual({ max_events: 5, events_written: 5 });
		// The marker still carries the stamped envelope — a reader can still
		// tell which run/actor truncated, same as every other event type.
		expect(marker?.run_id).toBe("run-1");
		expect(marker?.actor_id).toBe("core/player");
	});

	it("one sink's cap never affects a sibling sink in the same fan-out", () => {
		const capped = createMemorySink({ maxEvents: 1 });
		const uncapped = createMemorySink();
		const emitter = emitterOver([capped, uncapped]);
		emitter.emit("tool_call", { tool_name: "a" });
		emitter.emit("tool_call", { tool_name: "b" });
		expect(capped.events).toHaveLength(2); // 1 accepted + 1 truncation marker
		expect(uncapped.events).toHaveLength(2); // unaffected
	});
});

describe("parseRunEvents", () => {
	it("round-trips emitted events through JSONL", () => {
		const sink = createMemorySink();
		const emitter = emitterOver([sink]);
		emitter.emit("run_start");
		emitter.emit("tool_call", { tool_name: "spellkave_move", is_error: false });
		emitter.emit("run_end", { terminal: "explored_enough" });
		const jsonl = sink.events.map((event) => JSON.stringify(event)).join("\n");
		const parsed = parseRunEvents(jsonl);
		expect(parsed.skipped).toBe(0);
		expect(parsed.events).toEqual(sink.events);
	});

	it("tolerates unknown EXTRA fields, skips foreign and broken lines", () => {
		const v1 = JSON.stringify({
			...fullEnvelope("run-2"),
			type: "run_start",
			data: {},
			future_field: { nested: true },
		});
		const foreign = JSON.stringify({ stream: "coding_agent_events", msg: "coding-agent line" });
		const parsed = parseRunEvents([v1, foreign, "{not json", ""].join("\n"));
		expect(parsed.events).toHaveLength(1);
		expect(parsed.skipped).toBe(2);
		expect((parsed.events[0] as unknown as Record<string, unknown>).future_field).toEqual({
			nested: true,
		});
	});

	it("skips lines missing REQUIRED envelope fields (tolerance never optionalises the envelope)", () => {
		// A v/run_id/type-only record must be SKIPPED, not accepted with holes a
		// strict consumer (run index sorting on ts) would trip over.
		const partial = JSON.stringify({
			v: AGENT_RUN_EVENTS_VERSION,
			run_id: "run-partial",
			type: "run_start",
		});
		const noTs = JSON.stringify({ ...fullEnvelope("run-4"), ts: undefined, type: "run_start" });
		const parsed = parseRunEvents([partial, noTs].join("\n"));
		expect(parsed.events).toHaveLength(0);
		expect(parsed.skipped).toBe(2);
	});

	it("normalises a missing data payload to an empty record", () => {
		const line = JSON.stringify({ ...fullEnvelope("run-3"), type: "terminal" });
		const parsed = parseRunEvents(line);
		expect(parsed.events[0]?.data).toEqual({});
	});
});

describe("aggregations", () => {
	it("computes per-run tool-call/token totals", () => {
		const sink = createMemorySink();
		const emitter = emitterOver([sink]);
		emitter.emit("run_start");
		emitter.emit("tool_call", { tool_name: "spellkave_move" });
		emitter.emit("tool_call", { tool_name: "spellkave_manipulate", is_error: true });
		emitter.emit("gap_report", { surface: "world" });
		emitter.emit("turn_end", { input_tokens: 100, output_tokens: 20 });
		emitter.emit("turn_end", { input_tokens: 150, output_tokens: 30 });
		const totals = aggregateRunTotals(sink.events);
		expect(totals).toEqual({
			run_id: "run-1",
			tool_calls: 2,
			tool_errors: 1,
			turns: 2,
			input_tokens: 250,
			output_tokens: 50,
			gap_reports: 1,
		});
	});

	it("classifies the terminal and flags incomplete runs", () => {
		const sink = createMemorySink();
		const emitter = emitterOver([sink]);
		emitter.emit("run_start");
		emitter.emit("terminal", { terminal: "converged", reason: "dry-streak" });
		expect(classifyTerminal(sink.events)).toEqual({
			terminal: "converged",
			reason: "dry-streak",
			incomplete: true,
		});
		emitter.emit("run_end", { terminal: "converged" });
		expect(classifyTerminal(sink.events).incomplete).toBe(false);
	});
});
