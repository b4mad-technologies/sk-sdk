import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readReactionOptionsForActor } from "../core/readers/reaction_options";

function db() {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
		],
		visible_pending_resolution: [
			{
				pendingId: 8n,
				originatingActionId: "core/counter",
				originatingActor: "9",
				targetActor: "1",
				computedOutcomeTemplate: "core/counter/outcome",
				sessionId: 4n,
				windowOpensAtMicros: 100n,
				windowClosesAtMicros: 300n,
				depth: 1n,
				bundleId: "core",
			},
			{
				pendingId: 7n,
				originatingActionId: "core/shield",
				originatingActor: "2",
				targetActor: "1",
				computedOutcomeTemplate: "core/shield/outcome",
				sessionId: 4n,
				windowOpensAtMicros: 100n,
				windowClosesAtMicros: 200n,
				depth: 1n,
				bundleId: "core",
			},
		],
		visible_pending_resolution_reactor: [
			{
				rowId: 1n,
				pendingId: 8n,
				entityRef: "1",
				reacted: false,
				windowedAt: 1n,
				bundleId: "core",
			},
			{
				rowId: 2n,
				pendingId: 7n,
				entityRef: "1",
				reacted: false,
				windowedAt: 1n,
				bundleId: "core",
			},
			{
				rowId: 3n,
				pendingId: 7n,
				entityRef: "2",
				reacted: false,
				windowedAt: 1n,
				bundleId: "core",
			},
			{ rowId: 4n, pendingId: 8n, entityRef: "3", reacted: true, windowedAt: 1n, bundleId: "core" },
			{
				rowId: 5n,
				pendingId: 99n,
				entityRef: "1",
				reacted: false,
				windowedAt: 1n,
				bundleId: "core",
			},
		],
	});
}

describe("readReactionOptionsForActor", () => {
	it("joins only the actor's unreacted seats to visible open parents", () => {
		const options = readReactionOptionsForActor(db(), asEntityRef("1"));
		expect(options.map((option) => option.pending_id)).toEqual([7n, 8n]);
		expect(options[0]).toMatchObject({
			reactor_id: "1",
			originating_action_id: "core/shield",
			window_closes_at_micros: 200,
			session_id: 4n,
		});
	});

	it("resolves an authored actor alias before reactor matching", () => {
		expect(
			readReactionOptionsForActor(db(), asEntityRef("core/hero")).map(
				(option) => option.pending_id,
			),
		).toEqual([7n, 8n]);
	});

	it("preserves numeric and entity-prefixed reference parity", () => {
		expect(readReactionOptionsForActor(db(), asEntityRef("entity:1"))).toEqual(
			readReactionOptionsForActor(db(), asEntityRef("1")),
		);
	});

	it("does not expose another participant's seat", () => {
		expect(
			readReactionOptionsForActor(db(), asEntityRef("2")).map((option) => option.pending_id),
		).toEqual([7n]);
	});

	it("fails closed for an unresolved authored alias", () => {
		expect(readReactionOptionsForActor(db(), asEntityRef("core/missing"))).toEqual([]);
	});

	it("fails closed when a reactor row has no visible parent", () => {
		expect(readReactionOptionsForActor(db(), asEntityRef("1"))).toHaveLength(2);
	});

	it("uses the factored target disclosure for reaction faction classification", () => {
		const snapshot = snapshotDbFromFixture({
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
			],
			visible_pending_resolution: [
				{
					pendingId: 7n,
					originatingActionId: "core/shield",
					originatingActor: "2",
					targetActor: "9",
					computedOutcomeTemplate: "core/shield/outcome",
					sessionId: 4n,
					windowOpensAtMicros: 100n,
					windowClosesAtMicros: 200n,
					depth: 1n,
					bundleId: "core",
				},
			],
			visible_pending_resolution_reactor: [
				{
					rowId: 1n,
					pendingId: 7n,
					entityRef: "1",
					reacted: false,
					windowedAt: 1n,
					bundleId: "core",
				},
			],
			visible_manipulation_observed_target: [
				{
					targetFactId: "target:9",
					perceiverEntityId: 1n,
					targetRef: { tag: "Entity", value: 9n },
				},
			],
			visible_entity_tag: [{ entityId: 9n, tag: "faction:monsters" }],
		});
		expect(readReactionOptionsForActor(snapshot, asEntityRef("1"))[0]?.target_entity_faction).toBe(
			"monsters",
		);
	});
});
