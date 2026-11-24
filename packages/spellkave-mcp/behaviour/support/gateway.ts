// One PLAYER MCP gateway per scenario, started the way a deployment starts it:
// the real runtime entry (src/runtime-main.ts, bundled once by setup.ts, or
// the real bin/spellkave-player-mcp.js for the @launcher scenario) with its
// configuration in the environment and nothing else. The scenario talks to it
// only over HTTP (curl, steps.ts) and reads only what it answers and logs.
//
// The world it points at:
// - WORKOS_ISSUER is a fake issuer (fake-issuer.ts) on its own port;
// - SPELLKAVE_MCP_WORLD_URL is a closed port, so every seat probe fails at
//   once and every player is a player without a hero (a seat needs a live
//   SpacetimeDB subscription, which no offline fake can answer);
// - the catalog holds one public world `elven-mini-1` and one private world
//   `private-1`; the public one has a transcript on disk.
// The listen port is ephemeral, which runtime.ts allows only for a loopback
// canonical origin. Trust boundary `network-policy` lets the world URL point
// at the closed port instead of the fixed 127.0.0.1:3000, where a developer's
// own local node may be listening.
//
// The environment is built from scratch: no SPELLKAVE_*, WORKOS_*, OTEL_* or
// XDG_* of the developer's shell reaches the gateway, and HOME is the
// scenario's temp dir, so no local cli.toml or state file is read or written.

import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const PKG = resolve(import.meta.dirname, "../..");
export const REPO = resolve(PKG, "../..");
/** The runtime bundle setup.ts builds once per run. */
export const BUNDLE = join(PKG, "behaviour/.bin/spellkave-player-mcp.mjs");
/** The health-check bundle setup.ts builds once per run. */
export const HEALTH_BUNDLE = join(PKG, "behaviour/.bin/spellkave-player-mcp-health.mjs");
export const LAUNCHER = join(PKG, "bin/spellkave-player-mcp.js");
/** @spellkave/world-map loads vt-pbf through its own createRequire, which a bundle cannot follow. */
const NODE_PATH = join(PKG, "../spellkave-world-map/node_modules");
/** Port 9 (discard) is closed on a developer machine and a CI runner alike. */
const CLOSED_WORLD_URL = "http://127.0.0.1:9";
/** A tsx start on a cold cache takes a few seconds; the step timeout is 20 s. */
const READY_WITHIN_MS = 15_000;
/** The runtime stops in milliseconds; a hang gets a SIGKILL and a line in the log. */
const STOP_WITHIN_MS = 5_000;
export const PUBLIC_WORLD = "elven-mini-1";
export const PRIVATE_WORLD = "private-1";

export interface Gateway {
	/** `http://127.0.0.1:<port>`: the canonical origin and where it listens. */
	readonly origin: string;
	readonly dir: string;
	/** The environment it was started with, for the health check. */
	readonly env: Record<string, string>;
	/** Everything the gateway wrote to stderr (ready line, operations log). */
	stderr(): string;
	/** Sends SIGTERM and resolves with the exit code. */
	stop(): Promise<number | null>;
}

export async function freePort(): Promise<number> {
	return new Promise((done, fail) => {
		const probe = createServer();
		probe.once("error", fail);
		probe.listen(0, "127.0.0.1", () => {
			const address = probe.address();
			const port = typeof address === "object" && address !== null ? address.port : 0;
			probe.close(() => done(port));
		});
	});
}

