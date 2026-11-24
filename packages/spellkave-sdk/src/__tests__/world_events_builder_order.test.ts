// sk-jay0.1.8.96 / .101 — the ORDER guarantee of one drain (2026-11-12
// compatibility decision, `ledger/designs/unified-world-event-stream.md`):
//   - resource-delta and condition-delta events of one drain come out
//     together, oldest-first by event id, although both readers hand their
//     rows over newest-first;
//   - a `session_lifecycle` "closed" is the last event of its drain;
//   - a `session_lifecycle` "opened" is still the first.
// Before this decision the same drains read backwards ("now at 0" above
// "now at 5") and "The session closes." came before the blow that ended it.
import { describe, expect, it } from "vitest";

import {
	deltaFixture,
	openSession,
	ownCondition,
	ownHit,
	ownPoolDelta,
	ownXpGain,
	primedBuilder,
} from "./world_events_builder_delta_fixture";

describe("createWorldEventBuilder — order within one drain", () => {
	it("two own hits of one drain come out oldest-first", () => {
		const { db, resourceDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownHit("12", "2", 0), ownHit("10", "2", 5));

		expect(builder.diffAndAdvance().map((e) => (e.kind === "self_hit" ? e.new_value : e))).toEqual([
			5, 0,
		]);
	});

	it("resource and condition events are sorted together by event id, not kind by kind", () => {
		const { db, resourceDeltaRows, conditionDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownHit("10", "2", 5), ownHit("12", "2", 0));
		conditionDeltaRows.push(ownCondition("13", "test/down"), ownCondition("11", "test/dazed"));

		const told = builder
			.diffAndAdvance()
			.map((e) =>
				e.kind === "self_hit"
					? `hit:${e.new_value}`
					: e.kind === "self_condition_changed"
						? `condition:${e.condition_id}`
						: e.kind,
			);
		expect(told).toEqual(["hit:5", "condition:test/dazed", "hit:0", "condition:test/down"]);
	});

	it("event ids are compared numerically, so 9 comes before 10", () => {
		const { db, resourceDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownXpGain("10", 175), ownXpGain("9", 125));

		expect(builder.diffAndAdvance()).toEqual([
			{ kind: "xp_gained", amount: 50, new_value: 125, observed_at_tick: 1 },
			{ kind: "xp_gained", amount: 50, new_value: 175, observed_at_tick: 1 },
		]);
	});

	it("non-numeric host ids do not throw and still sort oldest-first", () => {
		const { db, resourceDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		resourceDeltaRows.push(ownPoolDelta("d2", "1"), ownHit("d1", "2", 4));

		expect(builder.diffAndAdvance().map((e) => e.kind)).toEqual([
			"self_hit",
			"self_resource_spent",
		]);
	});

	it("a resource row and a condition row sharing one event id keep the resource row first", () => {
		const { db, resourceDeltaRows, conditionDeltaRows } = deltaFixture();
		const builder = primedBuilder(db);

		conditionDeltaRows.push(ownCondition("20", "test/down"));
		resourceDeltaRows.push(ownHit("20", "2", 0));

		expect(builder.diffAndAdvance().map((e) => e.kind)).toEqual([
			"self_hit",
			"self_condition_changed",
		]);
	});

	it("a session that closes in the drain is told last, after what ended it", () => {
		const fixture = deltaFixture();
		openSession(fixture);
		const builder = primedBuilder(fixture.db);

		fixture.sessionRows.length = 0;
		fixture.participantRows.length = 0;
		fixture.resourceDeltaRows.push(ownXpGain("31", 175), ownXpGain("30", 125));

		expect(builder.diffAndAdvance()).toEqual([
			{ kind: "xp_gained", amount: 50, new_value: 125, observed_at_tick: 1 },
			{ kind: "xp_gained", amount: 50, new_value: 175, observed_at_tick: 1 },
			{
				kind: "session_lifecycle",
				session_id: "5",
				phase: "closed",
				participants: [],
				opened_by: "2",
				observed_at_tick: 1,
			},
		]);
		// Told exactly once: the next drain is quiet.
		expect(builder.diffAndAdvance()).toEqual([]);
	});

	it("a session that opens in the drain is still told first", () => {
		const fixture = deltaFixture();
		const builder = primedBuilder(fixture.db);

		openSession(fixture);
		fixture.resourceDeltaRows.push(ownHit("40", "2", 7));

		expect(builder.diffAndAdvance().map((e) => e.kind)).toEqual(["session_lifecycle", "self_hit"]);
	});
});
