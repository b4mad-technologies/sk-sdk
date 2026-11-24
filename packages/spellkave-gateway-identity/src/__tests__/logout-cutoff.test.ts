// The "logout everywhere" cutoff (ADR-0161 D-7 step 4). The behaviour suites
// prove the refusal through real requests (packages/spellkave-api/behaviour/
// logout.feature, packages/spellkave-mcp/behaviour/login.feature). What stays
// here: the value and `iat` rules, and the WorkOS outage path, which no
// scenario can provoke without an injected fetch.

import { describe, expect, it } from "vitest";

import {
	createWorkosLogoutCutoff,
	issuedBeforeCutoff,
	parseLogoutAfter,
} from "../logout-cutoff.ts";

describe("logout_after values and token age", () => {
	// keep(K1): rule space of a pure parser over what WorkOS metadata may hold
	it("accepts only decimal unix seconds", () => {
		expect(parseLogoutAfter("1760616000")).toBe(1_760_616_000);
		for (const bad of [
			undefined,
			null,
			1760616000,
			"",
			" 1",
			"1.5",
			"-1",
			"1e9",
			"x",
			"1".repeat(13),
		])
			expect(parseLogoutAfter(bad)).toBeUndefined();
	});

	// keep(K1): rule space of a pure predicate
	it("counts a token as revoked when iat is before the cutoff minus the skew, or missing", () => {
		// LOGOUT_CUTOFF_SKEW_S = 5: issued 6 s before the sign-out is revoked,
		// 5 s before (clock skew), the same second or later passes.
		expect(issuedBeforeCutoff({ iat: 94 }, 100)).toBe(true);
		expect(issuedBeforeCutoff({ iat: 95 }, 100)).toBe(false);
		expect(issuedBeforeCutoff({ iat: 100 }, 100)).toBe(false);
		expect(issuedBeforeCutoff({ iat: 101 }, 100)).toBe(false);
		expect(issuedBeforeCutoff({}, 100)).toBe(true);
		expect(issuedBeforeCutoff({ iat: "101" }, 100)).toBe(true);
	});
});

describe("createWorkosLogoutCutoff", () => {
	function harness() {
		let clock = 1_000_000;
		const answers: (Response | Error)[] = [];
		const asked: string[] = [];
		const logged: Record<string, unknown>[] = [];
		const fetchImpl = (async (url: string) => {
			asked.push(String(url));
			const next = answers.shift() ?? new Error("no answer queued");
			if (next instanceof Error) throw next;
			return next;
		}) as typeof fetch;
		const cutoff = createWorkosLogoutCutoff({
			workosApiKey: "fake-workos-key",
			baseUrl: "https://workos.test",
			fetchImpl,
			now: () => clock,
			log: (record) => logged.push(record),
		});
		const user = (metadata: Record<string, string>) =>
			new Response(JSON.stringify({ id: "user_1", metadata }), { status: 200 });
		return {
			cutoff,
			answers,
			asked,
			logged,
			user,
			advance: (ms: number) => {
				clock += ms;
			},
		};
	}

	// keep(K2): the 30 s cache window needs an injected clock
	it("asks WorkOS once per subject per 30 s", async () => {
		const h = harness();
		h.answers.push(h.user({ logout_after: "500" }), h.user({ logout_after: "600" }));
		expect(await h.cutoff.notBefore("user_1")).toBe(500);
		h.advance(29_000);
		expect(await h.cutoff.notBefore("user_1")).toBe(500);
		h.advance(2_000);
		expect(await h.cutoff.notBefore("user_1")).toBe(600);
		expect(h.asked).toEqual([
			"https://workos.test/user_management/users/user_1",
			"https://workos.test/user_management/users/user_1",
		]);
	});

	// keep(K2): a WorkOS outage needs an injected fetch fault
	it("keeps the last known cutoff when WorkOS fails, and logs it", async () => {
		const h = harness();
		h.answers.push(h.user({ logout_after: "500" }), new Error("ECONNRESET"));
		expect(await h.cutoff.notBefore("user_1")).toBe(500);
		h.advance(31_000);
		expect(await h.cutoff.notBefore("user_1")).toBe(500);
		expect(h.logged).toEqual([
			{ event: "logout_cutoff_unavailable", error: "ECONNRESET", has_stale_value: true },
		]);
	});

	// keep(K2): fail-open without a stale value needs an injected HTTP 500
	it("has no cutoff for an unknown or unreachable subject", async () => {
		const h = harness();
		h.answers.push(new Response("{}", { status: 404 }), new Response("{}", { status: 500 }));
		expect(await h.cutoff.notBefore("user_gone")).toBeUndefined();
		expect(await h.cutoff.notBefore("user_2")).toBeUndefined();
		expect(h.logged).toHaveLength(1);
	});

	// keep(K3): concurrent first requests share one lookup
	it("shares one lookup between concurrent requests", async () => {
		const h = harness();
		h.answers.push(h.user({ logout_after: "700" }));
		const results = await Promise.all([h.cutoff.notBefore("user_1"), h.cutoff.notBefore("user_1")]);
		expect(results).toEqual([700, 700]);
		expect(h.asked).toHaveLength(1);
	});
});
