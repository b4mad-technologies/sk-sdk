import {
	dsl_reference_json,
	manifest_schema_json,
	observation_placeholder_tokens_json,
} from "@spellkave/validate-wasm";

export interface DslArgReference {
	name: string;
	shape: string;
}

export interface DslOperatorReference {
	operator: string;
	expression_kind: string;
	returns: string;
	args: DslArgReference[];
	notes: string[];
	examples: string[];
	/** `"expression"` = parseable DSL text; `"frame_write"` = structured consequence row (example is conceptual, not DSL). */
	authoring: "expression" | "frame_write";
}

export interface DslReference {
	operators: DslOperatorReference[];
}

export type ManifestSchema = Record<string, unknown>;

export function describeManifestSchema(): ManifestSchema {
	return JSON.parse(manifest_schema_json()) as ManifestSchema;
}

export function describeDsl(): DslReference {
	return JSON.parse(dsl_reference_json()) as DslReference;
}

/**
 * #1968 B-9 (canon-warden Phase-2 condition 3): the FROZEN closed set of
 * presentation-layer placeholder tokens an authored `outcome_template.description`
 * may reference, single-sourced from `spellkave_validate::OBSERVATION_PLACEHOLDER_TOKENS`
 * (Rust). Callers that resolve/interpolate observation prose (the companion
 * agent's `observation.ts`) import THIS function rather than hand-mirroring
 * the list — see the wasm export's own doc comment for why the set does not
 * grow by convention.
 */
export function observationPlaceholderTokens(): string[] {
	return JSON.parse(observation_placeholder_tokens_json()) as string[];
}
