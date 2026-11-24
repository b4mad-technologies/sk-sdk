// A player's scene request over HTTP MCP reaches the selected caller daemon and passes
// production scene admission with its parameters, so a scene only runs for the right
// seat and inputs. If it breaks, scenes run with wrong parameters or are blocked. Needs a
// staged world on a live node. Spec: AUTH-50-01/02.

// keep-file(K2): live caller-authenticated journeys against a staged world; the offline behaviour suite has no world

import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { execFileSyncGit } from "@spellkave/behaviour/git-env";
import { parseWorldCatalog, probeWorldSeat } from "@spellkave/gateway-identity";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import { SessionDaemonClient, startDaemon } from "@spellkave/session/node";
import {
	applyManifestDelta,
	applyManifestSource,
	connectDedicatedClaimWorld,
	connectTestWorld,
	ensureWorldAuthority,
	readFixtureSource,
} from "@spellkave/test-lab";
import type { ScenePackage } from "@spellkave/tool-authoring";
import { renderSchemaManifest } from "@spellkave/world-author/tooling";
import { describe, expect, it } from "vitest";
import { createPlayerMcpHttpService } from "../http";
import { withRemoteMcpAccessToken, withRemoteMcpRequestSubject } from "../observability";
import { JwtBoundPlayerSessionClient } from "../runtime";

const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? String(x) : x));
const enabled =
	process.env.SPELLKAVE_LOCAL_NODE === "1" && process.env.SPELLKAVE_SCENE_MCP_PROOF === "1";
