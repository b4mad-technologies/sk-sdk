// keep-file(K2): connection counts, caller-scoped row delivery and transport faults require an injected SDK transport.
import { NO_SEAT_HINT, parseWorldCatalog, probeWorldSeat } from "@spellkave/gateway-identity";
import {
	buildSubscribeSet,
	type connect,
	type SpellkaveSession,
	subscribeSetForSurface,
} from "@spellkave/sdk";
import type { SessionBinding } from "@spellkave/session";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withRemoteMcpAccessToken, withRemoteMcpRequestSubject } from "../observability.ts";
import { JwtBoundPlayerSessionClient } from "../runtime.ts";
import { createSeatProbes } from "../seat-probes.ts";

const sdk = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("@spellkave/sdk", async (importOriginal) => ({
	...(await importOriginal<typeof import("@spellkave/sdk")>()),
	connect: sdk.connect,
}));

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error("missing test fixture");
	return value;
}

function token(sub: string, extra: Record<string, unknown> = {}) {
	return `e30.${Buffer.from(JSON.stringify({ iss: "issuer", sub, ...extra })).toString("base64url")}.sig`;
}

function transport() {
	const rows = new Map<string, { bindings: Record<string, unknown>[]; role: string }>();
	const connections: { session: SpellkaveSession; callbacks: Parameters<typeof connect>[1] }[] = [];
	const connectFn = vi.fn<typeof connect>(async (args, callbacks) => {
		const sub = JSON.parse(
			Buffer.from(args.token?.split(".")[1] ?? "", "base64url").toString(),
		).sub;
		let state = rows.get(sub);
		if (!state) {
			state = {
				bindings: [
					{ key: sub, actorId: sub === "alice" ? 1n : 2n, role: "primary", boundAtTick: 1n },
				],
				role: "primary",
			};
			rows.set(sub, state);
		}
		const caller = state;
		const table = (values: Record<string, unknown>[]) => ({ iter: () => values });
		const session = {
			ready: Promise.resolve(),
			conn: {
				db: {
					visible_actor_identity: {
						iter: () => caller.bindings.map((row) => ({ ...row, role: caller.role })),
					},
					actor: table([
						{ actorId: 1n, currentBody: 10n },
						{ actorId: 2n, currentBody: 20n },
					]),
					visible_capability: table([]),
					visible_entity_tag: table([]),
					visible_entity_tag_coverage: table([{ status: "complete", projectionVersion: 1 }]),
					world_time: table([{ tick: 1n }]),
				},
			},
			disconnect: vi.fn(),
		} as unknown as SpellkaveSession;
		connections.push({ session, callbacks });
		return session;
	});
	return { connectFn, rows, connections };
}

const catalog = parseWorldCatalog({
	v: "player-world-catalog/v1",
	worlds: [
		{
			slug: "world",
			db: "world",
			display_name: "World",
			adventure: "elven-mini",
			status: "running",
			visibility: "public",
			owner: "owner",
			members: [],
			join_policy: "invite",
		},
	],
});

