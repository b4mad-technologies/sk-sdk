// `ensureDaemon` — probe / stale-socket-unlink / spawn / poll-ready / attach
// (#1990 decision 4). Modeled on herdr's `src/server/autodetect.rs`:
// `is_server_listening_at` (connect-probe; a socket file with nobody
// listening reads as `ConnectionRefused`/`ENOENT`, both "stale"),
// `spawn_server_daemon` (detached, stdio redirected to a log file),
// `wait_for_server_socket` (poll at a fixed interval up to a timeout).

import { type ChildProcess, spawn as spawnChildProcess } from "node:child_process";
import { closeSync, existsSync, openSync, unlinkSync } from "node:fs";
import * as net from "node:net";
import { fileURLToPath } from "node:url";

import type { SessionBinding } from "../binding.ts";
import {
	logPath as deriveLogPath,
	socketPath as deriveSocketPath,
	ensureParentDir,
} from "./paths.ts";

const DEFAULT_READY_TIMEOUT_MS = 15_000;
const DEFAULT_POLL_INTERVAL_MS = 50;
const DEFAULT_PROBE_TIMEOUT_MS = 500;

const BINDING_ENV = "SPELLKAVE_SESSION_BINDING";
const SOCKET_ENV = "SPELLKAVE_SESSION_SOCKET";
const TOKEN_ENV = "SPELLKAVE_SESSION_TOKEN";
const IDLE_TIMEOUT_ENV = "SPELLKAVE_SESSION_IDLE_TIMEOUT_MS";
const WORLD_SLUG_ENV = "SPELLKAVE_WORLD_SLUG";

/**
 * This package's own `tsx`-shebang'd daemon entry — the default spawn
 * target, same shape as `packages/spellkave-cli/bin/sk.js`. Relies on `tsx`
 * being resolvable on the spawned child's `PATH` (true under `pnpm`/`just`,
 * which put each workspace package's `node_modules/.bin` on `PATH`). A host
 * that spawns `ensureDaemon` outside such an environment — or that wants to
 * respawn itself instead (e.g. `sk session start`, #1990 slice 3) — should
 * pass an explicit `command` override rather than rely on this default.
 */
const DEFAULT_DAEMON_BIN = fileURLToPath(
	new URL("../../bin/spellkave-session-daemon.js", import.meta.url),
);

export interface DaemonCommand {
	command: string;
	args: string[];
}

/** Minimal shape `ensureDaemon` needs from a spawned child — narrower than `ChildProcess` so tests can fake it. */
export interface SpawnedProcessLike {
	unref(): void;
}

export type SpawnDaemonFn = (
	command: string,
	args: string[],
	options: { detached: boolean; stdio: ["ignore", number, number]; env: NodeJS.ProcessEnv },
) => SpawnedProcessLike;

export interface EnsureDaemonOptions {
	token?: string;
	/** Stable catalog identity for this daemon's single world. */
	worldSlug?: string;
	idleTimeoutMs?: number;
	readyTimeoutMs?: number;
	pollIntervalMs?: number;
	probeTimeoutMs?: number;
	/** Override the derived socket path. Defaults to `socketPath(binding)`; tests point this at a temp dir. */
	socketPath?: string;
	/** Override the spawned daemon process. Defaults to this package's own entry via `tsx`. */
	command?: DaemonCommand;
	/** Injectable for tests — avoids spawning a real process. */
	spawnFn?: SpawnDaemonFn;
	/** Injectable probe for tests — avoids touching a real socket. */
	probeFn?: (path: string) => Promise<boolean>;
}

export interface DaemonAttachment {
	socketPath: string;
	/** `true` when this call spawned a new daemon; `false` when it attached to one already listening. */
	spawned: boolean;
}

/**
 * Attach to `binding`'s daemon, spawning one first if none is listening.
 * A socket FILE that exists but refuses connections (a crashed daemon's
 * leftover) is unlinked before respawning — never mistaken for "already
 * running".
 */
export async function ensureDaemon(
	binding: SessionBinding,
	options: EnsureDaemonOptions = {},
): Promise<DaemonAttachment> {
	const path = options.socketPath ?? deriveSocketPath(binding);
	const probe =
		options.probeFn ??
		((p: string) => probeSocket(p, options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS));

	if (await probe(path)) {
		return { socketPath: path, spawned: false };
	}

	await unlinkStaleSocket(path, probe);
	spawnDaemonProcess(binding, path, options);
	await waitForReady(
		path,
		probe,
		options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS,
		options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
	);
	return { socketPath: path, spawned: true };
}

