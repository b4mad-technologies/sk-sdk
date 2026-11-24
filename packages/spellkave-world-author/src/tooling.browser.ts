import {
	type RenderManifestIncludeOptions,
	renderManifestIncludeWith,
	splitIncludedManifestMetadataWith,
} from "./included-manifest-metadata-core";

/** Browser AUTHOR tooling: web wasm at the boundary, shared pure helpers within. */

import initAuthoring, {
	applyset_root_info_json,
	classify_and_build_delta_json,
	cluster_rows_json,
	export_not_round_tripped_json,
	extra_rows_by_natural_key_json,
	live_manifest_row_identities_json,
	manifest_row_identities_json,
	patch_manifest_json,
	row_kind_composite_key_json,
	row_kind_natural_key_json,
	row_kind_storage_key_json,
	shape_params_json,
} from "@spellkave/authoring-wasm/browser";
import initValidate, {
	core_bootstrap_manifest,
	core_extent_kinds_json,
	evaluate_dsl_expression_json as evaluate_dsl_expression_json_raw,
	manifest_schema_json,
	merged_role_capability_ids_json,
	parse_manifest_toml_to_json,
	render_manifest_include,
	render_manifest_json_to_toml,
	split_manifest_fragment,
	validate_manifest_toml,
} from "@spellkave/validate-wasm/browser";
import type {
	ApplysetDiffInput,
	ApplysetDiffOutput,
	ApplysetExtentScope,
	ApplysetRootInfo,
} from "./applyset-diff-types";
import {
	authoringDocMetadata,
	extractAuthoringDocSection,
	isSupportedAuthoringDoc,
	listAuthoringDocSections,
	listAuthoringDocs,
	queryAuthoringDocs,
} from "./corpus";
import { routeDamage, routeDamageMagnitude } from "./damage";
import type { Diagnostic } from "./diagnostics";
import {
	diffManifests,
	flattenManifestDiff,
	parseMapKey,
	parseSchemaManifestToml as parseSchemaManifestTomlPure,
} from "./diff-manifest-core";
import type {
	DslExpressionKind,
	EvaluateDslExpressionOptions,
	EvaluationRejection,
	EvaluationResult,
	EvaluationValue,
	RollTableSelection,
	StochasticDraw,
	SubjectRef,
	TraceEntry,
	TraceScopeEntry,
} from "./evaluate";
import {
	filteredRowCount,
	filterManifestForActor,
	type SchemaManifest,
} from "./filter-manifest-core";
import {
	findRowByCompositeKey,
	inspectRowRefs,
	inspectSchemaManifest,
	outboundRefsExcluding,
	refTagOutboundRefs,
} from "./inspection";
import { stripManifestHeaders } from "./manifest-text";
import { validateMetadataRows } from "./metadata";
import { type RefTagFamily, resolveRefTagValue } from "./ref-tags";
import { setExportNotRoundTripped, setRowKindMaps } from "./row-kinds-data";
import { manifestTagPrefixFamilies } from "./tag-prefix-families";

export type { Diagnostic, RefTagFamily, SchemaManifest };
export type * from "./applyset-diff-types";
export type DiffOnlyFilter = "gaps" | "snapshot" | "changed";
export type ActorBehavior = import("./compose").ActorBehavior;
export type BehaviorConfig = import("./compose").BehaviorConfig;
export type InboundRowRef = { kind: string; id: string; field: string };
export type OutboundRowRef = { field: string; value: string };

let ready: Promise<void> | undefined;
export const ROW_KIND_NATURAL_KEY: Record<string, string> = {};
export const ROW_KIND_COMPOSITE_KEY: Record<string, readonly string[]> = {};
/** ADR-0146, sk-jay0.7.174.30 — see `row-kinds.ts`'s own doc comment. */
export const ROW_KIND_STORAGE_KEY: Record<string, readonly string[]> = {};

export function loadBrowserAuthorTooling(): Promise<void> {
	ready ??= Promise.all([initValidate(), initAuthoring()]).then(() => {
		Object.assign(ROW_KIND_NATURAL_KEY, decode(row_kind_natural_key_json()));
		Object.assign(ROW_KIND_COMPOSITE_KEY, decode(row_kind_composite_key_json()));
		Object.assign(ROW_KIND_STORAGE_KEY, decode(row_kind_storage_key_json()));
		setRowKindMaps(ROW_KIND_NATURAL_KEY, ROW_KIND_COMPOSITE_KEY);
		setExportNotRoundTripped(decode(export_not_round_tripped_json()));
	});
	return ready;
}

