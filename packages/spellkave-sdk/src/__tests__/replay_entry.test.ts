import { describe, expect, it } from "vitest";
import {
	BoundedRecording,
	captureSnapshotFrame,
	type JsonValue,
	parseRecordingEnvelope,
	readRecentEvents,
	snapshotDbFromCaptureFrame,
	snapshotDbFromFixture,
} from "../replay";

describe("@spellkave/sdk/replay", () => {
	it("retains JSON-safe frames by count and age while a paused cursor keeps recording", () => {
		let now = 100;
		const recording = new BoundedRecording<{ value: number }>({
			limit: 3,
			maxAgeMs: 10,
			now: () => now,
		});
		recording.record({ value: 1 });
		now = 105;
		recording.record({ value: 2 });
		recording.pause();
		now = 109;
		recording.record({ value: 3 });
		expect(recording.cursor()).toEqual({ kind: "paused", sequence: 2 });
		expect(recording.frameAtCursor()?.payload).toEqual({ value: 2 });
		now = 116;
		recording.record({ value: 4 });
		expect(recording.frames().map((frame) => frame.payload.value)).toEqual([3, 4]);
		// The paused target aged out, so it clamps to the oldest retained frame.
		expect(recording.frameAtCursor()?.payload).toEqual({ value: 3 });
	});

	it("exports defensive JSON copies and parses only its own valid envelope", () => {
		const recording = new BoundedRecording<{ nested: { value: string } }>({
			limit: 2,
			now: () => 10,
		});
		recording.record({ nested: { value: "original" } });
		const exported = recording.export("spellkave.play");
		const firstExport = exported.frames[0];
		if (firstExport === undefined) throw new Error("expected exported frame");
		firstExport.payload.nested.value = "mutated";
		expect(recording.frames()[0]?.payload.nested.value).toBe("original");

		const parsed = parseRecordingEnvelope(
			JSON.parse(JSON.stringify(recording.export("spellkave.play"))),
			{
				surface: "spellkave.play",
				parsePayload: (value) =>
					typeof value === "object" &&
					value !== null &&
					!Array.isArray(value) &&
					typeof value.nested === "object" &&
					value.nested !== null &&
					!Array.isArray(value.nested) &&
					typeof value.nested.value === "string"
						? { nested: { value: value.nested.value } }
						: null,
			},
		);
		expect(parsed?.frames[0]?.payload).toEqual({ nested: { value: "original" } });
		expect(
			parseRecordingEnvelope(
				{
					kind: "spellkave.recording",
					version: 2,
					surface: "spellkave.play",
					capturedAt: 1,
					frames: [],
				},
				{ surface: "spellkave.play", parsePayload: (value) => value },
			),
		).toBeNull();
		expect(
			parseRecordingEnvelope(
				{
					kind: "spellkave.recording",
					version: 1,
					surface: "spellkave.play",
					capturedAt: 1,
					frames: [{ sequence: 1, capturedAt: 1, payload: { bad: undefined } }],
				},
				{ surface: "spellkave.play", parsePayload: (value) => value },
			),
		).toBeNull();
	});

	it("keeps recording and frame ids stable when export metadata changes", () => {
		const recording = new BoundedRecording<{ value: number }>({
			limit: 2,
			id: "recording_demo",
			now: () => 10,
		});
		recording.record({ value: 1 });
		const live = recording.export("spellkave.play", {
			provenance: { source: "live", build: "dev" },
		});
		const fixture = recording.export("spellkave.play", {
			provenance: { source: "fixture", title: "Review fixture" },
		});
		expect(fixture.id).toBe(live.id);
		expect(fixture.frames.map((frame) => frame.id)).toEqual(live.frames.map((frame) => frame.id));
		expect(() => recording.export("spellkave.play", { id: "recording_other" })).toThrow(
			"recording id cannot change",
		);
	});

	it("migrates a v1 recording deterministically and rejects unbounded v2 metadata", () => {
		const v1 = {
			kind: "spellkave.recording",
			version: 1,
			surface: "spellkave.play",
			capturedAt: 5,
			frames: [{ sequence: 1, capturedAt: 4, payload: { value: 1 } }],
		};
		const parser = { surface: "spellkave.play", parsePayload: (value: JsonValue) => value };
		const first = parseRecordingEnvelope(v1, parser);
		const second = parseRecordingEnvelope(JSON.parse(JSON.stringify(v1)), parser);
		expect(first).toEqual(second);
		expect(first?.version).toBe(2);
		expect(first?.provenance).toEqual({ source: "legacy" });
		expect(first?.frames[0]?.id).toMatch(/^legacy_frame_/);

		const valid = new BoundedRecording<{ value: number }>({ limit: 1, id: "recording_valid" });
		valid.record({ value: 1 });
		const exported = valid.export("spellkave.play", { provenance: { source: "fixture" } });
		expect(
			parseRecordingEnvelope(
				{ ...exported, provenance: { source: "fixture", token: "never-allowed" } },
				parser,
			),
		).toBeNull();
		expect(
			parseRecordingEnvelope(
				{ ...exported, frames: [exported.frames[0], exported.frames[0]] },
				parser,
			),
		).toBeNull();
	});

	it("replays captured world events without the live connection entry", () => {
		// Deliberately keyed under the OLD `world_event` accessor (pre-#915
		// PR-8, when the raw table was public) — `readRecentEvents` tries
		// `visible_world_event` first and falls back to this name, so
		// pre-existing frozen captures (e.g.
		// apps/world-review/src/fixtures/review-capture.json) keep replaying.
		// The `Tick` row is deliberately kept: this fixture stands in for a
		// capture recorded before scope-tick-event-visibility, when a tick row
		// really did reach the view — replay must still decode it correctly
		// even though the live server no longer writes one.
		const db = snapshotDbFromFixture({
			visible_entity_tag: [],
			visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
			world_event: [
				{ id: 1n, tick: 1n, kind: { tag: "tick" }, summary: { some: "World tick 1" } },
				{ id: 2n, tick: 2n, kind: { tag: "intent" }, summary: { some: "Player looked" } },
			],
		});
		const frame = captureSnapshotFrame(db, { tick: 2, tables: ["world_event"] });

		expect(frame.tables.world_event).toEqual([
			{ id: 1, tick: 1, kind: { tag: "tick" }, summary: { some: "World tick 1" } },
			{ id: 2, tick: 2, kind: { tag: "intent" }, summary: { some: "Player looked" } },
		]);
		expect(readRecentEvents(snapshotDbFromCaptureFrame(frame), 1)).toEqual([
			{ id: "2", tick: 2, kind: "intent", summary: "Player looked" },
		]);
	});
});
