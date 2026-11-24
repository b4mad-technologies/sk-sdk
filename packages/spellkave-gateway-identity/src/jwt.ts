/**
 * WorkOS AuthKit access-token verification for the PLAYER MCP resource server.
 * Checks signature (JWKS), iss, aud, exp. Never logs the raw token.
 * Ported from sandbox/workos-mcp-spike/src/jwt.mjs.
 */

const encoder = new TextEncoder();

/** Accept tokens up to this far past `exp` (AuthKit/clock skew). */
export const ACCESS_TOKEN_CLOCK_SKEW_MS = 60_000;

/**
 * `TokenError.code` for "the signing key this token names is not in the JWKS
 * we hold". The verifier refetches the JWKS once on this code (key rotation)
 * before giving up — matching on the code, not on the message text.
 */
export const UNKNOWN_KID_CODE = "unknown_kid";

export class TokenError extends Error {
	readonly code: string;

	constructor(code: string, message: string) {
		super(message);
		this.code = code;
		this.name = "TokenError";
	}
}

/**
 * The JWKS endpoint could not be consulted — DNS/TCP/TLS failure, a 5xx from
 * the issuer, or a body with no keys. This is an INFRASTRUCTURE fault, not a
 * verdict about the token, so callers must NOT map it to 401: a caller holding
 * a perfectly good token would then be told its token is bad. Kept distinct
 * from {@link TokenError} for exactly that reason (sk-jay0.5.14.x).
 */
export class JwksUnavailableError extends Error {
	readonly code = "jwks_unavailable";

	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "JwksUnavailableError";
	}
}

export type JsonWebKeyWithKid = {
	kid?: string;
	alg?: string;
	use?: string;
	kty?: string;
	n?: string;
	e?: string;
	[key: string]: unknown;
};

