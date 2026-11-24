// The `sk` plugin contract (ADR-0144 D-3, D-8).
//
// A plugin is a workspace package whose default export is an `SkPlugin`: one
// root group mounted at `sk <root.name>`, holding groups and verbs. A verb has
// exactly the shape an author-facing registry tool has — a typebox
// `parameters` schema plus a function — so `@spellkave/cli` derives its flags,
// validation and help through the same path it uses for registry tools, and
// the verb body is typed by `Static<typeof parameters>`.
//
// This package depends on nothing in `@spellkave/cli`. The CLI depends on
// every plugin it lists, so a plugin importing the CLI would be a cycle; the
// pieces a verb needs from the CLI (output, host, config, connection) arrive
// through `SkContext` instead.

import type { Static, TSchema } from "typebox";

export { createNodeHost } from "./node-host.ts";

// --- Exit codes: one ladder for the core and every plugin. ---

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_IN_WORLD = 2;
/** Advisory findings only (e.g. `sk lint --strict`); opt-in by contract. */
export const EXIT_LINT = 3;

export type ExitCode = typeof EXIT_OK | typeof EXIT_USAGE | typeof EXIT_IN_WORLD | typeof EXIT_LINT;

// --- What a verb receives. ---

/** One structured output record. `kind` is snake_case by convention. */
export type OutputRecord = Record<string, unknown>;

/**
 * The output sink every verb writes through. Records are canonical JSONL when
 * stdout is not a TTY and rendered Markdown under `--format human`; `hint`
 * lines are human-only; `err` goes to stderr in every format. `toon` is the
 * token-lean text form of the same record (`--format toon`).
 */
export interface OutputSink {
	record(value: OutputRecord): void;
	err(line: string): void;
	hint(line: string): void;
	readonly format: "human" | "jsonl" | "toon";
}

/**
 * Every side effect a verb needs that is not output. Injected so a verb runs
 * in a test with no process, no real filesystem and no real clock. Keep it
 * small: a verb that needs a new capability adds a named method here rather
 * than importing `node:` directly (the `@spellkave/ops` `HostDeps` rule).
 */
export interface HostDeps {
	readonly cwd: string;
	readonly env: Readonly<Record<string, string | undefined>>;
	/** File contents, or `null` when absent or unreadable. */
	readFile(filePath: string): string | null;
	exists(filePath: string): boolean;
	/** Creates parent directories, then writes the file. */
	writeFile(filePath: string, contents: string): void;
	/** Runs a command and returns its exit status and captured output. Never throws on a non-zero exit. */
	run(command: string, args: readonly string[], options?: { cwd?: string }): RunResult;
	/** Milliseconds since the epoch. */
	now(): number;
}

export interface RunResult {
	readonly status: number;
	readonly stdout: string;
	readonly stderr: string;
}

/** A world connection as the core resolves it for this invocation. */
export interface ResolvedConnection {
	readonly url: string;
	readonly db: string;
	readonly token: string | undefined;
	/** Set only when `--profile` supplied the connection. */
	readonly profile: string | undefined;
}

/** One effective configuration value and where it came from. */
export interface ConfigValue {
	readonly value: string | undefined;
	readonly source: string;
}

export interface SkContext {
	readonly out: OutputSink;
	readonly host: HostDeps;
	/** Effective configuration keyed by its dotted name (e.g. `output.format`). */
	readonly config: Readonly<Record<string, ConfigValue>>;
	/** Resolves the connection the same way `--live` does; throws a usage error when nothing resolves. */
	resolveConnection(): ResolvedConnection;
}

// --- The tree. ---

export interface SkVerb<P extends TSchema = TSchema> {
	readonly kind: "verb";
	readonly name: string;
	readonly description: string;
	readonly parameters: P;
	/** Parameter names that may also be given positionally, in order. */
	readonly positionals?: readonly string[];
	run(params: Static<P>, ctx: SkContext): Promise<ExitCode>;
}

export interface SkGroup {
	readonly kind: "group";
	readonly name: string;
	readonly description: string;
	readonly children: readonly SkNode[];
	/**
	 * A child verb to run when the group is called with no command, so a bare
	 * `sk <group>` shows content instead of a usage error. Flags after the
	 * group go to that verb.
	 */
	readonly default?: string;
}

