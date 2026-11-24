/** Browser host policy for canonical AUTHOR tools and wasm initialization. */

import { getToolContract } from "@spellkave/tool-contracts";
import { loadBrowserAuthorTooling } from "@spellkave/world-author/tooling-browser";

import {
	type AuthorFacingBoundTool,
	type AuthorToolContext,
	authorFacingToolDefinitions,
	createAuthorFacingBoundTools,
} from "./authoring.ts";

export * from "./index.ts";

const browserToolNames = new Set(
	authorFacingToolDefinitions
		.filter((definition) => (definition.requiredCapabilities?.length ?? 0) === 0)
		.map((definition) => definition.name),
);

/** Canonical AUTHOR names whose execution needs no Node-only capability port. */
export const BROWSER_AUTHOR_TOOL_NAMES: readonly string[] = authorFacingToolDefinitions
	.filter((definition) => browserToolNames.has(definition.name))
	.map((definition) => definition.name);

/** Initialize the web wasm owned by world-author behind the tool-authoring boundary. */
export const initializeBrowserAuthorTools = loadBrowserAuthorTooling;

/** Bind only AUTHOR definitions whose required host capabilities are present in browsers. */
export function createBrowserAuthorFacingBoundTools(
	context: AuthorToolContext,
): AuthorFacingBoundTool[] {
	return createAuthorFacingBoundTools(context).filter(
		(tool) =>
			browserToolNames.has(tool.name) &&
			(!getToolContract(tool.name).admission.ports.includes("applyset") ||
				context.applyset !== undefined) &&
			(tool.name !== "spellkave_can_i" || context.canI !== undefined) &&
			(tool.name !== "spellkave_apply_manifest_delta" ||
				context.target !== undefined ||
				context.applyDelta !== undefined),
	);
}

export * from "./grant-tools";
