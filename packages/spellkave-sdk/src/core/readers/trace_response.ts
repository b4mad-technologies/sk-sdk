/** Causal answer history. Never infer the answered occurrence from current prompts or time. */
import type { ActionDefinitionTagRow, PromptOccurrenceRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { rows } from "./_helpers";
import { readAudienceTracePresentation } from "./audience_trace_presentation";
import { readDialoguePromptPresentation } from "./dialogue_prompt_presentation";

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

export interface TraceResponse {
	action_id: string;
	slot: number;
	occurrence_id?: string;
	label?: string;
}

/** Public authored syntax marker, independent of target admission. */
export function responseSlot(tags: readonly string[]): number | undefined {
	for (const tag of tags) {
		if (!tag.startsWith("ui.response-slot=")) continue;
		const value = Number(tag.slice("ui.response-slot=".length));
		if (Number.isSafeInteger(value) && value > 0) return value;
	}
	return undefined;
}

export function responseSlotFields(tags: readonly string[]): { response_slot?: number } {
	const slot = responseSlot(tags);
	return slot === undefined ? {} : { response_slot: slot };
}

export function readTraceResponse(db: SnapshotDb, payload: unknown): TraceResponse | undefined {
	if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return undefined;
	const body = payload as Record<string, unknown>;
	if (typeof body.action_id !== "string") return undefined;
	const actionId = body.action_id;
	const slot = responseSlot(
		rows<ActionDefinitionTagRow>(db, "action_definition_tag")
			.filter((row) => row.actionId === actionId)
			.map((row) => row.tag),
	);
	if (slot === undefined) return undefined;
	const response: TraceResponse = { action_id: actionId, slot };
	// u64 identities travel as decimal strings, avoiding JavaScript precision loss.
	if (typeof body.occurrence_id !== "string" || !/^\d+$/.test(body.occurrence_id)) return response;
	response.occurrence_id = body.occurrence_id;
	const occurrence = rows<PromptOccurrenceRow>(db, "visible_prompt_occurrence").find(
		(row) => String(row.occurrenceId) === body.occurrence_id,
	);
	if (!occurrence || occurrence.responseActionIds[slot - 1] !== actionId) return response;
	const authored = readDialoguePromptPresentation(db).get(occurrence.promptDefId);
	const presentation = readAudienceTracePresentation(
		db,
		String(occurrence.audienceTraceId),
		occurrence.responseActionIds,
		authored,
	);
	const label = presentation?.labels[actionId];
	if (label !== undefined && label !== String(slot)) response.label = label;
	return response;
}
