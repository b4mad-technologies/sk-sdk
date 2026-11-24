// JSONL wire protocol over the session daemon's unix socket (#1990 decision
// 3): one generic `invoke` frame plus a tiny control plane. No tool names
// appear anywhere in this file — the registry decided the shape
// (`defineTool` + typebox schema + JSON args -> transport-neutral result), so the
// wire protocol only needs to pass a tool NAME through, never enumerate one.
//
//   -> {"id":1,"op":"invoke","tool":"<name>","args":{...}}
//   <- {"id":1,"ok":true,"result":{...}}
//   <- {"id":1,"ok":false,"error":{"message":"...","code":"..."}}
//   <- {"id":1,"ok":true,"result":{...},"pushes":[...]}
//
// Control ops: `hello` (protocol version + binding echo), `status` (binding,
// uptime, subscribed, and — #2003 — the active `observability` mode/artifact
// path), `shutdown` (clean close), `drain_pushes` (sk-0m4.22: drain the
// daemon's ONE WorldEventBuilder without running a PLAYER tool). Each
// request/response is framed as one JSON object per line (JSONL, ADR-0002's
// own wire convention).
//
// `pushes` is ADDITIVE (sk-0m4.22): pending WorldEvents piggyback on every
// response so a PLAYER driving the world through `sk` sees incoming hits,
// damage dealt, XP, and turn transitions without a protocol-version bump or
// unsolicited daemon→client frames. Existing consumers that ignore unknown
// fields keep working. Omitted (not `[]`) when the daemon has no feed — the
// fake-registry test seam — so those tests stay byte-stable.

import {
	normalizeWorldActorCausalContext,
	type WorldActorCausalContext,
} from "@spellkave/agent-observability";

export const PROTOCOL_VERSION = 1;

export interface InvokeRequest {
	id: number;
	op: "invoke";
	tool: string;
	args: unknown;
	/** Optional non-secret observability context beside (never inside) tool args. */
	causal_context?: WorldActorCausalContext;
}

export interface HelloRequest {
	id: number;
	op: "hello";
}

export interface StatusRequest {
	id: number;
	op: "status";
}

export interface ShutdownRequest {
	id: number;
	op: "shutdown";
}

export interface DrainPushesRequest {
	id: number;
	op: "drain_pushes";
}

export interface ListToolsRequest {
	id: number;
	op: "list_tools";
}

export type Request =
	| ListToolsRequest
	| InvokeRequest
	| HelloRequest
	| StatusRequest
	| ShutdownRequest
	| DrainPushesRequest;

/**
 * sk-uglp: an out-of-band session-lifecycle notice a gateway attaches to the
 * next response after something happened to the WORLD SESSION itself (not to
 * the world): today only `world_reset` — the session daemon behind this
 * caller died (world connection lost after a wipe/redeploy) and a fresh one
 * was attached. Additive, same discipline as `pushes`; clients that ignore
 * unknown fields keep working.
 */
export interface SessionNotice {
	kind: "world_reset";
	text: string;
}

export interface OkResponse<R = unknown> {
	id: number;
	ok: true;
	result: R;
	/** Pending WorldEvents drained from the daemon's one session-lifetime
	 * builder (sk-0m4.22). Omitted when the daemon has no feed, or when the
	 * drain produced nothing. Never an empty array. */
	pushes?: readonly unknown[];
	/** sk-uglp: see {@link SessionNotice}. Omitted when there is nothing to say. */
	notices?: readonly SessionNotice[];
}

export interface ErrorDetail {
	message: string;
	code?: string;
}

export interface ErrResponse {
	id: number;
	ok: false;
	error: ErrorDetail;
	/** Same piggyback as {@link OkResponse.pushes} — a tool_error must not
	 * swallow events that accumulated before the throw. */
	pushes?: readonly unknown[];
	/** sk-uglp: see {@link SessionNotice}. */
	notices?: readonly SessionNotice[];
}

export type Response<R = unknown> = OkResponse<R> | ErrResponse;

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumericId(
	value: Record<string, unknown>,
): value is Record<string, unknown> & { id: number } {
	return typeof value.id === "number" && Number.isFinite(value.id);
}

/** Type guard for a well-formed request frame. Rejects anything the codec can't safely dispatch. */
export function isRequest(value: unknown): value is Request {
	if (!isPlainObject(value) || !hasNumericId(value)) return false;
	switch (value.op) {
		case "list_tools":
		case "hello":
		case "status":
		case "shutdown":
		case "drain_pushes":
			return true;
		case "invoke":
			return (
				typeof value.tool === "string" &&
				value.tool.length > 0 &&
				"args" in value &&
				(value.causal_context === undefined ||
					normalizeWorldActorCausalContext(value.causal_context) !== undefined)
			);
		default:
			return false;
	}
}

/** Best-effort id extraction from a frame that failed {@link isRequest} — for error replies. */
export function requestId(value: unknown): number | undefined {
	if (isPlainObject(value) && typeof value.id === "number" && Number.isFinite(value.id)) {
		return value.id;
	}
	return undefined;
}

export function isOkResponse(value: unknown): value is OkResponse {
	return isPlainObject(value) && hasNumericId(value) && value.ok === true && "result" in value;
}

export function isErrResponse(value: unknown): value is ErrResponse {
	if (!isPlainObject(value) || !hasNumericId(value) || value.ok !== false) return false;
	const error = value.error;
	return isPlainObject(error) && typeof error.message === "string";
}

export function isResponse(value: unknown): value is Response {
	return isOkResponse(value) || isErrResponse(value);
}

/** Encode one frame as a newline-terminated JSON line — the unit this codec writes to the socket. */
export function encodeFrame(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

/**
 * Incremental JSONL decoder: feed raw socket chunks in, get back the frames
 * (parsed, but NOT yet validated as `Request`/`Response` — callers apply the
 * type guards above) that completed since the last call. Blank lines are
 * skipped rather than erroring, matching ADR-0002's JSONL convention
 * elsewhere in the repo.
 */
export class JsonlFrameDecoder {
	private buffer = "";

	push(chunk: string): unknown[] {
		this.buffer += chunk;
		const frames: unknown[] = [];
		let newlineIndex = this.buffer.indexOf("\n");
		while (newlineIndex !== -1) {
			const line = this.buffer.slice(0, newlineIndex).trim();
			this.buffer = this.buffer.slice(newlineIndex + 1);
			if (line.length > 0) frames.push(JSON.parse(line));
			newlineIndex = this.buffer.indexOf("\n");
		}
		return frames;
	}
}
