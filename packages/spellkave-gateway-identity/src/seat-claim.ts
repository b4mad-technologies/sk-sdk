/**
 * Seat choice for third-party MCP clients (ADR-0161 D-5, bead sk-jay0.5.14.5.5).
 *
 * The person picks a hero on the WorkOS consent screen; WorkOS writes it into
 * the access token as `urn:spellkave:seat = "<world-slug>/<actor_id>"`. The
 * gateway reads it only from a token the resource server already verified
 * (signature, issuer, audience), routes world and actor from it, and claims a
 * free seat on first use. The claim is user-selected input, never authority:
 * the world re-checks it against `actor_identity`, and the module narrows
 * every write of that connection to the pinned actor (seat_pin.rs).
 */

import { decodeJwtUnverified } from "./jwt.ts";
import {
	type CatalogWorld,
	canClaimSeat,
	type WorldCatalog,
	worldsToProbeForSeat,
} from "./world-catalog.ts";
import type { WorldRoute, WorldSeatHit, WorldSelfCapability } from "./world-router.ts";

export const SEAT_CLAIM = "urn:spellkave:seat";

export const SEAT_UNAVAILABLE_HINT =
	"The hero picked for this connection is not available (held by someone else, not in this world, or over the seat limit). Pick another hero at https://spellkave.com, then reconnect.";

export interface SeatClaim {
	slug: string;
	actorId: string;
}

export class SeatClaimUnavailableError extends Error {
	readonly code = "seat_unavailable";
	readonly claim: SeatClaim | undefined;
	constructor(claim: SeatClaim | undefined) {
		super(`seat_unavailable: ${SEAT_UNAVAILABLE_HINT}`);
		this.claim = claim;
	}
}

/**
 * The seat claim of a VERIFIED token: undefined when absent, "invalid" when
 * present but malformed (the gateway then refuses rather than guessing).
 */
export function parseSeatClaim(verifiedToken: string): SeatClaim | "invalid" | undefined {
	let payload: Record<string, unknown>;
	try {
		payload = decodeJwtUnverified(verifiedToken).payload as Record<string, unknown>;
	} catch {
		return undefined;
	}
	if (!(SEAT_CLAIM in payload)) return undefined;
	const raw = payload[SEAT_CLAIM];
	if (typeof raw !== "string") return "invalid";
	const cut = raw.lastIndexOf("/");
	if (cut <= 0) return "invalid";
	const slug = raw.slice(0, cut);
	const actorId = raw.slice(cut + 1);
	if (!/^[0-9]+$/.test(actorId)) return "invalid";
	return { slug, actorId };
}

/** The connection's routing key: one session per subject AND picked seat. */
export function seatSessionKey(subject: string, claim: SeatClaim | undefined): string {
	return claim === undefined ? subject : `${subject}#${claim.slug}/${claim.actorId}`;
}

export type FindClaimedSeat = (
	world: CatalogWorld,
	token: string,
	actorId: string,
) => Promise<{
	actorId: string;
	boundAtTick: number;
	role?: string;
	currentTick?: number;
	selfCapabilities?: WorldSelfCapability[];
} | null>;

export type ClaimSeat = (world: CatalogWorld, token: string, actorId: string) => Promise<void>;

/** True when the world's public seat catalog lists `actorId` as a free (offered, unclaimed) seat. */
export type IsOfferedFreeSeat = (
	world: CatalogWorld,
	token: string,
	actorId: string,
) => Promise<boolean>;

export interface ClaimedSeatPorts {
	findClaimedSeat: FindClaimedSeat;
	isOfferedFreeSeat: IsOfferedFreeSeat;
	claimSeat: ClaimSeat;
}

/** A world read failed while routing a pick: transient, never cached, never a claim. */
export class SeatClaimProbeError extends Error {
	readonly code = "seat_probe_failed";
	constructor() {
		super("seat_probe_failed: the world could not be read right now; try again shortly.");
	}
}

