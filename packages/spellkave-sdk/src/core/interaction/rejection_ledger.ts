// ADR-0141 D-6: suppress automatic re-dispatch of the exact rejected attempt
// while the facts a caller holds have not changed. This ledger is the only
// place that memory lives — it is in-memory, unpersisted, and carries no
// timers; a caller resets it explicitly on epoch boundaries via
// `resetEpoch`.
//
// Suppression blocks AUTOMATIC re-dispatch, and an UNCHANGED-SUBMIT
// re-dispatch of the exact rejected candidate (same fingerprint, same facts
// revision), inside the epoch + facts-revision boundary. It is never a
// display filter and never hides other syntax toward the same target: a
// caller may still show the rejected option, offer other actions against the
// same target, or let a person explicitly retry. `rejectionCount` and
// `lastRejection` exist so a caller can keep the draft and its refusal
// explanation on screen as a ranking/history signal, not hide it.

import { attemptFingerprint } from "./fingerprint";
import type { IntentDraft, ObservationEpoch } from "./intent";
import type { Attempt, Outcome } from "./outcome";

interface RejectionEntry {
	/** The `facts_revision` last recorded for this rejection. A later
	 * rejection of the same fingerprint overwrites this, even at a different
	 * revision — suppression always compares against the most recent one. */
	revision: number | null;
	/** All-time count of rejections for this fingerprint in this epoch,
	 * across every revision. A ranking signal only — never used to decide
	 * suppression. */
	count: number;
	reason?: string;
	failure_detail?: string;
}

/** The last recorded refusal for a fingerprint, for display/ranking. */
export interface LastRejection {
	reason?: string;
	failure_detail?: string;
	facts_revision: number | null;
}

export interface RejectionLedger {
	/** Records a `"rejected"` outcome. Every other `Outcome` status —
	 * `"unobserved"` and an accepted miss included — is not a confirmed
	 * server rejection and never enters. */
	record(attempt: Attempt, outcome: Outcome): void;
	/** True iff the same fingerprint was rejected in this epoch and the
	 * recorded `facts_revision` equals `factsRevision` (`null` equals
	 * `null`). Any revision change lifts suppression. */
	isSuppressed(draft: IntentDraft, epoch: ObservationEpoch, factsRevision: number | null): boolean;
	/** All-time rejection count for this fingerprint in this epoch,
	 * regardless of revision. A ranking signal only. */
	rejectionCount(draft: IntentDraft, epoch: ObservationEpoch): number;
	/** The most recently recorded rejection for this fingerprint in this
	 * epoch, or `undefined` if none was recorded. A display/ranking signal —
	 * callers keep showing the draft and this explanation, they do not hide
	 * it. */
	lastRejection(draft: IntentDraft, epoch: ObservationEpoch): LastRejection | undefined;
	/** Drops every recorded rejection for one epoch. */
	resetEpoch(epoch: ObservationEpoch): void;
}

export function createRejectionLedger(): RejectionLedger {
	const byEpoch = new Map<ObservationEpoch, Map<string, RejectionEntry>>();

	function entryFor(draft: IntentDraft, epoch: ObservationEpoch): RejectionEntry | undefined {
		return byEpoch.get(epoch)?.get(attemptFingerprint(draft, epoch));
	}

	return {
		record(attempt, outcome) {
			if (outcome.status !== "rejected") return;
			let entries = byEpoch.get(attempt.epoch);
			if (entries === undefined) {
				entries = new Map();
				byEpoch.set(attempt.epoch, entries);
			}
			const existing = entries.get(attempt.fingerprint);
			entries.set(attempt.fingerprint, {
				revision: attempt.facts_revision,
				count: (existing?.count ?? 0) + 1,
				...(outcome.reason === undefined ? {} : { reason: outcome.reason }),
				...(outcome.failure_detail === undefined ? {} : { failure_detail: outcome.failure_detail }),
			});
		},

		isSuppressed(draft, epoch, factsRevision) {
			const entry = entryFor(draft, epoch);
			return entry !== undefined && entry.revision === factsRevision;
		},

		rejectionCount(draft, epoch) {
			return entryFor(draft, epoch)?.count ?? 0;
		},

		lastRejection(draft, epoch) {
			const entry = entryFor(draft, epoch);
			if (entry === undefined) return undefined;
			return {
				facts_revision: entry.revision,
				...(entry.reason === undefined ? {} : { reason: entry.reason }),
				...(entry.failure_detail === undefined ? {} : { failure_detail: entry.failure_detail }),
			};
		},

		resetEpoch(epoch) {
			byEpoch.delete(epoch);
		},
	};
}
