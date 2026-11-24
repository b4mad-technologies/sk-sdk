import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { readAffordanceDefinitionRefs } from "../core/readers/affordance_reference";

function attachment(overrides: Record<string, unknown> = {}) {
	return {
		rowId: 1n,
		targetKind: "affordance_template",
		targetRef: "dm/creation/class/barbarian/affordance",
		namespace: "ui.affordance_reference",
		payloadJson: '{"definition_ref":"srd/class/barbarian"}',
		audience: "public",
		bundleId: "dm",
		source: "manifest",
		setAtTick: 0n,
		...overrides,
	};
}

describe("readAffordanceDefinitionRefs", () => {
	it("projects the exact public definition reference for an affordance template", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachment()],
		});
		expect(readAffordanceDefinitionRefs(db)).toEqual(
			new Map([["dm/creation/class/barbarian/affordance", "srd/class/barbarian"]]),
		);
	});

	it("rejects malformed, non-public, and unrelated attachments", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachment({ rowId: 2n, payloadJson: "not-json" }),
				attachment({ rowId: 3n, audience: "author" }),
				attachment({ rowId: 4n, namespace: "ui.affordance_group" }),
			],
		});
		expect(readAffordanceDefinitionRefs(db)).toEqual(new Map());
	});
});
