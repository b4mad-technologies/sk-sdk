import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readInterventionWindowsForActor } from "../core/readers/intervention_windows";

function db() {
	return snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
		],
		visible_pending_resolution: [
			// A plain multi-actor reaction seat window (no stochastic sibling) —
			// must NOT surface as an intervention window.
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
			// A stochastic self-intervention window: no reactor-seat row backs it,
			// eligibility is target_actor === originating_actor (self_only).
			{
				pendingId: 7n,
				originatingActionId: "core/wisdom_check",
				originatingActor: "1",
				targetActor: "1",
				computedOutcomeTemplate: "core/wisdom_check/outcome",
				sessionId: 4n,
				windowOpensAtMicros: 100n,
				windowClosesAtMicros: 200n,
				depth: 0n,
				bundleId: "core",
			},
			// Belongs to a different actor — must not leak into "1"'s listing.
			{
				pendingId: 6n,
				originatingActionId: "core/wisdom_check",
				originatingActor: "2",
				targetActor: "2",
				computedOutcomeTemplate: "core/wisdom_check/outcome",
				sessionId: 4n,
				windowOpensAtMicros: 100n,
				windowClosesAtMicros: 150n,
				depth: 0n,
				bundleId: "core",
			},
		],
		visible_pending_stochastic_resolution: [
			{
				pendingId: 7n,
				draws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 14 }],
				predicateSource: "d20 >= 11",
				rollBiasJson: "{}",
				frozenFactsJson: "{}",
				commitTailJson: "{}",
				originalProvenanceId: "p0",
				bundleId: "core",
			},
			{
				pendingId: 6n,
				draws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 3 }],
				predicateSource: "d20 >= 11",
				rollBiasJson: "{}",
				frozenFactsJson: "{}",
				commitTailJson: "{}",
				originalProvenanceId: "p1",
				bundleId: "core",
			},
			// Advantage: two independent draws recorded before any decision.
		],
	});
}

describe("readInterventionWindowsForActor", () => {
	it("surfaces only the caller's own stochastic pending windows, never a plain reaction seat", () => {
		const windows = readInterventionWindowsForActor(db(), asEntityRef("1"));
		expect(windows.map((w) => w.pending_id)).toEqual([7n]);
		expect(windows[0]).toMatchObject({
			originating_action_id: "core/wisdom_check",
			target_actor: "1",
			window_closes_at_micros: 200,
			session_id: 4n,
			faces: [{ source_id: "dsl_node:1", value: 14 }],
		});
	});

	it("resolves an authored actor alias before matching", () => {
		expect(
			readInterventionWindowsForActor(db(), asEntityRef("core/hero")).map((w) => w.pending_id),
		).toEqual([7n]);
	});

	it("does not expose another actor's window", () => {
		expect(
			readInterventionWindowsForActor(db(), asEntityRef("2")).map((w) => w.pending_id),
		).toEqual([6n]);
	});

	it("orders faces by draw index for a two-draw Advantage window", () => {
		const withAdvantage = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [
				{ manifestKey: "core:core/hero", bundleId: "core", entityId: 1n },
			],
			visible_pending_resolution: [
				{
					pendingId: 9n,
					originatingActionId: "core/wisdom_check",
					originatingActor: "1",
					targetActor: "1",
					computedOutcomeTemplate: "core/wisdom_check/outcome",
					sessionId: 4n,
					windowOpensAtMicros: 100n,
					windowClosesAtMicros: 200n,
					depth: 0n,
					bundleId: "core",
				},
			],
			visible_pending_stochastic_resolution: [
				{
					pendingId: 9n,
					// Recorded out of order — the reader must sort by drawIndex.
					draws: [
						{ sourceId: "dsl_node:1", drawIndex: 1, value: 5 },
						{ sourceId: "dsl_node:1", drawIndex: 0, value: 17 },
					],
					predicateSource: "d20 >= 11",
					rollBiasJson: "{}",
					frozenFactsJson: "{}",
					commitTailJson: "{}",
					originalProvenanceId: "p2",
					bundleId: "core",
				},
			],
		});
		expect(readInterventionWindowsForActor(withAdvantage, asEntityRef("1"))[0]?.faces).toEqual([
			{ source_id: "dsl_node:1", value: 17 },
			{ source_id: "dsl_node:1", value: 5 },
		]);
	});

	it("fails closed for an unresolved authored alias", () => {
		expect(readInterventionWindowsForActor(db(), asEntityRef("core/missing"))).toEqual([]);
	});
});