function call(client: JwtBoundPlayerSessionClient, sub: string, bearer = token(sub)) {
	return withRemoteMcpRequestSubject(sub, () =>
		withRemoteMcpAccessToken(bearer, () => client.invoke("spellkave_look", {})),
	);
}

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe("retained caller-scoped routing connections", () => {
	it("drives 100 tool calls for two identities: routing connects fall from 100 to 2", async () => {
		// Fake time also owns the existing runtime invoke deadline timers.
		vi.useFakeTimers();
		const run = async (retained: boolean) => {
			const host = transport();
			sdk.connect.mockImplementation(host.connectFn);
			const probes = createSeatProbes({ connectFn: host.connectFn });
			const attach = vi.fn(async (binding: SessionBinding) => ({
				invoke: async () => ({
					id: 1,
					ok: true as const,
					result: { content: [], actorId: binding.actorId },
				}),
			}));
			const client = new JwtBoundPlayerSessionClient(
				"url",
				catalog,
				(world, bearer) =>
					retained
						? probes.probe("url", world.db, bearer)
						: probeWorldSeat("url", world.db, bearer),
				{ attach },
			);
			try {
				for (let i = 0; i < 100; i++) {
					const sub = i % 2 === 0 ? "alice" : "bob";
					expect(await call(client, sub)).toMatchObject({
						result: { actorId: sub === "alice" ? "10" : "20" },
					});
				}
				expect(attach).toHaveBeenCalledTimes(2);
				return host.connectFn.mock.calls.length;
			} finally {
				await probes.close();
			}
		};
		expect(await run(false)).toBe(100);
		expect(await run(true)).toBe(2);
	});

	it("hydrates only routing rows even for a caller whose other visible tables are large", async () => {
		const host = transport();
		const probes = createSeatProbes({ connectFn: host.connectFn });
		try {
			await probes.probe("url", "world", token("alice"));
			const args = required(host.connectFn.mock.calls[0])[0];
			expect(buildSubscribeSet(args.readerManifests)).toEqual([
				"config",
				"world_time",
				"directly_controlled_actor_spatial_location",
				"actor",
				"visible_actor_identity",
			]);
			const tables = subscribeSetForSurface({ tables: [] }, args.readerManifests);
			expect(tables).not.toContain("visible_manipulation_context");
			expect(tables).not.toContain("visible_world_event");
			expect(tables).not.toContain("visible_manifest_authored_entity");
			Object.defineProperty(required(host.connections[0]).session.conn.db, "visible_capability", {
				get() {
					throw new Error("routing must not scan a wide capability cache");
				},
			});
			const seat = await probes.probe("url", "world", token("alice"));
			expect(seat).toMatchObject({ actorId: "10", role: "primary" });
			expect(seat).not.toHaveProperty("selfCapabilities");
		} finally {
			await probes.close();
		}
	});

	it("deduplicates concurrent opens and reuses a refreshed bearer only for the same issuer/subject/seat/world", async () => {
		const host = transport();
		const probes = createSeatProbes({ connectFn: host.connectFn });
		try {
			await Promise.all(
				Array.from({ length: 20 }, () => probes.probe("url", "world", token("alice"))),
			);
			await probes.probe("url", "world", token("alice", { exp: 999 }));
			expect(host.connectFn).toHaveBeenCalledTimes(1);
			await probes.probe("url", "world", token("bob"));
			await probes.probe("url", "world", token("alice", { iss: "other-issuer" }));
			await probes.probe("url", "other-world", token("alice"));
			await probes.probe("other-url", "world", token("alice"));
			await probes.probe("url", "world", token("alice", { "urn:spellkave:seat": "world/1" }), "1");
			await probes.probe("url", "world", token("alice", { "urn:spellkave:seat": "world/2" }), "2");
			expect(host.connectFn).toHaveBeenCalledTimes(7);
		} finally {
			await probes.close();
		}
		expect(
			host.connections.every(
				({ session }) => vi.mocked(session.disconnect).mock.calls.length === 1,
			),
		).toBe(true);
	});

	it("a delivered seat release takes effect on the next tool call without reconnecting or acting as another caller", async () => {
		vi.useFakeTimers();
		const host = transport();
		const probes = createSeatProbes({ connectFn: host.connectFn });
		const invoke = vi.fn(async () => ({ id: 1, ok: true as const, result: { content: [] } }));
		const client = new JwtBoundPlayerSessionClient(
			"url",
			catalog,
			(world, bearer) => probes.probe("url", world.db, bearer),
			{ attach: async () => ({ invoke }) },
		);
		try {
			await call(client, "alice");
			await call(client, "bob");
			required(host.rows.get("alice")).bindings = [];
			expect(await call(client, "alice")).toMatchObject({
				result: { content: [{ type: "text", text: NO_SEAT_HINT }] },
			});
			expect(invoke).toHaveBeenCalledTimes(2);
			await call(client, "bob");
			expect(invoke).toHaveBeenCalledTimes(3);
			expect(host.connectFn).toHaveBeenCalledTimes(2);
			const picked = new JwtBoundPlayerSessionClient(
				"url",
				catalog,
				(world, bearer) => probes.probe("url", world.db, bearer),
				{
					findClaimedSeat: (world, bearer, actorId) =>
						probes.probe("url", world.db, bearer, actorId),
					isOfferedFreeSeat: async () => false,
					attach: async () => ({ invoke }),
				},
			);
			const bearer = token("bob", { "urn:spellkave:seat": "world/2" });
			await call(picked, "bob", bearer);
			required(host.rows.get("bob")).bindings = [];
			await expect(call(picked, "bob", bearer)).rejects.toThrow("seat_unavailable");
			expect(invoke).toHaveBeenCalledTimes(4);
			expect(host.connectFn).toHaveBeenCalledTimes(3);
		} finally {
			await probes.close();
		}
	});

	it("re-reads presence routing and refuses a newly ambiguous authority world", async () => {
		vi.useFakeTimers();
		const host = transport();
		const probes = createSeatProbes({ connectFn: host.connectFn });
		const worlds = {
			...catalog,
			worlds: [...catalog.worlds, { ...required(catalog.worlds[0]), slug: "second", db: "second" }],
		};
		const findSeat = async (world: (typeof worlds.worlds)[number], bearer: string) =>
			probes.probe("url", world.db, bearer);
		const client = new JwtBoundPlayerSessionClient("url", worlds, findSeat, {
			attach: async () => ({
				invoke: async () => ({ id: 1, ok: true as const, result: { content: [] } }),
			}),
		});
		try {
			await call(client, "alice");
			required(host.rows.get("alice")).role = "presence";
			await expect(call(client, "alice")).rejects.toThrow("ambiguous_authority_world");
			expect(host.connectFn).toHaveBeenCalledTimes(2);
		} finally {
			await probes.close();
		}
	});

	it("evicts idle, disconnected and failed connections and retries with the latest bearer", async () => {
		vi.useFakeTimers();
		const host = transport();
		const probes = createSeatProbes({ connectFn: host.connectFn, idleMs: 1000 });
		try {
			await probes.probe("url", "world", token("alice"));
			await vi.advanceTimersByTimeAsync(900);
			await probes.probe("url", "world", token("alice"));
			await vi.advanceTimersByTimeAsync(900);
			expect(required(host.connections[0]).session.disconnect).not.toHaveBeenCalled();
			await vi.advanceTimersByTimeAsync(100);
			expect(required(host.connections[0]).session.disconnect).toHaveBeenCalledOnce();
			await probes.probe("url", "world", token("alice"));
			required(host.connections[1]).callbacks.onDisconnect(new Error("lost"));
			const fresh = token("alice", { exp: 999 });
			await probes.probe("url", "world", fresh);
			expect(host.connectFn.mock.calls[2]?.[0].token).toBe(fresh);
			required(host.connections[2]).callbacks.onError(new Error("subscription lost"));
			host.connectFn.mockRejectedValueOnce(new Error("unavailable"));
			await expect(probes.probe("url", "world", fresh)).rejects.toThrow("unavailable");
			await probes.probe("url", "world", fresh);
			expect(host.connectFn).toHaveBeenCalledTimes(5);
		} finally {
			await probes.close();
		}
		await expect(probes.probe("url", "world", token("alice"))).rejects.toThrow("closed");
	});
});
