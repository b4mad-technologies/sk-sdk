import { mkdtempSync, rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionBinding } from "../../spellkave-session/src/binding.ts";
import {
	attachSessionDaemon,
	requireSessionResult,
	SessionDaemonClient,
	SessionDaemonProtocolError,
	SessionDaemonResponseError,
	SessionDaemonTransportError,
	sendSessionRequest,
} from "../../spellkave-session/src/node/client.ts";
import { type InvokableTool, serveDaemon } from "../../spellkave-session/src/node/daemon.ts";

const binding: SessionBinding = {
	url: "http://127.0.0.1:3000",
	db: "spellkave-test",
	identity: "identity-hash",
	actorId: "actor-1",
};

function signal(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

describe("SessionDaemonClient", () => {
	it("falls back to the shipped PLAYER roster only when an old v1 daemon refuses discovery", async () => {
		const client = new SessionDaemonClient({ socketPath: "unused", spawned: false });
		vi.spyOn(client, "request").mockResolvedValue({
			id: 9,
			ok: false,
			error: { code: "bad_request", message: "malformed request frame" },
		});
		const { PLAYER_TOOL_NAMES } = await import("../../spellkave-tool-contracts/src/index.ts");
		expect(await client.toolNames()).toEqual({ id: 9, ok: true, result: PLAYER_TOOL_NAMES });
		vi.mocked(client.request).mockResolvedValue({
			id: 10,
			ok: false,
			error: { code: "authority_unavailable", message: "no authority" },
		});
		expect(await client.toolNames()).toMatchObject({
			ok: false,
			error: { code: "authority_unavailable" },
		});
	});
	let dir: string;
	let socketPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "spellkave-session-client-"));
		socketPath = join(dir, "session.sock");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("attaches by binding and shares hello, status, invoke, and shutdown with a future host", async () => {
		const echoTool: InvokableTool = {
			name: "test_echo",
			parameters: Type.Object({ value: Type.String() }),
			execute: async (_id, params) => ({
				content: [{ type: "text", text: "ok" }],
				details: { echoed: params },
			}),
		};
		const closed = signal();
		const onClose = vi.fn(closed.resolve);
		await serveDaemon({ binding, tools: [echoTool], socketPath, onClose });
		const ensureDaemonFn = vi.fn(async () => ({ socketPath, spawned: false }));

		const client = await attachSessionDaemon(binding, { ensureDaemonFn, token: "secret" });

		expect(ensureDaemonFn).toHaveBeenCalledWith(binding, { token: "secret" });
		expect(requireSessionResult(await client.hello())).toEqual({ protocol: 1, binding });
		expect(requireSessionResult(await client.status())).toMatchObject({
			binding,
			subscribed: true,
		});
		expect(
			requireSessionResult(
				await client.invoke("test_echo", { value: "x" }, { correlation_id: "corr-client" }),
			),
		).toEqual({
			content: [{ type: "text", text: "ok" }],
			details: { echoed: { value: "x" } },
		});
		expect(requireSessionResult(await client.shutdown())).toEqual({});
		await closed.promise;
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("returns daemon errors with their stable code and exposes a typed unwrap error", async () => {
		await serveDaemon({ binding, tools: [], socketPath });
		const client = new SessionDaemonClient({ socketPath, spawned: false });

		const response = await client.invoke("missing", {});

		expect(response).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
		expect(() => requireSessionResult(response)).toThrow(SessionDaemonResponseError);
		try {
			requireSessionResult(response);
		} catch (error) {
			expect(error).toMatchObject({ code: "unknown_tool", requestId: 1 });
		}
	});

	it("rejects a response whose id does not match the request", async () => {
		const server = net.createServer((socket) => {
			socket.once("data", () => socket.end('{"id":99,"ok":true,"result":{}}\n'));
		});
		await new Promise<void>((resolve) => server.listen(socketPath, resolve));
		try {
			await expect(sendSessionRequest(socketPath, { id: 7, op: "status" })).rejects.toThrow(
				SessionDaemonProtocolError,
			);
			await expect(sendSessionRequest(socketPath, { id: 8, op: "status" })).rejects.toThrow(
				"does not match request id 8",
			);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("makes a missing or stale transport failure actionable", async () => {
		const missingPath = join(dir, "missing.sock");

		await expect(sendSessionRequest(missingPath, { id: 1, op: "hello" })).rejects.toMatchObject({
			name: "SessionDaemonTransportError",
			socketPath: missingPath,
			transportCode: "ENOENT",
		});
		await expect(sendSessionRequest(missingPath, { id: 2, op: "hello" })).rejects.toThrow(
			SessionDaemonTransportError,
		);
	});

	it("times out when a listener accepts but never answers", async () => {
		// Keep real socket I/O; advance only the request deadline after the peer
		// has received the request, so runner scheduling cannot consume it.
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const received = signal();
		const sockets = new Set<net.Socket>();
		const server = net.createServer((socket) => {
			sockets.add(socket);
			socket.once("data", received.resolve);
			socket.once("close", () => sockets.delete(socket));
		});
		await new Promise<void>((resolve) => server.listen(socketPath, resolve));
		try {
			const settled = vi.fn();
			const request = sendSessionRequest(socketPath, { id: 1, op: "status" }, { timeoutMs: 20 });
			void request.then(settled, settled);
			const rejected = expect(request).rejects.toThrow("timed out after 20ms");
			await received.promise;
			await vi.advanceTimersByTimeAsync(19);
			expect(settled).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(1);
			await rejected;
			expect(settled).toHaveBeenCalledOnce();
		} finally {
			vi.useRealTimers();
			for (const socket of sockets) socket.destroy();
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("propagates attach/spawn failures without hiding their remedy", async () => {
		const stale = new Error("cannot replace stale socket; inspect daemon log");

		await expect(
			attachSessionDaemon(binding, {
				ensureDaemonFn: async () => {
					throw stale;
				},
			}),
		).rejects.toBe(stale);
	});
});
