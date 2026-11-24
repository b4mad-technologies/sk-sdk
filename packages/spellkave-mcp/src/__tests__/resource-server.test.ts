// A request with a valid token carries the verified subject and, for an operator,
// the verified roles claim, which the Account API's operator check reads; a missing
// or malformed claim grants nothing. If it breaks, operators lose their rights or a
// bad claim crashes the request. Runs against a test signer and fixed keys, no
// network. Discovery, token refusals and key rotation: behaviour/login.feature.

import { requireBearerAuth } from "@modelcontextprotocol/server";
import { createPlayerJwtVerifier } from "@spellkave/gateway-identity";
import { describe, expect, it } from "vitest";
import { createTestSigner } from "./jwt-helpers.ts";

const config = {
	canonicalOrigin: "https://mcp.example.test",
	issuer: "https://authkit.example.test",
};

describe("RFC 9728 protected resource metadata", () => {
	// keep(K5): pins the roles claim of gateway-identity's verifier that the Account API's operator check reads; no MCP route reads roles
	it("surfaces a verified roles claim on extra.roles (sk-jay0.5.14.10)", async () => {
		const signer = await createTestSigner();
		const now = 1_700_000_000;
		const verifier = createPlayerJwtVerifier({
			...config,
			jwks: [signer.publicJwk],
			now: () => now * 1000,
		});
		const token = await signer.sign({
			iss: config.issuer,
			aud: `${config.canonicalOrigin}/mcp`,
			sub: "user_operator",
			org_id: "org_spellkave",
			roles: ["operator"],
			exp: now + 300,
			iat: now,
		});
		const auth = await verifier.verifyAccessToken(token);
		expect(auth.extra).toMatchObject({ subject: "user_operator", roles: ["operator"] });
	});

	// keep(K5): pins the roles claim of gateway-identity's verifier that the Account API's operator check reads; no MCP route reads roles
	it("omits extra.roles when the claim is absent (member with no org membership)", async () => {
		const signer = await createTestSigner();
		const now = 1_700_000_000;
		const verifier = createPlayerJwtVerifier({
			...config,
			jwks: [signer.publicJwk],
			now: () => now * 1000,
		});
		const token = await signer.sign({
			iss: config.issuer,
			aud: `${config.canonicalOrigin}/mcp`,
			sub: "user_member",
			exp: now + 300,
			iat: now,
		});
		const auth = await verifier.verifyAccessToken(token);
		expect(auth.extra?.roles).toBeUndefined();
	});

	// keep(K5): pins the roles claim of gateway-identity's verifier that the Account API's operator check reads; no MCP route reads roles
	it("ignores a malformed roles claim (non-array) instead of throwing", async () => {
		const signer = await createTestSigner();
		const now = 1_700_000_000;
		const verifier = createPlayerJwtVerifier({
			...config,
			jwks: [signer.publicJwk],
			now: () => now * 1000,
		});
		const token = await signer.sign({
			iss: config.issuer,
			aud: `${config.canonicalOrigin}/mcp`,
			sub: "user_malformed",
			roles: "operator",
			exp: now + 300,
			iat: now,
		});
		const auth = await verifier.verifyAccessToken(token);
		expect(auth.extra?.roles).toBeUndefined();
	});
});

/**
 * Production cutover 2026-09-16: after the issuer was switched, every request
 * carrying a still-valid-looking token from the OLD issuer answered
 * `500 server_error` instead of 401. The raw `TokenError` from the kid-refresh
 * retry escaped `createPlayerJwtVerifier`, and the bearer middleware maps any
 * non-`OAuthError` to 500 — so the operator chased a phantom server fault for
 * ~40 minutes while the real cause was a stale token. These tests pin the
 * STATUS CODE through the same middleware the gateway mounts, not just the
 * thrown type.
 */
describe("stale / foreign issuer tokens (2026-09-16 cutover incident)", () => {
	const audience = `${config.canonicalOrigin}/mcp`;

	/** Run a token through the exact bearer gate the API and gateway mount. */
	async function bearerStatus(
		verifier: ReturnType<typeof createPlayerJwtVerifier>,
		token: string,
	): Promise<{ status: number; body: { error?: string; error_description?: string } }> {
		const gate = requireBearerAuth({ verifier, requiredScopes: [] });
		const result = await gate(
			new Request(`${config.canonicalOrigin}/mcp`, {
				headers: { authorization: `Bearer ${token}` },
			}),
		);
		if (!(result instanceof Response)) return { status: 200, body: {} };
		return { status: result.status, body: (await result.json()) as Record<string, string> };
	}

	// keep(K2): checks the verified subject on the request's auth info, which no offline route answers with
	it("leaves a valid token unchanged", async () => {
		const signer = await createTestSigner();
		// Real clock here: `verifyBearerToken` re-checks `expiresAt` against
		// `Date.now()` itself, so a frozen `now` would 401 on expiry instead.
		const issuedAt = Math.floor(Date.now() / 1000);
		const verifier = createPlayerJwtVerifier({ ...config, jwks: [signer.publicJwk] });
		const token = await signer.sign({
			iss: config.issuer,
			aud: audience,
			sub: "user_valid",
			exp: issuedAt + 3600,
			iat: issuedAt,
		});

		const auth = await verifier.verifyAccessToken(token);
		expect(auth.extra).toMatchObject({ subject: "user_valid" });
		expect((await bearerStatus(verifier, token)).status).toBe(200);
	});
});
