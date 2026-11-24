// sk-dms.36: a refused act's PLAYER register keeps the raw engine fields
// (`reason` / `failure_detail`) and adds one world-legible sentence so a
// blind player can learn the rule they just hit. The SDK wrapper mints
// `reason: "r_manipulate rejected by server"`; the engine code lives on
// `provenance.failure_kind` and/or as `failure_detail` JSON `.reason`.
// There is no authored refusal-prose primitive (observation prose is
// success-only); this table is the client-side mapping, not a new schema.

const UNKNOWN_REFUSAL = "That did not work.";

const REFUSAL_PROSE: Record<string, string> = {
	action_budget_exhausted: "No effort is available for that action.",
	action_recharging: "That is not ready yet.",
	unknown_economy_channel: "You cannot spend that kind of effort here.",
	action_economy_observability_error: "The world cannot tell whether you may act.",
	not_your_turn: "It is not your turn.",
	actor_authorization_failed: "You are not allowed to do that.",
	predicate_rejected: "That cannot be done right now.",
	affordance_selection_failed: "Nothing here lets you do that.",
	bound_exhausted: "You have nothing left to spend on that.",
	claim_contended: "Someone else already has hold of that.",
	insufficient_item_quantity: "You do not have enough of that.",
	invalid_args: "That is not a way you can do this.",
	invalid_outcome_template: "The world does not know how that should end.",
	invalid_resolution_mode: "The world does not know how to settle that.",
	manipulation_rejected: "That did not take.",
	missing_action_definition: "You do not know how to do that.",
	out_of_range: "That is too far away to reach.",
	precondition_failed: "The moment is not right for that.",
	self_target_not_eligible: "You cannot do that to yourself.",
	stale_item_source: "That is no longer in your hands.",
	stale_target: "That is no longer where you saw it.",
	unreachable_target: "You cannot get to that from here.",
	abandoned: "That was given up before it finished.",
	felicity_rejected: "That is not a fitting thing to say.",
	// ADR-0142 D-3: a prompt-bound answer sent without its open prompt.
	prompt_context_required: "That answer belongs to a question nobody is asking you right now.",
	predicate_no_longer_holds: "The way is closed to you right now.",
	movement_reach_exceeded: "That is farther than you can go.",
	movement_budget_exhausted: "You have no movement left.",
	spatial_missing_edge_or_relation: "There is no way there from here.",
	spatial_blocked_substrate_crossing: "Something blocks the way.",
	spatial_invalid_target_reference: "That is not a place you can go to.",
};

/** One world-legible English sentence for a manipulate refusal code. */
export function describeRefusal(reason: string): string {
	return REFUSAL_PROSE[reason] ?? UNKNOWN_REFUSAL;
}

// sk-jay0.1.46: the world-legible sentence above deliberately carries no
// engine token, so it cannot tell a tool-driving player WHERE the missing
// fact lives. This second register does: one sentence per code naming the
// PLAYER tool and field that repairs the call. Only codes whose remedy is a
// tool-surface fact (not a world fact) get a row; a blind player reads
// `player_message`, a tool caller reads `tool_hint`.
const REFUSAL_TOOL_HINT: Record<string, string> = {
	prompt_context_required:
		'Send the open prompt with the answer: copy the matching prompts[] row from spellkave_manipulation_context into args_json as {"semantic_context": <row>}.',
};

/** Tool-surface repair hint for a refusal code, or undefined when the remedy is a world fact. */
export function describeRefusalToolHint(reason: string): string | undefined {
	return REFUSAL_TOOL_HINT[reason];
}

function parseFailureDetailReason(detail: string | undefined): string | undefined {
	if (detail === undefined || detail === "") return undefined;
	try {
		const parsed: unknown = JSON.parse(detail);
		if (parsed !== null && typeof parsed === "object" && "reason" in parsed) {
			const nested = (parsed as { reason: unknown }).reason;
			if (typeof nested === "string" && nested !== "") return nested;
		}
	} catch {
		// Malformed detail is not a code — fall through.
	}
	return undefined;
}

/**
 * Engine refusal code from a manipulate result. Precedence matches the
 * live SDK path: `provenance.failure_kind` (evaluation_provenance) →
 * `failure_detail` JSON `.reason` → top-level `reason` (often the
 * wrapper "r_manipulate rejected by server").
 */
export function refusalCodeFromActResult(result: {
	reason?: string;
	failure_detail?: string;
	provenance?: { failure_kind?: string; failure_detail?: string };
}): string | undefined {
	const kind = result.provenance?.failure_kind;
	if (typeof kind === "string" && kind !== "") return kind;
	const fromDetail =
		parseFailureDetailReason(result.provenance?.failure_detail) ??
		parseFailureDetailReason(result.failure_detail);
	if (fromDetail !== undefined) return fromDetail;
	if (result.reason !== undefined && result.reason !== "") return result.reason;
	return undefined;
}
