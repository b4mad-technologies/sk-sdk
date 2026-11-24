import { snapshotDbFromFixture } from "@spellkave/sdk";
import {
	attachMapLayerToolDef,
	authorFacingToolDefinitions,
	mapGraphToolDef,
} from "@spellkave/tool-authoring";
import {
	bindTool,
	createToolRuntime,
	type NodeToolCapabilities,
	type ToolDefinition,
} from "@spellkave/tool-runtime";
import type { TSchema } from "typebox";
import { describe, expect, it } from "vitest";
import { type SpellkaveToolContext, spellkaveToolDefinitions } from "../tools";

type Definition = ToolDefinition<SpellkaveToolContext, TSchema, unknown, NodeToolCapabilities>;

function companionDefinition(name: string): Definition {
	const definition = spellkaveToolDefinitions.find((candidate) => candidate.name === name);
	if (definition === undefined) throw new Error(`missing companion definition ${name}`);
	return definition as Definition;
}

function authorDefinition(
	name: string,
): ToolDefinition<unknown, TSchema, unknown, NodeToolCapabilities> {
	const definition = authorFacingToolDefinitions.find((candidate) => candidate.name === name);
	if (definition === undefined) throw new Error(`missing AUTHOR definition ${name}`);
	return definition as ToolDefinition<unknown, TSchema, unknown, NodeToolCapabilities>;
}

describe("host capability-bound tool definitions", () => {
	it("keeps PLAYER reads portable and marks actual AUTHOR Node bodies", () => {
		for (const definition of [
			companionDefinition("spellkave_map"),
			companionDefinition("spellkave_orient"),
		]) {
			expect(definition.requiredCapabilities).toBeUndefined();
		}
		for (const definition of [
			authorDefinition("spellkave_export"),
			authorDefinition("spellkave_diff"),
			mapGraphToolDef,
			attachMapLayerToolDef,
		]) {
			expect(definition.requiredCapabilities).toEqual(["node"]);
		}
	});

	it("keeps portable PLAYER tools and omits Node-bound AUTHOR tools in browsers", () => {
		for (const [role, definition] of [
			["AUTHOR", authorDefinition("spellkave_export")],
			[
				"AUTHOR",
				mapGraphToolDef as ToolDefinition<unknown, TSchema, unknown, NodeToolCapabilities>,
			],
		] as const) {
			expect(
				createToolRuntime({
					role,
					context: {} as never,
					capabilities: {},
					definitions: [definition] as never,
				}),
			).toEqual([]);
		}
		for (const definition of [
			companionDefinition("spellkave_map"),
			companionDefinition("spellkave_orient"),
		]) {
			expect(
				createToolRuntime({
					role: "PLAYER",
					context: {} as never,
					capabilities: {},
					definitions: [definition] as never,
				}),
			).toHaveLength(1);
		}
	});

	it("executes an SVG map in a browser and reserves Node capability for JPEG", async () => {
		const definition = companionDefinition("spellkave_map");
		const context = {
			db: snapshotDbFromFixture({
				visible_manifest_authored_entity: [],
				visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
				world_time: [{ tick: 1n }],
			}),
			act: { actorId: "actor:map" },
		} as SpellkaveToolContext;
		await expect(
			bindTool(definition, { context, capabilities: {} }).execute("browser-map", {}),
		).resolves.toMatchObject({ details: { has_layout: false } });
		await expect(
			bindTool(definition, { context, capabilities: {} }).execute("browser-jpg", {
				output_type: "jpg",
			}),
		).rejects.toMatchObject({
			name: "ToolCapabilityUnavailableError",
			code: "tool_capability_unavailable",
			toolName: "spellkave_map",
			capability: "node",
		});
	});

	it("keeps orient's nested telemetry result path when Node composition supplies an emitter", async () => {
		const events: Array<{ kind: string; payload: Record<string, unknown> }> = [];
		const orient = companionDefinition("spellkave_orient");
		const result = await orient.run(
			{
				db: snapshotDbFromFixture({
					visible_manifest_authored_entity: [],
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					visible_entity_tag: [],
					visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
					world_time: [{ tick: 1n }],
				}),
				act: { actorId: "actor:orientation" },
			} as SpellkaveToolContext,
			{},
			"orient-node",
			{
				node: {
					filesystem: {} as never,
					map: {} as never,
					telemetry: {
						createRunEmitter: () => ({ emit: (kind, payload) => events.push({ kind, payload }) }),
					},
				},
			},
		);
		expect(result).toMatchObject({ details: { actorId: "actor:orientation" } });
		expect(events.some((event) => event.kind === "tool_call")).toBe(true);
	});
});
