// embedded-manifest: {"category":"production_schema_constructor","rationale":"The opt-in DM compiler derives bounded metadata documents and their exact declared read authority from shared Rust admission; it never applies rows or activates a host.","signatures":["schema_object","schema_shape"]}
/** Job-only DM carrier. No IO, connection, credential or activation callback. */
import {
	derive_dm_document_authority_json,
	validate_dm_artifact_shape_json,
	validate_dm_duty_document_json,
	validate_dm_presentation_document_json,
	validate_dm_source_references_json,
	validate_dm_source_shape_json,
} from "@spellkave/validate-wasm";
import { projectDmAuthorityWorlds } from "./npc-dm-authority-projection.ts";
import type {
	DmDutySource,
	DmLocatorReferenceLocators,
	DmPresentationContent,
	DmPrincipalPlan,
	DmReads,
} from "./npc-dm-types.ts";
import {
	type NpcQuestArtifact,
	type NpcQuestReferenceDiagnostic,
	parseNpcQuestArtifact,
} from "./npc-quests.ts";

export type * from "./npc-dm-types.ts";

type Row = Record<string, unknown>;

export interface NpcDmSource {
	schema_version: number;
	bundle_id: string;
	body_key: string;
	principal_plan: DmPrincipalPlan;
	reads: DmReads;
	catalog: NpcQuestArtifact;
	presentation: DmPresentationContent;
	duties: DmDutySource;
	reference_locators: DmLocatorReferenceLocators;
}
export interface NpcDmLocator {
	catalog_namespace: string;
	reader_binding_id: string;
}
export interface NpcDmReadGrant {
	socket_role: "principal" | "body";
	target_kind: "bundle" | "entity";
	target_ref: string;
	namespace: string;
	read_capability_id: string;
	content_hash: string;
	publication_id: string;
}
export interface NpcDmMetadataAttachment {
	bundle_id: string;
	target_kind: "entity" | "bundle";
	target_ref: string;
	namespace: string;
	payload_json: string;
	source: "manifest";
}
export interface NpcDmManifest {
	schema_version: "1.0.0";
	capability_definitions: {
		bundle_id: string;
		capability_id: string;
		actor_kind: "entity";
		display_name: string;
		description: string;
		default_visibility: "Public";
	}[];
	/** Every DM read capability is a service-only audience
	 * (`SERVICE_ONLY_AUDIENCE_TAG`). */
	capability_definition_tag: {
		bundle_id: string;
		capability_id: string;
		tag: string;
		source: "manifest";
	}[];
	role_definitions: {
		bundle_id: string;
		role_id: string;
		display_name: string;
		description: string;
		capability_ids: string[];
	}[];
	metadata_namespaces: {
		bundle_id: string;
		namespace: string;
		audience: string;
		on_demand: false;
	}[];
	actor_capabilities: {
		bundle_id: string;
		actor_entity_key: string;
		capability_id: string;
		source: string;
		source_args_hash: string;
		elevation_class: string;
		extent_kind_ref: string;
		extent_ref: string;
	}[];
	metadata_attachments: NpcDmMetadataAttachment[];
}
export interface NpcDmArtifact {
	schema_version: 1;
	npc_kind: "dm";
	artifact_digest: string;
	source_content_hash: string;
	source: NpcDmSource;
	manifest: NpcDmManifest;
	principal_plan: DmPrincipalPlan;
	locator: NpcDmLocator;
	read_grants: NpcDmReadGrant[];
	reference_diagnostics: NpcQuestReferenceDiagnostic[];
}

const PRESENTATION_NAMESPACE = "npc/dm/presentation/v1";
const DUTIES_NAMESPACE = "npc/dm/duties/v1";
const MAX_DOCUMENT_BYTES = 256 * 1024;

/** JSON key order follows JS UTF-16 ordering, matching existing quest hashes.
 * Refuse values that JSON.stringify would silently omit/coerce, plus class
 * serializers, accessors, sparse arrays and cycles in canonical world inputs. */
