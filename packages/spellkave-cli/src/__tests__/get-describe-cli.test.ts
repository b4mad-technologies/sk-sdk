// A world author reads the instances placed in a running world with
// `sk get <kind> [<key>]` and `sk describe entities <key>`, as the
// publisher. These tests check the routing (which answer exits 0, 1 or 2,
// which mistakes refuse before connecting), the human view of `describe`
// (pinned in `__snapshots__/get-describe-cli.test.ts.snap`), and that both
// verbs answer exactly like their registry tools. A fake publisher
// connection stands in for the world; no node.
import { createAuthorFacingBoundTools } from "@spellkave/tool-authoring";
import {
	createOwnerInstanceRead,
	type OwnerInstanceRead,
	type OwnerSnapshot,
} from "@spellkave/world-author";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ConnectLive, EXIT_IN_WORLD, EXIT_OK, EXIT_USAGE, runCli } from "../cli";
import { collect, snapshotText } from "./helpers";

beforeEach(() => {
	vi.stubEnv("SPELLKAVE_URL", "http://127.0.0.1:1");
	vi.stubEnv("SPELLKAVE_DB", "get-describe-test");
});
afterEach(() => vi.unstubAllEnvs());

function connection(port?: OwnerInstanceRead, readsAsPublisher = true): ConnectLive {
	return async () => ({
		target: {
			kind: "live",
			resolveRef: () => false,
			lookup: () => [],
			applyBatch: async () => ({ ok: true }),
		},
		...(port === undefined ? {} : { readInstance: port }),
		readsAsPublisher,
		connectedIdentity: "publisher",
		close: () => {},
	});
}

