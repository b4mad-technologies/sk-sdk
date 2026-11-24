// sk-jay0.1.11: `conversation.response` (`ConversationReply`, `observation.ts`)
// carries the SAME `addressee`/`addressee_name` fields `speech_heard` does.
// `awaitConversationReply` (`tools.ts`) is the sole construction site and
// needs a live builder + reply-window harness (already proven end-to-end,
// out-of-package, by `act-affordance-communicate-reply.test.ts`) — these
// cases instead pin `buildConversationResult`'s own contract: the envelope
// it hands back names the fields verbatim, for the three shapes the field
// contract promises (a perceived addressee, a known-but-unperceived one,
// and untargeted reply speech, where — unlike the `speech_heard` push event,
// which leaves both keys ABSENT for untargeted speech, `world-events.ts`'s
// `SpeechHeardEvent` doc comment — this per-call envelope normalizes to an
// explicit `null` since there is no legacy literal shape to protect,
// `observation.ts`'s `ConversationReply` doc comment).
import { describe, expect, it } from "vitest";
import { buildConversationResult, type ConversationReply } from "../observation.ts";

function reply(overrides: Partial<ConversationReply> = {}): ConversationReply {
	return {
		speaker: "2",
		speaker_name: "Aldwin",
		addressee: null,
		addressee_name: null,
		text: "Well met, traveler.",
		trace_id: "trace-1",
		...overrides,
	};
}

describe("buildConversationResult — addressee fields", () => {
	it("names a perceived addressee", () => {
		const result = buildConversationResult(
			true,
			"Anyone there?",
			reply({ addressee: 1, addressee_name: "Hero" }),
		);
		expect(result.response).toEqual(reply({ addressee: 1, addressee_name: "Hero" }));
		expect(result.awaiting_response).toBe(false);
	});

	it("keeps addressee_name null for a known but unperceived addressee", () => {
		const result = buildConversationResult(
			true,
			"Anyone there?",
			reply({ addressee: 7, addressee_name: null }),
		);
		expect(result.response).toMatchObject({ addressee: 7, addressee_name: null });
	});

	it("carries an explicit null addressee for untargeted reply speech", () => {
		const result = buildConversationResult(true, "Anyone there?", reply());
		expect(result.response).toMatchObject({ addressee: null, addressee_name: null });
	});

	it("stays awaiting with no response envelope when no reply landed in the window", () => {
		const result = buildConversationResult(true, "Anyone there?", null);
		expect(result).toEqual({
			spoken_by_player: "Anyone there?",
			response: null,
			awaiting_response: true,
			continuity: null,
		});
	});
});