function canonical(value: unknown, ancestors = new Set<object>()): string {
	if (value === null || typeof value === "string" || typeof value === "boolean")
		return JSON.stringify(value);
	if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
	if (typeof value !== "object" || ancestors.has(value))
		throw new Error("DM carrier requires acyclic JSON values");
	const prototype: unknown = Object.getPrototypeOf(value);
	if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null)
		throw new Error("DM carrier requires plain JSON objects");
	ancestors.add(value);
	try {
		if (Object.getOwnPropertySymbols(value).length)
			throw new Error("DM carrier refuses symbol fields");
		if (Array.isArray(value)) {
			if (
				Object.getOwnPropertyNames(value).some(
					(key) =>
						key !== "length" && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length),
				)
			)
				throw new Error("DM carrier refuses extra array fields");
			const items: string[] = [];
			for (let i = 0; i < value.length; i++) {
				const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
				if (!descriptor || !("value" in descriptor))
					throw new Error("DM carrier refuses sparse/accessor arrays");
				items.push(canonical(descriptor.value, ancestors));
			}
			return `[${items.join(",")}]`;
		}
		const descriptors = Object.getOwnPropertyDescriptors(value);
		return `{${Object.keys(descriptors)
			.sort()
			.map((key) => {
				const descriptor = descriptors[key]!;
				if (!("value" in descriptor) || !descriptor.enumerable)
					throw new Error("DM carrier refuses accessors/non-JSON fields");
				return `${JSON.stringify(key)}:${canonical(descriptor.value, ancestors)}`;
			})
			.join(",")}}`;
	} finally {
		ancestors.delete(value);
	}
}
async function digest(value: unknown): Promise<string> {
	const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
	return `sha256:${Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
function checked(diagnostics: string, context: string): void {
	const errors: string[] = JSON.parse(diagnostics);
	if (errors.length) throw new Error(`Invalid DM ${context}: ${errors.join("; ")}`);
}
function deriveAuthority(
	input: Row,
	worlds: readonly unknown[],
): {
	principal_plan: DmPrincipalPlan;
	manifest: Omit<NpcDmManifest, "metadata_attachments">;
} {
	try {
		return JSON.parse(
			derive_dm_document_authority_json(
				canonical(input),
				canonical(projectDmAuthorityWorlds(worlds)),
			),
		);
	} catch (error) {
		throw new Error(`Invalid DM read authority: ${String(error)}`);
	}
}
async function document(
	content: Row,
	publication: string,
): Promise<Row & { content_hash: string; publication_id: string }> {
	const result = { ...content, content_hash: await digest(content), publication_id: publication };
	if (new TextEncoder().encode(canonical(result)).byteLength > MAX_DOCUMENT_BYTES)
		throw new Error("DM document exceeds 256 KiB including its publication envelope");
	return result;
}

/** canonicalWorlds contains complete admitted flattened roots, followed by the
 * independently parsed quest artifact contribution. Never a filtered cache or
 * self-composed nested catalog. Old no-document artifacts use their old parser. */
export async function compileNpcDmSource(
	sourceJson: string,
	canonicalWorlds: readonly unknown[],
): Promise<NpcDmArtifact> {
	checked(validate_dm_source_shape_json(sourceJson), "source");
	const source = JSON.parse(sourceJson) as NpcDmSource;
	const worldsJson = canonical(canonicalWorlds);
	checked(validate_dm_source_references_json(sourceJson, worldsJson), "references");
	const catalog = await parseNpcQuestArtifact(canonical(source.catalog), canonicalWorlds);
	const catalogNamespace = catalog.source.catalog_namespace;
	const authority = deriveAuthority(
		{
			schema_version: 1,
			bundle_id: source.bundle_id,
			body_key: source.body_key,
			principal_plan: source.principal_plan,
			reads: source.reads,
			catalog_namespace: catalogNamespace,
		},
		canonicalWorlds,
	);
	const attachments = catalog.manifest.metadata_attachments as Row[];
	const catalogRow = attachments.find(
		(row) =>
			row.target_kind === "bundle" &&
			row.target_ref === source.bundle_id &&
			row.bundle_id === source.bundle_id &&
			row.namespace === catalogNamespace,
	);
	if (!catalogRow || typeof catalogRow.payload_json !== "string")
		throw new Error("DM catalog publication is missing");
	const catalogDocument = JSON.parse(catalogRow.payload_json) as { publication_id: string };
	const sourceHash = await digest(source);
	const publication = `source:${sourceHash}`;
	const presentation = await document({ ...source.presentation }, publication);
	const duties = await document(
		{
			...source.duties,
			creation: {
				...source.duties.creation,
				kits: source.duties.creation.kits.map(({ items: _items, ...kit }) => kit),
			},
			catalog_namespace: catalogNamespace,
			catalog_content_hash: catalog.catalog_content_hash,
			catalog_publication_id: catalogDocument.publication_id,
			presentation_content_hash: presentation.content_hash,
		},
		publication,
	);
	checked(validate_dm_presentation_document_json(canonical(presentation)), "presentation document");
	checked(validate_dm_duty_document_json(canonical(duties)), "duty document");
	const attachment = (
		kind: "entity" | "bundle",
		target: string,
		namespace: string,
		payload: Row,
	): NpcDmMetadataAttachment => ({
		bundle_id: source.bundle_id,
		target_kind: kind,
		target_ref: target,
		namespace,
		payload_json: canonical(payload),
		source: "manifest",
	});
	const manifest: NpcDmManifest = {
		...authority.manifest,
		metadata_attachments: [
			attachment("entity", source.body_key, PRESENTATION_NAMESPACE, presentation),
			attachment("bundle", source.bundle_id, DUTIES_NAMESPACE, duties),
		],
	};
	const grants: NpcDmReadGrant[] = [
		{
			socket_role: "principal",
			target_kind: "bundle",
			target_ref: source.bundle_id,
			namespace: catalogNamespace,
			read_capability_id: source.reads.catalog_read_capability_id,
			content_hash: catalog.catalog_content_hash,
			publication_id: catalogDocument.publication_id,
		},
		{
			socket_role: "principal",
			target_kind: "bundle",
			target_ref: source.bundle_id,
			namespace: DUTIES_NAMESPACE,
			read_capability_id: source.reads.duty_read_capability_id,
			content_hash: duties.content_hash,
			publication_id: publication,
		},
		{
			socket_role: "body",
			target_kind: "entity",
			target_ref: source.body_key,
			namespace: PRESENTATION_NAMESPACE,
			read_capability_id: source.reads.presentation_read_capability_id,
			content_hash: presentation.content_hash,
			publication_id: publication,
		},
	];
	const content = {
		schema_version: 1 as const,
		npc_kind: "dm" as const,
		source_content_hash: sourceHash,
		source,
		manifest,
		principal_plan: authority.principal_plan,
		locator: {
			catalog_namespace: catalogNamespace,
			reader_binding_id: source.reads.reader_binding_id,
		},
		read_grants: grants,
		reference_diagnostics: catalog.reference_diagnostics,
	};
	const artifact = { ...content, artifact_digest: await digest(content) };
	checked(validate_dm_artifact_shape_json(canonical(artifact)), "artifact shape");
	return artifact;
}

/** Publication repeats raw JSON admission and every derivation. Unknown fields,
 * altered rows/plan/grants/locators/hash and stale catalog publications refuse. */
export async function parseNpcDmArtifact(
	artifactJson: string,
	canonicalWorlds: readonly unknown[],
): Promise<NpcDmArtifact> {
	checked(validate_dm_artifact_shape_json(artifactJson), "artifact shape");
	const value: unknown = JSON.parse(artifactJson);
	if (value === null || typeof value !== "object" || Array.isArray(value) || !("source" in value))
		throw new Error("Invalid DM artifact envelope");
	const expected = await compileNpcDmSource(canonical(value.source), canonicalWorlds);
	if (canonical(value) !== canonical(expected)) throw new Error("DM artifact derivation mismatch");
	return expected;
}
