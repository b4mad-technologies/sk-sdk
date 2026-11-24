// Production manifest-apply primitive (sk-0m4.45, ADR-0103 D-2).
// CLI / sk / Pi / elevated seats / test-lab all resolve on the same two
// subscribed signals: a new `manifest_apply_digest` seal (ok) or a new
// `manifest_apply_outcome` verdict row (repeat seal or real MF-APPLY failure).
//
// This module is the production path. `enqueueAndWaitManifestApply` stays
// Result-returning; `applyManifestDeltaOrThrow` unwraps `{ ok: false }` into
// an Error whose message keeps the MF-* code. Optional MF-APPLY-013 in-flight
// retry and `tolerateAlreadyApplied` (MF-APPLY-012) default OFF so existing
// callers are unchanged. Serialization is per caller-owned lane from
// `createManifestApplyLane()` — never a module-global singleton.
//
// test-lab (`applyManifestDelta` / `applyManifestSource` / `runManifestApply`)
// is a consumer of this primitive: throwing wrappers that keep `world.db()` /
// `table()` conveniences and a test-only process-wide lane. Do not import
// test-lab from production hosts.
//
// Happy path has no 60s/120s/240s timeout — a long watchdog fires only when
// neither signal arrives (scheduler dead or a mid-commit wedge).

export const MANIFEST_APPLY_WAIT_TABLES = [
	"manifest_apply_digest",
	"manifest_apply_outcome",
] as const;

/** Derived subscribe set — same whole-table query shape as connect()/subscribeReaders. */
export const MANIFEST_APPLY_WAIT_QUERIES = MANIFEST_APPLY_WAIT_TABLES.map(
	// ci-allow(raw-sql): derived wait-subscribe for the drain seal/outcome tables (sk-0m4.45), same query shape as connect()
	(table) => `SELECT * FROM ${table}`,
);

/** Long bound for a dead scheduler / leftover mid-commit wedge. Not the happy path. */
export const MANIFEST_APPLY_WATCHDOG_MS = 15 * 60 * 1000;

const POLL_MIN_MS = 10;
const POLL_MAX_MS = 300;

/** Notify after the subscribed cache mutation is readable. */
export type ManifestApplyUpdateSource = (listener: (table?: string) => void) => () => void;

export type ManifestApplyHandle = { iter(): Iterable<unknown> } | undefined;

export type ManifestApplyVerdict =
	| { status: "pending" }
	| { status: "sealed"; digest?: string }
	| { status: "failed"; code: string; message: string; outcome?: ManifestApplyOutcomeSnap };

export interface ManifestApplyOutcomeSnap {
	/** A new successful outcome seals a repeat apply whose digest already exists. */
	ok?: boolean;
	applyId: string;
	/** Present on server outcome rows; optional for older snapshot adapters. */
	digest?: string;
	code: string;
	message: string;
}

export type ManifestApplyResult =
	| { ok: true; alreadyApplied?: true; digest?: string }
	| { ok: false; detail: string; outcome?: ManifestApplyOutcomeSnap; cause?: unknown };

/** Correlated failure without replacing the original transport/cache exception. */
export class ManifestApplyError extends Error {
	readonly outcome: ManifestApplyOutcomeSnap | undefined;

	constructor(failure: Extract<ManifestApplyResult, { ok: false }>) {
		const correlation =
			failure.outcome === undefined
				? ""
				: ` [apply_id=${failure.outcome.applyId}, digest=${failure.outcome.digest ?? "unknown"}]`;
		super(`${failure.detail}${correlation}`, { cause: failure.cause });
		this.name = "ManifestApplyError";
		this.outcome = failure.outcome;
	}
}

export interface ManifestApplyLane {
	run<T>(task: () => Promise<T>): Promise<T>;
}

export interface ManifestApplyDeltaPort {
	digestHandle: ManifestApplyHandle;
	outcomeHandle: ManifestApplyHandle;
	enqueueDelta: (toml: string) => Promise<void>;
}

