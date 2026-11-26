import { snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import { createPlayerFacingToolMap, type SpellkaveToolContext } from "../tools.ts";

// ---------------------------------------------------------------------------
// Fix 3 (sk-0m4.120.40): the scene LISTING dropped every actor's conditions
// (kept only for scene_detail), so a corpse and a threat read identically.
// The listing now carries each actor's condition ids compactly.
// ---------------------------------------------------------------------------
const sceneDb = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
	world_time: [{ tick: 20n }],
	directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "cellar" }],
	visible_actor_spatial_location: [
		{ entityId: 1n, placeNodeId: "cellar" },
		{ entityId: 2n, placeNodeId: "cellar" },
		{ entityId: 3n, placeNodeId: "cellar" },
	],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [
		{ manifestKey: "test:test/hero", entityId: 1n, bundleId: "test" },
	],
	visible_place_node: [
		{ nodeId: "cellar", placeGraphId: "inn", description: "A dank cellar.", posPresent: false },
	],
	visible_place_graph_definition: [{ placeGraphId: "inn", description: "The Lamp and Ladle." }],
	visible_place_edge: [],
	entity: [
		{ entityId: 1n, name: "Hero", entityDefId: "hero", kind: "actor", quantity: 1n },
		{ entityId: 2n, name: "Cellar Rat 1", entityDefId: "rat", kind: "actor", quantity: 1n },
		{ entityId: 3n, name: "Cellar Rat 3", entityDefId: "rat", kind: "actor", quantity: 1n },
	],
	visible_entity_tag: [],
	entity_description: [],
	visible_object_state: [],
	visible_entity_location: [],
	visible_trace: [],
	visible_target_condition: [
		{
			targetKind: { tag: "Entity" },
			targetId: 2n,
			conditionDefinitionId: "srd/condition/dead",
			appliedAtTick: 16n,
			expiresAtTick: undefined,
			stackCount: 1n,
			bundleId: "srd",
			sourceId: "actor_ref:entity:2",
		},
		{
			targetKind: { tag: "Entity" },
			targetId: 2n,
			conditionDefinitionId: "srd/condition/incapacitated",
			appliedAtTick: 16n,
			expiresAtTick: undefined,
			stackCount: 1n,
			bundleId: "srd",
			sourceId: "actor_ref:entity:2",
		},
	],
});

describe("scene listing distinguishes a corpse from a threat", () => {
	it("carries a killed actor's conditions and leaves a live actor's row bare", async () => {
		const map = createPlayerFacingToolMap({
			db: sceneDb,
			act: { actorId: "1" },
		} as SpellkaveToolContext);
		const result = (await map.scene.execute("scene-test", {})) as {
			details: { items: Array<{ id: string; kind: string; conditions?: string[] }> };
		};
		const dead = result.details.items.find((item) => item.id === "2");
		const live = result.details.items.find((item) => item.id === "3");
		expect(dead?.kind).toBe("actor");
		expect(dead?.conditions).toContain("srd/condition/dead");
		expect(dead?.conditions).toContain("srd/condition/incapacitated");
		expect(live?.kind).toBe("actor");
		expect(live).not.toHaveProperty("conditions");
	});
});

describe("scene_detail addresses a target by typed id (sk-jay0.1.46)", () => {
	it("reads the current row for entity:<n> and returns the handle and rev it would have needed", async () => {
		const map = createPlayerFacingToolMap({
			db: sceneDb,
			act: { actorId: "1" },
		} as SpellkaveToolContext);
		const byId = (await map.sceneDetail.execute("detail", { target_id: "entity:3" })) as {
			details: {
				status: string;
				handle: string;
				rev: string;
				target: { id: string; kind: string };
			};
		};
		expect(byId.details.status).toBe("ok");
		expect(byId.details.target).toMatchObject({ id: "3", kind: "actor" });
		expect(byId.details.handle).toBe("s:actor:3");
		const byHandle = await map.sceneDetail.execute("detail", {
			handle: byId.details.handle,
			rev: byId.details.rev,
		});
		expect(byHandle).toMatchObject({ details: { status: "ok", target: { id: "3" } } });
	});

	it("refuses a mixed or empty addressing and an unknown target", async () => {
		const map = createPlayerFacingToolMap({
			db: sceneDb,
			act: { actorId: "1" },
		} as SpellkaveToolContext);
		expect(await map.sceneDetail.execute("detail", {})).toMatchObject({
			details: { status: "invalid_detail_params" },
		});
		expect(
			await map.sceneDetail.execute("detail", { target_id: "entity:3", handle: "s:actor:3" }),
		).toMatchObject({ details: { status: "invalid_detail_params" } });
		expect(await map.sceneDetail.execute("detail", { target_id: "entity:99" })).toMatchObject({
			details: { status: "unknown_target", target_id: "entity:99" },
		});
	});
});

