// ADR-0140/ADR-0141 shared interaction vocabulary: WorldFacts -> IntentDraft
// -> Attempt -> Outcome. The server no longer publishes evaluated
// action×target offers ("disclosure is not eligibility"); a client composes
// exactly one local, fallible `IntentDraft` from disclosed facts, and the
// server alone decides admission. This file is the draft half of that
// vocabulary: syntax-only shaping and completeness, never an eligibility
// claim.

import type { AffordanceInputField, AffordanceInputSchema } from "../readers/affordance_input";
import { sortKeysDeep } from "./canonical";

/** Transport families this vocabulary is scoped to, not a closed game-action
 * vocabulary. `IntentDraft` currently covers `manipulate` and `communicate`
 * only. `move`, `sense`, `react`, and `end_turn` keep their existing bounded
 * reducer contracts and will get their own named draft fields in a later
 * change — this module does not invent a generic shape for them yet. */
export type AttemptKind = "manipulate" | "communicate" | "move" | "sense" | "react" | "end_turn";

/** The speaker and occurrence an otherwise-identical utterance answers. Two
 * drafts with the same `utterance` text but different `semantic_context`
 * mean different things (e.g. two different dialogue prompts asking "yes or
 * no?"), so both parts enter the fingerprint. `occurrence_id` is the ADR-0142
 * D-2 server-allocated occurrence identity from the `manipulation_context`
 * projection's `prompts` (ADR-0142 D-6) — never client-derived. The wire
 * shape a caller forwards under `args_json`'s `semantic_context` key is
 * `{ source_ref, occurrence_id }` exactly (ADR-0142 D-3). */
export interface IntentSemanticContext {
	source_ref: string;
	occurrence_id: string;
}

/** Structured form input shared by both draft kinds. Values are read-only:
 * an `IntentDraft` is a snapshot of caller intent, not a live form model. */
export type IntentInputValues = Readonly<Record<string, string | number | boolean>>;

interface IntentDraftCommon {
	/** A typed target string, exactly as disclosed. */
	target_ref?: string;
	/** JSON object text carrying authored input fields, forward-compatible
	 * with fields `input_values` does not name. */
	args_json?: string;
	/** Structured form input. The one defined representation for authored
	 * input fields — see `inputValuesToText` for its wire form. */
	input_values?: IntentInputValues;
	/** Select one disclosed mpc (multi-participant context) token. */
	participant_context?: string;
	semantic_context?: IntentSemanticContext;
}

/** manipulate: an authored action id and a disclosed target, going through
 * the existing `composeFactoredManipulationAttempt` machinery for direct
 * manipulation. */
export interface ManipulateDraft extends IntentDraftCommon {
	kind: "manipulate";
	action_id?: string;
}

/** communicate: an authored speech act id and a disclosed target. `utterance`
 * is free text by default — see `checkDraft` for when it doubles as a JSON
 * field source. */
export interface CommunicateDraft extends IntentDraftCommon {
	kind: "communicate";
	speech_act_id?: string;
	utterance?: string;
}

/**
 * A local, fallible candidate assembled from disclosed facts. An `IntentDraft`
 * is never a server offer and never implies admission — it only says what a
 * caller intends to send, shaped well enough to dispatch. Scoped to
 * `manipulate` and `communicate` for now; see `AttemptKind`.
 */
export type IntentDraft = ManipulateDraft | CommunicateDraft;

/** The exact wire form the Play app sends today for structured input (as
 * `utterance` / `dispatch_text`): key-sorted JSON text. Transports decide
 * where that text travels — this helper only shapes it. */
export function inputValuesToText(values: IntentInputValues): string {
	return JSON.stringify(sortKeysDeep(values));
}

/** The utterance text for structured input: only fields whose authored
 * `channel` is `"utterance"` and that carry a non-blank value count. Exactly
 * one such field yields its bare text; several yield a key-sorted JSON object
 * string (the `inputValuesToText` form); none yields `""`. Additive beside
 * `inputValuesToText`, which keeps its all-values behaviour. */
export function utteranceFromInputValues(
	fields: readonly AffordanceInputField[],
	values: IntentInputValues,
): string {
	const picked: Record<string, string | number | boolean> = {};
	for (const field of fields) {
		if (field.channel !== "utterance") continue;
		if (!(field.name in values)) continue;
		const value = values[field.name];
		if (value === undefined || (typeof value === "string" && value.trim() === "")) continue;
		picked[field.name] = value;
	}
	const names = Object.keys(picked);
	if (names.length === 0) return "";
	if (names.length === 1) return String(picked[names[0] as string]);
	return inputValuesToText(picked);
}

/**
 * One connected actor/world observation lifetime. Opaque to callers besides
 * `observationEpoch`; mint a new value after reconnect, actor change, world
 * reset, or context evict+rebuild. Never reused across those boundaries —
 * `RejectionLedger` suppression is scoped by this value precisely so a stale
 * epoch cannot suppress dispatch against facts the caller no longer holds.
 */
export type ObservationEpoch = string;

/** A stable, collision-safe join of the facts that bound one epoch.
 * `context_generation` exists because `connection_generation` alone cannot
 * promise freshness across a server-side context evict+rebuild (the context
 * `revision` restarts, but the transport connection does not change) — see
 * `nextContextGeneration`. */
export function observationEpoch(parts: {
	world_instance_id: string;
	actor_id: string;
	connection_generation: number | string;
	context_generation: number | string;
}): ObservationEpoch {
	return [
		parts.world_instance_id,
		parts.actor_id,
		String(parts.connection_generation),
		String(parts.context_generation),
	]
		.map((part) => part.replaceAll("\\", "\\\\").replaceAll("|", "\\|"))
		.join("|");
}