describe("sk get / sk describe routing", () => {
	it("help get and help describe are reserved core commands", async () => {
		const getHelp = collect();
		expect(await runCli(["help", "get"], getHelp.io)).toBe(EXIT_OK);
		expect(getHelp.out.join("\n")).toMatch(/Connects on the author path/);
		const describeHelp = collect();
		expect(await runCli(["help", "describe"], describeHelp.io)).toBe(EXIT_OK);
		expect(describeHelp.out.join("\n")).toMatch(/sk describe entities/);
	});

	it("get uses the live readInstance port and exits 0 on ok", async () => {
		const get = vi.fn(() => ({
			ok: true as const,
			kind: "entities",
			tick: "3",
			labels: ["authored_entities_only"] as const,
			row: { entity_key: "core/hero" },
		}));
		const port: OwnerInstanceRead = {
			get,
			describe: () => {
				throw new Error("describe must not run");
			},
		};
		const { io, out } = collect();
		expect(
			await runCli(["--format", "jsonl", "get", "entities", "core/hero"], io, connection(port)),
		).toBe(EXIT_OK);
		expect(get).toHaveBeenCalledWith({ kind: "entities", key: "core/hero" });
		expect(out.join("\n")).toMatch(/"kind":"get_result"/);
		expect(out.join("\n")).toMatch(/"reads_as_publisher":true/);
	});

	it("empty listing still exits 0", async () => {
		const port: OwnerInstanceRead = {
			get: () => ({
				ok: true,
				kind: "entities",
				tick: "1",
				labels: ["authored_entities_only"],
				rows: [],
				match_count: 0,
				left_out: 0,
			}),
			describe: () => {
				throw new Error("describe must not run");
			},
		};
		const { io, out } = collect();
		expect(await runCli(["--format", "jsonl", "get", "entities"], io, connection(port))).toBe(
			EXIT_OK,
		);
		expect(out[0]).toContain('"match_count":0');
		expect(snapshotText(out)).toMatchSnapshot();
	});

	it("maps not_publisher and unknown_key to exit 2", async () => {
		const port: OwnerInstanceRead = {
			get: () => ({ ok: false, code: "not_publisher", message: "reads_as_publisher is false" }),
			describe: () => ({ ok: false, code: "unknown_key", message: "no authored entities row" }),
		};
		const refused = collect();
		expect(
			await runCli(["--format", "jsonl", "get", "entities"], refused.io, connection(port, false)),
		).toBe(EXIT_IN_WORLD);
		const unknown = collect();
		expect(
			await runCli(
				["--format", "jsonl", "describe", "entities", "missing"],
				unknown.io,
				connection(port),
			),
		).toBe(EXIT_IN_WORLD);
	});

	it("maps usage from the port and ambiguous_bundle to 1 and 2", async () => {
		const port: OwnerInstanceRead = {
			get: () => ({
				ok: false,
				code: "usage",
				message:
					"kind 'place_nodes' is not read from a world by this tool; use sk query --target live",
			}),
			describe: () => ({
				ok: false,
				code: "ambiguous_bundle",
				message: "key hero matches bundles core and srd",
			}),
		};
		expect(
			await runCli(["--format", "jsonl", "get", "place_nodes"], collect().io, connection(port)),
		).toBe(EXIT_USAGE);
		expect(
			await runCli(
				["--format", "jsonl", "describe", "entities", "hero"],
				collect().io,
				connection(port),
			),
		).toBe(EXIT_IN_WORLD);
	});

	it("forwards describe --bundle and --limit to the port", async () => {
		const describe = vi.fn(() =>
			describeOk({
				belonging: [],
				match_count: 0,
				left_out: 0,
			}),
		);
		const port: OwnerInstanceRead = {
			get: () => {
				throw new Error("get must not run");
			},
			describe,
		};
		expect(
			await runCli(
				["--format", "jsonl", "describe", "entities", "shared", "--bundle", "a", "--limit", "3"],
				collect().io,
				connection(port),
			),
		).toBe(EXIT_OK);
		expect(describe).toHaveBeenCalledWith({
			kind: "entities",
			key: "shared",
			bundle: "a",
			limit: 3,
		});
	});

	it("describe --limit -1 exits 1 without connecting", async () => {
		const connectLive = vi.fn(connection());
		expect(
			await runCli(
				["--format", "jsonl", "describe", "entities", "shared", "--limit", "-1"],
				collect().io,
				connectLive,
			),
		).toBe(EXIT_USAGE);
		expect(connectLive).not.toHaveBeenCalled();
	});

	it("refuses extra positionals and describe --pattern without connecting", async () => {
		const connectLive = vi.fn(connection());
		expect(
			await runCli(
				["--format", "jsonl", "get", "entities", "hero", "unexpected"],
				collect().io,
				connectLive,
			),
		).toBe(EXIT_USAGE);
		expect(
			await runCli(
				["--format", "jsonl", "describe", "entities", "hero", "--pattern", "x"],
				collect().io,
				connectLive,
			),
		).toBe(EXIT_USAGE);
		expect(connectLive).not.toHaveBeenCalled();
	});

	it("usage (missing kind/key) exits 1 without connecting", async () => {
		const connectLive = vi.fn(connection());
		const { io } = collect();
		expect(await runCli(["--format", "jsonl", "get"], io, connectLive)).toBe(EXIT_USAGE);
		expect(connectLive).not.toHaveBeenCalled();
		expect(
			await runCli(["--format", "jsonl", "describe", "entities"], collect().io, connectLive),
		).toBe(EXIT_USAGE);
		expect(connectLive).not.toHaveBeenCalled();
	});

	it("connect failure exits 1", async () => {
		const connectLive: ConnectLive = async () => {
			throw new Error("connection refused");
		};
		const { io, out } = collect();
		expect(
			await runCli(["--format", "jsonl", "get", "entities", "core/hero"], io, connectLive),
		).toBe(EXIT_USAGE);
		expect(out.join("\n")).toMatch(/no reachable world/);
	});

	it("missing readInstance refuses without export", async () => {
		const { io, out } = collect();
		expect(await runCli(["--format", "jsonl", "get", "entities"], io, connection())).toBe(
			EXIT_IN_WORLD,
		);
		expect(out.join("\n")).toMatch(/not_publisher/);
		expect(out.join("\n")).not.toMatch(/export/);
	});

	it("JSONL preserves i64/u64 bigint digits from the get answer", async () => {
		const i64Max = 9223372036854775807n;
		const u64Max = 18446744073709551615n;
		const port: OwnerInstanceRead = {
			get: () => ({
				ok: true,
				kind: "object_state",
				tick: "3",
				labels: ["authored_entities_only"],
				row: { value_int: i64Max, expires_at: u64Max },
			}),
			describe: () => {
				throw new Error("describe must not run");
			},
		};
		const { io, out } = collect();
		expect(
			await runCli(
				["--format", "jsonl", "get", "object_state", "core/hero::hp"],
				io,
				connection(port),
			),
		).toBe(EXIT_OK);
		expect(out).toHaveLength(1);
		expect(out[0]).toContain('"value_int":"9223372036854775807"');
		expect(out[0]).toContain('"expires_at":"18446744073709551615"');
		expect(() => JSON.parse(out[0] as string)).not.toThrow();
	});

	it("sk query --kind entities without --live does not connect", async () => {
		const connectLive = vi.fn(connection());
		const { io } = collect();
		await runCli(["--format", "jsonl", "query", "--kind", "entities"], io, connectLive);
		expect(connectLive).not.toHaveBeenCalled();
	});
});

