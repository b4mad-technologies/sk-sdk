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
const AFFORDANCE_TEMPLATE_TARGET_KIND = "affordance_template";
const AFFORDANCE_GROUP_NAMESPACE = "ui.affordance_group";

/** Reader-owned payload schema for `ui.affordance_group` (ADR-0073 G-2, T4c
 * tool-UX decision log): `{"group": "combat"}` is the whole contract; anything
 * else is malformed and the row is skipped. */
function parseGroupPayload(payloadJson: unknown): string | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(asString(payloadJson));
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null) return undefined;
	const { group } = parsed as Record<string, unknown>;
	if (typeof group !== "string" || group.length === 0) return undefined;
	return group;
}

/**
 * ADR-0073 `ui.affordance_group` membership (T4c,
 * `packages/spellkave-srd-cc/ledger/designs/tool-ux-decision-log.md`): which
 * `affordance_template` (by `template_id`, matching an `AffordanceRow`'s
 * `derived_by_template_id`) belongs to which bundle-authored UI group (e.g.
 * "combat"). Unlike `readSurfaceMembership`'s single-slot membership, a
 * template MAY carry more than one group attachment (different bundles, or a
 * future multi-group template), so this returns every group per target_ref
 * rather than resolving one winner. Filters to `public`-audience rows only:
 * `visible_metadata_attachment` (ADR-0130 D-5) can carry non-public rows this
 * caller is admitted to (visibility-class relations like `hidden`/`internal`,
 * the strict `owned` relation, or capability audiences), so a PLAYER-facing
 * reader must not trust "present in the union" to mean "public" — the
 * explicit check stays load-bearing even post-ADR-0130.
 *
 * No group vocabulary lives here — the reader is generic over whatever
 * string an authoring bundle attaches; group-name knowledge (e.g. "combat")
 * lives entirely in the authoring generator, per the tool-UX consumer maxim.
 */
export function readAffordanceGroupMembership(db: SnapshotDb): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const row of readMetadataAttachmentRows(db)) {
		if (asString(row.namespace) !== AFFORDANCE_GROUP_NAMESPACE) continue;
		if (asString(row.targetKind) !== AFFORDANCE_TEMPLATE_TARGET_KIND) continue;
		if (asString(row.audience) !== PUBLIC_AUDIENCE) continue;
		const group = parseGroupPayload(row.payloadJson);
		if (group === undefined) continue;
		const targetRef = asString(row.targetRef);
		const set = out.get(targetRef) ?? new Set<string>();
		set.add(group);
		out.set(targetRef, set);
	}
	return out;
}
