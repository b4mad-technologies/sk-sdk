import {
	type CallToolResult,
	fromJsonSchema,
	type JsonSchemaType,
	McpServer,
} from "@modelcontextprotocol/server";
import { resolveDocsResult } from "@spellkave/tool-authoring";
import {
	AUTHOR_TOOL_CONTRACTS,
	DOCS_TOOL,
	type DocsVersionEvidence,
	getToolContract,
	PLAYER_TOOL_CONTRACTS,
	type ToolContract,
} from "@spellkave/tool-contracts";
import { DOCS_PARAMS } from "@spellkave/tool-contracts/schemas";
import { Value } from "typebox/value";

import {
	FEEDBACK_TOOL_DESCRIPTION,
	FEEDBACK_TOOL_INPUT_SCHEMA,
	SPELLKAVE_FEEDBACK_TOOL,
} from "./feedback-constants.ts";

// GHSA-46jr-4wx8-v453: count array entries and object members before schema validation.
// PLAYER/feedback: twice the 32 KiB diagnostic section's maximum JSON element density.
export const PLAYER_MCP_MAX_INPUT_ELEMENTS = 32_768;
// 10x the largest parsed manifest in the 1,921-file SRD/adventure corpus (27,503).
// Portable-source TOML stays a string; 128 fragments add only 387 source elements.
export const AUTHOR_MCP_MAX_INPUT_ELEMENTS = 275_030;

export const PLAYER_MCP_SERVER_INFO = {
	name: "spellkave-player",
	version: "0.0.0",
} as const;

/**
 * sk-0m4.120.13: the deployed revision as the MCP server version. The deployment
 * supplies `SPELLKAVE_IMAGE_TAG` (e.g. `sha-919f9ae5`) into the gateway
 * container, so `initialize`, the feedback bundle's `versions.gateway`, and
 * the triage postscript's `observed-base` all name the same commit. Local
 * dev without the variable keeps the `0.0.0` literal — an honest "unknown".
 */
export function playerMcpServerInfo(env: NodeJS.ProcessEnv = process.env): {
	name: string;
	version: string;
} {
	const tag = env.SPELLKAVE_IMAGE_TAG?.trim();
	return { name: PLAYER_MCP_SERVER_INFO.name, version: tag || PLAYER_MCP_SERVER_INFO.version };
}

export const PLAYER_MCP_PROMPT_SNIPPET_META_KEY = "spellkave/promptSnippet";
export const PLAYER_MCP_PROMPT_GUIDELINES_META_KEY = "spellkave/promptGuidelines";

/**
 * MCP InitializeResult.instructions — how to play this staged-push world
 * (sk-gejh). Compact English for the client model at connect time.
 */
export const PLAYER_MCP_INITIALIZE_INSTRUCTIONS = [
	"spellkave_docs serves curated public help without a character or author grant; search with query, then retrieve the returned doc ID. Help never grants world authority.",
	"Spellkave is a persistent live game world. NPCs and the DM keep acting asynchronously even when you do nothing.",
	"There are no out-of-band push messages. Fresh world news reaches you only on your next tool call: changes caused by OTHER actors or the world (you were hit, a reaction window opened, someone spoke, XP landed) arrive as world_events attached to that response; changes caused by your OWN action arrive as its consequences / world_deltas.",
	"After an action whose outcome you still need (for example a DM confirmation), call a suitable look/status tool again instead of telling the player it is impossible or 'not processed yet'.",
	"The word session in tool names and answers means the in-world turn/scene session, not your MCP connection.",
	"no_session only means there is no turn-based scene open right now — exploration and character setup still work.",
	"spellkave_feedback records player bug/confusing/idea notes. Always ask the player before attaching the diagnostic report (include_report).",
].join("\n");

export type PlayerMcpToolHandler = (
	toolName: string,
	args: unknown,
) => CallToolResult | Promise<CallToolResult>;

/**
 * The Remote MCP projection of the host-neutral PLAYER registry. No tool name,
 * description, schema, order, or prompt hint is re-authored in this package.
 * Gateway-local ops tools (today: spellkave_feedback) are registered separately.
 */
