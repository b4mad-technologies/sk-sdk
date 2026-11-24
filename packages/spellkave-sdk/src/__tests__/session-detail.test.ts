import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import {
	readParticipantSessionDetail,
	readParticipantSessionSummaries,
} from "../core/readers/session_detail";

function fixture(
	overrides: Record<string, unknown> = {},
	extra: Record<string, Record<string, unknown>[]> = {},
) {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		visible_session: [
			{
				sessionId: 7n,
				sessionDefId: "test/work",
				lifecycle: "active",
				currentActor: "10",
				openedAt: 20n,
				lastAdvancedAt: 22n,
				promotedDurationTicks: 10n,
				originatingAction: "test/prepare",
				originatingTarget: { tag: "Entity", value: 99n },
				stateJson: '{"hidden":"never expose"}',
				...overrides,
			},
		],
		visible_session_participant: [{ sessionId: 7n, actorId: "10", ordinal: 0, joinedAt: 20n }],
		session_definition: [
			{ sessionDefId: "test/work", turnRule: "Simultaneous", busyAllowPred: "private expression" },
		],
		action_definition: [{ actionId: "test/prepare", displayName: "Prepare a sample" }],
		world_time: [{ tick: 24n }],
		...extra,
	});
}

describe("participant session detail", () => {
	it("preserves supplied cadence and clock observation without exposing an unknown opener", () => {
		const db = fixture(
			{ openedBy: "99" },
			{
				session_definition: [
					{ sessionDefId: "test/work", turnRule: "Sequential", roundDurationMs: 6000n },
				],
				world_time: [{ tick: 24n, lastTickAt: { microsSinceUnixEpoch: 1788816000000000n } }],
			},
		);
		expect(readParticipantSessionDetail(db, asEntityRef("10"))).toMatchObject({
			opened_by: null,
			round_duration_ms: "6000",
			roster: [{ actor_id: "10", ordinal: 0 }],
			timing: { last_tick_at_micros: "1788816000000000" },
		});
		expect(
			readParticipantSessionDetail(fixture({ openedBy: "10" }), asEntityRef("10"))?.opened_by,
		).toBe("10");
	});
	it("discloses an owned item origin but not an item in another body", () => {
		for (const containerId of [10n, 11n]) {
			const db = fixture(
				{ originatingTarget: { tag: "Item", value: 99n } },
				{
					visible_entity_containment: [
						{ entityId: 99n, containerId, slotId: "", insertedAtTick: 1n },
					],
				},
			);
			expect(readParticipantSessionDetail(db, asEntityRef("10"))?.originating_target).toBe(
				containerId === 10n ? "item:99" : null,
			);
		}
	});
	it("selects the lowest participating nonterminal id regardless of snapshot order", () => {
		const db = fixture(
			{},
			{
				visible_session: [
					{ sessionId: 12n, sessionDefId: "test/work", lifecycle: "active" },
					{ sessionId: 2n, sessionDefId: "test/work", lifecycle: "completed" },
					{ sessionId: 1n, sessionDefId: "test/work", lifecycle: "active" },
					{ sessionId: 7n, sessionDefId: "test/work", lifecycle: "waiting-on-external" },
				],
				visible_session_participant: [
					{ sessionId: 12n, actorId: "10" },
					{ sessionId: 2n, actorId: "10" },
					{ sessionId: 1n, actorId: "11" },
					{ sessionId: 7n, actorId: "10" },
				],
			},
		);
		expect(readParticipantSessionDetail(db, asEntityRef("10"))?.session_id).toBe("7");
		expect(readParticipantSessionDetail(db, asEntityRef("10"), "12")?.session_id).toBe("12");
		expect(readParticipantSessionSummaries(db, asEntityRef("10"))).toEqual([
			{ session_id: "7", lifecycle: "waiting-on-external", label: null },
			{ session_id: "12", lifecycle: "active", label: null },
		]);
		expect(readParticipantSessionSummaries(db, asEntityRef("test/missing"))).toEqual([]);
	});
	it("reports source world-time estimates for a non-travel operation without leaking hidden state", () => {
		const result = readParticipantSessionDetail(fixture(), asEntityRef("10"));
		expect(result).toMatchObject({
			label: "Prepare a sample",
			description: null,
			turn_rule: "Simultaneous",
			originating_target: null,
			timing: {
				basis: "world_ticks",
				opened_at: "20",
				last_advanced_at: "22",
				observed_at: "24",
				duration_ticks: "10",
				estimated_completion_at: "30",
				estimated_remaining_ticks: "6",
			},
		});
		expect(JSON.stringify(result)).not.toMatch(/hidden|private expression|state_json|busyAllow/);
	});
	it("does not disclose a foreign session even for an explicit id", () => {
		expect(readParticipantSessionDetail(fixture(), asEntityRef("11"), "7")).toBeNull();
		expect(readParticipantSessionDetail(fixture(), asEntityRef("test/missing"), "7")).toBeNull();
	});
	it.each([
		"initiated",
		"waiting-on-external",
	])("preserves the %s phase after its estimate elapses", (lifecycle) => {
		const result = readParticipantSessionDetail(
			fixture({ lifecycle }, { world_time: [{ tick: 50n }] }),
			asEntityRef("10"),
		);
		expect(result?.lifecycle).toBe(lifecycle);
		expect(result?.timing.estimated_remaining_ticks).toBe("0");
	});
	it.each([
		"completed",
		"failed",
		"abandoned",
	])("follows an explicitly selected session into %s", (lifecycle) => {
		const db = fixture({ lifecycle });
		expect(readParticipantSessionDetail(db, asEntityRef("10"))).toBeNull();
		expect(readParticipantSessionDetail(db, asEntityRef("10"), "7")?.lifecycle).toBe(lifecycle);
		expect(readParticipantSessionDetail(db, asEntityRef("10"), "8")).toBeNull();
	});
	it("keeps missing timing unknown and direct untimed sessions without a countdown", () => {
		const result = readParticipantSessionDetail(
			fixture(
				{
					openedAt: undefined,
					lastAdvancedAt: undefined,
					promotedDurationTicks: 0n,
					originatingAction: "",
					currentActor: "",
				},
				{ world_time: [], action_definition: [] },
			),
			asEntityRef("10"),
		);
		expect(result).toMatchObject({
			label: null,
			current_actor: null,
			my_turn: false,
			originating_action: null,
			originating_target: null,
			timing: {
				observed_at: null,
				opened_at: null,
				last_advanced_at: null,
				duration_ticks: null,
				estimated_completion_at: null,
				estimated_remaining_ticks: null,
			},
		});
	});
	it("retains large tick precision and does not advance a paused snapshot", () => {
		const db = fixture(
			{ openedAt: 9007199254740993n },
			{ world_time: [{ tick: 9007199254740994n }] },
		);
		const first = readParticipantSessionDetail(db, asEntityRef("10"));
		expect(first?.timing.estimated_completion_at).toBe("9007199254741003");
		expect(first?.timing.estimated_remaining_ticks).toBe("9");
		expect(readParticipantSessionDetail(db, asEntityRef("10"))).toEqual(first);
	});
	it("discloses only the requesting actor's known target", () => {
		const own = {
			visible_observer_knowledge: [
				{ observerEntityId: 10n, knownEntityId: 99n, learnedAtTick: 0n },
			],
		};
		expect(
			readParticipantSessionDetail(fixture({}, own), asEntityRef("10"))?.originating_target,
		).toBe("entity:99");
		const foreign = {
			visible_observer_knowledge: [
				{ observerEntityId: 11n, knownEntityId: 99n, learnedAtTick: 0n },
			],
		};
		expect(
			readParticipantSessionDetail(fixture({}, foreign), asEntityRef("10"))?.originating_target,
		).toBeNull();
	});
	it("uses the same timing shape for travel to a known place", () => {
		const db = fixture(
			{ originatingTarget: { tag: "PlaceNode", value: "test/destination" } },
			{
				visible_observer_place_knowledge: [
					{ observerEntityId: 10n, knownNodeId: "test/destination", learnedAtTick: 0n },
				],
			},
		);
		expect(readParticipantSessionDetail(db, asEntityRef("10"))).toMatchObject({
			originating_target: "place_node:test/destination",
			timing: { estimated_remaining_ticks: "6" },
		});
	});
});
