import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionBinding } from "../../spellkave-session/src/binding.ts";
import { sendSessionRequest } from "../../spellkave-session/src/node/client.ts";
import {
	DAEMON_REPLY_WINDOW_CAP_MS,
	DEFAULT_IDLE_TIMEOUT_MS,
	type InvokableTool,
	resolveReplyWindowMs,
	resolveReplyWindowOptions,
	SessionDispatcher,
	serveDaemon,
} from "../../spellkave-session/src/node/daemon.ts";
import type { SessionRunObserver } from "../../spellkave-session/src/node/observability.ts";
import type { Request } from "../../spellkave-session/src/node/protocol.ts";

const binding: SessionBinding = {
	url: "http://127.0.0.1:3000",
	db: "spellkave-dev",
	identity: "tok-abc",
	actorId: "hero-1",
};

/** A callback boundary owned by the test, with no clock or polling involved. */
function signal(): { promise: Promise<void>; resolve: () => void } {
	let resolve!: () => void;
	const promise = new Promise<void>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}

/** A minimal fake registry tool — proves dispatch without a live SpacetimeDB node. */
function echoTool(name: string): InvokableTool {
	return {
		name,
		parameters: Type.Object({ value: Type.Optional(Type.String()) }),
		execute: async (_toolCallId, params) => ({
			content: [{ type: "text", text: "ok" }],
			details: { echoed: params },
		}),
	};
}

