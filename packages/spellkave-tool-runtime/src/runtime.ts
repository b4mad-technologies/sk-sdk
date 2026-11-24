import {
	admitsTool,
	getToolContract,
	type LiveToolAuthority,
	type ToolContract,
	type ToolRole,
} from "@spellkave/tool-contracts";
import type { Static, TSchema } from "typebox";
import { Check, Errors } from "typebox/value";
import { ToolCapabilityUnavailableError } from "./capabilities";
import { shapeConsequences, type WorldEventCoordinatorPort } from "./world-events";

/**
 * A host-neutral execution body for one canonical contract. The context and
 * capability ports are supplied only when a host binds the definition; this
 * package never constructs SDK, authoring, filesystem, telemetry, or transport
 * implementations itself.
 */
export interface ToolExecutionDefinition<
	TContext,
	P extends TSchema,
	TResult,
	TCapabilities extends object = Record<string, unknown>,
> {
	contract: string;
	/** A schema structurally identical to the TypeBox schema owned by tool-contracts. */
	schema: P;
	/** Capability keys a host must provide before this definition is exposed. */
	requiredCapabilities?: readonly (keyof TCapabilities & string)[];
	run: (
		context: TContext,
		params: Static<P>,
		toolCallId: string,
		capabilities?: TCapabilities,
	) => Promise<TResult>;
	/** Optional worked-example parameters consumed by host-side doc builders. */
	exampleParams?: Static<P>;
}

/** Structural authoring operation port; concrete world-author operations stay host-owned. */
export interface AuthoringOperationPort<TInput, TResult> {
	execute(input: TInput): Promise<TResult>;
}

/** A canonical descriptor joined with an executable body. */
export interface ToolDefinition<
	TContext,
	P extends TSchema,
	TResult,
	TCapabilities extends object = Record<string, unknown>,
> extends Omit<ToolContract, "parameters">,
		ToolExecutionDefinition<TContext, P, TResult, TCapabilities> {
	parameters: P;
}

/** The portable tool shape consumed by adapters; it is deliberately not Pi's AgentTool. */
export interface BoundTool<P extends TSchema, TResult> extends Omit<ToolContract, "parameters"> {
	parameters: P;
	execute: (toolCallId: string, params: Static<P>) => Promise<TResult>;
}

export interface ToolArgumentIssue {
	path: string;
	message: string;
}

/** Raised before an execution body receives invalid TypeBox arguments. */
export class ToolArgumentValidationError extends Error {
	readonly toolName: string;
	readonly issues: readonly ToolArgumentIssue[];

	constructor(toolName: string, issues: readonly ToolArgumentIssue[]) {
		super(`Invalid arguments for '${toolName}'.`);
		this.name = "ToolArgumentValidationError";
		this.toolName = toolName;
		this.issues = issues;
	}
}

export interface ToolResultInvocation<TContext, TCapabilities> {
	contract: ToolContract;
	context: TContext;
	capabilities: TCapabilities;
	toolCallId: string;
}

/**
 * Optional host-owned world-event coordination. It is deliberately only a
 * result hook: event acquisition, subscriptions, and transport remain in the
 * SDK and host adapters, while the runtime can coordinate their result shape.
 */
export interface WorldEventPort<TContext, TCapabilities, TResult> {
	afterToolResult: (
		result: TResult,
		invocation: ToolResultInvocation<TContext, TCapabilities>,
	) => TResult | Promise<TResult>;
}

export interface ToolRuntimePorts<TContext, TCapabilities extends object, TResult> {
	context: TContext;
	capabilities: TCapabilities;
	/**
	 * A host-owned, serial event-delta source. When present, the runtime adds
	 * the attributable events to the one tool result before any host adapter
	 * observes it. SDK subscriptions and buffering stay behind this port.
	 */
	consequences?: WorldEventCoordinatorPort;
	worldEvents?: WorldEventPort<TContext, TCapabilities, TResult>;
	/**
	 * Transitional escape hatch for adapters that already validate before they
	 * invoke a tool. New runtime compositions use the default true value.
	 */
	validateArguments?: boolean;
}

export interface ToolRuntimeComposition<TContext, TCapabilities extends object> {
	role?: ToolRole;
	/** Live authority takes precedence over the offline presentation preset. */
	authority?: () => LiveToolAuthority;
	availablePorts?: () => readonly string[];
	context: TContext;
	capabilities: TCapabilities;
	definitions: readonly ToolDefinition<TContext, TSchema, unknown, TCapabilities>[];
	consequences?: WorldEventCoordinatorPort;
	worldEvents?: WorldEventPort<TContext, TCapabilities, unknown>;
}

function isCapabilityPresent(capabilities: object, name: string): boolean {
	return (
		Object.hasOwn(capabilities, name) &&
		(capabilities as Record<string, unknown>)[name] !== undefined
	);
}

