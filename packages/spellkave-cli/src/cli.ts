import {
	AUTHOR_CONNECTED_TOOL_NAMES,
	type GrantArtifact,
	type GrantsPort,
	previewRestore,
	restoreGrants,
} from "@spellkave/tool-authoring";
import {
	EXPORT_GRANTS_TOOL,
	LIST_GRANTS_TOOL,
	REMOVE_ENTITY_TOOL,
	REVOKE_ROLE_TOOL,
	STAGE_SCENE_TOOL,
} from "@spellkave/tool-contracts/schemas";
// `sk` — the registry-driven Spellkave CLI (#1983).
//
// Tool schemas, flags and help are derived at runtime from
// `@spellkave/tool-authoring`'s `authorFacingToolDefinitions` — the same
// registry the Pi extension binds in-process
// (`.pi/extensions/spellkave/src/extension/main.ts`). Adding a tool there
// makes it callable through the generic tool dispatch; dedicated aliases and connection requirements are explicit here. That registry
// property is what `__tests__/registry-parity.test.ts` pins.
//
// Three destinations back the registry's connected tools (#1990):
//
//   - AUTHOR, offline: every tool in `AUTHOR_OFFLINE_TOOL_NAMES` runs
//     against the workspace alone, no connection at all. Grant/revoke/list/export use optional caller grant ports when connected.
//   - AUTHOR, connected: `spellkave_apply_manifest_delta` (the one AUTHOR
//     tool supporting either a local or live flush destination) takes `--target <dir>` (a local TOML
//     folder, `createLocalAuthorTarget`) or `--live` (a per-call SDK
//     connection, `createLiveAuthorTarget` — slice 2). The two are mutually
//     exclusive; `--live` connects once per invocation and closes after the
//     tool settles — no session held across calls. `--live`'s own url/db/token
//     ladder (`resolveLiveConnection`, #2002 follow-up): `--profile <name>`,
//     when given, supplies the connection outright — the same "explicit flag
//     beats ambient env" precedence PLAYER's `resolveBinding` uses, so the
//     same flag never means opposite things on the two paths. `--profile`
//     used to be silently ignored on this path (flushing to whatever
//     `SPELLKAVE_URL` happened to be exported); that's the bug this fixed.
//     Without `--profile`, the plain env chain resolves as before. No
//     last-used-profile fallback for `--live` (unlike PLAYER below) — a bare
//     `--live` with an exported `SPELLKAVE_URL` has an unambiguous meaning
//     with no ambient profile needed; the profile's identity/actor is
//     irrelevant for an AUTHOR flush either way.
//   - PLAYER, always connected: every `playerFacingToolDefinitions` tool
//     dispatches through a binding-keyed `@spellkave/session` daemon (slice
//     3) — `ensureDaemon` attaches to (or spawns) the ONE background daemon
//     for `(url, db, identity, actor)`, `sk` sends one `invoke` frame over
//     its unix socket, and disconnects; the daemon itself persists (idle
//     timeout, `sk session list`/`stop` manage it). PLAYER tools always need
//     `url`/`db`/`actor`/`token` resolvable — there is no offline PLAYER
//     mode, because subscribe-on-connect (`openSession`, #1987/#1990) is
//     what makes an unbuilt affordance palette unrepresentable instead of
//     silently looking like a blocked gate. Resolution precedence (#2002,
//     `resolveBinding` below): explicit `--actor` > `--profile <name>` >
//     the plain env chain (`SPELLKAVE_URL`/`SPELLKAVE_DB`/`SPELLKAVE_ACTOR`).
//     `--profile` resolves through `@spellkave/sdk`'s
//     `loadProfileFromDisk`/`resolveConnection`/`CredentialRef` chain — the
//     SAME seam Pi's `createSdkConnectionController` uses since #1997 and the
//     installed Rust `spellkave` CLI's own `profile.rs`/`resolve.rs` mirror
//     (shared FILE contract, not shared code — `openspec/specs/spellkave-cli`).
//     A bare invocation with neither `--profile` nor a resolvable env chain
//     falls back to `last_used_profile` state, announced on stderr (ambient
//     state must stay visible); nothing resolvable at all is a loud usage
//     error naming every remedy, `--profile` included. A successful
//     explicitly-named `--profile` is remembered as `last_used_profile`
//     afterward (write failure is non-fatal — convenience state, never
//     connection authority).
//
// Contrast with the CLI this eventually retires,
// `packages/spellkave-author-cli/src/cli.ts`: a 1198-line hand-written
// `domain`/`command` switch over `@spellkave/world-author`, where every new
// verb needed a new arm.
//
// Output contract: commands emit structured records once. Non-interactive
// stdout and explicit `--format jsonl` serialize the canonical JSONL shape;
// interactive stdout and explicit `--format human` project those same records
// through the generic Pi-TUI Markdown renderer in `output.ts`. Human-facing
// usage text stays on stderr. `createProcessIo` and
// `withConsoleLogOnStderr` below preserve EPIPE behavior and keep a connected
// dependency's stray `console.log` off the structured stdout stream.
//
// Exit codes (ADR-0002): 0 = ok, 1 = infra/usage, 2 = in-world rejection
// (a tool that ran fine and reported `ok: false` — an invalid manifest, a
// refused delta). A tool that THROWS is infra (1), not in-world.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
// The exit ladder is shared with every plugin (ADR-0144 D-3); `EXIT_LINT` is
// `sk lint --strict` only — findings are advisory by contract, so it is opt-in.
import {
	createNodeHost,
	EXIT_IN_WORLD,
	EXIT_LINT,
	EXIT_OK,
	EXIT_USAGE,
	type HostDeps,
	type SkContext,
	type SkPlugin,
	type SkVerb,
	verbPaths,
} from "@spellkave/cli-plugin";
import {
	checkedProfileFile,
	connect,
	defaultReaderManifest,
	enqueueAndWaitManifestApply,
	isLocalNodeProfile,
	localNodeProfileName,
	type PersonaProfile,
	type ProfileSource,
	type ResolvedConnection,
	readActorIdentityBindings,
	readActorPrincipals,
	readManifestExport,
	snapshotDb,
	subscribeManifestApplyWait,
} from "@spellkave/sdk";
import {
	listProfileNames,
	loadProfileFromDisk,
	readCurrentContext,
	readLastUsedProfile,
	resolveCliPaths,
	resolveConnection,
	resolveCredential,
	resolveSpacetimeClientCredentialToken,
	resolveSpacetimeConfigPathToken,
	resolveSpacetimeLoginToken,
	writeCurrentContext,
	writeLastUsedProfile,
} from "@spellkave/sdk/node";
import type { SessionBinding } from "@spellkave/session";
import {
	createLiveApplysetPort,
	createLiveAuthorTarget,
	createLiveExplorationPort,
	createLiveGrantsPort,
	createLiveScenesPort,
	createLiveScopedSnapshotPort,
} from "@spellkave/session/authoring";
import {
	attachSessionDaemon,
	type DaemonCommand,
	ensureDaemon as defaultEnsureDaemon,
	socketPath as deriveSessionSocketPath,
	isOkResponse,
	probeSocket,
	runtimeDir,
	type EnsureDaemon as SessionEnsureDaemon,
	type Response as SessionResponse,
	sendSessionRequest,
	sha256HexNode,
} from "@spellkave/session/node";
import {
	type PlayerFacingToolDefinition,
	playerFacingToolDefinitions,
	renderWorldEventLine,
} from "@spellkave/session/player-tools";
import { localNodeIdentity } from "./local-node-identity.ts";
import {
	APPLYSET_DEFINITION_TABLES,
	type ApplysetPort,
	AUTHOR_OFFLINE_TOOL_NAMES,
	type AuthorFinding,
	type AuthorTarget,
	type AuthorTargetApplyResult,
	type AuthorToolContext,
	authorFacingToolDefinitions,
	connectedAuthorAnswer,
	EXPLAIN_VOCABULARY_TABLES,
	type ExplorationPort,
	type ManifestExportRow,
	PLACED_INSTANCE_READ_TOOLS,
} from "@spellkave/tool-authoring";
import {
	APPLY_MANIFEST_DELTA_TOOL,
	APPLYSET_APPLY_TOOL,
	APPLYSET_DIFF_TOOL,
	CAN_I_TOOL,
	DESCRIBE_TOOL,
	DOCS_TOOL,
	EXPLAIN_TOOL,
	EXPORT_MANIFEST_TOOL,
	GET_TOOL,
	QUERY_TOOL,
} from "@spellkave/tool-contracts";
import { nodeToolCapability } from "@spellkave/tool-node";
import {
	applysetRootPath,
	createFileExplorationPort,
	LocalAuthorTargetDirectoryError,
	resolveLocalAuthorTarget,
} from "@spellkave/tool-node/authoring";
import type { WorldEvent } from "@spellkave/tool-runtime";
import { bindTool, ToolArgumentValidationError } from "@spellkave/tool-runtime";
import {
	createOwnerInstanceRead,
	createScopedInstanceRead,
	type InstanceRead,
	loadBundleChainDetailed,
	type OwnerDescribeInput,
	type OwnerGetInput,
	type OwnerSnapshot,
} from "@spellkave/world-author";
import type { TSchema } from "typebox";
import { Check as typeboxCheck, Errors as typeboxErrors } from "typebox/value";
import { type ApplysetVerb, applysetVerbArgs, finishApplysetVerb } from "./applyset-verbs.ts";
import { deriveFlags, parseToolArgs, UsageError } from "./args.ts";
import { prepareAuthoring } from "./authoring-prepare.ts";
import {
	inspectBundle,
	lintBundle,
	patchManifestFile,
	renderManifestFile,
	validateBundle,
} from "./bundle.ts";
import { createLiveCanIPort } from "./can-i-port";
import {
	configRows,
	configValues,
	loadSkConfig,
	type ResolvedSkConfig,
	setConfigValue,
	unsetConfigValue,
} from "./config.ts";
import { inspectDelta } from "./delta-inspect.ts";
import {
	EXPLORE_VERBS,
	type ExploreLiveTarget,
	exploreVerb,
	parseExploreArgs,
	projectExploreRecord,
	requireSourceId,
} from "./explore-verbs.ts";
import { recordLiveDelta, resolveLiveDeltaJournalDir } from "./live-delta-journal.ts";
import { liveAuthorProgress } from "./live-progress.ts";
import { mapInspect, renderAuthorMap } from "./map.ts";
import { createRecordIo, isOutputFormat, type OutputFormat, type RecordIo } from "./output.ts";
import {
	checkRootCollisions,
	defaultPluginSource,
	loadAllPlugins,
	loadPlugin,
	type PluginEntry,
	type PluginSource,
	resolveNode,
} from "./plugins.ts";
import {
	emitSpatialGraphPresentation,
	maybeEmitSvgDetailsOnTerminal,
	parseImagesModeFlag,
	presentSpatialGraphOnTerminal,
	type TerminalImagesMode,
} from "./spatial-graph-terminal.ts";
import { createFileAuthorWorkspace, SK_SCRATCH_DIR } from "./workspace.ts";

export { EXIT_IN_WORLD, EXIT_LINT, EXIT_OK, EXIT_USAGE };

/** Injectable streams so tests can drive `runCli` without touching process state. */
export interface CliIo {
	out(line: string): void;
	err(line: string): void;
	/** Optional raw byte writer for terminal graphics (timg/Kitty). */
	writeBytes?(data: Uint8Array): void;
	/** Terminal capabilities used by `--format auto` and width-aware Markdown. */
	stdoutIsTTY?: boolean;
	stdoutColumns?: number;
}

/**
 * Build a `CliIo` over a stdout/stderr pair, guarded against EPIPE. A
 * downstream reader closing early (`sk ... | head`) is ordinary CLI usage,
 * not a crash: a Writable with no `'error'` listener throws on the NEXT
 * write after the pipe breaks — Node's default behavior turns that into an
 * unhandled exception (the full crash banner this guards against). Once a
 * stream has broken this way, every later write on it is a silent no-op —
 * the work already done keeps its own exit code; there is nothing left to
 * usefully report to a reader who is gone. A non-EPIPE error still throws:
 * this only special-cases the one broken-pipe case, never hides a real bug.
 *
 * Exported (not just the process-bound singleton below) so tests can drive
 * it against a stream double instead of the real process streams.
 */
export function createProcessIo(
	stdout: NodeJS.WritableStream,
	stderr: NodeJS.WritableStream,
): CliIo {
	const terminal = stdout as NodeJS.WritableStream & {
		isTTY?: boolean;
		columns?: number;
	};
	let stdoutBroken = false;
	let stderrBroken = false;

	function isEpipe(err: unknown): boolean {
		return (err as NodeJS.ErrnoException | undefined)?.code === "EPIPE";
	}

	// The stream ALSO emits `'error'` asynchronously (independent of any
	// particular `write()` call) — an unhandled `'error'` event is itself
	// how Node crashes a process with no listener present, so this listener
	// is required even though `write()` below is separately guarded for the
	// synchronous-throw case.
	stdout.on("error", (err: NodeJS.ErrnoException) => {
		if (isEpipe(err)) {
			stdoutBroken = true;
			return;
		}
		throw err;
	});
	stderr.on("error", (err: NodeJS.ErrnoException) => {
		if (isEpipe(err)) {
			stderrBroken = true;
			return;
		}
		throw err;
	});

	return {
		stdoutIsTTY: terminal.isTTY === true,
		...(typeof terminal.columns === "number" ? { stdoutColumns: terminal.columns } : {}),
		out: (line) => {
			if (stdoutBroken) return;
			try {
				stdout.write(`${line}\n`);
			} catch (err) {
				if (!isEpipe(err)) throw err;
				stdoutBroken = true;
			}
		},
		writeBytes: (data: Uint8Array) => {
			if (stdoutBroken) return;
			try {
				stdout.write(data);
			} catch (err) {
				if (!isEpipe(err)) throw err;
				stdoutBroken = true;
			}
		},
		err: (line) => {
			if (stderrBroken) return;
			try {
				stderr.write(`${line}\n`);
			} catch (err) {
				if (!isEpipe(err)) throw err;
				stderrBroken = true;
			}
		},
	};
}

const processIo: CliIo = createProcessIo(process.stdout, process.stderr);

/**
 * Keep dependency console output off structured stdout for one invocation,
 * restoring console.log in finally. Suppress only the known INFO connect
 * progress, including the installed SDK logger's CSS-format arguments;
 * unknown messages still reach stderr. The connector separately suppresses
 * recognized additive-schema metadata through onDiagnostic, retaining failures
 * and unknown diagnostic shapes. io.test.ts and live-diagnostics.test.ts pin
 * the boundary and restoration without changing the SDK's other consumers.
 */
async function withConsoleLogOnStderr<T>(fn: () => Promise<T>): Promise<T> {
	const original = console.log;
	console.log = (...args: unknown[]) => {
		if (
			(args.length === 1 && args[0] === "ℹ️ INFO Connecting to SpacetimeDB WS...") ||
			(args.length === 3 &&
				args[0] === "%cℹ️ INFO%c Connecting to SpacetimeDB WS..." &&
				typeof args[1] === "string" &&
				typeof args[2] === "string")
		)
			return;
		console.error(...args);
	};
	try {
		return await fn();
	} finally {
		console.log = original;
	}
}

interface GlobalOptions {
	format: OutputFormat;
	workspaceDir: string;
	targetDir?: string;
	fixturesRoot?: string;
	defaultBundle?: string;
	/** `--live`: flush destination is a per-call SDK connection, not `--target`. */
	live: boolean;
	/**
	 * `--actor <id>`: the PLAYER tool identity a session binding is keyed on.
	 * EXPLICIT flag value only — `SPELLKAVE_ACTOR` is consulted separately by
	 * `resolveBinding`'s own env-chain tier (#2002), so its priority relative
	 * to `--profile` stays enforceable instead of being pre-merged away here.
	 */
	actorId?: string;
	/**
	 * `--profile <name>`: resolve url/db/actor/token through the shared SDK
	 * profile chain (#2002) — see `resolveBinding` below.
	 */
	profileName?: string;
	config: ResolvedSkConfig;
}

/**
 * Global options are read from argv ONLY before the tool name, and from the
 * environment otherwise. That ordering is not stylistic: tool parameters are
 * derived from schemas this CLI does not control, and `bundle` is already a
 * real parameter on most write verbs — a global `--bundle` accepted anywhere
 * would shadow it. Everything after the tool name therefore belongs to the
 * tool, always.
 */
function parseGlobals(argv: string[]): { options: GlobalOptions; rest: string[] } {
	const env = process.env;
	const config = loadSkConfig(env);
	const options: GlobalOptions = {
		format: config.format.value,
		workspaceDir: config.workspace.value,
		...(config.target.value ? { targetDir: config.target.value } : {}),
		...(config.defaultBundle.value ? { defaultBundle: config.defaultBundle.value } : {}),
		live: false,
		config,
	};
	let explicitTarget = false;
	let i = 0;
	for (; i < argv.length; i += 1) {
		const token = argv[i] as string;
		if (!token.startsWith("--")) break;
		const eq = token.indexOf("=");
		const name = eq === -1 ? token : token.slice(0, eq);
		const inline = eq === -1 ? undefined : token.slice(eq + 1);
		const take = (): string => {
			const value = inline ?? argv[++i];
			if (value === undefined) throw new UsageError(`${name}: missing value.`);
			return value;
		};
		switch (name) {
			case "--workspace":
				options.workspaceDir = take();
				options.config.workspace = {
					value: options.workspaceDir,
					display: options.workspaceDir,
					source: "flag",
				};
				break;
			case "--target":
				options.targetDir = take();
				explicitTarget = true;
				options.config.target = {
					value: options.targetDir,
					display: options.targetDir,
					source: "flag",
				};
				break;
			case "--no-target":
				options.targetDir = undefined;
				explicitTarget = false;
				options.config.target = {
					value: undefined,
					display: "none",
					source: "flag",
				};
				break;
			case "--fixtures-root":
				options.fixturesRoot = take();
				break;
			case "--default-bundle":
				options.defaultBundle = take();
				options.config.defaultBundle = {
					value: options.defaultBundle,
					display: options.defaultBundle,
					source: "flag",
				};
				break;
			case "--no-default-bundle":
				options.defaultBundle = undefined;
				options.config.defaultBundle = {
					value: undefined,
					display: "none",
					source: "flag",
				};
				break;
			case "--live":
				options.live = true;
				// An explicit live destination outranks a configured local
				// target. Only two flags in the same invocation are ambiguous.
				if (!explicitTarget) {
					options.targetDir = undefined;
					options.config.target = {
						value: undefined,
						display: "none (--live)",
						source: "flag",
					};
				}
				break;
			case "--actor":
				options.actorId = take();
				break;
			case "--profile":
				options.profileName = take();
				break;
			case "--format": {
				const format = take();
				if (
					format !== "auto" &&
					format !== "human" &&
					format !== "jsonl" &&
					format !== "json" &&
					format !== "toon"
				) {
					throw new UsageError(
						`--format: expected auto, human, jsonl, or toon; received ${JSON.stringify(format)}.`,
					);
				}
				const resolved = format === "json" ? "jsonl" : format;
				options.format = resolved;
				options.config.format = { value: resolved, display: resolved, source: "flag" };
				break;
			}
			case "--help":
			case "-h":
				return { options, rest: ["help", ...argv.slice(i + 1)] };
			default:
				throw new UsageError(
					`unknown global option ${name} — global options must precede the tool name; ` +
						"run `sk help` for the list.",
				);
		}
	}
	if (options.live && explicitTarget) {
		throw new UsageError(
			`--live and --target are mutually exclusive — pick one flush destination for ${APPLY_MANIFEST_DELTA_TOOL}.`,
		);
	}
	return { options, rest: argv.slice(i) };
}