function describeOk(
	overrides: Partial<Extract<ReturnType<OwnerInstanceRead["describe"]>, { ok: true }>> = {},
) {
	return {
		ok: true as const,
		kind: "entities" as const,
		tick: "12",
		labels: ["authored_entities_only"] as const,
		row: { entity_key: "kavemouth/adventure/item/loft_chest_1", name: "Loft chest" },
		slices: {
			entities: [{ entity_key: "kavemouth/adventure/item/loft_chest_1" }],
			object_state: [{ state_id: "locked", value: false }],
		},
		numeric_id: "41",
		place: "kavemouth/loft",
		container_chain: [
			{
				numeric_id: "41",
				entity_key: "kavemouth/adventure/item/loft_chest_1",
				place: "kavemouth/loft",
			},
		],
		chain_end: { reason: "place" as const, numeric_id: "41" },
		belonging: [
			{
				entity_key: "kavemouth/adventure/item/loft_chest_potion_1",
				numeric_id: "42",
				name: "Potion",
				belongs_to_numeric_id: "41",
				relation: "containment" as const,
			},
		],
		match_count: 1,
		left_out: 0,
		...overrides,
	};
}

describe("sk describe human rendering", () => {
	it("shows slices, chain end at a place, and bounded belonging", async () => {
		const port: OwnerInstanceRead = {
			get: () => {
				throw new Error("get must not run");
			},
			describe: () => describeOk(),
		};
		const { io, out } = collect({ stdoutIsTTY: true });
		expect(
			await runCli(
				["--format", "human", "describe", "entities", "kavemouth/adventure/item/loft_chest_1"],
				io,
				connection(port),
			),
		).toBe(EXIT_OK);
		expect(snapshotText(out)).toMatchSnapshot();
	});

	it("shows chain end cycle and left-out belonging rows", async () => {
		const port: OwnerInstanceRead = {
			get: () => {
				throw new Error("get must not run");
			},
			describe: () =>
				describeOk({
					place: undefined,
					chain_end: { reason: "cycle", numeric_id: "41" },
					match_count: 3,
					left_out: 2,
				}),
		};
		const { io, out } = collect({ stdoutIsTTY: true });
		expect(
			await runCli(
				["--format", "human", "describe", "entities", "kavemouth/adventure/item/loft_chest_1"],
				io,
				connection(port),
			),
		).toBe(EXIT_OK);
		expect(snapshotText(out)).toMatchSnapshot();
	});

	it("shows chain end none when no place is found", async () => {
		const port: OwnerInstanceRead = {
			get: () => {
				throw new Error("get must not run");
			},
			describe: () =>
				describeOk({
					place: undefined,
					container_chain: [],
					chain_end: { reason: "none" },
					belonging: [],
					match_count: 0,
					left_out: 0,
				}),
		};
		const { io, out } = collect({ stdoutIsTTY: true });
		expect(
			await runCli(
				["--format", "human", "describe", "entities", "kavemouth/adventure/item/loft_chest_1"],
				io,
				connection(port),
			),
		).toBe(EXIT_OK);
		expect(snapshotText(out)).toMatchSnapshot();
	});
});

