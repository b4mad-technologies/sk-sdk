import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse as parsePath, resolve } from "node:path";

import { appConfigFile } from "@spellkave/sdk";
import { resolveCliPaths } from "@spellkave/sdk/node";
import { parse, stringify, type TomlTable } from "smol-toml";

import { UsageError } from "./args.ts";
import { SK_SCRATCH_DIR } from "./workspace.ts";

export type ConfigSource = "built-in" | "defaults" | "global" | "project" | "environment" | "flag";
export type ConfigKey =
	| "author.workspace"
	| "author.target"
	| "author.default-bundle"
	| `author.dependencies.${string}`
	| "output.format"
	| "dev.seed"
	| "dev.backend"
	| "dev.golden";

export interface SkConfigPaths {
	global: string;
	project: string;
	/** Tracked repository defaults (`.spellkave/defaults.toml`): author.dependencies only. */
	defaults: string;
	projectRoot: string;
}

export interface ResolvedConfigValue<T> {
	value: T;
	source: ConfigSource;
	display: string;
}

export interface ResolvedSkConfig {
	paths: SkConfigPaths;
	dependencies: Record<string, ResolvedConfigValue<string>>;
	format: ResolvedConfigValue<"auto" | "human" | "jsonl" | "toon">;
	workspace: ResolvedConfigValue<string>;
	target: ResolvedConfigValue<string | undefined>;
	defaultBundle: ResolvedConfigValue<string | undefined>;
	/** Manifest `sk dev up` seeds when no `--seed` is given (sk-mts: no built-in default). */
	devSeed: ResolvedConfigValue<string | undefined>;
	/** Where `sk dev` runs the world: `pool` (leased stdb-pool world) or `local` (this worktree's node). */
	devBackend: ResolvedConfigValue<"pool" | "local" | undefined>;
	/** `true`: `sk dev up --seed` keys the world like CI and keeps a local golden (ci-golden-world-cache). */
	devGolden: ResolvedConfigValue<"true" | "false" | undefined>;
}

interface SkConfigFile {
	author?: {
		workspace?: string;
		target?: string;
		default_bundle?: string;
		dependencies?: Record<string, string>;
	};
	output?: {
		format?: "auto" | "human" | "jsonl" | "toon";
	};
	dev?: {
		seed?: string;
		backend?: "pool" | "local";
		golden?: "true" | "false";
	};
}

function findProjectRoot(cwd: string): { root: string; config?: string } {
	let current = resolve(cwd);
	let repositoryRoot: string | undefined;
	while (true) {
		const candidate = join(current, ".spellkave", "config.toml");
		if (existsSync(candidate)) return { root: current, config: candidate };
		if (repositoryRoot === undefined && existsSync(join(current, ".git"))) {
			repositoryRoot = current;
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	const root = repositoryRoot ?? resolve(cwd);
	return { root, config: undefined };
}

export function resolveSkConfigPaths(
	cwd = process.cwd(),
	env: NodeJS.ProcessEnv = process.env,
): SkConfigPaths {
	const project = findProjectRoot(cwd);
	return {
		global: appConfigFile(resolveCliPaths({ env })),
		project: project.config ?? join(project.root, ".spellkave", "config.toml"),
		defaults: join(project.root, ".spellkave", "defaults.toml"),
		projectRoot: project.root,
	};
}

function table(value: unknown, label: string, path: string): TomlTable | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new UsageError(`${path}: ${label} must be a TOML table.`);
	}
	return value as TomlTable;
}

function optionalString(value: unknown, label: string, path: string): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== "string" || value.length === 0) {
		throw new UsageError(`${path}: ${label} must be a non-empty string.`);
	}
	return value;
}

/**
 * Tracked repository defaults: only dependency manifests, relative to the repository
 * root. Personal settings (target, workspace, output, dev) never come from a tracked file.
 */
function readDefaults(path: string): SkConfigFile {
	const config = readConfig(path);
	const extra = Object.keys(config).filter((key) => key !== "author");
	const author = Object.keys(config.author ?? {}).filter((key) => key !== "dependencies");
	if (extra.length || author.length)
		throw new UsageError(
			`${path}: tracked defaults may only set author.dependencies (found ${[...extra, ...author.map((key) => `author.${key}`)].join(", ")}).`,
		);
	for (const [id, value] of Object.entries(config.author?.dependencies ?? {}))
		if (isAbsolute(value) || value.startsWith("~"))
			throw new UsageError(
				`${path}: author.dependencies.${id} must be relative to the repository root.`,
			);
	return config;
}

