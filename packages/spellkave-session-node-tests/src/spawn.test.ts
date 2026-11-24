import { spawn as spawnChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SessionBinding } from "../../spellkave-session/src/binding.ts";
import {
	DAEMON_ENV,
	ensureDaemon,
	probeSocket,
	type SpawnDaemonFn,
	type SpawnedProcessLike,
} from "../../spellkave-session/src/node/spawn.ts";

function fakeSpawnFn() {
	return vi.fn<SpawnDaemonFn>(() => ({ unref: () => {} }));
}

/**
 * Produce a REAL stale socket: bind a throwaway process to `path`, then
 * `SIGKILL` it. Node's own graceful `server.close()` unlinks the socket file
 * it created — only a process that never gets the chance to run that cleanup
 * (a crash, or here, a kill -9) leaves the file behind with nobody listening,
 * which is the actual failure mode `probeSocket`/`ensureDaemon` guard against.
 */
async function bindThenKill(path: string): Promise<void> {
	const script =
		'const net = require("node:net"); ' +
		"const server = net.createServer(); " +
		// `node -e <script> <args...>` places extra CLI args starting at
		// `process.argv[1]` (there is no script-path slot to occupy) — NOT
		// `argv[2]`, which would silently bind a random TCP port instead of the
		// intended unix socket path.
		'server.listen(process.argv[1], () => process.stdout.write("ready\\n"));';
	const child = spawnChildProcess(process.execPath, ["-e", script, path], {
		stdio: ["ignore", "pipe", "ignore"],
	});
	await new Promise<void>((resolve, reject) => {
		child.stdout?.once("data", () => resolve());
		child.once("error", reject);
	});
	child.kill("SIGKILL");
	await new Promise<void>((resolve) => child.once("exit", () => resolve()));
}

const binding: SessionBinding = {
	url: "http://127.0.0.1:3000",
	db: "spellkave-dev",
	identity: "tok-abc",
	actorId: "hero-1",
};

describe("probeSocket", () => {
	let dir: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "spellkave-session-probe-"));
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("is false when no socket file exists", async () => {
		expect(await probeSocket(join(dir, "missing.sock"))).toBe(false);
	});

	it("is true for a live listener", async () => {
		const path = join(dir, "live.sock");
		const server = net.createServer();
		await new Promise<void>((resolve) => server.listen(path, resolve));
		try {
			expect(await probeSocket(path)).toBe(true);
		} finally {
			await new Promise<void>((resolve) => server.close(() => resolve()));
		}
	});

	it("is false for a stale socket file (bound, then the listener process was killed)", async () => {
		const path = join(dir, "stale.sock");
		await bindThenKill(path);
		expect(existsSync(path)).toBe(true); // the file survives; nobody is listening on it
		expect(await probeSocket(path)).toBe(false);
	});
});

describe("ensureDaemon", () => {
	let dir: string;
	let socketPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "spellkave-session-ensure-"));
		socketPath = join(dir, "session.sock");
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	it("attaches without spawning when the socket is already live", async () => {
		const spawnFn = vi.fn();
		const attachment = await ensureDaemon(binding, {
			socketPath,
			probeFn: async () => true,
			spawnFn,
		});
		expect(attachment).toEqual({ socketPath, spawned: false });
		expect(spawnFn).not.toHaveBeenCalled();
	});

	it("unlinks a real stale socket file before spawning", async () => {
		await bindThenKill(socketPath);
		expect(existsSync(socketPath)).toBe(true);

		const spawnFn = fakeSpawnFn();
		let probeCalls = 0;
		await ensureDaemon(binding, {
			socketPath,
			// First call (the caller's own liveness check) sees the stale file as
			// dead; the unlink-before-respawn step re-probes and also sees it dead;
			// readiness polling then succeeds on its first check.
			probeFn: async () => {
				probeCalls += 1;
				return probeCalls > 2;
			},
			spawnFn,
			pollIntervalMs: 1,
			readyTimeoutMs: 1_000,
		});

		expect(existsSync(socketPath)).toBe(false);
		expect(spawnFn).toHaveBeenCalledOnce();
	});

	it("spawns with the binding, token, and idle timeout in the child's environment", async () => {
		const spawnFn = fakeSpawnFn();
		let calls = 0;
		await ensureDaemon(binding, {
			socketPath,
			probeFn: async () => {
				calls += 1;
				return calls > 1;
			},
			spawnFn,
			pollIntervalMs: 1,
			readyTimeoutMs: 1_000,
			token: "tok-xyz",
			worldSlug: " elven-mini-1 ",
			idleTimeoutMs: 42,
			command: { command: "fake-daemon", args: ["--flag"] },
		});

		expect(spawnFn).toHaveBeenCalledOnce();
		const call = spawnFn.mock.calls[0];
		if (call === undefined) throw new Error("spawnFn was not called");
		const [command, args, options] = call;
		expect(command).toBe("fake-daemon");
		expect(args).toEqual(["--flag"]);
		expect(options.detached).toBe(true);
		expect(options.env[DAEMON_ENV.binding]).toBe(JSON.stringify(binding));
		expect(options.env[DAEMON_ENV.socket]).toBe(socketPath);
		expect(options.env[DAEMON_ENV.token]).toBe("tok-xyz");
		expect(options.env[DAEMON_ENV.worldSlug]).toBe("elven-mini-1");
		expect(options.env[DAEMON_ENV.idleTimeoutMs]).toBe("42");
	});

	it("throws a readiness-timeout error when the daemon never comes up", async () => {
		vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
		try {
			const probeFn = vi.fn(async () => false);
			const settled = vi.fn();
			const attachment = ensureDaemon(binding, {
				socketPath,
				probeFn,
				spawnFn: (): SpawnedProcessLike => ({ unref: () => {} }),
				pollIntervalMs: 1,
				readyTimeoutMs: 10,
			});
			void attachment.then(settled, settled);
			const rejected = expect(attachment).rejects.toThrow(/did not become ready within 10ms/);
			// Flush the initial probes before advancing the readiness clock.
			await vi.advanceTimersByTimeAsync(0);
			expect(probeFn).toHaveBeenCalledTimes(2);
			await vi.advanceTimersByTimeAsync(9);
			expect(settled).not.toHaveBeenCalled();
			expect(probeFn).toHaveBeenCalledTimes(11);
			await vi.advanceTimersByTimeAsync(1);
			await rejected;
			expect(settled).toHaveBeenCalledOnce();
			expect(probeFn).toHaveBeenCalledTimes(11);
			expect(vi.getTimerCount()).toBe(0);
		} finally {
			vi.useRealTimers();
		}
	});
});
