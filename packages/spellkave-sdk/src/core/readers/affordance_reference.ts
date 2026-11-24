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
const AFFORDANCE_REFERENCE_NAMESPACE = "ui.affordance_reference";

/**
 * Reads exact, world-authored definition references for affordance templates.
 * The attachment is deliberately optional: actions remain usable when a world
 * has no reference card, while consumers never infer one from display prose.
 */
export function readAffordanceDefinitionRefs(db: SnapshotDb): Map<string, string> {
	const out = new Map<string, string>();
	for (const row of readMetadataAttachmentRows(db)) {
		if (asString(row.namespace) !== AFFORDANCE_REFERENCE_NAMESPACE) continue;
		if (asString(row.targetKind) !== AFFORDANCE_TEMPLATE_TARGET_KIND) continue;
		if (asString(row.audience) !== PUBLIC_AUDIENCE) continue;
		let payload: unknown;
		try {
			payload = JSON.parse(asString(row.payloadJson));
		} catch {
			continue;
		}
		if (typeof payload !== "object" || payload === null) continue;
		const reference = (payload as Record<string, unknown>).definition_ref;
		if (typeof reference !== "string" || reference.trim().length === 0) continue;
		out.set(asString(row.targetRef), reference);
	}
	return out;
}
