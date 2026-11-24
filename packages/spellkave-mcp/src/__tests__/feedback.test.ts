// A seated player sends feedback from inside the game and it reaches the project as a
// bounded, redacted report, with limits against floods. If it breaks, feedback is
// lost, leaks secrets or can be spammed. Runs against injected sinks, a must-gather
// status and an in-memory rate limiter, no live world.

// keep-file(K2): injected sinks, must-gather status and rate limiter for a seated player

import type { AgentRunEvent } from "@spellkave/agent-observability";
import { createMemorySink } from "@spellkave/agent-observability";
import { SessionDaemonTransportError } from "@spellkave/session/node";
import { describe, expect, it } from "vitest";

import { createSessionToolHandler, type PlayerSessionClient } from "../daemon-handler.ts";
import {
	createInMemoryFeedbackRateLimiter,
	createMemoryFeedbackSink,
	FEEDBACK_CLIENT_SECTION_MAX_BYTES,
	FEEDBACK_MESSAGE_MAX_BYTES,
	FEEDBACK_TOOL_DESCRIPTION,
	handleSpellkaveFeedback,
	SPELLKAVE_FEEDBACK_TOOL,
} from "../feedback.ts";
import {
	createRemoteMcpRunObserver,
	createRunEventsRingBufferSink,
	withRemoteMcpRequestContext,
	withRemoteMcpRequestSubject,
} from "../observability.ts";
import {
	createPlayerMcpServer,
	PLAYER_MCP_INITIALIZE_INSTRUCTIONS,
	PLAYER_MCP_SERVER_INFO,
	playerMcpGatewayToolDescriptors,
} from "../tools.ts";
import { hashTranscriptSubject } from "../transcript.ts";

function fixedClock(iso = "2026-08-22T16:00:00.000Z"): () => Date {
	return () => new Date(iso);
}

function sampleEvent(runId = "mcp-fb-1"): AgentRunEvent {
	return {
		v: "agent-run-events/v1",
		run_id: runId,
		run_kind: "mcp_tool_call",
		actor_id: "hero_42",
		role: "PLAYER",
		controller_kind: "llm_player",
		driver: "remote-mcp",
		seed: "",
		ts: "2026-08-22T15:59:00.000Z",
		type: "tool_call",
		data: { tool_name: "spellkave_scene", correlation_id: "corr-fb" },
	};
}

describe("spellkave_feedback tool registration", () => {
	it("is listed as a gateway-local PLAYER tool", () => {
		expect(playerMcpGatewayToolDescriptors.map((d) => d.name)).toContain(SPELLKAVE_FEEDBACK_TOOL);
		expect(FEEDBACK_TOOL_DESCRIPTION).toMatch(/consent/i);
		expect(PLAYER_MCP_INITIALIZE_INSTRUCTIONS).toMatch(/spellkave_feedback/);
		const server = createPlayerMcpServer(async () => ({
			content: [{ type: "text", text: "ok" }],
		}));
		expect(server).toBeDefined();
	});
});

