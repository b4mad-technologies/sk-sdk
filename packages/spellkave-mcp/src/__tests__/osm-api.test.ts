// A map client reads the world as OpenStreetMap API 0.6: capabilities, bounding-box map
// and elements by id, with oversized boxes and writes refused. If it breaks, map tools
// cannot read the world. Runs against a static demo world cache and a signed test
// token, no live world.

// keep-file(K2): OSM API handler over a static world cache; the offline gateway has no world export

import { describe, expect, it } from "vitest";

import { createPlayerMcpGateway } from "../gateway.ts";
import { createStaticWorldOsmCache, elementsInBboxFromDoc } from "../osm-model.ts";
import { createTestSigner } from "./jwt-helpers.ts";
import { sampleOsmSnapshot } from "./osm-fixture.ts";

const origin = "https://mcp.example.test";
const issuer = "https://authkit.example.test";

describe("OSM API 0.6 read endpoints", () => {
	it("serves capabilities, map bbox, element by id, rejects oversized bbox and writes", async () => {
		const snap = sampleOsmSnapshot();
		const cache = createStaticWorldOsmCache({ "demo": snap });
		const signer = await createTestSigner();
		const now = Math.floor(Date.now() / 1000);
		const gateway = createPlayerMcpGateway({
			resourceConfig: {
				canonicalOrigin: origin,
				issuer,
				jwks: [signer.publicJwk],
			},
			client: {
				invoke: async () => ({
					id: 1,
					ok: true as const,
					result: { content: [{ type: "text" as const, text: "ok" }] },
				}),
			},
			now: () => now * 1000,
			osmCache: cache,
			osmWorldSlugs: new Set(["demo"]),
			allowedHostnames: ["mcp.example.test"],
			allowedOriginHostnames: ["mcp.example.test"],
		});
		const token = await signer.sign({
			iss: issuer,
			aud: `${origin}/mcp`,
			sub: "user_ok",
			exp: now + 300,
			iat: now,
		});
		const headers = {
			host: "mcp.example.test",
			authorization: `Bearer ${token}`,
		};

		const caps = await gateway.fetch(
			new Request(`${origin}/w/demo/api/0.6/capabilities`, { headers }),
		);
		expect(caps.status).toBe(200);
		const capsXml = await caps.text();
		expect(capsXml).toContain('api="readonly"');
		expect(capsXml).toContain('area maximum="0.25"');

		const map = await gateway.fetch(
			new Request(`${origin}/w/demo/api/0.6/map?bbox=-122.303,47.498,-122.296,47.501`, {
				headers: { ...headers, accept: "application/json" },
			}),
		);
		expect(map.status).toBe(200);
		const mapJson = (await map.json()) as { elements: unknown[] };
		expect(mapJson.elements.length).toBe(3);

		const big = await gateway.fetch(
			new Request(`${origin}/w/demo/api/0.6/map?bbox=-180,-90,180,90`, { headers }),
		);
		expect(big.status).toBe(400);
		expect(await big.text()).toContain("The maximum bbox size is 0.25");

		const nodeId = snap.doc.nodes[0]?.id;
		expect(nodeId).toBeTruthy();
		const node = await gateway.fetch(
			new Request(`${origin}/w/demo/api/0.6/node/${nodeId}.json`, { headers }),
		);
		expect(node.status).toBe(200);
		const nodeJson = (await node.json()) as { elements: Array<{ id: string }> };
		expect(nodeJson.elements[0]?.id).toBe(nodeId);

		const write = await gateway.fetch(
			new Request(`${origin}/w/demo/api/0.6/changeset/create`, {
				method: "PUT",
				headers,
				body: "<osm/>",
			}),
		);
		expect(write.status).toBe(405);
		expect(write.headers.get("allow")).toContain("GET");

		const unauth = await gateway.fetch(
			new Request(`${origin}/w/demo/api/0.6/capabilities`, {
				headers: { host: "mcp.example.test" },
			}),
		);
		expect(unauth.status).toBe(401);

		const unknown = await gateway.fetch(
			new Request(`${origin}/w/no-such-world/api/0.6/capabilities`, { headers }),
		);
		expect(unknown.status).toBe(404);

		await gateway.close();
		await cache.close();
	});

	it("elementsInBbox includes way nodes outside the box (map semantics)", () => {
		const doc = {
			generator: "t",
			tick: 0,
			timestamp: "2026-08-22T00:00:00Z",
			nodes: [
				{
					type: "node" as const,
					id: "1",
					lat: 0,
					lon: 0,
					tags: {},
					version: 1,
					changeset: 1,
					uid: 1,
					user: "u",
					visible: true,
					timestamp: "2026-08-22T00:00:00Z",
				},
				{
					type: "node" as const,
					id: "2",
					lat: 10,
					lon: 10,
					tags: {},
					version: 1,
					changeset: 1,
					uid: 1,
					user: "u",
					visible: true,
					timestamp: "2026-08-22T00:00:00Z",
				},
			],
			ways: [
				{
					type: "way" as const,
					id: "10",
					refs: ["1", "2"],
					tags: { highway: "path" },
					version: 1,
					changeset: 1,
					uid: 1,
					user: "u",
					visible: true,
					timestamp: "2026-08-22T00:00:00Z",
				},
			],
			relations: [],
		};
		const set = elementsInBboxFromDoc(doc, -1, -1, 1, 1);
		expect(set.nodes.map((n) => n.id).sort()).toEqual(["1", "2"]);
		expect(set.ways).toHaveLength(1);
	});
});
