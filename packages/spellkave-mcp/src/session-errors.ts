import { SessionDaemonProtocolError, SessionDaemonTransportError } from "@spellkave/session/node";

/** `gateway`: the gateway refused the call before contacting any daemon
 * (sk-0m4.120.36 — a full per-subject seat queue). Retryable, not a wipe. */
export type SessionErrorCategory = "transport" | "protocol" | "gateway" | "internal";

/**
 * sk-0m4.120.36: the per-subject seat queue (`SerializedPlayerSessionClient`)
 * already holds its cap of in-flight calls. Until this class existed the queue
 * threw a plain `Error("Fixed PLAYER seat is busy")`, which the classifier
 * below could only call `internal_error` — the 1-2 ms "The PLAYER tool call
 * failed." rows of 2026-08-29 that never reached a session daemon.
 */
export class PlayerSeatBusyError extends Error {
	readonly code = "seat_busy" as const;

	constructor(message = "PLAYER seat queue is full") {
		super(message);
		this.name = "PlayerSeatBusyError";
	}
}

/**
 * Constructor / `name` of an unknown throw — never its message. Rides the
 * `internal_error` result as `error_class` so the tool_call row can say WHICH
 * unknown throw it was (sk-0m4.120.36). Non-object throws report their type.
 */
export function unknownErrorClass(error: unknown): string {
	if (typeof error !== "object" || error === null) return typeof error;
	const rec = error as { name?: unknown; constructor?: { name?: unknown } };
	const name = typeof rec.name === "string" ? rec.name.trim() : "";
	const fallback = typeof rec.constructor?.name === "string" ? rec.constructor.name.trim() : "";
	const chosen = name !== "" ? name : fallback !== "" ? fallback : "object";
	return chosen.replace(/[^A-Za-z0-9_$.]/g, "").slice(0, 64) || "object";
}

export interface SessionErrorClass {
	readonly category: SessionErrorCategory;
	/** Stable gateway code (`session_invoke_timeout`, `session_unavailable`,
	 * a transport `code` such as `ECONNREFUSED`, `session_protocol_error`, …). */
	readonly code: string;
}

/** True when the gateway or session socket gave up waiting — not a dead world. */
export function isInvokeTimeout(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	const rec = error as { name?: string; code?: string; message?: string };
	if (rec.name === "SessionInvokeTimeoutError" || rec.code === "ETIMEDOUT") return true;
	if (error instanceof SessionDaemonTransportError && rec.message?.includes("timed out"))
		return true;
	return typeof rec.message === "string" && rec.message.includes("timed out after");
}

/**
 * sk-0m4.120.24: the ONE classification of a thrown session error into the
 * structured `(category, code)` pair every emitter agrees on — the tool_call
 * error result (`daemon-handler.ts`) and the must-gather `session_status`
 * (`feedback.ts`). Never a constructor name: round 3's bundle (#2802) showed
 * `session_status.error_code: "Error"` while `recent_tool_errors` in the same
 * bundle already said `session_invoke_timeout`.
 *
 * Lives in its own module so `feedback.ts` can share it without importing
 * `runtime.ts`/`daemon-handler.ts` (both of which import `feedback.ts`).
 */
export function classifySessionError(
	error: unknown,
	fallbackCode = "internal_error",
): SessionErrorClass {
	if (isInvokeTimeout(error)) return { category: "transport", code: "session_invoke_timeout" };
	if (error instanceof SessionDaemonTransportError) {
		return { category: "transport", code: error.transportCode ?? "session_unavailable" };
	}
	if (error instanceof SessionDaemonProtocolError) {
		return { category: "protocol", code: "session_protocol_error" };
	}
	if (error instanceof PlayerSeatBusyError) return { category: "gateway", code: error.code };
	return { category: "internal", code: fallbackCode };
}
