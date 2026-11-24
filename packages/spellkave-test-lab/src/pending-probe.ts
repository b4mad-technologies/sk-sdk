import { deepStrictEqual, strictEqual } from "node:assert";
import type {
	EvaluationProvenanceRow,
	PendingStochasticResolutionRow,
	SnapshotDb,
} from "@spellkave/sdk";

/** Use actor-authorized projections on the canonical connection, including after reconnect. */
export const PENDING_PROBE_READER_MANIFEST = {
	requiredTables: ["visible_pending_stochastic_resolution", "visible_evaluation_provenance"],
} as const;

function requiredRows<T>(db: SnapshotDb, table: string): T[] {
	const handle = db[table];
	if (handle === undefined) throw new Error(`Pending probe requires subscribed table ${table}`);
	return Array.from(handle.iter()) as T[];
}

/** Copy the complete frozen payload before a caller-owned preserve publish. */
export function capturePendingResolution(
	db: SnapshotDb,
	pendingId: bigint,
): PendingStochasticResolutionRow {
	const matches = requiredRows<PendingStochasticResolutionRow>(
		db,
		"visible_pending_stochastic_resolution",
	).filter((row) => row.pendingId === pendingId);
	strictEqual(matches.length, 1, `Expected one visible pending payload for ${pendingId}`);
	const row = matches[0];
	if (row === undefined || row.draws.length === 0 || row.originalProvenanceId.length === 0)
		throw new Error(`Pending ${pendingId} must contain a frozen draw and original provenance`);
	return structuredClone(row);
}

/** Full-row equality includes commit tail and frozen facts, not just die faces. */
export function assertPendingResolutionPreserved(
	before: PendingStochasticResolutionRow,
	db: SnapshotDb,
): void {
	deepStrictEqual(
		capturePendingResolution(db, before.pendingId),
		before,
		`Pending ${before.pendingId} changed across preserve publish`,
	);
}

/** Verify the explicit decline's observed completion; this does not wait or dispatch. */
export function assertPendingResolutionDeclined(
	before: PendingStochasticResolutionRow,
	db: SnapshotDb,
): EvaluationProvenanceRow {
	const pending = requiredRows<PendingStochasticResolutionRow>(
		db,
		"visible_pending_stochastic_resolution",
	);
	strictEqual(
		pending.some((row) => row.pendingId === before.pendingId),
		false,
		"Pending remains",
	);
	const provenance = requiredRows<EvaluationProvenanceRow>(db, "visible_evaluation_provenance");
	const originals = provenance.filter((row) => row.provenanceId === before.originalProvenanceId);
	strictEqual(originals.length, 1, "Expected the original provenance in the observed scope");
	deepStrictEqual(
		originals[0]?.terminalEventIds,
		[],
		"Original must not duplicate terminal effects",
	);
	const continuations = provenance.filter((row) =>
		row.selectedTemplateIds.includes(`intervention_original:${before.originalProvenanceId}`),
	);
	strictEqual(continuations.length, 1, "Expected exactly one continuation in the observed scope");
	const continuation = continuations[0];
	if (continuation === undefined) throw new Error("Continuation missing");
	strictEqual(continuation.selectedTemplateIds.includes("intervention_declined"), true);
	deepStrictEqual(continuation.stochasticDraws, before.draws, "Continuation rerolled frozen draws");
	strictEqual(continuation.terminalEventIds.length, 1, "Expected exactly one terminal event");
	strictEqual(continuation.failureKind, "", "Continuation failed");
	return continuation;
}
