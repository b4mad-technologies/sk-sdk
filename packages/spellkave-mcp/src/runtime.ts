import { readFileSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { WorldActorCausalContext } from "@spellkave/agent-observability";
import {
	AUTHKIT_JWKS_PATH,
	type ClaimSeat,
	claimSeatAsCaller,
	createWorkosLogoutCutoff,
	type FindClaimedSeat,
	type FindWorldSeat,
	fetchJwks,
	type IsOfferedFreeSeat,
	isOfferedFreeSeatInWorld,
	loadWorldCatalog,
	NO_SEAT_HINT,
	NO_SEAT_TTL_MS,
	type PlayerResourceServerConfig,
	parseSeatClaim,
	probeWorldSeat,
	resolveClaimedSeatRoute,
	resolveWorldRoute,
	SeatClaimProbeError,
	SeatClaimUnavailableError,
	seatSessionKey,
	type WorldCatalog,
	type WorldRoute,
} from "@spellkave/gateway-identity";
import type { SessionBinding } from "@spellkave/session";
import {
	attachSessionDaemon,
	type SessionDaemonStatus,
	SessionDaemonTransportError,
	type SessionNotice,
	type Response as SessionResponse,
} from "@spellkave/session/node";
import type { PlayerSessionClient, PlayerToolResult } from "./daemon-handler.ts";
import { createAttachedPlayerMcpGateway, type PlayerMcpGatewayService } from "./gateway.ts";
import { createPlayerMcpNodeHandler } from "./http.ts";
import {
	currentRemoteMcpAccessToken,
	currentRemoteMcpRequestSubject,
	type RemoteMcpLifecycleEmit,
} from "./observability.ts";
import { createLiveWorldOsmCache, type WorldOsmCache } from "./osm-model.ts";
import { createSeatProbes } from "./seat-probes.ts";
import { isInvokeTimeout, unknownErrorClass } from "./session-errors.ts";
import {
	createPublicTranscriptRecorder,
	NOOP_PUBLIC_TRANSCRIPT_RECORDER,
	publicWorldSlugs,
} from "./transcript.ts";

export const PLAYER_MCP_DEFAULT_HOST = "127.0.0.1";
export const PLAYER_MCP_DEFAULT_PORT = 8080;
export const PLAYER_MCP_DEFAULT_KEEPALIVE_MS = 60_000;
export const PLAYER_MCP_WORLD_URL = "http://127.0.0.1:3000";
export const PLAYER_MCP_WEBSITE_ORIGIN = "https://spellkave.com";
export const PLAYER_MCP_DEFAULT_API_ORIGIN = "https://api.spellkave.com";
export { NO_SEAT_HINT };

/** Parsed `URL.hostname`s of a loopback canonical origin. IPv6 `[::1]` is not
 * one: the origin allowlist refuses a hostname with a colon. */
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost"]);

export type PlayerMcpTrustBoundary = "loopback" | "network-policy";

export interface PlayerMcpRuntimeConfig {
	trustBoundary: PlayerMcpTrustBoundary;
	listenHost: string;
	listenPort: number;
	resourceConfig: PlayerResourceServerConfig;
	apiOrigin: string;
	worldUrl: string;
	catalogPath: string;
	allowedOriginHostnames: string[];
	trustForwardedHeaders: boolean;
	keepaliveMs: number;
	/** Empty = no public recorder. Quadlet sets SPELLKAVE_MCP_PUBLIC_TRANSCRIPT_DIR. */
	publicTranscriptDir: string;
	/**
	 * Optional base URL for the interactive maps app (SPELLKAVE_MAPS_URL).
	 * When set, spellkave_map results gain one deep-link text line. Unset = local
	 * dev silence. Trailing slash already stripped by the loader.
	 */
	mapsBaseUrl?: string;
}

export interface RunningPlayerMcpRuntime {
	readonly config: PlayerMcpRuntimeConfig;
	readonly gateway: PlayerMcpGatewayService;
	readonly server: Server;
	close(): Promise<void>;
}

type AttachPlayerClient = () => Promise<PlayerSessionClient>;
type AttachBoundSessionClient = (
	binding: SessionBinding,
	token: string,
	worldSlug: string,
) => Promise<PlayerSessionClient>;

/** Module-publisher token for full-world OSM export (ADR-0123). */
function resolveOsmOperatorToken(env: NodeJS.ProcessEnv): string | undefined {
	const explicit =
		env.SPELLKAVE_OSM_OPERATOR_TOKEN?.trim() || env.SPELLKAVE_CONNECT_TOKEN?.trim() || "";
	if (explicit !== "") return explicit;
	const configPath = env.SPACETIME_CONFIG_PATH?.trim();
	if (configPath === undefined || configPath === "") return undefined;
	try {
		const text = readFileSync(configPath, "utf8");
		const match = /spacetimedb_token\s*=\s*"([^"]+)"/.exec(text);
		const token = match?.[1]?.trim() ?? "";
		return token === "" ? undefined : token;
	} catch {
		return undefined;
	}
}

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name]?.trim();
	if (value === undefined || value === "") throw new Error(`${name} is required`);
	if (/\r|\n|\0/.test(value)) throw new Error(`${name} contains forbidden control characters`);
	return value;
}

