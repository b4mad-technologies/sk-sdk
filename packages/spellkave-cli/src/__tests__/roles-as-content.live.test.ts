// Roles are authored content: a manifest defines which capabilities a role
// holds. `sk explain role` must show that composition by its authored names,
// `sk diff -k`/`sk apply -k` must export and prune it, and a role definition
// alone must grant nothing to someone without a binding.
// Needs a local node (SPELLKAVE_LOCAL_NODE=1); skips otherwise.
// Spec: AUTH-33-01 (explain a role), AUTH-33-02 (a definition grants nothing).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	applyManifestDelta,
	connectDedicatedClaimWorld,
	connectTestWorld,
	ensureWorldAuthority,
	operatorScopeManifest,
	type TestWorld,
	waitForEvent,
} from "@spellkave/test-lab";
import { inspectManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";
import { runCli } from "../cli";
import { collect } from "./helpers";
import { observeAfter, settleObserver } from "./live-observers";

const header = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
`;
const bundle = (id: string) => `[[bundles]]
bundle_id = "${id}"
display_name = "Roles proof"
author = "synthetic"
version = "1.0.0"
`;
const vocabulary = operatorScopeManifest("roles proof public vocabulary", [
	"role_definition",
	"role_aggregation",
	"capability_definition",
	"extent_kind_definition",
	"actor",
	"mod_bundle",
]);
const rows = (world: TestWorld, name: string): Record<string, unknown>[] => {
	const table = world.db()[name];
	if (!table) throw new Error(`missing subscribed public table ${name}`);
	return [...table.iter()] as Record<string, unknown>[];
};
const text = (value: unknown) =>
	JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));

describe.skipIf(process.env.SPELLKAVE_LOCAL_NODE !== "1")("roles-as-content real admission", () => {
	it("explains, exports and prunes an authored role, and a definition without a binding grants nothing (AUTH-33-01, AUTH-33-02)", async () => {
		const started = Date.now();
		// Applyset ownership includes the absolute root path. Keep that path
		// stable across fresh/reused processes for this isolated database.
		const databaseKey = createHash("sha256")
			.update(`${process.env.SPELLKAVE_URL}/${process.env.SPELLKAVE_DB}`)
			.digest("hex")
			.slice(0, 16);
		const directory = join(tmpdir(), `roles-content-proof-${databaseKey}`);
		const applysetHeader = `applyset = "roles-content-proof-${databaseKey}"\n`;
		mkdirSync(directory, { recursive: true });
		const evidence = resolve(
			process.env.SPELLKAVE_ROLES_EVIDENCE_DIR ?? join(directory, "evidence"),
		);
		mkdirSync(evidence, { recursive: true });
		const interactions: Record<string, unknown>[] = [];
		const observations: Record<string, unknown>[] = [];
		const previousToken = process.env.SPELLKAVE_CONNECT_TOKEN;
		const publisher = resolveSpacetimeConfigPathToken();
		if (!publisher) throw new Error("local publisher credential unavailable");
		let owner: TestWorld | undefined;
		let author: TestWorld | undefined;
		let unbound: TestWorld | undefined;
		const capture = (status: string) =>
			writeFileSync(
				join(evidence, "capture.json"),
				text({
					schema: "roles-content-proof/v1",
					testedAt: new Date().toISOString(),
					status,
					testSourceSha256: createHash("sha256")
						.update(readFileSync(import.meta.filename))
						.digest("hex"),
					serverWasmSha256: process.env.SPELLKAVE_ROLES_WASM_SHA256 ?? null,
					surface:
						"local production SDK admission and actual CLI; installed consumer captured separately",
					interactions,
					observations,
					elapsedMs: Date.now() - started,
					boundaries: [
						"credentials and connection bootstrap excluded",
						"SDK subscription/seal protocol traffic excluded",
						"future AUTH-33-02 authorized binding recovery remains planned",
						"not hosted MCP acceptance",
					],
					modelAccounting: { inferenceCalls: 0, mode: "scripted" },
					imageAccounting: { images: 0 },
				}),
			);
		const apply = async (world: TestWorld, source: string, label: string) => {
			const entry = {
				kind: "SDK manifest submission",
				label,
				requestText: source,
				responseText: "",
				outcome: "pending",
			};
			interactions.push(entry);
			try {
				await observeAfter(
					() => applyManifestDelta(world, source, { tolerateAlreadyApplied: true }),
					[owner, author, unbound].filter((w): w is TestWorld => w !== undefined),
				);
				entry.outcome = "sealed";
			} catch (error) {
				entry.responseText = String(error);
				entry.outcome = "refused";
				throw error;
			} finally {
				capture("running");
			}
		};
		const cli = async (argv: string[], token = publisher) => {
			process.env.SPELLKAVE_CONNECT_TOKEN = token;
			const output = collect();
			const exitCode = await runCli(
				["--format", "jsonl", "--workspace", join(directory, "scratch"), ...argv],
				output.io,
			);
			if (owner) await settleObserver(owner);
			interactions.push({
				kind: "CLI",
				argv,
				exitCode,
				requestText: text(argv),
				responseText: output.out.join("\n"),
				stderr: output.err.join("\n"),
			});
			capture("running");
			return {
				exitCode,
				out: output.out.map((line) => JSON.parse(line) as Record<string, unknown>),
			};
		};
		try {
			owner = await connectTestWorld({ token: publisher, readerManifests: [vocabulary] });
			author = await connectDedicatedClaimWorld({ readerManifests: [vocabulary] }, "roles-author");
			unbound = await connectDedicatedClaimWorld(
				{ readerManifests: [vocabulary] },
				"roles-unbound",
			);
			expect(author.identity).not.toBe(owner.identity);
			expect(unbound.identity).not.toBe(author.identity);
			expect(author.token).toBeTruthy();
			if (rows(owner, "actor").length === 0) {
				await apply(
					unbound,
					header +
						bundle("roles_genesis") +
						`
[[role_definitions]]
role_id = "roles_genesis/viewer"
bundle_id = "roles_genesis"
display_name = "Genesis viewer"
description = "Reserved vocabulary admitted before any actor exists."
capability_ids = ["frontier.read_hidden"]
`,
					"fresh genesis reserved vocabulary positive control",
				);
				await waitForEvent(
					owner,
					() => rows(owner!, "role_definition").some((r) => r.roleId === "roles_genesis/viewer"),
					"genesis role never committed",
				);
				observations.push({ label: "actual genesis exception", outcome: "passed" });
			} else
				observations.push({
					label: "genesis exception",
					outcome: "not rerun on reused non-genesis database",
				});
			await ensureWorldAuthority(owner);
			// Recover only this probe's temporary control if an earlier local
			// failed attempt stopped before its withdrawal.
			await apply(
				owner,
				header +
					bundle("roles_dm_control").replace(
						'version = "1.0.0"',
						`version = "1.0.0-start-${started}"`,
					) +
					`
[[retractions]]
row_kind = "role_aggregation"
authored_key = '["dm","roles_dm_control"]'
`,
				"remove retained temporary admission control before parity",
			);
			await waitForEvent(
				owner,
				() => !rows(owner!, "role_aggregation").some((r) => r.bundleId === "roles_dm_control"),
				"retained temporary dm control not removed",
			);
			await apply(
				owner,
				header +
					bundle("roles_owner") +
					`
[[entities]]
entity_key = "roles_owner/author"
bundle_id = "roles_owner"
name = "Synthetic author"
kind = "npc"
place_node_id = "test_lab_live_on_demand_gatekeeper/root"
[[actors]]
entity_key = "roles_owner/author"
bundle_id = "roles_owner"
name = "Synthetic author"
[[actor_identities]]
entity_key = "roles_owner/author"
bundle_id = "roles_owner"
identity = "${author.identity}"
role = "primary"
[[actor_capabilities]]
actor_entity_key = "roles_owner/author"
bundle_id = "roles_owner"
capability_id = "frontier.apply_manifest"
source = "roles-proof-publisher-authored"
[[capability_definitions]]
capability_id = "roles_owner/weather"
bundle_id = "roles_owner"
actor_kind = "entity"
display_name = "Weather"
description = "Synthetic weather authority vocabulary."
[[role_definitions]]
role_id = "roles_owner/gm"
bundle_id = "roles_owner"
display_name = "GM"
description = "Synthetic custom role."
capability_ids = ["roles_owner/weather"]
`,
				"setup actual author grant and custom role",
			);
			const original = rows(owner, "role_definition").find((r) => r.roleId === "roles_owner/gm");
			expect(original).toBeDefined();
			for (const [kind, id] of [
				["role", "dm"],
				["extent-kind", "place_graph"],
			] as const) {
				const files = await cli(["--no-target", "explain", kind, id]);
				const live = await cli(["explain", kind, id, "--target", "live"], unbound.token!);
				expect(files.exitCode).toBe(0);
				expect(live.exitCode).toBe(0);
				const fileAnswer = files.out.find((r) => r.kind === "explain_result")!;
				const liveAnswer = live.out.find((r) => r.kind === "explain_result")!;
				const { source: _fileSource, ...fileFields } = fileAnswer;
				expect(liveAnswer.reads_as_publisher).toBe(false);
				expect(liveAnswer.connected_identity).toBe(unbound.identity);
				const {
					source: _liveSource,
					reads_as_publisher: _publisher,
					connected_identity: _identity,
					...liveFields
				} = liveAnswer;
				expect(liveFields).toEqual(fileFields);
				observations.push({
					label: `${kind} ${id} files/live authored vocabulary parity`,
					files: fileAnswer,
					live: liveAnswer,
				});
			}
			const ordinary =
				header +
				bundle("roles_other") +
				`
[[role_aggregations]]
role_id = "roles_owner/gm"
bundle_id = "roles_other"
description = "Contribution on an already-live role without a file dependency."
capability_ids = ["roles_owner/weather"]
`;
			await apply(author, ordinary, "ordinary live aggregation positive control");
			await waitForEvent(
				owner,
				() => rows(owner!, "role_aggregation").some((r) => r.bundleId === "roles_other"),
				"ordinary contribution never committed",
			);
			const takeover =
				header +
				bundle("roles_other") +
				`
[[role_definitions]]
role_id = "roles_owner/gm"
bundle_id = "roles_other"
display_name = "Takeover"
description = "Must refuse."
capability_ids = []
`;
			await expect(apply(author, takeover, "foreign owner refusal")).rejects.toThrow("MF-VAL-367");
			expect(rows(owner, "role_definition").find((r) => r.roleId === "roles_owner/gm")).toEqual(
				original,
			);
			const reservedBefore = ["role_definition", "role_aggregation", "capability_definition"].map(
				(name) => rows(owner!, name),
			);
			for (const body of [
				`[[role_definitions]]\nrole_id = "roles_other/reserved"\nbundle_id = "roles_other"\ndisplay_name = "Reserved"\ndescription = "Must refuse."\ncapability_ids = ["frontier.pace_time"]\n`,
				`[[role_aggregations]]\nrole_id = "dm"\nbundle_id = "roles_other"\ndescription = "Must refuse."\ncapability_ids = ["frontier.pace_time"]\n`,
				`[[capability_definitions]]\ncapability_id = "frontier.bind.synthetic"\nbundle_id = "roles_other"\nactor_kind = "entity"\ndisplay_name = "Reserved"\ndescription = "Must refuse."\n`,
			])
				await expect(
					apply(author, header + bundle("roles_other") + body, "reserved vocabulary refusal"),
				).rejects.toThrow("MF-APPLY-035");
			expect(
				["role_definition", "role_aggregation", "capability_definition"].map((name) =>
					rows(owner!, name),
				),
			).toEqual(reservedBefore);
			observations.push({
				label: "reserved vocabulary refusals retain all three public catalogs",
				catalogs: reservedBefore,
			});
			const dmControl = (capability: string) =>
				header +
				bundle("roles_dm_control") +
				`
[[role_aggregations]]
role_id = "dm"
bundle_id = "roles_dm_control"
description = "Exact ordinary and publisher-reserved admission controls, run ${started}."
capability_ids = ["${capability}"]
`;
			await apply(
				author,
				dmControl("roles_owner/weather"),
				"ordinary apply-author widens dm positive control",
			);
			await waitForEvent(
				owner,
				() =>
					rows(owner!, "role_aggregation").some(
						(r) =>
							r.bundleId === "roles_dm_control" &&
							(r.capabilityIds as string[]).includes("roles_owner/weather"),
					),
				"ordinary dm contribution absent",
			);
			await apply(
				owner,
				dmControl("frontier.pace_time"),
				"publisher widens dm with reserved authority positive control",
			);
			await waitForEvent(
				owner,
				() =>
					rows(owner!, "role_aggregation").some(
						(r) =>
							r.bundleId === "roles_dm_control" &&
							(r.capabilityIds as string[]).includes("frontier.pace_time"),
					),
				"publisher dm contribution absent",
			);
			// A new replay has a new digest even though it withdraws the same
			// key: an earlier completed tombstone must not skip this deletion.
			await apply(
				owner,
				header +
					bundle("roles_dm_control").replace(
						'version = "1.0.0"',
						`version = "1.0.0-run-${started}"`,
					) +
					`
[[retractions]]
row_kind = "role_aggregation"
authored_key = '["dm","roles_dm_control"]'
`,
				"withdraw temporary dm admission control",
			);
			await waitForEvent(
				owner,
				() => !rows(owner!, "role_aggregation").some((r) => r.bundleId === "roles_dm_control"),
				"temporary dm contribution retained",
			);
			const bundlesBefore = rows(owner, "mod_bundle");
			await expect(
				apply(
					unbound,
					header + bundle("roles_unbound"),
					"AUTH-33-02 local definition grants nothing",
				),
			).rejects.toThrow("MF-APPLY-015");
			expect(rows(owner, "mod_bundle")).toEqual(bundlesBefore);
			observations.push({
				label: "AUTH-33-02 refusal leaves bundles unchanged; binding recovery remains planned",
				bundles: bundlesBefore,
			});
			const root = join(directory, "roles.manifest.toml");
			const reference =
				bundle("roles_owner") +
				`
[[capability_definitions]]
capability_id = "roles_owner/weather"
bundle_id = "roles_owner"
actor_kind = "entity"
display_name = "Weather"
description = "Synthetic weather authority vocabulary."
`;
			const contribution =
				header +
				applysetHeader +
				reference +
				bundle("roles_content") +
				'depends_on = ["roles_owner"]\n' +
				`
[[role_definitions]]
role_id = "roles_content/local"
bundle_id = "roles_content"
display_name = "Local role"
description = "Owned export role."
capability_ids = []
[[role_aggregations]]
role_id = "dm"
bundle_id = "roles_content"
description = "Weather added to DM."
capability_ids = ["roles_owner/weather"]
`;
			writeFileSync(root, contribution);
			const beforeUnboundCli = rows(owner, "mod_bundle");
			const deniedCli = await cli(["apply", "-k", root], unbound.token!);
			expect(deniedCli.exitCode).toBe(2);
			expect(rows(owner, "mod_bundle")).toEqual(beforeUnboundCli);
			observations.push({
				label: "AUTH-33-02 actual author CLI refusal leaves admitted bundles unchanged",
				exitCode: deniedCli.exitCode,
			});
			expect((await cli(["apply", "-k", root])).exitCode).toBe(0);
			const diff = await cli(["diff", "-k", root]);
			expect(diff.exitCode).toBe(0);
			expect(diff.out.find((r) => r.kind === "diff_result")).toMatchObject({
				differences: false,
				counts: { create: 0, configure: 0, prune: 0 },
			});
			const explained = await cli(["explain", "role", "dm", "--target", "live"], unbound.token!);
			expect(explained.exitCode).toBe(0);
			const answer = explained.out.find((r) => r.kind === "explain_result")!;
			expect(answer.capability_ids).toContain("roles_owner/weather");
			expect(answer.contributions).toEqual(
				expect.arrayContaining([expect.objectContaining({ bundle_id: "roles_content" })]),
			);
			const exportedPath = join(directory, "exported.toml");
			expect(
				(await cli(["--live", "export", "roles_content", "--out", exportedPath])).exitCode,
			).toBe(0);
			const exported = inspectManifest(readFileSync(exportedPath, "utf8")).manifest;
			expect(exported.role_definitions).toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						role_id: "roles_content/local",
						description: "Owned export role.",
					}),
				]),
			);
			expect(exported.role_aggregations).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ role_id: "dm", bundle_id: "roles_content" }),
				]),
			);
			expect(
				(exported.role_definitions as Record<string, unknown>[]).some((r) => r.role_id === "dm"),
			).toBe(false);
			writeFileSync(
				root,
				header +
					applysetHeader +
					reference +
					bundle("roles_content") +
					'depends_on = ["roles_owner"]\n',
			);
			expect((await cli(["apply", "-k", root, "--prune"])).exitCode).toBe(0);
			const pruned = await cli(["explain", "role", "dm", "--target", "live"], unbound.token!);
			const after = pruned.out.find((r) => r.kind === "explain_result")!;
			expect(after.capability_ids).not.toContain("roles_owner/weather");
			expect(after.definition).toMatchObject({ role_id: "dm", bundle_id: "core" });
			observations.push({
				label: "composition before/after prune",
				before: answer,
				after,
				originalOwnerRetained: original,
				export: exported,
			});
			capture("passed");
		} catch (error) {
			observations.push({ failure: String(error) });
			capture("failed");
			throw error;
		} finally {
			owner?.disconnect();
			author?.disconnect();
			unbound?.disconnect();
			if (previousToken === undefined) delete process.env.SPELLKAVE_CONNECT_TOKEN;
			else process.env.SPELLKAVE_CONNECT_TOKEN = previousToken;
		}
	}, 180_000);
});
