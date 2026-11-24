/**
 * Live-world fixture for the persona-world-exploration Gherkin steps
 * (`behaviour/live-steps.ts`). Caller-facing CLI queries and retained SDK
 * exploration ports use the same authored world and caller identities.
 *
 * The world comes from one of:
 * - the stdb pool (SPELLKAVE_EXPLORATION_POOL=seeded|wiped): a leased world,
 *   released by `close()` (`@spellkave/behaviour/world`, D-6 WorldSource);
 * - env: SPELLKAVE_URL + SPELLKAVE_DB, with the owner token from
 *   SPELLKAVE_EXPLORATION_OWNER_TOKEN or else the local publisher credential.
 * With POOL=wiped, SPELLKAVE_EXPLORATION_WASM may name this branch's built module:
 * the pool uploads it to a fresh database via its lease-module route (proved by
 * spellkave-behaviour/src/world-pooled.test.ts), without changing a stored baseline.
 * Existing databases are never deleted or clear-published. Tokens are never logged.
 */
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import type { Run } from "@spellkave/behaviour/cli";
import { createPooledWorldSource, type PooledWorldSource } from "@spellkave/behaviour/world";
import { connect, defaultReaderManifest, type SpellkaveSession } from "@spellkave/sdk";
import { resolveSpacetimeConfigPathToken } from "@spellkave/sdk/node";
import { createLiveExplorationPort } from "@spellkave/session/authoring";
import {
	applyManifestDelta,
	applyManifestSource,
	connectTestWorld,
	privilegedActsFixture,
	readFixtureSource,
	type TestWorld,
} from "@spellkave/test-lab";
import { explore as exploreWithPort } from "@spellkave/tool-authoring";
import { decode } from "@toon-format/toon";

export const explorationLive = () => process.env.SPELLKAVE_EXPLORATION_LIVE === "1";
const repository = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));
const executeFile = promisify(execFile);

export type Explored = {
	code: number;
	stdout: string;
	/** Original CLI process receipt, absent on direct in-process port answers. */
	run?: Run;
	// biome-ignore lint/suspicious/noExplicitAny: the envelope is asserted field by field by callers
	details: any;
};

/**
 * A long-lived caller connection with its live exploration port, like a hosted
 * MCP session: unlike one `sk` call, epochs and the session outlive one answer.
 */
export interface LivePortCaller {
	explore(request: Record<string, unknown>): Promise<Explored>;
	/** The reader's declared coverage of every family, complete ones included. */
	coverage(): Promise<{ family: string; state: string; reason?: string }[]>;
	/** Close the caller's own connection while the port stays in use. */
	disconnect(): void;
	close(): void;
}

export interface LiveExplorationWorld {
	/** Unique bundle id of this run's authored world. */
	readonly b: string;
	readonly url: string;
	readonly db: string;
	readonly owner: TestWorld;
	readonly dm: TestWorld;
	readonly other: TestWorld;
	/** The shared two-region fixture: forest admitted to the DM role, village hidden. */
	world(): string;
	/** A hidden place in the region the DM role does not cover. */
	crypt(): string;
	/** The same bundle without the DM's role binding: a full-bundle apply retracts it. */
	revoked(source: string): string;
	/** Publisher full-bundle apply of `source`. */
	apply(source: string): Promise<void>;
	/** One `sk query --explore` call as `caller`. */
	explore(caller: TestWorld, request: Record<string, unknown>): Promise<Explored>;
	/** One `sk <argv>` call as `caller`; `details` is the last record when it is an exploration answer. */
	run(caller: TestWorld, argv: string[]): Promise<Explored>;
	/** Owner-side ground truth over the SQL endpoint. */
	ownerSql(query: string): Promise<unknown[][]>;
	/** Authored keys of this bundle that the server materialised as entity rows. */
	materialised(): Promise<string[]>;
	/** The server's own per-kind coverage codes as the DM's connection sees them. */
	dmCoverage(): Promise<string[]>;
	/** The same codes as `caller`'s connection sees them. */
	coverageOf(caller: TestWorld): Promise<string[]>;
	/** Open a long-lived exploration port for `caller` (same token, own connection). */
	openPort(caller: TestWorld): Promise<LivePortCaller>;
	close(): Promise<void>;
}