/**
 * Whether a tool can run given what this invocation has wired. Derived from
 * the registry's own offline/connected split rather than a curated list:
 * `spellkave_remove_entity` requires a local target.
 * `spellkave_apply_manifest_delta` needs a flush
 * destination, and either a local `--target` folder (`createLocalAuthorTarget`
 * merges the delta into that folder's `manifest.toml`) or `--live` (a per-call
 * connection, `createLiveAuthorTarget` flushes via `r_apply_manifest_delta`)
 * IS one, so it becomes available the moment either is configured.
 */
function connectsOnItsOwn(name: string): boolean {
	const resolved = definitionFor(name)?.name;
	return resolved === CAN_I_TOOL || resolved === GET_TOOL || resolved === DESCRIBE_TOOL;
}

function isAvailable(name: string, options: GlobalOptions): boolean {
	if (name === REMOVE_ENTITY_TOOL) return options.targetDir !== undefined && !options.live;
	if ((AUTHOR_OFFLINE_TOOL_NAMES as readonly string[]).includes(name)) return true;
	if (name === APPLY_MANIFEST_DELTA_TOOL) {
		return options.targetDir !== undefined || options.live;
	}
	if (
		name === EXPORT_MANIFEST_TOOL ||
		name === REVOKE_ROLE_TOOL ||
		name === LIST_GRANTS_TOOL ||
		name === EXPORT_GRANTS_TOOL
	)
		return options.live;
	if (name === APPLYSET_DIFF_TOOL || name === APPLYSET_APPLY_TOOL || name === STAGE_SCENE_TOOL)
		return options.live;
	if (name === CAN_I_TOOL || name === GET_TOOL || name === DESCRIBE_TOOL) return options.live;
	if (AUTHOR_CONNECTED_TOOL_NAMES.includes(name)) return options.live;
	return true;
}

function unavailableReason(name: string): string {
	if (name === REMOVE_ENTITY_TOOL)
		return `${name} needs a local --target <bundle-dir>; it edits author files without connecting to a world.`;
	if (name === STAGE_SCENE_TOOL)
		return `${name} needs --live and a reviewed source on the selected caller connection.`;
	if (name === EXPORT_MANIFEST_TOOL) {
		return `${name} needs --live against a running node (r_export_manifest).`;
	}
	if (name === APPLYSET_DIFF_TOOL || name === APPLYSET_APPLY_TOOL) {
		return `${name} needs --live against a running node (it reads the applyset memory); \`sk diff -k\` / \`sk apply -k\` connect on their own.`;
	}
	return (
		`${name} needs a flush destination: pass \`--target <bundle-dir>\` (e.g. ` +
		"`--target ./world/manifest.toml`) to commit into a local bundle, `--live` to commit " +
		"against a running node, or set SPELLKAVE_AUTHOR_LOCAL_TARGET."
	);
}

/**
 * A live flush destination for one invocation: `target` backs
 * `AuthorToolContext.target`, `close` tears the connection down once the
 * tool's result is in hand. Injectable (`ConnectLive`) so tests drive
 * `--live` without a real node.
 */
export interface LiveConnection {
	target: AuthorTarget;
	exportManifest?: (bundleId: string) => Promise<ManifestExportRow>;
	applyset?: ApplysetPort;
	grants?: GrantsPort;
	scenes?: AuthorToolContext["scenes"];
	canI?: import("@spellkave/tool-authoring").CanIPort;
	/** Same-session get/describe projector. No db/session/tick on this object. */
	readInstance?: InstanceRead;
	explainDisclosure?: AuthorToolContext["explainDisclosure"];
	/** Isolated caller-scoped exploration snapshot; serves only `source: "live"`. */
	exploration?: ExplorationPort;
	/** Final after `ownerRowsReady` settles. True only after the owner subscription applies. */
	readsAsPublisher: boolean;
	/** Hex identity the connection authenticated with, without a 0x prefix. */
	connectedIdentity: string;
	close(): void | Promise<void>;
}

/**
 * Dependency-injection seam for `--live` — see `defaultConnectLive` below for
 * production. Takes the ALREADY-RESOLVED `{url, db, token}` (resolved by
 * `resolveLiveConnection` in `runTool`, before this is ever called) rather
 * than resolving anything itself — mirrors `EnsureDaemon`'s own shape
 * (`ensureDaemon(binding, {token, ...})`) on the PLAYER side, so a test
 * double can assert on exactly what connection info this invocation resolved
 * to (#2002 follow-up).
 */
export type ConnectLive = (resolved: {
	url: string;
	db: string;
	token?: string;
	publicVocabularyOnly?: boolean;
}) => Promise<LiveConnection>;

// Provenance-buffer bookkeeping only (`ConnectArgs.connectedActorId` —
// `packages/spellkave-sdk/src/connection.ts`): a delta-flush connection
// submits manifests, it does not act as anyone, so this need not resolve to a
// live actor.
const LIVE_CONNECTED_ACTOR_ID = "sk-live-author";

/**
 * Local-dev token precedence, mirroring
 * `packages/spellkave-agent-scenarios/src/wanderer.ts`'s
 * `resolveWorldExplorerToken` (also `spellkave-player-eval/src/connect.ts`):
 * an explicit override, then the credential file the Rust seed CLI persisted
 * for this url+db (`just seed`'s own identity — the one manifest `$sender`
 * macros and `frontier.apply_manifest` grants resolve to locally), then the
 * per-worktree `SPACETIME_CONFIG_PATH` token. `undefined` falls through to
 * `connect()`'s own anonymous-connection default.
 */
function resolveLiveToken(url: string, db: string): string | undefined {
	const explicit = process.env.SPELLKAVE_CONNECT_TOKEN;
	if (explicit !== undefined && explicit.length > 0) return explicit;
	return (
		resolveSpacetimeClientCredentialToken(url, db, { env: process.env, home: process.env.HOME }) ??
		resolveSpacetimeConfigPathToken({ env: process.env })
	);
}

/** Where the author path got its connection (sk-config-contexts). */
export type AuthorConnectionSource = "flag" | "environment" | "context";

export interface ResolvedLiveConnection {
	url: string;
	db: string;
	token: string | undefined;
	/** The profile that supplied the connection (flag or context tier); unset on the environment tier. */
	profile: string | undefined;
	source: AuthorConnectionSource;
	/** The current context, when one is set (even if a higher tier won). */
	context?: string;
	/** Set when the environment won over a current context naming another world. */
	overriddenContext?: { name: string; url: string; db: string };
	/** Set when the current context names a profile that no longer exists. */
	danglingContext?: string;
}

function loadNamedProfile(name: string, label: string): PersonaProfile {
	try {
		return loadProfileFromDisk(checkedProfileFile(resolveCliPaths(), name));
	} catch (err) {
		throw new UsageError(`${label} ${name}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/**
 * Credential for a named profile on the author or PLAYER path. A `sk dev up`
 * local-node profile may omit its credential. Discover its node config only when its name,
 * URL and database match this worktree's canonical node identity. Explicit token
 * and config-path choices win; an existing node config never falls through to
 * another identity. Other profiles keep `resolveProfileToken` semantics.
 */
function connectionProfileToken(name: string, profile: PersonaProfile): string | undefined {
	if (
		profile.identity.credential === undefined &&
		isLocalNodeProfile(name, profile.connection.url)
	) {
		const explicit = process.env.SPELLKAVE_CONNECT_TOKEN;
		if (explicit !== undefined && explicit.length > 0) return explicit;
		if (process.env.SPACETIME_CONFIG_PATH) {
			return resolveSpacetimeConfigPathToken({ env: process.env });
		}
		const node = localNodeIdentity(createNodeHost());
		if (
			node !== undefined &&
			name === localNodeProfileName(node.worktreeRoot) &&
			profile.connection.url === node.url &&
			profile.connection.db === node.db &&
			existsSync(node.configPath)
		) {
			const token = resolveSpacetimeConfigPathToken({
				env: { ...process.env, SPACETIME_CONFIG_PATH: node.configPath },
			});
			if (token !== undefined) return token;
			throw new UsageError(
				`local node credential is missing or unreadable in ${node.configPath}; run \`sk dev up\` to restore this worktree's node connection`,
			);
		}
		return resolveLiveToken(profile.connection.url, profile.connection.db);
	}
	return resolveProfileToken(profile);
}

const NO_AUTHOR_CONNECTION =
	"no world to connect to: pass --profile <name>, select one with `sk config use-context <name>` " +
	"(`sk dev up` selects this worktree's local node), or export SPELLKAVE_URL (and SPELLKAVE_DB), " +
	"e.g. `source scripts/dev/node-env.sh`.";

/**
 * The author path's connection ladder (sk-config-contexts D2): `--profile
 * <name>` > the environment (`SPELLKAVE_URL`/`SPELLKAVE_DB`) > the
 * per-worktree current context > a usage error naming every remedy. The
 * last-used profile is never consulted here: `play-stage` and PLAYER
 * `--profile` move it, and an apply target must not move with them.
 *
 * `--profile` still beats the environment (#2002 follow-up: an explicit flag
 * means THAT world). The environment beats the context so `just` recipes,
 * which export it, keep their target; the caller warns about that override
 * once (`announceAuthorConnection`). A context naming a deleted profile is an
 * error unless the environment already supplies the target, in which case it
 * is only reported. The profile's `identity` stays irrelevant for an AUTHOR
 * flush (`LIVE_CONNECTED_ACTOR_ID` is fixed); only `connection` and the
 * credential are read.
 */
export function resolveLiveConnection(profileName: string | undefined): ResolvedLiveConnection {
	if (profileName !== undefined) {
		const profileObj = loadNamedProfile(profileName, "--profile");
		return {
			url: profileObj.connection.url,
			db: profileObj.connection.db,
			token: connectionProfileToken(profileName, profileObj),
			profile: profileName,
			source: "flag",
		};
	}

	const paths = resolveCliPaths();
	const contextName = readCurrentContext(paths);
	let contextProfile: PersonaProfile | undefined;
	let dangling: string | undefined;
	if (contextName !== undefined) {
		try {
			contextProfile = loadProfileFromDisk(checkedProfileFile(paths, contextName));
		} catch {
			dangling = contextName;
		}
	}

	const envUrl = process.env.SPELLKAVE_URL;
	if (envUrl !== undefined && envUrl.length > 0) {
		const db = process.env.SPELLKAVE_DB ?? "spellkave-dev";
		const resolved: ResolvedLiveConnection = {
			url: envUrl,
			db,
			token: resolveLiveToken(envUrl, db),
			profile: undefined,
			source: "environment",
			...(contextName === undefined ? {} : { context: contextName }),
			...(dangling === undefined ? {} : { danglingContext: dangling }),
		};
		if (
			contextName !== undefined &&
			contextProfile !== undefined &&
			(contextProfile.connection.url !== envUrl || contextProfile.connection.db !== db)
		) {
			resolved.overriddenContext = {
				name: contextName,
				url: contextProfile.connection.url,
				db: contextProfile.connection.db,
			};
		}
		return resolved;
	}

	if (dangling !== undefined) {
		throw new UsageError(
			`current context '${dangling}' names a profile that does not exist; ` +
				"select another with `sk config use-context <name>` (list them with `sk config get-contexts`).",
		);
	}
	if (contextName !== undefined && contextProfile !== undefined) {
		return {
			url: contextProfile.connection.url,
			db: contextProfile.connection.db,
			token: connectionProfileToken(contextName, contextProfile),
			profile: contextName,
			source: "context",
			context: contextName,
		};
	}
	throw new UsageError(NO_AUTHOR_CONNECTION);
}

/**
 * Print, once per invocation, which world the author path uses when that is
 * not obvious from the command line: a flag or context profile, the
 * environment overriding a context, or a dangling context behind the
 * environment.
 */
function announceAuthorConnection(
	io: RecordIo,
	resolved: ResolvedLiveConnection,
	what: string,
): void {
	if (resolved.source === "flag") {
		io.err(`sk: using profile '${resolved.profile}' (${what})`);
	} else if (resolved.source === "context") {
		io.err(`sk: using context '${resolved.profile}' (${what})`);
	}
	if (resolved.overriddenContext !== undefined) {
		const ctx = resolved.overriddenContext;
		io.err(
			`sk: environment wins over context '${ctx.name}' (${ctx.url} ${ctx.db}): ` +
				`using SPELLKAVE_URL ${resolved.url} ${resolved.db}`,
		);
	}
	if (resolved.danglingContext !== undefined) {
		io.err(
			`sk: current context '${resolved.danglingContext}' names a missing profile; ` +
				"the environment supplies the target (fix with `sk config use-context <name>`)",
		);
	}
}

/**
 * `--live`'s production connector: one `@spellkave/sdk` connection per `sk`
 * invocation, closed by the caller once the tool settles (see `runTool`).
 * `resolved` is ALREADY the outcome of `resolveLiveConnection` — see the
 * `ConnectLive` type doc for why resolution lives outside this function.
 */
async function defaultConnectLive(resolved: {
	url: string;
	db: string;
	token?: string;
	publicVocabularyOnly?: boolean;
}): Promise<LiveConnection> {
	liveAuthorProgress("connect");
	const session = await connect(
		{
			url: resolved.url,
			db: resolved.db,
			token: resolved.token,
			connectedActorId: LIVE_CONNECTED_ACTOR_ID,
			onDiagnostic: (line) => {
				const diagnostic = line as Record<string, unknown>;
				const additions = diagnostic.additions;
				// The SDK keeps the full surface for its consumers. The CLI only
				// suppresses this known informational diagnostic; preserve
				// unknown shapes and new metadata instead of hiding future warnings.
				if (
					diagnostic.kind === "binding_drift_additive" &&
					Object.keys(diagnostic).length === 2 &&
					additions !== null &&
					typeof additions === "object" &&
					Object.keys(additions).length === 2 &&
					"tables" in additions &&
					"reducers" in additions &&
					Array.isArray(additions.tables) &&
					Array.isArray(additions.reducers) &&
					additions.tables.every((name) => typeof name === "string") &&
					additions.reducers.every((name) => typeof name === "string")
				) {
					return;
				} else {
					console.warn(JSON.stringify(line));
				}
			},
			ownerTables: !resolved.publicVocabularyOnly,
			readerManifests: resolved.publicVocabularyOnly
				? [{ requiredTables: [...EXPLAIN_VOCABULARY_TABLES] }]
				: [
						defaultReaderManifest(),
						// mod_bundle: the live target resolves `bundles` from it, so a
						// scaffolded header is not sent over a published bundle (sk-jay0.3.26.26).
						{
							requiredTables: [
								...APPLYSET_DEFINITION_TABLES,
								...EXPLAIN_VOCABULARY_TABLES,
								"mod_bundle",
							],
						},
					],
		},
		{ onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} },
	);
	try {
		liveAuthorProgress("initial_subscription");
		await session.ready;
		if (resolved.publicVocabularyOnly)
			return {
				target: createLiveAuthorTarget({ db: () => snapshotDb(session) }),
				readsAsPublisher: false,
				connectedIdentity: connectedIdentityHex(session.authenticatedIdentity),
				close: () => session.disconnect(),
			};
		try {
			liveAuthorProgress("owner_subscription");
			await session.ownerRowsReady;
		} catch (error) {
			// A subscribe-time refusal leaves the connection open and the flag false.
			// A connection end does not set ownerSubscriptionError; that failure is not an owner-query error.
			if (session.ownerSubscriptionError === null) {
				throw error instanceof Error ? error : new Error(String(error));
			}
		}
		// The export view is subscribed only when the module lists it
		// (`visible_manifest_export_result`). `manifest_export` is no longer written.
		liveAuthorProgress("manifest_subscription");
		await subscribeManifestApplyWait(session.conn.subscriptionBuilder());
		const scopedSnapshot = createLiveScopedSnapshotPort({
			session,
			world: { url: resolved.url, db: resolved.db },
		});
		const exploration = createLiveExplorationPort({
			session,
			world: { url: resolved.url, db: resolved.db },
		});
		const applyDelta = async (toml: string): Promise<AuthorTargetApplyResult> => {
			const db = snapshotDb(session);
			return enqueueAndWaitManifestApply({
				digestHandle: db.manifest_apply_digest,
				outcomeHandle: db.manifest_apply_outcome,
				enqueue: async () => {
					liveAuthorProgress("enqueue");
					await session.conn.reducers.rApplyManifestDelta({ toml });
					liveAuthorProgress("manifest_result");
				},
				label: "sk applyDelta",
			});
		};
		const exportManifest = async (bundleId: string): Promise<ManifestExportRow> => {
			if (!session.exportViewSubscribed) {
				throw new Error("manifest export is not available");
			}
			const db = snapshotDb(session);
			const tickBefore = Number(
				[...(db.worldTime?.iter() ?? db.world_time?.iter() ?? [])][0]?.tick ?? 0,
			);
			await session.conn.reducers.rExportManifest({ bundleId });
			const deadline = Date.now() + 5_000;
			while (Date.now() < deadline) {
				const row = readManifestExport(db, bundleId);
				if (row !== undefined && row.requestedAtTick >= tickBefore) {
					return {
						bundleId: row.bundleId,
						status: row.status,
						rowCount: row.rowCount,
						diagnostics: row.diagnostics,
						manifestJson: row.manifestJson,
					};
				}
				await new Promise((r) => setTimeout(r, 10));
			}
			throw new Error(
				`manifest export: timed out waiting for visible_manifest_export_result row for '${bundleId}' ` +
					`(tickBefore=${tickBefore})`,
			);
		};
		return {
			target: createLiveAuthorTarget({
				db: () => snapshotDb(session),
				applyDelta,
				scopedSnapshot,
				readsAsPublisher: () => session.readsAsPublisher,
			}),
			scenes: createLiveScenesPort({
				session: () => session,
				endpoint: () => `${resolved.url}/${resolved.db}`,
				apply: applyDelta,
			}),
			grants: createLiveGrantsPort({
				session: () => session,
				endpoint: () => `${resolved.url}/${resolved.db}`,
				apply: applyDelta,
				writeArtifact: async (path, text) => {
					writeFileSync(resolve(path), text);
				},
			}),
			exportManifest,
			applyset: createLiveApplysetPort({
				session,
				rootPathFor: applysetRootPath,
				definitionTablesSubscribed: true,
				scopedSnapshot,
			}),
			canI: createLiveCanIPort({
				conn: session.conn as never,
				db: () => snapshotDb(session) as never,
			}),
			explainDisclosure: {
				bindingSubjectsAdmitted: session.grantProtocolSupported,
				connectedIdentity: connectedIdentityHex(session.authenticatedIdentity),
				readsAsPublisher: session.readsAsPublisher,
				identitiesForPresence: (body) => {
					const db = snapshotDb(session);
					const actorIds = new Set(
						readActorPrincipals(db)
							.filter((actor) => actor.current_body === body)
							.map((actor) => String(actor.actor_id)),
					);
					if (!session.readsAsPublisher)
						return readActorIdentityBindings(db)
							.filter((binding) => actorIds.has(String(binding.actor_id)))
							.map((binding) => binding.identity);
					return [...(db.actorIdentity?.iter() ?? [])]
						.filter((binding) => actorIds.has(String(binding.actorId)))
						.map((binding) => connectedIdentityHex(binding.identity));
				},
			},
			readInstance: session.readsAsPublisher
				? createOwnerInstanceRead({
						snapshot: () => snapshotDb(session) as OwnerSnapshot,
						worldTick: () => session.currentWorldTick(),
						readsAsPublisher: session.readsAsPublisher,
					})
				: createScopedInstanceRead(scopedSnapshot),
			exploration,
			readsAsPublisher: session.readsAsPublisher,
			connectedIdentity: connectedIdentityHex(session.authenticatedIdentity),
			close: () => {
				exploration.close();
				scopedSnapshot.close();
				session.disconnect();
			},
		};
	} catch (error) {
		try {
			session.disconnect();
		} catch {
			// The socket may already be closed.
		}
		throw error instanceof Error ? error : new Error(String(error));
	}
}

