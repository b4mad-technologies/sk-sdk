import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString } from "./_helpers";
import type { DialogueGuide } from "./dialogue_guide";
import { readMetadataAttachmentRows } from "./metadata_rows";

export const requiredTables: RequiredTables<
	["public_metadata_attachment", "visible_metadata_attachment"]
> = ["public_metadata_attachment", "visible_metadata_attachment"];
registerReaderManifest({ requiredTables });

const PUBLIC_AUDIENCE = "public";
const PROMPT_DEFINITION_TARGET_KIND = "prompt_definition";
const DIALOGUE_PROMPT_NAMESPACE = "dialogue.prompt";

/** A prompt's authored presentation or audience-trace marker. Static question
 * and labels remain metadata; scripted menus resolve the occurrence's captured
 * trace in manipulation_context. Neither changes response admission, which
 * checks the occurrence's captured action set (ADR-0073 D-1). */
export interface DialoguePromptPresentation {
	presentation?: "audience_trace";
	question?: string;
	labels: Record<string, string>;
	/** Static authored definition refs keyed by response identity. */
	response_refs?: Record<string, string>;
	/** Picks still to make on a multi-pick menu, this one included — the
	 * "(N more)" of the question as a number. Absent on a single-pick prompt. */
	picks_remaining?: number;
	/** The machine side of a guided question: outline, draft so far, picks
	 * left. Present only on a prompt whose speaker sends one. */
	guide?: DialogueGuide;
}

function parsePresentationPayload(payloadJson: unknown): DialoguePromptPresentation | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(asString(payloadJson));
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
	const { question, responses, picks_remaining, presentation } = parsed as Record<string, unknown>;
	const labels: Record<string, string> = {};
	if (typeof responses === "object" && responses !== null && !Array.isArray(responses)) {
		for (const [actionId, label] of Object.entries(responses as Record<string, unknown>)) {
			if (typeof label === "string" && label.length > 0) labels[actionId] = label;
		}
	}
	if (question !== undefined && typeof question !== "string") return undefined;
	const picksRemaining =
		typeof picks_remaining === "number" && Number.isInteger(picks_remaining) && picks_remaining > 0
			? picks_remaining
			: undefined;
	return {
		...(presentation === "audience_trace" ? { presentation: "audience_trace" as const } : {}),
		...(typeof question === "string" ? { question } : {}),
		labels,
		...(picksRemaining === undefined ? {} : { picks_remaining: picksRemaining }),
	};
}

/**
 * Reads authored dialogue-prompt presentation text: `metadata_attachment`
 * rows with `target_kind = "prompt_definition"`, `target_ref = <prompt_def_id>`,
 * namespace `dialogue.prompt`, payload `{ "question": string?, "responses":
 * { "<action_id>": "<label>" } }`. Public-audience only, the same rule
 * {@link readAffordanceGroupMembership}/{@link readAffordanceDefinitionRefs}
 * apply: `visible_metadata_attachment` can carry non-public rows this caller
 * happens to be admitted to, and a PLAYER-facing reader must not trust
 * "present in the union" to mean "public". Deliberately optional per
 * `prompt_def_id`: a prompt with no authored presentation still opens and
 * closes normally — `r_manipulate`'s prompt gate never reads this namespace.
 */
export function readDialoguePromptPresentation(
	db: SnapshotDb,
): Map<string, DialoguePromptPresentation> {
	const out = new Map<string, DialoguePromptPresentation>();
	for (const row of readMetadataAttachmentRows(db)) {
		if (asString(row.namespace) !== DIALOGUE_PROMPT_NAMESPACE) continue;
		if (asString(row.targetKind) !== PROMPT_DEFINITION_TARGET_KIND) continue;
		if (asString(row.audience) !== PUBLIC_AUDIENCE) continue;
		const presentation = parsePresentationPayload(row.payloadJson);
		if (presentation === undefined) continue;
		out.set(asString(row.targetRef), presentation);
	}
	return out;
}