describe("spellkave_feedback memory sink", () => {
	it("receives message + must-gather bundle and returns a local reference", async () => {
		const sink = createMemoryFeedbackSink({ idFactory: () => "local-feedback-test-1" });
		const rateLimiter = createInMemoryFeedbackRateLimiter({
			now: () => fixedClock()().getTime(),
		});
		const eventsSink = createRunEventsRingBufferSink();
		eventsSink.write(sampleEvent());
		const runMemory = createMemorySink();
		const observer = createRemoteMcpRunObserver({
			sinks: [eventsSink, runMemory],
			eventsSink,
			resolveActor: () => ({ actorId: "hero_42", worldSlug: "elven-mini" }),
			now: fixedClock(),
		});

		const client: PlayerSessionClient = {
			invoke: async () => {
				throw new Error("feedback must not reach the daemon");
			},
			status: async () => ({
				id: 1,
				ok: true,
				result: {
					binding: {
						url: "http://127.0.0.1:3000",
						db: "spellkave-elven-mini",
						identity: "user_sub",
						actorId: "hero_42",
					},
					uptimeMs: 1000,
					subscribed: true,
					observability: {
						mode: "jsonl",
						logsProjection: "configured",
						tracesProjection: "disabled",
						metricsProjection: "disabled",
					},
				},
			}),
		};

		const result = await withRemoteMcpRequestContext("corr-fb", () =>
			observer.observeToolCall(SPELLKAVE_FEEDBACK_TOOL, async () =>
				handleSpellkaveFeedback(
					{
						message: "The exit to the crypt looked walkable but move failed.",
						category: "bug",
						include_report: true,
					},
					client,
					{
						sink,
						rateLimiter,
						resolveSeat: () => ({ actorId: "hero_42", worldSlug: "elven-mini" }),
						now: fixedClock(),
					},
					observer,
				),
			),
		);

		expect(result.isError).not.toBe(true);
		expect(result.structuredContent).toEqual({
			ok: true,
			reference: "local-feedback-test-1",
			category: "bug",
			include_report: true,
		});
		expect(sink.submissions).toHaveLength(1);
		const submission = sink.submissions[0];
		expect(submission).toBeDefined();
		if (submission === undefined) return;
		expect(submission.message).toContain("crypt");
		expect(submission.category).toBe("bug");
		expect(submission.seat.actor_id).toBe("hero_42");
		expect(submission.bundle?.v).toBe("spellkave-must-gather/v1");
		expect(submission.bundle?.seat.actor_id).toBe("hero_42");
		expect(submission.bundle?.run.events.length).toBeGreaterThan(0);

		const feedbackEvents = runMemory.events.filter((e) => e.type === "player_feedback");
		expect(feedbackEvents).toHaveLength(1);
		const fb = feedbackEvents[0];
		expect(fb?.run_id).toBe("mcp-corr-fb");
		expect(fb?.actor_id).toBe("hero_42");
		expect(fb?.data.reference).toBe("local-feedback-test-1");
		expect(fb?.data.category).toBe("bug");
		expect(fb?.data.world_slug).toBe("elven-mini");
		expect(fb?.data.message_chars).toBe(
			"The exit to the crypt looked walkable but move failed.".length,
		);
		expect(typeof fb?.data.bundle_sha256).toBe("string");
		expect(String(fb?.data.bundle_sha256)).toHaveLength(64);
		// Never the bundle body / player message on the run event.
		expect(JSON.stringify(fb?.data)).not.toContain("crypt");
		expect(fb?.data).not.toHaveProperty("bundle");
		expect(fb?.data).not.toHaveProperty("message");

		expect({
			result: result.structuredContent,
			submission: {
				message: submission.message,
				category: submission.category,
				seat: submission.seat,
				submitted_at: submission.submitted_at,
				bundle: {
					v: submission.bundle?.v,
					world: submission.bundle?.world,
					seat: submission.bundle?.seat,
					run_events_count: submission.bundle?.run.events_count,
					versions_gateway: submission.bundle?.versions.gateway,
				},
			},
			player_feedback: {
				run_id: fb?.run_id,
				actor_id: fb?.actor_id,
				type: fb?.type,
				data: {
					reference: fb?.data.reference,
					category: fb?.data.category,
					world_slug: fb?.data.world_slug,
					message_chars: fb?.data.message_chars,
					bundle_sha256_len: String(fb?.data.bundle_sha256 ?? "").length,
				},
			},
		}).toMatchSnapshot();
	});

	it("bundle carries the subject's history, hashed prefix, errors, and an honest status (sk-0m4.120.8)", async () => {
		const subject = "user_01M13FABNDQ7XYZ"; // raw WorkOS sub — must never reach the bundle
		const eventsSink = createRunEventsRingBufferSink();
		const observer = createRemoteMcpRunObserver({
			sinks: [eventsSink],
			eventsSink,
			resolveActor: () => ({ actorId: "hero_42", worldSlug: "elven-mini" }),
			now: fixedClock(),
		});
		const fine = async () => ({ content: [{ type: "text" as const, text: "ok" }] });
		const transportFailure = async () => ({
			isError: true,
			content: [{ type: "text" as const, text: "world unreachable" }],
			structuredContent: { error: { category: "transport", code: "world_unreachable" } },
		});
		for (const [i, op] of [fine, fine, transportFailure, fine].entries()) {
			await withRemoteMcpRequestContext(`prior-${i}`, () =>
				withRemoteMcpRequestSubject(subject, () =>
					observer.observeToolCall(i === 2 ? "spellkave_move" : "spellkave_scene", op),
				),
			);
		}
		// Another player's failing call in the same process.
		await withRemoteMcpRequestContext("other-1", () =>
			withRemoteMcpRequestSubject("user_01OTHERPLAYER", () =>
				observer.observeToolCall("spellkave_act", transportFailure),
			),
		);

		const sink = createMemoryFeedbackSink({ idFactory: () => "local-feedback-history" });
		const client: PlayerSessionClient = {
			invoke: async () => {
				throw new Error("feedback must not reach the daemon");
			},
			status: async () => {
				throw new Error("daemon socket closed");
			},
		};
		const result = await withRemoteMcpRequestContext("corr-fb-hist", () =>
			withRemoteMcpRequestSubject(subject, () =>
				observer.observeToolCall(SPELLKAVE_FEEDBACK_TOOL, async () =>
					handleSpellkaveFeedback(
						{ message: "the DM never answered", category: "bug", include_report: true },
						client,
						{
							sink,
							rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 1 }),
							resolveSeat: () => ({ actorId: "hero_42", worldSlug: "elven-mini" }),
							now: fixedClock(),
						},
						observer,
					),
				),
			),
		);
		expect(result.isError).not.toBe(true);
		const bundle = sink.submissions[0]?.bundle;
		expect(bundle).toBeDefined();
		if (bundle === undefined) return;

		// (d) hashed 16-hex prefix, never a slice of the raw sub.
		expect(bundle.seat.subject_prefix).toBe(hashTranscriptSubject(subject));
		expect(bundle.seat.subject_prefix).toMatch(/^[0-9a-f]{16}$/);
		expect(JSON.stringify(bundle)).not.toContain("user_01");

		// (a) 4 prior runs * 3 events + own run_start; (b) the other player excluded.
		expect(bundle.run.run_id).toBe("mcp-corr-fb-hist");
		expect(bundle.run.events_count).toBe(13);
		expect(bundle.run.events.some((e) => e.run_id === "mcp-other-1")).toBe(false);
		expect(
			bundle.run.events.filter((e) => e.type === "tool_call").map((e) => e.data.tool_name),
		).toEqual(["spellkave_scene", "spellkave_scene", "spellkave_move", "spellkave_scene"]);

		// (c) recent_tool_errors from the is_error row.
		expect(bundle.recent_tool_errors).toHaveLength(1);
		expect(bundle.recent_tool_errors[0]).toMatchObject({
			toolName: "spellkave_move",
			errorCategory: "transport",
			correlationId: "prior-2",
			runId: "mcp-prior-2",
		});

		// Honest status + gateway version. A plain `Error` from status() maps
		// to the explicit fallback code, never its constructor name
		// (sk-0m4.120.24).
		expect(bundle.session_status).toEqual({
			status: "unavailable",
			error_category: "internal",
			error_code: "status_failed",
		});
		expect(bundle.versions.gateway).toBe(PLAYER_MCP_SERVER_INFO.version);
	});

	it("session_status reports ok:false status responses as unavailable", async () => {
		const sink = createMemoryFeedbackSink();
		await handleSpellkaveFeedback(
			{ message: "status is down", include_report: true },
			{
				invoke: async () => ({ id: 1, ok: true, result: { content: [] } }),
				status: async () => ({
					id: 2,
					ok: false,
					error: { code: "daemon_not_ready", message: "not yet" },
				}),
			},
			{
				sink,
				rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 1 }),
				resolveSeat: () => ({ actorId: "hero_1" }),
				now: fixedClock(),
			},
		);
		expect(sink.submissions[0]?.bundle?.session_status).toEqual({
			status: "unavailable",
			error_category: "protocol",
			error_code: "daemon_not_ready",
		});
	});

	it("session_status carries the structured gateway code when status() throws, never the Error name (sk-0m4.120.24)", async () => {
		const collect = async (thrown: unknown) => {
			const sink = createMemoryFeedbackSink();
			await handleSpellkaveFeedback(
				{ message: "status hangs", include_report: true },
				{
					invoke: async () => ({ id: 1, ok: true, result: { content: [] } }),
					status: async () => {
						throw thrown;
					},
				},
				{
					sink,
					rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 1 }),
					resolveSeat: () => ({ actorId: "hero_1" }),
					now: fixedClock(),
				},
			);
			return sink.submissions[0]?.bundle?.session_status;
		};
		// The socket-level request timeout of a busy daemon (round 3, #2802).
		await expect(
			collect(new SessionDaemonTransportError("/private/socket", "timed out after 12000ms")),
		).resolves.toEqual({
			status: "unavailable",
			error_category: "transport",
			error_code: "session_invoke_timeout",
		});
		// A dead socket keeps its transport code.
		await expect(
			collect(
				new SessionDaemonTransportError("/private/socket", "refused", { code: "ECONNREFUSED" }),
			),
		).resolves.toEqual({
			status: "unavailable",
			error_category: "transport",
			error_code: "ECONNREFUSED",
		});
		// Anything unstructured is the explicit fallback, not "Error".
		await expect(collect(new Error("boom"))).resolves.toEqual({
			status: "unavailable",
			error_category: "internal",
			error_code: "status_failed",
		});
	});

	it("emits player_feedback is_error when the sink fails", async () => {
		const eventsSink = createRunEventsRingBufferSink();
		const runMemory = createMemorySink();
		const observer = createRemoteMcpRunObserver({
			sinks: [eventsSink, runMemory],
			eventsSink,
			resolveActor: () => ({ actorId: "hero_fail", worldSlug: "elven-mini" }),
			now: fixedClock(),
		});
		const result = await withRemoteMcpRequestContext("corr-fb-fail", () =>
			observer.observeToolCall(SPELLKAVE_FEEDBACK_TOOL, async () =>
				handleSpellkaveFeedback(
					{ message: "sink is down", category: "bug", include_report: false },
					{ invoke: async () => ({ id: 1, ok: true, result: { content: [] } }) },
					{
						sink: {
							async submit() {
								throw new Error("sink unavailable");
							},
						},
						resolveSeat: () => ({ actorId: "hero_fail", worldSlug: "elven-mini" }),
						now: fixedClock(),
					},
					observer,
				),
			),
		);
		expect(result.isError).toBe(true);
		const fb = runMemory.events.filter((e) => e.type === "player_feedback");
		expect(fb).toHaveLength(1);
		expect(fb[0]?.run_id).toBe("mcp-corr-fb-fail");
		expect(fb[0]?.data).toMatchObject({
			is_error: true,
			category: "bug",
			message_chars: "sink is down".length,
		});
		expect(fb[0]?.data).not.toHaveProperty("reference");
	});

	it("omits the bundle when include_report is false", async () => {
		const sink = createMemoryFeedbackSink({ idFactory: () => "local-feedback-no-report" });
		const result = await handleSpellkaveFeedback(
			{ message: "Just a note", include_report: false },
			{ invoke: async () => ({ id: 1, ok: true, result: { content: [] } }) },
			{
				sink,
				rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 1 }),
				resolveSeat: () => ({ actorId: "hero_1" }),
				now: fixedClock(),
			},
		);
		expect(result.structuredContent).toMatchObject({
			ok: true,
			include_report: false,
			reference: "local-feedback-no-report",
		});
		expect(sink.submissions[0]?.bundle).toBeUndefined();
	});

	it("rejects oversized messages without crashing", async () => {
		const sink = createMemoryFeedbackSink();
		const big = "x".repeat(FEEDBACK_MESSAGE_MAX_BYTES + 1);
		const result = await handleSpellkaveFeedback(
			{ message: big },
			{ invoke: async () => ({ id: 1, ok: true, result: { content: [] } }) },
			{ sink, resolveSeat: () => ({ actorId: "hero_1" }), now: fixedClock() },
		);
		expect(result.isError).toBe(true);
		expect(result.structuredContent).toMatchObject({
			error: { code: "message_too_large", category: "domain" },
		});
		expect(sink.submissions).toHaveLength(0);
	});
});