// biome-ignore lint/suspicious/noExplicitAny: a node list holds verbs of many parameter schemas
export type SkNode = SkGroup | SkVerb<any>;

export interface SkPlugin {
	/** The package that exports this plugin; echoed in `sk plugin list` and errors. */
	readonly package: string;
	/** Mounted at `sk <root.name>`. */
	readonly root: SkGroup;
}

/** Typed constructor for a verb: `params` in `run` is `Static<P>`. */
export function defineVerb<P extends TSchema>(verb: Omit<SkVerb<P>, "kind">): SkVerb<P> {
	return { kind: "verb", ...verb };
}

export function defineGroup(group: Omit<SkGroup, "kind">): SkGroup {
	return { kind: "group", ...group };
}

export function definePlugin(plugin: SkPlugin): SkPlugin {
	return plugin;
}

// --- Validation of an imported plugin module. ---

export class PluginContractError extends Error {
	constructor(packageName: string, detail: string) {
		super(`sk plugin ${packageName}: ${detail}`);
		this.name = "PluginContractError";
	}
}

const NAME = /^[a-z][a-z0-9-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkNode(packageName: string, node: unknown, path: string): void {
	if (!isRecord(node)) throw new PluginContractError(packageName, `${path}: not an object`);
	const name = node.name;
	if (typeof name !== "string" || !NAME.test(name)) {
		throw new PluginContractError(packageName, `${path}: name must match ${NAME}`);
	}
	if (typeof node.description !== "string" || node.description.length === 0) {
		throw new PluginContractError(packageName, `${path} ${name}: description is required`);
	}
	if (node.kind === "verb") {
		if (!isRecord(node.parameters)) {
			throw new PluginContractError(
				packageName,
				`${path} ${name}: parameters must be a schema object`,
			);
		}
		if (typeof node.run !== "function") {
			throw new PluginContractError(packageName, `${path} ${name}: run must be a function`);
		}
		return;
	}
	if (node.kind !== "group") {
		throw new PluginContractError(packageName, `${path} ${name}: kind must be "group" or "verb"`);
	}
	if (!Array.isArray(node.children)) {
		throw new PluginContractError(packageName, `${path} ${name}: children must be an array`);
	}
	const seen = new Set<string>();
	for (const child of node.children) {
		checkNode(packageName, child, `${path} ${name}`);
		const childName = (child as { name: string }).name;
		if (seen.has(childName)) {
			throw new PluginContractError(packageName, `${path} ${name}: duplicate child ${childName}`);
		}
		seen.add(childName);
	}
	if (node.default !== undefined) {
		const target = (node.children as { name: string; kind: string }[]).find(
			(child) => child.name === node.default,
		);
		if (target?.kind !== "verb") {
			throw new PluginContractError(
				packageName,
				`${path} ${name}: default ${JSON.stringify(node.default)} must name a child verb`,
			);
		}
	}
}

/**
 * Validate an imported module against the contract. Accepts the module
 * namespace (reads `default`) or the plugin value itself.
 */
export function validatePlugin(packageName: string, imported: unknown): SkPlugin {
	const candidate = isRecord(imported) && "default" in imported ? imported.default : imported;
	if (!isRecord(candidate) || !("root" in candidate)) {
		throw new PluginContractError(packageName, "default export is not a plugin object");
	}
	if (candidate.package !== packageName) {
		throw new PluginContractError(
			packageName,
			`plugin declares package ${JSON.stringify(candidate.package)}, expected ${JSON.stringify(packageName)}`,
		);
	}
	checkNode(packageName, candidate.root, "root");
	if ((candidate.root as { kind: unknown }).kind !== "group") {
		throw new PluginContractError(packageName, "root must be a group");
	}
	return candidate as unknown as SkPlugin;
}

/** Every verb under `node`, with its path from the mount point. */
export function verbPaths(node: SkNode, prefix: readonly string[] = []): string[][] {
	const path = [...prefix, node.name];
	if (node.kind === "verb") return [path];
	return node.children.flatMap((child) => verbPaths(child, path));
}
