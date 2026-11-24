import {
	snapshotDbFromFixture as admittedFixtureSource,
	manipulationArgsFromJson,
} from "@spellkave/sdk";
import { describe, expect, it, vi } from "vitest";
import {
	createManipulateTool,
	createPlayerFacingToolMap,
	type SpellkaveToolContext,
} from "../tools";

function fixture({ empty = false, factored = true }: { empty?: boolean; factored?: boolean } = {}) {
	const db = admittedFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
		world_time: [{ tick: 1n }],
		entity: [
			{ entityId: 1n, name: "Actor" },
			{ entityId: 2n, name: "Target" },
		],
		affordance_template: [{ templateId: "test/strike", displayName: "Strike" }],
		action_definition: [
			{ actionId: "test/strike", displayName: "Strike", selfOnly: false, selfEligible: false },
		],
		outcome_template: [
			{ outcomeTemplateId: "test/strike/outcome", manipulationActionId: "test/strike" },
		],
		visible_manipulation_available_action: [
			{
				perceiverEntityId: 1n,
				actionId: "test/strike",
				templateIds: ["test/strike"],
				nicheIds: [],
			},
		],
		visible_manipulation_context: factored
			? [{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true }]
			: [],
		visible_manipulation_observed_target: factored
			? [
					{
						targetFactId: "target:1:item:7",
						perceiverEntityId: 1n,
						targetRef: { tag: "Item", value: 7n },
						nicheIds: [],
					},
					{
						targetFactId: "target:1:entity:2",
						perceiverEntityId: 1n,
						targetRef: { tag: "Entity", value: 2n },
						nicheIds: [],
					},
				]
			: [],
		visible_manipulation_participant_context: factored
			? [
					{
						contextId: 7n,
						perceiverEntityId: 1n,
						actionId: "test/strike",
						bindingCount: empty ? 0 : 1,
					},
				]
			: [],
		visible_manipulation_participant_binding:
			!factored || empty
				? []
				: [{ rowId: 1n, contextId: 7n, roleId: "test/instrument", entityId: 9007199254740993n }],
	});
	const manipulate = vi.fn(async (_targetRef: string, _actionId: string, _argsJson: string) => ({
		status: "rejected",
	}));
	const map = createPlayerFacingToolMap({
		db,
		act: { actorId: "1", actorClient: { manipulate } },
	} as unknown as SpellkaveToolContext);
	return {
		map,
		directManipulate: createManipulateTool({
			db,
			act: { actorId: "1", actorClient: { manipulate } },
		} as unknown as SpellkaveToolContext),
		manipulate,
	};
}

describe("PLAYER participant dispatch", () => {
	it("exposes factored action, neutral target, and participant facts without reading eager pairs", async () => {
		const { map } = fixture();
		const result = await map.manipulationContext.execute("context", { detail: "full" });
		expect(result.details).toEqual({
			manipulation_context: {
				status: "ready",
				schema_version: 1,
				revision: 1,
				actions: [
					{
						action_id: "test/strike",
						display_name: "Strike",
						self_only: false,
						self_eligible: false,
						tags: [],
						niche_requirements: [],
						template_ids: ["test/strike"],
						groups: [],
					},
				],
				targets: [
					{ target_fact_id: "target:1:entity:2", target_ref: "entity:2", tags: [], niche_ids: [] },
					{ target_fact_id: "target:1:item:7", target_ref: "item:7", tags: [], niche_ids: [] },
				],
				participants: [
					{
						context_id: "mpc:7",
						action_id: "test/strike",
						binding_count: 1,
						bindings: [{ role_id: "test/instrument", entity_id: "9007199254740993" }],
					},
				],
				prompts: [],
			},
		});
	});

	it("composes a direct PLAYER manipulate attempt from factored facts without an eager handle", async () => {
		const { directManipulate, manipulate } = fixture();
		await directManipulate.execute("direct", {
			target_id: "entity:2",
			action_id: "test/strike",
			args_json: JSON.stringify({ quantity: 2, expected_participants: [] }),
		});
		expect(manipulate).toHaveBeenCalledOnce();
		expect(manipulate.mock.calls[0]).toEqual([
			"entity:2",
			"test/strike",
			JSON.stringify({ quantity: 2, participant_context: "mpc:7" }),
			expect.any(Function),
			expect.any(Function),
		]);
		const firstCall = manipulate.mock.calls[0];
		if (firstCall === undefined) throw new Error("expected direct manipulate dispatch");
		expect(manipulationArgsFromJson(firstCall[2])).toMatchObject({
			participantContext: "mpc:7",
		});
	});

	it("forwards a caller-supplied semantic_context through the factored composer unmangled (ADR-0142 D-3)", async () => {
		const { directManipulate, manipulate } = fixture();
		await directManipulate.execute("direct", {
			target_id: "entity:2",
			action_id: "test/strike",
			args_json: JSON.stringify({
				semantic_context: { source_ref: "entity:3", occurrence_id: 101 },
			}),
		});
		expect(manipulate).toHaveBeenCalledOnce();
		const firstCall = manipulate.mock.calls[0];
		if (firstCall === undefined) throw new Error("expected direct manipulate dispatch");
		// The wire text still carries the exact key the server's prompt-gate
		// reads (`args::ManipulationSemanticContextArg`, r_manipulate/args.rs).
		const forwardedArgs = JSON.parse(firstCall[2] as string);
		expect(forwardedArgs.semantic_context).toEqual({
			source_ref: "entity:3",
			occurrence_id: 101,
		});
		// And the SDK's own wire parser (the one `rManipulateWrapper` actually
		// calls) must round-trip it into the typed reducer arg, not drop it —
		// the exact regression this test guards against.
		expect(manipulationArgsFromJson(firstCall[2] as string)).toMatchObject({
			semanticContext: { sourceRef: "entity:3", occurrenceId: 101n },
		});
	});

	it("reports unavailable manipulation context without dispatching", async () => {
		const { map, manipulate } = fixture({ factored: false });
		const result = await map.manipulationContext.execute("context", { detail: "full" });
		expect(result.details).toEqual({ manipulation_context: { status: "unavailable" } });
		expect(manipulate).not.toHaveBeenCalled();
	});
});

function admittedFixture(parts: Parameters<typeof admittedFixtureSource>[0]) {
	return admittedFixtureSource({
		visible_manifest_authored_entity: [],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		...parts,
	});
}
