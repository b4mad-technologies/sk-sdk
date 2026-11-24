import { snapshotDbFromFixture } from "@spellkave/sdk";
import { expect, it } from "vitest";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools";

it("carries a visible subject's public image in the scene list without revealing remote art", async () => {
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		visible_actor_spatial_location: [
			{ entityId: 1n, placeNodeId: "station" },
			{ entityId: 2n, placeNodeId: "station" },
		],
		visible_place_node: [
			{
				nodeId: "station",
				placeGraphId: "orbit",
				displayName: "Station",
				description: "",
				posPresent: false,
			},
		],
		visible_place_graph_definition: [{ placeGraphId: "orbit", description: "" }],
		entity: [1, 2, 3].map((id) => ({
			entityId: BigInt(id),
			entityDefId: "crew",
			name: `Crew ${id}`,
			kind: "actor",
			quantity: 1n,
		})),
		public_metadata_attachment: [2, 3].map((id) => ({
			rowId: BigInt(id),
			namespace: "test.art.image",
			audience: "public",
			bundleId: "test",
			targetKind: "entity",
			targetRef: String(id),
			payloadJson: JSON.stringify({
				path: `test/crew-${id}.webp`,
				hash: "a".repeat(64),
				license: "CC0-1.0",
				author_note: "private",
			}),
		})),
	});
	const tools = createPlayerFacingToolMap({ db, act: { actorId: "1" } } as SpellkaveToolContext);
	const result = await tools.scene.execute("scene", {});
	expect(result).toMatchObject({
		details: {
			items: [
				expect.objectContaining({
					id: "2",
					art: { path: "test/crew-2.webp", hash: "a".repeat(64), license: "CC0-1.0" },
				}),
			],
		},
	});
	expect(JSON.stringify(result)).not.toContain("crew-3.webp");
	expect(JSON.stringify(result)).not.toContain("author_note");
});
