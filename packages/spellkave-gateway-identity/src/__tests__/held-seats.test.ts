// keep-file(K1): which bindings count as a held seat (ADR-0161 D-5), as pure rows.
import { describe, expect, it } from "vitest";
import { heldSeatsFromRows } from "../world-router.ts";

describe("heldSeatsFromRows", () => {
	it("lists every primary seat (a disembodied one too), newest first, with actor and body ids", () => {
		expect(
			heldSeatsFromRows(
				[
					{ actor_id: "1", role: "primary", bound_at_tick: 5 },
					{ actor_id: "2", role: "primary", bound_at_tick: 9 },
					{ actor_id: "3", role: "presence", bound_at_tick: 7 },
					{ actor_id: "4", role: "co-pilot", bound_at_tick: 8 },
					{ actor_id: "5", role: "primary", bound_at_tick: 6 },
				],
				[
					{ actor_id: "1", current_body: "101" },
					{ actor_id: "2", current_body: "102" },
					{ actor_id: "3", current_body: "103" },
					{ actor_id: "4", current_body: "104" },
					{ actor_id: "5", current_body: "0" },
				],
			),
		).toEqual([
			{ seatActorId: "2", bodyId: "102", boundAtTick: 9 },
			{ seatActorId: "5", bodyId: "0", boundAtTick: 6 },
			{ seatActorId: "1", bodyId: "101", boundAtTick: 5 },
		]);
	});

	it("breaks equal bound ticks by numeric actor id", () => {
		expect(
			heldSeatsFromRows(
				[
					{ actor_id: "10", role: "primary", bound_at_tick: 3 },
					{ actor_id: "9", role: "primary", bound_at_tick: 3 },
				],
				[
					{ actor_id: "9", current_body: "109" },
					{ actor_id: "10", current_body: "110" },
				],
			).map((seat) => seat.seatActorId),
		).toEqual(["9", "10"]);
	});
});
