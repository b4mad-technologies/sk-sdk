// XDG / SPELLKAVE_HOME path resolution for the Spellkave pi extension.
//
// Mirrors the Rust contract in `client/src/paths.rs`:
//   * SPELLKAVE_HOME override → <root>/{config,state,cache}
//   * otherwise XDG defaults on every platform (including macOS and Windows):
//       config: ${XDG_CONFIG_HOME:-$HOME/.config}/spellkave
//       state:  ${XDG_STATE_HOME:-$HOME/.local/state}/spellkave
//       cache:  ${XDG_CACHE_HOME:-$HOME/.cache}/spellkave
//   * profile names go through the same validation rules as the Rust CLI.
//
// The Rust CLI does NOT use `directories`/`ProjectDirs` — it uses XDG directly,
// so we must not branch on `darwin`/`win32` to native app-data roots. Doing so
// forks persona state from the CLI (BUG-001).
//
// This module is browser-reachable through the `@spellkave/sdk` barrel, so it
// MUST NOT import Node builtins at the top level (see `node-io.ts`). Path
// joining is pure string work (XDG forward-slash on every platform, matching
// the Rust contract); the `home` default lives in the Node-only `node-io.ts`.

export const ENV_OVERRIDE_ROOT = "SPELLKAVE_HOME";
const APP_NAME = "spellkave";

/**
 * Pure POSIX-style path join. The XDG contract above is forward-slash on every
 * platform (matching the Rust CLI), and profile names are `..`/separator-free
 * by `validateProfileName`, so a segment join + slash collapse is faithful to
 * `node:path`'s `join` for every path this module builds — without dragging
 * `node:path` into the browser bundle.
 */
function joinPath(...segments: string[]): string {
	return segments
		.filter((s) => s.length > 0)
		.join("/")
		.replace(/\/{2,}/g, "/");
}

export interface CliPaths {
	config: string;
	state: string;
	cache: string;
}

export interface CliPathsEnv {
	/** Process env. Tests inject a synthetic record. */
	env?: NodeJS.ProcessEnv;
	/** Home dir override for tests. */
	home?: string;
	/**
	 * Platform override for tests. Accepted but ignored — path resolution is
	 * XDG on every platform. Kept so existing call sites compile.
	 */
	platform?: NodeJS.Platform;
}

/**
 * Resolve XDG-style roots for the installed Spellkave CLI / extension.
 * Honors SPELLKAVE_HOME first, then falls back to platform conventions.
 */
export function resolveCliPaths(opts: CliPathsEnv = {}): CliPaths {
	const env = opts.env ?? process.env;

	const override = env[ENV_OVERRIDE_ROOT];
	if (override && override.length > 0) {
		return {
			config: joinPath(override, "config"),
			state: joinPath(override, "state"),
			cache: joinPath(override, "cache"),
		};
	}

	// XDG fallback needs a home dir. This module is pure, so the Node-bound
	// `homedir()` default is injected by `@spellkave/sdk/node`'s wrapper.
	const home = opts.home;
	if (home === undefined) {
		throw new Error(
			"resolveCliPaths requires opts.home outside SPELLKAVE_HOME; use @spellkave/sdk/node for the Node-bound default",
		);
	}

	// XDG on every platform — must match the Rust CLI on macOS/Windows too.
	const configHome =
		env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.length > 0
			? env.XDG_CONFIG_HOME
			: joinPath(home, ".config");
	const stateHome =
		env.XDG_STATE_HOME && env.XDG_STATE_HOME.length > 0
			? env.XDG_STATE_HOME
			: joinPath(home, ".local", "state");
	const cacheHome =
		env.XDG_CACHE_HOME && env.XDG_CACHE_HOME.length > 0
			? env.XDG_CACHE_HOME
			: joinPath(home, ".cache");
	return {
		config: joinPath(configHome, APP_NAME),
		state: joinPath(stateHome, APP_NAME),
		cache: joinPath(cacheHome, APP_NAME),
	};
}

export const APP_CONFIG_FILENAME = "config.toml";
/** Legacy app-global last-used file. Production reads ignore it (sk-sol / sk-1p83). */
export const LAST_USED_PROFILE_FILENAME = "last_used_profile";
/** One remembered profile per git worktree root — matches `client/src/state.rs`. */
export const LAST_USED_PROFILES_DIR = "last_used_profiles/by_worktree";
/**
 * One explicitly selected author context per git worktree root (change
 * `sk-config-contexts`). Same hash and shape as the last-used pointer, but
 * only `sk config use-context` and `sk dev up` write it.
 */
