import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { type ToolRole, toolContractsForRole } from "@spellkave/tool-contracts";
import {
	type BoundTool,
	bindTool,
	type ToolDefinition,
	type ToolRuntimePorts,
} from "@spellkave/tool-runtime";
import type { Static, TSchema } from "typebox";

/** Pi's prompt extensions, preserved verbatim from the shared tool contract. */
export type PromptAwareAgentTool<P extends TSchema = TSchema, R = unknown> = AgentTool<P, R> & {
	promptSnippet?: string;
	promptGuidelines?: string[];
};

/** Convert a transport-neutral bound tool into Pi's AgentTool shape. */
type ToolDetails<TResult> = TResult extends { details: infer TDetails } ? TDetails : unknown;

export function toAgentTool<P extends TSchema, TResult>(
	bound: BoundTool<P, TResult>,
): PromptAwareAgentTool<P, ToolDetails<TResult>> {
	return {
		name: bound.name,
		label: bound.label,
		description: bound.description,
		...(bound.promptSnippet === undefined ? {} : { promptSnippet: bound.promptSnippet }),
		...(bound.promptGuidelines === undefined
			? {}
			: { promptGuidelines: [...bound.promptGuidelines] }),
		parameters: bound.parameters,
		executionMode: bound.executionMode,
		// Pi 1.5 validates JSON Schema and infers only a subset of TypeBox kinds.
		// The bound tool retains the exact schema P; bridge that generic boundary here.
		execute: async (toolCallId, params) =>
			(await bound.execute(toolCallId, params as Static<P>)) as AgentToolResult<
				ToolDetails<TResult>
			>,
	};
}

/** Convert a keyed transport-neutral tool collection without losing its tool-specific types. */
export type AgentToolMap<TTools extends Record<string, BoundTool<TSchema, unknown>>> = {
	[K in keyof TTools]: TTools[K] extends BoundTool<infer P extends TSchema, infer TResult>
		? PromptAwareAgentTool<P, ToolDetails<TResult>>
		: never;
};

/** Adapt a keyed collection at the Pi delivery boundary, preserving its keys and result details. */
export function toAgentToolMap<TTools extends Record<string, BoundTool<TSchema, unknown>>>(
	tools: TTools,
): AgentToolMap<TTools> {
	return Object.fromEntries(
		Object.entries(tools).map(([name, tool]) => [name, toAgentTool(tool)]),
	) as AgentToolMap<TTools>;
}

/** Bind then convert one executable definition for a Pi host. Pi owns argument validation. */
export function bindAgentTool<TContext, P extends TSchema, TResult, TCapabilities extends object>(
	definition: ToolDefinition<TContext, P, TResult, TCapabilities>,
	ports: ToolRuntimePorts<TContext, TCapabilities, TResult>,
): PromptAwareAgentTool<P, ToolDetails<TResult>> {
	return toAgentTool(bindTool(definition, { ...ports, validateArguments: false }));
}

export interface AgentToolRoleComposition<TContext, TCapabilities extends object> {
	role: ToolRole;
	definitions: readonly ToolDefinition<TContext, TSchema, unknown, TCapabilities>[];
	ports: ToolRuntimePorts<TContext, TCapabilities, unknown>;
}

/** Compose one Pi role surface in canonical contract-roster order, without a second registry. */
export function createAgentToolsForRole<TContext, TCapabilities extends object>(
	composition: AgentToolRoleComposition<TContext, TCapabilities>,
): PromptAwareAgentTool[] {
	const definitions = new Map(
		composition.definitions.map((definition) => [definition.name, definition]),
	);
	return toolContractsForRole(composition.role).map((contract) => {
		const definition = definitions.get(contract.name);
		if (definition === undefined)
			throw new Error(`Pi ${composition.role} roster is missing execution '${contract.name}'.`);
		return bindAgentTool(definition, composition.ports);
	});
}

/** Small hook for Pi hosts that preserve their existing run-observability envelope. */
export interface PiToolRunObserver {
	observeToolCall<T>(toolName: string, operation: () => Promise<T>): Promise<T>;
}

export function observeAgentTool<P extends TSchema, R>(
	tool: PromptAwareAgentTool<P, R>,
	observer: PiToolRunObserver,
): PromptAwareAgentTool<P, R> {
	return {
		...tool,
		execute: (toolCallId, params, signal, onUpdate) =>
			observer.observeToolCall(tool.name, () => tool.execute(toolCallId, params, signal, onUpdate)),
	};
}

export type PiMessageDelivery = "steer" | "followUp";
export function deliverPiMessage(
	send: (message: string, options: { deliverAs: PiMessageDelivery }) => void,
	message: string,
	deliverAs: PiMessageDelivery = "followUp",
): void {
	send(message, { deliverAs });
}