function connectedIdentityHex(value: unknown): string {
	if (typeof value === "string") return value.replace(/^0x/i, "").toLowerCase();
	if (value && typeof value === "object" && "toHexString" in value) {
		const hex = (value as { toHexString?: () => string }).toHexString;
		if (typeof hex === "function") return hex.call(value).replace(/^0x/i, "").toLowerCase();
	}
	return "";
}

function publisherAnswerFields(
	live: LiveConnection,
	toolName: string,
): {
	reads_as_publisher: boolean;
	connected_identity: string;
	note?: string;
} {
	return connectedAuthorAnswer({
		readsAsPublisher: live.readsAsPublisher,
		connectedIdentity: live.connectedIdentity,
		readsPlacedInstances: PLACED_INSTANCE_READ_TOOLS.has(toolName),
	});
}

// ---------------------------------------------------------------------------
// PLAYER tools: binding-keyed session daemon (#1990 slice 3). Every PLAYER
// tool dispatches through `@spellkave/session`'s `ensureDaemon` + a one-shot
// JSONL `invoke` frame over its unix socket — `sk` itself never holds the
// live SpacetimeDB connection; the daemon does, persisting across `sk`
// invocations (idle-timeout, `sk session list`/`stop` below manage it).
// ---------------------------------------------------------------------------

/**
 * `--profile <name>` (#2002): `sk` as the third consumer of the shared
 * persona-profile FILE contract (`profiles/<name>.toml` + `last_used_profile`
 * state under the XDG config/state roots, pinned by
 * `openspec/specs/spellkave-cli`) — reusing `@spellkave/sdk`'s
 * `loadProfileFromDisk`/`resolveConnection`/`CredentialRef` chain, the SAME
 * seam Pi's `createSdkConnectionController` uses since #1997
 * (`.pi/extensions/spellkave/src/extension/connection-controller.ts`). The
 * Rust `spellkave` CLI has its own implementation of the same contract
 * (`client/src/profile.rs`/`resolve.rs`) — the shared artifact is the file
 * format, never code.
 */
function resolveProfileToken(profile: PersonaProfile): string {
	return profile.identity.credential === undefined
		? resolveSpacetimeLoginToken()
		: resolveCredential(profile.identity.credential);
}

function profileErrorMessage(name: string | undefined, err: unknown): string {
	const detail = err instanceof Error ? err.message : String(err);
	return name === undefined ? `--profile: ${detail}` : `--profile ${name}: ${detail}`;
}

interface ProfileChainResult {
	url: string;
	db: string;
	actorId: string | undefined;
	profileName: string | undefined;
	profileSource: ProfileSource | undefined;
	profileObj: PersonaProfile | undefined;
}

/**
 * Resolve url/db/actor (never token — see `resolveBinding`, which needs the
 * url/db checks to fire before it bothers resolving a credential) through the
 * precedence `--actor` (explicit flag) > `--profile <name>` > the plain env
 * chain (`SPELLKAVE_URL`/`SPELLKAVE_DB`/`SPELLKAVE_ACTOR`). A profile ALWAYS
 * supplies `connection.{url,db}` and `identity.in_world_self` once selected
 * (required, non-empty fields in the persona contract), so every field below
 * comes from the selected profile except an explicit `--actor` override.
 */
function resolveConnectionViaProfileChain(options: GlobalOptions): ProfileChainResult {
	const explicitActor = options.actorId;
	const envUrl = process.env.SPELLKAVE_URL;
	const envDb = process.env.SPELLKAVE_DB;
	const envActor = process.env.SPELLKAVE_ACTOR;

	const legacy = (): ProfileChainResult => ({
		url: envUrl ?? "",
		db: envDb ?? "spellkave-dev",
		actorId: explicitActor ?? envActor,
		profileName: undefined,
		profileSource: undefined,
		profileObj: undefined,
	});

	// Fast path: the plain env chain alone already resolves url+actor and no
	// `--profile` was requested — behaves EXACTLY as before #2002, touching
	// no profile-chain filesystem state (`resolveCliPaths`/
	// `readLastUsedProfile`) at all.
	if (options.profileName === undefined && envUrl && (explicitActor ?? envActor)) {
		return legacy();
	}

	const paths = resolveCliPaths();
	const lastUsed = options.profileName === undefined ? readLastUsedProfile(paths) : undefined;
	let resolved: ResolvedConnection;
	try {
		resolved = resolveConnection(
			options.profileName === undefined ? {} : { profile: options.profileName },
			{
				paths,
				built_in_url: envUrl ?? "",
				built_in_db: envDb ?? "spellkave-dev",
				last_used_profile: lastUsed,
			},
		);
	} catch (err) {
		throw new UsageError(profileErrorMessage(options.profileName, err));
	}

	// No profile resolved at all (no flag, no last-used state, no app-config
	// default) — the plain env chain's own url/actor checks in `resolveBinding`
	// still apply, unchanged.
	if (resolved.profile === undefined) return legacy();

	let profileObj: PersonaProfile;
	try {
		profileObj = loadProfileFromDisk(checkedProfileFile(paths, resolved.profile));
	} catch (err) {
		throw new UsageError(profileErrorMessage(resolved.profile, err));
	}

	return {
		url: resolved.url,
		db: resolved.db,
		actorId: explicitActor ?? profileObj.identity.in_world_self,
		profileName: resolved.profile,
		profileSource: resolved.profile_source,
		profileObj,
	};
}

/**
 * Mirrors Pi's own `rememberProfile` exactly
 * (`.pi/extensions/spellkave/src/extension/connection-controller.ts`): write
 * `last_used_profile` under the resolved state root. Convenience state, never
 * connection authority — a write failure here must never fail the tool call
 * that triggered it (#2002 decision 4).
 */
function rememberProfile(name: string): void {
	try {
		writeLastUsedProfile(resolveCliPaths(), name);
	} catch {
		// Remembered profile is convenience state, never connection authority.
	}
}

/**
 * Resolve the `(url, db, identity, actor)` binding a PLAYER invocation keys
 * its daemon on. `identity` is a SHA-256 of the resolved token (never the raw
 * token) — `SessionDispatcher` echoes the binding verbatim in `hello`/`status`
 * responses (`@spellkave/session/node`'s `daemon.ts`), so the binding itself
 * must stay a safe thing to hand back over the socket. `context` names who
 * needed the binding, for the loud "missing SPELLKAVE_URL"/"missing --actor"
 * errors below — never a silent guess. `profile` (when set) tells the caller
 * WHICH resolved-profile behaviors to run (stderr announce for `last_used`,
 * remember-on-use for `flag` — see `runPlayerTool`); `resolveBinding` itself
 * stays free of stderr/fs-write side effects so `playerAvailability` (`sk
 * list`) and `sk session stop` can share it safely.
 */
function resolveBinding(
	options: GlobalOptions,
	context: string,
): {
	binding: SessionBinding;
	token?: string;
	profile?: { name: string; source: ProfileSource };
} {
	const chain = resolveConnectionViaProfileChain(options);
	if (chain.url.length === 0) {
		throw new UsageError(
			`${context} needs SPELLKAVE_URL — run \`just spacetime-start\` then ` +
				"`source scripts/dev/node-env.sh` to export it, set SPELLKAVE_URL directly, " +
				"or resolve one through --profile <name> (or a remembered last-used profile).",
		);
	}
	if (chain.actorId === undefined || chain.actorId.length === 0) {
		throw new UsageError(
			`${context} needs an actor — pass \`--actor <id>\`, set SPELLKAVE_ACTOR, or resolve one ` +
				"through --profile <name> (or a remembered last-used profile).",
		);
	}
	const token =
		chain.profileObj === undefined || chain.profileName === undefined
			? resolveLiveToken(chain.url, chain.db)
			: connectionProfileToken(chain.profileName, chain.profileObj);
	const identity = token === undefined ? "anonymous" : sha256HexNode(token);
	return {
		binding: { url: chain.url, db: chain.db, identity, actorId: chain.actorId },
		...(token === undefined ? {} : { token }),
		...(chain.profileName === undefined || chain.profileSource === undefined
			? {}
			: { profile: { name: chain.profileName, source: chain.profileSource } }),
	};
}

/** Backwards-compatible CLI test seam; the implementation now belongs to `@spellkave/session/node`. */
export type EnsureDaemon = SessionEnsureDaemon;

/**
 * `ensureDaemon`'s default spawn target relies on `bin/spellkave-session-daemon.js`'s
 * OWN `#!/usr/bin/env tsx` shebang resolving on the spawned child's `PATH` —
 * true under `pnpm`/`just`, not guaranteed for an arbitrary parent process
 * (flagged on `DEFAULT_DAEMON_BIN`, `@spellkave/session/node`'s `spawn.ts`).
 * `sk` passes this explicit override instead: `node <tsx's own CLI entry>
 * <the same daemon bin>` — both paths resolved once via Node's own module
 * resolution (`require.resolve`, honoring each package's `exports` map),
 * never `PATH`.
 */
let cachedDaemonCommand: DaemonCommand | undefined;
function sessionDaemonCommand(): DaemonCommand {
	if (cachedDaemonCommand === undefined) {
		// `require.resolve` (via `createRequire`), not `import.meta.resolve`:
		// both honor each package's `exports` map identically, but
		// `import.meta.resolve` is unavailable under Vitest's SSR module
		// runtime (`vite-node`) — this needs to resolve the same way whether
		// `sk` is run for real or exercised by `__tests__/player.test.ts`.
		const require = createRequire(import.meta.url);
		const tsxCli = require.resolve("tsx/cli");
		const sessionNodeEntryDir = dirname(require.resolve("@spellkave/session/node"));
		const daemonBin = join(sessionNodeEntryDir, "..", "..", "bin", "spellkave-session-daemon.js");
		cachedDaemonCommand = { command: process.execPath, args: [tsxCli, daemonBin] };
	}
	return cachedDaemonCommand;
}

/**
 * `--target`'s local `AuthorTarget` construction is `resolveLocalAuthorTarget`
 * (`@spellkave/tool-node/authoring`, #2004) — the seam shared with Pi's own
 * `SPELLKAVE_AUTHOR_LOCAL_TARGET` wiring (`.pi/extensions/spellkave/src/extension/main.ts`).
 * It resolves `--target`/`--fixtures-root` to absolute paths (this used to
 * happen here directly) and rejects a blank directory loudly — an explicit
 * `--target ""` used to silently resolve to the current working directory;
 * it now surfaces as a `UsageError` instead.
 */
/** Each source is served by exactly one port; no source falls back to another. */
function composeExplorationPorts(
	files: ExplorationPort,
	live: ExplorationPort | undefined,
): ExplorationPort {
	return {
		snapshot: (source) => {
			if (source !== "live") return files.snapshot(source);
			if (live === undefined) throw new Error("reader_unavailable: no live connection");
			return live.snapshot(source);
		},
	};
}

function configuredDependencies(options: GlobalOptions, io: RecordIo): Record<string, string> {
	// An explicit fixture-root retains the legacy per-call override.
	if (options.fixturesRoot !== undefined && Object.keys(options.config.dependencies).length > 0) {
		io.err("sk: --fixtures-root overrides configured dependency mappings for this call");
	}
	return options.fixturesRoot !== undefined
		? {}
		: Object.fromEntries(
				Object.entries(options.config.dependencies).map(([id, entry]) => [id, entry.value]),
			);
}

function buildContext(
	options: GlobalOptions,
	io: RecordIo,
	liveTarget: AuthorTarget | undefined,
	exportManifest?: (bundleId: string) => Promise<ManifestExportRow>,
	applyset?: ApplysetPort,
	canI?: import("@spellkave/tool-authoring").CanIPort,
	readInstance?: InstanceRead,
	explainDisclosure?: AuthorToolContext["explainDisclosure"],
	grants?: GrantsPort,
	liveExploration?: ExplorationPort,
	scenes?: AuthorToolContext["scenes"],
): AuthorToolContext {
	const dependencyManifests = configuredDependencies(options, io);
	const workspace = createFileAuthorWorkspace(resolve(options.workspaceDir));
	let target: AuthorTarget | undefined = liveTarget;
	if (target === undefined && options.targetDir !== undefined) {
		try {
			target = resolveLocalAuthorTarget(options.targetDir, {
				fixturesRoot: options.fixturesRoot,
				dependencyManifests,
				readPendingManifest: workspace.readToml,
			}).target;
		} catch (err) {
			if (err instanceof LocalAuthorTargetDirectoryError) {
				throw new UsageError(`--target: ${err.message}`);
			}
			throw err;
		}
	}
	return {
		workspace,
		...(grants === undefined ? {} : { grants }),
		exploration: composeExplorationPorts(
			createFileExplorationPort({
				workspace,
				workspacePath: resolve(options.workspaceDir),
				localPath: options.targetDir,
				fixturesRoot: options.fixturesRoot,
				dependencyManifests,
			}),
			liveExploration,
		),
		...(scenes === undefined ? {} : { scenes }),
		// Findings are a first-class result of an authoring run, not a log
		// line — `spellkave_declare_inexpressible` reporting "the substrate
		// cannot express this" is a SUCCESSFUL outcome per its own docs. Emit
		// them on the JSONL stream so a script gets them alongside results.
		//
		// NESTED, not spread: `AuthorFinding` carries its own `kind`
		// discriminator (`doc_gap` / `inexpressible`), which a spread would
		// silently write over ADR-0002's line-level `kind`. Two discriminators
		// at two levels, neither shadowing the other.
		onFinding: (finding: AuthorFinding) => io.record({ kind: "finding", finding }),
		...(target === undefined ? {} : { target }),
		...(exportManifest === undefined ? {} : { exportManifest }),
		...(applyset === undefined ? {} : { applyset }),
		...(canI === undefined ? {} : { canI }),
		...(readInstance === undefined ? {} : { readInstance }),
		...(explainDisclosure === undefined ? {} : { explainDisclosure }),
		...(options.defaultBundle === undefined ? {} : { defaultBundle: options.defaultBundle }),
	};
}

/**
 * Look `name` up in a registry tool list. Shared by the AUTHOR (in-process)
 * and PLAYER (daemon-dispatched) lookups below — the prefix-tolerance rule is
 * the same for both, and the lookup itself is what keeps tool membership
 * registry-derived rather than name-cased per call site.
 */
function findDefinition<T extends { name: string }>(
	defs: readonly T[],
	name: string,
): T | undefined {
	// Callers may drop the registry's `spellkave_` prefix — `sk query` and
	// `sk spellkave_query` are the same tool. The prefix exists so a model
	// sees Spellkave tools as a namespaced family; a shell caller has no such
	// ambiguity to resolve.
	const wanted = name.startsWith("spellkave_") ? name : `spellkave_${name}`;
	return defs.find((def) => def.name === wanted);
}

function definitionFor(name: string) {
	return findDefinition(authorFacingToolDefinitions, name);
}

function playerDefinitionFor(name: string): PlayerFacingToolDefinition | undefined {
	return findDefinition(playerFacingToolDefinitions, name);
}

function flagSummaries(def: { parameters: unknown }) {
	return deriveFlags(def.parameters as TSchema).map((spec) => ({
		flag: spec.flag,
		kind: spec.kind,
		required: spec.required,
	}));
}

/**
 * Whether a PLAYER tool call would resolve a binding right now — reuses
 * `resolveBinding` itself (same URL/actor checks, same messages `runPlayerTool`
 * throws) rather than re-deriving the rule, so `sk list`'s `available`/`reason`
 * can never drift from what actually happens on a real invocation.
 * `resolveBinding` does only local env/file reads (no network), so calling it
 * here — for every PLAYER tool, on every `sk list` — is safe and cheap.
 */
function playerAvailability(
	def: PlayerFacingToolDefinition,
	options: GlobalOptions,
): { available: boolean; reason?: string } {
	try {
		resolveBinding(options, def.name);
		return { available: true };
	} catch (err) {
		return { available: false, reason: err instanceof Error ? err.message : String(err) };
	}
}

function authorToolSummary(
	def: (typeof authorFacingToolDefinitions)[number],
	options: GlobalOptions,
) {
	const available = isAvailable(def.name, options);
	return {
		name: def.name,
		label: def.label,
		facing: "author" as const,
		available,
		...(available ? {} : { reason: unavailableReason(def.name) }),
		flags: flagSummaries(def),
	};
}

function playerToolSummary(def: PlayerFacingToolDefinition, options: GlobalOptions) {
	const { available, reason } = playerAvailability(def, options);
	return {
		name: def.name,
		label: def.label,
		facing: "player" as const,
		available,
		...(reason === undefined ? {} : { reason }),
		flags: flagSummaries(def),
	};
}

function byName<T extends { name: string }>(left: T, right: T): number {
	return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
}

function alphabetically<T extends { name: string }>(definitions: readonly T[]): T[] {
	return [...definitions].sort(byName);
}

/**
 * One coherent contract for both registries (#1990 follow-up: a listing that
 * hid PLAYER tools would break `sk`'s own "command surface derived from
 * toolDefinitions" claim, #1983). AUTHOR entries precede PLAYER entries and
 * each group is alphabetical for navigation — `facing` is the discriminator,
 * not a second output shape.
 */
