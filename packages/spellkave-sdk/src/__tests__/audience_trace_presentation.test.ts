import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readAudienceTracePresentation } from "../core/readers/audience_trace_presentation";
import { parseDialogueGuide } from "../core/readers/dialogue_guide";
import { readManipulationContext } from "../core/readers/manipulation_context";

const ids = ["dm/dialog/choice/1", "dm/dialog/choice/2"] as const;
const marker = { presentation: "audience_trace" as const, labels: {} };
describe("occurrence-bound prompt presentation", () => {
	it("reads the captured trace rather than the newest speech from that source", () => {
		const db = snapshotDbFromFixture({
			visible_trace: [
				{
					traceId: 101n,
					payloadJson: JSON.stringify({ text: "Choose (2 more)", options: ["Fighter", "Wizard"] }),
				},
				{
					traceId: 102n,
					payloadJson: JSON.stringify({ text: "Later speech", options: ["Rogue", "Cleric"] }),
				},
			],
		});
		expect(readAudienceTracePresentation(db, "101", ids, marker)).toEqual({
			question: "Choose (2 more)",
			labels: { [ids[0]]: "Fighter", [ids[1]]: "Wizard" },
		});
	});
	it("falls back to neutral numbers when the trace is missing or label counts disagree", () => {
		for (const trace of [
			[],
			[{ traceId: 101n, payloadJson: JSON.stringify({ text: "Choose", options: ["one"] }) }],
		]) {
			const result = readAudienceTracePresentation(
				snapshotDbFromFixture({ visible_trace: trace }),
				"101",
				ids,
				marker,
			);
			expect(result?.labels).toEqual(Object.fromEntries(ids.map((id, i) => [id, String(i + 1)])));
		}
	});
	it("keeps static authored presentation and absent metadata unchanged", () => {
		const db = snapshotDbFromFixture({});
		const authored = { question: "Accept?", labels: { yes: "Accept" } };
		expect(readAudienceTracePresentation(db, "101", ids, authored)).toBe(authored);
		expect(readAudienceTracePresentation(db, "101", ids, undefined)).toBeUndefined();
	});
});

// Exercise the public projection, rather than only its presentation helper.
it("joins the captured audience trace into the disclosed prompt", () => {
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manipulation_context: [
			{ perceiverEntityId: 7n, schemaVersion: 1, revision: 1n, ready: true },
		],
		visible_manipulation_prompt: [
			{
				perceiverEntityId: 7n,
				occurrenceId: 99n,
				promptDefId: "dm/menu",
				contractVersion: 1,
				sourceRef: "entity:3",
				responseActionIds: [...ids],
				openedAtTick: 1n,
				consumed: false,
				audienceTraceId: 101n,
			},
		],
		public_metadata_attachment: [
			{
				targetKind: "prompt_definition",
				targetRef: "dm/menu",
				namespace: "dialogue.prompt",
				audience: "public",
				payloadJson: JSON.stringify({ presentation: "audience_trace" }),
			},
		],
		visible_trace: [
			{
				traceId: 101n,
				payloadJson: JSON.stringify({ text: "Which class?", options: ["Fighter", "Wizard"] }),
			},
			{
				traceId: 102n,
				payloadJson: JSON.stringify({ text: "Later", options: ["Rogue", "Cleric"] }),
			},
		],
	});
	expect(readManipulationContext(db, asEntityRef("entity:7"))).toMatchObject({
		status: "ready",
		prompts: [
			{
				presentation: {
					question: "Which class?",
					labels: { [ids[0]]: "Fighter", [ids[1]]: "Wizard" },
				},
			},
		],
	});
});

// K2: malformed/absent wire payload boundary; the live retention proof covers valid rows.
it.each([
	undefined,
	"invalid",
	'{"options":["one"]}',
	'{"options":[1,2]}',
])("missing or mismatched trace presentation stays neutral: %s", (payloadJson) => {
	const db = snapshotDbFromFixture({
		visible_trace: payloadJson === undefined ? [] : [{ traceId: 7n, payloadJson }],
	});
	expect(
		readAudienceTracePresentation(db, "7", ["private/choice/1", "private/choice/2"], {
			presentation: "audience_trace",
			labels: {},
		})?.labels,
	).toEqual({ "private/choice/1": "1", "private/choice/2": "2" });
});

// K2: optional parallel refs preserve slot alignment; absent refs reveal no description source.
it("projects exact per-option refs beside labels and omits options without refs", () => {
	const db = snapshotDbFromFixture({
		visible_trace: [
			{
				traceId: 7n,
				payloadJson: JSON.stringify({
					options: ["First", "Second"],
					option_definition_refs: ["srd/class/fighter", null],
				}),
			},
		],
	});
	expect(readAudienceTracePresentation(db, "7", ids, marker)).toEqual({
		labels: { [ids[0]]: "First", [ids[1]]: "Second" },
		response_refs: { [ids[0]]: "srd/class/fighter" },
	});
});

describe("the machine side of a guided question", () => {
	it("reads the speaker's machine side from the same captured trace", () => {
		const context = {
			guide: 1,
			step: "skills",
			reopened: false,
			remaining: 2,
			outline: [
				{
					step: "class",
					title: "Class",
					state: "answered",
					answers: [{ label: "Fighter", ref: "srd/class/fighter" }],
				},
				{ step: "skills", title: "Skill", state: "open" },
				{ step: "kit", title: "Starting kit", state: "ahead" },
			],
		};
		const db = snapshotDbFromFixture({
			visible_trace: [
				{
					traceId: 101n,
					payloadJson: JSON.stringify({ text: "Choose", options: ["A", "B"], context }),
				},
			],
		});
		expect(readAudienceTracePresentation(db, "101", ids, marker)?.guide).toEqual({
			...context,
			outline: [
				context.outline[0],
				{ ...context.outline[1], answers: [] },
				{ ...context.outline[2], answers: [] },
			],
		});
	});
	it("drops a machine side it cannot read whole and keeps the question", () => {
		const good = { guide: 1, step: "s", reopened: false, outline: [] };
		expect(parseDialogueGuide(good)).toEqual(good);
		for (const bad of [
			undefined,
			"text",
			{ ...good, guide: 2 },
			{ ...good, step: "" },
			{ ...good, outline: "none" },
			{ ...good, outline: [{ step: "s", title: "T", state: "done" }] },
			{ ...good, outline: [{ step: "s", title: "T", state: "open", answers: [{ label: 7 }] }] },
			{ ...good, remaining: 0 },
			{ ...good, descriptions: [7] },
			{
				...good,
				outline: Array.from({ length: 49 }, () => ({ step: "s", title: "T", state: "ahead" })),
			},
		]) {
			expect(parseDialogueGuide(bad)).toBeUndefined();
			const db = snapshotDbFromFixture({
				visible_trace: [
					{
						traceId: 101n,
						payloadJson: JSON.stringify({ text: "Choose", options: ["A", "B"], context: bad }),
					},
				],
			});
			expect(readAudienceTracePresentation(db, "101", ids, marker)).toEqual({
				question: "Choose",
				labels: { [ids[0]]: "A", [ids[1]]: "B" },
			});
		}
	});
});
