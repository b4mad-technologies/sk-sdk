// A gateway reads a signed-in person's roles from the verified token to decide
// who is an operator. These cases enumerate how a roles value of any shape is
// read. Who counts as an operator (role, subject allowlist, refusals) is
// proven through a real request by the Account API behaviour suite
// (packages/spellkave-api/behaviour/admin-sql.feature). Pure function; no
// token, no network. (sk-jay0.5.14.10, sk-adr8.6)

// keep-file(K1): rule cases of the pure roles reader; the gateway's verifier already filters roles, so a request never reaches these guards

import { describe, expect, it } from "vitest";

import { rolesFromAuthInfo } from "../operator.ts";

describe("reading the roles claim (rolesFromAuthInfo)", () => {
	it("returns the verified roles claim as a string array", () => {
		expect(rolesFromAuthInfo({ extra: { roles: ["operator"] } })).toEqual(["operator"]);
	});

	it("returns [] when extra.roles is absent", () => {
		expect(rolesFromAuthInfo({ extra: { subject: "user_alice" } })).toEqual([]);
		expect(rolesFromAuthInfo({})).toEqual([]);
	});

	it("ignores a non-array roles claim", () => {
		expect(rolesFromAuthInfo({ extra: { roles: "operator" } })).toEqual([]);
	});

	it("drops non-string entries from a malformed roles array", () => {
		expect(rolesFromAuthInfo({ extra: { roles: ["operator", 1, null, "member"] } })).toEqual([
			"operator",
			"member",
		]);
	});
});
