/**
 * Pooled world source: each `reset` leases a fresh database from the shared
 * SpacetimeDB test host (stdb pool, sk-jay0.7.209) instead of restoring a
 * local node, so scenarios get their own `db` and can run in parallel.
 *
 * `reset` never clears or deletes. SpacetimeDB 2.10.x exits the whole shared
 * host when a database is deleted or clear-published while a client still
 * calls it, so the pool server refuses DELETE, clear and publish for tenants,
 * and a used database is only abandoned (released, never touched again). The
 * host is recycled from a golden data dir when it runs out of headroom.
 *
 * `await reset(baseline)` returns only when the leased database answers SQL
 * with the lease token: the pool touches it before answering, and this client
 * polls `{url}/v1/database/{db}/sql` within `readyTimeoutMs`. When the pool has
 * no free database (exhausted or recycling, HTTP 503 with Retry-After), reset
 * retries within `leaseTimeoutMs`, then throws `PoolExhaustedError`.
 *
 * `wipedModule` (bytes, or an async function returning them) makes
 * `reset("wiped")` upload that wasm to `POST /pool/lease-module` instead of
 * leasing from the pool's stored module: a branch that changes `server/` gets
 * a fresh database running its own build. The pool only ever creates a new
 * database for it; the upload is size-capped (413) and a module spacetime
 * rejects fails the reset (422) without leaving a lease.
 *
 * Extras outside `WorldSource`: `release()` ends the current lease at the end
 * of a run; `mintCaller()` mints a second, non-owner identity on the same host
 * (`POST {url}/v1/identity`) for role-scoped callers.
 *
 * Dependency-free on purpose: only `fetch`, which tests inject.
 */
import type { WorldBaseline, WorldSource } from "./world.ts";

export type { WorldBaseline, WorldSource } from "./world.ts";

export interface PooledWorldSourceOptions {
	/** Pool front door; defaults to `SPELLKAVE_STDB_POOL_URL`. */
	poolUrl?: string;
	/** Baseline of the first lease when a property is read before any reset. */
	baseline?: WorldBaseline;
	/** Lease lifetime the pool grants (seconds); the pool clamps it to 60 s..4 h. */
	ttlS?: number;
	/** Shown in the pool status, e.g. the suite or worktree name. */
	holder?: string;
	/** Wasm for `reset("wiped")`: uploaded to `/pool/lease-module` (own module, fresh database). */
	wipedModule?: Uint8Array | (() => Promise<Uint8Array>);
	readyTimeoutMs?: number;
	leaseTimeoutMs?: number;
	fetch?: typeof fetch;
}

export interface PooledWorldSource extends WorldSource {
	release(): Promise<void>;
	mintCaller(): Promise<{ identity: string; token: string }>;
}

export interface Lease {
	leaseId: string;
	url: string;
	db: string;
	token: string;
	identity: string | null;
	baseline: WorldBaseline;
	gen: number;
	expiresAt: string;
}

export class PoolExhaustedError extends Error {
	readonly baseline: WorldBaseline;
	readonly waitedMs: number;
	readonly lastMessage: string;
	constructor(baseline: WorldBaseline, waitedMs: number, lastMessage: string) {
		super(`stdb pool had no ${baseline} database for ${waitedMs} ms: ${lastMessage}`);
		this.name = "PoolExhaustedError";
		this.baseline = baseline;
		this.waitedMs = waitedMs;
		this.lastMessage = lastMessage;
	}
}

export class PoolNotReadyError extends Error {
	readonly db: string;
	readonly lastStatus: number | string;
	readonly waitedMs: number;
	constructor(db: string, lastStatus: number | string, waitedMs: number) {
		super(`leased database ${db} did not answer SQL within ${waitedMs} ms (last: ${lastStatus})`);
		this.name = "PoolNotReadyError";
		this.db = db;
		this.lastStatus = lastStatus;
		this.waitedMs = waitedMs;
	}
}

