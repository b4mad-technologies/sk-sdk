// sk-jay0.1.23.35.4: `renderWorldEventLine`'s `trace_departure` arm. The line
// is built from `mover_name` and `exit_label` ONLY. Two properties matter more
// than the wording: an unperceived mover stays anonymous, and no destination
// ever appears — the event does not carry one, and the world's voice must not
// invent one.
import { describe, expect, it } from "vitest";

import type { TraceDepartureEvent } from "../world-events.ts";
import { isCausedByActor, renderWorldEventLine } from "../world-events.ts";

const base: TraceDepartureEvent = {
	kind: "trace_departure",
	trace_id: "42",
	trace_kind: "core/departure",
	mover: 7,
	mover_name: "Aldwin",
	from_place_node_id: "inn/common_room",
	via_place_edge_id: "18",
	exit_label: "north",
	inscribed_at: 10,
	location_kind: "place_node",
	location_ref: "inn/common_room",
	observed_at_tick: 11,
};

describe("renderWorldEventLine — trace_departure", () => {
	it("names a perceived mover and the exit taken", () => {
		expect(renderWorldEventLine(base)).toBe("🌍 Aldwin leaves to the north.");
	});

	it("keeps an unperceived mover anonymous rather than fabricating a name", () => {
		expect(renderWorldEventLine({ ...base, mover_name: null })).toBe(
			"🌍 Someone leaves to the north.",
		);
	});

	it("says 'this way' when the world derived no direction for the exit", () => {
		expect(renderWorldEventLine({ ...base, exit_label: "" })).toBe("🌍 Aldwin leaves this way.");
	});

	it("never renders a destination or a raw edge id", () => {
		const line = renderWorldEventLine(base);
		expect(line).not.toContain("18");
		expect(line).not.toContain("inn/common_room");
	});

	it("is never a consequence of the observing actor's own act", () => {
		// A departure is someone ELSE walking out, observed. Attribution here
		// is deliberately stricter than sharing a tick with an act.
		expect(isCausedByActor(base, "7", 11)).toBe(false);
	});
});
