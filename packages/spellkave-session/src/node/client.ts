// Host-neutral client for the binding-keyed session daemon. Hosts attach by
// SessionBinding, then speak the generic JSONL protocol; PLAYER tool membership
// remains in session-owned player-tools and never appears here.

import * as net from "node:net";
import {
	normalizeWorldActorCausalContext,
	type WorldActorCausalContext,
} from "@spellkave/agent-observability";
import type { SessionBinding } from "../binding.ts";
import {
	type ErrResponse,
	encodeFrame,
	isOkResponse,
	isResponse,
	JsonlFrameDecoder,
	type Request,
	type Response,
} from "./protocol.ts";
import { type DaemonAttachment, type EnsureDaemonOptions, ensureDaemon } from "./spawn.ts";

export const DEFAULT_SESSION_REQUEST_TIMEOUT_MS = 15_000;

export type EnsureDaemon = (
	binding: SessionBinding,
	options?: EnsureDaemonOptions,
) => Promise<DaemonAttachment>;

export interface SendSessionRequestOptions {
	timeoutMs?: number;
}

export interface AttachSessionDaemonOptions extends EnsureDaemonOptions {
	/** Injectable attach/spawn seam for tests and hosts with their own process supervisor. */
	ensureDaemonFn?: EnsureDaemon;
	requestTimeoutMs?: number;
}

export interface SessionDaemonHello {
	protocol: number;
	binding: SessionBinding;
}

export interface SessionDaemonStatus {
	binding: SessionBinding;
	uptimeMs: number;
	subscribed: boolean;
	observability: {
		mode: string;
		artifactPath?: string;
		logsProjection?: "configured" | "disabled";
		tracesProjection?: "configured" | "disabled";
		metricsProjection?: "configured" | "disabled";
	};
}

export class SessionDaemonResponseError extends Error {
	readonly code: string | undefined;
	readonly requestId: number;

	constructor(response: ErrResponse) {
		super(response.error.message);
		this.name = "SessionDaemonResponseError";
		this.code = response.error.code;
		this.requestId = response.id;
	}
}

export class SessionDaemonProtocolError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SessionDaemonProtocolError";
	}
}

export class SessionDaemonTransportError extends Error {
	readonly socketPath: string;
	readonly transportCode: string | undefined;

	constructor(socketPath: string, message: string, cause?: unknown) {
		super(`session daemon request failed at ${socketPath}: ${message}`, { cause });
		this.name = "SessionDaemonTransportError";
		this.socketPath = socketPath;
		this.transportCode =
			typeof cause === "object" && cause !== null && "code" in cause
				? String((cause as { code: unknown }).code)
				: undefined;
	}
}

/**
 * One validated request/response round trip over an already-listening daemon
 * socket. The returned daemon error frame is intentionally not thrown so a
 * host can map its stable code into its own protocol without losing detail.
 */
export function sendSessionRequest<R = unknown>(
	socketPath: string,
	request: Request,
	options: SendSessionRequestOptions = {},
): Promise<Response<R>> {
	return new Promise((resolve, reject) => {
		const socket = net.createConnection(socketPath);
		const decoder = new JsonlFrameDecoder();
		const timeoutMs = options.timeoutMs ?? DEFAULT_SESSION_REQUEST_TIMEOUT_MS;
		let settled = false;

		const finish = (operation: () => void): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.destroy();
			operation();
		};
		const failTransport = (message: string, cause?: unknown): void =>
			finish(() => reject(new SessionDaemonTransportError(socketPath, message, cause)));
		const timer = setTimeout(() => failTransport(`timed out after ${timeoutMs}ms`), timeoutMs);

		socket.setEncoding("utf8");
		socket.once("connect", () => socket.write(encodeFrame(request)));
		socket.on("data", (chunk: string) => {
			let frames: unknown[];
			try {
				frames = decoder.push(chunk);
			} catch (error) {
				failTransport("received malformed JSON", error);
				return;
			}
			if (frames.length === 0) return;
			const response = frames[0];
			if (!isResponse(response)) {
				finish(() =>
					reject(new SessionDaemonProtocolError("daemon returned a malformed response")),
				);
				return;
			}
			if (response.id !== request.id) {
				finish(() =>
					reject(
						new SessionDaemonProtocolError(
							`daemon response id ${response.id} does not match request id ${request.id}`,
						),
					),
				);
				return;
			}
			finish(() => resolve(response as Response<R>));
		});
		socket.once("error", (error) => failTransport(error.message, error));
		socket.once("end", () => failTransport("connection ended before a response"));
	});
}

export function requireSessionResult<R>(response: Response<R>): R {
	if (isOkResponse(response)) return response.result as R;
	throw new SessionDaemonResponseError(response);
}

/** A lightweight host client; each call opens one socket while the daemon keeps the session alive. */
export class SessionDaemonClient {
	readonly attachment: DaemonAttachment;
	private readonly requestTimeoutMs: number;
	private nextId = 1;

	constructor(attachment: DaemonAttachment, requestTimeoutMs = DEFAULT_SESSION_REQUEST_TIMEOUT_MS) {
		this.attachment = attachment;
		this.requestTimeoutMs = requestTimeoutMs;
	}

	request<R = unknown>(request: Request): Promise<Response<R>> {
		return sendSessionRequest<R>(this.attachment.socketPath, request, {
			timeoutMs: this.requestTimeoutMs,
		});
	}

	hello(): Promise<Response<SessionDaemonHello>> {
		return this.request({ id: this.requestId(), op: "hello" });
	}

	async toolNames(): Promise<Response<string[]>> {
		const response = await this.request<string[]>({ id: this.requestId(), op: "list_tools" });
		// A v1 predecessor refuses this additive operation. Gateway-first rollback
		// preserves its shipped PLAYER surface without inferring elevated rights.
		if (!response.ok && response.error.code === "bad_request") {
			const { PLAYER_TOOL_NAMES } = await import("@spellkave/tool-contracts");
			return { id: response.id, ok: true, result: [...PLAYER_TOOL_NAMES] };
		}
		return response;
	}

	status(): Promise<Response<SessionDaemonStatus>> {
		return this.request({ id: this.requestId(), op: "status" });
	}

	invoke<R = unknown>(
		tool: string,
		args: unknown,
		causalContext?: WorldActorCausalContext,
	): Promise<Response<R>> {
		const causal_context = normalizeWorldActorCausalContext(causalContext);
		return this.request({
			id: this.requestId(),
			op: "invoke",
			tool,
			args,
			...(causal_context === undefined ? {} : { causal_context }),
		});
	}

	drainPushes(): Promise<Response<Record<string, never>>> {
		return this.request({ id: this.requestId(), op: "drain_pushes" });
	}

	shutdown(): Promise<Response<Record<string, never>>> {
		return this.request({ id: this.requestId(), op: "shutdown" });
	}

	private requestId(): number {
		const id = this.nextId;
		this.nextId += 1;
		return id;
	}
}

/** Attach or spawn by binding; callers can issue `hello()` when they need the binding echo. */
export async function attachSessionDaemon(
	binding: SessionBinding,
	options: AttachSessionDaemonOptions = {},
): Promise<SessionDaemonClient> {
	const { ensureDaemonFn = ensureDaemon, requestTimeoutMs, ...ensureOptions } = options;
	const attachment = await ensureDaemonFn(binding, ensureOptions);
	return new SessionDaemonClient(attachment, requestTimeoutMs);
}
