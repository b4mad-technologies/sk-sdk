import {
	createDmExtensionTools as createPortableDmExtensionTools,
	createMapTool as createPortableMapTool,
	createOrientTool as createPortableOrientTool,
	createPlayerFacingToolMap as createPortablePlayerFacingToolMap,
	createPlayerFacingTools as createPortablePlayerFacingTools,
	createSpellkaveTools as createPortableSpellkaveTools,
	type PlayerToolState,
	type SpellkaveToolContext,
} from "@spellkave/tool-player";
import type { NodeToolCapabilities } from "@spellkave/tool-runtime";
import { companionNodeCapabilities } from "./node-adapter.ts";

export * from "@spellkave/tool-player";
export { createPortablePlayerFacingTools };

const nodeCapabilities: NodeToolCapabilities = companionNodeCapabilities;

/** Node host compatibility: portable definitions plus the explicit Node ports. */
export function createSpellkaveTools(context: SpellkaveToolContext) {
	return createPortableSpellkaveTools(context, nodeCapabilities, false);
}

export function createPlayerFacingTools(context: SpellkaveToolContext) {
	return createPortablePlayerFacingTools(context, nodeCapabilities, false);
}

export function createDmExtensionTools(context: SpellkaveToolContext) {
	return createPortableDmExtensionTools(context, nodeCapabilities, false);
}

export function createPlayerFacingToolMap(context: SpellkaveToolContext, state?: PlayerToolState) {
	return createPortablePlayerFacingToolMap(context, nodeCapabilities, false, state);
}

export function createOrientTool(context: SpellkaveToolContext) {
	return createPortableOrientTool(context, nodeCapabilities, false);
}

export function createMapTool(context: SpellkaveToolContext) {
	return createPortableMapTool(context, nodeCapabilities, false);
}
