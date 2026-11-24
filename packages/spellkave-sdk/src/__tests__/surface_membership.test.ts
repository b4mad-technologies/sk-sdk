import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { readSurfaceMembership } from "../core/readers/surface_membership";

function attachmentRow(overrides: Record<string, unknown>) {
	return {
		rowId: 1n,
		targetKind: "resource_definition",
		targetRef: "srd/hp",
		namespace: "ui.self_summary",
		payloadJson: '{"slot":"vitals","order":10}',
		audience: "public",
		bundleId: "srd",
		source: "manifest",
		setAtTick: 0n,
		...overrides,
	};
}

describe("readSurfaceMembership", () => {
	it("returns slot/order membership for the matching namespace and target_kind", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({})],
		});
		const membership = readSurfaceMembership(db, "ui.self_summary", "resource_definition");
		expect(membership.get("srd/hp")).toEqual({ slot: "vitals", order: 10 });
	});

	it("ignores rows from an unrelated namespace or target_kind", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachmentRow({ rowId: 2n, namespace: "editorial.note", targetRef: "srd/ac" }),
				attachmentRow({ rowId: 3n, targetKind: "entity", targetRef: "phandelver/hero" }),
			],
		});
		const membership = readSurfaceMembership(db, "ui.self_summary", "resource_definition");
		expect(membership.size).toBe(0);
	});

	it("unions membership additively across bundles", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachmentRow({ rowId: 1n, bundleId: "srd", targetRef: "srd/hp" }),
				attachmentRow({
					rowId: 2n,
					bundleId: "srd-cc",
					targetRef: "srd/ac",
					payloadJson: '{"slot":"vitals","order":20}',
				}),
			],
		});
		const membership = readSurfaceMembership(db, "ui.self_summary", "resource_definition");
		expect(membership.get("srd/hp")).toEqual({ slot: "vitals", order: 10 });
		expect(membership.get("srd/ac")).toEqual({ slot: "vitals", order: 20 });
	});

	it("keeps the lowest order when two bundles attach the same target_ref", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachmentRow({ rowId: 1n, bundleId: "srd", payloadJson: '{"slot":"vitals","order":30}' }),
				attachmentRow({
					rowId: 2n,
					bundleId: "srd-cc",
					payloadJson: '{"slot":"vitals","order":10}',
				}),
			],
		});
		const membership = readSurfaceMembership(db, "ui.self_summary", "resource_definition");
		expect(membership.get("srd/hp")).toEqual({ slot: "vitals", order: 10 });
	});

	it("skips a row whose payload_json is not JSON", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({ payloadJson: "{not json" })],
		});
		expect(readSurfaceMembership(db, "ui.self_summary", "resource_definition").size).toBe(0);
	});

	it("skips a row whose payload_json is missing slot/order", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({ payloadJson: '{"order":10}' })],
		});
		expect(readSurfaceMembership(db, "ui.self_summary", "resource_definition").size).toBe(0);
	});

	it("filters out non-public audience rows (ADR-0073 D-2/D-3, no audience-scoped subscription yet)", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({ audience: "author" })],
		});
		expect(readSurfaceMembership(db, "ui.self_summary", "resource_definition").size).toBe(0);
	});
});
