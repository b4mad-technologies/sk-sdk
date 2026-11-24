// `sk --live`, `sk get` and the other author commands must reach the world
// the author meant. The order is: `--profile`, then the environment, then
// this worktree's current context (`sk config use-context`), else a usage
// error that names every fix. These tests check that order, the warnings on
// stderr when one source overrides another, and the `sk config` context
// verbs. Each case writes real profile TOML in its own SPELLKAVE_HOME; no node.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localNodeProfileName } from "@spellkave/sdk";
import * as sdkNode from "@spellkave/sdk/node";
import {
	currentWorktreeRoot,
	resolveCliPaths,
	writeCurrentContext,
	writeLastUsedProfile,
} from "@spellkave/sdk/node";
import type { AuthorTarget } from "@spellkave/tool-authoring";
import type { OwnerInstanceRead } from "@spellkave/world-author";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConnectLive, EXIT_OK, EXIT_USAGE, resolveLiveConnection, runCli } from "../cli.ts";
import { collect } from "./helpers.ts";

const ENV_KEYS = [
	"SPELLKAVE_HOME",
	"SPELLKAVE_URL",
	"SPELLKAVE_DB",
	"SPELLKAVE_CONNECT_TOKEN",
	"SPACETIME_CONFIG_PATH",
	"SPACETIME_DATA_DIR",
	"SPACETIME_PORT",
	"SK_TEST_TOKEN",
] as const;

