// Local stdio PLAYER MCP over a persona profile (sk-jay0.7.170).
//
// The hosted gateway (`runtime.ts`) resolves a seat from a WorkOS subject and
// speaks Streamable HTTP. This module keeps the SAME MCP surface —
// `createPlayerMcpServer` (instructions, tool roster, `_meta` prompt hints,
// `spellkave_feedback`) over `createSessionToolHandler` (text blocks,
// world_events relay, notices) — but resolves the session binding the way
// `sk --profile` does: a persona profile written by `just play-stage`, a
// credential file, the branch-derived local node. No OAuth, no rate limit,
// no GitHub feedback sink. The point is to let a Claude Code / Codex session
// play a LOCAL worktree node through the exact tool projection a public
// player sees, so MCP tool refinements are tried locally before they ship.
//
// Never a substitute for the hosted path when the seat/OAuth/reset UX itself
// is under test — see docs/mcp.md "Local player-mcp gateway".

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import {
	currentWorktreeRoot,
	loadProfileFromDisk,
	resolveCliPaths,
	resolveCredential,
	resolveSpacetimeLoginToken,
} from "@spellkave/sdk/node";
import type { SessionBinding } from "@spellkave/session";
import { attachSessionDaemon, type SessionDaemonClient } from "@spellkave/session/node";
import {
	createSessionToolHandler,
	type PlayerSessionClient,
	type PlayerToolResult,
} from "./daemon-handler.ts";
import type { FeedbackSink, FeedbackSubmission } from "./feedback.ts";
import {
	buildFeedbackIssueBody,
	buildFeedbackIssueTitle,
	FEEDBACK_ISSUE_LABEL,
	feedbackIssueLabels,
} from "./github-feedback-sink.ts";
import { OFF_REMOTE_MCP_RUN_OBSERVER } from "./observability.ts";
import { createPlayerMcpServer, playerMcpServerInfo } from "./tools.ts";
import { NOOP_PUBLIC_TRANSCRIPT_RECORDER } from "./transcript.ts";

export const LOCAL_PLAYER_MCP_SERVER_NAME = "spellkave-player-mcp-local";
/** Env var naming the persona profile when no `--profile` flag is given. */
export const LOCAL_PLAYER_PROFILE_ENV = "SPELLKAVE_PLAYER_PROFILE";
/** Worktree-local profile copies `just play-stage` writes (hero-seat.ts). */
export const WORKTREE_PROFILES_DIR = join(".local", "profiles");
/** Env var: `owner/name` repo; when set, feedback goes to GitHub issues through the local `gh` CLI. */
export const LOCAL_FEEDBACK_GH_REPO_ENV = "SPELLKAVE_FEEDBACK_GH_REPO";
/** Where the local `spellkave_feedback` sink appends submissions when no repo is set. */
export const LOCAL_FEEDBACK_FILE = join(".local", "player-mcp-local", "feedback.jsonl");

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface ResolveLocalPlayerBindingOptions {
	/** Explicit persona profile name; else `SPELLKAVE_PLAYER_PROFILE`; else the single worktree profile. */
	profileName?: string;
	/** Worktree root holding `.local/profiles/`; default: walk up from cwd. */
	worktreeRoot?: string;
	env?: NodeJS.ProcessEnv;
}

export interface ResolvedLocalPlayerBinding {
	binding: SessionBinding;
	token: string;
	profileName: string;
	profilePath: string;
	worktreeRoot: string;
}

export class LocalPlayerMcpUsageError extends Error {}

function listWorktreeProfiles(worktreeRoot: string): string[] {
	const dir = join(worktreeRoot, WORKTREE_PROFILES_DIR);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => name.endsWith(".toml"))
		.map((name) => name.slice(0, -".toml".length))
		.sort();
}

function pickProfileName(
	explicit: string | undefined,
	worktreeRoot: string,
	env: NodeJS.ProcessEnv,
): string {
	const named = explicit ?? env[LOCAL_PLAYER_PROFILE_ENV]?.trim();
	if (named !== undefined && named.length > 0) {
		if (!PROFILE_NAME.test(named)) {
			throw new LocalPlayerMcpUsageError(
				`profile name '${named}' is not a valid persona profile name`,
			);
		}
		return named;
	}
	const candidates = listWorktreeProfiles(worktreeRoot);
	if (candidates.length === 1) return candidates[0] as string;
	if (candidates.length === 0) {
		throw new LocalPlayerMcpUsageError(
			`no persona profile under ${join(worktreeRoot, WORKTREE_PROFILES_DIR)} — run \`just play-stage <adventure>\` first, ` +
				`or pass --profile <name> / set ${LOCAL_PLAYER_PROFILE_ENV}`,
		);
	}
	throw new LocalPlayerMcpUsageError(
		`several persona profiles under ${join(worktreeRoot, WORKTREE_PROFILES_DIR)} (${candidates.join(", ")}) — ` +
			`pass --profile <name> or set ${LOCAL_PLAYER_PROFILE_ENV}`,
	);
}