describe("spellkave_feedback client section (sk-jay0.5.8)", () => {
	function sampleClient(): Record<string, unknown> {
		return {
			trail: [
				{
					kind: "layout",
					id: 1,
					at: 1000,
					tick: 40,
					tile: "table",
					level: "stage",
					trigger: "tap",
				},
				{
					kind: "act",
					id: 2,
					at: 1500,
					tick: 41,
					tool: "spellkave_communicate",
					actionId: "h:12",
					targetRef: "item:7",
					words: "I open the chest.",
					outcome: "You open the chest.",
					durationMs: 240,
				},
			],
			viewport: { width: 1280, height: 720 },
			layout: { table: "stage", place: "card" },
		};
	}

	it("existing calls without a client argument behave exactly as before", async () => {
		const sink = createMemoryFeedbackSink({ idFactory: () => "local-feedback-unchanged" });
		const result = await handleSpellkaveFeedback(
			{ message: "unchanged path", include_report: true },
			{ invoke: async () => ({ id: 1, ok: true, result: { content: [] } }) },
			{
				sink,
				rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 1 }),
				resolveSeat: () => ({ actorId: "hero_1" }),
				now: fixedClock(),
			},
		);
		expect(result.isError).not.toBe(true);
		expect(sink.submissions[0]?.bundle).toBeDefined();
		expect(sink.submissions[0]?.bundle?.client_info).toBeUndefined();
	});

	it("threads a consented client section into bundle.client_info, redacted like the rest of the bundle", async () => {
		const sink = createMemoryFeedbackSink({ idFactory: () => "local-feedback-client" });
		const client = sampleClient();
		// A secret that must never survive into the issue, planted in a field
		// the wire schema allows free text in (`words`) — proves the bundle-wide
		// `redactSensitiveData` pass in must-gather.ts reaches client_info too,
		// not just proving Play's own client-side redaction (belt and suspenders).
		const trailEntry = (client.trail as Record<string, unknown>[])[1];
		if (trailEntry === undefined) throw new Error("sampleClient() trail[1] is missing");
		trailEntry.words = "player@example.com said hi";
		const result = await handleSpellkaveFeedback(
			{ message: "the chest opened fine", include_report: true, client },
			{ invoke: async () => ({ id: 1, ok: true, result: { content: [] } }) },
			{
				sink,
				rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 1 }),
				resolveSeat: () => ({ actorId: "hero_1" }),
				now: fixedClock(),
			},
		);
		expect(result.isError).not.toBe(true);
		const clientInfo = sink.submissions[0]?.bundle?.client_info as
			| {
					viewport?: { width?: number };
					layout?: Record<string, string>;
					trail?: Record<string, unknown>[];
			  }
			| undefined;
		expect(clientInfo).toBeDefined();
		expect(clientInfo?.viewport).toEqual({ width: 1280, height: 720 });
		expect(clientInfo?.layout).toEqual({ table: "stage", place: "card" });
		expect(clientInfo?.trail).toHaveLength(2);
		expect(clientInfo?.trail?.[1]?.words).toBe("[REDACTED_EMAIL] said hi");
		expect(JSON.stringify(clientInfo)).not.toContain("player@example.com");
	});

	it("never attaches the client section when include_report is false, even if one was sent", async () => {
		const sink = createMemoryFeedbackSink();
		const result = await handleSpellkaveFeedback(
			{ message: "no report wanted", include_report: false, client: sampleClient() },
			{ invoke: async () => ({ id: 1, ok: true, result: { content: [] } }) },
			{
				sink,
				rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 1 }),
				resolveSeat: () => ({ actorId: "hero_1" }),
				now: fixedClock(),
			},
		);
		expect(result.isError).not.toBe(true);
		expect(sink.submissions[0]?.bundle).toBeUndefined();
	});

	it("rejects a client section over the byte cap with a text-backed error, without submitting", async () => {
		const sink = createMemoryFeedbackSink();
		const oversized = {
			trail: [
				{
					kind: "tool_error",
					at: 1,
					tick: 1,
					message: "x".repeat(FEEDBACK_CLIENT_SECTION_MAX_BYTES),
				},
			],
		};
		const result = await handleSpellkaveFeedback(
			{ message: "too much", include_report: true, client: oversized },
			{ invoke: async () => ({ id: 1, ok: true, result: { content: [] } }) },
			{
				sink,
				rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 1 }),
				resolveSeat: () => ({ actorId: "hero_1" }),
				now: fixedClock(),
			},
		);
		expect(result.isError).toBe(true);
		expect((result.content[0] as { text?: string } | undefined)?.text).toMatch(
			/client exceeds the .* byte limit/,
		);
		expect(result.structuredContent).toMatchObject({
			error: { code: "client_section_too_large", category: "domain" },
		});
		expect(sink.submissions).toHaveLength(0);
	});

	it("the registered tool's real input schema accepts a realistic client payload (ajv-backed, not just this module's own parse)", async () => {
		const descriptor = playerMcpGatewayToolDescriptors.find(
			(d) => d.name === SPELLKAVE_FEEDBACK_TOOL,
		);
		expect(descriptor).toBeDefined();
		if (descriptor === undefined) return;
		const result = await descriptor.inputSchema["~standard"].validate({
			message: "the chest opened fine",
			category: "bug",
			include_report: true,
			client: sampleClient(),
		});
		expect(result.issues).toBeUndefined();
	});

	it("the registered tool's real input schema rejects an unknown property on the client section", async () => {
		const descriptor = playerMcpGatewayToolDescriptors.find(
			(d) => d.name === SPELLKAVE_FEEDBACK_TOOL,
		);
		expect(descriptor).toBeDefined();
		if (descriptor === undefined) return;
		const result = await descriptor.inputSchema["~standard"].validate({
			message: "hi",
			client: { ...sampleClient(), somethingUnexpected: true },
		});
		expect(result.issues).toBeDefined();
		expect(result.issues?.length).toBeGreaterThan(0);
	});
});

