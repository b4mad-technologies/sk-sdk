// Read-first SDK reader surface for evaluation_provenance rows.
//
// Reads from the live SpacetimeDB subscription cache. Never calls reducers.
// Sorted ascending by createdAtTick (chronological) since provenanceId is a
// string key not suitable for numeric ordering.
//
// iter() output is camelCase per the generated bindings; no snake_case fallback.

import type { EvaluationProvenanceRow } from "./binding_rows";
import type { ProvenanceRingBuffer } from "./core/provenance_buffer";
import type { TickIntervalEstimator } from "./core/tick_cadence";
import { currentWorldTickOrZero } from "./core/world_time";
import { type RequiredTables, registerReaderManifest, type SnapshotDb } from "./reader-manifest";

export const requiredTables: RequiredTables<["visible_evaluation_provenance"]> = [
	"visible_evaluation_provenance",
];
registerReaderManifest({ requiredTables });

export interface ReducerAttemptResult<T> {
	status:
		| "success"
		| "rejected"
		| "unobserved_timeout"
		| "unobserved_no_provenance"
		| "unobservable";
	snapshot: T | null;
	provenance: ProvenanceRow | null;
	lagWarning: boolean;
	observedAtTick: bigint;
}

export interface ReducerAttemptTelemetrySpan {
	addEvent(name: string, attributes?: Record<string, unknown>): void;
	end(status?: "unset" | "ok" | "error"): void;
}

/** Structural telemetry port: hosts may supply OpenTelemetry without making the
 * browser-safe SDK depend on one concrete OTel implementation. */
export interface ReducerAttemptTelemetry {
	startSpan(name: string, attributes?: Record<string, unknown>): ReducerAttemptTelemetrySpan;
}

/** Host-supplied reducer context admitted to shared telemetry. This list must
 * equal `WORLD_ACTOR_CORRELATION_ATTRIBUTE_KEYS` in
 * `@spellkave/agent-observability` (from which the exporter allowlist is
 * derived). Enforced by `src/__tests__/reducer-attempt-telemetry-allowlist.test.ts`.
 * Arbitrary host objects and content-bearing values are deliberately not accepted. */
export const REDUCER_ATTEMPT_SAFE_TELEMETRY_ATTRIBUTES = [
	"spellkave.reducer",
	"spellkave.actor_id",
	"spellkave.action_id",
	"spellkave.target_ref",
	"spellkave.correlation_id",
	"spellkave.world_slug",
	"spellkave.cause_kind",
	"spellkave.cause_id",
] as const;

export type ReducerAttemptSafeTelemetryAttribute =
	(typeof REDUCER_ATTEMPT_SAFE_TELEMETRY_ATTRIBUTES)[number];
export type ReducerAttemptTelemetryAttributes = Partial<
	Record<ReducerAttemptSafeTelemetryAttribute, string | number | boolean>
>;

const MAX_TELEMETRY_STRING_LENGTH = 256;

export function safeReducerAttemptTelemetryAttributes(
	value: Readonly<Record<string, unknown>> | undefined,
): ReducerAttemptTelemetryAttributes {
	if (value === undefined) return {};
	const safe: ReducerAttemptTelemetryAttributes = {};
	for (const key of REDUCER_ATTEMPT_SAFE_TELEMETRY_ATTRIBUTES) {
		const candidate = value[key];
		if (typeof candidate === "string") safe[key] = candidate.slice(0, MAX_TELEMETRY_STRING_LENGTH);
		else if (typeof candidate === "boolean") safe[key] = candidate;
		else if (typeof candidate === "number" && Number.isFinite(candidate)) safe[key] = candidate;
	}
	return safe;
}

