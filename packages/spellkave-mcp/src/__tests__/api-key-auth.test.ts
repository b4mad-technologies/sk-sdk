// A script or agent calls the Account API with a WorkOS user API key instead of a
// login token: a valid user key is accepted, a bad, organization-owned or
// unverifiable one is refused with the right status. If it breaks, keyed clients
// are locked out or an invalid key gets in. Runs against an injected WorkOS fetch,
// no network.

// keep-file(K2): injected WorkOS fetch (4xx, 5xx, network error, cache)

import {
	ApiKeyAuthError,
	createApiKeyValidator,
	looksLikeJwt,
	WORKOS_API_KEYS_VALIDATIONS_PATH,
} from "@spellkave/gateway-identity";
import { describe, expect, it, vi } from "vitest";

describe("looksLikeJwt", () => {
	// keep(K1): pure token-shape classifier
	it("accepts three base64url JSON parts", () => {
		const h = Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url");
		const p = Buffer.from(JSON.stringify({ sub: "u" })).toString("base64url");
		expect(looksLikeJwt(`${h}.${p}.sig`)).toBe(true);
	});

	// keep(K1): pure token-shape classifier
	it("rejects opaque API-key shaped secrets", () => {
		expect(looksLikeJwt("sk_user_abc123")).toBe(false);
		expect(looksLikeJwt("not-a-jwt")).toBe(false);
		expect(looksLikeJwt("a.b")).toBe(false);
	});
});

describe("createApiKeyValidator", () => {
	const userKey = "sk_user_test_value_not_a_jwt";

	it("is disabled without WORKOS_API_KEY and throws 401 disabled", async () => {
		const validator = createApiKeyValidator({});
		expect(validator.enabled).toBe(false);
		await expect(validator.validate(userKey)).rejects.toMatchObject({
			outcome: "disabled",
			httpStatus: 401,
		});
	});

	it("validates via POST /api_keys/validations and returns user subject", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			expect(String(input)).toBe(`https://api.workos.com${WORKOS_API_KEYS_VALIDATIONS_PATH}`);
			expect(init?.method).toBe("POST");
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk_server");
			expect(JSON.parse(String(init?.body))).toEqual({ value: userKey });
			return new Response(
				JSON.stringify({
					api_key: {
						object: "api_key",
						id: "key_123",
						owner: { type: "user", id: "user_alice", organization_id: "org_1" },
						permissions: ["posts:read"],
						name: "ci",
						obfuscated_value: "sk_…",
					},
				}),
				{ status: 200 },
			);
		});
		const validator = createApiKeyValidator({
			workosApiKey: "sk_server",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		const result = await validator.validate(userKey);
		expect(result).toEqual({
			subject: "user_alice",
			permissions: ["posts:read"],
			apiKeyId: "key_123",
			ownerType: "user",
		});
		expect(fetchImpl).toHaveBeenCalledOnce();
	});

	it("caches successful validations by key hash", async () => {
		const fetchImpl = vi.fn(
			async () =>
				new Response(
					JSON.stringify({
						api_key: {
							id: "key_123",
							owner: { type: "user", id: "user_alice" },
							permissions: [],
						},
					}),
					{ status: 200 },
				),
		);
		let now = 1_000;
		const validator = createApiKeyValidator({
			workosApiKey: "sk_server",
			fetchImpl: fetchImpl as unknown as typeof fetch,
			now: () => now,
			cacheTtlMs: 60_000,
		});
		await validator.validate(userKey);
		await validator.validate(userKey);
		expect(fetchImpl).toHaveBeenCalledOnce();
		now = 70_000;
		await validator.validate(userKey);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});

	it("maps WorkOS 4xx to invalid 401", async () => {
		const validator = createApiKeyValidator({
			workosApiKey: "sk_server",
			fetchImpl: (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch,
		});
		await expect(validator.validate(userKey)).rejects.toBeInstanceOf(ApiKeyAuthError);
		await expect(validator.validate(userKey)).rejects.toMatchObject({
			outcome: "invalid",
			httpStatus: 401,
		});
	});

	it("maps WorkOS 5xx and network errors to 503", async () => {
		const serverError = createApiKeyValidator({
			workosApiKey: "sk_server",
			fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
		});
		await expect(serverError.validate(userKey)).rejects.toMatchObject({
			outcome: "network_error",
			httpStatus: 503,
		});
		const network = createApiKeyValidator({
			workosApiKey: "sk_server",
			fetchImpl: (async () => {
				throw new Error("ECONNRESET");
			}) as unknown as typeof fetch,
		});
		await expect(network.validate(userKey)).rejects.toMatchObject({
			outcome: "network_error",
			httpStatus: 503,
		});
	});

	it("rejects organization-owned keys", async () => {
		const validator = createApiKeyValidator({
			workosApiKey: "sk_server",
			fetchImpl: (async () =>
				new Response(
					JSON.stringify({
						api_key: {
							id: "key_org",
							owner: { type: "organization", id: "org_1" },
							permissions: [],
						},
					}),
					{ status: 200 },
				)) as unknown as typeof fetch,
		});
		await expect(validator.validate(userKey)).rejects.toMatchObject({
			outcome: "rejected_owner",
			httpStatus: 401,
		});
	});
});
