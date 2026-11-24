// A world author re-applies their manifest file after play changed something
// the file also sets (an object's state, where it stands). `sk diff` must
// show that conflict, and `sk apply` must refuse to overwrite it until the
// author passes `--force`, so play results are never wiped by accident. An
// author bound to one bundle cannot read the world's apply memory: their
// diff and `--force` are refused before anything is queued. Runs against a
// live node.
// Spec: AUTH-37-01 (drift decision), AUTH-37-02 (bound author refused before enqueue).
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { execFileSyncGit } from "@spellkave/behaviour/git-env";
import { enqueueAndWaitManifestApply } from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import {
	operatorScopeManifest,
	applyManifestDelta as rawApplyManifestDelta,
	applyManifestSource as rawApplyManifestSource,
	connectDedicatedClaimWorld as rawConnectDedicatedClaimWorld,
	connectTestWorld as rawConnectTestWorld,
	ensureApplyManifestAuthority as rawEnsureApplyManifestAuthority,
	manipulateAction as rawManipulateAction,
	type TestWorld,
	waitForEvent,
} from "@spellkave/test-lab";
import { buildApplysetParts } from "@spellkave/world-author/tooling";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProductionCliRunner } from "./production-cli-runner.ts";

const executeFile = promisify(execFile);
const sdkOperations: string[] = [];
const applyManifestDelta = (...args: Parameters<typeof rawApplyManifestDelta>) => {
	sdkOperations.push("setup: raw manifest delta");
	return rawApplyManifestDelta(...args);
};
const applyManifestSource = (...args: Parameters<typeof rawApplyManifestSource>) => {
	sdkOperations.push("probe: whole-bundle invalidation");
	return rawApplyManifestSource(...args);
};
const connectDedicatedClaimWorld = (...args: Parameters<typeof rawConnectDedicatedClaimWorld>) => {
	sdkOperations.push("setup: independent author connection");
	return rawConnectDedicatedClaimWorld(...args);
};
const connectTestWorld = (...args: Parameters<typeof rawConnectTestWorld>) => {
	sdkOperations.push("probe: publisher connection and subscription");
	return rawConnectTestWorld(...args);
};
const ensureApplyManifestAuthority = (
	...args: Parameters<typeof rawEnsureApplyManifestAuthority>
) => {
	sdkOperations.push("setup: authoring authority");
	return rawEnsureApplyManifestAuthority(...args);
};
const manipulateAction = (...args: Parameters<typeof rawManipulateAction>) => {
	sdkOperations.push("setup: authored affordance changes resource");
	return rawManipulateAction(...args);
};
const repository = resolve(import.meta.dirname, "../../../..");
const database = process.env.SPELLKAVE_DB ?? "spellkave-cli-applyset-drift";
const header = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
`;
const bundle = `[[bundles]]
bundle_id = "drift"
display_name = "Drift proof"
version = "1.0.0"
author = "synthetic"
description = "Disposable contract fixture"
`;
const node = (id: string, x: number) => `[[place_nodes]]
node_id = "drift/ground/${id}"
bundle_id = "drift"
place_graph_id = "drift/ground"
local_id = "${id}"
substrate_id = "outdoor"
display_name = "${id}"
pos_x = ${x}
pos_y = 0
pos_present = true
pose_elevation_present = true
extent_shape_id = "core/area/cube"
extent_params_json = '{"extent_m":1}'
`;
const body = `[[place_graphs]]
place_graph_id = "drift/ground"
bundle_id = "drift"
substrate_id = "outdoor"
display_name = "Ground"
${node("start", 0)}${node("end", 1)}
[[resource_definitions]]
resource_definition_id = "drift/charges"
bundle_id = "drift"
display_name = "Charges"
value_kind = "int"
min_value = 0
max_value = 10
recovery_rule = "none"
[[capability_definitions]]
capability_id = "drift/touch-cap"
bundle_id = "drift"
actor_kind = "entity"
display_name = "Touch"
description = "Touch a resource"
[[consequence_templates]]
template_id = "drift/touch/success"
bundle_id = "drift"
[[consequence_frame_writes]]
template_id = "drift/touch/success"
ordinal = 0
[consequence_frame_writes.frame_write.ModifyResource]
actor = "TargetActor"
resource = "drift/charges"
delta_source = "1"
[[action_definitions]]
action_id = "drift/touch"
bundle_id = "drift"
display_name = "Touch"
cost_time_ms = 0
on_success = "drift/touch/success"
required_capability = "drift/touch-cap"
resolution_mode = "Deterministic"
self_eligible = false
self_only = false
[[outcome_templates]]
outcome_template_id = "drift/touch/outcome"
bundle_id = "drift"
manipulation_action_id = "drift/touch"
outcome_bool = true
sense_visibility = "local"
display_name = "Touch"
[[affordance_templates]]
template_id = "drift/touch/affordance"
bundle_id = "drift"
capability_id = "drift/touch-cap"
niche_id = "capability:drift/touch-cap"
outcome_template_id = "drift/touch/outcome"
predicate_bool = true
range_m = 0.0
display_name = "Touch"
[[spatial_niche_attachments]]
bundle_id = "drift"
niche_id = "capability:drift/touch-cap"
place_node_id = "drift/ground/start"
[[entities]]
entity_key = "drift/caster"
bundle_id = "drift"
name = "Caster"
kind = "npc"
place_node_id = "drift/ground/start"
[[actors]]
bundle_id = "drift"
entity_key = "drift/caster"
name = "Caster"
[[actor_identities]]
bundle_id = "drift"
entity_key = "drift/caster"
identity = "$sender"
role = "primary"
[[actor_spatial_locations]]
bundle_id = "drift"
entity_key = "drift/caster"
place_node_id = "drift/ground/start"
selection_path = "manifest:drift/caster"
[[actor_capabilities]]
bundle_id = "drift"
actor_entity_key = "drift/caster"
capability_id = "drift/touch-cap"
source = "manifest"
[[entities]]
entity_key = "drift/chest:colon"
bundle_id = "drift"
name = "Chest"
kind = "item"
place_node_id = "drift/ground/start"
[[object_state]]
bundle_id = "drift"
entity_key = "drift/chest:colon"
state_id = "drift/charges"
value_int = 0
source_template_id = "manifest"
`;
const rows = (world: TestWorld, accessor: string): Record<string, unknown>[] => {
	const table = world.db()[accessor];
	if (!table) throw new Error(`missing observer table ${accessor}`);
	return [...table.iter()] as Record<string, unknown>[];
};
const readers = operatorScopeManifest("independent drift proof", [
	"operator_manifest_applyset",
	"operator_manifest_applyset_part",
	"operator_manifest_applyset_export_hash",
	"manifest_apply_digest",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"visible_pending_manifest_apply",
	"visible_object_state",
	"visible_actor_driver_control",
	"entity_location",
]);

describe.skipIf(process.env.SPELLKAVE_LOCAL_NODE !== "1")("applyset drift live", () => {
	const started = Date.now();
	let token: string;
	let directory: string;
	let path: string;
	let home: string;
	let runner: ReturnType<typeof createProductionCliRunner> | undefined;
	const evidence = process.env.SPELLKAVE_DRIFT_EVIDENCE_DIR;
	const interactions: Record<string, unknown>[] = [];
	const assertions: Record<string, unknown>[] = [];
	let status = "failed";
	let owner: TestWorld;
	let chest: bigint;
	const edited = body
		.replace('name = "Chest"', 'name = "Edited Chest"')
		.replace('source_template_id = "manifest"', 'source_template_id = "revised"');
	const adoptionOnly = edited.replace(
		/^\[\[(?:resource_definitions|action_definitions|actor_identities|consequence_templates|consequence_frame_writes|spatial_niche_attachments)\]\][\s\S]*?(?=^\[\[|(?![\s\S]))/gm,
		"",
	);
	let author: TestWorld | undefined;
	const root = (name: string, contents = body) =>
		header + `applyset = "${name}"\n` + bundle + contents;
	const snapshot = async () => {
		owner.disconnect();
		owner = await connectTestWorld({ db: database, token, readerManifests: [readers] });
		return {
			generation: rows(owner, "operatorManifestApplyset").find((r) => r.applyset === "drift-proof")
				?.generation,
			digests: rows(owner, "manifestApplyDigest")
				.map((r) => r.manifestDigest)
				.sort(),
			hashes: rows(owner, "operatorManifestApplysetExportHash")
				.filter((r) => r.applyset === "drift-proof")
				.sort((a, b) => String(a.rowRef).localeCompare(String(b.rowRef))),
		};
	};
	const cli = async (args: string[], credential = token, format = "jsonl", installed = false) => {
		const commandStarted = performance.now();
		let exit = 0,
			stdout = "",
			stderr = "";
		try {
			const result = installed
				? await executeFile(
						resolve(repository, "bin/sk"),
						["--format", format, "--live", ...args],
						{
							cwd: directory,
							env: {
								...process.env,
								SPELLKAVE_DB: database,
								SPELLKAVE_CONNECT_TOKEN: credential,
								SPELLKAVE_HOME: home,
							},
						},
					)
				: await runner!.invoke(["--format", format, "--live", ...args], credential);
			if ("exit" in result && typeof result.exit === "number") exit = result.exit;
			stdout = result.stdout;
			stderr = result.stderr;
		} catch (error) {
			const result = error as { code: number; stdout: string; stderr: string };
			if (typeof result.code !== "number") throw error;
			exit = result.code;
			stdout = result.stdout;
			stderr = result.stderr;
		}
		const result = stdout
			.split("\n")
			.flatMap((line) => {
				try {
					return [JSON.parse(line) as Record<string, unknown>];
				} catch {
					return [];
				}
			})
			.find((r) => r.kind === "apply_result" || r.kind === "diff_result");
		interactions.push({
			consumer: installed ? "installed bin/sk process" : "production CLI runner subprocess",
			elapsedMs: Math.round(performance.now() - commandStarted),
			argv: [
				"sk",
				"--format",
				format,
				"--live",
				...args.map((a) => (a === path ? "manifest.toml" : a)),
			],
			exitCode: exit,
			output: stdout
				.replaceAll(directory, "fixture")
				.replaceAll(repository, "checkout")
				.replace(/[0-9a-f]{64,}/g, "[digest-or-principal]"),
			stderr: stderr
				.replaceAll(directory, "fixture")
				.replaceAll(repository, "checkout")
				.replace(/[0-9a-f]{64,}/g, "[digest-or-principal]"),
		});
		return { exit, result, stdout, stderr };
	};
	beforeAll(async () => {
		const publisher = resolveSpacetimeConfigPathToken();
		if (!publisher) throw new Error("local publisher credential unavailable");
		token = publisher;
		directory = mkdtempSync(join(tmpdir(), "sk-drift-proof-"));
		path = join(directory, "manifest.toml");
		home = join(directory, "home");
		owner = await connectTestWorld({ db: database, token, readerManifests: [readers] });
		await ensureApplyManifestAuthority(owner);
		// Reuse module/bindings loading; the default runCli connector opens and
		// closes a fresh authenticated connection for each command. The decisive
		// refusal below also proves the installed launcher in a fresh process.
		runner = createProductionCliRunner(directory, {
			...process.env,
			SPELLKAVE_DB: database,
			SPELLKAVE_HOME: home,
		});
		await runner.ready;
	});
	it("refuses to overwrite state or placement that play changed, and sends nothing (AUTH-37-01)", async () => {
		writeFileSync(path, root("drift-proof"));
		const applied = await cli(["apply", "-k", path]);
		expect(applied.exit, applied.stdout + applied.stderr).toBe(0);
		let before = await snapshot();
		expect(before.hashes.length).toBeGreaterThan(0);
		const authored = rows(owner, "visibleManifestAuthoredEntity");
		const caster = BigInt(
			String(authored.find((r) => r.manifestKey === "drift:drift/caster")?.entityId),
		);
		chest = BigInt(
			String(authored.find((r) => r.manifestKey === "drift:drift/chest:colon")?.entityId),
		);
		await manipulateAction(owner, caster, chest, "drift/touch");
		await snapshot();
		expect(
			rows(owner, "visibleObjectState").find(
				(r) => String(r.targetId) === String(chest) && r.stateId === "drift/charges",
			)?.value,
		).toMatchObject({ tag: "Int", value: 1n });
		await applyManifestDelta(
			owner,
			header +
				`[[entities]]\nentity_key = "drift/chest:colon"\nbundle_id = "drift"\nname = "Chest"\nkind = "item"\nplace_node_id = "drift/ground/end"\n`,
		);
		before = await snapshot();
		expect(
			rows(owner, "entityLocation").find((r) => String(r.entityId) === String(chest))?.placeNodeId,
		).toBe("drift/ground/end");

		writeFileSync(path, root("drift-proof", edited));
		const diff = await cli(["diff", "-k", path]);
		expect(diff.exit, diff.stdout + diff.stderr).toBe(3);
		expect(diff.result?.conflicts).toHaveLength(2);
		const humanDiff = await cli(["diff", "-k", path], token, "human");
		expect(humanDiff.exit, humanDiff.stdout + humanDiff.stderr).toBe(3);
		expect(humanDiff.stdout).toContain("authored, changed in the world since the last apply:");
		const refusal = await cli(["apply", "-k", path], token, "jsonl", true);
		expect(refusal.exit, refusal.stdout + refusal.stderr).toBe(2);
		expect(refusal.result?.sent).toBe(false);
		const afterRefusal = await snapshot();
		expect(afterRefusal).toEqual(before);
		expect(rows(owner, "visiblePendingManifestApply")).toEqual([]);
		assertions.push({
			checkpoint: "refusal",
			conflicts: 2,
			sent: false,
			generationUnchanged: true,
			digestsUnchanged: true,
			hashesUnchanged: true,
		});
	});
	it("--force overwrites the drift, and a fresh applyset adopts the rows without rewriting them (AUTH-37-01)", async () => {
		const forced = await cli(["apply", "-k", path, "--force"]);
		expect(forced.exit, forced.stdout + forced.stderr).toBe(0);
		expect(forced.result?.force_used).toEqual(["world_changed"]);
		await snapshot();
		expect(
			rows(owner, "visibleObjectState").find(
				(r) => String(r.targetId) === String(chest) && r.stateId === "drift/charges",
			)?.value,
		).toMatchObject({ tag: "Int", value: 0n });
		expect(
			rows(owner, "entityLocation").find((r) => String(r.entityId) === String(chest))?.placeNodeId,
		).toBe("drift/ground/start");
		const clean = await cli(["diff", "-k", path]);
		expect(clean.exit, clean.stdout + clean.stderr).toBe(0);
		expect(clean.result?.conflicts).toEqual([]);
		assertions.push({
			checkpoint: "force recovery",
			stateValue: 0,
			place: "drift/ground/start",
			conflicts: 0,
		});
		// Adoption-only proof uses the exported subset; unavailable kinds are
		// explicitly not checked and cannot support a no-write claim.
		writeFileSync(path, root("fresh-adoption", adoptionOnly));
		const adoption = await cli(["apply", "-k", path]);
		expect(adoption.exit, adoption.stdout + adoption.stderr).toBe(0);
		expect(adoption.result?.counts).toMatchObject({
			create: 0,
			configure: 0,
			adopt: expect.any(Number),
		});
		const adopted = adoption.result?.results as Array<{ result: string }>;
		expect(adopted.length).toBeGreaterThan(0);
		expect(adopted.every((row) => row.result === "adopted")).toBe(true);
		await snapshot();
		expect(
			rows(owner, "visibleObjectState").find(
				(r) => String(r.targetId) === String(chest) && r.stateId === "drift/charges",
			)?.value,
		).toMatchObject({ tag: "Int", value: 0n });
		assertions.push({
			checkpoint: "adoption",
			entityWriteAbsent: true,
			stateValuePreserved: true,
		});
	});
	it("an author bound to one bundle cannot read the world's apply memory, so their diff and --force are refused before anything is queued, and a direct adoption is admitted (AUTH-37-02)", async () => {
		// The installed consumer reads under the bound author's own credential.
		author = await connectDedicatedClaimWorld({ db: database }, "drift-role-reader");
		await applyManifestDelta(
			owner,
			header +
				bundle +
				`[[role_bindings]]\nbinding_id = "drift/author"\ndescription = "Drift reader"\nbundle_id = "drift"\nsubject = "${author.identity}"\nrole_id = "system-author"\nextent_kind_ref = "bundle"\nextent_ref = "drift"\n`,
		);
		if (!author.token) throw new Error("author claim token unavailable");
		const beforeRegionalRead = await snapshot();
		const observed = await cli(["diff", "-k", path], author.token);
		expect(observed.exit, observed.stdout + observed.stderr).toBe(2);
		expect(observed.stdout + observed.stderr).toContain("baseline_unavailable");
		expect(await snapshot()).toEqual(beforeRegionalRead);
		expect(rows(owner, "visiblePendingManifestApply")).toEqual([]);
		assertions.push({
			scenarioId: "AUTH-37-02",
			status: "verified regional baseline refusal before enqueue",
			baselineUnavailable: true,
			finalProofOwner: "sk-jay0.3.24.142",
		});

		const scopedParts = buildApplysetParts(
			{ path: "manifest.toml", toml: root("scoped-adoption", adoptionOnly) },
			[],
		).parts;
		const scoped = await enqueueAndWaitManifestApply({
			digestHandle: author.conn.db.manifestApplyDigest,
			outcomeHandle: author.conn.db.manifestApplyOutcome,
			enqueue: () =>
				author!.conn.reducers.rApplyBundleScoped({
					deltaToml: header,
					applyset: "scoped-adoption",
					rootPath: "manifest.toml",
					partsJson: JSON.stringify(scopedParts),
					expectedGeneration: 0n,
					force: false,
					bundleIds: ["drift"],
				}),
		});
		sdkOperations.push("probe: scoped no-upsert adoption");
		expect(scoped.ok).toBe(true);
		await snapshot();
		expect(
			rows(owner, "operatorManifestApplyset").find((r) => r.applyset === "scoped-adoption")
				?.generation,
		).toBe(1n);
		expect(
			rows(owner, "visibleManifestAuthoredEntity").find(
				(r) => r.manifestKey === "drift:drift/chest:colon",
			)?.entityId,
		).toBe(chest);
		assertions.push({
			checkpoint: "scoped colon-key adoption",
			caller: "bound author",
			sameEntity: true,
			generation: 1,
		});
		const condition = `\n[[condition_definitions]]\ncondition_definition_id = "drift/condition"\nbundle_id = "drift"\ndisplay_name = "Condition"\ngate_predicate_source = ""\n`;
		writeFileSync(path, root("fresh-adoption", adoptionOnly + condition));
		const uncovered = await cli(["diff", "-k", path]);
		expect(
			(uncovered.result?.not_checked as Array<{ kind: string }>).some(
				(r) => r.kind === "condition_definitions",
			),
		).toBe(true);
		const beforeUncheckedForce = await snapshot();
		const refusedForce = await cli(["apply", "-k", path, "--force"], author.token);
		expect(refusedForce.exit, refusedForce.stdout + refusedForce.stderr).toBe(2);
		expect(refusedForce.stdout + refusedForce.stderr).toContain("baseline_unavailable");
		expect(await snapshot()).toEqual(beforeUncheckedForce);
		expect(rows(owner, "visiblePendingManifestApply")).toEqual([]);
		assertions.push({
			scenarioId: "AUTH-37-02",
			uncheckedForceRefused: true,
			sent: false,
			generationDigestsHashesUnchanged: true,
		});
		// Metadata-only unlisted-row admission is still the server's .36 policy.
		const unlisted =
			header +
			bundle +
			`[[entity_definitions]]\nentity_def_id = "drift/unlisted"\nbundle_id = "drift"\ndisplay_name = "Unlisted"\n`;
		await applyManifestDelta(owner, unlisted);
		const built = buildApplysetParts(
			{
				path: "unlisted.toml",
				toml: header + 'applyset = "unlisted-adoption"\n' + unlisted.slice(header.length),
			},
			[],
		);
		await expect(
			author.conn.reducers.rApplyBundleScoped({
				deltaToml: header,
				applyset: "unlisted-adoption",
				rootPath: "unlisted.toml",
				partsJson: JSON.stringify(built.parts),
				expectedGeneration: 0n,
				force: false,
				bundleIds: ["drift"],
			}),
		).rejects.toThrow("MF-APPLY-043");
		sdkOperations.push("probe: unlisted scoped adoption refusal");
		await snapshot();
		expect(
			rows(owner, "operatorManifestApplyset").some((r) => r.applyset === "unlisted-adoption"),
		).toBe(false);
	});
	it("seals wire hashes, retains omitted hashes, drops unlisted keys, and preserves hashes on invalidation", async () => {
		await snapshot();
		const memory = () =>
			rows(owner, "operatorManifestApplyset").find((r) => r.applyset === "fresh-adoption")!;
		const hashes = () =>
			rows(owner, "operatorManifestApplysetExportHash")
				.filter((r) => r.applyset === "fresh-adoption")
				.sort((a, b) => String(a.rowRef).localeCompare(String(b.rowRef)));
		const part = rows(owner, "operatorManifestApplysetPart").find(
			(r) => r.applyset === "fresh-adoption",
		)!;
		const entries = (part.entries as Array<Record<string, unknown>>).map((e) => ({
			kind: e.kind,
			key: e.key,
			bundle_id: e.bundleId ?? null,
			hash: e.hash,
		}));
		const seal = async (submitted: Array<Record<string, unknown>>) => {
			sdkOperations.push("probe: hash lifecycle seal");
			const generation = BigInt(String(memory().generation));
			const outcome = await enqueueAndWaitManifestApply({
				digestHandle: owner.conn.db.manifestApplyDigest,
				outcomeHandle: owner.conn.db.manifestApplyOutcome,
				enqueue: () =>
					owner.conn.reducers.rApplyBundle({
						deltaToml: header,
						applyset: "fresh-adoption",
						rootPath: path,
						partsJson: JSON.stringify([{ path: "manifest.toml", entries: submitted }]),
						expectedGeneration: generation,
						force: false,
					}),
			});
			expect(outcome.ok).toBe(true);
			await waitForEvent(
				owner,
				() => memory().generation === generation + 1n,
				"hash seal did not converge",
			);
			await snapshot();
		};
		await seal(entries.map((e, i) => (i === 0 ? { ...e, export_hash: "wire-hash-proof" } : e)));
		const recorded = hashes();
		const selected = recorded.find(
			(r) => r.kind === entries[0]!.kind && r.key === entries[0]!.key,
		)!;
		expect(selected.exportHash).toBe("wire-hash-proof");
		await seal(entries);
		expect(hashes()).toEqual(recorded);
		await seal(entries.slice(1));
		expect(hashes()).toEqual(recorded.filter((r) => r.rowRef !== selected.rowRef));
		const beforeInvalidation = hashes();
		await applyManifestSource(owner, header + bundle);
		await snapshot();
		expect(memory().baseState).toMatchObject({ tag: "Unknown" });
		expect(hashes()).toEqual(beforeInvalidation);
		assertions.push({
			checkpoint: "hash lifecycle",
			wireHashSealed: true,
			oldWireRetainedHashes: true,
			droppedUnlistedKey: true,
			wholeBundleInvalidationPreservedHashes: true,
		});
		status = "verified";
	});
	afterAll(async () => {
		await runner?.close();
		author?.disconnect();
		owner?.disconnect();
		if (evidence) {
			mkdirSync(evidence, { recursive: true });
			writeFileSync(
				join(evidence, "AUTH-37.json"),
				JSON.stringify(
					{
						schema: "spellkave.persona-evidence/v1",
						scenarioId: "AUTH-37-01",
						status,
						observedAt: new Date().toISOString(),
						implementingRevision: execFileSyncGit(["rev-parse", "HEAD"], {
							cwd: repository,
							encoding: "utf8",
						}).trim(),
						testSourceSha256: createHash("sha256")
							.update(readFileSync(import.meta.filename))
							.digest("hex"),
						serverWasmSha256: process.env.SPELLKAVE_DRIFT_PROOF_WASM
							? createHash("sha256")
									.update(readFileSync(process.env.SPELLKAVE_DRIFT_PROOF_WASM))
									.digest("hex")
							: "not supplied",
						fixtureRevision: "synthetic drift v2, scoped source and unchecked-force proof",
						consumer:
							"production CLI runner in one subprocess, fresh connection per command; drift refusal through a fresh installed bin/sk process",
						prerequisites: [
							"disposable fresh database",
							"matching module and generated client",
							"explicit publisher credential",
							"independent bound author",
						],
						versions: {
							client: JSON.parse(
								readFileSync(resolve(repository, "packages/spellkave-cli/package.json"), "utf8"),
							).version,
							server: "identified by serverWasmSha256",
							dependency: "extent-scoped-apply",
						},
						interactions,
						setupAndProbeOperations: sdkOperations,
						assertions,
						cost: {
							runnerStartupMs: runner?.startupMs,
							calls: interactions.length,
							logicalSetupAndProbeCalls: sdkOperations.length,
							transportAccounting:
								"SDK subscription frames and waiter polling are not measured; counts are logical operations",
							retries: 0,
							failedAttempts: interactions.filter((row) => row.exitCode !== 0 && row.exitCode !== 3)
								.length,
							journeyFailed: status !== "verified",
							configuration: "scripted Vitest, one fresh-database journey; no autonomous model",
							elapsedMs: Date.now() - started,
							responseBytes: interactions.reduce(
								(n, r) => n + Buffer.byteLength(String(r.output)),
								0,
							),
							tokens: "not applicable: scripted execution",
							images: 0,
							usability:
								"demonstrates supported CLI route in a temporary external working directory; unaided discovery and hosted delivery are unverified",
						},
					},
					(_key, v) => (typeof v === "bigint" ? String(v) : v),
					2,
				) + "\n",
			);
		}
		if (directory) rmSync(directory, { recursive: true, force: true });
	});
});
