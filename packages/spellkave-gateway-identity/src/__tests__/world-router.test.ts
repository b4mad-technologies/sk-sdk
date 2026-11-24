// A player's client asks the gateway "which world is my character in?". The
// router probes the worlds the player owns or belongs to, also ones still
// scheduling, skips an unreachable one, and picks the one authority world (a
// primary seat, else exactly one presence). Catalog parsing is real; each
// world's seat probe is an injected fake, so no node and no socket.
// (sk-jay0.1.1.13)

// keep-file(K2): the multi-world cases need injected per-world probes; the outside would need several live worlds

import {
	readActorIdentityBindings,
	readActorPrincipals,
	readWorldStatus,
} from "@spellkave/sdk/readers";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { parseWorldCatalog, type WorldCatalog } from "../world-catalog.ts";
import { type FindWorldSeat, probeWorldSeat, resolveWorldRoute } from "../world-router.ts";

function catalog(worlds: WorldCatalog["worlds"]): WorldCatalog {
	return parseWorldCatalog({ v: "player-world-catalog/v1", worlds });
}

const baseWorld = {
	display_name: "World",
	adventure: "elven-mini",
	visibility: "public",
	join_policy: "invite" as const,
};

describe("finding the world that holds a seat (sk-jay0.1.1.13)", () => {
	it("normalizes an omitted paused flag and retains explicit lifecycle intent", () => {
		expect(
			catalog([
				{
					...baseWorld,
					slug: "default",
					db: "default",
					status: "running",
					owner: "o",
					members: [],
				},
			]).worlds[0]?.paused,
		).toBe(false);
		expect(
			catalog([
				{
					...baseWorld,
					slug: "idle",
					db: "idle",
					status: "scheduling",
					owner: "o",
					members: [],
					paused: true,
				},
			]).worlds[0]?.paused,
		).toBe(true);
	});

	it("finds a seat in a non-running world the subject is a member of", async () => {
		const world = catalog([
			{
				...baseWorld,
				slug: "elven-mini-4",
				db: "spellkave-elven-mini-4",
				status: "scheduling",
				owner: "user_owner",
				members: ["user_sim1"],
			},
		]);
		const findSeat: FindWorldSeat = async () => ({ actorId: "9", boundAtTick: 4 });
		const route = await resolveWorldRoute(world, "user_sim1", "token", findSeat);
		expect(route).toMatchObject({
			kind: "seat",
			hit: { world: { slug: "elven-mini-4", status: "scheduling" }, actorId: "9" },
		});
	});

	it("does not probe a non-running world the subject holds no membership in", async () => {
		const world = catalog([
			{
				...baseWorld,
				slug: "elven-mini-4",
				db: "spellkave-elven-mini-4",
				status: "scheduling",
				owner: "user_owner",
				members: [],
			},
		]);
		const findSeat = vi.fn<FindWorldSeat>(async () => ({ actorId: "9", boundAtTick: 4 }));
		const route = await resolveWorldRoute(world, "user_stranger", "token", findSeat);
		expect(route).toEqual({ kind: "no_seat" });
		expect(findSeat).not.toHaveBeenCalled();
	});

	it("skips an unreachable running world (bounded probe) and still finds the seat in a scheduling membership world", async () => {
		// Running worlds are probed first (existing order); the unreachable one
		// must not stop the loop from reaching the membership world after it.
		const world = catalog([
			{
				...baseWorld,
				slug: "down-world",
				db: "spellkave-down",
				status: "running",
				owner: "user_other",
				members: [],
			},
			{
				...baseWorld,
				slug: "scheduling-world",
				db: "spellkave-scheduling",
				status: "scheduling",
				owner: "user_owner",
				members: ["user_sim1"],
			},
		]);
		const failure = new Error("connection refused");
		const findSeat: FindWorldSeat = async (w) => {
			if (w.slug === "down-world") throw failure;
			return w.slug === "scheduling-world" ? { actorId: "1", boundAtTick: 1 } : null;
		};
		const onProbeError = vi.fn();
		const route = await resolveWorldRoute(world, "user_sim1", "token", findSeat, onProbeError);
		expect(route).toMatchObject({ kind: "seat", hit: { world: { slug: "scheduling-world" } } });
		expect(onProbeError).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "down-world" }),
			failure,
		);
	});
});

