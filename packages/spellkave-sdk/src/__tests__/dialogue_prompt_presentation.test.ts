import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { readDialoguePromptPresentation } from "../core/readers/dialogue_prompt_presentation";

function attachment(overrides: Record<string, unknown> = {}) {
	return {
		rowId: 1n,
		targetKind: "prompt_definition",
		targetRef: "dm/creation/class",
		namespace: "dialogue.prompt",
		payloadJson: JSON.stringify({
			question: "Which class?",
			responses: { "dm/dialog/choice/1": "Barbarian", "dm/dialog/choice/2": "Rogue" },
		}),
		audience: "public",
		bundleId: "dm",
		source: "manifest",
		setAtTick: 0n,
		...overrides,
	};
}

describe("readDialoguePromptPresentation", () => {
	it("projects the question and response labels for a prompt_definition", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [attachment()],
		});
		expect(readDialoguePromptPresentation(db)).toEqual(
			new Map([
				[
					"dm/creation/class",
					{
						question: "Which class?",
						labels: { "dm/dialog/choice/1": "Barbarian", "dm/dialog/choice/2": "Rogue" },
					},
				],
			]),
		);
	});

	it("projects picks_remaining as a positive integer and drops anything else", () => {
		const withCount = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachment({
					payloadJson: JSON.stringify({
						question: "Which skill (2 more)?",
						responses: { "dm/dialog/choice/1": "Athletics" },
						picks_remaining: 2,
					}),
				}),
			],
		});
		expect(readDialoguePromptPresentation(withCount).get("dm/creation/class")).toEqual({
			question: "Which skill (2 more)?",
			labels: { "dm/dialog/choice/1": "Athletics" },
			picks_remaining: 2,
		});
		const malformed = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachment({
					payloadJson: JSON.stringify({
						responses: { "dm/dialog/choice/1": "Athletics" },
						picks_remaining: "2",
					}),
				}),
			],
		});
		expect(readDialoguePromptPresentation(malformed).get("dm/creation/class")).toEqual({
			labels: { "dm/dialog/choice/1": "Athletics" },
		});
	});

	it("admits a payload with no question, keeping only labels", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachment({
					payloadJson: JSON.stringify({ responses: { "dm/dialog/choice/1": "Accept" } }),
				}),
			],
		});
		expect(readDialoguePromptPresentation(db)).toEqual(
			new Map([["dm/creation/class", { labels: { "dm/dialog/choice/1": "Accept" } }]]),
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
				attachment({ rowId: 5n, targetKind: "affordance_template" }),
				attachment({ rowId: 6n, payloadJson: JSON.stringify({ question: 7 }) }),
			],
		});
		expect(readDialoguePromptPresentation(db)).toEqual(new Map());
	});

	it("drops a non-string response label but keeps other well-formed ones", () => {
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			public_metadata_attachment: [
				attachment({
					payloadJson: JSON.stringify({
						responses: { "dm/dialog/choice/1": "Barbarian", "dm/dialog/choice/2": 7 },
					}),
				}),
			],
		});
		expect(readDialoguePromptPresentation(db)).toEqual(
			new Map([["dm/creation/class", { labels: { "dm/dialog/choice/1": "Barbarian" } }]]),
		);
	});
});
