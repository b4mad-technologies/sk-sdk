import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readCurrentScene } from "../core/readers/scene";

const db = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	public_metadata_attachment: [2, 90].map((id) => ({
		rowId: BigInt(id),
		namespace: "test.art.image",
		audience: "public",
		bundleId: "test",
		targetKind: "entity",
		targetRef: String(id),
		payloadJson: JSON.stringify({
			path: `test/subject-${id}.webp`,
			hash: "b".repeat(64),
			license: "CC0-1.0",
		}),
	})),
	visible_actor_spatial_location: [
		{ entityId: 1n, placeNodeId: "inn" },
		{ entityId: 2n, placeNodeId: "inn" },
		{ entityId: 3n, placeNodeId: "inn" },
	],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [
		{ manifestKey: "test:test/hero", entityId: 1n, bundleId: "test" },
		{ manifestKey: "test:test/remote", entityId: 99n, bundleId: "test" },
	],
	visible_place_node: [
		{
			nodeId: "inn",
			placeGraphId: "town",
			displayName: "The Inn",
			description: "A warm common room.",
			posPresent: false,
		},
		{
			nodeId: "road",
			placeGraphId: "town",
			displayName: "The Road",
			description: "A distant road.",
			posPresent: false,
		},
	],
	visible_place_graph_definition: [{ placeGraphId: "town", description: "The town of tests." }],
	visible_place_edge: [{ edgeId: 7n, fromNodeId: "inn", toNodeId: "road" }],
	entity: [
		{ entityId: 1n, name: "Hero", entityDefId: "hero", kind: "actor", quantity: 1n },
		{ entityId: 2n, name: "Innkeeper", entityDefId: "npc", kind: "actor", quantity: 1n },
		{ entityId: 3n, name: "Guard", entityDefId: "npc", kind: "actor", quantity: 1n },
		{ entityId: 10n, name: "Lantern", entityDefId: "lantern", kind: "item", quantity: 1n },
		{ entityId: 90n, name: "Remote Chest", entityDefId: "chest", kind: "item", quantity: 1n },
	],
	visible_entity_tag: [{ entityId: 2n, tag: "faction:town" }],
	entity_description: [{ entityId: 2n, description: "A stout innkeeper with flour on her apron." }],
	visible_object_state: [
		{
			rowId: 1n,
			targetKind: { tag: "Entity" },
			targetId: 2n,
			stateId: "srd/appearance",
			value: { tag: "Text", value: "Flour-dusted apron, warm smile." },
			setAtTick: 1n,
		},
	],
	visible_target_condition: [
		{
			targetKind: { tag: "Entity" },
			targetId: 2n,
			conditionDefinitionId: "test/condition/weary",
			appliedAtTick: 1n,
			expiresAtTick: undefined,
			stackCount: 1n,
			bundleId: "test",
			sourceId: "test/source",
		},
	],
	visible_entity_location: [{ entityId: 10n, placeNodeId: "inn" }],
	visible_trace: [
		{
			traceId: 4n,
			kind: "smoke",
			locationKind: "place_node",
			locationRef: "inn",
			payloadJson: '{"source":"hearth"}',
			inscribedAt: 2n,
			expiresAt: undefined,
			inscribedBy: "2",
			visibility: { tag: "Local" },
			bundleId: "test",
		},
	],
});

describe("readCurrentScene", () => {
	it("joins authorized prose, occupants, entities, exits, and traces deterministically", () => {
		const scene = readCurrentScene(db, asEntityRef("test/hero"));
		expect(scene).toMatchObject({
			node_id: "inn",
			node_display_name: "The Inn",
			node_description: "A warm common room.",
			graph_description: "The town of tests.",
			counts: { actor: 2, entity: 1, exit: 1, trace: 1 },
		});
		expect(scene?.targets.map((target) => [target.kind, target.label])).toEqual([
			["actor", "Innkeeper"],
			["actor", "Guard"],
			["entity", "Lantern"],
			["exit", "road"],
			["trace", "smoke"],
		]);
		// The exit carries its destination's authored name, so a listing can say
		// "The Road" without a scene_detail round trip.
		const exit = scene?.targets.find((target) => target.kind === "exit");
		expect(exit?.detail.to_display_name).toBe("The Road");
	});

	// U4 (tool-ux-decision-log.md): scene_detail's actor target used to carry
	// only {entity_id, name, faction} — nothing to act on beyond the listing
	// row. The Innkeeper (authored description + a live condition) and the
	// Guard (neither authored) prove the enrichment surfaces what IS there and
	// gracefully shows nothing (not an error) for what is not.
	it("enriches an actor target's detail with authored description, appearance, and visible conditions (U4)", () => {
		const scene = readCurrentScene(db, asEntityRef("test/hero"));
		const byLabel = new Map(
			(scene?.targets ?? []).filter((t) => t.kind === "actor").map((t) => [t.label, t.detail]),
		);
		expect(byLabel.get("Innkeeper")).toMatchObject({
			entity_def_id: "npc",
			description: "A stout innkeeper with flour on her apron.",
			appearance: "Flour-dusted apron, warm smile.",
			conditions: [
				expect.objectContaining({
					condition_definition_id: "test/condition/weary",
					stack_count: 1,
				}),
			],
		});
		expect(byLabel.get("Guard")).toMatchObject({
			entity_def_id: "npc",
			description: "",
			appearance: "",
			conditions: [],
		});
	});

	it("does not admit a known remote actor or grounded entity", () => {
		const scene = readCurrentScene(db, asEntityRef("test/hero"));
		expect(scene?.targets.find((target) => target.id === "2")?.detail.art).toMatchObject({
			path: "test/subject-2.webp",
		});
		expect(scene?.targets.some((target) => target.id === "90")).toBe(false);
		expect(readCurrentScene(db, asEntityRef("test/remote"))).toBeNull();
		expect(
			Array.from(db.visible_entity_location?.iter?.() ?? []).some(
				(row) => String((row as { entityId: bigint }).entityId) === "90",
			),
		).toBe(false);
	});
});
