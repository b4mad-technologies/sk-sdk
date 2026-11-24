import { describe, expect, it, vi } from "vitest";
import { createOtlpHttpTracer, OTEL_TRACE_STREAM_NAME } from "../traces.ts";

describe("OTLP world-actor tracer", () => {
	it("exports structured spans and drains auto-flush requests", async () => {
		let resolveRequest: ((response: Response) => void) | undefined;
		const fetchFn = vi.fn(
			() =>
				new Promise<Response>((resolve) => {
					resolveRequest = resolve;
				}),
		);
		const tracer = createOtlpHttpTracer({
			endpoint: "http://collector:4318",
			batchSize: 1,
			fetchFn: fetchFn as typeof fetch,
			now: () => 42,
		});

		const span = tracer.startSpan("spellkave.reducer_attempt", {
			"spellkave.actor_id": "271",
		});
		span.addEvent("classified", { "spellkave.result_status": "success" });
		span.end("ok");
		const flushing = tracer.flush();
		await vi.waitFor(() => expect(fetchFn).toHaveBeenCalledOnce());
		resolveRequest?.(new Response(null, { status: 200 }));
		await flushing;

		const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe("http://collector:4318/v1/traces");
		expect(new Headers(init.headers).get("stream-name")).toBe(OTEL_TRACE_STREAM_NAME);
		const payload = JSON.parse(String(init.body));
		const exported = payload.resourceSpans[0].scopeSpans[0].spans[0];
		expect(exported.name).toBe("spellkave.reducer_attempt");
		expect(exported.status.code).toBe(1);
		expect(exported.events[0].name).toBe("classified");
	});

	// sk-jay0.6.15.56.21: a request that never settles must not hold flush open.
	it("aborts a hung export after requestTimeoutMs so flush settles", async () => {
		vi.useFakeTimers();
		try {
			const onError = vi.fn();
			const tracer = createOtlpHttpTracer({
				endpoint: "http://collector:4318",
				batchSize: 1,
				requestTimeoutMs: 50,
				fetchFn: ((_url: string, init: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init.signal?.addEventListener("abort", () =>
							reject(new DOMException("This operation was aborted", "AbortError")),
						);
					})) as typeof fetch,
				onError,
			});
			tracer.startSpan("spellkave.reducer_attempt").end("ok");
			const flushing = tracer.flush();
			await vi.advanceTimersByTimeAsync(60);
			await flushing;
			expect(onError).toHaveBeenCalled();
			expect(String(onError.mock.calls[0]?.[0])).toContain("AbortError");
		} finally {
			vi.useRealTimers();
		}
	});

	it("never throws transport failures into gameplay", async () => {
		const onError = vi.fn();
		const tracer = createOtlpHttpTracer({
			endpoint: "http://collector:4318",
			fetchFn: (() => Promise.reject(new Error("offline"))) as typeof fetch,
			onError,
		});
		tracer.startSpan("attempt").end("error");
		await expect(tracer.flush()).resolves.toBeUndefined();
		expect(onError).toHaveBeenCalledOnce();
	});

	it("keeps a rejected Aldwin follow-up diagnosable without exporting speech or full results", async () => {
		const requests: RequestInit[] = [];
		const speechCanary = "Aldwin says the private confirmation aloud";
		const resultCanary = "FULL-REDUCER-RESULT-CANARY";
		const tracer = createOtlpHttpTracer({
			endpoint: "http://collector:4318",
			fetchFn: (async (_url: string, init: RequestInit) => {
				requests.push(init);
				return new Response(null, { status: 200 });
			}) as typeof fetch,
			resourceAttributes: { "spellkave.world_slug": "elven-mini", private: speechCanary },
		});
		const span = tracer.startSpan("spellkave.reducer_attempt", {
			"spellkave.actor_id": "aldwin",
			"spellkave.cause_kind": "visible_trace",
			"spellkave.cause_id": "trace-character-confirmed-7",
			"spellkave.action_id": "equip-creation-longsword",
			private: speechCanary,
		});
		span.addEvent("provenance_observed", {
			"spellkave.provenance_id": "prov-7",
			"spellkave.failure_class": "missing_equipment_slot",
			"spellkave.failure_detail": resultCanary,
			result: resultCanary,
		});
		span.end("error");
		await tracer.flush();
		const serialized = JSON.stringify(requests);
		expect(serialized).toContain("trace-character-confirmed-7");
		expect(serialized).toContain("equip-creation-longsword");
		expect(serialized).toContain("missing_equipment_slot");
		expect(serialized).not.toContain(speechCanary);
		expect(serialized).not.toContain(resultCanary);
		expect(serialized).not.toContain("failure_detail");
	});
});
