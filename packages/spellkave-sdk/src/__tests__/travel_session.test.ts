import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { travelSessionForActor } from "../core/readers/travel_session";

const TRAVEL_STATE = JSON.stringify({
	from_node: "phandalin/stonehill",
	to_node: "phandalin/edermath",
	edge_id: 7,
	selection_path: ["phandalin/stonehill", "phandalin/edermath"],
});

describe("travelSessionForActor (sk-2qt)", () => {
	it("answers for a participant whose visible_session carries TravelState", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 20n }],
			visible_session: [
				{
					sessionId: 9n,
					sessionDefId: "core/long_running_action",
					lifecycle: "active",
					currentActor: "11",
					stateJson: TRAVEL_STATE,
					openedAt: 10n,
					promotedDurationTicks: 8n,
					originatingAction: "core/walk",
				},
			],
			visible_session_participant: [{ sessionId: 9n, actorId: "11", ordinal: 0, joinedAt: 10n }],
		});
		expect(travelSessionForActor(db, "11", 20n)).toEqual({
			sessionId: 9n,
			openedAt: 10n,
			durationTicks: 8n,
			arrivesAtTick: 18n,
			arrivesInTicks: 0n,
			originatingAction: "core/walk",
		});
	});

	it("returns null when the caller has no visible_session rows (unrelated connection)", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_time: [{ tick: 20n }],
			visible_session: [],
			visible_session_participant: [],
		});
		expect(travelSessionForActor(db, "11", 20n)).toBeNull();
	});
});