/** Connect-probe a unix socket path. `false` covers both "no file" and "file present, nobody listening". */
export function probeSocket(path: string, timeoutMs = DEFAULT_PROBE_TIMEOUT_MS): Promise<boolean> {
	if (!existsSync(path)) return Promise.resolve(false);
	return new Promise((resolve) => {
		const socket = net.createConnection(path);
		let settled = false;
		const finish = (result: boolean): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.removeAllListeners();
			socket.destroy();
			resolve(result);
		};
		const timer = setTimeout(() => finish(false), timeoutMs);
		socket.once("connect", () => finish(true));
		socket.once("error", () => finish(false));
	});
}

async function unlinkStaleSocket(
	path: string,
	probe: (p: string) => Promise<boolean>,
): Promise<void> {
	if (!existsSync(path)) return;
	// Re-probe: a concurrent `ensureDaemon` caller may have started listening
	// between our own probe above and this call.
	if (await probe(path)) return;
	try {
		unlinkSync(path);
	} catch (err) {
		if ((err as NodeJS.ErrnoException)?.code !== "ENOENT") throw err;
	}
}

function spawnDaemonProcess(
	binding: SessionBinding,
	socketPathValue: string,
	options: EnsureDaemonOptions,
): void {
	ensureParentDir(socketPathValue);
	const log = deriveLogPath(binding);
	ensureParentDir(log);
	const logFd = openSync(log, "a");
	try {
		const spawnFn = options.spawnFn ?? defaultSpawnFn;
		const command = options.command ?? { command: DEFAULT_DAEMON_BIN, args: [] };
		// `...process.env` is the spawn-time config snapshot (#2003): the child
		// inherits `SPELLKAVE_RUN_EVENTS`, `CAMPAIGN_ARTIFACTS_ROOT`,
		// `SPELLKAVE_AGENT_OBS_OTLP_ENDPOINT`, and the standard `OTEL_EXPORTER_OTLP_*`
		// vars exactly as they read HERE, once, never re-read afterward — a
		// binding-keyed daemon's env is fixed at spawn; changing observability
		// config means `sk session stop` + respawn, same as any other daemon env.
		const env: NodeJS.ProcessEnv = {
			...process.env,
			[BINDING_ENV]: JSON.stringify(binding),
			[SOCKET_ENV]: socketPathValue,
			...(options.token === undefined ? {} : { [TOKEN_ENV]: options.token }),
			...(options.worldSlug?.trim() ? { [WORLD_SLUG_ENV]: options.worldSlug.trim() } : {}),
			...(options.idleTimeoutMs === undefined
				? {}
				: { [IDLE_TIMEOUT_ENV]: String(options.idleTimeoutMs) }),
		};
		const child = spawnFn(command.command, command.args, {
			detached: true,
			stdio: ["ignore", logFd, logFd],
			env,
		});
		child.unref();
	} finally {
		closeSync(logFd);
	}
}

function defaultSpawnFn(
	command: string,
	args: string[],
	options: { detached: boolean; stdio: ["ignore", number, number]; env: NodeJS.ProcessEnv },
): ChildProcess {
	return spawnChildProcess(command, args, options);
}

async function waitForReady(
	path: string,
	probe: (p: string) => Promise<boolean>,
	timeoutMs: number,
	intervalMs: number,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	// Sequential polling is the point here — each iteration must observe the
	// previous probe's outcome before retrying.
	while (Date.now() < deadline) {
		if (await probe(path)) return;
		await delay(intervalMs);
	}
	throw new Error(
		`session daemon did not become ready within ${timeoutMs}ms (socket: ${path}). ` +
			"It may still be starting; check the daemon log next to the socket.",
	);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Env var names `daemon-entry.ts` reads — exported so tests/spawn stay in sync with the entry point. */
export const DAEMON_ENV = {
	binding: BINDING_ENV,
	socket: SOCKET_ENV,
	token: TOKEN_ENV,
	worldSlug: WORLD_SLUG_ENV,
	idleTimeoutMs: IDLE_TIMEOUT_ENV,
} as const;