function assertCanonicalSchema<P extends TSchema>(contract: ToolContract, schema: P): void {
	if (JSON.stringify(contract.parameters) !== JSON.stringify(schema)) {
		throw new Error(
			`Tool '${contract.name}' must bind the TypeBox schema exported by @spellkave/tool-contracts.`,
		);
	}
}

/**
 * Join an execution body to its canonical descriptor without duplicating a
 * schema, name, description, roster, or execution mode in a host package.
 */
export function defineTool<
	TContext,
	P extends TSchema,
	TResult,
	TCapabilities extends object = Record<string, unknown>,
>(
	definition: ToolExecutionDefinition<TContext, P, TResult, TCapabilities>,
): ToolDefinition<TContext, P, TResult, TCapabilities> {
	const contract = getToolContract(definition.contract);
	assertCanonicalSchema(contract, definition.schema);
	// Contract metadata owns the runtime schema. Some pre-cut companion
	// constants are structurally identical aliases (for example empty-object
	// parameters), so equality is semantic rather than object identity.
	return { ...contract, ...definition, parameters: contract.parameters as P };
}

function assertValidArguments<P extends TSchema>(
	tool: Pick<BoundTool<P, unknown>, "name" | "parameters">,
	params: unknown,
): asserts params is Static<P> {
	if (Check(tool.parameters, params)) return;
	const issues = [...Errors(tool.parameters, params)].map((issue) => ({
		path: "path" in issue && typeof issue.path === "string" ? issue.path : "",
		message: issue.message,
	}));
	throw new ToolArgumentValidationError(tool.name, issues);
}

/**
 * Bind one definition to explicit context and capability ports. The bound
 * function remains transport-neutral and can be adapted to Pi, MCP, CLI, or a
 * browser host without importing those packages here.
 */
export function bindTool<
	TContext,
	P extends TSchema,
	TResult,
	TCapabilities extends object = Record<string, unknown>,
>(
	definition: ToolDefinition<TContext, P, TResult, TCapabilities>,
	ports: ToolRuntimePorts<TContext, TCapabilities, TResult>,
): BoundTool<P, TResult> {
	const { context, capabilities, consequences, worldEvents, validateArguments = true } = ports;
	return {
		name: definition.name,
		label: definition.label,
		description: definition.description,
		executionMode: definition.executionMode,
		roles: definition.roles,
		...(definition.promptSnippet === undefined ? {} : { promptSnippet: definition.promptSnippet }),
		...(definition.promptGuidelines === undefined
			? {}
			: { promptGuidelines: definition.promptGuidelines }),
		...(definition.cli === undefined ? {} : { cli: definition.cli }),
		parameters: definition.parameters,
		admission: definition.admission,
		execute: async (toolCallId, params) => {
			const unavailable = (definition.requiredCapabilities ?? []).find(
				(name) => !isCapabilityPresent(capabilities, name),
			);
			if (unavailable !== undefined)
				throw new ToolCapabilityUnavailableError(definition.name, unavailable);
			if (validateArguments) assertValidArguments(definition, params);
			const result = await definition.run(context, params, toolCallId, capabilities);
			const shaped =
				consequences === undefined
					? result
					: (shapeConsequences(result as object, consequences) as TResult);
			if (worldEvents === undefined) return shaped;
			return worldEvents.afterToolResult(shaped, {
				contract: definition,
				context,
				capabilities,
				toolCallId,
			});
		},
	};
}

/**
 * Compose an authorized role roster. A definition is hidden unless its
 * contract authorizes the caller role and every declared capability port is
 * available. Missing ports never cause conditional Node imports.
 */
export function createToolRuntime<TContext, TCapabilities extends object>(
	composition: ToolRuntimeComposition<TContext, TCapabilities>,
): BoundTool<TSchema, unknown>[] {
	return composition.definitions
		.filter((definition) =>
			composition.authority === undefined
				? composition.role !== undefined && definition.roles.includes(composition.role)
				: admitsTool(
						definition.admission,
						composition.authority(),
						composition.availablePorts?.() ?? Object.keys(composition.capabilities),
					),
		)
		.filter((definition) =>
			(definition.requiredCapabilities ?? []).every((name) =>
				isCapabilityPresent(composition.capabilities, name),
			),
		)
		.map((definition) =>
			bindTool(
				{
					...definition,
					run: async (...args) => {
						if (
							composition.authority !== undefined &&
							!admitsTool(
								definition.admission,
								composition.authority(),
								composition.availablePorts?.() ?? Object.keys(composition.capabilities),
							)
						)
							throw new Error(`authority_unavailable: '${definition.name}' is no longer admitted`);
						return definition.run(...args);
					},
				},
				{
					context: composition.context,
					capabilities: composition.capabilities,
					...(composition.consequences === undefined
						? {}
						: { consequences: composition.consequences }),
					...(composition.worldEvents === undefined
						? {}
						: { worldEvents: composition.worldEvents }),
				},
			),
		);
}
