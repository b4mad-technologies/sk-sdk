// embedded-manifest: {"category": "schema_object_oracle", "rationale": "compact row graph is the direct algorithm oracle for manifest diffing", "signatures": ["schema_object", "schema_shape"]}
import { describe, expect, it } from "vitest";

import {
	DIFF_JUNCTION_IDENTITY,
	diffManifests,
	flattenManifestDiff,
	identityFieldsOf,
	parseMapKey,
	parseSchemaManifestToml,
	rowIdentityKey,
} from "../diff-manifest";
import type { SchemaManifest } from "../filter-manifest";

const HERO = "elven_mini/adventure/hero_1";
const SWORD = "elven_mini/adventure/item/longsword_1";
const TORCH = "elven_mini/adventure/item/torch_1";

function entity(
	key: string,
	extra: Record<string, unknown> = {},
): NonNullable<SchemaManifest["entities"]>[number] {
	return {
		entity_key: key,
		bundle_id: "elven_mini",
		entity_def_id: "srd/pregen/fighter",
		name: key,
		kind: key === HERO ? "player" : "item",
		place_node_id: "elven_mini/inn/loft",
		quantity: 1,
		owned_by_entity_key: "",
		...extra,
	};
}

function base(): SchemaManifest {
	return {
		schema_version: "1.0.0",
		bundles: [{ bundle_id: "elven_mini", display_name: "Elven Mini" }],
		entities: [entity(HERO), entity(SWORD)],
		actors: [{ entity_key: HERO, name: "Renn", bundle_id: "elven_mini" }],
		actor_capabilities: [
			{ actor_entity_key: HERO, capability_id: "srd/skill/athletics", elevation_class: "hidden" },
			{ actor_entity_key: HERO, capability_id: "elven_mini/party/sight", visibility: "Public" },
		],
		actor_spatial_locations: [
			{ entity_key: HERO, place_node_id: "elven_mini/inn/loft", selection_path: "manifest" },
		],
		actor_equipment_slots: [
			{ actor_entity_key: HERO, slot_id: "srd/slot/main-hand", item_key: SWORD },
		],
		entity_containment: [
			{ container_entity_key: HERO, entity_key: SWORD, direction: "in", slot_id: "" },
		],
		entity_tag: [
			{ entity_key: HERO, tag: "srd.class.fighter", bundle_id: "elven_mini" },
			{ entity_key: HERO, tag: "srd.species.human", bundle_id: "elven_mini" },
		],
		object_state: [
			{
				entity_key: HERO,
				state_id: "srd/hp",
				value_bool: true,
				value_int: 12,
				bundle_id: "srd",
				expires_at_tick: 40,
			},
		],
	};
}

function shuffle<T>(rows: T[] | undefined): T[] {
	return [...(rows ?? [])].reverse();
}

describe("identityFieldsOf", () => {
	it("uses ROW_KIND_NATURAL_KEY for entities/actors (not identityOf surrogates)", () => {
		expect(identityFieldsOf("entities")).toEqual(["entity_key"]);
		expect(identityFieldsOf("actors")).toEqual(["entity_key"]);
		expect(identityFieldsOf("bundles")).toEqual(["bundle_id"]);
	});

	it("uses ROW_KIND_COMPOSITE_KEY for entity_tag", () => {
		expect(identityFieldsOf("entity_tag")).toEqual(["entity_key", "tag"]);
		expect(rowIdentityKey("entity_tag", { entity_key: HERO, tag: "srd.class.fighter" })).toBe(
			`${HERO}::srd.class.fighter`,
		);
	});

	it("uses the cited junction composites for kinds absent from both Rust tables", () => {
		expect(DIFF_JUNCTION_IDENTITY.actor_capabilities).toEqual([
			"actor_entity_key",
			"capability_id",
		]);
		expect(DIFF_JUNCTION_IDENTITY.object_state).toEqual(["entity_key", "state_id"]);
		expect(DIFF_JUNCTION_IDENTITY.entity_containment).toEqual([
			"container_entity_key",
			"entity_key",
		]);
		expect(DIFF_JUNCTION_IDENTITY.actor_equipment_slots).toEqual(["actor_entity_key", "slot_id"]);
		expect(DIFF_JUNCTION_IDENTITY.actor_spatial_locations).toEqual(["entity_key"]);
		expect(identityFieldsOf("actor_capabilities")).toEqual(["actor_entity_key", "capability_id"]);
	});
});

