import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { readAffordanceDefaults } from "../core/readers/affordance_defaults";

function attachment(overrides: Record<string, unknown>) {
	return {
		key: "1",
		targetKind: "affordance_template",
		targetRef: "demo/dodge/affordance",
		namespace: "ui.affordance_defaults",
		audience: "public",
		payloadJson: '{"version":1,"target":{"kind":"actor"}}',
		setAtTick: 3n,
		...overrides,
	};
}

describe("readAffordanceDefaults", () => {
	it("projects one bounded, authored whole with provenance", () => {
		const defaults = readAffordanceDefaults(
			snapshotDbFromFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
				public_metadata_attachment: [attachment({})],
			}),
			new Map(),
		);
		expect(defaults.get("demo/dodge/affordance")).toMatchObject({
			target: { kind: "actor" },
			provenance: {
				namespace: "ui.affordance_defaults",
				template_id: "demo/dodge/affordance",
				attachment_id: "1",
			},
		});
	});

	it("admits only schema-validated scalar input values", () => {
		const schema = new Map([
			[
				"demo/speak/affordance",
				{ fields: [{ name: "tone", label: "Tone", control: "text" as const, maxLength: 10 }] },
			],
		]);
		const defaults = readAffordanceDefaults(
			snapshotDbFromFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
				public_metadata_attachment: [
					attachment({
						targetRef: "demo/speak/affordance",
						payloadJson: '{"version":1,"input_values":{"tone":"formal"}}',
					}),
					attachment({
						key: "2",
						targetRef: "demo/bad/affordance",
						payloadJson: '{"version":1,"input_values":{"utterance":"invented"}}',
					}),
				],
			}),
			schema,
		);
		expect(defaults.get("demo/speak/affordance")?.input_values).toEqual({ tone: "formal" });
		expect(defaults.has("demo/bad/affordance")).toBe(false);
	});

	it("withholds ambiguous duplicate attachments rather than inventing precedence", () => {
		const defaults = readAffordanceDefaults(
			snapshotDbFromFixture({
				visible_entity_tag: [],
				visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
				public_metadata_attachment: [attachment({}), attachment({ key: "2" })],
			}),
			new Map(),
		);
		expect(defaults.has("demo/dodge/affordance")).toBe(false);
	});
});
