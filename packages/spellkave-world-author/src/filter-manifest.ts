import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { filterManifestForActor, type SchemaManifest } from "./filter-manifest-core";
import { renderSchemaManifest } from "./manifest";

export type { SchemaManifest } from "./filter-manifest-core";
export {
	filteredRowCount,
	filterManifestForActor,
	INSTANCE_ROW_KINDS,
	type InstanceRowKind,
} from "./filter-manifest-core";

// One-actor view of a reconstructed schema-shaped Manifest (sk-0m4.43).
//
// Port of the closed PR's Rust `client/src/cli/manifest_filter.rs` (9453e2609)
// 1:1: keep-set closure over containment / owned_by / equipment; keep the
// bundles header plus instance rows that hang off the named actor. Catalog
// rows stay behind. Operates on snake_case schema JSON (the shape
// `r_export_manifest` writes), never camelCase authoring builders.

/** Recorder-only: zero `object_state.expires_at_tick` so a ±1 tick cannot jitter a story fixture. */
export function zeroObjectStateExpiry(manifest: SchemaManifest): SchemaManifest {
	return {
		...manifest,
		object_state: (manifest.object_state ?? []).map((row) => ({ ...row, expires_at_tick: 0 })),
	};
}

/** Filter + zero expiry + wasm render. Used by the story recorder and tests. */
export function prepareActorExportToml(manifest: SchemaManifest, actorKey: string): string {
	return renderSchemaManifest(zeroObjectStateExpiry(filterManifestForActor(manifest, actorKey)));
}

/** Write `toml` to `join(outDir, fileName)`. Caller chooses the file name. */
export function writeActorExport(outDir: string, toml: string, fileName: string): string {
	mkdirSync(outDir, { recursive: true });
	const dest = join(outDir, fileName);
	writeFileSync(dest, toml.endsWith("\n") ? toml : `${toml}\n`);
	return dest;
}
