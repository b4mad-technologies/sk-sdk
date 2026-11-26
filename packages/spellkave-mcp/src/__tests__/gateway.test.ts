import { sampleWorldRows } from "./osm-fixture.ts";
// The hosted gateway keeps players from starving each other (per-subject buckets
// and seat queues), exports each request and tool call without the token or URL,
// and serves a world's tiles and OSM map from one cache. If it breaks, one busy
// agent locks out the rest, telemetry leaks or maps disagree. Runs against an
// injected client, run-event sinks, small limits and tile caches. Login, CORS and
// transcripts: behaviour/login.feature and behaviour/browser.feature.

// keep-file(K2): injected client, run-event sinks, small rate limits and tile caches

import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createMemorySink } from "@spellkave/agent-observability";
import { DOCS_TOOL, PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerSessionClient } from "../daemon-handler.ts";
import { createInMemoryFeedbackRateLimiter, createMemoryFeedbackSink } from "../feedback.ts";
import { SPELLKAVE_FEEDBACK_TOOL } from "../feedback-constants.ts";
import { createPlayerMcpGateway, type PlayerMcpGatewayService } from "../gateway.ts";
import {
	createRemoteMcpRunObserver,
	currentRemoteMcpRequestSubject,
	type PlayerMcpOperationLogger,
} from "../observability.ts";
import { createTestSigner, type TestSigner } from "./jwt-helpers.ts";

const origin = "https://mcp.example.test";
const issuer = "https://authkit.example.test";

function rpc(method: string, params: unknown = {}): Record<string, unknown> {
	return { jsonrpc: "2.0", id: 1, method, params };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
	const contentType = response.headers.get("content-type");
	if (contentType?.includes("application/json")) {
		return (await response.json()) as Record<string, unknown>;
	}
	const data = (await response.text())
		.split("\n")
		.find((line) => line.startsWith("data: "))
		?.slice("data: ".length);
	if (data === undefined) throw new Error("MCP response had no JSON or SSE data");
	return JSON.parse(data) as Record<string, unknown>;
}

