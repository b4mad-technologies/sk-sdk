import initWasm, {
	dsl_reference_json,
	manifest_schema_json,
	parse_manifest_toml_to_json,
	render_manifest_json_to_toml,
	validate_manifest_toml,
} from "@spellkave/validate-wasm/browser";
import { type Diagnostic, diagnosticsFromJson } from "./diagnostics";
import { inspectSchemaManifest, type ManifestInspection } from "./inspection";
import { type LintFinding, lintManifest as lintManifestRules } from "./lint";
import {
	type SchemaMetadataAttachmentRow,
	type SchemaMetadataNamespaceRow,
	validateMetadataRows,
} from "./metadata";
import { patchManifest } from "./patch";
import type { DslReference, ManifestSchema } from "./reference";
import { manifestTagPrefixFamilies } from "./tag-prefix-families";

export type {
	Diagnostic,
	DiagnosticSeverity,
	DiagnosticSpan,
} from "./diagnostics";
export type { ManifestInspection, ManifestSummary } from "./inspection";
export type { LintFinding, LintRule } from "./lint";
export type {
	DslArgReference,
	DslOperatorReference,
	DslReference,
	ManifestSchema,
} from "./reference";

export interface BrowserAuthorSdk {
	describeDsl(): DslReference;
	describeManifestSchema(): ManifestSchema;
	inspectManifest(toml: string): ManifestInspection;
	lintManifest(manifest: Record<string, unknown>): LintFinding[];
	patchManifest(
		manifest: Record<string, unknown>,
		op: string,
		payload: Record<string, unknown>,
	): void;
	renderSchemaManifest(manifest: Record<string, unknown>): string;
	renderSchemaManifestJson(manifestJson: string): string;
	validateManifestToml(toml: string): Diagnostic[];
}

let wasmReady: Promise<void> | null = null;

function ensureWasm(): Promise<void> {
	if (wasmReady === null) {
		wasmReady = initWasm().then(() => undefined);
	}
	return wasmReady;
}

function describeManifestSchema(): ManifestSchema {
	return JSON.parse(manifest_schema_json()) as ManifestSchema;
}

function describeDsl(): DslReference {
	return JSON.parse(dsl_reference_json()) as DslReference;
}

function inspectManifest(toml: string): ManifestInspection {
	return inspectSchemaManifest(
		JSON.parse(parse_manifest_toml_to_json(toml)) as Record<string, unknown>,
	);
}

function lintManifest(manifest: Record<string, unknown>): LintFinding[] {
	return lintManifestRules(manifest, { refTagFamilies: manifestTagPrefixFamilies(manifest) });
}

function renderSchemaManifest(manifest: Record<string, unknown>): string {
	return render_manifest_json_to_toml(JSON.stringify(manifest));
}

function renderSchemaManifestJson(manifestJson: string): string {
	return render_manifest_json_to_toml(manifestJson);
}

function validateManifestToml(toml: string): Diagnostic[] {
	const diagnostics = diagnosticsFromJson(validate_manifest_toml(toml));
	try {
		const manifest = inspectManifest(toml).manifest as Record<string, unknown>;
		diagnostics.push(
			...validateMetadataRows(
				manifest.metadata_attachments as SchemaMetadataAttachmentRow[] | undefined,
				manifest.metadata_namespaces as SchemaMetadataNamespaceRow[] | undefined,
			),
		);
	} catch {
		// Parse errors are already represented by validate_manifest_toml.
	}
	return diagnostics;
}

export async function loadBrowserAuthorSdk(): Promise<BrowserAuthorSdk> {
	await ensureWasm();
	return {
		describeDsl,
		describeManifestSchema,
		inspectManifest,
		lintManifest,
		patchManifest,
		renderSchemaManifest,
		renderSchemaManifestJson,
		validateManifestToml,
	};
}

export { composeGrant, type GrantInput, type GrantRow, grantDelta } from "./tooling.browser";
