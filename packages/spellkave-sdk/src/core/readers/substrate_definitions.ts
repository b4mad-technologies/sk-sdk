// Reader: public `substrate_definition` catalog (substrate_id → coordinate_kind_id).
// Used by the OSM projection (ADR-0123 D-2 indoor/outdoor class) so the exporter
// does not fall back to the kernel bootstrap seed when live rows are available.

import type { SubstrateDefinitionRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString, rows } from "./_helpers";

export const requiredTables: RequiredTables<["substrate_definition"]> = ["substrate_definition"];
registerReaderManifest({ requiredTables });

/**
 * Read every substrate_definition row in the manifest's snake_case shape
 * (`substrate_id`, `bundle_id`, `coordinate_kind_id`, `description`).
 */
export function readSubstrateDefinitions(db: SnapshotDb): Record<string, unknown>[] {
	return rows<SubstrateDefinitionRow>(db, "substrate_definition").map((row) => ({
		substrate_id: asString(row.substrateId),
		bundle_id: asString(row.bundleId),
		coordinate_kind_id: asString(row.coordinateKindId),
		description: asString(row.description),
	}));
}
