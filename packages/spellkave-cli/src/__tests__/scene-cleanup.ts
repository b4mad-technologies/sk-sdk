/** Current authorable graph Despawn: inspect surviving occupants independently. */
import { manipulationArgsFromJson, targetRefFromString } from "@spellkave/sdk";
import {
	applyManifestDelta,
	authoredAdmissionProbeAct,
	type TestWorld,
	waitForEvent,
} from "@spellkave/test-lab";
import { parseSchemaManifestToml, renderSchemaManifest } from "@spellkave/world-author/tooling";
import { expect } from "vitest";
export async function proveSceneCleanup(input: {
	owner: TestWorld;
	author: TestWorld;
	catalog: string;
	destination: string;
	graph: string;
	body: bigint;
	sql(query: string): Promise<unknown[][]>;
	record(value: unknown): void;
}) {
	const { owner, author, catalog, destination, graph, body, sql } = input;
	// An explicit ordinary author edit chooses an anchor which survives removal.
	const anchor = `${catalog}/room/entry`;
	const adjustment = renderSchemaManifest({
		schema_version: "1.0.0",
		place_graphs: [
			{
				bundle_id: destination,
				place_graph_id: graph,
				substrate_id: "test_lab_live_on_demand_gatekeeper/plane",
				display_name: "Scene cleanup proof",
				anchor_node_id: anchor,
				parent_graph_id: `${catalog}/room`,
			},
		],
	});
	await applyManifestDelta(author, adjustment);
	const beforeSpawn = await sql(
		`SELECT entity_id FROM entity_location WHERE place_node_id = '${graph}/entry'`,
	);
	const spawn = parseSchemaManifestToml(
		authoredAdmissionProbeAct(
			destination,
			"runtime-addition",
			"frontier.spawn_entity_definition",
			[],
			{
				primitive: "Spawn",
				parameters: {
					blueprint_id: "core/creature/wolf",
					location_ref: { kind: "place_node", id: `${graph}/entry` },
				},
			},
		),
	);
	for (const niche of (spawn.niche_definitions ?? []) as Record<string, unknown>[]) {
		niche.provider = "entity";
		niche.predicate_source = "target.has_niche('core.creature')";
	}
	await applyManifestDelta(owner, renderSchemaManifest(spawn));
	const spawnBaseline = new Set(
		[...author.conn.db.visibleEvaluationProvenance.iter()].map((r) => r.provenanceId),
	);
	const spawnRequest = {
		actorId: body,
		targetRef: targetRefFromString(`entity:${beforeSpawn[0]![0]}`),
		actionId: `${destination}/runtime-addition`,
		args: manipulationArgsFromJson("{}"),
	};
	await author.conn.reducers.rManipulate(spawnRequest);
	await waitForEvent(
		author,
		() =>
			[...author.conn.db.visibleEvaluationProvenance.iter()].some(
				(r) => !spawnBaseline.has(r.provenanceId) && r.subjectId === String(body),
			),
		"runtime spawn act record",
	);
	const spawnRecord = [...author.conn.db.visibleEvaluationProvenance.iter()].find(
		(r) => !spawnBaseline.has(r.provenanceId) && r.subjectId === String(body),
	)!;
	expect(spawnRecord.status.tag, spawnRecord.failureDetail).toBe("Succeeded");
	const afterSpawn = await sql(
		`SELECT entity_id FROM entity_location WHERE place_node_id = '${graph}/entry'`,
	);
	const runtime = afterSpawn.filter(([id]) => !beforeSpawn.some(([prior]) => prior === id));
	expect(runtime).toHaveLength(1);
	expect(
		await sql(
			`SELECT manifest_key FROM operator_manifest_authored_entity WHERE entity_id = ${runtime[0]![0]}`,
		),
	).toEqual([]);
	input.record({
		category: "consumer",
		operation: "authorized runtime Spawn",
		request: spawnRequest,
		response: spawnRecord,
		runtimeOutsideManifestOwnership: true,
	});
	const act = authoredAdmissionProbeAct(destination, "remove-run", "frontier.despawn", [], {
		primitive: "Despawn",
		parameters: { target_ref: { kind: "place_graph", id: graph } },
	});
	const authored = parseSchemaManifestToml(act);
	for (const action of (authored.action_definitions ?? []) as Record<string, unknown>[])
		action.self_eligible = true;
	for (const niche of (authored.niche_definitions ?? []) as Record<string, unknown>[]) {
		niche.provider = "entity";
		niche.predicate_source = "target.has_niche('core.creature')";
	}
	await applyManifestDelta(owner, renderSchemaManifest(authored));
	const occupants = await sql(
		`SELECT entity_id FROM entity_location WHERE place_node_id = '${graph}/entry'`,
	);
	expect(occupants.length).toBeGreaterThan(0);
	const before = new Set(
		[...author.conn.db.visibleEvaluationProvenance.iter()].map((r) => r.provenanceId),
	);
	await author.conn.reducers.rManipulate({
		actorId: body,
		targetRef: targetRefFromString(`entity:${occupants[0]![0]}`),
		actionId: `${destination}/remove-run`,
		args: manipulationArgsFromJson("{}"),
	});
	await waitForEvent(
		author,
		() =>
			[...author.conn.db.visibleEvaluationProvenance.iter()].some(
				(r) => !before.has(r.provenanceId) && r.subjectId === String(body),
			),
		"graph cleanup act record",
	);
	const record = [...author.conn.db.visibleEvaluationProvenance.iter()].find(
		(r) => !before.has(r.provenanceId) && r.subjectId === String(body),
	)!;
	expect(record.status.tag, record.failureDetail).toBe("Succeeded");
	expect(
		await sql(
			`SELECT place_graph_id FROM place_graph_definition WHERE place_graph_id = '${graph}'`,
		),
	).toEqual([]);
	const survivors = [];
	for (const [id] of occupants) {
		expect(await sql(`SELECT entity_id FROM entity WHERE entity_id = ${id}`)).toHaveLength(1);
		expect(await sql(`SELECT place_node_id FROM entity_location WHERE entity_id = ${id}`)).toEqual([
			[anchor],
		]);
		const spatialLocation = await sql(
			`SELECT place_node_id FROM actor_spatial_location WHERE entity_id = ${id}`,
		);
		survivors.push({
			entity_id: String(id),
			entityLocation: anchor,
			spatialLocation,
			outcome: "survived",
			knownResidual: "sk-jay0.3.24.169",
		});
	}
	input.record({
		category: "consumer",
		operation: "explicit authorized graph Despawn",
		request: {
			ordinaryAnchorAdjustment: adjustment,
			authoredAct: renderSchemaManifest(authored),
			actor: "controlled-presence",
			target: `entity:${occupants[0]![0]}`,
		},
		response: { record, survivors, cleanupCoverage: "unknown", completeTeardown: false },
	});
}
