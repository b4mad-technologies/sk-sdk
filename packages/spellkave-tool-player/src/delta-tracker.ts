/**
 * SDK adapter for the browser-safe world-delta tracker. This module owns only
 * reader acquisition and projection; fingerprints, cursor state, and result
 * shaping live in @spellkave/tool-runtime.
 */
import type { EntityRef } from "@spellkave/sdk";
import {
	readCurrentScene,
	readCurrentTraceProjection,
	readInventoryProjection,
	readManipulationContext,
	readSelfStates,
	type SnapshotDb,
} from "@spellkave/sdk/readers";
import {
	createWorldDeltaTracker,
	truncateSceneNodePathPrefix,
	type WorldDeltaItem,
	type WorldDeltaProjection,
	type WorldDeltaSource,
} from "@spellkave/tool-runtime";

export { createWorldDeltaTracker as createDeltaTrackerFromSource, truncateSceneNodePathPrefix };
export type {
	DeltaDomain,
	DeltaTracker,
	DiffAndAdvanceOptions,
	DomainDeltaNote,
	SelfStateDelta,
	WorldDeltaSource,
	WorldDeltas,
} from "@spellkave/tool-runtime";

function sceneItems(db: SnapshotDb, actorId: EntityRef): WorldDeltaItem[] {
	const scene = readCurrentScene(db, actorId);
	if (scene === null) return [];
	return scene.targets.map((target) => {
		if (target.kind === "exit") {
			const node = target.detail.to_node_id;
			const destination =
				typeof node === "string" ? truncateSceneNodePathPrefix(scene.node_id, node) : null;
			return {
				fingerprint: `${target.kind}:${target.id}`,
				name:
					destination === null ? `exit ${target.label}` : `exit ${target.label} → ${destination}`,
			};
		}
		return {
			fingerprint: `${target.kind}:${target.id}`,
			name:
				target.kind === "actor" || target.kind === "entity"
					? `${target.kind} "${target.label}"`
					: `${target.kind} ${target.label}`,
		};
	});
}

function affordanceItems(db: SnapshotDb, actorId: EntityRef): WorldDeltaItem[] {
	const context = readManipulationContext(db, actorId);
	if (context.status !== "ready") return [];
	return [
		...context.actions.map((action) => ({
			fingerprint: `action:${action.action_id}`,
			name: action.display_name || action.action_id,
		})),
		...context.targets.map((target) => ({
			fingerprint: `target:${target.target_fact_id}`,
			name: target.target_ref,
		})),
	];
}

function inventoryItems(db: SnapshotDb, actorId: EntityRef): WorldDeltaItem[] {
	const projection = readInventoryProjection(db, actorId);
	return projection === null
		? []
		: projection.items.map((item) => ({
				fingerprint: `${item.entity_id}|${item.container_id}|${item.quantity}`,
				name: item.quantity > 1 ? `${item.name} ×${item.quantity}` : item.name,
			}));
}

function traceItems(db: SnapshotDb, actorId: EntityRef): WorldDeltaItem[] {
	const projection = readCurrentTraceProjection(db, actorId);
	return projection === null
		? []
		: projection.entries.map((entry) => ({
				fingerprint: entry.trace_id,
				name: entry.kind.slice(entry.kind.lastIndexOf("/") + 1),
			}));
}

/** Production SDK-reader adapter for the runtime's structural delta source port. */
export function createCompanionWorldDeltaSource(
	db: () => SnapshotDb,
	actorId: () => EntityRef | undefined,
): WorldDeltaSource {
	return {
		sample(): WorldDeltaProjection {
			const currentActorId = actorId();
			if (currentActorId === undefined) {
				return { scene: [], affordance: [], inventory: [], trace: [], self: [] };
			}
			const currentDb = db();
			return {
				scene: sceneItems(currentDb, currentActorId),
				affordance: affordanceItems(currentDb, currentActorId),
				inventory: inventoryItems(currentDb, currentActorId),
				trace: traceItems(currentDb, currentActorId),
				self: readSelfStates(currentDb, currentActorId).map((item) => ({
					state_id: item.state_id,
					value: item.value,
				})),
			};
		},
	};
}

/** Compatibility constructor retained for companion consumers during migration. */
export function createDeltaTracker(db: () => SnapshotDb, actorId: () => EntityRef | undefined) {
	return createWorldDeltaTracker(createCompanionWorldDeltaSource(db, actorId));
}
