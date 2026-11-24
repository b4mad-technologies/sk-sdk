// sk-jay0.1.8.96 / .101 — `self_hit.attacker_name` (2026-11-12 compatibility
// decision, `ledger/designs/unified-world-event-stream.md`): additive and
// optional, resolved at emit time from the same name source `dealt_hit` uses.
// The key is ABSENT — never null, never an id, never a placeholder — when no
// name resolves, when the delta is ownerless, and when the attacker is the
// actor itself.
import { describe, expect, it } from "vitest";

import { deltaFixture, ownHit, primedBuilder } from "./world_events_builder_delta_fixture";

function entity(entityId: bigint, name: string) {
	return { entityId, name, entityDefId: "test", kind: "actor", quantity: 1n };
}

describe("createWorldEventBuilder — self_hit.attacker_name", () => {
	it("names the attacker when its entity name resolves", () => {
		const { db, resourceDeltaRows, entityRows } = deltaFixture();
		entityRows.push(entity(1n, "Hero"), entity(2n, "Cellar Rat"));
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownHit("60", "2", 4));

		expect(builder.diffAndAdvance()).toEqual([
			{
				kind: "self_hit",
				resource_id: "test/hp",
				amount: 1,
				new_value: 4,
				attack_kind: "test/strike/success",
				attacker_id: "2",
				attacker_name: "Cellar Rat",
				observed_at_tick: 1,
			},
		]);
	});

	it("omits the key when the attacker id has no name", () => {
		const { db, resourceDeltaRows, entityRows } = deltaFixture();
		entityRows.push(entity(1n, "Hero"), entity(2n, ""));
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownHit("61", "2", 4), ownHit("62", "9", 3));

		const events = builder.diffAndAdvance();
		expect(events.map((e) => (e.kind === "self_hit" ? e.attacker_id : null))).toEqual(["2", "9"]);
		for (const event of events) expect(event).not.toHaveProperty("attacker_name");
	});

	it("omits the key when the actor hit itself", () => {
		const { db, resourceDeltaRows, entityRows } = deltaFixture();
		entityRows.push(entity(1n, "Hero"));
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownHit("63", "1", 4));

		const [event] = builder.diffAndAdvance();
		expect(event).toMatchObject({ kind: "self_hit", attacker_id: "1" });
		expect(event).not.toHaveProperty("attacker_name");
	});

	it("omits the key for an ownerless hit", () => {
		const { db, resourceDeltaRows, entityRows } = deltaFixture();
		entityRows.push(entity(1n, "Hero"), entity(2n, "Cellar Rat"));
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownHit("64", "", 4));

		const [event] = builder.diffAndAdvance();
		expect(event).toMatchObject({ kind: "self_hit", attacker_id: null });
		expect(event).not.toHaveProperty("attacker_name");
	});
});
