// `sk seed` loads compiled world manifests into a running world. These tests
// run it against a fake connection: the command surface through `runCli` with
// a fake seed target, and the apply seam (`seedTargetFromSession`) with a fake
// session whose cache gains the seal or outcome row the server would write.
// No node, no network.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ManifestApplyResult } from "@spellkave/sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXIT_IN_WORLD, EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import {
	type ConnectSeed,
	flattenSeedRoot,
	parseSeedArgs,
	type SeedSession,
	seedTargetFromSession,
} from "../seed.ts";
import { collect } from "./helpers.ts";

const CATALOG_DIR = fileURLToPath(new URL("./fixtures/catalog", import.meta.url));
const MAPPED = fileURLToPath(new URL("./fixtures/mapped/manifest.toml", import.meta.url));

interface FakeWorld {
	connectSeed: ConnectSeed;
	/** Each connection request, as the command resolved it. */
	connections: Array<{ url: string; db: string; token?: string }>;
	/** Each manifest text sent, in order. */
	applied: string[];
	labels: string[];
	tolerate: boolean[];
	closed: number;
}

function fakeWorld(verdicts: ManifestApplyResult[] = []): FakeWorld {
	const world: FakeWorld = {
		connections: [],
		applied: [],
		labels: [],
		tolerate: [],
		closed: 0,
		connectSeed: async (resolved) => {
			world.connections.push(resolved);
			return {
				applyWorldManifest: async (toml, options) => {
					world.applied.push(toml);
					world.labels.push(options.label);
					world.tolerate.push(options.tolerateAlreadyApplied);
					return verdicts.shift() ?? { ok: true, digest: `digest-${world.applied.length}` };
				},
				close: () => {
					world.closed += 1;
				},
			};
		},
	};
	return world;
}

async function sk(world: FakeWorld | undefined, argv: string[]) {
	const io = collect();
	const refuseConnect: ConnectSeed = async () => {
		throw new Error("this test must not connect");
	};
	const code = await runCli(["--format", "jsonl", ...argv], io.io, undefined, undefined, {
		connectSeed: world?.connectSeed ?? refuseConnect,
	});
	const records = io.out.map((line) => JSON.parse(line) as Record<string, unknown>);
	return { code, records, result: records.at(-1) as Record<string, unknown>, err: io.err };
}

