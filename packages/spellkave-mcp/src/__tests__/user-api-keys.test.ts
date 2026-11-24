// A signed-in player creates, lists and revokes their own API keys through WorkOS, and
// the key lands in the right organization. If it breaks, keys are created for the wrong
// organization or failures are hidden. Runs against an injected WorkOS fetch, no network.

// keep-file(K2): injected WorkOS fetch

import {
	ACCOUNT_TOKEN_PERMISSION,
	createUserApiKeyClient,
	resolveTokenOrganizationId,
	WORKOS_API_KEY_PATH,
	WORKOS_USER_API_KEYS_PATH,
} from "@spellkave/gateway-identity";
import { describe, expect, it, vi } from "vitest";

describe("resolveTokenOrganizationId", () => {
	// keep(K1): pure organization resolver
	it("prefers extra.org_id, then JWT, then fallback", () => {
		expect(
			resolveTokenOrganizationId({ org_id: "org_extra" }, { org_id: "org_jwt" }, "org_env"),
		).toBe("org_extra");
		expect(resolveTokenOrganizationId({}, { org_id: "org_jwt" }, "org_env")).toBe("org_jwt");
		expect(resolveTokenOrganizationId({}, {}, "org_env")).toBe("org_env");
		expect(resolveTokenOrganizationId({}, {}, undefined)).toBeUndefined();
	});
});

describe("createUserApiKeyClient", () => {
	it("is disabled without WORKOS_API_KEY and throws 503", async () => {
		const client = createUserApiKeyClient({});
		expect(client.enabled).toBe(false);
		await expect(client.list("user_alice")).rejects.toMatchObject({
			code: "unavailable",
			httpStatus: 503,
		});
	});

	it("creates via POST /user_management/users/{id}/api_keys", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			expect(String(input)).toBe(
				`https://api.workos.com${WORKOS_USER_API_KEYS_PATH("user_alice")}`,
			);
			expect(init?.method).toBe("POST");
			expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk_server");
			expect(JSON.parse(String(init?.body))).toEqual({
				name: "ci",
				organization_id: "org_1",
				permissions: [ACCOUNT_TOKEN_PERMISSION],
			});
			return new Response(
				JSON.stringify({
					object: "api_key",
					id: "key_123",
					name: "ci",
					value: "sk_user_secret_once",
					created_at: "2026-08-24T00:00:00.000Z",
				}),
				{ status: 201, headers: { "content-type": "application/json" } },
			);
		});
		const client = createUserApiKeyClient({
			workosApiKey: "sk_server",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(
			client.create("user_alice", { name: "ci", organizationId: "org_1" }),
		).resolves.toEqual({
			id: "key_123",
			name: "ci",
			value: "sk_user_secret_once",
		});
	});

	it("lists via GET and maps last_used_at", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request) => {
			expect(String(input)).toContain(WORKOS_USER_API_KEYS_PATH("user_alice"));
			expect(String(input)).toContain("organization_id=org_1");
			return new Response(
				JSON.stringify({
					data: [
						{
							id: "key_123",
							name: "ci",
							created_at: "2026-08-24T00:00:00.000Z",
							last_used_at: "2026-08-24T01:00:00.000Z",
						},
						{
							id: "key_124",
							name: "laptop",
							created_at: "2026-08-24T00:00:01.000Z",
							last_used_at: null,
						},
					],
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		});
		const client = createUserApiKeyClient({
			workosApiKey: "sk_server",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(client.list("user_alice", { organizationId: "org_1" })).resolves.toEqual([
			{
				id: "key_123",
				name: "ci",
				created_at: "2026-08-24T00:00:00.000Z",
				last_used_at: "2026-08-24T01:00:00.000Z",
			},
			{
				id: "key_124",
				name: "laptop",
				created_at: "2026-08-24T00:00:01.000Z",
				last_used_at: null,
			},
		]);
	});

	it("deletes via DELETE /api_keys/{id}", async () => {
		const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
			expect(String(input)).toBe(`https://api.workos.com${WORKOS_API_KEY_PATH("key_123")}`);
			expect(init?.method).toBe("DELETE");
			return new Response(null, { status: 204 });
		});
		const client = createUserApiKeyClient({
			workosApiKey: "sk_server",
			fetchImpl: fetchImpl as unknown as typeof fetch,
		});
		await expect(client.delete("key_123")).resolves.toBeUndefined();
	});

	it("maps WorkOS 5xx to 503", async () => {
		const client = createUserApiKeyClient({
			workosApiKey: "sk_server",
			fetchImpl: (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch,
		});
		await expect(client.list("user_alice")).rejects.toMatchObject({
			code: "unavailable",
			httpStatus: 503,
		});
	});
});
