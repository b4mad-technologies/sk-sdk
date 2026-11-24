// `sk --live` sends an author's change straight into a running world instead
// of a local bundle. These tests check that it refuses `--target` with it,
// names the fix when no world is configured, closes the connection after
// every call (also on errors), resolves `--profile`, and journals each
// delta. A fake connector stands in for the world; the one case that uses
// the real connector checks only its error without a node. No node.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readLastUsedProfile, resolveCliPaths } from "@spellkave/sdk/node";
import type { AuthorTarget } from "@spellkave/tool-authoring";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ConnectLive, EXIT_IN_WORLD, EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import { collect } from "./helpers.ts";

function parseOnly(lines: string[]): Record<string, unknown> {
	expect(lines).toHaveLength(1);
	return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

/** A minimal `AuthorTarget` double — `spellkave_apply_manifest_delta` only ever
 * touches `applyBatch`/`kind`, but the interface requires all three. */
function fakeTarget(applyBatch: AuthorTarget["applyBatch"]): AuthorTarget {
	return { kind: "live", resolveRef: () => false, lookup: () => [], applyBatch };
}

describe("sk --live", () => {
	const savedUrl = process.env.SPELLKAVE_URL;
	const savedDb = process.env.SPELLKAVE_DB;
	const savedHome = process.env.SPELLKAVE_HOME;

	beforeEach(() => {
		delete process.env.SPELLKAVE_URL;
		delete process.env.SPELLKAVE_DB;
		// The author path now consults the per-worktree current context; an
		// empty temp home keeps the developer's own context out of these cases.
		process.env.SPELLKAVE_HOME = mkdtempSync(join(tmpdir(), "sk-live-home-"));
	});

	afterEach(() => {
		if (savedHome === undefined) delete process.env.SPELLKAVE_HOME;
		else process.env.SPELLKAVE_HOME = savedHome;
		if (savedUrl === undefined) delete process.env.SPELLKAVE_URL;
		else process.env.SPELLKAVE_URL = savedUrl;
		if (savedDb === undefined) delete process.env.SPELLKAVE_DB;
		else process.env.SPELLKAVE_DB = savedDb;
	});

	it("rejects --live combined with --target as a usage error, before connecting", async () => {
		const io = collect();
		let connected = false;
		const connectLive: ConnectLive = async () => {
			connected = true;
			return {
				target: fakeTarget(async () => ({ ok: true })),
				readsAsPublisher: true,
				connectedIdentity: "publisher",
				close: () => {},
			};
		};

		const code = await runCli(
			["--live", "--target", "world-fixtures/core", "list"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.scope).toBe("usage");
		expect(payload.message).toContain("--live");
		expect(payload.message).toContain("--target");
		expect(connected).toBe(false);
	});

	it("marks the connected tool available under --live with no --target wired", async () => {
		const io = collect();
		const code = await runCli(["--live", "list"], io.io, async () => ({
			target: fakeTarget(async () => ({ ok: true })),
			readsAsPublisher: true,
			connectedIdentity: "publisher",
			close: () => {},
		}));

		expect(code).toBe(EXIT_OK);
		const payload = parseOnly(io.out) as { tools: { name: string; available: boolean }[] };
		const delta = payload.tools.find((tool) => tool.name.endsWith("apply_manifest_delta"));
		expect(delta?.available).toBe(true);
	});

	it("fails loudly naming SPELLKAVE_URL when the default connector has no node to reach", async () => {
		const io = collect();
		// No injected connectLive here — exercises `defaultConnectLive` itself,
		// with SPELLKAVE_URL deliberately unset (see beforeEach).
		const code = await runCli(["--live", "apply_manifest_delta", "--toml", "irrelevant"], io.io);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.scope).toBe("usage");
		expect(payload.message).toContain("SPELLKAVE_URL");
		expect(payload.message).toContain("--profile");
		expect(payload.message).toContain("sk config use-context");
	});

	it("runs the connected tool through the injected live target and closes after", async () => {
		// `--live`'s own ladder (#2002 follow-up) resolves url/db/token BEFORE
		// ever calling `connectLive` (even an injected fake) — see
		// `resolveLiveConnection`'s doc comment — so a resolvable env is
		// required here even though this case does not care what it resolves to.
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		const io = collect();
		const submitted: string[] = [];
		let closed = false;
		const connectLive: ConnectLive = async () => ({
			target: fakeTarget(async (toml) => {
				submitted.push(toml);
				return { ok: true };
			}),
			readsAsPublisher: true,
			connectedIdentity: "publisher",
			close: () => {
				closed = true;
			},
		});

		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", 'schema_version = "1.0.0"\n'],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_OK);
		expect(submitted).toEqual(['schema_version = "1.0.0"\n']);
		expect(closed).toBe(true);
	});

	it("maps a live in-world rejection to EXIT_IN_WORLD and still closes", async () => {
		// See the comment in the previous case: `resolveLiveConnection` runs
		// before `connectLive`, so a resolvable env is required regardless.
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		const io = collect();
		let closed = false;
		const connectLive: ConnectLive = async () => ({
			target: fakeTarget(async () => ({ ok: false, detail: "MF-VAL-001: refused" })),
			readsAsPublisher: true,
			connectedIdentity: "publisher",
			close: () => {
				closed = true;
			},
		});

		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", "bogus"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_IN_WORLD);
		expect(closed).toBe(true);
	});

	it("closes the connection even when the tool call throws", async () => {
		// See the comment above: `resolveLiveConnection` runs before
		// `connectLive`, so a resolvable env is required regardless.
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		const io = collect();
		let closed = false;
		const connectLive: ConnectLive = async () => ({
			target: fakeTarget(async () => {
				throw new Error("transport dropped mid-call");
			}),
			readsAsPublisher: true,
			connectedIdentity: "publisher",
			close: () => {
				closed = true;
			},
		});

		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", "bogus"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.scope).toBe("infra");
		expect(payload.reads_as_publisher).toBe(true);
		expect(payload.connected_identity).toBe("publisher");
		expect(payload.message).toContain("transport dropped mid-call");
		expect(closed).toBe(true);
	});

	it("never calls close when connectLive itself fails", async () => {
		// See the comment above: `resolveLiveConnection` must resolve BEFORE
		// `connectLive` is even reachable, so this needs a resolvable env to
		// exercise `connectLive` itself throwing (not resolution failing first).
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		const io = collect();
		const connectLive: ConnectLive = async () => {
			throw new Error("connect refused");
		};

		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", "bogus"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.scope).toBe("infra");
		expect(payload.message).toContain("connect refused");
	});
});

// `--live --profile <name>` (#2002 follow-up): `--profile` used to be
// silently ignored on the `--live` path — this section pins the fix's own
// ladder (`resolveLiveConnection` in `cli.ts`): `--profile`, when given,
// supplies the connection OUTRIGHT — same "explicit flag beats ambient env"
// precedence as PLAYER's `resolveBinding`, so the same flag never means
// opposite things on the two paths. Without `--profile`, the plain env chain
// resolves as before. Isolated in its own `describe` (own `SPELLKAVE_HOME`,
// its own env save/restore) rather than folded into `sk --live` above, since
// it needs real profile TOML fixtures under a temp config root — the same
// convention `__tests__/profile.test.ts` documents.
describe("sk --live --profile", () => {
	let home: string;
	let configRoot: string;

	const savedHome = process.env.SPELLKAVE_HOME;
	const savedUrl = process.env.SPELLKAVE_URL;
	const savedDb = process.env.SPELLKAVE_DB;
	const savedToken = process.env.SPELLKAVE_CONNECT_TOKEN;
	const savedConfigPath = process.env.SPACETIME_CONFIG_PATH;
	const savedTestToken = process.env.SK_TEST_TOKEN;

	beforeEach(() => {
		home = mkdtempSync(join(tmpdir(), "sk-live-profile-home-"));
		process.env.SPELLKAVE_HOME = home;
		configRoot = join(home, "config");
		delete process.env.SPELLKAVE_URL;
		delete process.env.SPELLKAVE_DB;
		delete process.env.SPELLKAVE_CONNECT_TOKEN;
		delete process.env.SPACETIME_CONFIG_PATH;
		delete process.env.SK_TEST_TOKEN;
	});

	afterEach(() => {
		rmSync(home, { recursive: true, force: true });
		for (const [key, value] of [
			["SPELLKAVE_HOME", savedHome],
			["SPELLKAVE_URL", savedUrl],
			["SPELLKAVE_DB", savedDb],
			["SPELLKAVE_CONNECT_TOKEN", savedToken],
			["SPACETIME_CONFIG_PATH", savedConfigPath],
			["SK_TEST_TOKEN", savedTestToken],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	function writeProfile(
		name: string,
		opts: { url: string; db: string; tokenEnvVar: string },
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
				`in_world_self = "irrelevant-for-live"\n` +
				`credential = { kind = "env_var", name = "${opts.tokenEnvVar}" }\n`,
			"utf8",
		);
	}

	it("resolves the profile's url/db/token when SPELLKAVE_URL is unset (fake connector asserts what it was handed)", async () => {
		writeProfile("kira", {
			url: "http://profile.example:9000",
			db: "profile-db",
			tokenEnvVar: "SK_TEST_TOKEN",
		});
		process.env.SK_TEST_TOKEN = "tok-secret";
		const io = collect();
		const captured: { url: string; db: string; token?: string }[] = [];
		const connectLive: ConnectLive = async (resolved) => {
			captured.push(resolved);
			return {
				target: fakeTarget(async () => ({ ok: true })),
				readsAsPublisher: true,
				connectedIdentity: "publisher",
				close: () => {},
			};
		};

		const code = await runCli(
			["--live", "--profile", "kira", "apply_manifest_delta", "--toml", "irrelevant"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_OK);
		expect(captured).toEqual([
			{ url: "http://profile.example:9000", db: "profile-db", token: "tok-secret" },
		]);
	});

	it("--profile wins over an exported SPELLKAVE_URL (explicit flag beats ambient env, same as PLAYER)", async () => {
		writeProfile("kira", {
			url: "http://profile.example:9000",
			db: "profile-db",
			tokenEnvVar: "SK_TEST_TOKEN",
		});
		process.env.SK_TEST_TOKEN = "tok-secret";
		process.env.SPELLKAVE_URL = "http://env.example:1";
		process.env.SPELLKAVE_DB = "env-db";
		const io = collect();
		const captured: { url: string; db: string; token?: string }[] = [];
		const connectLive: ConnectLive = async (resolved) => {
			captured.push(resolved);
			return {
				target: fakeTarget(async () => ({ ok: true })),
				readsAsPublisher: true,
				connectedIdentity: "publisher",
				close: () => {},
			};
		};

		const code = await runCli(
			["--live", "--profile", "kira", "apply_manifest_delta", "--toml", "irrelevant"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_OK);
		expect(captured[0]?.url).toBe("http://profile.example:9000");
		expect(captured[0]?.db).toBe("profile-db");
		expect(captured[0]?.token).toBe("tok-secret");
		// The profile supplied the connection — announced, and remembered.
		expect(io.err).toContain("sk: using profile 'kira' (--live)");
		expect(readLastUsedProfile(resolveCliPaths())).toBe("kira");
	});

	it("without --profile, SPELLKAVE_URL and SPELLKAVE_DB from the environment still choose the world", async () => {
		process.env.SPELLKAVE_URL = "http://env.example:1";
		process.env.SPELLKAVE_DB = "env-db";
		const io = collect();
		const captured: { url: string; db: string; token?: string }[] = [];
		const connectLive: ConnectLive = async (resolved) => {
			captured.push(resolved);
			return {
				target: fakeTarget(async () => ({ ok: true })),
				readsAsPublisher: true,
				connectedIdentity: "publisher",
				close: () => {},
			};
		};

		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", "irrelevant"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_OK);
		expect(captured[0]?.url).toBe("http://env.example:1");
		expect(captured[0]?.db).toBe("env-db");
		// No profile involved — nothing announced, nothing remembered.
		expect(io.err).toEqual([]);
	});

	it("--live --profile <unknown> is a loud usage error, never a silent connect", async () => {
		const io = collect();
		const connectLive: ConnectLive = async () => {
			throw new Error("connectLive must not be called once resolution has failed");
		};

		const code = await runCli(
			["--live", "--profile", "ghost", "apply_manifest_delta", "--toml", "irrelevant"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.scope).toBe("usage");
		expect(payload.message).toContain("ghost");
	});

	it("announces the profile on stderr and remembers it as last_used_profile after a successful use", async () => {
		writeProfile("kira", {
			url: "http://profile.example:9000",
			db: "profile-db",
			tokenEnvVar: "SK_TEST_TOKEN",
		});
		process.env.SK_TEST_TOKEN = "tok-secret";
		const io = collect();
		const connectLive: ConnectLive = async () => ({
			target: fakeTarget(async () => ({ ok: true })),
			readsAsPublisher: true,
			connectedIdentity: "publisher",
			close: () => {},
		});

		const code = await runCli(
			["--live", "--profile", "kira", "apply_manifest_delta", "--toml", "irrelevant"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_OK);
		expect(io.err).toContain("sk: using profile 'kira' (--live)");
		expect(readLastUsedProfile(resolveCliPaths())).toBe("kira");
	});
});

// sk-jay0.7.171.1: every live apply leaves a journal entry, success or
// in-world rejection, under the directory the env names.
describe("sk --live apply_manifest_delta journal", () => {
	const savedUrl = process.env.SPELLKAVE_URL;
	const savedJournal = process.env.SPELLKAVE_LIVE_DELTA_JOURNAL;
	const savedJournalDir = process.env.SPELLKAVE_LIVE_DELTA_JOURNAL_DIR;
	let journalDir: string;

	beforeEach(() => {
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		process.env.SPELLKAVE_DB = "spellkave-journal";
		journalDir = mkdtempSync(join(tmpdir(), "sk-live-journal-"));
		process.env.SPELLKAVE_LIVE_DELTA_JOURNAL_DIR = journalDir;
		delete process.env.SPELLKAVE_LIVE_DELTA_JOURNAL;
	});

	afterEach(() => {
		rmSync(journalDir, { recursive: true, force: true });
		if (savedUrl === undefined) delete process.env.SPELLKAVE_URL;
		else process.env.SPELLKAVE_URL = savedUrl;
		if (savedJournal === undefined) delete process.env.SPELLKAVE_LIVE_DELTA_JOURNAL;
		else process.env.SPELLKAVE_LIVE_DELTA_JOURNAL = savedJournal;
		if (savedJournalDir === undefined) delete process.env.SPELLKAVE_LIVE_DELTA_JOURNAL_DIR;
		else process.env.SPELLKAVE_LIVE_DELTA_JOURNAL_DIR = savedJournalDir;
	});

	function journalLines(): Record<string, unknown>[] {
		return readFileSync(join(journalDir, "journal.jsonl"), "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	it("journals an accepted explicit --toml delta with the resolved binding", async () => {
		const io = collect();
		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", 'schema_version = "1.0.0"\n'],
			io.io,
			async () => ({
				target: fakeTarget(async () => ({ ok: true })),
				readsAsPublisher: true,
				connectedIdentity: "publisher",
				close: () => {},
			}),
		);
		expect(code).toBe(EXIT_OK);
		const [entry] = journalLines();
		expect(entry).toMatchObject({
			seq: 1,
			ok: true,
			source: "toml",
			url: "http://127.0.0.1:4001",
			db: "spellkave-journal",
		});
		expect(readFileSync(entry?.path as string, "utf8")).toBe('schema_version = "1.0.0"\n');
		expect(
			io.err.some((line) => line.includes("live delta journaled") && line.includes("(ok)")),
		).toBe(true);
		// stdout stays the tool's own JSONL: no journal key leaks into the contract.
		expect(io.out.join("\n")).not.toContain("journal");
	});

	it("journals an in-world rejection with its detail", async () => {
		const io = collect();
		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", "bogus"],
			io.io,
			async () => ({
				target: fakeTarget(async () => ({ ok: false, detail: "MF-VAL-001: refused" })),
				readsAsPublisher: true,
				connectedIdentity: "publisher",
				close: () => {},
			}),
		);
		expect(code).toBe(EXIT_IN_WORLD);
		const [entry] = journalLines();
		expect(entry).toMatchObject({ ok: false, detail: "MF-VAL-001: refused", lines: 1 });
	});

	it("writes nothing when SPELLKAVE_LIVE_DELTA_JOURNAL=0", async () => {
		process.env.SPELLKAVE_LIVE_DELTA_JOURNAL = "0";
		const io = collect();
		const code = await runCli(
			["--live", "apply_manifest_delta", "--toml", 'schema_version = "1.0.0"\n'],
			io.io,
			async () => ({
				target: fakeTarget(async () => ({ ok: true })),
				readsAsPublisher: true,
				connectedIdentity: "publisher",
				close: () => {},
			}),
		);
		expect(code).toBe(EXIT_OK);
		expect(readdirSync(journalDir)).toEqual([]);
		expect(io.err.some((line) => line.includes("journaled"))).toBe(false);
	});
});
