import type { SnapshotDb } from "@spellkave/sdk";
import {
	readActorIdentityBindings,
	readActorPrincipals,
	readSelfCapabilities,
	readWorldStatus,
} from "@spellkave/sdk/readers";

import { type CatalogWorld, type WorldCatalog, worldsToProbeForSeat } from "./world-catalog.ts";

export const NO_SEAT_HINT =
	"No hero claimed on any Spellkave server. Choose a server and hero at https://spellkave.com";

export class AmbiguousAuthorityWorldError extends Error {
	readonly code = "ambiguous_authority_world";
	constructor() {
		super(
			"ambiguous_authority_world: more than one world contains your presence; ask the operator to resolve routing. World selection is not accepted in MCP/OAuth.",
		);
	}
}

export const NO_SEAT_TTL_MS = 30_000;

export interface WorldSeatHit {
	world: CatalogWorld;
	actorId: string;
	boundAtTick: number;
	role?: string;
	currentTick?: number;
	selfCapabilities?: WorldSelfCapability[];
}

export interface WorldSelfCapability {
	capabilityId: string;
	extentRef: string;
	extentKindRef: string;
	elevationClass: string;
	expiresAtTick?: number;
}

export type WorldRoute =
	| { kind: "seat"; hit: WorldSeatHit; others: WorldSeatHit[] }
	| { kind: "no_seat" };

export type FindWorldSeat = (
	world: CatalogWorld,
	token: string,
) => Promise<{
	actorId: string;
	boundAtTick: number;
	role?: string;
	currentTick?: number;
	selfCapabilities?: WorldSelfCapability[];
} | null>;

export interface ProbeWorldSeat {
	actorId: string;
	boundAtTick: number;
	role?: string;
	currentTick?: number;
	selfCapabilities?: WorldSelfCapability[];
}

/**
 * Read the caller's own durable/runtime claim in one world. With `actorId`
 * (ADR-0161 D-5 seat claim) only the caller's `primary` binding on that actor
 * counts; without it the newest primary seat wins.
 */
export async function probeWorldSeat(
	url: string,
	db: string,
	token: string,
	actorId?: string,
): Promise<ProbeWorldSeat | null> {
	const { connect, snapshotDb } = await import("@spellkave/sdk");
	const session = await connect(
		{
			url,
			db,
			token: token === "" ? null : token,
			// Probe-only: no PLAYER session yet. Provenance filter is unused.
			connectedActorId: "probe",
		},
		{ onError() {}, onDisconnect() {}, onUpdate() {} },
	);
	try {
		await session.ready;
		return readWorldSeat(snapshotDb(session), actorId);
	} finally {
		session.disconnect();
	}
}

/** Project a seat from the caller-scoped, continuously updated SDK subscription. */
export function readWorldSeat(
	snap: SnapshotDb,
	actorId?: string,
	options: { includeSelfCapabilities?: boolean } = {},
): ProbeWorldSeat | null {
	const bindings = readActorIdentityBindings(snap);
	if (bindings.length === 0) return null;
	const principals = readActorPrincipals(snap);
	const ranked = [...bindings]
		.filter((binding) =>
			principals.some(
				(principal) =>
					principal.actor_id === binding.actor_id &&
					principal.current_body !== "" &&
					principal.current_body !== "0",
			),
		)
		.sort(
			(left, right) =>
				right.bound_at_tick - left.bound_at_tick ||
				compareActorIds(String(left.actor_id), String(right.actor_id)),
		);
	const chosen =
		actorId === undefined
			? (ranked.find((row) => row.role === "primary") ?? ranked[0])
			: ranked.find((row) => row.role === "primary" && String(row.actor_id) === actorId);
	if (chosen === undefined) return null;
	const actor = principals.find((row) => row.actor_id === chosen.actor_id);
	if (actor === undefined || actor.current_body === "" || actor.current_body === "0") {
		return null;
	}
	const currentTick = readWorldStatus(snap)?.tick;
	const seat = {
		actorId: actor.current_body,
		boundAtTick: chosen.bound_at_tick,
		role: chosen.role ?? "primary",
		...(currentTick === undefined ? {} : { currentTick }),
	};
	// MCP routing needs only binding/body/role, not account navigation grants.
	if (options.includeSelfCapabilities === false) return seat;
	return {
		...seat,
		selfCapabilities: [
			...new Set(
				principals
					.filter((principal) =>
						bindings.some((binding) => binding.actor_id === principal.actor_id),
					)
					.map((principal) => principal.current_body)
					.filter((body) => body !== "" && body !== "0"),
			),
		]
			.flatMap((body) =>
				readSelfCapabilities(snap, body, {
					includeAuthoredGrantMetadata: true,
				}),
			)
			.map((capability) => ({
				capabilityId: capability.capability_id,
				extentRef: capability.extent_ref ?? "",
				extentKindRef: capability.extent_kind_ref ?? "",
				elevationClass: capability.elevation_class ?? "",
				...(capability.expires_at_tick === undefined
					? {}
					: { expiresAtTick: capability.expires_at_tick }),
			})),
	};
}

