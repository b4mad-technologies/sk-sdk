/**
 * WorkOS User Management (UM) access-token verification for the login site
 * (ADR-0161 D-2, bead sk-jay0.5.14.5.3).
 *
 * The login site authenticates people over the UM API and keeps the UM
 * session (refresh token + `sid`) in a sealed cookie. Every UM access token
 * it receives — from a password, Magic Auth, email-verification, social or
 * refresh grant — is verified here before its `sub` and `sid` are trusted:
 * RS256 signature against the client's JWKS, exact issuer, expiry, `sub` and
 * `sid` present. UM tokens are not resource tokens, so there is no audience
 * check; they never authorize a world call (the Connect token minted by
 * `POST /authkit/oauth2/complete` does).
 *
 * Issuer and JWKS shapes (observed in WorkOS staging 2026-10-16, ADR-0161):
 *   iss  = https://api.workos.com/user_management/<client_id>
 *   JWKS = https://api.workos.com/sso/jwks/<client_id>
 * Never logs the raw token.
 */

import {
	fetchJwks,
	type JsonWebKeyWithKid,
	JwksUnavailableError,
	TokenError,
	UNKNOWN_KID_CODE,
	verifyAccessToken,
} from "./jwt.ts";

export const WORKOS_API_BASE_URL = "https://api.workos.com";

export interface UserManagementTokenClaims {
	sub: string;
	sid: string;
	iat?: number;
	exp: number;
	org_id?: string;
}

export interface UserManagementTokenVerifier {
	readonly issuer: string;
	readonly jwksUri: string;
	/** Throws {@link TokenError} for a bad token, {@link JwksUnavailableError} when the JWKS cannot be read. */
	verify(token: string): Promise<UserManagementTokenClaims>;
}

export interface UserManagementTokenVerifierOptions {
	clientId: string;
	apiBaseUrl?: string;
	jwks?: readonly JsonWebKeyWithKid[];
	fetchJwks?: (jwksUri: string) => Promise<JsonWebKeyWithKid[]>;
	now?: () => number;
}

export function userManagementIssuer(clientId: string, apiBaseUrl = WORKOS_API_BASE_URL): string {
	return `${apiBaseUrl.replace(/\/$/, "")}/user_management/${clientId}`;
}

export function userManagementJwksUri(clientId: string, apiBaseUrl = WORKOS_API_BASE_URL): string {
	return `${apiBaseUrl.replace(/\/$/, "")}/sso/jwks/${clientId}`;
}

export function createUserManagementTokenVerifier(
	options: UserManagementTokenVerifierOptions,
): UserManagementTokenVerifier {
	const clientId = options.clientId.trim();
	if (!/^client_[A-Za-z0-9]+$/.test(clientId)) {
		throw new Error("WorkOS User Management client id must look like client_<id>");
	}
	const issuer = userManagementIssuer(clientId, options.apiBaseUrl);
	const jwksUri = userManagementJwksUri(clientId, options.apiBaseUrl);
	const load = options.fetchJwks ?? fetchJwks;
	let cached = options.jwks === undefined ? undefined : [...options.jwks];

	async function check(token: string, jwks: readonly JsonWebKeyWithKid[]) {
		return verifyAccessToken(token, {
			issuer,
			skipAudienceCheck: true,
			jwks,
			...(options.now === undefined ? {} : { now: options.now() }),
		});
	}

	return {
		issuer,
		jwksUri,
		async verify(token) {
			if (cached === undefined) cached = await load(jwksUri);
			let payload: Record<string, unknown>;
			try {
				payload = await check(token, cached);
			} catch (error) {
				if (!(error instanceof TokenError) || error.code !== UNKNOWN_KID_CODE) throw error;
				// Unknown kid may be key rotation: refetch once, then accept the verdict.
				cached = await load(jwksUri);
				payload = await check(token, cached);
			}
			if (typeof payload.sid !== "string" || payload.sid === "") {
				throw new TokenError("invalid_token", "missing sid");
			}
			return {
				sub: payload.sub as string,
				sid: payload.sid,
				exp: payload.exp as number,
				...(typeof payload.iat === "number" ? { iat: payload.iat } : {}),
				...(typeof payload.org_id === "string" && payload.org_id !== ""
					? { org_id: payload.org_id }
					: {}),
			};
		},
	};
}

export { JwksUnavailableError };