function readConfig(path: string): SkConfigFile {
	if (!existsSync(path)) return {};
	let parsed: TomlTable;
	try {
		parsed = parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new UsageError(
			`${path}: invalid TOML (${error instanceof Error ? error.message : String(error)}).`,
		);
	}
	const author = table(parsed.author, "[author]", path);
	const output = table(parsed.output, "[output]", path);
	const dependencyTable = table(author?.dependencies, "author.dependencies", path);
	const dependencies: Record<string, string> = Object.create(null);
	for (const [id, value] of Object.entries(dependencyTable ?? {})) {
		if (!id.trim()) throw new UsageError(`${path}: dependency bundle ID must not be empty.`);
		if (typeof value !== "string" || !value.trim()) {
			throw new UsageError(`${path}: author.dependencies.${id} must be a non-empty manifest path.`);
		}
		dependencies[id] = value;
	}
	const dev = table(parsed.dev, "[dev]", path);
	const devSeed = optionalString(dev?.seed, "dev.seed", path);
	const devBackend = optionalString(dev?.backend, "dev.backend", path);
	if (devBackend !== undefined && devBackend !== "pool" && devBackend !== "local") {
		throw new UsageError(
			`${path}: dev.backend must be pool or local; received ${JSON.stringify(devBackend)}.`,
		);
	}
	const devGolden = optionalString(dev?.golden, "dev.golden", path);
	if (devGolden !== undefined && devGolden !== "true" && devGolden !== "false") {
		throw new UsageError(
			`${path}: dev.golden must be true or false; received ${JSON.stringify(devGolden)}.`,
		);
	}
	const workspace = optionalString(author?.workspace, "author.workspace", path);
	const target = optionalString(author?.target, "author.target", path);
	const defaultBundle = optionalString(author?.default_bundle, "author.default_bundle", path);
	const format = optionalString(output?.format, "output.format", path);
	if (
		format !== undefined &&
		format !== "auto" &&
		format !== "human" &&
		format !== "jsonl" &&
		format !== "toon"
	) {
		throw new UsageError(
			`${path}: output.format must be auto, human, jsonl, or toon; received ${JSON.stringify(format)}.`,
		);
	}
	return {
		...(author === undefined
			? {}
			: {
					author: {
						dependencies,
						...(workspace === undefined ? {} : { workspace }),
						...(target === undefined ? {} : { target }),
						...(defaultBundle === undefined ? {} : { default_bundle: defaultBundle }),
					},
				}),
		...(output === undefined || format === undefined
			? {}
			: { output: { format: format as "auto" | "human" | "jsonl" | "toon" } }),
		...(devSeed === undefined && devBackend === undefined && devGolden === undefined
			? {}
			: {
					dev: {
						...(devSeed === undefined ? {} : { seed: devSeed }),
						...(devBackend === undefined ? {} : { backend: devBackend as "pool" | "local" }),
						...(devGolden === undefined ? {} : { golden: devGolden as "true" | "false" }),
					},
				}),
	};
}

function configuredPath(value: string, source: ConfigSource, paths: SkConfigPaths): string {
	if (isAbsolute(value)) return value;
	if (source === "project") return resolve(paths.projectRoot, value);
	return value;
}

