import type { Diagnostic } from "./diagnostics";

export type MetadataNamespace = string;

export interface MetadataNamespaceRow {
	namespace: string;
	audience: string;
	description?: string;
	/** ADR-0130 D-4: reference content (rules text, creation data, docs) that
	 * ships only to clients that subscribe `public_reference_metadata`, never
	 * to a play session on connect. Default `false` (kernel default). */
	onDemand?: boolean;
}

export interface MetadataAttachmentRow {
	targetKind:
		| "entity"
		| "entity_definition"
		| "place_graph"
		| "place_node"
		| "place_edge"
		| "item_definition"
		| "resource_definition"
		| "affordance_template"
		| "capability_definition"
		| "bundle"
		| "prompt_definition";
	targetRef: string;
	namespace: MetadataNamespace | string;
	payload: unknown;
	source?: string;
}

export interface SchemaMetadataAttachmentRow {
	target_kind: string;
	target_ref: string;
	namespace: string;
	payload_json: string;
	bundle_id: string;
	source?: string;
}

export interface SchemaMetadataNamespaceRow {
	namespace: string;
	audience: string;
	bundle_id: string;
	description?: string;
	/** ADR-0130 D-4: see {@link MetadataNamespaceRow.onDemand}. */
	on_demand?: boolean;
}

export function toSchemaMetadataNamespaceRows(
	bundleId: string,
	rows: MetadataNamespaceRow[] | undefined,
): SchemaMetadataNamespaceRow[] | undefined {
	if (!rows || rows.length === 0) return undefined;
	return rows.map((row) => ({
		namespace: row.namespace,
		audience: row.audience,
		bundle_id: bundleId,
		...(row.description === undefined ? {} : { description: row.description }),
		...(row.onDemand === undefined ? {} : { on_demand: row.onDemand }),
	}));
}

export function toSchemaMetadataRows(
	bundleId: string,
	rows: MetadataAttachmentRow[] | undefined,
): SchemaMetadataAttachmentRow[] | undefined {
	if (!rows || rows.length === 0) return undefined;
	return rows.map((row) => ({
		target_kind: row.targetKind,
		target_ref: row.targetRef,
		namespace: row.namespace,
		payload_json: JSON.stringify(row.payload),
		bundle_id: bundleId,
		...(row.source === undefined ? {} : { source: row.source }),
	}));
}

export function validateMetadataRows(
	rows: SchemaMetadataAttachmentRow[] | undefined,
	namespaces: SchemaMetadataNamespaceRow[] | undefined,
	pathPrefix = "metadata",
): Diagnostic[] {
	const diags: Diagnostic[] = [];
	const registeredNamespaces = new Set<string>();
	for (const [index, row] of (namespaces ?? []).entries()) {
		if (registeredNamespaces.has(row.namespace)) {
			diags.push(
				metadataDiag(
					`metadata_namespaces[${index}]`,
					`duplicate metadata namespace '${row.namespace}'`,
					row,
				),
			);
			continue;
		}
		registeredNamespaces.add(row.namespace);
	}
	for (const [index, row] of (rows ?? []).entries()) {
		const path = `${pathPrefix}[${index}]`;
		if (!registeredNamespaces.has(row.namespace)) {
			diags.push(metadataDiag(path, `unknown metadata namespace '${row.namespace}'`, row));
			continue;
		}
		let payload: unknown;
		try {
			payload = JSON.parse(row.payload_json);
		} catch (err) {
			diags.push(
				metadataDiag(path, `payload_json is not valid JSON: ${String(err)}`, {
					namespace: row.namespace,
				}),
			);
			continue;
		}
		if (!isRecord(payload)) {
			diags.push(metadataDiag(path, "payload_json must decode to a JSON object", row));
		}
	}
	return diags;
}

function metadataDiag(path: string, message: string, details: unknown): Diagnostic {
	return {
		code: "WA-META-001",
		severity: "fatal",
		message,
		path,
		details,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
