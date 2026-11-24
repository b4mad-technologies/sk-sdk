import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readSelfCapabilities } from "../core/readers/self_capabilities";

const fixture = {
	visible_entity_tag: [],
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "village" }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
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
			extentRef: "",
			extentKindRef: "",
			elevationClass: { tag: "Public" },
		},
		{
			rowId: 2n,
			entityId: 1n,
			capabilityId: "srd/skill/no-catalog-row",
			source: "manual_grant",
			bundleId: "srd",
			extentRef: "",
			extentKindRef: "",
			elevationClass: { tag: "Public" },
		},
		{
			rowId: 3n,
			entityId: 1n,
			capabilityId: "srd/skill/expiring",
			source: "manual_grant",
			bundleId: "srd",
			expiresAtTick: 500n,
			extentRef: "region/one",
			extentKindRef: "place_graph",
			elevationClass: { tag: "Internal" },
		},
		{
			rowId: 4n,
			// A different entity's grant — must never leak into actor "1"'s listing.
			entityId: 2n,
			capabilityId: "srd/skill/persuasion",
			source: "entity_definition",
			bundleId: "srd",
			extentRef: "",
			extentKindRef: "",
			elevationClass: { tag: "Public" },
		},
	],
};

const db = snapshotDbFromFixture(fixture);

describe("readSelfCapabilities", () => {
	it("returns the connected actor's own capability grants, joined against the catalog for display_name", () => {
		const result = readSelfCapabilities(db, asEntityRef("1"));
		const perception = result.find((row) => row.capability_id === "srd/skill/perception");
		expect(perception).toEqual({
			capability_id: "srd/skill/perception",
			display_name: "Skill: Perception",
			description: "Perceive things.",
			source: "entity_definition",
		});
	});

	it("excludes a grant on a different entity", () => {
		const result = readSelfCapabilities(db, asEntityRef("1"));
		expect(result.map((row) => row.capability_id)).not.toContain("srd/skill/persuasion");
	});

	it("omits blank authored prose without fabricating a fallback", () => {
		const blank = snapshotDbFromFixture({
			...fixture,
			capability_definition: fixture.capability_definition.map((row) => ({
				...row,
				description: "  ",
			})),
		});
		expect(
			readSelfCapabilities(blank, asEntityRef("1")).find(
				(row) => row.capability_id === "srd/skill/perception",
			),
		).not.toHaveProperty("description");
	});

	it("falls back to the bare capability_id when no catalog row exists", () => {
		const result = readSelfCapabilities(db, asEntityRef("1"));
		const noCatalog = result.find((row) => row.capability_id === "srd/skill/no-catalog-row");
		expect(noCatalog).toEqual({
			capability_id: "srd/skill/no-catalog-row",
			display_name: "srd/skill/no-catalog-row",
			source: "manual_grant",
		});
	});

	it("round-trips expires_at_tick when present and omits it when absent", () => {
		const result = readSelfCapabilities(db, asEntityRef("1"));
		const expiring = result.find((row) => row.capability_id === "srd/skill/expiring");
		expect(expiring?.expires_at_tick).toBe(500);
		const perception = result.find((row) => row.capability_id === "srd/skill/perception");
		expect(perception).not.toHaveProperty("expires_at_tick");
	});

	it("preserves authored extent and elevation metadata without classifying the capability", () => {
		const result = readSelfCapabilities(db, asEntityRef("1"), {
			includeAuthoredGrantMetadata: true,
		});
		const elevated = result.find((row) => row.capability_id === "srd/skill/expiring");
		expect(elevated).toMatchObject({
			extent_ref: "region/one",
			extent_kind_ref: "place_graph",
			elevation_class: "Internal",
		});
	});

	it("cannot read a co-located remote body's capabilities", () => {
		expect(readSelfCapabilities(db, asEntityRef("2"))).toEqual([]);
	});
	it("reads a bound placeless presence and refuses an unbound body despite visible grants", () => {
		const placeless = snapshotDbFromFixture({
			...fixture,
			directly_controlled_actor_spatial_location: [],
			actor: [
				{ actorId: 9n, currentBody: 1n, name: "Presence", createdAtTick: 1n },
				{ actorId: 10n, currentBody: 2n, name: "Other", createdAtTick: 1n },
			],
			visible_actor_identity: [
				{ key: "own", actorId: 9n, identity: "self", role: "presence", boundAtTick: 1n },
			],
		});
		expect(
			readSelfCapabilities(placeless, asEntityRef("1"), { includeAuthoredGrantMetadata: true }),
		).toContainEqual(
			expect.objectContaining({
				capability_id: "srd/skill/expiring",
				extent_ref: "region/one",
				elevation_class: "Internal",
			}),
		);
		expect(readSelfCapabilities(placeless, asEntityRef("2"))).toEqual([]);
	});
});

describe("derived self grants", () => {
	const derived = snapshotDbFromFixture({
		...fixture,
		entity: [{ entityId: 1n, entityDefId: "hero/blueprint" }],
		visible_entity_tag: [
			{ entityId: 1n, tag: "hero.level.1" },
			{ entityId: 2n, tag: "other.level.1" },
		],
		entity_definition_tag: [{ entityDefId: "hero/blueprint", tag: "hero.species" }],
		tag_capability_grant: [
			{ tag: "hero.level.1", capabilityId: "hero/feature" },
			{ tag: "hero.species", capabilityId: "hero/sight" },
			{ tag: "other.level.1", capabilityId: "other/feature" },
		],
		visible_target_condition: [
			{
				targetKind: { tag: "Entity" },
				targetId: 1n,
				conditionDefinitionId: "hero/drafting",
				stackCount: 1,
				expiresAtTick: 0n,
			},
			{
				targetKind: { tag: "Entity" },
				targetId: 1n,
				conditionDefinitionId: "hero/expired",
				stackCount: 1,
				expiresAtTick: 1n,
			},
			{
				targetKind: { tag: "Entity" },
				targetId: 2n,
				conditionDefinitionId: "other/drafting",
				stackCount: 1,
				expiresAtTick: 0n,
			},
		],
		condition_definition: [
			{ conditionDefinitionId: "hero/drafting", grantsCapabilityWhileActive: ["hero/confirm"] },
			{
				conditionDefinitionId: "hero/expired",
				grantsCapabilityWhileActive: ["hero/expired-handle"],
			},
			{ conditionDefinitionId: "other/drafting", grantsCapabilityWhileActive: ["other/confirm"] },
		],
		world_time: [{ tick: 2n }],
	});
	it("joins instance tags, blueprint tags and active conditions with their provenance", () => {
		const result = readSelfCapabilities(derived, asEntityRef("1"));
		expect(result).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ capability_id: "hero/feature", source: "tag:hero.level.1" }),
				expect.objectContaining({ capability_id: "hero/sight", source: "tag:hero.species" }),
				expect.objectContaining({
					capability_id: "hero/confirm",
					source: "condition:hero/drafting",
				}),
			]),
		);
		for (const id of ["other/feature", "other/confirm", "hero/expired-handle"])
			expect(result.map((row) => row.capability_id)).not.toContain(id);
	});
	it("retains direct scoped grants and never returns another body's derived grants", () => {
		expect(
			readSelfCapabilities(derived, asEntityRef("1"), { includeAuthoredGrantMetadata: true }),
		).toContainEqual(
			expect.objectContaining({ capability_id: "srd/skill/expiring", extent_ref: "region/one" }),
		);
		expect(readSelfCapabilities(derived, asEntityRef("2"))).toEqual([]);
	});
});
