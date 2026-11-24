/**
 * The machine side of one guided question: where a guided dialogue stands,
 * for a client that remembers nothing. An NPC sends it beside the spoken
 * question; the shape is built by `crates/spellkave-npc-host/src/guide.rs`
 * (design: `ledger/designs/guided-dialogue-tree.md`).
 *
 * Presentation only. It never decides what may be answered: admission checks
 * the prompt occurrence's captured action set (ADR-0073 D-1). A reader shows
 * titles and labels and must not branch on a step id.
 */
export interface DialogueGuideAnswer {
	label: string;
	/** A definition id, when the answer names one. */
	ref?: string;
}

export interface DialogueGuideEntry {
	/** Opaque step id. Several entries share it when a step asks several questions. */
	step: string;
	title: string;
	state: "answered" | "open" | "ahead";
	answers: DialogueGuideAnswer[];
}

export interface DialogueGuide {
	/** Version of this shape. */
	guide: 1;
	/** The step the open question belongs to. */
	step: string;
	/** The question was answered before and is shown again. */
	reopened: boolean;
	/** Picks left on this question, this one included. Absent on a single pick. */
	remaining?: number;
	/** The draft so far and the way ahead, in the NPC's order. */
	outline: DialogueGuideEntry[];
	/** Parallel to the question's options, for options without a definition. */
	descriptions?: (string | null)[];
	/** The NPC cut the outline to stay inside its bound. */
	truncated?: true;
}

const STATES = new Set(["answered", "open", "ahead"]);
const MAX_ENTRIES = 48;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseEntry(value: unknown): DialogueGuideEntry | undefined {
	if (!isRecord(value)) return undefined;
	const { step, title, state, answers } = value;
	if (typeof step !== "string" || step === "" || typeof title !== "string") return undefined;
	if (typeof state !== "string" || !STATES.has(state)) return undefined;
	if (answers !== undefined && !Array.isArray(answers)) return undefined;
	const parsed: DialogueGuideAnswer[] = [];
	for (const answer of answers ?? []) {
		if (!isRecord(answer) || typeof answer.label !== "string") return undefined;
		if (answer.ref !== undefined && typeof answer.ref !== "string") return undefined;
		parsed.push({ label: answer.label, ...(answer.ref ? { ref: answer.ref } : {}) });
	}
	return { step, title, state: state as DialogueGuideEntry["state"], answers: parsed };
}

/**
 * Reads a machine side. An unknown version or any malformed part yields
 * `undefined`: the question then shows without an outline, it is never shown
 * with a half-read one.
 */
export function parseDialogueGuide(value: unknown): DialogueGuide | undefined {
	if (!isRecord(value) || value.guide !== 1) return undefined;
	const { step, reopened, remaining, outline, descriptions, truncated } = value;
	if (typeof step !== "string" || step === "") return undefined;
	if (!Array.isArray(outline) || outline.length > MAX_ENTRIES) return undefined;
	const entries: DialogueGuideEntry[] = [];
	for (const raw of outline) {
		const entry = parseEntry(raw);
		if (entry === undefined) return undefined;
		entries.push(entry);
	}
	if (remaining !== undefined && !(Number.isInteger(remaining) && (remaining as number) > 0))
		return undefined;
	if (
		descriptions !== undefined &&
		!(
			Array.isArray(descriptions) &&
			descriptions.every((text) => text === null || typeof text === "string")
		)
	)
		return undefined;
	return {
		guide: 1,
		step,
		reopened: reopened === true,
		...(remaining === undefined ? {} : { remaining: remaining as number }),
		outline: entries,
		...(descriptions === undefined ? {} : { descriptions: descriptions as (string | null)[] }),
		...(truncated === true ? { truncated: true as const } : {}),
	};
}
