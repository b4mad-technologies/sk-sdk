// A world author works on manifest files on disk: `sk validate`, `sk lint`,
// `sk inspect`, `sk map-inspect`/`map-render`, `sk patch`/`render`. These
// commands take a file path, which no registry tool does (why: the header of
// `../bundle.ts`). These tests run them on the committed core and
// place-graph bundles, so includes, dependencies and maps are the shapes
// authors really write, and check that a failed patch writes nothing. No node.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { authorFacingToolDefinitions } from "@spellkave/tool-authoring";
import { inspectManifest } from "@spellkave/world-author";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	EXIT_IN_WORLD,
	EXIT_LINT,
	EXIT_OK,
	EXIT_USAGE,
	FILE_COMMAND_NAMES,
	runCli,
} from "../cli.ts";
import { collect } from "./helpers.ts";

const CORE = fileURLToPath(new URL("./fixtures/catalog/manifest.toml", import.meta.url));
const DEPENDENT = fileURLToPath(new URL("./fixtures/mapped/manifest.toml", import.meta.url));
const MAPPED = DEPENDENT;
const PREVIOUS_AUTHOR_TARGET = process.env.SPELLKAVE_AUTHOR_LOCAL_TARGET;

let out: string;

beforeEach(() => {
	out = mkdtempSync(join(tmpdir(), "sk-map-"));
	process.env.SPELLKAVE_AUTHOR_LOCAL_TARGET = dirname(CORE);
});

afterEach(() => {
	rmSync(out, { recursive: true, force: true });
	if (PREVIOUS_AUTHOR_TARGET === undefined) delete process.env.SPELLKAVE_AUTHOR_LOCAL_TARGET;
	else process.env.SPELLKAVE_AUTHOR_LOCAL_TARGET = PREVIOUS_AUTHOR_TARGET;
});

function only(lines: string[]): Record<string, unknown> {
	expect(lines).toHaveLength(1);
	return JSON.parse(lines[0] as string) as Record<string, unknown>;
}

// The guard that keeps the two halves from silently merging. `sk <name>`
// resolves a file command BEFORE a registry tool, so a registry tool named
// `spellkave_validate` would become unreachable the day it is added — silently,
// with the file command answering in its place.
describe("file commands vs the registry", () => {
	it("shadows no registry tool name", () => {
		const registry = new Set(
			authorFacingToolDefinitions.map((def) => def.name.replace(/^spellkave_/, "")),
		);
		for (const name of FILE_COMMAND_NAMES) {
			expect(registry.has(name), `file command \`sk ${name}\` shadows a registry tool`).toBe(false);
		}
	});
});

// #2002/#1983 docs-packaging follow-up: `sk`'s own agent skill ships WITH the
// package (`packages/spellkave-cli/skill/SKILL.md`), and `sk skill path` is
// the hunk.dev-style seam an agent uses to find it — this pins that the path
// it prints actually resolves to a real, correctly-located file, not just a
// well-formed string.
describe("sk skill", () => {
	it("path prints the packaged SKILL.md's absolute, on-disk path", async () => {
		const io = collect();
		const code = await runCli(["skill", "path"], io.io);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as { kind: string; path: string };
		expect(result.kind).toBe("skill_path");
		expect(result.path.endsWith("skill/SKILL.md")).toBe(true);
		expect(existsSync(result.path)).toBe(true);
	});

	it("without a subcommand, is a usage error naming the subcommand", async () => {
		const io = collect();
		const code = await runCli(["skill"], io.io);

		expect(code).toBe(EXIT_USAGE);
		const result = only(io.out) as { kind: string; scope: string; message: string };
		expect(result.kind).toBe("error");
		expect(result.scope).toBe("usage");
		expect(result.message).toContain("sk skill path");
	});
});

