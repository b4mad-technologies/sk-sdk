// Scripts and agents read `sk`'s stdout and exit code, so both must be
// stable: records and explicit help on stdout, diagnostics on stderr, exit 1 for a usage
// mistake (before the tool runs) and 2 when the world says no. These tests
// drive the real dispatcher for tool calls, help, config, docs and output
// formats. Offline against packages/spellkave-mechanics/fixtures; no node.
// Output contract: ADR-0002.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EXIT_IN_WORLD, EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import { collect } from "./helpers.ts";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const CORE_BUNDLE = fileURLToPath(new URL("./fixtures/catalog", import.meta.url));

let workspace: string;

beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "sk-cli-"));
});

afterEach(() => {
	rmSync(workspace, { recursive: true, force: true });
	// Each case sets only what it needs; leaking either would silently
	// re-point a later case's target.
	delete process.env.SPELLKAVE_AUTHOR_LOCAL_TARGET;
	delete process.env.SPELLKAVE_AUTHOR_WORKSPACE;
});

function parseOnly(lines: string[]): Record<string, unknown> {
	expect(lines).toHaveLength(1);
	return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

describe("sk dispatch", () => {
	it("reads a real bundle through the local target with no node running", async () => {
		const io = collect();
		const code = await runCli(
			["--target", CORE_BUNDLE, "query", "--kind", "capability_definitions"],
			io.io,
		);

		expect(code).toBe(EXIT_OK);
		const payload = parseOnly(io.out) as {
			kind: string;
			ok: boolean;
			details: { items: { id: string }[] };
		};
		expect(payload.kind).toBe("tool_result");
		expect(payload.ok).toBe(true);
		expect(payload.details.items.map((item) => item.id)).toContain("demo/inspect");
	});

	it("accepts a tool name with or without the registry's namespace prefix", async () => {
		const bare = collect();
		const prefixed = collect();
		await runCli(["--target", CORE_BUNDLE, "query", "--kind", "niche_definitions"], bare.io);
		await runCli(
			["--target", CORE_BUNDLE, "spellkave_query", "--kind", "niche_definitions"],
			prefixed.io,
		);

		expect(bare.out).toEqual(prefixed.out);
	});

	it("sk tool <registry-name> matches the bare form (with and without a target)", async () => {
		for (const argsTail of [
			["query", "--kind", "capability_definitions"],
			["query", "--schema", "--kind", "entity_definitions"],
		]) {
			const globals = argsTail.includes("--schema") ? [] : ["--target", CORE_BUNDLE];
			const bare = collect();
			const explicit = collect();
			const bareCode = await runCli([...globals, ...argsTail], bare.io);
			const explicitCode = await runCli(
				[...globals, "tool", `spellkave_${argsTail[0]}`, ...argsTail.slice(1)],
				explicit.io,
			);
			expect(bareCode).toBe(EXIT_OK);
			expect(explicitCode).toBe(bareCode);
			expect(explicit.out).toEqual(bare.out);
		}
	});

	it("writes an authored row into the scratch bundle", async () => {
		const io = collect();
		const code = await runCli(
			[
				"--workspace",
				workspace,
				"--default-bundle",
				"sk_test",
				"define_capability",
				"--id",
				"whistle",
				"--actor-kind",
				"actor",
				"--description",
				"Whistle a tune loud enough to carry across a clearing.",
			],
			io.io,
		);

		expect(code).toBe(EXIT_OK);
		expect(parseOnly(io.out).ok).toBe(true);
		expect(readFileSync(join(workspace, "manifest.toml"), "utf8")).toContain(
			'capability_id = "sk_test/whistle"',
		);
	});

	// Deliberately a bundle directory that does NOT exist yet: authoring a new
	// mod from nothing is the CLI's real entry case, and it is the path that
	// `createLocalAuthorTarget`'s fresh-root leniency exists to serve.
	it("bootstraps a new bundle from an empty target directory", async () => {
		const target = join(workspace, "target");
		const scratch = join(workspace, "scratch");

		const authored = collect();
		expect(
			await runCli(
				[
					"--workspace",
					scratch,
					"--target",
					target,
					"--fixtures-root",
					join(REPO_ROOT, "archive/world-fixtures"),
					"--default-bundle",
					"sk_test",
					"define_capability",
					"--id",
					"whistle",
					"--actor-kind",
					"actor",
					"--description",
					"Whistle a tune loud enough to carry across a clearing.",
				],
				authored.io,
			),
		).toBe(EXIT_OK);

		const flushed = collect();
		const code = await runCli(
			[
				"--workspace",
				scratch,
				"--target",
				target,
				"--fixtures-root",
				join(REPO_ROOT, "archive/world-fixtures"),
				"apply_manifest_delta",
				"--toml",
				readFileSync(join(scratch, "manifest.toml"), "utf8"),
			],
			flushed.io,
		);

		expect(code).toBe(EXIT_OK);
		expect(readFileSync(join(target, "manifest.toml"), "utf8")).toContain(
			'capability_id = "sk_test/whistle"',
		);
	});
});

describe("sk exit codes", () => {
	it("reports an unknown tool as usage", async () => {
		const io = collect();
		const code = await runCli(["definitely_not_a_tool"], io.io);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.kind).toBe("error");
		expect(payload.scope).toBe("usage");
	});

	it("reports a schema violation as usage, before the tool ever runs", async () => {
		const io = collect();
		// `actor_kind` and `description` are required by the schema.
		const code = await runCli(["--workspace", workspace, "define_capability", "--id", "x"], io.io);

		expect(code).toBe(EXIT_USAGE);
		expect(parseOnly(io.out).scope).toBe("usage");
	});

	it("reports an unwired connected tool as usage, naming the remedy", async () => {
		const io = collect();
		const code = await runCli(
			["--no-target", "apply_manifest_delta", "--toml", "irrelevant"],
			io.io,
		);

		expect(code).toBe(EXIT_USAGE);
		expect(parseOnly(io.out).message).toContain("--target");
	});

	// #2004: `--target ""` used to fall through to `resolve("")` — silently the
	// CURRENT WORKING DIRECTORY, with no diagnostic. The shared
	// `resolveLocalAuthorTarget` helper (`@spellkave/tool-node/authoring`) now
	// rejects a blank directory loudly instead.
	it("reports --target '' as usage instead of silently targeting the cwd", async () => {
		const io = collect();
		const code = await runCli(["--target", "", "query", "--kind", "capability_definitions"], io.io);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out);
		expect(payload.scope).toBe("usage");
		expect(payload.message).toContain("--target");
	});

	it("reports a validator rejection as in-world, with diagnostics", async () => {
		const io = collect();
		const code = await runCli(
			[
				"--workspace",
				workspace,
				"--default-bundle",
				"sk_test",
				"write_rows",
				"--kind",
				"affordance_templates",
				"--rows",
				JSON.stringify([
					{
						template_id: "sk_test/x",
						bundle_id: "sk_test",
						capability_id: "sk_test/missing",
						display_name: "X",
						locality_class: "",
						niche_id: "sk_test/missing",
						outcome_template_id: "sk_test/missing",
						predicate_bool: false,
						// Not a predicate — the wasm validator refuses it.
						predicate_source: "true",
						accepts_global_storm: false,
					},
				]),
			],
			io.io,
		);

		expect(code).toBe(EXIT_IN_WORLD);
		const payload = parseOnly(io.out) as {
			ok: boolean;
			details: { diagnostics: { code: string; severity: string }[] };
		};
		expect(payload.ok).toBe(false);
		expect(payload.details.diagnostics.some((d) => d.severity === "fatal")).toBe(true);
	});
});

