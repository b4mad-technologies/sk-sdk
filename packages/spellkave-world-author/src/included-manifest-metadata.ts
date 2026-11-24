import { render_manifest_include, split_manifest_fragment } from "@spellkave/validate-wasm";
import {
	type RenderManifestIncludeOptions,
	renderManifestIncludeWith,
	splitIncludedManifestMetadataWith,
} from "./included-manifest-metadata-core";

export type {
	IncludedManifestMetadata,
	RenderManifestIncludeOptions,
} from "./included-manifest-metadata-core";

export function renderManifestInclude(
	rendered: string,
	options: RenderManifestIncludeOptions = {},
): string {
	return renderManifestIncludeWith(render_manifest_include, rendered, options);
}
export function splitIncludedManifestMetadata(fragmentToml: string) {
	return splitIncludedManifestMetadataWith(split_manifest_fragment, fragmentToml);
}
