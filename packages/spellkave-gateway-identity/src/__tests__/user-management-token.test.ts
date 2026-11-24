// keep-file(K2): UM-token refusals the login site's fake WorkOS never sends (no sid, Connect issuer, key rotation)
// The fake WorkOS in packages/spellkave-api/behaviour always signs well-formed
// UM tokens, so these cases cannot be provoked through the login routes. Each
// case signs a real RS256 token; no network.
import { generateKeyPairSync, sign } from "node:crypto";

import { describe, expect, it } from "vitest";

import { TokenError } from "../jwt.ts";
import { createUserManagementTokenVerifier } from "../user-management-token.ts";

const CLIENT = "client_TEST01";
const API = "https://api.workos.test";
const ISSUER = `${API}/user_management/${CLIENT}`;
const NOW = 1_700_000_000;

function signer(kid: string) {
	const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
	const jwk = privateKey.export({ format: "jwk" });
	return {
		jwk: { kty: jwk.kty, n: jwk.n, e: jwk.e, kid, alg: "RS256", use: "sig" },
		token(claims: Record<string, unknown>): string {
			const head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT", kid })).toString(
				"base64url",
			);
			const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
			const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), privateKey);
			return `${head}.${body}.${sig.toString("base64url")}`;
		},
	};
}

const valid = { iss: ISSUER, sub: "user_1", sid: "session_1", iat: NOW - 10, exp: NOW + 300 };

describe("createUserManagementTokenVerifier", () => {
	it("returns sub and sid of a UM token and fetches the client's JWKS once", async () => {
		const key = signer("k1");
		const fetched: string[] = [];
		const verifier = createUserManagementTokenVerifier({
			clientId: CLIENT,
			apiBaseUrl: API,
			fetchJwks: async (uri) => {
				fetched.push(uri);
				return [key.jwk];
			},
			now: () => NOW * 1000,
		});
		await expect(verifier.verify(key.token(valid))).resolves.toMatchObject({
			sub: "user_1",
			sid: "session_1",
		});
		await verifier.verify(key.token(valid));
		expect(fetched).toEqual([`${API}/sso/jwks/${CLIENT}`]);
	});

	it("refuses a token without sid and a token from the AuthKit (Connect) issuer", async () => {
		const key = signer("k1");
		const verifier = createUserManagementTokenVerifier({
			clientId: CLIENT,
			apiBaseUrl: API,
			jwks: [key.jwk],
			now: () => NOW * 1000,
		});
		const { sid: _sid, ...noSid } = valid;
		await expect(verifier.verify(key.token(noSid))).rejects.toThrow("missing sid");
		await expect(
			verifier.verify(key.token({ ...valid, iss: "https://example.authkit.app" })),
		).rejects.toBeInstanceOf(TokenError);
	});

	it("refetches the JWKS once for an unknown kid (key rotation)", async () => {
		const old = signer("old");
		const rotated = signer("new");
		let calls = 0;
		const verifier = createUserManagementTokenVerifier({
			clientId: CLIENT,
			apiBaseUrl: API,
			fetchJwks: async () => (calls++ === 0 ? [old.jwk] : [rotated.jwk]),
			now: () => NOW * 1000,
		});
		await verifier.verify(old.token(valid));
		await expect(verifier.verify(rotated.token(valid))).resolves.toMatchObject({ sub: "user_1" });
		expect(calls).toBe(2);
	});
});
