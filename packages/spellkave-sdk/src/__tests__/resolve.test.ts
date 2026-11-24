import { describe, expect, it } from "vitest";
import type { CliPaths } from "../core/paths";
import { scopedLastUsedProfileFile } from "../core/paths";
import { listProfileNames, readLastUsedProfile, resolveConnection } from "../core/resolve";

const PATHS: CliPaths = {
	config: "/cfg",
	state: "/st",
	cache: "/ca",
};

const BUILTIN_URL = "http://127.0.0.1:3000";
const BUILTIN_DB = "spellkave-dev";

const PROFILE_FILE = (name: string) =>
	`[connection]\nurl = "http://${name}.example:9000"\ndb = "${name}-db"\n\n[identity]\nrole = "watcher"\nin_world_self = "scout-01"\n`;

function fakeFs(map: Record<string, string>) {
	return {
		readFileSync: (path: string) => {
			// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
			if (map[path] !== undefined) return map[path]!;
			const err = new Error(`ENOENT: ${path}`) as NodeJS.ErrnoException;
			err.code = "ENOENT";
			throw err;
		},
	};
}

describe("resolveConnection precedence", () => {
	it("returns built-ins when no overrides, no profile, no app config", () => {
		const r = resolveConnection(
			{},
			{
				paths: PATHS,
				built_in_url: BUILTIN_URL,
				built_in_db: BUILTIN_DB,
				last_used_profile: undefined,
				io: fakeFs({}),
			},
		);
		expect(r.url).toBe(BUILTIN_URL);
		expect(r.db).toBe(BUILTIN_DB);
		expect(r.url_source).toBe("built_in");
		expect(r.profile).toBeUndefined();
		expect(r.profile_source).toBe("none");
	});

	it("explicit flag overrides everything else (per field)", () => {
		const r = resolveConnection(
			{ url: "http://flag:1", db: "flag-db", profile: "scout" },
			{
				paths: PATHS,
				built_in_url: BUILTIN_URL,
				built_in_db: BUILTIN_DB,
				last_used_profile: undefined,
				io: fakeFs({
					"/cfg/profiles/scout.toml": PROFILE_FILE("scout"),
				}),
			},
		);
		expect(r.url).toBe("http://flag:1");
		expect(r.db).toBe("flag-db");
		expect(r.url_source).toBe("flag");
		expect(r.profile).toBe("scout");
		expect(r.profile_source).toBe("flag");
	});

	it("profile supplies url/db when no flag", () => {
		const r = resolveConnection(
			{ profile: "scout" },
			{
				paths: PATHS,
				built_in_url: BUILTIN_URL,
				built_in_db: BUILTIN_DB,
				last_used_profile: undefined,
				io: fakeFs({
					"/cfg/profiles/scout.toml": PROFILE_FILE("scout"),
				}),
			},
		);
		expect(r.url).toBe("http://scout.example:9000");
		expect(r.db).toBe("scout-db");
		expect(r.url_source).toBe("profile");
	});

	it("last-used profile selected when no flag", () => {
		const r = resolveConnection(
			{},
			{
				paths: PATHS,
				built_in_url: BUILTIN_URL,
				built_in_db: BUILTIN_DB,
				last_used_profile: "remembered",
				io: fakeFs({
					"/cfg/profiles/remembered.toml": PROFILE_FILE("remembered"),
				}),
			},
		);
		expect(r.profile).toBe("remembered");
		expect(r.profile_source).toBe("last_used");
		expect(r.url).toBe("http://remembered.example:9000");
	});

	it("app config default profile is the lowest-priority fallback", () => {
		const r = resolveConnection(
			{},
			{
				paths: PATHS,
				built_in_url: BUILTIN_URL,
				built_in_db: BUILTIN_DB,
				last_used_profile: undefined,
				io: fakeFs({
					"/cfg/config.toml": `default_profile = "configured"\n`,
					"/cfg/profiles/configured.toml": PROFILE_FILE("configured"),
				}),
			},
		);
		expect(r.profile).toBe("configured");
		expect(r.profile_source).toBe("app_config_default");
	});

	it("explicit profile beats last-used and default", () => {
		const r = resolveConnection(
			{ profile: "winner" },
			{
				paths: PATHS,
				built_in_url: BUILTIN_URL,
				built_in_db: BUILTIN_DB,
				last_used_profile: "loser-state",
				io: fakeFs({
					"/cfg/config.toml": `default_profile = "loser-default"\n`,
					"/cfg/profiles/winner.toml": PROFILE_FILE("winner"),
					"/cfg/profiles/loser-state.toml": PROFILE_FILE("loser-state"),
					"/cfg/profiles/loser-default.toml": PROFILE_FILE("loser-default"),
				}),
			},
		);
		expect(r.profile).toBe("winner");
		expect(r.profile_source).toBe("flag");
		expect(r.url).toBe("http://winner.example:9000");
	});

	it("explicit profile that does not exist throws (no silent fallback)", () => {
		expect(() =>
			resolveConnection(
				{ profile: "ghost" },
				{
					paths: PATHS,
					built_in_url: BUILTIN_URL,
					built_in_db: BUILTIN_DB,
					last_used_profile: undefined,
					io: fakeFs({}),
				},
			),
		).toThrow(/ghost/);
	});

	it("skips a last-used profile whose file is gone instead of failing", () => {
		const r = resolveConnection(
			{},
			{
				paths: PATHS,
				built_in_url: BUILTIN_URL,
				built_in_db: BUILTIN_DB,
				last_used_profile: "ghost",
				io: fakeFs({}),
			},
		);
		expect(r.profile).toBeUndefined();
		expect(r.profile_source).toBe("none");
		expect(r.url).toBe(BUILTIN_URL);
	});

	it("skips a dead last-used profile and uses the app-config default", () => {
		const r = resolveConnection(
			{},
			{
				paths: PATHS,
				built_in_url: BUILTIN_URL,
				built_in_db: BUILTIN_DB,
				last_used_profile: "ghost",
				io: fakeFs({
					"/cfg/config.toml": `default_profile = "configured"\n`,
					"/cfg/profiles/configured.toml": PROFILE_FILE("configured"),
				}),
			},
		);
		expect(r.profile).toBe("configured");
		expect(r.profile_source).toBe("app_config_default");
	});

	it("rejects path-traversal profile names from any source", () => {
		expect(() =>
			resolveConnection(
				{ profile: "../etc/passwd" },
				{
					paths: PATHS,
					built_in_url: BUILTIN_URL,
					built_in_db: BUILTIN_DB,
					last_used_profile: undefined,
					io: fakeFs({}),
				},
			),
		).toThrow();
	});
});