function positiveIntegerEnv(
	env: NodeJS.ProcessEnv,
	name: string,
	fallback: number,
	maximum: number,
): number {
	const raw = env[name]?.trim();
	if (raw === undefined || raw === "") return fallback;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
		throw new Error(`${name} must be an integer between 1 and ${maximum}`);
	}
	return value;
}

function fixedValue(name: string, value: string, expected: string): string {
	if (value !== expected) throw new Error(`${name} must remain ${expected}`);
	return value;
}

function resolveTrustBoundary(env: NodeJS.ProcessEnv): PlayerMcpTrustBoundary {
	const value = env.SPELLKAVE_MCP_TRUST_BOUNDARY?.trim() || "loopback";
	if (value !== "loopback" && value !== "network-policy") {
		throw new Error("SPELLKAVE_MCP_TRUST_BOUNDARY must be loopback or network-policy");
	}
	return value;
}

function networkPolicyWorldUrl(value: string): string {
	try {
		const url = new URL(value);
		if (url.protocol === "http:" || url.protocol === "https:") return value;
	} catch {
		// Fall through to the mode-specific validation error.
	}
	throw new Error("SPELLKAVE_MCP_WORLD_URL must be an absolute http(s) URL in network-policy mode");
}

/** Browser website origins that call login-gated GET /transcripts/* (CORS). */
const WEBSITE_TRANSCRIPT_ORIGINS = ["spellkave.com", "www.spellkave.com", "localhost"] as const;

function commaSeparatedHostnames(value: string | undefined, canonicalHostname: string): string[] {
	const configured = value
		?.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter((entry) => entry !== "");
	const hostnames = configured ?? [canonicalHostname, "claude.ai", ...WEBSITE_TRANSCRIPT_ORIGINS];
	if (!hostnames.includes(canonicalHostname)) hostnames.unshift(canonicalHostname);
	for (const website of WEBSITE_TRANSCRIPT_ORIGINS) {
		if (!hostnames.includes(website)) hostnames.push(website);
	}
	if (
		hostnames.length === 0 ||
		hostnames.some(
			(hostname) =>
				hostname.includes(":") ||
				hostname.includes("/") ||
				hostname.includes("@") ||
				!/^[a-z0-9.-]+$/.test(hostname),
		)
	) {
		throw new Error("SPELLKAVE_MCP_ALLOWED_ORIGIN_HOSTNAMES contains an invalid hostname");
	}
	return [...new Set(hostnames)];
}

function parseApiOrigin(raw: string | undefined): string {
	const origin = raw?.trim() || PLAYER_MCP_DEFAULT_API_ORIGIN;
	const url = new URL(origin);
	const hostname = url.hostname.toLowerCase();
	const loopback = hostname === "127.0.0.1" || hostname === "localhost";
	if (!loopback && (url.protocol !== "https:" || url.port !== "")) {
		throw new Error("SPELLKAVE_API_ORIGIN must use HTTPS port 443");
	}
	if (loopback && url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("loopback SPELLKAVE_API_ORIGIN must be http(s)");
	}
	return origin;
}

