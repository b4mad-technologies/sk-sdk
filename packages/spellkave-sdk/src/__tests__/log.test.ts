import { afterEach, describe, expect, it } from "vitest";

import { logKind, setLogSink } from "../core/log";

// Restore default sink after each test.
afterEach(() => {
	setLogSink((line) => {
		// swallow — tests that don't override should not emit
		void line;
	});
});

describe("logKind", () => {
	it("captures output with a custom sink", () => {
		const captured: string[] = [];
		setLogSink((line) => captured.push(line));

		logKind("world_time_unavailable", { actor_id: "scout" });

		expect(captured).toHaveLength(1);
		// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
		const parsed = JSON.parse(captured[0]!);
		expect(parsed).toEqual({ kind: "world_time_unavailable", actor_id: "scout" });
	});

	it("serialises bigint fields without throwing", () => {
		const captured: string[] = [];
		setLogSink((line) => captured.push(line));

		logKind("tick_event", { tick: 42n });

		expect(captured).toHaveLength(1);
		// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
		const parsed = JSON.parse(captured[0]!);
		expect(parsed.tick).toBe("42");
	});

	it("includes all extra fields in the emitted object", () => {
		const captured: string[] = [];
		setLogSink((line) => captured.push(line));

		logKind("test_kind", { a: 1, b: "two", c: true });

		// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
		const parsed = JSON.parse(captured[0]!);
		expect(parsed).toEqual({ kind: "test_kind", a: 1, b: "two", c: true });
	});
});