function emitList(io: RecordIo, options: GlobalOptions, plugins: readonly SkPlugin[] = []): number {
	io.record({
		kind: "tool_list",
		tools: [
			...alphabetically(authorFacingToolDefinitions).map((def) => authorToolSummary(def, options)),
			...alphabetically(playerFacingToolDefinitions).map((def) => playerToolSummary(def, options)),
			...pluginVerbSummaries(plugins),
		],
	});
	io.hint("Next: run sk help <tool> to see one tool's purpose and flags.");
	return EXIT_OK;
}

/** Native spellings share one registry mapping between invocation and help. */
function registryCommand(command: string, subcommand?: string): string {
	if (command === "can-i") return "can_i";
	if (command === "grant") return "grant_role";
	if (command === "revoke") return "revoke_role";
	if (command === "grants") {
		if (subcommand === "prepare-hand-over") return "prepare_hand_over";
		if (subcommand === "hand-over") return "hand_over_role";
		if (subcommand === "export") return "export_grants";
		return "list_grants";
	}
	return command;
}

function emitHelp(
	io: RecordIo,
	options: GlobalOptions,
	toolName?: string,
	plugins: readonly SkPlugin[] = [],
	subcommand?: string,
): number {
	if (toolName === undefined) {
		io.err(USAGE);
		io.err("Registry tools — derived from canonical role surfaces, never listed here.");
		io.err("Run `sk help <tool>` for one tool's schema-derived flags.");
		io.err("");
		io.err("AUTHOR (offline, or connected via --target/--live):");
		for (const def of alphabetically(authorFacingToolDefinitions)) {
			const mark = isAvailable(def.name, options) ? " " : "!";
			io.err(`  ${mark} ${def.name.replace(/^spellkave_/, "").padEnd(24)} ${def.label}`);
		}
		io.err("");
		io.err(
			"PLAYER (always connected via the session daemon — needs --actor/--profile/SPELLKAVE_URL resolvable):",
		);
		for (const def of alphabetically(playerFacingToolDefinitions)) {
			const mark = playerAvailability(def, options).available ? " " : "!";
			io.err(`  ${mark} ${def.name.replace(/^spellkave_/, "").padEnd(24)} ${def.label}`);
		}
		io.err("");
		io.err("  ! = unavailable with the current options; run the tool to see why.");
		io.err("");
		io.err("Configuration:");
		io.err("    config show              effective values and where each came from");
		io.err("    config path              global and project config file locations");
		io.err("    config set               write one explicit project or global value");
		io.err("    config get-contexts      profiles you can author against; marks the current one");
		io.err("    config use-context       select this worktree's world for --live / diff / apply");
		io.err("    config view              the world connection the author path uses now, and why");
		io.err("");
		// Listed apart because they ARE different in kind, not merely in
		// implementation: these take filesystem paths, which no registry tool
		// does. Collapsing the two groups would teach a reader that `sk`'s
		// surface is uniform when the boundary is exactly what keeps the
		// registry host-neutral.
		io.err("File commands — take a manifest path; not registry tools (see `sk help <command>`):");
		for (const [name, command] of Object.entries(FILE_COMMANDS).sort(([left], [right]) =>
			left < right ? -1 : left > right ? 1 : 0,
		)) {
			io.err(`    ${name.padEnd(24)} ${command.summary}`);
		}
		io.err("");
		if (plugins.length > 0) {
			io.err("Plugins — command groups from sk.plugins (see `sk help <group>`):");
			for (const plugin of plugins) {
				io.err(`    ${plugin.root.name.padEnd(24)} ${plugin.root.description}`);
			}
			io.err("");
		}
		io.err("Core: sk plugin list · sk tool <registry-name> (explicit form of any registry tool)");
		io.err("");
		io.err("Agents: run 'sk skill path' and load that file.");
		return EXIT_OK;
	}
	if (toolName === "config") {
		io.err("sk config — inspect or change shell defaults");
		io.err("");
		io.err("Usage:");
		io.err("  sk config show");
		io.err("  sk config path");
		io.err("  sk config set --project <key> <value>");
		io.err("  sk config set --global <key> <value>");
		io.err("  sk config unset --project|--global <key>");
		io.err("  sk config get-contexts");
		io.err("  sk config use-context <profile>");
		io.err("  sk config current-context");
		io.err("  sk config view");
		io.err("");
		io.err("Contexts are persona profiles (profiles/<name>.toml); the current context is");
		io.err("remembered per git worktree. Author path (--live, diff, apply) precedence:");
		io.err("  --profile > SPELLKAVE_URL/SPELLKAVE_DB > current context. When the environment");
		io.err("  overrides a context naming another world, sk warns once on stderr.");
		io.err("");
		io.err(
			"Common keys: author.workspace, author.target, author.dependencies.<bundle>, author.default-bundle, output.format, dev.seed, dev.backend",
		);
		io.err("Precedence: flags > environment > project > global > built-in.");
		io.err("");
		io.err(CONFIG_COMMON_CHANGES);
		return EXIT_OK;
	}
	if (toolName === "get" || toolName === "describe") {
		io.err(
			toolName === "get"
				? "sk get — list or fetch an admitted authored instance row"
				: "sk describe — one authored entity plus admitted belonging and place",
		);
		io.err("");
		io.err("Usage:");
		io.err("  sk get <kind> [<key>] [--bundle <id>] [--pattern <text>] [--fields a,b] [--limit n]");
		io.err("  sk describe entities <key> [--bundle <id>]");
		io.err("");
		io.err("Connects on the author path (no --live), using publisher closure when admitted");
		io.err("or the caller's scoped reader with coverage. Exit 0 on a row or listing, 2 on");
		io.err(
			"an unknown/out-of-scope key or unavailable reader, 1 on usage or an unreachable world.",
		);
		io.err("Does not call r_export_manifest; authored_entities_only remains a reader limit.");
		return EXIT_OK;
	}
	if (toolName === "explore") return emitExploreHelp(io);
	if (toolName === "session") {
		if (subcommand !== undefined && subcommand !== "list" && subcommand !== "stop")
			throw new UsageError(`sk session: expected list or stop, got ${JSON.stringify(subcommand)}`);
		io.err("sk session — inspect or stop the local player-session daemons");
		io.err("Usage:");
		if (subcommand !== "stop") io.err("  sk session list");
		if (subcommand !== "list") {
			io.err("  sk session stop [<hash-or-socket-path> | --all]");
			io.err("With no selector, stop the session selected by the current --actor/--profile/world.");
		}
		io.err("Examples:");
		io.err("  sk session list");
		if (subcommand !== "list") io.err("  sk session stop <hash>");
		return EXIT_OK;
	}
	if (toolName === "grants" && subcommand === "restore") {
		io.err("sk grants restore — preview a grant artifact; --apply commits the reviewed restore");
		io.err("Usage: sk grants restore <artifact.json> [--rebase-expiry] [--apply]");
		return EXIT_OK;
	}
	if (toolName === "events") {
		io.err("sk events --drain — drain pending world-push events for this binding");
		io.err("");
		io.err("Usage:");
		io.err("  sk events --drain");
		io.err("");
		io.err(
			"Every PLAYER invoke already piggybacks pending WorldEvents as extra JSONL lines (kind: push).",
		);
		io.err("This command drains the same session-lifetime builder without running a PLAYER tool.");
		return EXIT_OK;
	}
	const fileCommand = FILE_COMMANDS[toolName];
	if (fileCommand !== undefined) {
		io.err(`sk ${toolName} — ${fileCommand.summary}`);
		io.err("");
		io.err(fileCommand.usage);
		return EXIT_OK;
	}
	const registryName = registryCommand(toolName, subcommand);
	const def = definitionFor(registryName) ?? playerDefinitionFor(registryName);
	if (def === undefined) return unknownTool(io, toolName);
	const nativePath =
		toolName === "grants" && registryName !== "list_grants"
			? `${toolName} ${subcommand}`
			: toolName;
	io.err(`${registryName === toolName ? def.name : `sk ${nativePath}`} — ${def.label}`);
	const authorDefinition = authorFacingToolDefinitions.some(
		(candidate) => candidate.name === def.name,
	);
	const availability = authorDefinition
		? {
				available: isAvailable(def.name, options),
				reason: unavailableReason(def.name),
			}
		: playerAvailability(def as PlayerFacingToolDefinition, options);
	if (!availability.available && availability.reason !== undefined) {
		io.err(`Unavailable: ${availability.reason}`);
	}
	// PLAYER tools are never in `authorFacingToolDefinitions` (disjoint
	// registries, see `runCli`'s dispatch) — this membership check, not a
	// name literal, is what tells a reader which dispatch path applies.
	if (!authorDefinition) {
		io.err(
			"(PLAYER tool — dispatches through the session daemon; needs --actor/--profile/SPELLKAVE_URL resolvable.)",
		);
	}
	io.err("");
	io.err(def.description);
	io.err("");
	if (!renderFlags(io, def.parameters as TSchema)) return EXIT_OK;
	if (def.cli?.examples !== undefined) {
		io.err("");
		io.err("Examples:");
		for (const example of def.cli.examples) {
			io.err(`  ${example.command.padEnd(48)} ${example.description}`);
		}
	}
	return EXIT_OK;
}

/** Schema-derived flag help, shared by registry tools and plugin verbs. False when there are no flags. */
function renderFlags(io: RecordIo, schema: TSchema, positionals: readonly string[] = []): boolean {
	const flags = deriveFlags(schema).filter((flag) => !positionals.includes(flag.name));
	if (flags.length === 0) {
		io.err("Takes no parameters.");
		return false;
	}
	io.err("Flags:");
	for (const spec of flags) {
		const suffix = spec.kind === "boolean" ? "" : ` <${spec.choices?.join("|") ?? spec.kind}>`;
		io.err(`  ${spec.flag}${suffix}${spec.required ? "  (required)" : ""}`);
		if (spec.description !== undefined) io.err(`      ${spec.description}`);
		if (spec.kind === "json") {
			io.err("      Structured — pass JSON, or supply the whole payload with --json.");
		}
	}
	return true;
}

// --- Plugins (ADR-0144 D-3): one root namespace, groups mounted from `sk.plugins`. ---

/**
 * Commands the core itself owns at the root. `runCliDispatch` may only branch
 * on names listed here; a test holds the two in step, so a new core command
 * cannot be shadowed by a plugin group without a load error.
 */
export const CORE_COMMANDS: readonly string[] = [
	"list",
	"tools",
	"help",
	"config",
	"session",
	"events",
	"plugin",
	"tool",
	"diff",
	"apply",
	"can-i",
	"get",
	"describe",
	"explain",
	"explore",
	"grant",
	"grants",
	"revoke",
];

/** Every non-plugin root name, mapped to a label naming its owner. */
function rootReservations(): Map<string, string> {
	const reserved = new Map<string, string>();
	for (const name of CORE_COMMANDS) reserved.set(name, `core command ${name}`);
	for (const name of Object.keys(FILE_COMMANDS)) reserved.set(name, `file command ${name}`);
	for (const def of [...authorFacingToolDefinitions, ...playerFacingToolDefinitions]) {
		reserved.set(def.name, `registry tool ${def.name}`);
		reserved.set(def.name.replace(/^spellkave_/, ""), `registry tool ${def.name}`);
	}
	return reserved;
}

function pluginVerbSummaries(plugins: readonly SkPlugin[]) {
	return plugins.flatMap((plugin) =>
		verbPaths(plugin.root).map((path) => {
			const node = resolveNode(plugin.root, path).node as SkVerb;
			return {
				name: path.join(" "),
				path,
				label: node.description,
				facing: "plugin" as const,
				package: plugin.package,
				available: true,
				flags: flagSummaries(node),
			};
		}),
	);
}

async function runPluginCommand(
	io: RecordIo,
	source: PluginSource,
	argv: string[],
): Promise<number> {
	if (argv[0] !== "list" || argv.length > 1) {
		throw new UsageError("usage: sk plugin list");
	}
	for (const plugin of await loadAllPlugins(source)) {
		io.record({
			kind: "plugin",
			package: plugin.package,
			group: plugin.root.name,
			description: plugin.root.description,
			verbs: verbPaths(plugin.root),
		});
	}
	io.hint("Next: run sk help <group> to see one plugin's commands.");
	return EXIT_OK;
}

function emitPluginHelp(io: RecordIo, plugin: SkPlugin, tokens: readonly string[]): number {
	const { node, path } = resolveNode(plugin.root, tokens);
	io.err(`sk ${path.join(" ")} — ${node.description}`);
	io.err(`(plugin ${plugin.package})`);
	io.err("");
	if (node.kind === "group") {
		io.err("Commands:");
		for (const child of node.children) {
			const suffix = child.kind === "group" ? " …" : "";
			io.err(`    ${`${child.name}${suffix}`.padEnd(24)} ${child.description}`);
		}
		io.err("");
		io.err(`Run \`sk help ${path.join(" ")} <command>\` for one command's flags.`);
		return EXIT_OK;
	}
	const positionals = (node.positionals ?? []).map((name) => ` [${name}]`).join("");
	io.err(`Usage: sk ${path.join(" ")}${positionals} [flags]`);
	io.err("");
	renderFlags(io, node.parameters as TSchema);
	return EXIT_OK;
}

async function runPluginVerb(
	output: RecordIo,
	options: GlobalOptions,
	plugin: SkPlugin,
	argv: readonly string[],
	host: HostDeps,
): Promise<number> {
	const resolved = resolveNode(plugin.root, argv);
	const { path, consumed } = resolved;
	let node = resolved.node;
	// A bare group with a default verb runs that verb; its flags still apply.
	if (node.kind === "group" && node.default !== undefined) {
		const wanted = node.default;
		const fallback = node.children.find((child) => child.name === wanted);
		if (fallback?.kind === "verb") {
			node = fallback;
			path.push(fallback.name);
		}
	}
	if (node.kind === "group") {
		throw new UsageError(
			`sk ${path.join(" ")}: choose one of: ${node.children.map((child) => child.name).join(", ")} ` +
				`— run \`sk help ${path.join(" ")}\`.`,
		);
	}
	const schema = node.parameters as TSchema;
	const params = parseToolArgs(deriveFlags(schema), argv.slice(consumed), node.positionals);
	if (!typeboxCheck(schema, params)) {
		const errors = [...typeboxErrors(schema, params)];
		output.record({
			kind: "error",
			scope: "usage",
			command: path.join(" "),
			message: `invalid parameters: ${errors
				.map((e) => `${e.instancePath || "/"} ${e.message}`)
				.join("; ")}`,
		});
		return EXIT_USAGE;
	}
	const context: SkContext = {
		out: output,
		host,
		config: configValues(options.config),
		resolveConnection: () => resolveLiveConnection(options.profileName),
	};
	return node.run(params, context);
}

// --- File commands: the fs half (#1983). See `./bundle.ts`'s header for why
// these are NOT registry tools. Kept in one table so `sk help` can list them
// as a distinct group and `__tests__/registry-parity.test.ts` can assert that
// no name here ever shadows a registry tool. ---

interface FileCommand {
	summary: string;
	usage: string;
	run: (
		io: RecordIo,
		argv: string[],
		options: GlobalOptions,
		connectLive: ConnectLive,
	) => Promise<number>;
}

/**
 * `sk skill path`'s answer, resolved once from THIS package's own install
 * location — `import.meta.url`-relative, never cwd-relative, so it prints
 * the right path whether `sk` is invoked from inside this monorepo or from
 * an arbitrary directory after an external install (the docs-packaging
 * contract this file command exists to serve). `cli.ts` lives at
 * `<pkg>/src/cli.ts`; the packaged skill ships one level up, at
 * `<pkg>/skill/SKILL.md` (see this package's own `package.json` `files`).
 */
const PACKAGED_SKILL_MD_PATH = fileURLToPath(new URL("../skill/SKILL.md", import.meta.url));

/** Shared parsing for the file commands' path + `--bundle`/`--dep` closure. */
function parseBundleArgs(
	argv: string[],
	command: string,
	boolFlags: string[] = [],
	valueFlags: string[] = [],
): {
	path: string;
	deps: string[];
	bundle: boolean;
	flags: Set<string>;
	values: Map<string, string>;
} {
	const deps: string[] = [];
	const flags = new Set<string>();
	const values = new Map<string, string>();
	let path: string | undefined;
	let bundle = false;
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i] as string;
		if (token === "--bundle") {
			bundle = true;
		} else if (token === "--dep") {
			const value = argv[++i];
			if (value === undefined) throw new UsageError("--dep: missing manifest path.");
			deps.push(value);
			// A `--dep` without `--bundle` is a silent no-op otherwise: the
			// dependency closure only exists in the merged document.
			bundle = true;
		} else if (boolFlags.includes(token)) {
			flags.add(token);
		} else if (valueFlags.includes(token)) {
			const value = argv[++i];
			if (value === undefined) throw new UsageError(`${token}: missing value.`);
			values.set(token, value);
		} else if (token.startsWith("--")) {
			throw new UsageError(`sk ${command}: unknown flag ${token}.`);
		} else if (path === undefined) {
			path = token;
		} else {
			throw new UsageError(`sk ${command}: unexpected second path ${JSON.stringify(token)}.`);
		}
	}
	if (path === undefined) throw new UsageError(`sk ${command}: requires a manifest path.`);
	return { path, deps, bundle, flags, values };
}

function resolveReadManifestArgs(
	argv: string[],
	options: GlobalOptions,
	command: string,
	valueFlags: string[] = [],
): { argv: string[]; configuredTarget: boolean } {
	let hasPath = false;
	for (let index = 0; index < argv.length; index += 1) {
		const token = argv[index] as string;
		if (token === "--dep" || valueFlags.includes(token)) {
			index += 1;
		} else if (!token.startsWith("--")) {
			hasPath = true;
			break;
		}
	}
	if (hasPath) return { argv, configuredTarget: false };
	if (options.targetDir === undefined) {
		throw new UsageError(
			`sk ${command}: no manifest path and no author.target — ` +
				"pass <manifest.toml> or run `sk config set --project author.target <bundle-dir>`.",
		);
	}
	return {
		argv: [
			options.targetDir.endsWith(".toml")
				? options.targetDir
				: join(options.targetDir, "manifest.toml"),
			"--bundle",
			...argv,
		],
		configuredTarget: true,
	};
}

function shellArg(value: string): string {
	return /^[A-Za-z0-9_./:@+-]+$/.test(value) ? value : `'${value.replace(/'/g, "'\\''")}'`;
}

/** Parse --images for map commands; default auto (env SPELLKAVE_TERMINAL_IMAGES also works). */
function requireImagesMode(raw: string | undefined): TerminalImagesMode {
	if (raw === undefined) return "auto";
	const mode = parseImagesModeFlag(raw);
	if (mode === undefined) {
		throw new UsageError(
			`--images: expected auto|kitty|iterm2|half|quarter|sixel|timg|off; received ${JSON.stringify(raw)}.`,
		);
	}
	return mode;
}

function bundleFollowup(
	command: string,
	path: string,
	deps: string[],
	bundle: boolean,
	configuredTarget: boolean,
): string {
	if (configuredTarget) return `sk ${command}`;
	const args = [shellArg(path)];
	if (bundle) args.push("--bundle");
	for (const dep of deps) args.push("--dep", shellArg(dep));
	return `sk ${command} ${args.join(" ")}`;
}

