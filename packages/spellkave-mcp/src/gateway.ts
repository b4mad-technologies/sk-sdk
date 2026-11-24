import {
	bearerAuthChallengeResponse,
	hostHeaderValidationResponse,
	OAuthError,
	OAuthErrorCode,
	originValidationResponse,
	requireBearerAuth,
} from "@modelcontextprotocol/server";
import type { WorldActorCausalContext } from "@spellkave/agent-observability";
import {
	createPlayerJwtVerifier,
	DEFAULT_MAX_CONCURRENT_REQUESTS,
	DEFAULT_MAX_CONCURRENT_REQUESTS_PER_SUBJECT,
	DEFAULT_OSM_REQUEST_LIMIT,
	DEFAULT_PUBLIC_REQUEST_LIMIT,
	DEFAULT_SUBJECT_QUEUE_DEPTH,
	DEFAULT_SUBJECT_QUEUE_WAIT_MS,
	DEFAULT_SUBJECT_REQUEST_LIMIT,
	DEFAULT_TRANSCRIPT_REQUEST_LIMIT,
	type FixedWindowLimit,
	FixedWindowRateLimiter,
	forwardedHeaderValidationResponse,
	mcpResourceUrl,
	type PlayerResourceServerConfig,
	protectedResourceMetadataUrl,
	rateLimitedResponse,
	requestBodyTooLarge,
	resourceServerFetch,
	SubjectConcurrencyQueue,
} from "@spellkave/gateway-identity";
import type { SessionBinding } from "@spellkave/session";
import { attachSessionDaemon } from "@spellkave/session/node";
import { PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import {
	type MapDeepLinkOptions,
	normalizeMapsBaseUrl,
	type PlayerSessionClient,
} from "./daemon-handler.ts";
import {
	createFeedbackSinkFromEnv,
	createInMemoryFeedbackRateLimiter,
	createMemoryFeedbackSink,
	type FeedbackToolOptions,
} from "./feedback.ts";
import { SPELLKAVE_FEEDBACK_TOOL } from "./feedback-constants.ts";
import { createPlayerMcpHttpService, type PlayerMcpHttpService } from "./http.ts";
import { mcpPreflightResponse, withMcpCors } from "./mcp-cors.ts";
import {
	createPrivateStatusFileWriter,
	createRemoteMcpRunObserverFromEnv,
	createRequestCorrelationId,
	currentRemoteMcpRequestSubject,
	defaultMcpStatusPath,
	emitPlayerMcpOperationLog,
	NOOP_PLAYER_MCP_OPERATION_LOGGER,
	type PlayerMcpOperationLogger,
	type PlayerMcpStatusWriter,
	type RemoteMcpRunObserver,
	STDERR_PLAYER_MCP_OPERATION_LOGGER,
	withRemoteMcpAccessToken,
	withRemoteMcpRequestContext,
	withRemoteMcpRequestSubject,
} from "./observability.ts";
import { osmPreflightResponse, parseWorldApiPath } from "./osm-api.ts";
import type { WorldOsmCache } from "./osm-model.ts";
import { TilesModelStore } from "./osm-model.ts";
import { PlayerSeatBusyError } from "./session-errors.ts";
import {
	defaultFontsRoot,
	defaultMapsDemoPath,
	defaultWorldAssetsRoot,
	handleWorldTilesRequest,
	openTilesCorsHeaders,
	parseWorldTilesPath,
	tilesPreflightResponse,
	type WorldTilesHandlerOptions,
} from "./tiles.ts";
import { hashTranscriptSubject, type PublicTranscriptRecorder } from "./transcript.ts";
import {
	parseTranscriptSlug,
	servePublicTranscript,
	type TranscriptFileReader,
	transcriptPreflightResponse,
	websiteCorsHeaders,
} from "./transcript-http.ts";

/** Classify the middleware response without logging attacker-controlled claims or headers. */
async function bearerRejectionReason(response: Response): Promise<string> {
	const body = (await response
		.clone()
		.json()
		.catch(() => ({}))) as Record<string, unknown>;
	const description = typeof body.error_description === "string" ? body.error_description : "";
	if (description === "Missing Authorization header") return "missing_header";
	if (description.startsWith("Invalid Authorization header format")) return "malformed_header";
	if (description === "token expired" || description === "Token has expired") return "expired";
	if (description === "Token has no expiration time") return "missing_expiration";
	if (description === "token was issued before sign-out") return "revoked";
	if (description === "missing sub") return "missing_subject";
	if (description.startsWith("token issuer ")) return "issuer_mismatch";
	if (
		description.startsWith("aud mismatch") ||
		description === "Token was not issued for this resource"
	)
		return "audience_mismatch";
	if (description.startsWith("no JWKS key matches")) return "unknown_key";
	if (description === "signature mismatch") return "signature_mismatch";
	if (description.startsWith("unsupported alg ")) return "unsupported_algorithm";
	if (description.startsWith("JWT ")) return "malformed_token";
	if (body.error === "server_error") return "verifier_unavailable";
	return "invalid_token";
}

export const PLAYER_MCP_STATUS_VERSION = "player-mcp-status/v1";
export const DEFAULT_WORLD_URL = "http://127.0.0.1:3000";

export interface PlayerMcpGatewayOptions {
	resourceConfig: PlayerResourceServerConfig;
	client: PlayerSessionClient;
	resolveClient?: (subject: string) => PlayerSessionClient;
	allowedHostnames?: string[];
	allowedOriginHostnames?: string[];
	maxBodyBytes?: number;
	requestTimeoutMs?: number;
	/** Shared pre-auth flood guard (default 3000/60s; see security.ts arithmetic). */
	requestRateLimit?: FixedWindowLimit;
	/** Per WorkOS-subject `/mcp` budget after auth (default 300/60s). */
	subjectRequestRateLimit?: FixedWindowLimit;
	/** Separate bucket for GET /transcripts/* (default 120/60s). */
	transcriptRequestRateLimit?: FixedWindowLimit;
	/** Separate bucket for /w/<slug>/api/… OSM + Overpass (default 120/60s). */
	osmRequestRateLimit?: FixedWindowLimit;
	maxConcurrentRequests?: number;
	/** In-flight `/mcp` requests per subject; further ones queue (default 2). */
	maxConcurrentRequestsPerSubject?: number;
	/** Requests a subject may queue for a slot before it gets 429 (default 8). */
	subjectQueueDepth?: number;
	/** Longest a queued request waits for a slot before it gets 429 (default 5000). */
	subjectQueueWaitMs?: number;
	trustForwardedHeaders?: boolean;
	readiness?: () => boolean | Promise<boolean>;
	now?: () => number;
	operationNow?: () => Date;
	operationLogger?: PlayerMcpOperationLogger;
	runObserver?: RemoteMcpRunObserver;
	/**
	 * spellkave_feedback sink. Default: `SPELLKAVE_FEEDBACK_APP_ENV` → GitHub
	 * Issues sink (sk-rax8.6); unset → in-memory local references.
	 */
	feedback?: FeedbackToolOptions;
	/** Optional maps app deep link on spellkave_map (SPELLKAVE_MAPS_URL). */
	mapLink?: MapDeepLinkOptions;
	transcriptRecorder?: PublicTranscriptRecorder;
	/** Local JSONL tree (SPELLKAVE_MCP_PUBLIC_TRANSCRIPT_DIR). Empty = 404 all reads. */
	transcriptDirectory?: string;
	/** Catalog slugs with visibility=public — only these are readable. */
	publicTranscriptSlugs?: ReadonlySet<string>;
	readTranscriptFile?: TranscriptFileReader;
	statusWriter?: PlayerMcpStatusWriter<PlayerMcpGatewayStatus>;
	/** Per-world OSM export cache (operator identity). */
	osmCache?: WorldOsmCache;
	/** Catalog world slugs served by OSM routes. */
	osmWorldSlugs?: ReadonlySet<string>;
	/** MVT / MapLibre routes under `/w/<slug>/…` (sk-adr8.14). */
	worldTiles?: {
		knownSlugs: ReadonlySet<string>;
		loadCache: WorldTilesHandlerOptions["loadCache"];
		worldAssetsRoot?: string;
		fontsRoot?: string;
		mapsDemoPath?: string;
		store?: TilesModelStore;
	};
}

export interface AttachedPlayerMcpGatewayOptions extends Omit<PlayerMcpGatewayOptions, "client"> {
	binding: SessionBinding;
	attach?: (binding: SessionBinding) => Promise<PlayerSessionClient>;
	resolveClient?: (subject: string) => PlayerSessionClient;
	env?: NodeJS.ProcessEnv;
	/** sk-0m4.120.13: the image tag this process runs (`SPELLKAVE_IMAGE_TAG`);
	 * reported on the `gateway_start` lifecycle row. */
	imageTag?: string;
}

export interface PlayerMcpGatewayStatus {
	v: typeof PLAYER_MCP_STATUS_VERSION;
	kind: "player_mcp_status";
	ts: string;
	status: "ok" | "unavailable";
	mcp_transport: "ready";
	oauth: "ready";
	daemon: {
		attached: true;
		transport: "ok" | "unavailable" | "unknown";
		subscribed: boolean | null;
		observability_mode?: string;
	};
	world_reachable: boolean | null;
	world_actor_exporters: {
		gateway_logs: "configured" | "disabled" | "unknown";
		session_logs: "configured" | "disabled" | "unknown";
		session_traces: "configured" | "disabled" | "unknown";
		session_metrics: "configured" | "disabled" | "unknown";
	};
	active_authorized_sessions: number;
	active_authorized_requests: number;
	last_auth_rejection?: { ts: string; correlation_id: string };
}

export interface PlayerMcpGatewayService {
	readonly resource: string;
	fetch(request: Request): Promise<Response>;
	status(): Promise<PlayerMcpGatewayStatus>;
	close(): Promise<void>;
}

/**
 * Promise-tail queue: one PLAYER seat observes one deterministic call order.
 * One instance per subject (seat) — see `resolveSerialized` below. Over the
 * cap the call is refused with {@link PlayerSeatBusyError} (classified
 * `gateway` / `seat_busy`), never a plain `Error` (sk-0m4.120.36).
 */
export class SerializedPlayerSessionClient implements PlayerSessionClient {
	private tail: Promise<void> = Promise.resolve();
	private pending = 0;
	/**
	 * sk-0m4.120.30: `status()` passes straight through (a status probe is not
	 * a seat action and never queues). Defined only when the wrapped client
	 * has one, so callers keep seeing `status_unsupported` for clients without
	 * it instead of a throw. Before this every must-gather bundle reported
	 * `status_failed`: the subject-scoped client saw no `status` here and
	 * threw a plain Error.
	 */
	readonly status?: () => ReturnType<NonNullable<PlayerSessionClient["status"]>>;
	/** Discovery reads current authority without joining the action queue. */
	readonly toolNames?: PlayerSessionClient["toolNames"];

	constructor(
		private readonly client: PlayerSessionClient,
		private readonly maxPending = DEFAULT_MAX_CONCURRENT_REQUESTS_PER_SUBJECT,
	) {
		if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
			throw new Error("serialized client maxPending must be positive");
		}
		const status = client.status;
		if (status !== undefined) this.status = () => status.call(client);
		const toolNames = client.toolNames;
		if (toolNames !== undefined) this.toolNames = () => toolNames.call(client);
	}

	invoke(
		tool: string,
		args: unknown,
		causalContext?: WorldActorCausalContext,
	): ReturnType<PlayerSessionClient["invoke"]> {
		if (this.pending >= this.maxPending) {
			return Promise.reject(new PlayerSeatBusyError());
		}
		this.pending += 1;
		const result = this.tail.then(() => this.client.invoke(tool, args, causalContext));
		this.tail = result
			.then(
				() => undefined,
				() => undefined,
			)
			.finally(() => {
				this.pending -= 1;
			});
		return result;
	}
}

