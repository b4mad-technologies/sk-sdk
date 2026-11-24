import { getToolParameters, type ToolRole } from "@spellkave/tool-contracts";
import type { TSchema } from "typebox";
import { describe, expect, it } from "vitest";

import {
	type AuthoringOperationPort,
	coordinateWorldDeltas,
	createToolRuntime,
	createWorldDeltaTracker,
	defineTool,
	renderWorldEventLine,
	shapeConsequences,
	ToolArgumentValidationError,
	type ToolCapabilityUnavailableError,
	type ToolDefinition,
	type WorldEvent,
	type WorldEventCoordinatorPort,
	type WorldProjectionPort,
	type WorldSessionPort,
} from "../index";

type PublicReader = {
	readSelfSummary(): { actorId: string; location: string };
	readWorldStatus(): { tick: number; phase: string };
};
type TestCapabilities = {
	sdk?: WorldSessionPort<PublicReader> & WorldProjectionPort<PublicReader, PublicReader>;
	author?: AuthoringOperationPort<{ query: string }, { document: string; excerpt: string }>;
};
type TestContext = { host: "browser" | "node" };
type RuntimeDefinition = ToolDefinition<TestContext, TSchema, unknown, TestCapabilities>;

function projection(capabilities: TestCapabilities): PublicReader | undefined {
	const sdk = capabilities.sdk;
	const session = sdk?.currentSession();
	return sdk === undefined || session === undefined ? undefined : sdk.project(session);
}

function definition(
	name: string,
	requiredCapabilities?: readonly (keyof TestCapabilities & string)[],
): RuntimeDefinition {
	return defineTool<TestContext, TSchema, unknown, TestCapabilities>({
		contract: name,
		schema: getToolParameters(name),
		...(requiredCapabilities === undefined ? {} : { requiredCapabilities }),
		run: async (context, params, toolCallId, capabilities) => ({
			context,
			params,
			toolCallId,
			capabilities,
		}),
	});
}

const playerContractName = "spellkave_self_summary";
const dmContractName = "spellkave_status";
const authorContractName = "spellkave_docs";
const playerDefinition = defineTool<TestContext, TSchema, unknown, TestCapabilities>({
	contract: playerContractName,
	schema: getToolParameters(playerContractName),
	requiredCapabilities: ["sdk"],
	run: async (context, _params, toolCallId, capabilities = {}) => ({
		kind: "self_summary",
		toolCallId,
		host: context.host,
		self: projection(capabilities)?.readSelfSummary(),
	}),
});
const dmDefinition = defineTool<TestContext, TSchema, unknown, TestCapabilities>({
	contract: dmContractName,
	schema: getToolParameters(dmContractName),
	requiredCapabilities: ["sdk"],
	run: async (context, _params, toolCallId, capabilities = {}) => ({
		kind: "world_status",
		toolCallId,
		host: context.host,
		status: projection(capabilities)?.readWorldStatus(),
	}),
});
const authorDefinition = defineTool<TestContext, TSchema, unknown, TestCapabilities>({
	contract: authorContractName,
	schema: getToolParameters(authorContractName),
	requiredCapabilities: ["author"],
	run: async (context, params, toolCallId, capabilities = {}) => ({
		kind: "author_docs",
		toolCallId,
		host: context.host,
		docs: await capabilities.author?.execute({
			query: (params as { query?: string }).query ?? "onramp",
		}),
	}),
});
const representativeRoles: readonly [ToolRole, string, RuntimeDefinition][] = [
	["PLAYER", playerContractName, playerDefinition],
	["DM", dmContractName, dmDefinition],
	["AUTHOR", authorContractName, authorDefinition],
];

function publicCapabilities(): TestCapabilities {
	return {
		sdk: {
			currentSession: () => ({
				readSelfSummary: () => ({ actorId: "actor:player-1", location: "Neverwinter Wood" }),
				readWorldStatus: () => ({ tick: 42, phase: "exploration" }),
			}),
			project: (session) => session,
		},
		author: {
			execute: async ({ query }) => ({ document: "manifest-format", excerpt: `docs for ${query}` }),
		},
	};
}

