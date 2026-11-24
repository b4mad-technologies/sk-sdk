// A Claude/Codex connection carries the hero the person picked on the WorkOS
// consent screen (ADR-0161 D-5). The gateway plays exactly that hero: it reads
// the claim from the verified token, finds or claims the seat, and refuses
// rather than falling back to another hero. Seat probes and claims are
// injected fakes, so no node and no socket.

// keep-file(K2): routing decisions over injected per-world probe/claim fakes; the outside would need live worlds and a WorkOS token with a custom claim

import { describe, expect, it } from "vitest";
import {
	parseSeatClaim,
	resolveClaimedSeatRoute,
	SeatClaimProbeError,
	SeatClaimUnavailableError,
	seatSessionKey,
} from "../seat-claim.ts";
import { parseWorldCatalog, type WorldCatalog } from "../world-catalog.ts";

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const token = (payload: Record<string, unknown>) =>
	`${b64({ alg: "RS256" })}.${b64({ sub: "user_1", ...payload })}.sig`;

const catalog: WorldCatalog = parseWorldCatalog({
	v: "player-world-catalog/v1",
	worlds: [
		{
			slug: "elven-mini-1",
			display_name: "Elven Mini",
			adventure: "elven-mini",
			db: "db-elven",
			status: "running",
			visibility: "public",
			owner: "o",
			members: [],
			join_policy: "open",
		},
		{
			slug: "private",
			display_name: "Private",
			adventure: "elven-mini",
			db: "db-private",
			status: "running",
			visibility: "private",
			owner: "o",
			members: [],
			join_policy: "invite",
		},
	],
});

describe("parseSeatClaim", () => {
	it("reads <world>/<actor_id>, keeping a slug that contains a slash", () => {
		expect(parseSeatClaim(token({ "urn:spellkave:seat": "elven-mini-1/7" }))).toEqual({
			slug: "elven-mini-1",
			actorId: "7",
		});
		expect(parseSeatClaim(token({ "urn:spellkave:seat": "team/world/12" }))).toEqual({
			slug: "team/world",
			actorId: "12",
		});
	});

	it("is absent without the claim and invalid when malformed", () => {
		expect(parseSeatClaim(token({}))).toBeUndefined();
		expect(parseSeatClaim("not-a-jwt")).toBeUndefined();
		for (const value of ["elven-mini-1", "/7", "elven-mini-1/hero", 7, null])
			expect(parseSeatClaim(token({ "urn:spellkave:seat": value }))).toBe("invalid");
	});

	it("keys one session per subject and picked seat", () => {
		expect(seatSessionKey("user_1", undefined)).toBe("user_1");
		expect(seatSessionKey("user_1", { slug: "w", actorId: "7" })).toBe("user_1#w/7");
		expect(seatSessionKey("user_1", { slug: "w", actorId: "9" })).not.toBe(
			seatSessionKey("user_1", { slug: "w", actorId: "7" }),
		);
	});
});

describe("resolveClaimedSeatRoute", () => {
	const held = { actorId: "107", boundAtTick: 3, role: "primary" };
	const elven = { slug: "elven-mini-1", actorId: "9" };

	/** A world fake: `heldBy` = actors this caller holds, `free` = offered unclaimed seats. */
	function ports(options: {
		heldBy?: string[];
		free?: string[];
		claimFails?: boolean;
		probeFails?: boolean;
	}) {
		const holds = new Set(options.heldBy ?? []);
		const free = new Set(options.free ?? []);
		const calls: string[] = [];
		return {
			calls,
			ports: {
				findClaimedSeat: async (_world: unknown, _token: string, actorId: string) => {
					calls.push(`find:${actorId}`);
					if (options.probeFails) throw new Error("ECONNRESET");
					return holds.has(actorId) ? { ...held, actorId: `10${actorId}` } : null;
				},
				isOfferedFreeSeat: async (_world: unknown, _token: string, actorId: string) => {
					calls.push(`offered:${actorId}`);
					return free.has(actorId);
				},
				claimSeat: async (_world: unknown, _token: string, actorId: string) => {
					calls.push(`claim:${actorId}`);
					if (options.claimFails) throw new Error("actor already has 1 identity binding(s)");
					holds.add(actorId);
					free.delete(actorId);
				},
			},
		};
	}

	it("routes a seat the person already holds without claiming", async () => {
		const world = ports({ heldBy: ["7"] });
		const route = await resolveClaimedSeatRoute(
			catalog,
			"user_1",
			"tok",
			{ slug: "elven-mini-1", actorId: "7" },
			world.ports,
		);
		expect(route).toMatchObject({
			kind: "seat",
			hit: { world: { slug: "elven-mini-1" }, actorId: "107" },
		});
		expect(world.calls).toEqual(["find:7"]);
	});

	it("claims an offered free seat once on first use, then routes it", async () => {
		const world = ports({ free: ["9"] });
		const route = await resolveClaimedSeatRoute(catalog, "user_1", "tok", elven, world.ports);
		expect(world.calls).toEqual(["find:9", "offered:9", "claim:9", "find:9"]);
		expect(route).toMatchObject({ kind: "seat", hit: { actorId: "109" } });
	});

	it("never claims a seat the picker would not offer (taken, NPC, unknown id)", async () => {
		const world = ports({ free: ["9"] });
		await expect(
			resolveClaimedSeatRoute(
				catalog,
				"user_1",
				"tok",
				{ slug: "elven-mini-1", actorId: "42" },
				world.ports,
			),
		).rejects.toBeInstanceOf(SeatClaimUnavailableError);
		expect(world.calls).toEqual(["find:42", "offered:42"]);
	});

	it("refuses, never falling back to another hero, when the world refuses the claim", async () => {
		const world = ports({ heldBy: ["7"], free: ["9"], claimFails: true });
		await expect(
			resolveClaimedSeatRoute(catalog, "user_1", "tok", elven, world.ports),
		).rejects.toBeInstanceOf(SeatClaimUnavailableError);
	});

	it("treats a failed world read as transient and never claims", async () => {
		const world = ports({ free: ["9"], probeFails: true });
		await expect(
			resolveClaimedSeatRoute(catalog, "user_1", "tok", elven, world.ports),
		).rejects.toBeInstanceOf(SeatClaimProbeError);
		expect(world.calls).toEqual(["find:9"]);
	});

	it("refuses a world the person may not reach or claim in, without touching it", async () => {
		for (const slug of ["nowhere", "private"]) {
			const world = ports({ free: ["7"] });
			await expect(
				resolveClaimedSeatRoute(catalog, "user_1", "tok", { slug, actorId: "7" }, world.ports),
			).rejects.toBeInstanceOf(SeatClaimUnavailableError);
			expect(world.calls).toEqual(slug === "private" ? ["find:7"] : []);
		}
	});
});
