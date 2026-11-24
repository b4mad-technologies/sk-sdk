import {
	core_bootstrap_manifest,
	core_extent_kinds_json,
	merged_role_capability_ids_json,
} from "@spellkave/validate-wasm";
import {
	type ExplainDisclosure,
	type ExplainKind,
	explainVocabularyWith,
	type VocabularyLookup,
} from "./explain-core";
import { inspectManifest } from "./inspect";

export * from "./explain-core";

import type { VocabularyRow } from "./explain-core";

/** Files consult the actual bootstrap; live callers must supply live rows alone. */
export function bootstrapVocabularyRows(kind: string): VocabularyRow[] {
	if (kind === "extent_kind_definitions") return JSON.parse(core_extent_kinds_json());
	const value = inspectManifest(core_bootstrap_manifest()).manifest[kind];
	return Array.isArray(value) ? (value as VocabularyRow[]) : [];
}

export function mergedRoleCapabilityIds(roleId: string, lookup: VocabularyLookup): string[] {
	return JSON.parse(
		merged_role_capability_ids_json(
			roleId,
			JSON.stringify(lookup("role_definitions")),
			JSON.stringify(lookup("role_aggregations")),
		),
	);
}

export function explainVocabulary(
	kind: ExplainKind,
	id: string,
	source: "files" | "live",
	lookup: VocabularyLookup,
	disclosure?: ExplainDisclosure,
) {
	return explainVocabularyWith(kind, id, source, lookup, mergedRoleCapabilityIds, disclosure);
}