export function loadPlayerMcpRuntimeConfig(
	env: NodeJS.ProcessEnv = process.env,
): PlayerMcpRuntimeConfig {
	const trustBoundary = resolveTrustBoundary(env);
	const canonicalOrigin = requiredEnv(env, "SPELLKAVE_MCP_CANONICAL_ORIGIN");
	const canonicalUrl = new URL(canonicalOrigin);
	const canonicalHostname = canonicalUrl.hostname.toLowerCase();
	const loopback = LOOPBACK_HOSTNAMES.has(canonicalHostname);
	if (!loopback && (canonicalUrl.protocol !== "https:" || canonicalUrl.port !== "")) {
		throw new Error("SPELLKAVE_MCP_CANONICAL_ORIGIN must use HTTPS port 443");
	}
	if (loopback && canonicalUrl.protocol !== "http:" && canonicalUrl.protocol !== "https:") {
		throw new Error("loopback SPELLKAVE_MCP_CANONICAL_ORIGIN must be http(s)");
	}
	const listenHost = env.SPELLKAVE_MCP_LISTEN_HOST?.trim() ?? PLAYER_MCP_DEFAULT_HOST;
	if (trustBoundary === "loopback" && listenHost !== PLAYER_MCP_DEFAULT_HOST) {
		throw new Error("SPELLKAVE_MCP_LISTEN_HOST must remain 127.0.0.1");
	}
	if (trustBoundary === "network-policy" && (listenHost === "" || listenHost.includes("://"))) {
		throw new Error(
			"SPELLKAVE_MCP_LISTEN_HOST must be a non-empty host without a scheme in network-policy mode",
		);
	}
	const listenPort = positiveIntegerEnv(
		env,
		"SPELLKAVE_MCP_LISTEN_PORT",
		PLAYER_MCP_DEFAULT_PORT,
		65_535,
	);
	// A deployment (any non-loopback canonical origin) keeps the fixed 8080.
	// A loopback origin is a developer's machine or a behaviour scenario, which
	// runs several gateways side by side on ephemeral ports (sk-jay0.7.229.45).
	if (!loopback && listenPort !== PLAYER_MCP_DEFAULT_PORT) {
		throw new Error(`SPELLKAVE_MCP_LISTEN_PORT must remain ${PLAYER_MCP_DEFAULT_PORT}`);
	}
	const requiredWorldUrl = requiredEnv(env, "SPELLKAVE_MCP_WORLD_URL");
	return {
		trustBoundary,
		listenHost,
		listenPort,
		resourceConfig: {
			canonicalOrigin,
			issuer: requiredEnv(env, "WORKOS_ISSUER"),
			// ADR-0161 D-7 step 4: refuse tokens issued before the person's last
			// sign-out everywhere (WorkOS user metadata `logout_after`, 30 s cache).
			// The pod already holds WORKOS_API_KEY (the `workos` Secret).
			...(env.WORKOS_API_KEY?.trim()
				? {
						logoutCutoff: createWorkosLogoutCutoff({
							workosApiKey: env.WORKOS_API_KEY.trim(),
							...(env.WORKOS_API_BASE_URL?.trim()
								? { baseUrl: env.WORKOS_API_BASE_URL.trim() }
								: {}),
						}),
					}
				: {}),
		},
		apiOrigin: parseApiOrigin(env.SPELLKAVE_API_ORIGIN),
		worldUrl:
			trustBoundary === "loopback"
				? fixedValue("SPELLKAVE_MCP_WORLD_URL", requiredWorldUrl, PLAYER_MCP_WORLD_URL)
				: networkPolicyWorldUrl(requiredWorldUrl),
		catalogPath: requiredEnv(env, "SPELLKAVE_WORLD_CATALOG"),
		allowedOriginHostnames: commaSeparatedHostnames(
			env.SPELLKAVE_MCP_ALLOWED_ORIGIN_HOSTNAMES,
			canonicalHostname,
		),
		trustForwardedHeaders: env.SPELLKAVE_MCP_TRUST_FORWARDED_HEADERS === "true",
		publicTranscriptDir: (env.SPELLKAVE_MCP_PUBLIC_TRANSCRIPT_DIR ?? "").trim(),
		keepaliveMs: positiveIntegerEnv(
			env,
			"SPELLKAVE_MCP_KEEPALIVE_MS",
			PLAYER_MCP_DEFAULT_KEEPALIVE_MS,
			5 * 60_000,
		),
		...((): { mapsBaseUrl?: string } => {
			const raw = env.SPELLKAVE_MAPS_URL?.trim() ?? "";
			if (raw === "") return {};
			return { mapsBaseUrl: raw.replace(/\/+$/, "") };
		})(),
	};
}

export async function readMode600Secret(path: string, name: string): Promise<string> {
	const metadata = await lstat(path);
	if (!metadata.isFile()) throw new Error(`${name} must be a regular file`);
	if ((metadata.mode & 0o777) !== 0o600) throw new Error(`${name} must have mode 0600`);
	const value = (await readFile(path, "utf8")).trim();
	if (value === "") throw new Error(`${name} must not be empty`);
	return value;
}

/** sk-0m4.120.12: identity bits every lifecycle row carries. The subject
 * prefix is stamped by the observer, never here. */
export interface SessionLifecycleContext {
	lifecycle?: RemoteMcpLifecycleEmit;
	worldSlug?: string;
}

/** `true`/`false` from a real daemon attachment (`ensureDaemon`), undefined
 * for clients that carry no attachment (test doubles). */
function attachmentSpawned(client: PlayerSessionClient): boolean | undefined {
	const attachment = (client as { attachment?: { spawned?: unknown } }).attachment;
	return typeof attachment?.spawned === "boolean" ? attachment.spawned : undefined;
}

function transportCause(error: unknown): string {
	if (error instanceof SessionDaemonTransportError) {
		return error.transportCode ?? (isInvokeTimeout(error) ? "request_timeout" : "transport");
	}
	return "transport";
}

/**
 * A lost transport reconnects immediately but never replays an invoke whose
 * world-side outcome is unknown. The next caller uses the new attachment.
 */
export class ReattachingPlayerSessionClient implements PlayerSessionClient {
	private reconnecting: Promise<PlayerSessionClient> | undefined;

	private constructor(
		private client: PlayerSessionClient,
		private readonly attach: AttachPlayerClient,
		private readonly context: SessionLifecycleContext,
	) {}

	static async create(
		attach: AttachPlayerClient,
		context: SessionLifecycleContext = {},
	): Promise<ReattachingPlayerSessionClient> {
		const client = await attach();
		const created = new ReattachingPlayerSessionClient(client, attach, context);
		created.emit("session_attach", { spawned: attachmentSpawned(client) ?? false });
		return created;
	}

	private emit(type: Parameters<RemoteMcpLifecycleEmit>[0], data: Record<string, unknown>): void {
		const slug = this.context.worldSlug?.trim();
		this.context.lifecycle?.(type, { ...data, ...(slug ? { world_slug: slug } : {}) });
	}

	private async reconnect(
		failedClient: PlayerSessionClient,
		error: unknown,
	): Promise<PlayerSessionClient> {
		if (this.client !== failedClient) return this.client;
		if (this.reconnecting === undefined) {
			// The daemon socket died under an attached client — the row that
			// separates "subscription lost" from "pod restarted" (sk-0m4.121).
			this.emit("subscription_lost", { cause: transportCause(error) });
			this.reconnecting = this.attach().then(
				(client) => {
					this.client = client;
					this.reconnecting = undefined;
					this.emit("session_resubscribed", { spawned: attachmentSpawned(client) ?? false });
					return client;
				},
				(error: unknown) => {
					this.reconnecting = undefined;
					this.emit("session_detach", { reason: "reattach_failed" });
					throw error;
				},
			);
		}
		return this.reconnecting;
	}

