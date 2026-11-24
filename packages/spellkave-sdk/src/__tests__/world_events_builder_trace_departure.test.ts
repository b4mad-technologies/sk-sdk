// sk-jay0.1.23.35.4: `trace_departure` is the third sibling of `speech_heard`
// / `trace_addressed` — the ONLY place a `TraceDepartureEvent` is constructed
// from a `visible_trace` row. These cases pin the structural contract the
// builder promises (module header of `../world-events/builder.ts`):
//   - a payload with a numeric `mover` and a string `via_place_edge_id`, and
//     neither `text` nor `addressee`, emits exactly one `trace_departure`
//   - THE ORDER of the three predicates: a row carrying `text` as well is
//     `speech_heard` only, and one carrying `addressee` as well is
//     `trace_addressed` only — the three partition the rows
//   - a row that stays visible across drains is never re-emitted
//   - the actor's own departure is skipped, same sk-dms.17 rule
//   - a malformed payload emits nothing rather than a half-filled event
// No case names an authored trace kind as a condition: `core/departure` is
// passed through verbatim in `trace_kind` for a consumer to match on, and the
// builder itself carries no vocabulary.
import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { createWorldEventBuilder } from "../world-events/builder";

/** The hero (id 1) is the builder's own actor and stays in the common room;
 * Aldwin (id 2) is co-located and therefore perceivable; the Guard (id 3) is
 * the mover in most cases; entity 99 is authored but never placed, so it is a
 * mover this observer cannot name. */
function buildDb(traceRows: Record<string, unknown>[]) {
	return snapshotDbFromFixture({
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		world_time: [{ tick: 5n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "test:test/hero", entityId: 1n, bundleId: "test" },
		],
		visible_actor_spatial_location: [
			{ entityId: 1n, placeNodeId: "inn" },
			{ entityId: 2n, placeNodeId: "inn" },
			{ entityId: 3n, placeNodeId: "inn" },
		],
		visible_place_node: [
			{
				nodeId: "inn",
				placeGraphId: "town",
				displayName: "The Inn",
				description: "A warm common room.",
				posPresent: false,
			},
		],
		visible_place_graph_definition: [{ placeGraphId: "town", description: "The town of tests." }],
		visible_place_edge: [],
		entity: [
			{ entityId: 1n, name: "Hero", entityDefId: "hero", kind: "actor", quantity: 1n },
			{ entityId: 2n, name: "Aldwin", entityDefId: "npc", kind: "actor", quantity: 1n },
			{ entityId: 3n, name: "Guard", entityDefId: "npc", kind: "actor", quantity: 1n },
			{ entityId: 99n, name: "Remote Stranger", entityDefId: "npc", kind: "actor", quantity: 1n },
		],
		visible_entity_tag: [],
		entity_description: [],
		visible_object_state: [],
		visible_target_condition: [],
		visible_entity_location: [],
		visible_trace: traceRows,
		session: [],
		session_participant: [],
		visible_turn_state: [],
	});
}

function traceRow(
	traceId: bigint,
	payloadJson: string,
	inscribedBy = "3",
	kind = "core/departure",
) {
	return {
		traceId,
		kind,
		locationKind: "place_node",
		locationRef: "inn",
		payloadJson,
		inscribedAt: Number(traceId),
		expiresAt: undefined,
		inscribedBy,
		visibility: { tag: "Local" },
		bundleId: "core",
	};
}

function departurePayload(mover: number, edgeId = "18", exitLabel = "north") {
	return JSON.stringify({ mover, via_place_edge_id: edgeId, exit_label: exitLabel });
}

function primedBuilder(traceRows: Record<string, unknown>[]) {
	const db = buildDb(traceRows);
	const builder = createWorldEventBuilder(
		() => db,
		() => "1",
	);
	builder.diffAndAdvance(); // priming — reports nothing on the first call
	return builder;
}

describe("createWorldEventBuilder — trace_departure", () => {
	it("emits one event for a departure trace, carrying the exit and not a destination", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(30n, departurePayload(3)));
		const events = builder.diffAndAdvance();

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "trace_departure",
			trace_id: "30",
			trace_kind: "core/departure",
			mover: 3,
			mover_name: "Guard",
			from_place_node_id: "inn",
			via_place_edge_id: "18",
			exit_label: "north",
			inscribed_at: 30,
			location_kind: "place_node",
			location_ref: "inn",
			observed_at_tick: 5,
		});
		expect(JSON.stringify(events[0])).not.toContain("to_node");
	});

	it("names the mover only when the observer perceives them", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(31n, departurePayload(2)));
		traceRows.push(traceRow(32n, departurePayload(99)));
		const events = builder.diffAndAdvance();

		expect(events).toHaveLength(2);
		const byId = new Map(
			events
				.filter((event) => event.kind === "trace_departure")
				.map((event) => [event.trace_id, event]),
		);
		expect(byId.get("31")).toMatchObject({ mover_name: "Aldwin" });
		expect(byId.get("32")).toMatchObject({ mover_name: null });
	});

	it("treats an absent exit_label as no label rather than a fabricated one", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(33n, JSON.stringify({ mover: 3, via_place_edge_id: "18" })));
		const events = builder.diffAndAdvance();

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "trace_departure", exit_label: "" });
	});

	it("a payload carrying text as well is speech only", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(
			traceRow(
				34n,
				JSON.stringify({ text: "I am off.", mover: 3, via_place_edge_id: "18" }),
				"3",
				"srd/speech",
			),
		);
		const events = builder.diffAndAdvance();

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "speech_heard", trace_id: "34" });
	});

	it("a payload carrying an addressee as well is addressed only", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(
			traceRow(35n, JSON.stringify({ addressee: 1, mover: 3, via_place_edge_id: "18" })),
		);
		const events = builder.diffAndAdvance();

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "trace_addressed", trace_id: "35" });
	});

	it("never re-emits a row that stays visible on a later drain", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(36n, departurePayload(3)));
		expect(builder.diffAndAdvance()).toHaveLength(1);
		expect(builder.diffAndAdvance()).toHaveLength(0);
	});

	it("skips the observer's own departure", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(37n, departurePayload(1), "1"));
		expect(builder.diffAndAdvance()).toHaveLength(0);
	});

	it("emits nothing for a malformed payload", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		// No edge; edge but no mover; non-numeric mover; non-string edge; an
		// array; and a null payload.
		traceRows.push(traceRow(40n, JSON.stringify({ mover: 3 })));
		traceRows.push(traceRow(41n, JSON.stringify({ via_place_edge_id: "18" })));
		traceRows.push(traceRow(42n, JSON.stringify({ mover: "3", via_place_edge_id: "18" })));
		traceRows.push(traceRow(43n, JSON.stringify({ mover: 3, via_place_edge_id: 18 })));
		traceRows.push(traceRow(44n, JSON.stringify([{ mover: 3, via_place_edge_id: "18" }])));
		traceRows.push(traceRow(45n, JSON.stringify(null)));

		expect(builder.diffAndAdvance()).toHaveLength(0);
	});
});
