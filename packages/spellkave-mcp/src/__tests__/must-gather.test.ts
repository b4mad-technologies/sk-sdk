// A maintainer receives a must-gather bundle that explains a player's problem without
// exposing tokens, keys or personal data, and stays within its size cap. If it breaks,
// bundles leak secrets or truncate the evidence. Pure builders and redaction, no setup.

// keep-file(K1): bundle builders and redaction rule space over pure functions

import type { AgentRunEvent } from "@spellkave/agent-observability";
import type { SessionDaemonStatus } from "@spellkave/session/node";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	buildMustGather,
	DEFAULT_MAX_MUST_GATHER_BYTES,
	deriveRecentToolErrors,
	MUST_GATHER_BUNDLE_VERSION,
	type MustGatherContext,
	redactSensitiveData,
	redactString,
} from "../must-gather.ts";
import {
	createRemoteMcpRunObserver,
	createRunEventsRingBufferSink,
	withRemoteMcpRequestContext,
	withRemoteMcpRequestSubject,
} from "../observability.ts";
import { hashTranscriptSubject } from "../transcript.ts";

const SAMPLE_JWT = [
	JSON.stringify({ alg: "HS256", typ: "JWT" }),
	JSON.stringify({ sub: "test-player" }),
	"dummy signature",
].map((part) => Buffer.from(part).toString("base64url")).join(".");

function fixedClock(iso = "2026-08-22T15:30:00.000Z"): () => Date {
	return () => new Date(iso);
}

function sampleEvent(
	type: "run_start" | "tool_call" | "run_end",
	runId = "mcp-req-1",
	actorId = "hero_42",
	data: Record<string, unknown> = {},
): AgentRunEvent {
	return {
		v: "agent-run-events/v1",
		run_id: runId,
		run_kind: "mcp_tool_call",
		actor_id: actorId,
		role: "PLAYER",
		controller_kind: "llm_player",
		driver: "remote-mcp",
		seed: "",
		ts: "2026-08-22T15:30:00.000Z",
		type,
		data,
	};
}

describe("versions.gateway (sk-0m4.120.13)", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it("is the deployed image tag when the host declares SPELLKAVE_IMAGE_TAG, else the 0.0.0 literal", () => {
		vi.stubEnv("SPELLKAVE_IMAGE_TAG", " sha-919f9ae5 ");
		expect(buildMustGather({}).versions.gateway).toBe("sha-919f9ae5");
		vi.stubEnv("SPELLKAVE_IMAGE_TAG", "");
		expect(buildMustGather({}).versions.gateway).toBe("0.0.0");
	});
});

