// Credential reference resolution.
//
// Mirrors the Rust `CredentialRef` enum in `client/src/credential.rs` and
// the documented `cloud`/maincloud token-fallback semantics from
// `openspec/specs/cli-persona-profiles/spec.md`.
//
// Variants supported:
//   * { kind: "env_var", name }         — read non-empty env var
//   * { kind: "file", path }            — read first non-empty line of file
//   * { kind: "inline", value }         — literal value (local-dev only)
//   * undefined credential + cloud preset → resolve via `spacetime login` token
//
// Failure modes are uniform: missing, unreadable, or empty source → throw.
//
// Browser-reachable through the `@spellkave/sdk` barrel: NO top-level `node:*`
// imports. File reads and the `home` dir come in through injected readers; Node
// hosts get the `node:fs`/`node:os`-backed defaults from `@spellkave/sdk/node`
// (`node-io.ts`). `smol-toml` and `Buffer` are pure/runtime-shimmed, so they
// stay.

import { parse as parseToml } from "smol-toml";

/**
 * Pure POSIX-style path join. The credential/token files this module addresses
 * live under `$HOME` with forward-slash segments; a segment join + slash
 * collapse matches `node:path`'s `join` without dragging it into the browser
 * bundle.
 */
function joinPath(...segments: string[]): string {
	return segments
		.filter((s) => s.length > 0)
		.join("/")
		.replace(/\/{2,}/g, "/");
}

export type CredentialRef =
	| { kind: "env_var"; name: string }
	| { kind: "file"; path: string }
	| { kind: "inline"; value: string };

/**
 * Static well-formedness check that does NOT touch env or fs (except File,
 * which we leave to `resolveCredential`). Mirrors the Rust `validate()`.
 */
export type CredentialValidation =
	| { kind: "ok" }
	| { kind: "empty" }
	| { kind: "missing_path"; path: string };

export function validateCredentialRef(ref: CredentialRef): CredentialValidation {
	switch (ref.kind) {
		case "env_var":
			return ref.name.length === 0 ? { kind: "empty" } : { kind: "ok" };
		case "inline":
			return ref.value.length === 0 ? { kind: "empty" } : { kind: "ok" };
		case "file":
			return ref.path.length === 0 ? { kind: "empty" } : { kind: "ok" };
	}
}

export interface CredentialResolveEnv {
	env?: NodeJS.ProcessEnv;
	/** Override fs reader; tests inject. */
	readFile?: (path: string) => string;
	/** Override `spacetime login` token reader; tests inject. */
	readSpacetimeToken?: () => string | undefined;
	/** Optional home dir override for the default token reader. */
	home?: string;
}

export interface SpacetimeConfigTokenResolveEnv {
	env?: NodeJS.ProcessEnv;
	/** Override fs reader; tests inject. */
	readFile?: (path: string) => string;
	/** Override binary fs reader; tests inject. */
	readFileBytes?: (path: string) => Uint8Array;
	/** Optional home dir override for the Rust SDK credential-file reader. */
	home?: string;
}

/**
 * Resolve a credential reference to its raw secret string. Fails closed on
 * missing, unreadable, or empty sources. The caller must NEVER catch and
 * fall back silently — that would defeat the contract.
 */
export function resolveCredential(ref: CredentialRef, opts: CredentialResolveEnv = {}): string {
	switch (ref.kind) {
		case "env_var": {
			if (ref.name.length === 0) {
				throw new Error("credential env_var.name is empty");
			}
			const env = opts.env ?? process.env;
			const v = env[ref.name];
			if (v === undefined || v.length === 0) {
				throw new Error(`credential env_var '${ref.name}' is missing or empty`);
			}
			return v;
		}
		case "file": {
			if (ref.path.length === 0) {
				throw new Error("credential file.path is empty");
			}
			const reader = opts.readFile;
			if (reader === undefined) {
				throw new Error(
					"credential file resolution requires opts.readFile; use @spellkave/sdk/node for the Node-bound default",
				);
			}
			let raw: string;
			try {
				raw = reader(ref.path);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				throw new Error(`credential file '${ref.path}' is unreadable: ${msg}`);
			}
			const trimmed = raw.split(/\r?\n/, 1)[0]?.trim() ?? "";
			if (trimmed.length === 0) {
				throw new Error(`credential file '${ref.path}' is empty`);
			}
			return trimmed;
		}
		case "inline": {
			if (ref.value.length === 0) {
				throw new Error("credential inline.value is empty");
			}
			return ref.value;
		}
	}
}