	async invoke(
		tool: string,
		args: unknown,
		causalContext?: WorldActorCausalContext,
	): Promise<SessionResponse<PlayerToolResult>> {
		const client = this.client;
		try {
			return await client.invoke(tool, args, causalContext);
		} catch (error) {
			// sk-0m4.121: a request timeout on a LIVE socket is a busy daemon
			// (e.g. a queued invoke behind a reply window), not a lost
			// subscription — re-attaching would only re-join the same busy
			// daemon and misreport `subscription_lost`. Only a dead socket
			// (refused/closed/reset) re-attaches.
			if (isSessionLoss(error)) {
				await this.reconnect(client, error).catch(() => undefined);
			}
			throw error;
		}
	}

	async toolNames(): Promise<SessionResponse<string[]>> {
		const client = this.client;
		const read = async (current: PlayerSessionClient) => {
			if (current.toolNames !== undefined) return current.toolNames();
			const { PLAYER_TOOL_NAMES } = await import("@spellkave/tool-contracts");
			return { id: 0, ok: true as const, result: [...PLAYER_TOOL_NAMES] };
		};
		try {
			return await read(client);
		} catch (error) {
			if (!isSessionLoss(error)) throw error;
			return read(await this.reconnect(client, error));
		}
	}

	async status(): Promise<SessionResponse<SessionDaemonStatus>> {
		const client = this.client;
		try {
			if (client.status === undefined) throw new Error("session client has no status operation");
			return await client.status();
		} catch (error) {
			if (!isSessionLoss(error)) throw error;
			const reattached = await this.reconnect(client, error);
			if (reattached.status === undefined)
				throw new Error("session client has no status operation");
			return reattached.status();
		}
	}
}

function noSeatResponse(): SessionResponse<PlayerToolResult> {
	return {
		id: 0,
		ok: true,
		result: { content: [{ type: "text", text: NO_SEAT_HINT }] },
	};
}

/** Clear MCP tool text when the world session is dead after a catalog reset. */
export const WORLD_RESET_OR_RESTARTING_HINT =
	"The world was reset or is restarting. Everything this conversation remembers about the world is stale — best to start a new chat. If you previously had a hero, your seat may have been released — claim a seat again at https://spellkave.com, then retry.";

/**
 * sk-uglp: attached to the FIRST successful tool result after this caller's
 * world session had to be re-attached (its daemon died — world wiped,
 * redeployed, or restarted). The world is fresh; the chat is not.
 */
export const WORLD_RESET_NOTICE: SessionNotice = {
	kind: "world_reset",
	text: "The world was reset since this conversation last acted: your previous session ended and a fresh one was attached. Prior scene, dialogue, and character state in this chat are stale — tell the player, and best start a new chat.",
};

/**
 * Bound daemon invoke so a wedged session fails before the HTTP 15s 504.
 * Must clear the communicate reply window plus framing headroom: a 3s bound
 * raced the reply wait and mis-fired on slow NPC turns (sk-0m4.94). Still
 * strictly below the HTTP request bound (15s). The daemon's DEFAULT reply
 * window is in turn capped below this bound (`DAEMON_REPLY_WINDOW_CAP_MS`,
 * 8 s, `packages/spellkave-session/src/node/daemon.ts`, sk-0m4.121) and no
 * longer holds the daemon's invoke lock while it waits.
 */
export const SESSION_INVOKE_FAST_FAIL_MS = 12_000;

// Moved to `session-errors.ts` (sk-0m4.120.24) so `feedback.ts` can share the
// classification without an import cycle; re-exported to keep this surface.
export { isInvokeTimeout };

/**
 * sk-uglp / sk-0m4.94: only a dead daemon socket is session loss. An invoke
 * timeout means the tool ran long (e.g. communicate reply window), not that
 * the world was wiped — do not sticky-arm {@link WORLD_RESET_NOTICE}.
 */
function isSessionLoss(error: unknown): boolean {
	return error instanceof SessionDaemonTransportError && !isInvokeTimeout(error);
}

/** Player-facing text when a tool call exceeds {@link SESSION_INVOKE_FAST_FAIL_MS}. */
export const SESSION_INVOKE_TIMEOUT_HINT =
	"The tool call timed out waiting for the world session. The world was not reset — retry the call; if you were speaking to someone, their reply may still arrive as a later event.";

/** Communication tool that may wait on an NPC reply window (sk-0m4.73).
 * A gateway-side invoke timeout on this tool is treated as a slow reply, not a
 * failed act (sk-0m4.100) — see {@link awaitingResponseCommunicationReceipt}. */
export const COMMUNICATE_TOOL = "spellkave_communicate";

/**
 * sk-0m4.100: normal communicate-shaped receipt when the gateway bound fires
 * while the daemon is still waiting on a reply window. The utterance typically
 * already landed as a world trace; returning
 * an error here made LLM players retry and double-inscribe speech. Only a real
 * transport loss may surface as an error / world_reset (sk-0m4.94).
 */
