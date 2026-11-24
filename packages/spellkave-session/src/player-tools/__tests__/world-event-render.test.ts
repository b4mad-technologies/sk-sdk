import { describe, expect, it } from "vitest";

import {
	type DealtConditionEvent,
	renderWorldEventLine,
	type SelfConditionChangedEvent,
	type SelfHitEvent,
	type SpeechHeardEvent,
} from "../index";

function speech(overrides: Partial<SpeechHeardEvent> = {}): SpeechHeardEvent {
	return {
		kind: "speech_heard",
		inscribed_at: 1,
		trace_id: "1",
		trace_kind: "test/speech",
		text: "Well met, traveler.",
		inscribed_by: "11",
		inscribed_by_name: null,
		location_kind: "place_node",
		location_ref: "node-1",
		observed_at_tick: 1,
		...overrides,
	};
}

// sk-dms.17. The pre-fix renderer had two cases and printed the raw entity id
// whenever attribution existed ("🌍 11 says: …") — unreadable to a player, and
// undiscoverable to a blind one, who has no way to learn that "11" is a person.
describe("renderWorldEventLine — speech_heard attribution", () => {
	it("names the speaker when the hearer perceives them", () => {
		expect(
			renderWorldEventLine(speech({ inscribed_by_name: "Aldwin, keeper of the hearth-ledger" })),
		).toBe('🌍 Aldwin, keeper of the hearth-ledger says: "Well met, traveler."');
	});

	it("stays anonymous — never leaks the entity id — when the speaker is attributed but unseen", () => {
		const line = renderWorldEventLine(speech());
		expect(line).toBe('🌍 An unseen speaker says: "Well met, traveler."');
		expect(line).not.toContain("11");
	});

	it("keeps the honest unattributed shape for an environmental trace", () => {
		expect(renderWorldEventLine(speech({ inscribed_by: null }))).toBe(
			'🌍 Something speaks: "Well met, traveler."',
		);
	});
});

describe("renderWorldEventLine — resource-delta sides", () => {
	const selfHit = (overrides: Partial<SelfHitEvent> = {}): SelfHitEvent => ({
		kind: "self_hit",
		resource_id: "srd/hp",
		amount: 4,
		new_value: 6,
		attack_kind: "srd/attack/melee/success",
		attacker_id: "1",
		observed_at_tick: 1,
		...overrides,
	});

	// 2026-11-12 compatibility decision
	// (`ledger/designs/unified-world-event-stream.md`): the line says who hit
	// you when the producer resolved a name, and the outcome template id
	// (`attack_kind`) never appears in the sentence.
	it("victim side names the attacker and reports remaining own HP", () => {
		const line = renderWorldEventLine(selfHit({ attacker_name: "Cellar Rat" }));
		expect(line).toBe("🌍 Cellar Rat hits you for 4 srd/hp damage — now at 6.");
		expect(line).not.toContain("srd/attack/melee/success");
	});

	it("victim side without a resolved name names nobody and never prints the attacker id", () => {
		const line = renderWorldEventLine(selfHit({ attacker_id: "31" }));
		expect(line).toBe("🌍 You take 4 srd/hp damage — now at 6.");
		expect(line).not.toContain("31");
		expect(line).not.toContain("srd/attack/melee/success");
	});

	it("victim side of an ownerless hit reads the same as an unnamed one", () => {
		expect(renderWorldEventLine(selfHit({ attacker_id: null }))).toBe(
			"🌍 You take 4 srd/hp damage — now at 6.",
		);
	});

	it("victim side with redacted new_value does not invent remaining HP", () => {
		expect(renderWorldEventLine(selfHit({ new_value: undefined }))).toBe(
			"🌍 You take 4 srd/hp damage.",
		);
		expect(
			renderWorldEventLine(selfHit({ new_value: undefined, attacker_name: "Cellar Rat" })),
		).toBe("🌍 Cellar Rat hits you for 4 srd/hp damage.");
	});

	it("source side reports damage dealt and never the target HP", () => {
		const line = renderWorldEventLine({
			kind: "dealt_hit",
			target_name: "Crypt Warden",
			amount: 6,
			attacker_id: "1",
			observed_at_tick: 1,
		});
		expect(line).toBe("🌍 You hit Crypt Warden for 6 damage.");
		expect(line).not.toMatch(/now at|srd\/hp/);
	});

	it("xp_gained reports an award, never a hit", () => {
		const line = renderWorldEventLine({
			kind: "xp_gained",
			amount: 300,
			new_value: 300,
			observed_at_tick: 21,
		});
		expect(line).toBe("🌍 You gain 300 experience — now at 300.");
		expect(line).not.toMatch(/hit|damage/);
	});

	it("self_resource_spent uses spend wording, never damage", () => {
		const line = renderWorldEventLine({
			kind: "self_resource_spent",
			resource_id: "srd/fighter/action-surge-uses",
			amount: 1,
			new_value: 0,
			source: "srd/fighter/action-surge/success",
			observed_at_tick: 34,
		});
		expect(line).toBe(
			"🌍 You spend 1 srd/fighter/action-surge-uses (srd/fighter/action-surge/success) — now at 0.",
		);
		expect(line).not.toMatch(/damage/);
	});
});

// K-B Part B: self_condition_changed / dealt_condition are the
// event_condition_delta sibling of self_hit / dealt_hit — applied/removed is
// the discriminator, condition_id a bare content id forwarded verbatim.
describe("renderWorldEventLine — condition-delta sides", () => {
	const selfConditionChanged = (
		overrides: Partial<SelfConditionChangedEvent> = {},
	): SelfConditionChangedEvent => ({
		kind: "self_condition_changed",
		condition_id: "srd/condition/prone",
		applied: true,
		source_entity_id: "1",
		observed_at_tick: 1,
		...overrides,
	});

	it("victim side reports being affected on apply", () => {
		expect(renderWorldEventLine(selfConditionChanged())).toBe(
			"🌍 You are now affected by srd/condition/prone.",
		);
	});

	it("victim side reports the condition lifting on removal", () => {
		expect(renderWorldEventLine(selfConditionChanged({ applied: false }))).toBe(
			"🌍 You are no longer affected by srd/condition/prone.",
		);
	});

	it("dealt_condition side names the target, never 'You'", () => {
		const dealt: DealtConditionEvent = {
			kind: "dealt_condition",
			target_name: "Crypt Warden",
			condition_id: "srd/condition/prone",
			applied: true,
			source_entity_id: "1",
			observed_at_tick: 1,
		};
		expect(renderWorldEventLine(dealt)).toBe(
			"🌍 Crypt Warden is now affected by srd/condition/prone.",
		);
		expect(renderWorldEventLine({ ...dealt, applied: false })).toBe(
			"🌍 Crypt Warden is no longer affected by srd/condition/prone.",
		);
	});
});
