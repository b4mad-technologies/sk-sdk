// `sk session list` shows the background session daemons that player
// commands start, and `sk session stop` ends one or all of them. These tests
// start real daemon sockets (fake tool registry) in a temp
// XDG_RUNTIME_DIR, the same place `sk` looks, and check listing, stale
// sockets, and each way to choose what to stop. No node.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { SessionBinding } from "@spellkave/session";
import { serveDaemon, socketPath } from "@spellkave/session/node";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import { collect } from "./helpers.ts";

function parseAll(lines: string[]): Record<string, unknown>[] {
	return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("sk session", () => {
	let dir: string;
	const savedXdg = process.env.XDG_RUNTIME_DIR;
	const savedUrl = process.env.SPELLKAVE_URL;
	const savedDb = process.env.SPELLKAVE_DB;
	const savedActor = process.env.SPELLKAVE_ACTOR;
	const savedToken = process.env.SPELLKAVE_CONNECT_TOKEN;
	const savedConfigPath = process.env.SPACETIME_CONFIG_PATH;

	beforeEach(() => {
		// `/tmp`, deliberately NOT `os.tmpdir()`: `socketPath()` derives
		// `<XDG_RUNTIME_DIR>/spellkave/session-<hash12>.sock` — macOS's own
		// `os.tmpdir()` (`/var/folders/<random>/T`) is already long enough that
		// this nesting overflows `sockaddr_un`'s ~104-byte `sun_path` (`listen
		// EINVAL`). `/tmp` keeps the literal path short regardless of platform.
		dir = mkdtempSync(join("/tmp", "sk-rt-"));
		process.env.XDG_RUNTIME_DIR = dir;
		delete process.env.SPELLKAVE_URL;
		delete process.env.SPELLKAVE_DB;
		delete process.env.SPELLKAVE_ACTOR;
		delete process.env.SPELLKAVE_CONNECT_TOKEN;
		delete process.env.SPACETIME_CONFIG_PATH;
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
		for (const [key, value] of [
			["XDG_RUNTIME_DIR", savedXdg],
			["SPELLKAVE_URL", savedUrl],
			["SPELLKAVE_DB", savedDb],
			["SPELLKAVE_ACTOR", savedActor],
			["SPELLKAVE_CONNECT_TOKEN", savedToken],
			["SPACETIME_CONFIG_PATH", savedConfigPath],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("rejects an unknown subcommand as a usage error", async () => {
		const io = collect();
		const code = await runCli(["session", "bogus"], io.io);

		expect(code).toBe(EXIT_USAGE);
		expect(parseAll(io.out)[0]?.scope).toBe("usage");
	});

	describe("list", () => {
		it("emits nothing against an empty run dir", async () => {
			const io = collect();
			const code = await runCli(["session", "list"], io.io);

			expect(code).toBe(EXIT_OK);
			expect(io.out).toEqual([]);
		});

		it("turns an empty human list into a player-session onramp", async () => {
			const io = collect({ stdoutIsTTY: true });
			const code = await runCli(["session", "list"], io.io);

			expect(code).toBe(EXIT_OK);
			const text = io.out.join("\n");
			expect(text).toContain("No player sessions are running.");
			expect(text).toContain("starts automatically");
			expect(text).toContain("sk --profile PLAYER_PROFILE scene");
		});

		it("reports a live daemon's status and a stale socket file separately", async () => {
			const binding: SessionBinding = {
				url: "http://127.0.0.1:4001",
				db: "spellkave-test",
				identity: "anonymous",
				actorId: "hero-1",
			};
			const livePath = socketPath(binding);
			const handle = await serveDaemon({ binding, tools: [], socketPath: livePath });
			// A socket FILE with nobody listening — a crashed daemon's leftover.
			const staleBinding: SessionBinding = { ...binding, actorId: "hero-2" };
			const stalePath = socketPath(staleBinding);
			writeFileSync(stalePath, "");

			try {
				const io = collect();
				const code = await runCli(["session", "list"], io.io);

				expect(code).toBe(EXIT_OK);
				const lines = parseAll(io.out);
				expect(lines).toHaveLength(2);

				const live = lines.find((l) => l.socket === livePath);
				expect(live).toMatchObject({ kind: "session", status: "live", socket: livePath, binding });
				expect(typeof live?.uptimeMs).toBe("number");
				expect(live?.subscribed).toBe(true);

				const stale = lines.find((l) => l.socket === stalePath);
				expect(stale).toMatchObject({ kind: "session", status: "stale", socket: stalePath });
			} finally {
				await handle.close();
			}
		});
	});

	it("shows an existing connected session in the bare quick start", async () => {
		const binding: SessionBinding = {
			url: "http://127.0.0.1:4001",
			db: "spellkave-test",
			identity: "anonymous",
			actorId: "hero-1",
		};
		const path = socketPath(binding);
		const handle = await serveDaemon({ binding, tools: [], socketPath: path });

		try {
			const io = collect();
			const code = await runCli([], io.io);

			expect(code).toBe(EXIT_OK);
			expect(io.err.join("\n")).toContain("Player sessions: 1 connected");
			expect(io.err.join("\n")).toContain("hero-1 @ spellkave-test");
		} finally {
			await handle.close();
		}
	});

	describe("stop", () => {
		it("stops a live daemon by its socket-filename hash and tears it down", async () => {
			const binding: SessionBinding = {
				url: "http://127.0.0.1:4001",
				db: "spellkave-test",
				identity: "anonymous",
				actorId: "hero-1",
			};
			const path = socketPath(binding);
			const onClose = vi.fn();
			await serveDaemon({ binding, tools: [], socketPath: path, onClose });
			const hash = path.slice(path.lastIndexOf("session-") + "session-".length, -".sock".length);

			const io = collect();
			const code = await runCli(["session", "stop", hash], io.io);

			expect(code).toBe(EXIT_OK);
			expect(parseAll(io.out)[0]).toMatchObject({
				kind: "session",
				status: "stopped",
				socket: path,
			});
			await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
			expect(existsSync(path)).toBe(false);
		});

		it("stops every live daemon under --all", async () => {
			const bindingA: SessionBinding = {
				url: "http://127.0.0.1:4001",
				db: "spellkave-test",
				identity: "anonymous",
				actorId: "hero-a",
			};
			const bindingB: SessionBinding = { ...bindingA, actorId: "hero-b" };
			const pathA = socketPath(bindingA);
			const pathB = socketPath(bindingB);
			const onCloseA = vi.fn();
			const onCloseB = vi.fn();
			await serveDaemon({ binding: bindingA, tools: [], socketPath: pathA, onClose: onCloseA });
			await serveDaemon({ binding: bindingB, tools: [], socketPath: pathB, onClose: onCloseB });

			const io = collect();
			const code = await runCli(["session", "stop", "--all"], io.io);

			expect(code).toBe(EXIT_OK);
			const statuses = parseAll(io.out).map((l) => l.status);
			expect(statuses).toEqual(["stopped", "stopped"]);
			await vi.waitFor(() => {
				expect(onCloseA).toHaveBeenCalledOnce();
				expect(onCloseB).toHaveBeenCalledOnce();
			});
		});

		it("derives the target from --actor/SPELLKAVE_URL/SPELLKAVE_DB when no selector is given", async () => {
			process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
			process.env.SPELLKAVE_DB = "spellkave-test";
			const binding: SessionBinding = {
				url: process.env.SPELLKAVE_URL,
				db: process.env.SPELLKAVE_DB,
				identity: "anonymous",
				actorId: "hero-1",
			};
			const path = socketPath(binding);
			const onClose = vi.fn();
			await serveDaemon({ binding, tools: [], socketPath: path, onClose });

			const io = collect();
			const code = await runCli(["--actor", "hero-1", "session", "stop"], io.io);

			expect(code).toBe(EXIT_OK);
			expect(parseAll(io.out)[0]).toMatchObject({
				kind: "session",
				status: "stopped",
				socket: path,
			});
			await vi.waitFor(() => expect(onClose).toHaveBeenCalledOnce());
		});

		it("reports a stale/nonexistent selector as stale rather than failing", async () => {
			const io = collect();
			const code = await runCli(["session", "stop", "does-not-exist"], io.io);

			expect(code).toBe(EXIT_OK);
			expect(parseAll(io.out)[0]?.status).toBe("stale");
		});
	});
});
