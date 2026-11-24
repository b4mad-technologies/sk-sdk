// A claimed PLAYER can be placed even when the AUTHOR's bounded live view does not expose its node.
import type { SnapshotDb } from "@spellkave/sdk/replay";
import {
	actorIdForBody,
	applyRoundTrip,
	bindActor,
	connectTestWorld,
	operatorScopeManifest,
	type Scene,
	scene,
	syncConnection,
	type TestWorld,
} from "@spellkave/test-lab";
import type { AuthorWorkspace } from "@spellkave/tool-authoring";
import { createAuthorFacingBoundTools } from "@spellkave/tool-authoring";
import { driveManifestScene, nodeToolCapability } from "@spellkave/tool-node";
import { inspectManifest } from "@spellkave/world-author";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLiveAuthorTarget } from "../authoring";
import { liveWorldRef, localNode } from "./support";

describe.skipIf(!localNode)("define_behavior for an already claimed PLAYER", () => {
	let mine: Scene;
	let player: TestWorld;
	let caster: string;
	let node: string;
	let target: ReturnType<typeof createLiveAuthorTarget>;

	beforeAll(async () => {
		const world = liveWorldRef();
		mine = await scene(world);
		mine.place("hall");
		await mine.apply();
		node = mine.reads.nodeId("hall");
		caster = `${mine.prefix}/caster_1`;
		player = await connectTestWorld({ url: world.url, db: world.db });
		await mine.owner.subscribeReaders([
			operatorScopeManifest("caster-placement-author", [
				"entity",
				"entity_definition",
				"visible_place_node",
				"visible_actor_spatial_location",
			]),
		]);
		target = createLiveAuthorTarget({
			db: () => mine.owner.db() as unknown as SnapshotDb,
			readsAsPublisher: () => true,
		});
		const source = await driveManifestScene(
			[
				{
					toolName: "spellkave_place_actor",
					label: "place PLAYER caster",
					params: {
						bundle: mine.prefix,
						kind: "player",
						entity_def: "core/creature/wolf",
						key_prefix: "caster",
						at: node,
					},
				},
				{
					toolName: "spellkave_bind_actor",
					label: "bind PLAYER identity",
					params: { bundle: mine.prefix, entity_key: caster, identity: player.identity },
				},
			],
			target,
		);
		await applyRoundTrip({ scene: mine, delta: source });
		const entityId = mine.reads.entityId("caster_1");
		if (entityId === null) throw new Error("authored PLAYER caster missing");
		const actorId = actorIdForBody(mine.owner.db(), entityId);
		if (actorId === null) throw new Error("authored PLAYER actor missing");
		await bindActor(player, actorId);
		await syncConnection(player);
		const entity = [...mine.owner.conn.db.entity.iter()].find((row) => row.entityId === entityId);
		expect(entity?.kind).toBe("player");
		const placed = [...player.conn.db.visibleActorSpatialLocation.iter()].find(
			(row) => row.entityId === entityId,
		);
		expect(placed?.placeNodeId).toBe(node);
		expect(
			target.lookup("actor_spatial_locations").find((row) => row.entity_key === caster),
		).toEqual(expect.objectContaining({ place_node_id: "" }));
	});

	afterAll(async () => {
		player?.disconnect();
		await mine?.close();
	});

	async function author(explicitPlacement: boolean) {
		let source: string | null = null;
		const workspace: AuthorWorkspace = {
			readToml: () => source,
			writeToml: (value) => {
				source = value;
				return "memory";
			},
		};
		const tools = createAuthorFacingBoundTools({ workspace, target }, { node: nodeToolCapability });
		const tool = (name: string) => {
			const found = tools.find((entry) => entry.name === name);
			if (!found) throw new Error(`missing AUTHOR tool ${name}`);
			return found;
		};
		await tool("spellkave_write_rows").execute("probe-resource", {
			bundle: mine.prefix,
			kind: "resource_definitions",
			rows: [
				{
					bundle_id: mine.prefix,
					resource_definition_id: `${mine.prefix}/observed`,
					display_name: "Observed",
					value_kind: "int",
					min_value: 0,
					max_value: 10,
					recovery_rule: "long_rest",
				},
			],
		});
		if (explicitPlacement)
			await tool("spellkave_write_rows").execute("known-current-placement", {
				bundle: mine.prefix,
				kind: "actor_spatial_locations",
				rows: [{ bundle_id: mine.prefix, entity_key: caster, place_node_id: node }],
			});
		return {
			before: source,
			current: () => source,
			run: () =>
				tool("spellkave_define_behavior").execute("claimed-player-graph", {
					bundle: mine.prefix,
					id: "graph-placement",
					grant_to: caster,
					action_class: "probe",
					offered_when: { reach: "same_node" },
					effect: {
						primitive: "ForEachActorInRadius",
						write: {
							primitive: "OutcomeGraph",
							branches: [
								{
									node: "observed",
									guard: "1 == 1",
									subject: "TargetActor",
									resource: `${mine.prefix}/observed`,
									delta: "1",
								},
							],
						},
					},
				}),
		};
	}

	it("names unavailable caster placement before writing a graph to scratch", async () => {
		const probe = await author(false);
		await expect(probe.run()).rejects.toThrow(/grant_to.*place_node_id/);
		expect(probe.current()).toBe(probe.before);
	});

	it("preserves the known workspace placement for the same claimed PLAYER", async () => {
		const probe = await author(true);
		expect(await probe.run()).toMatchObject({ details: { ok: true } });
		const manifest = inspectManifest(probe.current() as string).manifest;
		expect(manifest.spatial_niche_attachments).toEqual(
			expect.arrayContaining([expect.objectContaining({ place_node_id: node })]),
		);
	});
});