describe("sk help", () => {
	it("treats a bare invocation as a successful, guided starting point", async () => {
		const io = collect();
		const code = await runCli(
			["--workspace", "scratch", "--target", "bundle", "--default-bundle", "demo"],
			io.io,
		);

		expect(code).toBe(EXIT_OK);
		expect(io.err.join("\n")).toContain("Current context:");
		expect(io.err.join("\n")).toContain("Author workspace: scratch");
		expect(io.err.join("\n")).toContain("Local target: bundle");
		expect(io.err.join("\n")).toContain("Default bundle for writes: demo");
		expect(io.err.join("\n")).toContain("Start here:");
		expect(io.err.join("\n")).toContain("sk docs onramp");
		expect(io.err.join("\n")).toContain("sk docs                       browse guidance by topic");
		expect(io.err.join("\n")).toContain("sk inspect                   understand");
		expect(io.err.join("\n")).toContain("sk validate                  check");
		expect(io.err.join("\n")).toContain("sk --format jsonl <command>");
		expect(io.err.join("\n")).toContain("stable output for agents and scripts");
	});

	it("prints explicit help on stdout without stderr diagnostics", async () => {
		const io = collect();
		const code = await runCli(["help"], io.io);

		expect(code).toBe(EXIT_OK);
		expect(io.err).toEqual([]);
		expect(io.out.join("\n")).toContain("registry-driven");
	});

	it("renders one tool's flags from its schema", async () => {
		const io = collect();
		await runCli(["help", "define_capability"], io.io);

		const text = io.out.join("\n");
		expect(text).toContain("--actor-kind");
		expect(text).toContain("(required)");
	});

	it("sorts navigational command groups alphabetically", async () => {
		const io = collect();
		await runCli(["help"], io.io);

		const text = io.out.join("\n");
		expect(text.indexOf("apply_manifest_delta")).toBeLessThan(text.indexOf("author_place"));
		expect(text.indexOf("map-inspect")).toBeLessThan(text.indexOf("map-render"));
	});
});