function writeWorld(dir: string): { catalog: string; transcripts: string } {
	const world = (slug: string, visibility: "public" | "private") => ({
		slug,
		display_name: slug,
		adventure: "elven-mini",
		db: `spellkave-${slug}`,
		status: "running",
		visibility,
		owner: "user_owner",
		members: [],
		join_policy: "open",
	});
	const catalog = join(dir, "worlds.catalog.json");
	writeFileSync(
		catalog,
		JSON.stringify({
			v: "player-world-catalog/v1",
			worlds: [world(PUBLIC_WORLD, "public"), world(PRIVATE_WORLD, "private")],
		}),
	);
	const transcripts = join(dir, "transcripts");
	mkdirSync(join(transcripts, PUBLIC_WORLD), { recursive: true });
	writeFileSync(
		join(transcripts, PUBLIC_WORLD, "agent-run-events.jsonl"),
		`${JSON.stringify({ type: "tool_call", data: { tool_name: "spellkave_orient" } })}\n`,
	);
	return { catalog, transcripts };
}

export function gatewayEnv(dir: string, issuer: string, port: number): Record<string, string> {
	const { catalog, transcripts } = writeWorld(dir);
	const origin = `http://127.0.0.1:${port}`;
	return {
		// The launcher's `#!/usr/bin/env tsx` needs tsx and node on PATH.
		PATH: [
			join(PKG, "node_modules/.bin"),
			join(REPO, "node_modules/.bin"),
			dirname(process.execPath),
			"/usr/bin",
			"/bin",
		].join(":"),
		HOME: dir,
		NODE_PATH,
		SPELLKAVE_MCP_TRUST_BOUNDARY: "network-policy",
		SPELLKAVE_MCP_CANONICAL_ORIGIN: origin,
		SPELLKAVE_MCP_LISTEN_HOST: "127.0.0.1",
		SPELLKAVE_MCP_LISTEN_PORT: String(port),
		SPELLKAVE_MCP_WORLD_URL: CLOSED_WORLD_URL,
		SPELLKAVE_WORLD_CATALOG: catalog,
		SPELLKAVE_MCP_PUBLIC_TRANSCRIPT_DIR: transcripts,
		WORKOS_ISSUER: issuer,
	};
}

/** Starts a gateway and waits for its ready line; rejects with its stderr if it exits first. */
export async function startGateway(
	issuer: string,
	options: { launcher?: boolean; env?: Record<string, string> } = {},
): Promise<Gateway> {
	const dir = mkdtempSync(join(tmpdir(), "player-mcp-behaviour-"));
	const port = await freePort();
	const env = { ...gatewayEnv(dir, issuer, port), ...options.env };
	const child: ChildProcess = options.launcher
		? spawn(LAUNCHER, [], { cwd: dir, env })
		: spawn(process.execPath, [BUNDLE], { cwd: dir, env });
	let stderr = "";
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => {
		stderr += chunk;
	});
	child.stdout?.resume();
	const exited = new Promise<number | null>((done) => child.once("close", (code) => done(code)));
	const started = Date.now();
	await new Promise<void>((ready, fail) => {
		const timer = setInterval(() => {
			if (stderr.includes("spellkave-player-mcp: ready")) {
				clearInterval(timer);
				ready();
			} else if (Date.now() - started > READY_WITHIN_MS) {
				// Fail with what the gateway said, before the step timeout hides it.
				clearInterval(timer);
				child.kill("SIGKILL");
				fail(new Error(`gateway not ready within ${READY_WITHIN_MS} ms:\n${stderr}`));
			}
		}, 10);
		void exited.then((code) => {
			clearInterval(timer);
			fail(new Error(`gateway exited ${code} before it was ready:\n${stderr}`));
		});
	});
	let stopped: Promise<number | null> | undefined;
	return {
		origin: `http://127.0.0.1:${port}`,
		dir,
		env,
		stderr: () => stderr,
		stop() {
			if (stopped === undefined) {
				child.kill("SIGTERM");
				const deadline = setTimeout(() => {
					stderr += `[suite] no exit within ${STOP_WITHIN_MS} ms of SIGTERM; sent SIGKILL\n`;
					child.kill("SIGKILL");
				}, STOP_WITHIN_MS);
				stopped = exited.finally(() => {
					clearTimeout(deadline);
					rmSync(dir, { recursive: true, force: true });
				});
			}
			return stopped;
		},
	};
}
