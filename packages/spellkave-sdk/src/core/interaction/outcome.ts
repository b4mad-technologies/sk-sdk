// The `Attempt` a caller dispatches, and the `Outcome` vocabulary a
// transport reports back. Both stay transport-free: this module never talks
// to a connection, a reducer, or a table — it only shapes and stamps values a
// transport-owning caller passes in and reads back.

import { attemptFingerprint } from "./fingerprint";
import type { IntentDraft, ObservationEpoch } from "./intent";

/** One dispatched candidate: an immutable snapshot of a draft, the epoch it
 * was minted against, the facts revision the caller last observed (if the
 * transport tracks one), and its fingerprint. Created only at dispatch —
 * never speculatively. */
export interface Attempt {
	draft: Readonly<IntentDraft>;
	epoch: ObservationEpoch;
	facts_revision: number | null;
	fingerprint: string;
}

/** Deep-copies and deep-freezes `draft` before stamping it: an `Attempt`
 * must stay a faithful record of what was dispatched even if the caller goes
 * on to mutate the `IntentDraft` object it built the attempt from (e.g. a
 * reused form-state object). Mutating the original after this call changes
 * neither `attempt.draft` nor `attempt.fingerprint`. */
export function createAttempt(
	draft: IntentDraft,
	epoch: ObservationEpoch,
	factsRevision: number | null,
): Attempt {
	const snapshot = deepFreeze(structuredClone(draft));
	return {
		draft: snapshot,
		epoch,
		facts_revision: factsRevision,
		fingerprint: attemptFingerprint(snapshot, epoch),
	};
}

function deepFreeze<T>(value: T): T {
	if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const key of Object.keys(value as Record<string, unknown>)) {
			deepFreeze((value as Record<string, unknown>)[key]);
		}
	}
	return value;
}

/**
 * `"sent"` means dispatched with no receipt observed yet; `"unobserved"`
 * means dispatch happened but no receipt or confirmation was ever observed
 * (distinct from `"sent"`'s in-flight moment — e.g. a transport that gives up
 * watching before a reply arrives). `"accepted"` means admission only — the
 * server took the attempt onto its resolution path, not that it succeeded.
 * `"rejected"` means a CONFIRMED server admission rejection only — never a
 * local/transport-side guess — and is the only status a `RejectionLedger`
 * records. `"pending"` covers an accepted attempt whose consequence or reply
 * is still outstanding.
 */
export type Outcome =
	| { status: "sent" }
	| { status: "unobserved" }
	| { status: "accepted" }
	| { status: "rejected"; reason?: string; failure_detail?: string }
	| { status: "pending" }
	| { status: "observed_result"; summary?: string }
	| { status: "transport_error"; message: string };
