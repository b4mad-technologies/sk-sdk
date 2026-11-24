import { AsyncLocalStorage } from "node:async_hooks";
import { type NodeMcpRequestHandler, toNodeHandler } from "@modelcontextprotocol/node";
import {
	createMcpHandler,
	hostHeaderValidationResponse,
	isJsonContentType,
	localhostAllowedHostnames,
	localhostAllowedOrigins,
	type McpHandlerRequestOptions,
	type McpHttpHandler,
	originValidationResponse,
} from "@modelcontextprotocol/server";
import {
	AmbiguousAuthorityWorldError,
	requestBodyTooLarge,
	SeatClaimProbeError,
	SeatClaimUnavailableError,
} from "@spellkave/gateway-identity";
import { DOCS_TOOL, type DocsVersionEvidence, getToolContract } from "@spellkave/tool-contracts";
import {
	createSessionToolHandler,
	type MapDeepLinkOptions,
	type PlayerSessionClient,
} from "./daemon-handler.ts";
import type { FeedbackToolOptions } from "./feedback.ts";
import type { RemoteMcpRunObserver } from "./observability.ts";
import { parseWorldApiPath, serveOsmApi } from "./osm-api.ts";
import type { WorldOsmCache } from "./osm-model.ts";
import { serveOverpass } from "./overpass.ts";

// World tiles (/w/<slug>/…) are Bearer-gated in gateway.ts (open CORS), same
// pattern as GET /transcripts/* — keep this file free of auth/catalog wiring.
export { parseWorldTilesPath } from "./tiles.ts";

import { createPlayerMcpServer } from "./tools.ts";
import type { PublicTranscriptRecorder } from "./transcript.ts";

// JSON escaping can expand a 1 MiB decoded source by up to six times.
// The portable source adapter still enforces the separate decoded 1 MiB cap.
export const DEFAULT_MCP_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 15_000;

export interface PlayerMcpHttpOptions {
	client: PlayerSessionClient;
	/** Optional verdict from an already-authorized host context; docs never obtains it. */
	docsVersionEvidence?: Readonly<DocsVersionEvidence>;
	allowedHostnames?: string[];
	allowedOriginHostnames?: string[];
	maxBodyBytes?: number;
	requestTimeoutMs?: number;
	readiness?: () => boolean | Promise<boolean>;
	runObserver?: RemoteMcpRunObserver;
	/** Public spectator transcript for catalog seats flagged `publicTranscript`. */
	transcriptRecorder?: PublicTranscriptRecorder;
	/** Per-world OSM export cache (ADR-0123 / sk-adr8.13). */
	osmCache?: WorldOsmCache;
	/** Catalog slugs the OSM routes may serve (any running catalog world). */
	osmWorldSlugs?: ReadonlySet<string>;
	/** Gateway-local spellkave_feedback sink + rate limit (sk-rax8.5). */
	feedback?: FeedbackToolOptions;
	/** Optional maps.spellkave.com deep link on spellkave_map results. */
	mapLink?: MapDeepLinkOptions;
}

export interface PlayerMcpHttpService {
	fetch(request: Request, options?: McpHandlerRequestOptions): Promise<Response>;
	close(): Promise<void>;
}

function jsonRpcError(status: number, code: number, message: string): Response {
	return Response.json(
		{ jsonrpc: "2.0", error: { code, message }, id: null },
		{ status, headers: { "content-type": "application/json" } },
	);
}

async function withTimeout(operation: Promise<Response>, timeoutMs: number): Promise<Response> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		return await Promise.race([
			operation,
			new Promise<Response>((resolve) => {
				timer = setTimeout(
					() => resolve(jsonRpcError(504, -32_000, "MCP request timed out.")),
					timeoutMs,
				);
			}),
		]);
	} finally {
		if (timer !== undefined) clearTimeout(timer);
	}
}

