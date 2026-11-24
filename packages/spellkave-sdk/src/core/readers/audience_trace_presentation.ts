/** ADR-0155 D-6: prompt labels bind to the occurrence's captured speech trace. */
import type { TraceRow } from "../../binding_rows";
import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { rows } from "./_helpers";
import { parseDialogueGuide } from "./dialogue_guide";
import type { DialoguePromptPresentation } from "./dialogue_prompt_presentation";
export const requiredTables: RequiredTables<["visible_trace"]> = ["visible_trace"];
registerReaderManifest({ requiredTables });

export function readAudienceTracePresentation(
	db: SnapshotDb,
	traceId: string,
	responseIds: readonly string[],
	authored: DialoguePromptPresentation | undefined,
): DialoguePromptPresentation | undefined {
	if (authored?.presentation !== "audience_trace") return authored;
	const fallback = Object.fromEntries(responseIds.map((id, index) => [id, String(index + 1)]));
	const trace = rows<TraceRow>(db, "visible_trace").find((row) => String(row.traceId) === traceId);
	let payload: unknown;
	try {
		payload = JSON.parse(trace?.payloadJson ?? "null");
	} catch {
		payload = undefined;
	}
	if (typeof payload !== "object" || payload === null || Array.isArray(payload))
		return { labels: fallback };
	const { text, options, option_definition_refs, context } = payload as Record<string, unknown>;
	// The speaker's machine side rides the same captured trace, so it is bound
	// to this occurrence like the labels are.
	const guide = parseDialogueGuide(context);
	const valid =
		Array.isArray(options) &&
		options.length === responseIds.length &&
		options.every((label) => typeof label === "string");
	const refs =
		valid &&
		Array.isArray(option_definition_refs) &&
		option_definition_refs.length === responseIds.length &&
		option_definition_refs.every(
			(ref) => ref === null || (typeof ref === "string" && ref.length > 0),
		)
			? Object.fromEntries(
					responseIds.flatMap((id, index) =>
						typeof option_definition_refs[index] === "string"
							? [[id, option_definition_refs[index]]]
							: [],
					),
				)
			: undefined;
	return {
		...(typeof text === "string" ? { question: text } : {}),
		...(refs === undefined || Object.keys(refs).length === 0 ? {} : { response_refs: refs }),
		...(guide === undefined ? {} : { guide }),
		labels: valid
			? Object.fromEntries(responseIds.map((id, i) => [id, (options as string[])[i] as string]))
			: fallback,
	};
}