export async function openLiveExplorationWorld(): Promise<LiveExplorationWorld> {
	const b = `pwe${Date.now().toString(36)}`;
	let url = process.env.SPELLKAVE_URL ?? "";
	let db = process.env.SPELLKAVE_DB ?? "";
	let ownerToken = process.env.SPELLKAVE_EXPLORATION_OWNER_TOKEN ?? "";
	let pool: PooledWorldSource | undefined;
	const worlds: TestWorld[] = [];
	const cwd = mkdtempSync(join(tmpdir(), "sk-explore-live-"));
	const baseline = process.env.SPELLKAVE_EXPLORATION_POOL;
	const wasm = process.env.SPELLKAVE_EXPLORATION_WASM;
	if (wasm && baseline !== "wiped")
		throw new Error("SPELLKAVE_EXPLORATION_WASM requires SPELLKAVE_EXPLORATION_POOL=wiped");
	if (baseline === "seeded" || baseline === "wiped") {
		pool = createPooledWorldSource({
			holder: `persona-world-exploration:${b}`,
			...(wasm ? { wipedModule: readFileSync(wasm) } : {}),
		});
		await pool.reset(baseline);
		({ url, db, token: ownerToken } = pool);
	}
	ownerToken ||= resolveSpacetimeConfigPathToken() ?? "";
	if (!url || !db || !ownerToken) throw new Error("live exploration needs URL, DB and owner token");

	async function sqlAs(token: string, query: string): Promise<unknown[][]> {
		const res = await fetch(`${url}/v1/database/${db}/sql`, {
			method: "POST",
			headers: { Authorization: `Bearer ${token}` },
			body: query,
		});
		if (!res.ok) throw new Error(`sql: HTTP ${res.status}`);
		return ((await res.json()) as { rows: unknown[][] }[])[0]?.rows ?? [];
	}
	const ownerSql = (query: string) => sqlAs(ownerToken, query);

	const owner = await connectTestWorld({ url, db, token: ownerToken }).catch(async (error) => {
		await pool?.release();
		throw error;
	});
	worlds.push(owner);
	// A fresh per-runner database has no bundles yet; a pooled seeded world has core.
	if ((await ownerSql("SELECT bundle_id FROM mod_bundle WHERE bundle_id = 'core'")).length === 0)
		await applyManifestSource(
			owner,
			readFixtureSource("packages/spellkave-mechanics/fixtures/core"),
			{ tolerateAlreadyApplied: true },
		);
	// Same publisher-bound gatekeeper `ensureWorldAuthority` applies, but with the
	// leased owner token instead of a worktree-local publisher credential.
	if (!owner.identity) throw new Error("owner identity unavailable");
	await applyManifestDelta(
		owner,
		readFixtureSource(
			"packages/spellkave-mechanics/fixtures/test_lab_live_on_demand_gatekeeper/manifest.toml",
		).replaceAll("$sender", owner.identity),
		{ tolerateAlreadyApplied: true },
	);
	const dm = await connectTestWorld({ url, db, token: null });
	const other = await connectTestWorld({ url, db, token: null });
	worlds.push(dm, other);
	if (!dm.identity || !other.identity) throw new Error("fresh callers need identities");
	const dmIdentity = dm.identity;
	const otherIdentity = other.identity;

	/**
	 * The two-region fixture minus its one `core/inspect` grant: exploration needs
	 * no gameplay capability, and the srd-cc seed does not define that capability.
	 */
	const world = () =>
		privilegedActsFixture(b, dmIdentity, otherIdentity).replace(
			`[[actor_capabilities]]\nbundle_id="${b}"\nactor_entity_key="${b}/hero"\ncapability_id="core/inspect"\nsource="manifest"\n`,
			"",
		);
	const live: LiveExplorationWorld = {
		b,
		url,
		db,
		owner,
		dm,
		other,
		world,
		crypt: () =>
			`[[place_nodes]]\nbundle_id="${b}"\nnode_id="${b}/village/crypt"\nlocal_id="crypt"\nplace_graph_id="${b}/village"\nsubstrate_id="outdoor"\ndisplay_name="${b} crypt"\ndescription="secret ${b} crypt"\n`,
		revoked: (source) =>
			source.replace(/\[\[role_bindings\]\]\nbundle_id="[^"]*"\nbinding_id="[^"]*\/dm"\n[^[]*/, ""),
		async apply(source) {
			await applyManifestSource(owner, source);
		},
		async run(caller, argv) {
			let stdout: string;
			let stderr: string;
			let code: number;
			try {
				({ stdout, stderr } = await executeFile(resolve(repository, "bin/sk"), argv, {
					cwd,
					env: {
						...process.env,
						SPELLKAVE_URL: url,
						SPELLKAVE_DB: db,
						SPELLKAVE_CONNECT_TOKEN: caller.token ?? "",
						SPELLKAVE_LIVE_DELTA_JOURNAL: "0",
					},
				}));
				code = 0;
			} catch (error) {
				const failed = error as { code: number; stdout: string; stderr: string };
				if (typeof failed.code !== "number") throw error;
				({ stdout, stderr, code } = failed);
			}
			const run: Run = { argv: [...argv], stdout, stderr, exit: code };
			// `sk explore` answers in TOON unless a format is asked for: decode it, and read its
			// `next`/`help`/`recovery` one-column tables as command lines.
			if (!stdout.trimStart().startsWith("{")) {
				const toon = decode(stdout) as Record<string, unknown>;
				for (const key of ["next", "help", "recovery"])
					if (Array.isArray(toon[key]))
						toon[key] = (toon[key] as { command: string }[]).map((row) => row.command);
				return { code, stdout: stdout.trim(), details: toon, run };
			}
			const line = stdout.trim().split("\n").at(-1) ?? "null";
			const record = JSON.parse(line);
			return { code, stdout: line, details: record?.details ?? record, run };
		},
		explore(caller, request) {
			return live.run(caller, [
				"--live",
				"--format",
				"jsonl",
				"query",
				"--json",
				JSON.stringify({ explore: request }),
			]);
		},
		ownerSql,
		async materialised() {
			const rows = await ownerSql(
				`SELECT manifest_key, entity_id FROM operator_manifest_authored_entity WHERE bundle_id = '${b}'`,
			);
			return rows.filter((row) => Number(row[1]) !== 0).map((row) => String(row[0]));
		},
		async coverageOf(caller) {
			return (await sqlAs(caller.token ?? "", "SELECT kind, status FROM authoring_coverage"))
				.map((row) => JSON.stringify(row))
				.sort();
		},
		async dmCoverage() {
			return (await sqlAs(dm.token ?? "", "SELECT kind, status FROM authoring_coverage"))
				.map((row) => JSON.stringify(row))
				.sort();
		},
		async openPort(caller) {
			const session: SpellkaveSession = await connect(
				{
					url,
					db,
					token: caller.token,
					connectedActorId: "sk-live-author",
					readerManifests: [defaultReaderManifest()],
				},
				{ onError: () => {}, onDisconnect: () => {}, onUpdate: () => {} },
			);
			await session.ready;
			const port = createLiveExplorationPort({ session, world: { url, db } });
			return {
				async explore(request) {
					// biome-ignore lint/suspicious/noExplicitAny: same loose request shape the CLI accepts
					const details = (await exploreWithPort(port, request as any)) as any;
					return { code: 0, stdout: JSON.stringify(details), details };
				},
				async coverage() {
					return (await port.snapshot("live")).source.coverage;
				},
				disconnect: () => session.disconnect(),
				close() {
					port.close();
					session.disconnect();
				},
			};
		},
		async close() {
			for (const w of worlds) w.disconnect?.();
			await pool?.release();
		},
	};
	await live.apply(world());
	return live;
}
