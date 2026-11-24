import { snapshotDbFromFixture } from "@spellkave/sdk";
import { expect, it } from "vitest";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

// keep(K2): synthetic coverage injects absent old-module views and partial delivery shapes.
it.each([
	"available",
	"empty",
	"unavailable",
	"truncated",
] as const)("scene detail preserves %s contents and nested admission", async (status) => {
	const disclosed = status === "available" || status === "truncated";
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "room" }],
		visible_entity_location: [{ entityId: 2n, placeNodeId: "room" }],
		visible_place_node: [
			{
				nodeId: "room",
				placeGraphId: "test",
				displayName: "Room",
				description: "",
				posPresent: false,
			},
		],
		visible_place_graph_definition: [{ placeGraphId: "test", description: "" }],
		entity: [1, 2, 3, 4].map((id) => ({
			entityId: BigInt(id),
			entityDefId: "test/item",
			name: `Object ${id}`,
			kind: "item",
			quantity: 1n,
		})),
		...(status === "unavailable"
			? {}
			: {
					visible_observed_container_coverage: [
						{
							perceiverEntityId: 1n,
							containerEntityId: 2n,
							revision: status,
							complete: status !== "truncated",
						},
					],
					visible_observed_container_content: disclosed
						? [
								{
									perceiverEntityId: 1n,
									containerEntityId: 2n,
									entityId: 3n,
									name: "Disclosed child",
									quantity: 2n,
									entityDefId: "test/item",
								},
							]
						: [],
				}),
	});
	const tools = createPlayerFacingToolMap({ db, act: { actorId: "1" } } as SpellkaveToolContext);
	const root = (await tools.sceneDetail.execute("root", { target_id: "entity:2" })).details as {
		target: { detail: { contents: { status: string; items: unknown[] } } };
	};
	expect(root.target.detail.contents).toMatchObject({
		status,
		scope: "direct",
		items: disclosed
			? [
					{
						target_ref: "item:3",
						parent_ref: "entity:2",
						name: "Disclosed child",
						quantity: 2,
						entity_def_id: "test/item",
					},
				]
			: [],
	});
	const child = await tools.sceneDetail.execute("child", { target_id: "item:3" });
	expect(child.details).toMatchObject(
		disclosed
			? {
					status: "ok",
					target: {
						kind: "item",
						label: "Disclosed child",
						detail: { parent_ref: "entity:2", contents: { status: "unavailable" } },
					},
				}
			: { status: "unknown_target" },
	);
	expect(
		(await tools.sceneDetail.execute("guessed", { target_id: "item:4" })).details,
	).toMatchObject({ status: "unknown_target" });
	const listing = await tools.scene.execute("scene", {});
	expect((listing.details as { items: { id: string }[] }).items.map((row) => row.id)).not.toContain(
		"3",
	);
});
