// Test support: a served `/schema?version=10` body for the module this SDK
// was built for (KERNEL_CONTRACT), optionally altered, without a node.
import {
	type SchemaSnapshot,
	type SchemaTable,
	servedSchemaFromSnapshot,
} from "../core/world-contract/index.ts";
import { KERNEL_CONTRACT } from "../core/kernel_contract.generated";

const EXTRA_TABLE: SchemaTable = {
	access: "public",
	kind: "user",
	event: false,
	columns: ["id: U64"],
	primaryKey: [],
	unique: [],
	indexes: {},
	autoInc: [],
};

/**
 * Serves `tables` (tables or views of the contract; unknown names become a
 * one-column table) and `reducers`, plus extra public or private views.
 */
export function servedSchema(
	tables: readonly string[],
	reducers: readonly string[],
	views: readonly { source_name: string; is_public: boolean }[] = [],
	edit: (snapshot: SchemaSnapshot) => SchemaSnapshot = (s) => s,
): unknown {
	const snapshot: SchemaSnapshot = {
		...KERNEL_CONTRACT,
		tables: Object.fromEntries(
			tables
				.filter((t) => !(t in KERNEL_CONTRACT.views))
				.map((t) => [t, KERNEL_CONTRACT.tables[t] ?? EXTRA_TABLE]),
		),
		views: {
			...Object.fromEntries(
				tables.filter((t) => t in KERNEL_CONTRACT.views).map((t) => [t, KERNEL_CONTRACT.views[t]]),
			),
			...Object.fromEntries(
				views.map((v) => [
					v.source_name,
					{
						public: v.is_public,
						anonymous: false,
						params: [],
						returns: "Array",
						columns: ["id: U64"],
					},
				]),
			),
		},
		reducers: Object.fromEntries(
			reducers.map((r) => [
				r,
				KERNEL_CONTRACT.reducers[r] ?? {
					visibility: "client",
					params: [],
					ok: "()",
					err: "String",
				},
			]),
		),
	} as SchemaSnapshot;
	return servedSchemaFromSnapshot(edit(snapshot));
}
