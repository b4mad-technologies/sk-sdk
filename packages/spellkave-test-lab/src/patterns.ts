/**
 * The live-test patterns (live-test-pattern-library design D-3/D-4/D-9;
 * capability spec `live-test-patterns`).
 *
 * Every pattern owns time and waits for the test:
 * - it counts its action as one step of the per-test budget (`steps.ts`);
 * - it calls `syncConnection` on each observing connection after the action,
 *   so the test asserts on the subscribed cache without any further wait;
 * - it reports the change as a diff over the scene's own rows only.
 *
 * `act` is a callback: a test-lab reducer helper or a PLAYER-facing tool call.
 * An `act` that advances the clock or a turn (`manualTick`, `advanceTurn`,
 * `castAction`, `advanceSessionTurn`) makes the test a final-phase test; the
 * step helpers refuse to run in a lane file without `// live-phase: final`.
 */

import { SenderError } from "spacetimedb";
import {
	type ApplyManifestOptions,
	applyManifestDelta,
	manualTicks,
	pauseTicks,
	resumeTicks,
	syncConnection,
	type TestWorld,
} from "./live";
import type { Scene, SceneHero, SceneSnapshot } from "./scene";
import { countedStep, MAX_STEPS, requireFinalPhase } from "./steps";

// --- verdict and diff -----------------------------------------------------

/**
 * The outcome of an action. `ok: false` is a server refusal only: the reducer
 * returned an error (`SenderError`), directly or as the cause of a wrapper
 * such as `ManifestApplyError`. A refusal the action reports as data (a
 * PLAYER tool's `rejected` status) is an `ok: true` value.
 */
export type Verdict<T> = { ok: true; value: T } | { ok: false; error: Error };

export interface EntityChange {
	entityId: bigint;
	/** Place node before / after; `null` when the entity had no location. */
	node: { before: string | null; after: string | null };
}

/**
 * The scene's change, as the scene owner sees it: entities added, removed and
 * moved. Object states are not included (see `SceneReads.snapshot`).
 */

export interface SceneDiff {
	/** Entities of the scene that exist after the action but not before. */
	added: bigint[];
	/** Entities of the scene that existed before the action but not after. */
	removed: bigint[];
	changed: EntityChange[];
	/** True when nothing in the scene changed. */
	readonly empty: boolean;
}

export function diffSnapshots(before: SceneSnapshot, after: SceneSnapshot): SceneDiff {
	const added: bigint[] = [];
	const removed: bigint[] = [];
	const changed: EntityChange[] = [];
	for (const [id, now] of after) {
		const was = before.get(id);
		if (was === undefined) {
			added.push(BigInt(id));
			continue;
		}
		if (was.node !== now.node) {
			changed.push({ entityId: BigInt(id), node: { before: was.node, after: now.node } });
		}
	}
	for (const id of before.keys()) if (!after.has(id)) removed.push(BigInt(id));
	return {
		added,
		removed,
		changed,
		get empty() {
			return added.length === 0 && removed.length === 0 && changed.length === 0;
		},
	};
}

/** True when `error`, or an error in its `cause` chain, is a reducer's own refusal. */
export function isServerRefusal(error: unknown): boolean {
	for (let e: unknown = error, depth = 0; e instanceof Error && depth < 8; depth++) {
		if (e instanceof SenderError) return true;
		e = e.cause;
	}
	return false;
}

/**
 * Run the action and turn only a server refusal into a verdict. Every other
 * failure (a harness guard such as the step budget or the final-phase check,
 * a lost connection, a sync timeout, an `InternalError` from a panicking
 * reducer) is rethrown, so it fails the test instead of passing as "refused".
 */
async function settle<T>(act: () => Promise<T>): Promise<Verdict<T>> {
	try {
		return { ok: true, value: await act() };
	} catch (cause) {
		if (!isServerRefusal(cause)) throw cause;
		return { ok: false, error: cause as Error };
	}
}

/** The scene's owner connection plus every hero connection: everything a scene test reads. */
export function sceneObservers(scene: Scene): TestWorld[] {
	return [scene.owner, ...scene.heroes().map((hero) => hero.world)];
}

async function syncAll(worlds: readonly TestWorld[]): Promise<void> {
	for (const world of new Set(worlds)) await syncConnection(world);
}

// --- probe ----------------------------------------------------------------

export interface ProbeOptions<T> {
	scene: Scene;
	/** The one action under test. A rejected promise is a refusal verdict, not a test error. */
	act: () => Promise<T>;
	/** Connections to sync before returning. Default: the scene owner and every hero. */
	observe?: readonly TestWorld[];
}

export interface ProbeResult<T> {
	verdict: Verdict<T>;
	diff: SceneDiff;
}