function writeProfile(
	home: string,
	name: string,
	opts: { url: string; db: string; credential?: string },
): void {
	const dir = join(home, "config", "profiles");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${name}.toml`),
		`[connection]\nurl = "${opts.url}"\ndb = "${opts.db}"\n\n[identity]\nrole = "author"\nin_world_self = "0"\n` +
			(opts.credential === undefined ? "" : `credential = ${opts.credential}\n`),
		"utf8",
	);
}

function fakeTarget(): AuthorTarget {
	return {
		kind: "live",
		resolveRef: () => false,
		lookup: () => [],
		applyBatch: async () => ({ ok: true }),
	};
}

describe("author-path connection ladder", () => {
	const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	let home: string;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "sk-ctx-home-"));
		for (const k of ENV_KEYS) delete process.env[k];
		process.env.SPELLKAVE_HOME = home;
		process.env.SK_TEST_TOKEN = "t-staging";
		writeProfile(home, "staging", {
			url: "https://staging.example",
			db: "stage-db",
			credential: '{ kind = "env_var", name = "SK_TEST_TOKEN" }',
		});
		writeProfile(home, "kira", {
			url: "https://kira.example",
			db: "kira-db",
			credential: '{ kind = "env_var", name = "SK_TEST_TOKEN" }',
		});
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		for (const k of ENV_KEYS) {
			const v = saved[k];
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("uses the current context when nothing else is set", () => {
		writeCurrentContext(resolveCliPaths(), "staging");
		const r = resolveLiveConnection(undefined);
		expect(r).toMatchObject({
			url: "https://staging.example",
			db: "stage-db",
			source: "context",
			profile: "staging",
			token: "t-staging",
		});
	});

	it("lets the environment win and records the overridden context", () => {
		writeCurrentContext(resolveCliPaths(), "staging");
		process.env.SPELLKAVE_URL = "http://127.0.0.1:7649";
		const r = resolveLiveConnection(undefined);
		expect(r.source).toBe("environment");
		expect(r.url).toBe("http://127.0.0.1:7649");
		expect(r.overriddenContext).toEqual({
			name: "staging",
			url: "https://staging.example",
			db: "stage-db",
		});
	});

	it("reports no override when environment and context name the same world", () => {
		writeCurrentContext(resolveCliPaths(), "staging");
		process.env.SPELLKAVE_URL = "https://staging.example";
		process.env.SPELLKAVE_DB = "stage-db";
		expect(resolveLiveConnection(undefined).overriddenContext).toBeUndefined();
	});

	it("lets an explicit --profile beat the environment without an override record", () => {
		writeCurrentContext(resolveCliPaths(), "staging");
		process.env.SPELLKAVE_URL = "http://127.0.0.1:7649";
		const r = resolveLiveConnection("kira");
		expect(r).toMatchObject({ url: "https://kira.example", source: "flag", profile: "kira" });
		expect(r.overriddenContext).toBeUndefined();
	});

	it("never consults the last-used profile", () => {
		writeLastUsedProfile(resolveCliPaths(), "kira");
		expect(() => resolveLiveConnection(undefined)).toThrow(/sk config use-context/);
	});

	it("names every remedy when nothing resolves", () => {
		expect(() => resolveLiveConnection(undefined)).toThrow(
			/--profile.*use-context.*SPELLKAVE_URL/s,
		);
	});

	it("reports a dangling context as an error naming the remedy", () => {
		writeCurrentContext(resolveCliPaths(), "ghost");
		expect(() => resolveLiveConnection(undefined)).toThrow(/'ghost'.*sk config use-context/s);
	});

	it("tolerates a dangling context behind the environment, but records it", () => {
		writeCurrentContext(resolveCliPaths(), "ghost");
		process.env.SPELLKAVE_URL = "http://127.0.0.1:7649";
		expect(resolveLiveConnection(undefined)).toMatchObject({
			source: "environment",
			danglingContext: "ghost",
		});
	});

	describe("credential fallback for local-node profiles", () => {
		async function playerBindingToken(
			name: string,
			expectAttached = true,
		): Promise<string | undefined> {
			const io = collect();
			let token: string | undefined;
			let attached = false;
			await runCli(
				["--profile", name, "--actor", "5", "scene"],
				io.io,
				undefined,
				async (_binding, options) => {
					token = options?.token;
					attached = true;
					throw new Error("injected stop before daemon transport");
				},
			);
			expect(attached).toBe(expectAttached);
			if (!expectAttached) expect(io.out.join("\n")).toContain("spacetime login");
			// Boolean assertions keep a failing credential test from printing a token.
			const output = [...io.out, ...io.err].join("\n");
			if (token) expect(output.includes(token)).toBe(false);
			return token;
		}

		// keep(K2): observes the credential at an injected daemon seam without opening a real session or printing secrets.
		it("PLAYER dispatch uses this canonical local-node profile's credential too", async () => {
			const { name } = localNode();
			expect((await playerBindingToken(name)) === "t-node-publisher").toBe(true);
		});

		// keep(K2): varies profile/world identity at the daemon seam without connecting to any hosted target.
		it.each([
			{ name: "ordinary", url: "http://127.0.0.1:7649", db: "spellkave-dev" },
			{ name: "other-worktree", url: "http://127.0.0.1:7649", db: "spellkave-dev" },
			{ name: "same", url: "http://127.0.0.1:7650", db: "spellkave-dev" },
			{ name: "same", url: "http://127.0.0.1:7649", db: "other-db" },
			{ name: "same", url: "https://hosted.example", db: "spellkave-dev" },
		])("PLAYER dispatch never borrows the canonical node credential for %j", async (target) => {
			const local = localNode();
			const name =
				target.name === "same"
					? local.name
					: target.name === "ordinary"
						? "ordinary"
						: localNodeProfileName(join(home, "other-worktree"));
			writeProfile(home, name, { url: target.url, db: target.db });
			// Both a logged-in developer and an empty CI runner must preserve this boundary.
			const login = vi.spyOn(sdkNode, "resolveSpacetimeLoginToken");
			try {
				login.mockReturnValue("t-unrelated-login");
				expect((await playerBindingToken(name)) === "t-node-publisher").toBe(false);
				login.mockImplementation(() => {
					throw new Error("no spacetime login token found");
				});
				expect(
					(await playerBindingToken(
						name,
						target.name !== "ordinary" && target.url !== "https://hosted.example",
					)) === "t-node-publisher",
				).toBe(false);
			} finally {
				login.mockRestore();
			}
		});

		// keep(K2): explicit credentials are checked before a daemon can make a network connection.
		it("PLAYER dispatch preserves ordinary profiles and explicit profile credentials", async () => {
			const { name } = localNode();
			expect((await playerBindingToken("staging")) === "t-staging").toBe(true);
			writeProfile(home, name, {
				url: "http://127.0.0.1:7649",
				db: "spellkave-dev",
				credential: '{ kind = "env_var", name = "SK_TEST_TOKEN" }',
			});
			expect((await playerBindingToken(name)) === "t-staging").toBe(true);
		});

		function localNode(): { name: string; path: string } {
			const name = localNodeProfileName(currentWorktreeRoot() as string);
			process.env.SPACETIME_PORT = "7649";
			process.env.SPACETIME_DATA_DIR = join(home, "node");
			mkdirSync(process.env.SPACETIME_DATA_DIR, { recursive: true });
			const path = join(process.env.SPACETIME_DATA_DIR, "cli.toml");
			writeFileSync(path, 'spacetimedb_token = "t-node-publisher"\n');
			writeProfile(home, name, { url: "http://127.0.0.1:7649", db: "spellkave-dev" });
			return { name, path };
		}

		// keep(K2): isolated process environment/files exercise credential choice without sending tokens over a network.
		it("discovers this worktree node's publisher credential without SPACETIME_CONFIG_PATH", () => {
			const { name } = localNode();
			expect(resolveLiveConnection(name).token).toBe("t-node-publisher");
		});

		// keep(K2): inject a damaged credential file without corrupting a running node.
		it("refuses a known node config without a token instead of borrowing another identity", () => {
			const { name, path } = localNode();
			writeFileSync(path, 'default_server = "local"\n');
			expect(() => resolveLiveConnection(name)).toThrow(/local node.*credential.*sk dev up/i);
		});

		// keep(K2): explicit credentials and environment bindings cannot be varied on a shared live world safely.
		it("keeps explicit token, config path and profile credentials ahead of discovery", () => {
			const { name } = localNode();
			const explicit = join(home, "explicit-cli.toml");
			writeFileSync(explicit, 'spacetimedb_token = "t-explicit-config"\n');
			process.env.SPACETIME_CONFIG_PATH = explicit;
			expect(resolveLiveConnection(name).token).toBe("t-explicit-config");
			process.env.SPELLKAVE_CONNECT_TOKEN = "t-explicit-env";
			expect(resolveLiveConnection(name).token).toBe("t-explicit-env");
			writeProfile(home, name, {
				url: "http://127.0.0.1:7649",
				db: "spellkave-dev",
				credential: '{ kind = "env_var", name = "SK_TEST_TOKEN" }',
			});
			expect(resolveLiveConnection(name).token).toBe("t-staging");
		});

		// keep(K2): authority boundary across worktree names and connection targets, without network side effects.
		it.each([
			{ name: "other", url: "http://127.0.0.1:7649", db: "spellkave-dev" },
			{ name: "same", url: "http://127.0.0.1:7650", db: "spellkave-dev" },
			{ name: "same", url: "http://127.0.0.1:7649", db: "other-db" },
		])("does not borrow node credentials for another generated profile or world: %j", (target) => {
			const local = localNode();
			const name =
				target.name === "same" ? local.name : localNodeProfileName(join(home, "another-worktree"));
			writeProfile(home, name, { url: target.url, db: target.db });
			expect(resolveLiveConnection(name).token).not.toBe("t-node-publisher");
		});

		it("resolves the local credential for a sk dev up profile without a credential", () => {
			const name = localNodeProfileName(currentWorktreeRoot() as string);
			writeProfile(home, name, { url: "http://127.0.0.1:7649", db: "spellkave-dev" });
			process.env.SPELLKAVE_CONNECT_TOKEN = "t-local";
			expect(resolveLiveConnection(name).token).toBe("t-local");
		});

		it("gives a hand-made local-prod profile with a remote URL no fallback", () => {
			writeProfile(home, "local-prod", { url: "https://prod.example", db: "prod" });
			process.env.SPELLKAVE_CONNECT_TOKEN = "t-local";
			// Falls through to the `spacetime login` rule for credential-less
			// profiles, which fails in an empty HOME instead of borrowing the
			// local token.
			const savedHomeDir = process.env.HOME;
			process.env.HOME = join(home, "empty-home");
			try {
				expect(() => resolveLiveConnection("local-prod")).toThrow(/spacetime login/);
			} finally {
				process.env.HOME = savedHomeDir;
			}
		});

		it("keeps the cloud preset on the spacetime login token", () => {
			writeProfile(home, "cloud", { url: "https://maincloud.spacetimedb.com", db: "spellkave" });
			process.env.SPELLKAVE_CONNECT_TOKEN = "t-local";
			const loginDir = join(home, "spacetime-home", ".config", "spacetime");
			mkdirSync(loginDir, { recursive: true });
			writeFileSync(join(loginDir, "cli.toml"), 'spacetimedb_token = "t-login"\n', "utf8");
			const savedHomeDir = process.env.HOME;
			process.env.HOME = join(home, "spacetime-home");
			try {
				expect(resolveLiveConnection("cloud").token).toBe("t-login");
			} finally {
				process.env.HOME = savedHomeDir;
			}
		});
	});

	describe("stderr announcements through sk --live", () => {
		const connectLive: ConnectLive = async () => ({
			target: fakeTarget(),
			readsAsPublisher: true,
			connectedIdentity: "publisher",
			close: () => {},
		});
		const toml = 'schema_version = "1.0.0"\n';

		it("warns exactly once when the environment overrides the context", async () => {
			writeCurrentContext(resolveCliPaths(), "staging");
			process.env.SPELLKAVE_URL = "http://127.0.0.1:7649";
			const io = collect();
			const code = await runCli(
				["--live", "apply_manifest_delta", "--toml", toml],
				io.io,
				connectLive,
			);
			expect(code).toBe(EXIT_OK);
			const warnings = io.err.filter((l) => l.includes("environment wins over context"));
			expect(warnings).toHaveLength(1);
			expect(warnings[0]).toContain("staging");
			expect(warnings[0]).toContain("https://staging.example");
			expect(warnings[0]).toContain("http://127.0.0.1:7649");
		});

		it("announces the context it uses", async () => {
			writeCurrentContext(resolveCliPaths(), "staging");
			const io = collect();
			const code = await runCli(
				["--live", "apply_manifest_delta", "--toml", toml],
				io.io,
				connectLive,
			);
			expect(code).toBe(EXIT_OK);
			expect(io.err).toContain("sk: using context 'staging' (--live)");
		});

		it("exits with a usage error when nothing resolves", async () => {
			const io = collect();
			const code = await runCli(
				["--live", "apply_manifest_delta", "--toml", toml],
				io.io,
				connectLive,
			);
			expect(code).toBe(EXIT_USAGE);
		});
	});

	describe("sk get without --live", () => {
		const port: OwnerInstanceRead = {
			get: () => ({
				ok: true,
				kind: "entities",
				tick: "1",
				labels: ["authored_entities_only"],
				rows: [],
				match_count: 0,
				left_out: 0,
			}),
			describe: () => {
				throw new Error("describe must not run");
			},
		};
		const connectLive: ConnectLive = async () => ({
			target: fakeTarget(),
			readInstance: port,
			readsAsPublisher: true,
			connectedIdentity: "publisher",
			close: () => {},
		});

		it("uses the current context and does not require --live", async () => {
			writeCurrentContext(resolveCliPaths(), "staging");
			const io = collect();
			const code = await runCli(["--format", "jsonl", "get", "entities"], io.io, connectLive);
			expect(code).toBe(EXIT_OK);
			expect(io.err).toContain("sk: using context 'staging' (get)");
		});

		it("exits usage when no context or env resolves", async () => {
			const io = collect();
			const code = await runCli(["--format", "jsonl", "get", "entities"], io.io, connectLive);
			expect(code).toBe(EXIT_USAGE);
		});
	});
});

describe("sk config context verbs", () => {
	const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
	let home: string;

	function parse(lines: string[]): Record<string, unknown> {
		expect(lines).toHaveLength(1);
		return JSON.parse(lines[0] as string) as Record<string, unknown>;
	}

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "sk-ctx-verbs-"));
		for (const k of ENV_KEYS) delete process.env[k];
		process.env.SPELLKAVE_HOME = home;
		process.env.SK_TEST_TOKEN = "t";
		const cred = '{ kind = "env_var", name = "SK_TEST_TOKEN" }';
		writeProfile(home, "staging", {
			url: "https://staging.example",
			db: "stage-db",
			credential: cred,
		});
		writeProfile(home, "kira", { url: "https://kira.example", db: "kira-db", credential: cred });
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		for (const k of ENV_KEYS) {
			const v = saved[k];
			if (v === undefined) delete process.env[k];
			else process.env[k] = v;
		}
	});

	it("get-contexts lists profiles with URL and database and marks the current one", async () => {
		writeCurrentContext(resolveCliPaths(), "staging");
		const io = collect();
		expect(await runCli(["config", "get-contexts"], io.io)).toBe(EXIT_OK);
		expect(parse(io.out)).toEqual({
			kind: "config_contexts",
			current: "staging",
			contexts: [
				{ name: "kira", current: false, url: "https://kira.example", db: "kira-db" },
				{ name: "staging", current: true, url: "https://staging.example", db: "stage-db" },
			],
		});
	});

	it("use-context selects an existing profile", async () => {
		const io = collect();
		expect(await runCli(["config", "use-context", "kira"], io.io)).toBe(EXIT_OK);
		expect(parse(io.out)).toMatchObject({ kind: "config_context_change", context: "kira" });
		const current = collect();
		await runCli(["config", "current-context"], current.io);
		expect(parse(current.out)).toEqual({ kind: "config_current_context", context: "kira" });
	});

	it("use-context refuses an unknown name, lists what exists, and keeps the context", async () => {
		writeCurrentContext(resolveCliPaths(), "staging");
		const io = collect();
		expect(await runCli(["config", "use-context", "nosuch"], io.io)).toBe(EXIT_USAGE);
		const payload = parse(io.out);
		expect(payload.message).toContain("'nosuch'");
		expect(payload.message).toContain("kira, staging");
		const current = collect();
		await runCli(["config", "current-context"], current.io);
		expect(parse(current.out)).toEqual({ kind: "config_current_context", context: "staging" });
	});

	it("current-context reports none with exit 0", async () => {
		const io = collect();
		expect(await runCli(["config", "current-context"], io.io)).toBe(EXIT_OK);
		expect(parse(io.out)).toEqual({ kind: "config_current_context", context: null });
	});

	it("view reports the environment as effective and the context as overridden", async () => {
		writeCurrentContext(resolveCliPaths(), "staging");
		process.env.SPELLKAVE_URL = "http://127.0.0.1:7649";
		const io = collect();
		expect(await runCli(["config", "view"], io.io)).toBe(EXIT_OK);
		const payload = parse(io.out);
		expect(payload).toMatchObject({
			kind: "config_view",
			url: "http://127.0.0.1:7649",
			source: "environment",
			context: "staging",
			overridden_context: { name: "staging", url: "https://staging.example", db: "stage-db" },
		});
		expect(String(payload.reason)).toContain("environment");
		expect(JSON.stringify(payload)).not.toContain('"t"');
	});

	it("view reports an error instead of failing when nothing resolves", async () => {
		const io = collect();
		expect(await runCli(["config", "view"], io.io)).toBe(EXIT_OK);
		expect(parse(io.out)).toMatchObject({ kind: "config_view", url: null, context: null });
	});

	it("show names the current context", async () => {
		writeCurrentContext(resolveCliPaths(), "kira");
		const io = collect();
		await runCli(["--no-target", "--no-default-bundle", "config", "show"], io.io);
		expect(parse(io.out)).toMatchObject({ kind: "config", current_context: "kira" });
		const human = collect({ stdoutIsTTY: true, stdoutColumns: 120 });
		await runCli(["config", "show"], human.io);
		expect(human.out.join("\n")).toContain(
			"World connection: context 'kira' (details: sk config view)",
		);
	});
});