export function awaitingResponseCommunicationReceipt(args: unknown): PlayerToolResult {
	const record =
		typeof args === "object" && args !== null && !Array.isArray(args)
			? (args as Record<string, unknown>)
			: {};
	const rawUtterance = typeof record.utterance === "string" ? record.utterance.trim() : "";
	const spoken = rawUtterance === "" ? null : rawUtterance;
	const details = {
		receipt: {
			status: "dispatched" as const,
			verb_class: "communicate",
			// The gateway stopped waiting; it did not observe the world's verdict.
			// `unobserved` is the honest receipt vocabulary for exactly that
			// (player-tools ActReceipt) — never claim `accepted` for an act whose
			// outcome nobody read (playtest rule: prose/guesses are not evidence).
			outcome: "unobserved" as const,
		},
		observation: spoken === null ? null : `You say: "${spoken}"`,
		conversation: {
			spoken_by_player: spoken,
			response: null,
			awaiting_response: true,
			continuity: null,
		},
	};
	return {
		content: [{ type: "text", text: JSON.stringify(details, null, 2) }],
		details,
	};
}

function unresolvedBinding(url: string): SessionBinding {
	return { url, db: "unresolved", identity: "workos-pending", actorId: "unresolved" };
}

/** `session_detach.reason` when a new token resolves to a different world,
 * actor, or `no_seat` than the cached route (sk-jay0.6.37.14). */
export const SESSION_DETACH_REASON_ROUTE_CHANGED = "route_changed";

function sameSeatRoute(left: WorldRoute | undefined, right: WorldRoute): boolean {
	if (left === undefined) return false;
	if (left.kind === "no_seat" && right.kind === "no_seat") return true;
	if (left.kind !== "seat" || right.kind !== "seat") return false;
	return left.hit.world.slug === right.hit.world.slug && left.hit.actorId === right.hit.actorId;
}

/** Attach the catalog world that holds this subject's seat (sk-pka5.8). */
export class JwtBoundPlayerSessionClient implements PlayerSessionClient {
	private readonly clients = new Map<string, PlayerSessionClient>();
	private readonly tokens = new Map<string, string>();
	private readonly routes = new Map<string, WorldRoute>();

	private readonly noSeatUntil = new Map<string, number>();
	/** ADR-0161 D-5: a refused pick (seat_unavailable) for the same token, until a short TTL. */
	private readonly pickRefusedUntil = new Map<string, number>();
	/** sk-uglp: subjects whose attached session died under them (real transport
	 * loss while a client was attached — not an invoke timeout, sk-0m4.94).
	 * The next successful result for such a subject carries {@link WORLD_RESET_NOTICE}. */
	private readonly resetNoticePending = new Set<string>();
	private readonly now: () => number;
	private readonly noSeatTtlMs: number;
	private readonly attach: AttachBoundSessionClient;
	private readonly findClaimedSeat: FindClaimedSeat;
	private readonly claimSeat: ClaimSeat;
	private readonly isOfferedFreeSeat: IsOfferedFreeSeat;
	/** sk-0m4.120.12: bound by the gateway once its run observer exists. */
	private lifecycle: RemoteMcpLifecycleEmit | undefined;

	constructor(
		private readonly worldUrl: string,
		private readonly catalog: WorldCatalog,
		private readonly findSeat: FindWorldSeat,
		options: {
			now?: () => number;
			noSeatTtlMs?: number;
			/** Test seam: how one (binding, token) becomes a session client.
			 * Production attaches the real PLAYER session daemon. */
			attach?: AttachBoundSessionClient;
			/** ADR-0161 D-5: probe/claim the seat a token's consent claim picked. */
			findClaimedSeat?: FindClaimedSeat;
			claimSeat?: ClaimSeat;
			isOfferedFreeSeat?: IsOfferedFreeSeat;
		} = {},
	) {
		this.findClaimedSeat =
			options.findClaimedSeat ??
			((world, token, actorId) => probeWorldSeat(this.worldUrl, world.db, token, actorId));
		this.claimSeat =
			options.claimSeat ??
			((world, token, actorId) => claimSeatAsCaller(this.worldUrl, world.db, token, actorId));
		this.isOfferedFreeSeat =
			options.isOfferedFreeSeat ??
			((world, token, actorId) =>
				isOfferedFreeSeatInWorld(this.worldUrl, world.db, token, actorId));
		this.now = options.now ?? Date.now;
		this.noSeatTtlMs = options.noSeatTtlMs ?? NO_SEAT_TTL_MS;
		this.attach =
			options.attach ??
			((binding, token, worldSlug) =>
				attachSessionDaemon(binding, {
					token,
					worldSlug,
					requestTimeoutMs: SESSION_INVOKE_FAST_FAIL_MS,
				}));
	}

	bindLifecycle(emit: RemoteMcpLifecycleEmit): void {
		this.lifecycle = emit;
	}

	routedWorld(subject: string): { slug: string; actorId: string } | undefined {
		const token = currentRemoteMcpAccessToken();
		// A picked token reads only its own seat's route; never the subject's
		// unpicked route, which may be another hero (wrong world in telemetry).
		const route = this.routes.get(token === undefined ? subject : this.keyFor(subject, token));
		if (route?.kind !== "seat") return undefined;
		return { slug: route.hit.world.slug, actorId: route.hit.actorId };
	}