export function loadSkConfig(env = process.env, cwd = process.cwd()): ResolvedSkConfig {
	const paths = resolveSkConfigPaths(cwd, env);
	const global = readConfig(paths.global);
	const project = readConfig(paths.project);
	const defaults = readDefaults(paths.defaults);
	const dependencies: ResolvedSkConfig["dependencies"] = Object.create(null);

	let format: ResolvedSkConfig["format"] = {
		value: "auto",
		display: "auto",
		source: "built-in",
	};
	let workspace: ResolvedSkConfig["workspace"] = {
		value: SK_SCRATCH_DIR,
		display: SK_SCRATCH_DIR,
		source: "built-in",
	};
	let target: ResolvedSkConfig["target"] = {
		value: undefined,
		display: "none",
		source: "built-in",
	};
	let defaultBundle: ResolvedSkConfig["defaultBundle"] = {
		value: undefined,
		display: "none",
		source: "built-in",
	};
	let devSeed: ResolvedSkConfig["devSeed"] = {
		value: undefined,
		display: "none",
		source: "built-in",
	};
	// No built-in value here: `sk dev` picks pool, or local under CI.
	let devBackend: ResolvedSkConfig["devBackend"] = {
		value: undefined,
		display: "none",
		source: "built-in",
	};
	let devGolden: ResolvedSkConfig["devGolden"] = {
		value: undefined,
		display: "none",
		source: "built-in",
	};

	for (const [source, config] of [
		["defaults", defaults],
		["global", global],
		["project", project],
	] as const) {
		for (const [id, path] of Object.entries(config.author?.dependencies ?? {})) {
			dependencies[id] = {
				// Preserve a literal tilde until the dependency is used, so a per-call
				// fixture-root override can bypass an invalid stored mapping.
				value: path.startsWith("~")
					? path
					: resolve(source === "global" ? dirname(paths.global) : paths.projectRoot, path),
				display: path,
				source,
			};
		}
		if (config.output?.format !== undefined) {
			format = { value: config.output.format, display: config.output.format, source };
		}
		if (config.author?.workspace !== undefined) {
			workspace = {
				value: configuredPath(config.author.workspace, source, paths),
				display: config.author.workspace,
				source,
			};
		}
		if (config.author?.target !== undefined) {
			target = {
				value: configuredPath(config.author.target, source, paths),
				display: config.author.target,
				source,
			};
		}
		if (config.author?.default_bundle !== undefined) {
			defaultBundle = {
				value: config.author.default_bundle,
				display: config.author.default_bundle,
				source,
			};
		}
		if (config.dev?.seed !== undefined) {
			devSeed = {
				value: configuredPath(config.dev.seed, source, paths),
				display: config.dev.seed,
				source,
			};
		}
		if (config.dev?.backend !== undefined) {
			devBackend = { value: config.dev.backend, display: config.dev.backend, source };
		}
		if (config.dev?.golden !== undefined) {
			devGolden = { value: config.dev.golden, display: config.dev.golden, source };
		}
	}

	if (env.SPELLKAVE_AUTHOR_WORKSPACE) {
		workspace = {
			value: env.SPELLKAVE_AUTHOR_WORKSPACE,
			display: env.SPELLKAVE_AUTHOR_WORKSPACE,
			source: "environment",
		};
	}
	if (env.SPELLKAVE_AUTHOR_LOCAL_TARGET) {
		target = {
			value: env.SPELLKAVE_AUTHOR_LOCAL_TARGET,
			display: env.SPELLKAVE_AUTHOR_LOCAL_TARGET,
			source: "environment",
		};
	}
	if (env.SPELLKAVE_AUTHOR_BUNDLE) {
		defaultBundle = {
			value: env.SPELLKAVE_AUTHOR_BUNDLE,
			display: env.SPELLKAVE_AUTHOR_BUNDLE,
			source: "environment",
		};
	}

	if (env.SPELLKAVE_DEV_SEED) {
		devSeed = {
			value: env.SPELLKAVE_DEV_SEED,
			display: env.SPELLKAVE_DEV_SEED,
			source: "environment",
		};
	}

	const envBackend = env.SPELLKAVE_DEV_BACKEND;
	if (envBackend) {
		if (envBackend !== "pool" && envBackend !== "local") {
			throw new UsageError(
				`SPELLKAVE_DEV_BACKEND must be pool or local; received ${JSON.stringify(envBackend)}.`,
			);
		}
		devBackend = { value: envBackend, display: envBackend, source: "environment" };
	}

	return {
		paths,
		dependencies,
		format,
		workspace,
		target,
		defaultBundle,
		devSeed,
		devBackend,
		devGolden,
	};
}

export function configRows(config: ResolvedSkConfig): Array<{
	key: ConfigKey;
	value: string;
	source: ConfigSource;
}> {
	return [
		{ key: "author.workspace", value: config.workspace.display, source: config.workspace.source },
		{ key: "author.target", value: config.target.display, source: config.target.source },
		{
			key: "author.default-bundle",
			value: config.defaultBundle.display,
			source: config.defaultBundle.source,
		},
		{ key: "output.format", value: config.format.display, source: config.format.source },
		{ key: "dev.seed", value: config.devSeed.display, source: config.devSeed.source },
		{ key: "dev.backend", value: config.devBackend.display, source: config.devBackend.source },
		{ key: "dev.golden", value: config.devGolden.display, source: config.devGolden.source },
		...Object.entries(config.dependencies)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([id, entry]) => ({
				key: `author.dependencies.${id}` as ConfigKey,
				value: entry.display,
				source: entry.source,
			})),
	];
}

/**
 * The effective values as plugins see them (`SkContext.config`): the resolved
 * value, `undefined` when unset — never the `"none"` display text that
 * `configRows` prints.
 */
