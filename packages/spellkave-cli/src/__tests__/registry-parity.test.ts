// Adding a tool to the shared role registry makes it a `sk` command with no
// edit in this package. These tests list every AUTHOR and PLAYER tool, check
// each gets a flag surface, and scan this package's source for a hard-coded
// tool name: one would mean a tool bypassed the generic path. They also
// check which tools are available with and without a world. No node.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { playerFacingToolDefinitions } from "@spellkave/session/player-tools";
import {
	AUTHOR_CONNECTED_TOOL_NAMES,
	AUTHOR_FACING_TOOL_NAMES,
	AUTHOR_OFFLINE_TOOL_NAMES,
	authorFacingToolDefinitions,
} from "@spellkave/tool-authoring";
import {
	APPLY_MANIFEST_DELTA_TOOL,
	APPLYSET_APPLY_TOOL,
	APPLYSET_DIFF_TOOL,
	EXPORT_MANIFEST_TOOL,
	PLAYER_TOOL_NAMES as PLAYER_FACING_TOOL_NAMES,
} from "@spellkave/tool-contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runCli } from "../cli.ts";
import { collect } from "./helpers.ts";

const SOURCE_FILES = [
	"../cli.ts",
	"../args.ts",
	"../workspace.ts",
	"../bundle.ts",
	"../map.ts",
	"../index.ts",
] as const;

/**
 * Source with comment-only lines dropped. The property under test is about
 * CODE — prose is free to name a tool (and does: the availability rule is
 * only comprehensible if the comment says which tool it is about). A checker
 * that could not tell the two apart would push those explanations out of the
 * file, which is a worse outcome than the test it protects.
 */
function readCode(relative: string): string {
	return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8")
		.split("\n")
		.filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
		.join("\n");
}

type ListedTool = {
	name: string;
	facing: "author" | "player" | "plugin";
	available: boolean;
	reason?: string;
};

async function listTools(): Promise<ListedTool[]> {
	const io = collect();
	await runCli(["--no-target", "list"], io.io);
	const payload = JSON.parse(io.out[0] as string) as { tools: ListedTool[] };
	return registryOnly(payload.tools);
}

/** Plugin verbs share the `tool_list` record (`facing: "plugin"`); `plugins.test.ts` covers them. */
function registryOnly<T extends { facing: string }>(tools: readonly T[]): T[] {
	return tools.filter((tool) => tool.facing !== "plugin");
}

