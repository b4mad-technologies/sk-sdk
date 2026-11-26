// A player's tool call is routed to the world where they hold a seat, a player without
// a hero is pointed to the website, and a changed route detaches the old session. If it
// breaks, calls land in the wrong world or fail unclearly. Runs against injected seat
// probes, attach and clock, no live world.

// keep-file(K2): injected seat probes, attach and clock

import {
	type FindWorldSeat,
	NO_SEAT_HINT,
	parseWorldCatalog,
	resolveWorldRoute,
} from "@spellkave/gateway-identity";
import { SessionDaemonTransportError } from "@spellkave/session/node";
import { describe, expect, it, vi } from "vitest";
import { withRemoteMcpAccessToken, withRemoteMcpRequestSubject } from "../observability.ts";
import {
	JwtBoundPlayerSessionClient,
	SESSION_DETACH_REASON_ROUTE_CHANGED,
	WORLD_RESET_NOTICE,
} from "../runtime.ts";

const catalog = parseWorldCatalog({
	v: "player-world-catalog/v1",
	worlds: [
		{
			slug: "world-a",
			display_name: "A",
			adventure: "kavemouth",
			db: "spellkave-a",
			status: "running",
			visibility: "public",
			owner: "user_owner_a",
			members: [],
			join_policy: "invite",
		},
		{
			slug: "world-b",
			display_name: "B",
			adventure: "kavemouth",
			db: "spellkave-b",
			status: "running",
			visibility: "public",
			owner: "user_owner_b",
			members: [],
			join_policy: "invite",
		},
		{
			slug: "stopped",
			display_name: "Stopped",
			adventure: "kavemouth",
			db: "spellkave-stopped",
			status: "stopped",
			visibility: "public",
			owner: "user_owner_stopped",
			members: [],
			join_policy: "invite",
		},
	],
});