function requireReady(): void {
	if (ready === undefined) {
		throw new Error(
			"AUTHOR browser tooling is not initialized; call loadBrowserAuthorTooling first.",
		);
	}
}

function decode<T>(value: string): T {
	return JSON.parse(value) as T;
}

export function describeManifestSchema(): Record<string, unknown> {
	requireReady();
	return decode(manifest_schema_json());
}

export function renderSchemaManifest(manifest: Record<string, unknown>): string {
	requireReady();
	return render_manifest_json_to_toml(JSON.stringify(manifest));
}

export function inspectManifest(toml: string) {
	requireReady();
	return inspectSchemaManifest(decode<Record<string, unknown>>(parse_manifest_toml_to_json(toml)));
}

export function parseSchemaManifestToml(toml: string): SchemaManifest {
	return parseSchemaManifestTomlPure(toml);
}

export function validateManifestToml(toml: string): Diagnostic[] {
	requireReady();
	const diagnostics = decode<Diagnostic[]>(validate_manifest_toml(toml));
	try {
		const manifest = parseSchemaManifestToml(toml);
		diagnostics.push(
			...validateMetadataRows(
				manifest.metadata_attachments as never,
				manifest.metadata_namespaces as never,
			),
			...validateActorCapabilityRows(manifest.actor_capabilities as never),
			...validateCapabilityNicheProvider(
				manifest.niche_definitions as never,
				manifest.affordance_templates as never,
			),
		);
	} catch {
		// Rust validation already contains parse diagnostics.
	}
	return diagnostics;
}

export function patchManifest(
	manifest: Record<string, unknown>,
	op: string,
	payload: Record<string, unknown>,
): void {
	requireReady();
	for (const [table, rows] of Object.entries(
		decode<Record<string, unknown[]>>(
			patch_manifest_json(JSON.stringify(manifest), op, JSON.stringify(payload)),
		),
	))
		manifest[table] = rows;
}

export function clusterRows(
	behaviors: ActorBehavior[],
	cfg: BehaviorConfig,
): Record<string, unknown> {
	requireReady();
	return decode(cluster_rows_json(JSON.stringify(behaviors), JSON.stringify(cfg)));
}

export function applysetRootInfo(rootToml: string): ApplysetRootInfo {
	requireReady();
	return decode(applyset_root_info_json(rootToml));
}

export function classifyAndBuildDelta(input: ApplysetDiffInput): ApplysetDiffOutput {
	requireReady();
	return decode(classify_and_build_delta_json(JSON.stringify(input)));
}

export function inspectRowReferences(manifest: Record<string, unknown>, kind: string, id: string) {
	requireReady();
	return inspectRowRefs(manifest, ROW_KIND_NATURAL_KEY, kind, id);
}

export {
	authoringDocMetadata,
	isSupportedAuthoringDoc,
	diffManifests,
	extractAuthoringDocSection,
	extra_rows_by_natural_key_json,
	findRowByCompositeKey,
	filteredRowCount,
	filterManifestForActor,
	flattenManifestDiff,
	inspectSchemaManifest,
	listAuthoringDocs,
	listAuthoringDocSections,
	manifestTagPrefixFamilies,
	outboundRefsExcluding,
	parseMapKey,
	queryAuthoringDocs,
	refTagOutboundRefs,
	resolveRefTagValue,
	routeDamage,
	routeDamageMagnitude,
	shape_params_json,
	stripManifestHeaders,
};

function validateActorCapabilityRows(
	rows: Array<{ actor_entity_key: string; capability_id: string }> | undefined,
): Diagnostic[] {
	const seen = new Map<string, number>();
	const diagnostics: Diagnostic[] = [];
	for (const [index, row] of (rows ?? []).entries()) {
		const key = `${row.actor_entity_key}::${row.capability_id}`;
		const prior = seen.get(key);
		if (prior === undefined) seen.set(key, index);
		else
			diagnostics.push({
				code: "WA-CAP-001",
				severity: "warning",
				path: `actor_capabilities[${index}]`,
				message: `duplicate actor_capabilities row for (actor_entity_key='${row.actor_entity_key}', capability_id='${row.capability_id}') at index ${index} (first at index ${prior})`,
				details: row,
			});
	}
	return diagnostics;
}
function validateCapabilityNicheProvider(
	niches: Array<{ niche_id?: string; provider?: string }> | undefined,
	affordances: Array<{ niche_id?: string }> | undefined,
): Diagnostic[] {
	const defined = new Set<string>();
	const diagnostics: Diagnostic[] = [];
	for (const [index, row] of (niches ?? []).entries())
		if (row.niche_id?.startsWith("capability:")) {
			defined.add(row.niche_id);
			if (!row.provider?.trim())
				diagnostics.push(capabilityDiagnostic(row.niche_id, `niche_definitions[${index}]`, row));
		}
	for (const [index, row] of (affordances ?? []).entries())
		if (row.niche_id?.startsWith("capability:") && !defined.has(row.niche_id))
			diagnostics.push(capabilityDiagnostic(row.niche_id, `affordance_templates[${index}]`, row));
	return diagnostics;
}
function capabilityDiagnostic(nicheId: string, path: string, details: unknown): Diagnostic {
	return {
		code: "WA-CAP-002",
		severity: "fatal",
		path,
		details,
		message: `capability-shaped niche '${nicheId}' requires an explicit provider`,
	};
}

