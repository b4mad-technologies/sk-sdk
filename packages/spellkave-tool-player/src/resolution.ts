// U1 minimal fix (elven-mini findings, operator quick-fix 2026-08-04): a
// dispatched manipulate/react receipt's hit/miss outcome is readable today
// only by grepping `resolution_result:true|false` out of
// `provenance.selected_template_ids` — a flat string array `r_manipulate`/
// `r_react` already write real template ids AND prefixed annotation strings
// into side by side (see the elven-mini T6 finding: the full attack
// predicate appears twice in there, byte-identical). This module parses the
// SAME strings the receipt already carries into one small, readable field —
// no new reads, no epistemic change (the info was already in the receipt,
// just unreadable without parsing raw DSL text).
//
// Deliberately narrow scope: mode/result/consequence only. Damage numbers
// and target HP are OUT of scope — that is the harder, epistemically
// sensitive U1 discussion (does an attacker get to see the target's exact
// remaining HP?) and is not smuggled in here.
import { isUnobservedActStatus, UNCONFIRMED_OUTCOME_MESSAGE } from "./act-uncertainty";
import {
	describeRefusal,
	describeRefusalToolHint,
	refusalCodeFromActResult,
} from "./refusal-prose";

const RESOLUTION_MODE_PREFIX = "resolution_mode:";
const RESOLUTION_RESULT_PREFIX = "resolution_result:";
const RESOLUTION_BRANCH_PREFIX = "resolution_branch:";
const RESOLUTION_CONSEQUENCE_PREFIX = "resolution_consequence:";

export interface ResolutionSummary {
	/** e.g. `"stochastic"` — the raw `resolution_mode:` value up to (not
	 * including) its own embedded `:predicate=...` suffix. Absent entirely
	 * (not a fabricated placeholder) when the outcome carries no
	 * `resolution_mode:` line at all — a react_option outcome's provenance
	 * never writes one (U1 follow-up, T16 live finding, 2026-08-04): only
	 * `r_manipulate`'s own resolution path does. */
	mode?: string;
	result: "success" | "failure";
	/** Consequence template id, e.g. `"srd/attack/melee/success"`. */
	consequence: string;
}

/**
 * Parse a dispatched manipulate/react provenance's `selected_template_ids`
 * for the `resolution_mode:`/`resolution_result:`/`resolution_branch:`/
 * `resolution_consequence:` prefixed entries `r_manipulate`/`r_react` write
 * for a stochastic/branching outcome. Returns `null` when result/consequence
 * cannot be resolved — the honest "field weglassen" case for a non-stochastic
 * outcome, which writes none of these lines at all, rather than a
 * partially-filled guess. `mode` alone is optional on the returned summary:
 * a react_option outcome resolves result+consequence but never writes its
 * own `resolution_mode:` line (that annotation is `r_manipulate`-specific),
 * so requiring it unconditionally silently dropped every reaction's
 * otherwise-complete summary.
 */
export function parseResolutionSummary(
	selectedTemplateIds: readonly string[] | undefined,
): ResolutionSummary | null {
	if (selectedTemplateIds === undefined) return null;
	let mode: string | undefined;
	let result: "success" | "failure" | undefined;
	// `resolution_branch:on_success|on_failure` is a fallback source for
	// `result` when `resolution_result:` itself is absent — both name the
	// same verdict, but only `result` is ever exposed on the parsed shape.
	let branchResult: "success" | "failure" | undefined;
	let consequence: string | undefined;

	for (const entry of selectedTemplateIds) {
		if (mode === undefined && entry.startsWith(RESOLUTION_MODE_PREFIX)) {
			const rest = entry.slice(RESOLUTION_MODE_PREFIX.length);
			const separator = rest.indexOf(":");
			mode = separator === -1 ? rest : rest.slice(0, separator);
		} else if (result === undefined && entry.startsWith(RESOLUTION_RESULT_PREFIX)) {
			result = entry.slice(RESOLUTION_RESULT_PREFIX.length) === "true" ? "success" : "failure";
		} else if (branchResult === undefined && entry.startsWith(RESOLUTION_BRANCH_PREFIX)) {
			const branch = entry.slice(RESOLUTION_BRANCH_PREFIX.length);
			if (branch === "on_success") branchResult = "success";
			else if (branch === "on_failure") branchResult = "failure";
		} else if (consequence === undefined && entry.startsWith(RESOLUTION_CONSEQUENCE_PREFIX)) {
			consequence = entry.slice(RESOLUTION_CONSEQUENCE_PREFIX.length);
		}
	}

	const resolvedResult = result ?? branchResult;
	if (resolvedResult === undefined || consequence === undefined) return null;
	return { ...(mode === undefined ? {} : { mode }), result: resolvedResult, consequence };
}

