import { describe, expect, it } from "vitest";
import type { SnapshotDb } from "../connection";
import { ProvenanceRingBuffer } from "../core/provenance_buffer";
import { type ProvenanceRow, readRecentProvenance } from "../provenance";

function makeRow(id: string, subjectId: string, tick: bigint, bundleId = "b1"): ProvenanceRow {
	return {
		id,
		kind: "EvaluationProvenanceKind",
		status: "Success",
		subject_id: subjectId,
		failure_kind: "",
		failure_detail: "",
		selected_template_ids: [],
		created_at_tick: tick,
		bundle_id: bundleId,
	};
}

describe("ProvenanceRingBuffer — basic operations", () => {
	it("stores and retrieves rows by subject", () => {
		const buf = new ProvenanceRingBuffer("actor-1");
		buf.insert(makeRow("r1", "actor-1", 1n));
		buf.insert(makeRow("r2", "actor-2", 2n));
		expect(buf.forSubject("actor-1")).toHaveLength(1);
		expect(buf.forSubject("actor-2")).toHaveLength(1);
		expect(buf.forSubject("actor-3")).toHaveLength(0);
	});

	it("retrieves rows by bundleId (correlationId)", () => {
		const buf = new ProvenanceRingBuffer("actor-1");
		buf.insert(makeRow("r1", "actor-1", 1n, "bundle-A"));
		buf.insert(makeRow("r2", "actor-1", 2n, "bundle-A"));
		buf.insert(makeRow("r3", "actor-1", 3n, "bundle-B"));
		expect(buf.byCorrelationId("bundle-A")).toHaveLength(2);
		expect(buf.byCorrelationId("bundle-B")).toHaveLength(1);
		expect(buf.byCorrelationId("bundle-X")).toHaveLength(0);
	});

	it("latestWatermark returns highest tick across all subjects", () => {
		const buf = new ProvenanceRingBuffer("actor-1");
		buf.insert(makeRow("r1", "actor-1", 5n));
		buf.insert(makeRow("r2", "actor-2", 10n));
		buf.insert(makeRow("r3", "actor-1", 3n));
		const wm = buf.latestWatermark();
		expect(wm?.created_at_tick).toBe(10n);
		expect(wm?.id).toBe("r2");
	});

	it("latestWatermark returns null for empty buffer", () => {
		const buf = new ProvenanceRingBuffer("actor-1");
		expect(buf.latestWatermark()).toBeNull();
	});
});

describe("ProvenanceRingBuffer — FIFO eviction", () => {
	it("evicts oldest row at connectedCap for connected actor", () => {
		const buf = new ProvenanceRingBuffer("actor-1", { connectedCap: 3, perSubjectCap: 10 });
		buf.insert(makeRow("r1", "actor-1", 1n));
		buf.insert(makeRow("r2", "actor-1", 2n));
		buf.insert(makeRow("r3", "actor-1", 3n));
		buf.insert(makeRow("r4", "actor-1", 4n)); // evicts r1
		const rows = buf.forSubject("actor-1");
		expect(rows).toHaveLength(3);
		expect(rows.map((r) => r.id)).toEqual(["r2", "r3", "r4"]);
	});

	it("evicts oldest row at perSubjectCap for non-connected actor", () => {
		const buf = new ProvenanceRingBuffer("connected", { connectedCap: 512, perSubjectCap: 2 });
		buf.insert(makeRow("r1", "other", 1n));
		buf.insert(makeRow("r2", "other", 2n));
		buf.insert(makeRow("r3", "other", 3n)); // evicts r1
		const rows = buf.forSubject("other");
		expect(rows).toHaveLength(2);
		expect(rows.map((r) => r.id)).toEqual(["r2", "r3"]);
	});

	it("removes evicted row from bundle index", () => {
		const buf = new ProvenanceRingBuffer("actor-1", { connectedCap: 2, perSubjectCap: 10 });
		buf.insert(makeRow("r1", "actor-1", 1n, "bundle-A"));
		buf.insert(makeRow("r2", "actor-1", 2n, "bundle-A"));
		buf.insert(makeRow("r3", "actor-1", 3n, "bundle-A")); // evicts r1
		const bRows = buf.byCorrelationId("bundle-A");
		expect(bRows.map((r) => r.id)).not.toContain("r1");
		expect(bRows).toHaveLength(2);
	});

	it("default caps: connected=512, non-connected=200", () => {
		const buf = new ProvenanceRingBuffer("actor-1");
		for (let i = 0; i < 512; i++) {
			buf.insert(makeRow(`r${i}`, "actor-1", BigInt(i)));
		}
		expect(buf.forSubject("actor-1")).toHaveLength(512);
		buf.insert(makeRow("r512", "actor-1", 512n));
		expect(buf.forSubject("actor-1")).toHaveLength(512);

		for (let i = 0; i < 600; i++) {
			buf.insert(makeRow(`s${i}`, "actor-2", BigInt(i)));
		}
		expect(buf.forSubject("actor-2")).toHaveLength(200);
	});
});

