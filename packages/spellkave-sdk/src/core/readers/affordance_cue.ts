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
const AFFORDANCE_CUE_NAMESPACE = "ui.affordance_cue";

/** A public authoring hint. It ranks or explains a disclosed action, but does
 * not claim eligibility, bind a target, or carry response-contract context. */
export interface AffordanceCue {
	rank?: number;
	hint?: string;
}

function cueFromPayload(payloadJson: unknown): AffordanceCue | undefined {
	let payload: unknown;
	try {
		payload = JSON.parse(asString(payloadJson));
	} catch {
		return undefined;
	}
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const row = payload as Record<string, unknown>;
	const rank =
		typeof row.rank === "number" && Number.isInteger(row.rank) && row.rank >= 0 && row.rank <= 9
			? row.rank
			: undefined;
	const hint = typeof row.hint === "string" && row.hint.trim() !== "" ? row.hint : undefined;
	return rank === undefined && hint === undefined
		? undefined
		: { ...(rank === undefined ? {} : { rank }), ...(hint === undefined ? {} : { hint }) };
}

/** Reads public template cues. The first authored source template remains the
 * sole join authority in manipulation_context, matching input/reference UI. */
export function readAffordanceCues(db: SnapshotDb): Map<string, AffordanceCue> {
	const out = new Map<string, AffordanceCue>();
	for (const row of readMetadataAttachmentRows(db)) {
		if (
			asString(row.namespace) !== AFFORDANCE_CUE_NAMESPACE ||
			asString(row.targetKind) !== AFFORDANCE_TEMPLATE_TARGET_KIND ||
			asString(row.audience) !== PUBLIC_AUDIENCE
		)
			continue;
		const cue = cueFromPayload(row.payloadJson);
		if (cue !== undefined) out.set(asString(row.targetRef), cue);
	}
	return out;
}
