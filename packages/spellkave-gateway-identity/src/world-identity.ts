/**
 * SpacetimeDB world identity preimage (ADR-0102 D-2).
 * Identity = BLAKE3(iss|sub) from the access token handed to withToken().
 * Same iss+sub ⇒ same world identity; a different iss is a different person.
 */

import { decodeJwtUnverified } from "./jwt.ts";

export class WorldIdentityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WorldIdentityError";
	}
}

export interface WorldIdentity {
	iss: string;
	sub: string;
	/** `${iss}|${sub}` — the BLAKE3 preimage, not the hash. */
	key: string;
}

export function worldIdentityFromAccessToken(token: string): WorldIdentity {
	let payload: Record<string, unknown>;
	try {
		payload = decodeJwtUnverified(token).payload;
	} catch {
		throw new WorldIdentityError("access token is not a JWT");
	}
	const iss = typeof payload.iss === "string" ? payload.iss.trim() : "";
	const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
	if (iss === "" || sub === "") {
		throw new WorldIdentityError("access token missing iss or sub");
	}
	return { iss, sub, key: `${iss}|${sub}` };
}

/** True when two tokens hash to the same SpacetimeDB Identity. */
export function sameWorldIdentity(left: string, right: string): boolean {
	return worldIdentityFromAccessToken(left).key === worldIdentityFromAccessToken(right).key;
}