describe("diffManifests", () => {
	it("treats shuffled rows of the same identity as an empty diff", () => {
		const left = base();
		const right: SchemaManifest = {
			...left,
			entities: shuffle(left.entities),
			actor_capabilities: shuffle(left.actor_capabilities),
			entity_tag: shuffle(left.entity_tag),
			object_state: shuffle(left.object_state),
		};
		expect(diffManifests(left, right)).toEqual({ kinds: [], unkeyedKinds: [] });
	});

	it("reports onlyLeft as a gap and onlyRight as snapshot/play", () => {
		const left = base();
		const right = base();
		right.entities = [entity(HERO), entity(TORCH)];
		const diff = diffManifests(left, right);
		const entities = diff.kinds.find((entry) => entry.kind === "entities");
		expect(entities?.onlyLeft.map((row) => row.key)).toEqual([SWORD]);
		expect(entities?.onlyRight.map((row) => row.key)).toEqual([TORCH]);
		expect(entities?.changed).toEqual([]);
	});

	it("reports field-level changes on the same identity key", () => {
		const left = base();
		const right = base();
		right.entities = [
			entity(HERO, { entity_def_id: "elven_mini/adventure/candidate" }),
			entity(SWORD),
		];
		const diff = diffManifests(left, right);
		expect(diff.kinds).toEqual([
			{
				kind: "entities",
				onlyLeft: [],
				onlyRight: [],
				changed: [
					{
						key: HERO,
						fields: [
							{
								field: "entity_def_id",
								left: "srd/pregen/fighter",
								right: "elven_mini/adventure/candidate",
							},
						],
					},
				],
			},
		]);
	});

	it("ignores the default snapshot/enrichment fields", () => {
		const left = base();
		const right = base();
		right.entities = [entity(HERO, { place_node_id: "elven_mini/inn/common" }), entity(SWORD)];
		right.actor_spatial_locations = [
			{ entity_key: HERO, place_node_id: "elven_mini/inn/common", selection_path: "manifest" },
		];
		right.actor_capabilities = [
			{
				actor_entity_key: HERO,
				capability_id: "srd/skill/athletics",
				elevation_class: "public",
			},
			{ actor_entity_key: HERO, capability_id: "elven_mini/party/sight", visibility: "Hidden" },
		];
		right.object_state = [
			{
				entity_key: HERO,
				state_id: "srd/hp",
				value_bool: false,
				value_int: 12,
				bundle_id: "elven_mini",
				expires_at_tick: 99,
			},
		];
		expect(diffManifests(left, right)).toEqual({ kinds: [], unkeyedKinds: [] });
	});

	it("does not ignore value_bool when value_int/value_text do not carry the value", () => {
		const left: SchemaManifest = {
			object_state: [{ entity_key: HERO, state_id: "flag/prone", value_bool: false }],
		};
		const right: SchemaManifest = {
			object_state: [{ entity_key: HERO, state_id: "flag/prone", value_bool: true }],
		};
		const diff = diffManifests(left, right);
		expect(diff.kinds[0]?.changed[0]?.fields).toEqual([
			{ field: "value_bool", left: false, right: true },
		]);
	});

	it("merges extra ignoreFields and restricts by kinds", () => {
		const left = base();
		const right = base();
		right.actors = [{ entity_key: HERO, name: "Created hero", bundle_id: "elven_mini" }];
		right.entities = [entity(HERO, { name: "Created hero" }), entity(SWORD)];
		const all = diffManifests(left, right);
		expect(all.kinds.map((entry) => entry.kind)).toEqual(["actors", "entities"]);
		const ignored = diffManifests(left, right, {
			ignoreFields: { global: ["name"] },
			kinds: ["entities", "actors"],
		});
		expect(ignored).toEqual({ kinds: [], unkeyedKinds: [] });
		const onlyActors = diffManifests(left, right, { kinds: ["actors"] });
		expect(onlyActors.kinds.map((entry) => entry.kind)).toEqual(["actors"]);
	});

	it("indexes composite junction keys independently of row order", () => {
		const left: SchemaManifest = {
			entity_tag: [
				{ entity_key: HERO, tag: "srd.class.fighter" },
				{ entity_key: SWORD, tag: "srd.item.weapon" },
			],
			actor_capabilities: [
				{ actor_entity_key: HERO, capability_id: "srd/skill/athletics" },
				{ actor_entity_key: HERO, capability_id: "srd/skill/insight" },
			],
		};
		const right: SchemaManifest = {
			entity_tag: [
				{ entity_key: SWORD, tag: "srd.item.weapon" },
				{ entity_key: HERO, tag: "srd.class.rogue" },
			],
			actor_capabilities: [{ actor_entity_key: HERO, capability_id: "srd/skill/athletics" }],
		};
		const diff = diffManifests(left, right);
		const tags = diff.kinds.find((entry) => entry.kind === "entity_tag");
		expect(tags?.onlyLeft.map((row) => row.key)).toEqual([`${HERO}::srd.class.fighter`]);
		expect(tags?.onlyRight.map((row) => row.key)).toEqual([`${HERO}::srd.class.rogue`]);
		const caps = diff.kinds.find((entry) => entry.kind === "actor_capabilities");
		expect(caps?.onlyLeft.map((row) => row.key)).toEqual([`${HERO}::srd/skill/insight`]);
	});

	it("lists unkeyed array kinds instead of inventing an identity", () => {
		const left = { mystery_rows: [{ foo: 1 }] } as SchemaManifest;
		const right = { mystery_rows: [{ foo: 2 }] } as SchemaManifest;
		expect(diffManifests(left, right)).toEqual({
			kinds: [],
			unkeyedKinds: ["mystery_rows"],
		});
	});

	it("sorts kinds and keys deterministically", () => {
		const left: SchemaManifest = {
			entities: [entity(TORCH), entity(SWORD), entity(HERO)],
			actors: [{ entity_key: HERO, name: "Renn" }],
		};
		const right: SchemaManifest = {
			entities: [entity(HERO)],
			actors: [{ entity_key: "other", name: "Mira" }],
		};
		const kinds = diffManifests(left, right).kinds.map((entry) => entry.kind);
		expect(kinds).toEqual(["actors", "entities"]);
		const entities = diffManifests(left, right).kinds.find((entry) => entry.kind === "entities");
		expect(entities?.onlyLeft.map((row) => row.key)).toEqual([SWORD, TORCH]);
	});
});

