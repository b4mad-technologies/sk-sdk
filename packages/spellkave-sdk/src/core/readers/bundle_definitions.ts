import type { CapabilityDefinitionRow, ResourceDefinitionRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, optNumber, rows } from "./_helpers";

export const capabilityRequiredTables: RequiredTables<["capability_definition"]> = [
	"capability_definition",
];
registerReaderManifest({ requiredTables: capabilityRequiredTables });

export const resourceRequiredTables: RequiredTables<["resource_definition"]> = [
	"resource_definition",
];
registerReaderManifest({ requiredTables: resourceRequiredTables });

export interface BundleCapabilityDefinitionRow {
	capability_id: string;
	bundle_id: string;
	actor_kind: string;
	display_name: string;
	description: string;
}

export interface BundleResourceDefinitionRow {
	resource_definition_id: string;
	bundle_id: string;
	display_name: string;
	value_kind: string;
	min_value: number;
	max_value: number;
	recovery_rule: string;
	initial_value: number | null;
}

export function readCapabilityDefinition(
	db: SnapshotDb,
	capabilityId: string,
): BundleCapabilityDefinitionRow | null {
	const row = rows<CapabilityDefinitionRow>(db, "capability_definition").find(
		(r) => r.capabilityId === capabilityId,
	);
	if (!row) return null;
	return {
		capability_id: asString(row.capabilityId),
		bundle_id: asString(row.bundleId),
		actor_kind: asString(row.actorKind),
		display_name: asString(row.displayName),
		description: asString(row.description),
	};
}

export function readResourceDefinition(
	db: SnapshotDb,
	resourceDefinitionId: string,
): BundleResourceDefinitionRow | null {
	const row = rows<ResourceDefinitionRow>(db, "resource_definition").find(
		(r) => r.resourceDefinitionId === resourceDefinitionId,
	);
	if (!row) return null;
	const initial = optNumber(row.initialValue);
	return {
		resource_definition_id: asString(row.resourceDefinitionId),
		bundle_id: asString(row.bundleId),
		display_name: asString(row.displayName),
		value_kind: asString(row.valueKind),
		min_value: asNumber(row.minValue),
		max_value: asNumber(row.maxValue),
		recovery_rule: asString(row.recoveryRule),
		initial_value: initial === undefined || !Number.isFinite(initial) ? null : initial,
	};
}
