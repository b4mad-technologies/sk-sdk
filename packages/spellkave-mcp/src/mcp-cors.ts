/**
 * Browser CORS for POST /mcp (Streamable HTTP). Distinct from
 * `websiteCorsHeaders` (transcripts, GET/OPTIONS + credentials).
 *
 * Origin hostname must already have passed `originValidationResponse`.
 * No `Access-Control-Allow-Credentials` — the browser sends Bearer, not cookies.
 */

const ALLOW_METHODS = "POST, GET, DELETE, OPTIONS";
const ALLOW_HEADERS =
	"Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID";
const EXPOSE_HEADERS = "Mcp-Session-Id, Mcp-Protocol-Version";
const MAX_AGE = "600";

export interface McpCorsHeaders {
	"access-control-allow-origin": string;
	"access-control-expose-headers": string;
	vary: string;
}

function originHostname(origin: string): string | undefined {
	try {
		return new URL(origin).hostname.toLowerCase();
	} catch {
		return undefined;
	}
}

/** ACAO + Expose + Vary when Origin hostname is on the allowlist. */
export function mcpCorsHeaders(
	request: Request,
	allowedOriginHostnames: readonly string[],
): McpCorsHeaders | undefined {
	const origin = request.headers.get("origin");
	if (origin === null || origin === "") return undefined;
	const hostname = originHostname(origin);
	if (hostname === undefined) return undefined;
	const allowed = allowedOriginHostnames.map((entry) => entry.toLowerCase());
	if (!allowed.includes(hostname)) return undefined;
	return {
		"access-control-allow-origin": origin,
		"access-control-expose-headers": EXPOSE_HEADERS,
		vary: "Origin",
	};
}

/** 204 preflight for an allowlisted Origin; undefined when there is nothing to grant. */
export function mcpPreflightResponse(
	request: Request,
	allowedOriginHostnames: readonly string[],
): Response | undefined {
	const cors = mcpCorsHeaders(request, allowedOriginHostnames);
	if (cors === undefined) return undefined;
	return new Response(null, {
		status: 204,
		headers: {
			...cors,
			"access-control-allow-methods": ALLOW_METHODS,
			"access-control-allow-headers": ALLOW_HEADERS,
			"access-control-max-age": MAX_AGE,
		},
	});
}

export function withMcpCors(
	request: Request,
	response: Response,
	allowedOriginHostnames: readonly string[],
): Response {
	const cors = mcpCorsHeaders(request, allowedOriginHostnames);
	if (cors === undefined) return response;
	const headers = new Headers(response.headers);
	headers.set("access-control-allow-origin", cors["access-control-allow-origin"]);
	headers.set("access-control-expose-headers", cors["access-control-expose-headers"]);
	headers.set("vary", cors.vary);
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}