// TODO(sk-pka5.8): subject with no in-world seat → send the client to the website.

class SubjectScopedPlayerSessionClient implements PlayerSessionClient {
	constructor(
		private readonly fallback: PlayerSessionClient,
		private readonly resolveClient?: (subject: string) => PlayerSessionClient,
	) {}

	private active(): PlayerSessionClient {
		const subject = currentRemoteMcpRequestSubject();
		if (subject === undefined || this.resolveClient === undefined) return this.fallback;
		return this.resolveClient(subject);
	}

	invoke(tool: string, args: unknown, causalContext?: WorldActorCausalContext) {
		return this.active().invoke(tool, args, causalContext);
	}

	status() {
		const client = this.active();
		if (client.status === undefined) throw new Error("session client has no status operation");
		return client.status();
	}

	toolNames(): ReturnType<NonNullable<PlayerSessionClient["toolNames"]>> {
		const client = this.active();
		if (client.toolNames !== undefined) return client.toolNames();
		// Preserve the HTTP adapter's legacy PLAYER fallback for older clients.
		return Promise.resolve({ id: 0, ok: true, result: [...PLAYER_TOOL_NAMES] });
	}
}

/**
 * True when this `/mcp` POST is `tools/call` for `spellkave_feedback`.
 * Uses a cloned body so the live request stream stays readable for MCP.
 * Only inspects method + tool name — no second full validation parse.
 */
