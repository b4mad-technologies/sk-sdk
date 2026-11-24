import { describe, expect, it } from "vitest";
import { createWorldEventFanout } from "../fanout.ts";
import type {
	SpeechHeardEvent,
	WorldEvent,
	WorldEventBuilder,
	XpGainedEvent,
} from "../world-events.ts";

function scriptedBuilder(batches: WorldEvent[][]): WorldEventBuilder {
	const remaining = [...batches];
	return {
		diffAndAdvance: () => remaining.shift() ?? [],
		takeWhere: () => {
			throw new Error("fan-out must not call inner takeWhere — that would be a second cursor");
		},
	};
}

const reply: SpeechHeardEvent = {
	kind: "speech_heard",
	inscribed_at: 20,
	trace_id: "trace-reply",
	trace_kind: "utterance",
	text: "The deep tomb is open enough to enter.",
	inscribed_by: "9",
	inscribed_by_name: "Aldwin",
	location_kind: "place_node",
	location_ref: "common-room",
	observed_at_tick: 20,
};

const xp: XpGainedEvent = {
	kind: "xp_gained",
	amount: 25,
	new_value: 25,
	observed_at_tick: 20,
};

const isReply = (event: WorldEvent): boolean => event.kind === "speech_heard";

describe("createWorldEventFanout", () => {
	it("a speech_heard claimed by takeWhere during a tool call still reaches drainObserved (the Play chronicle)", () => {
		const fanout = createWorldEventFanout(scriptedBuilder([[reply, xp]]));
		const replies = fanout.takeWhere(isReply);
		const chronicle = fanout.drainObserved();
		const leftover = fanout.diffAndAdvance();
		expect(replies).toEqual([reply]);
		expect(chronicle).toEqual([reply, xp]);
		expect(leftover).toEqual([xp]);
	});

	it("takeWhere claims a reply so leftover (piggyback) does not also carry it", () => {
		const fanout = createWorldEventFanout(scriptedBuilder([[reply, xp]]));
		const replies = fanout.takeWhere(isReply);
		const leftover = fanout.diffAndAdvance();
		expect(replies).toEqual([reply]);
		expect(leftover).toEqual([xp]);
	});

	it("leftover drain before takeWhere would steal the reply (the live-publish hazard)", () => {
		const fanout = createWorldEventFanout(scriptedBuilder([[reply, xp]]));
		const leftoverFirst = fanout.diffAndAdvance();
		const repliesAfter = fanout.takeWhere(isReply);
		expect(leftoverFirst).toEqual([reply, xp]);
		expect(repliesAfter).toEqual([]);
		expect(fanout.drainObserved()).toEqual([reply, xp]);
	});

	it("observe during a claim lets takeWhere see a later batch without leftover stealing it", () => {
		const fanout = createWorldEventFanout(scriptedBuilder([[xp], [reply]]));
		fanout.observe();
		const replies = fanout.takeWhere(isReply);
		const leftover = fanout.diffAndAdvance();
		expect(replies).toEqual([reply]);
		expect(leftover).toEqual([xp]);
		expect(fanout.drainObserved()).toEqual([xp, reply]);
	});
});