describe("readLastUsedProfile", () => {
	it("returns undefined when file is missing", () => {
		expect(readLastUsedProfile(PATHS, fakeFs({}))).toBeUndefined();
	});

	it("returns trimmed name when present", () => {
		expect(readLastUsedProfile(PATHS, fakeFs({ "/st/last_used_profile": "scout\n" }))).toBe(
			"scout",
		);
	});

	it("reads the per-worktree pointer and ignores the legacy global file", () => {
		const root = "/tmp/wt-a";
		const scoped = scopedLastUsedProfileFile(PATHS, root);
		expect(
			readLastUsedProfile(
				PATHS,
				fakeFs({
					"/st/last_used_profile": "legacy\n",
					[scoped]: "scout\n",
				}),
				root,
			),
		).toBe("scout");
	});

	it("returns undefined for whitespace-only file", () => {
		expect(readLastUsedProfile(PATHS, fakeFs({ "/st/last_used_profile": "  \n" }))).toBeUndefined();
	});
});

describe("listProfileNames", () => {
	it("lists *.toml files in profiles/ alphabetically without extension", () => {
		const names = listProfileNames(PATHS, {
			readdirSync: () => ["scout.toml", "alice.toml", "README.md", "bob.toml"],
		});
		expect(names).toEqual(["alice", "bob", "scout"]);
	});

	it("returns [] when the dir does not exist", () => {
		const names = listProfileNames(PATHS, {
			readdirSync: () => {
				const err = new Error("ENOENT") as NodeJS.ErrnoException;
				err.code = "ENOENT";
				throw err;
			},
		});
		expect(names).toEqual([]);
	});

	it("filters out invalid names", () => {
		const names = listProfileNames(PATHS, {
			readdirSync: () => [".hidden.toml", "scout.toml", "..weird.toml"],
		});
		expect(names).toEqual(["scout"]);
	});
});
