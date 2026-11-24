import type { ReaderManifest } from "../reader-manifest";

const rawContainment: ReaderManifest = {
	// @ts-expect-error entity_containment is an owner-subscription table, not a reader TableName
	requiredTables: ["entity_containment"],
};

export const ownerTablesNotReader = rawContainment;