export interface EnqueueAndWaitManifestApplyArgs {
	digestHandle: ManifestApplyHandle;
	outcomeHandle: ManifestApplyHandle;
	enqueue: () => Promise<void>;
	label?: string;
	/** Cache observation; when supplied, no polling timer is used. */
	onUpdate?: ManifestApplyUpdateSource;
	/// Bounded retry on MF-APPLY-013 (in-flight collision). Off when omitted
	/// (one attempt). `attempts` is the total try count, matching test-lab's
	/// historical 30× loop. The digest/outcome snapshot is retaken on EVERY
	/// attempt so an unrelated apply sealing between tries is never misread
	/// as this call's success (ADR-0103 D-2).
	retryInFlight?: { attempts: number; delayMs: number };
	/// MF-APPLY-012 / "already applied" resolves `{ ok: true, alreadyApplied: true }`
	/// instead of `{ ok: false }`. Off by default.
	tolerateAlreadyApplied?: boolean;
	/// Caller-owned serialization. Two lanes do not block each other; one lane
	/// does. Never a module-global singleton.
	lane?: ManifestApplyLane;
}

export function verdictFromManifestApplySnapshots(input: {
	beforeDigests: ReadonlySet<string>;
	currentDigests: Iterable<string>;
	beforeOutcomeIds: ReadonlySet<string>;
	currentOutcomes: Iterable<ManifestApplyOutcomeSnap>;
}): ManifestApplyVerdict {
	for (const digest of input.currentDigests) {
		if (!input.beforeDigests.has(digest)) return { status: "sealed", digest };
	}
	for (const outcome of input.currentOutcomes) {
		if (!input.beforeOutcomeIds.has(outcome.applyId)) {
			if (outcome.ok === true) return { status: "sealed", digest: outcome.digest };
			return { status: "failed", code: outcome.code, message: outcome.message, outcome };
		}
	}
	return { status: "pending" };
}

export function formatManifestApplyFailure(code: string, message: string): string {
	return `${code}: ${message}`;
}

export function isManifestAlreadyApplied(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("MF-APPLY-012") || message.includes("already applied");
}

export function isManifestApplyInFlight(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("MANIFEST_APPLY_IN_FLIGHT") || message.includes("MF-APPLY-013");
}

/** Caller-owned single-flight lane. Failures do not stall later callers. */
export function createManifestApplyLane(): ManifestApplyLane {
	let tail: Promise<void> = Promise.resolve();
	return {
		run<T>(task: () => Promise<T>): Promise<T> {
			const run = tail.then(task);
			tail = run.then(
				() => undefined,
				() => undefined,
			);
			return run;
		},
	};
}

export async function waitForManifestApplyVerdict(
	read: () => ManifestApplyVerdict,
	options: { watchdogMs?: number; label?: string; onUpdate?: ManifestApplyUpdateSource } = {},
): Promise<Exclude<ManifestApplyVerdict, { status: "pending" }>> {
	const watchdogMs = options.watchdogMs ?? MANIFEST_APPLY_WATCHDOG_MS;
	const deadline = Date.now() + watchdogMs;
	if (options.onUpdate !== undefined) {
		const observed: { verdict: ManifestApplyVerdict } = { verdict: { status: "pending" } };
		await waitForApplySignal(
			options.onUpdate,
			deadline,
			options.label,
			() => {
				observed.verdict = read();
				return observed.verdict.status !== "pending";
			},
			watchdogMs,
		);
		if (observed.verdict.status === "pending")
			throw new Error("Apply observation resolved without a verdict");
		return observed.verdict;
	}
	let pollMs = POLL_MIN_MS;
	for (;;) {
		const verdict = read();
		if (verdict.status !== "pending") return verdict;
		if (Date.now() >= deadline) {
			const label = options.label === undefined ? "" : `${options.label}: `;
			throw new Error(
				`${label}manifest apply watchdog: no seal or failure outcome within ${watchdogMs}ms`,
			);
		}
		await new Promise<void>((resolve) => setTimeout(resolve, pollMs));
		pollMs = Math.min(pollMs * 2, POLL_MAX_MS);
	}
}