function profileFileFor(name: string, worktreeRoot: string, env: NodeJS.ProcessEnv): string {
	const local = join(worktreeRoot, WORKTREE_PROFILES_DIR, `${name}.toml`);
	if (existsSync(local)) return local;
	// Fall back to the XDG copy `sk --profile` would read.
	const global = join(resolveCliPaths({ env }).config, "profiles", `${name}.toml`);
	if (existsSync(global)) return global;
	throw new LocalPlayerMcpUsageError(
		`persona profile '${name}' not found at ${local} or ${global} — run \`just play-stage <adventure>\``,
	);
}

/** Same token → identity derivation as `sk` (`resolveBinding`, cli.ts): never the raw token. */
function identityFor(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

/**
 * Resolve the `(url, db, identity, actor)` daemon binding from a persona
 * profile. Mirrors `sk`'s precedence for the profile half only: this server
 * never reads the plain `SPELLKAVE_URL`/`SPELLKAVE_ACTOR` chain, because a
 * profile is the one artifact that names a SEAT (a body plus its credential),
 * and a stdio MCP server has no flag surface for an ad-hoc actor.
 */
export function resolveLocalPlayerBinding(
	options: ResolveLocalPlayerBindingOptions = {},
): ResolvedLocalPlayerBinding {
	const env = options.env ?? process.env;
	const worktreeRoot = options.worktreeRoot ?? currentWorktreeRoot();
	if (worktreeRoot === undefined) {
		throw new LocalPlayerMcpUsageError(
			"not inside a git worktree — start this server from a Spellkave checkout or pass worktreeRoot",
		);
	}
	const root = resolvePath(worktreeRoot);
	const profileName = pickProfileName(options.profileName, root, env);
	const profilePath = profileFileFor(profileName, root, env);
	const profile = loadProfileFromDisk(profilePath);
	const token =
		profile.identity.credential === undefined
			? resolveSpacetimeLoginToken({ env })
			: resolveCredential(profile.identity.credential, { env });
	return {
		binding: {
			url: profile.connection.url,
			db: profile.connection.db,
			identity: identityFor(token),
			actorId: profile.identity.in_world_self,
		},
		token,
		profileName,
		profilePath,
		worktreeRoot: root,
	};
}

/**
 * The daemon spawn target, resolved the way `sk` does it (`sessionDaemonCommand`,
 * cli.ts): `node <tsx cli> <session daemon bin>` through `require.resolve`,
 * never `PATH`, so an MCP host that spawns this server with a bare
 * environment still finds the daemon.
 */
export function localSessionDaemonCommand(): { command: string; args: string[] } {
	const require = createRequire(import.meta.url);
	const tsxCli = require.resolve("tsx/cli");
	const sessionNodeEntryDir = dirname(require.resolve("@spellkave/session/node"));
	const daemonBin = join(sessionNodeEntryDir, "..", "..", "bin", "spellkave-session-daemon.js");
	return { command: process.execPath, args: [tsxCli, daemonBin] };
}

/** `spellkave_feedback` sink for a local node: one JSONL line per submission under `.local/`. */
export function createLocalFeedbackSink(
	worktreeRoot: string,
): FeedbackSink & { readonly path: string } {
	const path = join(worktreeRoot, LOCAL_FEEDBACK_FILE);
	let count = 0;
	return {
		path,
		async submit(feedback: FeedbackSubmission): Promise<{ reference: string }> {
			mkdirSync(dirname(path), { recursive: true });
			appendFileSync(path, `${JSON.stringify(feedback)}\n`);
			count += 1;
			return { reference: `local:${path}#${count}` };
		},
	};
}

export type GhIssueRunner = (args: readonly string[]) => Promise<string>;

const runGh: GhIssueRunner = (args) =>
	new Promise((resolve, reject) => {
		execFile("gh", [...args], { encoding: "utf8" }, (error, stdout, stderr) => {
			if (error) {
				reject(new Error(`gh ${args[0]} ${args[1]} failed: ${stderr.trim() || error.message}`));
				return;
			}
			resolve(stdout);
		});
	});

/**
 * `spellkave_feedback` sink for a local node that files the SAME issue the
 * hosted gateway would (`buildFeedbackIssueTitle`/`Body`, `feedbackIssueLabels`
 * from github-feedback-sink.ts) through the operator's `gh` login instead of
 * the GitHub App. Adds a `feedback:local` label and a provenance line naming
 * the node, so a local playtest never masquerades as a hosted report. Mirrors
 * the hosted sink's label fallback: `world:`/`seat:` labels may not exist, so
 * a failed create is retried with the two labels this sink guarantees
 * (`feedback`, `feedback:local`; the latter is created idempotently first).
 */
export const LOCAL_FEEDBACK_LABEL = "feedback:local";
export function createGhFeedbackSink(
	repo: string,
	provenance: { worktreeRoot: string; url: string; db: string },
	run: GhIssueRunner = runGh,
): FeedbackSink {
	if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
		throw new LocalPlayerMcpUsageError(
			`${LOCAL_FEEDBACK_GH_REPO_ENV} must be owner/name, got '${repo}'`,
		);
	}
	return {
		async submit(feedback: FeedbackSubmission): Promise<{ reference: string }> {
			const body = [
				buildFeedbackIssueBody(feedback),
				"",
				"### Local provenance",
				"",
				`**Node:** ${provenance.url} db=${provenance.db}`,
				`**Worktree:** ${provenance.worktreeRoot}`,
				"Filed by `bin/sk-player-mcp` (local stdio PLAYER MCP), not by the hosted gateway.",
			].join("\n");
			const create = (labels: readonly string[]): Promise<string> =>
				run([
					"issue",
					"create",
					"--repo",
					repo,
					"--title",
					buildFeedbackIssueTitle(feedback),
					"--body",
					body,
					...labels.flatMap((label) => ["--label", label]),
				]);
			await run([
				"label",
				"create",
				LOCAL_FEEDBACK_LABEL,
				"--repo",
				repo,
				"--color",
				"BFD4F2",
				"--description",
				"spellkave_feedback filed from a local worktree node",
				"--force",
			]);
			const full = [...feedbackIssueLabels(feedback), LOCAL_FEEDBACK_LABEL];
			const guaranteed = [FEEDBACK_ISSUE_LABEL, LOCAL_FEEDBACK_LABEL];
			let output: string;
			try {
				output = await create(full);
			} catch (error) {
				if (full.length === guaranteed.length) throw error;
				output = await create(guaranteed);
			}
			const url = output.trim().split("\n").pop() ?? "";
			return { reference: url.length > 0 ? url : `gh:${repo}` };
		},
	};
}

