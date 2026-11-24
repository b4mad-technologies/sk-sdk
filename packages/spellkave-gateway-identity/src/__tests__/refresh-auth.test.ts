// A simulated player's refresh grant must only ever go to the AuthKit-domain
// issuer: a User Management issuer would mint a second world identity for the
// same person. This file pins the refusal message the issuer check gives. The
// command hides that message today (it reports "no machine-user seed"), so no
// behaviour scenario can see it. Pure function; no files, no network.
// (ADR-0124 D-7, ADR-0102 D-2; the hidden message is bug sk-jay0.5.17)

import { describe, expect, it } from "vitest";

import { assertAuthKitIssuer } from "../refresh-auth.ts";

describe("only an AuthKit-domain issuer may receive the refresh grant (assertAuthKitIssuer)", () => {
	// keep(K1): rule cases of the pure issuer check; its message is not visible from the command
	it("refuses the User Management issuer by name and accepts an AuthKit domain", () => {
		expect(() => assertAuthKitIssuer("https://api.workos.com/user_management/client_x")).toThrow(
			"User Management issuer is forbidden",
		);
		expect(assertAuthKitIssuer("https://tenant.authkit.app/")).toBe("https://tenant.authkit.app");
	});
});
