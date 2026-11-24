// A world author keeps a world in step with a manifest file: `sk diff -k`
// shows what the world would change, `sk apply -k` sends it. These tests
// check exit codes, what gets sent, and refusals, against a fake world that
// behaves like the server's applyset memory; no node. Most cases are also
// scenarios in behaviour/applyset/ on real leased worlds; each marker says
// which, and those cases go once CI runs that suite. Decided in ADR-0145.
import * as childProcess from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApplyBundleCall, AuthorTarget, ManifestExportRow } from "@spellkave/tool-authoring";
import type { ApplysetExtentScope, ApplysetMemory } from "@spellkave/world-author/tooling";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { finishApplysetVerb, unifiedDiff } from "../applyset-verbs.ts";
import { type ConnectLive, EXIT_IN_WORLD, EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import { createRecordIo } from "../output.ts";
import { collect } from "./helpers.ts";

// A mutable module facade lets this unit inspect the process boundary without spawning.
vi.mock("node:child_process", async (importOriginal) => ({
	...(await importOriginal<typeof import("node:child_process")>()),
}));

const HEADER = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
`;
const BUNDLE =
	'[[bundles]]\nbundle_id = "demo"\ndisplay_name = "Demo"\nversion = "1.0.0"\nauthor = "t"\ndescription = "d"\n';

function def(id: string, desc: string): string {
	return `[[entity_definitions]]\nbundle_id = "demo"\nentity_def_id = "${id}"\ndisplay_name = "X"\ndescription = "${desc}"\n`;
}

function entity(key: string): string {
	return `[[entities]]\nentity_key = "${key}"\nbundle_id = "demo"\nname = "${key}"\nkind = "item"\nplace_node_id = ""\n`;
}

function containment(container: string, item: string): string {
	return `[[entity_containment]]\ncontainer_entity_key = "${container}"\nentity_key = "${item}"\n`;
}

function tag(id: string, value: string): string {
	return `[[entity_definition_tag]]\nentity_def_id = "${id}"\ntag = "${value}"\nbundle_id = "demo"\nsource = "manifest"\n`;
}

function root(rows: string, includes: string[]): string {
	const directives = includes.map((path) => `\n[[include]]\npath = "${path}"\n`).join("");
	return HEADER.concat('applyset = "demo"\n', BUNDLE, rows, directives);
}

const DIFFERENCES = 3;

/** The server's applyset memory and checks, in memory. */
function fakeWorld(
	options: {
		exportRows?: Record<string, unknown[]>;
		extentScope?: ApplysetExtentScope;
		readsAsPublisher?: boolean;
		connectedIdentity?: string;
		worldAdded?: {
			entityId: string;
			entityDefId: string;
			rows: Array<{ table: string; key: string }>;
		};
		cannotLook?: boolean;
	} = {},
) {
	let memory: ApplysetMemory | null = null;
	const calls: ApplyBundleCall[] = [];
	const target: AuthorTarget = {
		kind: "live",
		resolveRef: () => false,
		lookup: () => [],
		applyBatch: async () => ({ ok: true }),
	};
	const exportManifest = async (bundleId: string): Promise<ManifestExportRow> => {
		const rows =
			options.exportRows ??
			(options.worldAdded === undefined
				? undefined
				: {
						entities: [
							{
								entity_key: "demo/torch",
								bundle_id: "demo",
								entity_def_id: "",
								name: "demo/torch",
								kind: "item",
								place_node_id: "",
								quantity: 1,
								owned_by_entity_key: "",
							},
						],
					});
		if (rows === undefined) throw new Error("MF-EXPORT-011: over the bound");
		return {
			bundleId,
			status: "complete",
			rowCount: 1,
			diagnostics: "",
			manifestJson: JSON.stringify({ schema_version: "1.0.0", ...rows }),
		};
	};
	const connectLive: ConnectLive = async () => ({
		target,
		exportManifest,
		applyset: {
			readApplyset: async () => memory,
			readExtentScope: async () => options.extentScope,
			...(options.cannotLook === true
				? {
						worldRows: () => "not_subscribed" as const,
						readsAsPublisher: () => false,
					}
				: options.worldAdded !== undefined
					? {
							worldRows: (entityId: string) =>
								entityId === "10" && options.worldAdded !== undefined
									? options.worldAdded
									: { entityId, entityDefId: "", rows: [] },
							authoredEntityId: () => "10",
							readsAsPublisher: () => true,
							livePlaces: () => [
								{ kind: "entities" as const, key: "demo/torch", place_node_id: "" },
							],
						}
					: {}),
			applyBundle: async (call) => {
				calls.push(call);
				const current = memory?.generation ?? 0;
				if (call.expectedGeneration !== current) {
					return {
						ok: false,
						detail: `{"code":"MF-APPLY-030","message":"stale applyset generation","details":{"expected_generation":${call.expectedGeneration},"current_generation":${current}}}`,
					};
				}
				if (memory !== null && memory.root_path !== call.rootPath && !call.force) {
					return {
						ok: false,
						detail: `{"code":"MF-APPLY-031","message":"applyset name belongs to another root path; pass force to take it over"}`,
					};
				}
				const parts = new Map((memory?.parts ?? []).map((p) => [p.path, p.entries]));
				for (const part of JSON.parse(call.partsJson) as ApplysetMemory["parts"]) {
					if (part.entries.length === 0) parts.delete(part.path);
					else parts.set(part.path, part.entries);
				}
				memory = {
					root_path: call.rootPath,
					generation: current + 1,
					base_state: "known",
					parts: [...parts].map(([path, entries]) => ({ path, entries })),
				};
				return { ok: true };
			},
			rootPathFor: (file) => `fx/${file.slice(file.lastIndexOf("/") + 1)}`,
		},
		readsAsPublisher: options.readsAsPublisher ?? true,
		connectedIdentity: options.connectedIdentity ?? "publisher",
		close: () => {},
	});
	return {
		connectLive,
		calls,
		memory: () => memory,
		setMemory: (value: ApplysetMemory | null) => {
			memory = value;
		},
	};
}

type Records = Array<Record<string, unknown>>;

async function sk(world: ReturnType<typeof fakeWorld>, argv: string[]) {
	const io = collect();
	const code = await runCli(["--format", "jsonl", ...argv], io.io, world.connectLive);
	const records = io.out.map((line) => JSON.parse(line) as Record<string, unknown>) as Records;
	return { code, records, result: records.at(-1) as Record<string, unknown>, err: io.err };
}

describe("sk diff -k / sk apply -k", () => {
	const saved = { ...process.env };
	let dir: string;

	beforeEach(() => {
		process.env.SPELLKAVE_HOME = mkdtempSync(join(tmpdir(), "sk-applyset-home-"));
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		process.env.SPELLKAVE_DB = "spellkave-test";
		delete process.env.SK_EXTERNAL_DIFF;
		dir = mkdtempSync(join(tmpdir(), "sk-applyset-"));
		writeFileSync(join(dir, "manifest.toml"), root(def("demo/a", "a"), ["b.toml", "c.toml"]));
		writeFileSync(join(dir, "b.toml"), def("demo/b", "b"));
		writeFileSync(join(dir, "c.toml"), def("demo/c", "c"));
	});

	afterEach(() => {
		vi.restoreAllMocks();
		for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
		Object.assign(process.env, saved);
		rmSync(dir, { recursive: true, force: true });
	});

	// open: no scenario yet for the drift heading, adopt count and not-checked reason (applyset-drift.live covers drift live)
	it("shows the drift decision heading, row diff, adopt count and explicit not-checked reason", async () => {
		const world = fakeWorld({
			exportRows: {
				entity_definitions: [
					{ entity_def_id: "demo/a", bundle_id: "demo", display_name: "X", description: "world" },
				],
			},
		});
		const io = collect();
		const code = await runCli(["--format", "human", "diff", "-k", dir], io.io, world.connectLive);
		expect(code).toBe(DIFFERENCES);
		expect(io.out.join("\n")).toContain("authored, changed in the world since the last apply:");
		expect(io.out.join("\n")).toContain('"description": "world"');
		expect(io.out.join("\n")).toContain('"description": "a"');
		const unread = await sk(fakeWorld(), ["diff", "-k", dir]);
		expect(unread.result.not_checked).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ reason: "MF-EXPORT-011: over the bound" }),
			]),
		);
		expect((await sk(world, ["diff", "-k", dir])).result.counts).toMatchObject({ adopt: 1 });
	});

	// open: no scenario yet for the publisher / non-publisher statement on a diff
	it("states publisher and non-publisher sessions without replacing the diff result", async () => {
		const publisher = await sk(fakeWorld({ readsAsPublisher: true, connectedIdentity: "aa11" }), [
			"diff",
			"-k",
			dir,
		]);
		expect(publisher.result.reads_as_publisher).toBe(true);
		expect(publisher.result.connected_identity).toBe("aa11");
		expect(publisher.result.note).toBeUndefined();
		expect(publisher.result.counts).toMatchObject({ create: 4 });

		const other = await sk(fakeWorld({ readsAsPublisher: false, connectedIdentity: "bb22" }), [
			"diff",
			"-k",
			dir,
		]);
		expect(other.result.reads_as_publisher).toBe(false);
		expect(other.result.connected_identity).toBe("bb22");
		expect(other.result.note).toBeUndefined();
		expect(other.result.counts).toMatchObject({ create: 4 });
	});

	// open: no scenario yet for a memory takeover whose placement the server decides
	it("prints memory takeover before sending, keeps placement on the server, and exits 2", async () => {
		const world = fakeWorld({
			extentScope: {
				publisher: false,
				bundle_extents: ["demo"],
				memory: [
					{
						bundle_ids: ["foreign"],
						entries: [
							{ kind: "entity_definitions", key: "demo/a", bundle_id: "demo", hash: "prior" },
						],
					},
				],
			},
		});
		const diff = await sk(world, ["diff", "-k", dir]);
		expect(diff.code).toBe(EXIT_IN_WORLD);
		expect(diff.result.refused_by_extent).toEqual([
			{ kind: "entity_definitions", key: "demo/a", code: "MF-APPLY-042", owners: ["foreign"] },
		]);
		expect(diff.result.placement_server_decides).toContainEqual({
			kind: "entity_definitions",
			key: "demo/a",
			bundle_id: "demo",
		});
		const applied = await sk(world, ["apply", "-k", dir]);
		expect(applied.code).toBe(EXIT_IN_WORLD);
		expect(applied.result.sent).toBe(false);
		expect(world.calls).toEqual([]);
	});

	// open: covered by keep-in-step.feature "Put my files into a world for the first time"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("diff exits 3 on differences, apply sends them, diff then exits 0", async () => {
		const world = fakeWorld();
		const first = await sk(world, ["diff", "-k", dir]);
		expect(first.code).toBe(DIFFERENCES);
		expect(first.result).toMatchObject({
			kind: "diff_result",
			rowKind: "applyset_diff",
			applyset: "demo",
			counts: { create: 4, configure: 0, move: 0, prune: 0, unchanged: 0 },
		});
		expect(world.calls).toHaveLength(0);

		const applied = await sk(world, ["apply", "-k", dir]);
		expect(applied.code).toBe(EXIT_OK);
		expect(applied.result).toMatchObject({ kind: "apply_result", ok: true, sent: true });
		expect(world.calls).toHaveLength(1);
		expect(world.calls[0]).toMatchObject({ applyset: "demo", rootPath: "fx/manifest.toml" });

		const second = await sk(world, ["diff", "-k", dir]);
		expect(second.code).toBe(EXIT_OK);
		expect(second.result).toMatchObject({ differences: false, generation: 1 });
	});

	// open: covered by keep-in-step.feature "Comments and order are not differences"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("treats comment-only changes as no difference and sends nothing", async () => {
		const world = fakeWorld();
		await sk(world, ["apply", "-k", dir]);
		writeFileSync(join(dir, "b.toml"), `# a note\n\n${def("demo/b", "b")}`);
		expect((await sk(world, ["diff", "-k", dir])).code).toBe(EXIT_OK);
		const idle = await sk(world, ["apply", "-k", dir]);
		expect(idle.code).toBe(EXIT_OK);
		expect(idle.result).toMatchObject({ sent: false });
		expect(world.calls).toHaveLength(1);
	});

	// open: covered by keep-in-step.feature "Change one description and send only that row"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("sends one changed row and reports it configured", async () => {
		const world = fakeWorld();
		await sk(world, ["apply", "-k", dir]);
		writeFileSync(join(dir, "b.toml"), def("demo/b", "a new description"));
		const diff = await sk(world, ["diff", "-k", dir]);
		expect(diff.code).toBe(DIFFERENCES);
		expect(diff.result.counts).toMatchObject({ configure: 1, unchanged: 3 });
		const applied = await sk(world, ["apply", "-k", dir]);
		expect(applied.result.results).toEqual([
			{ result: "configured", kind: "entity_definitions", key: "demo/b", part: "b.toml" },
		]);
		expect(world.calls[1]?.deltaToml).toContain("a new description");
		expect(world.calls[1]?.deltaToml).not.toContain("demo/c");
	});

	// open: covered by keep-in-step.feature "Move a definition to another file"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("a move-only change exits 3 and applies as an empty delta with both parts", async () => {
		const world = fakeWorld();
		await sk(world, ["apply", "-k", dir]);
		writeFileSync(join(dir, "b.toml"), "");
		writeFileSync(join(dir, "c.toml"), `${def("demo/c", "c")}${def("demo/b", "b")}`);
		const diff = await sk(world, ["diff", "-k", dir]);
		expect(diff.code).toBe(DIFFERENCES);
		expect(diff.result.counts).toMatchObject({ move: 1 });
		const applied = await sk(world, ["apply", "-k", dir]);
		expect(applied.code).toBe(EXIT_OK);
		expect(applied.result.results).toEqual([
			{
				result: "moved",
				kind: "entity_definitions",
				key: "demo/b",
				part: "c.toml",
				from_part: "b.toml",
			},
		]);
		const call = world.calls[1] as ApplyBundleCall;
		expect(call.deltaToml).not.toContain("entity_definitions");
		expect((JSON.parse(call.partsJson) as Array<{ path: string }>).map((p) => p.path)).toEqual([
			"b.toml",
			"c.toml",
		]);
		expect((await sk(world, ["diff", "-k", dir])).code).toBe(EXIT_OK);
	});

	// keep(K2): the server marks a base unknown only after a mid-apply abort, which the outside cannot provoke
	it("warns about an unknown base and refuses --prune on it", async () => {
		const world = fakeWorld();
		await sk(world, ["apply", "-k", dir]);
		world.setMemory({ ...(world.memory() as ApplysetMemory), base_state: "unknown" });
		const diff = await sk(world, ["diff", "-k", dir]);
		expect((diff.result.warnings as Array<{ code: string }>).map((w) => w.code)).toContain(
			"MF-APPLYSET-BASE-UNKNOWN",
		);
		const pruned = await sk(world, ["apply", "-k", dir, "--prune"]);
		expect(pruned.code).toBe(EXIT_IN_WORLD);
		expect(pruned.result).toMatchObject({ ok: false, sent: false });
		expect(world.calls).toHaveLength(1);
	});

	// open: covered by prune.feature "Delete a file's content, keep it in the world, then prune it"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("keeps prune candidates without --prune and retracts them with it", async () => {
		const world = fakeWorld();
		await sk(world, ["apply", "-k", dir]);
		writeFileSync(join(dir, "manifest.toml"), root(def("demo/a", "a"), ["b.toml"]));
		const kept = await sk(world, ["apply", "-k", dir]);
		expect(kept.code).toBe(EXIT_OK);
		expect(kept.result).toMatchObject({
			sent: false,
			prune_candidates: [{ kind: "entity_definitions", key: "demo/c", part: "c.toml" }],
		});
		const pruned = await sk(world, ["apply", "-k", dir, "--prune"]);
		expect(pruned.code).toBe(EXIT_OK);
		expect(pruned.result.results).toEqual([
			{ result: "pruned", kind: "entity_definitions", key: "demo/c", part: "c.toml" },
		]);
		expect(world.calls[1]?.deltaToml).toContain("[[retractions]]");
		expect((await sk(world, ["diff", "-k", dir])).code).toBe(EXIT_OK);
	});

	// open: covered by prune.feature "an item cannot leave its container while the item stays"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("refuses a containment prune without its entity, prints the diagnostic, and sends nothing", async () => {
		const world = fakeWorld();
		writeFileSync(
			join(dir, "manifest.toml"),
			root(`${entity("demo/chest")}${entity("demo/torch")}`, ["items.toml"]),
		);
		writeFileSync(join(dir, "items.toml"), containment("demo/chest", "demo/torch"));
		expect((await sk(world, ["apply", "-k", dir])).code).toBe(EXIT_OK);
		expect(world.calls).toHaveLength(1);
		writeFileSync(join(dir, "items.toml"), "");
		const refused = await sk(world, ["apply", "-k", dir, "--prune"]);
		expect(refused.code).toBe(EXIT_IN_WORLD);
		expect(refused.result).toMatchObject({ ok: false, sent: false });
		const diagnostics = refused.result.diagnostics as Array<{ code: string; message: string }>;
		expect(diagnostics.map((d) => d.code)).toContain("MF-APPLYSET-PRUNE-INSTANCE");
		expect(
			diagnostics.some((d) =>
				d.message.includes("can be removed only together with its entity `demo/torch`"),
			),
		).toBe(true);
		expect(world.calls).toHaveLength(1);
	});

	// open: covered by prune.feature "a tag of a definition cannot be retracted on its own"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("refuses a retraction the validator rejects, naming the row, and sends nothing", async () => {
		const world = fakeWorld();
		writeFileSync(join(dir, "c.toml"), `${def("demo/c", "c")}${tag("demo/c", "demo.lamp")}`);
		await sk(world, ["apply", "-k", dir]);
		writeFileSync(join(dir, "c.toml"), def("demo/c", "c"));
		const refused = await sk(world, ["apply", "-k", dir, "--prune"]);
		expect(refused.code).toBe(EXIT_IN_WORLD);
		const diagnostics = refused.result.diagnostics as Array<{ code: string; message: string }>;
		expect(diagnostics.map((d) => d.code)).toEqual(["MF-VAL-293"]);
		expect(diagnostics[0]?.message).toContain("entity_definition_tag");
		expect(world.calls).toHaveLength(1);
	});

	// keep(K2): the race needs another writer between this apply's read and its send, injected into the port
	it("loses a concurrent apply with MF-APPLY-030 naming both generations", async () => {
		const world = fakeWorld();
		await sk(world, ["apply", "-k", dir]);
		writeFileSync(join(dir, "b.toml"), def("demo/b", "mine"));
		const memory = world.memory() as ApplysetMemory;
		// Another writer applied after this apply read generation 1.
		const realRead = world.connectLive;
		const stale: ConnectLive = async (resolved) => {
			const live = await realRead(resolved);
			const port = live.applyset;
			if (port === undefined) throw new Error("fake world has an applyset port");
			return {
				...live,
				applyset: {
					...port,
					readApplyset: async (name) => {
						const read = await port.readApplyset(name);
						world.setMemory({ ...memory, generation: 2 });
						return read;
					},
				},
			};
		};
		const io = collect();
		const code = await runCli(["--format", "jsonl", "apply", "-k", dir], io.io, stale);
		expect(code).toBe(EXIT_IN_WORLD);
		const result = JSON.parse(io.out.at(-1) as string) as Record<string, unknown>;
		expect(result).toMatchObject({ ok: false, code: "MF-APPLY-030" });
		expect(String(result.error)).toContain('"expected_generation":1');
		expect(String(result.error)).toContain('"current_generation":2');
	});

	// open: covered by ownership.feature "a copy of the folder is refused until I force it"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("refuses another root path without --force and takes the name over with it", async () => {
		const world = fakeWorld();
		await sk(world, ["apply", "-k", dir]);
		world.setMemory({
			...(world.memory() as ApplysetMemory),
			root_path: "elsewhere/manifest.toml",
		});
		writeFileSync(join(dir, "b.toml"), def("demo/b", "moved root"));
		const refused = await sk(world, ["apply", "-k", dir]);
		expect(refused.code).toBe(EXIT_IN_WORLD);
		expect(refused.result).toMatchObject({ code: "MF-APPLY-031" });
		const forced = await sk(world, ["apply", "-k", dir, "--force"]);
		expect(forced.code).toBe(EXIT_OK);
		expect(world.calls.at(-1)?.force).toBe(true);
	});

	// open: covered by keep-in-step.feature "Try an apply without sending it"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("dry-run behaves as diff", async () => {
		const world = fakeWorld();
		const dry = await sk(world, ["apply", "-k", dir, "--dry-run"]);
		expect(dry.code).toBe(DIFFERENCES);
		expect(dry.result).toMatchObject({ sent: false, dry_run: true });
		expect(world.calls).toHaveLength(0);
	});

	// open: covered by keep-in-step.feature "Put my files into a world for the first time"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("reports the adoption warning on a world without memory", async () => {
		const world = fakeWorld();
		const applied = await sk(world, ["apply", "-k", dir]);
		expect((applied.result.warnings as Array<{ code: string }>).map((w) => w.code)).toContain(
			"MF-APPLYSET-ADOPT",
		);
		expect((applied.result.results as Array<{ result: string }>).map((r) => r.result)).toEqual([
			"created",
			"created",
			"created",
			"created",
		]);
	});

	// open: covered offline by contract.feature (both Examples), which CI runs; delete once the PR's CI run is green
	it("needs -k for apply, and plain sk diff stays the two-file diff", async () => {
		const world = fakeWorld();
		const usage = await sk(world, ["apply", dir]);
		expect(usage.code).toBe(EXIT_USAGE);
		expect(String(usage.result.message)).toContain("-k <dir>");
		const twoFile = await sk(world, ["diff", join(dir, "b.toml"), join(dir, "c.toml")]);
		expect(twoFile.code).toBe(EXIT_OK);
		expect(JSON.stringify(twoFile.result)).toContain("manifest_diff");
	});

	// keep(K5): pins external-program argv and staged-file lifetime; keep-in-step.feature drives the real process
	it("runs SK_EXTERNAL_DIFF on two directories holding the live and file values", async () => {
		const world = fakeWorld({
			exportRows: {
				entity_definitions: [
					{ bundle_id: "demo", entity_def_id: "demo/b", display_name: "X", description: "live" },
				],
			},
		});
		await sk(world, ["apply", "-k", dir]);
		writeFileSync(join(dir, "b.toml"), def("demo/b", "edited"));
		let liveDir = "";
		let fileDir = "";
		let recorded = "";
		const spawn = vi.spyOn(childProcess, "spawnSync").mockImplementation((_program, args) => {
			// Inspect the real staged files while the child would own them, before cleanup.
			const [, live, files] = args as string[];
			liveDir = live as string;
			fileDir = files as string;
			recorded = [liveDir, fileDir]
				.map((path) => readFileSync(join(path, "entity_definitions/demo_b.json"), "utf8"))
				.join("\n");
			return {
				pid: 0,
				output: [],
				stdout: Buffer.alloc(0),
				stderr: Buffer.alloc(0),
				status: 1,
				signal: null,
			};
		});
		process.env.SK_EXTERNAL_DIFF = "record-diff --flag";
		const diff = await sk(world, ["diff", "-k", dir]);
		expect(diff.code).toBe(DIFFERENCES);
		expect(spawn).toHaveBeenCalledExactlyOnceWith("record-diff", ["--flag", liveDir, fileDir], {
			stdio: "inherit",
		});
		expect(liveDir).toMatch(/\/LIVE$/);
		expect(fileDir).toBe(join(liveDir, "..", "FILES"));
		expect(recorded).toContain('"description": "live"');
		expect(recorded).toContain('"description": "edited"');
		expect(existsSync(liveDir)).toBe(false);
		expect(existsSync(fileDir)).toBe(false);
	});

	// open: covered by ownership.feature "a second identity cannot export the world's bundle"; delete once CI runs the @live suite (sk-jay0.7.229.28)
	it("exits 2 when a non-publisher export is refused", async () => {
		const world = fakeWorld();
		const base = world.connectLive;
		world.connectLive = async (resolved) => {
			const live = await base(resolved);
			return {
				...live,
				exportManifest: async () => {
					throw new Error("manifest export requires the module publisher: MF-EXPORT-001");
				},
			};
		};
		const out = join(dir, "out.toml");
		const io = collect();
		const code = await runCli(
			["--format", "jsonl", "--live", "export", "demo", "--out", out],
			io.io,
			world.connectLive,
		);
		expect(code).toBe(EXIT_IN_WORLD);
		expect(io.out.join("\n")).toContain("MF-EXPORT-001");
	});

	// keep(K2): rows play added to an applyset entity need a played world; applyset-prune.live covers them live
	it("prints world-added rows in JSONL and human apply output", async () => {
		const worldAdded = {
			entityId: "10",
			entityDefId: "demo/torch",
			rows: [
				{ table: "entity_containment", key: "content:99" },
				{ table: "target_condition", key: "a/hex" },
			],
		};
		const world = fakeWorld({ worldAdded });
		writeFileSync(
			join(dir, "manifest.toml"),
			root(`${entity("demo/chest")}${entity("demo/torch")}`, []),
		);
		await sk(world, ["apply", "-k", dir]);
		writeFileSync(join(dir, "manifest.toml"), root(entity("demo/chest"), []));
		const refused = await sk(world, ["apply", "-k", dir, "--prune"]);
		expect(refused.code).toBe(EXIT_IN_WORLD);
		expect(refused.result.world_added_rows).toMatchObject({
			"demo/torch": {
				taken: [{ table: "entity_containment", key: "content:99" }],
				left_behind: [{ table: "target_condition", key: "a/hex" }],
			},
		});
		const human = collect({ stdoutIsTTY: true });
		const humanCode = await runCli(
			["--format", "human", "apply", "-k", dir, "--prune"],
			human.io,
			world.connectLive,
		);
		expect(humanCode).toBe(EXIT_IN_WORLD);
		const text = human.out.join("\n");
		expect(text).toContain("taken with the entity");
		expect(text).toContain("left behind");
		expect(text).toContain("entity_containment content:99");
		expect(text).toContain("target_condition a/hex");
		expect(text).toContain("--force");
	});

	// keep(K4): source-order check on the production connector
	it("defaultConnectLive awaits ownerRowsReady before the applyset port", () => {
		const source = readFileSync(new URL("../cli.ts", import.meta.url), "utf8");
		const start = source.indexOf("async function defaultConnectLive");
		const next = source.indexOf("\nasync function ", start + 1);
		const fn = source.slice(start, next === -1 ? undefined : next);
		const ready = fn.indexOf("await session.ownerRowsReady");
		const port = fn.indexOf("createLiveApplysetPort");
		expect(ready).toBeGreaterThan(-1);
		expect(port).toBeGreaterThan(ready);
	});
});