async function probe<T>(read: () => Promise<T>): Promise<T> {
	try {
		return await read();
	} catch {
		throw new SeatClaimProbeError();
	}
}

/**
 * Route the picked seat. The pick is user-selected input (a WorkOS consent
 * enum is not trusted to be what the login site offered), so it is re-checked
 * against the same eligibility rule the picker uses (`login/seat-choice.ts`):
 *
 * - the world must be one the person may reach (running, or owned/joined);
 * - a seat the caller already holds as `primary` is routed as is;
 * - otherwise the world must let the person claim (`canClaimSeat`) AND its
 *   public seat catalog must list the actor as free; only then is it claimed
 *   once (`r_claim_actor`, which the world itself refuses when the seat is
 *   held, not offered, or over the cap).
 *
 * A refusal is a {@link SeatClaimUnavailableError}; a failed world read is a
 * transient {@link SeatClaimProbeError} and never leads to a claim. The
 * caller's other seats are never used instead.
 */
export async function resolveClaimedSeatRoute(
	catalog: WorldCatalog,
	sub: string,
	token: string,
	claim: SeatClaim,
	ports: ClaimedSeatPorts,
): Promise<WorldRoute> {
	const world = worldsToProbeForSeat(catalog, sub).find((row) => row.slug === claim.slug);
	if (world === undefined) throw new SeatClaimUnavailableError(claim);
	let seat = await probe(() => ports.findClaimedSeat(world, token, claim.actorId));
	if (seat === null) {
		if (!canClaimSeat(world, sub)) throw new SeatClaimUnavailableError(claim);
		const offered = await probe(() => ports.isOfferedFreeSeat(world, token, claim.actorId));
		if (!offered) throw new SeatClaimUnavailableError(claim);
		try {
			await ports.claimSeat(world, token, claim.actorId);
		} catch {
			throw new SeatClaimUnavailableError(claim);
		}
		seat = await probe(() => ports.findClaimedSeat(world, token, claim.actorId));
		if (seat === null) throw new SeatClaimUnavailableError(claim);
	}
	const hit: WorldSeatHit = {
		world,
		actorId: seat.actorId,
		boundAtTick: seat.boundAtTick,
		role: seat.role ?? "primary",
		...(seat.currentTick === undefined ? {} : { currentTick: seat.currentTick }),
		...(seat.selfCapabilities === undefined ? {} : { selfCapabilities: seat.selfCapabilities }),
	};
	return { kind: "seat", hit, others: [] };
}

/** Read the world's public seat catalog: is `actorId` an offered, unclaimed seat? */
export async function isOfferedFreeSeatInWorld(
	url: string,
	db: string,
	token: string,
	actorId: string,
): Promise<boolean> {
	const { connect, readSeats, snapshotDb } = await import("@spellkave/sdk");
	const session = await connect(
		{
			url,
			db,
			token: token === "" ? null : token,
			connectedActorId: "",
			readerManifests: [{ requiredTables: ["seat"] }],
		},
		{ onError() {}, onDisconnect() {}, onUpdate() {} },
	);
	try {
		await session.ready;
		return readSeats(snapshotDb(session)).some(
			(seat) => String(seat.actor_id) === actorId && !seat.claimed && seat.embodied,
		);
	} finally {
		session.disconnect();
	}
}

/** Claim one free seat as the caller (`r_claim_actor`, role `primary`). */
export async function claimSeatAsCaller(
	url: string,
	db: string,
	token: string,
	actorId: string,
): Promise<void> {
	const { connect } = await import("@spellkave/sdk");
	const session = await connect(
		{ url, db, token: token === "" ? null : token, connectedActorId: "" },
		{ onError() {}, onDisconnect() {}, onUpdate() {} },
	);
	try {
		await session.ready;
		const reducers = session.conn.reducers as {
			rClaimActor(args: { actorId: bigint; role: string }): Promise<unknown>;
		};
		await reducers.rClaimActor({ actorId: BigInt(actorId), role: "primary" });
	} finally {
		session.disconnect();
	}
}