/** Build-act-sync-assert in one step: run `act` once and return its verdict and the scene diff. */
export async function probe<T>(options: ProbeOptions<T>): Promise<ProbeResult<T>> {
	const { scene, act } = options;
	await syncAll([scene.owner]);
	const before = scene.reads.snapshot();
	const verdict = await countedStep("act", 1, () => settle(act));
	await syncAll(options.observe ?? sceneObservers(scene));
	return { verdict, diff: diffSnapshots(before, scene.reads.snapshot()) };
}

// --- luckTolerant ---------------------------------------------------------

export interface RecordedDraw {
	/** Provenance row that recorded the roll. */
	provenanceId: string;
	/** Every physical draw value, in draw order. */
	faces: number[];
	/** The effective face: max under advantage, min under disadvantage, else the one draw. */
	face: number;
	/** `advantage`, `disadvantage` or `none`, from the row's roll-bias template. */
	bias: "advantage" | "disadvantage" | "none";
	selectedTemplateIds: string[];
}

export interface LuckTolerantOptions<T> extends ProbeOptions<T> {
	/** The acting hero; its connection reads its own `visible_evaluation_provenance` rows. */
	actor: SceneHero;
	/** Assert that verdict and diff are consistent with the recorded draw. */
	expect: (draw: RecordedDraw, verdict: Verdict<T>, diff: SceneDiff) => void;
}

interface ProvenanceLike {
	provenanceId?: string;
	provenance_id?: string;
	subjectId?: string;
	subject_id?: string;
	selectedTemplateIds?: unknown;
	selected_template_ids?: unknown;
	stochasticDraws?: unknown;
	stochastic_draws?: unknown;
}

const PROVENANCE_TABLE = "visible_evaluation_provenance";

function provenanceRows(world: TestWorld): ProvenanceLike[] {
	const db = world.db();
	const handle = db.visibleEvaluationProvenance ?? db[PROVENANCE_TABLE];
	return handle === undefined ? [] : ([...handle.iter()] as ProvenanceLike[]);
}

/** Effective d20 face of a provenance row, resolved the way the engine labels roll bias. */
export function recordedDraw(row: {
	provenanceId: string;
	selectedTemplateIds: readonly string[];
	draws: readonly { value: number | bigint }[];
}): RecordedDraw {
	const faces = row.draws.map((draw) => Number(draw.value));
	if (faces.length === 0) {
		throw new Error(`provenance ${row.provenanceId} recorded no stochastic draw`);
	}
	const ids = [...row.selectedTemplateIds];
	if (ids.includes("resolution_roll_bias:advantage")) {
		return {
			provenanceId: row.provenanceId,
			faces,
			face: Math.max(...faces),
			bias: "advantage",
			selectedTemplateIds: ids,
		};
	}
	if (ids.includes("resolution_roll_bias:disadvantage")) {
		return {
			provenanceId: row.provenanceId,
			faces,
			face: Math.min(...faces),
			bias: "disadvantage",
			selectedTemplateIds: ids,
		};
	}
	if (faces.length !== 1) {
		throw new Error(
			`provenance ${row.provenanceId} carried ${faces.length} draws without a roll-bias label`,
		);
	}
	return {
		provenanceId: row.provenanceId,
		faces,
		face: faces[0] as number,
		bias: "none",
		selectedTemplateIds: ids,
	};
}

/**
 * A probe whose assertion is a function of the recorded roll. It never seeds
 * the RNG: it reads the draw the engine recorded for the action and hands it to
 * `expect` with the verdict and the diff. A branch claim (crit, natural 1) is
 * proven offline against the resolver, not here.
 */
export async function luckTolerant<T>(options: LuckTolerantOptions<T>): Promise<ProbeResult<T>> {
	const { actor } = options;
	await actor.world.subscribeReaders([{ requiredTables: [PROVENANCE_TABLE] }]);
	await syncConnection(actor.world);
	const seen = new Set(
		provenanceRows(actor.world).map((r) => String(r.provenanceId ?? r.provenance_id)),
	);
	const observe = options.observe ?? sceneObservers(options.scene);
	const result = await probe({ ...options, observe: [...observe, actor.world] });
	const subject = String(actor.actorId);
	const fresh = provenanceRows(actor.world).filter((r) => {
		const id = String(r.provenanceId ?? r.provenance_id);
		const draws = (r.stochasticDraws ?? r.stochastic_draws) as unknown[] | undefined;
		return (
			!seen.has(id) &&
			String(r.subjectId ?? r.subject_id) === subject &&
			Array.isArray(draws) &&
			draws.length > 0
		);
	});
	if (fresh.length !== 1) {
		throw new Error(
			`luckTolerant: expected exactly one new rolled provenance row for actor ${subject}, found ${fresh.length}`,
		);
	}
	const row = fresh[0] as ProvenanceLike;
	const draw = recordedDraw({
		provenanceId: String(row.provenanceId ?? row.provenance_id),
		selectedTemplateIds: ((row.selectedTemplateIds ?? row.selected_template_ids) as string[]) ?? [],
		draws: (row.stochasticDraws ?? row.stochastic_draws) as { value: number | bigint }[],
	});
	options.expect(draw, result.verdict, result.diff);
	return result;
}