describe("WorkOS-protected PLAYER gateway", () => {
	let signer: TestSigner;
	let now: number;
	let invoke: ReturnType<typeof vi.fn<PlayerSessionClient["invoke"]>>;
	let gateway: PlayerMcpGatewayService;
	let runEvents: ReturnType<typeof createMemorySink>;
	let operationLogs: Parameters<PlayerMcpOperationLogger>[0][];

	beforeEach(async () => {
		signer = await createTestSigner();
		now = Math.floor(Date.now() / 1000);
		invoke = vi.fn<PlayerSessionClient["invoke"]>().mockResolvedValue({
			id: 1,
			ok: true,
			result: { content: [{ type: "text", text: "Renn acts." }] },
		});
		runEvents = createMemorySink();
		operationLogs = [];
		const operationLogger: PlayerMcpOperationLogger = (event) => operationLogs.push(event);
		gateway = createPlayerMcpGateway({
			resourceConfig: {
				canonicalOrigin: origin,
				issuer,
				jwks: [signer.publicJwk],
			},
			client: { invoke },
			now: () => now * 1000,
			operationNow: () => new Date(now * 1000),
			operationLogger,
			runObserver: createRemoteMcpRunObserver({
				actorId: "kavemouth/adventure/hero_1",
				sinks: [runEvents],
				logger: operationLogger,
				now: () => new Date(now * 1000),
				status: { mode: "jsonl+otlp", logsProjection: "configured" },
			}),
		});
	});

	function mcpRequest(body: unknown, accessToken?: string): Request {
		return new Request(`${origin}/mcp`, {
			method: "POST",
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				host: "mcp.example.test",
				...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
			},
			body: JSON.stringify(body),
		});
	}

	async function accessToken(overrides: Record<string, unknown> = {}): Promise<string> {
		return signer.sign({
			iss: issuer,
			aud: `${origin}/mcp`,
			sub: "user_ok",
			exp: now + 300,
			iat: now,
			...overrides,
		});
	}

	it.each([
		false,
		true,
	])("discovers current caller authority and revocation (resolveClient=%s)", async (resolveClient) => {
		let authorNames = ["spellkave_query", "spellkave_grant_role"];
		let unavailable = false;
		const discoverySubjects: string[] = [];
		const clientFor = (fixedSubject?: string): PlayerSessionClient => ({
			invoke,
			toolNames: async function () {
				expect(this.invoke).toBe(invoke);
				const subject = fixedSubject ?? currentRemoteMcpRequestSubject();
				if (subject === undefined) throw new Error("Missing authenticated subject");
				discoverySubjects.push(subject);
				if (unavailable)
					return {
						id: 0,
						ok: false,
						error: { code: "disconnected", message: "Discovery unavailable" },
					};
				return {
					id: 0,
					ok: true,
					result: subject === "user_author" ? authorNames : [...PLAYER_TOOL_NAMES],
				};
			},
		});
		const discoveryGateway = createPlayerMcpGateway({
			resourceConfig: { canonicalOrigin: origin, issuer, jwks: [signer.publicJwk] },
			client: clientFor(),
			...(resolveClient ? { resolveClient: clientFor } : {}),
			now: () => now * 1000,
		});
		const names = async (subject: string) => {
			const response = await discoveryGateway.fetch(
				mcpRequest(rpc("tools/list"), await accessToken({ sub: subject })),
			);
			expect(response.status).toBe(200);
			const body = await responseJson(response);
			return (body.result as { tools: { name: string }[] }).tools.map((tool) => tool.name);
		};
		try {
			expect(await names("user_author")).toContain("spellkave_grant_role");
			expect(await names("user_player")).not.toContain("spellkave_grant_role");
			authorNames = [];
			expect(await names("user_author")).not.toContain("spellkave_grant_role");
			expect(discoverySubjects).toEqual(["user_author", "user_player", "user_author"]);
			unavailable = true;
			const refused = await discoveryGateway.fetch(
				mcpRequest(rpc("tools/list"), await accessToken({ sub: "user_author" })),
			);
			expect(refused.status).toBe(500);
			expect(await responseJson(refused)).toHaveProperty("error");
		} finally {
			await discoveryGateway.close();
		}
	});



	// keep(K2): signed fault tokens and the injected sink prove reason classification and redaction.
	it.each([
		["malformed_header", "Basic must-not-be-logged"],
		["malformed_token", "Bearer must-not-be-logged"],
	])("classifies %s without logging the header", async (reason, authorization) => {
		const request = mcpRequest(rpc("tools/list"));
		request.headers.set("authorization", authorization);
		expect((await gateway.fetch(request)).status).toBe(401);
		expect(operationLogs).toContainEqual(expect.objectContaining({ auth_reason: reason }));
		expect(JSON.stringify(operationLogs)).not.toContain("must-not-be-logged");
		await gateway.close();
	});

	// keep(K2): malicious claim text and injected operational sink prove redaction.
	it("logs a category instead of reflecting an untrusted issuer", async () => {
		const secret = "attacker-controlled-issuer-must-not-be-logged";
		const token = await accessToken({ iss: secret });
		expect((await gateway.fetch(mcpRequest(rpc("tools/list"), token))).status).toBe(401);
		expect(operationLogs).toContainEqual(
			expect.objectContaining({ auth_reason: "issuer_mismatch" }),
		);
		expect(JSON.stringify(operationLogs)).not.toContain(secret);
		expect(JSON.stringify(operationLogs)).not.toContain(token);
		await gateway.close();
	});

	it("exports one http_request run event per request with route pattern, status and CF-Ray — never the URL (sk-0m4.120.11)", async () => {
		const request = new Request(`${origin}/mcp?token=should-not-leak`, {
			method: "POST",
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				host: "mcp.example.test",
				"CF-Ray": "a322a7c029111eca-FRA",
			},
			body: JSON.stringify(rpc("tools/list")),
		});
		const response = await gateway.fetch(request);
		expect(response.status).toBe(401);
		const correlationId = response.headers.get("x-request-id");
		const rows = runEvents.events.filter((e) => e.type === "http_request");
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			run_id: `mcp-${correlationId}`,
			run_kind: "mcp_http_request",
			actor_id: "gateway",
			controller_kind: "service",
			data: {
				http_status: 401,
				route: "/mcp",
				http_method: "POST",
				cf_ray: "a322a7c029111eca-FRA",
				correlation_id: correlationId,
				duration_ms: expect.any(Number),
			},
		});
		expect(JSON.stringify(rows)).not.toContain("should-not-leak");
		// The same request is still in the redacted operational log (unchanged).
		expect(operationLogs).toContainEqual(
			expect.objectContaining({ kind: "http_request", route: "/mcp", status: 401 }),
		);
		// Readiness probes are not exported (they carry no player-facing signal).
		await gateway.fetch(
			new Request(`${origin}/healthz`, { headers: { host: "mcp.example.test" } }),
		);
		expect(runEvents.events.filter((e) => e.type === "http_request")).toHaveLength(1);
	});

	it("reports exporter configuration without collector details", async () => {
		const status = await gateway.status();
		expect(status.world_actor_exporters).toEqual({
			gateway_logs: "configured",
			session_logs: "unknown",
			session_traces: "unknown",
			session_metrics: "unknown",
		});
		expect(JSON.stringify(status)).not.toMatch(/endpoint|authorization|password/iu);
	});

	it("invokes a PLAYER tool and records observability without the raw token", async () => {
		const token = await accessToken();
		const callResponse = await gateway.fetch(
			mcpRequest(rpc("tools/call", { name: PLAYER_TOOL_NAMES[0], arguments: {} }), token),
		);
		expect(await responseJson(callResponse)).toMatchObject({
			result: { content: [{ type: "text", text: "Renn acts." }] },
		});
		expect(invoke).toHaveBeenCalledWith(
			PLAYER_TOOL_NAMES[0],
			{},
			expect.objectContaining({ correlation_id: expect.any(String) }),
		);
		expect(JSON.stringify(operationLogs)).not.toContain(token);
	});
});