export interface ObserveReducerAttemptOpts<T> {
	db: () => SnapshotDb;
	subjectId: string;
	invoke: () => Promise<void>;
	successPredicate: (db: SnapshotDb) => boolean;
	collectSnapshot: (db: SnapshotDb) => T | null;
	timeoutMs: number;
	pollMs: number;
	tickEstimator?: TickIntervalEstimator;
	/** Treat a post-baseline successful provenance row as success even without a state predicate. */
	successOnProvenance?: boolean;
	/** Optional: "this attempt has reached a terminal outcome that is NOT
	 * success, stop waiting". Returning true leaves the observation loop immediately;
	 * the normal post-loop classification then runs, and the CALLER decides
	 * what the outcome means.
	 *
	 * WHY (feat/travel-eta, 2026-08-18). `r_move` promotes an over-reach move
	 * into a session that walks the actor one step per world tick, so the
	 * success predicate ("actor is at the destination") cannot come true for
	 * many ticks — every long journey burned the FULL `timeoutMs` before being
	 * reported, and reported as a non-arrival at that. With 17 journeys in one
	 * recording that was ~34s of waiting for an answer the world had settled
	 * on immediately. The move wrapper passes "is a travel session open for
	 * this actor" here and turns the early exit into `status: "travelling"`. */
	// The second argument lets receipt observers wait for the invoke acknowledgement
	// before classifying a settled call as unobservable.
	settledEarly?: (db: SnapshotDb, invokeSettled: boolean) => boolean;
	provenanceBuffer?: ProvenanceRingBuffer;
	/** Attribute only rows emitted by this reducer. Subject and baseline alone
	 * cannot distinguish its verdict from ambient or other-action evaluations. */
	provenancePredicate?: (row: ProvenanceRow) => boolean;
	telemetry?: ReducerAttemptTelemetry;
	/** Safe, low-cardinality reducer context; never include credentials or raw args. */
	telemetryAttributes?: ReducerAttemptTelemetryAttributes;
}

/** Wake on the asserting cache's delivered mutations or the reducer result.
 * Snapshot-only hosts keep their polling fallback. Never add subscriptions. */
function attemptWakeups(snapshot: SnapshotDb) {
	let revision = 0;
	let pending: (() => void) | undefined;
	const notify = () => {
		revision++;
		pending?.();
	};
	const detach: (() => void)[] = [];
	const tables = [...new Set(Object.values(snapshot).filter((table) => table !== undefined))];
	const eventDriven =
		tables.length > 0 &&
		tables.every(
			(table) =>
				table.onInsert &&
				table.removeOnInsert &&
				table.onDelete &&
				table.removeOnDelete &&
				(!table.onUpdate || table.removeOnUpdate),
		);
	if (eventDriven)
		for (const table of tables) {
			for (const [add, remove] of [
				[table.onInsert, table.removeOnInsert],
				[table.onUpdate, table.removeOnUpdate],
				[table.onDelete, table.removeOnDelete],
			] as const) {
				if (add && remove) {
					add.call(table, notify);
					detach.push(() => remove.call(table, notify));
				}
			}
		}
	return {
		notify,
		get revision() {
			return revision;
		},
		wait(seen: number, remaining: number, pollMs: number): Promise<void> {
			if (seen !== revision) return Promise.resolve();
			return new Promise((resolve) => {
				const finish = () => {
					clearTimeout(timer);
					if (pending === finish) pending = undefined;
					resolve();
				};
				const timer = setTimeout(
					finish,
					Math.max(0, eventDriven ? remaining : Math.min(pollMs, remaining)),
				);
				pending = finish;
				if (seen !== revision) finish();
			});
		},
		close() {
			for (const remove of detach) remove();
			pending?.();
		},
	};
}

/**
 * Generic reducer-attempt observer. Captures a provenance baseline before
 * invoke(), observes cache/result callbacks until successPredicate is satisfied, and returns a
 * structured result with the outcome and nearest provenance row.
 *
 * Contains ZERO argument validation — caller payload goes 1:1 to invoke().
 */