// ---------------------------------------------------------------------------
// Fix 4 (sk-0m4.120.34): self_summary omitted class/species/background, so a
// player could not tell who they were without a second self_states call. The
// tool now re-surfaces a COMPACT identity (tag + prefix, no verbose prose).
// ---------------------------------------------------------------------------
const selfDb = snapshotDbFromFixture({
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1, tick: 1n }],
	world_time: [{ tick: 5n }],
	directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "village" }],
	visible_actor_spatial_location: [
		{ entityId: 1n, placeNodeId: "village" },
		{ entityId: 2n, placeNodeId: "village" },
	],
	visible_target_condition: [],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	entity: [
		{ entityId: 1n, entityDefId: "srd/hero", name: "Hero" },
		{ entityId: 2n, entityDefId: "srd/companion", name: "Companion" },
	],
	visible_entity_tag: [
		{ key: "k10", entityId: 1n, tag: "srd.background.soldier", bundleId: "srd", source: "test" },
	],
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
		// Extra facets so the hero has more than the old 4-item bound and species
		// sorts LAST alphabetically — the exact live shape that dropped species.
		{
			rowId: 4n,
			entityDefId: "srd/hero",
			tag: "srd.communication.vocal",
			bundleId: "srd",
			source: "test",
		},
		{ key: "k5", entityDefId: "srd/hero", tag: "srd.creature", bundleId: "srd", source: "test" },
		{
			rowId: 6n,
			entityDefId: "srd/hero",
			tag: "srd.language.common",
			bundleId: "srd",
			source: "test",
		},
		// A companion's own tag — must never leak into the hero's identity.
		{
			rowId: 3n,
			entityDefId: "srd/companion",
			tag: "srd.species.elf",
			bundleId: "srd",
			source: "test",
		},
	],
	tag_value_definition: [
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
			value: { tag: "Int", value: 11n },
			setAtTick: 1n,
		},
	],
	resource_definition: [
		{ resourceDefinitionId: "srd/hp", displayName: "Hit Points", valueKind: "int" },
	],
	resource_definition_tag: [{ resourceDefinitionId: "srd/hp", tag: "core" }],
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
	],
});

describe("self_summary re-surfaces the identity facets", () => {
	it("shows a whole character's facets compactly — species included, no verbose prose, no leak", async () => {
		const map = createPlayerFacingToolMap({
			db: selfDb,
			act: { actorId: "1" },
		} as SpellkaveToolContext);
		const result = (await map.selfSummary.execute("self-test", {})) as {
			details: {
				self: {
					identity: {
						listing: string;
						items: Array<{ tag: string; prefix?: string; description?: string }>;
					};
				};
			};
		};
		const identity = result.details.self.identity;
		const tags = identity.items.map((facet) => facet.tag);
		// The whole set shows — the raised bound keeps the alphabetically-last
		// facet (species) from being truncated away, the live sk-0m4.120.34 bug.
		expect(identity.listing).toBe("complete");
		expect(tags).toEqual([
			"srd.background.soldier",
			"srd.class.fighter",
			"srd.communication.vocal",
			"srd.creature",
			"srd.language.common",
			"srd.species.human",
		]);
		// A different body's tag must never leak into the hero's identity.
		expect(tags).not.toContain("srd.species.elf");
		// Compact: a catalogued facet keeps its prefix but NOT the verbose
		// description (that stays at self_states kind=identity).
		const fighter = identity.items.find((facet) => facet.tag === "srd.class.fighter");
		expect(fighter?.prefix).toBe("srd.class");
		expect(fighter).not.toHaveProperty("description");
		// A bare facet with no catalog row keeps neither field (never "" in place).
		const soldier = identity.items.find((facet) => facet.tag === "srd.background.soldier");
		expect(soldier).not.toHaveProperty("prefix");
		expect(soldier).not.toHaveProperty("description");
	});
});
