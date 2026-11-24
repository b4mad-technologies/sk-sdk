import type { SpellkaveSession } from "@spellkave/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
	builds: 0,
	nextRows: {} as Record<string, Record<string, unknown>[]>,
	retire: undefined as (() => void) | undefined,
	autoRetire: true,
	fail: false,
	/** A table the retirement leaves rows in: SDK cache drift (sk-jay0.7.123.20.38). */
	residue: undefined as string | undefined,
}));
vi.mock("@spellkave/bindings", () => ({
	DbConnection: {
		builder() {
			let connected: (conn: unknown, identity: unknown) => void;
			let disconnected: () => void;
			let token: string;
			const tables: Record<string, Record<string, unknown>[]> = {};
			const conn = {
				isActive: true,
				db: new Proxy(
					{},
					{
						get: (_t, key) => {
							if (String(key).includes("_")) return undefined;
							const table = String(key).replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
							return { iter: () => tables[table] ?? [] };
						},
					},
				),
				disconnect() {
					conn.isActive = false;
					disconnected?.();
				},
				subscriptionBuilder() {
					let applied: () => void;
					let failed: () => void;
					const sub = {
						onApplied(cb: () => void) {
							applied = cb;
							return sub;
						},
						onError(cb: () => void) {
							failed = cb;
							return sub;
						},
						subscribe(queries: string[]) {
							const names = queries.map((q) => q.split(" ").at(-1) ?? "");
							queueMicrotask(() => {
								if (fake.fail) {
									failed();
									return;
								}
								for (const name of names) tables[name] = structuredClone(fake.nextRows[name] ?? []);
								applied();
							});
							return {
								unsubscribeThen(cb: () => void) {
									fake.retire = () => {
										for (const name of names) if (name !== fake.residue) tables[name] = [];
										cb();
									};
									if (fake.autoRetire) queueMicrotask(fake.retire);
								},
							};
						},
					};
					return sub;
				},
			};
			const builder = {
				withUri: () => builder,
				withDatabaseName: () => builder,
				withToken(v: string) {
					token = v;
					return builder;
				},
				onConnect(cb: typeof connected) {
					connected = cb;
					return builder;
				},
				onDisconnect(cb: typeof disconnected) {
					disconnected = cb;
					return builder;
				},
				onConnectError: () => builder,
				build() {
					fake.builds++;
					queueMicrotask(() => connected(conn, { toHexString: () => token }));
					return conn;
				},
			};
			return builder;
		},
	},
}));

import { createLiveScopedSnapshotPort } from "../live-scoped-instance-port";

