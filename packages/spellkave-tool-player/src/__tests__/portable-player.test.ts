import { snapshotDbFromFixture as admittedFixtureSource } from "@spellkave/sdk";
import { DM_TOOL_NAMES, PLAYER_TOOL_NAMES } from "@spellkave/tool-contracts";
import { describe, expect, it } from "vitest";
import { decodeCursor, encodeCursor } from "../query-protocol.ts";
import {
	contextActorId,
	createMapTool,
	createOrientTool,
	createPlayerFacingToolMap,
	DM_EXTENSION_TOOL_NAMES,
	dmExtensionToolDefinitions,
	PLAYER_FACING_TOOL_NAMES,
	perceive,
	playerFacingToolDefinitions,
	type SpellkaveToolContext,
	spellkaveToolDefinitions,
} from "../tools.ts";

describe("portable PLAYER and DM ownership", () => {
	it("exposes typed attempts and factual discovery without the retired palette API", () => {
		const names = spellkaveToolDefinitions.map((tool) => tool.name);
		expect(names).toEqual(
			expect.arrayContaining([
				"spellkave_manipulate",
				"spellkave_manipulation_context",
				"spellkave_communicate",
				"spellkave_move",
				"spellkave_sense",
				"spellkave_sense_context",
				"spellkave_react_option",
			]),
		);
		for (const retired of [
			"spellkave_act_affordance",
			"spellkave_affordances",
			"spellkave_affordance_verbs",
			"spellkave_affordance_targets",
			"spellkave_affordance_actions",
			"spellkave_subscribe_affordance_cache",
		])
			expect(names).not.toContain(retired);
	});

	it("derives both execution rosters from canonical contracts", () => {
		expect(PLAYER_FACING_TOOL_NAMES).toEqual(PLAYER_TOOL_NAMES);
		expect(DM_EXTENSION_TOOL_NAMES).toEqual(DM_TOOL_NAMES);
		expect(playerFacingToolDefinitions.map((tool) => tool.name)).toEqual(PLAYER_TOOL_NAMES);
		expect(dmExtensionToolDefinitions.map((tool) => tool.name)).toEqual(DM_TOOL_NAMES);
		expect(new Set(spellkaveToolDefinitions.map((tool) => tool.name)).size).toBe(
			spellkaveToolDefinitions.length,
		);
		expect(
			[...playerFacingToolDefinitions, ...dmExtensionToolDefinitions].flatMap(
				(tool) => tool.requiredCapabilities ?? [],
			),
		).toEqual([]);
	});

	it("round-trips Unicode cursors without Buffer", () => {
		const cursor = encodeCursor("trace", "revision/Grüße/洞窟", 23);
		expect(cursor).not.toMatch(/[+/=]/);
		expect(decodeCursor(cursor, "trace", "revision/Grüße/洞窟")).toBe(23);
	});

	it("executes the former Node-gated PLAYER reads with browser defaults", async () => {
		const context = {
			db: admittedFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
				world_time: [{ tick: 1n }],
			}),
			act: { actorId: "actor:browser" },
		} as SpellkaveToolContext;
		await expect(createMapTool(context).execute("browser-map", {})).resolves.toMatchObject({
			details: { has_layout: false },
		});
		await expect(createOrientTool(context).execute("browser-orient", {})).resolves.toMatchObject({
			details: { actorId: "actor:browser" },
		});
		await expect(
			createPlayerFacingToolMap(context).map.execute("browser-invalid", {
				output_type: "png",
			} as never),
		).rejects.toMatchObject({
			name: "ToolArgumentValidationError",
			toolName: "spellkave_map",
		});
	});

	it("includes factored manipulation facts in a PLAYER perception without an affordance pair", async () => {
		const context = {
			db: admittedFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
				world_time: [{ tick: 1n }],
				entity: [{ entityId: 1n, name: "Actor" }],
				visible_manipulation_context: [
					{ perceiverEntityId: 1n, schemaVersion: 1, revision: 3n, ready: true },
				],
				action_definition: [
					{ actionId: "author/open", displayName: "Open", selfOnly: false, selfEligible: false },
				],
				outcome_template: [
					{ outcomeTemplateId: "author/open/outcome", manipulationActionId: "author/open" },
				],
				visible_manipulation_available_action: [
					{
						perceiverEntityId: 1n,
						actionId: "author/open",
						templateIds: ["author/open/template"],
						nicheIds: [],
					},
				],
				visible_manipulation_observed_target: [
					{
						targetFactId: "target:1:item:2",
						perceiverEntityId: 1n,
						targetRef: { tag: "Item", value: 2n },
						nicheIds: [],
					},
				],
				// ADR-0142 D-6: an open dialogue prompt addressed to this actor.
				visible_manipulation_prompt: [
					{
						promptFactId: "prompt:1:101",
						perceiverEntityId: 1n,
						occurrenceId: 101n,
						promptDefId: "dm/creation/class",
						contractVersion: 1,
						sourceRef: "entity:3",
						responseActionIds: ["dm/dialog/choice/1"],
						openedAtTick: 1n,
						consumed: false,
					},
				],
				// ADR-0142 D-6 follow-up: authored question/response-label presentation.
				public_metadata_attachment: [
					{
						rowId: 1n,
						targetKind: "prompt_definition",
						targetRef: "dm/creation/class",
						namespace: "dialogue.prompt",
						payloadJson: JSON.stringify({
							question: "Which class?",
							responses: { "dm/dialog/choice/1": "Barbarian" },
						}),
						audience: "public",
						bundleId: "dm",
						source: "manifest",
						setAtTick: 0n,
					},
				],
			}),
			act: { actorId: "1" },
		} as SpellkaveToolContext;
		const view = await perceive("1", createPlayerFacingToolMap(context), { emit: () => {} });
		expect(contextActorId(context)).toBe("entity:1");
		expect(view).toMatchObject({
			kind: "turn",
			manipulationContext: {
				status: "ready",
				schemaVersion: 1,
				revision: 3,
				actions: [{ actionId: "author/open" }],
				targets: [{ targetRef: "item:2" }],
				prompts: [
					{
						occurrenceId: "101",
						promptDefId: "dm/creation/class",
						contractVersion: 1,
						sourceRef: "entity:3",
						responseActionIds: ["dm/dialog/choice/1"],
						openedAtTick: 1,
						consumed: false,
						presentation: {
							question: "Which class?",
							labels: { "dm/dialog/choice/1": "Barbarian" },
						},
					},
				],
			},
		});
		if (view.kind === "turn") expect(view).not.toHaveProperty("affordances");
		// No authored template metadata backs "author/open/template": absent
		// `input` (no authored schema) must survive as undefined, never {}.
		if (view.kind === "turn" && view.manipulationContext?.status === "ready")
			expect(view.manipulationContext.actions[0]).not.toHaveProperty("input");
	});

	it("carries published presentation facts (input schema, groups, description, definitionRef, templateIds) through a PLAYER perception's manipulation actions", async () => {
		const context = {
			db: admittedFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
				world_time: [{ tick: 1n }],
				entity: [{ entityId: 1n, name: "Actor" }],
				visible_manipulation_context: [
					{ perceiverEntityId: 1n, schemaVersion: 1, revision: 3n, ready: true },
				],
				action_definition: [
					{ actionId: "author/write", displayName: "Write", selfOnly: false, selfEligible: false },
					{
						actionId: "author/salute",
						displayName: "Salute",
						selfOnly: false,
						selfEligible: false,
					},
				],
				outcome_template: [
					{ outcomeTemplateId: "author/write/outcome", manipulationActionId: "author/write" },
					{ outcomeTemplateId: "author/salute/outcome", manipulationActionId: "author/salute" },
				],
				affordance_template: [
					{
						templateId: "author/write/template",
						displayName: "Write",
						description: "Inscribe a note.",
					},
					{ templateId: "author/salute/template", displayName: "Salute" },
				],
				public_metadata_attachment: [
					{
						rowId: 1n,
						namespace: "ui.affordance_group",
						targetKind: "affordance_template",
						targetRef: "author/write/template",
						audience: "public",
						payloadJson: '{"group":"correspondence"}',
					},
					{
						rowId: 2n,
						namespace: "ui.affordance_input",
						targetKind: "affordance_template",
						targetRef: "author/write/template",
						audience: "public",
						payloadJson: JSON.stringify({
							fields: [{ name: "body", label: "Message", control: "textarea", max_length: 200 }],
							submit_label: "Send",
						}),
					},
					{
						rowId: 3n,
						namespace: "ui.affordance_reference",
						targetKind: "affordance_template",
						targetRef: "author/write/template",
						audience: "public",
						payloadJson: '{"definition_ref":"srd/write"}',
					},
					{
						// An explicit empty schema ("complete invocation, no form") must
						// survive as `{ fields: [] }`, distinct from an absent `input`.
						rowId: 4n,
						namespace: "ui.affordance_input",
						targetKind: "affordance_template",
						targetRef: "author/salute/template",
						audience: "public",
						payloadJson: JSON.stringify({ fields: [] }),
					},
				],
				visible_manipulation_available_action: [
					{
						perceiverEntityId: 1n,
						actionId: "author/write",
						templateIds: ["author/write/template"],
						nicheIds: [],
					},
					{
						perceiverEntityId: 1n,
						actionId: "author/salute",
						templateIds: ["author/salute/template"],
						nicheIds: [],
					},
				],
				visible_manipulation_observed_target: [],
			}),
			act: { actorId: "1" },
		} as SpellkaveToolContext;
		const view = await perceive("1", createPlayerFacingToolMap(context), { emit: () => {} });
		expect(view).toMatchObject({
			kind: "turn",
			manipulationContext: {
				status: "ready",
				actions: [
					{
						actionId: "author/salute",
						templateIds: ["author/salute/template"],
						input: { fields: [] },
					},
					{
						actionId: "author/write",
						description: "Inscribe a note.",
						groups: ["correspondence"],
						definitionRef: "srd/write",
						templateIds: ["author/write/template"],
						input: {
							fields: [{ name: "body", label: "Message", control: "textarea", maxLength: 200 }],
							submitLabel: "Send",
						},
					},
				],
			},
		});
	});

	it("preserves an unresolved stable actor key", () => {
		const context = {
			db: admittedFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
				world_time: [{ tick: 1n }],
			}),
			act: { actorId: "kavemouth/adventure/npc/aldwin_1" },
		} as SpellkaveToolContext;
		expect(contextActorId(context)).toBe("kavemouth/adventure/npc/aldwin_1");
	});
});

function admittedFixture(parts: Parameters<typeof admittedFixtureSource>[0]) {
	return admittedFixtureSource({
		visible_manifest_authored_entity: [],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		...parts,
	});
}
