// A client keeps a working MCP surface when the world side misbehaves: public docs
// answer without world discovery, an ambiguous seat is a typed error, a dead daemon
// is a tool error, a stalled call times out, and a changed roster is picked up. If
// it breaks, clients see raw failures or a stale toolset. Runs against an injected
// session client, no live daemon. The normal handshake and request guards:
// behaviour/play.feature and behaviour/browser.feature.

// keep-file(K2): injected session client (toolNames, invoke, timeouts, transport errors)

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { AmbiguousAuthorityWorldError } from "@spellkave/gateway-identity";
import { SessionDaemonTransportError } from "@spellkave/session/node";
import { DOCS_TOOL, PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import { parse } from "smol-toml";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PlayerSessionClient } from "../daemon-handler.ts";
import { SPELLKAVE_FEEDBACK_TOOL } from "../feedback-constants.ts";
import {
	createPlayerMcpHttpService,
	createPlayerMcpNodeHandler,
	DEFAULT_MCP_MAX_BODY_BYTES,
	type PlayerMcpHttpService,
} from "../http.ts";
import { AUTHOR_MCP_MAX_INPUT_ELEMENTS, PLAYER_MCP_MAX_INPUT_ELEMENTS } from "../tools.ts";

const jsonHeaders = {
	accept: "application/json, text/event-stream",
	"content-type": "application/json",
	host: "localhost",
};

function request(body: unknown, init: RequestInit = {}): Request {
	return new Request("http://localhost/mcp", {
		method: "POST",
		headers: jsonHeaders,
		body: JSON.stringify(body),
		...init,
	});
}

function rpc(method: string, params: unknown = {}): Record<string, unknown> {
	return { jsonrpc: "2.0", id: 1, method, params };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
	const contentType = response.headers.get("content-type");
	if (contentType?.includes("application/json")) {
		return (await response.json()) as Record<string, unknown>;
	}
	expect(contentType).toContain("text/event-stream");
	const data = (await response.text())
		.split("\n")
		.find((line) => line.startsWith("data: "))
		?.slice("data: ".length);
	if (data === undefined) throw new Error("MCP SSE response had no data event");
	return JSON.parse(data) as Record<string, unknown>;
}

