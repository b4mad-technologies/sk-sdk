import { afterEach, describe, expect, it, vi } from "vitest";
import { KNOWN_TABLES } from "../reader-manifest";

const STRICT_REDUCERS = [
	"r_manipulate",
	"r_move",
	"r_sense",
	"r_session_close",
	"r_session_move",
	"r_session_open",
];

type Applied = () => void;

let onConnect: ((conn: unknown, identity: string, token: string) => void) | undefined;
let onConnectError: ((ctx: unknown, err: Error) => void) | undefined;
let onDisconnect: ((ctx: unknown, err?: Error) => void) | undefined;
let ownerApplied: Applied | undefined;
const subscriptionOnError: Array<(ctx: unknown, err?: unknown) => void> = [];
const reducerCalls: string[] = [];
const subscriptionQueries: string[][] = [];
let ownerIdentity = "publisher";
let holdOwnerApply = false;
let holdReaderApply = false;
let holdConnect = false;
let failBeforeConnect = false;

vi.mock("@spellkave/bindings", () => {
	const subscriptionBuilder = {
		onApplied: (callback: Applied) => {
			ownerApplied = callback;
			return subscriptionBuilder;
		},
		onError: (callback: (ctx: unknown, err?: unknown) => void) => {
			subscriptionOnError.push(callback);
			return subscriptionBuilder;
		},
		subscribe: (queries: string[]) => {
			subscriptionQueries.push(queries);
			const owner = queries.some((query) => query.endsWith(" entity_containment"));
			if (owner ? !holdOwnerApply : !holdReaderApply) ownerApplied?.();
			return { unsubscribe: () => {} };
		},
	};
	const conn = {
		db: {
			config: {
				iter: () => [{ operatorIdentity: ownerIdentity }],
			},
		},
		subscriptionBuilder: () => subscriptionBuilder,
		disconnect: () => {
			onDisconnect?.(undefined, new Error("socket closed"));
		},
		reducers: {
			rMove: () => {
				reducerCalls.push("rMove");
			},
		},
	};
	const builder = {
		withUri: () => builder,
		withCompression: () => builder,
		withDatabaseName: () => builder,
		withToken: () => builder,
		onConnect: (callback: typeof onConnect) => {
			onConnect = callback;
			return builder;
		},
		onConnectError: (callback: typeof onConnectError) => {
			onConnectError = callback;
			return builder;
		},
		onDisconnect: (callback: typeof onDisconnect) => {
			onDisconnect = callback;
			return builder;
		},
		build: () => {
			if (failBeforeConnect) {
				onConnectError?.(undefined, new Error("connect failed"));
				return conn;
			}
			if (holdConnect) return conn;
			onConnect?.(conn, "publisher", "token");
			return conn;
		},
	};
	return {
		DbConnection: { builder: () => builder },
		STRICT_REDUCERS: [
			"r_manipulate",
			"r_move",
			"r_sense",
			"r_session_close",
			"r_session_move",
			"r_session_open",
		],
	};
});

import { connect, OWNER_SUBSCRIPTION_TABLES, STRICT_TABLES } from "../connection";
import { servedSchema } from "./served_schema_fixture";

const EXPECTED_OWNER_SUBSCRIPTION_TABLES = [
	"operator_manifest_authored_entity",
	"entity_tag",
	"autonomy_job",
	"arbitration_request",
	"arbitration_response",
	"arbitration_rejection",
	"arbitration_fallback",
	"entity_containment",
	"entity_location",
	"object_state",
	"capability",
	"actor_identity",
	"actor_spatial_location",
	"entity_equipment_slot",
	"target_condition",
] as const;

function schema() {
	return servedSchema(STRICT_TABLES, STRICT_REDUCERS);
}

const callbacks = { onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} };

