import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { readAffordanceInputSchemas } from "../core/readers/affordance_input";

function attachmentRow(overrides: Record<string, unknown>) {
	return {
		rowId: 1n,
		targetKind: "affordance_template",
		targetRef: "homebrew/inscribe/affordance",
		namespace: "ui.affordance_input",
		payloadJson:
			'{"fields":[{"name":"message","label":"Message","control":"textarea","max_length":240}],"submit_label":"Inscribe"}',
		audience: "public",
		bundleId: "homebrew",
		source: "manifest",
		setAtTick: 0n,
		...overrides,
	};
}

describe("readAffordanceInputSchemas", () => {
	it("projects a strictly-shaped, world-authored form schema", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachmentRow({})],
		});
		expect(readAffordanceInputSchemas(db).get("homebrew/inscribe/affordance")).toEqual({
			fields: [
				{
					name: "message",
					label: "Message",
					control: "textarea",
					maxLength: 240,
				},
			],
			submitLabel: "Inscribe",
		});
	});

	it("projects a field's transport channel and drops an unknown one", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachmentRow({
					payloadJson: JSON.stringify({
						fields: [
							{ name: "name", label: "Name", control: "text", channel: "utterance" },
							{ name: "count", label: "Count", control: "number", channel: "args_json" },
							{ name: "odd", label: "Odd", control: "text", channel: "telepathy" },
						],
					}),
				}),
			],
		});
		expect(readAffordanceInputSchemas(db).get("homebrew/inscribe/affordance")?.fields).toEqual([
			{ name: "name", label: "Name", control: "text", channel: "utterance" },
			{ name: "count", label: "Count", control: "number", channel: "args_json" },
			{ name: "odd", label: "Odd", control: "text" },
		]);
	});

	it("keeps an explicit empty schema and rejects malformed fields", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachmentRow({
					rowId: 1n,
					targetRef: "homebrew/button/affordance",
					payloadJson: '{"fields":[]}',
				}),
				attachmentRow({
					rowId: 2n,
					targetRef: "homebrew/bad/affordance",
					payloadJson: '{"fields":[{"name":"x","control":"unknown"}]}',
				}),
			],
		});
		const schemas = readAffordanceInputSchemas(db);
		expect(schemas.get("homebrew/button/affordance")).toEqual({ fields: [] });
		expect(schemas.has("homebrew/bad/affordance")).toBe(false);
	});
});
