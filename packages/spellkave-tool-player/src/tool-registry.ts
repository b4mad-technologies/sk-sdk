// Single-registration-point tool registry (issue #1380).
//
// Before this module existed, adding a Spellkave companion tool meant three
// synchronized edits: a `*_PARAMS` schema constant, a `createXTool(context)`
// factory + an entry in the flat `createSpellkaveTools()` array, and a new arm
// in a hand-maintained tool union type. `defineTool` collapses that to ONE call
// in one place: the runtime `BoundTool` (via `bindTool`) and the package's
// derived tool-union types are both produced from the same `ToolDefinition`.
//
// Generic over the host context type (`TContext`) so both `tools.ts`
// (`SpellkaveToolContext`) and `authoring.ts` (a bare `root: string`) share one
// registry shape without coupling those two tool families to each other.
import {
	defineTool as defineRuntimeTool,
	type NodeToolCapabilities,
	type ToolDefinition as RuntimeToolDefinition,
	type ToolExecutionDefinition as RuntimeToolExecutionDefinition,
} from "@spellkave/tool-runtime";
import type { TSchema } from "typebox";

/** Transport-neutral PLAYER tool result, deliberately independent of Pi SDK types. */
export interface ToolResult<R> {
	content: Array<
		{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
	>;
	details: R;
	addedToolNames?: string[];
	terminate?: boolean;
}

/** @deprecated Compatibility name for legacy companion-facing consumers. */
export type CompanionToolResult<R> = ToolResult<R>;

/**
 * A tool's definition, decoupled from the host context it runs against. This is
 * the one place a new Spellkave companion tool is declared.
 */
/**
 * Compatibility view for existing Pi-facing execution bodies: the runtime is
 * generic over a complete result, while companion's historical `R` parameter
 * represents the `details` field inside the historical host result envelope.
 */
export type ToolDefinition<
	TContext,
	P extends TSchema,
	R,
	TCapabilities extends object = NodeToolCapabilities,
> = RuntimeToolDefinition<TContext, P, ToolResult<R>, TCapabilities>;

export type ToolExecutionDefinition<
	TContext,
	P extends TSchema,
	R,
	TCapabilities extends object = NodeToolCapabilities,
> = RuntimeToolExecutionDefinition<TContext, P, ToolResult<R>, TCapabilities>;

/**
 * Keep the companion-facing generic signature stable while delegating
 * descriptor binding to the browser-safe runtime.
 */
export function defineTool<
	TContext,
	P extends TSchema,
	R,
	TCapabilities extends object = NodeToolCapabilities,
>(
	definition: ToolExecutionDefinition<TContext, P, R, TCapabilities>,
): ToolDefinition<TContext, P, R, TCapabilities> {
	return defineRuntimeTool(definition);
}
