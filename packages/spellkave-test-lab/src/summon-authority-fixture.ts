// embedded-manifest: {"category":"dynamic_authoring_proof","rationale":"Unique principals and authored Spawn effects establish independent local summon-authority scenes."}
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { emptyManipulationArgs, targetRefFromString } from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import { parse, stringify } from "smol-toml";
import { expect } from "vitest";
import { actAsFixture } from "./act-as-fixture";
import { header, rows } from "./environment-ownership-fixture";
import {
	applyManifestDelta,
	applyManifestSource,
	connectTestWorld,
	ensureWorldAuthority,
	entityIdByManifestKey,
	readFixtureSource,
	type TestWorld,
} from "./live";
import { US9_KIT, us9KitSource } from "./scene-live/us9-kit";

// ci-allow-start(raw-sql): publisher SQL observes committed state of this private synthetic scene; no runtime subscription uses raw SQL.
/** Independent private scene; callers close every socket in finally. */
export async function summonAuthorityFixture(
	track: (bundle: string) => string,
	mixedDriverPresence = false,
) {
	const b = track(`act41b_${randomUUID().replaceAll("-", "")}`);
	const kit = b;
	const worlds: TestWorld[] = [];
	const connect = async (token: string | null) => {
		const world = await connectTestWorld({ token });
		worlds.push(world);
		return world;
	};
	try {
		const publisher = await connect(resolveSpacetimeConfigPathToken() ?? null);
		await ensureWorldAuthority(publisher);
		await publisher.conn.reducers.paceTime({
			op: "pause",
			requestId: randomUUID().replaceAll("-", ""),
		});
		await applyManifestSource(
			publisher,
			readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
			{ tolerateAlreadyApplied: true },
		);
		const driver = await connect(null);
		const host = await connect(null),
			replacement = await connect(null),
			player = await connect(null),
			dm = await connect(null),
			other = await connect(null);
		const kitDoc = parse(us9KitSource().replaceAll(US9_KIT, kit));
		const effects = kitDoc.effect_definitions as Record<string, unknown>[];
		expect(kitDoc.schema_version).toBe("1.0.0");
		let kitRevision = 0;
		const renderKit = () => {
			(kitDoc.bundles as Record<string, unknown>[])[0]!.version = `${++kitRevision}.0.0`;
			const content = { ...kitDoc };
			delete content.schema_version;
			return `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
${stringify(content)}`;
		};
		effects[0]!.parameters_schema_json = JSON.stringify({
			blueprint_id: `${kit}/item/puddle`,
			location_ref: { kind: "binding", id: "ActorSpatialRef" },
		});
		kitDoc.entity_definition_initial_capability = [
			{
				bundle_id: kit,
				entity_def_id: `${kit}/item/puddle`,
				capability_id: `${kit}/spell/relieve_puddle`,
			},
		];
		await applyManifestSource(publisher, renderKit());
		await applyManifestDelta(
			publisher,
			`${actAsFixture(b, { person: player.identity!, dm: dm.identity!, peer: publisher.identity!, host: host.identity! }).replace('role_id="npc-host"', `role_id="${mixedDriverPresence ? `${b}/mixed-host` : "npc-host"}"`)}
${
	mixedDriverPresence
		? `
[[role_definitions]]
bundle_id="${b}"
role_id="${b}/mixed-host"
display_name="Mixed drive and steering authority"
description="Proves authoritative loss precedes ordinary steering invalidation"
capability_ids=["frontier.drive", "frontier.impersonate"]
`
		: ""
}
[[entities]]
bundle_id="${b}"
entity_key="${b}/other"
entity_def_id="${kit}/item/puddle"
name="Independent Service root"
kind="npc"
place_node_id="${b}/graph/root"
[[actors]]
bundle_id="${b}"
entity_key="${b}/other"
name="Independent Service root"
[[actor_capabilities]]
bundle_id="${b}"
actor_entity_key="${b}/npc"
capability_id="${kit}/spell/relieve_puddle"
source="publisher-explicit"
[[actor_capabilities]]
bundle_id="${b}"
actor_entity_key="${b}/person"
capability_id="${kit}/spell/relieve_puddle"
source="publisher-explicit"
[[spatial_niche_attachments]]
bundle_id="${b}"
place_node_id="${b}/graph/root"
niche_id="capability:${kit}/spell/relieve_puddle"
condition_bool=true
ecological_invariant=false
visibility="Public"
`,
		);
		const actorFor = async (body: bigint) =>
			BigInt(
				String(
					(await rows(publisher, `SELECT actor_id FROM actor WHERE current_body = ${body}`))[0]!
						.actor_id,
				),
			);
		const npcBody = entityIdByManifestKey(publisher.db(), `${b}:${b}/npc`)!;
		const npcActor = await actorFor(npcBody);
		const presenceBody = BigInt(
			String(
				(
					await rows(
						publisher,
						`SELECT presence_entity_id FROM role_binding WHERE binding_id = '${b}/host'`,
					)
				)[0]!.presence_entity_id,
			),
		);
		const presenceActorId = await actorFor(presenceBody);
		const assign = (identityHex: string, actorId = npcActor) =>
			host.conn.reducers.rAssignDriver({ presenceActorId, actorId, identityHex });
		const control = (actorId: bigint) =>
			rows(publisher, `SELECT * FROM actor_driver_control WHERE actor_id = ${actorId}`);
		const worldInstanceId = String(
			(await rows(publisher, "SELECT world_instance_id FROM config"))[0]!.world_instance_id,
		);
		const token = async (actorId: bigint, bodyEntityId: bigint) => ({
			actorId,
			bodyEntityId,
			worldInstanceId,
			generation: BigInt(String((await control(actorId))[0]!.generation)),
		});
		await assign(driver.identity!);
		await driver.conn.reducers.rManipulate({
			actorId: npcBody,
			driverToken: await token(npcActor, npcBody),
			targetRef: targetRefFromString(`place_node:${b}/graph/root`),
			actionId: `${kit}/cast_relieve_puddle`,
			args: emptyManipulationArgs(),
		});
		const summons = await rows(publisher, "SELECT * FROM actor_identity WHERE role = 'summoner'");
		const ownSummon = summons.find((row) =>
			JSON.stringify(row.identity).includes(driver.identity!),
		);
		expect(
			ownSummon,
			ownSummon
				? undefined
				: JSON.stringify(
						await rows(
							publisher,
							`SELECT * FROM evaluation_provenance WHERE owner_body_entity_id = ${npcBody}`,
						),
					),
		).toBeDefined();
		const summonActor = BigInt(String(ownSummon!.actor_id));
		const summonBody = BigInt(
			String(
				(
					await rows(publisher, `SELECT current_body FROM actor WHERE actor_id = ${summonActor}`)
				)[0]!.current_body,
			),
		);
		expect(ownSummon!.assigned_by).toEqual([1, []]);

		const act = async (caller: TestWorld, actorId: bigint, body: bigint) => {
			const query = `SELECT * FROM evaluation_provenance WHERE owner_body_entity_id = ${body}`;
			const before = new Set(
				(await rows(publisher, query)).map((row) => String(row.provenance_id)),
			);
			await caller.conn.reducers.rManipulate({
				actorId: body,
				driverToken: await token(actorId, body),
				targetRef: targetRefFromString(`place_node:${b}/graph/root`),
				actionId: `${kit}/cast_relieve_puddle`,
				args: emptyManipulationArgs(),
			});
			const evaluations = (await rows(publisher, query)).filter(
				(row) => !before.has(String(row.provenance_id)),
			);
			expect(evaluations.length).toBeGreaterThan(0);
			const refused = evaluations.find((row) => row.failure_kind !== "");
			if (refused)
				throw new Error(`world act refused: ${refused.failure_kind}: ${refused.failure_detail}`);
		};

		const allSummons = async () =>
			(await rows(publisher, "SELECT * FROM actor_identity WHERE role = 'summoner'")).filter(
				(row) =>
					JSON.stringify(row.identity).includes(driver.identity!) ||
					JSON.stringify(row.identity).includes(replacement.identity!),
			);

		return {
			b,
			kit,
			worlds,
			connect,
			publisher,
			driver,
			host,
			replacement,
			player,
			dm,
			other,
			effects,
			renderKit,
			actorFor,
			npcBody,
			npcActor,
			presenceActorId,
			assign,
			control,
			token,
			worldInstanceId,
			summonActor,
			summonBody,
			act,
			allSummons,
		};
	} catch (error) {
		for (const world of worlds) world.disconnect();
		throw error;
	}
}