describe("flattenManifestDiff", () => {
	it("projects --only gaps|snapshot|changed", () => {
		const left = base();
		const right = base();
		right.entities = [entity(HERO, { name: "Created" }), entity(TORCH)];
		const diff = diffManifests(left, right);
		expect(flattenManifestDiff(diff, "gaps").gaps.map((row) => row.key)).toEqual([SWORD]);
		expect(flattenManifestDiff(diff, "snapshot").snapshot.map((row) => row.key)).toEqual([TORCH]);
		expect(flattenManifestDiff(diff, "changed").changes).toEqual([
			{ kind: "entities", key: HERO, field: "name", left: HERO, right: "Created" },
		]);
		expect(flattenManifestDiff(diff, "gaps").snapshot).toEqual([]);
	});
});

const CANDIDATE = "elven_mini/adventure/candidate_1";
function remapKeys(manifest: SchemaManifest, from: string, to: string): SchemaManifest {
	const json = JSON.stringify(manifest);
	return JSON.parse(json.split(from).join(to)) as SchemaManifest;
}

describe("mapKeys (sk-0m4.54)", () => {
	it("parses from=to and rejects a bare token", () => {
		expect(parseMapKey(`${CANDIDATE}=${HERO}`)).toEqual({ from: CANDIDATE, to: HERO });
		expect(() => parseMapKey("no-equals")).toThrow(/from=to/);
	});

	it("treats candidate_1 vs hero_1 as empty when only keys differ", () => {
		const left = base();
		const right = remapKeys(left, HERO, CANDIDATE);
		expect(diffManifests(left, right).kinds.length).toBeGreaterThan(0);
		expect(diffManifests(left, right, { mapKeys: [{ from: CANDIDATE, to: HERO }] })).toEqual({
			kinds: [],
			unkeyedKinds: [],
		});
	});

	it("shows exactly one changed row when one mapped value differs", () => {
		const left = base();
		const right = remapKeys(left, HERO, CANDIDATE);
		const states = right.object_state ?? [];
		right.object_state = states.map((row) =>
			row.state_id === "srd/hp" ? { ...row, value_int: 7 } : row,
		);
		const diff = diffManifests(left, right, { mapKeys: [{ from: CANDIDATE, to: HERO }] });
		expect(diff.kinds).toHaveLength(1);
		expect(diff.kinds[0]?.kind).toBe("object_state");
		expect(diff.kinds[0]?.changed).toEqual([
			{
				key: `${HERO}::srd/hp`,
				fields: [{ field: "value_int", left: 12, right: 7 }],
			},
		]);
		expect(diff.kinds[0]?.onlyLeft).toEqual([]);
		expect(diff.kinds[0]?.onlyRight).toEqual([]);
	});
});

describe("parseSchemaManifestToml (sk-jay0.7.171.2)", () => {
	const cell = (id: string) => `[[place_nodes]]
bundle_id = "elven_mini"
node_id = "elven_mini/hamlet/green"
cell_res10 = ${id}
`;

	it("reads an H3 cell id above 2^53 exactly instead of refusing the file", () => {
		const parsed = parseSchemaManifestToml(cell("622215095455449087"));
		const rows = parsed.place_nodes as Array<Record<string, unknown>>;
		expect(rows[0]?.cell_res10).toBe("622215095455449087");
	});

	it("keeps small integers as numbers", () => {
		const parsed = parseSchemaManifestToml('[[entities]]\nentity_key = "x"\nquantity = 3\n');
		expect((parsed.entities as Array<Record<string, unknown>>)[0]?.quantity).toBe(3);
	});

	it("diffs two wide cell ids by value", () => {
		const same = diffManifests(
			parseSchemaManifestToml(cell("622215095455449087")),
			parseSchemaManifestToml(cell("622215095455449087")),
		);
		expect(same.kinds).toEqual([]);
		const changed = diffManifests(
			parseSchemaManifestToml(cell("622215095455449087")),
			parseSchemaManifestToml(cell("622215095455449088")),
		);
		expect(changed.kinds[0]?.changed[0]?.fields).toEqual([
			{ field: "cell_res10", left: "622215095455449087", right: "622215095455449088" },
		]);
	});
});
