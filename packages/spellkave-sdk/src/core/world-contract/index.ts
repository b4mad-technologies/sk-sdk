export type { SchemaSnapshot, SchemaTable } from "./classify.ts";
export {
	foldCollisions,
	foldNames,
	normaliseItems,
	type UncheckedItem,
	normaliseModuleDef,
	restrictSnapshot,
} from "./normalise.ts";
export { classifyRuntimeChange, type RuntimeChange } from "./runtime.ts";
export { servedSchemaFromSnapshot } from "./served.ts";
export { typeNames } from "./typetext.ts";