/** Publisher logs from this worktree's local module, never a hosted endpoint. */
export function localModuleLogs() {
	const configPath = process.env.SPACETIME_CONFIG_PATH;
	if (!configPath) throw new Error("SPACETIME_CONFIG_PATH required for local publisher logs");
	return execFileSync(
		"spacetime",
		[
			"--config-path",
			configPath,
			"logs",
			"--server",
			"local",
			process.env.SPELLKAVE_DB ?? "spellkave-dev",
		],
		{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
	);
}

/** Prepare one failed drain in a per-case hook; no test timeout override. */
export async function prepareDrainIsolation(
	kind: "authored identity" | "presence mirror" | "mixed clone",
	track: (bundle: string) => string,
) {
	const f = await summonAuthorityFixture(track);
	try {
		expect(
			(await rows(f.publisher, "SELECT slack_secs FROM debug_manifest_quarantine_deadline"))[0]!
				.slack_secs,
		).toBe(5);
		const base = header(f.b);
		const source =
			kind === "authored identity"
				? base +
					`
[[actor_identities]]
bundle_id="${f.b}"
entity_key="${f.b}/other"
identity="${f.driver.identity}"
role="primary"
provenance="service"
`
				: kind === "presence mirror"
					? base +
						`
[[role_bindings]]
bundle_id="${f.b}"
binding_id="${f.b}/foreign-driver-presence"
subject="${f.driver.identity}"
role_id="npc-host"
extent_kind_ref="place_graph"
extent_ref="${f.b}/graph"
description="Must refuse assigned driver presence"
`
					: base +
						`
[[entities]]
bundle_id="${f.b}"
entity_key="${f.b}/segment-b-rolled-back"
entity_def_id="core/creature/wolf"
name="Entity rolls back with the failed clone"
kind="npc"
place_node_id="${f.b}/graph/root"
[[place_graph_instances]]
bundle_id="${f.b}"
blueprint_id="${f.b}/graph"
instance_id="${f.b}/mixed-clone"
[place_graph_instances.anchor]
kind="place_node"
id="${f.b}/graph/root"
`;
		const beforeBindings = await rows(f.publisher, "SELECT * FROM actor_identity");
		const beforeControls = await rows(f.publisher, "SELECT * FROM actor_driver_control");
		const priorOutcomes = new Set(
			(await rows(f.publisher, "SELECT apply_id FROM manifest_apply_outcome")).map((r) =>
				String(r.apply_id),
			),
		);

		const configPath = process.env.SPACETIME_CONFIG_PATH;
		if (!configPath)
			throw new Error("SPACETIME_CONFIG_PATH required for local publisher drain logs");
		const readLogs = () =>
			execFileSync(
				"spacetime",
				[
					"--config-path",
					configPath,
					"logs",
					"--server",
					"local",
					process.env.SPELLKAVE_DB ?? "spellkave-dev",
				],
				{ encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
			);
		const priorLogs = new Set(readLogs().split("\n"));
		const refusal = await applyManifestDelta(f.publisher, source).then(
			() => "",
			(error) => String(error),
		);
		const outcomes = (await rows(f.publisher, "SELECT * FROM manifest_apply_outcome")).filter(
			(row) => !priorOutcomes.has(String(row.apply_id)),
		);

		const logs = readLogs()
			.split("\n")
			.filter((line) => !priorLogs.has(line))
			.join("\n");
		const proof = {
			kind,
			refusal,
			outcomes,
			logs,
			beforeBindings,
			beforeControls,
			pending: await rows(f.publisher, "SELECT * FROM pending_manifest_apply"),
			afterBindings: await rows(f.publisher, "SELECT * FROM actor_identity"),
			afterControls: await rows(f.publisher, "SELECT * FROM actor_driver_control"),
			graphs: await rows(
				f.publisher,
				`SELECT place_graph_id FROM place_graph_definition WHERE place_graph_id = '${f.b}/mixed-clone'`,
			),
			clonedLocations: (
				await rows(f.publisher, "SELECT entity_id, place_node_id FROM entity_location")
			).filter((row) => String(row.place_node_id).startsWith(`${f.b}/mixed-clone/`)),
			seals: outcomes[0]
				? await rows(
						f.publisher,
						`SELECT manifest_digest FROM manifest_apply_digest WHERE manifest_digest = '${outcomes[0].digest}'`,
					)
				: [],
			rolledBackEntities: await rows(
				f.publisher,
				`SELECT entity_id FROM manifest_authored_entity WHERE manifest_key = '${f.b}:${f.b}/segment-b-rolled-back'`,
			),
		};
		await f.act(f.driver, f.summonActor, f.summonBody);
		return proof;
	} finally {
		for (const world of f.worlds) world.disconnect();
	}
}

export function assertDrainIsolation(proof: Awaited<ReturnType<typeof prepareDrainIsolation>>) {
	expect(proof.refusal).toContain("MF-APPLY-029");
	expect(proof.outcomes).toHaveLength(1);
	const outcome = proof.outcomes[0]!;
	expect(outcome.ok).toBe(false);
	expect(outcome.code).toBe("MF-APPLY-029");
	const abort = proof.logs
		.split("\n")
		.filter(
			(line) =>
				line.includes("manifest_drain_aborted") &&
				line.includes(`apply_id=${outcome.apply_id} `) &&
				line.includes("assigned_identity_requires_isolation"),
		);
	expect(abort.length, `isolation abort for apply ${outcome.apply_id}`).toBeGreaterThan(0);
	expect(proof.pending).toEqual([]);
	expect(proof.afterBindings).toEqual(proof.beforeBindings);
	expect(proof.afterControls).toEqual(proof.beforeControls);
	expect(proof.graphs).toHaveLength(proof.kind === "mixed clone" ? 1 : 0);
	expect(proof.clonedLocations).toEqual([]);
	expect(proof.seals).toEqual([]);
	expect(proof.rolledBackEntities).toEqual([]);
	console.log(
		"G11 late drain",
		JSON.stringify({
			kind: proof.kind,
			applyId: outcome.apply_id,
			code: outcome.code,
			isolationAbort: abort[0],
		}),
	);
}
// ci-allow-end(raw-sql)
