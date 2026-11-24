import { describe, expect, it } from "vitest";

import {
	encodeFrame,
	isErrResponse,
	isOkResponse,
	isRequest,
	isResponse,
	JsonlFrameDecoder,
	PROTOCOL_VERSION,
	requestId,
} from "../../spellkave-session/src/node/protocol.ts";

describe("isRequest", () => {
	it("accepts the control ops", () => {
		expect(isRequest({ id: 1, op: "hello" })).toBe(true);
		expect(isRequest({ id: 2, op: "status" })).toBe(true);
		expect(isRequest({ id: 3, op: "shutdown" })).toBe(true);
		expect(isRequest({ id: 6, op: "drain_pushes" })).toBe(true);
	});

	it("accepts invoke with a tool name and args", () => {
		expect(isRequest({ id: 4, op: "invoke", tool: "spellkave_scene", args: {} })).toBe(true);
		expect(
			isRequest({
				id: 4,
				op: "invoke",
				tool: "spellkave_scene",
				args: {},
				causal_context: { correlation_id: "corr-1", world_slug: "elven-mini" },
			}),
		).toBe(true);
	});

	it("rejects invoke missing a tool name or args", () => {
		expect(isRequest({ id: 5, op: "invoke", args: {} })).toBe(false);
		expect(isRequest({ id: 5, op: "invoke", tool: "" })).toBe(false);
		expect(isRequest({ id: 5, op: "invoke", tool: "spellkave_scene" })).toBe(false);
		expect(
			isRequest({
				id: 5,
				op: "invoke",
				tool: "spellkave_scene",
				args: {},
				causal_context: { token: "not-admitted" },
			}),
		).toBe(false);
	});

	it("rejects malformed frames", () => {
		expect(isRequest(null)).toBe(false);
		expect(isRequest([])).toBe(false);
		expect(isRequest("hello")).toBe(false);
		expect(isRequest({ op: "hello" })).toBe(false);
		expect(isRequest({ id: "1", op: "hello" })).toBe(false);
		expect(isRequest({ id: 1, op: "unknown-op" })).toBe(false);
	});
});

describe("requestId", () => {
	it("extracts a numeric id even from an otherwise-malformed frame", () => {
		expect(requestId({ id: 7, op: "bogus" })).toBe(7);
	});

	it("returns undefined when no numeric id is present", () => {
		expect(requestId({})).toBeUndefined();
		expect(requestId(null)).toBeUndefined();
		expect(requestId({ id: "not-a-number" })).toBeUndefined();
	});
});

describe("response type guards", () => {
	it("recognizes ok and err responses", () => {
		expect(isOkResponse({ id: 1, ok: true, result: {} })).toBe(true);
		expect(isErrResponse({ id: 1, ok: false, error: { message: "boom" } })).toBe(true);
		expect(isResponse({ id: 1, ok: true, result: null })).toBe(true);
		expect(isResponse({ id: 1, ok: false, error: { message: "x" } })).toBe(true);
		expect(
			isOkResponse({
				id: 1,
				ok: true,
				result: {},
				pushes: [{ kind: "dealt_hit", target_name: "Slime Scout", amount: 3 }],
			}),
		).toBe(true);
	});

	it("rejects a response missing its result/error payload", () => {
		expect(isOkResponse({ id: 1, ok: true })).toBe(false);
		expect(isErrResponse({ id: 1, ok: false })).toBe(false);
		expect(isErrResponse({ id: 1, ok: false, error: {} })).toBe(false);
		expect(isResponse({ id: 1 })).toBe(false);
	});
});

describe("JsonlFrameDecoder + encodeFrame roundtrip", () => {
	it("decodes one frame per line, even split across chunk boundaries", () => {
		const decoder = new JsonlFrameDecoder();
		const encoded = encodeFrame({ id: 1, ok: true, result: { protocol: PROTOCOL_VERSION } });
		const splitAt = 5;
		expect(decoder.push(encoded.slice(0, splitAt))).toEqual([]);
		expect(decoder.push(encoded.slice(splitAt))).toEqual([
			{ id: 1, ok: true, result: { protocol: PROTOCOL_VERSION } },
		]);
	});

	it("decodes multiple frames delivered in one chunk", () => {
		const decoder = new JsonlFrameDecoder();
		const chunk = encodeFrame({ id: 1, op: "hello" }) + encodeFrame({ id: 2, op: "status" });
		expect(decoder.push(chunk)).toEqual([
			{ id: 1, op: "hello" },
			{ id: 2, op: "status" },
		]);
	});

	it("skips blank lines", () => {
		const decoder = new JsonlFrameDecoder();
		expect(decoder.push(`\n\n${encodeFrame({ id: 1, op: "hello" })}`)).toEqual([
			{ id: 1, op: "hello" },
		]);
	});

	it("round-trips an error frame", () => {
		const decoder = new JsonlFrameDecoder();
		const errFrame = {
			id: 9,
			ok: false,
			error: { message: "unknown tool spellkave_bogus", code: "unknown_tool" },
		};
		const [decoded] = decoder.push(encodeFrame(errFrame));
		expect(decoded).toEqual(errFrame);
		expect(isErrResponse(decoded)).toBe(true);
	});
});
