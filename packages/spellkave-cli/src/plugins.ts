// Optional CLI extensions use the same typed contract as the built-in CLI.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { type SkGroup, type SkNode, type SkPlugin, validatePlugin } from "@spellkave/cli-plugin";

import { UsageError } from "./args.ts";

export interface PluginEntry {
	readonly package: string;
	readonly group: string;
}

/** Where plugin entries and modules come from. Tests inject their own. */
export interface PluginSource {
	readonly entries: readonly PluginEntry[];
	load(packageName: string): Promise<unknown>;
}

/** Parse the `sk.plugins` list out of a `package.json` text. */
export function readPluginEntries(packageJsonText: string): PluginEntry[] {
	const parsed = JSON.parse(packageJsonText) as { sk?: { plugins?: unknown } };
	const list = parsed.sk?.plugins ?? [];
	if (!Array.isArray(list)) throw new Error("package.json sk.plugins must be an array");
	return list.map((entry, index) => {
		const candidate = entry as Partial<PluginEntry> | null;
		if (
			candidate === null ||
			typeof candidate !== "object" ||
			typeof candidate.package !== "string" ||
			typeof candidate.group !== "string"
		) {
			throw new Error(
				`package.json sk.plugins[${index}] must be { "package": string, "group": string }`,
			);
		}
		return { package: candidate.package, group: candidate.group };
	});
}

const OWN_PACKAGE_JSON = new URL("../package.json", import.meta.url);

export function defaultPluginSource(): PluginSource {
	const manifest = process.env.SPELLKAVE_PLUGIN_MANIFEST;
	if (!manifest) {
		return {
			entries: readPluginEntries(readFileSync(OWN_PACKAGE_JSON, "utf8")),
			load: (packageName) => import(packageName),
		};
	}
	const path = resolve(manifest);
	const require = createRequire(path);
	return {
		entries: readPluginEntries(readFileSync(path, "utf8")),
		load: (packageName) => import(pathToFileURL(require.resolve(packageName)).href),
	};
}

/**
 * One namespace at the root: registry tools, file commands, core commands and
 * plugin groups. `reserved` maps every non-plugin root name to its owner
 * label. A plugin group that collides with it, or with another plugin, is a
 * load error naming both owners.
 */
export function checkRootCollisions(
	entries: readonly PluginEntry[],
	reserved: ReadonlyMap<string, string>,
): void {
	const seen = new Map<string, string>();
	for (const entry of entries) {
		const owner = reserved.get(entry.group) ?? seen.get(entry.group);
		if (owner !== undefined) {
			throw new UsageError(
				`sk plugin ${entry.package}: group ${JSON.stringify(entry.group)} collides with ${owner}.`,
			);
		}
		seen.set(entry.group, `plugin ${entry.package}`);
	}
}

export async function loadPlugin(source: PluginSource, entry: PluginEntry): Promise<SkPlugin> {
	const plugin = validatePlugin(entry.package, await source.load(entry.package));
	if (plugin.root.name !== entry.group) {
		throw new UsageError(
			`sk plugin ${entry.package}: root group is ${JSON.stringify(plugin.root.name)}, ` +
				`but package.json sk.plugins mounts it as ${JSON.stringify(entry.group)}.`,
		);
	}
	return plugin;
}

export async function loadAllPlugins(source: PluginSource): Promise<SkPlugin[]> {
	return Promise.all(source.entries.map((entry) => loadPlugin(source, entry)));
}

/**
 * Walk `tokens` down from `root`. Stops at the first verb, at the first token
 * that is a flag, or when the tokens run out. `consumed` counts the tokens
 * used to reach `node` (the root's own name included).
 */
export function resolveNode(
	root: SkGroup,
	tokens: readonly string[],
): { node: SkNode; path: string[]; consumed: number } {
	let node: SkNode = root;
	const path = [root.name];
	let consumed = 1;
	while (node.kind === "group") {
		const token = tokens[consumed];
		if (token === undefined || token.startsWith("-")) break;
		const child: SkNode | undefined = node.children.find((candidate) => candidate.name === token);
		if (child === undefined) {
			throw new UsageError(
				`sk ${path.join(" ")}: unknown command ${JSON.stringify(token)} — ` +
					`choose one of: ${node.children.map((candidate) => candidate.name).join(", ")}.`,
			);
		}
		node = child;
		path.push(child.name);
		consumed += 1;
	}
	return { node, path, consumed };
}