/** The shape `nextContextGeneration` reads to decide whether a caller's
 * locally observed context is the same rebuild-generation as before. */
export interface ContextGenerationInput {
	status: "ready" | "unavailable";
	revision: number | null;
}

interface ContextGenerationState extends ContextGenerationInput {
	generation: number;
}

/**
 * Conservative, client-side detection of a context evict+rebuild — a
 * substitute for a portable generation the server does not publish yet.
 * Returns `0` for an undefined `previous` (first observation). Otherwise
 * bumps by one when the context went `unavailable` -> `ready`, or when its
 * `revision` moved backwards (a lower revision than previously observed
 * implies the context was rebuilt from scratch); any other transition keeps
 * the previous generation. This detection is conservative: it can miss a
 * rebuild that happens not to satisfy either signal, but it never invents a
 * bump the caller did not observe.
 */
export function nextContextGeneration(
	previous: ContextGenerationState | undefined,
	current: ContextGenerationInput,
): number {
	if (previous === undefined) return 0;
	const wentUnavailableToReady = previous.status === "unavailable" && current.status === "ready";
	const revisionWentBackwards =
		previous.revision !== null && current.revision !== null && current.revision < previous.revision;
	return wentUnavailableToReady || revisionWentBackwards
		? previous.generation + 1
		: previous.generation;
}

export type DraftMissingPart = "action" | "target" | "required_input";

/** Syntax completeness only. Never an eligibility claim — a "complete" draft
 * may still be rejected by the server for any live-state reason. `missing`
 * lists absent required syntax; `malformed` lists a present-but-unparsable
 * source. A draft that is `"incomplete"` has at least one non-empty array,
 * never both empty. */
export type DraftCheck =
	| { status: "complete" }
	| {
			status: "incomplete";
			missing: DraftMissingPart[];
			malformed: Array<"args_json" | "utterance_json">;
			/** Names of the required input fields that carry no value. Present
			 * only when `missing` includes `"required_input"`. */
			missing_fields?: string[];
	  };

function isBlank(value: string | undefined): boolean {
	return value === undefined || value.trim() === "";
}

/** Checks that a draft carries the syntax its `kind` needs to dispatch, that
 * `args_json` (when present) parses as a JSON object, and optionally that
 * every field an authored `AffordanceInputSchema` marks `required` has a
 * value. Required-field values are looked up in `input_values` first, then a
 * JSON object parsed from `utterance` (Play's historical wire form for form
 * values — `communicate` only, since `utterance` is not a `manipulate`
 * field), then `args_json`.
 *
 * `args_json` present and not a JSON object is `malformed`, never `missing`.
 * An `utterance` that fails to parse as JSON is NOT malformed — ordinary
 * speech is not JSON, so a parse failure there is silently ignored as a
 * field source rather than reported. `utterance_json` is kept in the
 * `malformed` vocabulary for a future draft kind that requires `utterance`
 * itself to carry structured input; nothing in this module produces it yet.
 * An absent schema, or one with an empty `fields` array, never yields
 * `required_input`. */
export function checkDraft(draft: IntentDraft, input?: AffordanceInputSchema): DraftCheck {
	const missing: DraftMissingPart[] = [];
	const malformed: Array<"args_json" | "utterance_json"> = [];

	if (draft.kind === "manipulate") {
		if (isBlank(draft.action_id)) missing.push("action");
	} else {
		if (isBlank(draft.speech_act_id)) missing.push("action");
	}
	if (isBlank(draft.target_ref)) missing.push("target");

	const argsValues = parseJsonObjectOrReport(draft.args_json, () => malformed.push("args_json"));
	const utteranceText = draft.kind === "communicate" ? draft.utterance : undefined;
	// A parse failure here is deliberately swallowed: plain speech is not malformed.
	const utteranceValues = utteranceText === undefined ? undefined : parseJsonObject(utteranceText);

	let missingFields: string[] = [];
	if (input !== undefined && input.fields.some((field) => field.required === true)) {
		missingFields = input.fields
			.filter((field) => field.required === true)
			.filter(
				(field) =>
					!isPresent(fieldValue(field.name, draft.input_values, utteranceValues, argsValues)),
			)
			.map((field) => field.name);
		if (missingFields.length > 0) missing.push("required_input");
	}

	return missing.length === 0 && malformed.length === 0
		? { status: "complete" }
		: {
				status: "incomplete",
				missing,
				malformed,
				...(missingFields.length > 0 ? { missing_fields: missingFields } : {}),
			};
}

function fieldValue(
	name: string,
	inputValues: IntentInputValues | undefined,
	utteranceValues: Record<string, unknown> | undefined,
	argsValues: Record<string, unknown> | undefined,
): unknown {
	if (inputValues !== undefined && name in inputValues) return inputValues[name];
	if (utteranceValues !== undefined && name in utteranceValues) return utteranceValues[name];
	if (argsValues !== undefined && name in argsValues) return argsValues[name];
	return undefined;
}

function isPresent(value: unknown): boolean {
	if (value === undefined || value === null) return false;
	if (typeof value === "string") return value.trim() !== "";
	if (typeof value === "number") return Number.isFinite(value);
	return true;
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
	if (text.trim() === "") return undefined;
	try {
		const parsed: unknown = JSON.parse(text);
		if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
		return parsed as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

function parseJsonObjectOrReport(
	text: string | undefined,
	reportMalformed: () => void,
): Record<string, unknown> | undefined {
	if (text === undefined || text.trim() === "") return undefined;
	const parsed = parseJsonObject(text);
	if (parsed === undefined) reportMalformed();
	return parsed;
}