describe("resolveWorldRoute", () => {
	it("routes a subject to the world that holds their claim", async () => {
		const findSeat: FindWorldSeat = async (world) =>
			world.slug === "world-b" ? { actorId: "9", boundAtTick: 4 } : null;
		const route = await resolveWorldRoute(catalog, "user_probe", "token-b", findSeat);
		expect(route).toMatchObject({
			kind: "seat",
			hit: { actorId: "9", world: { db: "spellkave-b", slug: "world-b" } },
		});
	});

	it("returns no_seat when no running world has a claim", async () => {
		const findSeat: FindWorldSeat = async () => null;
		await expect(resolveWorldRoute(catalog, "user_probe", "token-none", findSeat)).resolves.toEqual(
			{
				kind: "no_seat",
			},
		);
	});

	it("skips a stopped catalog world the subject does not own or belong to", async () => {
		const findSeat = vi.fn<FindWorldSeat>(async (world) =>
			world.slug === "stopped" ? { actorId: "1", boundAtTick: 99 } : null,
		);
		await expect(resolveWorldRoute(catalog, "user_probe", "token", findSeat)).resolves.toEqual({
			kind: "no_seat",
		});
		expect(findSeat.mock.calls.map(([world]) => world.slug)).toEqual(["world-a", "world-b"]);
	});

	it("still probes a non-running world the subject owns or is a member of (sk-jay0.1.1.13)", async () => {
		const findSeat = vi.fn<FindWorldSeat>(async (world) =>
			world.slug === "stopped" ? { actorId: "1", boundAtTick: 99 } : null,
		);
		const route = await resolveWorldRoute(catalog, "user_owner_stopped", "token", findSeat);
		expect(route).toMatchObject({ kind: "seat", hit: { world: { slug: "stopped" } } });
		expect(findSeat.mock.calls.map(([world]) => world.slug)).toEqual([
			"world-a",
			"world-b",
			"stopped",
		]);
	});

	it("skips an unreachable running world and still finds the seat in a non-running membership world", async () => {
		// Running worlds are probed first; the unreachable one must not stop the
		// loop from reaching the membership world after it.
		const failure = new Error("connection refused");
		const findSeat: FindWorldSeat = async (world) => {
			if (world.slug === "world-a") throw failure;
			return world.slug === "stopped" ? { actorId: "1", boundAtTick: 2 } : null;
		};
		const onProbeError = vi.fn();
		const route = await resolveWorldRoute(
			catalog,
			"user_owner_stopped",
			"token",
			findSeat,
			onProbeError,
		);
		expect(route).toMatchObject({ kind: "seat", hit: { world: { slug: "stopped" } } });
		expect(onProbeError).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "world-a" }),
			failure,
		);
	});

	it("picks the first catalog world with a claim (ticks are world-local)", async () => {
		const findSeat: FindWorldSeat = async (world) =>
			world.slug === "world-a"
				? { actorId: "1", boundAtTick: 2 }
				: { actorId: "2", boundAtTick: 8 };
		const route = await resolveWorldRoute(catalog, "user_probe", "token", findSeat);
		expect(route.kind).toBe("seat");
		if (route.kind === "seat") expect(route.hit.world.slug).toBe("world-a");
	});

	it("skips a dead world and keeps probing", async () => {
		const findSeat: FindWorldSeat = async (world) => {
			if (world.slug === "world-a") throw new Error("connection refused");
			return { actorId: "9", boundAtTick: 1 };
		};
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const route = await resolveWorldRoute(catalog, "user_probe", "token", findSeat);
		warn.mockRestore();
		expect(route).toMatchObject({
			kind: "seat",
			hit: { world: { slug: "world-b" } },
		});
	});

	it("reports a skipped probe to onProbeError instead of console.warn, and still resolves", async () => {
		const failure = new Error("connection refused");
		const findSeat: FindWorldSeat = async (world) => {
			if (world.slug === "world-a") throw failure;
			return { actorId: "9", boundAtTick: 1 };
		};
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const onProbeError = vi.fn();
		const route = await resolveWorldRoute(catalog, "user_probe", "token", findSeat, onProbeError);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
		expect(onProbeError).toHaveBeenCalledTimes(1);
		expect(onProbeError).toHaveBeenCalledWith(
			expect.objectContaining({ slug: "world-a" }),
			failure,
		);
		expect(route).toMatchObject({
			kind: "seat",
			hit: { world: { slug: "world-b" } },
		});
	});

	it("still finds the same world after a fresh resolver (restart)", async () => {
		const findSeat: FindWorldSeat = async (world) =>
			world.slug === "world-b" ? { actorId: "9", boundAtTick: 4 } : null;
		const first = await resolveWorldRoute(catalog, "user_probe", "token-b", findSeat);
		const second = await resolveWorldRoute(catalog, "user_probe", "token-b", findSeat);
		expect(first).toEqual(second);
		expect(first).toMatchObject({ kind: "seat", hit: { world: { slug: "world-b" } } });
	});
});

