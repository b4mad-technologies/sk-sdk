// ADR-0139 client-side lazy composition for one ordinary manipulation attempt.
//
// This is deliberately a transport and disclosure policy, not an eligibility
// evaluator. It accepts one open authored action id and one already-disclosed
// target, then leaves template selection, authority, predicates, budget, and
// consequences to r_manipulate at dispatch time.

import type { ManipulationContext } from "./readers/manipulation_context";
import { manipulationArgsFromJson } from "./reducers/manipulation_args";
import { targetRefFromString, targetRefToString } from "./reducers/transport";

export interface FactoredManipulationAttemptInput {
	/** An authored action id from the caller's ready manipulation context. */
	action_id: string;
	/** A typed target string from the caller's disclosed target facts. */
	target_ref: string;
	/** Existing JSON arguments, preserved except for a selected mpc token. */
	args_json?: string;
	/** Select one disclosed mpc token when an action has more than one. */
	participant_context?: string;
	/** The occurrence and source this response answers (ADR-0142 D-3), when
	 * `action_id` is prompt-bound. The caller picks it from `context.prompts`
	 * (ADR-0142 D-6/D-7: "clients rank; nothing becomes eligible client-side"
	 * — this composer never infers it). Forwarded 1:1 under `args_json`'s
	 * `semantic_context` key, exactly as the server reads it. */
	semantic_context?: { source_ref: string; occurrence_id: string };
}

/** One lazy candidate. `not_assessed` means only that its transport is shaped;
 * it makes no claim that the server will admit the attempt. */
export interface FactoredManipulationAttempt {
	status: "not_assessed";
	action_id: string;
	target_ref: string;
	args_json: string;
	participant_context?: string;
	semantic_context?: { source_ref: string; occurrence_id: string };
}

export type FactoredManipulationAttemptResult =
	| FactoredManipulationAttempt
	| { status: "context_unavailable" }
	| { status: "unknown_action"; action_id: string }
	| { status: "invalid_target_ref"; target_ref: string }
	| { status: "undisclosed_target"; target_ref: string }
	| { status: "malformed_args"; reason: string }
	| { status: "participant_context_conflict" }
	| { status: "unknown_participant_context"; participant_context: string }
	| { status: "participant_context_required"; action_id: string; choices: string[] };

/**
 * Composes exactly one attempt from a ready factored context. It never reads a
 * database, calls an eligibility reader, or constructs an action × target
 * list. A caller may use the returned value to invoke the existing
 * r_manipulate transport once.
 */
export function composeFactoredManipulationAttempt(
	context: ManipulationContext,
	input: FactoredManipulationAttemptInput,
): FactoredManipulationAttemptResult {
	if (context.status !== "ready") return { status: "context_unavailable" };
	const actionId = input.action_id.trim();
	if (!context.actions.some((action) => action.action_id === actionId)) {
		return { status: "unknown_action", action_id: input.action_id };
	}

	let targetRef: string;
	try {
		targetRef = targetRefToString(targetRefFromString(input.target_ref));
	} catch {
		return { status: "invalid_target_ref", target_ref: input.target_ref };
	}
	if (!context.targets.some((target) => target.target_ref === targetRef)) {
		return { status: "undisclosed_target", target_ref: targetRef };
	}

	const args = parseArgs(input.args_json ?? "{}");
	if ("reason" in args) return { status: "malformed_args", reason: args.reason };
	const rawContext = stringField(args.value, "participant_context", "participantContext");
	const requestedContext = input.participant_context?.trim() || rawContext;
	if (
		input.participant_context !== undefined &&
		rawContext !== undefined &&
		input.participant_context.trim() !== rawContext
	) {
		return { status: "participant_context_conflict" };
	}

	const choices = context.participants.filter((candidate) => candidate.action_id === actionId);
	let participantContext: string | undefined;
	if (requestedContext !== undefined) {
		if (!choices.some((choice) => choice.context_id === requestedContext)) {
			return { status: "unknown_participant_context", participant_context: requestedContext };
		}
		participantContext = requestedContext;
	} else if (choices.length === 1) {
		participantContext = choices[0]?.context_id;
	} else if (choices.length > 1) {
		return {
			status: "participant_context_required",
			action_id: actionId,
			choices: choices.map((choice) => choice.context_id),
		};
	}

	if (participantContext !== undefined) {
		delete args.value.expectedParticipants;
		delete args.value.expected_participants;
		delete args.value.participantContext;
		delete args.value.participant_context;
		args.value.participant_context = participantContext;
	}
	// ADR-0142 D-3 wire fold-in, the same shape `participant_context` above
	// uses: an explicit caller-supplied `semantic_context` replaces whatever
	// (if anything) `args_json` already carried under that key. This composer
	// never derives it from `context.prompts` itself (D-7: "clients rank;
	// nothing becomes eligible client-side").
	if (input.semantic_context !== undefined) {
		args.value.semantic_context = {
			source_ref: input.semantic_context.source_ref,
			occurrence_id: input.semantic_context.occurrence_id,
		};
	}
	return {
		status: "not_assessed",
		action_id: actionId,
		target_ref: targetRef,
		args_json: JSON.stringify(args.value),
		...(participantContext === undefined ? {} : { participant_context: participantContext }),
		...(input.semantic_context === undefined ? {} : { semantic_context: input.semantic_context }),
	};
}

function parseArgs(json: string): { value: Record<string, unknown> } | { reason: string } {
	try {
		const parsed = JSON.parse(json.trim() === "" ? "{}" : json) as unknown;
		if (!isRecord(parsed)) return { reason: "manipulation args must be a JSON object" };
		// Validate the wire fields with the same parser r_manipulate uses. The
		// original object remains intact so forward-compatible authored fields
		// are not erased by this generic composer.
		manipulationArgsFromJson(JSON.stringify(parsed));
		return { value: { ...parsed } };
	} catch (error) {
		return { reason: error instanceof Error ? error.message : "malformed manipulation args" };
	}
}

function stringField(record: Record<string, unknown>, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (value !== undefined && value !== null) return String(value);
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