async function isSpellkaveFeedbackToolsCall(request: Request): Promise<boolean> {
	if (request.method !== "POST") return false;
	let body: unknown;
	try {
		body = await request.clone().json();
	} catch {
		return false;
	}
	if (body === null || typeof body !== "object" || Array.isArray(body)) return false;
	const record = body as Record<string, unknown>;
	if (record.method !== "tools/call") return false;
	const params = record.params;
	if (params === null || typeof params !== "object" || Array.isArray(params)) return false;
	return (params as Record<string, unknown>).name === SPELLKAVE_FEEDBACK_TOOL;
}

function safeRoute(pathname: string): string {
	if (pathname === "/mcp" || pathname === "/healthz") return pathname;
	if (pathname.startsWith("/v1/")) return "/v1/*";
	if (parseTranscriptSlug(pathname) !== null) return "/transcripts/*";
	if (parseWorldApiPath(pathname) !== null) return "/w/*/api/*"; // route label
	if (parseWorldTilesPath(pathname) !== null) return "/w/*";
	if (pathname.startsWith("/.well-known/")) return "/.well-known/*";
	return "other";
}

function withCorrelationHeader(response: Response, correlationId: string): Response {
	const headers = new Headers(response.headers);
	headers.set("x-request-id", correlationId);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/** Compose public OAuth routes with one bearer-protected, fixed-seat MCP endpoint. */
export function createPlayerMcpGateway(options: PlayerMcpGatewayOptions): PlayerMcpGatewayService {
	const resourceConfig = options.resourceConfig;
	const resource = mcpResourceUrl(resourceConfig.canonicalOrigin);
	const resourceMetadataUrl = protectedResourceMetadataUrl(resourceConfig.canonicalOrigin);
	const verifier = createPlayerJwtVerifier({
		...resourceConfig,
		now: options.now ?? resourceConfig.now,
	});
	const operationNow = options.operationNow ?? (() => new Date(options.now?.() ?? Date.now()));
	const operationLogger = options.operationLogger ?? NOOP_PLAYER_MCP_OPERATION_LOGGER;
	const publicHostname = new URL(resourceConfig.canonicalOrigin).hostname.toLowerCase();
	const allowedHostnames = options.allowedHostnames ?? [publicHostname];
	const allowedOriginHostnames = options.allowedOriginHostnames ?? [publicHostname];
	if (allowedHostnames.length === 0 || allowedOriginHostnames.length === 0) {
		throw new Error("Host and Origin allowlists must not be empty");
	}
	const maxBodyBytes = options.maxBodyBytes ?? 1024 * 1024;
	const maxConcurrentRequests = options.maxConcurrentRequests ?? DEFAULT_MAX_CONCURRENT_REQUESTS;
	const maxConcurrentRequestsPerSubject =
		options.maxConcurrentRequestsPerSubject ?? DEFAULT_MAX_CONCURRENT_REQUESTS_PER_SUBJECT;
	const subjectQueueDepth = options.subjectQueueDepth ?? DEFAULT_SUBJECT_QUEUE_DEPTH;
	const subjectQueueWaitMs = options.subjectQueueWaitMs ?? DEFAULT_SUBJECT_QUEUE_WAIT_MS;
	// Queue depth/wait may be 0 — that restores the old reject-at-cap behaviour.
	for (const [name, value, minimum] of [
		["maxConcurrentRequests", maxConcurrentRequests, 1],
		["maxConcurrentRequestsPerSubject", maxConcurrentRequestsPerSubject, 1],
		["subjectQueueDepth", subjectQueueDepth, 0],
		["subjectQueueWaitMs", subjectQueueWaitMs, 0],
	] as const) {
		if (!Number.isSafeInteger(value) || value < minimum) {
			throw new Error(`${name} must be an integer >= ${minimum}`);
		}
	}
	const requestLimiter = new FixedWindowRateLimiter(
		options.requestRateLimit ?? DEFAULT_PUBLIC_REQUEST_LIMIT,
		options.now,
	);
	const subjectRequestLimiter = new FixedWindowRateLimiter(
		options.subjectRequestRateLimit ?? DEFAULT_SUBJECT_REQUEST_LIMIT,
		options.now,
	);
	const transcriptRequestLimiter = new FixedWindowRateLimiter(
		options.transcriptRequestRateLimit ?? DEFAULT_TRANSCRIPT_REQUEST_LIMIT,
		options.now,
	);
	const osmRequestLimiter = new FixedWindowRateLimiter(
		options.osmRequestRateLimit ?? DEFAULT_OSM_REQUEST_LIMIT,
		options.now,
	);
	const serializers = new Map<string, SerializedPlayerSessionClient>();
	// Only requests WITHOUT a subject (none of the authorized /mcp ones) share
	// this queue.
	const fallbackClient = new SerializedPlayerSessionClient(
		options.client,
		maxConcurrentRequestsPerSubject,
	);
	// sk-0m4.120.36: the seat queue is per SUBJECT, whether or not the caller
	// hands us a per-subject client. Production wires no `resolveClient` (the
	// JWT world router picks the seat from the request subject itself), and
	// until this change every subject then shared ONE queue with a cap of
	// `maxConcurrentRequestsPerSubject` (2): two in-flight calls of player A
	// made player B's next call fail in 1-2 ms without ever reaching B's
	// daemon, and every player's call waited behind every other player's.
	const resolveSerialized = (subject: string): PlayerSessionClient => {
		const existing = serializers.get(subject);
		if (existing !== undefined) return existing;
		const created = new SerializedPlayerSessionClient(
			options.resolveClient === undefined ? options.client : options.resolveClient(subject),
			maxConcurrentRequestsPerSubject,
		);
		serializers.set(subject, created);
		return created;
	};
	const feedbackOptions: FeedbackToolOptions = {
		sink: options.feedback?.sink ?? createMemoryFeedbackSink(),
		rateLimiter:
			options.feedback?.rateLimiter ??
			createInMemoryFeedbackRateLimiter({ now: () => operationNow().getTime() }),
		...(options.feedback?.resolveSeat === undefined
			? {}
			: { resolveSeat: options.feedback.resolveSeat }),
		...(options.feedback?.mustGatherContext === undefined
			? {}
			: { mustGatherContext: options.feedback.mustGatherContext }),
		...(options.feedback?.now === undefined ? {} : { now: options.feedback.now }),
	};
	const mcp: PlayerMcpHttpService = createPlayerMcpHttpService({
		client: new SubjectScopedPlayerSessionClient(fallbackClient, resolveSerialized),
		allowedHostnames,
		allowedOriginHostnames,
		maxBodyBytes,
		requestTimeoutMs: options.requestTimeoutMs,
		readiness: options.readiness,
		runObserver: options.runObserver,
		transcriptRecorder: options.transcriptRecorder,
		...(options.osmCache === undefined ? {} : { osmCache: options.osmCache }),
		...(options.osmWorldSlugs === undefined ? {} : { osmWorldSlugs: options.osmWorldSlugs }),
		feedback: feedbackOptions,
		...(options.mapLink === undefined ? {} : { mapLink: options.mapLink }),
	});
	// No custom OAuth scope gate: WorkOS DCR/CIMD (Claude.ai) cannot mint
	// player:tools. Auth = verified JWT + iss + aud (resource server).
	const authenticate = requireBearerAuth({
		verifier,
		requiredScopes: [],
		resourceMetadataUrl,
	});
	const transcriptDirectory = options.transcriptDirectory?.trim() ?? "";
	const publicTranscriptSlugs = options.publicTranscriptSlugs ?? new Set<string>();
	const tilesStore = options.worldTiles?.store ?? new TilesModelStore();
	const tilesHandlerOptions: WorldTilesHandlerOptions | undefined =
		options.worldTiles === undefined
			? undefined
			: {
					store: tilesStore,
					loadCache: options.worldTiles.loadCache,
					worldAssetsRoot: options.worldTiles.worldAssetsRoot ?? defaultWorldAssetsRoot(),
					fontsRoot: options.worldTiles.fontsRoot ?? defaultFontsRoot(),
					mapsDemoPath: options.worldTiles.mapsDemoPath ?? defaultMapsDemoPath(),
					knownSlugs: options.worldTiles.knownSlugs,
					// Links inside tiles.json / style.json / backdrops.json must point at
					// the PUBLIC origin (Cloudflare Tunnel → loopback bind otherwise).
					publicBaseUrl: resourceConfig.canonicalOrigin,
				};
	// Per-subject admission: over the cap a request waits for a slot instead of
	// being rejected — one client's own parallel tools/call batch must not 429
	// itself (sk-0m4.88).
	const subjectConcurrency = new SubjectConcurrencyQueue({
		maxConcurrent: maxConcurrentRequestsPerSubject,
		queueDepth: subjectQueueDepth,
		maxWaitMs: subjectQueueWaitMs,
	});
	let activeAuthorizedRequests = 0;
	let activeRequests = 0;
	let lastAuthRejection: { ts: string; correlation_id: string } | undefined;

	async function status(): Promise<PlayerMcpGatewayStatus> {
		let transport: PlayerMcpGatewayStatus["daemon"]["transport"] = "unknown";
		let subscribed: boolean | null = null;
		let observabilityMode: string | undefined;
		let sessionLogs: PlayerMcpGatewayStatus["world_actor_exporters"]["session_logs"] = "unknown";
		let sessionTraces: PlayerMcpGatewayStatus["world_actor_exporters"]["session_traces"] =
			"unknown";
		let sessionMetrics: PlayerMcpGatewayStatus["world_actor_exporters"]["session_metrics"] =
			"unknown";
		if (options.client.status !== undefined) {
			try {
				const daemonStatus = await options.client.status();
				if (daemonStatus.ok) {
					transport = "ok";
					subscribed = daemonStatus.result.subscribed;
					observabilityMode = daemonStatus.result.observability.mode;
					sessionLogs = daemonStatus.result.observability.logsProjection ?? "unknown";
					sessionTraces = daemonStatus.result.observability.tracesProjection ?? "unknown";
					sessionMetrics = daemonStatus.result.observability.metricsProjection ?? "unknown";
				} else {
					transport = "unavailable";
					subscribed = false;
				}
			} catch {
				transport = "unavailable";
				subscribed = false;
			}
		}
		return {
			v: PLAYER_MCP_STATUS_VERSION,
			kind: "player_mcp_status",
			ts: operationNow().toISOString(),
			status: transport === "unavailable" || subscribed === false ? "unavailable" : "ok",
			mcp_transport: "ready",
			oauth: "ready",
			daemon: {
				attached: true,
				transport,
				subscribed,
				...(observabilityMode === undefined ? {} : { observability_mode: observabilityMode }),
			},
			world_reachable: subscribed,
			world_actor_exporters: {
				gateway_logs: options.runObserver?.status?.logsProjection ?? "unknown",
				session_logs: sessionLogs,
				session_traces: sessionTraces,
				session_metrics: sessionMetrics,
			},
			active_authorized_sessions: subjectConcurrency.activeSubjectCount,
			active_authorized_requests: activeAuthorizedRequests,
			...(lastAuthRejection === undefined ? {} : { last_auth_rejection: lastAuthRejection }),
		};
	}

	async function publishStatus(): Promise<void> {
		try {
			await options.statusWriter?.(await status());
		} catch {
			// A stale operator snapshot cannot change the public request outcome.
		}
	}

	async function routeRequest(
		request: Request,
		correlationId: string,
	): Promise<{
		response: Response;
		auth: "accepted" | "rejected" | "not_applicable";
		auth_reason?: string;
	}> {
		const requestUrlEarly = new URL(request.url);
		const isOsmRoute = parseWorldApiPath(requestUrlEarly.pathname) !== null;
		// OSM tools (JOSM / Overpass Turbo / MapLibre) need open CORS — skip the
		// website-origin allowlist for /w/*/api/* only (Host still enforced).
		const requestPathEarly = new URL(request.url).pathname;
		// /w/* deliberately allows any Origin (MapLibre / JOSM / Overpass Turbo).
		const skipOriginAllowlist = parseWorldTilesPath(requestPathEarly) !== null;
		const rejected =
			hostHeaderValidationResponse(request, allowedHostnames) ??
			(isOsmRoute || skipOriginAllowlist
				? undefined
				: originValidationResponse(request, allowedOriginHostnames)) ??
			forwardedHeaderValidationResponse(request, {
				trustForwardedHeaders: options.trustForwardedHeaders ?? false,
				allowedHostnames,
			});
		if (rejected !== undefined) return { response: rejected, auth: "not_applicable" };
		if (await requestBodyTooLarge(request, maxBodyBytes)) {
			return {
				response: new Response("Request body is too large.", { status: 413 }),
				auth: "not_applicable",
			};
		}

		const requestUrl = new URL(request.url);

		const prm = resourceServerFetch(resourceConfig, request);
		if (prm !== undefined) return { response: prm, auth: "not_applicable" };

		const transcriptSlug = parseTranscriptSlug(requestUrl.pathname);
		if (transcriptSlug !== null) {
			// Own bucket — spectator poll must not starve /mcp (sk-pka5.23 review).
			const transcriptRate = transcriptRequestLimiter.take("transcripts");
			if (!transcriptRate.allowed) {
				return {
					response: rateLimitedResponse(transcriptRate.retryAfterSeconds),
					auth: "not_applicable",
				};
			}
			const cors = websiteCorsHeaders(request, allowedOriginHostnames);
			if (request.method === "OPTIONS") {
				return {
					response: transcriptPreflightResponse(request, allowedOriginHostnames),
					auth: "not_applicable",
				};
			}
			if (request.method !== "GET" && request.method !== "HEAD") {
				return {
					response: new Response("Method not allowed.", {
						status: 405,
						headers: { ...(cors ?? {}), allow: "GET, HEAD, OPTIONS" },
					}),
					auth: "not_applicable",
				};
			}
			const authInfo = await authenticate(request);
			if (authInfo instanceof Response) {
				lastAuthRejection = {
					ts: operationNow().toISOString(),
					correlation_id: correlationId,
				};
				// Re-wrap challenge so browser SPA can read the 401 body.
				const headers = new Headers(authInfo.headers);
				if (cors !== undefined) {
					for (const [key, value] of Object.entries(cors)) headers.set(key, value);
				}
				return {
					response: new Response(authInfo.body, {
						status: authInfo.status,
						statusText: authInfo.statusText,
						headers,
					}),
					auth: "rejected",
				};
			}
			const subject = typeof authInfo.extra?.subject === "string" ? authInfo.extra.subject : "";
			if (subject === "") {
				lastAuthRejection = {
					ts: operationNow().toISOString(),
					correlation_id: correlationId,
				};
				const challenge = bearerAuthChallengeResponse(
					new OAuthError(OAuthErrorCode.InvalidToken, "Access token is missing sub."),
					{ requiredScopes: [], resourceMetadataUrl },
				);
				const headers = new Headers(challenge.headers);
				if (cors !== undefined) {
					for (const [key, value] of Object.entries(cors)) headers.set(key, value);
				}
				return {
					response: new Response(challenge.body, {
						status: challenge.status,
						statusText: challenge.statusText,
						headers,
					}),
					auth: "rejected",
				};
			}
			// Logged-in only — no seat requirement (sk-pka5.23).
			const response = await servePublicTranscript({
				directory: transcriptDirectory,
				slug: transcriptSlug,
				publicSlugs: publicTranscriptSlugs,
				readFile: options.readTranscriptFile,
				cors,
			});
			return { response, auth: "accepted" };
		}

		// OSM API 0.6 + Overpass — any logged-in user, no seat (like transcripts).
		const worldApi = parseWorldApiPath(requestUrl.pathname);
		if (worldApi !== null) {
			const osmRate = osmRequestLimiter.take("osm");
			if (!osmRate.allowed) {
				return {
					response: rateLimitedResponse(osmRate.retryAfterSeconds),
					auth: "not_applicable",
				};
			}
			if (request.method === "OPTIONS") {
				return {
					response: osmPreflightResponse(request),
					auth: "not_applicable",
				};
			}
			const authInfo = await authenticate(request);
			if (authInfo instanceof Response) {
				lastAuthRejection = {
					ts: operationNow().toISOString(),
					correlation_id: correlationId,
				};
				const headers = new Headers(authInfo.headers);
				for (const [key, value] of Object.entries(osmPreflightResponse(request).headers)) {
					if (key.toLowerCase().startsWith("access-control-")) headers.set(key, value);
				}
				return {
					response: new Response(authInfo.body, {
						status: authInfo.status,
						statusText: authInfo.statusText,
						headers,
					}),
					auth: "rejected",
				};
			}
			const subject = typeof authInfo.extra?.subject === "string" ? authInfo.extra.subject : "";
			if (subject === "") {
				lastAuthRejection = {
					ts: operationNow().toISOString(),
					correlation_id: correlationId,
				};
				return {
					response: bearerAuthChallengeResponse(
						new OAuthError(OAuthErrorCode.InvalidToken, "Access token is missing sub."),
						{ requiredScopes: [], resourceMetadataUrl },
					),
					auth: "rejected",
				};
			}
			// Delegate body to http.ts OSM branch (auth already accepted).
			const response = await mcp.fetch(request);
			return { response, auth: "accepted" };
		}

		// /w/<slug>/… MVT + MapLibre style (sk-adr8.14) — Bearer, no seat.
		const worldTilesPath = parseWorldTilesPath(requestUrl.pathname);
		if (worldTilesPath !== null) {
			if (request.method === "OPTIONS") {
				return { response: tilesPreflightResponse(request), auth: "not_applicable" };
			}
			if (tilesHandlerOptions === undefined) {
				return {
					response: new Response("Not found.", {
						status: 404,
						headers: { ...openTilesCorsHeaders(request), "cache-control": "no-store" },
					}),
					auth: "not_applicable",
				};
			}
			const authInfo = await authenticate(request);
			if (authInfo instanceof Response) {
				lastAuthRejection = {
					ts: operationNow().toISOString(),
					correlation_id: correlationId,
				};
				const headers = new Headers(authInfo.headers);
				for (const [key, value] of Object.entries(openTilesCorsHeaders(request))) {
					headers.set(key, value);
				}
				return {
					response: new Response(authInfo.body, {
						status: authInfo.status,
						statusText: authInfo.statusText,
						headers,
					}),
					auth: "rejected",
				};
			}
			const response = await handleWorldTilesRequest(request, worldTilesPath, tilesHandlerOptions);
			return { response, auth: "accepted" };
		}

		// The Account and Admin API lives in @spellkave/api (api.spellkave.com,
		// ADR-0124). This host never serves /v1/* (sk-jay0.5.18, sk-jay0.7.267).
		if (requestUrl.pathname.startsWith("/v1/")) {
			return { response: new Response("Not found.", { status: 404 }), auth: "not_applicable" };
		}

		const publicRate = requestLimiter.take("public");
		if (!publicRate.allowed) {
			const limited = rateLimitedResponse(publicRate.retryAfterSeconds);
			return {
				response:
					requestUrl.pathname === "/mcp"
						? withMcpCors(request, limited, allowedOriginHostnames)
						: limited,
				auth: "not_applicable",
			};
		}

		if (requestUrl.pathname !== "/mcp") {
			return { response: await mcp.fetch(request), auth: "not_applicable" };
		}

		if (request.method === "OPTIONS") {
			const preflight = mcpPreflightResponse(request, allowedOriginHostnames);
			if (preflight !== undefined) {
				return { response: preflight, auth: "not_applicable" };
			}
		}

		const corsWrap = (response: Response) => withMcpCors(request, response, allowedOriginHostnames);

		const authInfo = await authenticate(request);
		if (authInfo instanceof Response) {
			lastAuthRejection = { ts: operationNow().toISOString(), correlation_id: correlationId };
			return {
				response: corsWrap(authInfo),
				auth: "rejected",
				auth_reason: await bearerRejectionReason(authInfo),
			};
		}
		const subject = typeof authInfo.extra?.subject === "string" ? authInfo.extra.subject : "";
		if (subject === "") {
			lastAuthRejection = { ts: operationNow().toISOString(), correlation_id: correlationId };
			return {
				response: corsWrap(
					bearerAuthChallengeResponse(
						new OAuthError(OAuthErrorCode.InvalidToken, "Access token is missing sub."),
						{ requiredScopes: [], resourceMetadataUrl },
					),
				),
				auth: "rejected",
			};
		}
		// Per-subject `/mcp` budget. spellkave_feedback is exempt so a throttled
		// player can still report the throttle (feedback.ts has its own 3/h cap).
		// Inspect method/name from a cloned body; the live request is not consumed.
		const subjectLimitExempt = await isSpellkaveFeedbackToolsCall(request);
		if (!subjectLimitExempt) {
			const subjectRate = subjectRequestLimiter.take(hashTranscriptSubject(subject));
			if (!subjectRate.allowed) {
				return {
					response: corsWrap(rateLimitedResponse(subjectRate.retryAfterSeconds)),
					auth: "accepted",
				};
			}
		}
		// Wait for one of this subject's in-flight slots. Only a full queue or an
		// expired wait falls through to the 429 the cap used to return outright.
		const slot = await subjectConcurrency.acquire(subject);
		if (slot === undefined) {
			return { response: corsWrap(rateLimitedResponse(1)), auth: "accepted" };
		}
		activeAuthorizedRequests += 1;
		void publishStatus();
		try {
			const response = await withRemoteMcpRequestSubject(subject, () =>
				withRemoteMcpAccessToken(authInfo.token, () => mcp.fetch(request, { authInfo })),
			);
			return { response: corsWrap(response), auth: "accepted" };
		} finally {
			activeAuthorizedRequests -= 1;
			slot.release();
		}
	}

	/**
	 * sk-0m4.120.11: the redacted `http_request` operational log as a run event
	 * on `mcp-<correlation_id>` — status, matched route pattern, duration and
	 * the Cloudflare `CF-Ray` id. Never the URL, query, body or bearer. The
	 * readiness probe (`/healthz`) is left out: it fires every few seconds and
	 * carries no player-facing signal (the doctor measures readiness directly).
	 */
	const exportHttpRequest = (
		request: Request,
		correlationId: string,
		route: string,
		status: number,
		durationMs: number,
	): void => {
		if (route === "/healthz") return;
		const cfRay = request.headers.get("cf-ray")?.trim();
		options.runObserver?.emitHttpRequest?.({
			http_status: status,
			route,
			duration_ms: durationMs,
			correlation_id: correlationId,
			http_method: request.method,
			...(cfRay ? { cf_ray: cfRay } : {}),
		});
	};

	return {
		resource,
		async fetch(request): Promise<Response> {
			const correlationId = createRequestCorrelationId();
			const startedAt = operationNow().getTime();
			let statusCode = 500;
			let auth: "accepted" | "rejected" | "not_applicable" = "not_applicable";
			let authReason: string | undefined;
			const route = safeRoute(new URL(request.url).pathname);
			if (activeRequests >= maxConcurrentRequests) {
				const response = withCorrelationHeader(rateLimitedResponse(1), correlationId);
				emitPlayerMcpOperationLog(
					operationLogger,
					{
						kind: "http_request",
						correlation_id: correlationId,
						method: request.method,
						route,
						status: response.status,
						auth,
						duration_ms: 0,
					},
					operationNow,
				);
				exportHttpRequest(request, correlationId, route, response.status, 0);
				return response;
			}
			activeRequests += 1;
			try {
				const routed = await withRemoteMcpRequestContext(correlationId, () =>
					routeRequest(request, correlationId),
				);
				statusCode = routed.response.status;
				auth = routed.auth;
				authReason = routed.auth_reason;
				return withCorrelationHeader(routed.response, correlationId);
			} finally {
				activeRequests -= 1;
				const durationMs = Math.max(0, operationNow().getTime() - startedAt);
				emitPlayerMcpOperationLog(
					operationLogger,
					{
						kind: "http_request",
						correlation_id: correlationId,
						method: request.method,
						route,
						status: statusCode,
						auth,
						...(authReason === undefined ? {} : { auth_reason: authReason }),
						duration_ms: durationMs,
					},
					operationNow,
				);
				exportHttpRequest(request, correlationId, route, statusCode, durationMs);
				void publishStatus();
			}
		},
		status,
		close: () => mcp.close(),
	};
}

function validatePrivateBinding(binding: SessionBinding): void {
	if (
		[binding.url, binding.db, binding.identity, binding.actorId].some(
			(value) => value.trim() === "",
		)
	) {
		throw new Error("Fixed PLAYER session binding is incomplete");
	}
}

/** Attach one private server-owned binding; the returned gateway never exposes it over HTTP. */
export async function createAttachedPlayerMcpGateway(
	options: AttachedPlayerMcpGatewayOptions,
): Promise<PlayerMcpGatewayService> {
	validatePrivateBinding(options.binding);
	const attach = options.attach ?? attachSessionDaemon;
	const client = await attach(options.binding);
	const operationLogger = options.operationLogger ?? STDERR_PLAYER_MCP_OPERATION_LOGGER;
	const resolveActorFromClient = async () => {
		const maybe = client as PlayerSessionClient & {
			resolveSeatForCurrentRequest?: () => Promise<
				{ actorId: string; worldSlug: string } | undefined
			>;
			routedWorld?: (subject: string) => { slug: string; actorId: string } | undefined;
		};
		if (maybe.resolveSeatForCurrentRequest !== undefined) {
			return maybe.resolveSeatForCurrentRequest();
		}
		// Cached-only fallback (tests / non-JWT clients).
		const subject = currentRemoteMcpRequestSubject();
		if (subject === undefined || maybe.routedWorld === undefined) return undefined;
		const hit = maybe.routedWorld(subject);
		if (hit === undefined) return undefined;
		return { actorId: hit.actorId, worldSlug: hit.slug };
	};
	const runObserver =
		options.runObserver ??
		createRemoteMcpRunObserverFromEnv({
			actorId: options.binding.actorId,
			resolveActor: resolveActorFromClient,
			env: options.env,
			logger: operationLogger,
			...(options.operationNow === undefined ? {} : { now: options.operationNow }),
		});
	// sk-0m4.120.12: hand the router its lifecycle emitter (attach / lost /
	// resubscribed / detach rows) and mark this process start with the deployed
	// revision — the row that tells "pod restarted" from "daemon died".
	const imageTag =
		options.imageTag?.trim() || (options.env ?? process.env).SPELLKAVE_IMAGE_TAG?.trim() || "";
	if (runObserver.emitLifecycle !== undefined) {
		(client as PlayerSessionClient).bindLifecycle?.(runObserver.emitLifecycle);
		runObserver.emitLifecycle("gateway_start", { image_tag: imageTag });
	}
	const readiness =
		options.readiness ??
		(client.status === undefined
			? undefined
			: async () => {
					try {
						const daemonStatus = await client.status?.();
						return daemonStatus?.ok === true && daemonStatus.result.subscribed;
					} catch {
						return false;
					}
				});
	const statusWriter =
		options.statusWriter ??
		createPrivateStatusFileWriter<PlayerMcpGatewayStatus>(
			defaultMcpStatusPath(options.env ?? process.env),
		);
	const feedbackSink =
		options.feedback?.sink ?? (await createFeedbackSinkFromEnv(options.env ?? process.env));
	const feedback: FeedbackToolOptions = {
		...(options.feedback ?? {}),
		sink: feedbackSink,
		resolveSeat: options.feedback?.resolveSeat ?? resolveActorFromClient,
	};
	const env = options.env ?? process.env;
	const mapsBaseUrl =
		normalizeMapsBaseUrl(options.mapLink?.mapsBaseUrl) ??
		normalizeMapsBaseUrl(env.SPELLKAVE_MAPS_URL);
	const mapLink: MapDeepLinkOptions | undefined =
		mapsBaseUrl === undefined
			? undefined
			: {
					mapsBaseUrl,
					resolveWorldSlug:
						options.mapLink?.resolveWorldSlug ??
						(async () => {
							const seat = await resolveActorFromClient();
							return seat?.worldSlug;
						}),
				};
	const gateway = createPlayerMcpGateway({
		resourceConfig: {
			...options.resourceConfig,
			...(options.now === undefined ? {} : { now: options.now }),
		},
		client,
		feedback,
		...(mapLink === undefined ? {} : { mapLink }),
		...(options.resolveClient === undefined ? {} : { resolveClient: options.resolveClient }),
		allowedHostnames: options.allowedHostnames,
		allowedOriginHostnames: options.allowedOriginHostnames,
		maxBodyBytes: options.maxBodyBytes,
		requestTimeoutMs: options.requestTimeoutMs,
		requestRateLimit: options.requestRateLimit,
		subjectRequestRateLimit: options.subjectRequestRateLimit,
		maxConcurrentRequests: options.maxConcurrentRequests,
		maxConcurrentRequestsPerSubject: options.maxConcurrentRequestsPerSubject,
		subjectQueueDepth: options.subjectQueueDepth,
		subjectQueueWaitMs: options.subjectQueueWaitMs,
		trustForwardedHeaders: options.trustForwardedHeaders,
		readiness,
		now: options.now,
		operationNow: options.operationNow,
		operationLogger,
		runObserver,
		transcriptRecorder: options.transcriptRecorder,
		transcriptDirectory: options.transcriptDirectory,
		publicTranscriptSlugs: options.publicTranscriptSlugs,
		readTranscriptFile: options.readTranscriptFile,
		statusWriter,
		...(options.osmCache === undefined ? {} : { osmCache: options.osmCache }),
		...(options.osmWorldSlugs === undefined ? {} : { osmWorldSlugs: options.osmWorldSlugs }),
		worldTiles: options.worldTiles,
	});
	void (async () => {
		try {
			await statusWriter(await gateway.status());
		} catch {
			// Startup remains available even when the operator snapshot is unavailable.
		}
	})();
	return gateway;
}