describe("sk validate", () => {
	it("defaults to the configured author target and its include closure", async () => {
		const io = collect();
		const code = await runCli(["validate"], io.io);

		expect(code).toBe(EXIT_OK);
		expect(only(io.out)).toMatchObject({ path: CORE, bundle: true, valid: true });
	});

	it("validates a real bundle through its include closure", async () => {
		const io = collect();
		const code = await runCli(["validate", CORE, "--bundle"], io.io);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as { kind: string; valid: boolean; includedFiles: string[] };
		expect(result.kind).toBe("validate_result");
		expect(result.valid).toBe(true);
		// The whole point of --bundle: fragments actually got merged in.
		expect(result.includedFiles.length).toBeGreaterThan(0);
	});

	it("resolves a depends_on bundle passed with --dep", async () => {
		const io = collect();
		const code = await runCli(["validate", DEPENDENT, "--bundle", "--dep", CORE], io.io);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as { valid: boolean; depManifests: string[] };
		expect(result.valid).toBe(true);
		expect(result.depManifests).toEqual([CORE]);
	});

	it("without --bundle, sees only the root file", async () => {
		const io = collect();
		await runCli(["validate", CORE], io.io);
		const result = only(io.out) as { bundle: boolean; includedFiles: string[] };
		expect(result.bundle).toBe(false);
		expect(result.includedFiles).toEqual([]);
	});

	it("exits in-world on a fatal diagnostic rather than throwing", async () => {
		const invalid = join(out, "missing-schema-directive.toml");
		writeFileSync(invalid, 'schema_version = "1.0.0"\n', "utf8");
		const io = collect();
		const code = await runCli(["validate", invalid], io.io);

		expect(code).toBe(EXIT_IN_WORLD);
		const result = only(io.out) as { valid: boolean; diagnostics: { severity: string }[] };
		expect(result.valid).toBe(false);
		expect(result.diagnostics.some((d) => d.severity === "fatal")).toBe(true);
	});

	// ADR-0145: only the root manifest names its applyset. An include that
	// declares its own used to crash `sk validate --bundle` with a raw thrown
	// error (exit 1) instead of the documented exit-2-with-diagnostics contract.
	it("exits in-world with a structured diagnostic when an include declares its own applyset", async () => {
		mkdirSync(join(out, "base"));
		const manifestPath = join(out, "manifest.toml");
		writeFileSync(
			manifestPath,
			`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[[bundles]]
bundle_id = "root"
display_name = "root"
author = "spellkave-test"
version = "0.0.0"
depends_on = []
description = "test bundle"

[[include]]
path = "base/rogue.toml"
`,
			"utf8",
		);
		writeFileSync(join(out, "base/rogue.toml"), 'applyset = "rogue"\n', "utf8");

		const io = collect();
		const code = await runCli(["validate", manifestPath, "--bundle"], io.io);

		expect(code).toBe(EXIT_IN_WORLD);
		const result = only(io.out) as {
			valid: boolean;
			diagnostics: { severity: string; code: string; message: string; path: string }[];
		};
		expect(result.valid).toBe(false);
		const fatal = result.diagnostics.find((d) => d.severity === "fatal");
		expect(fatal).toBeDefined();
		expect(fatal?.code).toBe("MF-FMT-002");
		expect(fatal?.message).toContain("applyset");
		expect(fatal?.path).toBe("base/rogue.toml");
	});
});

