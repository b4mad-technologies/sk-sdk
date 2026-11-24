// sk-jay0.1.11: `speech_heard`'s `addressee`/`addressee_name` fields are
// resolved here, not in `@spellkave/world-events` — that package only owns
// the closed `WorldEvent` union's shape; `createWorldEventBuilder`
// (`../world-events/builder.ts`) is the SOLE place a `SpeechHeardEvent` gets
// constructed from a `visible_trace` row's `payload_json` (`srd/speech`'s
// `{"text":"string","addressee":"integer?"}` schema,
// `packages/spellkave-srd-cc/docs/speech-and-traces.md`). These cases prove
// the three shapes the addressee contract promises:
//   - directed + the hearer currently perceives the addressee (name resolved
//     via the SAME co-located scene projection `inscribed_by_name` already
//     uses, `perceivedActorNames`)
//   - directed + the addressee is a known id the hearer cannot currently
//     perceive (`addressee_name: null`, never fabricated — same
//     "honest absence" rule `inscribed_by_name` already holds)
//   - untargeted (broadcast/self-shaped speech, no `addressee` key in the
//     payload at all) — `addressee`/`addressee_name` are both simply absent,
//     never a fabricated `null` for "no addressee at all" vs. "addressee
//     unperceived"
import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { createWorldEventBuilder } from "../world-events/builder";

/**
 * Hero (id 1, the hearer/builder's own actor) and Aldwin (id 2) share the
 * "inn" node — the co-located scene `perceivedActorNames` projects names
 * from. The Guard (id 3) speaks from the same node but is deliberately NOT
 * the hero, so `speech_heard` fires at all (the actor's own utterance is
 * filtered, module header sk-dms.17). Entity 99 ("Remote Stranger") is
 * authored but never placed anywhere the hero could perceive — a known id
 * with no currently-perceivable name, exactly the `addressee_name: null`
 * case.
 */
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

function textTraceRow(traceId: bigint, payloadJson: string, inscribedBy = "3") {
	return {
		traceId,
		kind: "srd/speech",
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

describe("createWorldEventBuilder — speech_heard addressee", () => {
	it("directed speech: addressee currently perceived resolves addressee_name", () => {
		const traceRows: Record<string, unknown>[] = [];
		const db = buildDb(traceRows);
		const builder = createWorldEventBuilder(
			() => db,
			() => "1",
		);
		builder.diffAndAdvance(); // priming — reports nothing on the first call

		traceRows.push(textTraceRow(10n, JSON.stringify({ text: "Well met.", addressee: 2 })));
		const [event] = builder.diffAndAdvance();
		expect(event).toMatchObject({
			kind: "speech_heard",
			trace_id: "10",
			text: "Well met.",
			addressee: 2,
			addressee_name: "Aldwin",
		});
	});

	it("directed speech: a known but unperceivable addressee stays addressee_name: null", () => {
		const traceRows: Record<string, unknown>[] = [];
		const db = buildDb(traceRows);
		const builder = createWorldEventBuilder(
			() => db,
			() => "1",
		);
		builder.diffAndAdvance();

		traceRows.push(textTraceRow(11n, JSON.stringify({ text: "Where did you go?", addressee: 99 })));
		const [event] = builder.diffAndAdvance();
		expect(event).toMatchObject({
			kind: "speech_heard",
			trace_id: "11",
			addressee: 99,
			addressee_name: null,
		});
	});

	it("untargeted speech: no addressee key at all leaves both fields absent", () => {
		const traceRows: Record<string, unknown>[] = [];
		const db = buildDb(traceRows);
		const builder = createWorldEventBuilder(
			() => db,
			() => "1",
		);
		builder.diffAndAdvance();

		traceRows.push(textTraceRow(12n, JSON.stringify({ text: "Anyone home?" })));
		const [event] = builder.diffAndAdvance();
		expect(event).toMatchObject({ kind: "speech_heard", trace_id: "12" });
		expect(event).not.toHaveProperty("addressee");
		expect(event).not.toHaveProperty("addressee_name");
	});
});
