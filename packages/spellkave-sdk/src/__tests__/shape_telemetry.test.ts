// keep-file(K1): the warn-mode mismatch event shape and its OTLP export
import { describe, expect, it, vi } from "vitest";
import {
	CONTRACT_SHAPE_MISMATCH,
	exportShapeMismatches,
	shapeMismatchEvents,
	shapeMismatchFields,
	shapeTelemetryDriver,
} from "../core/shape_telemetry";

const CHANGE = {
	verdict: "breaking" as const,
	item: "table actor",
	detail: "column 2 changed: name: U32 -> name: String",
};

describe("shape mismatch telemetry", () => {
	const fields = shapeMismatchFields([CHANGE], "elven-mini-1", 1);
	const events = shapeMismatchEvents(fields, {
		runId: "contract-check-x",
		actorId: "42",
		driver: "player-mcp",
		now: new Date("2026-11-17T12:00:00Z"),
	});

	it("is one agent-run-events/v1 service row per mismatch", () => {
		expect(events).toEqual([
			{
				v: "agent-run-events/v1",
				run_id: "contract-check-x",
				run_kind: "contract_check",
				actor_id: "42",
				role: "SERVICE",
				controller_kind: "service",
				driver: "player-mcp",
				seed: "",
				ts: "2026-11-17T12:00:00.000Z",
				type: CONTRACT_SHAPE_MISMATCH,
				data: {
					shape_mode: "warn",
					shape_database: "elven-mini-1",
					shape_item: "table actor",
					shape_detail: "column 2 changed: name: U32 -> name: String",
					client_epoch: 1,
				},
			},
		]);
	});

	it("posts the events to the world-actor OTLP logs endpoint with the logs headers", async () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
		const sent = await exportShapeMismatches(
			events,
			{
				SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT: "https://telemetry.example/v1/logs",
				OTEL_EXPORTER_OTLP_LOGS_HEADERS: "cf-access-client-id=abc",
				OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=prod",
			},
			fetchFn as unknown as typeof fetch,
		);
		expect(sent).toBe(true);
		expect(fetchFn).toHaveBeenCalledOnce();
		const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
		expect(url).toBe("https://telemetry.example/v1/logs");
		expect(new Headers(init.headers).get("cf-access-client-id")).toBe("abc");
		expect(new Headers(init.headers).get("stream-name")).toBe("world_actor_run_events");
		const body = String(init.body);
		for (const field of [
			"contract_shape_mismatch",
			"shape_item",
			"table actor",
			"shape_detail",
			"client_epoch",
			"prod",
		]) {
			expect(body).toContain(field);
		}
	});

	it("sends nothing without an endpoint and never throws", async () => {
		const fetchFn = vi.fn();
		expect(await exportShapeMismatches(events, {}, fetchFn as unknown as typeof fetch)).toBe(false);
		expect(fetchFn).not.toHaveBeenCalled();
		const failing = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
		await expect(
			exportShapeMismatches(
				events,
				{ SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT: "https://x/v1/logs" },
				failing as unknown as typeof fetch,
			),
		).resolves.toBe(true);
	});

	it("names the host as the driver", () => {
		expect(shapeTelemetryDriver({ OTEL_SERVICE_NAME: "spellkave-api" })).toBe("spellkave-api");
		expect(shapeTelemetryDriver({})).toBe("spellkave-sdk");
	});
});