describe("gateway /mcp request rate limits (sk-pzaq.5)", () => {
	let signer: TestSigner;
	let now: number;

	beforeEach(async () => {
		signer = await createTestSigner();
		now = Math.floor(Date.now() / 1000);
	});

	function mcpRequest(body: unknown, accessToken?: string): Request {
		return new Request(`${origin}/mcp`, {
			method: "POST",
			headers: {
				accept: "application/json, text/event-stream",
				"content-type": "application/json",
				host: "mcp.example.test",
				...(accessToken === undefined ? {} : { authorization: `Bearer ${accessToken}` }),
			},
			body: JSON.stringify(body),
		});
	}

	async function tokenFor(sub: string): Promise<string> {
		return signer.sign({
			iss: issuer,
			aud: `${origin}/mcp`,
			sub,
			exp: now + 300,
			iat: now,
		});
	}

	function isolatedGateway(
		overrides: {
			requestRateLimit?: { maxRequests: number; windowMs: number };
			subjectRequestRateLimit?: { maxRequests: number; windowMs: number };
			invoke?: ReturnType<typeof vi.fn<PlayerSessionClient["invoke"]>>;
			maxConcurrentRequestsPerSubject?: number;
			subjectQueueDepth?: number;
			subjectQueueWaitMs?: number;
			resolveClient?: (subject: string) => PlayerSessionClient;
			requestTimeoutMs?: number;
		} = {},
	): PlayerMcpGatewayService {
		const invoke =
			overrides.invoke ??
			vi.fn<PlayerSessionClient["invoke"]>().mockResolvedValue({
				id: 1,
				ok: true,
				result: { content: [{ type: "text", text: "ok" }] },
			});
		return createPlayerMcpGateway({
			resourceConfig: {
				canonicalOrigin: origin,
				issuer,
				jwks: [signer.publicJwk],
			},
			client: { invoke },
			now: () => now * 1000,
			// Generous shared pre-auth so subject tests are not masked by it.
			requestRateLimit: overrides.requestRateLimit ?? { maxRequests: 1_000, windowMs: 60_000 },
			...(overrides.subjectRequestRateLimit === undefined
				? {}
				: { subjectRequestRateLimit: overrides.subjectRequestRateLimit }),
			...(overrides.maxConcurrentRequestsPerSubject === undefined
				? {}
				: { maxConcurrentRequestsPerSubject: overrides.maxConcurrentRequestsPerSubject }),
			...(overrides.subjectQueueDepth === undefined
				? {}
				: { subjectQueueDepth: overrides.subjectQueueDepth }),
			...(overrides.subjectQueueWaitMs === undefined
				? {}
				: { subjectQueueWaitMs: overrides.subjectQueueWaitMs }),
			...(overrides.resolveClient === undefined ? {} : { resolveClient: overrides.resolveClient }),
			...(overrides.requestTimeoutMs === undefined
				? {}
				: { requestTimeoutMs: overrides.requestTimeoutMs }),
		});
	}

	/** A client whose calls hang until the test releases them. */
	function gatedInvoke(): {
		invoke: ReturnType<typeof vi.fn<PlayerSessionClient["invoke"]>>;
		releaseAll: () => void;
		started: () => number;
	} {
		const gates: Array<() => void> = [];
		const invoke = vi.fn<PlayerSessionClient["invoke"]>(async () => {
			await new Promise<void>((resolve) => gates.push(resolve));
			return { id: 1, ok: true, result: { content: [{ type: "text", text: "ok" }] } };
		});
		return {
			invoke,
			releaseAll: () => {
				for (const open of gates.splice(0)) open();
			},
			started: () => gates.length,
		};
	}

	function toolCall(): Record<string, unknown> {
		return rpc("tools/call", { name: PLAYER_TOOL_NAMES[0], arguments: {} });
	}

	/** Let queued microtasks/timers run so in-flight requests reach the client. */
	async function settle(): Promise<void> {
		for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
	}

	it("isolates per-subject buckets so one player cannot 429 another", async () => {
		const gateway = isolatedGateway({
			subjectRequestRateLimit: { maxRequests: 2, windowMs: 60_000 },
		});
		const busy = await tokenFor("user_busy");
		const other = await tokenFor("user_other");
		const listBody = rpc("tools/list");

		expect((await gateway.fetch(mcpRequest(listBody, busy))).status).toBe(200);
		expect((await gateway.fetch(mcpRequest(listBody, busy))).status).toBe(200);
		const throttled = await gateway.fetch(mcpRequest(listBody, busy));
		expect(throttled.status).toBe(429);
		expect(throttled.headers.get("retry-after")).toMatch(/^\d+$/);
		const body = (await throttled.json()) as {
			error: string;
			error_description: string;
		};
		expect(body).toMatchObject({ error: "rate_limited" });
		expect(body.error_description).toMatch(/Wait \d+ seconds/i);

		// Second subject still has full budget.
		expect((await gateway.fetch(mcpRequest(listBody, other))).status).toBe(200);
	});

	it("exempts spellkave_feedback tools/call from the per-subject request bucket", async () => {
		const invoke = vi.fn<PlayerSessionClient["invoke"]>().mockResolvedValue({
			id: 1,
			ok: true,
			result: { content: [{ type: "text", text: "ok" }] },
		});
		const gateway = isolatedGateway({
			subjectRequestRateLimit: { maxRequests: 1, windowMs: 60_000 },
			invoke,
		});
		const token = await tokenFor("user_throttled");

		// Exhaust the subject bucket with a normal tools/list.
		expect((await gateway.fetch(mcpRequest(rpc("tools/list"), token))).status).toBe(200);
		const blockedTool = await gateway.fetch(
			mcpRequest(rpc("tools/call", { name: PLAYER_TOOL_NAMES[0], arguments: {} }), token),
		);
		expect(blockedTool.status).toBe(429);
		expect(blockedTool.headers.get("retry-after")).toMatch(/^\d+$/);

		// Feedback must still land so the player can report the throttle.
		const feedback = await gateway.fetch(
			mcpRequest(
				rpc("tools/call", {
					name: SPELLKAVE_FEEDBACK_TOOL,
					arguments: {
						category: "bug",
						message: "I am being rate limited on other tools.",
						include_report: false,
					},
				}),
				token,
			),
		);
		expect(feedback.status).toBe(200);
		const feedbackJson = await responseJson(feedback);
		expect(feedbackJson).toMatchObject({
			result: expect.objectContaining({
				structuredContent: expect.objectContaining({ ok: true }),
			}),
		});
	});

	it("still enforces the shared pre-auth bucket before JWT acceptance", async () => {
		const gateway = isolatedGateway({
			requestRateLimit: { maxRequests: 2, windowMs: 60_000 },
			// Subject budget would not bind first if public is tiny.
			subjectRequestRateLimit: { maxRequests: 100, windowMs: 60_000 },
		});
		const listBody = rpc("tools/list");

		// Unauthenticated probes consume the shared pre-auth guard.
		expect((await gateway.fetch(mcpRequest(listBody))).status).toBe(401);
		expect((await gateway.fetch(mcpRequest(listBody))).status).toBe(401);
		const flooded = await gateway.fetch(mcpRequest(listBody));
		expect(flooded.status).toBe(429);
		expect(flooded.headers.get("retry-after")).toMatch(/^\d+$/);
		const body = (await flooded.json()) as {
			error: string;
			error_description: string;
		};
		expect(body.error).toBe("rate_limited");
		expect(body.error_description).toMatch(/Wait \d+ seconds/i);

		// Even a valid bearer cannot bypass a tripped pre-auth guard.
		const token = await tokenFor("user_ok");
		expect((await gateway.fetch(mcpRequest(listBody, token))).status).toBe(429);
	});

	// sk-0m4.88: an MCP client that fires 3-4 tools/call at once used to lose the
	// third onward to a 429 — and, because the SDK closes the transport on a
	// failed POST, every sibling request with it.
	// quarantine(sk-jay0.7.164.118): flaky: five setTimeout(0) turns do not wait for authenticate and body inspection before the gate count
	it.skipIf(process.env.SPELLKAVE_RUN_QUARANTINED !== "1")(
		"queues one subject's parallel requests instead of rejecting them",
		async () => {
			const gate = gatedInvoke();
			const gateway = isolatedGateway({
				invoke: gate.invoke,
				maxConcurrentRequestsPerSubject: 2,
				subjectQueueDepth: 8,
			});
			const token = await tokenFor("user_parallel");

			const responses = Promise.all(
				[0, 1, 2, 3].map(() => gateway.fetch(mcpRequest(toolCall(), token))),
			);
			await settle();
			expect(gate.started()).toBeGreaterThan(0);
			for (let round = 0; round < 8 && gate.started() > 0; round += 1) {
				gate.releaseAll();
				await settle();
			}

			const statuses = (await responses).map((response) => response.status);
			expect(statuses).toEqual([200, 200, 200, 200]);
			expect(gate.invoke).toHaveBeenCalledTimes(4);
		},
	);

	it("429s only what overflows a subject's queue", async () => {
		const gate = gatedInvoke();
		const gateway = isolatedGateway({
			invoke: gate.invoke,
			maxConcurrentRequestsPerSubject: 1,
			subjectQueueDepth: 1,
			subjectQueueWaitMs: 5_000,
		});
		const token = await tokenFor("user_overflow");

		const inFlight = gateway.fetch(mcpRequest(toolCall(), token));
		await settle();
		const queued = gateway.fetch(mcpRequest(toolCall(), token));
		await settle();
		// cap (1) + depth (1) are taken; this one has nowhere to wait.
		const overflow = await gateway.fetch(mcpRequest(toolCall(), token));

		expect(overflow.status).toBe(429);
		expect(overflow.headers.get("retry-after")).toMatch(/^\d+$/);
		expect(await overflow.json()).toMatchObject({ error: "rate_limited" });

		for (let round = 0; round < 8 && gate.started() > 0; round += 1) {
			gate.releaseAll();
			await settle();
		}
		expect((await inFlight).status).toBe(200);
		expect((await queued).status).toBe(200);
	});

	it("does not delay a second subject behind the first subject's queue", async () => {
		const gate = gatedInvoke();
		const fast = vi.fn<PlayerSessionClient["invoke"]>().mockResolvedValue({
			id: 1,
			ok: true,
			result: { content: [{ type: "text", text: "ok" }] },
		});
		const gateway = isolatedGateway({
			invoke: gate.invoke,
			maxConcurrentRequestsPerSubject: 1,
			subjectQueueDepth: 8,
			resolveClient: (subject) => ({
				invoke: subject === "user_slow" ? gate.invoke : fast,
			}),
		});
		const slow = await tokenFor("user_slow");
		const quick = await tokenFor("user_quick");

		const blocked = gateway.fetch(mcpRequest(toolCall(), slow));
		await settle();
		const waiting = gateway.fetch(mcpRequest(toolCall(), slow));
		await settle();

		// The other player's slot is its own; it must not wait behind user_slow.
		const other = await gateway.fetch(mcpRequest(toolCall(), quick));
		expect(other.status).toBe(200);
		expect(fast).toHaveBeenCalledTimes(1);

		for (let round = 0; round < 8 && gate.started() > 0; round += 1) {
			gate.releaseAll();
			await settle();
		}
		expect((await blocked).status).toBe(200);
		expect((await waiting).status).toBe(200);
	});

	// sk-0m4.120.30: the must-gather bundle's `session_status` reported
	// `status_failed` in every bundle because the per-subject seat queue had no
	// `status()` and the subject-scoped client threw a plain Error. The probe
	// must pass through to the router's status, untouched by the queue.
	it("passes status() through the seat queue so must-gather sees the daemon status (sk-0m4.120.30)", async () => {
		const sink = createMemoryFeedbackSink();
		const status = vi.fn<NonNullable<PlayerSessionClient["status"]>>().mockResolvedValue({
			id: 7,
			ok: true,
			result: {
				binding: { url: "http://127.0.0.1:3000", db: "w1", identity: "i", actorId: "hero_1" },
				uptimeMs: 1234,
				subscribed: true,
				observability: { mode: "off" },
			},
		});
		const gateway = createPlayerMcpGateway({
			resourceConfig: { canonicalOrigin: origin, issuer, jwks: [signer.publicJwk] },
			client: {
				invoke: async () => ({ id: 1, ok: true, result: { content: [] } }),
				status,
			},
			now: () => now * 1000,
			feedback: {
				sink,
				rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => now * 1000 }),
				resolveSeat: () => ({ actorId: "hero_1" }),
			},
		});
		const token = await tokenFor("user_status_probe");

		const feedback = await gateway.fetch(
			mcpRequest(
				rpc("tools/call", {
					name: SPELLKAVE_FEEDBACK_TOOL,
					arguments: { category: "bug", message: "status probe", include_report: true },
				}),
				token,
			),
		);
		expect(feedback.status).toBe(200);
		expect(status).toHaveBeenCalledTimes(1);
		const sessionStatus = sink.submissions[0]?.bundle?.session_status;
		expect(sessionStatus).toMatchObject({ subscribed: true, uptimeMs: 1234 });
		expect(JSON.stringify(sessionStatus)).not.toContain("status_failed");
	});

	// sk-0m4.120.36: production wires NO resolveClient (the JWT world router
	// picks the seat from the request subject itself), so every subject used to
	// share ONE SerializedPlayerSessionClient with a cap of 2. Two in-flight
	// calls of player A made player B's next call fail in 1-2 ms with a plain
	// Error -> `internal_error`, and the call never reached B's session daemon
	// (OpenObserve rows 2026-08-29 16:48-16:52 UTC, kavemouth-2 / kavemouth-4).
	it("gives each subject its own seat queue even without resolveClient (sk-0m4.120.36)", async () => {
		const gate = gatedInvoke();
		const gateway = isolatedGateway({
			invoke: gate.invoke,
			maxConcurrentRequestsPerSubject: 2,
			subjectQueueDepth: 8,
		});
		const slow = await tokenFor("user_slow_shared");
		const quick = await tokenFor("user_quick_shared");

		// The seat queue runs one call at a time per seat: A's second call waits
		// behind the first, so the queue now holds its whole cap of 2.
		const blockedA = gateway.fetch(mcpRequest(toolCall(), slow));
		const blockedB = gateway.fetch(mcpRequest(toolCall(), slow));
		await settle();
		expect(gate.started()).toBe(1);

		// The other player's call must reach the daemon, not die at the gateway.
		const other = gateway.fetch(mcpRequest(toolCall(), quick));
		await settle();
		expect(gate.started()).toBe(2);

		for (let round = 0; round < 8 && gate.started() > 0; round += 1) {
			gate.releaseAll();
			await settle();
		}
		const otherJson = await responseJson(await other);
		expect(otherJson).toMatchObject({
			result: { content: [{ type: "text", text: "ok" }] },
		});
		expect((otherJson.result as { isError?: boolean }).isError).toBeUndefined();
		expect((await blockedA).status).toBe(200);
		expect((await blockedB).status).toBe(200);
		expect(gate.invoke).toHaveBeenCalledTimes(3);
	});

	// sk-0m4.120.36 (second shape): the HTTP 504 frees the subject's admission
	// slot while the invoke behind it is still pending in the seat queue. The
	// next call then hits the seat cap. That is a real, retryable condition —
	// it must say so (`seat_busy`, category `gateway`), never `internal_error`.
	it("reports a full seat queue as seat_busy, not internal_error (sk-0m4.120.36)", async () => {
		const gate = gatedInvoke();
		const gateway = isolatedGateway({
			invoke: gate.invoke,
			maxConcurrentRequestsPerSubject: 2,
			subjectQueueDepth: 8,
			requestTimeoutMs: 20,
		});
		const token = await tokenFor("user_leaked_slots");

		const timedOutA = await gateway.fetch(mcpRequest(toolCall(), token));
		const timedOutB = await gateway.fetch(mcpRequest(toolCall(), token));
		expect([timedOutA.status, timedOutB.status]).toEqual([504, 504]);
		// One in flight, one queued behind it: the seat queue is at its cap of 2
		// although both HTTP requests are already answered.
		expect(gate.started()).toBe(1);
		expect(gate.invoke).toHaveBeenCalledTimes(1);

		const busy = await gateway.fetch(mcpRequest(toolCall(), token));
		expect(busy.status).toBe(200);
		const busyJson = await responseJson(busy);
		expect(busyJson).toMatchObject({
			result: {
				isError: true,
				structuredContent: { error: { category: "gateway", code: "seat_busy" } },
			},
		});
		const busyText = JSON.stringify(busyJson);
		expect(busyText).not.toContain("internal_error");
		expect(busyText).toMatch(/busy/i);
		// Never reached the daemon: still only the leaked invoke.
		expect(gate.invoke).toHaveBeenCalledTimes(1);

		for (let round = 0; round < 8 && gate.started() > 0; round += 1) {
			gate.releaseAll();
			await settle();
		}
	});
});