describe("sk seed", () => {
	const saved = { ...process.env };
	let dir: string;

	beforeEach(() => {
		process.env.SPELLKAVE_HOME = mkdtempSync(join(tmpdir(), "sk-seed-home-"));
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		process.env.SPELLKAVE_DB = "spellkave-test";
		process.env.SPELLKAVE_CONNECT_TOKEN = "test-token";
		dir = mkdtempSync(join(tmpdir(), "sk-seed-"));
	});

	afterEach(() => {
		for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
		rmSync(dir, { recursive: true, force: true });
	});

	it("sends each root with its includes as one manifest, in the order given", async () => {
		const world = fakeWorld();
		const { code, records, result } = await sk(world, ["seed", CATALOG_DIR, MAPPED]);

		expect(code).toBe(EXIT_OK);
		expect(world.connections).toEqual([
			{ url: "http://127.0.0.1:4001", db: "spellkave-test", token: "test-token" },
		]);
		expect(world.applied).toHaveLength(2);
		// The directory root resolves to its manifest.toml; the include's rows follow the root.
		const catalog = world.applied[0] as string;
		expect(catalog.startsWith("#:schema")).toBe(true);
		expect(catalog.indexOf('bundle_id = "demo"')).toBeLessThan(
			catalog.indexOf('entity_def_id = "demo/torch"'),
		);
		expect(world.applied[1]).toContain('place_graph_id = "mapped/hub"');
		expect(world.labels).toEqual([`sk seed ${CATALOG_DIR}`, `sk seed ${MAPPED}`]);
		expect(world.tolerate).toEqual([false, false]);
		expect(world.closed).toBe(1);

		expect(records).toHaveLength(3);
		expect(records[0]).toMatchObject({
			kind: "seed_root",
			root: CATALOG_DIR,
			includes: 1,
			status: "applied",
			digest: "digest-1",
			bytes: Buffer.byteLength(catalog, "utf8"),
		});
		expect(records[1]).toMatchObject({ kind: "seed_root", root: MAPPED, includes: 0 });
		expect(result).toEqual({
			kind: "seed_result",
			ok: true,
			db: "spellkave-test",
			roots: 2,
			applied: 2,
			already_applied: 0,
		});
	});

	it("never prints the connection token", async () => {
		const { records, err } = await sk(fakeWorld(), ["seed", CATALOG_DIR]);
		expect(JSON.stringify(records) + err.join("\n")).not.toContain("test-token");
	});

	it("stops at the first refused root, reports the server code and exits 2", async () => {
		const world = fakeWorld([
			{
				ok: false,
				detail: "MF-APPLY-044: sender may not apply a world manifest",
				outcome: {
					applyId: "7",
					digest: "",
					code: "MF-APPLY-044",
					message: "sender may not apply a world manifest",
				},
			},
		]);
		const { code, records, result } = await sk(world, ["seed", CATALOG_DIR, MAPPED]);

		expect(code).toBe(EXIT_IN_WORLD);
		expect(world.applied).toHaveLength(1);
		expect(world.closed).toBe(1);
		expect(records[0]).toMatchObject({
			kind: "seed_root",
			root: CATALOG_DIR,
			status: "failed",
			code: "MF-APPLY-044",
			detail: "MF-APPLY-044: sender may not apply a world manifest",
		});
		expect(result).toMatchObject({ kind: "seed_result", ok: false, roots: 2, applied: 0 });
	});

	it("counts an already sealed root as success only with --tolerate-applied", async () => {
		const world = fakeWorld([{ ok: true, alreadyApplied: true }]);
		const { code, records, result } = await sk(world, [
			"seed",
			CATALOG_DIR,
			MAPPED,
			"--tolerate-applied",
		]);

		expect(code).toBe(EXIT_OK);
		expect(world.tolerate).toEqual([true, true]);
		expect(records[0]).toMatchObject({ root: CATALOG_DIR, status: "already_applied" });
		expect(records[1]).toMatchObject({ root: MAPPED, status: "applied" });
		expect(result).toMatchObject({ ok: true, applied: 1, already_applied: 1 });
	});

	it("--dry-run reads and hashes every root and connects to nothing", async () => {
		const { code, records, result } = await sk(undefined, ["seed", CATALOG_DIR, "--dry-run"]);

		expect(code).toBe(EXIT_OK);
		expect(records[0]).toMatchObject({ kind: "seed_root", root: CATALOG_DIR, status: "planned" });
		expect(records[0]?.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(result).toEqual({ kind: "seed_result", ok: true, dry_run: true, roots: 1 });
	});

	it("reads every root before connecting: a missing include applies nothing", async () => {
		mkdirSync(join(dir, "broken"));
		writeFileSync(
			join(dir, "broken", "manifest.toml"),
			'#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json\nschema_version = "1.0.0"\n\n' +
				'[[bundles]]\nbundle_id = "broken"\ndisplay_name = "Broken"\nauthor = "Spellkave"\nversion = "1.0.0"\n\n' +
				'[[include]]\npath = "absent.toml"\n',
		);
		const world = fakeWorld();
		const { code, result } = await sk(world, ["seed", CATALOG_DIR, join(dir, "broken")]);

		expect(code).toBe(EXIT_USAGE);
		expect(world.connections).toHaveLength(0);
		expect(result).toMatchObject({ kind: "error", scope: "usage" });
		expect(String(result.message)).toContain("absent.toml");
	});

	it("rejects a missing root, no roots and an unknown flag as usage errors", async () => {
		for (const argv of [
			["seed", join(dir, "nowhere")],
			["seed"],
			["seed", CATALOG_DIR, "--force"],
		]) {
			const world = fakeWorld();
			const { code, result } = await sk(world, argv);
			expect(code, argv.join(" ")).toBe(EXIT_USAGE);
			expect(result).toMatchObject({ kind: "error", scope: "usage" });
			expect(world.connections).toHaveLength(0);
		}
	});

	it("reports a failed connection as an infrastructure error", async () => {
		const io = collect();
		const code = await runCli(["--format", "jsonl", "seed", CATALOG_DIR], io.io, undefined, undefined, {
			connectSeed: async () => {
				throw new Error("connection refused");
			},
		});
		expect(code).toBe(EXIT_USAGE);
		expect(JSON.parse(io.out.at(-1) as string)).toMatchObject({
			kind: "error",
			scope: "infra",
			message: "connection refused",
		});
	});

	it("is listed and explained by sk help", async () => {
		const io = collect();
		expect(await runCli(["help", "seed"], io.io)).toBe(EXIT_OK);
		const text = io.out.join("\n");
		expect(text).toContain("sk seed <root>...");
		expect(text).toContain("--tolerate-applied");
		expect(text).toContain("--dry-run");
	});
});

describe("flattenSeedRoot", () => {
	it("accepts a directory or a manifest file and yields the same text", async () => {
		const fromDir = await flattenSeedRoot(CATALOG_DIR);
		const fromFile = await flattenSeedRoot(join(CATALOG_DIR, "manifest.toml"));
		expect(fromDir.toml).toBe(fromFile.toml);
		expect(fromDir.manifestPath).toBe(join(CATALOG_DIR, "manifest.toml"));
		expect(fromDir.includes).toEqual(["rows.toml"]);
		expect(fromDir.bytes).toBe(Buffer.byteLength(fromDir.toml, "utf8"));
	});
});

describe("parseSeedArgs", () => {
	it("keeps root order and reads both flags anywhere", () => {
		expect(parseSeedArgs(["--dry-run", "a", "b", "--tolerate-applied"])).toEqual({
			roots: ["a", "b"],
			dryRun: true,
			tolerateApplied: true,
		});
	});
});

// The seam itself: the one binding call and the verdict read from the cache.
describe("seedTargetFromSession", () => {
	type Row = Record<string, unknown>;

	function fakeSession(onApply: (toml: string, tables: { digests: Row[]; outcomes: Row[] }) => void) {
		const tables = { digests: [] as Row[], outcomes: [] as Row[] };
		const sent: string[] = [];
		let disconnected = 0;
		const session: SeedSession = {
			conn: {
				reducers: {
					rApplyWorldManifest: async ({ toml }) => {
						sent.push(toml);
						onApply(toml, tables);
					},
				},
				db: {
					manifest_apply_digest: { iter: () => tables.digests },
					manifest_apply_outcome: { iter: () => tables.outcomes },
				},
			},
			disconnect: () => {
				disconnected += 1;
			},
		};
		return { session, tables, sent, disconnected: () => disconnected };
	}

	const options = { label: "sk seed test", tolerateAlreadyApplied: false };

	it("calls the whole-manifest reducer once and returns the new seal", async () => {
		const fake = fakeSession((_toml, tables) => {
			tables.digests.push({ manifestDigest: "new-seal" });
		});
		fake.tables.digests.push({ manifestDigest: "older-seal" });

		const target = seedTargetFromSession(fake.session);
		expect(await target.applyWorldManifest("toml-text", options)).toEqual({
			ok: true,
			digest: "new-seal",
		});
		expect(fake.sent).toEqual(["toml-text"]);
		await target.close();
		expect(fake.disconnected()).toBe(1);
	});

	it("returns the server's failure outcome with its code", async () => {
		const fake = fakeSession((_toml, tables) => {
			tables.outcomes.push({ ok: false, applyId: "3", digest: "", code: "MF-REF-001", message: "unknown reference" });
		});
		const result = await seedTargetFromSession(fake.session).applyWorldManifest("x", options);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.outcome?.code).toBe("MF-REF-001");
			expect(result.detail).toContain("unknown reference");
		}
	});

	it("returns a rejected reducer call as a failure, not a throw", async () => {
		const fake = fakeSession(() => {
			throw new Error("websocket closed");
		});
		const result = await seedTargetFromSession(fake.session).applyWorldManifest("x", options);
		expect(result).toMatchObject({ ok: false, detail: "websocket closed" });
	});

	it("maps an already-applied refusal to success only when tolerated", async () => {
		const refuse = () => {
			throw new Error("MF-APPLY-012: manifest already applied");
		};
		const strict = await seedTargetFromSession(fakeSession(refuse).session).applyWorldManifest(
			"x",
			options,
		);
		expect(strict.ok).toBe(false);
		const tolerant = await seedTargetFromSession(fakeSession(refuse).session).applyWorldManifest("x", {
			...options,
			tolerateAlreadyApplied: true,
		});
		expect(tolerant).toEqual({ ok: true, alreadyApplied: true });
	});
});