describe("readRecentProvenance — buffer cross-subject union", () => {
	const fakeDb = {} as SnapshotDb;

	it("returns all rows across 3 subjects when no subjectId filter", () => {
		const buf = new ProvenanceRingBuffer("s1");
		buf.insert(makeRow("r1", "s1", 1n));
		buf.insert(makeRow("r2", "s1", 2n));
		buf.insert(makeRow("r3", "s2", 3n));
		buf.insert(makeRow("r4", "s2", 4n));
		buf.insert(makeRow("r5", "s3", 5n));
		buf.insert(makeRow("r6", "s3", 6n));

		const rows = readRecentProvenance(fakeDb, {}, buf);
		expect(rows).toHaveLength(6);
		// sorted ascending by tick
		expect(rows.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6"]);
	});

	it("applies since filter when no subjectId is given", () => {
		const buf = new ProvenanceRingBuffer("s1");
		buf.insert(makeRow("r1", "s1", 1n));
		buf.insert(makeRow("r2", "s2", 2n));
		buf.insert(makeRow("r3", "s3", 3n)); // midpoint
		buf.insert(makeRow("r4", "s1", 4n));
		buf.insert(makeRow("r5", "s2", 5n));
		buf.insert(makeRow("r6", "s3", 6n));

		const midpoint = { created_at_tick: 3n, id: "r3" };
		const rows = readRecentProvenance(fakeDb, { since: midpoint }, buf);
		expect(rows).toHaveLength(3);
		expect(rows.map((r) => r.id)).toEqual(["r4", "r5", "r6"]);
	});

	it("can exclude exact baseline IDs when reducer prefixes do not sort chronologically", () => {
		const buf = new ProvenanceRingBuffer("actor-1");
		buf.insert(makeRow("r_move-9", "actor-1", 0n));
		const baselineIds = new Set(readRecentProvenance(fakeDb, {}, buf).map((row) => row.id));
		buf.insert(makeRow("r_manipulate-10", "actor-1", 0n));

		const rows = readRecentProvenance(
			fakeDb,
			{ subjectId: "actor-1", excludeIds: baselineIds },
			buf,
		);
		expect(rows.map((r) => r.id)).toEqual(["r_manipulate-10"]);
	});
});

describe("ProvenanceRingBuffer — 600-row connected-actor eviction scenario", () => {
	it("default buffer evicts to 512 after 600 inserts", () => {
		const buf = new ProvenanceRingBuffer("actor-1");
		for (let i = 0; i < 600; i++) {
			buf.insert(makeRow(`row-${i}`, "actor-1", BigInt(i)));
		}
		const rows = buf.forSubject("actor-1");
		expect(rows).toHaveLength(512);
		// oldest 88 rows were evicted; row-88 should be first
		expect(rows[0]?.id).toBe("row-88");
		// latest watermark tick should be 599
		expect(buf.latestWatermark()?.created_at_tick).toBe(599n);
	});
});
