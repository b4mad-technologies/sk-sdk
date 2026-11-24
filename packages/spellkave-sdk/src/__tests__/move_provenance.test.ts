import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityId } from "../core/ids";
import { ProvenanceRingBuffer } from "../core/provenance_buffer";
import { rMoveWrapper } from "../core/reducers/r_move";
import { readRecentProvenance } from "../provenance";

function provenance(provenanceId: string, status = "Succeeded", subjectId = "1") {
	return {
		provenanceId,
		kind: provenanceId.startsWith("r_move:") ? "Affordance" : "Arbitration",
		status,
		subjectId,
		createdAtTick: 66n,
		failureKind: status === "Failed" ? "not_adjacent" : "",
		failureDetail: "",
		selectedTemplateIds: [],
		bundleId: "runtime",
	};
}

for (const source of ["subscription cache", "ring buffer"] as const) {
	describe(`move provenance attribution (${source})`, () => {
		function setup() {
			const location = { entityId: 1n, placeNodeId: "road/start" };
			const rows: ReturnType<typeof provenance>[] = [];
			const sessions: Record<string, unknown>[] = [];
			const db = snapshotDbFromFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
				world_time: [{ tick: 66n }],
				visible_actor_spatial_location: [location],
				visible_place_edge: [{ edgeId: 72n, fromNodeId: "road/start", toNodeId: "road/end" }],
				visible_evaluation_provenance: rows,
				visible_session: sessions,
				visible_session_participant: [{ sessionId: 12n, actorId: "1", ordinal: 0 }],
			});
			const buffer = source === "ring buffer" ? new ProvenanceRingBuffer("1") : undefined;
			function deliver(row: ReturnType<typeof provenance>) {
				rows.push(row);
				buffer?.insert(
					readRecentProvenance(db).find((candidate) => candidate.id === row.provenanceId)!,
				);
			}
			function travel() {
				sessions.push({
					sessionId: 12n,
					lifecycle: "active",
					openedAt: 66n,
					promotedDurationTicks: 3n,
				});
			}
			function move(invoke: () => Promise<void>) {
				return rMoveWrapper(asEntityId("1"), "72", () => db, invoke, 100, 1, undefined, buffer);
			}
			return { location, db, buffer, deliver, travel, move };
		}

		it("returns the same travel receipt when TTL release arrives before or after the baseline", async () => {
			const receipts = [];
			for (const delivery of ["before baseline", "during move", "after receipt"] as const) {
				const s = setup();
				const release = provenance("claim_released:66:173");
				if (delivery === "before baseline") s.deliver(release);
				const receipt = await s.move(async () => {
					if (delivery === "during move") s.deliver(release);
					s.travel();
				});
				if (delivery === "after receipt") s.deliver(release);
				expect(receipt.status).toBe("travelling");
				expect(receipt.provenance).toBeUndefined();
				// Attribution does not remove the ambient event from either reader.
				expect(readRecentProvenance(s.db, {}, s.buffer).map((row) => row.id)).toEqual([
					release.provenanceId,
				]);
				receipts.push(receipt);
			}
			expect(receipts[1]).toEqual(receipts[0]);
			expect(receipts[2]).toEqual(receipts[0]);
		});

		it("does not reject admitted travel because an unrelated actor evaluation failed", async () => {
			const s = setup();
			const result = await s.move(async () => {
				s.deliver(provenance("r_manipulate:66:173", "Failed"));
				s.travel();
			});
			expect(result.status).toBe("travelling");
			expect(result.provenance).toBeUndefined();
		});

		it.each([
			"Succeeded",
			"Failed",
		])("retains the move's %s row despite later unrelated provenance", async (status) => {
			const s = setup();
			s.deliver(provenance("r_move:66:171"));
			const result = await s.move(async () => {
				s.deliver(provenance("r_move:66:172", status));
				s.deliver(provenance("claim_released:66:173"));
				s.deliver(provenance("r_sense:66:175"));
				s.deliver(provenance("r_move:66:174", "Failed", "2"));
				if (status === "Succeeded") s.location.placeNodeId = "road/end";
			});
			expect(result.status).toBe(status === "Succeeded" ? "success" : "rejected");
			expect(result.provenance?.id).toBe("r_move:66:172");
			expect(result.provenance?.status).toBe(status);
		});
	});
}
