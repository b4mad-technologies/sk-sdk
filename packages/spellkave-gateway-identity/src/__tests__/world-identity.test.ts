// A player who signs in on the website and the same player's machine token
// must land on one SpacetimeDB identity, and a token from another issuer must
// not: the identity is BLAKE3 of the token's `iss|sub`. These tests pin that
// preimage, which SpacetimeDB hashes and no behaviour scenario can read back.
// Pure functions over unsigned test tokens; no network. (ADR-0102 D-2)
// The non-JWT refusal is a behaviour scenario (behaviour/mint.feature).

import { describe, expect, it } from "vitest";
import { sameWorldIdentity, worldIdentityFromAccessToken } from "../world-identity.ts";

function unsignedJwt(payload: Record<string, unknown>): string {
	const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${header}.${body}.sig`;
}

describe("one person, one world identity (ADR-0102 D-2)", () => {
	const iss = "https://tenant.authkit.app";
	const sub = "user_01MACHINE";

	// keep(K5): pins the iss|sub preimage SpacetimeDB hashes into the world identity
	it("is identical for an interactive AuthKit JWT and a machine-path JWT with the same iss|sub", () => {
		const interactive = unsignedJwt({
			iss,
			sub,
			aud: "https://mcp.spellkave.com/mcp",
			azp: "client_website",
		});
		const machine = unsignedJwt({
			iss,
			sub,
			aud: "https://mcp.spellkave.com/mcp",
			azp: "client_website",
			grant: "password",
		});
		expect(worldIdentityFromAccessToken(interactive)).toEqual({
			iss,
			sub,
			key: `${iss}|${sub}`,
		});
		expect(sameWorldIdentity(interactive, machine)).toBe(true);
	});

	// keep(K5): pins the iss|sub preimage SpacetimeDB hashes into the world identity
	it("differs when the same person is minted under the User Management issuer", () => {
		const interactive = unsignedJwt({ iss, sub, aud: "https://mcp.spellkave.com/mcp" });
		const userManagement = unsignedJwt({
			iss: "https://api.workos.com/user_management/client_x",
			sub,
			aud: "client_x",
		});
		expect(sameWorldIdentity(interactive, userManagement)).toBe(false);
	});
});