const FILE_COMMANDS: Record<string, FileCommand> = {
	authoring: {
		summary: "Prepare the SDK authoring corpus",
		usage:
			"sk authoring prepare\n\n" +
			"In an sk-sdk source checkout with dependencies installed, regenerate the authoring " +
			"corpus and verify its reviewed diagnostics using the installed validator. No world connection is required.",
		run: async (io, argv) => {
			if (argv.length !== 1 || argv[0] !== "prepare") {
				throw new UsageError("usage: sk authoring prepare");
			}
			return prepareAuthoring(io);
		},
	},
	delta: {
		summary:
			"Inspect a delta offline: dependency validation, preservation risks and regression obligations",
		usage:
			"sk delta inspect <delta.toml> --against <roots...>\n\n" +
			"Roots are manifest files or directories containing manifest.toml; --against may repeat.\n" +
			"Validates with the same context as sk validate --bundle --dep <root>..., then reports\n" +
			"potential preservation-sensitive rows, git tracking, unkeyed regression kinds and census\n" +
			"recapture guidance. Read-only and offline: roots do not establish live state or ownership.\n" +
			"Default machine output is one delta_inspect_result JSONL record. Advisory risks do not fail.\n\n" +
			"Exit: 0 valid context, 2 fatal diagnostics or missing includes, 1 usage/input/tool failure.",
		run: async (io, argv) => {
			if (argv[0] !== "inspect" || !argv[1] || argv[1].startsWith("-")) {
				throw new UsageError("sk delta: expected inspect <delta.toml> --against <roots...>.");
			}
			const path = argv[1];
			const roots: string[] = [];
			let inAgainst = false;
			let groupCount = 0;
			for (const token of argv.slice(2)) {
				if (token === "--against") {
					if (inAgainst && groupCount === 0)
						throw new UsageError("--against: requires a dependency root.");
					inAgainst = true;
					groupCount = 0;
				} else if (token.startsWith("-") || !inAgainst) {
					throw new UsageError(`sk delta inspect: unexpected argument ${JSON.stringify(token)}.`);
				} else {
					roots.push(token);
					groupCount++;
				}
			}
			if (groupCount === 0)
				throw new UsageError("--against: requires at least one dependency root.");
			const result = await inspectDelta(path, roots);
			io.record({ kind: "delta_inspect_result", ...result });
			return result.validation.valid && result.validation.missingIncludes.length === 0
				? EXIT_OK
				: EXIT_IN_WORLD;
		},
	},
	validate: {
		summary: "Validate a manifest; exit 2 on any fatal diagnostic",
		usage:
			"sk validate [<manifest.toml>] [--bundle] [--dep <manifest>]...\n\n" +
			"Without a path, validates <author.target>/manifest.toml and its include closure.\n" +
			"--bundle merges the root's [[include]] fragments (and each --dep bundle's, for the\n" +
			"depends_on closure) into one document, so cross-row checks a single-file validate\n" +
			"structurally cannot see fire against the real merged catalog. `valid` means no FATAL\n" +
			"diagnostic — the server admits with warnings.\n\n" +
			"Exit: 0 valid, 2 fatal diagnostics present.",
		run: async (io, argv, options) => {
			const resolved = resolveReadManifestArgs(argv, options, "validate");
			const { path, deps, bundle } = parseBundleArgs(resolved.argv, "validate");
			const result = await validateBundle(path, deps, bundle);
			io.record({ kind: "validate_result", ...result });
			const inspect = bundleFollowup("inspect", path, deps, bundle, resolved.configuredTarget);
			if (result.valid) {
				io.hint(
					`Next:\n  ${bundleFollowup("lint", path, deps, bundle, resolved.configuredTarget)} — check non-fatal authoring problems\n  ${inspect} — review the bundle's populated row kinds`,
				);
			} else {
				const firstCode = result.diagnostics[0]?.code ?? "manifest validation";
				io.hint(
					`Next:\n  sk docs --query ${shellArg(`validation ${firstCode}`)} — understand the first diagnostic\n  ${inspect} — review the bundle's shape and includes`,
				);
			}
			return result.valid ? EXIT_OK : EXIT_IN_WORLD;
		},
	},
	lint: {
		summary: "Lint a manifest for non-fatal smells; advisory unless --strict",
		usage:
			"sk lint [<manifest.toml>] [--bundle] [--dep <manifest>]... [--strict]\n\n" +
			"Without a path, lints <author.target>/manifest.toml and its include closure.\n" +
			"The author-time companion to validate: the same rows, but only NON-FATAL duplication\n" +
			"and binding smells (twin actions, dangling spell-capability bindings, delimiter drift,\n" +
			"repeated tag sets). Findings are advisory, so this exits 0 by default; --strict exits 3\n" +
			"when a root-bundle finding fires; dependency findings remain listed. The JSON is identical either way.\n\n" +
			"Exit: 0 always, or 3 under --strict with root findings.",
		run: async (io, argv, options) => {
			const resolved = resolveReadManifestArgs(argv, options, "lint");
			const { path, deps, bundle, flags } = parseBundleArgs(resolved.argv, "lint", ["--strict"]);
			const result = await lintBundle(path, deps, bundle);
			io.record({ kind: "lint_result", ...result });
			const validate = bundleFollowup("validate", path, deps, bundle, resolved.configuredTarget);
			const inspect = bundleFollowup("inspect", path, deps, bundle, resolved.configuredTarget);
			io.hint(
				result.clean
					? `Next:\n  ${validate} — confirm fatal validation is also clean\n  ${inspect} — review the bundle's populated row kinds`
					: `Next:\n  sk docs --query "lint findings" — review authoring guidance for these findings\n  ${validate} — confirm the bundle still passes fatal validation`,
			);
			return flags.has("--strict") && !result.clean ? EXIT_LINT : EXIT_OK;
		},
	},
	patch: {
		summary: "Apply one named patch op to a manifest FILE",
		usage:
			"sk patch <manifest.toml> --op <op> --json '<payload>' --output <file> [--no-validate]\n\n" +
			"The op name is pass-through to the Rust wasm dispatcher, so this gains every op the\n" +
			"crate gains with no change here. An unknown --op fails with `unknown patch op: <op>`;\n" +
			"the accepted names are the arms of `dispatch` in spellkave-authoring's src/patch/mod.rs.\n\n" +
			"Distinct from the registry write verbs (place_entity, place_actor, define_*, write_rows), and both are\n" +
			"worth having: the verbs author into a workspace and flush to a bundle's ROOT manifest,\n" +
			"while this writes whichever FILE you name — which is how a row lands in a specific\n" +
			"[[include]] fragment of an include-heavy bundle.\n\n" +
			"Nothing is written when validation fails. Exit: 0 written, 2 diagnostics (no write).",
		run: async (io, argv) => {
			const { path, values, flags } = parseBundleArgs(
				argv,
				"patch",
				["--no-validate"],
				["--op", "--json", "--output"],
			);
			const op = values.get("--op");
			const output = values.get("--output");
			const raw = values.get("--json");
			if (op === undefined) throw new UsageError("sk patch: requires --op <op>.");
			if (output === undefined) throw new UsageError("sk patch: requires --output <file>.");
			if (raw === undefined) throw new UsageError("sk patch: requires --json '<payload>'.");
			let payload: unknown;
			try {
				payload = JSON.parse(raw);
			} catch (err) {
				throw new UsageError(`sk patch --json: ${(err as Error).message}`);
			}
			if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
				throw new UsageError("sk patch --json: payload must be a JSON object.");
			}
			const { result, ok } = await patchManifestFile(
				path,
				op,
				payload as Record<string, unknown>,
				output,
				flags.has("--no-validate"),
			);
			io.record({ kind: "patch_result", ...result });
			io.hint(
				ok
					? `Next:\n  sk validate ${shellArg(output)} — check the written manifest\n  sk inspect ${shellArg(output)} — review its populated row kinds`
					: `Next:\n  sk docs --query "manifest validation" — understand why nothing was written\n  sk inspect ${shellArg(path)} — review the source manifest`,
			);
			return ok ? EXIT_OK : EXIT_IN_WORLD;
		},
	},
	render: {
		summary: "Render a schema-shaped JSON manifest to TOML",
		usage:
			"sk render --input <manifest.json> --output <manifest.toml> [--no-validate]\n\n" +
			"The bulk path: build ONE schema-shaped JSON object carrying whole row arrays and render\n" +
			"it in a single call (the Rust renderer fills defaults and validates) rather than looping\n" +
			"a patch op per row.\n\n" +
			"Nothing is written when validation fails. Exit: 0 written, 2 diagnostics (no write).",
		run: async (io, argv) => {
			// `--input` stands in for the positional path every other file
			// command takes, so this one is parsed directly.
			const values = new Map<string, string>();
			let noValidate = false;
			for (let i = 0; i < argv.length; i += 1) {
				const token = argv[i] as string;
				if (token === "--no-validate") {
					noValidate = true;
				} else if (token === "--input" || token === "--output") {
					const value = argv[++i];
					if (value === undefined) throw new UsageError(`${token}: missing value.`);
					values.set(token, value);
				} else {
					throw new UsageError(`sk render: unexpected argument ${JSON.stringify(token)}.`);
				}
			}
			const input = values.get("--input");
			const output = values.get("--output");
			if (input === undefined) throw new UsageError("sk render: requires --input <json>.");
			if (output === undefined) throw new UsageError("sk render: requires --output <toml>.");
			const { result, ok } = await renderManifestFile(input, output, noValidate);
			io.record({ kind: "render_result", ...result });
			io.hint(
				ok
					? `Next:\n  sk validate ${shellArg(output)} — check the rendered manifest\n  sk inspect ${shellArg(output)} — review its populated row kinds`
					: 'Next:\n  sk docs --query "manifest validation" — understand why nothing was written\n  Fix the reported input fields, then run this render command again.',
			);
			return ok ? EXIT_OK : EXIT_IN_WORLD;
		},
	},
	"map-inspect": {
		summary: "Report an authored place-graph's shape and reachability",
		usage:
			"sk map-inspect [<manifest.toml>] [--bundle] [--dep <manifest>]... [--graph <id>]\n" +
			"                [--images auto|kitty|iterm2|half|quarter|sixel|timg|off]\n\n" +
			"Without a path, inspects author.target (a manifest file or directory) and its include closure.\n" +
			"Counts graphs, places, routes, and actor clusters, and names every node NOT reachable\n" +
			"from the graph's anchor — an unreachable place is authored but unwalkable.\n" +
			"Human mode draws the map inline. --images half|quarter uses timg unicode blocks\n" +
			"(best over herdr --remote); kitty|iterm2 use graphics protocols; auto tries kitty\n" +
			"then falls back to quarter when timg is installed.\n\n" +
			"Exit: 0.",
		run: async (io, argv, options) => {
			// valueFlags must match parseBundleArgs so `--graph region` is not
			// mistaken for a bare path token when no manifest path is given.
			const mapInspectFlags = ["--graph", "--images"];
			const resolved = resolveReadManifestArgs(argv, options, "map-inspect", mapInspectFlags);
			const { path, deps, bundle, values } = parseBundleArgs(
				resolved.argv,
				"map-inspect",
				[],
				mapInspectFlags,
			);
			const graphId = values.get("--graph");
			const imagesMode = requireImagesMode(values.get("--images"));
			const result = await mapInspect(path, deps, bundle, { graphId });
			const svg = typeof result.svg === "string" ? result.svg : null;
			const inventory =
				typeof result.inventory === "string"
					? result.inventory
					: "Spatial graph: empty (no outdoor positioned place_nodes).";
			// Human path: SVG → PNG → Kitty/iTerm2 inline image (Ghostty uses Kitty).
			let showedImage = false;
			if (io.format === "human") {
				const presented = await presentSpatialGraphOnTerminal({
					svg,
					inventory,
					maxWidthCells: Math.max(40, process.stdout.columns ?? 100),
					imagesMode,
				});
				emitSpatialGraphPresentation(io, presented);
				showedImage = presented.showedImage;
			}
			// JSONL keeps additive svg/inventory; human summary omits the large svg blob.
			// When an inline image was shown, skip the Markdown wall (it scrolls/
			// obscures the picture — timg only emits graphics + one newline).
			const { svg: _svg, ...summary } = result;
			if (io.format === "jsonl") {
				io.record({ kind: "map_inspect_result", ...result });
			} else if (!showedImage) {
				io.record({ kind: "map_inspect_result", ...summary });
			} else {
				io.hint(
					`${Number(result.places)} places · ${Number(result.routes)} routes` +
						(graphId ? ` · graph ${graphId}` : "") +
						`  ·  sk map-render --out map.svg to save`,
				);
			}
			if (!showedImage) {
				const sourceArgs = [shellArg(path)];
				if (bundle) sourceArgs.push("--bundle");
				for (const dep of deps) sourceArgs.push("--dep", shellArg(dep));
				if (graphId !== undefined) sourceArgs.push("--graph", shellArg(graphId));
				const inspect = bundleFollowup("inspect", path, deps, bundle, resolved.configuredTarget);
				const available = Array.isArray(result.availableGraphIds)
					? result.availableGraphIds.filter((id): id is string => typeof id === "string")
					: [];
				const chooseGraph = available
					.map(
						(id) =>
							`  ${bundleFollowup("map-inspect", path, deps, bundle, resolved.configuredTarget)} --graph ${shellArg(id)}`,
					)
					.join("\n");
				io.hint(
					Number(result.graphs) > 0 || Number(result.places) > 0
						? `Next:\n  sk map-render ${sourceArgs.join(" ")} --out map.svg — write the SVG file\n  ${inspect} — review the rest of the bundle`
						: available.length > 0
							? `No positioned places in this view. Authored graphs are available.\nNext:\n${chooseGraph}`
							: `No place graph is authored yet.\nNext:\n  sk docs --query "place graph" — learn the map authoring shape\n  ${inspect} — review what the bundle already contains`,
				);
			}
			return EXIT_OK;
		},
	},
	"map-render": {
		summary: "Draw an authored place-graph as SVG or HTML",
		usage:
			"sk map-render <manifest.toml> [--out <file>] [--bundle] [--dep <manifest>]...\n" +
			"                [--graph <id>] [--format html|svg] [--asset-root <path-or-url>]\n" +
			"                [--images auto|kitty|iterm2|half|quarter|sixel|timg|off]\n\n" +
			"With --out, writes SVG/HTML to that path. Without --out, human mode paints the map\n" +
			"inline. --images quarter|half shells out to timg (unicode blocks — best for\n" +
			"herdr --remote); kitty|iterm2 use graphics protocols; auto tries kitty then\n" +
			"quarter. Requires `timg` on PATH for half/quarter/sixel (brew install timg).\n" +
			"--graph draws one place_graph instead of every graph composed together.\n" +
			"--asset-root resolves backdrop images (a path or a URL prefix); without it, a map with\n" +
			"backdrops still renders, just without them.\n\n" +
			"Exit: 0.",
		run: async (io, argv, options) => {
			const mapRenderValueFlags = ["--out", "--graph", "--format", "--asset-root", "--images"];
			const resolved = resolveReadManifestArgs(argv, options, "map-render", mapRenderValueFlags);
			const { path, deps, bundle, values } = parseBundleArgs(
				resolved.argv,
				"map-render",
				[],
				mapRenderValueFlags,
			);
			const out = values.get("--out");
			const graphId = values.get("--graph");
			const imagesMode = requireImagesMode(values.get("--images"));
			if (out === undefined) {
				// Terminal-only path: same SVG as file export, painted inline when capable.
				const inspected = await mapInspect(path, deps, bundle, { graphId });
				const svg = typeof inspected.svg === "string" ? inspected.svg : null;
				const inventory =
					typeof inspected.inventory === "string"
						? inspected.inventory
						: "Spatial graph: empty (no outdoor positioned place_nodes).";
				let showedImage = false;
				if (io.format === "human") {
					const presented = await presentSpatialGraphOnTerminal({
						svg,
						inventory,
						maxWidthCells: Math.max(40, process.stdout.columns ?? 100),
						imagesMode,
					});
					emitSpatialGraphPresentation(io, presented);
					showedImage = presented.showedImage;
				}
				const { svg: _svg, ...summary } = inspected;
				if (io.format === "jsonl") {
					io.record({
						kind: "map_render_result",
						output: null,
						format: "terminal",
						graph: graphId ?? "all",
						...inspected,
					});
				} else if (!showedImage) {
					io.record({
						kind: "map_render_result",
						output: null,
						format: "terminal",
						graph: graphId ?? "all",
						...summary,
					});
					io.hint(
						`Next: sk map-render ${shellArg(path)}${bundle ? " --bundle" : ""} --out map.svg — write the SVG file`,
					);
				} else {
					io.hint(
						`${Number(inspected.places)} places · ${Number(inspected.routes)} routes` +
							(graphId ? ` · graph ${graphId}` : "") +
							`  ·  sk map-render --out map.svg to save`,
					);
				}
				return EXIT_OK;
			}
			const result = await renderAuthorMap(
				path,
				deps,
				bundle,
				out,
				values.get("--format") ?? "svg",
				graphId,
				values.get("--asset-root"),
			);
			io.record({ kind: "map_render_result", ...result });
			io.hint(
				`Rendered map: ${out}\nNext: ${bundleFollowup("map-inspect", path, deps, bundle, false)} — check reachability.`,
			);
			return EXIT_OK;
		},
	},
	inspect: {
		summary: "Explore a bundle from row-kind overview to row detail",
		usage:
			"sk inspect [<manifest.toml>] [--bundle] [--dep <manifest>]...\n\n" +
			"sk inspect --kind <row-kind> [--id <row-id> | --pattern <text> | --schema]\n\n" +
			"Without a path, inspects <author.target>/manifest.toml and its include closure from config.\n" +
			"Use the exact row-kind keys shown in the overview with --kind to list rows, then --id\n" +
			"to inspect one complete row and its references. These deeper forms delegate to the\n" +
			"registry's query tool over the configured workspace/target. `sk query` remains its\n" +
			"direct, machine-oriented name. An explicit manifest path supports only the overview.\n\n" +
			"Exit: 0.",
		run: async (io, argv, options, connectLive) => {
			const queryFlags = ["--kind", "--id", "--pattern", "--schema"];
			if (argv.some((token) => queryFlags.includes(token))) {
				const valueFlags = new Set([
					"--kind",
					"--id",
					"--pattern",
					"--bundle",
					"--refs",
					"--target",
				]);
				for (let index = 0; index < argv.length; index += 1) {
					const token = argv[index] as string;
					if (valueFlags.has(token)) {
						index += 1;
					} else if (token !== "--schema" && !token.startsWith("--")) {
						throw new UsageError(
							"sk inspect: a manifest path cannot be combined with --kind/--id/--pattern/--schema; " +
								"use the configured author.target or pass `--target <bundle-dir>` before `inspect`.",
						);
					}
				}
				let queryDetails: Record<string, unknown> | undefined;
				const code = await runTool(
					io,
					options,
					"query",
					argv,
					connectLive,
					false,
					"inspect_result",
					(details) => {
						if (typeof details === "object" && details !== null && !Array.isArray(details)) {
							queryDetails = details as Record<string, unknown>;
						}
					},
				);
				if (code !== EXIT_OK) return code;
				const valueAfter = (flag: string): string | undefined => {
					const index = argv.indexOf(flag);
					return index < 0 ? undefined : argv[index + 1];
				};
				const kind = valueAfter("--kind");
				const id = valueAfter("--id");
				if (kind !== undefined) {
					const firstItem =
						Array.isArray(queryDetails?.items) &&
						typeof (queryDetails.items[0] as { id?: unknown } | undefined)?.id === "string"
							? ((queryDetails.items[0] as { id: string }).id ?? undefined)
							: undefined;
					const firstInbound =
						Array.isArray(queryDetails?.inbound_refs) &&
						typeof (queryDetails.inbound_refs[0] as { kind?: unknown } | undefined)?.kind ===
							"string" &&
						typeof (queryDetails.inbound_refs[0] as { id?: unknown } | undefined)?.id === "string"
							? (queryDetails.inbound_refs[0] as { kind: string; id: string })
							: undefined;
					io.hint(
						id === undefined
							? firstItem === undefined
								? `No rows of this kind are authored.\nNext: sk inspect — return to the bundle overview.`
								: `Next:\n  sk inspect --kind ${shellArg(kind)} --id ${shellArg(firstItem)} — inspect the first listed row and its references\n  sk inspect — return to the bundle overview`
							: `Next:\n${firstInbound === undefined ? "" : `  sk inspect --kind ${shellArg(firstInbound.kind)} --id ${shellArg(firstInbound.id)} — follow the first inbound reference\n`}  sk inspect --kind ${shellArg(kind)} — return to all rows of this kind\n  sk inspect — return to the bundle overview`,
					);
				}
				return code;
			}
			const resolved = resolveReadManifestArgs(argv, options, "inspect");
			const { path, deps, bundle } = parseBundleArgs(resolved.argv, "inspect");
			const result = await inspectBundle(path, deps, bundle);
			io.record({ kind: "inspect_result", ...result });
			const next = [
				"Next:",
				"  sk inspect --kind ROW_KIND — browse rows using an exact kind shown above",
				`  ${bundleFollowup("validate", path, deps, bundle, resolved.configuredTarget)} — check fatal manifest problems`,
				`  ${bundleFollowup("lint", path, deps, bundle, resolved.configuredTarget)} — check non-fatal authoring problems`,
			];
			io.hint(next.join("\n"));
			return EXIT_OK;
		},
	},
	// Host metadata, not a manifest-path command like its siblings above — kept
	// in this table anyway (rather than a fourth dispatch group) because the
	// property that matters is the same one every file command shares: it is
	// NOT a registry tool, so it must never collide with one (the
	// "shadows no registry tool name" test in `__tests__/file-commands.test.ts`
	// covers this entry too, for free).
	skill: {
		summary: "Print the absolute path to sk's own packaged SKILL.md",
		usage:
			"sk skill path\n\n" +
			"Prints the absolute path to this package's OWN packaged skill file, resolved from\n" +
			"sk's own install location (never cwd-relative — works from any invocation directory,\n" +
			"inside or outside the Spellkave monorepo). Agents: run this once per session, then\n" +
			"read the file at the printed path before authoring or taking connected-mode actions.\n\n" +
			"Exit: 0.",
		run: async (io, argv) => {
			if (argv[0] !== "path") {
				throw new UsageError("sk skill: requires a subcommand — run `sk skill path`.");
			}
			io.record({ kind: "skill_path", path: PACKAGED_SKILL_MD_PATH });
			io.hint(`Next: read ${shellArg(PACKAGED_SKILL_MD_PATH)} before using sk as an agent.`);
			return EXIT_OK;
		},
	},
};