/** One seat the caller holds in a world (ADR-0161 D-5: there may be several). */
export interface HeldSeat {
	/** The actor id: what the seat board, claim and release routes name. */
	seatActorId: string;
	/** The actor's current body (the id a PLAYER session acts as); "0" when disembodied. */
	bodyId: string;
	boundAtTick: number;
}

/** Numeric actor ids compare as numbers; the tiebreak for equal bound ticks. */
export function compareActorIds(left: string, right: string): number {
	return left.length - right.length || (left < right ? -1 : left > right ? 1 : 0);
}

export function heldSeatsFromRows(
	bindings: readonly { actor_id: string | number; role?: string | null; bound_at_tick: number }[],
	principals: readonly { actor_id: string | number; current_body: string }[],
): HeldSeat[] {
	return bindings
		.filter((binding) => (binding.role ?? "primary") === "primary")
		.flatMap((binding) => {
			const actor = principals.find((row) => String(row.actor_id) === String(binding.actor_id));
			if (actor === undefined) return [];
			return [
				{
					seatActorId: String(binding.actor_id),
					bodyId: actor.current_body === "" ? "0" : actor.current_body,
					boundAtTick: binding.bound_at_tick,
				},
			];
		})
		.sort(
			(left, right) =>
				right.boundAtTick - left.boundAtTick ||
				compareActorIds(left.seatActorId, right.seatActorId),
		);
}

/** Every seat the caller holds in one world (one probe connection). */
export async function probeWorldHeldSeats(
	url: string,
	db: string,
	token: string,
): Promise<HeldSeat[]> {
	const { connect, readActorIdentityBindings, readActorPrincipals, snapshotDb } = await import(
		"@spellkave/sdk"
	);
	const session = await connect(
		{ url, db, token: token === "" ? null : token, connectedActorId: "probe" },
		{ onError() {}, onDisconnect() {}, onUpdate() {} },
	);
	try {
		await session.ready;
		const snap = snapshotDb(session);
		return heldSeatsFromRows(readActorIdentityBindings(snap), readActorPrincipals(snap));
	} finally {
		session.disconnect();
	}
}

/**
 * The first primary seat wins; otherwise one presence-only world is routed,
 * and multiple presence-only worlds refuse rather than pick an authority. Probe every running
 * catalog world, plus every world `sub` owns or is a member of regardless of
 * status (sk-jay0.1.1.13 — a claim writes membership before the world's
 * npc-host finishes scheduling, so the seat must stay reachable through that
 * window). See `worldsToProbeForSeat`.
 * World ticks are local to each database — they are not compared across worlds.
 * A dead world is skipped so one failed probe cannot fail the request.
 */
export async function resolveWorldRoute(
	catalog: WorldCatalog,
	sub: string,
	token: string,
	findSeat: FindWorldSeat,
	/** sk-jay0.6.38.5: observe a skipped probe (e.g. to emit a `world_lifecycle`
	 * `route_probe_failed` row). This package has no dependency on the
	 * observability emitter, so the caller owns the actual reporting. */
	onProbeError?: (world: CatalogWorld, error: unknown) => void,
): Promise<WorldRoute> {
	const presences: WorldSeatHit[] = [];
	for (const world of worldsToProbeForSeat(catalog, sub)) {
		let seat: {
			actorId: string;
			boundAtTick: number;
			role?: string;
			currentTick?: number;
			selfCapabilities?: WorldSelfCapability[];
		} | null;
		try {
			seat = await findSeat(world, token);
		} catch (error) {
			if (onProbeError !== undefined) {
				onProbeError(world, error);
			} else {
				// Fallback only: kept for any caller that does not supply
				// onProbeError. Every in-repo caller does (runtime.ts), so this
				// branch is not expected to run in production.
				const message = error instanceof Error ? error.message : String(error);
				console.warn(`world route: skip ${world.slug} (${world.db}): ${message}`);
			}
			continue;
		}
		if (seat !== null) {
			if (seat.role === "presence") {
				presences.push({ world, ...seat });
				continue;
			}
			return {
				kind: "seat",
				hit: {
					world,
					actorId: seat.actorId,
					boundAtTick: seat.boundAtTick,
					role: seat.role ?? "primary",
					...(seat.currentTick === undefined ? {} : { currentTick: seat.currentTick }),
					...(seat.selfCapabilities === undefined
						? {}
						: { selfCapabilities: seat.selfCapabilities }),
				},
				others: [],
			};
		}
	}
	if (presences.length > 1) throw new AmbiguousAuthorityWorldError();
	const presence = presences[0];
	if (presence) return { kind: "seat", hit: presence, others: [] };
	return { kind: "no_seat" };
}