export function configValues(
	config: ResolvedSkConfig,
): Record<ConfigKey, { value: string | undefined; source: ConfigSource }> {
	return {
		"author.workspace": { value: config.workspace.value, source: config.workspace.source },
		"author.target": { value: config.target.value, source: config.target.source },
		"author.default-bundle": {
			value: config.defaultBundle.value,
			source: config.defaultBundle.source,
		},
		"output.format": { value: config.format.value, source: config.format.source },
		"dev.seed": { value: config.devSeed.value, source: config.devSeed.source },
		"dev.backend": { value: config.devBackend.value, source: config.devBackend.source },
		"dev.golden": { value: config.devGolden.value, source: config.devGolden.source },
		...Object.fromEntries(
			Object.entries(config.dependencies).map(([id, entry]) => [
				`author.dependencies.${id}`,
				{ value: entry.value, source: entry.source },
			]),
		),
	};
}

const CONFIG_KEYS = new Set<ConfigKey>([
	"author.workspace",
	"author.target",
	"author.default-bundle",
	"output.format",
	"dev.seed",
	"dev.backend",
	"dev.golden",
]);

export function setConfigValue(
	scope: "project" | "global",
	key: string,
	value: string,
	paths: SkConfigPaths,
): string {
	if (!CONFIG_KEYS.has(key as ConfigKey) && dependencyId(key) === undefined) {
		throw new UsageError(
			`sk config set: unknown key ${JSON.stringify(key)} — expected ${[...CONFIG_KEYS].join(", ")}.`,
		);
	}
	if (!value.trim()) throw new UsageError("sk config set: value must not be empty.");
	if (
		key === "output.format" &&
		value !== "auto" &&
		value !== "human" &&
		value !== "jsonl" &&
		value !== "toon"
	) {
		throw new UsageError("sk config set: output.format must be auto, human, jsonl, or toon.");
	}
	if (key === "dev.backend" && value !== "pool" && value !== "local") {
		throw new UsageError("sk config set: dev.backend must be pool or local.");
	}
	if (key === "dev.golden" && value !== "true" && value !== "false") {
		throw new UsageError("sk config set: dev.golden must be true or false.");
	}

	const path = scope === "project" ? paths.project : paths.global;
	if (dependencyId(key) !== undefined && value.startsWith("~")) {
		throw new UsageError(`${key}: literal ~ paths are not expanded; use an absolute path instead.`);
	}
	const document = existsSync(path) ? parse(readFileSync(path, "utf8")) : {};
	const [sectionName, rawName] = tomlLocation(key as ConfigKey);
	const parent = configParent(document, key, path, true);
	const section = table(parent[sectionName], `[${sectionName}]`, path) ?? {};
	section[rawName] = value;
	parent[sectionName] = section;
	writeConfig(path, document);
	return path;
}

function dependencyId(key: string): string | undefined {
	const prefix = "author.dependencies.";
	return key.startsWith(prefix) && key.slice(prefix.length).trim().length > 0
		? key.slice(prefix.length)
		: undefined;
}

function configParent(document: TomlTable, key: string, path: string, create: boolean): TomlTable {
	if (dependencyId(key) === undefined) return document;
	const author = table(document.author, "[author]", path) ?? {};
	if (create) document.author = author;
	return author;
}

/** Where a key lives inside its parent table. */
function tomlLocation(key: ConfigKey): [string, string] {
	const id = dependencyId(key);
	if (id !== undefined) return ["dependencies", id];
	return key === "author.default-bundle"
		? ["author", "default_bundle"]
		: (key.split(".") as [string, string]);
}

function writeConfig(path: string, document: TomlTable): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${parsePath(path).base}.${process.pid}.tmp`);
	writeFileSync(temporary, stringify(document), { encoding: "utf8", mode: 0o600 });
	renameSync(temporary, path);
}

/**
 * Remove one key from a scope's file so the next layer (or the built-in
 * default) applies again. An emptied table is dropped; other keys and
 * unrelated top-level values stay. Removing an absent key is not an error.
 */
export function unsetConfigValue(
	scope: "project" | "global",
	key: string,
	paths: SkConfigPaths,
): { path: string; removed: boolean } {
	if (!CONFIG_KEYS.has(key as ConfigKey) && dependencyId(key) === undefined) {
		throw new UsageError(
			`sk config unset: unknown key ${JSON.stringify(key)} — expected ${[...CONFIG_KEYS].join(", ")}.`,
		);
	}
	const path = scope === "project" ? paths.project : paths.global;
	if (!existsSync(path)) return { path, removed: false };
	const document = parse(readFileSync(path, "utf8"));
	const [sectionName, rawName] = tomlLocation(key as ConfigKey);
	const parent = configParent(document, key, path, false);
	const section = table(parent[sectionName], `[${sectionName}]`, path);
	if (section === undefined || !(rawName in section)) return { path, removed: false };
	delete section[rawName];
	if (Object.keys(section).length === 0) delete parent[sectionName];
	writeConfig(path, document);
	return { path, removed: true };
}
