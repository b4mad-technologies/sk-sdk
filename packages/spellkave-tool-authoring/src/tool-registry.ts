/** AUTHOR result envelope compatibility over the transport-neutral runtime. */
import {
	defineTool as defineRuntimeTool,
	type NodeToolCapabilities,
	type ToolDefinition as RuntimeToolDefinition,
	type ToolExecutionDefinition as RuntimeToolExecutionDefinition,
} from "@spellkave/tool-runtime";
import type { TSchema } from "typebox";

export interface ToolResult<R> {
	content: Array<
		{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
	>;
	details: R;
	addedToolNames?: string[];
	terminate?: boolean;
}

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