describe("unifiedDiff", () => {
	// keep(K1): unifiedDiff formatter over line pairs
	it("marks removed and added lines around common ones", () => {
		expect(unifiedDiff("live", "file", "a\nb\nc", "a\nB\nc")).toBe(
			["--- live", "+++ file", "@@ -1,3 +1,3 @@", " a", "-b", "+B", " c"].join("\n"),
		);
	});
});

// keep(K1): rendering rule of the human drift heading
it("keeps unchanged drift outside the conflict heading", () => {
	const capture = collect({ stdoutIsTTY: true });
	const io = createRecordIo(capture.io, "human");
	finishApplysetVerb(
		io,
		{ verb: "diff", tool: "applyset_diff", argv: [] },
		{
			differences: true,
			conflicts: [{ kind: "object_state", key: "conflict", part: "root" }],
			values: [
				{ kind: "object_state", key: "conflict", part: "root", live: "played", file: "file" },
				{ kind: "entities", key: "informational", part: "root", live: "moved", file: "same file" },
			],
			world_added_rows: {
				item: { taken: [{ table: "capability", key: "added" }], left_behind: [] },
			},
		},
		0,
		{},
	);
	const text = capture.out.join("\n");
	const heading = text.indexOf("authored, changed in the world since the last apply:");
	expect(text.indexOf("live entities informational")).toBeLessThan(heading);
	expect(text.indexOf("World-added rows on item:")).toBeLessThan(heading);
	expect(text.indexOf("live object_state conflict")).toBeGreaterThan(heading);
});