describe("sk lint", () => {
	it("keeps dependency findings advisory while strict mode gates root and included rows", async () => {
		const manifestPath = join(out, "manifest.toml");
		const srd = join(out, "srd.toml");
		writeFileSync(
			srd,
			`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "srd"
display_name = "Dependency"
author = "spellkave-test"
version = "0.0.0"
description = "lint dependency test"
depends_on = []
[[action_definitions]]
action_id = "dependency-action"
display_name = "Dependency action"
on_success = ""
bundle_id = "srd"
required_capability = "missing-dep-capability"
`,
		);
		const root = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "root"
display_name = "root"
author = "spellkave-test"
version = "0.0.0"
depends_on = ["srd"]
description = "lint scope test"
[[include]]
path = "rows.toml"
`;
		writeFileSync(manifestPath, root);
		writeFileSync(join(out, "rows.toml"), "");
		const clean = collect();
		expect(
			await runCli(["lint", manifestPath, "--bundle", "--dep", srd, "--strict"], clean.io),
			clean.err.join("\n") + clean.out.join("\n"),
		).toBe(EXIT_OK);
		const result = only(clean.out) as { clean: boolean; findings: { bundleId: string }[] };
		expect(result.clean).toBe(true);
		expect(result.findings.length).toBeGreaterThan(0);
		expect(result.findings.every((finding) => finding.bundleId === "srd")).toBe(true);

		// An unscoped id proves ownership comes from bundle_id, not an id prefix.
		writeFileSync(
			join(out, "rows.toml"),
			`[[action_definitions]]
action_id = "own-action"
display_name = "Own action"
on_success = ""
bundle_id = "root"
required_capability = "missing"
`,
		);
		const dirty = collect();
		expect(
			await runCli(["lint", manifestPath, "--bundle", "--dep", srd, "--strict"], dirty.io),
		).toBe(EXIT_LINT);
		expect(only(dirty.out)).toMatchObject({
			clean: false,
			findings: expect.arrayContaining([
				expect.objectContaining({
					id: "own-action",
					bundleId: "root",
					rule: "dangling-required-capability",
				}),
			]),
		});
	});

	it("defaults to the configured author target and its include closure", async () => {
		const io = collect();
		const code = await runCli(["lint"], io.io);

		expect(code).toBe(EXIT_OK);
		expect(only(io.out)).toMatchObject({ path: CORE, bundle: true });
	});

	it("keeps findings advisory by default and gates on them under --strict", async () => {
		const path = join(out, "lint-case.toml");
		writeFileSync(path, `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "lint-case"
display_name = "Lint test catalogue"
author = "Spellkave"
version = "1.0.0"
[[action_definitions]]
action_id = "lint-case/inspect"
display_name = "Inspect"
on_success = ""
bundle_id = "lint-case"
required_capability = "missing"
`);
		const advisory = collect();
		const strict = collect();
		const advisoryCode = await runCli(["lint", path, "--bundle"], advisory.io);
		const strictCode = await runCli(["lint", path, "--bundle", "--strict"], strict.io);

		expect(advisoryCode).toBe(EXIT_OK);
		expect(strictCode).toBe(EXIT_LINT);
		expect(only(advisory.out)).toMatchObject({
			findings: expect.arrayContaining([expect.objectContaining({ rule: "dangling-required-capability" })]),
		});
		expect(advisory.out).toEqual(strict.out);
	});
});

describe("sk inspect", () => {
	it("ends human output with populated-row and quality-check next steps", async () => {
		const io = collect({ stdoutIsTTY: true, stdoutColumns: 80 });
		const code = await runCli(["inspect"], io.io);

		expect(code).toBe(EXIT_OK);
		const text = io.out.join("\n");
		expect(text).toContain("zero-valued fields omitted");
		expect(text).toContain("Roll tables");
		// Human mode may color the code span, so match the bare kind id rather than
		// the exact monochrome "(roll_tables)" spelling.
		expect(text).toMatch(/roll_tables/);
		expect(text).toContain("sk inspect --kind ROW_KIND");
		expect(text).toContain("sk validate");
		expect(text).toContain("sk lint");
	});

	it("lists one exact row kind through the inspect surface", async () => {
		const io = collect();
		const code = await runCli(["inspect", "--kind", "roll_tables"], io.io);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as {
			kind: string;
			rowKind: string;
			shape: string;
			items: Array<{ id: string }>;
		};
		expect(result.kind).toBe("inspect_result");
		expect(result.rowKind).toBe("roll_tables");
		expect(result.shape).toBe("list");
		expect(result.items).toContainEqual(expect.objectContaining({ id: "demo/severity" }));
		expect(result).not.toHaveProperty("tool");
	});

	it("drills from a row kind into one row and its references", async () => {
		const io = collect();
		const code = await runCli(["inspect", "--kind", "roll_tables", "--id", "demo/severity"], io.io);

		expect(code).toBe(EXIT_OK);
		expect(only(io.out)).toMatchObject({
			kind: "inspect_result",
			rowKind: "roll_tables",
			shape: "detail",
			id: "demo/severity",
			found: true,
			row: { roll_table_id: "demo/severity" },
		});
	});

	it("uses returned ids and references in human next steps", async () => {
		const list = collect({ stdoutIsTTY: true });
		const detail = collect({ stdoutIsTTY: true });

		expect(await runCli(["inspect", "--kind", "roll_tables"], list.io)).toBe(EXIT_OK);
		expect(await runCli(["inspect", "--kind", "roll_tables", "--id", "demo/severity"], detail.io)).toBe(
			EXIT_OK,
		);

		expect(list.out.join("\n")).toContain("sk inspect --kind roll_tables --id demo/severity");
		expect(detail.out.join("\n")).toContain("sk inspect --kind roll_table_entries --id demo/severity:1");
	});

	it("does not imply that a query can inspect an arbitrary manifest path", async () => {
		const io = collect();
		const code = await runCli(["inspect", CORE, "--kind", "roll_tables"], io.io);

		expect(code).toBe(EXIT_USAGE);
		expect(String(only(io.out).message)).toContain(
			"a manifest path cannot be combined with --kind",
		);
	});

	it("defaults to the configured author target", async () => {
		const io = collect();
		const code = await runCli(["inspect"], io.io);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as {
			path: string;
			bundle: boolean;
			bundleIds: string[];
			rowKinds: Record<string, number>;
		};
		expect(result.path).toBe(CORE);
		expect(result.bundle).toBe(true);
		expect(result.bundleIds).toContain("demo");
		expect(result.rowKinds.capability_definitions).toBeGreaterThan(0);
	});

	it("explains how to configure a target when neither target nor path exists", async () => {
		const io = collect();
		const code = await runCli(["--no-target", "inspect"], io.io);

		expect(code).toBe(EXIT_USAGE);
		const result = only(io.out) as { message: string };
		expect(result.message).toContain("author.target");
		expect(result.message).toContain("sk config set --project");
	});

	it("summarizes bundle ids and row-kind counts across the include closure", async () => {
		const io = collect();
		const code = await runCli(["inspect", CORE, "--bundle"], io.io);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as {
			kind: string;
			bundleIds: string[];
			rowKinds: Record<string, number>;
		};
		expect(result.kind).toBe("inspect_result");
		expect(result.bundleIds).toContain("demo");
		expect(result.rowKinds.capability_definitions).toBeGreaterThan(0);
	});
});

describe("sk map-inspect / map-render", () => {
	it("names indoor authored graphs and offers a graph selection command when the default view is empty", async () => {
		const indoor = join(out, "indoor.toml");
		writeFileSync(
			indoor,
			readFileSync(MAPPED, "utf8").replaceAll(
				'substrate_id = "outdoor"',
				'substrate_id = "indoor"',
			),
		);
		const json = collect();
		expect(
			await runCli(["map-inspect", indoor, "--bundle", "--dep", CORE, "--images", "off"], json.io),
		).toBe(EXIT_OK);
		expect(only(json.out)).toMatchObject({
			graphs: 0,
			places: 0,
			availableGraphIds: expect.arrayContaining(["mapped/hub"]),
			inventory: expect.stringContaining("--graph <id>"),
		});
		const human = collect({ stdoutIsTTY: true });
		expect(
			await runCli(
				["--format", "human", "map-inspect", indoor, "--bundle", "--dep", CORE, "--images", "off"],
				human.io,
			),
		).toBe(EXIT_OK);
		const text = human.out.join("\n");
		expect(text).not.toContain("No place graph is authored yet.");
		expect(text.replace(/\s+/g, " ")).toContain(
			`sk map-inspect ${indoor} --bundle --dep ${CORE} --graph mapped/hub`,
		);
		const selected = collect();
		expect(
			await runCli(
				[
					"map-inspect",
					indoor,
					"--bundle",
					"--dep",
					CORE,
					"--graph",
					"mapped/hub",
					"--images",
					"off",
				],
				selected.io,
			),
		).toBe(EXIT_OK);
		expect(Number(only(selected.out).places)).toBeGreaterThan(0);
	});

	it("defaults map inspection to the configured author target", async () => {
		const io = collect();
		const code = await runCli(["map-inspect"], io.io);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as { path: string; bundle: boolean };
		expect(result.bundle).toBe(true);
		expect(result.path).toMatch(/manifest\.toml$/);
	});

	it("accepts --graph without a path when author.target is configured", async () => {
		// Regression: resolveReadManifestArgs must treat --graph's value as a flag
		// value, not as a bare path — otherwise `sk map-inspect --graph region`
		// fails with "requires a manifest path" despite a configured target.
		const io = collect();
		const code = await runCli(["map-inspect", "--graph", "hub"], io.io);
		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as { path: string; bundle: boolean; graph: string };
		expect(result.bundle).toBe(true);
		expect(result.graph).toBe("hub");
		expect(result.path).toMatch(/manifest\.toml$/);
	});

	it("reports a place-graph's shape and its unreachable nodes", async () => {
		const io = collect();
		const code = await runCli(["map-inspect", MAPPED, "--bundle", "--dep", CORE], io.io);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as {
			kind: string;
			graphs: number;
			places: number;
			routes: number;
			reachable: number;
			unreachable: string[];
		};
		expect(result.kind).toBe("map_inspect_result");
		expect(result.graphs).toBeGreaterThan(0);
		expect(result.places).toBeGreaterThan(0);
		// Reachability is the diagnostic worth having: an authored-but-unwalkable
		// place is invisible in a row count.
		expect(result.reachable + result.unreachable.length).toBe(result.places);
	});

	it("explains the empty map state and gives a relevant next action", async () => {
		// Use core explicitly — project author.target may point at phandelver.
		const io = collect({ stdoutIsTTY: true });
		const code = await runCli(["--format", "human", "map-inspect", CORE], io.io);

		expect(code).toBe(EXIT_OK);
		const text = io.out.join("\n");
		expect(text).toContain("No place graph is authored yet.");
		expect(text).toContain('sk docs --query "place graph"');
		expect(text).toContain("sk inspect");
	});

	it("renders SVG carrying the graph's places", async () => {
		const target = join(out, "map.svg");
		const io = collect();
		const code = await runCli(
			["map-render", MAPPED, "--bundle", "--dep", CORE, "--out", target],
			io.io,
		);

		expect(code).toBe(EXIT_OK);
		const result = only(io.out) as { kind: string; format: string; places: number };
		expect(result.kind).toBe("map_render_result");
		expect(result.format).toBe("svg");
		const svg = readFileSync(target, "utf8");
		expect(svg.startsWith("<svg")).toBe(true);
		expect(svg.split("<circle").length - 1).toBeGreaterThanOrEqual(result.places);
	});

	it("wraps the same SVG in a page for --format html", async () => {
		const svgPath = join(out, "map.svg");
		const htmlPath = join(out, "map.html");
		await runCli(["map-render", MAPPED, "--bundle", "--dep", CORE, "--out", svgPath], collect().io);
		await runCli(
			["map-render", MAPPED, "--bundle", "--dep", CORE, "--out", htmlPath, "--format", "html"],
			collect().io,
		);

		const html = readFileSync(htmlPath, "utf8");
		expect(html).toContain("<!doctype html>");
		// The picture itself is the same bytes — html only adds the page around it.
		expect(html).toContain(readFileSync(svgPath, "utf8"));
	});

	it("narrows to one graph with --graph", async () => {
		const all = join(out, "all.svg");
		const one = join(out, "one.svg");
		const allIo = collect();
		const oneIo = collect();
		await runCli(["map-render", MAPPED, "--bundle", "--dep", CORE, "--out", all], allIo.io);
		await runCli(
			["map-render", MAPPED, "--bundle", "--dep", CORE, "--out", one, "--graph", "hub"],
			oneIo.io,
		);

		expect((only(oneIo.out) as { graph: string }).graph).toBe("hub");
		expect(readFileSync(one, "utf8").length).toBeLessThan(readFileSync(all, "utf8").length);
	});

	it("rejects an unknown render format instead of writing a broken file", async () => {
		const io = collect();
		const code = await runCli(
			["map-render", CORE, "--out", join(out, "x"), "--format", "pdf"],
			io.io,
		);
		expect(code).toBe(EXIT_USAGE);
		expect(only(io.out).scope).toBe("infra");
	});

	it("without --out shows a terminal result instead of a usage error", async () => {
		const io = collect({ stdoutIsTTY: true, stdoutColumns: 80 });
		const code = await runCli(
			["--format", "human", "map-render", MAPPED, "--bundle", "--dep", CORE, "--graph", "hub"],
			io.io,
		);
		expect(code).toBe(EXIT_OK);
		const text = io.out.join("\n");
		expect(text.length).toBeGreaterThan(0);
		expect(text).not.toMatch(/requires --out/);
	});
});

describe("file command argument errors", () => {
	it("explains both remedies when no manifest path or configured target exists", async () => {
		const io = collect();
		expect(await runCli(["--no-target", "validate"], io.io)).toBe(EXIT_USAGE);
		const message = String(only(io.out).message);
		expect(message).toContain("pass <manifest.toml>");
		expect(message).toContain("sk config set --project author.target");
	});

	it("rejects an unknown flag rather than ignoring it", async () => {
		const io = collect();
		expect(await runCli(["validate", CORE, "--nope"], io.io)).toBe(EXIT_USAGE);
	});

	it("rejects a second path", async () => {
		const io = collect();
		expect(await runCli(["validate", CORE, CORE], io.io)).toBe(EXIT_USAGE);
	});

	// `--dep` only means anything in a merged document, so accepting it while
	// silently ignoring it would be the worst outcome: a green validate that
	// never looked at the dependency.
	it("implies --bundle when a --dep is given", async () => {
		const io = collect();
		await runCli(["validate", DEPENDENT, "--dep", CORE], io.io);
		expect((only(io.out) as { bundle: boolean }).bundle).toBe(true);
	});
});

describe("sk patch / sk render", () => {
	it("applies a patch op and writes the rendered manifest", async () => {
		const target = join(out, "patched.toml");
		const io = collect();
		const code = await runCli(
			[
				"patch",
				CORE,
				"--op",
				"add-object-state-definition",
				"--json",
				JSON.stringify({ state_id: "demo/lit", bundle_id: "demo", display_name: "Lit" }),
				"--output",
				target,
				"--no-validate",
			],
			io.io,
		);

		expect(code).toBe(EXIT_OK);
		expect((only(io.out) as { kind: string }).kind).toBe("patch_result");
		expect(readFileSync(target, "utf8")).toContain('state_id = "demo/lit"');
	});

	// The invariant worth pinning: a half-valid manifest on disk is worse than
	// no write at all, because the next command reads it back as if it were sound.
	it("writes NOTHING when the patched result fails validation", async () => {
		const target = join(out, "never-written.toml");
		const io = collect();
		const code = await runCli(
			[
				"patch",
				CORE,
				"--op",
				"add-place-edge",
				"--json",
				JSON.stringify({
					bundle_id: "demo",
					edge_key: "demo/a-to-missing",
					from_node_id: "demo/a",
					to_node_id: "demo/missing",
				}),
				"--output",
				target,
			],
			io.io,
		);

		expect(code).toBe(EXIT_IN_WORLD);
		const result = only(io.out) as { valid: boolean; diagnostics: unknown[] };
		expect(result.valid).toBe(false);
		expect(result.diagnostics.length).toBeGreaterThan(0);
		expect(() => readFileSync(target, "utf8")).toThrow();
	});

	it("requires --op, --json and --output", async () => {
		for (const argv of [
			["patch", CORE, "--output", join(out, "x")],
			["patch", CORE, "--op", "add-entity", "--output", join(out, "x")],
			["patch", CORE, "--op", "add-entity", "--json", "{}"],
		]) {
			const io = collect();
			expect(await runCli(argv, io.io)).toBe(EXIT_USAGE);
		}
	});

	it("round-trips a manifest through render", async () => {
		const jsonPath = join(out, "manifest.json");
		const tomlPath = join(out, "rendered.toml");
		writeFileSync(
			jsonPath,
			JSON.stringify(
				inspectManifest(readFileSync(CORE, "utf8")).manifest as Record<string, unknown>,
			),
			"utf8",
		);

		const io = collect();
		const code = await runCli(
			["render", "--input", jsonPath, "--output", tomlPath, "--no-validate"],
			io.io,
		);

		expect(code).toBe(EXIT_OK);
		expect((only(io.out) as { kind: string }).kind).toBe("render_result");
		expect(readFileSync(tomlPath, "utf8")).toContain("schema_version");
	});

	it("rejects a non-object patch payload", async () => {
		const io = collect();
		const code = await runCli(
			["patch", CORE, "--op", "add-entity", "--json", "[1,2]", "--output", join(out, "x")],
			io.io,
		);
		expect(code).toBe(EXIT_USAGE);
		expect(String(only(io.out).message)).toContain("JSON object");
	});
});
