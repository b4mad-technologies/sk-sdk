import type { SceneTarget } from "@spellkave/sdk/readers";

import type { SpawnedCreatureRef } from "./observation";
import { spawnedActorsAfter } from "./observation";

export interface ApplyConsequenceSpawnEvent {
	event_id: string;
	target_entity_id?: string;
}

/** Server-truth spawn id from new apply_consequence events (sk-84i.6).
 * `target_entity_id` is the spawned body when this apply bound SpawnedEntity;
 * skip the original manipulate target so a non-spawn hit is not reported as a spawn. */
export function spawnedEntityIdFromApplyConsequenceEvents(opts: {
	before: ApplyConsequenceSpawnEvent[];
	after: ApplyConsequenceSpawnEvent[];
	originalTargetEntityId?: string;
}): string | undefined {
	const seen = new Set(opts.before.map((event) => event.event_id));
	const original =
		opts.originalTargetEntityId && opts.originalTargetEntityId !== "0"
			? opts.originalTargetEntityId
			: undefined;
	for (const event of opts.after) {
		if (seen.has(event.event_id)) continue;
		const id = event.target_entity_id?.trim();
		if (!id || id === "0" || id === original) continue;
		return id;
	}
	return undefined;
}

function sceneCreatureName(target: SceneTarget): string {
	return typeof target.detail.name === "string" && target.detail.name.length > 0
		? target.detail.name
		: target.label;
}

/** Prefer the apply_consequence spawned entity when the server named one;
 * otherwise the co-located scene diff. */
export function spawnedCreaturesPreferringServer(opts: {
	serverEntityId?: string;
	sceneAfter: SceneTarget[];
	sceneDiff: SpawnedCreatureRef[];
}): SpawnedCreatureRef[] {
	const serverId = opts.serverEntityId?.trim();
	if (!serverId) return opts.sceneDiff;
	const fromScene = opts.sceneAfter.find((target) => target.id === serverId);
	if (fromScene) {
		return [{ entity_id: serverId, name: sceneCreatureName(fromScene) || "creature" }];
	}
	const fromDiff = opts.sceneDiff.find((entry) => entry.entity_id === serverId);
	if (fromDiff) return [fromDiff];
	return [{ entity_id: serverId, name: "creature" }];
}

/** Resolve spawned creatures for an accepted act: server truth first, scene diff fallback. */
export function resolveSpawnedCreatures(opts: {
	serverEventsBefore: ApplyConsequenceSpawnEvent[];
	serverEventsAfter: ApplyConsequenceSpawnEvent[];
	originalTargetEntityId?: string;
	sceneBefore: SceneTarget[];
	sceneAfter: SceneTarget[];
}): SpawnedCreatureRef[] {
	const sceneDiff = spawnedActorsAfter(opts.sceneBefore, opts.sceneAfter);
	const serverEntityId = spawnedEntityIdFromApplyConsequenceEvents({
		before: opts.serverEventsBefore,
		after: opts.serverEventsAfter,
		originalTargetEntityId: opts.originalTargetEntityId,
	});
	return spawnedCreaturesPreferringServer({
		serverEntityId,
		sceneAfter: opts.sceneAfter,
		sceneDiff,
	});
}