export const CURRENT_CONTEXT_DIR = "current_context/by_worktree";

export function appConfigFile(paths: CliPaths): string {
	return joinPath(paths.config, APP_CONFIG_FILENAME);
}

export function profilesDir(paths: CliPaths): string {
	return joinPath(paths.config, "profiles");
}

export function profileFile(paths: CliPaths, name: string): string {
	return joinPath(profilesDir(paths), `${name}.toml`);
}

export function checkedProfileFile(paths: CliPaths, name: string): string {
	validateProfileName(name);
	return profileFile(paths, name);
}

export function personaStateDir(paths: CliPaths, profile: string): string {
	return joinPath(paths.state, "personas", profile);
}

export function checkedPersonaStateDir(paths: CliPaths, profile: string): string {
	validateProfileName(profile);
	return personaStateDir(paths, profile);
}

export function lastUsedProfileFile(paths: CliPaths): string {
	return joinPath(paths.state, LAST_USED_PROFILE_FILENAME);
}

/**
 * FNV-1a 64-bit, matching `client/src/state.rs` `stable_scope_key` so the
 * TypeScript hosts and the Rust CLI remember the same per-worktree pointer.
 */
export function worktreeScopeKey(worktreeRoot: string): string {
	let hash = 0xcbf29ce484222325n;
	const prime = 0x100000001b3n;
	const mask = 0xffffffffffffffffn;
	for (const byte of new TextEncoder().encode(worktreeRoot)) {
		hash ^= BigInt(byte);
		hash = (hash * prime) & mask;
	}
	return hash.toString(16).padStart(16, "0");
}

export function scopedLastUsedProfileFile(paths: CliPaths, worktreeRoot: string): string {
	return joinPath(paths.state, LAST_USED_PROFILES_DIR, worktreeScopeKey(worktreeRoot));
}

export function scopedCurrentContextFile(paths: CliPaths, worktreeRoot: string): string {
	return joinPath(paths.state, CURRENT_CONTEXT_DIR, worktreeScopeKey(worktreeRoot));
}

/**
 * Name of the local-node profile `sk dev up` owns for one worktree:
 * `local-<dir name>-<first 6 hex of worktreeScopeKey>`. Profiles are global,
 * so the hash keeps two clones with the same directory name apart.
 */
export function localNodeProfileName(worktreeRoot: string): string {
	const trimmed = worktreeRoot.replace(/[/\\]+$/, "");
	const base = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
	const safe = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^[-.]+/, "") || "worktree";
	return `local-${safe}-${worktreeScopeKey(worktreeRoot).slice(0, 6)}`;
}

const LOCAL_NODE_PROFILE = /^local-.+-[0-9a-f]{6}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);

/**
 * True for a profile `sk dev up` wrote: the `local-<worktree>-<6 hex>` name
 * pattern AND a loopback URL. Only such a profile may omit its credential and
 * fall back to the local SpacetimeDB client credential (sk-config-contexts D3).
 */
export function isLocalNodeProfile(name: string, url: string): boolean {
	if (!LOCAL_NODE_PROFILE.test(name)) return false;
	try {
		return LOOPBACK_HOSTS.has(new URL(url).hostname);
	} catch {
		return false;
	}
}

/**
 * Reject profile names that could escape the `profiles/` directory or
 * abuse the filesystem. Mirrors the Rust `validate_profile_name` exactly:
 *   * non-empty
 *   * does not start with `.`
 *   * no `..` substring
 *   * no `/`, `\`, or NUL bytes
 *
 * Throws on rejection. Use this on every name reaching the filesystem from
 * user input (including the optional `/spellkave <profile-name>` argument).
 */
export function validateProfileName(name: string): void {
	if (name.length === 0) {
		throw new Error("profile name must not be empty");
	}
	if (name.startsWith(".")) {
		throw new Error(`profile name must not start with '.' (rejects '..', hidden files): ${name}`);
	}
	if (name.includes("..")) {
		throw new Error(`profile name must not contain '..' (path traversal): ${name}`);
	}
	for (const c of name) {
		if (c === "/" || c === "\\" || c === "\0") {
			throw new Error(`profile name must not contain path separators or NUL: ${name}`);
		}
	}
}