describe("tool runtime", () => {
	it.each([
		"browser",
		"node",
	] as const)("binds realistic PLAYER, DM, and AUTHOR exported structural ports in a %s host", async (host) => {
		for (const [role, name, tool] of representativeRoles) {
			const runtime = createToolRuntime({
				role,
				context: { host },
				capabilities: publicCapabilities(),
				definitions: [tool],
			});
			expect(runtime).toHaveLength(1);
			const params = name === authorContractName ? { query: "manifest" } : {};
			await expect(runtime[0]?.execute(`${role}-${host}`, params)).resolves.toMatchSnapshot();
		}
	});

	it("does not expose a capability-bound contract when a browser host lacks that port", () => {
		expect(
			createToolRuntime({
				role: "PLAYER",
				context: { host: "browser" },
				capabilities: {},
				definitions: [playerDefinition, authorDefinition],
			}),
		).toEqual([]);
	});

	it("fails a direct unsupported composition with the documented capability error", async () => {
		const runtime = createToolRuntime({
			role: "PLAYER",
			context: { host: "browser" },
			capabilities: {},
			definitions: [definition("spellkave_self_summary", ["sdk"])],
		});
		expect(runtime).toEqual([]);
		const direct = definition("spellkave_self_summary", ["sdk"]);
		const { bindTool } = await import("../index");
		await expect(
			bindTool(direct, { context: { host: "browser" }, capabilities: {} }).execute("browser", {}),
		).rejects.toMatchObject({
			name: "ToolCapabilityUnavailableError",
			code: "tool_capability_unavailable",
			toolName: "spellkave_self_summary",
			capability: "sdk",
		} satisfies Partial<ToolCapabilityUnavailableError>);
	});

	it("rejects invalid canonical arguments before dispatch", async () => {
		const runtime = createToolRuntime({
			role: "PLAYER",
			context: { host: "node" },
			capabilities: publicCapabilities(),
			definitions: [definition("spellkave_scene", ["sdk"])],
		});
		await expect(runtime[0]?.execute("invalid", { limit: 0 } as never)).rejects.toBeInstanceOf(
			ToolArgumentValidationError,
		);
	});

	it("serially shapes a result with only consequences caused by the caller", async () => {
		let buffered: WorldEvent[] = [
			{
				kind: "dealt_hit",
				target_name: "Goblin",
				amount: 7,
				attacker_id: "actor:player-1",
				observed_at_tick: 42,
			},
			{
				kind: "speech_heard",
				inscribed_at: 42,
				trace_id: "trace-1",
				trace_kind: "speech",
				text: "Behind you!",
				inscribed_by: null,
				inscribed_by_name: null,
				location_kind: "place",
				location_ref: "wood",
				observed_at_tick: 42,
			},
		];
		const consequences: WorldEventCoordinatorPort = {
			actorEntityId: "actor:player-1",
			tick: 42,
			source: {
				takeWhere: (predicate) => {
					const taken = buffered.filter(predicate);
					buffered = buffered.filter((event) => !predicate(event));
					return taken;
				},
			},
		};
		const runtime = createToolRuntime({
			role: "PLAYER",
			context: { host: "node" },
			capabilities: publicCapabilities(),
			definitions: [playerDefinition],
			consequences,
		});
		await expect(runtime[0]?.execute("event", {})).resolves.toMatchSnapshot();
		expect(shapeConsequences({ receipt: "next" }, consequences)).toMatchSnapshot();
		expect(
			renderWorldEventLine({
				kind: "dealt_hit",
				target_name: "Goblin",
				amount: 7,
				attacker_id: "actor:player-1",
				observed_at_tick: 42,
			}),
		).toBe("🌍 You hit Goblin for 7 damage.");
	});

	it("coordinates a projected delta source and appends without rewriting primary content", () => {
		let projection = {
			scene: [],
			affordance: [{ fingerprint: "manipulate|Attack|entity:9", name: "Attack → Goblin" }],
			inventory: [],
			trace: [],
			self: [],
		};
		const tracker = createWorldDeltaTracker({ sample: () => projection });
		const coordinator = {
			tracker,
			contentFor: (deltas: object) => JSON.stringify({ world_deltas: deltas }),
		};
		expect(
			coordinateWorldDeltas(
				{ content: ["primary"], details: { receipt: { status: "success" } } },
				{ receiptAttributable: true },
				coordinator,
			),
		).toEqual({ content: ["primary"], details: { receipt: { status: "success" } } });
		projection = {
			...projection,
			affordance: [
				...projection.affordance,
				{ fingerprint: "manipulate|Bandage|entity:9", name: "Bandage → Goblin" },
			],
		};
		expect(
			coordinateWorldDeltas(
				{ content: ["primary"], details: { receipt: { status: "success" } } },
				{ receiptAttributable: true },
				coordinator,
			),
		).toMatchSnapshot();
	});
});

describe("live registry authority", () => {
	it("revalidates a cached descriptor after revoke and missing-port changes", async () => {
		let ids = ["frontier.read_hidden"];
		let ports = ["readInstance"];
		let calls = 0;
		const def = defineTool({
			contract: "spellkave_get",
			schema: getToolParameters("spellkave_get"),
			run: async () => {
				calls++;
				return { ok: true };
			},
		});
		const composition = {
			context: {},
			capabilities: {},
			definitions: [def],
			authority: () => ({
				character: false,
				publisher: false,
				capabilities: ids,
				bodyCapabilities: [ids],
				roles: [],
			}),
			availablePorts: () => ports,
		};
		const tools = createToolRuntime(composition);
		expect(tools).toHaveLength(1);
		await tools[0]?.execute("first", { kind: "entities" });
		ids = [];
		await expect(tools[0]?.execute("stale", { kind: "entities" })).rejects.toThrow(
			"authority_unavailable",
		);
		expect(createToolRuntime(composition)).toEqual([]);
		ids = ["frontier.read_hidden"];
		ports = [];
		await expect(tools[0]?.execute("missing-port", { kind: "entities" })).rejects.toThrow(
			"authority_unavailable",
		);
		expect(calls).toBe(1);
	});
});
