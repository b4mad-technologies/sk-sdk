// sk-jay0.1.8.96 / .101: `renderWorldEventLine`'s `self_hit` arm (2026-11-12
// compatibility decision, `ledger/designs/unified-world-event-stream.md`).
// Two properties matter more than the wording: the line says who hit this
// actor only when the producer resolved a name, and neither the outcome
// template id (`attack_kind`) nor the raw `attacker_id` ever reaches the
// sentence.
import { describe, expect, it } from "vitest";

import type { SelfHitEvent } from "../world-events.ts";
import { isCausedByActor, renderWorldEventLine } from "../world-events.ts";

const base: SelfHitEvent = {
	kind: "self_hit",
	resource_id: "test/vigor",
	amount: 4,
	new_value: 6,
	attack_kind: "test/strike/outcome",
	attacker_id: "31",
	observed_at_tick: 11,
};

describe("renderWorldEventLine — self_hit", () => {
	it("names the attacker when the producer resolved a name", () => {
		expect(renderWorldEventLine({ ...base, attacker_name: "Warden" })).toBe(
			"🌍 Warden hits you for 4 test/vigor damage — now at 6.",
		);
	});

	it("names nobody without a resolved name, and never prints the attacker id", () => {
		const line = renderWorldEventLine(base);
		expect(line).toBe("🌍 You take 4 test/vigor damage — now at 6.");
		expect(line).not.toContain("31");
	});

	it("treats an empty name as no name", () => {
		expect(renderWorldEventLine({ ...base, attacker_name: "" })).toBe(
			"🌍 You take 4 test/vigor damage — now at 6.",
		);
	});

	it("reads the same for an ownerless hit", () => {
		expect(renderWorldEventLine({ ...base, attacker_id: null })).toBe(
			"🌍 You take 4 test/vigor damage — now at 6.",
		);
	});

	it("does not invent a remaining value the producer redacted", () => {
		const { new_value: _redacted, ...redacted } = base;
		expect(renderWorldEventLine({ ...redacted, attacker_name: "Warden" })).toBe(
			"🌍 Warden hits you for 4 test/vigor damage.",
		);
	});

	it("keeps the outcome template id out of every form of the sentence", () => {
		for (const event of [
			base,
			{ ...base, attacker_name: "Warden" },
			{ ...base, attacker_id: null },
		]) {
			expect(renderWorldEventLine(event)).not.toContain("test/strike/outcome");
		}
	});

	it("is never a consequence of the actor's own act, named or not", () => {
		expect(isCausedByActor({ ...base, attacker_name: "Warden" }, "31", 11)).toBe(false);
	});
});
