// The token checks a gateway cannot show from outside. The Account API
// behaviour suite (packages/spellkave-api/behaviour/contract.feature) proves
// the rest through a real request: wrong issuer, audience, expiry, missing
// sub, an unknown key and a JWKS outage. What stays here: the guard for a
// bearer whose segments are not JSON (a gateway sends such a bearer to the
// API-key path first) and the 60 s expiry leeway, which the gateways' bearer
// middleware never lets through (sk-jay0.5.14.20). Each case signs a real
// RS256 token with a key made in the test; no network.

import { describe, expect, it } from "vitest";

import { TokenError, verifyAccessToken } from "../jwt.ts";

const encoder = new TextEncoder();

/** Minimal RS256 signer — mirrors the player-mcp test helper. */
async function createSigner(kid: string) {
	const pair = await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: new Uint8Array([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	);
	const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<
		string,
		unknown
	>;
	publicJwk.kid = kid;
	publicJwk.use = "sig";
	publicJwk.alg = "RS256";
	return {
		publicJwk,
		async sign(claims: Record<string, unknown>): Promise<string> {
			const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString(
				"base64url",
			);
			const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
			const signingInput = `${header}.${payload}`;
			const sig = await crypto.subtle.sign(
				"RSASSA-PKCS1-v1_5",
				pair.privateKey,
				encoder.encode(signingInput),
			);
			return `${signingInput}.${Buffer.from(sig).toString("base64url")}`;
		},
	};
}

const issuer = "https://authkit.prod.example.test";
const audience = "https://mcp.example.test/mcp";
const now = 1_700_000_000;

describe("checks no gateway request reaches (verifyAccessToken)", () => {
	// keep(K2): a gateway sends a bearer that is not JWT-shaped to the API-key path (looksLikeJwt), so no request reaches this guard
	it("reports a non-JSON JWT segment as a TokenError, never a bare SyntaxError", async () => {
		const error = await verifyAccessToken("not-base64.also-not.json", {
			issuer,
			audience,
			jwks: [],
			now: now * 1000,
		}).catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(TokenError);
	});

	// open: requireBearerAuth refuses any token past exp at both gateways, so no request sees the leeway (sk-jay0.5.14.20)
	it("accepts a token within the 60s exp leeway", async () => {
		const signer = await createSigner("prod-kid");
		const token = await signer.sign({
			iss: issuer,
			aud: audience,
			sub: "user_ok",
			exp: now - 30,
			iat: now - 100,
		});
		const payload = await verifyAccessToken(token, {
			issuer,
			audience,
			jwks: [signer.publicJwk],
			now: now * 1000,
		});
		expect(payload.sub).toBe("user_ok");
	});
});