describe("JwtBoundPlayerSessionClient", () => {
	it("passes the catalog world slug when attaching a PLAYER daemon", async () => {
		const invoke = vi.fn(async () => ({
			id: 1,
			ok: true as const,
			result: { content: [{ type: "text" as const, text: "ok" }] },
		}));
		const attach = vi.fn(async () => ({ invoke }));
		const client = new JwtBoundPlayerSessionClient(
			"http://127.0.0.1:3000",
			catalog,
			async (world) => (world.slug === "world-a" ? { actorId: "1", boundAtTick: 2 } : null),
			{ attach },
		);

		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-a", () => client.invoke("see", {})),
		);
		expect(attach).toHaveBeenCalledWith(
			expect.objectContaining({ db: "spellkave-a", actorId: "1" }),
			"jwt-a",
			"world-a",
		);
	});

	it("emits a world_lifecycle route_probe_failed row for a skipped probe, not console.warn (sk-jay0.6.38.5)", async () => {
		const invoke = vi.fn(async () => ({
			id: 1,
			ok: true as const,
			result: { content: [{ type: "text" as const, text: "ok" }] },
		}));
		const attach = vi.fn(async () => ({ invoke }));
		const failure = new Error("connection refused");
		const client = new JwtBoundPlayerSessionClient(
			"http://127.0.0.1:3000",
			catalog,
			async (world) => {
				if (world.slug === "world-a") throw failure;
				return world.slug === "world-b" ? { actorId: "9", boundAtTick: 4 } : null;
			},
			{ attach },
		);
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-a", () => client.invoke("see", {})),
		);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();

		expect(rows).toContainEqual([
			"world_lifecycle",
			{
				phase: "route_probe_failed",
				outcome: "failed",
				world_slug: "world-a",
				error_class: "Error",
			},
		]);
		// Routing still lands on world-b: one failed probe does not fail the request.
		expect(attach).toHaveBeenCalledWith(
			expect.objectContaining({ db: "spellkave-b", actorId: "9" }),
			"jwt-a",
			"world-b",
		);
	});

	it("caches a no-seat result for the TTL and re-probes after", async () => {
		let clock = 1_000;
		const findSeat = vi.fn<FindWorldSeat>(async () => null);
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			now: () => clock,
			noSeatTtlMs: 30_000,
		});
		const invoke = () =>
			withRemoteMcpRequestSubject("sub-none", () =>
				withRemoteMcpAccessToken("jwt-none", () => client.invoke("see", {})),
			);
		await invoke();
		clock += 10_000;
		await invoke();
		expect(findSeat).toHaveBeenCalledTimes(2);
		clock += 30_000;
		await invoke();
		expect(findSeat).toHaveBeenCalledTimes(4);
	});
});

