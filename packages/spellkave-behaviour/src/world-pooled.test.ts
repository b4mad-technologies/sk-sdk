// keep-file(K2): retry, readiness and error paths need an injected pool that refuses, delays or breaks
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { createPooledWorldSource, PoolExhaustedError, PoolNotReadyError } from "./world-pooled.ts";

type Handler = (
	url: string,
	init: RequestInit,
) => { status: number; body?: unknown; headers?: Record<string, string> };

function fakeFetch(handler: Handler) {
	const calls: string[] = [];
	const f = (async (input: string | URL | Request, init: RequestInit = {}) => {
		const url = String(input);
		calls.push(`${init.method ?? "GET"} ${url}`);
		const r = handler(url, init);
		return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
			status: r.status,
			headers: r.headers ?? {},
		});
	}) as typeof fetch;
	return { f, calls };
}

const lease = (n: number) => ({
	leaseId: `L${n}`,
	url: "http://pool.test:3000",
	db: `pool-s${n}`,
	token: `tok${n}`,
	identity: `id${n}`,
	baseline: "seeded",
	gen: 1,
	expiresAt: "2026-10-07T18:00:00Z",
});

describe("createPooledWorldSource", () => {
	it("leases on reset, exposes url/db/token, and releases the previous lease on the next reset", async () => {
		let n = 0;
		const { f, calls } = fakeFetch((url) => {
			if (url.endsWith("/pool/lease")) return { status: 200, body: lease(++n) };
			return { status: 200, body: [] };
		});
		const w = createPooledWorldSource({ poolUrl: "http://pool.test:3000/", fetch: f });
		assert.throws(() => w.db, /await reset/);
		await w.reset("seeded");
		assert.equal(w.db, "pool-s1");
		assert.equal(w.token, "tok1");
		assert.equal(w.url, "http://pool.test:3000");
		await w.reset("seeded");
		assert.equal(w.db, "pool-s2");
		assert.ok(calls.includes("POST http://pool.test:3000/pool/release"));
		assert.ok(!calls.some((c) => c.startsWith("DELETE")));
	});

	it("reset(wiped) with wipedModule uploads the bytes to /pool/lease-module", async () => {
		const wasm = new Uint8Array([0, 0x61, 0x73, 0x6d, 9]);
		let posted: { url: string; type: string | null; body: Uint8Array } | null = null;
		const { f, calls } = fakeFetch((url, init) => {
			if (url.includes("/pool/lease-module")) {
				posted = {
					url,
					type: new Headers(init.headers).get("Content-Type"),
					body: init.body as Uint8Array,
				};
				return { status: 200, body: { ...lease(1), baseline: "wiped", db: "pool-m1-1" } };
			}
			return { status: 200, body: [] };
		});
		const w = createPooledWorldSource({
			poolUrl: "http://pool.test:3000",
			fetch: f,
			ttlS: 120,
			holder: "branch",
			wipedModule: async () => wasm,
		});
		await w.reset("wiped");
		assert.equal(w.db, "pool-m1-1");
		assert.ok(posted);
		const sent = posted as { url: string; type: string | null; body: Uint8Array };
		assert.equal(sent.url, "http://pool.test:3000/pool/lease-module?ttlS=120&holder=branch");
		assert.equal(sent.type, "application/wasm");
		assert.deepEqual(Array.from(sent.body), Array.from(wasm));
		assert.ok(!calls.some((c) => c.endsWith("/pool/lease")));
	});

	it("waits on 503 Retry-After and then throws PoolExhaustedError within leaseTimeoutMs", async () => {
		const { f } = fakeFetch(() => ({
			status: 503,
			body: { error: "exhausted" },
			headers: { "Retry-After": "0" },
		}));
		const w = createPooledWorldSource({ poolUrl: "http://p", fetch: f, leaseTimeoutMs: 50 });
		await assert.rejects(w.reset("seeded"), PoolExhaustedError);
	});

	it("blocks until the leased database answers SQL, else throws PoolNotReadyError", async () => {
		let sqlCalls = 0;
		const { f } = fakeFetch((url) => {
			if (url.endsWith("/pool/lease")) return { status: 200, body: lease(1) };
			sqlCalls += 1;
			return { status: sqlCalls < 3 ? 503 : 200, body: [] };
		});
		const w = createPooledWorldSource({ poolUrl: "http://p", fetch: f });
		await w.reset("seeded");
		assert.equal(sqlCalls, 3);

		const dead = fakeFetch((url) =>
			url.endsWith("/pool/lease") ? { status: 200, body: lease(2) } : { status: 404 },
		);
		const w2 = createPooledWorldSource({ poolUrl: "http://p", fetch: dead.f, readyTimeoutMs: 300 });
		await assert.rejects(w2.reset("seeded"), PoolNotReadyError);
	});

	it("mints a second caller on the leased host", async () => {
		const { f, calls } = fakeFetch((url) => {
			if (url.endsWith("/pool/lease")) return { status: 200, body: lease(1) };
			if (url.endsWith("/v1/identity"))
				return { status: 200, body: { identity: "c1", token: "ctok" } };
			return { status: 200, body: [] };
		});
		const w = createPooledWorldSource({ poolUrl: "http://p", fetch: f });
		await w.reset("seeded");
		assert.deepEqual(await w.mintCaller(), { identity: "c1", token: "ctok" });
		assert.ok(calls.includes("POST http://pool.test:3000/v1/identity"));
	});

	it("fails fast on a non-retryable lease error", async () => {
		const { f } = fakeFetch(() => ({ status: 400, body: { error: "baseline" } }));
		const w = createPooledWorldSource({ poolUrl: "http://p", fetch: f });
		await assert.rejects(w.reset("seeded"), /lease failed: HTTP 400/);
	});
});
