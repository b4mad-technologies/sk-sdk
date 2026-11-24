// An operator starts the gateway attached to a player session and expects every
// configured option (image tag, sinks, lifecycle emitter) to reach the inner gateway.
// If one is dropped, requests fail in production with a config error the unit suite
// never saw. Runs against an injected attach, env and fetch, no live node.

// keep-file(K2): option seam of createAttachedPlayerMcpGateway with injected attach, env and fetch

import { createMemorySink } from "@spellkave/agent-observability";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlayerSessionClient } from "../daemon-handler.ts";
import { createAttachedPlayerMcpGateway } from "../gateway.ts";
import { createRemoteMcpRunObserver, type RemoteMcpLifecycleEmit } from "../observability.ts";
import { createTestSigner, type TestSigner } from "./jwt-helpers.ts";

/**
 * createAttachedPlayerMcpGateway copies inner-gateway options EXPLICITLY; a
 * dropped option fails only in production. This suite is the only coverage of
 * the attached path; when adding a new option, wire it here too.
 */
describe("createAttachedPlayerMcpGateway option seam", () => {
	const origin = "https://mcp.example.test";
	const issuer = "https://authkit.example.test";
	let now: number;
	let signer: TestSigner;

	beforeEach(async () => {
		now = Math.floor(Date.now() / 1000);
		signer = await createTestSigner();
		now = Math.floor(Date.now() / 1000);
	});

	it("marks process start with the deployed image tag and binds the router's lifecycle emitter (sk-0m4.120.12/.13)", async () => {
		const sink = createMemorySink();
		let bound: RemoteMcpLifecycleEmit | undefined;
		const client = {
			invoke: vi.fn(),
			bindLifecycle: (emit: RemoteMcpLifecycleEmit) => {
				bound = emit;
			},
		} as unknown as PlayerSessionClient;
		await createAttachedPlayerMcpGateway({
			resourceConfig: { canonicalOrigin: origin, issuer, jwks: [signer.publicJwk] },
			binding: { url: "http://127.0.0.1:3000", db: "d", identity: "i", actorId: "1" },
			attach: async () => client,
			env: { SPELLKAVE_IMAGE_TAG: "sha-919f9ae5" },
			runObserver: createRemoteMcpRunObserver({ actorId: "1", sinks: [sink] }),
			allowedOriginHostnames: ["mcp.example.test"],
			now: () => now * 1000,
		});
		expect(sink.events.map((e) => [e.type, e.data])).toEqual([
			["gateway_start", { image_tag: "sha-919f9ae5" }],
		]);
		expect(sink.events[0]?.controller_kind).toBe("service");
		expect(bound).toBeDefined();
		// Whatever the router reports later lands in the same sinks.
		bound?.("session_token_refreshed", { world_slug: "world-a" });
		expect(sink.events.at(-1)).toMatchObject({
			type: "session_token_refreshed",
			data: { world_slug: "world-a" },
		});
		bound?.("session_detach", { reason: "route_changed", world_slug: "world-a" });
		expect(sink.events.at(-1)).toMatchObject({
			type: "session_detach",
			data: { reason: "route_changed", world_slug: "world-a" },
		});
	});

	// sk-jay0.5.18 / sk-jay0.7.267: the Account and Admin API lives in
	// @spellkave/api; the MCP host answers /v1/* with 404 even with a valid token.
	it("answers /v1/* with 404 and still serves /mcp and /healthz", async () => {
		const client = { invoke: vi.fn() } as unknown as PlayerSessionClient;
		const gateway = await createAttachedPlayerMcpGateway({
			resourceConfig: { canonicalOrigin: origin, issuer, jwks: [signer.publicJwk] },
			binding: { url: "http://127.0.0.1:3000", db: "d", identity: "i", actorId: "1" },
			attach: async () => client,
			env: { SPELLKAVE_RUN_EVENTS: "off" },
			allowedOriginHostnames: ["mcp.example.test", "spellkave.com"],
			now: () => now * 1000,
		});
		const jwt = await signer.sign({
			iss: issuer,
			aud: `${origin}/mcp`,
			sub: "user_alice",
			exp: now + 300,
			iat: now,
		});
		const headers = { host: "mcp.example.test", authorization: `Bearer ${jwt}` };
		for (const [method, path] of [
			["GET", "/v1/account"],
			["POST", "/v1/account/tokens"],
			["GET", "/v1/worlds/any/seats"],
			["GET", "/v1/admin/worlds"],
		] as const) {
			const res = await gateway.fetch(new Request(`${origin}${path}`, { method, headers }));
			expect(res.status, `${method} ${path}`).toBe(404);
		}
		const listed = await gateway.fetch(
			new Request(`${origin}/mcp`, {
				method: "POST",
				headers: {
					...headers,
					accept: "application/json, text/event-stream",
					"content-type": "application/json",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
			}),
		);
		expect(listed.status).toBe(200);
		const health = await gateway.fetch(
			new Request(`${origin}/healthz`, { headers: { host: "mcp.example.test" } }),
		);
		expect(health.status).toBe(200);
	});
});