describe.skipIf(!enabled)("caller-authenticated parameterized scene MCP", () => {
	it("AUTH-50-01 admits portable payloads; AUTH-50-02 refuses replay and gateway paths", async () => {
		if (
			!process.env.SPELLKAVE_DB?.startsWith("spellkave-scene-mcp") ||
			!process.env.SPELLKAVE_URL?.startsWith("http://127.0.0.1:")
		)
			throw new Error("disposable local scene MCP DB required");
		const at = Date.now(),
			id = `scene50m_${randomUUID().replaceAll("-", "")}`,
			dest = `${id}_runs`;
		const owner = await connectTestWorld({ token: resolveSpacetimeConfigPathToken() });
		const author = await connectDedicatedClaimWorld({}, `${id}-author`);
		const dir = mkdtempSync(resolve(tmpdir(), "scene50-mcp-"));
		const handles: Awaited<ReturnType<typeof startDaemon>>[] = [];
		const calls: unknown[] = [],
			assertions: unknown[] = [];
		let status = "failed";
		const source = renderSchemaManifest({
			schema_version: "1.0.0",
			bundles: [
				{
					bundle_id: id,
					display_name: "Scene source",
					author: "synthetic",
					version: "1.0.0",
					depends_on: ["core", "test_lab_live_on_demand_gatekeeper"],
				},
			],
			place_graphs: [
				{
					bundle_id: id,
					place_graph_id: `${id}/room`,
					substrate_id: "test_lab_live_on_demand_gatekeeper/plane",
					display_name: "Empty blueprint",
					anchor_node_id: `${id}/room/entry`,
				},
			],
			place_nodes: [
				{
					bundle_id: id,
					node_id: `${id}/room/entry`,
					place_graph_id: `${id}/room`,
					local_id: "entry",
					substrate_id: "test_lab_live_on_demand_gatekeeper/plane",
					display_name: "Entry",
				},
			],
			entity_definitions: [
				{ bundle_id: id, entity_def_id: `${id}/target`, display_name: "Target" },
			],
		});
		const pkg: ScenePackage = {
			format: "spellkave-scene/v1",
			id: "target-room",
			version: "1.0.0",
			bundle_id: dest,
			blueprint_id: `${id}/room`,
			dependencies: [id, "core", "test_lab_live_on_demand_gatekeeper"],
			figures: [
				{
					key: "targets",
					entity_def_id: `${id}/target`,
					node_local_id: "entry",
					name: "Target",
					kind: "npc",
					default_count: 1,
					max_count: 4,
				},
			],
		};
		const headers = renderSchemaManifest({
			schema_version: "1.0.0",
			bundles: [
				{ bundle_id: "core", display_name: "Core", author: "test", version: "1.0.0" },
				{
					bundle_id: "test_lab_live_on_demand_gatekeeper",
					display_name: "Gatekeeper",
					author: "test",
					version: "1.0.0",
					depends_on: ["core"],
				},
			],
		});
		const catalog = parseWorldCatalog({
			v: "player-world-catalog/v1",
			worlds: [
				{
					slug: "scene-proof",
					db: process.env.SPELLKAVE_DB!,
					display_name: "Scene proof",
					adventure: "synthetic",
					visibility: "public",
					join_policy: "invite",
					status: "running",
					owner: "setup",
					members: [],
				},
			],
		});
		const caller = new JwtBoundPlayerSessionClient(
			process.env.SPELLKAVE_URL!,
			catalog,
			(w, t) => probeWorldSeat(process.env.SPELLKAVE_URL!, w.db, t),
			{
				attach: async (binding, token) => {
					const h = await startDaemon({
						binding,
						token,
						socketPath: resolve(dir, `${handles.length}.sock`),
						env: { SPELLKAVE_RUN_EVENTS: "off" },
					});
					handles.push(h);
					return new SessionDaemonClient({ socketPath: h.socketPath, spawned: true });
				},
			},
		);
		const service = createPlayerMcpHttpService({ client: caller });
		let sequence = 0;
		const request = async (method: string, params: object = {}) => {
			const body = { jsonrpc: "2.0", id: ++sequence, method, params };
			const started = Date.now();
			const r = await withRemoteMcpRequestSubject(author.identity!, () =>
				withRemoteMcpAccessToken(author.token!, () =>
					service.fetch(
						new Request("http://localhost/mcp", {
							method: "POST",
							headers: {
								host: "localhost",
								accept: "application/json, text/event-stream",
								"content-type": "application/json",
							},
							body: json(body),
						}),
					),
				),
			);
			const raw = await r.text(),
				data = r.headers.get("content-type")?.includes("text/event-stream")
					? raw
							.split("\n")
							.find((x) => x.startsWith("data: "))
							?.slice(6)
					: raw;
			if (!data) throw new Error("missing MCP response frame");
			const response = JSON.parse(data);
			calls.push({
				category: "consumer",
				request: body,
				response,
				status: r.status,
				requestBytes: Buffer.byteLength(json(body)),
				responseBytes: Buffer.byteLength(raw),
				elapsedMs: Date.now() - started,
			});
			return response;
		};
		const tool = (name: string, args: object) => request("tools/call", { name, arguments: args });
		const sql = async (query: string) => {
			const r = await fetch(
				`${process.env.SPELLKAVE_URL}/v1/database/${process.env.SPELLKAVE_DB}/sql`,
				{
					method: "POST",
					headers: { "Content-Type": "text/plain", Authorization: `Bearer ${owner.token}` },
					body: query,
				},
			);
			expect(r.ok).toBe(true);
			const result = (await r.json()) as Array<{ rows: unknown[][] }>;
			const rows = result.flatMap((x) => x.rows);
			assertions.push({ query, rows });
			calls.push({ category: "probe", query, rows });
			return rows;
		};
		try {
			await ensureWorldAuthority(owner);
			await applyManifestSource(
				owner,
				readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
				{ tolerateAlreadyApplied: true },
			);
			await applyManifestDelta(owner, source);
			const fixture = renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [
					{
						bundle_id: dest,
						display_name: pkg.id,
						author: "scene",
						version: "1.0.0",
						depends_on: pkg.dependencies,
					},
				],
				role_bindings: [
					{
						bundle_id: id,
						binding_id: `${id}/read`,
						subject: author.identity,
						role_id: "system-author",
						extent_kind_ref: "bundle",
						extent_ref: id,
						description: "Source Internal read",
					},
					{
						bundle_id: id,
						binding_id: `${id}/place`,
						subject: author.identity,
						role_id: "system-author",
						extent_kind_ref: "place_graph",
						extent_ref: `${id}/room`,
						description: "Placement in source descendants",
					},
					{
						bundle_id: dest,
						binding_id: `${dest}/write`,
						subject: author.identity,
						role_id: "system-author",
						extent_kind_ref: "bundle",
						extent_ref: dest,
						description: "Destination author",
					},
				],
			});
			await applyManifestDelta(owner, fixture);
			calls.push({
				category: "setup",
				operation: "core plus synthetic source and bindings",
				requestSha256: createHash("sha256")
					.update(source + fixture)
					.digest("hex"),
				requestBytes: Buffer.byteLength(source + fixture),
			});
			const listed = await request("tools/list");
			expect(listed.result.tools.map((t: { name: string }) => t.name)).toContain(
				"spellkave_stage_scene",
			);
			const rendered = await tool("spellkave_render_scene", {
				package: pkg,
				values: { anchor_id: `${id}/room/entry`, counts: { targets: 2 } },
				setup_name: "mcp-trial",
				dependencies: [source, headers],
			});
			expect(rendered.result?.isError, json(rendered)).not.toBe(true);
			const plan = rendered.result.structuredContent.plan;
			expect(plan.generated.entity_keys).toHaveLength(2);
			const staged = await tool("spellkave_stage_scene", {
				plan,
				expected_world_instance_id: plan.source_review.world_instance_id,
			});
			expect(staged.result.structuredContent.ok, json(staged)).toBe(true);
			expect(
				await sql(
					`SELECT place_graph_id FROM place_graph_definition WHERE place_graph_id = '${dest}/mcp-trial'`,
				),
			).toHaveLength(1);
			expect(
				await sql(
					`SELECT manifest_key FROM operator_manifest_authored_entity WHERE bundle_id = '${dest}'`,
				),
			).toHaveLength(2);
			const repeated = await tool("spellkave_stage_scene", {
				plan,
				expected_world_instance_id: plan.source_review.world_instance_id,
			});
			expect(repeated.result.structuredContent.ok).toBe(false);
			expect(repeated.result.structuredContent.phases[0].outcome).toBe("refused");
			const path = await tool("spellkave_render_scene", { path: "/gateway/private/scene.json" });
			expect(path.result?.isError || path.error).toBeTruthy();
			expect(
				await sql(`SELECT place_graph_id FROM place_graph_definition WHERE bundle_id = '${dest}'`),
			).toHaveLength(1);
			status = "passed";
		} finally {
			await service.close();

			for (const h of handles) await h.close();
			owner.disconnect();
			author.disconnect();
			rmSync(dir, { recursive: true, force: true });
			const output = resolve(process.env.SPELLKAVE_SCENE_EVIDENCE_DIR ?? ".local/scene-proof");
			mkdirSync(output, { recursive: true });
			const evidence = {
				format: "parameterized-scene-proof/v1",
				scenarioIds: ["AUTH-50-01", "AUTH-50-02"],
				status,
				testedAt: new Date(at).toISOString(),
				implementingRevision: execFileSyncGit(["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
				testSourceSha256: createHash("sha256")
					.update(readFileSync(import.meta.filename))
					.digest("hex"),
				context: {
					persona: "Adventure Author",
					surface: "HTTP MCP post-auth boundary + real selected caller daemon",
					scope: "Internal source Bundle, destination author and source-descendant placement",
					externalClient: "not tested",
				},
				calls,
				assertions,
				cost: {
					calls: calls.length,
					retries: 0,
					elapsedMs: Date.now() - at,
					inferenceCalls: 0,
					modelInputTokens: 0,
					modelOutputTokens: 0,
					images: 0,
					requestUtf8Bytes: calls.reduce<number>(
						(n, x) => n + ((x as { requestBytes?: number }).requestBytes ?? 0),
						0,
					),
					responseUtf8Bytes: calls.reduce<number>(
						(n, x) => n + ((x as { responseBytes?: number }).responseBytes ?? 0),
						0,
					),
					accounting: "recorded HTTP frames and setup/probe records; subscription traffic excluded",
					usability: "scripted discovery; external-client discovery unsupported",
				},
			};
			writeFileSync(
				resolve(output, "mcp-journey.json"),
				json(evidence)
					.replaceAll(id, "scene-mcp-catalog")
					.replaceAll(owner.identity!, "publisher")
					.replaceAll(author.identity!, "author")
					.replaceAll(process.env.SPELLKAVE_URL!, "fixture-node"),
			);
		}
	}, 60000);
});