// --- timeStep -------------------------------------------------------------

export interface TimeStepOptions {
	scene: Scene;
	/** Connection that holds the timekeeper authority (usually the scene owner). */
	clock?: TestWorld;
	/** Ticks to advance, at most ten. */
	ticks: number;
	observe?: readonly TestWorld[];
	/**
	 * Called with the clock paused and the observers synced: once before the
	 * ticks (`before`) and once after them (`after`). Read clock-dependent rows
	 * here; after the pattern returns the tick loop runs again.
	 */
	onPaused?: (phase: "before" | "after") => void;
}

/**
 * Final-phase only: pause the world clock, advance `ticks` manual ticks, sync,
 * and return the scene diff. The clock is resumed afterwards. The file must
 * carry `// live-phase: final`.
 */
export async function timeStep(options: TimeStepOptions): Promise<SceneDiff> {
	requireFinalPhase("timeStep");
	if (!Number.isInteger(options.ticks) || options.ticks < 1 || options.ticks > MAX_STEPS) {
		throw new RangeError(`timeStep: ticks must be 1..${MAX_STEPS}, got ${options.ticks}`);
	}
	const { scene } = options;
	const clock = options.clock ?? scene.owner;
	const observers = options.observe ?? sceneObservers(scene);
	await pauseTicks(clock);
	try {
		await syncAll([scene.owner, ...observers]);
		const before = scene.reads.snapshot();
		options.onPaused?.("before");
		await manualTicks(clock, { ticks: options.ticks });
		await syncAll([scene.owner, ...observers]);
		options.onPaused?.("after");
		return diffSnapshots(before, scene.reads.snapshot());
	} finally {
		await resumeTicks(clock);
	}
}

// --- applyRoundTrip -------------------------------------------------------

export interface ApplyRoundTripOptions {
	scene: Scene;
	/** A manifest delta whose rows sit under the scene prefix. */
	delta: string;
	/** Apply the same delta a second time and prove the scene is unchanged. */
	reapply?: boolean;
	applyOptions?: ApplyManifestOptions;
}

export interface ApplyRoundTripResult {
	/** Scene change of the first apply. */
	diff: SceneDiff;
	/** Scene change of the second apply; empty when the delta is idempotent. Only with `reapply`. */
	reapplyDiff?: SceneDiff;
}

/** Apply a scene-scoped manifest delta, read it back, and optionally prove idempotence. */
export async function applyRoundTrip(
	options: ApplyRoundTripOptions,
): Promise<ApplyRoundTripResult> {
	const { scene, delta } = options;
	if (!delta.includes(scene.prefix)) {
		throw new Error(`applyRoundTrip: delta does not name scene prefix '${scene.prefix}'`);
	}
	const applyOnce = async (): Promise<SceneDiff> => {
		await syncAll([scene.owner]);
		const before = scene.reads.snapshot();
		await countedStep("act", 1, () =>
			applyManifestDelta(scene.owner, delta, {
				tolerateAlreadyApplied: true,
				...options.applyOptions,
			}),
		);
		await syncAll([scene.owner]);
		return diffSnapshots(before, scene.reads.snapshot());
	};
	const diff = await applyOnce();
	if (options.reapply !== true) return { diff };
	return { diff, reapplyDiff: await applyOnce() };
}

// --- agentStep ------------------------------------------------------------

/** An external async actor (NPC host, LLM seat, spawned process) that can be stepped explicitly. */
export interface SteppableActor {
	/** Run exactly one decision cycle and resolve when its dispatch returned. */
	step(): Promise<void>;
}

export interface AgentStepOptions {
	/** Number of actor steps; each counts against the step budget. */
	steps?: number;
	/** Connections to sync after the last step. */
	observe?: readonly TestWorld[];
}

/**
 * Step an external actor explicitly instead of waiting for it by wall-clock.
 * Each step counts against the budget; there is no timeout of its own.
 */
export async function agentStep(
	actor: SteppableActor,
	options: AgentStepOptions = {},
): Promise<void> {
	const steps = options.steps ?? 1;
	if (!Number.isInteger(steps) || steps < 1) {
		throw new RangeError(`agentStep: steps must be a positive integer, got ${steps}`);
	}
	for (let i = 0; i < steps; i++) await countedStep("agentStep", 1, () => actor.step());
	await syncAll(options.observe ?? []);
}