describe("sk get and sk describe answer like the spellkave_get and spellkave_describe tools", () => {
	function table(rows: Record<string, unknown>[]): {
		iter: () => Iterable<Record<string, unknown>>;
	} {
		return { iter: () => rows };
	}
	function snap(parts: Record<string, Record<string, unknown>[]>): OwnerSnapshot {
		const out: OwnerSnapshot = {};
		for (const [k, v] of Object.entries(parts)) out[k] = table(v);
		return out;
	}

	it("sk get and spellkave_get return the same details from one OwnerInstanceRead", async () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [
						{
							manifestKey: "kavemouth:kavemouth/adventure/item/loft_chest_1",
							bundleId: "kavemouth",
							entityId: 10n,
						},
					],
					entity: [{ entityId: 10n, name: "Chest", kind: "item" }],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
				}),
			worldTick: () => 9n,
			readsAsPublisher: true,
		});
		const tools = createAuthorFacingBoundTools({
			workspace: { readToml: () => null, writeToml: () => "/scratch" },
			readInstance: port,
		});
		const getTool = tools.find((t) => t.name === "spellkave_get");
		expect(getTool).toBeDefined();
		const toolResult = (await getTool?.execute("t", {
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
		})) as { details?: unknown } | undefined;
		const { io, out } = collect();
		expect(
			await runCli(
				["--format", "jsonl", "get", "entities", "kavemouth/adventure/item/loft_chest_1"],
				io,
				connection(port),
			),
		).toBe(EXIT_OK);
		const cliRecord = JSON.parse(out[0] as string) as Record<string, unknown>;
		const {
			kind: _envelopeKind,
			reads_as_publisher: _pub,
			connected_identity: _id,
			instance_kind,
			...rest
		} = cliRecord;
		expect({ ...rest, kind: instance_kind }).toEqual(toolResult?.details);
	});

	it("sk describe and spellkave_describe return the same details from one OwnerInstanceRead", async () => {
		const port = createOwnerInstanceRead({
			snapshot: () =>
				snap({
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					operator_manifest_authored_entity: [
						{
							manifestKey: "kavemouth:kavemouth/adventure/item/loft_chest_1",
							bundleId: "kavemouth",
							entityId: 10n,
						},
					],
					entity: [{ entityId: 10n, name: "Chest", kind: "item" }],
					entity_location: [{ entityId: 10n, placeNodeId: "inn/loft" }],
				}),
			worldTick: () => 9n,
			readsAsPublisher: true,
		});
		const tools = createAuthorFacingBoundTools({
			workspace: { readToml: () => null, writeToml: () => "/scratch" },
			readInstance: port,
		});
		const describeTool = tools.find((t) => t.name === "spellkave_describe");
		expect(describeTool).toBeDefined();
		const toolResult = (await describeTool?.execute("t", {
			kind: "entities",
			key: "kavemouth/adventure/item/loft_chest_1",
		})) as { details?: unknown } | undefined;
		const { io, out } = collect();
		expect(
			await runCli(
				["--format", "jsonl", "describe", "entities", "kavemouth/adventure/item/loft_chest_1"],
				io,
				connection(port),
			),
		).toBe(EXIT_OK);
		const cliRecord = JSON.parse(out[0] as string) as Record<string, unknown>;
		const {
			kind: _envelopeKind,
			reads_as_publisher: _pub,
			connected_identity: _id,
			instance_kind,
			...rest
		} = cliRecord;
		expect({ ...rest, kind: instance_kind }).toEqual(toolResult?.details);
	});

	it("sk tool spellkave_get usage refusal exits 1 like sk get", async () => {
		const port: OwnerInstanceRead = {
			get: () => ({
				ok: false,
				code: "usage",
				message:
					"kind 'place_nodes' is not read from a world by this tool; use sk query --target live",
			}),
			describe: () => ({
				ok: false,
				code: "usage",
				message: "describe is defined for entities; use sk get",
			}),
		};
		expect(
			await runCli(
				["--format", "jsonl", "tool", "spellkave_get", "place_nodes"],
				collect().io,
				connection(port),
			),
		).toBe(EXIT_USAGE);
		expect(
			await runCli(
				["--format", "jsonl", "tool", "spellkave_describe", "actors", "hero"],
				collect().io,
				connection(port),
			),
		).toBe(EXIT_USAGE);
	});

	it("sk tool spellkave_get and spellkave_describe connect without --live", async () => {
		const port: OwnerInstanceRead = {
			get: () => ({
				ok: true,
				kind: "entities",
				tick: "1",
				labels: ["authored_entities_only"],
				row: { entity_key: "core/hero" },
			}),
			describe: () => ({
				ok: true,
				kind: "entities",
				tick: "1",
				labels: ["authored_entities_only"],
				row: { entity_key: "core/hero" },
				slices: {},
				numeric_id: "1",
				container_chain: [],
				chain_end: { reason: "none" },
				belonging: [],
				match_count: 0,
				left_out: 0,
			}),
		};
		const connectLive = vi.fn(connection(port));
		expect(
			await runCli(
				["--format", "jsonl", "tool", "spellkave_get", "entities", "core/hero"],
				collect().io,
				connectLive,
			),
		).toBe(EXIT_OK);
		expect(connectLive).toHaveBeenCalled();
		connectLive.mockClear();
		expect(
			await runCli(
				["--format", "jsonl", "tool", "spellkave_describe", "entities", "core/hero"],
				collect().io,
				connectLive,
			),
		).toBe(EXIT_OK);
		expect(connectLive).toHaveBeenCalled();
	});
});
