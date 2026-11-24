/** Node/default author-tool surface. Browser builds select `tooling.browser`. */

// Export owning modules directly: importing the index here creates a conditional-export cycle.
export type { InstanceRead } from "@spellkave/tool-contracts";
export { extra_rows_by_natural_key_json, shape_params_json } from "@spellkave/authoring-wasm";
export * from "./applyset";
export { manifestRowIdentities } from "./applyset";
export * from "./authoring-harness";
export * from "./compose";
export * from "./corpus";
export * from "./damage";
export * from "./diff-manifest";
export * from "./dsl";
export * from "./evaluate";
export * from "./explain";
export * from "./filter-manifest";
export * from "./grants";
export * from "./included-manifest-metadata";
export * from "./inspect";
export { inspectManifest } from "./inspect";
export * from "./lint";
export * from "./manifest";
export { renderSchemaManifestJson } from "./manifest";
export * from "./metadata";
export * from "./owner-instance-read";
export * from "./patch";
export * from "./ref-tags";
export * from "./reference";
// Explicit exports retain live bindings through the conditional tooling cycle.
export { describeManifestSchema } from "./reference";
export * from "./row-identity";
export * from "./row-kinds";
export { ROW_KIND_NATURAL_KEY, ROW_KIND_STORAGE_KEY } from "./row-kinds";
export * from "./scoped-instance-read";
export * from "./session-predicates";
export * from "./spell";
export * from "./tag-prefix-families";
export * from "./validate";
