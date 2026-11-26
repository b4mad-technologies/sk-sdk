/**
 * Resolve authored [[map_layers]] rows to SpatialGraphBackdrop for SVG overlay.
 * Assets stay out-of-repo (SPELLKAVE_MAP_ASSETS_ROOT / FVTT_DATA_ROOT); missing
 * files → skip.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { SpatialGraphBackdrop } from "../svg/types.ts";

function gitSibling(name: string): string | null {
	try {
		const common = execSync("git rev-parse --path-format=absolute --git-common-dir", {
			stdio: ["ignore", "pipe", "ignore"],
		})
			.toString()
			.trim();
		const candidate = join(dirname(common), name);
		return existsSync(candidate) ? candidate : null;
	} catch {
		return null;
	}
}

/**
 * Root that holds one folder per asset module (`<root>/<asset_module>/...`).
 * Set by `SPELLKAVE_MAP_ASSETS_ROOT`; there is no built-in module or folder name.
 */
export function resolveMapAssetsRoot(env: NodeJS.ProcessEnv = process.env): string | null {
	return env.SPELLKAVE_MAP_ASSETS_ROOT?.trim() || null;
}

/** One path segment, so a module id cannot point outside the sibling folder. */
function isPlainModuleName(module: string): boolean {
	return module !== "" && module !== "." && module !== ".." && !/[\\/]/.test(module);
}

export function resolveFvttDataRoot(env: NodeJS.ProcessEnv = process.env): string | null {
	if (env.FVTT_DATA_ROOT?.trim()) return env.FVTT_DATA_ROOT.trim();
	return gitSibling("foundry-data");
}

/** PNG IHDR width/height without external deps. */
export function readPngSize(path: string): { width: number; height: number } | null {
	try {
		const fd = readFileSync(path);
		if (fd.length < 24 || fd[0] !== 0x89) return null;
		const width = fd.readUInt32BE(16);
		const height = fd.readUInt32BE(20);
		if (width <= 0 || height <= 0) return null;
		return { width, height };
	} catch {
		return null;
	}
}

export function resolveMapLayerAssetPath(
	row: Record<string, unknown>,
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	const assetPath = typeof row.asset_path === "string" ? row.asset_path : "";
	const module = typeof row.asset_module === "string" ? row.asset_module : "";
	if (!assetPath) return null;
	if (isAbsolute(assetPath) && existsSync(assetPath)) return assetPath;

	const roots: string[] = [];
	const assetsRoot = resolveMapAssetsRoot(env);
	if (assetsRoot) {
		if (module) roots.push(join(assetsRoot, module));
		roots.push(assetsRoot);
	}
	// A checkout named like the module, next to this repository.
	if (isPlainModuleName(module)) {
		const sibling = gitSibling(module);
		if (sibling) roots.push(sibling);
	}
	const fvtt = resolveFvttDataRoot(env);
	if (fvtt) {
		roots.push(fvtt);
		if (module) roots.push(join(fvtt, module));
	}

	for (const root of roots) {
		const candidate = join(root, assetPath);
		if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
		// asset_path sometimes already includes maps/
		const bare = join(root, "maps", assetPath.replace(/^maps\//, ""));
		if (existsSync(bare) && statSync(bare).isFile()) return bare;
	}
	return null;
}

/**
 * resvg does not load `file://` reliably — embed a resolved local backdrop
 * asset as a base64 data URI instead. `null` when the asset can't be read
 * (missing file, permissions) — callers treat that the same as "no backdrop"
 * rather than failing the render. Same idea as
 * `packages/spellkave-srd-cc/src/author/kavemouth/renders.ts`'s own
 * `backdropDataHref` (kept there byte-for-byte, not consolidated, so this
 * addition never risks that file's own churn-guarded renders).
 */
export function backdropAssetDataHref(backdrop: SpatialGraphBackdrop): string | null {
	const asset = backdrop.asset;
	if (!asset) return null;
	if (asset.startsWith("data:")) return asset;
	try {
		const path = asset.startsWith("file:") ? fileURLToPath(asset) : asset;
		const buf = readFileSync(path);
		const ext = extname(path).toLowerCase();
		const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
		return `data:${mime};base64,${buf.toString("base64")}`;
	} catch {
		return null;
	}
}

/**
 * Build backdrop descriptors from map_layers rows. Only layers whose asset
 * resolves on disk are included (CI-safe when the assets are absent).
 */
export function mapLayersToBackdrops(
	layers: readonly Record<string, unknown>[],
	env: NodeJS.ProcessEnv = process.env,
): { backdrops: SpatialGraphBackdrop[]; resolved: number; skipped: number } {
	const backdrops: SpatialGraphBackdrop[] = [];
	let skipped = 0;
	for (const row of layers) {
		const graphId = typeof row.place_graph_id === "string" ? row.place_graph_id : "";
		if (!graphId) {
			skipped += 1;
			continue;
		}
		const abs = resolveMapLayerAssetPath(row, env);
		if (abs === null) {
			skipped += 1;
			continue;
		}
		const png = readPngSize(abs);
		const gridSize =
			typeof row.grid_size_px === "number" && row.grid_size_px > 0 ? row.grid_size_px : 100;
		const widthPx =
			typeof row.image_width_px === "number" && row.image_width_px > 0
				? row.image_width_px
				: (png?.width ?? 1000);
		const heightPx =
			typeof row.image_height_px === "number" && row.image_height_px > 0
				? row.image_height_px
				: (png?.height ?? 1000);
		const widthCells =
			typeof row.local_width_cells === "number" && row.local_width_cells > 0
				? row.local_width_cells
				: widthPx / gridSize;
		const heightCells =
			typeof row.local_height_cells === "number" && row.local_height_cells > 0
				? row.local_height_cells
				: heightPx / gridSize;
		const ox = typeof row.image_origin_x === "number" ? row.image_origin_x : 0;
		const oy = typeof row.image_origin_y === "number" ? row.image_origin_y : 0;
		const rot = typeof row.rotation_deg === "number" ? row.rotation_deg : 0;
		const stateRaw = typeof row.state === "string" ? row.state : "template";
		const state =
			stateRaw === "aligned" || stateRaw === "provisional" || stateRaw === "unmatched"
				? stateRaw
				: "provisional";

		backdrops.push({
			graph_id: graphId,
			scene: typeof row.display_name === "string" ? row.display_name : graphId,
			module: typeof row.asset_module === "string" ? row.asset_module : "",
			asset: pathToFileURL(abs).href,
			width_cells: widthCells,
			height_cells: heightCells,
			image_origin_cells: [ox, oy],
			image_bounds_cells: [
				[ox, oy],
				[ox, oy + heightCells],
				[ox + widthCells, oy + heightCells],
				[ox + widthCells, oy],
			],
			rotation_deg: rot,
			state,
		});
	}
	return { backdrops, resolved: backdrops.length, skipped };
}
