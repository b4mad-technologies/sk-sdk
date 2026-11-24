import type { TraceRow as DbTraceRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asNumber, asString, optNumber, rows, tagString } from "./_helpers";
import { readTraceResponse, type TraceResponse } from "./trace_response";

// `trace` is private (ADR-0120, #915); subscribe + read the per-caller
// `visible_trace` view — a body sees only the traces it has perceived
// (bounded by observer_trace_knowledge). Raw god-view → operator `just sql`.
export const requiredTables: RequiredTables<
	[
		"action_definition_tag",
		"visible_prompt_occurrence",
		"public_metadata_attachment",
		"visible_metadata_attachment",
		"visible_trace",
	]
> = [
	"action_definition_tag",
	"visible_prompt_occurrence",
	"public_metadata_attachment",
	"visible_metadata_attachment",
	"visible_trace",
];
registerReaderManifest({ requiredTables });

export interface TraceRow {
	trace_id: string;
	kind: string;
	location_kind: string;
	location_ref: string;
	payload_json: string;
	payload: unknown;
	response?: TraceResponse;
	inscribed_at: number;
	// decay_rate / decay_bound removed — Item 9 (09-decay-as-condition.md)
	// dissolved these columns into the condition machinery; they no longer
	// appear in the generated trace_table binding.
	expires_at: number | null;
	inscribed_by: string | null;
	visibility: string;
	bundle_id: string;
}

export interface ReadTracesAtOpts {
	kind?: string;
	inscribedBy?: string;
}

export function readTracesAt(
	db: SnapshotDb,
	locationKind: string,
	locationRef: string,
	opts: ReadTracesAtOpts = {},
): TraceRow[] {
	return rows<DbTraceRow>(db, "visible_trace")
		.filter((r) => asString(r.locationKind) === locationKind)
		.filter((r) => asString(r.locationRef) === locationRef)
		.filter((r) => opts.kind === undefined || asString(r.kind) === opts.kind)
		.filter((r) => opts.inscribedBy === undefined || asString(r.inscribedBy) === opts.inscribedBy)
		.map((row) => toTraceRow(row, db))
		.sort(
			(a, b) =>
				a.inscribed_at - b.inscribed_at ||
				a.trace_id.localeCompare(b.trace_id, undefined, { numeric: true }),
		);
}

/**
 * The `n` most recent traces this caller currently perceives, UNFILTERED by
 * location — the location-scoped `readTracesAt` above cannot see an
 * entity-anchored trace (ADR-0095 D-1, e.g. `srd/speak-to`'s addressee
 * anchor) unless the caller already knows which node OR which entity to ask
 * for. `visible_trace` (module header) is already per-caller bounded by
 * `observer_trace_knowledge` (ADR-0040) — this is the same "read window,
 * unfiltered" shape `readRecentResourceDeltas` (`resource_deltas.ts`) uses
 * over the sibling `visible_event_resource_delta` view, for the same reason:
 * a caller diffing this view call-to-call (shared tool runtime's push-events.ts)
 * wants a bounded recent slice, not a full unbounded scan every cycle, and
 * has no single location to scope to.
 */
export function readRecentTraces(db: SnapshotDb, n: number): TraceRow[] {
	if (n <= 0) return [];
	const all = rows<DbTraceRow>(db, "visible_trace")
		.map((row) => toTraceRow(row, db))
		.sort((a, b) => b.trace_id.localeCompare(a.trace_id, undefined, { numeric: true }));
	return all.slice(0, n);
}

function toTraceRow(r: DbTraceRow, db: SnapshotDb): TraceRow {
	const payloadJson = asString(r.payloadJson);
	const payload = parsePayload(payloadJson);
	const response = readTraceResponse(db, payload);
	const inscribedBy = asString(r.inscribedBy);
	return {
		trace_id: asString(r.traceId),
		kind: asString(r.kind),
		location_kind: asString(r.locationKind),
		location_ref: asString(r.locationRef),
		payload_json: payloadJson,
		payload,
		...(response === undefined ? {} : { response }),
		inscribed_at: asNumber(r.inscribedAt),
		expires_at: optNumber(r.expiresAt) ?? null,
		inscribed_by: inscribedBy === "" ? null : inscribedBy,
		// `trace.visibility` is the `VisibilityClass` tagged enum ({ tag: "Public" }),
		// not a plain string — `asString` would collapse it to "[object Object]"
		// (surfaced by the world-explorer wanderer reading back an inscribed trace).
		visibility: tagString(r.visibility),
		bundle_id: asString(r.bundleId),
	};
}

function parsePayload(raw: string): unknown {
	if (raw.trim() === "") return null;
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
}
