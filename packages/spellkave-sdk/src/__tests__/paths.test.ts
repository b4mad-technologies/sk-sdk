import { describe, expect, it } from "vitest";

import {
	appConfigFile,
	checkedProfileFile,
	ENV_OVERRIDE_ROOT,
	lastUsedProfileFile,
	personaStateDir,
	profileFile,
	profilesDir,
	resolveCliPaths,
	scopedLastUsedProfileFile,
	validateProfileName,
	worktreeScopeKey,
} from "../core/paths";

describe("resolveCliPaths", () => {
	it("SPELLKAVE_HOME override places config/state/cache as siblings", () => {
		const p = resolveCliPaths({ env: { [ENV_OVERRIDE_ROOT]: "/tmp/sk-test" } });
		expect(p.config).toBe("/tmp/sk-test/config");
		expect(p.state).toBe("/tmp/sk-test/state");
		expect(p.cache).toBe("/tmp/sk-test/cache");
	});

	it("Linux falls back to XDG defaults relative to home", () => {
		const p = resolveCliPaths({
			env: {},
			home: "/home/u",
			platform: "linux",
		});
		expect(p.config).toBe("/home/u/.config/spellkave");
		expect(p.state).toBe("/home/u/.local/state/spellkave");
		expect(p.cache).toBe("/home/u/.cache/spellkave");
	});

	it("honors XDG_CONFIG_HOME when set", () => {
		const p = resolveCliPaths({
			env: { XDG_CONFIG_HOME: "/custom/cfg" },
			home: "/home/u",
			platform: "linux",
		});
		expect(p.config).toBe("/custom/cfg/spellkave");
	});

	it("honors XDG_STATE_HOME and XDG_CACHE_HOME when set", () => {
		const p = resolveCliPaths({
			env: {
				XDG_STATE_HOME: "/custom/state",
				XDG_CACHE_HOME: "/custom/cache",
			},
			home: "/home/u",
			platform: "linux",
		});
		expect(p.state).toBe("/custom/state/spellkave");
		expect(p.cache).toBe("/custom/cache/spellkave");
	});

	it("macOS / darwin resolves to XDG defaults, not Library/Application Support (BUG-001)", () => {
		const p = resolveCliPaths({
			env: {},
			home: "/Users/u",
			platform: "darwin",
		});
		expect(p.config).toBe("/Users/u/.config/spellkave");
		expect(p.state).toBe("/Users/u/.local/state/spellkave");
		expect(p.cache).toBe("/Users/u/.cache/spellkave");
		expect(p.config).not.toContain("Library");
		expect(p.cache).not.toContain("Library");
	});

	it("win32 also resolves to XDG defaults (no AppData branching)", () => {
		const p = resolveCliPaths({
			env: { LOCALAPPDATA: "/should/not/be/used", APPDATA: "/should/not/be/used" },
			home: "/home/u",
			platform: "win32",
		});
		expect(p.config).toBe("/home/u/.config/spellkave");
		expect(p.state).toBe("/home/u/.local/state/spellkave");
		expect(p.cache).toBe("/home/u/.cache/spellkave");
	});

	it("config/state/cache are always distinct", () => {
		for (const platform of ["linux", "darwin", "win32"] as const) {
			const p = resolveCliPaths({
				env: {},
				home: "/h",
				platform,
			});
			expect(p.config).not.toBe(p.state);
			expect(p.state).not.toBe(p.cache);
			expect(p.config).not.toBe(p.cache);
		}
	});
});

describe("path joiners", () => {
	const paths = {
		config: "/tmp/cfg",
		state: "/tmp/st",
		cache: "/tmp/ca",
	};

	it("appConfigFile uses config.toml under config root", () => {
		expect(appConfigFile(paths)).toBe("/tmp/cfg/config.toml");
	});

	it("profilesDir is profiles/ under config root", () => {
		expect(profilesDir(paths)).toBe("/tmp/cfg/profiles");
	});

	it("profileFile appends <name>.toml", () => {
		expect(profileFile(paths, "scout")).toBe("/tmp/cfg/profiles/scout.toml");
	});

	it("checkedProfileFile rejects traversal attempts", () => {
		expect(() => checkedProfileFile(paths, "../etc/passwd")).toThrow();
		expect(() => checkedProfileFile(paths, "scout/extra")).toThrow();
		expect(() => checkedProfileFile(paths, ".hidden")).toThrow();
		expect(() => checkedProfileFile(paths, "")).toThrow();
		expect(checkedProfileFile(paths, "scout-01")).toBe("/tmp/cfg/profiles/scout-01.toml");
	});

	it("personaStateDir is state/personas/<name>/", () => {
		expect(personaStateDir(paths, "scout")).toBe("/tmp/st/personas/scout");
	});

	it("lastUsedProfileFile lives directly under state root", () => {
		expect(lastUsedProfileFile(paths)).toBe("/tmp/st/last_used_profile");
	});

	it("scopedLastUsedProfileFile is stable per worktree root (FNV-1a)", () => {
		const a = scopedLastUsedProfileFile(paths, "/tmp/wt-a");
		const b = scopedLastUsedProfileFile(paths, "/tmp/wt-b");
		expect(a).toMatch(/^\/tmp\/st\/last_used_profiles\/by_worktree\/[0-9a-f]{16}$/);
		expect(a).not.toBe(b);
		expect(worktreeScopeKey("/tmp/wt-a")).toHaveLength(16);
		expect(scopedLastUsedProfileFile(paths, "/tmp/wt-a")).toBe(a);
	});
});

describe("validateProfileName", () => {
	it("rejects traversal and separator forms", () => {
		for (const bad of [
			"",
			".",
			"..",
			"../etc/passwd",
			"scout/../narrator",
			"/abs/path",
			"scout\\backslash",
			".hidden",
			"scout\0null",
		]) {
			expect(() => validateProfileName(bad)).toThrow();
		}
	});

	it("accepts normal names", () => {
		for (const good of ["scout", "scout-01", "scout_01", "SCOUT", "narrator-2"]) {
			expect(() => validateProfileName(good)).not.toThrow();
		}
	});
});