describe("JwtBoundPlayerSessionClient — route cache is per token (sk-jay0.6.37.14)", () => {
	const okResult = {
		id: 1,
		ok: true as const,
		result: { content: [{ type: "text" as const, text: "ok" }] },
	};

	it("attaches the new world on a new token after the seat moved", async () => {
		const seats = new Map<string, { actorId: string } | null>([
			["world-a", { actorId: "1" }],
			["world-b", null],
		]);
		const findSeat: FindWorldSeat = async (world) => {
			const hit = seats.get(world.slug);
			return hit === undefined || hit === null ? null : { actorId: hit.actorId, boundAtTick: 1 };
		};
		const invoke = vi.fn(async () => okResult);
		const attach = vi.fn(async () => ({
			invoke,
			attachment: { socketPath: "/private/socket", spawned: false },
		}));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));

		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-a", () => client.invoke("see", {})),
		);
		expect(attach).toHaveBeenCalledWith(
			expect.objectContaining({ db: "spellkave-a", actorId: "1" }),
			"jwt-a",
			"world-a",
		);

		seats.set("world-a", null);
		seats.set("world-b", { actorId: "1" });
		rows.length = 0;
		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-b", () => client.invoke("see", {})),
		);
		expect(attach).toHaveBeenCalledWith(
			expect.objectContaining({ db: "spellkave-b", actorId: "1" }),
			"jwt-b",
			"world-b",
		);
		expect(rows).toEqual([
			["session_detach", { reason: SESSION_DETACH_REASON_ROUTE_CHANGED, world_slug: "world-a" }],
			["session_attach", { spawned: false, world_slug: "world-b" }],
		]);
		expect(client.routedWorld("sub-a")).toEqual({ slug: "world-b", actorId: "1" });
	});

	it("returns no_seat on a new token when the seat was released everywhere", async () => {
		const seats = new Map<string, { actorId: string } | null>([
			["world-a", { actorId: "1" }],
			["world-b", null],
		]);
		const findSeat: FindWorldSeat = async (world) => {
			const hit = seats.get(world.slug);
			return hit === undefined || hit === null ? null : { actorId: hit.actorId, boundAtTick: 1 };
		};
		const invoke = vi.fn(async () => okResult);
		const attach = vi.fn(async () => ({ invoke }));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));

		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-a", () => client.invoke("see", {})),
		);
		expect(attach).toHaveBeenCalledOnce();

		seats.set("world-a", null);
		rows.length = 0;
		const result = await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-b", () => client.invoke("see", {})),
		);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.result.content).toEqual([{ type: "text", text: NO_SEAT_HINT }]);
		expect(attach).toHaveBeenCalledOnce();
		expect(client.routedWorld("sub-a")).toBeUndefined();
		expect(rows).toEqual([
			["session_detach", { reason: SESSION_DETACH_REASON_ROUTE_CHANGED, world_slug: "world-a" }],
		]);
	});

	it("revalidates the primary seat without detaching on the same token", async () => {
		const findSeat = vi.fn<FindWorldSeat>(async (world) =>
			world.slug === "world-a" ? { actorId: "1", boundAtTick: 2 } : null,
		);
		const invoke = vi.fn(async () => okResult);
		const attach = vi.fn(async () => ({
			invoke,
			attachment: { socketPath: "/private/socket", spawned: true },
		}));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));
		const asSubject = <T>(run: () => Promise<T>) =>
			withRemoteMcpRequestSubject("sub-a", () => withRemoteMcpAccessToken("jwt-a", run));

		await asSubject(() => client.invoke("see", {}));
		const probesAfterFirst = findSeat.mock.calls.length;
		await asSubject(() => client.invoke("see", {}));
		expect(findSeat).toHaveBeenCalledTimes(probesAfterFirst + 1);
		expect(attach).toHaveBeenCalledOnce();
		expect(rows).toEqual([["session_attach", { spawned: true, world_slug: "world-a" }]]);
	});

	it("keeps the session on a same-subject token refresh: no detach, no rebuild, one cached-world probe (sk-jay0.5.14.15)", async () => {
		const findSeat = vi.fn<FindWorldSeat>(async (world) =>
			world.slug === "world-b" ? { actorId: "1", boundAtTick: 2 } : null,
		);
		const invoke = vi.fn(async () => okResult);
		const attach = vi.fn(async () => ({
			invoke,
			attachment: { socketPath: "/private/socket", spawned: false },
		}));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));

		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-a", () => client.invoke("see", {})),
		);
		expect(attach).toHaveBeenCalledWith(
			expect.objectContaining({ db: "spellkave-b", actorId: "1" }),
			"jwt-a",
			"world-b",
		);
		rows.length = 0;
		findSeat.mockClear();
		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-b", () => client.invoke("see", {})),
		);
		expect(attach).toHaveBeenCalledOnce();
		// Only the cached world is re-verified — not the full catalog sweep.
		expect(findSeat.mock.calls.map(([world, token]) => [world.slug, token])).toEqual([
			["world-b", "jwt-b"],
		]);
		expect(rows).toEqual([["session_token_refreshed", { world_slug: "world-b" }]]);
		expect(invoke).toHaveBeenCalledTimes(2);
		expect(client.routedWorld("sub-a")).toEqual({ slug: "world-b", actorId: "1" });

		// Revalidate the cached primary on every request, including an unchanged bearer.
		findSeat.mockClear();
		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-b", () => client.invoke("see", {})),
		);
		expect(findSeat.mock.calls.map(([world, token]) => [world.slug, token])).toEqual([
			["world-b", "jwt-b"],
		]);
	});

	it("attaches a separate session for a different subject", async () => {
		const findSeat = vi.fn<FindWorldSeat>(async (world) =>
			world.slug === "world-a" ? { actorId: "1", boundAtTick: 2 } : null,
		);
		const attach = vi.fn(async () => ({
			invoke: vi.fn(async () => okResult),
			attachment: { socketPath: "/private/socket", spawned: true },
		}));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));

		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-a", () => client.invoke("see", {})),
		);
		await withRemoteMcpRequestSubject("sub-b", () =>
			withRemoteMcpAccessToken("jwt-b", () => client.invoke("see", {})),
		);
		expect(attach).toHaveBeenCalledTimes(2);
		expect(attach).toHaveBeenLastCalledWith(
			expect.objectContaining({ identity: "sub-b", db: "spellkave-a" }),
			"jwt-b",
			"world-a",
		);
		expect(rows.map(([type]) => type)).toEqual(["session_attach", "session_attach"]);
		expect(rows.some(([type]) => type === "session_token_refreshed")).toBe(false);
	});

	it("falls back to the full resolve when the cached-world probe fails on a refresh", async () => {
		let failWorldA = false;
		const findSeat = vi.fn<FindWorldSeat>(async (world) => {
			if (world.slug === "world-a" && failWorldA) throw new Error("connection refused");
			return world.slug === "world-a" ? { actorId: "1", boundAtTick: 2 } : null;
		});
		const attach = vi.fn(async () => ({ invoke: vi.fn(async () => okResult) }));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));
		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-a", () => client.invoke("see", {})),
		);
		rows.length = 0;
		failWorldA = true;
		const result = await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-b", () => client.invoke("see", {})),
		);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.result.content).toEqual([{ type: "text", text: NO_SEAT_HINT }]);
		expect(rows.map(([type, data]) => [type, data.reason ?? data.phase])).toEqual([
			["world_lifecycle", "route_probe_failed"],
			["session_detach", SESSION_DETACH_REASON_ROUTE_CHANGED],
		]);
	});

	it("reconnects a dropped session with the latest refreshed bearer, not the first one", async () => {
		const findSeat: FindWorldSeat = async (world) =>
			world.slug === "world-a" ? { actorId: "1", boundAtTick: 2 } : null;
		const lost = new SessionDaemonTransportError("/private/socket", "closed", { code: "EPIPE" });
		const invoke = vi
			.fn()
			.mockResolvedValueOnce(okResult)
			.mockRejectedValueOnce(lost)
			.mockResolvedValue(okResult);
		const attach = vi.fn(async () => ({ invoke }));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		await withRemoteMcpRequestSubject("sub-a", () =>
			withRemoteMcpAccessToken("jwt-a", () => client.invoke("see", {})),
		);
		expect(attach).toHaveBeenLastCalledWith(expect.anything(), "jwt-a", "world-a");
		// Refresh, then the daemon socket dies under that very call: the
		// reattaching wrapper reconnects with the refreshed bearer.
		await expect(
			withRemoteMcpRequestSubject("sub-a", () =>
				withRemoteMcpAccessToken("jwt-b", () => client.invoke("see", {})),
			),
		).rejects.toBe(lost);
		expect(attach).toHaveBeenCalledTimes(2);
		expect(attach).toHaveBeenLastCalledWith(expect.anything(), "jwt-b", "world-a");
	});
});

