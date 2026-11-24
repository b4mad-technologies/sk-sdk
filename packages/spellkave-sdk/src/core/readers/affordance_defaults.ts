import {
	type RequiredTables,
	registerReaderManifest,
	type SnapshotDb,
} from "../../reader-manifest";
import { asString } from "./_helpers";
import type { AffordanceInputSchema } from "./affordance_input";
import { readMetadataAttachmentRows } from "./metadata_rows";

export const requiredTables: RequiredTables<
	["public_metadata_attachment", "visible_metadata_attachment"]
> = ["public_metadata_attachment", "visible_metadata_attachment"];
registerReaderManifest({ requiredTables });

export const AFFORDANCE_DEFAULTS_NAMESPACE = "ui.affordance_defaults";
const PUBLIC_AUDIENCE = "public";
const AFFORDANCE_TEMPLATE_TARGET_KIND = "affordance_template";

/** Author-published draft values. They are never an eligibility assertion,
 * reducer fallback, prompt response contract, or dispatch route. */
export interface AffordanceDefaults {
	target?: { kind: "actor" } | { kind: "reference"; target_ref: string };
	input_values?: Record<string, string | number>;
	provenance: {
		namespace: typeof AFFORDANCE_DEFAULTS_NAMESPACE;
		template_id: string;
		attachment_id: string;
		/** Changes when the authored attachment changes, even if the surrounding
		 * manipulation-context revision is unchanged. */
		content_key: string;
	};
}

function parseInputValues(
	value: unknown,
	schema: AffordanceInputSchema | undefined,
): Record<string, string | number> | undefined {
	if (value === undefined) return {};
	if (value === null || typeof value !== "object" || Array.isArray(value) || schema === undefined)
		return undefined;
	const fields = new Map(schema.fields.map((field) => [field.name, field]));
	const values: Record<string, string | number> = {};
	for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
		// Transport and occurrence identity are never an authored input default,
		// even if an accidentally named form field exists in a fixture.
		if (
			[
				"semantic_context",
				"occurrence_id",
				"source_ref",
				"action_id",
				"target_ref",
				"participants",
			].includes(name)
		)
			return undefined;
		const field = fields.get(name);
		if (field === undefined) return undefined;
		if (field.control === "number") {
			if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
			if (
				(field.min !== undefined && raw < field.min) ||
				(field.max !== undefined && raw > field.max)
			)
				return undefined;
			values[name] = raw;
			continue;
		}
		if (typeof raw !== "string") return undefined;
		if (field.maxLength !== undefined && raw.length > field.maxLength) return undefined;
		values[name] = raw;
	}
	return values;
}

function parseDefaults(
	payloadJson: unknown,
	templateId: string,
	attachmentId: string,
	setAtTick: unknown,
	schema: AffordanceInputSchema | undefined,
): AffordanceDefaults | undefined {
	let payload: unknown;
	try {
		payload = JSON.parse(asString(payloadJson));
	} catch {
		return undefined;
	}
	if (payload === null || typeof payload !== "object" || Array.isArray(payload)) return undefined;
	const row = payload as Record<string, unknown>;
	if (row.version !== 1) return undefined;
	let target: AffordanceDefaults["target"];
	if (row.target !== undefined) {
		if (row.target === null || typeof row.target !== "object" || Array.isArray(row.target))
			return undefined;
		const targetRow = row.target as Record<string, unknown>;
		if (targetRow.kind === "actor" && Object.keys(targetRow).length === 1)
			target = { kind: "actor" };
		else if (
			targetRow.kind === "reference" &&
			typeof targetRow.target_ref === "string" &&
			targetRow.target_ref.trim() !== "" &&
			Object.keys(targetRow).length === 2
		)
			target = { kind: "reference", target_ref: targetRow.target_ref };
		else return undefined;
	}
	const inputValues = parseInputValues(row.input_values, schema);
	if (inputValues === undefined || (target === undefined && Object.keys(inputValues).length === 0))
		return undefined;
	return {
		...(target === undefined ? {} : { target }),
		...(Object.keys(inputValues).length === 0 ? {} : { input_values: inputValues }),
		provenance: {
			namespace: AFFORDANCE_DEFAULTS_NAMESPACE,
			template_id: templateId,
			attachment_id: attachmentId,
			content_key: `${attachmentId}:${asString(setAtTick)}:${asString(payloadJson)}`,
		},
	};
}

/** Read one bounded author-published default per source template. Context
 * projection later resolves actor/reference targets against the caller's own
 * visible facts; this reader intentionally never infers a target. */
export function readAffordanceDefaults(
	db: SnapshotDb,
	inputByTemplate: ReadonlyMap<string, AffordanceInputSchema>,
): Map<string, AffordanceDefaults> {
	const out = new Map<string, AffordanceDefaults>();
	const conflictedTemplates = new Set<string>();
	for (const row of readMetadataAttachmentRows(db)) {
		if (
			asString(row.namespace) !== AFFORDANCE_DEFAULTS_NAMESPACE ||
			asString(row.targetKind) !== AFFORDANCE_TEMPLATE_TARGET_KIND ||
			asString(row.audience) !== PUBLIC_AUDIENCE
		)
			continue;
		const templateId = asString(row.targetRef);
		const defaults = parseDefaults(
			row.payloadJson,
			templateId,
			asString(row.key),
			row.setAtTick,
			inputByTemplate.get(templateId),
		);
		if (defaults === undefined || conflictedTemplates.has(templateId)) continue;
		// Defaults form one authored whole. Multiple attachments could not be
		// combined without inventing precedence, so withhold them all instead.
		if (out.has(templateId)) {
			out.delete(templateId);
			conflictedTemplates.add(templateId);
			continue;
		}
		out.set(templateId, defaults);
	}
	return out;
}
