// An operator watching the gateway sees each request and tool call as OTLP and run
// events with route, status and timing but never the token or URL, and a private status
// file for health checks. If it breaks, dashboards go blind or leak. Runs against
// injected sinks and a temp directory, no collector.

// keep-file(K2): OTLP and run-event projection into injected sinks

import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createMemorySink, createOtlpHttpSink } from "@spellkave/agent-observability";
import { describe, expect, it, vi } from "vitest";

import {
	createPrivateStatusFileWriter,
	createRemoteMcpRunObserver,
	createRemoteMcpRunObserverFromEnv,
	otlpHeadersFromEnv,
	type PlayerMcpOperationLogger,
	REMOTE_MCP_RUN_DRIVER,
	withRemoteMcpAccessToken,
	withRemoteMcpRequestContext,
	withRemoteMcpRequestSubject,
} from "../observability.ts";

describe("remote MCP world-actor observability", () => {
	it("reports only sanitized projection configuration", () => {
		const endpoint = "http://collector.internal:4318/v1/logs";
		const observer = createRemoteMcpRunObserverFromEnv({
			env: {
				SPELLKAVE_RUN_EVENTS: "jsonl+otlp",
				SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT: endpoint,
			},
		});
		expect(observer.status).toEqual({
			mode: "jsonl+otlp",
			logsProjection: "configured",
		});
		expect(JSON.stringify(observer.status)).not.toContain(endpoint);
	});

	it("passes OTEL_EXPORTER_OTLP_HEADERS to the logs projection without exposing them", () => {
		// Cloudflare Access service-token headers, as an authenticated gateway sends
		// them to telemetry.spellkave.com (sk-0m4.120.2).
		const env = {
			SPELLKAVE_RUN_EVENTS: "jsonl+otlp",
			SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT: "https://telemetry.spellkave.com/v1/logs",
			OTEL_EXPORTER_OTLP_HEADERS:
				"CF-Access-Client-Id=abc.access,CF-Access-Client-Secret=s%3Decret",
		};
		expect(otlpHeadersFromEnv(env)).toEqual({
			"CF-Access-Client-Id": "abc.access",
			"CF-Access-Client-Secret": "s=ecret",
		});
		// The logs-specific variable wins over the generic one, like the OTel SDKs.
		expect(otlpHeadersFromEnv({ ...env, OTEL_EXPORTER_OTLP_LOGS_HEADERS: "x-only=logs" })).toEqual({
			"x-only": "logs",
		});
		expect(otlpHeadersFromEnv({})).toEqual({});
		const observer = createRemoteMcpRunObserverFromEnv({ env });
		expect(observer.status).toEqual({ mode: "jsonl+otlp", logsProjection: "configured" });
		expect(JSON.stringify(observer.status)).not.toContain("ecret");
	});

	it("emits one correlated ADR-0074 lifecycle without args or results", async () => {
		const sink = createMemorySink();
		const logs: Parameters<PlayerMcpOperationLogger>[0][] = [];
		let milliseconds = 0;
		const observer = createRemoteMcpRunObserver({
			actorId: "elven_mini/adventure/hero_1",
			sinks: [sink],
			logger: (event) => logs.push(event),
			now: () => new Date(milliseconds++),
		});

		let propagated: unknown;
		const result = await withRemoteMcpRequestContext("request-123", () =>
			observer.observeToolCall("spellkave_scene", async (context) => {
				propagated = context;
				return {
					content: [{ type: "text", text: "secret-result" }],
				};
			}),
		);

		expect(result.content).toEqual([{ type: "text", text: "secret-result" }]);
		expect(sink.events.map(({ type }) => type)).toEqual(["run_start", "tool_call", "run_end"]);
		expect(sink.events.every(({ driver }) => driver === REMOTE_MCP_RUN_DRIVER)).toBe(true);
		expect(sink.events.every(({ role }) => role === "PLAYER")).toBe(true);
		expect(sink.events.every(({ actor_id }) => actor_id === "elven_mini/adventure/hero_1")).toBe(
			true,
		);
		expect(sink.events.every(({ run_id }) => run_id === "mcp-request-123")).toBe(true);
		expect(sink.events.every(({ data }) => data.correlation_id === "request-123")).toBe(true);
		expect(propagated).toEqual({ correlation_id: "request-123" });
		expect(logs).toMatchObject([
			{
				kind: "tool_call",
				correlation_id: "request-123",
				tool_name: "spellkave_scene",
				outcome: "ok",
			},
		]);
		expect(JSON.stringify({ events: sink.events, logs })).not.toContain("secret-result");
	});

	it("projects the act receipt verdict and the stable error code — never args or text (sk-0m4.120.10/.11)", async () => {
		const sink = createMemorySink();
		const observer = createRemoteMcpRunObserver({ actorId: "42", sinks: [sink] });
		const hostedCommunicate = {
			content: [{ type: "text" as const, text: 'You say: "hello there"' }],
			structuredContent: {
				receipt: {
					status: "dispatched",
					verb_class: "communicate",
					handle: "dm/dialog/choice/1",
					outcome: "accepted",
					communicate: {
						status: "success",
						actor_id: "entity:42",
						target_id: "entity:7",
						action_id: "core/speech/say",
					},
				},
				observation: 'You say: "hello there"',
				conversation: {
					spoken_by_player: "hello there",
					response: null,
					awaiting_response: true,
				},
			},
		};
		await withRemoteMcpRequestContext("act-1", () =>
			observer.observeToolCall("spellkave_communicate", async () => hostedCommunicate),
		);
		const toolCall = sink.events.find((e) => e.type === "tool_call");
		expect(toolCall?.data).toEqual({
			tool_name: "spellkave_communicate",
			is_error: false,
			duration_ms: expect.any(Number),
			correlation_id: "act-1",
			outcome: "accepted",
			action_id: "core/speech/say",
			target_ref: "entity:7",
			result_status: "success",
			awaiting_response: true,
		});
		for (const leak of ["hello there", "dm/dialog", "spoken_by_player", "observation"]) {
			expect(JSON.stringify(sink.events)).not.toContain(leak);
		}

		// The gateway-bound awaiting_response receipt (sk-0m4.100) has no verb block.
		sink.events.length = 0;
		await withRemoteMcpRequestContext("act-2", () =>
			observer.observeToolCall("spellkave_communicate", async () => ({
				content: [{ type: "text" as const, text: "{}" }],
				structuredContent: {
					receipt: { status: "dispatched", verb_class: "communicate", outcome: "unobserved" },
					conversation: { awaiting_response: true },
				},
			})),
		);
		expect(sink.events.find((e) => e.type === "tool_call")?.data).toMatchObject({
			outcome: "unobserved",
			awaiting_response: true,
		});
		expect(sink.events.find((e) => e.type === "tool_call")?.data).not.toHaveProperty("action_id");

		// A daemon-handler error carries its stable code next to the category.
		sink.events.length = 0;
		await withRemoteMcpRequestContext("act-3", () =>
			observer.observeToolCall("spellkave_scene", async () => ({
				isError: true,
				content: [{ type: "text" as const, text: "timed out waiting for the world session" }],
				structuredContent: {
					error: { category: "transport", code: "session_invoke_timeout", message: "timed out" },
				},
			})),
		);
		expect(sink.events.find((e) => e.type === "tool_call")?.data).toMatchObject({
			is_error: true,
			error_category: "transport",
			error_code: "session_invoke_timeout",
		});
		expect(JSON.stringify(sink.events)).not.toContain("timed out waiting");
	});

	it("emits lifecycle rows on the current tool run, else on a process run; http_request on the request run (sk-0m4.120.11/.12)", async () => {
		const sink = createMemorySink();
		const observer = createRemoteMcpRunObserver({ actorId: "42", sinks: [sink] });
		const rawSubject = "user_raw_sub_never_projected";

		// Outside any request: a process-lifetime run, controller_kind service.
		observer.emitLifecycle?.("gateway_start", { image_tag: "sha-919f9ae5" });
		const start = sink.events[0];
		expect(start).toMatchObject({
			type: "gateway_start",
			run_kind: "mcp_gateway_lifecycle",
			actor_id: "gateway",
			role: "GATEWAY",
			controller_kind: "service",
			driver: REMOTE_MCP_RUN_DRIVER,
			data: { image_tag: "sha-919f9ae5" },
		});
		expect(start?.run_id).toMatch(/^mcp-gateway-/);

		// Inside a tool call: same run_id as the tool_call, subject hashed.
		sink.events.length = 0;
		await withRemoteMcpRequestContext("req-7", () =>
			withRemoteMcpRequestSubject(rawSubject, () =>
				observer.observeToolCall("spellkave_scene", async () => {
					observer.emitLifecycle?.("session_attach", { spawned: true, world_slug: "world-a" });
					// A payload that smuggles the raw sub is dropped, not hashed.
					observer.emitLifecycle?.("session_detach", { reason: rawSubject });
					return { content: [{ type: "text" as const, text: "ok" }] };
				}),
			),
		);
		expect(sink.events.map((e) => e.type)).toEqual([
			"run_start",
			"session_attach",
			"tool_call",
			"run_end",
		]);
		const attach = sink.events[1];
		expect(attach?.run_id).toBe("mcp-req-7");
		expect(attach?.data).toEqual({
			spawned: true,
			world_slug: "world-a",
			subject_prefix: expect.stringMatching(/^[a-f0-9]{16}$/),
		});
		expect(JSON.stringify(sink.events)).not.toContain(rawSubject);

		// http_request rides the request's run id so a 5xx joins its tool_call.
		sink.events.length = 0;
		observer.emitHttpRequest?.({
			http_status: 504,
			route: "/mcp",
			duration_ms: 15_002,
			correlation_id: "req-7",
			http_method: "POST",
			cf_ray: "a322a7c029111eca",
		});
		expect(sink.events).toHaveLength(1);
		expect(sink.events[0]).toMatchObject({
			type: "http_request",
			run_id: "mcp-req-7",
			run_kind: "mcp_http_request",
			controller_kind: "service",
			data: {
				http_status: 504,
				route: "/mcp",
				duration_ms: 15_002,
				correlation_id: "req-7",
				http_method: "POST",
				cf_ray: "a322a7c029111eca",
			},
		});
	});

	it("emits world_lifecycle route_probe_failed on the process run outside a tool call, and on the tool-call run inside one (sk-jay0.6.38.5)", async () => {
		const sink = createMemorySink();
		const observer = createRemoteMcpRunObserver({ actorId: "42", sinks: [sink] });

		// The common case (§3 of the implementation brief): a probe throw during
		// actor resolution, before any tool-call run exists — process run.
		observer.emitLifecycle?.("world_lifecycle", {
			phase: "route_probe_failed",
			outcome: "failed",
			world_slug: "world-a",
			error_class: "Error",
		});
		expect(sink.events).toHaveLength(1);
		expect(sink.events[0]).toMatchObject({
			type: "world_lifecycle",
			run_kind: "mcp_gateway_lifecycle",
			actor_id: "gateway",
			role: "GATEWAY",
			controller_kind: "service",
			data: {
				phase: "route_probe_failed",
				outcome: "failed",
				world_slug: "world-a",
				error_class: "Error",
			},
		});
		expect(sink.events[0]?.run_id).toMatch(/^mcp-gateway-/);

		// Inside a tool call, the same row rides the tool call's own run instead.
		sink.events.length = 0;
		await withRemoteMcpRequestContext("req-9", () =>
			observer.observeToolCall("spellkave_scene", async () => {
				observer.emitLifecycle?.("world_lifecycle", {
					phase: "route_probe_failed",
					outcome: "failed",
					world_slug: "world-b",
					error_class: "TypeError",
				});
				return { content: [{ type: "text" as const, text: "ok" }] };
			}),
		);
		const row = sink.events.find((e) => e.type === "world_lifecycle");
		expect(row?.run_id).toBe("mcp-req-9");
		expect(row?.data).toMatchObject({
			phase: "route_probe_failed",
			outcome: "failed",
			world_slug: "world-b",
			error_class: "TypeError",
		});
	});

	it("resolves actor_id from resolveActor and hashes the OAuth subject", async () => {
		const sink = createMemorySink();
		const observer = createRemoteMcpRunObserver({
			actorId: "unresolved",
			resolveActor: async () => ({ actorId: "99", worldSlug: "elven-mini-1" }),
			sinks: [sink],
		});
		const rawSubject = "user_oauth_sub_must_not_leak";
		await withRemoteMcpRequestContext("req-seat", () =>
			withRemoteMcpRequestSubject(rawSubject, () =>
				observer.observeToolCall("spellkave_scene", async (context) => {
					expect(context).toEqual({
						correlation_id: "req-seat",
						world_slug: "elven-mini-1",
					});
					return {
						content: [{ type: "text", text: "ok" }],
					};
				}),
			),
		);
		expect(sink.events.every(({ actor_id }) => actor_id === "99")).toBe(true);
		expect(sink.events.some((e) => e.data.world_slug === "elven-mini-1")).toBe(true);
		expect(sink.events.map(({ type }) => type)).toEqual(["run_start", "tool_call", "run_end"]);
		const prefix = sink.events[0]?.data.subject_prefix;
		expect(typeof prefix).toBe("string");
		expect(prefix).toHaveLength(16);
		expect(JSON.stringify(sink.events)).not.toContain(rawSubject);
	});

	it("distinguishes a redacted transport failure from a domain failure", async () => {
		const sink = createMemorySink();
		const logger = vi.fn<PlayerMcpOperationLogger>();
		const observer = createRemoteMcpRunObserver({
			actorId: "hero_1",
			sinks: [sink],
			logger,
		});

		await withRemoteMcpRequestContext("request-transport", () =>
			observer.observeToolCall("spellkave_move", async () => ({
				isError: true,
				content: [{ type: "text", text: "The PLAYER session daemon is unavailable." }],
				structuredContent: {
					error: { category: "transport", code: "ECONNREFUSED", message: "redacted" },
				},
			})),
		);

		// sk-0m4.120.11: the stable code rides the run event (it is a closed
		// transport vocabulary, not player text); the message never does.
		expect(sink.events[1]).toMatchObject({
			type: "tool_call",
			data: { is_error: true, summary: "transport error", error_code: "ECONNREFUSED" },
		});
		expect(logger).toHaveBeenCalledWith(
			expect.objectContaining({
				kind: "tool_call",
				correlation_id: "request-transport",
				outcome: "error",
				error_category: "transport",
			}),
		);
		const serialized = JSON.stringify({ events: sink.events, logs: logger.mock.calls });
		expect(serialized).not.toContain("redacted");
		expect(serialized).not.toContain("daemon is unavailable");
	});

	// sk-0m4.120.36: an `internal_error` row now names the unknown throw's class
	// (never its message) so the receipt is more than "internal error".
	it("exports error_class beside error_code for an internal_error result", async () => {
		const sink = createMemorySink();
		const observer = createRemoteMcpRunObserver({ actorId: "42", sinks: [sink] });

		await withRemoteMcpRequestContext("request-internal", () =>
			observer.observeToolCall("spellkave_session_status", async () => ({
				isError: true,
				content: [{ type: "text", text: "The PLAYER tool call failed." }],
				structuredContent: {
					error: {
						category: "internal",
						code: "internal_error",
						message: "redacted",
						error_class: "RangeError",
					},
				},
			})),
		);

		expect(sink.events[1]).toMatchObject({
			type: "tool_call",
			data: {
				is_error: true,
				error_category: "internal",
				error_code: "internal_error",
				error_class: "RangeError",
			},
		});
		expect(JSON.stringify(sink.events)).not.toContain("redacted");
	});

	it("never projects OAuth credentials, tool arguments, or tool results to OTLP", async () => {
		const requests: RequestInit[] = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			fetchFn: (async (_url: string, init: RequestInit) => {
				requests.push(init);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});
		const observer = createRemoteMcpRunObserver({
			resolveActor: () => ({ actorId: "hero-1", worldSlug: "elven-mini" }),
			sinks: [sink],
		});
		const token = "SECRET-OAUTH-TOKEN";
		const subject = "SECRET-OAUTH-SUBJECT";
		const toolArgs = { speech: "SECRET-TOOL-ARGS" };
		await withRemoteMcpRequestContext("corr-safe", () =>
			withRemoteMcpRequestSubject(subject, () =>
				withRemoteMcpAccessToken(token, () =>
					observer.observeToolCall("spellkave_act", async (context) => {
						expect(context).toEqual({
							correlation_id: "corr-safe",
							world_slug: "elven-mini",
						});
						void toolArgs;
						return { content: [{ type: "text", text: "SECRET-TOOL-RESULT" }] };
					}),
				),
			),
		);
		await sink.close?.();
		const serialized = JSON.stringify(requests);
		expect(serialized).toContain("corr-safe");
		expect(serialized).toContain("elven-mini");
		// Hashed subject_prefix must reach OTLP so operators can split by player.
		const prefixes = requests.flatMap((init) => {
			const payload = JSON.parse(String(init.body)) as {
				resourceLogs: Array<{
					scopeLogs: Array<{
						logRecords: Array<{
							attributes: Array<{ key: string; value: { stringValue?: string } }>;
						}>;
					}>;
				}>;
			};
			return payload.resourceLogs.flatMap((rl) =>
				rl.scopeLogs.flatMap((sl) =>
					sl.logRecords.flatMap((rec) =>
						rec.attributes
							.filter((a) => a.key === "spellkave.subject_prefix")
							.map((a) => a.value.stringValue),
					),
				),
			);
		});
		expect(prefixes.length).toBeGreaterThan(0);
		expect(prefixes.every((p) => typeof p === "string" && /^[a-f0-9]{16}$/.test(p))).toBe(true);
		for (const canary of [token, subject, "SECRET-TOOL-ARGS", "SECRET-TOOL-RESULT"]) {
			expect(serialized).not.toContain(canary);
		}
	});

	it("atomically persists only the supplied private status snapshot", async () => {
		const root = await mkdtemp(join(tmpdir(), "spellkave-mcp-status-"));
		const path = join(root, "private", "status.json");
		try {
			const writeStatus = createPrivateStatusFileWriter(path);
			await writeStatus({ v: "player-mcp-status/v1", status: "ok" });
			expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
				v: "player-mcp-status/v1",
				status: "ok",
			});
			expect((await stat(path)).mode & 0o777).toBe(0o600);
			expect((await stat(join(root, "private"))).mode & 0o777).toBe(0o700);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