describe("JwtBoundPlayerSessionClient — lifecycle rows (sk-0m4.120.12)", () => {
	it("emits session_attach on first attach and session_detach with the drop reason", async () => {
		const findSeat: FindWorldSeat = async (world) =>
			world.slug === "world-a" ? { actorId: "1", boundAtTick: 2 } : null;
		const lost = new SessionDaemonTransportError("/private/socket", "closed", { code: "EPIPE" });
		const invoke = vi
			.fn()
			.mockResolvedValueOnce({ id: 1, ok: true, result: { content: [] } })
			.mockRejectedValueOnce(lost);
		const attach = vi.fn(async () => ({
			invoke,
			attachment: { socketPath: "/private/socket", spawned: true },
		}));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));
		const asSubject = <T>(run: () => Promise<T>) =>
			withRemoteMcpRequestSubject("sub-a", () => withRemoteMcpAccessToken("jwt-a", run));
		await asSubject(() => client.invoke("see", {}));
		await expect(asSubject(() => client.invoke("see", {}))).rejects.toBe(lost);
		expect(rows).toEqual([
			["session_attach", { spawned: true, world_slug: "world-a" }],
			// The reattaching wrapper reports the loss …
			["subscription_lost", { cause: "EPIPE", world_slug: "world-a" }],
			["session_resubscribed", { spawned: true, world_slug: "world-a" }],
			// … and the router still drops the subject's client (sk-uglp arm).
			["session_detach", { reason: "EPIPE", world_slug: "world-a" }],
		]);
	});
});

