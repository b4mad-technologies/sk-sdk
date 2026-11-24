import type { ActorSpatialLocationRow, TraceRow as DbTraceRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import type { EntityRef } from "../ids";
import { asNumber, asString, optNumber, resolveEntityId, rows, tagString } from "./_helpers";
import { readTraceResponse, type TraceResponse } from "./trace_response";

export const requiredTables: RequiredTables<
	[
		"visible_actor_spatial_location",
		"visible_manifest_authored_entity",
		"visible_manifest_authored_entity_coverage",
		"visible_trace",
		"action_definition_tag",
		"visible_prompt_occurrence",
		"public_metadata_attachment",
		"visible_metadata_attachment",
	]
> = [
	"visible_actor_spatial_location",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"visible_trace",
	"action_definition_tag",
	"visible_prompt_occurrence",
	"public_metadata_attachment",
	"visible_metadata_attachment",
];
registerReaderManifest({ requiredTables });

export interface TraceQueryEntry {
	trace_id: string;
	kind: string;
	location_kind: string;
	location_ref: string;
	payload_json: string;
	payload: unknown;
	response?: TraceResponse;
	inscribed_at: number;
	expires_at: number | null;
	inscribed_by: string | null;
	visibility: string;
	bundle_id: string;
}

export interface CurrentTraceProjection {
	actor_entity_id: string;
	current_node_id: string;
	entries: TraceQueryEntry[];
}

export interface ReadCurrentTraceProjectionOptions {
	kind?: string;
	kindPrefix?: string;
	inscribedBy?: string;
	visibility?: string;
}

export function readCurrentTraceProjection(
	db: SnapshotDb,
	actorId: EntityRef,
	options: ReadCurrentTraceProjectionOptions = {},
): CurrentTraceProjection | null {
	const entityId = resolveEntityId(db, actorId);
	if (entityId === undefined) return null;
	const location = rows<ActorSpatialLocationRow>(db, "visible_actor_spatial_location").find(
		(row) => String(row.entityId) === String(entityId),
	);
	if (location === undefined) return null;
	const currentNodeId = asString(location.placeNodeId);
	const entries = rows<DbTraceRow>(db, "visible_trace")
		.filter((row) => asString(row.locationKind) === "place_node")
		.filter((row) => asString(row.locationRef) === currentNodeId)
		.map((row) => toTraceQueryEntry(row, db))
		.filter((row) => options.kind === undefined || row.kind === options.kind)
		.filter((row) => options.kindPrefix === undefined || row.kind.startsWith(options.kindPrefix))
		.filter((row) => options.inscribedBy === undefined || row.inscribed_by === options.inscribedBy)
		.filter((row) => options.visibility === undefined || row.visibility === options.visibility)
		// Trace IDs are u64 decimal strings. Numeric collation preserves their
		// order at equal ticks without rounding through JavaScript numbers.
		.sort(
			(a, b) =>
				a.inscribed_at - b.inscribed_at ||
				a.trace_id.localeCompare(b.trace_id, undefined, { numeric: true }),
		);
	return { actor_entity_id: String(entityId), current_node_id: currentNodeId, entries };
}

function toTraceQueryEntry(row: DbTraceRow, db: SnapshotDb): TraceQueryEntry {
	const payloadJson = asString(row.payloadJson);
	const payload = parsePayload(payloadJson);
	const response = readTraceResponse(db, payload);
	const inscribedBy = asString(row.inscribedBy);
	return {
		trace_id: asString(row.traceId),
		kind: asString(row.kind),
		location_kind: asString(row.locationKind),
		location_ref: asString(row.locationRef),
		payload_json: payloadJson,
		payload,
		...(response === undefined ? {} : { response }),
		inscribed_at: asNumber(row.inscribedAt),
		expires_at: optNumber(row.expiresAt) ?? null,
		inscribed_by: inscribedBy === "" ? null : inscribedBy,
		visibility: tagString(row.visibility),
		bundle_id: asString(row.bundleId),
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
