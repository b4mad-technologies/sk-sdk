// OTLP/HTTP projection sink coverage (ADR-0074 S5): world-actor resource
// names on every payload, stream header pinned to the world-actor stream,
// delivery failures never reach the emitting run.
import { describe, expect, it } from "vitest";
import { createRunEmitter } from "../emit.ts";
import {
	createOtlpHttpSink,
	OTEL_DECISION_INPUT_FIELDS,
	OTEL_SAFE_EVENT_DATA_FIELDS,
	OTEL_SERVICE_NAME,
	OTEL_STREAM_NAME,
	projectSafeEventData,
	toOtlpLogRecord,
	toOtlpPayload,
} from "../otel.ts";

function emitterOver(sink: ReturnType<typeof createOtlpHttpSink>) {
	return createRunEmitter(
		{
			run_id: "run-otel",
			run_kind: "combat_beat",
			actor_id: "phandelver/goblin-horde",
			role: "PLAYER",
			controller_kind: "deterministic_npc",
			driver: "npc-fleet",
			now: () => new Date("2026-07-15T12:00:00.000Z"),
		},
		[sink],
	);
}

describe("createOtlpHttpSink", () => {
	it("posts OTLP payloads with world-actor resource names, never ADR-0030 streams", async () => {
		const calls: Array<{ url: string; init: RequestInit }> = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			headers: { authorization: "Basic x", "stream-name": "coding_agent_events" },
			fetchFn: (async (url: string, init: RequestInit) => {
				calls.push({ url, init });
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});
		emitterOver(sink).emit("tool_call", { tool_name: "npc/manipulate" });
		expect(calls).toHaveLength(1);
		const call = calls[0];
		expect(call?.url).toBe("http://collector.local/v1/logs");
		// A caller-supplied ADR-0030 stream header is REPLACED — binding rule.
		expect((call?.init.headers as Headers).get("stream-name")).toBe(OTEL_STREAM_NAME);
		const payload = JSON.parse(call?.init.body as string) as {
			resourceLogs: Array<{
				resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
				scopeLogs: Array<{ logRecords: Array<Record<string, unknown>> }>;
			}>;
		};
		const attrs = payload.resourceLogs[0]?.resource.attributes ?? [];
		expect(attrs.find((a) => a.key === "service.name")?.value.stringValue).toBe(OTEL_SERVICE_NAME);
		expect(payload.resourceLogs[0]?.scopeLogs[0]?.logRecords).toHaveLength(1);
	});

	it("a MIXED-CASE caller stream header cannot smuggle an ADR-0030 stream", () => {
		const calls: Array<{ init: RequestInit }> = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			// Fetch treats header names case-insensitively — `Stream-Name` and
			// `stream-name` are the SAME header; the sink must replace it, not
			// merge with it.
			headers: { "Stream-Name": "coding_agent_events" },
			fetchFn: (async (_url: string, init: RequestInit) => {
				calls.push({ init });
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});
		emitterOver(sink).emit("run_start");
		const headers = calls[0]?.init.headers as Headers;
		expect(headers.get("stream-name")).toBe(OTEL_STREAM_NAME);
		expect(headers.get("Stream-Name")).toBe(OTEL_STREAM_NAME);
	});

	it("a failing transport never throws into the emitting run", () => {
		const errors: unknown[] = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			fetchFn: (async () => {
				throw new Error("collector down");
			}) as typeof fetch,
			onError: (error) => errors.push(error),
		});
		expect(() => emitterOver(sink).emit("run_start")).not.toThrow();
	});

	it("close() drains pending posts before returning", async () => {
		let resolvePost: (() => void) | undefined;
		const delivered: string[] = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			fetchFn: (async () => {
				await new Promise<void>((resolve) => {
					resolvePost = () => {
						delivered.push("posted");
						resolve();
					};
				});
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});
		emitterOver(sink).emit("run_start");
		const closed = sink.close?.();
		// The POST hasn't settled yet — close() must be waiting on it, not on a
		// resolved-by-default promise.
		expect(delivered).toEqual([]);
		resolvePost?.();
		await closed;
		expect(delivered).toEqual(["posted"]);
	});

	it("a non-2xx response is treated as a delivery error, not a silent drop", async () => {
		const errors: unknown[] = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			fetchFn: (async () =>
				new Response(null, { status: 500, statusText: "Internal Server Error" })) as typeof fetch,
			onError: (error) => errors.push(error),
		});
		emitterOver(sink).emit("run_start");
		await sink.close?.();
		expect(errors).toHaveLength(1);
		expect(String(errors[0])).toMatch(/500/);
	});

	it("write() never throws, even when fetchFn throws synchronously (not just a rejected promise)", () => {
		const errors: unknown[] = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			fetchFn: (() => {
				throw new Error("network unreachable");
			}) as unknown as typeof fetch,
			onError: (error) => errors.push(error),
		});
		expect(() => emitterOver(sink).emit("run_start")).not.toThrow();
		expect(errors).toHaveLength(1);
	});

	it("log records carry the envelope and only allowlisted scalar event data", () => {
		const record = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "r",
			run_kind: "combat_beat",
			actor_id: "a",
			role: "PLAYER",
			controller_kind: "deterministic_npc",
			driver: "npc-fleet",
			seed: "",
			ts: "2026-07-15T12:00:00.000Z",
			type: "tool_call",
			data: { tool_name: "npc/move" },
		});
		const attrs = record.attributes as Array<{ key: string }>;
		expect(attrs.map((a) => a.key)).toContain("controller_kind");
		expect(attrs.map((a) => a.key)).toContain("event_ts");
		expect(attrs.map((a) => a.key)).toContain("spellkave.tool_name");
		expect(JSON.parse((record.body as { stringValue: string }).stringValue)).toEqual({
			type: "tool_call",
			data: { tool_name: "npc/move" },
		});
		expect(toOtlpPayload([record])).toHaveProperty("resourceLogs");
	});

	it("stamps service.version from serviceVersion and omits it when unknown (sk-0m4.120.13)", () => {
		const calls: Array<{ init: RequestInit }> = [];
		const fetchFn = (async (_url: string, init: RequestInit) => {
			calls.push({ init });
			return new Response(null, { status: 200 });
		}) as typeof fetch;
		const stamped = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			fetchFn,
			serviceVersion: "sha-919f9ae5",
		});
		const bare = createOtlpHttpSink({ endpoint: "http://collector.local/v1/logs", fetchFn });
		emitterOver(stamped).emit("run_start");
		emitterOver(bare).emit("run_start");
		type Payload = {
			resourceLogs: Array<{
				resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
			}>;
		};
		const attrsOf = (index: number) =>
			(JSON.parse(calls[index]?.init.body as string) as Payload).resourceLogs[0]?.resource
				.attributes ?? [];
		expect(attrsOf(0).find((a) => a.key === "service.version")?.value.stringValue).toBe(
			"sha-919f9ae5",
		);
		expect(attrsOf(1).some((a) => a.key === "service.version")).toBe(false);
		// The empty string is "unknown", not a version.
		expect(JSON.stringify(toOtlpPayload([], { serviceVersion: "  " }))).not.toContain(
			"service.version",
		);
	});

	it("stamps deployment.environment resource attributes and drops unlisted keys (sk-jay0.6.38.13)", () => {
		type Payload = {
			resourceLogs: Array<{
				resource: { attributes: Array<{ key: string; value: { stringValue: string } }> };
			}>;
		};
		const attrsOf = (payload: unknown) =>
			(payload as Payload).resourceLogs[0]?.resource.attributes ?? [];

		const withEnvironment = toOtlpPayload([], {
			resourceAttributes: { "deployment.environment": "local-example" },
		});
		expect(attrsOf(withEnvironment)).toContainEqual({
			key: "deployment.environment",
			value: { stringValue: "local-example" },
		});

		const withoutAttribute = toOtlpPayload([]);
		expect(attrsOf(withoutAttribute).some((a) => a.key === "deployment.environment")).toBe(false);

		// An unlisted key (not on `OTLP_LOG_SAFE_RESOURCE_ATTRIBUTE_KEYS`) never
		// reaches the wire, even when a caller supplies it.
		const withDisallowedKey = toOtlpPayload([], {
			resourceAttributes: { "k8s.pod.name": "otel-sink-abc123" },
		});
		expect(attrsOf(withDisallowedKey).some((a) => a.key === "k8s.pod.name")).toBe(false);
	});

	// sk-0m4.120.42: the affordance listing counts reach OTLP as scalars; the
	// `observation` / items that carried them stay behind the disclosure boundary.
	it("projects affordance listing counts (sk-0m4.120.42)", () => {
		const record = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "mcp-corr-2",
			run_kind: "mcp_tool_call",
			actor_id: "42",
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: "remote-mcp",
			seed: "",
			ts: "2026-08-29T16:48:00.000Z",
			type: "tool_call",
			data: {
				tool_name: "spellkave_affordance_targets",
				is_error: false,
				duration_ms: 12,
				total_rows: 132,
				matched: 57,
				shown: 20,
				truncated: true,
				observation: { items: [{ handle: "h1", display_name: "Pick up lantern" }] },
				items: [{ handle: "h1" }],
			},
		});
		const body = JSON.parse((record.body as { stringValue: string }).stringValue) as {
			data: Record<string, unknown>;
		};
		expect(body.data).toEqual({
			tool_name: "spellkave_affordance_targets",
			is_error: false,
			duration_ms: 12,
			total_rows: 132,
			matched: 57,
			shown: 20,
			truncated: true,
		});
		expect(JSON.stringify(record)).not.toContain("Pick up lantern");
	});

	it("projects act receipt, HTTP edge, and lifecycle scalars (sk-0m4.120.10/.11/.12)", () => {
		const record = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "mcp-corr-1",
			run_kind: "mcp_tool_call",
			actor_id: "42",
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: "remote-mcp",
			seed: "",
			ts: "2026-08-28T10:33:00.000Z",
			type: "tool_call",
			data: {
				tool_name: "spellkave_act_affordance",
				action_id: "core/speech/say",
				target_ref: "entity:7",
				result_status: "success",
				outcome: "accepted",
				awaiting_response: false,
				error_code: "session_invoke_timeout",
				error_class: "RangeError",
				http_status: 504,
				http_method: "POST",
				route: "/mcp",
				cf_ray: "a322a7c029111eca",
				image_tag: "sha-919f9ae5",
				spawned: true,
				cause: "ECONNREFUSED",
				reason: "world_connection_lost",
				// Content-bearing neighbours of those keys must still be dropped.
				utterance: "hello there",
				observation: "You say hello",
				conversation: { response: { text: "hi" } },
				url: "https://mcp.spellkave.com/mcp?token=x",
			},
		});
		const body = JSON.parse((record.body as { stringValue: string }).stringValue) as {
			data: Record<string, unknown>;
		};
		expect(body.data).toEqual({
			tool_name: "spellkave_act_affordance",
			action_id: "core/speech/say",
			target_ref: "entity:7",
			result_status: "success",
			error_code: "session_invoke_timeout",
			error_class: "RangeError",
			outcome: "accepted",
			awaiting_response: false,
			http_status: 504,
			http_method: "POST",
			route: "/mcp",
			cf_ray: "a322a7c029111eca",
			image_tag: "sha-919f9ae5",
			spawned: true,
			cause: "ECONNREFUSED",
			reason: "world_connection_lost",
		});
		const serialized = JSON.stringify(record);
		for (const leak of ["hello there", "You say hello", "token=x", "conversation"]) {
			expect(serialized).not.toContain(leak);
		}
	});

	it("projects world_lifecycle fields — five new plus seven reused — and drops an unlisted one (sk-jay0.6.38.2)", () => {
		const record = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "load.kavemouth-3.1756800000000",
			run_kind: "world_observation",
			actor_id: "api",
			role: "ADMIN",
			controller_kind: "service",
			driver: "spellkave-api",
			seed: "",
			ts: "2026-09-02T20:14:14.000Z",
			type: "world_lifecycle",
			data: {
				// The five new disclosure-boundary fields.
				phase: "world_ready",
				job_id: "load.kavemouth-3.1756800000000",
				job_kind: "load",
				boot_ms: 150000,
				artifact_digest: "sha256:abc123",
				// Seven already-allowlisted fields, reused here.
				outcome: "ok",
				world_slug: "kavemouth-3",
				duration_ms: 27000,
				image_tag: "sha-018bfb5a",
				failure_class: "binding_drift",
				error_class: "BindingDriftError",
				error_code: "CrashLoopBackOff",
				// Not on the allowlist — must be dropped, not renamed or blobbed.
				artifact_ref: "registry.example/kavemouth-3:latest",
			},
		});
		const body = JSON.parse((record.body as { stringValue: string }).stringValue) as {
			data: Record<string, unknown>;
		};
		expect(body.data).toEqual({
			phase: "world_ready",
			job_id: "load.kavemouth-3.1756800000000",
			job_kind: "load",
			boot_ms: 150000,
			artifact_digest: "sha256:abc123",
			outcome: "ok",
			world_slug: "kavemouth-3",
			duration_ms: 27000,
			image_tag: "sha-018bfb5a",
			failure_class: "binding_drift",
			error_class: "BindingDriftError",
			error_code: "CrashLoopBackOff",
		});
		expect(JSON.stringify(record)).not.toContain("artifact_ref");
	});

	it("projects player_feedback join keys (reference + bundle hash) and drops the body", () => {
		const canary = "SECRET-MUST-GATHER-BODY";
		const record = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "mcp-corr-fb",
			run_kind: "mcp_tool_call",
			actor_id: "hero_42",
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: "remote-mcp",
			seed: "",
			ts: "2026-07-15T12:00:00.000Z",
			type: "player_feedback",
			data: {
				reference: "https://github.com/example/spellkave/issues/9999",
				category: "bug",
				message_chars: 42,
				bundle_sha256: "b".repeat(64),
				world_slug: "kavemouth",
				// Mistaken body leak must be stripped at the OTLP boundary.
				bundle: { v: "spellkave-must-gather/v1", notes: canary },
				message: canary,
			},
		});
		const serialized = JSON.stringify(record);
		expect(serialized).not.toContain(canary);
		expect(serialized).toContain("spellkave.reference");
		expect(serialized).toContain("spellkave.bundle_sha256");
		expect(JSON.parse((record.body as { stringValue: string }).stringValue)).toEqual({
			type: "player_feedback",
			data: {
				reference: "https://github.com/example/spellkave/issues/9999",
				category: "bug",
				message_chars: 42,
				bundle_sha256: "b".repeat(64),
				world_slug: "kavemouth",
			},
		});
	});

	it("drops private, unknown, nested, and non-finite event data from payloads", () => {
		const canary = "SECRET-CANARY-DO-NOT-EXPORT";
		const record = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "r",
			run_kind: "combat_beat",
			actor_id: "a",
			role: "PLAYER",
			controller_kind: "deterministic_npc",
			driver: "npc-fleet",
			seed: "",
			ts: "2026-07-15T12:00:00.000Z",
			type: "tool_call",
			data: {
				tool_name: "npc/manipulate",
				cause_kind: "visible_trace",
				cause_id: "trace-character-confirmed-7",
				duration_ms: 12,
				is_error: true,
				correlation_id: "corr-1",
				world_slug: "kavemouth-1",
				subject_prefix: "abcdef0123456789",
				args: { token: canary },
				speech: canary,
				reasoning: canary,
				observation: { result: canary },
				result: canary,
				error: canary,
				summary: canary,
				unknown: canary,
				poll_count: Number.POSITIVE_INFINITY,
			},
		});
		const serialized = JSON.stringify(record);
		expect(serialized).not.toContain(canary);
		const body = JSON.parse((record.body as { stringValue: string }).stringValue);
		expect(body.data).toEqual({
			tool_name: "npc/manipulate",
			is_error: true,
			duration_ms: 12,
			correlation_id: "corr-1",
			world_slug: "kavemouth-1",
			subject_prefix: "abcdef0123456789",
			cause_kind: "visible_trace",
			cause_id: "trace-character-confirmed-7",
		});
	});

	it("projects a hashed subject_prefix and refuses a raw OAuth subject", () => {
		const rawSubject = "user_oauth_sub_must_not_leak";
		const hashed = "a1b2c3d4e5f60718";
		const admitted = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "r",
			run_kind: "mcp_tool_call",
			actor_id: "hero",
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: "remote-mcp",
			seed: "",
			ts: "2026-07-15T12:00:00.000Z",
			type: "tool_call",
			data: {
				tool_name: "spellkave_scene",
				world_slug: "kavemouth-1",
				subject_prefix: hashed,
			},
		});
		const admittedBody = JSON.parse((admitted.body as { stringValue: string }).stringValue);
		expect(admittedBody.data.subject_prefix).toBe(hashed);
		expect(JSON.stringify(admitted)).toContain("spellkave.subject_prefix");

		const refused = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "r",
			run_kind: "mcp_tool_call",
			actor_id: "hero",
			role: "PLAYER",
			controller_kind: "llm_player",
			driver: "remote-mcp",
			seed: "",
			ts: "2026-07-15T12:00:00.000Z",
			type: "tool_call",
			data: {
				// Mistaken raw-sub stamp: OTLP boundary must drop it.
				subject_prefix: rawSubject,
				subject: rawSubject,
			},
		});
		const refusedSerialized = JSON.stringify(refused);
		expect(refusedSerialized).not.toContain(rawSubject);
		const refusedBody = JSON.parse((refused.body as { stringValue: string }).stringValue);
		expect(refusedBody.data.subject_prefix).toBeUndefined();
		expect(refusedBody.data.subject).toBeUndefined();
	});

	it("never derives request headers from event content", () => {
		const calls: RequestInit[] = [];
		const sink = createOtlpHttpSink({
			endpoint: "http://collector.local/v1/logs",
			fetchFn: (async (_url: string, init: RequestInit) => {
				calls.push(init);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
		});
		emitterOver(sink).emit("tool_call", {
			tool_name: "npc/manipulate",
			authorization: "SECRET-CANARY-DO-NOT-EXPORT",
			"stream-name": "coding_agent_events",
		});
		const headers = new Headers(calls[0]?.headers);
		expect(headers.get("authorization")).toBeNull();
		expect(headers.get("stream-name")).toBe(OTEL_STREAM_NAME);
	});
});

