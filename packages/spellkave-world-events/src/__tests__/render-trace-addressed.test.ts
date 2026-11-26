// sk-jay0.1.23.21: `renderWorldEventLine`'s `trace_addressed` arm. The line is
// built from `trace_kind`, `inscribed_by_name` and `addressee_name` ONLY —
// the payload is an arbitrary authored object and must never reach the
// world's voice. These cases pin the three inscriber shapes and, above all,
// that no payload value appears in any of them.
//
// sk-jay0.1.8.63.40 added two structural fields the renderer DOES read:
// `addressed_at_self` (renders "you" instead of reflecting the perceiving
// actor's own name back at them) and the one authored payload escape hatch,
// `label` (renders "{inscriber}'s {label} {to}." instead of the generic
// "{inscriber} signals {to} ({trace_kind})." line) — see the bottom describe
// block below. Every other payload key stays unread.
import { describe, expect, it } from "vitest";

import type { TraceAddressedEvent } from "../world-events.ts";
import { renderWorldEventLine } from "../world-events.ts";

const base: TraceAddressedEvent = {
	kind: "trace_addressed",
	trace_id: "42",
	trace_kind: "kavemouth/adventure/trace/companion_command",
	payload: { command: "hold", addressee: 3, secret_note: "never rendered" },
	inscribed_by: "7",
	inscribed_by_name: "Aldwin",
	inscribed_at: 10,
	addressee: 3,
	addressee_name: "Hesper",
	// This fixture is a bystander's own view — Hesper (the addressee) is a
	// different actor than whoever perceives this event.
	addressed_at_self: false,
	location_kind: "place_node",
	location_ref: "inn",
	observed_at_tick: 11,
};

describe("renderWorldEventLine — trace_addressed", () => {
	it("names a perceived inscriber and a perceived addressee", () => {
		expect(renderWorldEventLine(base)).toBe(
			"🌍 Aldwin signals Hesper (kavemouth/adventure/trace/companion_command).",
		);
	});

	it("keeps an unperceived addressee anonymous rather than fabricating a name", () => {
		expect(renderWorldEventLine({ ...base, addressee_name: null })).toBe(
			"🌍 Aldwin signals someone (kavemouth/adventure/trace/companion_command).",
		);
	});

	it("distinguishes an unseen inscriber from an ownerless one", () => {
		expect(renderWorldEventLine({ ...base, inscribed_by_name: null })).toBe(
			"🌍 An unseen figure signals Hesper (kavemouth/adventure/trace/companion_command).",
		);
		expect(renderWorldEventLine({ ...base, inscribed_by: null, inscribed_by_name: null })).toBe(
			"🌍 Something signals Hesper (kavemouth/adventure/trace/companion_command).",
		);
	});

	it("never renders a payload value", () => {
		const line = renderWorldEventLine(base);
		expect(line).not.toContain("hold");
		expect(line).not.toContain("never rendered");
	});
});

describe("renderWorldEventLine — trace_addressed, addressed_at_self (sk-jay0.1.8.63.40)", () => {
	it("renders 'you' instead of the addressee's own name when this actor IS the addressee", () => {
		expect(renderWorldEventLine({ ...base, addressed_at_self: true })).toBe(
			"🌍 Aldwin signals you (kavemouth/adventure/trace/companion_command).",
		);
	});

	it("still reads addressee_name when addressed_at_self is false, even if a name is known", () => {
		expect(renderWorldEventLine({ ...base, addressed_at_self: false })).toBe(
			"🌍 Aldwin signals Hesper (kavemouth/adventure/trace/companion_command).",
		);
	});
});

describe("renderWorldEventLine — trace_addressed, label (sk-jay0.1.8.63.40)", () => {
	it("renders '{inscriber}'s {label} {to}.' instead of the generic trace_kind line when label is present", () => {
		expect(renderWorldEventLine({ ...base, label: "Ranged Attack misses" })).toBe(
			"🌍 Aldwin's Ranged Attack misses Hesper.",
		);
	});

	it("renders 'you' as the target when the labelled trace addresses this actor", () => {
		expect(
			renderWorldEventLine({ ...base, label: "Ranged Attack misses", addressed_at_self: true }),
		).toBe("🌍 Aldwin's Ranged Attack misses you.");
	});

	it("keeps the unseen/ownerless inscriber shapes with a label present", () => {
		expect(
			renderWorldEventLine({ ...base, label: "Ranged Attack misses", inscribed_by_name: null }),
		).toBe("🌍 An unseen figure's Ranged Attack misses Hesper.");
		expect(
			renderWorldEventLine({
				...base,
				label: "Ranged Attack misses",
				inscribed_by: null,
				inscribed_by_name: null,
			}),
		).toBe("🌍 Something's Ranged Attack misses Hesper.");
	});

	it("never renders a payload value even with a label present", () => {
		const line = renderWorldEventLine({ ...base, label: "Ranged Attack misses" });
		expect(line).not.toContain("hold");
		expect(line).not.toContain("never rendered");
	});
});
