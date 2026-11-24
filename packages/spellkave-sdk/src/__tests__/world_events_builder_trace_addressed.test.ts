// sk-jay0.1.23.21: `trace_addressed` is the non-text mirror of `speech_heard`
// — the ONLY place a `TraceAddressedEvent` is constructed from a
// `visible_trace` row. These cases pin the structural contract the builder
// promises (module header of `../world-events/builder.ts`):
//   - a payload with a finite numeric `addressee` and no string `text` emits
//     exactly one `trace_addressed`, carrying the payload as inscribed
//   - a row that stays visible across drains is never re-emitted
//   - a payload carrying BOTH `text` and `addressee` is speech: it emits
//     `speech_heard` only, so the two kinds partition the rows
//   - the actor's own inscription is skipped, same sk-dms.17 rule as speech
//   - a malformed payload (no addressee, non-finite addressee, non-object)
//     emits nothing rather than a bogus id
// No case here names an authored trace kind as a condition: the builder
// carries zero bundle vocabulary, and `trace_kind` is passed through verbatim
// for a consumer to match on.
import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { createWorldEventBuilder } from "../world-events/builder";

/** Same world as `world_events_builder_addressee.test.ts`: the hero (id 1) is
 * the builder's own actor, the Guard (id 3) inscribes, Aldwin (id 2) is
 * co-located and therefore perceivable, entity 99 is authored but never
 * placed. */
function buildDb(traceRows: Record<string, unknown>[], overrides: Record<string, unknown[]> = {}) {
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
		...overrides,
	});
}

function traceRow(
	traceId: bigint,
	payloadJson: string,
	inscribedBy = "3",
	kind = "test/adventure/trace/companion_command",
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
		bundleId: "test",
	};
}

function primedBuilder(
	traceRows: Record<string, unknown>[],
	overrides: Record<string, unknown[]> = {},
) {
	const db = buildDb(traceRows, overrides);
	const builder = createWorldEventBuilder(
		() => db,
		() => "1",
	);
	builder.diffAndAdvance(); // priming — reports nothing on the first call
	return builder;
}

describe("createWorldEventBuilder — trace_addressed", () => {
	it("emits one event for an addressed non-text trace, payload as inscribed", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(20n, JSON.stringify({ command: "hold", addressee: 1 })));
		const events = builder.diffAndAdvance();

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			kind: "trace_addressed",
			trace_id: "20",
			trace_kind: "test/adventure/trace/companion_command",
			payload: { command: "hold", addressee: 1 },
			inscribed_by: "3",
			inscribed_by_name: "Guard",
			inscribed_at: 20,
			addressee: 1,
			// sk-jay0.1.8.63.40: the observer (actor "1") IS the addressee here.
			addressed_at_self: true,
			location_kind: "place_node",
			location_ref: "inn",
			observed_at_tick: 5,
		});
	});

	it("resolves addressee_name only when the observer perceives the addressee", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(21n, JSON.stringify({ command: "hold", addressee: 2 })));
		traceRows.push(traceRow(22n, JSON.stringify({ command: "hold", addressee: 99 })));
		const events = builder.diffAndAdvance();

		// `readRecentTraces` yields newest-first; this case is about name
		// resolution, not order, so it keys by trace id.
		expect(events).toHaveLength(2);
		const byId = new Map(
			events
				.filter((event) => event.kind === "trace_addressed")
				.map((event) => [event.trace_id, event]),
		);
		expect(byId.get("21")).toMatchObject({ addressee_name: "Aldwin", addressed_at_self: false });
		expect(byId.get("22")).toMatchObject({ addressee_name: null, addressed_at_self: false });
	});

	it("exposes an authored payload 'label' string, absent when the payload carries none", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(30n, JSON.stringify({ label: "Ranged Attack misses", addressee: 1 })));
		traceRows.push(traceRow(31n, JSON.stringify({ command: "hold", addressee: 1 })));
		const events = builder.diffAndAdvance();

		const byId = new Map(
			events
				.filter((event) => event.kind === "trace_addressed")
				.map((event) => [event.trace_id, event]),
		);
		expect(byId.get("30")).toMatchObject({ label: "Ranged Attack misses" });
		expect(byId.get("31")?.label).toBeUndefined();
	});

	it("names a participant of the observer's own session who stands on another cell", () => {
		// A tactical grid puts every participant on a cell of its own, so the
		// scene projection names nobody. The roster of the observer's own live
		// session fills that gap (seen live: the creature shooting at the
		// player read as "an unseen figure").
		const onTheGrid = {
			visible_actor_spatial_location: [
				{ entityId: 1n, placeNodeId: "session_grid_7/c_0_0" },
				{ entityId: 3n, placeNodeId: "session_grid_7/c_2_0" },
			],
		};
		const row = traceRow(21n, JSON.stringify({ addressee: 1 }));

		const noSession: Record<string, unknown>[] = [];
		const outside = primedBuilder(noSession, onTheGrid);
		noSession.push(row);
		expect(outside.diffAndAdvance()[0]).toMatchObject({
			kind: "trace_addressed",
			inscribed_by_name: null,
		});

		const traces: Record<string, unknown>[] = [];
		const inSession = primedBuilder(traces, {
			...onTheGrid,
			session: [
				{ sessionId: 7n, sessionDefId: "test/session", lifecycle: "active", currentActor: "3" },
			],
			session_participant: [
				{ sessionId: 7n, actorId: "1", ordinal: 0, joinedAt: 1n },
				{ sessionId: 7n, actorId: "3", ordinal: 1, joinedAt: 1n },
			],
		});
		traces.push(row);
		const events = inSession.diffAndAdvance().filter((event) => event.kind === "trace_addressed");
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			inscribed_by: "3",
			inscribed_by_name: "Guard",
			addressed_at_self: true,
		});
	});

	it("never re-emits a row that stays visible on a later drain", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(23n, JSON.stringify({ command: "follow", addressee: 1 })));
		expect(builder.diffAndAdvance()).toHaveLength(1);
		expect(builder.diffAndAdvance()).toHaveLength(0);
	});

	it("a payload carrying both text and addressee is speech only", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(
			traceRow(24n, JSON.stringify({ text: "Hold here.", addressee: 1 }), "3", "srd/speech"),
		);
		const events = builder.diffAndAdvance();

		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ kind: "speech_heard", trace_id: "24", inscribed_at: 24 });
	});

	it("skips the observer's own inscription", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(25n, JSON.stringify({ command: "hold", addressee: 2 }), "1"));
		expect(builder.diffAndAdvance()).toHaveLength(0);
	});

	it("emits nothing for a malformed payload", () => {
		const traceRows: Record<string, unknown>[] = [];
		const builder = primedBuilder(traceRows);

		traceRows.push(traceRow(26n, JSON.stringify({ command: "hold" })));
		traceRows.push(traceRow(27n, JSON.stringify({ command: "hold", addressee: "1" })));
		traceRows.push(traceRow(28n, JSON.stringify([{ addressee: 1 }])));
		traceRows.push(traceRow(29n, JSON.stringify(null)));

		expect(builder.diffAndAdvance()).toHaveLength(0);
	});
});