function rowString(row: Record<string, unknown>, camel: string, snake: string): string {
	return String(row[camel] ?? row[snake] ?? "");
}

export function digestSetFromHandle(handle: ManifestApplyHandle): Set<string> {
	const out = new Set<string>();
	if (handle === undefined) return out;
	for (const raw of handle.iter()) {
		const row = raw as Record<string, unknown>;
		const digest = rowString(row, "manifestDigest", "manifest_digest");
		if (digest.length > 0) out.add(digest);
	}
	return out;
}

export function outcomesFromHandle(handle: ManifestApplyHandle): ManifestApplyOutcomeSnap[] {
	if (handle === undefined) return [];
	return Array.from(handle.iter(), (raw) => {
		const row = raw as Record<string, unknown>;
		return {
			...(typeof row.ok === "boolean" ? { ok: row.ok } : {}),
			applyId: rowString(row, "applyId", "apply_id"),
			digest: rowString(row, "digest", "digest"),
			code: rowString(row, "code", "code"),
			message: rowString(row, "message", "message"),
		};
	});
}

export function subscribeManifestApplyWait(subscriptionBuilder: {
	onApplied(cb: () => void): {
		onError(cb: () => void): { subscribe(queries: string[]): unknown };
	};
}): Promise<void> {
	return new Promise((resolve, reject) => {
		subscriptionBuilder
			.onApplied(() => resolve())
			.onError(() => reject(new Error("manifest apply wait subscribe failed")))
			.subscribe([...MANIFEST_APPLY_WAIT_QUERIES]);
	});
}