describe("JwtBoundPlayerSessionClient — world reset notice (sk-uglp)", () => {
	const findSeat: FindWorldSeat = async (world) =>
		world.slug === "world-a" ? { actorId: "1", boundAtTick: 2 } : null;
	const okResult = (text: string) => ({
		id: 1,
		ok: true as const,
		result: { content: [{ type: "text" as const, text }] },
	});
	const asSubject = <T>(run: () => Promise<T>) =>
		withRemoteMcpRequestSubject("sub-a", () => withRemoteMcpAccessToken("jwt-a", run));

	it("tells the caller once, on the first successful call after its session died", async () => {
		const lost = new SessionDaemonTransportError("/private/socket", "closed");
		const invoke = vi
			.fn()
			.mockResolvedValueOnce(okResult("before"))
			.mockRejectedValueOnce(lost)
			.mockResolvedValue(okResult("after"));
		const attach = vi.fn(async () => ({ invoke }));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});

		await expect(asSubject(() => client.invoke("see", {}))).resolves.not.toHaveProperty("notices");
		// The daemon behind this subject dies (world wiped/redeployed).
		await expect(asSubject(() => client.invoke("see", {}))).rejects.toBe(lost);
		// A fresh client is attached; its first result carries the notice...
		const fresh = await asSubject(() => client.invoke("see", {}));
		expect(fresh).toMatchObject({ ok: true, notices: [WORLD_RESET_NOTICE] });
		// Two re-attaches, not one: the Reattaching wrapper reconnects eagerly
		// on transport loss, then the JWT layer drops the whole subject and
		// attaches afresh on the next call (pre-existing shape, not sk-uglp's).
		expect(attach).toHaveBeenCalledTimes(3);
		// ...and only that one.
		await expect(asSubject(() => client.invoke("see", {}))).resolves.not.toHaveProperty("notices");
	});

	it("does not announce a reset when the very first attach fails", async () => {
		const attach = vi
			.fn()
			.mockRejectedValueOnce(new SessionDaemonTransportError("/private/socket", "refused"))
			.mockResolvedValue({ invoke: async () => okResult("first") });
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		await expect(asSubject(() => client.invoke("see", {}))).rejects.toBeInstanceOf(
			SessionDaemonTransportError,
		);
		await expect(asSubject(() => client.invoke("see", {}))).resolves.not.toHaveProperty("notices");
	});

	// sk-0m4.94 + sk-0m4.100: a communicate whose reply window outruns the invoke
	// bound must return the NORMAL awaiting_response receipt (never a throw that
	// prompts retry/double-speak) and must NOT sticky-arm world_reset.
	it("returns awaiting_response receipt on communicate invoke timeout (sk-0m4.100)", async () => {
		const timedOut = Object.assign(new Error("session invoke timed out after 12000ms"), {
			code: "ETIMEDOUT",
			name: "SessionInvokeTimeoutError",
		});
		const invoke = vi
			.fn()
			.mockResolvedValueOnce(okResult("before"))
			.mockRejectedValueOnce(timedOut)
			.mockResolvedValue(okResult("after-timeout"));
		const attach = vi.fn(async () => ({ invoke }));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});

		await expect(asSubject(() => client.invoke("see", {}))).resolves.not.toHaveProperty("notices");
		const slow = await asSubject(() =>
			client.invoke("spellkave_communicate", {
				target_id: "entity:2",
				speech_act_id: "test/speak-to",
				utterance: "Ranger",
			}),
		);
		expect(slow).toMatchObject({
			ok: true,
			result: {
				details: {
					receipt: {
						status: "dispatched",
						verb_class: "communicate",
						outcome: "unobserved",
					},
					conversation: {
						spoken_by_player: "Ranger",
						response: null,
						awaiting_response: true,
					},
				},
			},
		});
		expect(slow).not.toHaveProperty("notices");
		// The SAME attachment serves the next call (sk-0m4.121: a busy daemon
		// is not re-attached) and no sticky world_reset notice (sk-0m4.94).
		const after = await asSubject(() => client.invoke("spellkave_communicate", {}));
		expect(after).toMatchObject({ ok: true, result: { content: [{ text: "after-timeout" }] } });
		expect(after).not.toHaveProperty("notices");
		expect(attach).toHaveBeenCalledOnce();
	});

	it("an invoke timeout emits no lifecycle row and keeps the subject's client (sk-0m4.121)", async () => {
		const timedOut = Object.assign(new Error("session invoke timed out after 12000ms"), {
			code: "ETIMEDOUT",
			name: "SessionInvokeTimeoutError",
		});
		const invoke = vi
			.fn()
			.mockResolvedValueOnce(okResult("before"))
			.mockRejectedValueOnce(timedOut)
			.mockResolvedValue(okResult("after"));
		const attach = vi.fn(async () => ({
			invoke,
			attachment: { socketPath: "/private/socket", spawned: true },
		}));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		const rows: Array<[string, Record<string, unknown>]> = [];
		client.bindLifecycle((type, data) => rows.push([type, data ?? {}]));
		await asSubject(() => client.invoke("see", {}));
		await expect(asSubject(() => client.invoke("spellkave_scene", {}))).rejects.toBe(timedOut);
		await expect(asSubject(() => client.invoke("see", {}))).resolves.toMatchObject({
			ok: true,
			result: { content: [{ text: "after" }] },
		});
		expect(attach).toHaveBeenCalledOnce();
		// Only the attach row: no subscription_lost / session_detach /
		// session_resubscribed for a busy daemon.
		expect(rows).toEqual([["session_attach", { spawned: true, world_slug: "world-a" }]]);
	});

	it("still surfaces a timeout error for non-act tools", async () => {
		const timedOut = Object.assign(new Error("session invoke timed out after 12000ms"), {
			code: "ETIMEDOUT",
			name: "SessionInvokeTimeoutError",
		});
		const invoke = vi.fn().mockRejectedValueOnce(timedOut);
		const attach = vi.fn(async () => ({ invoke }));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});
		await expect(asSubject(() => client.invoke("spellkave_scene", {}))).rejects.toBe(timedOut);
	});

	it("still sticky-arms world_reset exactly once after a real transport loss", async () => {
		const lost = new SessionDaemonTransportError("/private/socket", "closed");
		const invoke = vi
			.fn()
			.mockResolvedValueOnce(okResult("before"))
			.mockRejectedValueOnce(lost)
			.mockResolvedValue(okResult("after"));
		const attach = vi.fn(async () => ({ invoke }));
		const client = new JwtBoundPlayerSessionClient("http://127.0.0.1:3000", catalog, findSeat, {
			attach,
		});

		await asSubject(() => client.invoke("see", {}));
		await expect(asSubject(() => client.invoke("see", {}))).rejects.toBe(lost);
		const fresh = await asSubject(() => client.invoke("see", {}));
		expect(fresh).toMatchObject({ ok: true, notices: [WORLD_RESET_NOTICE] });
		await expect(asSubject(() => client.invoke("see", {}))).resolves.not.toHaveProperty("notices");
	});
});

