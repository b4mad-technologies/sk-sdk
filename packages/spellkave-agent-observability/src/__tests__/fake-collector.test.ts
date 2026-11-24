import { createServer } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { createRunEmitter } from "../emit.ts";
import { createOtlpHttpSink, OTEL_STREAM_NAME } from "../otel.ts";
import { createOtlpHttpTracer, OTEL_TRACE_STREAM_NAME } from "../traces.ts";

describe("world-actor fake collector smoke", () => {
	it("drains both redacted streams and keeps collector failure non-fatal", async () => {
		const requests: Array<{ path: string; stream: string | undefined; body: string }> = [];
		const server = createServer((request, response) => {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				requests.push({
					path: request.url ?? "",
					stream: request.headers["stream-name"] as string | undefined,
					body: Buffer.concat(chunks).toString("utf8"),
				});
				response.writeHead(200).end();
			});
		});
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		const address = server.address();
		if (address === null || typeof address === "string")
			throw new Error("fake collector has no port");
		const collector = `http://127.0.0.1:${address.port}`;
		const canary = "PRIVATE-SPEECH-AND-FULL-RESULT";
		const logSink = createOtlpHttpSink({ endpoint: `${collector}/v1/logs` });
		const emitter = createRunEmitter(
			{
				run_id: "fake-collector-run",
				run_kind: "mcp_tool_call",
				actor_id: "hero-1",
				role: "PLAYER",
				controller_kind: "llm_player",
				driver: "fake-collector-smoke",
				deterministic: true,
			},
			[logSink],
		);
		emitter.emit("tool_call", {
			tool_name: "spellkave_act",
			correlation_id: "corr-fake-1",
			speech: canary,
			result: { full: canary },
		});
		const tracer = createOtlpHttpTracer({ endpoint: collector });
		tracer
			.startSpan("spellkave.reducer_attempt", {
				"spellkave.actor_id": "hero-1",
				"spellkave.correlation_id": "corr-fake-1",
				private: canary,
			})
			.end("ok");

		await emitter.close();
		await tracer.flush();
		expect(requests.map(({ path, stream }) => ({ path, stream }))).toEqual([
			{ path: "/v1/logs", stream: OTEL_STREAM_NAME },
			{ path: "/v1/traces", stream: OTEL_TRACE_STREAM_NAME },
		]);
		const exported = JSON.stringify(requests);
		expect(exported).toContain("corr-fake-1");
		expect(exported).not.toContain(canary);

		await new Promise<void>((resolve, reject) =>
			server.close((error) => (error === undefined ? resolve() : reject(error))),
		);
		const onError = vi.fn();
		const failedSink = createOtlpHttpSink({ endpoint: `${collector}/v1/logs`, onError });
		const failedEmitter = createRunEmitter(
			{
				run_id: "collector-down-run",
				run_kind: "mcp_tool_call",
				actor_id: "hero-1",
				role: "PLAYER",
				controller_kind: "llm_player",
				driver: "fake-collector-smoke",
			},
			[failedSink],
		);
		const failedTracer = createOtlpHttpTracer({ endpoint: collector, onError });
		expect(() => failedEmitter.emit("run_start")).not.toThrow();
		failedTracer.startSpan("spellkave.reducer_attempt").end("error");
		await expect(failedEmitter.close()).resolves.toBeUndefined();
		await expect(failedTracer.flush()).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledTimes(2);
	});
});
