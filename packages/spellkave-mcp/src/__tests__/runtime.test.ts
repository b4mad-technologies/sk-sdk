// An operator configures the gateway from environment and files, and a bad value
// (a deployment port other than 8080, a wrong file mode, a plain-HTTP origin) is
// refused at startup, while the running gateway reports readiness and keeps or
// re-creates its session attachment correctly.
// If it breaks, the gateway starts misconfigured or reports ready when it is not. Runs
// against temp files and injected session clients and clock, no live node.

// keep-file(K1): runtime configuration validator rule space

import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Response, SessionDaemonStatus } from "@spellkave/session/node";
import { SessionDaemonTransportError } from "@spellkave/session/node";
import { describe, expect, it, vi } from "vitest";

import type { PlayerSessionClient, PlayerToolResult } from "../daemon-handler.ts";
import {
	createIssuerReadiness,
	loadPlayerMcpRuntimeConfig,
	ReattachingPlayerSessionClient,
	readMode600Secret,
} from "../runtime.ts";

function validEnv(): NodeJS.ProcessEnv {
	return {
		SPELLKAVE_MCP_CANONICAL_ORIGIN: "https://player.example.ts.net",
		WORKOS_ISSUER: "https://authkit.example.test",
		SPELLKAVE_MCP_WORLD_URL: "http://127.0.0.1:3000",
		SPELLKAVE_WORLD_CATALOG: "/tmp/worlds.catalog.json",
	};
}

function okStatus(id: number): Response<SessionDaemonStatus> {
	return {
		id,
		ok: true,
		result: {
			binding: { url: "private", db: "private", identity: "private", actorId: "private" },
			uptimeMs: 1,
			subscribed: true,
			observability: { mode: "jsonl" },
		},
	};
}