export async function observeReducerAttempt<T>(
	opts: ObserveReducerAttemptOpts<T>,
): Promise<ReducerAttemptResult<T>> {
	const {
		db,
		subjectId,
		invoke,
		successPredicate,
		collectSnapshot,
		timeoutMs,
		pollMs,
		tickEstimator,
		successOnProvenance,
		settledEarly,
		provenanceBuffer,
		provenancePredicate,
		telemetry,
		telemetryAttributes,
	} = opts;

	// Baseline only the subject's own rows. Both later reads filter by
	// subjectId, so unrelated row IDs would never be matched against the
	// baseline — keeping them just inflates the Set for no benefit.
	function readAttemptProvenance(excludeIds?: ReadonlySet<string>): ProvenanceRow[] {
		const rows = readRecentProvenance(db(), { subjectId, excludeIds }, provenanceBuffer);
		return provenancePredicate ? rows.filter(provenancePredicate) : rows;
	}
	const baselineIds = new Set(readAttemptProvenance().map((row) => row.id));
	let span: ReducerAttemptTelemetrySpan | undefined;
	try {
		span = telemetry?.startSpan("spellkave.reducer_attempt", {
			"spellkave.subject_id": subjectId,
			"spellkave.timeout_ms": timeoutMs,
			"spellkave.poll_ms": pollMs,
			"spellkave.success_on_provenance": successOnProvenance === true,
			...safeReducerAttemptTelemetryAttributes(telemetryAttributes),
		});
	} catch {
		// Observability is optional and must never change a reducer outcome.
	}
	function addSpanEvent(name: string, attributes?: Record<string, unknown>): void {
		try {
			span?.addEvent(name, attributes);
		} catch {
			// A failing projection loses only its own diagnostic event.
		}
	}
	function endSpan(status: "ok" | "error"): void {
		try {
			span?.end(status);
		} catch {
			// A failing projection never changes the authoritative result.
		}
	}
	addSpanEvent("baseline_captured", { "spellkave.baseline_count": baselineIds.size });
	let invokeFailed = false;
	let invokeSettled = false;
	let pollCount = 0;
	let lastObservedProvenanceId: string | undefined;

	function recordProvenance(row: ProvenanceRow | null): void {
		if (row === null || row.id === lastObservedProvenanceId) return;
		lastObservedProvenanceId = row.id;
		addSpanEvent("provenance_observed", {
			"spellkave.provenance_id": row.id,
			"spellkave.provenance_status": row.status,
			"spellkave.provenance_kind": row.kind,
			...(row.failure_kind === ""
				? {}
				: { "spellkave.failure_class": row.failure_kind.slice(0, MAX_TELEMETRY_STRING_LENGTH) }),
		});
	}

	function complete(result: ReducerAttemptResult<T>): ReducerAttemptResult<T> {
		recordProvenance(result.provenance);
		addSpanEvent("classified", {
			"spellkave.result_status": result.status,
			"spellkave.poll_count": pollCount,
			"spellkave.invoke_settled": invokeSettled,
			"spellkave.invoke_failed": invokeFailed,
			"spellkave.lag_warning": result.lagWarning,
		});
		if (
			result.status !== "success" &&
			result.provenance &&
			isSuccessStatus(result.provenance.status)
		) {
			addSpanEvent("classification_mismatch", {
				"spellkave.result_status": result.status,
				"spellkave.provenance_status": result.provenance.status,
			});
		}
		endSpan(result.status === "success" ? "ok" : "error");
		return result;
	}
	const wakeups = attemptWakeups(db());
	try {
		// `Promise.resolve().then(invoke)` shields against `invoke()` that throws
		// synchronously instead of returning a rejected Promise — either path now
		// lands in the reject handler and surfaces as `invokeFailed = true`.
		void Promise.resolve()
			.then(() => {
				addSpanEvent("reducer_invoked");
				return invoke();
			})
			.catch(() => {
				invokeFailed = true;
			})
			.finally(() => {
				invokeSettled = true;
				wakeups.notify();
			});

		const endAt = Date.now() + timeoutMs;
		while (Date.now() <= endAt) {
			const seen = wakeups.revision;
			pollCount += 1;
			if (invokeFailed) {
				const rows = readAttemptProvenance(baselineIds);
				return complete({
					status: "rejected",
					snapshot: collectSnapshot(db()),
					provenance: rows[rows.length - 1] ?? null,
					lagWarning: false,
					observedAtTick: currentWorldTickOrZero(db()),
				});
			}

			const rows = readAttemptProvenance(baselineIds);
			const latest = rows[rows.length - 1] ?? null;
			recordProvenance(latest);
			if (latest && isFailureStatus(latest.status)) {
				return complete({
					status: "rejected",
					snapshot: collectSnapshot(db()),
					provenance: latest,
					lagWarning: false,
					observedAtTick: currentWorldTickOrZero(db()),
				});
			}

			if (successPredicate(db())) {
				return complete({
					status: "success",
					snapshot: collectSnapshot(db()),
					provenance: latest,
					lagWarning: false,
					observedAtTick: currentWorldTickOrZero(db()),
				});
			}
			if (successOnProvenance === true && latest && isSuccessStatus(latest.status)) {
				return complete({
					status: "success",
					snapshot: collectSnapshot(db()),
					provenance: latest,
					lagWarning: false,
					observedAtTick: currentWorldTickOrZero(db()),
				});
			}
			// Checked LAST, after every success path: an outcome that could still
			// resolve to success must be given that chance first. Only once this
			// check has failed to see success do we ask whether the world has
			// nonetheless settled on something terminal.
			if (settledEarly?.(db(), invokeSettled) === true) {
				addSpanEvent("settled_early");
				break;
			}
			if (Date.now() >= endAt) break;
			await wakeups.wait(seen, endAt - Date.now(), pollMs);
		}

		// Post-loop classification follows main's contract:
		// - `unobserved_timeout` ≡ the reducer call did not settle before the
		//   deadline (caller should retry / wait longer).
		// - `unobservable` ≡ the reducer call returned, but no provenance rows were
		//   visible to this identity within the observation window.
		// - `unobserved_no_provenance` ≡ rows arrived but none reached a
		//   success/failure status (caller has signal but not resolution).
		// A `Failed`/`RolledBack` row is already caught inside the loop via
		// `isFailureStatus`; if execution reaches here there is no terminal row.
		const rows = readAttemptProvenance(baselineIds);
		const latest = rows[rows.length - 1] ?? null;
		recordProvenance(latest);
		if (latest && isFailureStatus(latest.status)) {
			return complete({
				status: "rejected",
				snapshot: collectSnapshot(db()),
				provenance: latest,
				lagWarning: false,
				observedAtTick: currentWorldTickOrZero(db()),
			});
		}
		if (successOnProvenance === true && latest && isSuccessStatus(latest.status)) {
			return complete({
				status: "success",
				snapshot: collectSnapshot(db()),
				provenance: latest,
				lagWarning: false,
				observedAtTick: currentWorldTickOrZero(db()),
			});
		}
		const lagWarning = computeLagWarning(tickEstimator);
		return complete({
			status:
				rows.length > 0
					? "unobserved_no_provenance"
					: invokeSettled
						? "unobservable"
						: "unobserved_timeout",
			snapshot: collectSnapshot(db()),
			provenance: latest,
			lagWarning,
			observedAtTick: currentWorldTickOrZero(db()),
		});
	} finally {
		wakeups.close();
	}
}

