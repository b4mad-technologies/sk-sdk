import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../replay";
import {
	hasOversightGrant,
	projectWatchFrame,
	readWatchOwnBodies,
	WATCH_BUFFER_CAP,
	WatchBuffer,
	watchOverlayAdmitted,
} from "../watch-buffer";

function db(
	parts: Record<string, Record<string, unknown>[]>,
): ReturnType<typeof snapshotDbFromFixture> {
	return snapshotDbFromFixture({
		visible_manifest_authored_entity: [],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		...parts,
	});
}

function occupancyDb(opts: {
	tick: number;
	entities: { id: bigint; name: string; place: string; hp?: number }[];
	grant?: boolean;
	events?: { id: bigint; tick: number; kind: string; summary?: string }[];
	art?: { entityId: bigint; key: string; path: string };
}) {
	return db({
		world_time: [{ tick: BigInt(opts.tick) }],
		visible_actor_spatial_location: opts.entities.map((e) => ({
			entityId: e.id,
			placeNodeId: e.place,
		})),
		entity: opts.entities.map((e) => ({
			entityId: e.id,
			name: e.name,
			entityDefId: "",
			kind: "npc",
			quantity: 1n,
			ownedByEntityId: 0n,
			createdAtTick: 0n,
		})),
		actor: opts.entities.map((e, i) => ({
			actorId: BigInt(i + 1),
			name: e.name,
			currentBody: e.id,
			createdAtTick: 0n,
		})),
		visible_object_state: opts.entities
			.filter((e) => e.hp !== undefined)
			.map((e, i) => ({
				rowId: BigInt(i + 1),
				targetKind: "entity",
				targetId: e.id,
				stateId: "srd/hp",
				value: { tag: "Int", value: BigInt(e.hp ?? 0) },
				sourceTemplateId: "",
				setAtTick: 0n,
				expiresAtTick: 0n,
				bundleId: "srd",
			})),
		visible_target_condition: [],
		visible_entity_tag: [],
		visible_manifest_authored_entity: opts.art
			? [{ manifestKey: `srd:${opts.art.key}`, entityId: opts.art.entityId }]
			: [],
		public_metadata_attachment: [],
		visible_metadata_attachment: opts.art
			? [
					{
						bundleId: "srd",
						namespace: "srd.art.image",
						audience: "public",
						targetKind: "entity",
						targetRef: opts.art.key,
						payloadJson: JSON.stringify({
							path: opts.art.path,
							hash: "a".repeat(64),
							license: "CC-BY-4.0",
						}),
					},
				]
			: [],
		visible_world_event: (opts.events ?? []).map((event) => ({
			id: event.id,
			tick: BigInt(event.tick),
			kind: { tag: event.kind },
			summary: event.summary !== undefined ? { some: event.summary } : undefined,
		})),
		visible_capability: opts.grant
			? [
					{
						entityId: opts.entities[0]?.id ?? 1n,
						capabilityId: "maps_watch/oversee",
						source: "maps_watch",
						extentRef: "elven_mini/region",
						extentKindRef: "place_graph",
						elevationClass: "internal",
					},
				]
			: [],
	});
}