describe("hosted PLAYER MCP runtime", () => {
	it("defaults to the explicit loopback deployment contract", () => {
		const config = loadPlayerMcpRuntimeConfig(validEnv());
		expect(config).toMatchObject({
			trustBoundary: "loopback",
			listenHost: "127.0.0.1",
			listenPort: 8080,
			apiOrigin: "https://api.spellkave.com",
			worldUrl: "http://127.0.0.1:3000",
			catalogPath: "/tmp/worlds.catalog.json",
			allowedOriginHostnames: [
				"player.example.ts.net",
				"claude.ai",
				"spellkave.com",
				"www.spellkave.com",
				"localhost",
			],
			trustForwardedHeaders: false,
			publicTranscriptDir: "",
		});
		expect(JSON.stringify(config)).not.toContain("spacetime-player-token-value");
		expect(config.mapsBaseUrl).toBeUndefined();
		expect(config).toEqual(
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_TRUST_BOUNDARY: "loopback",
			}),
		);
	});

	it("rejects an unknown trust boundary", () => {
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_TRUST_BOUNDARY: "cluster",
			}),
		).toThrow("SPELLKAVE_MCP_TRUST_BOUNDARY must be loopback or network-policy");
	});

	it("accepts service addresses under the network-policy trust boundary", () => {
		const config = loadPlayerMcpRuntimeConfig({
			...validEnv(),
			SPELLKAVE_MCP_TRUST_BOUNDARY: "network-policy",
			SPELLKAVE_MCP_LISTEN_HOST: "0.0.0.0",
			SPELLKAVE_MCP_WORLD_URL: "http://world.spellkave.svc:3000",
		});
		expect(config).toMatchObject({
			trustBoundary: "network-policy",
			listenHost: "0.0.0.0",
			listenPort: 8080,
			worldUrl: "http://world.spellkave.svc:3000",
		});
	});

	it("validates network-policy hosts and world URLs", () => {
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_TRUST_BOUNDARY: "network-policy",
				SPELLKAVE_MCP_LISTEN_HOST: "https://gateway.example.test",
			}),
		).toThrow("must be a non-empty host without a scheme");
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_TRUST_BOUNDARY: "network-policy",
				SPELLKAVE_MCP_WORLD_URL: "world.spellkave.svc:3000",
			}),
		).toThrow("must be an absolute http(s) URL");
	});

	it("loads optional SPELLKAVE_MAPS_URL and strips a trailing slash", () => {
		const config = loadPlayerMcpRuntimeConfig({
			...validEnv(),
			SPELLKAVE_MAPS_URL: "https://maps.spellkave.com/",
		});
		expect(config.mapsBaseUrl).toBe("https://maps.spellkave.com");
	});

	it("loads custom or loopback SPELLKAVE_API_ORIGIN", () => {
		const custom = loadPlayerMcpRuntimeConfig({
			...validEnv(),
			SPELLKAVE_API_ORIGIN: "https://api.custom.example.test",
		});
		expect(custom.apiOrigin).toBe("https://api.custom.example.test");

		const loopback = loadPlayerMcpRuntimeConfig({
			...validEnv(),
			SPELLKAVE_API_ORIGIN: "http://127.0.0.1:8080",
		});
		expect(loopback.apiOrigin).toBe("http://127.0.0.1:8080");
	});

	it("rejects invalid SPELLKAVE_API_ORIGIN", () => {
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_API_ORIGIN: "http://api.spellkave.com",
			}),
		).toThrow("must use HTTPS port 443");
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_API_ORIGIN: "https://api.spellkave.com:8443",
			}),
		).toThrow("must use HTTPS port 443");
	});

	it("keeps the loopback host invariant and error unchanged", () => {
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_TRUST_BOUNDARY: "loopback",
				SPELLKAVE_MCP_LISTEN_HOST: "0.0.0.0",
			}),
		).toThrow("SPELLKAVE_MCP_LISTEN_HOST must remain 127.0.0.1");
	});

	it("rejects deployment drift away from HTTPS 443, gateway 8080, and the loopback world host", () => {
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_CANONICAL_ORIGIN: "https://player.example.ts.net:8443",
			}),
		).toThrow("port 443");
		expect(() =>
			loadPlayerMcpRuntimeConfig({ ...validEnv(), SPELLKAVE_MCP_LISTEN_PORT: "8081" }),
		).toThrow("must remain 8080");
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_TRUST_BOUNDARY: "loopback",
				SPELLKAVE_MCP_WORLD_URL: "http://127.0.0.1:3001",
			}),
		).toThrow("SPELLKAVE_MCP_WORLD_URL must remain http://127.0.0.1:3000");
		expect(() =>
			loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_TRUST_BOUNDARY: "network-policy",
				SPELLKAVE_MCP_LISTEN_PORT: "8081",
			}),
		).toThrow("SPELLKAVE_MCP_LISTEN_PORT must remain 8080");
		expect(() =>
			loadPlayerMcpRuntimeConfig({ ...validEnv(), SPELLKAVE_WORLD_CATALOG: "" }),
		).toThrow("SPELLKAVE_WORLD_CATALOG is required");
	});

	it("moves the listen port only for a parsed loopback canonical origin", () => {
		for (const origin of ["http://127.0.0.1:9123", "http://localhost:9123"]) {
			const config = loadPlayerMcpRuntimeConfig({
				...validEnv(),
				SPELLKAVE_MCP_CANONICAL_ORIGIN: origin,
				SPELLKAVE_MCP_LISTEN_PORT: "9124",
			});
			expect(config.listenPort).toBe(9124);
		}
		// A hostname that only starts like a loopback one is a deployment.
		for (const origin of ["https://localhost.example.com", "https://127.0.0.1.nip.io"]) {
			expect(() =>
				loadPlayerMcpRuntimeConfig({
					...validEnv(),
					SPELLKAVE_MCP_CANONICAL_ORIGIN: origin,
					SPELLKAVE_MCP_LISTEN_PORT: "9124",
				}),
			).toThrow("SPELLKAVE_MCP_LISTEN_PORT must remain 8080");
		}
	});

	// keep(K2): needs file modes the offline gateway cannot vary
	it("accepts only a non-empty mode-0600 token file", async () => {
		const dir = await mkdtemp(join(tmpdir(), "player-mcp-runtime-"));
		const path = join(dir, "player.token");
		await writeFile(path, "secret-token\n", { mode: 0o600 });
		await expect(readMode600Secret(path, "test token")).resolves.toBe("secret-token");
		await chmod(path, 0o644);
		await expect(readMode600Secret(path, "test token")).rejects.toThrow("mode 0600");
	});

	// keep(K2): injected session clients lose and regain the subscription
	it("names attach, subscription loss and re-subscribe as lifecycle rows (sk-0m4.120.12)", async () => {
		const failure = new SessionDaemonTransportError("/private/socket", "closed", {
			code: "ECONNREFUSED",
		});
		const first = {
			invoke: vi.fn().mockRejectedValue(failure),
			attachment: { socketPath: "/private/socket", spawned: true },
		};
		const second = {
			invoke: vi.fn().mockResolvedValue({
				id: 2,
				ok: true,
				result: { content: [{ type: "text", text: "recovered" }] },
			} satisfies Response<PlayerToolResult>),
			attachment: { socketPath: "/private/socket", spawned: false },
		};
		const rows: Array<[string, Record<string, unknown>]> = [];
		const attach = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(second);
		const client = await ReattachingPlayerSessionClient.create(attach, {
			lifecycle: (type, data) => rows.push([type, data ?? {}]),
			worldSlug: "world-a",
		});
		await expect(client.invoke("act", {})).rejects.toBe(failure);
		await expect(client.invoke("see", {})).resolves.toMatchObject({ ok: true });
		expect(rows).toEqual([
			["session_attach", { spawned: true, world_slug: "world-a" }],
			["subscription_lost", { cause: "ECONNREFUSED", world_slug: "world-a" }],
			["session_resubscribed", { spawned: false, world_slug: "world-a" }],
		]);
	});

	// keep(K2): injected session client times out on invoke
	it("keeps the attachment on an invoke timeout — a busy daemon, not a lost subscription (sk-0m4.121)", async () => {
		// What `sendSessionRequest` throws when the daemon socket is alive but
		// the invoke queue is behind a reply window.
		const busy = new SessionDaemonTransportError("/private/socket", "timed out after 12000ms");
		const only = {
			invoke: vi
				.fn()
				.mockRejectedValueOnce(busy)
				.mockResolvedValue({
					id: 2,
					ok: true,
					result: { content: [{ type: "text", text: "served" }] },
				} satisfies Response<PlayerToolResult>),
			status: vi.fn().mockRejectedValueOnce(busy).mockResolvedValue(okStatus(3)),
			attachment: { socketPath: "/private/socket", spawned: true },
		};
		const rows: Array<[string, Record<string, unknown>]> = [];
		const attach = vi.fn().mockResolvedValue(only);
		const client = await ReattachingPlayerSessionClient.create(attach, {
			lifecycle: (type, data) => rows.push([type, data ?? {}]),
			worldSlug: "world-a",
		});
		await expect(client.invoke("act", {})).rejects.toBe(busy);
		await expect(client.status()).rejects.toBe(busy);
		await expect(client.invoke("see", {})).resolves.toMatchObject({ ok: true });
		await expect(client.status()).resolves.toMatchObject({ ok: true });
		expect(attach).toHaveBeenCalledOnce();
		expect(rows).toEqual([["session_attach", { spawned: true, world_slug: "world-a" }]]);
	});

	// keep(K2): injected session client drops the transport
	it("reattaches after transport loss without replaying the uncertain invocation", async () => {
		const failure = new SessionDaemonTransportError("/private/socket", "closed");
		const first: PlayerSessionClient = {
			invoke: vi.fn().mockRejectedValue(failure),
			status: vi.fn().mockRejectedValue(failure),
		};
		const second: PlayerSessionClient = {
			invoke: vi.fn().mockResolvedValue({
				id: 2,
				ok: true,
				result: { content: [{ type: "text", text: "recovered" }] },
			} satisfies Response<PlayerToolResult>),
			status: vi.fn().mockResolvedValue(okStatus(3)),
		};
		const attach = vi.fn().mockResolvedValueOnce(first).mockResolvedValue(second);
		const client = await ReattachingPlayerSessionClient.create(attach);
		await expect(client.invoke("act", {})).rejects.toBe(failure);
		expect(first.invoke).toHaveBeenCalledOnce();
		expect(second.invoke).not.toHaveBeenCalled();
		await expect(client.invoke("see", {})).resolves.toMatchObject({ ok: true });
		expect(second.invoke).toHaveBeenCalledOnce();
		expect(attach).toHaveBeenCalledTimes(2);
	});
});

describe("createIssuerReadiness", () => {
	const resourceConfig = {
		canonicalOrigin: "https://mcp.example.test",
		issuer: "https://authkit.example.test/",
	};

	// keep(K2): injected clock for the 60 s readiness cache
	it("is ready when the issuer JWKS is reachable, without any attached session", async () => {
		const loadJwks = vi.fn(async (uri: string) => {
			expect(uri).toBe("https://authkit.example.test/oauth2/jwks");
			return [{ kid: "k1", kty: "RSA", n: "n", e: "AQAB" }];
		});
		let clock = 1_000;
		const ready = createIssuerReadiness(resourceConfig, {
			loadJwks,
			now: () => clock,
			ttlMs: 60_000,
		});
		await expect(ready()).resolves.toBe(true);
		clock += 30_000;
		await expect(ready()).resolves.toBe(true);
		expect(loadJwks).toHaveBeenCalledOnce();
		clock += 60_000;
		await expect(ready()).resolves.toBe(true);
		expect(loadJwks).toHaveBeenCalledTimes(2);
	});
});