describe("registry parity", () => {
	// `sk list`'s PLAYER-side `available` is env-derived (`resolveBinding`) —
	// every case below controls that env explicitly so the assertions stay
	// deterministic regardless of what a caller's shell happens to export.
	const savedUrl = process.env.SPELLKAVE_URL;
	const savedDb = process.env.SPELLKAVE_DB;
	const savedActor = process.env.SPELLKAVE_ACTOR;
	const savedToken = process.env.SPELLKAVE_CONNECT_TOKEN;
	const savedConfigPath = process.env.SPACETIME_CONFIG_PATH;
	const savedHome = process.env.SPELLKAVE_HOME;
	let profileHome: string;

	beforeEach(() => {
		delete process.env.SPELLKAVE_URL;
		delete process.env.SPELLKAVE_DB;
		delete process.env.SPELLKAVE_ACTOR;
		delete process.env.SPELLKAVE_CONNECT_TOKEN;
		delete process.env.SPACETIME_CONFIG_PATH;
		// `playerAvailability` shares `resolveBinding`'s #2002 last-used-profile
		// fallback — an empty temp config root keeps "nothing is wired" cases
		// below deterministic instead of depending on whatever profile state
		// happens to exist under a developer's real `$HOME`.
		profileHome = mkdtempSync(join(tmpdir(), "sk-registry-parity-home-"));
		process.env.SPELLKAVE_HOME = profileHome;
	});

	afterEach(() => {
		rmSync(profileHome, { recursive: true, force: true });
		for (const [key, value] of [
			["SPELLKAVE_URL", savedUrl],
			["SPELLKAVE_DB", savedDb],
			["SPELLKAVE_ACTOR", savedActor],
			["SPELLKAVE_CONNECT_TOKEN", savedToken],
			["SPACETIME_CONFIG_PATH", savedConfigPath],
			["SPELLKAVE_HOME", savedHome],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	});

	it("lists every AUTHOR and PLAYER tool the registry defines, AUTHOR first, each alphabetically", async () => {
		const io = collect();
		const code = await runCli(["list"], io.io);

		expect(code).toBe(0);
		const [line] = io.out;
		const payload = JSON.parse(line as string) as {
			kind: string;
			tools: { name: string; facing: string }[];
		};
		expect(payload.kind).toBe("tool_list");
		const registry = registryOnly(payload.tools);
		expect(registry.map((tool) => tool.name)).toEqual([
			...[...AUTHOR_FACING_TOOL_NAMES].sort(),
			...[...PLAYER_FACING_TOOL_NAMES].sort(),
		]);
		expect(registry.map((tool) => tool.facing)).toEqual([
			...AUTHOR_FACING_TOOL_NAMES.map(() => "author"),
			...PLAYER_FACING_TOOL_NAMES.map(() => "player"),
		]);
	});

	// The Pi extension's parity test compares curated lists, because Pi's
	// main.ts hand-assembles its registration. `sk` has no list: it enumerates
	// the registry. So this source scan is what protects the claim; a literal
	// tool name here means the generic path was bypassed.
	it("hard-codes no tool name in executable code", () => {
		// The connected tool is referenced ONLY through the registry's own
		// exported constant (availability gating), never as a string — so not
		// one of these names may appear as a literal in code.
		for (const relative of SOURCE_FILES) {
			const code = readCode(relative);
			for (const name of AUTHOR_FACING_TOOL_NAMES) {
				expect(code, `${relative} hard-codes ${name}`).not.toContain(name);
			}
		}
	});

	it("hard-codes no PLAYER-facing tool name in executable code", () => {
		// PLAYER dispatch (#1990 slice 3, `runPlayerTool`/`playerDefinitionFor` in
		// `cli.ts`) routes on `playerFacingToolDefinitions` membership alone —
		// mirrors `@spellkave/session`'s own `__tests__/registry-parity.test.ts`
		// for the daemon side of the same invariant.
		expect(PLAYER_FACING_TOOL_NAMES.length).toBeGreaterThan(0);
		for (const relative of SOURCE_FILES) {
			const code = readCode(relative);
			for (const name of PLAYER_FACING_TOOL_NAMES) {
				expect(code, `${relative} hard-codes ${name}`).not.toContain(name);
			}
		}
	});

	it("derives a flag surface for every AUTHOR and PLAYER tool without special-casing", async () => {
		const tools = await listTools();
		const payload = tools as (ListedTool & { flags: { flag: string; required: boolean }[] })[];

		for (const def of [...authorFacingToolDefinitions, ...playerFacingToolDefinitions]) {
			const entry = payload.find((tool) => tool.name === def.name);
			expect(entry, `${def.name} missing from sk list`).toBeDefined();
			const schema = def.parameters as unknown as { properties?: Record<string, unknown> };
			expect(entry?.flags).toHaveLength(Object.keys(schema.properties ?? {}).length);
		}
	});

	it("marks the connected AUTHOR tool and every PLAYER tool unavailable when nothing is wired", async () => {
		const tools = await listTools();

		const unavailable = tools.filter((tool) => !tool.available).map((tool) => tool.name);
		expect(unavailable).toEqual([
			...[...AUTHOR_CONNECTED_TOOL_NAMES].sort(),
			...[...PLAYER_FACING_TOOL_NAMES].sort(),
		]);
		// Restated through the registry's own offline list, so this test tracks
		// the split rather than a snapshot of today's membership.
		const available = tools.filter((tool) => tool.available).map((tool) => tool.name);
		expect(available).toEqual([...AUTHOR_OFFLINE_TOOL_NAMES].sort());

		// Every unavailable entry names the missing piece — never a bare `false`
		// with no way to tell why (mirrors AUTHOR's own `unavailableReason`).
		const delta = tools.find((tool) => tool.name === APPLY_MANIFEST_DELTA_TOOL);
		expect(delta?.reason).toContain("--target");
		const exported = tools.find((tool) => tool.name === EXPORT_MANIFEST_TOOL);
		expect(exported?.reason).toContain("--live");
		for (const name of [APPLYSET_DIFF_TOOL, APPLYSET_APPLY_TOOL]) {
			expect(tools.find((tool) => tool.name === name)?.reason).toContain("sk diff -k");
		}
		for (const tool of tools.filter((t) => t.facing === "player")) {
			expect(tool.reason, `${tool.name} missing an unavailable reason`).toContain("SPELLKAVE_URL");
		}
	});

	it("marks every PLAYER tool available once SPELLKAVE_URL and --actor resolve, independent of AUTHOR's own --target/--live", async () => {
		process.env.SPELLKAVE_URL = "http://127.0.0.1:4001";
		process.env.SPELLKAVE_ACTOR = "hero-1";

		const tools = await listTools();

		const playerTools = tools.filter((tool) => tool.facing === "player");
		expect(playerTools).toHaveLength(PLAYER_FACING_TOOL_NAMES.length);
		expect(playerTools.every((tool) => tool.available)).toBe(true);
		expect(playerTools.every((tool) => tool.reason === undefined)).toBe(true);

		// AUTHOR's own connected tool is unaffected by --actor/SPELLKAVE_URL —
		// it only ever looks at --target/--live, which this case leaves unset.
		const delta = tools.find((tool) => tool.name === APPLY_MANIFEST_DELTA_TOOL);
		expect(delta?.available).toBe(false);
		const exported = tools.find((tool) => tool.name === EXPORT_MANIFEST_TOOL);
		expect(exported?.available).toBe(false);
	});
});
