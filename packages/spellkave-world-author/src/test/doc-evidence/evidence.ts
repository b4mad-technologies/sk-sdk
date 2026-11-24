// Ported from packages/spellkave-srd-cc/src/test/srd-coverage/evidence.ts
// (authoring-doc-evidence D1) — thin declaration wrappers, unchanged shape.

import { it } from "vitest";

import {
	type DocEvidenceIdentity,
	type DocNotApplicableIdentity,
	docEvidenceName,
	docNotApplicableName,
} from "./protocol";

/**
 * Register one executable doc-evidence claim. The test declaration is the
 * inventory: the generated `ledger/claims.md` discovers this name from
 * Vitest's actual result tree rather than reading a parallel checklist.
 */
export function docEvidence(
	evidence: DocEvidenceIdentity,
	assertion: () => void | Promise<void>,
	timeout?: number,
): void {
	it(docEvidenceName(evidence), assertion, timeout);
}

/** Register an executable logical-RED claim without failing while the known gap remains. */
export function docGap(
	evidence: DocEvidenceIdentity,
	assertion: () => void | Promise<void>,
	timeout?: number,
): void {
	it.fails(docEvidenceName(evidence), assertion, timeout);
}

/** Record an explicit, justified exception — a doc claim this axis does not apply to. */
export function docNotApplicable(evidence: DocNotApplicableIdentity): void {
	it.skip(docNotApplicableName(evidence), () => undefined);
}