/**
 * sk-dms.38: one player-facing sentence from the already-present
 * `resolution.result` so a hit and a miss do not print the same line.
 * Labels must already be human (display name / entity name) — never a
 * template id.
 */
export function describeResolutionOutcome(
	resolution: ResolutionSummary,
	labels: { action: string; target: string },
): string {
	return resolution.result === "success"
		? `Your ${labels.action} lands on ${labels.target}.`
		: `Your ${labels.action} misses ${labels.target}.`;
}

// U2 (receipt-slimming, operator ruling 2026-08-10): a dispatched
// manipulate/communicate/sense/react result travels in two registers. The
// RAW register — the full `ActorManipulateResult`/`ActorReactResult`/
// `ActorSenseResult` a reducer wrapper returns, SDK bookkeeping
// (`snapshot`, `lagWarning`, `observedAtTick`) and the whole
// `evaluation_provenance` row included — stays available to general/operator
// tooling and to THIS module's own internal parsing (`parseResolutionSummary`
// above; `describeOutcomeTemplate`'s `outcome_template_id` lookup in
// observation.ts). What a PLAYER-facing tool ships outward is the narrower
// PLAYER register: the verb's own status/identity fields untouched, and on a
// non-success outcome the already-present `reason` plus (extracted, not
// nested) `failure_detail` — never the raw `provenance` object, whose
// `selected_template_ids` is the SAME flat, DSL-predicate-duplicated
// annotation array `parseResolutionSummary` exists to parse instead of
// re-exposing (T6 finding: the full attack predicate riding along twice,
// byte-identical). Strips `snapshot`/`lagWarning`/`observedAtTick`/
// `provenance` by omission (same strategy as tools.ts's `slimMoveResult`)
// rather than a hand-picked allow-list, so a verb's own identity fields
// (actor_id, target_id, response_intent, query_kind, ...) travel through
// untouched. `failure_detail` is promoted only when the raw result actually
// carried one — an honest omission on a success result, not a fabricated
// `null`. sk-dms.36: a refused act also carries `player_message`, one
// world-legible sentence from `describeRefusal` of the engine code
// (`failure_kind` → `failure_detail.reason` → top-level `reason`), beside
// the raw `reason` (never instead of it — T7 still asserts the engine code
// stays in the LLM-facing content via `failure_detail`).
//
// Unobserved outcomes instead carry neutral prose and omit completion IDs;
// an SDK diagnostic Predicate row does not establish a completed act.
//
// sk-jay0.1.23.36.1: the deterministic NPC player learns from a rejection's
// engine CLASS, not its prose — so a rejected result also carries
// `failure_kind`, a stable string taken from `provenance.failure_kind` (the
// server's own class) then `failure_detail` JSON `.reason`, same precedence
// as `player_message` above but deliberately NOT falling through to the raw
// top-level `reason` (that is a generic SDK wrapper string like
// "r_manipulate rejected by server", not an engine class — falling through
// to it would fabricate a class where the server provided none). No
// provenance at all still records the field, as `"unclassified"`, rather
// than omitting it — an omitted field and a classified one are
// indistinguishable to a caller that only checks presence.
export function slimActResultForPlayer<
	T extends {
		status: string;
		reason?: string;
		snapshot?: unknown;
		lagWarning?: unknown;
		observedAtTick?: unknown;
		provenance?: {
			failure_kind?: string;
			failure_detail?: string;
			id?: string;
			provenance_id?: string;
		};
	},
