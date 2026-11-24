/**
 * Offline TOML bundle loader for the world-osm CLI.
 *
 * Mirrors the include-merge half of `packages/spellkave-cli/src/bundle.ts`
 * without pulling the CLI package (avoids a heavy dependency for a pure
 * projection tool). Uses smol-toml with `integersAsBigInt: "asNeeded"` so
 * H3 cell ids stay lossless.
 *
 * This module may use `node:fs` — it is CLI-only, not part of the pure barrel.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";

import type { WorldOsmInput } from "./rows.ts";

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function rowsOf(manifest: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const v = manifest[key];
	if (!Array.isArray(v)) return [];
	return v.filter(isRecord);
}

function mergeDocuments(documents: string[]): Record<string, unknown> {
	const merged: Record<string, unknown> = {};
	for (const toml of documents) {
		if (toml.trim().length === 0) continue;
		let part: Record<string, unknown>;
		try {
			part = parseToml(toml, { integersAsBigInt: "asNeeded" }) as Record<string, unknown>;
		} catch {
			try {
				part = parseToml(toml, { integersAsBigInt: true }) as Record<string, unknown>;
			} catch {
				continue;
			}
		}
		for (const [key, value] of Object.entries(part)) {
			if (Array.isArray(value)) {
				const existing = merged[key];
				merged[key] = Array.isArray(existing) ? [...existing, ...value] : [...value];
			} else if (merged[key] === undefined) {
				merged[key] = value;
			}
		}
	}
	return merged;
}

async function resolveManifestPath(bundleDirOrFile: string): Promise<string> {
	const abs = resolve(bundleDirOrFile);
	const st = await stat(abs);
	if (st.isFile()) return abs;
	const candidates: string[] = [
		join(abs, "adventure.manifest.toml"),
		join(abs, "manifest.toml"),
		join(abs, "..", "adventure.manifest.toml"),
	];
	try {
		const extras = (await readdir(abs))
			.filter((name) => name.endsWith(".manifest.toml") && name !== "adventure.manifest.toml")
			.sort()
			.map((name) => join(abs, name));
		candidates.push(...extras);
	} catch {
		/* ignore */
	}
	for (const c of candidates) {
		try {
			const s = await stat(c);
			if (s.isFile()) return c;
		} catch {
			/* try next */
		}
	}
	throw new Error(`No manifest.toml / *.manifest.toml under ${abs}`);
}

async function readIncludes(
	manifestPath: string,
	rootToml: string,
): Promise<{ bodies: string[]; included: string[] }> {
	const dir = dirname(manifestPath);
	let parsed: Record<string, unknown> = {};
	try {
		parsed = parseToml(rootToml, { integersAsBigInt: "asNeeded" }) as Record<string, unknown>;
	} catch {
		try {
			parsed = parseToml(rootToml, { integersAsBigInt: true }) as Record<string, unknown>;
		} catch {
			/* empty */
		}
	}
	const includes = Array.isArray(parsed.include) ? parsed.include : [];
	const bodies: string[] = [];
	const included: string[] = [];
	for (const entry of includes) {
		if (!isRecord(entry) || typeof entry.path !== "string") continue;
		const p = resolve(dir, entry.path);
		try {
			bodies.push(await readFile(p, "utf8"));
			included.push(entry.path);
		} catch {
			/* missing include skipped */
		}
	}
	return { bodies, included };
}

export interface LoadedBundle {
	rows: WorldOsmInput;
	manifestPath: string;
	includedFiles: string[];
}

/** Load a bundle directory (or manifest path) into plain spatial rows. */
export async function loadBundle(bundleDirOrFile: string): Promise<LoadedBundle> {
	const manifestPath = await resolveManifestPath(bundleDirOrFile);
	const rootToml = await readFile(manifestPath, "utf8");
	const { bodies, included } = await readIncludes(manifestPath, rootToml);
	const manifest = mergeDocuments([rootToml, ...bodies]);

	return {
		rows: {
			place_graphs: rowsOf(manifest, "place_graphs"),
			place_nodes: rowsOf(manifest, "place_nodes"),
			place_edges: rowsOf(manifest, "place_edges"),
			map_layers: rowsOf(manifest, "map_layers"),
			substrate_definitions: rowsOf(manifest, "substrate_definitions"),
			bundles: rowsOf(manifest, "bundles"),
			metadata_attachments: rowsOf(manifest, "metadata_attachments"),
			place_edge_affordances: rowsOf(manifest, "place_edge_affordance"),
			spatial_niche_attachments: rowsOf(manifest, "spatial_niche_attachments"),
			niche_definitions: rowsOf(manifest, "niche_definitions"),
			spatial_environment_states: rowsOf(manifest, "spatial_environment_states"),
		},
		manifestPath,
		includedFiles: included,
	};
}

/** Load either a bundle dir/manifest or a pre-serialized rows.json. */
export async function loadRowsSource(path: string): Promise<LoadedBundle> {
	const abs = resolve(path);
	const st = await stat(abs);
	if (st.isFile() && abs.endsWith(".json")) {
		const raw = JSON.parse(await readFile(abs, "utf8")) as WorldOsmInput;
		return { rows: raw, manifestPath: abs, includedFiles: [] };
	}
	return loadBundle(abs);
}
