import type { ObjectStateRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { rows, tagString } from "./_helpers";

export const requiredTables: RequiredTables<["visible_object_state"]> = ["visible_object_state"];
registerReaderManifest({ requiredTables });

export interface ObjectStateRef {
	targetKind: string;
	targetId: string | number | bigint;
	stateId: string;
}

export interface AwaitObjectStateAppliedOpts extends ObjectStateRef {
	previousValue?: number | bigint;
	expectedValue?: number | bigint;
	delta?: number | bigint;
	timeoutMs?: number;
	pollMs?: number;
}

const DEFAULT_TIMEOUT_MS = 2_000;
const DEFAULT_POLL_MS = 40;

export function readObjectStateInt(db: SnapshotDb, ref: ObjectStateRef): bigint | null {
	const row = rows<ObjectStateRow>(db, "visible_object_state").find(
		(candidate) =>
			targetKindMatches(candidate.targetKind, ref.targetKind) &&
			String(candidate.targetId) === String(ref.targetId) &&
			candidate.stateId === ref.stateId,
	);
	if (!row) return null;
	return dslIntValue(row.value);
}

export interface EntityIntState {
	stateId: string;
	value: bigint;
}

/**
 * All integer `object_state` pools for one entity, sorted by `stateId`.
 *
 * Generic over state vocabulary — the panel layer renders whatever pools an
 * entity carries (`srd/hp`, `srd/ac`, a modder's `myworld/stamina`) without the
 * kernel's content-neutrality (ADR-0021) leaking an SRD assumption into the SDK.
 * Non-int values (bool/text/outcome) are skipped: `dslIntValue` returns null and
 * they fall out of the list.
 */
export function readEntityIntStates(
	db: SnapshotDb,
	targetId: string | number | bigint,
): EntityIntState[] {
	const wanted = String(targetId);
	return rows<ObjectStateRow>(db, "visible_object_state")
		.filter((row) => targetKindMatches(row.targetKind, "entity") && String(row.targetId) === wanted)
		.map((row) => ({ stateId: String(row.stateId), value: dslIntValue(row.value) }))
		.filter((state): state is EntityIntState => state.value !== null)
		.sort((a, b) => (a.stateId < b.stateId ? -1 : a.stateId > b.stateId ? 1 : 0));
}

export async function awaitObjectStateApplied(
	db: () => SnapshotDb,
	opts: AwaitObjectStateAppliedOpts,
): Promise<bigint | null> {
	const timeoutMs = Math.max(1, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const pollMs = Math.max(1, opts.pollMs ?? DEFAULT_POLL_MS);
	const expected = expectedIntValue(opts);
	const previous = opts.previousValue === undefined ? undefined : BigInt(opts.previousValue);
	const deadline = Date.now() + timeoutMs;

	let latest = readObjectStateInt(db(), opts);
	while (Date.now() <= deadline) {
		if (matches(latest, expected, previous)) return latest;
		// Yield to the JS SDK's event loop so pending websocket updates can refresh the cache.
		await new Promise((resolve) => setTimeout(resolve, pollMs));
		latest = readObjectStateInt(db(), opts);
	}

	return matches(latest, expected, previous) ? latest : null;
}

function expectedIntValue(opts: AwaitObjectStateAppliedOpts): bigint | undefined {
	if (opts.expectedValue !== undefined) return BigInt(opts.expectedValue);
	if (opts.previousValue !== undefined && opts.delta !== undefined) {
		return BigInt(opts.previousValue) + BigInt(opts.delta);
	}
	return undefined;
}

function matches(
	value: bigint | null,
	expected: bigint | undefined,
	previous: bigint | undefined,
): boolean {
	if (value === null) return false;
	if (expected !== undefined) return value === expected;
	if (previous !== undefined) return value !== previous;
	return true;
}

function targetKindMatches(actual: unknown, expected: string): boolean {
	return normalizeTargetKind(String(actual)) === normalizeTargetKind(expected);
}

function normalizeTargetKind(kind: string): string {
	return kind.replace(/_/g, "").toLowerCase();
}

function dslIntValue(value: unknown): bigint | null {
	if (typeof value === "bigint") return value;
	if (typeof value === "number") return BigInt(value);
	if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
	if (!value || typeof value !== "object") return null;

	const record = value as Record<string, unknown>;
	if (tagString(record.tag) === "Int") return dslIntValue(record.value);
	if ("Int" in record) return dslIntValue(record.Int);
	return null;
}