export const FILE_COMMAND_NAMES: readonly string[] = Object.keys(FILE_COMMANDS);

function unknownTool(io: RecordIo, name: string): number {
	io.record({
		kind: "error",
		scope: "usage",
		message: `unknown tool ${JSON.stringify(name)} — run \`sk help\` to browse commands.`,
	});
	return EXIT_USAGE;
}

function resultText(result: AgentToolResult<unknown>): string {
	return result.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

/**
 * In-world rejection is the registry's own `{ ok: false }` details convention
 * (see `commitOrReport` in `authoring-verbs.ts`) — a tool that ran correctly
 * and is reporting that the WORLD refused. A tool whose details carry no `ok`
 * field simply succeeded.
 */
function isRejection(details: unknown): boolean {
	return (
		typeof details === "object" && details !== null && (details as { ok?: unknown }).ok === false
	);
}

async function runTool(
	io: RecordIo,
	options: GlobalOptions,
	toolName: string,
	argv: string[],
	connectLive: ConnectLive,
	emitHints = true,
	resultKind?: string,
	captureDetails?: (details: unknown) => void,
	/**
	 * Re-encodes the finished result record for the sink's format (CLI-only rendering such as
	 * `sk explore` command lines and its TOON shape). JSONL stays the canonical record.
	 */
	projectRecord?: (
		record: Record<string, unknown>,
		format: RecordIo["format"],
		liveTarget: ExploreLiveTarget | undefined,
	) => Record<string, unknown>,
): Promise<number> {
	const def = definitionFor(toolName);
	if (def === undefined) return unknownTool(io, toolName);
	if (!isAvailable(def.name, options)) {
		io.record({
			kind: "error",
			scope: "usage",
			tool: def.name,
			message: unavailableReason(def.name),
		});
		return EXIT_USAGE;
	}

	const schema = def.parameters as TSchema;
	let toolIo = io;
	let toolArgv = argv;
	const hasFormatInSchema =
		typeof (schema as { properties?: Record<string, unknown> }).properties?.format !== "undefined";
	if (!hasFormatInSchema) {
		const filtered: string[] = [];
		for (let i = 0; i < toolArgv.length; i += 1) {
			const arg = toolArgv[i] as string;
			if (arg === "--format") {
				const val = toolArgv[++i];
				if (isOutputFormat(val)) {
					toolIo = toolIo.withFormat ? toolIo.withFormat(val as OutputFormat) : toolIo;
				} else {
					throw new UsageError(
						`--format: expected auto, human, jsonl, or toon; received ${JSON.stringify(val)}.`,
					);
				}
			} else if (arg.startsWith("--format=")) {
				const val = arg.slice(9) as OutputFormat;
				if (isOutputFormat(val)) {
					toolIo = toolIo.withFormat ? toolIo.withFormat(val) : toolIo;
				} else {
					throw new UsageError(
						`--format: expected auto, human, jsonl, or toon; received ${JSON.stringify(val)}.`,
					);
				}
			} else {
				filtered.push(arg);
			}
		}
		toolArgv = filtered;
	}
	io = toolIo;

	const params = parseToolArgs(deriveFlags(schema), toolArgv, def.cli?.positionals);
	if (!typeboxCheck(schema, params)) {
		const errors = [...typeboxErrors(schema, params)];
		io.record({
			kind: "error",
			scope: "usage",
			tool: def.name,
			message: `invalid parameters: ${errors
				.map((e) => `${e.instancePath || "/"} ${e.message}`)
				.join("; ")}`,
		});
		return EXIT_USAGE;
	}

	// `--live` connects ONCE for this invocation and closes once the tool's
	// result is in hand, success or failure — `sk` is one-shot, never a
	// daemon holding a session across calls (#1990 slice 2 decision).
	let live: LiveConnection | undefined;
	let liveBinding: ExploreLiveTarget | undefined;
	try {
		if (options.live) {
			const resolvedLive = resolveLiveConnection(options.profileName);
			liveBinding = {
				url: resolvedLive.url,
				db: resolvedLive.db,
				source: resolvedLive.source,
				...(resolvedLive.profile === undefined ? {} : { profile: resolvedLive.profile }),
			};
			// Same visibility posture as PLAYER's `last_used` announce (#2002):
			// a profile, a context or an overriding environment silently
			// supplying a flush destination is exactly the mixing this was built
			// to stop being silent about.
			announceAuthorConnection(io, resolvedLive, "--live");
			if (resolvedLive.source === "flag" && resolvedLive.profile !== undefined) {
				rememberProfile(resolvedLive.profile);
			}
			try {
				live = await connectLive({
					...(def.name === EXPLAIN_TOOL && params.kind !== "binding"
						? { publicVocabularyOnly: true }
						: {}),
					url: resolvedLive.url,
					db: resolvedLive.db,
					...(resolvedLive.token === undefined ? {} : { token: resolvedLive.token }),
				});
			} catch (error) {
				if (def.name === CAN_I_TOOL) {
					throw new Error(
						`no reachable world. Start one with sk dev up or select one with sk config use-context. ${error instanceof Error ? error.message : String(error)}`,
					);
				}
				throw error;
			}
		}
		const context = buildContext(
			options,
			io,
			live?.target,
			live?.exportManifest,
			live?.applyset,
			live?.canI,
			live?.readInstance,
			live?.explainDisclosure ??
				(live === undefined
					? undefined
					: { connectedIdentity: live.connectedIdentity, readsAsPublisher: live.readsAsPublisher }),
			live?.grants,
			live?.exploration,
			live?.scenes,
		);
		const tool = bindTool(def as never, {
			context,
			capabilities: { node: nodeToolCapability },
			validateArguments: false,
		});
		// sk-jay0.7.171.1: a `--live` delta flush leaves a journal entry either
		// way — the applied TOML is the author's spec for the generator edit, and
		// a failed attempt is still a record of what was tried.
		const journalLiveDelta = (ok: boolean, detail: string | undefined) => {
			if (!options.live || def.name !== APPLY_MANIFEST_DELTA_TOOL || liveBinding === undefined)
				return;
			const dir = resolveLiveDeltaJournalDir();
			if (dir === undefined) return;
			const explicitToml = (params as { toml?: unknown }).toml;
			const source: "toml" | "scratch" =
				typeof explicitToml === "string" && explicitToml.length > 0 ? "toml" : "scratch";
			const toml =
				source === "toml" ? (explicitToml as string) : (context.workspace.readToml() ?? "");
			try {
				const entry = recordLiveDelta({
					dir,
					toml,
					source,
					url: liveBinding.url,
					db: liveBinding.db,
					ok,
					...(detail === undefined ? {} : { detail }),
					durationMs: Date.now() - startedAt,
				});
				io.err(`sk: live delta journaled -> ${entry.path} (${ok ? "ok" : "failed"})`);
			} catch (error) {
				io.err(
					`sk: live delta journal skipped — ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		};
		const startedAt = Date.now();
		let result: AgentToolResult<unknown>;
		try {
			result = (await tool.execute("sk", params as never)) as AgentToolResult<unknown>;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			journalLiveDelta(false, message);
			if (live !== undefined) {
				io.record({
					kind: "error",
					scope: message.startsWith("baseline_unavailable:") ? "in_world" : "infra",
					tool: def.name,
					message,
					...publisherAnswerFields(live, def.name),
				});
				return message.startsWith("baseline_unavailable:") ? EXIT_IN_WORLD : EXIT_USAGE;
			}
			throw error;
		}
		captureDetails?.(result.details);
		const rejected = isRejection(result.details);
		// Named guidance is prose at the native CLI boundary. Explicit machine
		// formats retain the shared tool envelope, including its metadata.
		if (
			def.name === DOCS_TOOL &&
			!rejected &&
			(options.format === "auto" || options.format === "human") &&
			typeof result.details === "object" &&
			result.details !== null &&
			"doc" in result.details
		) {
			const doc = result.details.doc as { body?: unknown } | undefined;
			if (typeof doc?.body === "string" && io.withFormat) {
				io.withFormat("human").rawHuman(doc.body.trimEnd());
				return EXIT_OK;
			}
		}
		journalLiveDelta(
			!rejected,
			typeof result.details === "object" &&
				result.details !== null &&
				typeof (result.details as { detail?: unknown }).detail === "string"
				? ((result.details as { detail: string }).detail as string)
				: undefined,
		);
		const projectedDetails =
			resultKind !== undefined &&
			typeof result.details === "object" &&
			result.details !== null &&
			!Array.isArray(result.details)
				? (result.details as Record<string, unknown>)
				: undefined;
		const projectedKind =
			projectedDetails !== undefined && typeof projectedDetails.kind === "string"
				? projectedDetails.kind
				: undefined;
		// Human terminals (Ghostty/Kitty/…): paint any tool-returned spatial SVG
		// inline before the structured summary. JSONL is untouched.
		await maybeEmitSvgDetailsOnTerminal(io, result.details, {
			maxWidthCells: Math.max(40, process.stdout.columns ?? 100),
		});
		const projectedBody =
			projectedDetails === undefined
				? undefined
				: Object.fromEntries(
						Object.entries(projectedDetails).filter(
							([key]) => key !== "kind" && !(io.format === "human" && key === "svg"),
						),
					);
		const toolDetailsForHuman =
			io.format === "human" &&
			typeof result.details === "object" &&
			result.details !== null &&
			!Array.isArray(result.details)
				? Object.fromEntries(
						Object.entries(result.details as Record<string, unknown>).filter(
							([key]) => key !== "svg",
						),
					)
				: result.details;
		const publisher = live === undefined ? {} : publisherAnswerFields(live, def.name);
		const record: Record<string, unknown> =
			projectedDetails === undefined
				? {
						kind: "tool_result",
						tool: def.name,
						ok: !rejected,
						text: resultText(result),
						details: toolDetailsForHuman,
						...publisher,
					}
				: {
						kind: resultKind,
						ok: !rejected,
						...(projectedKind === undefined ? {} : { rowKind: projectedKind }),
						...projectedBody,
						...publisher,
					};
		io.record(
			projectRecord !== undefined && projectedDetails !== undefined
				? projectRecord(record, io.format, liveBinding)
				: record,
		);
		if (emitHints && !rejected && def.cli?.examples !== undefined) {
			io.hint(
				[
					"Next:",
					...def.cli.examples.map((example) => `  ${example.command} — ${example.description}`),
				].join("\n"),
			);
		}
		if (rejected && (def.name === GET_TOOL || def.name === DESCRIBE_TOOL)) {
			const code =
				typeof result.details === "object" && result.details !== null
					? (result.details as { code?: string }).code
					: undefined;
			return instanceReadExit(code);
		}
		return rejected ? EXIT_IN_WORLD : EXIT_OK;
	} finally {
		if (live !== undefined) await live.close();
	}
}

/**
 * Dispatch one PLAYER tool through the binding-keyed session daemon:
 * `ensureDaemon` attaches to (or spawns) the ONE daemon for this invocation's
 * `(url, db, identity, actor)`, `sk` sends a single `invoke` frame, and the
 * connection to the SOCKET closes when `SessionDaemonClient.invoke` resolves — the
 * DAEMON keeps running (idle timeout, `sk session stop` below), unlike
 * `--live`'s own per-call SDK connection, which `sk` owns and closes itself.
 */
async function runPlayerTool(
	io: RecordIo,
	options: GlobalOptions,
	def: PlayerFacingToolDefinition,
	argv: string[],
	ensureDaemonFn: EnsureDaemon,
): Promise<number> {
	const schema = def.parameters as TSchema;
	const params = parseToolArgs(deriveFlags(schema), argv);
	if (!typeboxCheck(schema, params)) {
		const errors = [...typeboxErrors(schema, params)];
		io.record({
			kind: "error",
			scope: "usage",
			tool: def.name,
			message: `invalid parameters: ${errors
				.map((e) => `${e.instancePath || "/"} ${e.message}`)
				.join("; ")}`,
		});
		return EXIT_USAGE;
	}

	const { binding, token, profile } = resolveBinding(options, def.name);
	// Ambient state must stay visible (#2002 decision 2): a bare invocation
	// that fell back to `last_used_profile` announces WHICH profile it picked,
	// one line, stderr only — stdout stays JSONL-only regardless.
	if (profile !== undefined && profile.source === "last_used") {
		io.err(`sk: using profile '${profile.name}' (last used)`);
	}
	const client = await attachSessionDaemon(binding, {
		ensureDaemonFn,
		...(token === undefined ? {} : { token }),
		command: sessionDaemonCommand(),
	});
	// Successful use of an EXPLICITLY named `--profile` becomes the new
	// `last_used_profile` (#2002 decision 4) — mirrors Pi's own
	// `rememberProfile` call site, right after the connection is established.
	if (profile !== undefined && profile.source === "flag") {
		rememberProfile(profile.name);
	}
	const response = await client.invoke<AgentToolResult<unknown>>(def.name, params);
	return emitPlayerResponse(io, def, response);
}

/**
 * Same `tool_result` JSONL shape `runTool` emits for AUTHOR tools — the
 * output contract does not change with the dispatch path. A protocol-level
 * error (the daemon rejected the frame itself, before/instead of running a
 * tool) maps by the daemon's own error `code`
 * (`@spellkave/session/node`'s `daemon.ts`): `tool_error` is a tool body that
 * threw — infra, mirroring this file's own "a tool that throws is infra"
 * rule; `bad_request`/`unknown_tool` are usage (bad args, or a registry
 * skew between this `sk` and the daemon it attached to).
 */
function emitPlayerResponse(
	io: RecordIo,
	def: PlayerFacingToolDefinition,
	response: SessionResponse,
): number {
	if (isOkResponse(response)) {
		const result = response.result as AgentToolResult<unknown>;
		const rejected = isRejection(result.details);
		io.record({
			kind: "tool_result",
			tool: def.name,
			ok: !rejected,
			text: resultText(result),
			details: result.details,
		});
		emitConsequences(io, result.details);
		emitPushes(io, response.pushes);
		if (!rejected && def.cli?.examples !== undefined) {
			io.hint(
				[
					"Next:",
					...def.cli.examples.map((example) => `  ${example.command} — ${example.description}`),
				].join("\n"),
			);
		}
		return rejected ? EXIT_IN_WORLD : EXIT_OK;
	}
	const scope = response.error.code === "tool_error" ? "infra" : "usage";
	io.record({ kind: "error", scope, tool: def.name, message: response.error.message });
	emitPushes(io, response.pushes);
	return EXIT_USAGE;
}

/** sk-0m4.22: each pending WorldEvent is its own JSONL line (`kind: "push"`),
 * never folded into the carrying `tool_result`. A missing / empty piggyback
 * is silence — the common case. */
function emitPushes(io: RecordIo, pushes: readonly unknown[] | undefined): void {
	if (pushes === undefined) return;
	for (const event of pushes) {
		if (!isWorldEvent(event)) continue;
		io.record({
			kind: "push",
			event,
			text: renderWorldEventLine(event),
		});
	}
}

/** sk-0m4.74: each same-tick, caused-by-me `WorldEvent` the act tool already
 * took (`consequences`, additive to the carrying `tool_result.details`) is
 * its OWN JSONL line (`kind: "consequence"`) — distinct from a `push`
 * (later reaction/world news) even though both render through the SAME
 * `renderWorldEventLine`. A missing/absent `consequences` field (no host
 * builder was injected, or nothing matched) is silence, same discipline as
 * `emitPushes`. */
function emitConsequences(io: RecordIo, details: unknown): void {
	for (const event of consequenceEvents(details)) {
		io.record({
			kind: "consequence",
			event,
			text: renderWorldEventLine(event),
		});
	}
}

function consequenceEvents(details: unknown): WorldEvent[] {
	if (typeof details !== "object" || details === null) return [];
	const raw = (details as { consequences?: unknown }).consequences;
	if (!Array.isArray(raw)) return [];
	return raw.filter(isWorldEvent);
}

function isWorldEvent(value: unknown): value is WorldEvent {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { kind?: unknown }).kind === "string"
	);
}

// --- `sk session`: manage the daemons `runPlayerTool` above attaches to.
// Minimal surface for this slice — `list` and `stop`, no `attach`, no named
// aliases (a binding IS the identity; naming is future sugar per #1990's own
// design note). Both emit `kind: "session"` JSONL lines (ADR-0002 spirit),
// never a registry tool name — nothing here is a tool. ---

function socketHash(fileName: string): string {
	return fileName.slice("session-".length, -".sock".length);
}

function listSocketFiles(): string[] {
	try {
		return readdirSync(runtimeDir())
			.filter((name) => name.endsWith(".sock"))
			.sort();
	} catch {
		return [];
	}
}

/** Connect-probe every socket in the run dir, reporting a `status` frame for each live one. Never throws on a dead socket — that IS a reportable state, not a failure. */
async function sessionList(io: RecordIo): Promise<number> {
	const socketFiles = listSocketFiles();
	if (socketFiles.length === 0) {
		const starter = playerFacingToolDefinitions
			.flatMap((definition) => definition.cli?.examples ?? [])
			.at(0);
		io.hint(
			[
				"No player sessions are running.",
				"A session starts automatically with the first connected player command.",
				...(starter === undefined
					? ["Next: run sk list to browse PLAYER commands."]
					: [`Next: ${starter.command} — ${starter.description}`]),
			].join("\n"),
		);
		return EXIT_OK;
	}
	for (const name of socketFiles) {
		const path = join(runtimeDir(), name);
		const hash = socketHash(name);
		if (!(await probeSocket(path))) {
			io.record({ kind: "session", status: "stale", hash, socket: path });
			continue;
		}
		try {
			const response = await sendSessionRequest(path, { id: 1, op: "status" });
			if (isOkResponse(response)) {
				io.record({
					kind: "session",
					status: "live",
					hash,
					socket: path,
					...(response.result as Record<string, unknown>),
				});
			} else {
				io.record({
					kind: "session",
					status: "error",
					hash,
					socket: path,
					error: response.error,
				});
			}
		} catch (err) {
			io.record({
				kind: "session",
				status: "error",
				hash,
				socket: path,
				message: err instanceof Error ? err.message : String(err),
			});
		}
	}
	io.hint("Next: run sk session stop <hash> to stop one listed session.");
	return EXIT_OK;
}

/**
 * `sk session stop [--all | <hash-or-socket-path>]`. With no selector, stops
 * the ONE daemon the current global options (`--url`/`--db` via env,
 * `--actor`) would themselves attach to — the same binding a PLAYER tool
 * invocation resolves, so `sk --actor hero-1 session stop` stops exactly the
 * daemon `sk --actor hero-1 scene` would have used. A selector is the `hash`
 * `sk session list` reports (or a raw socket path) — how `sk session list`'s
 * own output becomes an argument here.
 */
async function sessionStop(io: RecordIo, options: GlobalOptions, args: string[]): Promise<number> {
	if (args.includes("--all")) {
		for (const name of listSocketFiles()) {
			await stopOneSession(io, join(runtimeDir(), name));
		}
		io.hint("Next: run sk session list to confirm no player sessions remain.");
		return EXIT_OK;
	}
	const selector = args[0];
	const path =
		selector === undefined
			? deriveSessionSocketPath(resolveBinding(options, "sk session stop").binding)
			: selector.includes("/")
				? selector
				: join(runtimeDir(), `session-${selector}.sock`);
	const result = await stopOneSession(io, path);
	io.hint("Next: run sk session list to review the remaining player sessions.");
	return result;
}

/** A socket with nobody listening is nothing to stop, not a failure — mirrors `ensureDaemon`'s own stale-socket tolerance (`@spellkave/session/node`'s `spawn.ts`). */
async function stopOneSession(io: RecordIo, path: string): Promise<number> {
	try {
		const response = await sendSessionRequest(path, { id: 1, op: "shutdown" });
		const stopped = isOkResponse(response);
		io.record({ kind: "session", status: stopped ? "stopped" : "error", socket: path });
		return stopped ? EXIT_OK : EXIT_USAGE;
	} catch {
		io.record({ kind: "session", status: "stale", socket: path });
		return EXIT_OK;
	}
}

async function runSessionCommand(
	io: RecordIo,
	options: GlobalOptions,
	argv: string[],
): Promise<number> {
	const sub = argv[0];
	if (sub === "list") return await sessionList(io);
	if (sub === "stop") return await sessionStop(io, options, argv.slice(1));
	throw new UsageError(
		`sk session: unknown subcommand ${JSON.stringify(sub ?? "")} — expected \`list\` or \`stop\`.`,
	);
}

/** `sk events --drain`: attach to THIS invocation's binding and drain the
 * daemon's pending WorldEvents without running a PLAYER tool. Piggyback on
 * invoke already covers the common case; this is the explicit on-demand
 * drain for a host that wants to poll between acts (sk-0m4.22 bonus). */
async function runEventsCommand(
	io: RecordIo,
	options: GlobalOptions,
	argv: string[],
	ensureDaemonFn: EnsureDaemon,
): Promise<number> {
	if (argv[0] !== "--drain" || argv.length !== 1) {
		throw new UsageError("sk events: expected `--drain` (no other arguments).");
	}
	const { binding, token, profile } = resolveBinding(options, "sk events --drain");
	if (profile !== undefined && profile.source === "last_used") {
		io.err(`sk: using profile '${profile.name}' (last used)`);
	}
	const client = await attachSessionDaemon(binding, {
		ensureDaemonFn,
		...(token === undefined ? {} : { token }),
		command: sessionDaemonCommand(),
	});
	if (profile !== undefined && profile.source === "flag") {
		rememberProfile(profile.name);
	}
	const response = await client.drainPushes();
	if (!isOkResponse(response)) {
		io.record({
			kind: "error",
			scope: response.error.code === "tool_error" ? "infra" : "usage",
			message: response.error.message,
		});
		return EXIT_USAGE;
	}
	emitPushes(io, response.pushes);
	return EXIT_OK;
}

const CONFIG_COMMON_CHANGES = `Common changes:
  Use another bundle once:
    sk --target ./adventure/manifest.toml inspect

  Make that bundle the project default:
    sk config set --project author.target ./adventure/manifest.toml
    sk config set --project author.default-bundle kavemouth

  Override a dependency (this checkout's .spellkave/defaults.toml maps srd and dm):
    sk config set --project author.dependencies.srd ./rules/manifest.toml

  Choose a global output default:
    sk config set --global output.format human

  Find the files:
    sk config path`;

/** The current context, or undefined when unset or unreadable (config display only). */
function safeCurrentContext(): string | undefined {
	try {
		return readCurrentContext(resolveCliPaths());
	} catch {
		return undefined;
	}
}

/**
 * `sk config view`: the connection the author path would use now and where it
 * comes from, without connecting and without failing when nothing resolves.
 * Tokens are never printed.
 */
function authorConnectionView(profileName: string | undefined): Record<string, unknown> {
	const context = safeCurrentContext();
	try {
		const r = resolveLiveConnection(profileName);
		return {
			kind: "config_view",
			url: r.url,
			db: r.db,
			source: r.source,
			profile: r.profile ?? null,
			context: context ?? null,
			credential: r.token === undefined ? "none" : "resolved",
			...(r.overriddenContext === undefined
				? {}
				: {
						overridden_context: r.overriddenContext,
						reason: "the environment (SPELLKAVE_URL/SPELLKAVE_DB) wins over the current context",
					}),
			...(r.danglingContext === undefined ? {} : { dangling_context: r.danglingContext }),
		};
	} catch (err) {
		return {
			kind: "config_view",
			url: null,
			db: null,
			source: null,
			context: context ?? null,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/** A leftover arg after `config <verb>` is almost always a global option placed too late. */
function configTakesNoArguments(verb: string): UsageError {
	return new UsageError(
		`sk config ${verb}: takes no arguments (global options such as --format must precede 'config').`,
	);
}

async function runConfigCommand(
	io: RecordIo,
	options: GlobalOptions,
	argv: string[],
): Promise<number> {
	const subcommand = argv[0];
	if (subcommand === undefined || subcommand === "show") {
		if (argv.length > 1) {
			throw configTakesNoArguments("show");
		}
		const currentContext = safeCurrentContext();
		io.record({
			kind: "config",
			values: configRows(options.config),
			current_context: currentContext ?? null,
		});
		io.hint(
			`World connection: context ${currentContext === undefined ? "none" : `'${currentContext}'`} (details: sk config view)`,
		);
		io.hint(CONFIG_COMMON_CHANGES);
		return EXIT_OK;
	}
	if (subcommand === "get-contexts") {
		if (argv.length !== 1) throw configTakesNoArguments("get-contexts");
		const paths = resolveCliPaths();
		const current = safeCurrentContext();
		const contexts = listProfileNames(paths).map((name) => {
			try {
				const profile = loadProfileFromDisk(checkedProfileFile(paths, name));
				return {
					name,
					current: name === current,
					url: profile.connection.url,
					db: profile.connection.db,
				};
			} catch (err) {
				return {
					name,
					current: name === current,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		});
		io.record({ kind: "config_contexts", current: current ?? null, contexts });
		if (contexts.length === 0) {
			io.hint("No profiles yet. `sk dev up` writes one for this worktree's local node.");
		}
		return EXIT_OK;
	}
	if (subcommand === "use-context") {
		const name = argv[1];
		if (name === undefined || argv.length !== 2) {
			throw new UsageError("sk config use-context: expected exactly <name>.");
		}
		const paths = resolveCliPaths();
		const available = listProfileNames(paths);
		if (!available.includes(name)) {
			throw new UsageError(
				`sk config use-context: no profile named '${name}'. Available: ${
					available.length === 0 ? "(none; `sk dev up` writes a local one)" : available.join(", ")
				}.`,
			);
		}
		let path: string;
		try {
			path = writeCurrentContext(paths, name);
		} catch (err) {
			throw new UsageError(
				`sk config use-context: ${err instanceof Error ? err.message : String(err)}`,
			);
		}
		io.record({ kind: "config_context_change", context: name, path });
		io.hint("Next: run sk config view to see the connection the author path now uses.");
		return EXIT_OK;
	}
	if (subcommand === "current-context") {
		if (argv.length !== 1) throw configTakesNoArguments("current-context");
		const current = safeCurrentContext();
		io.record({ kind: "config_current_context", context: current ?? null });
		if (current === undefined)
			io.hint("No context set. Select one with sk config use-context <name>.");
		return EXIT_OK;
	}
	if (subcommand === "view") {
		if (argv.length !== 1) throw configTakesNoArguments("view");
		io.record(authorConnectionView(options.profileName));
		return EXIT_OK;
	}
	if (subcommand === "path") {
		if (argv.length !== 1) {
			throw configTakesNoArguments("path");
		}
		io.record({
			kind: "config_paths",
			paths: [
				{
					scope: "project",
					path: options.config.paths.project,
					exists: existsSync(options.config.paths.project),
				},
				{
					scope: "global",
					path: options.config.paths.global,
					exists: existsSync(options.config.paths.global),
				},
				{
					scope: "defaults",
					path: options.config.paths.defaults,
					exists: existsSync(options.config.paths.defaults),
				},
			],
		});
		io.hint("Next: run sk config set --project <key> <value> for repository defaults.");
		return EXIT_OK;
	}
	if (subcommand === "set") {
		const scopeFlag = argv[1];
		if (scopeFlag !== "--project" && scopeFlag !== "--global") {
			throw new UsageError(
				"sk config set: choose --project or --global, then provide <key> <value>.",
			);
		}
		const key = argv[2];
		const value = argv[3];
		if (key === undefined || value === undefined || argv.length !== 4) {
			throw new UsageError(`sk config set ${scopeFlag}: expected exactly <key> <value>.`);
		}
		const scope = scopeFlag.slice(2) as "project" | "global";
		const path = setConfigValue(scope, key, value, options.config.paths);
		io.record({ kind: "config_change", scope, key, value, path });
		io.hint("Next: run sk config show to verify the effective value and source.");
		return EXIT_OK;
	}
	if (subcommand === "unset") {
		const scopeFlag = argv[1];
		if (scopeFlag !== "--project" && scopeFlag !== "--global") {
			throw new UsageError("sk config unset: choose --project or --global, then provide <key>.");
		}
		const key = argv[2];
		if (key === undefined || argv.length !== 3) {
			throw new UsageError(`sk config unset ${scopeFlag}: expected exactly <key>.`);
		}
		const scope = scopeFlag.slice(2) as "project" | "global";
		const { path, removed } = unsetConfigValue(scope, key, options.config.paths);
		io.record({ kind: "config_change", scope, key, value: null, removed, path });
		io.hint("Next: run sk config show to verify the effective value and source.");
		return EXIT_OK;
	}
	throw new UsageError(
		`sk config: unknown subcommand ${JSON.stringify(subcommand ?? "")} — expected show, path, set, unset, get-contexts, use-context, current-context, or view.`,
	);
}

const USAGE = `sk — registry-driven Spellkave CLI over canonical tool surfaces.

Usage:
  sk [global options] <tool> [--flag value ...]
  sk [global options] <tool> --json '{"param": "value"}'
  sk <file command> <manifest.toml> [...]
  sk explain <role|binding|capability|extent-kind|place|verb|persona> <id> [--target files|live] [--human]
  sk explore <search|detail|neighbors|references|field> ...   find and inspect world rows
  sk session list                session-daemon inventory
  sk session stop [--all | <hash-or-socket>]   stop one or every session daemon
  sk events --drain              drain pending world-push events for this binding
  sk config                     effective defaults, sources, and common changes
  sk config path                project and global config locations
  sk config set --project <key> <value>
  sk config get-contexts        profiles to author against; use-context <name> selects one
  sk config view                the world --live / diff / apply would use, and why
  sk list                       tool registry
  sk help [<tool|command>]      this text, or one tool's schema-derived flags

Global options (must precede the tool name):
  --format <mode>         auto (TTY human, pipes JSONL), human, jsonl, or toon  [default: auto]
                          \`sk explore\` and \`sk spire\` prefer toon when the mode is auto
  --workspace <dir>       scratch bundle dir      [$SPELLKAVE_AUTHOR_WORKSPACE, default ${SK_SCRATCH_DIR}]
  --target <dir>          local bundle to resolve refs against and flush into
                                                  [$SPELLKAVE_AUTHOR_LOCAL_TARGET]
  --no-target             ignore a configured local target for this invocation
  --fixtures-root <dir>   sibling-bundle root for depends_on  [default: parent of --target]
  --default-bundle <id>   bundle_id write verbs fall back to  [$SPELLKAVE_AUTHOR_BUNDLE]
  --no-default-bundle     require write commands to name their bundle explicitly
  --live                  flush against a running node instead of --target; world from
                                                  --profile > $SPELLKAVE_URL > current context
                                                  (mutually exclusive with --target). Every live
                                                  apply_manifest_delta is journaled under
                                                  .local/live-deltas/ (NNN-<utc>.toml + journal.jsonl;
                                                  off: SPELLKAVE_LIVE_DELTA_JOURNAL=0,
                                                  elsewhere: SPELLKAVE_LIVE_DELTA_JOURNAL_DIR)
  --actor <id>            connected identity for PLAYER tools  [$SPELLKAVE_ACTOR]
  --profile <name>        persona profile for PLAYER connections (url/db/actor/token) —
                                                  precedence: --actor > --profile > env chain;
                                                  a bare invocation falls back to the remembered
                                                  last_used_profile (announced on stderr)

Configuration precedence:
  flags > environment > project .spellkave/config.toml (optional) > XDG config.toml > built-in defaults
  Run \`sk help config\` for writable keys and examples.

PLAYER tools (the perceive/act registry subset — see @spellkave/session/player-tools's
playerFacingToolDefinitions; \`sk help <tool>\` renders one's flags) always dispatch through a
per-binding session daemon: need url/db/actor/token resolvable via --actor/--profile/the plain
env chain ($SPELLKAVE_URL/$SPELLKAVE_DB/$SPELLKAVE_ACTOR) or a remembered last-used profile;
\`sk session list\`/\`stop\` manage the daemon(s) that spawns; pending world-push events (hits, XP, turn transitions) piggyback on every PLAYER invoke as extra JSONL lines, or drain on demand with \`sk events --drain\`.

Output defaults to human Markdown on a TTY and canonical JSONL otherwise.
Exit: 0 ok, 1 usage/infra, 2 in-world rejection.
`;

const QUICK_START = `sk — author and explore Spellkave worlds from the shell.

Start here:
  sk docs onramp               start here: AUTHOR + PLAYER tools (TOML underneath)
  sk config                    see active defaults and common changes
  sk docs                       browse guidance by topic
  sk inspect                   understand the configured bundle
  sk validate                  check it before applying changes
  sk list                       browse every registry tool
  sk help <command>             see one command's purpose and flags

Output:
  sk --format human <command>   readable terminal output
  sk --format jsonl <command>   stable output for agents and scripts
  sk --format toon <command>    compact text for agents (the default of \`sk explore\`)
  default: human on a TTY, JSONL when piped or redirected (\`sk explore\`: TOON)

Run \`sk help\` for the full reference.`;

async function quickStartContext(options: GlobalOptions): Promise<string[]> {
	const liveSessions: SessionBinding[] = [];
	let staleSessions = 0;
	for (const name of listSocketFiles()) {
		const path = join(runtimeDir(), name);
		if (!(await probeSocket(path))) {
			staleSessions += 1;
			continue;
		}
		try {
			const response = await sendSessionRequest(path, { id: 1, op: "status" });
			if (!isOkResponse(response)) continue;
			const binding = (response.result as { binding?: unknown }).binding;
			if (
				typeof binding === "object" &&
				binding !== null &&
				typeof (binding as SessionBinding).actorId === "string" &&
				typeof (binding as SessionBinding).db === "string" &&
				typeof (binding as SessionBinding).url === "string"
			) {
				liveSessions.push(binding as SessionBinding);
			}
		} catch {
			// The full `sk session list` command reports per-socket errors. The
			// quick start stays an orientation surface and never fails because a
			// background daemon disappeared while it was being inspected.
		}
	}

	const lines = [
		"Current context:",
		`  Author workspace: ${options.config.workspace.display} (${options.config.workspace.source})`,
		`  Local target: ${
			options.config.target.value === undefined
				? "none (scratch workspace only)"
				: options.config.target.display
		} (${options.config.target.source})`,
		`  Default bundle for writes: ${options.config.defaultBundle.display} (${options.config.defaultBundle.source})`,
		`  Output format: ${options.config.format.display} (${options.config.format.source})`,
	];
	if (liveSessions.length === 0) {
		lines.push("  Player sessions: none");
	} else {
		lines.push(`  Player sessions: ${liveSessions.length} connected`);
		for (const binding of liveSessions) {
			lines.push(`    ${binding.actorId} @ ${binding.db} (${binding.url})`);
		}
	}
	if (staleSessions > 0) {
		lines.push(`  Stale session sockets: ${staleSessions} (run sk session list)`);
	}
	return lines;
}

/** Test seams for plugin loading and the host every plugin verb receives. */
export interface CliExtras {
	plugins?: PluginSource;
	host?: HostDeps;
}

export async function runCli(
	argv: string[],
	io: CliIo = processIo,
	connectLive: ConnectLive = defaultConnectLive,
	ensureDaemonFn: EnsureDaemon = defaultEnsureDaemon,
	extras: CliExtras = {},
): Promise<number> {
	// Scoped to this ONE call (`withConsoleLogOnStderr`'s own header comment)
	// — covers every dispatch path uniformly (AUTHOR offline/--live, PLAYER,
	// `sk session`) with one guard, rather than patching each connect-capable
	// call site individually.
	return withConsoleLogOnStderr(() =>
		runCliDispatch(argv, io, connectLive, ensureDaemonFn, extras),
	);
}

/**
 * `sk diff -k` / `sk apply -k`: run the applyset tool against the author
 * path's world (they always connect, like `--live`), then render the row
 * diffs and pick the exit code (`sk diff`: 3 on differences).
 */
function instanceReadExit(code: string | undefined): number {
	if (code === "usage") return EXIT_USAGE;
	if (
		code === "not_publisher" ||
		code === "unknown_key" ||
		code === "ambiguous_bundle" ||
		code === "reader_unavailable" ||
		code === "not_found_in_scope"
	) {
		return EXIT_IN_WORLD;
	}
	return EXIT_OK;
}

function parseInstanceReadArgs(
	verb: "get" | "describe",
	argv: string[],
): OwnerGetInput | OwnerDescribeInput {
	const flags =
		verb === "describe"
			? new Set(["--bundle", "--limit"])
			: new Set(["--bundle", "--pattern", "--fields", "--limit"]);
	const positionals: string[] = [];
	let bundle: string | undefined;
	let pattern: string | undefined;
	let fields: string[] | undefined;
	let limit: number | undefined;
	for (let i = 0; i < argv.length; i += 1) {
		const token = argv[i] as string;
		if (flags.has(token)) {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith("--")) {
				throw new UsageError(`sk ${verb}: ${token} needs a value`);
			}
			i += 1;
			if (token === "--bundle") bundle = value;
			else if (token === "--pattern") pattern = value;
			else if (token === "--fields") {
				fields = value
					.split(",")
					.map((part) => part.trim())
					.filter(Boolean);
			} else if (token === "--limit") {
				const parsed = Number(value);
				if (!Number.isInteger(parsed) || parsed < 0) {
					throw new UsageError(`sk ${verb}: --limit must be a non-negative integer`);
				}
				limit = parsed;
			}
		} else if (token.startsWith("--")) {
			throw new UsageError(`sk ${verb}: unknown flag ${token}`);
		} else {
			positionals.push(token);
		}
	}
	if (positionals.length > 2) {
		throw new UsageError(`sk ${verb}: unexpected argument ${positionals[2]}`);
	}
	const kind = positionals[0];
	if (kind === undefined || kind === "") {
		throw new UsageError(
			verb === "get"
				? "usage: sk get <kind> [<key>] [--bundle <id>] [--pattern <text>] [--fields a,b] [--limit n]"
				: "usage: sk describe entities <key> [--bundle <id>] [--limit n]",
		);
	}
	if (verb === "describe") {
		if (positionals[1] === undefined || positionals[1] === "") {
			throw new UsageError("usage: sk describe entities <key> [--bundle <id>] [--limit n]");
		}
		return {
			kind,
			key: positionals[1],
			...(bundle === undefined ? {} : { bundle }),
			...(limit === undefined ? {} : { limit }),
		};
	}
	return {
		kind,
		...(positionals[1] === undefined ? {} : { key: positionals[1] }),
		...(bundle === undefined ? {} : { bundle }),
		...(pattern === undefined ? {} : { pattern }),
		...(fields === undefined ? {} : { fields }),
		...(limit === undefined ? {} : { limit }),
	};
}

async function runInstanceRead(
	io: RecordIo,
	options: GlobalOptions,
	verb: "get" | "describe",
	argv: string[],
	connectLive: ConnectLive,
): Promise<number> {
	const input = parseInstanceReadArgs(verb, argv);
	const resolvedLive = resolveLiveConnection(options.profileName);
	announceAuthorConnection(io, resolvedLive, verb);
	let live: LiveConnection;
	try {
		live = await connectLive({
			url: resolvedLive.url,
			db: resolvedLive.db,
			...(resolvedLive.token === undefined ? {} : { token: resolvedLive.token }),
		});
	} catch (error) {
		throw new Error(
			`no reachable world. Start one with sk dev up or select one with sk config use-context. ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
	try {
		const port = live.readInstance;
		const answer =
			port === undefined
				? {
						ok: false as const,
						code: "not_publisher" as const,
						message: "reads_as_publisher is false",
					}
				: verb === "get"
					? await port.get(input as OwnerGetInput)
					: await port.describe(input as OwnerDescribeInput);
		const publisher = {
			reads_as_publisher: live.readsAsPublisher,
			connected_identity: live.connectedIdentity,
		};
		const instanceKind = "kind" in answer ? answer.kind : undefined;
		const rest = { ...answer } as Record<string, unknown>;
		delete rest.kind;
		io.record({
			...rest,
			kind: `${verb}_result`,
			...(instanceKind === undefined ? {} : { instance_kind: instanceKind }),
			...publisher,
		});
		if (answer.ok === false) {
			return instanceReadExit(answer.code);
		}
		return EXIT_OK;
	} finally {
		await live.close();
	}
}

/**
 * `sk explore <verb>`: build the shared explore request from flags and run it through the
 * `spellkave_query` tool, exactly as `sk query --json '{"explore":...}'` does. Only the output
 * differs: `next`/`recovery` come back as complete `sk explore ...` command lines.
 */
async function runExplore(
	io: RecordIo,
	options: GlobalOptions,
	args: string[],
	globals: readonly string[],
	connectLive: ConnectLive,
): Promise<number> {
	const name = args[0];
	if (name === undefined || name === "help" || name === "--help" || name === "-h") {
		return emitExploreHelp(io);
	}
	const verb = exploreVerb(name);
	if (args.slice(1).some((arg) => arg === "--help" || arg === "-h"))
		return emitExploreHelp(io, verb.name);
	const request = parseExploreArgs(verb, args.slice(1));
	requireSourceId(request);
	// No --source: read the current target like `sk get` resolves it. Files when one is set,
	// the connected world otherwise (the contract's own default).
	const defaultSource = options.targetDir !== undefined && !options.live ? "local" : "live";
	if (request.source === undefined) request.source = defaultSource;
	return await runTool(
		io,
		request.source === "live" ? { ...options, live: true } : options,
		QUERY_TOOL,
		["--json", JSON.stringify({ explore: request })],
		connectLive,
		false,
		"explore_result",
		undefined,
		(record, format, liveTarget) =>
			projectExploreRecord(record, globals, format, defaultSource, request, liveTarget),
	);
}

function emitExploreHelp(io: RecordIo, verbName?: string): number {
	const verbs = verbName === undefined ? EXPLORE_VERBS : [exploreVerb(verbName)];
	io.err("sk explore — find and inspect rows of one world source (read-only)");
	io.err("");
	io.err("Usage:");
	for (const verb of verbs) io.err(`  ${verb.usage}`);
	io.err("");
	if (verbName === undefined) {
		for (const verb of verbs) io.err(`  ${verb.name.padEnd(10)} ${verb.summary}`);
		io.err("");
		io.err("Run `sk explore <verb> --help` for one verb's flags.");
		io.err("Seat discovery: sk docs playable-seats (authored offers and live seat state differ).");
	} else {
		const verb = verbs[0] as (typeof EXPLORE_VERBS)[number];
		renderFlags(io, verb.parameters, verb.positionals);
	}
	io.err("");
	io.err("Source: --source local|workspace|live. Default: local when --target is set, else live.");
	io.err("Globals (--target, --fixtures-root, --workspace, --profile) go BEFORE `explore`.");
	io.err(
		"Every answer prints complete `sk explore ...` commands under `next`; run them as printed.",
	);
	io.err("The same call as JSON: sk query --json '{\"explore\":{...}}'.");
	return EXIT_OK;
}

/**
 * Without an explicit `--dep`, give `sk diff -k` / `sk apply -k` the root's
 * dependency closure from the configured `author.dependencies`, as the
 * `--target` verbs and `sk explore` resolve it (sk-jay0.3.26.28). A closure
 * the map cannot resolve leaves the argv unchanged, so the tool reports the
 * missing dependency itself.
 */
export function withConfiguredDependencies(
	verb: ApplysetVerb,
	dependencies: Record<string, string>,
): ApplysetVerb {
	if (verb.argv.includes("--dep") || Object.keys(dependencies).length === 0) return verb;
	const dir = verb.argv[verb.argv.indexOf("--dir") + 1];
	if (dir === undefined) return verb;
	const rootManifestPath = dir.endsWith(".toml") ? dir : join(dir, "manifest.toml");
	try {
		const { sources } = loadBundleChainDetailed({
			rootManifestPath,
			resolveDependency: (bundleId) => dependencies[bundleId],
		});
		const closure = sources.slice(0, -1).map((source) => source.manifestPath);
		return { ...verb, argv: [...verb.argv, ...closure.flatMap((path) => ["--dep", path])] };
	} catch {
		return verb;
	}
}

async function runApplysetVerb(
	io: RecordIo,
	options: GlobalOptions,
	requested: ApplysetVerb,
	connectLive: ConnectLive,
): Promise<number> {
	const verb = withConfiguredDependencies(requested, configuredDependencies(options, io));
	let details: unknown;
	const code = await runTool(
		io,
		{ ...options, live: true },
		verb.tool,
		verb.argv,
		connectLive,
		false,
		`${verb.verb}_result`,
		(captured) => {
			details = captured;
		},
	);
	if (code !== EXIT_OK && code !== EXIT_IN_WORLD) return code;
	return finishApplysetVerb(io, verb, details, code);
}

/**
 * A command's own default format. It applies only while the format is `auto`
 * (flag, environment and config all left it unset), on a TTY and a pipe alike;
 * `--format jsonl|human|toon` always wins. Every command not listed keeps the
 * global default.
 */
export const PREFERRED_FORMAT: Readonly<Record<string, OutputFormat>> = {
	explore: "toon",
	spire: "toon",
};

async function runCliDispatch(
	argv: string[],
	io: CliIo,
	connectLive: ConnectLive,
	ensureDaemonFn: EnsureDaemon,
	extras: CliExtras,
): Promise<number> {
	let output = createRecordIo(io, "auto");
	try {
		const { options, rest: parsedRest } = parseGlobals(argv);
		// Help is read-only even when written after a verb's positional arguments/flags.
		const helpFlag = parsedRest.findIndex((token) => token === "--help" || token === "-h");
		const rest =
			helpFlag < 0 || parsedRest[0] === "help"
				? parsedRest
				: ["help", ...parsedRest.slice(0, helpFlag)];
		output = createRecordIo(io, options.format, PREFERRED_FORMAT[rest[0] ?? ""]);
		const plugins = extras.plugins ?? defaultPluginSource();
		checkRootCollisions(plugins.entries, rootReservations());
		const pluginEntry = (name: string | undefined): PluginEntry | undefined =>
			plugins.entries.find((entry) => entry.group === name);
		const command = rest[0];
		if (command === undefined) {
			for (const line of await quickStartContext(options)) io.err(line);
			io.err("");
			io.err(QUICK_START);
			return EXIT_OK;
		}
		if (command === "list" || command === "tools") {
			return emitList(output, options, await loadAllPlugins(plugins));
		}
		if (command === "help") {
			// Explicit help is plain, agent-consumed stdout in every output mode.
			const helpOutput = { ...output, err: (line: string) => io.out(line) };
			const helpEntry = pluginEntry(rest[1]);
			if (helpEntry !== undefined) {
				return emitPluginHelp(helpOutput, await loadPlugin(plugins, helpEntry), rest.slice(1));
			}
			if (rest[1] === "explore" && rest[2] !== undefined)
				return emitExploreHelp(helpOutput, exploreVerb(rest[2]).name);
			const loaded = rest[1] === undefined ? await loadAllPlugins(plugins) : [];
			return emitHelp(helpOutput, options, rest[1], loaded, rest[2]);
		}
		if (command === "plugin") return await runPluginCommand(output, plugins, rest.slice(1));
		if (command === "tool") {
			const toolName = rest[1];
			if (toolName === undefined) throw new UsageError("usage: sk tool <registry-name> [flags]");
			if (definitionFor(toolName) !== undefined) {
				return await runTool(
					output,
					connectsOnItsOwn(toolName) ? { ...options, live: true } : options,
					toolName,
					rest.slice(2),
					connectLive,
				);
			}
			const explicitPlayerDef = playerDefinitionFor(toolName);
			if (explicitPlayerDef !== undefined) {
				return await runPlayerTool(
					output,
					options,
					explicitPlayerDef,
					rest.slice(2),
					ensureDaemonFn,
				);
			}
			return unknownTool(output, toolName);
		}
		if (command === "grant" || command === "revoke" || command === "grants") {
			if (command === "grants" && rest[1] === "restore") {
				const path = rest[2];
				if (!path)
					throw new UsageError(
						"usage: sk grants restore <artifact.json> [--rebase-expiry] [--apply]",
					);
				const live = await connectLive(resolveLiveConnection(options.profileName));
				try {
					const context = buildContext(
						options,
						output,
						live.target,
						undefined,
						undefined,
						undefined,
						undefined,
						undefined,
						live.grants,
					);
					const artifact = JSON.parse(readFileSync(resolve(path), "utf8")) as GrantArtifact;
					const prepared = await previewRestore(
						context,
						artifact,
						rest.includes("--rebase-expiry"),
					);
					const answer = rest.includes("--apply")
						? await restoreGrants(context, prepared)
						: { ok: true, preview: prepared };
					output.record({ kind: "grants_restore", ...answer });
					return answer.ok === false ? 2 : 0;
				} finally {
					await live.close();
				}
			}
			const name = registryCommand(command, rest[1]);
			return await runTool(
				output,
				{ ...options, live: command !== "grant" || options.live },
				name,
				command === "grants" ? rest.slice(rest[1] === undefined ? 1 : 2) : rest.slice(1),
				connectLive,
			);
		}
		const groupEntry = pluginEntry(command);
		if (groupEntry !== undefined) {
			const plugin = await loadPlugin(plugins, groupEntry);
			return await runPluginVerb(output, options, plugin, rest, extras.host ?? createNodeHost());
		}
		if (command === "diff" || command === "apply") {
			// `sk diff -k` / `sk apply -k` (ADR-0144 D-2); plain `sk diff a b`
			// stays the two-file registry tool below.
			const verb = applysetVerbArgs(command, rest.slice(1));
			if (verb !== undefined) return await runApplysetVerb(output, options, verb, connectLive);
		}
		if (command === "config") return await runConfigCommand(output, options, rest.slice(1));
		if (command === "session") return await runSessionCommand(output, options, rest.slice(1));
		if (command === "events") {
			return await runEventsCommand(output, options, rest.slice(1), ensureDaemonFn);
		}
		if (command === "explain") {
			const explainArgs = rest.slice(1).filter((arg) => arg !== "--human");
			const useLive = explainArgs.some(
				(arg, i) =>
					arg === "--target=live" || (arg === "--target" && explainArgs[i + 1] === "live"),
			);
			let details: unknown;
			const code = await runTool(
				output,
				{ ...options, live: useLive },
				"explain",
				rest.includes("--human") ? [...explainArgs, "--format", "human"] : explainArgs,
				connectLive,
				false,
				"explain_result",
				(answer) => {
					details = answer;
				},
			);
			return typeof details === "object" &&
				details !== null &&
				(details as { ok?: boolean }).ok === false
				? 2
				: code;
		}
		if (command === "explore") {
			// Global tokens the user passed travel into every printed command line.
			const globals = argv.slice(0, argv.length - rest.length);
			return await runExplore(output, options, rest.slice(1), globals, connectLive);
		}
		if (command === "get") {
			return await runInstanceRead(output, options, "get", rest.slice(1), connectLive);
		}
		if (command === "describe") {
			return await runInstanceRead(output, options, "describe", rest.slice(1), connectLive);
		}
		const fileCommand = FILE_COMMANDS[command];
		if (fileCommand !== undefined) {
			return await fileCommand.run(output, rest.slice(1), options, connectLive);
		}
		// AUTHOR-vs-PLAYER routing is registry membership, never a name
		// literal: `definitionFor` searches `authorFacingToolDefinitions`,
		// `playerDefinitionFor` searches the disjoint `playerFacingToolDefinitions`
		// — whichever registry actually has the name decides the dispatch path.
		const toolCommand = registryCommand(command);
		if (definitionFor(toolCommand) !== undefined) {
			return await runTool(
				output,
				connectsOnItsOwn(toolCommand) ? { ...options, live: true } : options,
				toolCommand,
				rest.slice(1),
				connectLive,
			);
		}
		const playerDef = playerDefinitionFor(command);
		if (playerDef !== undefined) {
			return await runPlayerTool(output, options, playerDef, rest.slice(1), ensureDaemonFn);
		}
		return unknownTool(output, command);
	} catch (err) {
		if (err instanceof UsageError) {
			output.record({ kind: "error", scope: "usage", message: err.message });
			return EXIT_USAGE;
		}
		// A tool that rejects its own arguments is a usage error, reported with the
		// same "invalid parameters" shape as schema validation, so the caller sees
		// what to change instead of a generic infra failure.
		if (err instanceof ToolArgumentValidationError) {
			output.record({
				kind: "error",
				scope: "usage",
				tool: err.toolName,
				message: `invalid parameters: ${err.issues
					.map((issue) => `${issue.path || "/"} ${issue.message}`)
					.join("; ")}`,
			});
			return EXIT_USAGE;
		}
		// A tool body that throws is an infrastructure failure by the
		// registry's own contract ("throw on failure instead of encoding
		// errors in `content`") — never an in-world rejection.
		output.record({
			kind: "error",
			scope: "infra",
			message: err instanceof Error ? err.message : String(err),
		});
		return EXIT_USAGE;
	}
}