describe("SessionDispatcher", () => {
	it("answers hello with the protocol version and a binding echo", async () => {
		const dispatcher = new SessionDispatcher({ binding, tools: [] });
		await expect(dispatcher.handle({ id: 1, op: "hello" })).resolves.toEqual({
			id: 1,
			ok: true,
			result: { protocol: 1, binding },
		});
	});

	it("answers status with binding, uptime, subscribed, and the observability mode", async () => {
		let now = 1_000;
		const dispatcher = new SessionDispatcher({ binding, tools: [], now: () => now });
		now = 1_500;
		await expect(dispatcher.handle({ id: 2, op: "status" })).resolves.toEqual({
			id: 2,
			ok: true,
			// No `observability` injected -> the `off` no-op observer's status.
			result: {
				binding,
				uptimeMs: 500,
				subscribed: true,
				observability: {
					mode: "off",
					logsProjection: "disabled",
					tracesProjection: "disabled",
					metricsProjection: "disabled",
				},
			},
		});
	});

	it("reports subscribed=false once the world connection is gone (sk-uglp)", async () => {
		let connected = true;
		const dispatcher = new SessionDispatcher({ binding, tools: [], connected: () => connected });
		await expect(dispatcher.handle({ id: 2, op: "status" })).resolves.toMatchObject({
			result: { subscribed: true },
		});
		connected = false;
		await expect(dispatcher.handle({ id: 3, op: "status" })).resolves.toMatchObject({
			result: { subscribed: false },
		});
	});

	it("echoes an injected observer's status in the status frame", async () => {
		const observability: SessionRunObserver = {
			status: { mode: "jsonl", artifactPath: "/tmp/agent-run-events.jsonl" },
			observeToolCall: (_toolName, operation) => operation(),
			emitLifecycle: () => {},
			heartbeatMetrics: () => {},
			end: vi.fn(async () => {}),
		};
		const dispatcher = new SessionDispatcher({ binding, tools: [], observability });
		await expect(dispatcher.handle({ id: 2, op: "status" })).resolves.toMatchObject({
			id: 2,
			ok: true,
			result: { observability: { mode: "jsonl", artifactPath: "/tmp/agent-run-events.jsonl" } },
		});
	});

	it("dispatches invoke to the matching tool after validating its params", async () => {
		const dispatcher = new SessionDispatcher({ binding, tools: [echoTool("spellkave_scene")] });
		await expect(
			dispatcher.handle({ id: 3, op: "invoke", tool: "spellkave_scene", args: { value: "x" } }),
		).resolves.toEqual({
			id: 3,
			ok: true,
			result: { content: [{ type: "text", text: "ok" }], details: { echoed: { value: "x" } } },
		});
	});

	it("serializes concurrent invoke frames in the daemon before the tool body and event drain", async () => {
		let active = 0;
		let maxActive = 0;
		const calls = [
			{ started: signal(), finish: signal() },
			{ started: signal(), finish: signal() },
		] as const;
		let callIndex = 0;
		const serializedTool: InvokableTool = {
			name: "spellkave_scene",
			parameters: Type.Object({}),
			execute: async () => {
				active += 1;
				maxActive = Math.max(maxActive, active);
				const call = calls[callIndex++];
				if (call === undefined) throw new Error("Unexpected extra invocation");
				call.started.resolve();
				await call.finish.promise;
				active -= 1;
				return { content: [{ type: "text", text: "ok" }], details: {} };
			},
		};
		const dispatcher = new SessionDispatcher({ binding, tools: [serializedTool] });
		const first = dispatcher.handle({ id: 30, op: "invoke", tool: "spellkave_scene", args: {} });
		await calls[0].started.promise;
		const second = dispatcher.handle({ id: 31, op: "invoke", tool: "spellkave_scene", args: {} });
		expect(maxActive).toBe(1);
		expect(callIndex).toBe(1);
		calls[0].finish.resolve();
		await calls[1].started.promise;
		calls[1].finish.resolve();
		await expect(Promise.all([first, second])).resolves.toEqual([
			{ id: 30, ok: true, result: { content: [{ type: "text", text: "ok" }], details: {} } },
			{ id: 31, ok: true, result: { content: [{ type: "text", text: "ok" }], details: {} } },
		]);
		expect(maxActive).toBe(1);
	});

	it("serves a second invoke while the first tool released the invoke lock early (sk-0m4.121)", async () => {
		let dispatcher: SessionDispatcher | undefined;
		const firstStarted = signal();
		const finishFirst = signal();
		const order: string[] = [];
		const releasingTool: InvokableTool = {
			name: "spellkave_manipulate",
			parameters: Type.Object({}),
			execute: async () => {
				order.push("first:dispatched");
				// The communicate reply window: ordering-relevant work is done,
				// hand the lock back and keep waiting.
				dispatcher?.releaseCurrentInvoke();
				firstStarted.resolve();
				await finishFirst.promise;
				order.push("first:done");
				return { content: [{ type: "text", text: "act" }], details: {} };
			},
		};
		const readTool: InvokableTool = {
			name: "spellkave_scene",
			parameters: Type.Object({}),
			execute: async () => {
				order.push("second:done");
				return { content: [{ type: "text", text: "scene" }], details: {} };
			},
		};
		dispatcher = new SessionDispatcher({ binding, tools: [releasingTool, readTool] });
		const first = dispatcher.handle({
			id: 40,
			op: "invoke",
			tool: "spellkave_manipulate",
			args: {},
		});
		await firstStarted.promise;
		const second = dispatcher.handle({ id: 41, op: "invoke", tool: "spellkave_scene", args: {} });
		// The read is served while the act is still waiting for its reply.
		await expect(second).resolves.toMatchObject({ id: 41, ok: true });
		expect(order).toEqual(["first:dispatched", "second:done"]);
		finishFirst.resolve();
		await expect(first).resolves.toMatchObject({ id: 40, ok: true });
		expect(order).toEqual(["first:dispatched", "second:done", "first:done"]);
		// Idle: nothing to release, nothing thrown.
		dispatcher.releaseCurrentInvoke();
		await expect(
			dispatcher.handle({ id: 42, op: "invoke", tool: "spellkave_scene", args: {} }),
		).resolves.toMatchObject({ id: 42, ok: true });
	});

	it("an early-released invoke finishing never releases its successor's lock (sk-0m4.121)", async () => {
		let dispatcher: SessionDispatcher | undefined;
		const firstStarted = signal();
		const secondStarted = signal();
		const finishFirst = signal();
		const finishSecond = signal();
		let secondFinished = false;
		let thirdRan = false;
		const releasingTool: InvokableTool = {
			name: "spellkave_manipulate",
			parameters: Type.Object({}),
			execute: async () => {
				dispatcher?.releaseCurrentInvoke();
				firstStarted.resolve();
				await finishFirst.promise;
				return { content: [{ type: "text", text: "act" }], details: {} };
			},
		};
		const holdingTool: InvokableTool = {
			name: "spellkave_move",
			parameters: Type.Object({}),
			execute: async () => {
				secondStarted.resolve();
				await finishSecond.promise;
				secondFinished = true;
				return { content: [{ type: "text", text: "move" }], details: {} };
			},
		};
		const readTool: InvokableTool = {
			name: "spellkave_scene",
			parameters: Type.Object({}),
			execute: async () => {
				thirdRan = true;
				expect(secondFinished, "third invoke must wait for its lock holder to finish").toBe(true);
				return { content: [{ type: "text", text: "scene" }], details: {} };
			},
		};
		dispatcher = new SessionDispatcher({
			binding,
			tools: [releasingTool, holdingTool, readTool],
		});
		const first = dispatcher.handle({
			id: 50,
			op: "invoke",
			tool: "spellkave_manipulate",
			args: {},
		});
		await firstStarted.promise;
		const second = dispatcher.handle({ id: 51, op: "invoke", tool: "spellkave_move", args: {} });
		await secondStarted.promise;
		const third = dispatcher.handle({ id: 52, op: "invoke", tool: "spellkave_scene", args: {} });
		// The first invoke completes while the second still holds the lock …
		finishFirst.resolve();
		await expect(first).resolves.toMatchObject({ id: 50, ok: true });
		// … and the third stays queued behind the second.
		expect(thirdRan).toBe(false);
		finishSecond.resolve();
		await expect(second).resolves.toMatchObject({ id: 51, ok: true });
		await expect(third).resolves.toMatchObject({ id: 52, ok: true });
		expect(thirdRan).toBe(true);
	});

	it("rejects invoke for a tool the registry does not have", async () => {
		const dispatcher = new SessionDispatcher({ binding, tools: [] });
		await expect(
			dispatcher.handle({ id: 4, op: "invoke", tool: "spellkave_bogus", args: {} }),
		).resolves.toMatchObject({ id: 4, ok: false, error: { code: "unknown_tool" } });
	});

	it("rejects invoke whose args fail the tool's own parameter schema", async () => {
		const dispatcher = new SessionDispatcher({ binding, tools: [echoTool("spellkave_scene")] });
		await expect(
			dispatcher.handle({ id: 5, op: "invoke", tool: "spellkave_scene", args: { value: 5 } }),
		).resolves.toMatchObject({ id: 5, ok: false, error: { code: "bad_request" } });
	});

	it("reports a throwing tool body as a tool_error, never a crash", async () => {
		const throwing: InvokableTool = {
			name: "spellkave_boom",
			parameters: Type.Object({}),
			execute: async () => {
				throw new Error("kaboom");
			},
		};
		const dispatcher = new SessionDispatcher({ binding, tools: [throwing] });
		await expect(
			dispatcher.handle({ id: 6, op: "invoke", tool: "spellkave_boom", args: {} }),
		).resolves.toEqual({
			id: 6,
			ok: false,
			error: { message: "kaboom", code: "tool_error" },
		});
	});

	it("returns a bad_request error for a frame that isn't a request at all", async () => {
		const dispatcher = new SessionDispatcher({ binding, tools: [] });
		await expect(dispatcher.handle({ id: 7, op: "not-a-real-op" })).resolves.toMatchObject({
			id: 7,
			ok: false,
			error: { code: "bad_request" },
		});
	});

	it("acknowledges shutdown with a response the caller sees, and invokes onShutdown exactly once", async () => {
		const shutdown = signal();
		const onShutdown = vi.fn(shutdown.resolve);
		const dispatcher = new SessionDispatcher({ binding, tools: [], onShutdown });
		const response = await dispatcher.handle({ id: 8, op: "shutdown" });
		expect(response).toEqual({ id: 8, ok: true, result: {} });
		// Await the callback itself without assuming how many microtasks precede it.
		await shutdown.promise;
		expect(onShutdown).toHaveBeenCalledOnce();
	});

	it("defaults the idle timeout to 10 minutes", () => {
		const dispatcher = new SessionDispatcher({ binding, tools: [] });
		expect(dispatcher.idleTimeoutMs).toBe(DEFAULT_IDLE_TIMEOUT_MS);
	});

	it("tracks idleness from the last handled frame, not from construction", async () => {
		let now = 0;
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [],
			now: () => now,
			idleTimeoutMs: 100,
		});
		now = 90;
		await dispatcher.handle({ id: 9, op: "status" });
		now = 150; // 60ms since the last handled frame
		expect(dispatcher.isIdle()).toBe(false);
		now = 200; // 110ms since the last handled frame
		expect(dispatcher.isIdle()).toBe(true);
	});

	it("wraps a successful invoke with the observer's observeToolCall, tool name included", async () => {
		const observedToolNames: string[] = [];
		const observability: SessionRunObserver = {
			status: { mode: "jsonl" },
			observeToolCall(toolName, operation) {
				observedToolNames.push(toolName);
				return operation();
			},
			emitLifecycle: () => {},
			heartbeatMetrics: () => {},
			end: vi.fn(async () => {}),
		};
		const dispatcher = new SessionDispatcher({
			binding,
			tools: [echoTool("spellkave_scene")],
			observability,
		});
		await dispatcher.handle({ id: 10, op: "invoke", tool: "spellkave_scene", args: {} });
		expect(observedToolNames).toEqual(["spellkave_scene"]);
	});

	it("still reports tool_error when the observer's observeToolCall re-throws", async () => {
		const throwing: InvokableTool = {
			name: "spellkave_boom",
			parameters: Type.Object({}),
			execute: async () => {
				throw new Error("kaboom");
			},
		};
		const observability: SessionRunObserver = {
			status: { mode: "jsonl" },
			observeToolCall: (_toolName, operation) => operation(),
			emitLifecycle: () => {},
			heartbeatMetrics: () => {},
			end: vi.fn(async () => {}),
		};
		const dispatcher = new SessionDispatcher({ binding, tools: [throwing], observability });
		await expect(
			dispatcher.handle({ id: 11, op: "invoke", tool: "spellkave_boom", args: {} }),
		).resolves.toEqual({ id: 11, ok: false, error: { message: "kaboom", code: "tool_error" } });
	});
});

