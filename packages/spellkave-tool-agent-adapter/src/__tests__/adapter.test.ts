import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import { TOOL_CONTRACTS, TOOL_ROLE_ROSTERS, type ToolRole } from "@spellkave/tool-contracts";
import { type BoundTool, defineTool, type ToolDefinition } from "@spellkave/tool-runtime";
import { type TSchema, Type } from "typebox";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
	createAgentToolsForRole,
	deliverPiMessage,
	observeAgentTool,
	type PromptAwareAgentTool,
	toAgentToolMap,
} from "../index";

type Context = { host: "pi" };
type Definition = ToolDefinition<Context, TSchema, AgentToolResult<unknown>, Record<string, never>>;

const definitions: Definition[] = TOOL_CONTRACTS.map((contract) =>
	defineTool<Context, TSchema, AgentToolResult<unknown>>({
		contract: contract.name,
		schema: contract.parameters,
		run: async (_context, params, toolCallId) => ({
			content: [{ type: "text", text: JSON.stringify({ toolCallId, params }) }],
			details: { toolCallId, params },
		}),
	}),
);

function roleTools(role: ToolRole) {
	return createAgentToolsForRole({
		role,
		definitions,
		ports: { context: { host: "pi" }, capabilities: {} },
	});
}

function contractFor(name: string) {
	const contract = TOOL_CONTRACTS.find((candidate) => candidate.name === name);
	if (contract === undefined) throw new Error(`Missing contract '${name}'.`);
	return contract;
}

const mapParameters = Type.Object({ value: Type.String() });
type MapResult = AgentToolResult<{ echoed: string }>;
const mapBoundTool = {
	name: "map_test",
	label: "Map test",
	description: "A typed map-adapter test tool.",
	parameters: mapParameters,
	executionMode: "parallel",
	roles: [],
	execute: async (_toolCallId, params) => ({
		content: [{ type: "text", text: params.value }],
		details: { echoed: params.value },
	}),
} satisfies BoundTool<typeof mapParameters, MapResult>;

describe("Pi adapter contract parity", () => {
	it.each([
		"PLAYER",
		"DM",
		"AUTHOR",
	] as const)("preserves the complete %s roster, schemas, and execution routing", async (role) => {
		const tools = roleTools(role);
		expect(tools.map((tool) => tool.name)).toEqual(TOOL_ROLE_ROSTERS[role]);
		for (const tool of tools) {
			const contract = contractFor(tool.name);
			expect(tool.parameters).toBe(contract.parameters);
			expect(tool.executionMode).toBe(contract.executionMode);
			await expect(tool.execute(`${role}:${tool.name}`, {} as never)).resolves.toMatchObject({
				details: { toolCallId: `${role}:${tool.name}` },
			});
		}
	});

	it("preserves prompt metadata without adding undefined keys", () => {
		for (const tool of roleTools("PLAYER")) {
			const contract = contractFor(tool.name);
			expect(tool.promptSnippet).toBe(contract.promptSnippet);
			expect(tool.promptGuidelines).toEqual(contract.promptGuidelines);
		}
	});

	it("converts keyed bound tools while preserving keys, schemas, and result details", async () => {
		const tools = toAgentToolMap({ first: mapBoundTool, second: mapBoundTool });
		expectTypeOf(tools).toEqualTypeOf<{
			first: PromptAwareAgentTool<typeof mapParameters, { echoed: string }>;
			second: PromptAwareAgentTool<typeof mapParameters, { echoed: string }>;
		}>();
		expect(Object.keys(tools)).toEqual(["first", "second"]);
		expect(tools.first.parameters).toBe(mapParameters);
		await expect(tools.second.execute("map", { value: "preserved" })).resolves.toMatchObject({
			details: { echoed: "preserved" },
		});
	});

	it("keeps host run-observability success and error envelopes intact", async () => {
		const tool = roleTools("PLAYER")[0];
		if (tool === undefined) throw new Error("PLAYER roster must not be empty.");
		const observer = { observeToolCall: vi.fn(async (_name, operation) => operation()) };
		const observed = observeAgentTool(tool, observer);
		expect((await observed.execute("observed", {} as never)).details).toEqual({
			toolCallId: "observed",
			params: {},
		});
		expect(observer.observeToolCall).toHaveBeenCalledWith(tool.name, expect.any(Function));
		await expect(
			observeAgentTool(
				{ ...tool, execute: async () => Promise.reject(new Error("boom")) },
				observer,
			).execute("failed", {} as never),
		).rejects.toThrow("boom");
	});

	it("keeps steer and follow-up delivery explicit at the host seam", () => {
		const send = vi.fn();
		deliverPiMessage(send, "next");
		deliverPiMessage(send, "now", "steer");
		expect(send).toHaveBeenNthCalledWith(1, "next", { deliverAs: "followUp" });
		expect(send).toHaveBeenNthCalledWith(2, "now", { deliverAs: "steer" });
	});
});
