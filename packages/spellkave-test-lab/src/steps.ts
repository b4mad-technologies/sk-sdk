/**
 * Per-test step budget (live-test-pattern-library design D-2; rule 8 in
 * `.agents/skills/sk-tests/references/principles.md`).
 *
 * A live test makes at most {@link MAX_STEPS} world-advancing steps. Every
 * outermost call of a step helper (`manualTick`, `manualTicks`, `advanceTurn`,
 * `castAction`, `advanceSessionTurn`, `agentStep`) counts. A helper that runs
 * inside another helper does not count again, so one `castAction` is one step
 * although it calls `advanceTurn`. A pattern `act` counts one step if it calls
 * no helper; the helpers it calls count instead, one by one (operator
 * decision of 2026-10-09: a loop inside `act` is not free). The check runs
 * before dispatch: the call that would make step eleven throws and never
 * reaches the server.
 *
 * The counter is off until the test-lab Vitest setup file
 * (`@spellkave/test-lab/vitest-setup`, wired by `liveTestConfig`) starts a test
 * with {@link beginStepBudget}. Packages that have not migrated keep running
 * their long loops unchanged; the smoke lane runs with the counter off.
 *
 * Nesting is tracked with `AsyncLocalStorage`, not a module flag, so two
 * outermost steps awaited concurrently both count.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import { FINAL_PHASE_MARKER } from "./markers";

export { FINAL_PHASE_MARKER } from "./markers";

export const MAX_STEPS = 10;

export type StepKind =
	| "manualTick"
	| "manualTicks"
	| "advanceTurn"
	| "castAction"
	| "advanceSessionTurn"
	| "agentStep"
	| "act";

interface Budget {
	readonly test: string;
	readonly file: string | undefined;
	readonly counts: Map<StepKind, number>;
	total: number;
}

let current: Budget | null = null;

/** What the running code is inside: a counted helper, or a pattern `act`. */
type Frame = { kind: "helper" } | { kind: "act"; reserved: boolean };
const inside = new AsyncLocalStorage<Frame>();

/** Thrown before dispatch when a call would exceed the step budget. */
export class StepBudgetError extends Error {
	constructor(
		readonly test: string,
		readonly counts: Readonly<Record<string, number>>,
		readonly attempted: { kind: StepKind; steps: number },
	) {
		const perKind = Object.entries(counts)
			.map(([kind, n]) => `${kind}=${n}`)
			.join(", ");
		super(
			`step budget exceeded in "${test}": ${attempted.kind} would add ${attempted.steps} ` +
				`step(s) to ${Object.values(counts).reduce((a, b) => a + b, 0)} ` +
				`(limit ${MAX_STEPS}; counted so far: ${perKind || "none"}). Construct the state the ` +
				"test asserts on (scene fixture, manifest delta) instead of playing the world forward, " +
				"or mark a playthrough `// live-lane: smoke`.",
		);
		this.name = "StepBudgetError";
	}
}

/** Start counting for one test case. Called by the test-lab Vitest setup file. */
export function beginStepBudget(test: string, file?: string): void {
	current = { test, file, counts: new Map(), total: 0 };
}

/** Stop counting (between tests, and in the smoke lane). */
export function endStepBudget(): void {
	current = null;
}

/** Steps counted so far in the current test, per kind. Empty when the counter is off. */
export function stepCounts(): Readonly<Record<string, number>> {
	return current === null ? {} : Object.fromEntries(current.counts);
}

/** The test file the counter was started for, if the setup file supplied it. */
export function currentTestFile(): string | undefined {
	return current?.file;
}

/** Whether a budget is active for the running test. */
export function stepBudgetActive(): boolean {
	return current !== null;
}

const finalPhaseFiles = new Map<string, boolean>();

/**
 * Refuse a clock or turn advance outside the serial final phase. Active only
 * while a step budget runs (an opted-in live lane); the check reads the test
 * file the setup file named. A file without `// live-phase: final` would race
 * every parallel test on the shared world clock and `turn_state` row (D-9).
 */
export function requireFinalPhase(kind: string): void {
	const budget = current;
	if (budget === null) return;
	if (budget.file === undefined) {
		throw new Error(`${kind}: the test-lab setup file did not name the test file`);
	}
	let final = finalPhaseFiles.get(budget.file);
	if (final === undefined) {
		final = FINAL_PHASE_MARKER.test(readFileSync(budget.file, "utf8"));
		finalPhaseFiles.set(budget.file, final);
	}
	if (!final) {
		throw new Error(
			`${kind} advances the world clock or a turn, which every parallel test sees; ` +
				`mark ${budget.file} \`// live-phase: final\` so it runs in the serial final phase ` +
				"(or `// lifecycle-proof: <reason>` when the DB itself is the unit under test)",
		);
	}
}

function charge(budget: Budget, kind: StepKind, steps: number): void {
	if (!Number.isInteger(steps) || steps < 1) {
		throw new RangeError(`${kind}: step count must be a positive integer, got ${steps}`);
	}
	if (budget.total + steps > MAX_STEPS) {
		throw new StepBudgetError(budget.test, Object.fromEntries(budget.counts), { kind, steps });
	}
	budget.total += steps;
	budget.counts.set(kind, (budget.counts.get(kind) ?? 0) + steps);
}

function refund(budget: Budget, kind: StepKind, steps: number): void {
	budget.total -= steps;
	const left = (budget.counts.get(kind) ?? 0) - steps;
	if (left > 0) budget.counts.set(kind, left);
	else budget.counts.delete(kind);
}

/**
 * Run `fn` as `steps` world-advancing steps of `kind`, checked and counted
 * before `fn` runs.
 *
 * - Inside a helper, a nested helper only runs `fn` (one `castAction` is one
 *   step).
 * - `kind: "act"` reserves one step for a pattern action. The first helper
 *   step inside it releases that reservation, and from then on each helper
 *   the action calls counts on its own.
 */
export async function countedStep<T>(
	kind: StepKind,
	steps: number,
	fn: () => Promise<T>,
): Promise<T> {
	const frame = inside.getStore();
	if (frame?.kind === "helper") return fn();
	const budget = current;
	if (kind === "act") {
		if (budget !== null) charge(budget, "act", steps);
		return inside.run({ kind: "act", reserved: budget !== null }, fn);
	}
	if (budget !== null) {
		if (frame?.kind === "act" && frame.reserved) {
			frame.reserved = false;
			refund(budget, "act", 1);
		}
		charge(budget, kind, steps);
	}
	return inside.run({ kind: "helper" }, fn);
}