function tempSocketPath(prefix: string): { dir: string; path: string } {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	return { dir, path: join(dir, "session.sock") };
}

function sendFrame(path: string, frame: Request): Promise<unknown> {
	return sendSessionRequest(path, frame);
}

describe("serveDaemon (real unix socket, fake tool registry — no live node)", () => {
	let dir: string;
	let socketPath: string;

	beforeEach(() => {
		({ dir, path: socketPath } = tempSocketPath("spellkave-session-daemon-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("serves hello, dispatches invoke, and tears down cleanly on shutdown", async () => {
		const closed = signal();
		const onClose = vi.fn(closed.resolve);
		await serveDaemon({ binding, tools: [echoTool("spellkave_scene")], socketPath, onClose });

		await expect(sendFrame(socketPath, { id: 1, op: "hello" })).resolves.toEqual({
			id: 1,
			ok: true,
			result: { protocol: 1, binding },
		});
		await expect(
			sendFrame(socketPath, { id: 2, op: "invoke", tool: "spellkave_scene", args: {} }),
		).resolves.toMatchObject({ id: 2, ok: true });
		await expect(sendFrame(socketPath, { id: 3, op: "shutdown" })).resolves.toEqual({
			id: 3,
			ok: true,
			result: {},
		});

		await closed.promise;
		expect(onClose).toHaveBeenCalledOnce();
		expect(existsSync(socketPath)).toBe(false);
	});

	it("closes and unlinks its socket once the idle timeout elapses with no frames", async () => {
		vi.useFakeTimers();
		try {
			const onClose = vi.fn();
			await serveDaemon({ binding, tools: [], socketPath, idleTimeoutMs: 1_000, onClose });

			await vi.advanceTimersByTimeAsync(1_000);

			expect(onClose).toHaveBeenCalledOnce();
			expect(existsSync(socketPath)).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("ends the run observer with terminal 'shutdown' on an explicit shutdown op", async () => {
		const ended = signal();
		const end = vi.fn(async () => {
			ended.resolve();
		});
		const observability: SessionRunObserver = {
			status: { mode: "jsonl" },
			observeToolCall: (_toolName, operation) => operation(),
			emitLifecycle: () => {},
			heartbeatMetrics: () => {},
			end,
		};
		await serveDaemon({ binding, tools: [], socketPath, observability });

		await sendFrame(socketPath, { id: 1, op: "shutdown" });

		await ended.promise;
		expect(end).toHaveBeenCalledOnce();
		expect(end).toHaveBeenCalledWith("shutdown");
	});

	it("ends the run observer with terminal 'idle_timeout' once the idle timeout elapses", async () => {
		vi.useFakeTimers();
		try {
			const end = vi.fn(async () => {});
			const observability: SessionRunObserver = {
				status: { mode: "jsonl" },
				observeToolCall: (_toolName, operation) => operation(),
				emitLifecycle: () => {},
				heartbeatMetrics: () => {},
				end,
			};
			await serveDaemon({ binding, tools: [], socketPath, idleTimeoutMs: 1_000, observability });

			await vi.advanceTimersByTimeAsync(1_000);

			expect(end).toHaveBeenCalledOnce();
			expect(end).toHaveBeenCalledWith("idle_timeout");
		} finally {
			vi.useRealTimers();
		}
	});

	it("heartbeats metrics on an interval without waiting for a player request", async () => {
		vi.useFakeTimers();
		try {
			const heartbeatMetrics = vi.fn();
			const observability: SessionRunObserver = {
				status: { mode: "jsonl" },
				observeToolCall: (_toolName, operation) => operation(),
				emitLifecycle: () => {},
				heartbeatMetrics,
				end: vi.fn(async () => {}),
			};
			const handle = await serveDaemon({
				binding,
				tools: [],
				socketPath,
				idleTimeoutMs: 60_000,
				metricsHeartbeatIntervalMs: 1_000,
				observability,
			});
			expect(heartbeatMetrics).toHaveBeenCalledOnce();
			await vi.advanceTimersByTimeAsync(1_000);
			expect(heartbeatMetrics).toHaveBeenCalledTimes(2);
			await handle.close();
		} finally {
			vi.useRealTimers();
		}
	});
});

// sk-0m4.73: `resolveReplyWindowMs` owns only the daemon's environment
// override. The shared PLAYER tool runtime layer owns the tick-scaled fallback, so an
// absent or invalid override stays absent here.
describe("resolveReplyWindowMs", () => {
	it("returns SPELLKAVE_REPLY_WINDOW_MS when set to a positive number", () => {
		expect(resolveReplyWindowMs({ SPELLKAVE_REPLY_WINDOW_MS: "1500" })).toBe(1500);
	});

	it("returns undefined when unset", () => {
		expect(resolveReplyWindowMs({})).toBeUndefined();
	});

	it("returns undefined for a non-numeric or non-positive override", () => {
		expect(resolveReplyWindowMs({ SPELLKAVE_REPLY_WINDOW_MS: "nope" })).toBeUndefined();
		expect(resolveReplyWindowMs({ SPELLKAVE_REPLY_WINDOW_MS: "0" })).toBeUndefined();
		expect(resolveReplyWindowMs({ SPELLKAVE_REPLY_WINDOW_MS: "-100" })).toBeUndefined();
	});
});

describe("resolveReplyWindowOptions (sk-0m4.121)", () => {
	it("passes only the daemon cap, below the gateway fast-fail, when no override is set", () => {
		expect(DAEMON_REPLY_WINDOW_CAP_MS).toBeLessThan(12_000);
		expect(resolveReplyWindowOptions({})).toEqual({
			replyWindowCapMs: DAEMON_REPLY_WINDOW_CAP_MS,
		});
	});

	it("passes an explicit SPELLKAVE_REPLY_WINDOW_MS uncapped and no cap at all", () => {
		expect(resolveReplyWindowOptions({ SPELLKAVE_REPLY_WINDOW_MS: "30000" })).toEqual({
			replyWindowMs: 30_000,
		});
	});
});

describe("live tool registry refresh", () => {
	it("lists the current roster and refuses a removed tool before executing it", async () => {
		const first = echoTool("custom_author_tool");
		let current: readonly InvokableTool[] = [first];
		const dispatcher = new SessionDispatcher({ binding, tools: () => current });
		expect(await dispatcher.handle({ id: 70, op: "list_tools" })).toEqual({
			id: 70,
			ok: true,
			result: [first.name],
		});
		current = [];
		expect(await dispatcher.handle({ id: 71, op: "list_tools" })).toEqual({
			id: 71,
			ok: true,
			result: [],
		});
		expect(
			await dispatcher.handle({ id: 72, op: "invoke", tool: first.name, args: {} }),
		).toMatchObject({ ok: false, error: { code: "unknown_tool" } });
	});
});