describe("PLAYER MCP HTTP service", () => {
	let service: PlayerMcpHttpService | undefined;

	afterEach(async () => {
		await service?.close();
		service = undefined;
	});

	// open: docs envelope metadata over index, hits, unknown id and unknown section; no scenario yet
	it("AUTH-56 public docs bypass world admission and preserve refusal semantics", async () => {
		const invoke = vi.fn(() => {
			throw new Error("world access forbidden in public docs");
		});
		service = createPlayerMcpHttpService({ client: { invoke } });
		const call = async (args: unknown) => {
			const response = await responseJson(
				await service!.fetch(request(rpc("tools/call", { name: DOCS_TOOL, arguments: args }))),
			);
			return response.result as { content: Array<{ text: string }>; isError?: boolean };
		};
		const pattern = await call({ doc: "patterns/container-with-loot", full: true });
		expect(JSON.parse(pattern.content[0]!.text).doc).toMatchObject({
			rel: "patterns/container-with-loot",
			metadata: { compatibility: "unknown" },
		});
		const refusal = await call({ doc: "file:///private/world.toml" });
		expect(refusal.isError).toBe(true);
		expect(JSON.parse(refusal.content[0]!.text)).toMatchObject({
			unknown_id: "file:///private/world.toml",
			doc: null,
		});

		const envelopes = await Promise.all(
			[
				{},
				{ query: "container loot" },
				{ doc: "hosted-authoring-guidance", section: "missing" },
			].map(call),
		);
		const full = JSON.parse(pattern.content[0]!.text);
		const unknown = JSON.parse(refusal.content[0]!.text);
		const [index, hits, section] = envelopes.map((result) => JSON.parse(result.content[0]!.text));
		for (const result of [full, unknown, index, hits, section]) {
			expect(result.metadata).toMatchObject({
				corpus_revision: full.doc.metadata.corpus_revision,
				compatibility: "unknown",
			});
			expect(result.metadata.links).toBeUndefined();
		}
		for (const row of [...index.index, ...hits.hits, ...unknown.index]) {
			expect(row.metadata).toMatchObject({
				document_id: row.rel,
				corpus_revision: full.metadata.corpus_revision,
			});
			expect(row.metadata.links).toBeUndefined();
		}
		expect(envelopes[2]!.isError).toBe(true);
		expect(section).toMatchObject({
			unknown_section: "missing",
			doc: null,
			metadata: { document_id: "hosted-authoring-guidance", content_status: "planned" },
		});
		expect(invoke).not.toHaveBeenCalled();
	});

	it("public docs bypass failed world discovery and preserve additive trusted version metadata", async () => {
		const invoke = vi.fn<PlayerSessionClient["invoke"]>();
		const toolNames = vi.fn(async () => {
			throw new AmbiguousAuthorityWorldError();
		});
		service = createPlayerMcpHttpService({
			client: { invoke, toolNames },
			docsVersionEvidence: {
				server_revision: "synthetic-authorized-revision",
				compatibility: "mismatch",
			},
		});
		const initialized = await responseJson(
			await service.fetch(
				request(
					rpc("initialize", {
						protocolVersion: "2025-11-25",
						capabilities: {},
						clientInfo: { name: "public-docs", version: "1" },
					}),
				),
			),
		);
		expect(JSON.stringify(initialized)).toContain(DOCS_TOOL);
		const answer = await responseJson(
			await service.fetch(
				request(
					rpc("tools/call", {
						name: DOCS_TOOL,
						arguments: { doc: "patterns/container-with-loot", section: "Problem" },
					}),
				),
			),
		);
		const result = answer.result as { content: Array<{ text: string }> };
		const details = JSON.parse(result.content[0]!.text);
		expect(details.doc.section).toBe("Problem");
		expect(details.metadata).toMatchObject({
			server_revision: "synthetic-authorized-revision",
			compatibility: "mismatch",
		});
		// Existing clients can consume the unchanged content without metadata.
		const { metadata: _metadata, ...legacy } = details.doc;
		expect(legacy.body).toContain("container");
		expect(toolNames).not.toHaveBeenCalled();
		expect(invoke).not.toHaveBeenCalled();
	});
	it("deduplicates docs returned by a dynamic authority roster", async () => {
		service = createPlayerMcpHttpService({
			client: {
				invoke: vi.fn(),
				toolNames: async () => ({ id: 1, ok: true, result: [DOCS_TOOL] }),
			},
		});
		const answer = await responseJson(await service.fetch(request(rpc("tools/list"))));
		expect(
			(answer.result as { tools: Array<{ name: string }> }).tools.map((row) => row.name),
		).toEqual([DOCS_TOOL, SPELLKAVE_FEEDBACK_TOOL]);
	});
	it("returns typed routing ambiguity from tools/list before attaching a session", async () => {
		const invoke = vi.fn<PlayerSessionClient["invoke"]>();
		const toolNames = vi.fn(async () => {
			throw new AmbiguousAuthorityWorldError();
		});
		service = createPlayerMcpHttpService({ client: { invoke, toolNames } });
		const response = await service.fetch(request(rpc("tools/list")));
		expect(response.status).toBe(200);
		expect(await responseJson(response)).toMatchObject({
			id: 1,
			error: {
				code: -32_000,
				data: { code: "ambiguous_authority_world", public_tools: [{ name: DOCS_TOOL }] },
			},
		});
		expect(toolNames).toHaveBeenCalledTimes(1);
		expect(invoke).not.toHaveBeenCalled();
	});
	it("calls a valid tool and preserves daemon-unavailable MCP results", async () => {
		const invoke = vi
			.fn<PlayerSessionClient["invoke"]>()
			.mockResolvedValueOnce({
				id: 1,
				ok: true,
				result: { content: [{ type: "text", text: "oriented" }], details: { tick: 42 } },
			})
			.mockRejectedValueOnce(
				new SessionDaemonTransportError("/private/session.sock", "offline", {
					code: "ECONNREFUSED",
				}),
			);
		service = createPlayerMcpHttpService({ client: { invoke } });
		const toolName = PLAYER_TOOL_NAMES[0] ?? "";

		const success = await responseJson(
			await service.fetch(request(rpc("tools/call", { name: toolName, arguments: {} }))),
		);
		expect(success).toMatchObject({
			result: {
				content: [{ type: "text", text: "oriented" }],
				structuredContent: { tick: 42 },
			},
		});

		const unavailable = await responseJson(
			await service.fetch(request(rpc("tools/call", { name: toolName, arguments: {} }))),
		);
		expect(unavailable).toMatchObject({
			result: {
				isError: true,
				structuredContent: { error: { category: "transport", code: "ECONNREFUSED" } },
			},
		});
		expect(JSON.stringify(unavailable)).not.toContain("/private/session.sock");
	});

	// keep(K2): the MCP service's own guards with an injected 64-byte limit; in the hosted binary the gateway's 1 MiB check answers first (behaviour/browser.feature)
	it("rejects hostile origins, wrong content types, and oversized bodies", async () => {
		service = createPlayerMcpHttpService({
			client: { invoke: vi.fn() as never },
			maxBodyBytes: 64,
		});

		const hostileOrigin = await service.fetch(
			request(rpc("tools/list"), { headers: { ...jsonHeaders, origin: "https://evil.example" } }),
		);
		expect(hostileOrigin.status).toBe(403);

		const wrongType = await service.fetch(
			request(rpc("tools/list"), {
				headers: { ...jsonHeaders, "content-type": "text/plain" },
			}),
		);
		expect(wrongType.status).toBe(415);

		const oversized = await service.fetch(request(rpc("tools/list", { padding: "x".repeat(80) })));
		expect(oversized.status).toBe(413);
	});

	// keep(K1): GHSA-46jr-4wx8-v453 must be bounded before SDK schema validation.
	it("accepts an SDK authoring example and refuses cap+1 before dispatch", async () => {
		const count = (value: unknown): number =>
			value !== null && typeof value === "object"
				? Object.values(value).reduce<number>((total, item) => total + 1 + count(item), 0)
				: 0;
		const largest = parse(readFileSync(
			new URL("../../../spellkave-world-author/docs/examples/authored-dark-cave.toml", import.meta.url),
			"utf8",
		));
		expect(count(largest)).toBeGreaterThan(0);
		expect(count(largest) * 10).toBeLessThanOrEqual(AUTHOR_MCP_MAX_INPUT_ELEMENTS);
		const invoke = vi.fn<PlayerSessionClient["invoke"]>().mockResolvedValue({
			id: 1,
			ok: true,
			result: { content: [{ type: "text", text: "accepted" }], details: {} },
		});
		const endpoint = createPlayerMcpHttpService({
			client: {
				invoke,
				toolNames: async () => ({ id: 1, ok: true, result: ["spellkave_set_metadata"] }),
			},
		});
		service = endpoint;
		const call = async (name: string, args: unknown) =>
			responseJson(await endpoint.fetch(request(rpc("tools/call", { name, arguments: args }))));
		const accepted = await call("spellkave_set_metadata", {
			target: "manifest",
			key: "corpus",
			value: largest,
		});
		expect(accepted).toMatchObject({ result: { content: [{ type: "text", text: "accepted" }] } });
		for (const [name, limit] of [
			["spellkave_set_metadata", AUTHOR_MCP_MAX_INPUT_ELEMENTS],
			[DOCS_TOOL, PLAYER_MCP_MAX_INPUT_ELEMENTS],
		] as const) {
			// One object member plus limit array entries = cap+1, under the byte cap.
			const rejected = await call(name, { padding: Array(limit).fill(0) });
			expect(rejected).toMatchObject({ result: { isError: true } });
			expect(JSON.stringify(rejected)).toContain(`maximum of ${limit} elements`);
		}
		expect(invoke).toHaveBeenCalledTimes(1);
		// A refusal leaves the same endpoint usable for subsequent calls.
		expect(
			await call("spellkave_set_metadata", { target: "manifest", key: "ok", value: true }),
		).toMatchObject({ result: { content: [{ type: "text", text: "accepted" }] } });
	});

	// keep(K2): max-size portable source through both real SDK HTTP body readers.
	it("preserves the 1 MiB, 128-fragment source inside the 8 MiB HTTP envelope", async () => {
		const fragments = Array.from({ length: 128 }, (_, i) => ({ path: `part-${i}.toml`, toml: "" }));
		const pathBytes = fragments.reduce(
			(n, fragment) => n + fragment.path.length,
			"manifest.toml".length,
		);
		const source = {
			root_path: "manifest.toml",
			root_toml: "#" + "x".repeat(1024 * 1024 - pathBytes - 2) + "\n",
			fragments,
		};
		const invoke = vi.fn<PlayerSessionClient["invoke"]>().mockResolvedValue({
			id: 1,
			ok: true,
			result: { content: [{ type: "text", text: "accepted" }], details: {} },
		});
		const endpoint = createPlayerMcpHttpService({
			client: {
				invoke,
				toolNames: async () => ({ id: 1, ok: true, result: ["spellkave_applyset_diff"] }),
			},
		});
		service = endpoint;
		const body = JSON.stringify(
			rpc("tools/call", { name: "spellkave_applyset_diff", arguments: { source } }),
		).padEnd(DEFAULT_MCP_MAX_BODY_BYTES, " ");
		const server = createServer(createPlayerMcpNodeHandler(endpoint));
		await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
		try {
			const address = server.address();
			if (address === null || typeof address === "string") throw new Error("no loopback port");
			const response = await fetch(`http://127.0.0.1:${address.port}/mcp`, {
				method: "POST",
				headers: jsonHeaders,
				body,
			});
			expect(response.status).toBe(200);
			expect(await responseJson(response)).toMatchObject({
				result: { content: [{ text: "accepted" }] },
			});
			expect(invoke).toHaveBeenCalledTimes(1);
			const refused = await endpoint.fetch(
				new Request("http://localhost/mcp", {
					method: "POST",
					headers: jsonHeaders,
					body: body + " ",
				}),
			);
			expect(refused.status).toBe(413);
			expect(invoke).toHaveBeenCalledTimes(1);
		} finally {
			await new Promise<void>((resolve, reject) =>
				server.close((error) => (error ? reject(error) : resolve())),
			);
		}
	});

	it("times out stalled requests and exposes only redacted readiness", async () => {
		service = createPlayerMcpHttpService({
			client: {
				invoke: () => new Promise(() => undefined),
			},
			requestTimeoutMs: 10,
			readiness: () => false,
		});

		const timedOut = await service.fetch(
			request(rpc("tools/call", { name: PLAYER_TOOL_NAMES[0], arguments: {} })),
		);
		expect(timedOut.status).toBe(504);

		const health = await service.fetch(
			new Request("http://localhost/healthz", { headers: { host: "localhost" } }),
		);
		expect(health.status).toBe(503);
		expect(await health.json()).toEqual({
			service: "spellkave-player-mcp",
			status: "unavailable",
		});
	});
});

describe("live MCP registry projection", () => {
	it("refreshes tools/list from the session and retains canonical elevated schemas", async () => {
		let names = ["spellkave_applyset_apply"];
		const service = createPlayerMcpHttpService({
			client: {
				invoke: async () => ({ id: 1, ok: true, result: { content: [], details: {} } }),
				toolNames: async () => ({ id: 1, ok: true, result: names }),
			},
		});
		try {
			const first = await responseJson(await service.fetch(request(rpc("tools/list"))));
			const tools = (
				first.result as { tools: Array<{ name: string; inputSchema: { properties: object } }> }
			).tools;
			expect(tools.map((tool) => tool.name)).toEqual([
				DOCS_TOOL,
				"spellkave_applyset_apply",
				SPELLKAVE_FEEDBACK_TOOL,
			]);
			expect(tools[1]?.inputSchema.properties).toHaveProperty("source");
			names = [];
			const second = await responseJson(await service.fetch(request(rpc("tools/list"))));
			expect(
				(second.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name),
			).toEqual([DOCS_TOOL, SPELLKAVE_FEEDBACK_TOOL]);
		} finally {
			await service.close();
		}
	});
});
