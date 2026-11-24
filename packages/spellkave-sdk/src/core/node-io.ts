// Node-only I/O bindings for the host-neutral SDK core modules.
//
// This is the SINGLE SDK file that imports Node builtins (`node:fs`/`node:os`).
// The browser-reachable core modules (`credential`, `paths`, `profile`,
// `resolve`) are pure: they take injected readers and a `home` string, with no
// top-level `node:*` import. Pulling them through the `@spellkave/sdk` barrel
// must NOT drag `node:fs` into a Vite dev pre-bundle — that externalizes the
// builtin into a shim that throws at module-eval and blanks the app. The
// `__tests__/browser-import-boundary.test.ts` guard encodes that invariant.
//
// Node hosts (the pi extension `main.ts`, the world-explorer wanderer) import
// their file-system-bound variants of these functions from here — exposed as
// the `@spellkave/sdk/node` subpath — instead of from the pure modules. Each
// wrapper just pre-injects the `node:fs`/`node:os` defaults that used to live
// inside the pure modules, preserving the original behavior exactly.

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";

import {
	type CredentialRef,
	type CredentialResolveEnv,
	resolveCredential as resolveCredentialPure,
	resolveSpacetimeClientCredentialToken as resolveSpacetimeClientCredentialTokenPure,
	resolveSpacetimeConfigPathToken as resolveSpacetimeConfigPathTokenPure,
	resolveSpacetimeLoginToken as resolveSpacetimeLoginTokenPure,
	type SpacetimeConfigTokenResolveEnv,
} from "./credential";
import {
	type CliPaths,
	type CliPathsEnv,
	resolveCliPaths as resolveCliPathsPure,
	scopedCurrentContextFile,
	scopedLastUsedProfileFile,
	validateProfileName,
} from "./paths";
import {
	type AppConfig,
	loadAppConfigFromDisk as loadAppConfigFromDiskPure,
	loadProfileFromDisk as loadProfileFromDiskPure,
	type PersonaProfile,
} from "./profile";
import {
	type CliOverrides,
	listProfileNames as listProfileNamesPure,
	type ResolutionInputs,
	type ResolvedConnection,
	readCurrentContext as readCurrentContextPure,
	readLastUsedProfile as readLastUsedProfilePure,
	resolveConnection as resolveConnectionPure,
} from "./resolve";

// --- Node-backed reader primitives ------------------------------------------

export function nodeReadFileUtf8(path: string): string {
	return readFileSync(path, "utf8");
}

export function nodeReadFileBytes(path: string): Uint8Array {
	return readFileSync(path);
}

export function nodeReaddirSync(path: string): string[] {
	return readdirSync(path);
}

export function nodeHomedir(): string {
	return homedir();
}

/**
 * Walk `cwd` (default: process.cwd) for a `.git` file or directory, matching
 * `client/src/state.rs` `worktree_root_from_dir`. Canonicalizes when possible
 * so the TypeScript last-used hash matches the Rust CLI.
 */
export function currentWorktreeRoot(cwd = process.cwd()): string | undefined {
	let dir = resolvePath(cwd);
	while (true) {
		if (existsSync(join(dir, ".git"))) {
			try {
				return realpathSync(dir);
			} catch {
				return dir;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

// --- Node-bound wrappers over the pure core functions ------------------------

export function resolveCliPaths(opts: CliPathsEnv = {}): CliPaths {
	return resolveCliPathsPure({ ...opts, home: opts.home ?? nodeHomedir() });
}

export function resolveCredential(ref: CredentialRef, opts: CredentialResolveEnv = {}): string {
	return resolveCredentialPure(ref, { ...opts, readFile: opts.readFile ?? nodeReadFileUtf8 });
}

export function resolveSpacetimeLoginToken(opts: CredentialResolveEnv = {}): string {
	return resolveSpacetimeLoginTokenPure({
		...opts,
		home: opts.home ?? nodeHomedir(),
		readFile: opts.readFile ?? nodeReadFileUtf8,
	});
}

export function resolveSpacetimeConfigPathToken(
	opts: SpacetimeConfigTokenResolveEnv = {},
): string | undefined {
	return resolveSpacetimeConfigPathTokenPure({
		...opts,
		readFile: opts.readFile ?? nodeReadFileUtf8,
	});
}

export function resolveSpacetimeClientCredentialToken(
	url: string,
	db: string,
	opts: SpacetimeConfigTokenResolveEnv = {},
): string | undefined {
	return resolveSpacetimeClientCredentialTokenPure(url, db, {
		...opts,
		home: opts.home ?? nodeHomedir(),
		readFileBytes: opts.readFileBytes ?? nodeReadFileBytes,
	});
}

export function loadAppConfigFromDisk(path: string): AppConfig {
	return loadAppConfigFromDiskPure(path, { readFileSync: nodeReadFileUtf8 });
}

export function loadProfileFromDisk(path: string): PersonaProfile {
	return loadProfileFromDiskPure(path, { readFileSync: nodeReadFileUtf8 });
}

export function resolveConnection(
	overrides: CliOverrides,
	inputs: ResolutionInputs,
): ResolvedConnection {
	return resolveConnectionPure(overrides, {
		...inputs,
		io: { readFileSync: nodeReadFileUtf8, ...inputs.io },
	});
}

export function readLastUsedProfile(paths: CliPaths): string | undefined {
	const root = currentWorktreeRoot();
	if (root === undefined) return undefined;
	return readLastUsedProfilePure(paths, { readFileSync: nodeReadFileUtf8 }, root);
}

/**
 * Persist the last-used profile name for the CURRENT worktree. No-op (returns
 * undefined) when cwd is not inside a git worktree — matching the Rust CLI,
 * which cannot scope a last-used pointer without a worktree root.
 */
export function writeLastUsedProfile(paths: CliPaths, name: string): string | undefined {
	const root = currentWorktreeRoot();
	if (root === undefined) return undefined;
	const file = scopedLastUsedProfileFile(paths, root);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${name.trim()}\n`, "utf8");
	return file;
}

/**
 * The current author context for `cwd`'s worktree, or `undefined` when none is
 * set or `cwd` is outside a git worktree (sk-config-contexts D1).
 */
export function readCurrentContext(paths: CliPaths, cwd?: string): string | undefined {
	const root = currentWorktreeRoot(cwd);
	if (root === undefined) return undefined;
	return readCurrentContextPure(paths, { readFileSync: nodeReadFileUtf8 }, root);
}

/**
 * Select the current author context for `cwd`'s worktree. Throws outside a git
 * worktree, since the pointer cannot be scoped there; unlike the last-used
 * pointer this is an explicit user action, so silence would hide the failure.
 */
export function writeCurrentContext(paths: CliPaths, name: string, cwd?: string): string {
	validateProfileName(name);
	const root = currentWorktreeRoot(cwd);
	if (root === undefined) {
		throw new Error(
			"current directory is not inside a git worktree; cannot scope the current context",
		);
	}
	const file = scopedCurrentContextFile(paths, root);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, `${name.trim()}\n`, "utf8");
	return file;
}

export function listProfileNames(paths: CliPaths): string[] {
	return listProfileNamesPure(paths, { readdirSync: nodeReaddirSync });
}
