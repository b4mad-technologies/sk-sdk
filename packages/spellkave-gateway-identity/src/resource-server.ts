import { type AuthInfo, OAuthError, OAuthErrorCode } from "@modelcontextprotocol/server";

import {
	fetchJwks,
	type JsonWebKeyWithKid,
	JwksUnavailableError,
	TokenError,
	UNKNOWN_KID_CODE,
	verifyAccessToken,
} from "./jwt.ts";
import { issuedBeforeCutoff, type LogoutCutoff } from "./logout-cutoff.ts";

/**
 * Historical marker only. WorkOS DCR/CIMD clients cannot request custom
 * scopes reliably (Claude.ai invalid_scope). Auth boundary is JWT signature +
 * iss + aud of the MCP resource — not this string. Kept exported so older
 * imports compile; do not put it in PRM or requiredScopes.
 */
export const PLAYER_TOOLS_SCOPE = "player:tools";

/** OIDC scopes advertised on protected-resource metadata (Claude-compatible). */
export const PLAYER_OAUTH_SCOPES_SUPPORTED = [
	"openid",
	"profile",
	"email",
	"offline_access",
] as const;

export const PRM_PATH = "/.well-known/oauth-protected-resource";
export const PRM_MCP_PATH = "/.well-known/oauth-protected-resource/mcp";
/** AuthKit JWKS path: `{issuer}/oauth2/jwks`. */
export const AUTHKIT_JWKS_PATH = "/oauth2/jwks";

export interface PlayerResourceServerConfig {
	canonicalOrigin: string;
	issuer: string;
	jwks?: readonly JsonWebKeyWithKid[];
	fetchJwks?: (jwksUri: string) => Promise<JsonWebKeyWithKid[]>;
	now?: () => number;
	/**
	 * Sink for the one-line JSON diagnostic emitted when the JWKS endpoint is
	 * unreachable — that failure answers 500, so it must leave a trace an
	 * operator can find. Defaults to stderr; tests inject a spy.
	 */
	logJwksFailure?: (record: Record<string, unknown>) => void;
	/**
	 * ADR-0161 D-7 step 4: rejects tokens issued before the person's last
	 * "sign out everywhere". Absent = no cutoff (local dev, tests).
	 */
	logoutCutoff?: LogoutCutoff;
}

export function mcpResourceUrl(canonicalOrigin: string): string {
	return `${new URL(canonicalOrigin).origin}/mcp`;
}

export function protectedResourceMetadataUrl(canonicalOrigin: string): string {
	return `${new URL(canonicalOrigin).origin}${PRM_PATH}`;
}

export function wwwAuthenticate(canonicalOrigin: string): string {
	return `Bearer realm="mcp", resource_metadata="${protectedResourceMetadataUrl(canonicalOrigin)}"`;
}

export function protectedResourceMetadata(
	config: PlayerResourceServerConfig,
): Record<string, unknown> {
	return {
		resource: mcpResourceUrl(config.canonicalOrigin),
		authorization_servers: [config.issuer],
		bearer_methods_supported: ["header"],
		scopes_supported: [...PLAYER_OAUTH_SCOPES_SUPPORTED],
	};
}

export function unauthorizedResponse(canonicalOrigin: string, description: string): Response {
	return new Response(JSON.stringify({ error: "invalid_token", error_description: description }), {
		status: 401,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
			"www-authenticate": wwwAuthenticate(canonicalOrigin),
		},
	});
}

export interface PlayerJwtVerifier {
	verifyAccessToken(token: string): Promise<AuthInfo>;
}

