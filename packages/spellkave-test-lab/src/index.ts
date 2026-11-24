// `@spellkave/test-lab` — the generic live-node TS test harness (ADR-0088
// D-2, openspec/changes/srd-content-package/design.md). Its own package since
// the live-test-pattern-library change (design D-1); it depends on
// `@spellkave/sdk`, and the SDK never imports it, so no production consumer
// picks this up transitively.
//
// Test-lab semantics (ephemeral bundle spawning, forced RNG seed, manual
// scheduler control) are intentionally kept out of the SDK's production
// surface (`connection.ts`, `readers.ts`, `replay.ts`, `provenance.ts`).

export { recordActAsTransport } from "./act-as-capture";
export { actAsFixtureCleanup } from "./act-as-cleanup";
export { actAsCli } from "./act-as-cli";
export { actAsFixture } from "./act-as-fixture";
export { containerContentsFixture } from "./container-contents-fixture";
export { rows as queryTestWorldRows } from "./environment-ownership-fixture";
export * from "./live";
// `luckTolerant` and its draw helpers stay out of the package entry until a
// live proof exists and the operator decides between it and an in-world
// forced-face mechanic (live-test-pattern-library, question 3 of the review).
export {
	type AgentStepOptions,
	type ApplyRoundTripOptions,
	type ApplyRoundTripResult,
	agentStep,
	applyRoundTrip,
	diffSnapshots,
	type EntityChange,
	isServerRefusal,
	type ProbeOptions,
	type ProbeResult,
	probe,
	type SceneDiff,
	type SteppableActor,
	sceneObservers,
	type TimeStepOptions,
	timeStep,
	type Verdict,
} from "./patterns";
export * from "./pending-probe";
export {
	fixture as privilegedActsFixture,
	probeAct as authoredAdmissionProbeAct,
} from "./privileged-acts-fixture";
export * from "./scene";
export {
	beginStepBudget,
	countedStep,
	endStepBudget,
	MAX_STEPS,
	StepBudgetError,
	type StepKind,
	stepCounts,
} from "./steps";