// Canonical PascalCase variants come from the generated binding for
// `EvaluationProvenanceStatus` (Started | Succeeded | Failed | RolledBack).
// The lowercase compare is defensive against any future runtime that
// serialises the tag in a different case; if `Started` ever needs
// separate handling, lift it into a third branch instead of folding it
// here.
function isFailureStatus(status: string): boolean {
	const normalised = status.toLowerCase();
	return normalised === "failed" || normalised === "failure" || normalised === "rolledback";
}

function isSuccessStatus(status: string): boolean {
	const normalised = status.toLowerCase();
	return normalised === "succeeded" || normalised === "success";
}

function computeLagWarning(estimator: TickIntervalEstimator | undefined): boolean {
	if (!estimator) return false;
	const lastMs = estimator.lastObservedAtMs();
	if (lastMs === null) return false;
	return Date.now() - lastMs > 2 * estimator.estimateMs();
}

export interface ProvenanceRow {
	id: string;
	provenance_id?: string;
	kind: string;
	status: string;
	subject_id: string;
	failure_kind: string;
	failure_detail: string;
	selected_template_ids: string[];
	created_at_tick: bigint;
	bundle_id: string;
}

export interface ProvenanceWatermark {
	created_at_tick: bigint;
	id: string;
}

function tagString(v: unknown): string {
	if (typeof v === "string") return v;
	// SpacetimeDB tagged-enum shape: { tag: "VariantName", value?: ... }
	if (v && typeof v === "object") {
		const tag = (v as { tag?: unknown }).tag;
		if (typeof tag === "string") return tag;
	}
	return String(v ?? "");
}