>(
	result: T,
): Omit<T, "snapshot" | "lagWarning" | "observedAtTick" | "provenance"> & {
	failure_detail?: string;
	player_message?: string;
	failure_kind?: string;
	tool_hint?: string;
	provenance_id?: string;
} {
	const {
		snapshot: _snapshot,
		lagWarning: _lagWarning,
		observedAtTick: _observedAtTick,
		provenance,
		...rest
	} = result;
	const failureDetail = provenance?.failure_detail;
	const unobserved = isUnobservedActStatus(result.status);
	const refusalCode =
		result.status === "rejected"
			? refusalCodeFromActResult({
					reason: rest.reason,
					failure_detail: failureDetail,
					provenance,
				})
			: undefined;
	const playerMessage = unobserved
		? UNCONFIRMED_OUTCOME_MESSAGE
		: refusalCode === undefined
			? undefined
			: describeRefusal(refusalCode);
	// Same lookup as `refusalCode` above but with `reason` withheld, so the
	// three-way precedence in `refusalCodeFromActResult` can only settle on
	// `provenance.failure_kind` or the `failure_detail` JSON `.reason` — its
	// own top-level-`reason` fallback then has nothing to fall through to
	// and correctly yields `undefined` instead of the wrapper string.
	const failureKind =
		result.status === "rejected"
			? (refusalCodeFromActResult({ failure_detail: failureDetail, provenance }) ?? "unclassified")
			: undefined;
	// sk-jay0.1.46: a second, tool-facing register beside `player_message` for
	// the codes whose remedy is a tool-surface fact (which tool, which field).
	const toolHint = failureKind === undefined ? undefined : describeRefusalToolHint(failureKind);
	// A diagnostic Predicate row does not identify an action completion.
	const provenanceId = unobserved ? undefined : (provenance?.provenance_id ?? provenance?.id);
	return {
		...rest,
		...(failureDetail ? { failure_detail: failureDetail } : {}),
		...(playerMessage === undefined ? {} : { player_message: playerMessage }),
		...(failureKind === undefined ? {} : { failure_kind: failureKind }),
		...(toolHint === undefined ? {} : { tool_hint: toolHint }),
		...(provenanceId !== undefined ? { provenance_id: provenanceId } : {}),
	};
}

// U2 (receipt-slimming, operator ruling 2026-08-10): `spellkave_move`'s
// rev+handle PLAYER register follows the same two-register split as
// `slimActResultForPlayer` above — this is its move-shaped sibling, not a
// distinct doctrine. The RAW `ActorMoveResult` an `ActorClient.move()` call
// returns (SDK bookkeeping, the full `provenance` row included) stays
// available to internal callers and to the edge_id compatibility mode
// (`dispatchRawEdgeMove`, tools.ts) — that mode is already a flat
// general/operator shape that never carried `actor_snapshot`/`lagWarning`/
// `observedAtTick`/raw `provenance` to begin with, so it needs no separate
// slimming pass. The rev+handle PLAYER mode strips those same four fields by
// omission (identical strategy to `slimActResultForPlayer`) and promotes
// `failure_detail` only when the raw result actually carried one — an honest
// omission on success, not a fabricated `null`. This subsumes tools.ts's
// former `slimMoveResult`, whose narrower actor_snapshot-only strip was the
// original ADR-0083 D-3.2 fix (absolute-state resend, not a provenance
// concern); that fix's scope note — "only the snapshot resend is the D-3.2
// violation, not [`reason`/`provenance`] diagnostics" — was a code comment
// about that PR's own narrow scope, not an ADR Decision-text mandate to keep
// provenance forever, so widening the strip here needed no ADR postscript.
//
// sk-jay0.1.76.10: a refused move carries the same two fields a refused act
// does. `failure_kind` is the server's own class from `provenance.failure_kind`
// and `player_message` is its sentence. A failed gate's `failure_detail` is an
// evaluation trail (`affordance_template=...;predicate_value=false`), which
// no player can read; the raw detail stays beside the sentence for debugging.
// A move without a provenance class gets neither field.
export function slimMoveResultForPlayer<
	T extends {
		status: string;
		reason?: string;
		actor_snapshot?: unknown;
		lagWarning?: unknown;
		observedAtTick?: unknown;
		provenance?: {
			failure_kind?: string;
			failure_detail?: string;
			id?: string;
			provenance_id?: string;
		};
	},
>(
	result: T,
): Omit<T, "actor_snapshot" | "lagWarning" | "observedAtTick" | "provenance"> & {
	failure_detail?: string;
	failure_kind?: string;
	player_message?: string;
	provenance_id?: string;
} {
	const {
		actor_snapshot: _actorSnapshot,
		lagWarning: _lagWarning,
		observedAtTick: _observedAtTick,
		provenance,
		...rest
	} = result;
	const failureDetail = provenance?.failure_detail;
	const provenanceId = provenance?.provenance_id ?? provenance?.id;
	const failureKind =
		result.status === "rejected" && provenance?.failure_kind ? provenance.failure_kind : undefined;
	return {
		...rest,
		...(provenanceId !== undefined ? { provenance_id: provenanceId } : {}),
		...(failureDetail ? { failure_detail: failureDetail } : {}),
		...(failureKind === undefined
			? {}
			: { failure_kind: failureKind, player_message: describeRefusal(failureKind) }),
	};
}