describe("JwtBoundPlayerSessionClient — the hero picked on the consent screen (ADR-0161 D-5)", () => {
	const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
	const pinned = (seat: string) =>
		`${b64({ alg: "RS256" })}.${b64({ sub: "sub-a", "urn:spellkave:seat": seat })}.sig`;
	const ok = {
		id: 1,
		ok: true as const,
		result: { content: [{ type: "text" as const, text: "ok" }] },
	};

	it("plays each connection's own hero: two heroes of one person, two sessions", async () => {
		const attach = vi.fn(async () => ({ invoke: vi.fn(async () => ok) }));
		const client = new JwtBoundPlayerSessionClient(
			"http://127.0.0.1:3000",
			catalog,
			async () => ({ actorId: "999", boundAtTick: 1 }),
			{
				attach,
				// actor 7 → body 107, actor 9 → body 109; both already held.
				findClaimedSeat: async (_world, _token, actorId) => ({
					actorId: `10${actorId}`,
					boundAtTick: 1,
				}),
				claimSeat: async () => {
					throw new Error("no claim expected");
				},
				isOfferedFreeSeat: async () => false,
			},
		);
		const first = pinned("world-a/7");
		const second = pinned("world-a/9");
		for (const token of [first, second, first])
			await withRemoteMcpRequestSubject("sub-a", () =>
				withRemoteMcpAccessToken(token, () => client.invoke("see", {})),
			);
		expect(attach).toHaveBeenCalledTimes(2);
		expect(attach).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ actorId: "107" }),
			first,
			"world-a",
		);
		expect(attach).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ actorId: "109" }),
			second,
			"world-a",
		);
	});

	it("refuses an unavailable pick instead of playing another hero, and caches the refusal briefly", async () => {
		const attach = vi.fn(async () => ({ invoke: vi.fn(async () => ok) }));
		let probes = 0;
		let now = 1_000;
		const client = new JwtBoundPlayerSessionClient(
			"http://127.0.0.1:3000",
			catalog,
			async () => ({ actorId: "999", boundAtTick: 1 }),
			{
				attach,
				now: () => now,
				noSeatTtlMs: 30_000,
				findClaimedSeat: async () => {
					probes += 1;
					return null;
				},
				// Seat 9 is held by someone else: the catalog does not offer it.
				isOfferedFreeSeat: async () => false,
				claimSeat: async () => {
					throw new Error("no claim expected");
				},
			},
		);
		const token = pinned("world-a/9");
		const call = () =>
			withRemoteMcpRequestSubject("sub-a", () =>
				withRemoteMcpAccessToken(token, () => client.invoke("see", {})),
			);
		await expect(call()).rejects.toThrow("spellkave.com");
		await expect(call()).rejects.toThrow("seat_unavailable");
		expect(probes).toBe(1);
		now += 31_000;
		await expect(call()).rejects.toThrow("seat_unavailable");
		expect(probes).toBe(2);
		await expect(
			withRemoteMcpRequestSubject("sub-a", () =>
				withRemoteMcpAccessToken(pinned("world-a"), () => client.invoke("see", {})),
			),
		).rejects.toThrow("seat_unavailable");
		expect(attach).not.toHaveBeenCalled();
	});

	it("treats a failed world read as transient: no claim, no cached refusal", async () => {
		let probes = 0;
		const claims: string[] = [];
		const client = new JwtBoundPlayerSessionClient(
			"http://127.0.0.1:3000",
			catalog,
			async () => ({ actorId: "999", boundAtTick: 1 }),
			{
				attach: vi.fn(async () => ({ invoke: vi.fn(async () => ok) })),
				findClaimedSeat: async () => {
					probes += 1;
					throw new Error("ECONNRESET");
				},
				isOfferedFreeSeat: async () => true,
				claimSeat: async (_world, _token, actorId) => {
					claims.push(actorId);
				},
			},
		);
		const call = () =>
			withRemoteMcpRequestSubject("sub-a", () =>
				withRemoteMcpAccessToken(pinned("world-a/9"), () => client.invoke("see", {})),
			);
		await expect(call()).rejects.toThrow("seat_probe_failed");
		await expect(call()).rejects.toThrow("seat_probe_failed");
		expect(probes).toBe(2);
		expect(claims).toEqual([]);
	});
});
