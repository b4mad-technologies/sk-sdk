// Deterministic identity for one dispatch-shaped `IntentDraft` inside one
// `ObservationEpoch`. Used by `RejectionLedger` to recognise "the exact
// rejected attempt" for ADR-0141 D-6 suppression — nothing here evaluates
// eligibility or compares drafts for similarity, only exact wire identity.
// `facts_revision` deliberately does not enter this fingerprint: the ledger
// pairs revision with fingerprint separately, so the same syntax at two
// different revisions is still recognisably "the same attempt" for counting
// purposes, even though only a matching revision suppresses it.

import { sortKeysDeep } from "./canonical";
import type { IntentDraft, ObservationEpoch } from "./intent";

// A present-vs-absent tag, not a natural JSON shape a caller's own data could
// produce by accident: `t: 0` (absent) can never equal `t: 1`/`t: 2`
// (present, well-formed/malformed) regardless of what value or text a caller
// supplies. This is what lets the fingerprint tell "field omitted" apart from
// "field present but empty" — undefined `args_json` from `"{}"`, undefined
// `utterance` from `""`, undefined `input_values` from `{}`.
const ABSENT = { t: 0 } as const;
function present(v: unknown) {
	return { t: 1, v };
}
function malformedText(text: string) {
	return { t: 2, text };
}

/** Canonicalizes `args_json` and extracts an effective `participant_context`
 * from it. `participant_context` carried as a draft field and as the
 * `participant_context` key inside `args_json` are the same fact: whichever
 * is present (draft field wins when both are) is folded into one value and
 * removed from the canonical args value, so the two spellings fingerprint
 * identically. */
function canonicalizeArgs(argsJson: string | undefined): {
	canonical: unknown;
	participantContext?: string;
} {
	if (argsJson === undefined) return { canonical: ABSENT };
	const text = argsJson.trim();
	if (text === "") return { canonical: present({}) };

	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		// Malformed args are not silently dropped: the raw trimmed text still
		// participates in the fingerprint, tagged distinctly from any
		// well-formed value, so a malformed and a well-formed draft are never
		// mistaken for the same attempt.
		return { canonical: malformedText(text) };
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return { canonical: present(sortKeysDeep(parsed)) };
	}

	const obj = { ...(parsed as Record<string, unknown>) };
	let participantContext: string | undefined;
	const raw = obj.participant_context;
	if (typeof raw === "string" && raw.trim() !== "") participantContext = raw.trim();
	delete obj.participant_context;

	return {
		canonical: present(sortKeysDeep(obj)),
		...(participantContext === undefined ? {} : { participantContext }),
	};
}

function canonicalizeInputValues(values: IntentDraft["input_values"]): unknown {
	return values === undefined ? ABSENT : present(sortKeysDeep(values));
}

function canonicalizeUtterance(draft: IntentDraft): unknown {
	const utterance = draft.kind === "communicate" ? draft.utterance : undefined;
	return utterance === undefined ? ABSENT : present(utterance);
}

function canonicalizeSemanticContext(draft: IntentDraft): unknown {
	const semanticContext = draft.semantic_context;
	return semanticContext === undefined
		? ABSENT
		: present({
				source_ref: semanticContext.source_ref.trim(),
				occurrence_id: semanticContext.occurrence_id.trim(),
			});
}

function trimOr(value: string | undefined): string {
	return value?.trim() ?? "";
}

/** A deterministic string over every field that distinguishes one draft's
 * dispatch, plus the epoch it would dispatch into. Computed from the
 * immutable snapshot `createAttempt` freezes — never from a caller's live,
 * mutable object. Two drafts differing only in `args_json`/`input_values` key
 * order, or in `participant_context` spelling (draft field vs. the
 * `participant_context` key inside `args_json`), fingerprint identically;
 * differing `utterance`, `target_ref`, `semantic_context`, or epoch never do,
 * and a field's absence never fingerprints the same as its
 * explicitly-empty presence (see `canonicalizeArgs`/`canonicalizeInputValues`/
 * `canonicalizeUtterance`). The tuple is joined via `JSON.stringify` of an
 * ordered array so no field boundary can be crossed by string
 * concatenation. */
export function attemptFingerprint(draft: IntentDraft, epoch: ObservationEpoch): string {
	const { canonical: argsCanonical, participantContext } = canonicalizeArgs(draft.args_json);
	const effectiveParticipantContext = trimOr(draft.participant_context) || participantContext || "";
	const primaryId = draft.kind === "manipulate" ? draft.action_id : draft.speech_act_id;

	return JSON.stringify([
		draft.kind,
		trimOr(primaryId),
		trimOr(draft.target_ref),
		argsCanonical,
		canonicalizeInputValues(draft.input_values),
		canonicalizeUtterance(draft),
		effectiveParticipantContext,
		canonicalizeSemanticContext(draft),
		epoch,
	]);
}