/**
 * `gh` is an operator convenience (not logged in, offline, label API down):
 * a failed GitHub submit lands in the JSONL sink instead of failing the
 * player's `spellkave_feedback` call, and the reference says where it went.
 */
export function withJsonlFallback(primary: FeedbackSink, fallback: FeedbackSink): FeedbackSink {
	return {
		async submit(feedback: FeedbackSubmission): Promise<{ reference: string }> {
			try {
				return await primary.submit(feedback);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				process.stderr.write(
					`spellkave-player-mcp-local: feedback via gh failed, kept locally: ${message}\n`,
				);
				return fallback.submit(feedback);
			}
		},
	};
}

function adaptDaemonClient(daemon: SessionDaemonClient): PlayerSessionClient {
	return {
		invoke: (tool, args, causalContext) =>
			daemon.invoke<PlayerToolResult>(tool, args, causalContext),
		status: () => daemon.status(),
		toolNames: () => daemon.toolNames(),
	};
}

export interface LocalPlayerMcp {
	server: McpServer;
	resolved: ResolvedLocalPlayerBinding;
	feedbackPath: string;
}

export interface CreateLocalPlayerMcpOptions extends ResolveLocalPlayerBindingOptions {
	/** Test seam: how the binding becomes a session client (default: the real daemon). */
	attach?: (binding: SessionBinding, token: string) => Promise<PlayerSessionClient>;
}

/**
 * Build the stdio-ready MCP server: the hosted projection (`createPlayerMcpServer`)
 * over the hosted result mapping (`createSessionToolHandler`) over ONE local
 * daemon session for the profile's seat. Attach happens here, eagerly, so a
 * dead node or a bad credential fails the process at start instead of on the
 * first tool call.
 */
export async function createLocalPlayerMcp(
	options: CreateLocalPlayerMcpOptions = {},
): Promise<LocalPlayerMcp> {
	const resolved = resolveLocalPlayerBinding(options);
	const attach =
		options.attach ??
		(async (binding: SessionBinding, token: string) =>
			adaptDaemonClient(
				await attachSessionDaemon(binding, { token, command: localSessionDaemonCommand() }),
			));
	const client = await attach(resolved.binding, resolved.token);
	const env = options.env ?? process.env;
	const ghRepo = env[LOCAL_FEEDBACK_GH_REPO_ENV]?.trim();
	const jsonlSink = createLocalFeedbackSink(resolved.worktreeRoot);
	const sink: FeedbackSink =
		ghRepo !== undefined && ghRepo.length > 0
			? withJsonlFallback(
					createGhFeedbackSink(ghRepo, {
						worktreeRoot: resolved.worktreeRoot,
						url: resolved.binding.url,
						db: resolved.binding.db,
					}),
					jsonlSink,
				)
			: jsonlSink;
	const handler = createSessionToolHandler(
		client,
		OFF_REMOTE_MCP_RUN_OBSERVER,
		NOOP_PUBLIC_TRANSCRIPT_RECORDER,
		() => Date.now(),
		{ sink, resolveSeat: () => ({ actorId: resolved.binding.actorId }) },
	);
	const info = playerMcpServerInfo(env);
	const offered = await client.toolNames?.();
	if (offered !== undefined && !offered.ok) throw new Error(offered.error.message);
	const server = createPlayerMcpServer(
		handler,
		{
			name: LOCAL_PLAYER_MCP_SERVER_NAME,
			version: info.version,
		},
		offered?.ok ? offered.result : undefined,
	);
	return {
		server,
		resolved,
		feedbackPath: ghRepo !== undefined && ghRepo.length > 0 ? `gh:${ghRepo}` : jsonlSink.path,
	};
}