async function materializeResponse(responsePromise: Promise<Response>): Promise<Response> {
	const response = await responsePromise;
	if (response.body === null) return response;
	const body = await response.arrayBuffer();
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

async function healthResponse(
	readiness: (() => boolean | Promise<boolean>) | undefined,
): Promise<Response> {
	let ready = false;
	try {
		ready = (await readiness?.()) ?? true;
	} catch {
		ready = false;
	}
	return Response.json(
		{ service: "spellkave-player-mcp", status: ready ? "ok" : "unavailable" },
		{ status: ready ? 200 : 503 },
	);
}

/** Stateless fetch-shaped Remote MCP service, suitable for Node and fetch-native hosts. */
export function createPlayerMcpHttpService(options: PlayerMcpHttpOptions): PlayerMcpHttpService {
	const allowedHostnames = options.allowedHostnames ?? localhostAllowedHostnames();
	const allowedOriginHostnames = options.allowedOriginHostnames ?? localhostAllowedOrigins();
	const maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MCP_MAX_BODY_BYTES;
	const requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_MCP_REQUEST_TIMEOUT_MS;
	if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1) {
		throw new Error("requestTimeoutMs must be a positive integer");
	}
	const toolHandler = createSessionToolHandler(
		options.client,
		options.runObserver,
		options.transcriptRecorder,
		undefined,
		options.feedback,
		options.mapLink,
	);
	// Request-local discovery avoids a second probe and cannot cache another caller's roster.
	const requestRoster = new AsyncLocalStorage<{
		toolNames?: readonly string[];
		toolName?: string;
	}>();
	const mcp: McpHttpHandler = createMcpHandler(
		() =>
			createPlayerMcpServer(
				toolHandler,
				undefined,
				requestRoster.getStore()?.toolNames,
				options.docsVersionEvidence,
				requestRoster.getStore()?.toolName,
			),
		{
			legacy: "stateless",
			maxRequestBodySize: maxBodyBytes,
		},
	);
	const osmCache = options.osmCache;
	const osmWorldSlugs = options.osmWorldSlugs ?? new Set<string>();

	return {
		async fetch(request, requestOptions): Promise<Response> {
			const pathname = new URL(request.url).pathname;
			const worldApi = parseWorldApiPath(pathname);
			// OSM tools need open CORS — Host still enforced, Origin allowlist skipped.
			const rejected =
				hostHeaderValidationResponse(request, allowedHostnames) ??
				(worldApi !== null ? undefined : originValidationResponse(request, allowedOriginHostnames));
			if (rejected !== undefined) return rejected;

			if (pathname === "/healthz") {
				if (request.method !== "GET") return new Response("Method not allowed.", { status: 405 });
				return healthResponse(options.readiness);
			}
			// OSM API 0.6 + Overpass under /w/<slug>/api/* (auth enforced by gateway).
			if (worldApi !== null) {
				if (osmCache === undefined) {
					return new Response("OSM endpoints not configured.", { status: 503 });
				}
				const catalogHasSlug = osmWorldSlugs.has(worldApi.slug);
				if (worldApi.kind === "interpreter") {
					return serveOverpass(request, {
						cache: osmCache,
						slug: worldApi.slug,
						catalogHasSlug,
					});
				}
				return serveOsmApi(request, {
					cache: osmCache,
					slug: worldApi.slug,
					rest: worldApi.rest || "/",
					catalogHasSlug,
				});
			}
			if (pathname !== "/mcp") return new Response("Not found.", { status: 404 });
			if (request.method === "POST") {
				if (!isJsonContentType(request.headers.get("content-type"))) {
					return jsonRpcError(415, -32_600, "Content-Type must be application/json.");
				}
				if (await requestBodyTooLarge(request, maxBodyBytes)) {
					return jsonRpcError(413, -32_600, "MCP request body is too large.");
				}
			}
			return withTimeout(
				(async () => {
					try {
						// Curated help and initialization do not depend on world admission.
						const rpc =
							request.method === "POST"
								? await request
										.clone()
										.json()
										.catch(() => null)
								: null;
						const publicRequest =
							rpc !== null &&
							typeof rpc === "object" &&
							"method" in rpc &&
							(rpc.method === "initialize" ||
								(rpc.method === "tools/call" &&
									"params" in rpc &&
									rpc.params !== null &&
									typeof rpc.params === "object" &&
									"name" in rpc.params &&
									rpc.params.name === DOCS_TOOL));
						const listed = publicRequest ? undefined : await options.client.toolNames?.();
						if (listed !== undefined && !listed.ok) throw new Error(listed.error.message);
						return requestRoster.run(
							{
								toolNames: listed?.ok ? listed.result : undefined,
								toolName:
									rpc !== null &&
									typeof rpc === "object" &&
									"method" in rpc &&
									rpc.method === "tools/call" &&
									"params" in rpc &&
									rpc.params !== null &&
									typeof rpc.params === "object" &&
									"name" in rpc.params &&
									typeof rpc.params.name === "string"
										? rpc.params.name
										: undefined,
							},
							() => materializeResponse(mcp.fetch(request, requestOptions)),
						);
					} catch (error) {
						if (
							!(error instanceof AmbiguousAuthorityWorldError) &&
							!(error instanceof SeatClaimUnavailableError) &&
							!(error instanceof SeatClaimProbeError)
						)
							return jsonRpcError(500, -32_603, "Internal server error.");
						let id: unknown = null;
						if (request.method === "POST") {
							try {
								const body: unknown = await request.clone().json();
								if (body !== null && typeof body === "object" && "id" in body) id = body.id;
							} catch {}
						}
						return Response.json({
							jsonrpc: "2.0",
							id,
							error: {
								code: -32_000,
								message: error.message,
								data: {
									code: error.code,
									// Preserve typed routing refusal while making public help discoverable.
									public_tools: [
										{ name: DOCS_TOOL, inputSchema: getToolContract(DOCS_TOOL).parameters },
									],
								},
							},
						});
					}
				})(),
				requestTimeoutMs,
			);
		},
		close: () => mcp.close(),
	};
}

/** Official Node adapter for plain `node:http`, Express, or compatible servers. */
export function createPlayerMcpNodeHandler(service: PlayerMcpHttpService): NodeMcpRequestHandler {
	return toNodeHandler(service, { maxRequestBodySize: DEFAULT_MCP_MAX_BODY_BYTES });
}
