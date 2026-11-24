import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString } from "./_helpers";
import { readMetadataAttachmentRows } from "./metadata_rows";

export const requiredTables: RequiredTables<
	["public_metadata_attachment", "visible_metadata_attachment"]
> = ["public_metadata_attachment", "visible_metadata_attachment"];
registerReaderManifest({ requiredTables });

const PUBLIC_AUDIENCE = "public";

export interface SurfaceMembership {
	slot: string;
	order: number;
}

/** Reader-owned payload schema for `ui.*` surface-membership namespaces
 * (ADR-0073 G-2: the server never owns namespace payload key schemas — the
 * consuming reader does). `{"slot": "vitals", "order": 10}` is the whole
 * contract; anything else is malformed and the row is skipped. */
function parseMembershipPayload(payloadJson: unknown): SurfaceMembership | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(asString(payloadJson));
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const { slot, order } = parsed as Record<string, unknown>;
	if (typeof slot !== "string" || slot.length === 0) return undefined;
	if (typeof order !== "number" || !Number.isFinite(order)) return undefined;
	return { slot, order };
}

/**
 * ADR-0073 metadata-attachment membership for one `(namespace, target_kind)`
 * pair — e.g. which `resource_definition` rows belong to `ui.self_summary`
 * and at what slot/order (#2119). Union over every `bundle_id`: additive
 * across bundles, matching the attachment upsert identity
 * `(target_kind, target_ref, namespace, bundle_id)` (#1968 G-1). A
 * malformed `payload_json` row (not JSON, not an object, missing/mistyped
 * `slot`/`order`) is skipped rather than thrown — one bad attachment must
 * not break the whole surface. A `target_ref` attached twice (two bundles
 * both claiming the same membership) keeps the LOWEST `order` — deterministic
 * precedence, not "last bundle iterated wins".
 *
 * Filters to `public`-audience rows only: `visible_metadata_attachment`
 * (ADR-0130 D-5) can carry non-public rows this caller is admitted to
 * (visibility-class relations like `hidden`/`internal`, the strict `owned`
 * relation, or capability audiences), so a PLAYER-facing reader must not
 * trust "present in the union" to mean "public" — the explicit check stays
 * load-bearing (ADR-0073 D-2/D-3 — player clients never read non-`public`
 * metadata through this surface).
 */
export function readSurfaceMembership(
	db: SnapshotDb,
	namespace: string,
	targetKind: string,
): Map<string, SurfaceMembership> {
	const out = new Map<string, SurfaceMembership>();
	for (const row of readMetadataAttachmentRows(db)) {
		if (asString(row.namespace) !== namespace) continue;
		if (asString(row.targetKind) !== targetKind) continue;
		if (asString(row.audience) !== PUBLIC_AUDIENCE) continue;
		const membership = parseMembershipPayload(row.payloadJson);
		if (membership === undefined) continue;
		const targetRef = asString(row.targetRef);
		const existing = out.get(targetRef);
		if (existing === undefined || membership.order < existing.order) {
			out.set(targetRef, membership);
		}
	}
	return out;
}