describe("sk config", () => {
	it("treats a bare config command as show", async () => {
		const bare = collect();
		const explicit = collect();

		await runCli(["config"], bare.io);
		await runCli(["config", "show"], explicit.io);

		expect(bare.out).toEqual(explicit.out);
	});

	it("names the fix when a global option like --format is placed after 'config'", async () => {
		const io = collect();
		const code = await runCli(["config", "show", "--format", "human"], io.io);

		expect(code).toBe(EXIT_USAGE);
		const payload = parseOnly(io.out) as { message: string };
		expect(payload.message).toBe(
			"sk config show: takes no arguments (global options such as --format must precede 'config').",
		);
	});

	it("shows common changes after a human-readable config", async () => {
		const io = collect({ stdoutIsTTY: true, stdoutColumns: 100 });
		const code = await runCli(["config"], io.io);

		expect(code).toBe(EXIT_OK);
		const text = io.out.join("\n").replace(/\s+/g, " ");
		expect(text).toContain("Use another bundle once:");
		expect(text).toContain(
			"sk --target ./adventure/manifest.toml inspect",
		);
		expect(text).toContain(
			"sk config set --project author.target ./adventure/manifest.toml",
		);
		expect(text).toContain("sk config set --global output.format human");
	});

	it("shows built-in defaults when no project config is present", async () => {
		// Project `.spellkave/config.toml` is gitignored (optional overlay);
		// CI and a clean clone use built-ins unless the operator copies
		// config.example.toml or sets XDG globals.
		const io = collect();
		const code = await runCli(["--no-target", "--no-default-bundle", "config", "show"], io.io);

		expect(code).toBe(EXIT_OK);
		const payload = parseOnly(io.out) as {
			kind: string;
			values: Array<{ key: string; value: string; source: string }>;
		};
		expect(payload.kind).toBe("config");
		expect(payload.values).toContainEqual({
			key: "author.target",
			value: "none",
			source: "flag",
		});
	});

	it("lets an explicit invocation opt out of configured author defaults", async () => {
		const io = collect();
		await runCli(["--no-target", "--no-default-bundle", "config", "show"], io.io);

		const payload = parseOnly(io.out) as {
			values: Array<{ key: string; value: string; source: string }>;
		};
		expect(payload.values).toContainEqual({
			key: "author.target",
			value: "none",
			source: "flag",
		});
		expect(payload.values).toContainEqual({
			key: "author.default-bundle",
			value: "none",
			source: "flag",
		});
	});
});

describe("sk docs shell ergonomics", () => {
	it("accepts an exact doc id positionally with an explicit machine envelope", async () => {
		const io = collect();
		const code = await runCli(["--format", "jsonl", "docs", "onramp"], io.io);

		expect(code).toBe(EXIT_OK);
		const payload = JSON.parse(io.out[0] as string) as {
			details: { shape: string; doc: { rel: string; title: string } };
		};
		expect(payload.details.shape).toBe("doc");
		expect(payload.details.doc.rel).toBe("onramp");
	});

	it("shows copyable next calls after the human index", async () => {
		const io = collect({ stdoutIsTTY: true, stdoutColumns: 100 });
		const code = await runCli(["docs"], io.io);

		expect(code).toBe(EXIT_OK);
		const text = io.out.join("\n");
		expect(text).toContain("Start here");
		expect(text).toContain("Worked examples");
		expect(text).toContain("Next:");
		expect(text).toContain("sk docs onramp");
	});
});

describe("sk output formats", () => {
	it("renders human output automatically for an interactive stdout", async () => {
		const io = collect({ stdoutIsTTY: true, stdoutColumns: 72 });

		const code = await runCli(["skill", "path"], io.io);

		expect(code).toBe(EXIT_OK);
		expect(() => JSON.parse(io.out.join("\n"))).toThrow();
		expect(io.out.join("\n")).toContain("Path");
		expect(io.out.join("\n")).toContain("SKILL.md");
	});

	it("forces human output for a non-interactive stdout", async () => {
		const io = collect({ stdoutIsTTY: false, stdoutColumns: 72 });

		const code = await runCli(["--format=human", "skill", "path"], io.io);

		expect(code).toBe(EXIT_OK);
		expect(io.out.join("\n")).toContain("Path");
		expect(io.out[0]).not.toMatch(/^\{/);
	});

	it("forces canonical JSONL for a TTY and matches the non-TTY default", async () => {
		const automatic = collect({ stdoutIsTTY: false });
		const forced = collect({ stdoutIsTTY: true });

		await runCli(["skill", "path"], automatic.io);
		await runCli(["--format", "jsonl", "skill", "path"], forced.io);

		expect(forced.out).toEqual(automatic.out);
		expect(parseOnly(forced.out).kind).toBe("skill_path");
	});

	it("rejects an unsupported format before invoking the requested tool", async () => {
		const io = collect();
		let connected = false;
		const connectLive = async () => {
			connected = true;
			throw new Error("must not connect");
		};

		const code = await runCli(
			["--format", "yaml", "--live", "apply_manifest_delta", "--toml", "irrelevant"],
			io.io,
			connectLive,
		);

		expect(code).toBe(EXIT_USAGE);
		expect(connected).toBe(false);
		expect(parseOnly(io.out).message).toContain("auto, human, jsonl, or toon");
	});
});
