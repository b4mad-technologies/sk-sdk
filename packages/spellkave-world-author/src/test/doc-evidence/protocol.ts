// Ported from packages/spellkave-srd-cc/src/test/srd-coverage/protocol.ts
// (authoring-doc-evidence D1) — same identity-in-test-name / round-trip-parse
// shape, generalized authoring axes. srd-cc keeps its own machinery untouched.

import type { DocEvidenceState } from "../../scenario-guidance";
export type { DocEvidenceState } from "../../scenario-guidance";

export const DOC_EVIDENCE_PREFIX = "[doc-evidence:";

/**
 * Proof-tier vocabulary (design D2). This axis answers "what kind of world
 * does proving this claim need" and reuses the `srd-evidence-authoring`
 * vocabulary verbatim. It is explicitly INDEPENDENT of ADR-0080's T0-T4 CI
 * tiers and must not be conflated with them — a `live-preseeded` claim can
 * still run in a fast CI lane, and an `offline` claim is not automatically
 * "T0".
 */
export type DocEvidenceTier = "offline" | "live-preseeded" | "live-self-seeding";

export interface DocEvidenceIdentity {
	/**
	 * docs/ filename stem, exactly as `packages/spellkave-world-author/src/corpus.ts`
	 * keys it (`PROSE_DOCS[].id`) — check the corpus and `docs/` before
	 * inventing a new id.
	 */
	doc: string;
	claim: string;
	tier: DocEvidenceTier;
}

export interface DocNotApplicableIdentity extends Omit<DocEvidenceIdentity, "claim"> {
	reason: string;
}

export interface DocEvidenceResult extends DocEvidenceIdentity {
	testFile: string;
	testLine?: number;
	state: DocEvidenceState;
}

const TIER_PATTERN = "offline|live-preseeded|live-self-seeding";

function assertMarkerSafe(value: string, label: string): void {
	if (value.includes("]")) throw new Error(`${label} must not contain ']'.`);
	if (value.includes(" :: ")) throw new Error(`${label} must not contain ' :: '.`);
}

export function docEvidenceName(evidence: DocEvidenceIdentity): string {
	assertMarkerSafe(evidence.doc, "Doc-evidence doc");
	assertMarkerSafe(evidence.claim, "Doc-evidence claim");
	return `${DOC_EVIDENCE_PREFIX}${evidence.doc}][${evidence.tier}] ${evidence.claim}`;
}

export function docNotApplicableName(evidence: DocNotApplicableIdentity): string {
	assertMarkerSafe(evidence.doc, "Doc-evidence doc");
	assertMarkerSafe(evidence.reason, "Doc-evidence reason");
	return `${DOC_EVIDENCE_PREFIX}${evidence.doc}][${evidence.tier}][n/a] ${evidence.reason}`;
}

export function parseDocEvidenceName(name: string): DocEvidenceIdentity | undefined {
	const match = name.match(
		new RegExp(`^\\[doc-evidence:([^\\]]+)\\]\\[(${TIER_PATTERN})\\] (.+)$`),
	);
	if (!match) return undefined;
	const [, doc, tier, claim] = match;
	if (!doc || !tier || !claim) return undefined;
	return { doc, tier: tier as DocEvidenceTier, claim };
}

/**
 * Parses a not-applicable declaration back into the SAME shape
 * {@link parseDocEvidenceName} returns — the reason text is carried in the
 * `claim` field — so the reporter can treat every declaration uniformly and
 * distinguish the not-applicable state purely from which parser matched.
 */
export function parseDocNotApplicableName(name: string): DocEvidenceIdentity | undefined {
	const match = name.match(
		new RegExp(`^\\[doc-evidence:([^\\]]+)\\]\\[(${TIER_PATTERN})\\]\\[n/a\\] (.+)$`),
	);
	if (!match) return undefined;
	const [, doc, tier, reason] = match;
	if (!doc || !tier || !reason) return undefined;
	return { doc, tier: tier as DocEvidenceTier, claim: reason };
}
