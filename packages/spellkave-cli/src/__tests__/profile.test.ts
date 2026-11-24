// A person or agent keeps connection settings (world URL, database, actor,
// token) in a named profile and selects it with `sk --profile <name>`, as
// Pi does. These tests check precedence (`--actor` over `--profile` over the
// environment), the fallback to the last used profile, loud errors instead
// of a silent wrong world, and that remembering the profile never fails a
// call. Real profile TOML in a temp SPELLKAVE_HOME; no node.
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readLastUsedProfile, resolveCliPaths, writeLastUsedProfile } from "@spellkave/sdk/node";
import { type InvokableTool, serveDaemon } from "@spellkave/session/node";
import { PLAYER_TOOL_NAMES as PLAYER_FACING_TOOL_NAMES } from "@spellkave/tool-contracts";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ConnectLive, type EnsureDaemon, EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import { collect } from "./helpers.ts";

const SCENE_TOOL = PLAYER_FACING_TOOL_NAMES.find((name) => name.endsWith("_scene"));
if (SCENE_TOOL === undefined) {
	throw new Error("expected a *_scene PLAYER tool in the registry for this test's fixture");
}

const unreachableConnectLive: ConnectLive = async () => {
	throw new Error("connectLive must not be called for a PLAYER tool");
};

const unreachableEnsureDaemon: EnsureDaemon = async () => {
	throw new Error("ensureDaemon must not be called once resolution has already failed");
};