export function mcpToolDescriptors(contracts: readonly ToolContract[]) {
	return contracts.map((definition) => ({
		name: definition.name,
		title: definition.label,
		description: definition.description,
		inputSchema: fromJsonSchema(definition.parameters as JsonSchemaType),
		_meta: {
			...(definition.promptSnippet === undefined
				? {}
				: { [PLAYER_MCP_PROMPT_SNIPPET_META_KEY]: definition.promptSnippet }),
			...(definition.promptGuidelines === undefined
				? {}
				: { [PLAYER_MCP_PROMPT_GUIDELINES_META_KEY]: definition.promptGuidelines }),
		},
	}));
}

export const playerMcpToolDescriptors = mcpToolDescriptors(PLAYER_TOOL_CONTRACTS);

// Product help is offered independently of world/character/authority ports.
// Reuse the AUTHOR contract without offering any of its mutation operations.
export const publicDocsMcpToolDescriptors = AUTHOR_TOOL_CONTRACTS.filter(
	(definition) => definition.name === DOCS_TOOL,
).map((definition) => ({
	name: definition.name,
	title: definition.label,
	description: definition.description,
	inputSchema: fromJsonSchema(definition.parameters as JsonSchemaType),
}));

/** Gateway-local PLAYER ops tools (not part of the companion gameplay registry). */
export const playerMcpGatewayToolDescriptors = [
	{
		name: SPELLKAVE_FEEDBACK_TOOL,
		title: "Spellkave Feedback",
		description: FEEDBACK_TOOL_DESCRIPTION,
		inputSchema: fromJsonSchema(FEEDBACK_TOOL_INPUT_SCHEMA as unknown as JsonSchemaType),
		_meta: {
			[PLAYER_MCP_PROMPT_SNIPPET_META_KEY]:
				"Ask the player for consent before include_report=true; return the reference id.",
		},
	},
] as const;

/** Build one fresh SDK server for one stateless Streamable HTTP request. */
export function createPlayerMcpServer(
	handler: PlayerMcpToolHandler,
	serverInfo: { name: string; version: string } = playerMcpServerInfo(),
	toolNames?: readonly string[],
	docsVersionEvidence?: Readonly<DocsVersionEvidence>,
	requestedToolName?: string,
): McpServer {
	const requestNames = requestedToolName === undefined ? (toolNames ?? []) : [requestedToolName];
	const authorRequest = requestNames.some((name) =>
		AUTHOR_TOOL_CONTRACTS.some((tool) => tool.name === name && name !== DOCS_TOOL),
	);
	const server = new McpServer(serverInfo, {
		maxToolInputElements: authorRequest
			? AUTHOR_MCP_MAX_INPUT_ELEMENTS
			: PLAYER_MCP_MAX_INPUT_ELEMENTS,
		instructions: PLAYER_MCP_INITIALIZE_INSTRUCTIONS,
	});
	for (const descriptor of publicDocsMcpToolDescriptors) {
		server.registerTool(descriptor.name, descriptor, (args) => {
			const details = resolveDocsResult(Value.Parse(DOCS_PARAMS, args), docsVersionEvidence);
			return {
				content: [{ type: "text" as const, text: JSON.stringify(details) }],
				isError: "ok" in details && details.ok === false,
			};
		});
	}
	for (const descriptor of toolNames === undefined
		? playerMcpToolDescriptors
		: mcpToolDescriptors(toolNames.filter((name) => name !== DOCS_TOOL).map(getToolContract))) {
		server.registerTool(
			descriptor.name,
			{
				title: descriptor.title,
				description: descriptor.description,
				inputSchema: descriptor.inputSchema,
				_meta: descriptor._meta,
			},
			(args) => handler(descriptor.name, args),
		);
	}
	for (const descriptor of playerMcpGatewayToolDescriptors) {
		server.registerTool(
			descriptor.name,
			{
				title: descriptor.title,
				description: descriptor.description,
				inputSchema: descriptor.inputSchema,
				_meta: descriptor._meta,
			},
			(args) => handler(descriptor.name, args),
		);
	}
	return server;
}