describe("spellkave_feedback rate limit", () => {
	it("returns rate_limited on the 4th call within an hour from the same seat", async () => {
		let t = 1_000_000;
		const sink = createMemoryFeedbackSink();
		const rateLimiter = createInMemoryFeedbackRateLimiter({
			max: 3,
			windowMs: 3_600_000,
			now: () => t,
		});
		const client: PlayerSessionClient = {
			invoke: async () => {
				throw new Error("should not invoke");
			},
		};
		const opts = {
			sink,
			rateLimiter,
			resolveSeat: () => ({ actorId: "seat-A" }),
			now: () => new Date(t),
		};

		for (let i = 0; i < 3; i++) {
			const ok = await handleSpellkaveFeedback(
				{ message: `note ${i}`, include_report: false },
				client,
				opts,
			);
			expect(ok.isError).not.toBe(true);
			t += 1_000;
		}

		const limited = await handleSpellkaveFeedback(
			{ message: "one too many", include_report: false },
			client,
			opts,
		);
		expect(limited.isError).toBe(true);
		expect(limited.structuredContent).toMatchObject({
			error: { code: "rate_limited", category: "domain" },
		});
		expect(sink.submissions).toHaveLength(3);
	});

	it("is handled by createSessionToolHandler without calling the daemon", async () => {
		const sink = createMemoryFeedbackSink({ idFactory: () => "local-via-handler" });
		const invoke = async () => {
			throw new Error("daemon must not see feedback");
		};
		const handler = createSessionToolHandler({ invoke }, undefined, undefined, undefined, {
			sink,
			rateLimiter: createInMemoryFeedbackRateLimiter({ now: () => 42 }),
			resolveSeat: () => ({ actorId: "hero_9" }),
			now: fixedClock(),
		});
		const result = await handler(SPELLKAVE_FEEDBACK_TOOL, {
			message: "handler path works",
			category: "idea",
			include_report: false,
		});
		expect(result.structuredContent).toEqual({
			ok: true,
			reference: "local-via-handler",
			category: "idea",
			include_report: false,
		});
		expect(sink.submissions).toHaveLength(1);
	});
});