function errorDetail(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function sleep(ms: number): Promise<void> {
	if (ms <= 0) return Promise.resolve();
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshotBefore(args: EnqueueAndWaitManifestApplyArgs): {
	beforeDigests: Set<string>;
	beforeOutcomeIds: Set<string>;
} {
	return {
		beforeDigests: digestSetFromHandle(args.digestHandle),
		beforeOutcomeIds: new Set(outcomesFromHandle(args.outcomeHandle).map((row) => row.applyId)),
	};
}

function tolerateAlreadyAppliedResult(
	args: EnqueueAndWaitManifestApplyArgs,
	error: unknown,
): ManifestApplyResult | undefined {
	if (args.tolerateAlreadyApplied === true && isManifestAlreadyApplied(error)) {
		return { ok: true, alreadyApplied: true };
	}
	return undefined;
}

async function enqueueAndWaitManifestApplyOnce(
	args: EnqueueAndWaitManifestApplyArgs,
): Promise<ManifestApplyResult> {
	const maxAttempts = Math.max(1, args.retryInFlight?.attempts ?? 1);
	const delayMs = args.retryInFlight?.delayMs ?? 0;
	for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
		// Retake on EVERY attempt (ADR-0103 D-2): an unrelated seal landing
		// between tries must not be attributed to this call.
		const { beforeDigests, beforeOutcomeIds } = snapshotBefore(args);
		try {
			await args.enqueue();
		} catch (err) {
			const tolerated = tolerateAlreadyAppliedResult(args, err);
			if (tolerated !== undefined) return tolerated;
			if (isManifestApplyInFlight(err) && attempt < maxAttempts) {
				await sleep(delayMs);
				continue;
			}
			return { ok: false, detail: errorDetail(err), cause: err };
		}
		try {
			const verdict = await waitForManifestApplyVerdict(
				() =>
					verdictFromManifestApplySnapshots({
						beforeDigests,
						currentDigests: digestSetFromHandle(args.digestHandle),
						beforeOutcomeIds,
						currentOutcomes: outcomesFromHandle(args.outcomeHandle),
					}),
				{ label: args.label, onUpdate: args.onUpdate },
			);
			if (verdict.status === "failed") {
				const detail = formatManifestApplyFailure(verdict.code, verdict.message);
				const tolerated = tolerateAlreadyAppliedResult(args, detail);
				if (tolerated !== undefined) return tolerated;
				return { ok: false, detail, outcome: verdict.outcome };
			}
			return { ok: true, digest: verdict.status === "sealed" ? verdict.digest : undefined };
		} catch (err) {
			return { ok: false, detail: errorDetail(err), cause: err };
		}
	}
	return { ok: false, detail: "manifest apply exhausted in-flight retries" };
}

export async function enqueueAndWaitManifestApply(
	args: EnqueueAndWaitManifestApplyArgs,
): Promise<ManifestApplyResult> {
	if (args.lane === undefined) return enqueueAndWaitManifestApplyOnce(args);
	return args.lane.run(() => enqueueAndWaitManifestApplyOnce(args));
}

/** Throwing convenience over `enqueueAndWaitManifestApply`. Keeps the MF-* code. */
export async function applyManifestDeltaOrThrow(
	port: ManifestApplyDeltaPort,
	toml: string,
	opts: Omit<EnqueueAndWaitManifestApplyArgs, "digestHandle" | "outcomeHandle" | "enqueue"> = {},
): Promise<void> {
	const result = await enqueueAndWaitManifestApply({
		digestHandle: port.digestHandle,
		outcomeHandle: port.outcomeHandle,
		enqueue: () => port.enqueueDelta(toml),
		label: opts.label,
		onUpdate: opts.onUpdate,
		retryInFlight: opts.retryInFlight,
		tolerateAlreadyApplied: opts.tolerateAlreadyApplied,
		lane: opts.lane,
	});
	if (!result.ok) {
		throw new ManifestApplyError(result);
	}
}

const APPLY_WAIT_TABLES: ReadonlySet<string> = new Set([
	...MANIFEST_APPLY_WAIT_TABLES,
	// Generated binding accessors (installRefreshHooks prefers snake_case, but
	// some cache wrappers emit camelCase).
	"manifestApplyDigest",
	"manifestApplyOutcome",
	// connection.ts CACHE_APPLIED_MARKER — onApplied after a snapshot apply.
	"__applied",
]);

export interface ManifestApplyObserveArgs extends EnqueueAndWaitManifestApplyArgs {
	/** Post-mutation cache updates. Silent cache changes violate this port's contract. */
	onUpdate: ManifestApplyUpdateSource;
}

/** Fire-and-forget ticket (sk-jay0.7.15.15). `result` settles with the
 * ManifestApplyResult; `done` unwraps `{ ok: false }` into a thrown Error
 * (same as `applyManifestDeltaOrThrow`). Returning the ticket is sync —
 * await `done`/`result` only when the caller needs the seal. */
export interface ManifestApplyTicket {
	readonly result: Promise<ManifestApplyResult>;
	readonly done: Promise<void>;
}

function isApplyWaitTable(table: string | undefined): boolean {
	return table === undefined || APPLY_WAIT_TABLES.has(table);
}

function waitForApplySignal(
	onUpdate: ManifestApplyUpdateSource,
	deadlineMs: number,
	label: string | undefined,
	pred?: () => boolean,
	watchdogMs = MANIFEST_APPLY_WATCHDOG_MS,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;
		let unsub: (() => void) | undefined;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const finish = (failure?: { cause: unknown }): void => {
			if (settled) return;
			settled = true;
			if (timer !== undefined) clearTimeout(timer);
			unsub?.();
			if (failure === undefined) resolve();
			else reject(failure.cause);
		};
		const check = (): void => {
			if (settled) return;
			try {
				if (pred === undefined || pred()) finish();
			} catch (error) {
				finish({ cause: error });
			}
		};
		try {
			// Subscribe before reading; an update during registration cannot be lost.
			// Generated table callbacks observe the already-mutated SDK cache.
			unsub = onUpdate((table) => {
				if (isApplyWaitTable(table)) check();
			});
			if (settled) {
				unsub();
				return;
			}
			if (pred !== undefined) check();
			if (settled) return;
			const remain = Math.max(0, deadlineMs - Date.now());
			timer = setTimeout(() => {
				const prefix = label === undefined ? "" : `${label}: `;
				finish({
					cause: new Error(
						`${prefix}manifest apply watchdog: no seal or failure outcome within ${watchdogMs}ms`,
					),
				});
			}, remain);
		} catch (error) {
			finish({ cause: error });
		}
	});
}

