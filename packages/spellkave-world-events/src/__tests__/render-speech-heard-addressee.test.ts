// sk-jay0.1.11: `renderWorldEventLine`'s speech_heard "to <name>" clause.
// `addressee`/`addressee_name` resolution itself happens in
// `@spellkave/sdk`'s world-event builder (this package owns only the closed
// `WorldEvent` shape and its renderer) — these cases pin the three shapes
// the renderer must distinguish: a perceived addressee, a known-but-
// unperceived one, and no addressee at all (untargeted speech, where
// `addressee` is simply absent from the event, never a fabricated `null`).
import { describe, expect, it } from "vitest";
import type { SpeechHeardEvent } from "../world-events.ts";
import { renderWorldEventLine } from "../world-events.ts";

const base: SpeechHeardEvent = {
	kind: "speech_heard",
	inscribed_at: 20,
	trace_id: "trace-1",
	trace_kind: "srd/speech",
	text: "Well met, traveler.",
	inscribed_by: "9",
	inscribed_by_name: "Aldwin",
	location_kind: "place_node",
	location_ref: "common-room",
	observed_at_tick: 20,
};

describe("renderWorldEventLine — speech_heard addressee clause", () => {
	it("names a perceived addressee", () => {
		const event: SpeechHeardEvent = { ...base, addressee: 2, addressee_name: "Mira" };
		expect(renderWorldEventLine(event)).toBe('🌍 Aldwin says to Mira: "Well met, traveler."');
	});

	it("says 'to someone' for a known but unperceived addressee, never fabricating a name", () => {
		const event: SpeechHeardEvent = { ...base, addressee: 99, addressee_name: null };
		expect(renderWorldEventLine(event)).toBe('🌍 Aldwin says to someone: "Well met, traveler."');
	});

	it("carries no 'to' clause for untargeted speech (addressee absent)", () => {
		expect(renderWorldEventLine(base)).toBe('🌍 Aldwin says: "Well met, traveler."');
	});

	it("keeps the 'to' clause on an unseen speaker's directed line", () => {
		const event: SpeechHeardEvent = {
			...base,
			inscribed_by: "9",
			inscribed_by_name: null,
			addressee: 2,
			addressee_name: "Mira",
		};
		expect(renderWorldEventLine(event)).toBe(
			'🌍 An unseen speaker says to Mira: "Well met, traveler."',
		);
	});
});