afterEach(() => {
	subscriptionQueries.length = 0;
	ownerIdentity = "publisher";
	holdOwnerApply = false;
	holdReaderApply = false;
	holdConnect = false;
	failBeforeConnect = false;
	subscriptionOnError.length = 0;
	reducerCalls.length = 0;
	onDisconnect = undefined;
	onConnectError = undefined;
});

async function connectAs(ownerTables: boolean | undefined, identity = "publisher") {
	ownerIdentity = identity;
	globalThis.fetch = vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve(schema()),
	}) as unknown as typeof fetch;
	return connect(
		{
			url: "http://127.0.0.1:3000",
			db: "spellkave-dev",
			token: null,
			connectedActorId: "actor",
			ownerTables,
		},
		callbacks,
	);
}

describe("initial subscription readiness", () => {
	// keep(K2): inject a socket close before authentication completes.
	it("rejects a socket close before onConnect", async () => {
		holdConnect = true;
		const session = await connectAs(false);
		const rejected = vi.fn();
		session.ready.catch(rejected);
		const error = new Error("socket closed before connect");
		onDisconnect?.(undefined, error);
		await Promise.resolve();
		expect(rejected).toHaveBeenCalledWith(error);
	});

	// keep(K2): inject transport loss before the initial subscription applies.
	it.each([
		undefined,
		new Error("socket closed before hydration"),
	])("rejects a pending reader wait on socket disconnect (%s)", async (error) => {
		holdReaderApply = true;
		const session = await connectAs(false);
		const resolved = vi.fn();
		const rejected = vi.fn();
		session.ready.then(resolved, rejected);
		onDisconnect?.(undefined, error);
		await Promise.resolve();
		expect(resolved).not.toHaveBeenCalled();
		expect(rejected).toHaveBeenCalledOnce();
		if (error) expect(rejected).toHaveBeenCalledWith(error);
		else
			expect(rejected.mock.calls[0]?.[0]?.message).toMatch(
				/connection ended.*initial subscription/,
			);
	});

	// keep(K2): hold subscription hydration while the caller disconnects.
	it("rejects a pending reader wait on explicit disconnect", async () => {
		holdReaderApply = true;
		const session = await connectAs(false);
		const rejected = vi.fn();
		session.ready.catch(rejected);
		session.disconnect();
		await Promise.resolve();
		expect(rejected).toHaveBeenCalledOnce();
		expect(rejected.mock.calls[0]?.[0]?.message).toMatch(/connection ended.*initial subscription/);
	});

	// keep(K2): inject transport loss after hydration to protect the settled wait.
	it("keeps an already hydrated reader wait resolved after disconnect", async () => {
		const session = await connectAs(false);
		await session.ready;
		onDisconnect?.(undefined, new Error("socket closed after hydration"));
		await expect(session.ready).resolves.toBeUndefined();
	});
});

