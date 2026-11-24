import type { JsonWebKeyWithKid } from "@spellkave/gateway-identity";

const encoder = new TextEncoder();

export interface TestSigner {
	publicJwk: JsonWebKeyWithKid;
	sign(claims: Record<string, unknown>): Promise<string>;
}

export async function createTestSigner(kid = "test-key"): Promise<TestSigner> {
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
	const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKeyWithKid;
	publicJwk.kid = kid;
	publicJwk.use = "sig";
	publicJwk.alg = "RS256";
	return {
		publicJwk,
		async sign(claims) {
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