function ticketFromResult(result: Promise<ManifestApplyResult>): ManifestApplyTicket {
	const done = result.then((value) => {
		if (!value.ok) throw new ManifestApplyError(value);
	});
	return { result, done };
}

async function enqueueManifestApplyObservedOnce(
	args: ManifestApplyObserveArgs,
): Promise<ManifestApplyResult> {
	const deadlineMs = Date.now() + MANIFEST_APPLY_WATCHDOG_MS;
	for (;;) {
		if (Date.now() >= deadlineMs) {
			const label = args.label === undefined ? "" : `${args.label}: `;
			return {
				ok: false,
				detail: `${label}manifest apply watchdog: no seal or failure outcome within ${MANIFEST_APPLY_WATCHDOG_MS}ms`,
			};
		}
		const { beforeDigests, beforeOutcomeIds } = snapshotBefore(args);
		try {
			await args.enqueue();
		} catch (err) {
			const tolerated = tolerateAlreadyAppliedResult(args, err);
			if (tolerated !== undefined) return tolerated;
			if (isManifestApplyInFlight(err)) {
				try {
					await waitForApplySignal(args.onUpdate, deadlineMs, args.label);
				} catch (waitErr) {
					return { ok: false, detail: errorDetail(waitErr), cause: waitErr };
				}
				continue;
			}
			return { ok: false, detail: errorDetail(err), cause: err };
		}
		try {
			let verdict = verdictFromManifestApplySnapshots({
				beforeDigests,
				currentDigests: digestSetFromHandle(args.digestHandle),
				beforeOutcomeIds,
				currentOutcomes: outcomesFromHandle(args.outcomeHandle),
			});
			while (verdict.status === "pending") {
				await waitForApplySignal(args.onUpdate, deadlineMs, args.label, () => {
					verdict = verdictFromManifestApplySnapshots({
						beforeDigests,
						currentDigests: digestSetFromHandle(args.digestHandle),
						beforeOutcomeIds,
						currentOutcomes: outcomesFromHandle(args.outcomeHandle),
					});
					return verdict.status !== "pending";
				});
			}
			if (verdict.status === "failed") {
				const detail = formatManifestApplyFailure(verdict.code, verdict.message);
				if (isManifestApplyInFlight(detail)) {
					continue;
				}
				const tolerated = tolerateAlreadyAppliedResult(args, detail);
				if (tolerated !== undefined) return tolerated;
				return { ok: false, detail, outcome: verdict.outcome };
			}
			return { ok: true, digest: verdict.status === "sealed" ? verdict.digest : undefined };
		} catch (err) {
			return { ok: false, detail: errorDetail(err), cause: err };
		}
	}
}

/** Enqueue a manifest apply and return immediately. The ticket settles when
 * `verdictFromManifestApplySnapshots` sees a new digest or outcome on the
 * caller's update stream. MF-APPLY-013 re-enqueues from that observer, never
 * from a sleep loop. */
export function enqueueManifestApplyObserved(args: ManifestApplyObserveArgs): ManifestApplyTicket {
	const result =
		args.lane === undefined
			? enqueueManifestApplyObservedOnce(args)
			: args.lane.run(() => enqueueManifestApplyObservedOnce(args));
	return ticketFromResult(result);
}
