import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readCurrentTraceProjection } from "../core/readers/trace_query";
import { readTracesAt } from "../core/readers/traces";

function trace(traceId: bigint, locationRef: string, kind: string, payloadJson: string) {
	return {
		traceId,
		kind,
		locationKind: "place_node",
		locationRef,
		payloadJson,
		inscribedAt: Number(traceId),
		expiresAt: undefined,
		inscribedBy: "1",
		visibility: { tag: "Local" },
		bundleId: "test",
	};
}

const db = snapshotDbFromFixture({
	visible_entity_tag: [],
	visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "near" }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [
		{ manifestKey: "test:test/hero", bundleId: "test", entityId: 1n },
	],
	visible_trace: [
		trace(1n, "near", "footprint", '{"direction":"north"}'),
		trace(2n, "near", "speech", '{"text":"hello"}'),
		trace(3n, "remote", "secret", '{"text":"unperceived"}'),
	],
});

describe("readCurrentTraceProjection", () => {
	it("orders equal-tick trace IDs numerically without losing u64 precision", () => {
		const fixture = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "near" }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			visible_trace: [
				...[108n, 98n, 18446744073709551615n, 9007199254740993n, 9007199254740992n].map((id) => ({
					...trace(id, "near", "speech", "{}"),
					inscribedAt: 0,
				})),
				trace(1n, "near", "speech", "{}"),
			],
		});
		const expected = [
			"98",
			"108",
			"9007199254740992",
			"9007199254740993",
			"18446744073709551615",
			"1",
		];
		expect(
			readCurrentTraceProjection(fixture, asEntityRef("1"))?.entries.map((row) => row.trace_id),
		).toEqual(expected);
		expect(readTracesAt(fixture, "place_node", "near").map((row) => row.trace_id)).toEqual(
			expected,
		);
	});

	it("derives the current node and excludes remote traces", () => {
		const result = readCurrentTraceProjection(db, asEntityRef("test/hero"));
		expect(result?.current_node_id).toBe("near");
		expect(result?.entries.map((entry) => entry.trace_id)).toEqual(["1", "2"]);
	});

	it("applies generic kind, prefix, inscriber, and visibility filters", () => {
		expect(
			readCurrentTraceProjection(db, asEntityRef("1"), { kind: "speech" })?.entries,
		).toHaveLength(1);
		expect(
			readCurrentTraceProjection(db, asEntityRef("1"), { kindPrefix: "foot" })?.entries,
		).toHaveLength(1);
		expect(
			readCurrentTraceProjection(db, asEntityRef("1"), { inscribedBy: "other" })?.entries,
		).toEqual([]);
		expect(
			readCurrentTraceProjection(db, asEntityRef("1"), { visibility: "Local" })?.entries,
		).toHaveLength(2);
	});

	it("fails closed when the actor has no authorized current location", () => {
		expect(
			readCurrentTraceProjection(
				snapshotDbFromFixture({
					visible_entity_tag: [],
					visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
					visible_actor_spatial_location: [],
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					visible_manifest_authored_entity: [],
					visible_trace: [],
				}),
				asEntityRef("1"),
			),
		).toBeNull();
	});
});