function sha256Hex(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

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

function writeProfile(
	configRoot: string,
	name: string,
	opts: { url: string; db: string; actor: string; tokenEnvVar: string },
): void {
	mkdirSync(join(configRoot, "profiles"), { recursive: true });
	writeFileSync(
		join(configRoot, "profiles", `${name}.toml`),
		`[connection]\n` +
			`url = "${opts.url}"\n` +
			`db = "${opts.db}"\n` +
			`\n` +
			`[identity]\n` +
			`role = "watcher"\n` +
			`in_world_self = "${opts.actor}"\n` +
			`credential = { kind = "env_var", name = "${opts.tokenEnvVar}" }\n`,
		"utf8",
	);
}

function writeLastUsed(_stateRoot: string, name: string): void {
	writeLastUsedProfile(resolveCliPaths(), name);
}

describe("sk --profile", () => {
	let home: string;
	let configRoot: string;
	let stateRoot: string;
	let daemonDir: string;
	let socketPath: string;

	const savedHome = process.env.SPELLKAVE_HOME;
	const savedUrl = process.env.SPELLKAVE_URL;
	const savedDb = process.env.SPELLKAVE_DB;
	const savedActor = process.env.SPELLKAVE_ACTOR;
	const savedToken = process.env.SPELLKAVE_CONNECT_TOKEN;
	const savedConfigPath = process.env.SPACETIME_CONFIG_PATH;
	const savedTestToken = process.env.SK_TEST_TOKEN;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "sk-profile-home-"));
		process.env.SPELLKAVE_HOME = home;
		configRoot = join(home, "config");
		stateRoot = join(home, "state");
		delete process.env.SPELLKAVE_URL;
		delete process.env.SPELLKAVE_DB;
		delete process.env.SPELLKAVE_ACTOR;
		delete process.env.SPELLKAVE_CONNECT_TOKEN;
		delete process.env.SPACETIME_CONFIG_PATH;
		delete process.env.SK_TEST_TOKEN;
		daemonDir = mkdtempSync(join(tmpdir(), "sk-profile-daemon-"));
		socketPath = join(daemonDir, "session.sock");
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		rmSync(daemonDir, { recursive: true, force: true });
		for (const [key, value] of [
			["SPELLKAVE_HOME", savedHome],
			["SPELLKAVE_URL", savedUrl],
			["SPELLKAVE_DB", savedDb],
			["SPELLKAVE_ACTOR", savedActor],
			["SPELLKAVE_CONNECT_TOKEN", savedToken],
			["SPACETIME_CONFIG_PATH", savedConfigPath],
			["SK_TEST_TOKEN", savedTestToken],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("resolves an explicit --profile end-to-end into a binding (url/db/actor/token/identity)", async () => {
		writeProfile(configRoot, "kira", {
			url: "http://profile.example:9000",
			db: "profile-db",
			actor: "kira-01",
			tokenEnvVar: "SK_TEST_TOKEN",
		});
		process.env.SK_TEST_TOKEN = "tok-secret";
		await serveDaemon({
			binding: { url: "x", db: "x", identity: "x", actorId: "x" },
			tools: [fakeTool(async () => ({ content: [{ type: "text", text: "ok" }], details: {} }))],
			socketPath,
		});
		const bindings: unknown[] = [];
		const tokens: (string | undefined)[] = [];
		const ensureDaemonFn: EnsureDaemon = async (binding, options) => {
			bindings.push(binding);
			tokens.push(options?.token);
			return { socketPath, spawned: false };
		};
		const io = collect();

		const code = await runCli(
			["--profile", "kira", "scene"],
			io.io,
			unreachableConnectLive,
			ensureDaemonFn,
		);

		expect(code).toBe(EXIT_OK);
		expect(bindings).toEqual([
			{
				url: "http://profile.example:9000",
				db: "profile-db",
				identity: sha256Hex("tok-secret"),
				actorId: "kira-01",
			},
		]);
		expect(tokens).toEqual(["tok-secret"]);
	});

	describe("precedence: --actor > --profile > env chain", () => {
		beforeEach(() => {
			writeProfile(configRoot, "kira", {
				url: "http://profile.example:9000",
				db: "profile-db",
				actor: "kira-01",
				tokenEnvVar: "SK_TEST_TOKEN",
			});
			process.env.SK_TEST_TOKEN = "tok-secret";
		});

		async function attach(argv: string[]): Promise<{ actorId: string; url: string; db: string }> {
			await serveDaemon({
				binding: { url: "x", db: "x", identity: "x", actorId: "x" },
				tools: [fakeTool(async () => ({ content: [{ type: "text", text: "ok" }], details: {} }))],
				socketPath,
			});
			let captured: { actorId: string; url: string; db: string } | undefined;
			const ensureDaemonFn: EnsureDaemon = async (binding) => {
				captured = binding as never;
				return { socketPath, spawned: false };
			};
			const code = await runCli(argv, collect().io, unreachableConnectLive, ensureDaemonFn);
			expect(code).toBe(EXIT_OK);
			if (captured === undefined) throw new Error("ensureDaemonFn was never called");
			return captured;
		}

		it("an explicit --actor flag overrides the profile's identity.in_world_self", async () => {
			const { actorId } = await attach(["--profile", "kira", "--actor", "flag-actor", "scene"]);
			expect(actorId).toBe("flag-actor");
		});

		it("--profile's connection.{url,db} wins over the plain env chain", async () => {
			process.env.SPELLKAVE_URL = "http://env.example:1";
			process.env.SPELLKAVE_DB = "env-db";
			process.env.SPELLKAVE_ACTOR = "env-actor";
			const { url, db, actorId } = await attach(["--profile", "kira", "scene"]);
			expect(url).toBe("http://profile.example:9000");
			expect(db).toBe("profile-db");
			expect(actorId).toBe("kira-01");
		});

		it("without --profile, SPELLKAVE_URL and SPELLKAVE_DB from the environment still choose the world", async () => {
			process.env.SPELLKAVE_URL = "http://env.example:1";
			process.env.SPELLKAVE_DB = "env-db";
			process.env.SPELLKAVE_ACTOR = "env-actor";
			const { url, db, actorId } = await attach(["scene"]);
			expect(url).toBe("http://env.example:1");
			expect(db).toBe("env-db");
			expect(actorId).toBe("env-actor");
		});
	});

	it("an unknown --profile name is a loud usage error, never a silent fallback", async () => {
		const io = collect();

		const code = await runCli(
			["--profile", "ghost", "scene"],
			io.io,
			unreachableConnectLive,
			unreachableEnsureDaemon,
		);

		expect(code).toBe(EXIT_USAGE);
		const payload = JSON.parse(io.out[0] as string) as { scope: string; message: string };
		expect(payload.scope).toBe("usage");
		expect(payload.message).toContain("ghost");
	});

	it("a bare invocation with no --profile/env falls back to last_used_profile, announced on stderr", async () => {
		writeProfile(configRoot, "kira", {
			url: "http://profile.example:9000",
			db: "profile-db",
			actor: "kira-01",
			tokenEnvVar: "SK_TEST_TOKEN",
		});
		process.env.SK_TEST_TOKEN = "tok-secret";
		writeLastUsed(stateRoot, "kira");
		await serveDaemon({
			binding: { url: "x", db: "x", identity: "x", actorId: "x" },
			tools: [fakeTool(async () => ({ content: [{ type: "text", text: "ok" }], details: {} }))],
			socketPath,
		});
		const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });
		const io = collect();

		const code = await runCli(["scene"], io.io, unreachableConnectLive, ensureDaemonFn);

		expect(code).toBe(EXIT_OK);
		expect(io.err).toContain("sk: using profile 'kira' (last used)");
	});

	it("no profile, no env, no last-used state: loud usage error naming --profile among the remedies", async () => {
		const io = collect();

		const code = await runCli(["scene"], io.io, unreachableConnectLive, unreachableEnsureDaemon);

		expect(code).toBe(EXIT_USAGE);
		const payload = JSON.parse(io.out[0] as string) as { scope: string; message: string };
		expect(payload.scope).toBe("usage");
		expect(payload.message).toContain("SPELLKAVE_URL");
		expect(payload.message).toContain("--profile");
	});

	it("an actor-only gap (url resolvable, no profile) also names --profile as a remedy", async () => {
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		const io = collect();

		const code = await runCli(["scene"], io.io, unreachableConnectLive, unreachableEnsureDaemon);

		expect(code).toBe(EXIT_USAGE);
		const payload = JSON.parse(io.out[0] as string) as { scope: string; message: string };
		expect(payload.message).toContain("--actor");
		expect(payload.message).toContain("SPELLKAVE_ACTOR");
		expect(payload.message).toContain("--profile");
	});

	it("remembers an explicitly named --profile as last_used_profile after a successful use", async () => {
		writeProfile(configRoot, "kira", {
			url: "http://profile.example:9000",
			db: "profile-db",
			actor: "kira-01",
			tokenEnvVar: "SK_TEST_TOKEN",
		});
		process.env.SK_TEST_TOKEN = "tok-secret";
		await serveDaemon({
			binding: { url: "x", db: "x", identity: "x", actorId: "x" },
			tools: [fakeTool(async () => ({ content: [{ type: "text", text: "ok" }], details: {} }))],
			socketPath,
		});
		const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });

		const code = await runCli(
			["--profile", "kira", "scene"],
			collect().io,
			unreachableConnectLive,
			ensureDaemonFn,
		);

		expect(code).toBe(EXIT_OK);
		expect(readLastUsedProfile(resolveCliPaths())).toBe("kira");
	});

	it("a remember-on-use write failure is non-fatal — the tool call still succeeds", async () => {
		writeProfile(configRoot, "kira", {
			url: "http://profile.example:9000",
			db: "profile-db",
			actor: "kira-01",
			tokenEnvVar: "SK_TEST_TOKEN",
		});
		process.env.SK_TEST_TOKEN = "tok-secret";
		// A regular FILE where the state dir should be: `mkdirSync(..., {
		// recursive: true })` fails on it (EEXIST/ENOTDIR), exercising the
		// non-fatal write-failure path `rememberProfile` guards against.
		writeFileSync(stateRoot, "not a directory", "utf8");
		await serveDaemon({
			binding: { url: "x", db: "x", identity: "x", actorId: "x" },
			tools: [fakeTool(async () => ({ content: [{ type: "text", text: "ok" }], details: {} }))],
			socketPath,
		});
		const ensureDaemonFn: EnsureDaemon = async () => ({ socketPath, spawned: false });
		const io = collect();

		const code = await runCli(
			["--profile", "kira", "scene"],
			io.io,
			unreachableConnectLive,
			ensureDaemonFn,
		);

		expect(code).toBe(EXIT_OK);
		const payload = JSON.parse(io.out[0] as string) as { ok: boolean };
		expect(payload.ok).toBe(true);
	});

	it("sk list marks PLAYER tools available when only a last-used profile is resolvable", async () => {
		writeProfile(configRoot, "kira", {
			url: "http://profile.example:9000",
			db: "profile-db",
			actor: "kira-01",
			tokenEnvVar: "SK_TEST_TOKEN",
		});
		process.env.SK_TEST_TOKEN = "tok-secret";
		writeLastUsed(stateRoot, "kira");
		const io = collect();

		const code = await runCli(["list"], io.io);

		expect(code).toBe(EXIT_OK);
		const payload = JSON.parse(io.out[0] as string) as {
			tools: { facing: string; available: boolean; reason?: string }[];
		};
		const playerTools = payload.tools.filter((tool) => tool.facing === "player");
		expect(playerTools.length).toBeGreaterThan(0);
		expect(playerTools.every((tool) => tool.available)).toBe(true);
	});
});
