// Other packages add command groups to `sk` (for example `sk dev`, `sk
// spire`) through the `sk.plugins` list in package.json. A plugin verb gets
// its flags from its schema like any tool, appears in `sk list` and `sk
// help`, and may not take a root name the core or another plugin owns. These
// tests mount fake plugins with an injected host; no node.
// Decided in ADR-0144 D-3.
import { readFileSync } from "node:fs";

import type { HostDeps } from "@spellkave/cli-plugin";
import { describe, expect, it } from "vitest";

import { CORE_COMMANDS, EXIT_IN_WORLD, EXIT_OK, EXIT_USAGE, runCli } from "../cli.ts";
import { type PluginSource, readPluginEntries } from "../plugins.ts";
import demoPlugin from "./fixtures/demo-plugin.ts";
import { collect } from "./helpers.ts";

const demoSource: PluginSource = {
	entries: [{ package: "@example/demo", group: "demo" }],
	load: async (name) => {
		if (name !== "@example/demo") throw new Error(`unexpected load ${name}`);
		return { default: demoPlugin };
	},
};

function fakeHost(files: Record<string, string> = {}): HostDeps {
	return {
		cwd: "/fake",
		env: {},
		readFile: (path) => files[path] ?? null,
		exists: (path) => path in files,
		writeFile: () => {
			throw new Error("writeFile not expected");
		},
		run: () => {
			throw new Error("run not expected");
		},
		now: () => 1234,
	};
}

async function sk(argv: string[], source: PluginSource = demoSource, host: HostDeps = fakeHost()) {
	const io = collect();
	const code = await runCli(argv, io.io, undefined, undefined, { plugins: source, host });
	const records =
		argv[0] === "help" ? [] : io.out.map((line) => JSON.parse(line) as Record<string, unknown>);
	return { code, records, out: io.out, err: io.err };
}

describe("plugin verbs", () => {
	it("runs a listed plugin verb in-process with the injected host", async () => {
		const { code, records } = await sk(["--format", "jsonl", "demo", "hello", "--name", "kira"]);
		expect(code).toBe(EXIT_OK);
		expect(records).toEqual([
			{ kind: "greeting", text: "hello kira", at: 1234, format_source: "flag" },
		]);
	});

	it("accepts declared positionals and boolean flags", async () => {
		const { code, records } = await sk(["--format", "jsonl", "demo", "hello", "kira", "--shout"]);
		expect(code).toBe(EXIT_OK);
		expect(records[0]).toMatchObject({ text: "HELLO KIRA" });
	});

	it("reaches nested groups and returns the verb's own exit code", async () => {
		const found = await sk(
			["--format", "jsonl", "demo", "notes", "read", "--path", "/n.txt"],
			demoSource,
			fakeHost({ "/n.txt": "remember the mill" }),
		);
		expect(found.code).toBe(EXIT_OK);
		expect(found.records).toEqual([{ kind: "note", contents: "remember the mill" }]);

		const missing = await sk(["--format", "jsonl", "demo", "notes", "read", "--path", "/none"]);
		expect(missing.code).toBe(EXIT_IN_WORLD);
	});

	it("reports a missing required flag as a schema-derived usage error", async () => {
		const { code, records } = await sk(["--format", "jsonl", "demo", "hello"]);
		expect(code).toBe(EXIT_USAGE);
		expect(records[0]).toMatchObject({ kind: "error", scope: "usage", command: "demo hello" });
		expect(String(records[0]?.message)).toMatch(/name/);
	});

	it("rejects an unknown flag and an unknown subcommand", async () => {
		const flag = await sk(["--format", "jsonl", "demo", "hello", "--nope", "x"]);
		expect(flag.code).toBe(EXIT_USAGE);
		const sub = await sk(["--format", "jsonl", "demo", "bogus"]);
		expect(sub.code).toBe(EXIT_USAGE);
		expect(String(sub.records[0]?.message)).toMatch(/choose one of: hello, notes/);
	});

	it("runs a group's default verb when the group is invoked bare", async () => {
		const withDefault: PluginSource = {
			entries: [{ package: "@example/demo", group: "demo" }],
			load: async () => ({
				default: { ...demoPlugin, root: { ...demoPlugin.root, default: "hello" } },
			}),
		};
		const bare = await sk(["--format", "jsonl", "demo", "--name", "Ada"], withDefault);
		expect(bare.code).toBe(EXIT_OK);
		expect(bare.records.length).toBeGreaterThan(0);
		const named = await sk(["--format", "jsonl", "demo", "hello", "--name", "Ada"], withDefault);
		expect(bare.records).toEqual(named.records);
	});

	it("asks for a subcommand when a group is invoked bare", async () => {
		const { code, records } = await sk(["--format", "jsonl", "demo", "notes"]);
		expect(code).toBe(EXIT_USAGE);
		expect(String(records[0]?.message)).toMatch(/sk demo notes: choose one of: read/);
	});
});

