// sk-jay0.1.8.96 — `self_resource_spent` is the actor's OWN spend (2026-11-12
// compatibility decision, `ledger/designs/unified-world-event-stream.md`).
// An own non-hit-point delta that ANOTHER entity caused (a sheet correction,
// a drain) is not emitted at all. An ownerless delta and a self-caused one
// keep the event. `self_hit` is never filtered by its source.
import { describe, expect, it } from "vitest";

import {
	deltaFixture,
	ownHit,
	ownPoolDelta,
	primedBuilder,
} from "./world_events_builder_delta_fixture";

const SPENT = {
	kind: "self_resource_spent",
	resource_id: "test/focus",
	amount: 1,
	new_value: 3,
	source: "test/focus/success",
	observed_at_tick: 1,
};

describe("createWorldEventBuilder — self_resource_spent source rule", () => {
	it("a change another entity caused on the actor's pool is not a spend", () => {
		const { db, resourceDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownPoolDelta("50", "2"));

		expect(builder.diffAndAdvance()).toEqual([]);
		// Dropped for good, not deferred: a later drain does not bring it back.
		expect(builder.diffAndAdvance()).toEqual([]);
		expect(builder.takeWhere(() => true)).toEqual([]);
	});

	it("a self-caused change is a spend", () => {
		const { db, resourceDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownPoolDelta("51", "1"));

		expect(builder.diffAndAdvance()).toEqual([SPENT]);
	});

	it("an ownerless change (empty source) is still a spend", () => {
		const { db, resourceDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownPoolDelta("52", ""));

		expect(builder.diffAndAdvance()).toEqual([SPENT]);
	});

	it("a hit another entity caused is still told", () => {
		const { db, resourceDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownHit("53", "2", 4), ownPoolDelta("54", "2"));

		expect(builder.diffAndAdvance().map((e) => e.kind)).toEqual(["self_hit"]);
	});
});
