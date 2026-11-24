// #2003: sk daemon run-events emission — mode parsing, sink selection, and
// the emitted event shapes. No live SpacetimeDB node anywhere in this file.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type AgentRunEvent,
	createMemorySink,
	createOtlpHttpMetrics,
} from "@spellkave/agent-observability";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionBinding } from "../../spellkave-session/src/binding.ts";
import {
	createSessionCausalTelemetry,
	createSessionRunObserver,
	DEFAULT_RUN_EVENTS_MAX_BYTES,
	OFF_SESSION_RUN_OBSERVER,
	otlpLogsHeadersFromEnv,
	parseRunEventsMaxBytes,
	parseRunEventsMode,
	RUN_EVENTS_MODES,
	resolveReducerAttemptTelemetry,
	resolveWorldActorMetrics,
	SESSION_METRICS_SERVICE_NAME,
	SESSION_RUN_DRIVER,
	sessionRunArtifactPath,
} from "../../spellkave-session/src/node/observability.ts";
import { runEventsPath } from "../../spellkave-session/src/node/paths.ts";

const binding: SessionBinding = {
	url: "http://127.0.0.1:3000",
	db: "spellkave-dev",
	identity: "tok-abc",
	actorId: "hero-1",
};

describe("parseRunEventsMode", () => {
	it("defaults to 'jsonl' when unset", () => {
		expect(parseRunEventsMode({})).toBe("jsonl");
	});

	it("defaults to 'jsonl' for an empty/whitespace value", () => {
		expect(parseRunEventsMode({ SPELLKAVE_RUN_EVENTS: "  " })).toBe("jsonl");
	});

	it.each(RUN_EVENTS_MODES)("accepts %s", (mode) => {
		expect(parseRunEventsMode({ SPELLKAVE_RUN_EVENTS: mode })).toBe(mode);
	});

	it("refuses to start on an unrecognized value instead of silently falling back", () => {
		expect(() => parseRunEventsMode({ SPELLKAVE_RUN_EVENTS: "verbose" })).toThrow(
			/SPELLKAVE_RUN_EVENTS.*verbose.*not a recognized observability mode/s,
		);
	});
});

describe("parseRunEventsMaxBytes", () => {
	it("caps by default — an unset var must not mean 'grow forever'", () => {
		expect(parseRunEventsMaxBytes({})).toBe(DEFAULT_RUN_EVENTS_MAX_BYTES);
		expect(parseRunEventsMaxBytes({ SPELLKAVE_RUN_EVENTS_MAX_BYTES: " " })).toBe(
			DEFAULT_RUN_EVENTS_MAX_BYTES,
		);
	});

	it("reads an explicit cap", () => {
		expect(parseRunEventsMaxBytes({ SPELLKAVE_RUN_EVENTS_MAX_BYTES: "1048576" })).toBe(1_048_576);
	});

	it("treats 0 as the opt-out for a short run that wants one whole artifact", () => {
		expect(parseRunEventsMaxBytes({ SPELLKAVE_RUN_EVENTS_MAX_BYTES: "0" })).toBeUndefined();
	});

	it.each([
		"-1",
		"12.5",
		"lots",
		"64MiB",
	])("refuses %s rather than silently writing an unbounded transcript", (value) => {
		expect(() => parseRunEventsMaxBytes({ SPELLKAVE_RUN_EVENTS_MAX_BYTES: value })).toThrow(
			/SPELLKAVE_RUN_EVENTS_MAX_BYTES.*non-negative integer/s,
		);
	});
});

describe("resolveReducerAttemptTelemetry", () => {
	it("is undefined for mode 'off', even with an OTLP endpoint configured", () => {
		expect(
			resolveReducerAttemptTelemetry({
				mode: "off",
				env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" },
			}),
		).toBeUndefined();
	});

	it("returns the injected tracer for any non-off mode (test seam)", () => {
		const tracer = { startSpan: vi.fn(), flush: vi.fn() } as never;
		expect(resolveReducerAttemptTelemetry({ mode: "jsonl", tracer })).toBe(tracer);
	});

	it("delegates to the env bootstrap for non-off modes, undefined without an endpoint", () => {
		expect(resolveReducerAttemptTelemetry({ mode: "jsonl", env: {} })).toBeUndefined();
	});
});

