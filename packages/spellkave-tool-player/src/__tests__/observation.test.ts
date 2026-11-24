import { describe, expect, it } from "vitest";

import type { SpawnedCreatureRef } from "../observation.ts";
import { resolveSpawnedCreatures, spawnedCreaturesPreferringServer } from "../spawn-observation.ts";

const goblin = {
	kind: "actor" as const,
	id: "42",
	label: "Goblin",
	detail: { name: "Goblin" },
};
const wolf = {
	kind: "actor" as const,
	id: "43",
	label: "Wolf",
	detail: { name: "Wolf" },
};
const sceneDiff: SpawnedCreatureRef[] = [
	{ entity_id: "42", name: "Goblin" },
	{ entity_id: "43", name: "Wolf" },
];

describe("spawnedCreaturesPreferringServer (sk-84i.6)", () => {
	it("prefers the server-truth entity over a wider scene diff", () => {
		expect(
			spawnedCreaturesPreferringServer({
				serverEntityId: "42",
				sceneAfter: [goblin, wolf],
				sceneDiff,
			}),
		).toEqual([{ entity_id: "42", name: "Goblin" }]);
	});

	it("falls back to the scene diff when the server did not name a spawn", () => {
		expect(
			spawnedCreaturesPreferringServer({
				sceneAfter: [goblin, wolf],
				sceneDiff,
			}),
		).toEqual(sceneDiff);
	});

	it("still reports the server entity when it is absent from the scene diff", () => {
		expect(
			spawnedCreaturesPreferringServer({
				serverEntityId: "99",
				sceneAfter: [goblin],
				sceneDiff: [{ entity_id: "42", name: "Goblin" }],
			}),
		).toEqual([{ entity_id: "99", name: "creature" }]);
	});
});

describe("resolveSpawnedCreatures (sk-84i.6)", () => {
	it("uses apply_consequence target_entity_id when it is not the original target", () => {
		expect(
			resolveSpawnedCreatures({
				serverEventsBefore: [{ event_id: "1", target_entity_id: "9" }],
				serverEventsAfter: [
					{ event_id: "1", target_entity_id: "9" },
					{ event_id: "2", target_entity_id: "42" },
				],
				originalTargetEntityId: "9",
				sceneBefore: [],
				sceneAfter: [goblin, wolf],
			}),
		).toEqual([{ entity_id: "42", name: "Goblin" }]);
	});

	it("falls back to the scene diff when the event still names the original target", () => {
		expect(
			resolveSpawnedCreatures({
				serverEventsBefore: [],
				serverEventsAfter: [{ event_id: "2", target_entity_id: "9" }],
				originalTargetEntityId: "9",
				sceneBefore: [],
				sceneAfter: [goblin],
			}),
		).toEqual([{ entity_id: "42", name: "Goblin" }]);
	});
});
