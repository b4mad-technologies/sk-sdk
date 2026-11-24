// A player acts in the world with `sk <player tool>` (scene, move, ...).
// Each call goes through a background session daemon that holds the
// connection, so these tests drive a real daemon socket with a fake tool
// registry: arguments, results, refusals, events pushed by the world and
// `sk events --drain`. The real world connector is stubbed to throw, so a
// call that bypasses the daemon fails. No node.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type InvokableTool,
	type SessionWorldEventFeed,
	serveDaemon,
} from "@spellkave/session/node";
import { PLAYER_TOOL_NAMES as PLAYER_FACING_TOOL_NAMES } from "@spellkave/tool-contracts";
import type { WorldEvent } from "@spellkave/tool-runtime";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	type ConnectLive,
	type EnsureDaemon,
	EXIT_IN_WORLD,
	EXIT_OK,
	EXIT_USAGE,
	runCli,
} from "../cli.ts";
import { collect } from "./helpers.ts";

// Real PLAYER tool with the simplest schema (every parameter optional) — lets
// a case call it with no flags. Its SERVER-side stand-in below is a fake
// (`InvokableTool`) with the SAME name; `sk`'s own client-side arg validation
// still runs against the REAL registry schema (`playerFacingToolDefinitions`).
const SCENE_TOOL = PLAYER_FACING_TOOL_NAMES.find((name) => name.endsWith("_scene"));
if (SCENE_TOOL === undefined) {
	throw new Error("expected a *_scene PLAYER tool in the registry for this test's fixture");
}

const unreachableConnectLive: ConnectLive = async () => {
	throw new Error("connectLive must not be called for a PLAYER tool");
};

