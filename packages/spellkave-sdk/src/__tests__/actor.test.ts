import { describe, expect, it } from "vitest";

import { type LiveActorReader, resolveActor } from "../core/actor";
import { asEntityId } from "../core/ids";

function reader(
	locations: Array<{ entity_id: string; aliases?: string[]; node_id?: string }>,
): LiveActorReader {
	return {
		locations: () =>
			locations.map((loc) => ({
				...loc,
				entity_id: asEntityId(loc.entity_id),
			})),
	};
}

describe("resolveActor", () => {
	it("returns the actor and its current node when a location row exists", () => {
		const r = resolveActor(
			"2",
			reader([
				{ entity_id: "1", node_id: "study" },
				{ entity_id: "2", node_id: "tavern" },
			]),
		);
		expect(r.body_entity_id).toBe("2");
		expect(r.current_node_id).toBe("tavern");
	});

	it("accepts an item:-prefixed EntityRef as in_world_self", () => {
		const r = resolveActor("item:2", reader([{ entity_id: "2", node_id: "tavern" }]));
		expect(r.body_entity_id).toBe("2");
		expect(r.current_node_id).toBe("tavern");
	});

	it("accepts an exact authored alias but never performs nickname or role lookup", () => {
		expect(
			resolveActor(
				"core/player",
				reader([{ entity_id: "2", aliases: ["core/player"], node_id: "tavern" }]),
			),
		).toEqual({ body_entity_id: "2", current_node_id: "tavern" });
		expect(() => resolveActor("Scout 01", reader([{ entity_id: "2", node_id: "tavern" }]))).toThrow(
			/not found/,
		);
	});

	it("fails closed when no actor_spatial_location row matches the configured id", () => {
		// Component-table world model: existence ⇔ has spatial location row.
		// No monolithic `actor` table exists in the schema.
		expect(() => resolveActor("ghost", reader([{ entity_id: "2", node_id: "tavern" }]))).toThrow(
			/not found in live actor_spatial_location/,
		);
	});

	it("fails closed when in_world_self is empty", () => {
		expect(() => resolveActor("  ", reader([]))).toThrow(/empty/);
	});

	it("returns undefined current_node_id when the row's node_id is empty", () => {
		const r = resolveActor("2", reader([{ entity_id: "2", node_id: "" }]));
		expect(r.current_node_id).toBeUndefined();
	});

	it("returns undefined current_node_id when the row's node_id is missing", () => {
		const r = resolveActor("2", reader([{ entity_id: "2" }]));
		expect(r.current_node_id).toBeUndefined();
	});
});
