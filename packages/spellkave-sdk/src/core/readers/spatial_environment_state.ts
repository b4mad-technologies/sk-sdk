// Reader: spatial_environment_state (room/edge-topology env-state, ADR-0056).
// The carrier for the ActorReachableNodes N-hop fanout (ADR-0076) —
// e.g. an alarm bool cascaded across every place-node within a hop radius.
// Generic over state vocabulary: a modder's own topology-scoped bool/int/text
// marker reads the same way as a phandelver-authored one.
//
// `spatial_environment_state` is private (ADR-0120, #915 sweep PR-4); read
// the per-caller `visible_spatial_environment_state` view.

import { resolveEffectiveSpatialEnvironmentStates } from "../effective_environment_state";

export { resolveEffectiveSpatialEnvironmentStates } from "../effective_environment_state";

import type { SpatialEnvironmentStateRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { rows, tagString } from "./_helpers";

export const requiredTables: RequiredTables<["visible_spatial_environment_state"]> = [
	"visible_spatial_environment_state",
];
registerReaderManifest({ requiredTables });

/** The projected identity/rank columns, derived from generated bindings. */
export type EnvironmentStateCandidate = Partial<
	Pick<
		SpatialEnvironmentStateRow,
		| "bundleId"
		| "stateId"
		| "stateRowId"
		| "updatedTick"
		| "targetKind"
		| "targetRef"
		| "placeNodeId"
		| "placeEdgeId"
		| "locationDefId"
		| "cellRes10"
		| "cellRes7"
		| "cellRes4"
		| "substrateId"
	>
>;

export interface SpatialNodeStateRef {
	placeNodeId: string;
	stateId: string;
}

function dslBoolValue(value: unknown): boolean | null {
	if (typeof value === "boolean") return value;
	if (!value || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	if (tagString(record.tag) === "Bool") return Boolean(record.value);
	if ("Bool" in record) return Boolean((record as { Bool: unknown }).Bool);
	return null;
}

/**
 * Read a single place-node's topology-scoped bool env-state
 * (`spatial_environment_state`, `target_kind = "place_node"`). Returns `null` when
 * no row exists for `(placeNodeId, stateId)` (never cascaded there) or the
 * row's value is not a `DslValue::Bool` carrier.
 */
export function readSpatialNodeStateBool(db: SnapshotDb, ref: SpatialNodeStateRef): boolean | null {
	const row = resolveEffectiveSpatialEnvironmentStates(
		rows<SpatialEnvironmentStateRow>(db, "visible_spatial_environment_state"),
	).find(
		(candidate) => candidate.placeNodeId === ref.placeNodeId && candidate.stateId === ref.stateId,
	);
	return row === undefined ? null : dslBoolValue(row.value);
}
