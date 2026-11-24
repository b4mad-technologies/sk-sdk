import { evaluate_dsl_expression_json } from "@spellkave/validate-wasm";

export type DslExpressionKind = "predicate" | "int" | "text";

export type EvaluationValue =
	| { type: "Bool"; value: boolean }
	| { type: "Int"; value: number }
	| { type: "Text"; value: string };

export interface StochasticDraw {
	source_id: string;
	draw_index: number;
	value: number;
}

export interface TraceScopeEntry {
	subject: SubjectRef;
	slot: string;
}

/** JSON shape emitted by Rust's externally-tagged `SubjectRef` enum. */
export type SubjectRef =
	| "Actor"
	| "ActorWieldedItem"
	| "Target"
	| "Location"
	| "Session"
	| "World"
	| { Binding: { name: string } }
	| { Event: "Kind" | { Detail: { field_id: string } } }
	| { ActorEquippedItem: { slot_id: string } };

export interface RollTableSelection {
	entry_id: string;
	kept: boolean;
}

export interface TraceEntry {
	node_id: number;
	operator: string | null;
	depth: number;
	span: { start: number; end: number } | null;
	scope: TraceScopeEntry[];
	value: EvaluationValue | null;
	error: string | null;
	table_entries: RollTableSelection[] | null;
}

export interface EvaluationRejection {
	kind: string;
	message: string;
	subject?: string;
	field_id?: string;
	pool?: string;
	draw_number?: number;
	bound?: string;
	budget?: number;
	macro_id?: string;
	operator?: string;
	diagnostics?: Array<{
		code: string;
		message: string;
		start: number;
		end: number;
	}>;
}

export interface EvaluationResult {
	ok: boolean;
	value?: EvaluationValue;
	draws?: StochasticDraw[];
	trace?: TraceEntry[];
	error?: string;
	rejection?: EvaluationRejection;
}

export interface EvaluateDslExpressionOptions {
	expression: string;
	kind: DslExpressionKind;
	facts?: Record<string, unknown> | string;
	dice?: readonly number[] | string;
	manifestToml?: string | null;
}

export { evaluate_dsl_expression_json };

export function evaluateDslExpression(options: EvaluateDslExpressionOptions): EvaluationResult {
	const factsJson =
		typeof options.facts === "string" ? options.facts : JSON.stringify(options.facts ?? {});
	const diceJson =
		typeof options.dice === "string" ? options.dice : JSON.stringify(options.dice ?? []);
	const raw = evaluate_dsl_expression_json(
		options.expression,
		options.kind,
		factsJson,
		diceJson,
		options.manifestToml ?? undefined,
	);
	return JSON.parse(raw) as EvaluationResult;
}