const kinds = [
	"entities",
	"actors",
	"actor_spatial_locations",
	"actor_capabilities",
	"actor_equipment_slots",
	"entity_containment",
	"entity_tag",
	"object_state",
];
function rows(name = "first") {
	fake.nextRows = {
		authoring_entity: [{ entityId: 42n, name }],
		authoring_coverage: kinds.map((kind) => ({
			kind,
			status: "complete",
			projectionVersion: 1,
			tick: 7n,
			scopes: ["binding"],
			bundleScopes: ["local"],
		})),
	};
}
function host(identity = "caller") {
	return {
		conn: { isActive: true },
		authenticatedIdentity: { toHexString: () => identity },
		authenticatedToken: identity,
	} as unknown as SpellkaveSession;
}
beforeEach(() => {
	fake.builds = 0;
	fake.autoRetire = true;
	fake.retire = undefined;
	fake.fail = false;
	fake.residue = undefined;
	rows();
});
describe("isolated caller snapshot lifecycle", () => {
	it("retires and empties the sole old group before applying queued reads", async () => {
		const port = createLiveScopedSnapshotPort({
			session: host(),
			world: { url: "http://world", db: "a" },
		});
		const first = await port.read();
		fake.autoRetire = false;
		rows("second");
		let complete = false;
		const next = port.read().then((v) => {
			complete = true;
			return v;
		});
		await vi.waitFor(() => expect(fake.retire).toBeDefined());
		expect(complete).toBe(false);
		expect([...(first.snapshot.entity?.iter() ?? [])][0]?.name).toBe("first");
		if (!fake.retire) throw new Error("missing retirement callback");
		fake.retire();
		const second = await next;
		expect([...(second.snapshot.entity?.iter() ?? [])][0]?.name).toBe("second");
		expect(second.source.tick).toBe(first.source.tick);
		expect(second.source.source_epoch).toBeGreaterThan(first.source.source_epoch);
		expect(Object.isFrozen([...(first.snapshot.entity?.iter() ?? [])][0])).toBe(true);
		port.close();
	});
	it("reads on a fresh connection when the retired group leaves rows behind", async () => {
		// CI run 37919904984: "Deleting a row that was not present in the cache"
		// warnings, then reader_unavailable on the next read of the same port.
		const port = createLiveScopedSnapshotPort({
			session: host(),
			world: { url: "http://world", db: "a" },
		});
		const first = await port.read();
		fake.residue = "authoring_entity";
		rows("second");
		const second = await port.read();
		expect([...(second.snapshot.entity?.iter() ?? [])].map((row) => row.name)).toEqual(["second"]);
		expect(second.source.connection_epoch).toBeGreaterThan(first.source.connection_epoch);
		expect(fake.builds).toBe(2);
		port.close();
	});
	it("keeps epochs stable across identical reapplication and rebuilds for world/user/parent reconnect", async () => {
		let session = host();
		let world = { url: "http://world", db: "a" };
		const port = createLiveScopedSnapshotPort({ session: () => session, world: () => world });
		const one = await port.read();
		const same = await port.read();
		expect(same.source.source_epoch).toBe(one.source.source_epoch);
		session = host();
		const reconnected = await port.read();
		expect(reconnected.source.connection_epoch).toBeGreaterThan(one.source.connection_epoch);
		session = host("other");
		world = { url: "http://world", db: "b" };
		const other = await port.read();
		expect(other.source.identity).toBe("other");
		expect(other.source.world).toContain("/b");
		expect(fake.builds).toBe(3);
		port.close();
	});
	it("refuses missing view coverage, errors, disconnection and an absent credential without owner fallback", async () => {
		const session = host();
		const port = createLiveScopedSnapshotPort({ session, world: { url: "http://world", db: "a" } });
		delete fake.nextRows.authoring_coverage;
		await expect(port.read()).rejects.toThrow("reader_unavailable");
		rows();
		fake.fail = true;
		await expect(port.read()).rejects.toThrow("reader_unavailable");
		fake.fail = false;
		(session.conn as unknown as { isActive: boolean }).isActive = false;
		await expect(port.read()).rejects.toThrow("reader_unavailable");
		port.close();
		await expect(port.read()).rejects.toThrow("reader_unavailable");
	});
	it("bounds the pending queue and rejects every queued read on close during retirement", async () => {
		const port = createLiveScopedSnapshotPort({
			session: host(),
			world: { url: "http://world", db: "a" },
		});
		await port.read();
		fake.autoRetire = false;
		const pending = Array.from({ length: 16 }, () => port.read());
		const outcomes = Promise.allSettled(pending);
		await expect(port.read()).rejects.toThrow("reader_unavailable");
		await vi.waitFor(() => expect(fake.retire).toBeDefined());
		const stale = fake.retire;
		port.close();
		const settled = await outcomes;
		expect(settled).toHaveLength(16);
		expect(settled.every((row) => row.status === "rejected")).toBe(true);
		stale?.();
		await expect(port.read()).rejects.toThrow("reader_unavailable");
	});
	it("deduplicates source depths and refuses malformed depth rather than guessing", async () => {
		const port = createLiveScopedSnapshotPort({
			session: host(),
			world: { url: "http://world", db: "a" },
		});
		for (const row of fake.nextRows.authoring_coverage ?? [])
			row.readDepths = [{ bindingId: "binding", depth: { tag: "Internal" } }];
		const captured = await port.read();
		expect(captured.source.read_depths).toEqual([{ binding_id: "binding", depth: "internal" }]);
		for (const row of fake.nextRows.authoring_coverage ?? [])
			row.readDepths = [{ bindingId: "binding", depth: { tag: "Public" } }];
		await expect(port.read()).rejects.toThrow("reader_unavailable");
		port.close();
	});
});