describe("root namespace", () => {
	const colliding = (group: string): PluginSource => ({
		entries: [{ package: "@example/clash", group }],
		load: async () => {
			throw new Error("a colliding plugin must be refused before it is imported");
		},
	});

	it.each([
		["query", /registry tool spellkave_query/],
		["validate", /file command validate/],
		["config", /core command config/],
	])("refuses a plugin group named %s before loading it", async (group, owner) => {
		const { code, records } = await sk(["--format", "jsonl", "list"], colliding(group));
		expect(code).toBe(EXIT_USAGE);
		expect(String(records[0]?.message)).toMatch(/sk plugin @example\/clash/);
		expect(String(records[0]?.message)).toMatch(owner);
	});

	it("reserves every root name the core dispatch branches on", () => {
		// The reservation list is hand-kept; this ties it to the dispatch code so
		// a new core command cannot silently lose its name to a plugin group.
		const source = readFileSync(new URL("../cli.ts", import.meta.url), "utf8");
		const start = source.indexOf("async function runCliDispatch(");
		const end = source.indexOf("\n}\n", start);
		const body = source.slice(start, end);
		const aliases = source.slice(
			source.indexOf("function registryCommand("),
			source.indexOf("function emitHelp("),
		);
		const dispatched = [...`${body}\n${aliases}`.matchAll(/\bcommand === "([a-z-]+)"/g)].map(
			(match) => match[1],
		);
		expect(dispatched.length).toBeGreaterThan(0);
		expect([...new Set(dispatched)].sort()).toEqual([...CORE_COMMANDS].sort());
	});

	it("refuses two plugins mounting the same group", async () => {
		const source: PluginSource = {
			entries: [
				{ package: "@example/demo", group: "demo" },
				{ package: "@example/other", group: "demo" },
			],
			load: demoSource.load,
		};
		const { code, records } = await sk(["--format", "jsonl", "list"], source);
		expect(code).toBe(EXIT_USAGE);
		expect(String(records[0]?.message)).toMatch(/collides with plugin @example\/demo/);
	});

	it("refuses a plugin whose root name differs from its entry", async () => {
		const source: PluginSource = {
			entries: [{ package: "@example/demo", group: "other" }],
			load: demoSource.load,
		};
		const { code, records } = await sk(["--format", "jsonl", "other", "hello"], source);
		expect(code).toBe(EXIT_USAGE);
		expect(String(records[0]?.message)).toMatch(/mounts it as "other"/);
	});
});

describe("plugin list, list, help, tool", () => {
	it("sk plugin list reports each plugin with its verb paths", async () => {
		const { code, records } = await sk(["--format", "jsonl", "plugin", "list"]);
		expect(code).toBe(EXIT_OK);
		expect(records).toEqual([
			{
				kind: "plugin",
				package: "@example/demo",
				group: "demo",
				description: "Demo plugin for the sk plugin contract tests.",
				verbs: [
					["demo", "hello"],
					["demo", "notes", "read"],
				],
			},
		]);
	});

	it("sk list carries plugin verbs with their full path", async () => {
		const { code, records } = await sk(["--format", "jsonl", "list"]);
		expect(code).toBe(EXIT_OK);
		const tools = (records[0] as { tools: Array<Record<string, unknown>> }).tools;
		const plugin = tools.filter((tool) => tool.facing === "plugin");
		expect(plugin.map((tool) => tool.path)).toEqual([
			["demo", "hello"],
			["demo", "notes", "read"],
		]);
		expect(plugin[0]).toMatchObject({ package: "@example/demo", available: true });
	});

	it("sk help <group> lists children; sk help <group> <verb> shows flags", async () => {
		const group = await sk(["help", "demo"]);
		expect(group.code).toBe(EXIT_OK);
		expect(group.out.join("\n")).toMatch(/hello\s+Greet someone/);
		expect(group.out.join("\n")).toMatch(/notes …\s+Note commands\./);

		const verb = await sk(["help", "demo", "hello"]);
		expect(verb.out.join("\n")).toMatch(/Usage: sk demo hello \[name\] \[flags\]/);
		expect(verb.out.join("\n")).toMatch(/--name <string>\s+\(required\)/);
		expect(verb.out.join("\n")).toMatch(/--shout/);
	});

	it("sk help lists plugin groups", async () => {
		const { out } = await sk(["help"]);
		expect(out.join("\n")).toMatch(/Plugins — command groups/);
		expect(out.join("\n")).toMatch(/demo\s+Demo plugin/);
	});

	it("sk tool <name> needs a name and rejects an unknown one", async () => {
		expect((await sk(["--format", "jsonl", "tool"])).code).toBe(EXIT_USAGE);
		const unknown = await sk(["--format", "jsonl", "tool", "no_such_tool"]);
		expect(unknown.code).toBe(EXIT_USAGE);
		expect(String(unknown.records[0]?.message)).toMatch(/unknown tool/);
	});
});

describe("readPluginEntries", () => {
	it("reads an absent list as empty and rejects malformed entries", () => {
		expect(readPluginEntries("{}")).toEqual([]);
		expect(readPluginEntries('{"sk":{"plugins":[{"package":"@a/b","group":"b"}]}}')).toEqual([
			{ package: "@a/b", group: "b" },
		]);
		expect(() => readPluginEntries('{"sk":{"plugins":["@a/b"]}}')).toThrow(/sk.plugins\[0\]/);
	});

	it("the shipped package.json parses", async () => {
		const { readFileSync } = await import("node:fs");
		const text = readFileSync(new URL("../../package.json", import.meta.url), "utf8");
		expect(() => readPluginEntries(text)).not.toThrow();
	});
});
