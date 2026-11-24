import { parse_manifest_toml_to_json } from "@spellkave/validate-wasm";
import { inspectRowRefs, inspectSchemaManifest, type ManifestInspection } from "./inspection";
import { ROW_KIND_NATURAL_KEY } from "./row-kinds";

export {
	findRowByCompositeKey,
	type InboundRowRef,
	inspectSchemaManifest,
	type ManifestInspection,
	type ManifestSummary,
	type OutboundRowRef,
	outboundRefsExcluding,
	refTagOutboundRefs,
} from "./inspection";

export function inspectManifest(toml: string): ManifestInspection {
	return inspectSchemaManifest(
		JSON.parse(parse_manifest_toml_to_json(toml)) as Record<string, unknown>,
	);
}

/**
 * `inspectRowRefs` pre-bound to the package's own `ROW_KIND_NATURAL_KEY` —
 * the entry point every consumer outside this package should call (e.g.
 * `spellkave_query`'s `refs` output); `inspectRowRefs` itself stays
 * dependency-free (a plain `Record<string, unknown>` walk, no wasm import)
 * so it can be unit-tested without the wasm boundary.
 */
export function inspectRowReferences(
	manifest: Record<string, unknown>,
	kind: string,
	id: string,
): ReturnType<typeof inspectRowRefs> {
	return inspectRowRefs(manifest, ROW_KIND_NATURAL_KEY, kind, id);
}
