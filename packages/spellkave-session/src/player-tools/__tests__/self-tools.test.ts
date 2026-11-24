import { snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import { createSelfStatesTool, createSelfSummaryTool } from "../tools";

const db = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	condition_definition: [
		{ conditionDefinitionId: "condition/0" },
		{ conditionDefinitionId: "remote/secret" },
	],
	condition_definition_description: [
		{ conditionDefinitionId: "condition/0", description: "An authored condition explanation." },
		{ conditionDefinitionId: "remote/secret", description: "Remote condition explanation." },
	],
	directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "village" }],
	visible_actor_spatial_location: [
		{ entityId: 1n, placeNodeId: "village" },
		{ entityId: 2n, placeNodeId: "village" },
	],
	visible_target_condition: [4, 1, 5, 0, 3, 2]
		.map((index) => ({
			rowId: BigInt(index + 1),
			targetKind: "entity",
			targetId: 1n,
			conditionDefinitionId: `condition/${index}`,
			sourceId: "test",
			appliedAtTick: 1n,
			stackCount: 1,
			bundleId: "test",
		}))
		.concat({
			rowId: 99n,
			targetKind: "entity",
			targetId: 2n,
			conditionDefinitionId: "remote/secret",
			sourceId: "test",
			appliedAtTick: 1n,
			stackCount: 1,
			bundleId: "test",
		}),
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	entity: [
		{ entityId: 1n, entityDefId: "srd/hero", name: "Hero" },
		{ entityId: 2n, entityDefId: "srd/companion", name: "Remote Companion" },
	],
	visible_entity_tag: [],
	entity_definition_tag: [
		{
			rowId: 1n,
			entityDefId: "srd/hero",
			tag: "srd.species.human",
			bundleId: "srd",
			source: "test",
		},
		{
			rowId: 2n,
			entityDefId: "srd/hero",
			tag: "srd.class.fighter",
			bundleId: "srd",
			source: "test",
		},
		{
			// A bare tag with no tag_value_definition catalog row — must surface
			// with no prefix/description, never empty strings.
			rowId: 4n,
			entityDefId: "srd/hero",
			tag: "creature",
			bundleId: "srd",
			source: "test",
		},
		{
			// A remote body's own definition tag — must never leak into actor "1"'s listing.
			rowId: 3n,
			entityDefId: "srd/companion",
			tag: "srd.species.elf",
			bundleId: "srd",
			source: "test",
		},
	],
	tag_value_definition: [
		{
			tag: "srd.species.human",
			prefix: "srd.species",
			bundleId: "srd",
			description: "Identifies an entity definition as the SRD Human species.",
		},
		{
			tag: "srd.class.fighter",
			prefix: "srd.class",
			bundleId: "srd",
			description: "Identifies an entity definition as the SRD Fighter class.",
		},
	],
	owned_object_state: [
		{
			rowId: 1n,
			targetKind: "entity",
			targetId: "1",
			stateId: "srd/hp",
			value: { tag: "Int", value: 12n },
			setAtTick: 1n,
		},
		{
			rowId: 2n,
			targetKind: "entity",
			targetId: "1",
			stateId: "story/a",
			value: { tag: "Int", value: 1n },
			setAtTick: 2n,
		},
		{
			rowId: 3n,
			targetKind: "entity",
			targetId: "1",
			stateId: "story/b",
			value: { tag: "Int", value: 2n },
			setAtTick: 3n,
		},
	],
	resource_definition: [
		{ resourceDefinitionId: "srd/hp", displayName: "Hit Points", valueKind: "int" },
		{ resourceDefinitionId: "story/a", displayName: "First objective", valueKind: "int" },
		{ resourceDefinitionId: "story/b", displayName: "Second objective", valueKind: "int" },
	],
	resource_definition_tag: [
		{ resourceDefinitionId: "srd/hp", tag: "core" },
		{ resourceDefinitionId: "story/a", tag: "quest" },
		{ resourceDefinitionId: "story/b", tag: "quest" },
	],
	// ui.self_summary membership (#2119) — author-driven `vitals`/`quest`
	// bucket assignment, independent of the resource_definition_tag rows
	// above (those now only back readActorStates' own generic stateTag
	// filter, exercised below).
	public_metadata_attachment: [
		{
			rowId: 1n,
			targetKind: "resource_definition",
			targetRef: "srd/hp",
			namespace: "ui.self_summary",
			payloadJson: '{"slot":"vitals","order":10}',
			audience: "public",
			bundleId: "srd",
			source: "manifest",
			setAtTick: 0n,
		},
		{
			rowId: 2n,
			targetKind: "resource_definition",
			targetRef: "story/a",
			namespace: "ui.self_summary",
			payloadJson: '{"slot":"quest","order":10}',
			audience: "public",
			bundleId: "srd",
			source: "manifest",
			setAtTick: 0n,
		},
		{
			rowId: 3n,
			targetKind: "resource_definition",
			targetRef: "story/b",
			namespace: "ui.self_summary",
			payloadJson: '{"slot":"quest","order":20}',
			audience: "public",
			bundleId: "srd",
			source: "manifest",
			setAtTick: 0n,
		},
	],
	capability_definition: [
		{
			capabilityId: "srd/skill/perception",
			bundleId: "srd",
			actorKind: "any",
			displayName: "Skill: Perception",
			description: "Perceive things.",
		},
	],
	visible_capability: [
		{
			rowId: 1n,
			entityId: 1n,
			capabilityId: "srd/skill/perception",
			source: "entity_definition",
			bundleId: "srd",
		},
		{
			// A remote body's grant — must never leak into actor "1"'s listing.
			rowId: 2n,
			entityId: 2n,
			capabilityId: "srd/skill/persuasion",
			source: "entity_definition",
			bundleId: "srd",
		},
	],
	visible_evaluation_provenance: [
		{
			provenanceId: "eval:contested-check",
			kind: { tag: "Affordance" },
			status: { tag: "Failed" },
			subjectId: "1",
			ownerBodyEntityId: 1n,
			failureKind: "predicate_rejected",
			failureDetail: "missed",
			selectedTemplateIds: ["srd/contested_check"],
			stochasticDraws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 7 }],
			createdAtTick: 12n,
			bundleId: "srd",
		},
		{
			// A remote body's evaluation — must never leak into actor "1"'s listing.
			provenanceId: "eval:remote",
			kind: { tag: "Affordance" },
			status: { tag: "Succeeded" },
			subjectId: "2",
			ownerBodyEntityId: 2n,
			failureKind: "",
			failureDetail: "",
			selectedTemplateIds: [],
			stochasticDraws: [],
			createdAtTick: 13n,
			bundleId: "srd",
		},
	],
	visible_economy_channel_spend: [
		{
			rowId: 1n,
			actorId: 1n,
			channelId: "core/action_class/primary",
			spentMs: 500n,
			windowStartMs: 0n,
		},
		{
			// A remote body's spend standing — must never leak into actor "1"'s listing.
			rowId: 2n,
			actorId: 2n,
			channelId: "core/action_class/primary",
			spentMs: 1_000n,
			windowStartMs: 0n,
		},
	],
	world_time: [{ tick: 1n }],
	visible_economy_channel_budget: [
		{
			actorId: 1n,
			channelId: "core/action_class/primary",
			poolMsPerRound: 6_000n,
			resetsOn: "turn_start",
			offTurnEligible: false,
			currentWindowStartMs: 0n,
			spentMs: 500n,
			grantMs: 0n,
			effectivePoolMs: 6_000n,
			remainingMs: 5_500n,
			remainingDisclosed: true,
			status: "ok",
		},
		{
			actorId: 2n,
			channelId: "core/action_class/primary",
			poolMsPerRound: 6_000n,
			resetsOn: "turn_start",
			offTurnEligible: false,
			currentWindowStartMs: 0n,
			spentMs: 1_000n,
			grantMs: 0n,
			effectivePoolMs: 6_000n,
			remainingMs: 5_000n,
			remainingDisclosed: true,
			status: "ok",
		},
	],
	event_channel_spend: [
		{
			eventId: 1n,
			actor: 1n,
			channel: "core/action_class/primary",
			costMs: 500n,
			remainingMs: 0n,
			window: 0n,
		},
		{
			// A remote body's spend event — must never leak into actor "1"'s
			// listing. Unlike `visible_capability`/`visible_evaluation_provenance`
			// above, `event_channel_spend` is NOT a server-scoped view (it is
			// declared `public` directly — see `self_economy.ts`'s own doc
			// comment, #2110): this exclusion is `readSelfEconomyChannelSpends`'s
			// own client-side filter, not a boundary the server enforces.
			eventId: 2n,
			actor: 2n,
			channel: "core/action_class/primary",
			costMs: 250n,
			remainingMs: 0n,
			window: 0n,
		},
	],
});

