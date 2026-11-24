import { afterEach, describe, expect, it, vi } from "vitest";

import { createRunEmitter } from "../emit.ts";
import { createWorldActorMetricsFromEnv } from "../node-metrics.ts";
import { logSinkResourceAttributesFromEnv } from "../node-resource.ts";
import { createWorldActorTracerFromEnv } from "../node-traces.ts";
import { createOtlpHttpSink } from "../otel.ts";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("Node world-actor exporter bootstrap", () => {
	it("uses the host world slug for metric and trace resources", async () => {
		const requests: Array<{ url: string; body: string }> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				requests.push({ url, body: String(init.body) });
				return new Response(null, { status: 200 });
			}),
		);
		const env = {
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.local:4318",
			OTEL_RESOURCE_ATTRIBUTES:
				"deployment.environment.name=production,spellkave.world_slug=wrong-world",
			SPELLKAVE_WORLD_SLUG: " elven-mini-1 ",
		};

		const metrics = createWorldActorMetricsFromEnv(env, {
			allowedToolNames: ["spellkave_scene"],
		});
		const tracer = createWorldActorTracerFromEnv(env);
		if (metrics === undefined || tracer === undefined) throw new Error("exporters disabled");
		metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 4, status: "ok" });
		tracer.startSpan("spellkave.reducer_attempt").end("ok");
		await Promise.all([metrics.flush(), tracer.flush()]);

		expect(requests.map(({ url }) => url).sort()).toEqual([
			"http://collector.local:4318/v1/metrics",
			"http://collector.local:4318/v1/traces",
		]);
		for (const request of requests) {
			expect(request.body).toContain("spellkave.world_slug");
			expect(request.body).toContain("elven-mini-1");
			expect(request.body).not.toContain("wrong-world");
		}
	});

	it("stamps service.version from SPELLKAVE_IMAGE_TAG on metric and trace resources (sk-0m4.120.13)", async () => {
		const requests: Array<{ url: string; body: string }> = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (url: string, init: RequestInit) => {
				requests.push({ url, body: String(init.body) });
				return new Response(null, { status: 200 });
			}),
		);
		const env = {
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.local:4318",
			SPELLKAVE_WORLD_SLUG: "elven-mini-1",
			SPELLKAVE_IMAGE_TAG: " sha-919f9ae5 ",
		};
		const metrics = createWorldActorMetricsFromEnv(env, {
			allowedToolNames: ["spellkave_scene"],
		});
		const tracer = createWorldActorTracerFromEnv(env);
		if (metrics === undefined || tracer === undefined) throw new Error("exporters disabled");
		metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 4, status: "ok" });
		tracer.startSpan("spellkave.reducer_attempt").end("ok");
		await Promise.all([metrics.flush(), tracer.flush()]);
		expect(requests).toHaveLength(2);
		for (const request of requests) {
			expect(request.body).toContain("service.version");
			expect(request.body).toContain("sha-919f9ae5");
		}
		// No tag declared (local dev): no placeholder version is invented.
		const { serviceVersionFromEnv, worldActorResourceAttributes } = await import(
			"../node-resource.ts"
		);
		expect(serviceVersionFromEnv({})).toBeUndefined();
		expect(serviceVersionFromEnv({ SPELLKAVE_IMAGE_TAG: "" })).toBeUndefined();
		expect(worldActorResourceAttributes({})).not.toHaveProperty("service.version");
	});

	it("lets a host override service.name via dimensions", async () => {
		const bodies: string[] = [];
		vi.stubGlobal(
			"fetch",
			vi.fn(async (_url: string, init: RequestInit) => {
				bodies.push(String(init.body));
				return new Response(null, { status: 200 });
			}),
		);
		const metrics = createWorldActorMetricsFromEnv(
			{ OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.local:4318" },
			{ serviceName: "spellkave-session-daemon" },
		);
		if (metrics === undefined) throw new Error("exporters disabled");
		metrics.recordExporterHeartbeat?.();
		await metrics.flush();
		expect(bodies[0]).toContain("spellkave-session-daemon");
	});

	it("carries deployment.environment from OTEL_RESOURCE_ATTRIBUTES to logs, traces and metrics (sk-jay0.6.38.13)", async () => {
		const requests: Array<{ url: string; body: string }> = [];
		const fetchFn = vi.fn(async (url: string, init: RequestInit) => {
			requests.push({ url, body: String(init.body) });
			return new Response(null, { status: 200 });
		});
		vi.stubGlobal("fetch", fetchFn);
		const env = {
			OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.local:4318",
			OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=local-x",
			SPELLKAVE_WORLD_SLUG: "elven-mini-1",
		};

		const metrics = createWorldActorMetricsFromEnv(env, { allowedToolNames: ["spellkave_scene"] });
		const tracer = createWorldActorTracerFromEnv(env);
		if (metrics === undefined || tracer === undefined) throw new Error("exporters disabled");
		metrics.recordRequest({ toolName: "spellkave_scene", durationMs: 4, status: "ok" });
		tracer.startSpan("spellkave.reducer_attempt").end("ok");

		const logsSink = createOtlpHttpSink({
			endpoint: "http://collector.local:4318/v1/logs",
			fetchFn: fetchFn as unknown as typeof fetch,
			resourceAttributes: logSinkResourceAttributesFromEnv(env),
		});
		const emitter = createRunEmitter(
			{
				run_id: "run-deployment-env",
				run_kind: "combat_beat",
				actor_id: "phandelver/goblin-horde",
				role: "PLAYER",
				controller_kind: "deterministic_npc",
				driver: "npc-fleet",
			},
			[logsSink],
		);
		emitter.emit("run_start");
		await Promise.all([metrics.flush(), tracer.flush(), logsSink.close?.()]);

		expect(requests).toHaveLength(3);
		for (const request of requests) {
			expect(request.body).toContain("deployment.environment");
			expect(request.body).toContain("local-x");
		}
	});
});
