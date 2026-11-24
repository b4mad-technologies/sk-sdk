// ADR-0140/ADR-0141 shared interaction vocabulary: WorldFacts -> IntentDraft
// -> Attempt -> Outcome. Both the Play web app and NPC brains compose ONE
// fallible direct attempt from disclosed facts; the server alone decides
// admission ("disclosure is not eligibility"). This module is PURE: no DB, no
// network, no ranking, no eligibility evaluation, no second resolver. Direct
// manipulation still goes through `composeFactoredManipulationAttempt`.

export { attemptFingerprint } from "./fingerprint";
export type {
	AttemptKind,
	CommunicateDraft,
	ContextGenerationInput,
	DraftCheck,
	DraftMissingPart,
	IntentDraft,
	IntentInputValues,
	IntentSemanticContext,
	ManipulateDraft,
	ObservationEpoch,
} from "./intent";
export {
	checkDraft,
	inputValuesToText,
	nextContextGeneration,
	observationEpoch,
	utteranceFromInputValues,
} from "./intent";
export type { Attempt, Outcome } from "./outcome";
export { createAttempt } from "./outcome";
export type { LastRejection, RejectionLedger } from "./rejection_ledger";
export { createRejectionLedger } from "./rejection_ledger";