describe("projectWatchFrame", () => {
	it("projects occupancy, names, hp and same-tick events", () => {
		const frame = projectWatchFrame(
			occupancyDb({
				tick: 4,
				entities: [
					{ id: 10n, name: "Renn", place: "inn/loft", hp: 12 },
					{ id: 11n, name: "Goblin", place: "inn/cellar", hp: 7 },
				],
				art: { entityId: 10n, key: "renn", path: "srd-art/characters/renn.webp" },
				events: [
					{ id: 1n, tick: 4, kind: "intent", summary: "Goblin lunges" },
					{ id: 2n, tick: 3, kind: "intent", summary: "older" },
				],
			}),
			4,
		);
		expect(frame.tick).toBe(4);
		expect(frame.actors.map((a) => a.name)).toEqual(["Renn", "Goblin"]);
		expect(frame.actors[1]?.states).toEqual([
			{ state_id: "srd/hp", display_name: "srd/hp", value: "7" },
		]);
		expect(frame.events).toEqual([{ id: "1", tick: 4, kind: "intent", summary: "Goblin lunges" }]);
		expect(frame.actors[0]?.art).toEqual({
			path: "srd-art/characters/renn.webp",
			hash: "a".repeat(64),
			license: "CC-BY-4.0",
		});
		expect(frame.actors[1]?.art).toBeNull();
		expect(frame.items).toEqual([]);
	});

	it("projects carried items onto the holder's place", () => {
		const frame = projectWatchFrame(
			db({
				world_time: [{ tick: 1n }],
				visible_actor_spatial_location: [{ entityId: 41n, placeNodeId: "mill/altar" }],
				entity: [
					{
						entityId: 41n,
						name: "Sister Maelis",
						entityDefId: "",
						kind: "npc",
						quantity: 1n,
						ownedByEntityId: 0n,
						createdAtTick: 0n,
					},
					{
						entityId: 155n,
						name: "Longsword (+1)",
						entityDefId: "",
						kind: "item",
						quantity: 1n,
						ownedByEntityId: 0n,
						createdAtTick: 0n,
					},
				],
				actor: [{ actorId: 1n, name: "Sister Maelis", currentBody: 41n, createdAtTick: 0n }],
				visible_entity_containment: [
					{ entityId: 155n, containerId: 41n, slotId: "core/main_hand" },
				],
				visible_entity_equipment_slot: [
					{ entityId: 41n, equippedEntityId: 155n, slotId: "srd/slot/torso" },
				],
				visible_entity_location: [],
				entity_description: [{ entityId: 155n, description: "A well-kept blade." }],
				visible_object_state: [
					{ targetKind: "entity", targetId: 155n, stateId: "srd/hp", value: 1 },
				],
				visible_target_condition: [],
				visible_entity_tag: [{ entityId: 155n, tag: "magic" }],
				visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
				visible_manifest_authored_entity: [{ manifestKey: "srd:longsword", entityId: 155n }],
				public_metadata_attachment: [],
				visible_metadata_attachment: [
					{
						bundleId: "srd",
						namespace: "srd.art.image",
						audience: "public",
						targetKind: "entity",
						targetRef: "longsword",
						payloadJson: JSON.stringify({
							path: "srd-art/items/longsword.webp",
							hash: "b".repeat(64),
							license: "CC-BY-4.0",
						}),
					},
				],
				visible_world_event: [],
				visible_capability: [],
			}),
			1,
		);
		expect(frame.items).toEqual([
			{
				entityId: "155",
				name: "Longsword (+1)",
				placeNodeId: "mill/altar",
				holderEntityId: "41",
				holderName: "Sister Maelis",
				slotId: "srd/slot/torso",
				description: "A well-kept blade.",
				states: [{ state_id: "srd/hp", display_name: "srd/hp", value: "1" }],
				tags: ["magic"],
				art: {
					path: "srd-art/items/longsword.webp",
					hash: "b".repeat(64),
					license: "CC-BY-4.0",
				},
			},
		]);
	});
});

describe("oversight grant", () => {
	it("admits overlay only with internal elevation + extent", () => {
		expect(
			hasOversightGrant(occupancyDb({ tick: 1, entities: [{ id: 1n, name: "A", place: "x" }] }), [
				"1",
			]),
		).toBe(false);
		expect(
			watchOverlayAdmitted(
				occupancyDb({
					tick: 1,
					entities: [{ id: 1n, name: "A", place: "x" }],
					grant: true,
				}),
				["1"],
			),
		).toBe(true);
	});
});