function parseOnly(lines: string[]): Record<string, unknown> {
	expect(lines).toHaveLength(1);
	return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

function parseAll(lines: string[]): Record<string, unknown>[] {
	return lines.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("sk <player tool>", () => {
	const savedUrl = process.env.SPELLKAVE_URL;
	const savedDb = process.env.SPELLKAVE_DB;
	const savedActor = process.env.SPELLKAVE_ACTOR;
	const savedToken = process.env.SPELLKAVE_CONNECT_TOKEN;
	const savedConfigPath = process.env.SPACETIME_CONFIG_PATH;
	const savedHome = process.env.SPELLKAVE_HOME;
	let profileHome: string;

	beforeEach(() => {
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		process.env.SPELLKAVE_DB = "spellkave-test";
		delete process.env.SPELLKAVE_ACTOR;
		delete process.env.SPELLKAVE_CONNECT_TOKEN;
		delete process.env.SPACETIME_CONFIG_PATH;
		// The #2002 last-used-profile fallback (`resolveBinding`) only fires
		// when the plain env chain is incomplete — several cases below
		// deliberately unset SPELLKAVE_URL/leave the actor unset to hit that
		// path, so this MUST point at an empty temp config root rather than a
		// developer's real `$HOME`, or these assertions would depend on
		// whatever profile state happens to exist on the machine running them.
		profileHome = mkdtempSync(join(tmpdir(), "sk-player-home-"));
		process.env.SPELLKAVE_HOME = profileHome;
	});

	afterEach(() => {
		rmSync(profileHome, { recursive: true, force: true });
		for (const [key, value] of [
			["SPELLKAVE_URL", savedUrl],
			["SPELLKAVE_DB", savedDb],
			["SPELLKAVE_ACTOR", savedActor],
			["SPELLKAVE_CONNECT_TOKEN", savedToken],
			["SPACETIME_CONFIG_PATH", savedConfigPath],
			["SPELLKAVE_HOME", savedHome],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("fails loudly naming SPELLKAVE_URL, before ever trying to attach a daemon", async () => {
		delete process.env.SPELLKAVE_URL;
		const io = collect();

		const code = await runCli(["--actor", "hero-1", "scene"], io.io);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.scope).toBe("usage");
		expect(payload.message).toContain("SPELLKAVE_URL");
	});

	it("fails loudly naming --actor/SPELLKAVE_ACTOR when neither is set", async () => {
		const io = collect();

		const code = await runCli(["scene"], io.io);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.scope).toBe("usage");
		expect(payload.message).toContain("--actor");
		expect(payload.message).toContain("SPELLKAVE_ACTOR");
	});

	describe("against a real daemon socket (fake tool registry, no live node)", () => {
		let dir: string;
		let socketPath: string;

		beforeEach(() => {
			dir = mkdtempSync(join(tmpdir(), "sk-player-daemon-"));
			socketPath = join(dir, "session.sock");
		});

		afterEach(() => {
			rmSync(dir, { recursive: true, force: true });
		});

		function fakeTool(execute: InvokableTool["execute"]): InvokableTool {
			return {
				name: SCENE_TOOL as string,
				parameters: Type.Object({
					kind: Type.Optional(Type.String()),
					limit: Type.Optional(Type.Number()),
					cursor: Type.Optional(Type.String()),
				}),
				execute,
			};
		}

		it("attaches via an explicit command override — never the default tsx-shebang spawn target", async () => {
			const calls: unknown[] = [];
			await serveDaemon({
				binding: { url: "x", db: "x", identity: "x", actorId: "x" },
				tools: [fakeTool(async () => ({ content: [{ type: "text", text: "ok" }], details: {} }))],
				socketPath,
			});
			const ensureDaemonFn: EnsureDaemon = async (_binding, options) => {
				calls.push(options?.command);
				return { socketPath, spawned: false };
			};

			const code = await runCli(
				["--actor", "hero-1", "scene"],
				collect().io,
				unreachableConnectLive,
				ensureDaemonFn,
			);

			expect(code).toBe(EXIT_OK);
			expect(calls).toHaveLength(1);
			const command = calls[0] as { command: string; args: string[] } | undefined;
			expect(command).toBeDefined();
			// The flagged gap (`DEFAULT_DAEMON_BIN`'s own doc comment,
			// `@spellkave/session/node`'s `spawn.ts`): the default spawn target
			// relies on `/usr/bin/env tsx` finding `tsx` on the CHILD's PATH. The
			// explicit override runs `node <resolved tsx/cli> <resolved daemon
			// bin>` instead — `command` is the node binary itself, never a bare
			// `tsx`/shebang'd path a PATH lookup could fail to resolve.
			expect(command?.command).toBe(process.execPath);
			expect(command?.args).toHaveLength(2);
			expect(command?.args[1]).toMatch(/spellkave-session-daemon\.js$/);
			for (const path of command?.args ?? []) expect(existsSync(path)).toBe(true);
		});

		it("round-trips a successful invoke as the same tool_result shape AUTHOR tools use", async () => {
			await serveDaemon({
				binding: { url: "x", db: "x", identity: "x", actorId: "x" },
				tools: [
					fakeTool(async (_id, params) => ({
						content: [{ type: "text", text: "scene" }],
						details: { echoed: params },
					})),
				],
				socketPath,
			});
			const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });
			const io = collect();

			const code = await runCli(
				["--actor", "hero-1", "scene", "--kind", "exit"],
				io.io,
				unreachableConnectLive,
				ensureDaemonFn,
			);

			expect(code).toBe(EXIT_OK);
			const payload = parseOnly(io.out) as {
				kind: string;
				tool: string;
				ok: boolean;
				text: string;
				details: unknown;
			};
			expect(payload.kind).toBe("tool_result");
			expect(payload.tool).toBe(SCENE_TOOL);
			expect(payload.ok).toBe(true);
			expect(payload.text).toBe("scene");
			expect(payload.details).toEqual({ echoed: { kind: "exit" } });
		});

		it("maps an in-world rejection ({ ok: false } details) to EXIT_IN_WORLD", async () => {
			await serveDaemon({
				binding: { url: "x", db: "x", identity: "x", actorId: "x" },
				tools: [
					fakeTool(async () => ({
						content: [{ type: "text", text: "refused" }],
						details: { ok: false, reason: "stale_handle" },
					})),
				],
				socketPath,
			});
			const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });
			const io = collect();

			const code = await runCli(
				["--actor", "hero-1", "scene"],
				io.io,
				unreachableConnectLive,
				ensureDaemonFn,
			);

			expect(code).toBe(EXIT_IN_WORLD);
			expect(parseOnly(io.out).ok).toBe(false);
		});

		it("maps a throwing tool body to a usage/infra error (daemon's own tool_error code)", async () => {
			await serveDaemon({
				binding: { url: "x", db: "x", identity: "x", actorId: "x" },
				tools: [
					fakeTool(async () => {
						throw new Error("kaboom");
					}),
				],
				socketPath,
			});
			const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });
			const io = collect();

			const code = await runCli(
				["--actor", "hero-1", "scene"],
				io.io,
				unreachableConnectLive,
				ensureDaemonFn,
			);

			expect(code).toBe(EXIT_USAGE);
			const payload = parseOnly(io.out);
			expect(payload.scope).toBe("infra");
			expect(payload.message).toBe("kaboom");
		});

		it("rejects bad client-side args before ever attaching to a daemon", async () => {
			const calls: unknown[] = [];
			const ensureDaemonFn: EnsureDaemon = async () => {
				calls.push(true);
				return { socketPath, spawned: false };
			};
			const io = collect();

			// `--limit` is schema-typed `number`; this is not a valid number.
			const code = await runCli(
				["--actor", "hero-1", "scene", "--limit", "not-a-number"],
				io.io,
				unreachableConnectLive,
				ensureDaemonFn,
			);

			expect(code).toBe(EXIT_USAGE);
			expect(calls).toHaveLength(0);
		});

		it("prints piggybacked WorldEvents as extra kind:push JSONL lines after the tool_result", async () => {
			const dealt: WorldEvent = {
				kind: "dealt_hit",
				target_name: "Slime Scout",
				amount: 3,
				attacker_id: "hero-1",
				observed_at_tick: 17,
			};
			const feed: SessionWorldEventFeed = {
				drain: () => [dealt],
				// sk-0m4.73: `builder` is part of the interface (the daemon injects it
				// into the companion tools' reply-window option) but this case only
				// exercises `drain()` — a stub is enough to satisfy the type.
				builder: { diffAndAdvance: () => [dealt], takeWhere: () => [] },
			};
			await serveDaemon({
				binding: { url: "x", db: "x", identity: "x", actorId: "x" },
				tools: [
					fakeTool(async () => ({
						content: [{ type: "text", text: "scene" }],
						details: {},
					})),
				],
				socketPath,
				pushes: feed,
			});
			const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });
			const io = collect();

			const code = await runCli(
				["--actor", "hero-1", "scene"],
				io.io,
				unreachableConnectLive,
				ensureDaemonFn,
			);

			expect(code).toBe(EXIT_OK);
			const lines = parseAll(io.out);
			expect(lines).toHaveLength(2);
			expect(lines[0]).toMatchObject({ kind: "tool_result", text: "scene", ok: true });
			expect(lines[1]).toMatchObject({
				kind: "push",
				event: dealt,
				text: "🌍 You hit Slime Scout for 3 damage.",
			});
		});

		// sk-0m4.74: `consequences` rides inside the tool's own `details` (unlike
		// `pushes`, which is the daemon's separate piggyback) — `runPlayerTool`
		// takes it off `result.details.consequences` and emits it as its own
		// `kind: "consequence"` line, BEFORE any `kind: "push"` lines from the
		// SAME response.
		it("prints an act tool's consequences as extra kind:consequence JSONL lines, before any push lines", async () => {
			const dealt: WorldEvent = {
				kind: "dealt_hit",
				target_name: "Slime Scout",
				amount: 3,
				attacker_id: "hero-1",
				observed_at_tick: 17,
			};
			const turnPush: WorldEvent = {
				kind: "turn_transition",
				session_id: "5",
				from_actor: "hero-1",
				to_actor: "npc-2",
				observed_at_tick: 17,
			};
			const feed: SessionWorldEventFeed = {
				drain: () => [turnPush],
				builder: { diffAndAdvance: () => [turnPush], takeWhere: () => [] },
			};
			await serveDaemon({
				binding: { url: "x", db: "x", identity: "x", actorId: "x" },
				tools: [
					fakeTool(async () => ({
						content: [{ type: "text", text: "act" }],
						details: { consequences: [dealt] },
					})),
				],
				socketPath,
				pushes: feed,
			});
			const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });
			const io = collect();

			const code = await runCli(
				["--actor", "hero-1", "scene"],
				io.io,
				unreachableConnectLive,
				ensureDaemonFn,
			);

			expect(code).toBe(EXIT_OK);
			const lines = parseAll(io.out);
			expect(lines).toHaveLength(3);
			expect(lines[0]).toMatchObject({ kind: "tool_result", text: "act", ok: true });
			expect(lines[1]).toMatchObject({
				kind: "consequence",
				event: dealt,
				text: "🌍 You hit Slime Scout for 3 damage.",
			});
			expect(lines[2]).toMatchObject({ kind: "push", event: turnPush });
		});

		it("sk events --drain emits only the pending push lines", async () => {
			const xp: WorldEvent = {
				kind: "xp_gained",
				amount: 50,
				new_value: 50,
				observed_at_tick: 22,
			};
			const feed: SessionWorldEventFeed = {
				drain: () => [xp],
				builder: { diffAndAdvance: () => [xp], takeWhere: () => [] },
			};
			await serveDaemon({
				binding: { url: "x", db: "x", identity: "x", actorId: "x" },
				tools: [],
				socketPath,
				pushes: feed,
			});
			const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });
			const io = collect();

			const code = await runCli(
				["--actor", "hero-1", "events", "--drain"],
				io.io,
				unreachableConnectLive,
				ensureDaemonFn,
			);

			expect(code).toBe(EXIT_OK);
			expect(parseAll(io.out)).toEqual([
				{
					kind: "push",
					event: xp,
					text: "🌍 You gain 50 experience — now at 50.",
				},
			]);
		});

		it("sk events without --drain is a usage error", async () => {
			const io = collect();
			const code = await runCli(
				["--actor", "hero-1", "events"],
				io.io,
				unreachableConnectLive,
				async () => {
					throw new Error("must not attach a daemon");
				},
			);
			expect(code).toBe(EXIT_USAGE);
			expect(parseOnly(io.out).scope).toBe("usage");
		});
	});
});