	/**
	 * ADR-0161 D-5: one session per subject AND picked seat, so two Claude
	 * connections of one person playing two heroes never share a session. A
	 * token without the consent claim keeps the subject key (unchanged).
	 */
	private keyFor(subject: string, token: string): string {
		const claim = parseSeatClaim(token);
		return seatSessionKey(subject, claim === "invalid" ? undefined : claim);
	}

	/** Resolve (and cache) the seat for the current authorized MCP request. */
	async resolveSeatForCurrentRequest(): Promise<
		{ actorId: string; worldSlug: string } | undefined
	> {
		const subject = currentRemoteMcpRequestSubject();
		const token = currentRemoteMcpAccessToken();
		if (subject === undefined || token === undefined) return undefined;
		const route = await this.routeFor(this.keyFor(subject, token), subject, token);
		if (route.kind !== "seat") return undefined;
		return { actorId: route.hit.actorId, worldSlug: route.hit.world.slug };
	}

	private drop(key: string, reason: string): void {
		if (this.clients.has(key)) {
			const slug = this.routes.get(key);
			this.lifecycle?.("session_detach", {
				reason,
				...(slug?.kind === "seat" ? { world_slug: slug.hit.world.slug } : {}),
			});
		}
		this.clients.delete(key);
		this.tokens.delete(key);
		this.routes.delete(key);
		this.noSeatUntil.delete(key);
		this.pickRefusedUntil.delete(key);
	}

	private async routeFor(key: string, subject: string, token: string): Promise<WorldRoute> {
		const claim = parseSeatClaim(token);
		if (claim === "invalid") throw new SeatClaimUnavailableError(undefined);
		const cached = this.routes.get(key);
		const previousToken = this.tokens.get(key);
		const sameToken = previousToken === token;
		// Revalidate a cached primary route before preferring it; presence-only
		// routes require a catalog sweep so a new second world cannot be ignored.
		// sk-jay0.5.14.15: an OAuth refresh (900 s WorkOS access tokens) hands a
		// new bearer for the SAME subject. The resource server verified it
		// against the one configured issuer, so same subject ⇒ same iss|sub ⇒
		// same world identity and seat. SpacetimeDB checks the token only when a
		// connection opens, so the live session stays valid: keep the session
		// and the route and store the fresh bearer for any later (re)attach.
		// The seat itself can still move between refreshes (released/claimed
		// through the Account API, sk-jay0.6.37.14), so verify it with ONE probe
		// of the cached world instead of the full catalog sweep; only a miss,
		// a different actor, or a failed probe falls through to the full
		// resolve with its `route_changed` semantics. A seat with no live
		// session also takes the full resolve.
		if (
			previousToken !== undefined &&
			cached?.kind === "seat" &&
			cached.hit.role !== "presence" &&
			this.clients.has(key)
		) {
			const verified = await (claim === undefined
				? this.findSeat(cached.hit.world, token)
				: this.findClaimedSeat(cached.hit.world, token, claim.actorId)
			).catch(() => null);
			if (
				verified !== null &&
				verified.actorId === cached.hit.actorId &&
				verified.role !== "presence"
			) {
				this.tokens.set(key, token);
				if (!sameToken)
					this.lifecycle?.("session_token_refreshed", { world_slug: cached.hit.world.slug });
				return cached;
			}
		}
		if (sameToken) {
			const until = this.noSeatUntil.get(key);
			if (until !== undefined && this.now() < until) return { kind: "no_seat" };
			const refused = this.pickRefusedUntil.get(key);
			if (claim !== undefined && refused !== undefined && this.now() < refused)
				throw new SeatClaimUnavailableError(claim);
		}
		const resolved =
			claim !== undefined
				? await resolveClaimedSeatRoute(this.catalog, subject, token, claim, {
						findClaimedSeat: this.findClaimedSeat,
						isOfferedFreeSeat: this.isOfferedFreeSeat,
						claimSeat: this.claimSeat,
					}).catch((error: unknown) => {
						// Cache only a refusal; a transient probe error (SeatClaimProbeError)
						// is retried on the next call.
						if (error instanceof SeatClaimUnavailableError) {
							this.tokens.set(key, token);
							this.pickRefusedUntil.set(key, this.now() + this.noSeatTtlMs);
						}
						throw error;
					})
				: await resolveWorldRoute(this.catalog, subject, token, this.findSeat, (world, error) => {
						// sk-jay0.6.38.5: a skipped probe (dead world, transport failure)
						// used to be a console.warn only. Route it through the same
						// lifecycle channel as session_attach/session_detach — the raw
						// subject guard lives inside emitLifecycle itself (observability.ts).
						this.lifecycle?.("world_lifecycle", {
							phase: "route_probe_failed",
							outcome: "failed",
							world_slug: world.slug,
							error_class: unknownErrorClass(error),
						});
					});
		const stale = cached?.kind === "seat" || this.clients.has(key);
		if (stale && !sameSeatRoute(cached, resolved)) {
			this.drop(key, SESSION_DETACH_REASON_ROUTE_CHANGED);
		}
		if (resolved.kind === "seat") {
			this.routes.set(key, resolved);
			this.noSeatUntil.delete(key);
			this.pickRefusedUntil.delete(key);
		} else {
			this.routes.delete(key);
			this.noSeatUntil.set(key, this.now() + this.noSeatTtlMs);
		}
		this.tokens.set(key, token);
		return resolved;
	}

