import { describe, expect, it } from "vitest";
import { assertIdentityStable, identityOf, SURROGATE_ID_FIELDS } from "../row-identity";

describe("identityOf", () => {
	it("natural-key kind: derives the key from ROW_KIND_NATURAL_KEY", () => {
		const id = identityOf("resource_definitions", {
			resource_definition_id: "aoe_blast/hp",
			display_name: "Hit Points",
		});
		expect(id).toEqual({ form: "natural-key", kind: "resource_definitions", key: "aoe_blast/hp" });
	});

	it("natural-key kind: a missing/empty key throws, naming the row", () => {
		expect(() => identityOf("resource_definitions", { display_name: "Hit Points" })).toThrow(
			/no non-empty 'resource_definition_id'/,
		);
		expect(() => identityOf("resource_definitions", { resource_definition_id: "" })).toThrow(
			/no non-empty 'resource_definition_id'/,
		);
	});

	it("surrogate kind 'entities': reads the camelCase live id first", () => {
		const id = identityOf("entities", { entityId: 42, entity_key: "aoe_blast/puddle_1" });
		expect(id).toEqual({ form: "surrogate", kind: "entities", id: 42 });
	});

	it("surrogate kind 'entities': falls back to snake_case", () => {
		const id = identityOf("entities", { entity_id: 7 });
		expect(id).toEqual({ form: "surrogate", kind: "entities", id: 7 });
	});

	it("surrogate kind 'actors': reads actorId/actor_id", () => {
		expect(identityOf("actors", { actorId: 3 })).toEqual({
			form: "surrogate",
			kind: "actors",
			id: 3,
		});
		expect(identityOf("actors", { actor_id: 9 })).toEqual({
			form: "surrogate",
			kind: "actors",
			id: 9,
		});
	});

	it("surrogate kind: a bare manifest row (only entity_key, no numeric id) throws — never silently falls back", () => {
		expect(() => identityOf("entities", { entity_key: "aoe_blast/puddle_1" })).toThrow(
			/no numeric 'entityId'\/'entity_id' field/,
		);
	});

	it("wrong-usage guard: an unknown kind throws, naming every known kind", () => {
		expect(() => identityOf("not_a_real_kind", {})).toThrow(/unknown row kind 'not_a_real_kind'/);
		try {
			identityOf("not_a_real_kind", {});
			expect.unreachable("identityOf must throw for an unknown kind");
		} catch (err) {
			const message = (err as Error).message;
			// A representative surrogate kind and a representative natural-key kind
			// must both appear in the known-kind list the error surfaces.
			expect(message).toContain("entities");
			expect(message).toContain("resource_definitions");
		}
	});

	it("SURROGATE_ID_FIELDS is exactly the small explicit {entities, actors} set", () => {
		expect(Object.keys(SURROGATE_ID_FIELDS).sort()).toEqual(["actors", "entities"]);
	});
});

describe("assertIdentityStable", () => {
	it("natural-key kind: passes when the key is unchanged, even if other fields differ (upsert-by-key)", () => {
		expect(() =>
			assertIdentityStable(
				{ resource_definition_id: "aoe_blast/hp", display_name: "Hit Points", max_value: 30 },
				{ resource_definition_id: "aoe_blast/hp", display_name: "HP (renamed)", max_value: 40 },
				"resource_definitions",
			),
		).not.toThrow();
	});

	it("natural-key kind: throws when the key itself changed", () => {
		expect(() =>
			assertIdentityStable(
				{ resource_definition_id: "aoe_blast/hp" },
				{ resource_definition_id: "aoe_blast/mana" },
				"resource_definitions",
			),
		).toThrow(/identity changed — before key 'aoe_blast\/hp', after 'aoe_blast\/mana'/);
	});

	it("surrogate kind: passes when the numeric id is identical, even if other fields differ", () => {
		expect(() =>
			assertIdentityStable(
				{ entityId: 42, place_node_id: "aoe_blast/arena/center" },
				{ entityId: 42, place_node_id: "aoe_blast/arena/fringe" },
				"entities",
			),
		).not.toThrow();
	});

	it("surrogate kind: throws when the numeric id changed (a delete+recreate under the same authored key)", () => {
		expect(() => assertIdentityStable({ entityId: 42 }, { entityId: 43 }, "entities")).toThrow(
			/identity changed — before id 42, after 43/,
		);
	});

	it("propagates identityOf's own unknown-kind guard", () => {
		expect(() => assertIdentityStable({}, {}, "not_a_real_kind")).toThrow(/unknown row kind/);
	});
});
