// Socket + log path derivation for the session daemon (#1990 decision 4/5).
//
// Socket path: `$XDG_RUNTIME_DIR/spellkave/session-<hash12>.sock`, falling
// back to `~/.spellkave/run/` when `XDG_RUNTIME_DIR` is unset (macOS has no
// XDG runtime dir by default). The containing directory is created `0o700`;
// the socket file itself is chmod'd `0o600` once bound (`daemon.ts`) — both
// steps belong here so every caller (daemon, spawn probe, tests) derives the
// same paths and the same permission discipline from one place.

import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { canonicalBindingJson, type SessionBinding } from "../binding.ts";

const RUN_SUBDIR = "spellkave";

/** Synchronous sha256 hex digest via `node:crypto` — the Node-bound `Sha256Hex`. */
export function sha256HexNode(input: string): string {
	return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Same 12-hex-char digest `hashBinding` (core, async, WebCrypto) produces,
 * computed synchronously so socket-path derivation never has to await. Both
 * hash the same `canonicalBindingJson` input through sha256 — see
 * `__tests__/binding.test.ts` for the cross-check that keeps them from
 * silently diverging.
 */
export function bindingHash12(binding: SessionBinding): string {
	return sha256HexNode(canonicalBindingJson(binding)).slice(0, 12);
}

/** `$XDG_RUNTIME_DIR/spellkave`, or `~/.spellkave/run` when unset/empty. */
export function runtimeDir(env: NodeJS.ProcessEnv = process.env): string {
	const xdg = env.XDG_RUNTIME_DIR;
	if (xdg !== undefined && xdg.length > 0) return join(xdg, RUN_SUBDIR);
	return join(homedir(), ".spellkave", "run");
}

/** The unix socket path a binding's daemon listens on. */
export function socketPath(binding: SessionBinding, env?: NodeJS.ProcessEnv): string {
	return join(runtimeDir(env), `session-${bindingHash12(binding)}.sock`);
}

/** Where `spawn.ts` redirects a spawned daemon's stdio (herdr's `*-server.log` convention). */
export function logPath(binding: SessionBinding, env?: NodeJS.ProcessEnv): string {
	return join(runtimeDir(env), `session-${bindingHash12(binding)}.log`);
}

/**
 * Fallback `agent-run-events.jsonl` location for the daemon's own run
 * (#2003): next to the daemon's log, in the same runtime dir this module
 * already owns. `@spellkave/session/node`'s `observability.ts` only reaches
 * for this when `CAMPAIGN_ARTIFACTS_ROOT` is unset — the Pi-mirrored default.
 */
export function runEventsPath(binding: SessionBinding, env?: NodeJS.ProcessEnv): string {
	return join(runtimeDir(env), `session-${bindingHash12(binding)}-run-events.jsonl`);
}

/**
 * Create `path`'s containing directory (`0o700`, recursive) if missing.
 * Idempotent — safe to call before every bind/spawn/probe.
 */
export function ensureParentDir(path: string): void {
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}
	try {
		chmodSync(dir, 0o700);
	} catch {
		// Best-effort: a dir we don't own (unexpected on a per-user runtime
		// dir) shouldn't block startup over a permission tightening we can't
		// make anyway.
	}
}

/** chmod a just-bound socket file to `0o600` — owner-only, matching the run dir's `0o700`. */
export function restrictSocketPermissions(path: string): void {
	chmodSync(path, 0o600);
}
