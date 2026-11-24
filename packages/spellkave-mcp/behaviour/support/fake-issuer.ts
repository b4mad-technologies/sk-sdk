// A fake WorkOS AuthKit issuer for behaviour scenarios: an HTTP server on an
// ephemeral 127.0.0.1 port that publishes a JWKS at `/oauth2/jwks` (the path
// the gateway derives from `WORKOS_ISSUER`) and signs access tokens with the
// matching private key. The gateway under test never reaches the real
// AuthKit; it checks these tokens with its own production verifier.
//
// Plain HTTP is enough: the gateway accepts any issuer URL and fetches the
// JWKS with `fetch`, unlike the refresh grant that gateway-identity's
// `fake-authkit.ts` fakes over HTTPS. The shape follows that fake on purpose
// (`startFake…()` -> `{ issuer, requests, close() }`), and the Account API
// suite builds a similar fake issuer in `packages/spellkave-api`; once both
// exist, one shared helper in `@spellkave/behaviour` can replace them.
//
// A generated public key under an example issuer provides the reference
// shape. Each scenario signs with its own ephemeral key. The fake serves
// only public JWK members; the verifier imports the key from kty, n and e.

import type { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

/** One request the fake received. */
export interface FakeIssuerRequest {
	readonly method: string;
	readonly path: string;
}

/** What `/oauth2/jwks` answers: the current keys, no keys, or nothing at all. */
export type JwksMode = "keys" | "empty" | "down";

interface SigningKey {
	readonly kid: string;
	readonly privateKey: webcrypto.CryptoKey;
	readonly publicJwk: webcrypto.JsonWebKey & { kid: string };
}

export interface FakeIssuer {
	/** `http://127.0.0.1:<port>`, no trailing slash: what `WORKOS_ISSUER` names. */
	readonly issuer: string;
	readonly requests: readonly FakeIssuerRequest[];
	/** The kid tokens are signed with unless a scenario names another. */
	readonly currentKid: string;
	/** Signs `claims` as RS256 with the current key, or with a key the JWKS never names. */
	sign(claims: Record<string, unknown>, options?: { stranger?: boolean }): Promise<string>;
	/** Publishes a new key in place of the old one (AuthKit key rotation). */
	rotate(): Promise<void>;
	/** How every following `/oauth2/jwks` request is answered. */
	jwks(mode: JwksMode): void;
	close(): Promise<void>;
}

/** The kid of a key the JWKS never publishes. */
export const STRANGER_KID = "stranger-key";

const RECORDED = JSON.parse(
	readFileSync(join(import.meta.dirname, "recorded/authkit-jwks.json"), "utf8"),
) as { body: { keys: Record<string, unknown>[] } };
const AUTHKIT_KEY = RECORDED.body.keys[0] ?? {};
const AUTHKIT_MEMBERS = new Set(Object.keys(AUTHKIT_KEY));
const SAME_AS_AUTHKIT = ["kty", "alg", "use", "e"] as const;
const PRIVATE_MEMBERS = ["d", "p", "q", "dp", "dq", "qi", "oth"] as const;

/** Throws unless `answer` is a JWKS AuthKit could have sent (see the header). */
export function assertAuthKitShape(answer: { keys: readonly object[] }): void {
	const top = Object.keys(answer).sort().join(",");
	if (top !== Object.keys(RECORDED.body).sort().join(","))
		throw new Error(`fake issuer JWKS has members ${top}; AuthKit sends only "keys"`);
	for (const key of answer.keys) {
		const fields = key as Record<string, unknown>;
		for (const member of Object.keys(fields)) {
			if (!AUTHKIT_MEMBERS.has(member))
				throw new Error(`fake issuer JWK member ${member} is not one AuthKit publishes`);
		}
		for (const member of [...SAME_AS_AUTHKIT, "kid", "n"]) {
			if (typeof fields[member] !== "string" || fields[member] === "")
				throw new Error(`fake issuer JWK lacks ${member}`);
		}
		for (const member of SAME_AS_AUTHKIT) {
			if (fields[member] !== AUTHKIT_KEY[member])
				throw new Error(
					`fake issuer JWK ${member} is ${String(fields[member])}, AuthKit's is ${String(AUTHKIT_KEY[member])}`,
				);
		}
		for (const member of PRIVATE_MEMBERS) {
			if (member in fields)
				throw new Error(`fake issuer would publish the private member ${member}`);
		}
	}
}

let generated = 0;
async function signingKey(name?: string): Promise<SigningKey> {
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
	generated += 1;
	const kid = name ?? `fake-key-${generated}`;
	const { kty, n, e } = await crypto.subtle.exportKey("jwk", pair.publicKey);
	const publicJwk = { kty, n, e, kid, use: "sig", alg: "RS256" };
	return { kid, privateKey: pair.privateKey, publicJwk };
}

async function signJwt(key: SigningKey, claims: Record<string, unknown>): Promise<string> {
	const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const input = `${part({ alg: "RS256", typ: "JWT", kid: key.kid })}.${part(claims)}`;
	const signature = await crypto.subtle.sign(
		"RSASSA-PKCS1-v1_5",
		key.privateKey,
		new TextEncoder().encode(input),
	);
	return `${input}.${Buffer.from(signature).toString("base64url")}`;
}

export async function startFakeIssuer(): Promise<FakeIssuer> {
	let current = await signingKey();
	let mode: JwksMode = "keys";
	const requests: FakeIssuerRequest[] = [];
	const server: Server = createServer((req, res) => {
		requests.push({ method: req.method ?? "", path: req.url ?? "" });
		if (mode === "down") {
			// An outage the gateway cannot read past: the socket closes unanswered.
			req.socket.destroy();
			return;
		}
		if (req.method !== "GET" || req.url !== "/oauth2/jwks") {
			res.writeHead(404, { "content-type": "application/json" });
			res.end(JSON.stringify({ error: "not_found" }));
			return;
		}
		const answer = { keys: mode === "empty" ? [] : [current.publicJwk] };
		assertAuthKitShape(answer);
		res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify(answer));
	});
	await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
	const address = server.address();
	if (address === null || typeof address === "string")
		throw new Error("fake issuer is not on a TCP port");
	let closed = false;
	return {
		issuer: `http://127.0.0.1:${address.port}`,
		requests,
		get currentKid() {
			return current.kid;
		},
		async sign(claims, options = {}) {
			return signJwt(options.stranger ? await signingKey(STRANGER_KID) : current, claims);
		},
		async rotate() {
			current = await signingKey();
		},
		jwks(next) {
			mode = next;
		},
		close() {
			if (closed) return Promise.resolve();
			closed = true;
			server.closeAllConnections();
			return new Promise((done) => server.close(() => done()));
		},
	};
}
