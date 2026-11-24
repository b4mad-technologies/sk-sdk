/**
 * Scrubbed `git` spawn helper for tests — sk-jay0.7.164.14.
 *
 * Why: on 2026-09-24 the preflight pre-push hook (sk-jay0.7.164.9) ran the
 * ops vitest suite with `GIT_DIR` inherited from git's own hook
 * environment. `packages/spellkave-ops/src/images-resolve-set.test.ts`
 * builds a scratch git history in a tmp dir (`git init`, `git config`,
 * three commits) with `cwd` set to that tmp dir — but `git` always prefers
 * `GIT_DIR`/`GIT_WORK_TREE` over `cwd` when they are set. With `GIT_DIR`
 * leaked in, every one of those commands targeted the REAL repository
 * instead: three commits deleting 1,553 files landed on the lane branch and
 * the `git config` calls landed in the shared `.bare/config`, disabling
 * hooks and mis-authoring eight commits on five branches for about 45
 * minutes. `preflight.sh` now scrubs its own environment before invoking
 * the suite (same bead), but any OTHER runner that happens to export
 * `GIT_DIR` (an IDE test runner started from a hook, a future hook, a CI
 * action) would reproduce the exact same incident — the fixture class
 * itself was the danger, not just the one caller that tripped it.
 *
 * What: every test that spawns `git` — whether to build a scratch history
 * or just to read the real repo's toplevel/HEAD — should go through
 * {@link execFileSyncGit} or {@link spawnSyncGit} instead of calling
 * `node:child_process`'s `execFileSync("git", ...)` / `spawnSync("git",
 * ...)` directly. Both strip the git-location env vars a parent process
 * (git hooks, `git rebase`, some CI actions) can set, and disable both
 * config layers a scrubbed run should never read:
 *
 *   - `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_COMMON_DIR`,
 *     `GIT_PREFIX`, `GIT_OBJECT_DIRECTORY`,
 *     `GIT_ALTERNATE_OBJECT_DIRECTORIES` — removed, so `git` falls back to
 *     discovering the repository from `cwd` the way a human typing the same
 *     command would.
 *   - `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1` — set, so a
 *     developer's global `core.hooksPath` (pre-commit dispatchers, beads
 *     sync) can't run inside a scratch repo the test builds, and no
 *     machine-specific system config leaks into the result.
 *
 * `check-test-git-env-scrub` (`../gates/check-test-git-env-scrub.ts`) is the
 * registry gate that fails a `*.test.ts`/`*.test.mjs` file which execs
 * `git` directly instead of through this module.
 */

import {
	type ExecFileSyncOptionsWithStringEncoding,
	execFileSync,
	type SpawnSyncOptionsWithStringEncoding,
	type SpawnSyncReturns,
	spawnSync,
} from "node:child_process";

/**
 * Location env vars that make `git` ignore `cwd` and operate on a different
 * repository than the caller intended. A parent process (a git hook, `git
 * rebase --exec`, some CI actions) can set these for ITS OWN git
 * invocation and they inherit into any child process that does not clear
 * them.
 */
export const GIT_LOCATION_ENV_KEYS = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_COMMON_DIR",
	"GIT_PREFIX",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
] as const;

/**
 * Returns a copy of `base` (default `process.env`) with every
 * {@link GIT_LOCATION_ENV_KEYS} entry removed and both config layers a
 * scrubbed run should never read disabled. Exported on its own so a caller
 * that cannot use {@link execFileSyncGit}/{@link spawnSyncGit} (a
 * `spawn`-based long-lived process, for instance) can still build the same
 * environment by hand.
 */
export function scrubbedGitEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...base };
	for (const key of GIT_LOCATION_ENV_KEYS) delete env[key];
	env.GIT_CONFIG_GLOBAL = "/dev/null";
	env.GIT_CONFIG_NOSYSTEM = "1";
	return env;
}

/** `options` for {@link execFileSyncGit}/{@link spawnSyncGit} — every field of the real options type except `encoding`, which defaults to `"utf8"` and can only be overridden to another string encoding (never `"buffer"`/`null`), so the return type stays honestly `string`. */
type StringEncodingOptions<T extends { encoding?: unknown }> = Omit<T, "encoding"> & {
	encoding?: BufferEncoding;
};

/**
 * `execFileSync("git", args, options)` with {@link scrubbedGitEnv} applied
 * to `options.env` (defaulting from `process.env` when the caller does not
 * pass one) and `encoding` defaulted to `"utf8"` — every current caller
 * wants text output, and making `encoding` optional lets a caller pass just
 * `{ cwd }` instead of repeating it at every call site.
 */
export function execFileSyncGit(
	args: readonly string[],
	options: StringEncodingOptions<ExecFileSyncOptionsWithStringEncoding> = {},
): string {
	return execFileSync("git", args as string[], {
		encoding: "utf8",
		...options,
		env: scrubbedGitEnv(options.env ?? process.env),
	});
}

/**
 * `spawnSync("git", args, options)` with {@link scrubbedGitEnv} applied to
 * `options.env` and `encoding` defaulted to `"utf8"` (see
 * {@link execFileSyncGit}).
 */
export function spawnSyncGit(
	args: readonly string[],
	options: StringEncodingOptions<SpawnSyncOptionsWithStringEncoding> = {},
): SpawnSyncReturns<string> {
	return spawnSync("git", args as string[], {
		encoding: "utf8",
		...options,
		env: scrubbedGitEnv(options.env ?? process.env),
	});
}