describe("owner subscription", () => {
	it("opens a second subscription only for an opted-in publisher", async () => {
		const session = await connectAs(true);
		await session.ownerRowsReady;
		expect(subscriptionQueries).toHaveLength(2);
		expect(session.readsAsPublisher).toBe(true);
		for (const table of EXPECTED_OWNER_SUBSCRIPTION_TABLES) {
			expect(subscriptionQueries[1]?.some((query) => query.includes(table))).toBe(true);
		}
	});

	it("opens one subscription for a different identity", async () => {
		const session = await connectAs(true, "guest");
		await session.ownerRowsReady;
		expect(subscriptionQueries).toHaveLength(1);
		expect(session.readsAsPublisher).toBe(false);
	});

	it("opens one subscription when the publisher does not opt in", async () => {
		const session = await connectAs(undefined);
		await session.ownerRowsReady;
		expect(subscriptionQueries).toHaveLength(1);
		expect(session.readsAsPublisher).toBe(false);
	});

	async function quietTurn(): Promise<void> {
		await new Promise((resolve) => setImmediate(resolve));
	}

	function watchUnhandled(): { stop: () => unknown[] } {
		const unhandled: unknown[] = [];
		const onUnhandled = (reason: unknown) => {
			unhandled.push(reason);
		};
		process.on("unhandledRejection", onUnhandled);
		return {
			stop: () => {
				process.off("unhandledRejection", onUnhandled);
				return unhandled;
			},
		};
	}

	it("rejects a pending owner wait when the socket closes", async () => {
		const watch = watchUnhandled();
		holdOwnerApply = true;
		const session = await connectAs(true);
		await session.ready;
		expect(subscriptionQueries).toHaveLength(2);
		const closed = new Error("socket closed");
		onDisconnect?.(undefined, closed);
		await quietTurn();
		expect(watch.stop()).toEqual([]);
		await expect(session.ownerRowsReady).rejects.toBe(closed);
		expect(session.readsAsPublisher).toBe(false);
		expect(session.ownerSubscriptionError).toBeNull();
	});

	it("rejects a pending owner wait on explicit disconnect", async () => {
		const watch = watchUnhandled();
		holdOwnerApply = true;
		const session = await connectAs(true);
		await session.ready;
		session.disconnect();
		await quietTurn();
		expect(watch.stop()).toEqual([]);
		await expect(session.ownerRowsReady).rejects.toThrow(
			"connection ended before owner rows were ready",
		);
		expect(session.readsAsPublisher).toBe(false);
		expect(session.ownerSubscriptionError).toBeNull();
	});

	it("rejects a pending owner wait when connect fails", async () => {
		const watch = watchUnhandled();
		failBeforeConnect = true;
		const session = await connectAs(true);
		// `ready` is the caller's promise. The SDK's no-op catch is only on
		// `ownerRowsReady`, so observe `ready` before the quiet turn.
		session.ready.catch(() => {});
		await quietTurn();
		expect(watch.stop()).toEqual([]);
		await expect(session.ownerRowsReady).rejects.toThrow("connect failed");
		await expect(session.ready).rejects.toThrow("connect failed");
		expect(session.readsAsPublisher).toBe(false);
		expect(session.ownerSubscriptionError).toBeNull();
	});

	it("does not resettle an owner wait that already resolved", async () => {
		const session = await connectAs(true);
		await session.ownerRowsReady;
		expect(session.readsAsPublisher).toBe(true);
		onDisconnect?.(undefined, new Error("socket closed"));
		await session.ownerRowsReady;
		expect(session.readsAsPublisher).toBe(true);
		expect(session.ownerSubscriptionError).toBeNull();
	});

	it("records a subscribe-time owner refusal without closing ready", async () => {
		const watch = watchUnhandled();
		holdOwnerApply = true;
		const session = await connectAs(true);
		await session.ready;
		expect(subscriptionOnError).toHaveLength(2);
		subscriptionOnError[1]?.(undefined, new Error("owner subscribe refused"));
		await quietTurn();
		expect(watch.stop()).toEqual([]);
		await expect(session.ownerRowsReady).rejects.toThrow("owner subscribe refused");
		expect(session.readsAsPublisher).toBe(false);
		expect(session.ownerSubscriptionError?.message).toBe("owner subscribe refused");
		await expect(session.ready).resolves.toBeUndefined();
		(session.conn.reducers as unknown as { rMove: () => void }).rMove();
		expect(reducerCalls).toEqual(["rMove"]);
	});

	it("names the fifteen owner tables independently of the export", () => {
		expect([...OWNER_SUBSCRIPTION_TABLES]).toEqual([...EXPECTED_OWNER_SUBSCRIPTION_TABLES]);
		expect(EXPECTED_OWNER_SUBSCRIPTION_TABLES).toEqual(
			expect.arrayContaining(["object_state", "target_condition", "actor_identity"]),
		);
	});

	it("keeps the owner set disjoint from reader table names", () => {
		for (const table of EXPECTED_OWNER_SUBSCRIPTION_TABLES) {
			expect(KNOWN_TABLES as readonly string[]).not.toContain(table);
		}
	});
});