describe("resolveWorldActorMetrics", () => {
	it("stays disabled in off mode and without an OTLP endpoint", () => {
		expect(
			resolveWorldActorMetrics({
				mode: "off",
				env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector:4318" },
			}),
		).toBeUndefined();
		expect(resolveWorldActorMetrics({ mode: "jsonl", env: {} })).toBeUndefined();
	});

	it("returns the injected metrics port for non-off modes", () => {
		const metrics = { recordRequest: vi.fn(), recordCycleFailure: vi.fn(), flush: vi.fn() };
		expect(resolveWorldActorMetrics({ mode: "jsonl", metrics })).toBe(metrics);
	});
});

describe("session daemon exporter heartbeat", () => {
	it("stamps the session-daemon service name, not the shared world-actors default", () => {
		expect(SESSION_METRICS_SERVICE_NAME).toBe("spellkave-session-daemon");
	});

	it("ships exporter heartbeats on flush with no recordRequest calls", async () => {
		const payloads: string[] = [];
		const metrics = createOtlpHttpMetrics({
			endpoint: "http://collector.local",
			serviceName: SESSION_METRICS_SERVICE_NAME,
			fetchFn: (async (_url: string, init: RequestInit) => {
				payloads.push(String(init.body));
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});
		const observer = createSessionRunObserver({
			mode: "jsonl",
			binding,
			env: {},
			sinks: [createMemorySink()],
			metrics,
		});

		await observer.heartbeatMetrics();

		expect(payloads).toHaveLength(1);
		expect(payloads[0]).toContain("spellkave.world_actor.exporter_heartbeats_total");
		expect(payloads[0]).toContain(SESSION_METRICS_SERVICE_NAME);
		expect(payloads[0]).not.toContain("spellkave.world_actor.requests_total");

		await observer.end();
	});
});

describe("sessionRunArtifactPath", () => {
	it("falls back to paths.ts's runEventsPath when CAMPAIGN_ARTIFACTS_ROOT is unset", () => {
		expect(sessionRunArtifactPath({ binding, runId: "run-1", env: {} })).toBe(
			runEventsPath(binding, {}),
		);
	});

	it("nests under CAMPAIGN_ARTIFACTS_ROOT/experiments/sk-daemon/runs/<runId> when set", () => {
		expect(
			sessionRunArtifactPath({
				binding,
				runId: "run-1",
				env: { CAMPAIGN_ARTIFACTS_ROOT: "/root" },
			}),
		).toBe(join("/root", "experiments", "sk-daemon", "runs", "run-1", "agent-run-events.jsonl"));
	});
});

describe("createSessionRunObserver", () => {
	it("mode 'off' returns the shared no-op singleton", () => {
		expect(createSessionRunObserver({ mode: "off", binding, env: {} })).toBe(
			OFF_SESSION_RUN_OBSERVER,
		);
	});

	it("off's observeToolCall is a pass-through and end() never throws", async () => {
		await expect(
			OFF_SESSION_RUN_OBSERVER.observeToolCall("spellkave_scene", async () => "ok"),
		).resolves.toBe("ok");
		await expect(OFF_SESSION_RUN_OBSERVER.end()).resolves.toBeUndefined();
	});

	it("stamps run boundaries and tool calls with the process-stable world slug", async () => {
		const sink = createMemorySink();
		let now = new Date("2026-07-27T10:00:00.000Z");
		const observer = createSessionRunObserver({
			mode: "jsonl",
			binding,
			env: { SPELLKAVE_WORLD_SLUG: "world-a" },
			now: () => now,
			sinks: [sink],
		});
		expect(observer.status.mode).toBe("jsonl");
		expect(observer.status.artifactPath).toBeDefined();

		now = new Date("2026-07-27T10:00:01.000Z");
		await expect(
			observer.observeToolCall("spellkave_scene", async () => "result", {
				correlation_id: "corr-session",
				world_slug: "untrusted-causal-world",
			}),
		).resolves.toBe("result");
		now = new Date("2026-07-27T10:00:05.000Z");
		await observer.end("shutdown");

		const types = sink.events.map((e) => e.type);
		expect(types).toEqual(["run_start", "tool_call", "daemon_exit", "run_end"]);
		for (const event of sink.events) {
			expect(event.driver).toBe(SESSION_RUN_DRIVER);
			expect(event.run_kind).toBe("sk_session");
			expect(event.actor_id).toBe(binding.actorId);
			expect(event.role).toBe("PLAYER");
			expect(event.controller_kind).toBe("human");
			expect(event.data.world_slug).toBe("world-a");
		}
		const toolCall = sink.events[1] as AgentRunEvent;
		expect(toolCall.data).toMatchObject({
			tool_name: "spellkave_scene",
			is_error: false,
			correlation_id: "corr-session",
			world_slug: "world-a",
		});
		expect(toolCall.data.duration_ms as number).toBeGreaterThanOrEqual(0);
		const daemonExit = sink.events[2] as AgentRunEvent;
		expect(daemonExit.data).toEqual({ reason: "shutdown", world_slug: "world-a" });
		const runEnd = sink.events[3] as AgentRunEvent;
		expect(runEnd.data).toMatchObject({
			terminal: "shutdown",
			duration_ms: 5_000,
			world_slug: "world-a",
		});
	});

	// The daemon event is a bounded request record. Keep factual PLAYER context
	// results out of it, including their potentially large target rows.
	it("records manipulation context calls without leaking factual rows", async () => {
		const sink = createMemorySink();
		const observer = createSessionRunObserver({
			mode: "jsonl",
			binding,
			env: {},
			now: () => new Date("2026-08-29T16:48:00.000Z"),
			sinks: [sink],
		});
		await observer.observeToolCall("spellkave_manipulation_context", async () => ({
			content: [{ type: "text", text: "{}" }],
			details: {
				manipulation_context: {
					status: "ready",
					actions: [{ action_id: "open" }],
					targets: [{ target_ref: "entity:1", display_name: "Pick up lantern" }],
					participants: [],
				},
			},
		}));
		await observer.observeToolCall("spellkave_scene", async () => ({
			content: [],
			details: { total_rows: 3, shown: 3, matched: 3, truncated: false },
		}));
		const [targets, scene] = sink.events.filter((e) => e.type === "tool_call");
		expect(targets?.data).toMatchObject({
			tool_name: "spellkave_manipulation_context",
		});
		expect(JSON.stringify(targets?.data)).not.toContain("Pick up lantern");
		expect(targets?.data).not.toHaveProperty("manipulation_context");
		expect(scene?.data).not.toHaveProperty("total_rows");
	});

	it("scopes the same causal context into reducer-attempt spans", async () => {
		const starts: Array<Record<string, unknown> | undefined> = [];
		const baseTracer = {
			startSpan: (_name: string, attributes?: Record<string, unknown>) => {
				starts.push(attributes);
				return { addEvent: () => {}, end: () => {} };
			},
			flush: async () => {},
		};
		const causalTelemetry = createSessionCausalTelemetry(baseTracer);
		const observer = createSessionRunObserver({
			mode: "jsonl",
			binding,
			env: {},
			sinks: [createMemorySink()],
			causalTelemetry,
		});
		await observer.observeToolCall(
			"spellkave_act",
			async () => {
				causalTelemetry.tracer.startSpan("spellkave.reducer_attempt", {
					"spellkave.action_id": "equip",
				});
				return "ok";
			},
			{ correlation_id: "corr-shared", world_slug: "elven-mini" },
		);
		expect(starts[0]).toMatchObject({
			"spellkave.correlation_id": "corr-shared",
			"spellkave.world_slug": "elven-mini",
			"spellkave.action_id": "equip",
		});
	});

	it("flushes a one-span request promptly and records bounded request metrics", async () => {
		const flush = vi.fn(async () => {});
		const causalTelemetry = createSessionCausalTelemetry({
			startSpan: () => ({ addEvent: () => {}, end: () => {} }),
			flush,
		});
		const metrics = {
			recordRequest: vi.fn(),
			recordCycleFailure: vi.fn(),
			flush: vi.fn(async () => {}),
		};
		const observer = createSessionRunObserver({
			mode: "jsonl",
			binding,
			env: {},
			sinks: [createMemorySink()],
			causalTelemetry,
			metrics,
		});

		await observer.observeToolCall("spellkave_confirm_creation", async () => "ok");
		expect(flush).toHaveBeenCalledOnce();
		expect(metrics.recordRequest).toHaveBeenCalledWith({
			toolName: "spellkave_confirm_creation",
			durationMs: expect.any(Number),
			status: "ok",
		});
		expect(observer.status.metricsProjection).toBe("configured");

		await observer.end();
		expect(flush).toHaveBeenCalledTimes(2);
		expect(metrics.flush).toHaveBeenCalledOnce();
	});

	it("marks a rejected tool call is_error:true and still re-throws", async () => {
		const sink = createMemorySink();
		const observer = createSessionRunObserver({ mode: "jsonl", binding, env: {}, sinks: [sink] });
		await expect(
			observer.observeToolCall("spellkave_boom", async () => {
				throw new Error("kaboom");
			}),
		).rejects.toThrow("kaboom");
		const toolCall = sink.events.find((e) => e.type === "tool_call");
		expect(toolCall?.data).toMatchObject({ tool_name: "spellkave_boom", is_error: true });
	});

	it("names the daemon's exit reason and a lost world subscription as their own rows (sk-0m4.120.12)", async () => {
		const sink = createMemorySink();
		const observer = createSessionRunObserver({
			mode: "jsonl",
			binding,
			env: { SPELLKAVE_WORLD_SLUG: "world-a" },
			sinks: [sink],
		});
		observer.emitLifecycle("subscription_lost", { cause: "world_connection_lost" });
		await observer.end("world_connection_lost");
		// After the run ended, lifecycle emits are dropped — never a row after run_end.
		observer.emitLifecycle("subscription_lost", { cause: "late" });
		expect(sink.events.map((e) => [e.type, e.data])).toEqual([
			["run_start", expect.objectContaining({ world_slug: "world-a" })],
			["subscription_lost", { cause: "world_connection_lost", world_slug: "world-a" }],
			["daemon_exit", { reason: "world_connection_lost", world_slug: "world-a" }],
			["run_end", expect.objectContaining({ terminal: "world_connection_lost" })],
		]);
		expect(JSON.stringify(sink.events)).not.toContain("late");
	});

	it("end() is idempotent — a second call emits nothing further", async () => {
		const sink = createMemorySink();
		const observer = createSessionRunObserver({ mode: "jsonl", binding, env: {}, sinks: [sink] });
		await observer.end("shutdown");
		const countAfterFirst = sink.events.length;
		await observer.end("idle_timeout");
		expect(sink.events).toHaveLength(countAfterFirst);
	});

	it("mode 'otlp' reports no artifactPath — the JSONL sink stays off", () => {
		const observer = createSessionRunObserver({
			mode: "otlp",
			binding,
			env: {},
			sinks: [createMemorySink()],
		});
		expect(observer.status).toEqual({
			mode: "otlp",
			logsProjection: "configured",
			tracesProjection: "disabled",
			metricsProjection: "disabled",
		});
	});
});

describe("createSessionRunObserver — default (env-driven) sink selection", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "spellkave-session-observability-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		vi.unstubAllGlobals();
	});

	it("mode 'jsonl' writes the JSONL file and never touches the network", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const observer = createSessionRunObserver({
			mode: "jsonl",
			binding,
			env: {
				CAMPAIGN_ARTIFACTS_ROOT: dir,
				SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT: "http://collector.local/v1/logs",
			},
		});
		await observer.observeToolCall("spellkave_scene", async () => "ok");
		await observer.end("shutdown");

		expect(fetchMock).not.toHaveBeenCalled();
		const artifactPath = observer.status.artifactPath as string;
		expect(existsSync(artifactPath)).toBe(true);
		const lines = readFileSync(artifactPath, "utf8").trim().split("\n");
		// run_start, tool_call, daemon_exit, run_end (sk-0m4.120.12)
		expect(lines).toHaveLength(4);
	});

	it("mode 'otlp' with an endpoint configured posts to the world-actor stream, writes no file", async () => {
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) => new Response(null, { status: 200 }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const observer = createSessionRunObserver({
			mode: "otlp",
			binding,
			env: { SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT: "http://collector.local/v1/logs" },
		});
		await observer.observeToolCall("spellkave_scene", async () => "ok");
		await observer.end("shutdown");

		expect(fetchMock).toHaveBeenCalled();
		const [, init] = fetchMock.mock.calls[0] ?? [];
		expect((init?.headers as Headers).get("stream-name")).toBe("world_actor_run_events");
		expect(observer.status.artifactPath).toBeUndefined();
	});

	it("passes OTEL_EXPORTER_OTLP_*HEADERS to the logs sink and never logs a value (sk-0m4.120.9)", async () => {
		const secret = "s3cr3t-cf-access-token";
		const env = {
			SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT: "http://collector.local/v1/logs",
			OTEL_EXPORTER_OTLP_HEADERS: `CF-Access-Client-Id=abc.access,CF-Access-Client-Secret=${secret}`,
		};
		expect(otlpLogsHeadersFromEnv(env)).toEqual({
			"CF-Access-Client-Id": "abc.access",
			"CF-Access-Client-Secret": secret,
		});
		// The logs-specific variable wins over the generic one, like the OTel SDKs.
		expect(
			otlpLogsHeadersFromEnv({ ...env, OTEL_EXPORTER_OTLP_LOGS_HEADERS: "x-only=logs" }),
		).toEqual({ "x-only": "logs" });
		expect(otlpLogsHeadersFromEnv({})).toEqual({});

		// The edge refuses the first POST: nothing may surface the credential.
		const fetchMock = vi.fn(
			async (_url: string, _init: RequestInit) =>
				new Response(null, { status: 403, statusText: "Forbidden" }),
		);
		vi.stubGlobal("fetch", fetchMock);
		const consoleSpy = {
			log: vi.spyOn(console, "log"),
			warn: vi.spyOn(console, "warn"),
			error: vi.spyOn(console, "error"),
		};
		const observer = createSessionRunObserver({ mode: "otlp", binding, env });
		await observer.observeToolCall("spellkave_scene", async () => "ok");
		await observer.end("shutdown");

		expect(fetchMock).toHaveBeenCalled();
		for (const [, init] of fetchMock.mock.calls) {
			const headers = init?.headers as Headers;
			expect(headers.get("CF-Access-Client-Id")).toBe("abc.access");
			expect(headers.get("CF-Access-Client-Secret")).toBe(secret);
			expect(headers.get("stream-name")).toBe("world_actor_run_events");
		}
		expect(observer.status).toEqual({
			mode: "otlp",
			logsProjection: "configured",
			tracesProjection: "disabled",
			metricsProjection: "disabled",
		});
		expect(JSON.stringify(observer.status)).not.toContain(secret);
		for (const spy of Object.values(consoleSpy)) {
			for (const call of spy.mock.calls) {
				expect(JSON.stringify(call)).not.toContain(secret);
			}
			spy.mockRestore();
		}
	});

	it("mode 'otlp' without a configured endpoint is a silent no-op projection", async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);
		const observer = createSessionRunObserver({ mode: "otlp", binding, env: {} });
		await observer.observeToolCall("spellkave_scene", async () => "ok");
		await observer.end("shutdown");
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("mode 'jsonl+otlp' does both", async () => {
		const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
		vi.stubGlobal("fetch", fetchMock);
		const observer = createSessionRunObserver({
			mode: "jsonl+otlp",
			binding,
			env: {
				CAMPAIGN_ARTIFACTS_ROOT: dir,
				SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT: "http://collector.local/v1/logs",
			},
		});
		await observer.observeToolCall("spellkave_scene", async () => "ok");
		await observer.end("shutdown");

		expect(fetchMock).toHaveBeenCalled();
		expect(existsSync(observer.status.artifactPath as string)).toBe(true);
	});
});
