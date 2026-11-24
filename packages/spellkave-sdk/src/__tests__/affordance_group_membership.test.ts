import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { readAffordanceGroupMembership } from "../core/readers/affordance_group_membership";

function attachmentRow(overrides: Record<string, unknown>) {
	return {
		rowId: 1n,
		targetKind: "affordance_template",
		targetRef: "srd/attack/melee/affordance",
		namespace: "ui.affordance_group",
		payloadJson: '{"group":"combat"}',
		audience: "public",
		bundleId: "srd-cc",
		source: "manifest",
		setAtTick: 0n,
		...overrides,
	};
}

describe("readAffordanceGroupMembership", () => {
	it("returns the group set for a matching affordance_template attachment", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({})],
		});
		const membership = readAffordanceGroupMembership(db);
		expect(membership.get("srd/attack/melee/affordance")).toEqual(new Set(["combat"]));
	});

	it("ignores rows from an unrelated namespace or target_kind", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachmentRow({ rowId: 2n, namespace: "editorial.note" }),
				attachmentRow({ rowId: 3n, targetKind: "resource_definition", targetRef: "srd/hp" }),
			],
		});
		const membership = readAffordanceGroupMembership(db);
		expect(membership.size).toBe(0);
	});

	it("unions multiple group attachments on the same template", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachmentRow({ rowId: 1n, bundleId: "srd-cc", payloadJson: '{"group":"combat"}' }),
				attachmentRow({ rowId: 2n, bundleId: "srd-cc-2", payloadJson: '{"group":"utility"}' }),
			],
		});
		const membership = readAffordanceGroupMembership(db);
		expect(membership.get("srd/attack/melee/affordance")).toEqual(new Set(["combat", "utility"]));
	});

	it("skips a row whose payload_json is not JSON", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({ payloadJson: "{not json" })],
		});
		expect(readAffordanceGroupMembership(db).size).toBe(0);
	});

	it("skips a row whose payload_json is missing group", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({ payloadJson: "{}" })],
		});
		expect(readAffordanceGroupMembership(db).size).toBe(0);
	});

	it("filters out non-public audience rows (ADR-0073 D-2/D-3, no audience-scoped subscription yet)", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({ audience: "author" })],
		});
		expect(readAffordanceGroupMembership(db).size).toBe(0);
	});
});
