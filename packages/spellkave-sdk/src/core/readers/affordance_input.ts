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
const AFFORDANCE_INPUT_NAMESPACE = "ui.affordance_input";

/** A world-authored field in an affordance's input form. The widget choice is
 * presentation only; action identity and dispatch remain authored by the
 * affordance/action rows. */
export interface AffordanceInputField {
	name: string;
	label: string;
	control: "text" | "textarea" | "number";
	placeholder?: string;
	required?: boolean;
	min?: number;
	max?: number;
	maxLength?: number;
	/** Which PLAYER transport carries the value: `"utterance"` means the
	 * world reads it from what the actor SAYS (spellkave_communicate's
	 * utterance; a JSON object or plain text), `"args_json"` means the
	 * structured argument blob. Absent means the author did not say;
	 * the tool descriptions apply (sk-jay0.1.46). */
	channel?: "utterance" | "args_json";
}

/** Public, authored input schema for one affordance template. An explicit
 * empty `fields` array is meaningful: it says this action takes no form
 * input, even if its underlying consequence happens to carry dispatch text. */
export interface AffordanceInputSchema {
	fields: readonly AffordanceInputField[];
	submitLabel?: string;
}

function optionalString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function optionalFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseField(value: unknown): AffordanceInputField | undefined {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const row = value as Record<string, unknown>;
	const name = optionalString(row.name);
	const label = optionalString(row.label);
	const control = row.control;
	if (
		name === undefined ||
		label === undefined ||
		(control !== "text" && control !== "textarea" && control !== "number")
	)
		return undefined;
	const min = optionalFiniteNumber(row.min);
	const max = optionalFiniteNumber(row.max);
	const maxLength = optionalFiniteNumber(row.max_length);
	const channel =
		row.channel === "utterance" || row.channel === "args_json" ? row.channel : undefined;
	if (
		(min !== undefined && max !== undefined && min > max) ||
		(maxLength !== undefined && maxLength < 1)
	)
		return undefined;
	return {
		name,
		label,
		control,
		...(optionalString(row.placeholder) === undefined
			? {}
			: { placeholder: optionalString(row.placeholder) }),
		...(row.required === true ? { required: true } : {}),
		...(min === undefined ? {} : { min }),
		...(max === undefined ? {} : { max }),
		...(maxLength === undefined ? {} : { maxLength }),
		...(channel === undefined ? {} : { channel }),
	};
}

/** Reader-owned validation for `ui.affordance_input`. Bad authored payloads
 * are omitted rather than guessed: a player client must never invent an input
 * shape for a world action. */
function parseInputPayload(payloadJson: unknown): AffordanceInputSchema | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(asString(payloadJson));
	} catch {
		return undefined;
	}
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
	const row = parsed as Record<string, unknown>;
	if (!Array.isArray(row.fields)) return undefined;
	const fields = row.fields.map(parseField);
	if (fields.some((field) => field === undefined)) return undefined;
	const typedFields = fields as AffordanceInputField[];
	if (new Set(typedFields.map((field) => field.name)).size !== typedFields.length) return undefined;
	return {
		fields: typedFields,
		...(optionalString(row.submit_label) === undefined
			? {}
			: { submitLabel: optionalString(row.submit_label) }),
	};
}

/** Reads public, template-keyed form schemas. There is deliberately no action
 * vocabulary in this reader: a template's manifest attachment is the sole
 * authority for which fields its offered action presents. */
export function readAffordanceInputSchemas(db: SnapshotDb): Map<string, AffordanceInputSchema> {
	const out = new Map<string, AffordanceInputSchema>();
	for (const row of readMetadataAttachmentRows(db)) {
		if (asString(row.namespace) !== AFFORDANCE_INPUT_NAMESPACE) continue;
		if (asString(row.targetKind) !== AFFORDANCE_TEMPLATE_TARGET_KIND) continue;
		if (asString(row.audience) !== PUBLIC_AUDIENCE) continue;
		const schema = parseInputPayload(row.payloadJson);
		if (schema !== undefined) out.set(asString(row.targetRef), schema);
	}
	return out;
}