const probe = vi.hoisted(() => ({ db: {} as Record<string, unknown>, disconnect: vi.fn() }));
vi.mock("@spellkave/sdk", () => ({
	connect: async () => ({ ready: Promise.resolve(), disconnect: probe.disconnect }),
	snapshotDb: () => probe.db,
	readActorIdentityBindings,
	readActorPrincipals,
	readWorldStatus,
}));

// Resolve the lazy transport module before a probe is timed. The ownership and
// capability projections stay real; this unit fixture must never open a socket.
beforeAll(async () => {
	await import("@spellkave/sdk");
});

function probeTables(presenceOnly = false) {
	const table = (rows: Record<string, unknown>[]) => ({ iter: () => rows });
	probe.db = {
		actor: table([
			{ actorId: 1n, currentBody: 10n, name: "Hero", createdAtTick: 1n },
			{ actorId: 2n, currentBody: 20n, name: "DM presence", createdAtTick: 2n },
			{ actorId: 3n, currentBody: 30n, name: "Other presence", createdAtTick: 2n },
		]),
		visible_actor_identity: table([
			{ key: "presence", actorId: 2n, identity: "alice", role: "presence", boundAtTick: 99n },
			...(presenceOnly
				? []
				: [{ key: "hero", actorId: 1n, identity: "alice", role: "primary", boundAtTick: 1n }]),
		]),
		visible_capability: table([
			{
				entityId: 10n,
				capabilityId: "hero/walk",
				source: "character",
				extentRef: "",
				extentKindRef: "",
				elevationClass: "",
			},
			{
				entityId: 20n,
				capabilityId: "frontier.read_internal",
				source: "role_binding:dm",
				extentRef: "region",
				extentKindRef: "place_graph",
				elevationClass: "internal",
			},
			{
				entityId: 30n,
				capabilityId: "other/secret",
				source: "role_binding:other",
				extentRef: "another",
				extentKindRef: "place_graph",
				elevationClass: "internal",
			},
		]),
		visible_entity_tag: table([]),
		visible_entity_tag_coverage: table([{ status: "complete", projectionVersion: 1 }]),
		world_time: table([{ tick: 100n }]),
	};
}

describe("presence and character routing", () => {
	it("routes the primary character while carrying authority from its placeless presence", async () => {
		probeTables();
		const result = await probeWorldSeat("url", "db", "token");
		expect(result).toMatchObject({
			actorId: "10",
			role: "primary",
			boundAtTick: 1,
			selfCapabilities: [
				{ capabilityId: "hero/walk" },
				{ capabilityId: "frontier.read_internal", extentRef: "region", elevationClass: "internal" },
			],
		});
		expect(result?.selfCapabilities?.some((row) => row.capabilityId === "other/secret")).toBe(
			false,
		);
		expect(probe.disconnect).toHaveBeenCalled();
	});
	it("routes a presence-only identity without requiring a spatial location", async () => {
		probeTables(true);
		expect(await probeWorldSeat("url", "db", "token")).toMatchObject({
			actorId: "20",
			role: "presence",
			selfCapabilities: [{ capabilityId: "frontier.read_internal", extentRef: "region" }],
		});
	});
});

describe("authority world selection", () => {
	const worlds = () =>
		catalog(
			["a", "b"].map((slug) => ({
				...baseWorld,
				slug,
				db: slug,
				status: "running" as const,
				owner: "o",
				members: [],
			})),
		);
	it("prefers a primary seat even after an earlier presence world", async () => {
		const route = await resolveWorldRoute(worlds(), "mine", "token", async (world) => ({
			actorId: world.slug,
			boundAtTick: 0,
			role: world.slug === "a" ? "presence" : "primary",
		}));
		expect(route).toMatchObject({ kind: "seat", hit: { actorId: "b", role: "primary" } });
	});
	it("routes exactly one presence world", async () => {
		const route = await resolveWorldRoute(worlds(), "mine", "token", async (world) =>
			world.slug === "b" ? { actorId: "presence", boundAtTick: 0, role: "presence" } : null,
		);
		expect(route).toMatchObject({ kind: "seat", hit: { actorId: "presence", role: "presence" } });
	});
	it("refuses multiple presence worlds with a typed operator remedy", async () => {
		await expect(
			resolveWorldRoute(worlds(), "mine", "token", async () => ({
				actorId: "presence",
				boundAtTick: 0,
				role: "presence",
			})),
		).rejects.toMatchObject({
			code: "ambiguous_authority_world",
			message: expect.stringContaining("operator"),
		});
	});
});