describe("must-gather bundle", () => {
	it("builds a versioned diagnostic bundle matching snapshot", () => {
		const clock = fixedClock();
		const events = [
			sampleEvent("run_start", "mcp-req-snapshot", "hero_42", {
				correlation_id: "req-snapshot",
				world_slug: "elven-mini",
				subject_prefix: "a1b2c3d4e5f60718",
			}),
			sampleEvent("tool_call", "mcp-req-snapshot", "hero_42", {
				tool_name: "spellkave_scene",
				duration_ms: 45,
				correlation_id: "req-snapshot",
				subject_prefix: "a1b2c3d4e5f60718",
			}),
			sampleEvent("run_end", "mcp-req-snapshot", "hero_42", {
				terminal: "completed",
				duration_ms: 50,
				correlation_id: "req-snapshot",
				subject_prefix: "a1b2c3d4e5f60718",
			}),
		];

		const sessionStatus: SessionDaemonStatus = {
			binding: {
				url: "http://127.0.0.1:3000",
				db: "spellkave-elven-mini",
				identity: "user_sub_hash",
				actorId: "hero_42",
			},
			uptimeMs: 120_000,
			subscribed: true,
			observability: {
				mode: "jsonl+otlp",
				logsProjection: "configured",
				tracesProjection: "configured",
				metricsProjection: "disabled",
			},
		};

		const ctx: MustGatherContext = {
			runId: "mcp-req-snapshot",
			correlationId: "req-snapshot",
			world: {
				slug: "elven-mini",
				db: "spellkave-elven-mini",
			},
			seat: {
				actorId: "hero_42",
				subjectPrefix: "a1b2c3d4e5f60718",
				role: "PLAYER",
			},
			versions: {
				gateway: "0.0.0",
				module: "0.1.4",
				companion: "0.0.0",
			},
			sessionStatus,
			runEvents: events,
			traceSummary: {
				traceId: "trace-abc-123",
				spanCount: 3,
				lastProvenanceStatus: "Succeeded",
				lastReducer: "r_act",
			},
			recentToolErrors: [
				{
					toolName: "spellkave_act",
					correlationId: "req-prev-fail",
					errorCategory: "domain",
					errorCode: "target_not_reachable",
					errorMessage: "Target is out of range.",
					timestamp: "2026-08-22T15:29:45.000Z",
					durationMs: 30,
				},
			],
			timestamps: {
				collectedAt: "2026-08-22T15:30:00.000Z",
				sessionStartedAt: "2026-08-22T15:28:00.000Z",
			},
			notes: "Player encountered out of range error while moving.",
			clientInfo: {
				clientName: "Claude Desktop",
				platform: "darwin-arm64",
			},
			now: clock,
		};

		const bundle = buildMustGather(ctx);

		expect(bundle.v).toBe(MUST_GATHER_BUNDLE_VERSION);
		expect(bundle.world).toEqual({ slug: "elven-mini", db: "spellkave-elven-mini" });
		expect(bundle.seat.actor_id).toBe("hero_42");
		expect(bundle.seat.subject_prefix).toBe("a1b2c3d4e5f60718");
		expect(bundle.versions.gateway).toBe("0.0.0");
		expect(bundle.versions.module).toBe("0.1.4");
		expect(bundle.run.events).toHaveLength(3);
		expect(bundle.diagnostics.size_bytes).toBeLessThan(DEFAULT_MAX_MUST_GATHER_BYTES);
		expect(bundle.diagnostics.truncated).toBe(false);

		// sk-jay0.7.164.4: replaces a 129-line whole-bundle snapshot. The asserts
		// above cover the computed/normalized fields; these cover the remaining
		// pass-through fields the snapshot also pinned (context values copied
		// onto the bundle unchanged) so removing the snapshot loses no coverage.
		expect(bundle.client_info).toEqual({ clientName: "Claude Desktop", platform: "darwin-arm64" });
		expect(bundle.session_status).toEqual(sessionStatus);
		expect(bundle.traces_summary).toEqual({
			traceId: "trace-abc-123",
			spanCount: 3,
			lastProvenanceStatus: "Succeeded",
			lastReducer: "r_act",
		});
		expect(bundle.notes).toBe("Player encountered out of range error while moving.");
		expect(bundle.recent_tool_errors).toEqual([
			{
				toolName: "spellkave_act",
				correlationId: "req-prev-fail",
				errorCategory: "domain",
				errorCode: "target_not_reachable",
				errorMessage: "Target is out of range.",
				timestamp: "2026-08-22T15:29:45.000Z",
				durationMs: 30,
			},
		]);
		// timestamps carries both the raw echoed shape (collectedAt/sessionStartedAt)
		// and the normalized collected_at alias the rest of the bundle keys off of.
		expect(bundle.timestamps).toEqual({
			collectedAt: "2026-08-22T15:30:00.000Z",
			collected_at: "2026-08-22T15:30:00.000Z",
			sessionStartedAt: "2026-08-22T15:28:00.000Z",
		});
	});

	it("redacts JWTs, Bearer tokens, emails, URL credentials, and secret fields", () => {
		const sampleApiKey = "sk_" + "live_" + "x".repeat(24);
		const sampleEmail = "player.tester+qa@spellkave.games";

		const dirtyContext: MustGatherContext = {
			world: {
				slug: "elven-mini",
				db: "spellkave-dev",
			},
			seat: {
				actorId: "hero_1",
			},
			sessionStatus: {
				auth: {
					authorization: `Bearer ${SAMPLE_JWT}`,
					access_token: SAMPLE_JWT,
					refreshToken: "super_secret_refresh_token_value",
					apiKey: sampleApiKey,
					password: "plaintext_super_password",
				},
				userEmail: sampleEmail,
				connectionUrl: "https://user:super_secret_pw@spacetimedb.internal:3000/v1",
			},
			recentToolErrors: [
				{
					toolName: "spellkave_communicate",
					errorMessage: `Failed with token: Bearer ${SAMPLE_JWT} and email ${sampleEmail}`,
					errorDetails: {
						token: SAMPLE_JWT,
						secretKey: "very-secret-value",
					},
				},
			],
			notes: `User reported issue from email: ${sampleEmail} with token: ${SAMPLE_JWT} and bearer Bearer my-raw-bearer-token`,
			now: fixedClock(),
		};

		const bundle = buildMustGather(dirtyContext);
		const serialized = JSON.stringify(bundle);

		// Prove no JWT survives
		expect(serialized).not.toContain(SAMPLE_JWT);
		expect(serialized).not.toMatch(
			/\beyJ[a-zA-Z0-9_-]{5,}\.eyJ[a-zA-Z0-9_-]{5,}\.[a-zA-Z0-9_-]+\b/,
		);

		// Prove no raw Bearer token survives
		expect(serialized).not.toMatch(/\b(bearer\s+)[a-zA-Z0-9_\-.~+/]{4,}/i);

		// Prove no Email survives
		expect(serialized).not.toContain(sampleEmail);
		expect(serialized).not.toContain("spellkave.games");
		expect(serialized).not.toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);

		// Prove no Passwords or API keys survive
		expect(serialized).not.toContain("plaintext_super_password");
		expect(serialized).not.toContain("super_secret_refresh_token_value");
		expect(serialized).not.toContain("super_secret_pw");
		expect(serialized).not.toContain(sampleApiKey);

		// Confirm redacted placeholders are present
		expect(serialized).toContain("[REDACTED_TOKEN]");
		expect(serialized).toContain("[REDACTED_EMAIL]");
	});

	it("redactString replaces sensitive substrings individually", () => {
		const sampleGitHubToken = "ghp" + "_" + "x".repeat(36);
		const raw = `Contact admin@example.com with Bearer ${SAMPLE_JWT} or ${sampleGitHubToken}`;
		const cleaned = redactString(raw);
		expect(cleaned).not.toContain("admin@example.com");
		expect(cleaned).not.toContain(SAMPLE_JWT.split(".")[0]);
		expect(cleaned).not.toContain(sampleGitHubToken);
		expect(cleaned).toContain("[REDACTED_EMAIL]");
		expect(cleaned).toContain("[REDACTED_TOKEN]");
	});

	it("redactSensitiveData handles circular references without throwing", () => {
		const cyclic: Record<string, unknown> = {
			name: "test",
			email: "user@example.com",
		};
		cyclic.self = cyclic;

		const result = redactSensitiveData(cyclic);
		expect(result.name).toBe("test");
		expect(result.email).toBe("[REDACTED_EMAIL]");
		expect(result.self).toBe("[CIRCULAR]");
	});

	it("enforces size cap under 256 KiB when payloads are large", () => {
		const largePayload = "X".repeat(2_000);
		const largeEvents: AgentRunEvent[] = [];
		for (let i = 0; i < 20; i++) {
			largeEvents.push(
				sampleEvent("tool_call", "mcp-heavy-run", "hero_1", {
					index: i,
					bloat: largePayload,
				}),
			);
		}

		const largeErrors = [];
		for (let i = 0; i < 10; i++) {
			largeErrors.push({
				toolName: `tool_${i}`,
				errorMessage: `Error ${i}: ${largePayload}`,
			});
		}

		const ctx: MustGatherContext = {
			runId: "mcp-heavy-run",
			world: { slug: "heavy-world", db: "heavy-db" },
			seat: "hero_1",
			runEvents: largeEvents,
			recentToolErrors: largeErrors,
			notes: "N".repeat(10_000),
			maxBytes: 16 * 1024, // 16 KiB cap
			now: fixedClock(),
		};

		const bundle = buildMustGather(ctx);
		const serialized = JSON.stringify(bundle);

		expect(serialized.length).toBeLessThanOrEqual(16 * 1024);
		expect(bundle.diagnostics.truncated).toBe(true);
		expect(bundle.diagnostics.size_bytes).toBe(serialized.length);
	});

	it("collects in-memory run events from RunEventsRingBufferSink", async () => {
		const ringSink = createRunEventsRingBufferSink(20);
		const observer = createRemoteMcpRunObserver({
			actorId: "hero_ring",
			sinks: [ringSink],
			eventsSink: ringSink,
		});

		await withRemoteMcpRequestContext("ring-req-1", () =>
			withRemoteMcpRequestSubject("oauth-sub-1", () =>
				observer.observeToolCall("spellkave_look", async () => ({
					content: [{ type: "text", text: "room description" }],
				})),
			),
		);

		await withRemoteMcpRequestContext("ring-req-2", () =>
			withRemoteMcpRequestSubject("oauth-sub-1", () =>
				observer.observeToolCall("spellkave_move", async () => ({
					content: [{ type: "text", text: "moved north" }],
				})),
			),
		);

		expect(ringSink.events.length).toBe(6); // 2 tool calls * 3 events each (run_start, tool_call, run_end)

		// The caller's whole history — never only the run named by runId.
		const bundle = buildMustGather({
			runId: "mcp-ring-req-2",
			eventsSink: ringSink,
			world: { slug: "dungeon-1", db: "dungeon-1-db" },
			seat: { actorId: "hero_ring", subjectPrefix: hashTranscriptSubject("oauth-sub-1") },
			now: fixedClock(),
		});

		expect(bundle.run.run_id).toBe("mcp-ring-req-2");
		expect(bundle.run.events).toHaveLength(6);
		expect(bundle.run.events.map((e) => e.run_id)).toEqual([
			"mcp-ring-req-1",
			"mcp-ring-req-1",
			"mcp-ring-req-1",
			"mcp-ring-req-2",
			"mcp-ring-req-2",
			"mcp-ring-req-2",
		]);

		// A caller without a subject keeps only unstamped rows: nothing here.
		const noSubject = buildMustGather({
			eventsSink: ringSink,
			world: { slug: "dungeon-1", db: "dungeon-1-db" },
			seat: "hero_ring",
			now: fixedClock(),
		});
		expect(noSubject.run.events).toHaveLength(0);
	});

	it("regression sk-0m4.120.8: 5 prior runs + own run_start ⇒ bundle lists the prior runs", async () => {
		const ringSink = createRunEventsRingBufferSink(100);
		const observer = createRemoteMcpRunObserver({
			resolveActor: () => ({ actorId: "hero_hist", worldSlug: "elven-mini-4" }),
			sinks: [ringSink],
			eventsSink: ringSink,
		});
		const subject = "user_01HISTORY";
		for (let i = 1; i <= 5; i++) {
			await withRemoteMcpRequestContext(`hist-${i}`, () =>
				withRemoteMcpRequestSubject(subject, () =>
					observer.observeToolCall(i === 3 ? "spellkave_move" : "spellkave_scene", async () =>
						i === 3
							? {
									isError: true,
									content: [{ type: "text", text: "world unreachable" }],
									structuredContent: {
										error: { category: "transport", code: "world_unreachable" },
									},
								}
							: { content: [{ type: "text", text: "ok" }] },
					),
				),
			);
		}
		// The feedback call's own run_start is already in the buffer when the
		// bundle is built (observeToolCall wraps handleSpellkaveFeedback).
		ringSink.write({
			...sampleEvent("run_start", "mcp-fb-own", "hero_hist", {
				correlation_id: "fb-own",
				world_slug: "elven-mini-4",
				subject_prefix: hashTranscriptSubject(subject),
			}),
		});

		const bundle = buildMustGather({
			runId: "mcp-fb-own",
			correlationId: "fb-own",
			eventsSink: ringSink,
			world: { slug: "elven-mini-4", db: "elven-mini-4" },
			seat: { actorId: "hero_hist", subjectPrefix: hashTranscriptSubject(subject) },
			now: fixedClock(),
		});

		expect(bundle.run.run_id).toBe("mcp-fb-own");
		// 5 runs * 3 events + own run_start
		expect(bundle.run.events_count).toBe(16);
		const runIds = new Set(bundle.run.events.map((e) => e.run_id));
		expect(runIds).toEqual(
			new Set(["mcp-hist-1", "mcp-hist-2", "mcp-hist-3", "mcp-hist-4", "mcp-hist-5", "mcp-fb-own"]),
		);
		const toolCalls = bundle.run.events.filter((e) => e.type === "tool_call");
		expect(toolCalls.map((e) => e.data.tool_name)).toEqual([
			"spellkave_scene",
			"spellkave_scene",
			"spellkave_move",
			"spellkave_scene",
			"spellkave_scene",
		]);
		expect(toolCalls.map((e) => e.data.is_error)).toEqual([false, false, true, false, false]);

		// recent_tool_errors derived from the is_error row — identity fields only.
		expect(bundle.recent_tool_errors).toEqual([
			{
				toolName: "spellkave_move",
				correlationId: "hist-3",
				errorCategory: "transport",
				// sk-0m4.120.11: the tool_call row now carries the stable code too.
				errorCode: "world_unreachable",
				errorMessage: "transport error",
				timestamp: expect.any(String),
				durationMs: expect.any(Number),
				runId: "mcp-hist-3",
			},
		]);
		expect(JSON.stringify(bundle)).not.toContain(subject);
		expect(JSON.stringify(bundle)).not.toContain("world unreachable");
	});

	it("excludes another subject's rows from the process-wide ring buffer", async () => {
		const ringSink = createRunEventsRingBufferSink(100);
		const observer = createRemoteMcpRunObserver({
			resolveActor: () => ({ actorId: "shared_actor", worldSlug: "elven-mini-4" }),
			sinks: [ringSink],
			eventsSink: ringSink,
		});
		const mine = "user_01MINE";
		const theirs = "user_01THEIRS";
		const failing = async () => ({
			isError: true,
			content: [{ type: "text" as const, text: "nope" }],
			structuredContent: { error: { category: "domain", code: "not_reachable" } },
		});
		const fine = async () => ({ content: [{ type: "text" as const, text: "ok" }] });

		await withRemoteMcpRequestContext("mine-1", () =>
			withRemoteMcpRequestSubject(mine, () => observer.observeToolCall("spellkave_scene", fine)),
		);
		await withRemoteMcpRequestContext("theirs-1", () =>
			withRemoteMcpRequestSubject(theirs, () => observer.observeToolCall("spellkave_act", failing)),
		);
		await withRemoteMcpRequestContext("mine-2", () =>
			withRemoteMcpRequestSubject(mine, () => observer.observeToolCall("spellkave_move", fine)),
		);
		// Unstamped row (no subject): belongs to nobody authenticated.
		ringSink.write(sampleEvent("tool_call", "mcp-anon", "shared_actor", { tool_name: "x" }));

		const bundle = buildMustGather({
			runId: "mcp-mine-2",
			eventsSink: ringSink,
			world: { slug: "elven-mini-4", db: "elven-mini-4" },
			seat: { actorId: "shared_actor", subjectPrefix: hashTranscriptSubject(mine) },
			now: fixedClock(),
		});

		expect(bundle.run.events).toHaveLength(6);
		expect(
			bundle.run.events.every((e) => e.data.subject_prefix === hashTranscriptSubject(mine)),
		).toBe(true);
		expect(bundle.run.events.some((e) => e.run_id === "mcp-theirs-1")).toBe(false);
		expect(bundle.run.events.some((e) => e.run_id === "mcp-anon")).toBe(false);
		expect(bundle.recent_tool_errors).toEqual([]);
		expect(JSON.stringify(bundle)).not.toContain(hashTranscriptSubject(theirs));
	});

	it("drops rows stamped with a different world_slug, keeps unstamped ones", () => {
		const prefix = hashTranscriptSubject("user_01WORLDS");
		const events = [
			sampleEvent("tool_call", "mcp-w1", "hero_w", {
				tool_name: "spellkave_scene",
				subject_prefix: prefix,
				world_slug: "elven-mini-4",
			}),
			sampleEvent("tool_call", "mcp-w2", "hero_w", {
				tool_name: "spellkave_scene",
				subject_prefix: prefix,
				world_slug: "other-world",
			}),
			sampleEvent("run_start", "mcp-w3", "hero_w", { subject_prefix: prefix }),
		];
		const bundle = buildMustGather({
			runEvents: events,
			world: { slug: "elven-mini-4", db: "elven-mini-4" },
			seat: { actorId: "hero_w", subjectPrefix: prefix },
			now: fixedClock(),
		});
		expect(bundle.run.events.map((e) => e.run_id)).toEqual(["mcp-w1", "mcp-w3"]);
	});

	it("deriveRecentToolErrors keeps only is_error tool_call rows, bounded", () => {
		const events: AgentRunEvent[] = [];
		for (let i = 0; i < 15; i++) {
			events.push(
				sampleEvent("tool_call", `mcp-e${i}`, "hero_e", {
					tool_name: `tool_${i}`,
					is_error: i % 2 === 0,
					error_category: "domain",
					error_code: `code_${i}`,
					duration_ms: i,
					correlation_id: `e${i}`,
				}),
			);
		}
		events.push(sampleEvent("run_end", "mcp-e0", "hero_e", { terminal: "error" }));
		const errors = deriveRecentToolErrors(events, 3);
		expect(errors.map((e) => e.toolName)).toEqual(["tool_10", "tool_12", "tool_14"]);
		expect(errors[0]).toMatchObject({
			errorCategory: "domain",
			errorCode: "code_10",
			durationMs: 10,
			correlationId: "e10",
			runId: "mcp-e10",
		});
		expect(deriveRecentToolErrors(events)).toHaveLength(8);
	});

	it("extracts sensible defaults when minimal context is supplied", () => {
		const clock = fixedClock("2026-08-22T12:00:00.000Z");
		const bundle = buildMustGather({ now: clock });

		expect(bundle.v).toBe("spellkave-must-gather/v1");
		expect(bundle.world).toEqual({ slug: "unknown", db: "unknown" });
		expect(bundle.seat.actor_id).toBe("unresolved");
		expect(bundle.versions.gateway).toBe("0.0.0");
		expect(bundle.versions.module).toBe("unknown");
		expect(bundle.run.run_id).toBe("unknown");
		expect(bundle.run.events).toEqual([]);
		expect(bundle.run.events_count).toBe(0);
		expect(bundle.timestamps.collected_at).toBe("2026-08-22T12:00:00.000Z");
		expect(bundle.diagnostics.truncated).toBe(false);
	});

	it("derives world and actor from sessionStatus binding fallback", () => {
		const sessionStatus: SessionDaemonStatus = {
			binding: {
				url: "http://127.0.0.1:3000",
				db: "spellkave-srd-cc",
				identity: "sub_123",
				actorId: "fighter_1",
			},
			uptimeMs: 5000,
			subscribed: true,
			observability: { mode: "off" },
		};

		const bundle = buildMustGather({
			sessionStatus,
			now: fixedClock(),
		});

		expect(bundle.world.db).toBe("spellkave-srd-cc");
		expect(bundle.world.slug).toBe("spellkave-srd-cc");
		expect(bundle.seat.actor_id).toBe("fighter_1");
	});
});
