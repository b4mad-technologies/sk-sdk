import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readSelfIdentity } from "../core/readers/self_identity";

const fixture = {
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "village" }],
	visible_actor_spatial_location: [
		{ entityId: 1n, placeNodeId: "village" },
		{ entityId: 2n, placeNodeId: "village" },
	],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	entity: [
		{ entityId: 1n, entityDefId: "srd/hero", name: "Hero" },
		{ entityId: 2n, entityDefId: "srd/companion", name: "Companion" },
	],
	visible_entity_tag: [
		{
			rowId: 10n,
			entityId: 1n,
			// Instance-only role tag — must union with definition tags (#2232).
			tag: "srd.background.soldier",
			bundleId: "srd",
			source: "test",
			setAtTick: 0n,
		},
		{
			rowId: 11n,
			entityId: 2n,
			// Remote body's instance tag — must never leak into actor "1".
			tag: "srd.background.sage",
			bundleId: "srd",
			source: "test",
			setAtTick: 0n,
		},
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
		// A bare tag with no catalog definition — must surface with no prefix/description.
		{ key: "k3", entityDefId: "srd/hero", tag: "creature", bundleId: "srd", source: "test" },
		{
			// A different entity's own definition tag — must never leak into actor "1"'s listing.
			rowId: 4n,
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
		{
			tag: "srd.background.soldier",
			prefix: "srd.background",
			bundleId: "srd",
			description: "Identifies an entity as the SRD Soldier background.",
		},
		// A definition for a value no entity here carries — irrelevant noise.
		{
			tag: "srd.species.elf",
			prefix: "srd.species",
			bundleId: "srd",
			description: "Identifies an entity definition as the SRD Elf species.",
		},
	],
};

const db = snapshotDbFromFixture(fixture);

describe("readSelfIdentity", () => {
	it("joins the actor's own definition tags with catalog description/prefix, sorted", () => {
		expect(readSelfIdentity(db, asEntityRef("1"))).toEqual([
			{
				tag: "creature",
			},
			{
				tag: "srd.background.soldier",
				prefix: "srd.background",
				description: "Identifies an entity as the SRD Soldier background.",
			},
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
		]);
	});

	it("excludes a remote body's own definition tags", () => {
		const tags = readSelfIdentity(db, asEntityRef("1")).map((facet) => facet.tag);
		expect(tags).not.toContain("srd.species.elf");
		expect(tags).not.toContain("srd.background.sage");
	});

	it("cannot read a co-located remote body's identity", () => {
		expect(readSelfIdentity(db, asEntityRef("2"))).toEqual([]);
	});
});