// ci-allow(raw-sql): one-shot readiness read over the SQL endpoint after a lease, never a subscription
const READY_SQL = "SELECT * FROM world_time";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function createPooledWorldSource(options: PooledWorldSourceOptions = {}): PooledWorldSource {
	const configuredUrl = options.poolUrl ?? process.env.SPELLKAVE_STDB_POOL_URL;
	if (!configuredUrl?.trim()) {
		throw new Error("Set a pool URL or SPELLKAVE_STDB_POOL_URL before leasing a test world");
	}
	const poolUrl = configuredUrl.trim().replace(/\/$/, "");
	const doFetch = options.fetch ?? fetch;
	const readyTimeoutMs = options.readyTimeoutMs ?? 30_000;
	const leaseTimeoutMs = options.leaseTimeoutMs ?? 120_000;
	let current: Lease | null = null;

	const need = (): Lease => {
		if (current === null) {
			throw new Error(
				`no leased world yet: await reset("${options.baseline ?? "seeded"}") before reading url/db/token`,
			);
		}
		return current;
	};

	// The module is produced once per source: a function may build or read a
	// 12 MB wasm, and every reset("wiped") uploads the same bytes.
	let moduleBytes: Uint8Array | undefined;
	async function wipedModuleBytes(): Promise<Uint8Array | undefined> {
		const m = options.wipedModule;
		if (m === undefined || typeof m !== "function") return m;
		moduleBytes ??= await m();
		return moduleBytes;
	}

	function moduleQuery(): string {
		const q = new URLSearchParams();
		if (options.ttlS !== undefined) q.set("ttlS", String(options.ttlS));
		if (options.holder !== undefined) q.set("holder", options.holder);
		const text = q.toString();
		return text ? `?${text}` : "";
	}

	async function lease(baseline: WorldBaseline): Promise<Lease> {
		const started = Date.now();
		let last = "";
		const module = baseline === "wiped" ? await wipedModuleBytes() : undefined;
		for (;;) {
			const res = module
				? await doFetch(`${poolUrl}/pool/lease-module${moduleQuery()}`, {
						method: "POST",
						headers: { "Content-Type": "application/wasm" },
						// Type-only cast: the package has no DOM lib for BodyInit.
						// fetch sends exactly the view's bytes (offset and length),
						// also when the Uint8Array views a larger buffer.
						body: module as unknown as ArrayBuffer,
					})
				: await doFetch(`${poolUrl}/pool/lease`, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ baseline, ttlS: options.ttlS, holder: options.holder }),
					});
			const text = await res.text();
			if (res.ok) return JSON.parse(text) as Lease;
			last = `HTTP ${res.status} ${text.trim()}`;
			const waited = Date.now() - started;
			if (res.status !== 503 && res.status !== 409)
				throw new Error(`stdb pool lease failed: ${last}`);
			const retryS = Number(res.headers.get("Retry-After") ?? "5");
			if (waited + retryS * 1000 > leaseTimeoutMs)
				throw new PoolExhaustedError(baseline, waited, last);
			await sleep(retryS * 1000);
		}
	}

	async function waitReady(l: Lease): Promise<void> {
		const started = Date.now();
		let last: number | string = "no attempt";
		for (;;) {
			try {
				const res = await doFetch(`${l.url}/v1/database/${l.db}/sql`, {
					method: "POST",
					headers: { Authorization: `Bearer ${l.token}` },
					body: READY_SQL,
				});
				await res.text();
				if (res.ok) return;
				last = res.status;
			} catch (e) {
				last = e instanceof Error ? e.message : String(e);
			}
			const waited = Date.now() - started;
			if (waited >= readyTimeoutMs) throw new PoolNotReadyError(l.db, last, waited);
			await sleep(250);
		}
	}

	async function release(): Promise<void> {
		if (current === null) return;
		const leaseId = current.leaseId;
		current = null;
		const res = await doFetch(`${poolUrl}/pool/release`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ leaseId }),
		});
		await res.text();
		// 404: the lease already expired; the database is abandoned either way.
		if (!res.ok && res.status !== 404)
			throw new Error(`stdb pool release failed: HTTP ${res.status}`);
	}

	return {
		get url() {
			return need().url;
		},
		get db() {
			return need().db;
		},
		get token() {
			return need().token;
		},
		async reset(baseline: WorldBaseline): Promise<void> {
			await release();
			const next = await lease(baseline);
			await waitReady(next);
			current = next;
		},
		release,
		async mintCaller() {
			const res = await doFetch(`${need().url}/v1/identity`, { method: "POST" });
			const text = await res.text();
			if (!res.ok) throw new Error(`minting a caller identity failed: HTTP ${res.status} ${text}`);
			const body = JSON.parse(text) as { identity: string; token: string };
			return { identity: body.identity, token: body.token };
		},
	};
}
