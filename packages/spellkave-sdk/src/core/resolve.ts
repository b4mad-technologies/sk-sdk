// Profile + connection resolution precedence.
//
// Mirrors the Rust contract in `client/src/resolve.rs` exactly:
//
//   Profile selection precedence:
//     1. explicit override (CLI --profile, or `/spellkave <name>` argument)
//     2. last-used profile from state
//     3. default_profile in app config
//     4. None
//
//   Connection field precedence (per field):
//     1. explicit override (--url / --db; pi has no equivalent yet, but the
//        slot exists for parity with the Rust contract)
//     2. selected profile's connection.{url, db}
//     3. built-in default
//
// A last-used pointer whose profile file is gone is skipped (sk-sol) rather
// than failing the whole connection — switching adventures must not inherit a
// dead seat. Explicit `--profile` still fails closed.
//
// Source-of-truth tags follow the Rust enum ordering for diagnostics.
//
// Browser-reachable through the `@spellkave/sdk` barrel: NO top-level `node:*`
// imports. File reads come in through injected `io` readers; Node hosts get the
// `node:fs`-backed defaults from `@spellkave/sdk/node` (`node-io.ts`).

import {
	appConfigFile,
	type CliPaths,
	checkedProfileFile,
	lastUsedProfileFile,
	scopedCurrentContextFile,
	scopedLastUsedProfileFile,
	validateProfileName,
} from "./paths";
import type { AppConfig, PersonaProfile } from "./profile";
import { loadAppConfigFromDisk, loadProfileFromDisk } from "./profile";

export type Source = "flag" | "profile" | "built_in";
export type ProfileSource = "flag" | "last_used" | "app_config_default" | "none";

export interface ResolvedConnection {
	url: string;
	db: string;
	profile: string | undefined;
	url_source: Source;
	db_source: Source;
	profile_source: ProfileSource;
}

export interface CliOverrides {
	url?: string;
	db?: string;
	/**
	 * Explicit profile override. For pi this comes from the optional argument
	 * to `/spellkave <profile-name>`; for the Rust CLI it is `--profile`.
	 */
	profile?: string;
}

export interface ResolutionInputs {
	paths: CliPaths;
	built_in_url: string;
	built_in_db: string;
	/**
	 * Last-used profile name. Pass `undefined` for invocations that should
	 * NOT honor remembered state (e.g. one-shot scripted reads).
	 */
	last_used_profile: string | undefined;
	/**
	 * Test/override hooks for fs reads. Production callers leave undefined.
	 */
	io?: { readFileSync?: (path: string) => string };
}

export function resolveConnection(
	overrides: CliOverrides,
	inputs: ResolutionInputs,
): ResolvedConnection {
	const io = inputs.io ?? {};
	const appCfg = loadAppConfigFromDisk(appConfigFile(inputs.paths), io);
	let selected = pickProfile(overrides, appCfg, inputs.last_used_profile);
	if (selected.name !== undefined) {
		validateProfileName(selected.name);
	}
	let profile: PersonaProfile | undefined;
	if (selected.name !== undefined) {
		try {
			profile = loadProfileFromDisk(checkedProfileFile(inputs.paths, selected.name), io);
		} catch (err) {
			if (selected.source !== "last_used") throw err;
			// Dead last-used pointer from a previous adventure/worktree: skip it.
			selected = pickProfile(overrides, appCfg, undefined);
			if (selected.name !== undefined) {
				validateProfileName(selected.name);
				profile = loadProfileFromDisk(checkedProfileFile(inputs.paths, selected.name), io);
			}
		}
	}
	const [url, urlSource] = pickField(overrides.url, profile?.connection.url, inputs.built_in_url);
	const [db, dbSource] = pickField(overrides.db, profile?.connection.db, inputs.built_in_db);
	return {
		url,
		db,
		profile: selected.name,
		url_source: urlSource,
		db_source: dbSource,
		profile_source: selected.source,
	};
}

function pickProfile(
	overrides: CliOverrides,
	appCfg: AppConfig,
	lastUsed: string | undefined,
): { name: string | undefined; source: ProfileSource } {
	if (overrides.profile !== undefined) {
		return { name: overrides.profile, source: "flag" };
	}
	if (lastUsed !== undefined) {
		return { name: lastUsed, source: "last_used" };
	}
	if (appCfg.default_profile !== undefined) {
		return { name: appCfg.default_profile, source: "app_config_default" };
	}
	return { name: undefined, source: "none" };
}

function pickField(
	flag: string | undefined,
	profileValue: string | undefined,
	builtIn: string,
): [string, Source] {
	if (flag !== undefined) return [flag, "flag"];
	if (profileValue !== undefined) return [profileValue, "profile"];
	return [builtIn, "built_in"];
}

/**
 * Read last-used profile state. Returns `undefined` for missing or empty
 * file (normal first-run). Pass `worktreeRoot` to read the per-worktree
 * pointer (`last_used_profiles/by_worktree/<hash>`); omit it only to inspect
 * the legacy app-global file.
 */
export function readLastUsedProfile(
	paths: CliPaths,
	io: { readFileSync?: (p: string) => string } = {},
	worktreeRoot?: string,
): string | undefined {
	const reader = io.readFileSync;
	if (reader === undefined) {
		throw new Error(
			"readLastUsedProfile requires io.readFileSync; use @spellkave/sdk/node for the Node-bound default",
		);
	}
	const file =
		worktreeRoot === undefined
			? lastUsedProfileFile(paths)
			: scopedLastUsedProfileFile(paths, worktreeRoot);
	try {
		const raw = reader(file);
		const trimmed = raw.trim();
		return trimmed.length === 0 ? undefined : trimmed;
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
		throw err;
	}
}

/**
 * Read the per-worktree current context (`current_context/by_worktree/<hash>`).
 * Returns `undefined` for a missing or empty file. Never falls back to the
 * last-used pointer: the two are separate on purpose (sk-config-contexts D1).
 */
export function readCurrentContext(
	paths: CliPaths,
	io: { readFileSync?: (p: string) => string },
	worktreeRoot: string,
): string | undefined {
	const reader = io.readFileSync;
	if (reader === undefined) {
		throw new Error(
			"readCurrentContext requires io.readFileSync; use @spellkave/sdk/node for the Node-bound default",
		);
	}
	try {
		const trimmed = reader(scopedCurrentContextFile(paths, worktreeRoot)).trim();
		return trimmed.length === 0 ? undefined : trimmed;
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined;
		throw err;
	}
}

/**
 * List candidate profile names by reading the `profiles/` dir.
 * Used by the `/spellkave <profile-name>` argument completer.
 * Returns names sorted alphabetically; missing dir → empty array.
 */
export function listProfileNames(
	paths: CliPaths,
	io: { readdirSync?: (p: string) => string[] } = {},
): string[] {
	const reader = io.readdirSync;
	if (reader === undefined) {
		throw new Error(
			"listProfileNames requires io.readdirSync; use @spellkave/sdk/node for the Node-bound default",
		);
	}
	try {
		const entries = reader(`${paths.config}/profiles`);
		return entries
			.filter((e) => e.endsWith(".toml"))
			.map((e) => e.slice(0, -".toml".length))
			.filter((n) => {
				try {
					validateProfileName(n);
					return true;
				} catch {
					return false;
				}
			})
			.sort();
	} catch (err: unknown) {
		if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return [];
		throw err;
	}
}