export function renderManifestInclude(
	rendered: string,
	options: RenderManifestIncludeOptions = {},
): string {
	requireReady();
	return renderManifestIncludeWith(render_manifest_include, rendered, options);
}
export function splitIncludedManifestMetadata(fragmentToml: string) {
	requireReady();
	return splitIncludedManifestMetadataWith(split_manifest_fragment, fragmentToml);
}

export type {
	DslExpressionKind,
	EvaluateDslExpressionOptions,
	EvaluationRejection,
	EvaluationResult,
	EvaluationValue,
	RollTableSelection,
	StochasticDraw,
	SubjectRef,
	TraceEntry,
	TraceScopeEntry,
};

export function evaluate_dsl_expression_json(
	source: string,
	kind: string,
	factsJson: string,
	diceJson: string,
	manifestToml?: string | null,
): string {
	requireReady();
	return evaluate_dsl_expression_json_raw(
		source,
		kind,
		factsJson,
		diceJson,
		manifestToml ?? undefined,
	);
}

export function evaluateDslExpression(options: EvaluateDslExpressionOptions): EvaluationResult {
	requireReady();
	const factsJson =
		typeof options.facts === "string" ? options.facts : JSON.stringify(options.facts ?? {});
	const diceJson =
		typeof options.dice === "string" ? options.dice : JSON.stringify(options.dice ?? []);
	const raw = evaluate_dsl_expression_json_raw(
		options.expression,
		options.kind,
		factsJson,
		diceJson,
		options.manifestToml ?? undefined,
	);
	return JSON.parse(raw) as EvaluationResult;
}

export * from "./explain-core";

import {
	type ExplainDisclosure,
	type ExplainKind,
	explainVocabularyWith,
	type VocabularyLookup,
	type VocabularyRow,
} from "./explain-core";
export function bootstrapVocabularyRows(kind: string): VocabularyRow[] {
	requireReady();
	if (kind === "extent_kind_definitions") return JSON.parse(core_extent_kinds_json());
	const manifest = JSON.parse(parse_manifest_toml_to_json(core_bootstrap_manifest()));
	return Array.isArray(manifest[kind]) ? manifest[kind] : [];
}
export function mergedRoleCapabilityIds(roleId: string, lookup: VocabularyLookup): string[] {
	requireReady();
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

export type { GrantInput, GrantRow } from "./grants-core";

import { compose_grant_json, grant_delta_json } from "@spellkave/authoring-wasm/browser";
import { composeGrantWith, grantDeltaWith } from "./grants-core";
export const composeGrant = (
	...args: Parameters<typeof composeGrantWith> extends [unknown, ...infer T] ? T : never
) => composeGrantWith(compose_grant_json, ...args);
export const grantDelta = (
	...args: Parameters<typeof grantDeltaWith> extends [unknown, ...infer T] ? T : never
) => grantDeltaWith(grant_delta_json, ...args);

export { createInstanceProjector, type OwnerSnapshot } from "./owner-instance-read";
export * from "./scoped-instance-read";
export function renderSchemaManifestJson(manifestJson: string): string {
	requireReady();
	return render_manifest_json_to_toml(manifestJson);
}
export function manifestRowIdentities(
	toml: string,
	isRoot: boolean,
): import("./applyset").ManifestRowIdentities {
	requireReady();
	return decode(manifest_row_identities_json(toml, isRoot));
}

export function liveManifestRowIdentities(
	manifestJson: string,
): import("./applyset").ManifestRowIdentities {
	requireReady();
	return decode(live_manifest_row_identities_json(manifestJson));
}