	private async clientFor(
		key: string,
		subject: string,
		token: string,
		route: Extract<WorldRoute, { kind: "seat" }>,
	): Promise<PlayerSessionClient> {
		// routeFor already dropped the client when the seat itself changed
		// (`route_changed`) and kept it on a same-subject token refresh
		// (`session_token_refreshed`, sk-jay0.5.14.15).
		if (!this.clients.has(key)) {
			const binding: SessionBinding = {
				url: this.worldUrl,
				db: route.hit.world.db,
				identity: subject,
				actorId: route.hit.actorId,
			};
			this.clients.set(
				key,
				await ReattachingPlayerSessionClient.create(
					// Read the bearer at attach time, not at construction: a
					// reconnect after a daemon/world drop must present the latest
					// refreshed token, never the (possibly expired) first one.
					() => this.attach(binding, this.tokens.get(key) ?? token, route.hit.world.slug),
					{
						...(this.lifecycle === undefined ? {} : { lifecycle: this.lifecycle }),
						worldSlug: route.hit.world.slug,
					},
				),
			);
		}
		this.tokens.set(key, token);
		const client = this.clients.get(key);
		if (client === undefined) throw new Error("failed to attach PLAYER session");
		return client;
	}

	private async clientForRequest(): Promise<PlayerSessionClient | "no_seat"> {
		const subject = currentRemoteMcpRequestSubject();
		const token = currentRemoteMcpAccessToken();
		if (subject === undefined || token === undefined) {
			throw new Error("authorized request is missing WorkOS token context");
		}
		const key = this.keyFor(subject, token);
		const route = await this.routeFor(key, subject, token);
		if (route.kind === "no_seat") return "no_seat";
		return this.clientFor(key, subject, token, route);
	}

	async toolNames(): Promise<SessionResponse<string[]>> {
		const client = await this.clientForRequest();
		if (client !== "no_seat" && client.toolNames !== undefined) return client.toolNames();
		// Preserve shipped onboarding: unseated callers can invoke PLAYER tools
		// to receive the website claim hint; this roster grants no world authority.
		const { PLAYER_TOOL_NAMES } = await import("@spellkave/tool-contracts");
		return { id: 0, ok: true, result: [...PLAYER_TOOL_NAMES] };
	}

	async invoke(tool: string, args: unknown, causalContext?: WorldActorCausalContext) {
		const subject = currentRemoteMcpRequestSubject();
		const token = currentRemoteMcpAccessToken();
		const key =
			subject === undefined || token === undefined ? subject : this.keyFor(subject, token);
		const hadAttachedClient = key !== undefined && this.clients.has(key);
		try {
			const client = await this.clientForRequest();
			if (client === "no_seat") return noSeatResponse();
			const response = await Promise.race([
				client.invoke(tool, args, causalContext),
				new Promise<never>((_, reject) => {
					setTimeout(() => {
						reject(
							Object.assign(
								new Error(`session invoke timed out after ${SESSION_INVOKE_FAST_FAIL_MS}ms`),
								{
									code: "ETIMEDOUT",
									name: "SessionInvokeTimeoutError",
								},
							),
						);
					}, SESSION_INVOKE_FAST_FAIL_MS);
				}),
			]);
			if (key !== undefined && this.resetNoticePending.delete(key)) {
				return { ...response, notices: [...(response.notices ?? []), WORLD_RESET_NOTICE] };
			}
			return response;
		} catch (error) {
			// sk-0m4.121: an invoke timeout is a BUSY daemon on a live socket
			// (each request opens its own socket, so the late daemon response
			// cannot collide with the next request) — keep the attachment and
			// emit no `session_detach`; the tool_call row still carries
			// `error_code=session_invoke_timeout` (daemon-handler). Do NOT arm
			// world_reset (sk-0m4.94).
			if (isInvokeTimeout(error)) {
				// sk-0m4.100: a communicate whose reply window (or observation)
				// outruns the gateway bound must surface as the NORMAL receipt
				// with awaiting_response=true — never a transport error that
				// prompts retry and double-inscribed speech.
				if (tool === COMMUNICATE_TOOL) {
					return { id: 0, ok: true as const, result: awaitingResponseCommunicationReceipt(args) };
				}
				throw error;
			}
			// A refused or unreadable pick (ADR-0161 D-5) is a routing answer, not a
			// transport loss: keep the cached refusal and attach no world_reset.
			if (error instanceof SeatClaimUnavailableError || error instanceof SeatClaimProbeError)
				throw error;
			if (key !== undefined) {
				this.drop(key, transportCause(error));
				// Real daemon death (socket closed/refused), not a slow tool:
				// arm the one-shot world_reset notice for the next success.
				if (hadAttachedClient && isSessionLoss(error)) this.resetNoticePending.add(key);
			}
			throw error;
		}
	}

