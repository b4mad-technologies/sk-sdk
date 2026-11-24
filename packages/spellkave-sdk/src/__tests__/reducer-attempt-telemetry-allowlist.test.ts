// sk-jay0.6.31.8: the SDK reducer-attempt allowlist is a runtime copy of
// WORLD_ACTOR_CORRELATION_ATTRIBUTE_KEYS (the SDK stays free of a runtime
// dependency on @spellkave/agent-observability). The exporter list is derived
// from that correlation list, so a key added only on the SDK side would be
// silently dropped at export. This test is the enforcement; do not "keep the
// two lists in sync by hand".

import {
	SAFE_TRACE_ATTRIBUTE_KEYS,
	WORLD_ACTOR_CORRELATION_ATTRIBUTE_KEYS,
} from "@spellkave/agent-observability";
import { describe, expect, it } from "vitest";
import { REDUCER_ATTEMPT_SAFE_TELEMETRY_ATTRIBUTES } from "../provenance";

describe("reducer-attempt telemetry allowlist (sk-jay0.6.31.8)", () => {
	it("equals the exporter correlation list and is a subset of SAFE_TRACE_ATTRIBUTE_KEYS", () => {
		expect([...REDUCER_ATTEMPT_SAFE_TELEMETRY_ATTRIBUTES]).toEqual([
			...WORLD_ACTOR_CORRELATION_ATTRIBUTE_KEYS,
		]);
		for (const key of REDUCER_ATTEMPT_SAFE_TELEMETRY_ATTRIBUTES) {
			expect(SAFE_TRACE_ATTRIBUTE_KEYS.has(key)).toBe(true);
		}
	});
});