describe("AUTH-35-02 compatibility watch admission", () => {
	it("ignores foreign Public read rows and expiry; admits own capability depth", () => {
		const snapshot = (expiresAtTick?: bigint) =>
			db({
				world_time: [{ tick: 10n }],
				actor: [
					{ actorId: 3n, currentBody: 7n },
					{ actorId: 4n, currentBody: 8n },
				],
				visible_actor_identity: [{ actorId: 3n }],
				visible_capability: [
					{
						entityId: 7n,
						capabilityId: "frontier.read_internal",
						extentRef: "forest",
						elevationClass: { tag: "Hidden" },
						expiresAtTick,
					},
				],
			});
		expect(readWatchOwnBodies(snapshot())).toEqual(["7"]);
		expect(hasOversightGrant(snapshot(), ["8"])).toBe(false);
		expect(hasOversightGrant(snapshot())).toBe(false);
		expect(hasOversightGrant(snapshot(), readWatchOwnBodies(snapshot()))).toBe(true);
		expect(hasOversightGrant(snapshot(10n), ["7"])).toBe(false);
		expect(hasOversightGrant(snapshot(11n), ["7"])).toBe(true);
	});
});

describe("WatchBuffer", () => {
	it("bootstraps at now and does not invent history", () => {
		const buffer = new WatchBuffer();
		buffer.bootstrap(occupancyDb({ tick: 10, entities: [{ id: 1n, name: "A", place: "x" }] }), 10);
		expect(buffer.oldestTick()).toBe(10);
		expect(buffer.latestTick()).toBe(10);
		expect(buffer.frameAt(9)).toBeNull();
		expect(buffer.cursor()).toEqual({ kind: "live" });
	});

	it("folds later ticks, replaces same tick, and caps the ring", () => {
		const buffer = new WatchBuffer(3);
		buffer.bootstrap(occupancyDb({ tick: 1, entities: [{ id: 1n, name: "A", place: "x" }] }), 1);
		buffer.observe(occupancyDb({ tick: 2, entities: [{ id: 1n, name: "A", place: "y" }] }), 2);
		buffer.observe(occupancyDb({ tick: 2, entities: [{ id: 1n, name: "A", place: "z" }] }), 2);
		expect(buffer.frameAt(2)?.actors[0]?.placeNodeId).toBe("z");
		buffer.observe(occupancyDb({ tick: 3, entities: [{ id: 1n, name: "A", place: "z" }] }), 3);
		buffer.observe(occupancyDb({ tick: 4, entities: [{ id: 1n, name: "A", place: "z" }] }), 4);
		expect(buffer.oldestTick()).toBe(2);
		expect(buffer.latestTick()).toBe(4);
	});

	it("pauses the view while still recording live ticks; scrub cannot pass now", () => {
		const buffer = new WatchBuffer();
		buffer.bootstrap(occupancyDb({ tick: 5, entities: [{ id: 1n, name: "A", place: "a" }] }), 5);
		buffer.observe(occupancyDb({ tick: 6, entities: [{ id: 1n, name: "A", place: "b" }] }), 6);
		buffer.pause();
		expect(buffer.cursor()).toEqual({ kind: "paused", tick: 6 });
		expect(buffer.frameAtCursor()?.actors[0]?.placeNodeId).toBe("b");
		buffer.observe(occupancyDb({ tick: 7, entities: [{ id: 1n, name: "A", place: "c" }] }), 7);
		expect(buffer.frameAtCursor()?.actors[0]?.placeNodeId).toBe("b");
		buffer.scrub(99);
		expect(buffer.cursor()).toEqual({ kind: "paused", tick: 7 });
		buffer.scrub(5);
		expect(buffer.frameAtCursor()?.actors[0]?.placeNodeId).toBe("a");
		buffer.play();
		expect(buffer.cursor()).toEqual({ kind: "live" });
		expect(buffer.frameAtCursor()?.actors[0]?.placeNodeId).toBe("c");
	});

	it("keeps the default cap at combat-picture order", () => {
		expect(WATCH_BUFFER_CAP).toBe(600);
	});
});