export function createPlayerJwtVerifier(config: PlayerResourceServerConfig): PlayerJwtVerifier {
	const issuer = config.issuer.replace(/\/$/, "");
	const audience = mcpResourceUrl(config.canonicalOrigin);
	// AuthKit publishes JWKS at {issuer}/oauth2/jwks (not /oauth2/v1/keys).
	const jwksUri = `${issuer}${AUTHKIT_JWKS_PATH}`;

	let cached = config.jwks === undefined ? undefined : [...config.jwks];
	const loadJwks = config.fetchJwks ?? fetchJwks;
	const logJwksFailure =
		config.logJwksFailure ??
		((record: Record<string, unknown>) => {
			process.stderr.write(`${JSON.stringify(record)}\n`);
		});

	/**
	 * Load the JWKS, turning every infrastructure fault into a LOGGED
	 * `server_error`. `requireBearerAuth` maps `server_error` to 500 and
	 * anything else it doesn't know to 400, so 503/`temporarily_unavailable`
	 * is not reachable on this route (the API-key route has that shape, see
	 * `apiKeyUnauthorizedResponse`). What matters is that a JWKS outage stays
	 * distinguishable from a bad token — it is never a 401 — and leaves a
	 * `jwks_unavailable` line behind instead of a bare stack.
	 */
	async function load(reason: "initial" | "kid_refresh"): Promise<JsonWebKeyWithKid[]> {
		try {
			return await loadJwks(jwksUri);
		} catch (error) {
			logJwksFailure({
				event: "jwks_unavailable",
				jwks_uri: jwksUri,
				issuer,
				reason,
				error: error instanceof Error ? error.message : String(error),
			});
			throw new OAuthError(
				OAuthErrorCode.ServerError,
				error instanceof JwksUnavailableError
					? error.message
					: `JWKS could not be loaded from ${jwksUri}`,
			);
		}
	}

	return {
		async verifyAccessToken(token: string): Promise<AuthInfo> {
			if (cached === undefined) cached = await load("initial");
			const verify = async (jwks: readonly JsonWebKeyWithKid[]) =>
				verifyAccessToken(token, { issuer, audience, jwks, now: config.now?.() });
			let payload: Record<string, unknown>;
			try {
				payload = await verify(cached);
			} catch (error) {
				if (!(error instanceof TokenError)) throw error;
				// An unknown kid may just be key rotation: refetch once, then
				// accept the verdict. The retry lives INSIDE a try/catch —
				// when it was outside, a token from a foreign issuer (whose
				// kid can never be in our JWKS) escaped as a raw TokenError
				// and the bearer middleware answered 500 server_error.
				if (error.code !== UNKNOWN_KID_CODE) {
					throw new OAuthError(OAuthErrorCode.InvalidToken, error.message);
				}
				cached = await load("kid_refresh");
				try {
					payload = await verify(cached);
				} catch (retryError) {
					if (retryError instanceof TokenError) {
						throw new OAuthError(OAuthErrorCode.InvalidToken, retryError.message);
					}
					throw retryError;
				}
			}
			const sub = payload.sub;
			if (typeof sub !== "string") {
				throw new OAuthError(OAuthErrorCode.InvalidToken, "missing sub");
			}
			if (config.logoutCutoff !== undefined) {
				const cutoff = await config.logoutCutoff.notBefore(sub);
				if (cutoff !== undefined && issuedBeforeCutoff(payload, cutoff)) {
					throw new OAuthError(OAuthErrorCode.InvalidToken, "token was issued before sign-out");
				}
			}
			const scopeClaim = typeof payload.scope === "string" ? payload.scope.trim() : "";
			const scopes =
				scopeClaim === ""
					? [...PLAYER_OAUTH_SCOPES_SUPPORTED]
					: scopeClaim.split(/\s+/).filter((part) => part.length > 0);
			// WorkOS env JWT template `{"roles": {{organization_membership.roles}}}`
			// (sk-jay0.5.14.10): verified array of role slugs, e.g. ["operator"].
			// Absent/non-array/non-string entries all collapse to [] — never throw
			// on a malformed roles claim.
			const rolesClaim = payload.roles;
			const roles = Array.isArray(rolesClaim)
				? rolesClaim.filter((role): role is string => typeof role === "string")
				: [];
			return {
				token,
				clientId: typeof payload.azp === "string" ? payload.azp : issuer,
				scopes,
				expiresAt: typeof payload.exp === "number" ? payload.exp : undefined,
				resource: new URL(audience),
				extra: {
					subject: sub,
					...(typeof payload.org_id === "string" && payload.org_id.trim() !== ""
						? { org_id: payload.org_id.trim() }
						: {}),
					...(roles.length > 0 ? { roles } : {}),
				},
			};
		},
	};
}

export function resourceServerFetch(
	config: PlayerResourceServerConfig,
	request: Request,
): Response | undefined {
	const pathname = new URL(request.url).pathname;
	if (pathname !== PRM_PATH && pathname !== PRM_MCP_PATH) return undefined;
	if (request.method !== "GET" && request.method !== "HEAD") {
		return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
	}
	return new Response(JSON.stringify(protectedResourceMetadata(config)), {
		status: 200,
		headers: {
			"content-type": "application/json",
			"cache-control": "no-store",
		},
	});
}