/**
 * Resolve identity for the documented `cloud`/maincloud profile preset where
 * the profile carries NO `credential` field — read the host's
 * `spacetime login` token instead. Fails closed when no token is present.
 *
 * The default reader prefers the real Spacetime CLI config at
 * `~/.config/spacetime/cli.toml` (top-level `spacetimedb_token` key — the
 * same store written by `spacetime login`), then falls back to legacy bare
 * `token` files for older installs. Callers can override via
 * `opts.readSpacetimeToken` for tests.
 */
export function resolveSpacetimeLoginToken(opts: CredentialResolveEnv = {}): string {
	const reader = opts.readSpacetimeToken ?? (() => defaultReadSpacetimeToken(opts));
	const token = reader();
	if (token === undefined || token.length === 0) {
		throw new Error(
			"no `spacetime login` token found; run `spacetime login` or set a credential reference on the profile",
		);
	}
	return token;
}

/**
 * Resolve the per-worktree SpacetimeDB token from SPACETIME_CONFIG_PATH.
 *
 * Unlike `resolveSpacetimeLoginToken`, this is best-effort: local harnesses use
 * it only when they explicitly opt into token reuse, and callers that still need
 * anonymous connections can ignore the undefined result.
 */
export function resolveSpacetimeConfigPathToken(
	opts: SpacetimeConfigTokenResolveEnv = {},
): string | undefined {
	const env = opts.env ?? process.env;
	const configPath = env.SPACETIME_CONFIG_PATH;
	if (configPath === undefined || configPath.length === 0) return undefined;

	const reader = opts.readFile;
	if (reader === undefined) {
		throw new Error(
			"resolveSpacetimeConfigPathToken requires opts.readFile; use @spellkave/sdk/node for the Node-bound default",
		);
	}
	try {
		const parsed = parseToml(reader(configPath)) as Record<string, unknown>;
		const token = parsed.spacetimedb_token;
		return typeof token === "string" && token.length > 0 ? token : undefined;
	} catch {
		return undefined;
	}
}

export function spacetimeClientCredentialKey(url: string, db: string): string {
	let key = "spellkave-";
	for (const ch of `${url}-${db}`) {
		key += /[A-Za-z0-9_-]/.test(ch) ? ch : "_";
	}
	return key;
}

/**
 * Resolve the token saved by the Rust `spacetimedb_sdk::credentials::File`
 * store used by `spellkave manifest apply`. Local walkthrough sweeps seed via
 * that Rust client, so this is the authoritative token for `$sender`-bound
 * actors in the freshly seeded world.
 */
export function resolveSpacetimeClientCredentialToken(
	url: string,
	db: string,
	opts: SpacetimeConfigTokenResolveEnv = {},
): string | undefined {
	const home = opts.home;
	const reader = opts.readFileBytes;
	if (home === undefined || reader === undefined) {
		throw new Error(
			"resolveSpacetimeClientCredentialToken requires opts.home + opts.readFileBytes; use @spellkave/sdk/node for the Node-bound defaults",
		);
	}
	const path = joinPath(
		home,
		".spacetimedb_client_credentials",
		spacetimeClientCredentialKey(url, db),
	);
	try {
		return decodeRustSdkCredentialToken(reader(path));
	} catch {
		return undefined;
	}
}

export function decodeRustSdkCredentialToken(bytes: Uint8Array): string | undefined {
	if (bytes.length < 4) return undefined;
	// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
	const len = bytes[0]! | (bytes[1]! << 8) | (bytes[2]! << 16) | (bytes[3]! << 24);
	if (len <= 0 || bytes.length < 4 + len) return undefined;
	return Buffer.from(bytes.subarray(4, 4 + len)).toString("utf8");
}

function defaultReadSpacetimeToken(opts: CredentialResolveEnv): string | undefined {
	const home = opts.home;
	const reader = opts.readFile;
	if (home === undefined || reader === undefined) {
		throw new Error(
			"resolveSpacetimeLoginToken's default reader requires opts.home + opts.readFile; use @spellkave/sdk/node for the Node-bound defaults",
		);
	}
	const cliToml = joinPath(home, ".config", "spacetime", "cli.toml");
	try {
		const raw = reader(cliToml);
		const parsed = parseToml(raw) as Record<string, unknown>;
		const tok = parsed.spacetimedb_token;
		if (typeof tok === "string" && tok.trim().length > 0) return tok.trim();
	} catch {
		// fall through to legacy candidates
	}
	const legacy = [
		joinPath(home, ".config", "spacetime", "token"),
		joinPath(home, "Library", "Application Support", "SpacetimeDB", "token"),
	];
	for (const path of legacy) {
		try {
			const raw = reader(path);
			const trimmed = raw.trim();
			if (trimmed.length > 0) return trimmed;
		} catch {
			// try next
		}
	}
	return undefined;
}