function b64urlToBytes(input: string): Uint8Array<ArrayBuffer> {
	const pad = "=".repeat((4 - (input.length % 4)) % 4);
	return new Uint8Array(Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64"));
}

function decodeJsonPart(part: string): Record<string, unknown> {
	return JSON.parse(Buffer.from(b64urlToBytes(part)).toString("utf8")) as Record<string, unknown>;
}

export function decodeJwtUnverified(token: string): {
	header: Record<string, unknown>;
	payload: Record<string, unknown>;
	signingInput: string;
	signature: Uint8Array<ArrayBuffer>;
} {
	const [header, payload, signature, ...extra] = token.split(".");
	if (
		header === undefined ||
		payload === undefined ||
		signature === undefined ||
		extra.length > 0
	) {
		throw new TokenError("invalid_token", "JWT must have three parts");
	}
	try {
		return {
			header: decodeJsonPart(header),
			payload: decodeJsonPart(payload),
			signingInput: `${header}.${payload}`,
			signature: b64urlToBytes(signature),
		};
	} catch {
		// A JWT-shaped string whose segments are not base64url JSON is a bad
		// token, not a server fault — never let the SyntaxError escape as 500.
		throw new TokenError("invalid_token", "JWT header or payload is not base64url JSON");
	}
}

export function audienceList(aud: unknown): string[] {
	if (aud === undefined || aud === null) return [];
	if (typeof aud === "string") return [aud];
	if (Array.isArray(aud)) return aud.filter((value): value is string => typeof value === "string");
	return [];
}

export function redactClaims(payload: Record<string, unknown>): Record<string, unknown> {
	return {
		iss: payload.iss ?? null,
		aud: payload.aud ?? null,
		sub_prefix: typeof payload.sub === "string" ? payload.sub.slice(0, 8) : null,
		azp: payload.azp ?? null,
		exp: payload.exp ?? null,
		iat: payload.iat ?? null,
	};
}

async function importRsaJwk(jwk: JsonWebKeyWithKid) {
	return crypto.subtle.importKey(
		"jwk",
		jwk as never,
		{ name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
		false,
		["verify"],
	);
}

export async function fetchJwks(jwksUri: string): Promise<JsonWebKeyWithKid[]> {
	let response: Response;
	try {
		response = await fetch(jwksUri);
	} catch (error) {
		throw new JwksUnavailableError(`JWKS fetch failed for ${jwksUri}`, { cause: error });
	}
	if (!response.ok) {
		throw new JwksUnavailableError(`JWKS HTTP ${response.status} from ${jwksUri}`);
	}
	let body: { keys?: JsonWebKeyWithKid[] };
	try {
		body = (await response.json()) as { keys?: JsonWebKeyWithKid[] };
	} catch (error) {
		throw new JwksUnavailableError(`JWKS body from ${jwksUri} is not JSON`, { cause: error });
	}
	if (!Array.isArray(body.keys) || body.keys.length === 0) {
		throw new JwksUnavailableError(`JWKS from ${jwksUri} has no keys`);
	}
	return body.keys;
}

export async function verifyAccessToken(
	token: string,
	options: {
		issuer: string;
		audience?: string;
		audiences?: readonly string[];
		/** User Management access tokens carry no resource audience; their
		 * verifier checks issuer, signature, expiry and `sid` instead. */
		skipAudienceCheck?: boolean;
		jwks: readonly JsonWebKeyWithKid[];
		now?: number;
	},
): Promise<Record<string, unknown>> {
	const allowed = options.audiences ?? (options.audience === undefined ? [] : [options.audience]);
	const decoded = decodeJwtUnverified(token);
	if (decoded.header.alg !== "RS256") {
		throw new TokenError("invalid_token", `unsupported alg ${String(decoded.header.alg)}`);
	}
	// `iss` first, BEFORE the JWKS kid lookup. A token minted by another
	// environment's issuer carries that issuer's kid, so a kid-first order
	// reported "no matching JWKS kid" (and burned a JWKS refetch) for what is
	// really a wrong-environment token. Naming the issuer is the whole signal
	// an operator needs; the configured issuer is already public in the
	// protected-resource metadata, so echoing it leaks nothing.
	if (decoded.payload.iss !== options.issuer) {
		throw new TokenError(
			"invalid_token",
			`token issuer ${String(decoded.payload.iss)} is not the configured issuer ${options.issuer}`,
		);
	}
	const kid = typeof decoded.header.kid === "string" ? decoded.header.kid : undefined;
	const key =
		(kid === undefined
			? options.jwks.length === 1
				? options.jwks[0]
				: undefined
			: options.jwks.find((entry) => entry.kid === kid)) ?? undefined;
	if (key === undefined) {
		throw new TokenError(
			UNKNOWN_KID_CODE,
			`no JWKS key matches token kid ${kid === undefined ? "<absent>" : kid} published by issuer ${options.issuer}`,
		);
	}
	const cryptoKey = await importRsaJwk(key);
	const ok = await crypto.subtle.verify(
		"RSASSA-PKCS1-v1_5",
		cryptoKey,
		decoded.signature,
		encoder.encode(decoded.signingInput),
	);
	if (!ok) throw new TokenError("invalid_token", "signature mismatch");
	const { payload } = decoded;
	// `iss` was already checked above, before the JWKS lookup.
	const audiences = audienceList(payload.aud);
	if (options.skipAudienceCheck !== true && !audiences.some((aud) => allowed.includes(aud))) {
		throw new TokenError("invalid_token", `aud mismatch (want one of ${allowed.join(", ")})`);
	}
	const now = options.now ?? Date.now();
	if (typeof payload.exp !== "number" || payload.exp * 1000 + ACCESS_TOKEN_CLOCK_SKEW_MS <= now) {
		throw new TokenError("invalid_token", "token expired");
	}
	if (typeof payload.sub !== "string" || payload.sub.length === 0) {
		throw new TokenError("invalid_token", "missing sub");
	}
	return payload;
}