	async status() {
		const subject = currentRemoteMcpRequestSubject();
		const token = currentRemoteMcpAccessToken();
		const key =
			subject === undefined || token === undefined ? subject : this.keyFor(subject, token);
		const client = key === undefined ? this.clients.values().next().value : this.clients.get(key);
		const route = key === undefined ? undefined : this.routes.get(key);
		const binding =
			route?.kind === "seat"
				? {
						url: this.worldUrl,
						db: route.hit.world.db,
						identity: subject ?? "unbound",
						actorId: route.hit.actorId,
					}
				: unresolvedBinding(this.worldUrl);
		if (client?.status === undefined) {
			return {
				id: 0,
				ok: true as const,
				result: {
					binding,
					uptimeMs: 0,
					subscribed: false,
					observability: { mode: "off" },
				},
			};
		}
		return client.status();
	}
}

/**
 * Resource-server readiness: the gateway is ready when it can validate tokens,
 * i.e. the issuer's JWKS is reachable. It must NOT depend on a subject having an
 * attached SpacetimeDB session — before the first login no daemon is subscribed,
 * and the Quadlet health check would otherwise keep the unit "activating"
 * until the service manager times it out.
 */
export function createIssuerReadiness(
	resourceConfig: PlayerResourceServerConfig,
	options: { ttlMs?: number; now?: () => number; loadJwks?: typeof fetchJwks } = {},
): () => Promise<boolean> {
	const jwksUri = `${resourceConfig.issuer.replace(/\/$/, "")}${AUTHKIT_JWKS_PATH}`;
	const ttlMs = options.ttlMs ?? 60_000;
	const now = options.now ?? Date.now;
	const loadJwks = options.loadJwks ?? resourceConfig.fetchJwks ?? fetchJwks;
	let lastOkAt = Number.NEGATIVE_INFINITY;
	return async () => {
		if (now() - lastOkAt < ttlMs) return true;
		try {
			const keys = await loadJwks(jwksUri);
			if (keys.length === 0) return false;
			lastOkAt = now();
			return true;
		} catch {
			return false;
		}
	};
}

export async function startPlayerMcpRuntime(
	config: PlayerMcpRuntimeConfig = loadPlayerMcpRuntimeConfig(),
): Promise<RunningPlayerMcpRuntime> {
	const catalog = loadWorldCatalog(config.catalogPath);
	const seatProbes = createSeatProbes();
	const client = new JwtBoundPlayerSessionClient(
		config.worldUrl,
		catalog,
		(world, token) => seatProbes.probe(config.worldUrl, world.db, token),
		{
			findClaimedSeat: (world, token, actorId) =>
				seatProbes.probe(config.worldUrl, world.db, token, actorId),
		},
	);
	const publicSlugs = publicWorldSlugs(catalog);
	const osmWorldSlugs = new Set(catalog.worlds.map((w) => w.slug));
	// Operator / module-publisher token for full-world OSM export (ADR-0123).
	// Prefer explicit env, then SPELLKAVE_CONNECT_TOKEN, then local cli.toml owner.
	const osmToken = resolveOsmOperatorToken(process.env);
	const osmCache: WorldOsmCache = createLiveWorldOsmCache({
		worldUrl: config.worldUrl,
		catalog,
		...(osmToken === undefined ? {} : { token: osmToken }),
	});
	const transcriptRecorder =
		config.publicTranscriptDir === ""
			? NOOP_PUBLIC_TRANSCRIPT_RECORDER
			: createPublicTranscriptRecorder({
					directory: config.publicTranscriptDir,
					publicSlugs,
					worldForSubject: (subject) => client.routedWorld(subject),
				});
	const worldTiles = {
		knownSlugs: osmWorldSlugs,
		loadCache: async (slug: string) => {
			await osmCache.ensure(slug);
			return osmCache.getTiles(slug) ?? null;
		},
	};
	const canonicalHostname = new URL(config.resourceConfig.canonicalOrigin).hostname.toLowerCase();
	const allowedHostnames = [canonicalHostname];
	const gateway = await createAttachedPlayerMcpGateway({
		resourceConfig: config.resourceConfig,
		binding: unresolvedBinding(config.worldUrl),
		attach: async () => client,
		readiness: createIssuerReadiness(config.resourceConfig),
		allowedHostnames,
		allowedOriginHostnames: config.allowedOriginHostnames,
		trustForwardedHeaders: config.trustForwardedHeaders,
		transcriptRecorder,
		transcriptDirectory: config.publicTranscriptDir,
		publicTranscriptSlugs: publicSlugs,
		osmCache,
		osmWorldSlugs,
		worldTiles,
		...(config.mapsBaseUrl === undefined ? {} : { mapLink: { mapsBaseUrl: config.mapsBaseUrl } }),
	});
	const handler = createPlayerMcpNodeHandler(gateway);
	const server = createServer((request, response) => void handler(request, response));
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(config.listenPort, config.listenHost, () => {
			server.off("error", reject);
			resolve();
		});
	});
	const keepalive = setInterval(() => {
		void client.status().catch(() => undefined);
	}, config.keepaliveMs);
	keepalive.unref();
	let closed = false;
	return {
		config,
		gateway,
		server,
		async close() {
			if (closed) return;
			closed = true;
			clearInterval(keepalive);
			await closeNodeServer(server);
			await gateway.close();
			await seatProbes.close();
			await osmCache.close();
		},
	};
}

function closeNodeServer(server: Server): Promise<void> {
	return new Promise((resolve, reject) => {
		server.close((error) => (error === undefined ? resolve() : reject(error)));
	});
}