const context = { db, act: { actorId: "1" } };

describe("queryable self tools", () => {
	it("summarizes only the implicit connected actor", async () => {
		const tool = createSelfSummaryTool(context);
		expect((tool.parameters as { properties?: object }).properties).not.toHaveProperty("actor_id");
		const result = await tool.execute("self", {});
		expect(result.details).toMatchObject({
			self: {
				actor_id: "1",
				entity_name: "Hero",
				state_count: 3,
				conditions: {
					count: 6,
					listing: "examples",
					items: [
						{ condition_definition_id: "condition/0", stack_count: 1 },
						{ condition_definition_id: "condition/1", stack_count: 1 },
						{ condition_definition_id: "condition/2", stack_count: 1 },
						{ condition_definition_id: "condition/3", stack_count: 1 },
					],
					continuation: { tool: "spellkave_self_states", args: { kind: "condition" } },
				},
				vitals: {
					count: 1,
					listing: "complete",
					items: [{ state_id: "srd/hp" }],
				},
				quest: {
					count: 2,
					listing: "complete",
					items: [{ state_id: "story/a" }, { state_id: "story/b" }],
				},
				capabilities: {
					count: 1,
					listing: "complete",
					items: [
						{
							capability_id: "srd/skill/perception",
							display_name: "Skill: Perception",
							source: "entity_definition",
						},
					],
				},
			},
		});
		const self = (result.details as { self: { vitals: { continuation?: unknown } } }).self;
		expect(self.vitals).not.toHaveProperty("continuation");
		// The FLAT `identity_tags` field is gone (2026-08-03) and stays gone.
		// Identity itself came back to the glance on 2026-08-30 as a compact
		// `identity` facet list — a player asking "who am I" was being told
		// everything except the answer — while the enriched facets stay one
		// call away at spellkave_self_states kind=identity. So this asserts
		// the old shape's absence, not identity's.
		expect(self).not.toHaveProperty("identity_tags");
	});

	// #2119 follow-up (2026-08-03): identity moved off self_summary onto its
	// own self_states kind, enriched with the bundle's tag_value_definition
	// catalog — the static "who am I" fetched once at session start.
	it("pages the connected actor's own identity facets, enriched where a catalog definition exists", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("identity-1", { kind: "identity" });
		expect(result.details).toMatchObject({
			shown: 3,
			matched: 3,
			truncated: false,
			items: [
				{ tag: "creature" },
				{
					tag: "srd.class.fighter",
					prefix: "srd.class",
					description: "Identifies an entity definition as the SRD Fighter class.",
				},
				{
					tag: "srd.species.human",
					prefix: "srd.species",
					description: "Identifies an entity definition as the SRD Human species.",
				},
			],
		});
		const items = (result.details as { items: Array<{ tag: string; prefix?: string }> }).items;
		const bareTag = items.find((item) => item.tag === "creature");
		expect(bareTag).not.toHaveProperty("prefix");
		expect(bareTag).not.toHaveProperty("description");
		// A remote body's own definition tag ("srd.species.elf") is excluded —
		// see the parameterized "excludes a remote body's grant" block below.
	});

	it("rejects kind=identity combined with a state filter as a structured invalid_filter", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("identity-invalid-filter", {
			kind: "identity",
			state_tag: "quest",
		});
		expect(result.details).toEqual({
			status: "invalid_filter",
			reason:
				"state_prefix/state_tag apply only to kind=state; omit kind or set kind=state to use them, or drop the filters to page conditions/capabilities/evaluations/economy/identity.",
		});
	});

	it("filters states and continues with truthful metadata", async () => {
		const tool = createSelfStatesTool(context);
		const first = await tool.execute("states-1", { state_tag: "quest", limit: 1 });
		expect(first.details).toMatchObject({ shown: 1, matched: 2, truncated: true });
		const cursor = (first.details as { next_cursor: string }).next_cursor;
		const second = await tool.execute("states-2", { state_tag: "quest", limit: 1, cursor });
		expect(second.details).toMatchObject({
			shown: 1,
			matched: 2,
			truncated: false,
			next_cursor: null,
		});
	});

	it("pages every implicit-self condition in stable order and closes continuation", async () => {
		const tool = createSelfStatesTool(context);
		const first = await tool.execute("conditions-1", { kind: "condition", limit: 2 });
		expect(first.details).toMatchObject({
			shown: 2,
			matched: 6,
			truncated: true,
			items: [
				{
					condition_definition_id: "condition/0",
					description: "An authored condition explanation.",
				},
				{ condition_definition_id: "condition/1" },
			],
		});
		const second = await tool.execute("conditions-2", {
			kind: "condition",
			limit: 2,
			cursor: (first.details as { next_cursor: string }).next_cursor,
		});
		const third = await tool.execute("conditions-3", {
			kind: "condition",
			limit: 2,
			cursor: (second.details as { next_cursor: string }).next_cursor,
		});
		expect(third.details).toMatchObject({
			shown: 2,
			matched: 6,
			truncated: false,
			next_cursor: null,
			items: [
				{ condition_definition_id: "condition/4" },
				{ condition_definition_id: "condition/5" },
			],
		});
	});

	it("pages the connected actor's own capabilities", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("capabilities-1", { kind: "capability" });
		expect(result.details).toMatchObject({
			shown: 1,
			matched: 1,
			truncated: false,
			items: [
				{
					capability_id: "srd/skill/perception",
					display_name: "Skill: Perception",
					description: "Perceive things.",
					source: "entity_definition",
				},
			],
		});
		// A remote body's grant ("srd/skill/persuasion") is excluded — see the
		// parameterized "excludes a remote body's grant" block below.
	});

	// finding #22(b): the shared player-facing tool surface for the
	// engine's recorded die faces (finding #22(a) made the row correct; this
	// closes the "no tool reads it" half).
	it("pages the connected actor's own recent evaluations, including the resolved die face", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("evaluations-1", { kind: "evaluation" });
		expect(result.details).toMatchObject({
			shown: 1,
			matched: 1,
			truncated: false,
			items: [
				{
					provenance_id: "eval:contested-check",
					status: "Failed",
					selected_template_ids: ["srd/contested_check"],
					draws: [{ source_id: "dsl_node:1", draw_index: 0, value: 7 }],
				},
			],
		});
		// A remote body's evaluation ("eval:remote") is excluded — see the
		// parameterized "excludes a remote body's grant" block below.
	});

	it("rejects kind=evaluation combined with a state filter as a structured invalid_filter", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("evaluation-invalid-filter", {
			kind: "evaluation",
			state_tag: "quest",
		});
		expect(result.details).toEqual({
			status: "invalid_filter",
			reason:
				"state_prefix/state_tag apply only to kind=state; omit kind or set kind=state to use them, or drop the filters to page conditions/capabilities/evaluations/economy/identity.",
		});
	});

	// #2096: action-economy costs are invisible to players — the connected
	// actor's own channel spend standing (current-window spent_ms, plus the
	// last spend's cost_ms/remaining_ms), excluding a remote body's row.
	it("pages the connected actor's own economy channel spends", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("economy-1", { kind: "economy" });
		expect(result.details).toMatchObject({
			shown: 1,
			matched: 1,
			truncated: false,
			items: [
				{
					channel_id: "core/action_class/primary",
					spent_ms: "500",
					window_start_ms: "0",
					last_spend: { event_id: "1", cost_ms: "500", remaining_ms: "0" },
				},
			],
		});
		// A remote body's spend row (spent_ms "1000") is excluded — see the
		// parameterized "excludes a remote body's grant" block below.
	});

	// finding #4 (04-suite-audit §4): the same exclusion rule — a remote body's
	// row never leaks into actor "1"'s page — was proven four times through a
	// thin pass-through with no new failure mode each time. One parameterized
	// case now covers all four kinds; each kind's smoke test above still
	// proves its own kind-specific shape.
	it.each([
		{
			kind: "identity" as const,
			requestId: "identity-exclusion",
			excluded: { tag: "srd.species.elf" },
		},
		{
			kind: "capability" as const,
			requestId: "capability-exclusion",
			excluded: { capability_id: "srd/skill/persuasion" },
		},
		{
			kind: "evaluation" as const,
			requestId: "evaluation-exclusion",
			excluded: { provenance_id: "eval:remote" },
		},
		{
			kind: "economy" as const,
			requestId: "economy-exclusion",
			excluded: { spent_ms: "1000" },
		},
	])("excludes a remote body's grant from kind=$kind pages", async ({
		kind,
		requestId,
		excluded,
	}) => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute(requestId, { kind });
		const items = (result.details as { items: Array<Record<string, unknown>> }).items;
		expect(items).not.toContainEqual(expect.objectContaining(excluded));
	});

	it("pages kind=economy_budget remaining without replacing kind=economy items", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("economy-budget-1", { kind: "economy_budget" });
		expect(result.details).toMatchObject({
			status: "ok",
			shown: 1,
			matched: 1,
			truncated: false,
			items: [
				{
					channel_id: "core/action_class/primary",
					spent_ms: "500",
					remaining_ms: "5500",
					status: "ok",
				},
			],
		});
		const items = (result.details as { items: Array<{ actor_id: string }> }).items;
		expect(items).not.toContainEqual(expect.objectContaining({ actor_id: "2" }));
	});

	it("rejects kind=economy combined with a state filter as a structured invalid_filter", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("economy-invalid-filter", {
			kind: "economy",
			state_tag: "quest",
		});
		expect(result.details).toEqual({
			status: "invalid_filter",
			reason:
				"state_prefix/state_tag apply only to kind=state; omit kind or set kind=state to use them, or drop the filters to page conditions/capabilities/evaluations/economy/identity.",
		});
	});

	// Removed 2026-08-03: self_summary is compact orientation, not history —
	// recent evaluation history lives at spellkave_self_states kind=evaluation
	// (covered above) and act-tool results already carry the roll that
	// produced them.
	it("does not include recent_evaluations in self_summary", async () => {
		const tool = createSelfSummaryTool(context);
		const result = await tool.execute("self-without-evaluations", {});
		expect((result.details as { self: object }).self).not.toHaveProperty("recent_evaluations");
	});

	it("rejects kind=capability combined with a state filter as a structured invalid_filter", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("capability-invalid-filter", {
			kind: "capability",
			state_tag: "quest",
		});
		expect(result.details).toEqual({
			status: "invalid_filter",
			reason:
				"state_prefix/state_tag apply only to kind=state; omit kind or set kind=state to use them, or drop the filters to page conditions/capabilities/evaluations/economy/identity.",
		});
	});

	it("does not accept or honor a remote actor for condition pages", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("conditions-remote-override", {
			kind: "condition",
			actor_id: "2",
			limit: 100,
		} as never);
		const items = (result.details as { items: Array<{ condition_definition_id: string }> }).items;
		expect(items.map((item) => item.condition_definition_id)).toEqual(
			Array.from({ length: 6 }, (_, index) => `condition/${index}`),
		);
		expect(items).not.toContainEqual(
			expect.objectContaining({ condition_definition_id: "remote/secret" }),
		);

		const unboundRemote = createSelfStatesTool({ db, act: { actorId: "2" } });
		const denied = await unboundRemote.execute("conditions-remote-context", {
			kind: "condition",
			limit: 100,
		});
		expect(denied.details).toMatchObject({ shown: 0, matched: 0, next_cursor: null });
	});

	// #1932 (audit row 25): combining kind=condition with a state-only filter used
	// to throw a raw Error, surfacing as an unstructured isError string.
	it("rejects kind=condition combined with a state filter as a structured invalid_filter, not a thrown Error", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("invalid-filter", { kind: "condition", state_tag: "quest" });
		expect(result.details).toEqual({
			status: "invalid_filter",
			reason:
				"state_prefix/state_tag apply only to kind=state; omit kind or set kind=state to use them, or drop the filters to page conditions/capabilities/evaluations/economy/identity.",
		});
	});

	// #1932 (audit row 26): a state_tag filter that matches nothing now says what
	// tags DO exist, instead of a silent shown:0.
	it("names the tags actually present when a state_tag filter matches nothing", async () => {
		const tool = createSelfStatesTool(context);
		const result = await tool.execute("tag-miss", { state_tag: "nonexistent" });
		expect(result.details).toMatchObject({
			matched: 0,
			values_present: ["core", "quest"],
			reason: "No rows with state_tag='nonexistent'; tags present for this actor: [core, quest].",
		});
	});

	describe("provenance_id query (Self evaluation rows carry the reason)", () => {
		const evalDb = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "village" }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			visible_evaluation_provenance: [
				{
					provenanceId: "eval:missed-roll",
					kind: { tag: "Affordance" },
					status: { tag: "Succeeded" },
					subjectId: "1",
					ownerBodyEntityId: 1n,
					failureKind: "",
					failureDetail: "",
					selectedTemplateIds: [
						"core/attack_template",
						"resolution_result:false",
						"resolution_consequence:miss",
					],
					stochasticDraws: [{ sourceId: "dsl_node:attack", drawIndex: 0, value: 4 }],
					createdAtTick: 14n,
					bundleId: "srd",
				},
				{
					provenanceId: "eval:refused-gate",
					kind: { tag: "Affordance" },
					status: { tag: "Failed" },
					subjectId: "1",
					ownerBodyEntityId: 1n,
					expressionIds: ["srd/action/attack", "gate/range"],
					failureKind: "predicate_rejected",
					failureDetail: "target out of range",
					selectedTemplateIds: [],
					stochasticDraws: [],
					createdAtTick: 15n,
					bundleId: "srd",
				},
				{
					provenanceId: "eval:other-actor",
					kind: { tag: "Affordance" },
					status: { tag: "Succeeded" },
					subjectId: "2",
					ownerBodyEntityId: 2n,
					failureKind: "",
					failureDetail: "",
					selectedTemplateIds: ["core/attack_template"],
					stochasticDraws: [],
					createdAtTick: 16n,
					bundleId: "srd",
				},
			],
		});
		const evalContext = { db: evalDb, act: { actorId: "1" } };

		it("explains a missed roll when queried with provenance_id", async () => {
			const tool = createSelfStatesTool(evalContext);
			const result = await tool.execute("eval-missed", {
				kind: "evaluation",
				provenance_id: "eval:missed-roll",
			});
			expect(result.details).toMatchObject({
				matched: 1,
				shown: 1,
				items: [
					{
						provenance_id: "eval:missed-roll",
						status: "Succeeded",
						selected_template_ids: expect.arrayContaining(["resolution_result:false"]),
						draws: [{ source_id: "dsl_node:attack", draw_index: 0, value: 4 }],
					},
				],
			});
		});

		it("names the refused gate and failure detail when queried with provenance_id", async () => {
			const tool = createSelfStatesTool(evalContext);
			const result = await tool.execute("eval-refused", {
				kind: "evaluation",
				provenance_id: "eval:refused-gate",
			});
			expect(result.details).toMatchObject({
				matched: 1,
				shown: 1,
				items: [
					{
						provenance_id: "eval:refused-gate",
						status: "Failed",
						expression_ids: ["srd/action/attack", "gate/range"],
						failure_kind: "predicate_rejected",
						failure_detail: "target out of range",
					},
				],
			});
		});

		it("does not return another actor's record (matched 0, no rows)", async () => {
			const tool = createSelfStatesTool(evalContext);
			const result = await tool.execute("eval-other", {
				kind: "evaluation",
				provenance_id: "eval:other-actor",
			});
			expect(result.details).toMatchObject({
				matched: 0,
				shown: 0,
				items: [],
			});
		});

		it("rejects provenance_id when passed with kind=state naming kind=evaluation", async () => {
			const tool = createSelfStatesTool(evalContext);
			const result = await tool.execute("eval-invalid-state", {
				kind: "state",
				provenance_id: "eval:missed-roll",
			});
			expect(result.details).toEqual({
				status: "invalid_filter",
				reason:
					"provenance_id applies only to kind=evaluation; set kind=evaluation to use it, or drop the filter.",
			});
		});

		it("rejects provenance_id when kind is omitted (defaulting to state)", async () => {
			const tool = createSelfStatesTool(evalContext);
			const result = await tool.execute("eval-invalid-default", {
				provenance_id: "eval:missed-roll",
			});
			expect(result.details).toEqual({
				status: "invalid_filter",
				reason:
					"provenance_id applies only to kind=evaluation; set kind=evaluation to use it, or drop the filter.",
			});
		});
	});
});