describe("login-gated public transcripts", () => {
	let signer: TestSigner;
	let now: number;
	let gateway: PlayerMcpGatewayService;
	const files = new Map<string, string>();

	beforeEach(async () => {
		signer = await createTestSigner();
		now = Math.floor(Date.now() / 1000);
		files.clear();
		files.set("/public/transcripts/kavemouth-1/agent-run-events.jsonl", '{"type":"tool_call"}\n');
		gateway = createPlayerMcpGateway({
			resourceConfig: {
				canonicalOrigin: origin,
				issuer,
				jwks: [signer.publicJwk],
			},
			client: {
				invoke: vi.fn(),
			},
			now: () => now * 1000,
			allowedOriginHostnames: ["mcp.example.test", "spellkave.com", "localhost"],
			transcriptDirectory: "/public/transcripts",
			publicTranscriptSlugs: new Set(["kavemouth-1"]),
			readTranscriptFile: async (path) => files.get(path) ?? null,
		});
	});

	async function token(): Promise<string> {
		return signer.sign({
			iss: issuer,
			aud: `${origin}/mcp`,
			sub: "user_ok",
			exp: now + 300,
			iat: now,
		});
	}

	it("transcript flood does not rate-limit /mcp", async () => {
		const invoke = vi.fn<PlayerSessionClient["invoke"]>().mockResolvedValue({
			id: 1,
			ok: true,
			result: { content: [{ type: "text", text: "ok" }] },
		});
		const isolated = createPlayerMcpGateway({
			resourceConfig: {
				canonicalOrigin: origin,
				issuer,
				jwks: [signer.publicJwk],
			},
			client: { invoke },
			now: () => now * 1000,
			// Tiny transcript bucket; generous /mcp bucket.
			transcriptRequestRateLimit: { maxRequests: 3, windowMs: 60_000 },
			requestRateLimit: { maxRequests: 50, windowMs: 60_000 },
			transcriptDirectory: "/public/transcripts",
			publicTranscriptSlugs: new Set(["kavemouth-1"]),
			readTranscriptFile: async (path) => files.get(path) ?? null,
		});
		const bearer = await token();
		const transcriptReq = () =>
			new Request(`${origin}/transcripts/kavemouth-1`, {
				headers: {
					host: "mcp.example.test",
					authorization: `Bearer ${bearer}`,
				},
			});
		expect((await isolated.fetch(transcriptReq())).status).toBe(200);
		expect((await isolated.fetch(transcriptReq())).status).toBe(200);
		expect((await isolated.fetch(transcriptReq())).status).toBe(200);
		expect((await isolated.fetch(transcriptReq())).status).toBe(429);

		const mcpResponse = await isolated.fetch(
			new Request(`${origin}/mcp`, {
				method: "POST",
				headers: {
					accept: "application/json, text/event-stream",
					"content-type": "application/json",
					host: "mcp.example.test",
					authorization: `Bearer ${bearer}`,
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
			}),
		);
		expect(mcpResponse.status).toBe(200);
	});
});

describe("world tiles routes (/w/<slug>)", () => {
	let signer: TestSigner;
	let now: number;
	let gateway: PlayerMcpGatewayService;

	beforeEach(async () => {
		signer = await createTestSigner();
		now = Math.floor(Date.now() / 1000);
		const { buildWorldTilesCache } = await import("../osm-model.ts");
		const rows = sampleWorldRows;
		const cache = buildWorldTilesCache("demo", rows, { tick: 7 });
		gateway = createPlayerMcpGateway({
			resourceConfig: {
				canonicalOrigin: origin,
				issuer,
				jwks: [signer.publicJwk],
			},
			client: { invoke: vi.fn() },
			now: () => now * 1000,
			worldTiles: {
				knownSlugs: new Set(["demo"]),
				loadCache: async () => cache,
			},
		});
	});

	async function token(): Promise<string> {
		return signer.sign({
			iss: issuer,
			aud: `${origin}/mcp`,
			sub: "user_ok",
			exp: now + 300,
			iat: now,
		});
	}

	it("challenges unauthenticated tile reads and serves TileJSON with open CORS", async () => {
		const bare = await gateway.fetch(
			new Request(`${origin}/w/demo/tiles.json`, {
				headers: { host: "mcp.example.test", origin: "https://josm.openstreetmap.de" },
			}),
		);
		expect(bare.status).toBe(401);
		expect(bare.headers.get("access-control-allow-origin")).toBe("https://josm.openstreetmap.de");

		const ok = await gateway.fetch(
			new Request(`${origin}/w/demo/tiles.json`, {
				headers: {
					host: "mcp.example.test",
					origin: "https://josm.openstreetmap.de",
					authorization: `Bearer ${await token()}`,
				},
			}),
		);
		expect(ok.status).toBe(200);
		const body = (await ok.json()) as { tilejson: string; levels: string[] };
		expect(body.tilejson).toBe("3.0.0");
		expect(Array.isArray(body.levels)).toBe(true);
		expect(ok.headers.get("access-control-allow-origin")).toBe("https://josm.openstreetmap.de");
	});

	it("proves a single cache instance serves both an /api/0.6/map request and a /tiles/… request for the same slug (same tick / same exportWorld call count)", async () => {
		const { createStaticWorldOsmCache, snapshotFromExport } = await import("../osm-model.ts");
		const worldOsm = await import("@spellkave/world-map");
		const rows = sampleWorldRows;

		let exportWorldCalls = 0;
		const exportResult = worldOsm.exportWorld(rows, {
			tick: 42,
			timestamp: "2026-08-22T00:00:00Z",
		});
		exportWorldCalls += 1;

		const snap = snapshotFromExport(exportResult, 42);
		const sharedCache = createStaticWorldOsmCache({ "demo": snap });

		const testGateway = createPlayerMcpGateway({
			resourceConfig: {
				canonicalOrigin: origin,
				issuer,
				jwks: [signer.publicJwk],
			},
			client: { invoke: vi.fn() },
			now: () => now * 1000,
			osmCache: sharedCache,
			osmWorldSlugs: new Set(["demo"]),
			worldTiles: {
				knownSlugs: new Set(["demo"]),
				loadCache: async (slug: string) => {
					await sharedCache.ensure(slug);
					return sharedCache.getTiles(slug) ?? null;
				},
			},
			allowedHostnames: ["mcp.example.test"],
			allowedOriginHostnames: ["mcp.example.test"],
		});

		const bearer = await token();
		const headers = {
			host: "mcp.example.test",
			authorization: `Bearer ${bearer}`,
		};

		// 1. Request /w/demo/api/0.6/map
		const mapBounds = sharedCache.getTiles("demo")!.bounds;
		const mapBbox = [mapBounds[0] - 0.001, mapBounds[1] - 0.001, mapBounds[2] + 0.001, mapBounds[3] + 0.001].join(",");
		const mapRes = await testGateway.fetch(
			new Request(`${origin}/w/demo/api/0.6/map?bbox=${mapBbox}`, {
				headers: { ...headers, accept: "application/json" },
			}),
		);
		expect(mapRes.status).toBe(200);
		const mapJson = (await mapRes.json()) as { elements: unknown[] };
		expect(mapJson.elements.length).toBeGreaterThan(0);

		// 2. Request /w/demo/tiles.json
		const tileJsonRes = await testGateway.fetch(
			new Request(`${origin}/w/demo/tiles.json`, { headers }),
		);
		expect(tileJsonRes.status).toBe(200);
		const tileJson = (await tileJsonRes.json()) as { tick: number; tilejson: string };
		expect(tileJson.tilejson).toBe("3.0.0");
		expect(tileJson.tick).toBe(42);

		// 3. Request /w/demo/tiles/{z}/{x}/{y}.pbf
		const tilesCache = sharedCache.getTiles("demo");
		expect(tilesCache).toBeDefined();
		const [minLon, minLat, maxLon, maxLat] = tilesCache!.bounds;
		const lon = (minLon + maxLon) / 2;
		const lat = (minLat + maxLat) / 2;
		const z = 16;
		const n = 2 ** z;
		const x = Math.floor(((lon + 180) / 360) * n);
		const latRad = (lat * Math.PI) / 180;
		const y = Math.floor(
			((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n,
		);

		const tileRes = await testGateway.fetch(
			new Request(`${origin}/w/demo/tiles/${z}/${x}/${y}.pbf`, { headers }),
		);
		expect(tileRes.status).toBe(200);
		expect(tileRes.headers.get("content-type")).toBe("application/x-protobuf");
		expect(tileRes.headers.get("etag")).toBe('"tick-42"');

		// exportWorld was called exactly once to produce the shared cache
		expect(exportWorldCalls).toBe(1);

		await testGateway.close();
		await sharedCache.close();
	});
});