function toRow(r: EvaluationProvenanceRow): ProvenanceRow {
	const arr = (v: unknown): string[] => {
		if (!Array.isArray(v)) return [];
		return v.map((x) => String(x));
	};
	return {
		id: r.provenanceId,
		provenance_id: r.provenanceId,
		kind: tagString(r.kind),
		status: tagString(r.status),
		subject_id: r.subjectId,
		failure_kind: r.failureKind,
		failure_detail: r.failureDetail,
		selected_template_ids: arr(r.selectedTemplateIds),
		created_at_tick: r.createdAtTick,
		bundle_id: r.bundleId,
	};
}

function iterRows(db: SnapshotDb): ProvenanceRow[] {
	const handle =
		db.visible_evaluation_provenance ?? db.visibleEvaluationProvenance ?? db.evaluation_provenance;
	if (!handle) return [];
	const rows: ProvenanceRow[] = [];
	for (const raw of handle.iter()) {
		rows.push(toRow(raw as unknown as EvaluationProvenanceRow));
	}
	return rows;
}

/**
 * Returns the latest provenance row watermark in the cache, or null if empty.
 * When `buffer` is provided, scans the ring buffer instead of iterating the
 * full DB cache (O(buffer-cap) rather than O(all cached rows)).
 */
export function maxProvenanceWatermark(
	db: SnapshotDb,
	buffer?: ProvenanceRingBuffer,
): ProvenanceWatermark | null {
	if (buffer) return buffer.latestWatermark();
	let max: ProvenanceWatermark | null = null;
	for (const row of iterRows(db)) {
		const watermark = { created_at_tick: row.created_at_tick, id: row.id };
		if (!max || compareWatermark(watermark, max) > 0) max = watermark;
	}
	return max;
}

export interface ReadRecentProvenanceOpts {
	/** Filter to rows whose subject_id matches. */
	subjectId?: string;
	/** Return only rows newer than this createdAtTick/id watermark. */
	since?: ProvenanceWatermark | null;
	/** Exclude exact row IDs already known to the caller. */
	excludeIds?: ReadonlySet<string>;
}

/**
 * Returns evaluation_provenance rows sorted ascending by createdAtTick.
 * When `buffer` is provided, scans the ring buffer (O(buffer-cap)).
 * Without buffer, iterates the full DB cache.
 */
export function readRecentProvenance(
	db: SnapshotDb,
	opts: ReadRecentProvenanceOpts = {},
	buffer?: ProvenanceRingBuffer,
): ProvenanceRow[] {
	let rows = buffer
		? opts.subjectId !== undefined
			? buffer.forSubject(opts.subjectId)
			: allBufferRows(buffer)
		: iterRows(db);

	if (opts.since !== undefined && opts.since !== null) {
		const baseline = opts.since;
		rows = rows.filter(
			(r) => compareWatermark({ created_at_tick: r.created_at_tick, id: r.id }, baseline) > 0,
		);
	}

	if (opts.excludeIds !== undefined) {
		const excluded = opts.excludeIds;
		rows = rows.filter((r) => !excluded.has(r.id));
	}

	if (opts.subjectId !== undefined) {
		const subjectId = opts.subjectId;
		rows = rows.filter((r) => r.subject_id === subjectId);
	}

	rows.sort((a, b) => {
		if (a.created_at_tick < b.created_at_tick) return -1;
		if (a.created_at_tick > b.created_at_tick) return 1;
		return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
	});

	return rows;
}

function allBufferRows(buffer: ProvenanceRingBuffer): ProvenanceRow[] {
	const result: ProvenanceRow[] = [];
	for (const subjectId of buffer.subjectIds()) {
		result.push(...buffer.forSubject(subjectId));
	}
	return result;
}

function compareWatermark(a: ProvenanceWatermark, b: ProvenanceWatermark): number {
	if (a.created_at_tick < b.created_at_tick) return -1;
	if (a.created_at_tick > b.created_at_tick) return 1;
	return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