describe("decision-input disclosure (ADR-0114 D-2 option A)", () => {
	it("drops intent.utterance on brain_decision (ADR-0114 D-4a)", () => {
		const canary = "Well met, Caelen Thorne.";
		expect(OTEL_SAFE_EVENT_DATA_FIELDS).not.toContain("utterance");
		expect(OTEL_SAFE_EVENT_DATA_FIELDS).not.toContain("intent");
		const record = toOtlpLogRecord({
			v: "agent-run-events/v1",
			run_id: "npc-host-kavemouth-1-aldwin_1",
			run_kind: "world_observation",
			actor_id: "kavemouth/adventure/npc/aldwin_1",
			role: "NPC",
			controller_kind: "deterministic_npc",
			driver: "srd-cc-npc-host-kavemouth",
			seed: "",
			ts: "2026-08-30T18:00:00.000Z",
			type: "brain_decision",
			data: {
				rule: "speak/name-readback",
				intendedRule: "speak/name-readback",
				viewKind: "turn",
				intent: { kind: "act_affordance", utterance: canary },
				utterance: canary,
				reasoning: {
					rule: "speak/name-readback",
					summary: canary,
				},
			},
		});
		const serialized = JSON.stringify(record);
		expect(serialized).not.toContain(canary);
		expect(serialized).not.toContain("utterance");
		const body = JSON.parse((record.body as { stringValue: string }).stringValue) as {
			data: Record<string, unknown>;
		};
		expect(body.data.rule).toBe("speak/name-readback");
		expect(body.data.intendedRule).toBe("speak/name-readback");
		expect(body.data).not.toHaveProperty("utterance");
		expect(body.data).not.toHaveProperty("intent");
	});
	it("projects an admitted input key as a scalar, not a blob", () => {
		const projected = projectSafeEventData({
			rule: "wait/not-addressed",
			intendedRule: "speak/offer-level-up",
			retryCount: 3,
			myTurn: false,
		});
		expect(projected.rule).toBe("wait/not-addressed");
		expect(projected.intendedRule).toBe("speak/offer-level-up");
		expect(projected.retryCount).toBe(3);
		expect(projected.myTurn).toBe(false);
		expect(typeof projected.intendedRule).toBe("string");
	});

	it("projects Aldwin wait-branch input names as scalars (sk-jay0.6.31.17)", () => {
		const projected = projectSafeEventData({
			rule: "wait/no-level-earned-yet",
			levelBand: 1,
			offerPresent: false,
			applyPresent: false,
			advancementLive: false,
			heardQuestion: false,
			speakable: true,
		});
		expect(projected.levelBand).toBe(1);
		expect(projected.offerPresent).toBe(false);
		expect(projected.applyPresent).toBe(false);
		expect(projected.advancementLive).toBe(false);
		expect(projected.heardQuestion).toBe(false);
		expect(projected.speakable).toBe(true);
		for (const key of [
			"levelBand",
			"offerPresent",
			"applyPresent",
			"advancementLive",
			"heardQuestion",
			"speakable",
		] as const) {
			expect(OTEL_DECISION_INPUT_FIELDS).toContain(key);
		}
		expect(OTEL_DECISION_INPUT_FIELDS).toHaveLength(17);
		expect(OTEL_DECISION_INPUT_FIELDS.length).toBeLessThanOrEqual(25);
	});

	it("DROPS an input key absent from the allowlist — not renamed, not blobbed", () => {
		// closedForLevel / offeredForLevel still live only under reasoning.state
		// (not in the emitted inputs map). They must not leak, be renamed, or
		// be stuffed into a blob (the accepted cost of option A).
		const unlisted = {
			closedForLevel: 1,
			offeredForLevel: 1,
		};
		const blob = JSON.stringify(unlisted);
		const projected = projectSafeEventData({
			rule: "wait/no-level-earned-yet",
			intendedRule: "speak/offer-level-up",
			levelBand: 1,
			...unlisted,
			inputs: blob,
			guards: blob,
		});
		expect(projected.intendedRule).toBe("speak/offer-level-up");
		expect(projected.levelBand).toBe(1);
		expect(projected).not.toHaveProperty("closedForLevel");
		expect(projected).not.toHaveProperty("offeredForLevel");
		expect(projected).not.toHaveProperty("inputs");
		expect(projected).not.toHaveProperty("guards");
		const serialized = JSON.stringify(projected);
		expect(serialized).not.toContain("closedForLevel");
		expect(serialized).not.toContain("offeredForLevel");
		expect(serialized).not.toContain(blob);
		expect(Object.keys(projected).sort()).toEqual(["intendedRule", "levelBand", "rule"]);
		expect(OTEL_DECISION_INPUT_FIELDS).toContain("intendedRule");
		expect(OTEL_DECISION_INPUT_FIELDS).not.toContain("closedForLevel");
		expect(OTEL_DECISION_INPUT_FIELDS).not.toContain("offeredForLevel");
	});
});
