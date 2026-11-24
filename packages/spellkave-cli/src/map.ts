// Author-map rendering: place-graph as SVG/HTML + shared terminal view helpers.
// Layout/SVG canonical product lives in `@spellkave/world-map/svg`.
// This module owns file/target I/O (manifest merge, backdrops, --out).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
	buildSpatialGraphModel,
	buildSpatialGraphView,
	countMapPlaces,
	layoutSpatialGraph,
	renderSpatialGraphSvg,
	renderSpatialGraphTextInventory,
	type SpatialGraphBackdrop,
	type SpatialGraphModel,
	type SpatialGraphToolRows,
} from "@spellkave/world-map/svg";

import { readMergedManifest } from "./bundle.ts";

export async function mapInspect(
	manifestPath: string,
	depPaths: string[],
	bundle: boolean,
	options: { graphId?: string } = {},
): Promise<Record<string, unknown>> {
	const merged = await readMergedManifest(manifestPath, depPaths, bundle);
	const rows = manifestToSpatialRows(merged.manifest);
	const model = buildSpatialGraphModel(rows, { graphId: options.graphId });
	const backdrops = await readMapBackdrops(manifestPath, merged.manifest);
	const view = buildSpatialGraphView(rows, {
		graphId: options.graphId,
		backdrops,
		backdropHref: (backdrop) => backdropHref(undefined, backdrop),
	});
	const graphIds = [...new Set(model.nodes.map((node) => node.graphId))].sort();
	const availableGraphIds = [
		...new Set(
			(rows.place_graphs ?? [])
				.map((row) => stringValue(row, "place_graph_id"))
				.filter((id): id is string => id !== null),
		),
	].sort();
	const inventory =
		model.nodes.length === 0 && availableGraphIds.length > 0
			? `${view.inventory}\nAuthored graphs: ${availableGraphIds.join(", ")}\nSelect a graph with --graph <id>.`
			: view.inventory;
	return {
		path: manifestPath,
		bundle,
		includedFiles: merged.includedFiles,
		depManifests: merged.depManifests,
		missingIncludes: merged.missingIncludes,
		graph: options.graphId?.trim() || null,
		graphs: graphIds.length,
		graphIds,
		availableGraphIds,
		places: countMapPlaces(model),
		routes: model.edges.length,
		actorClusters: model.actorClusters.length,
		actors: model.actorClusters.reduce((sum, cluster) => sum + cluster.count, 0),
		root: model.root,
		reachable: model.reachable.length,
		unreachable: model.unreachable,
		backdrops: backdrops.length,
		backdropStates: {
			aligned: backdrops.filter((backdrop) => backdrop.state === "aligned").length,
			provisional: backdrops.filter((backdrop) => backdrop.state === "provisional").length,
			unmatched: backdrops.filter((backdrop) => backdrop.state === "unmatched").length,
		},
		has_layout: view.hasLayout,
		// Additive optional presentation fields (JSONL-safe; hosts may ignore).
		svg: view.svg,
		inventory,
	};
}

export async function renderAuthorMap(
	manifestPath: string,
	depPaths: string[],
	bundle: boolean,
	outPath: string,
	format: string,
	graphId: string | undefined,
	assetRoot: string | undefined,
): Promise<Record<string, unknown>> {
	if (format !== "html" && format !== "svg") {
		throw new Error(`unknown map render format: ${format}`);
	}
	const merged = await readMergedManifest(manifestPath, depPaths, bundle);
	const rows = manifestToSpatialRows(merged.manifest);
	const model = buildSpatialGraphModel(rows, { graphId });
	const backdrops = await readMapBackdrops(manifestPath, merged.manifest);
	const layout = layoutSpatialGraph(model, { graphId });
	const svg =
		layout.nodes.length === 0
			? emptySvg()
			: renderSpatialGraphSvg(model, layout, {
					backdrops,
					backdropHref: (backdrop) => backdropHref(assetRoot, backdrop),
				});
	const selectedGraph = graphId?.trim();
	const output = format === "html" ? renderAuthorMapHtml(svg, manifestPath, selectedGraph) : svg;
	await writeFile(outPath, output, "utf8");
	return {
		output: outPath,
		format,
		graph: selectedGraph ?? "all",
		places: countMapPlaces(model),
		routes: model.edges.length,
		actors: model.actorClusters.reduce((sum, cluster) => sum + cluster.count, 0),
		unreachable: model.unreachable,
		inventory: renderSpatialGraphTextInventory(model),
	};
}

export function manifestToSpatialRows(manifest: Record<string, unknown>): SpatialGraphToolRows {
	return {
		place_graphs: rows(manifest, "place_graphs"),
		place_nodes: rows(manifest, "place_nodes"),
		place_edges: rows(manifest, "place_edges"),
		actor_spatial_locations: rows(manifest, "actor_spatial_locations"),
	};
}

export function spatialModelFromManifest(
	manifest: Record<string, unknown>,
	graphId?: string,
): SpatialGraphModel {
	return buildSpatialGraphModel(manifestToSpatialRows(manifest), { graphId });
}

function emptySvg(): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="760" viewBox="0 0 1200 760" role="img" aria-label="Empty spatial graph"></svg>\n`;
}

function renderAuthorMapHtml(
	svg: string,
	manifestPath: string,
	graphId: string | undefined,
): string {
	return `<!doctype html>
<html lang="en">
<meta charset="utf-8" />
<title>Spellkave author map preview</title>
<style>body{margin:0;background:#dfe6e3;color:#1d2428;font-family:Inter,Arial,sans-serif}main{display:grid;gap:12px;padding:16px}h1{margin:0;font-size:16px}p{margin:0;color:#526168;font-size:13px}svg{max-width:100%;height:auto;border:1px solid #b9c5c0;border-radius:6px}</style>
<main>
<h1>Spellkave author map preview</h1>
<p>${escapeHtml(manifestPath)} · ${escapeHtml(graphId ?? "all graphs")}</p>
${svg}
</main>
</html>
`;
}

async function readMapBackdrops(
	manifestPath: string,
	manifest: Record<string, unknown>,
): Promise<SpatialGraphBackdrop[]> {
	const authored = rows(manifest, "map_layers").map(authorBackdropFromMapLayer);
	if (authored.length > 0) return authored;
	return readMapBackdropSidecar(manifestPath);
}

function authorBackdropFromMapLayer(row: Record<string, unknown>): SpatialGraphBackdrop {
	const width = numberValue(row, "local_width_cells") ?? 1;
	const height = numberValue(row, "local_height_cells") ?? 1;
	const origin: [number, number] = [
		numberValue(row, "image_origin_x") ?? 0,
		numberValue(row, "image_origin_y") ?? 0,
	];
	const rotation = numberValue(row, "rotation_deg") ?? 0;
	return {
		graph_id: stringValue(row, "place_graph_id") ?? "",
		scene: stringValue(row, "display_name") ?? "",
		module: stringValue(row, "asset_module") ?? "",
		asset: stringValue(row, "asset_path") ?? "",
		width_cells: width,
		height_cells: height,
		image_origin_cells: origin,
		image_bounds_cells: rotatedAuthorBounds(origin, width, height, rotation),
		rotation_deg: rotation,
		state: backdropStateValue(row.state),
	};
}

async function readMapBackdropSidecar(manifestPath: string): Promise<SpatialGraphBackdrop[]> {
	try {
		const raw = await readFile(
			resolve(dirname(manifestPath), "generated/map-backdrops.generated.json"),
			"utf8",
		);
		const parsed = JSON.parse(raw) as { backdrops?: unknown };
		return Array.isArray(parsed.backdrops)
			? parsed.backdrops.filter(isRecord).map((row) => ({
					graph_id: stringValue(row, "graph_id") ?? "",
					scene: stringValue(row, "scene") ?? "",
					module: stringValue(row, "module") ?? "",
					asset: stringValue(row, "asset") ?? "",
					width_cells: numberValue(row, "width_cells") ?? 1,
					height_cells: numberValue(row, "height_cells") ?? 1,
					image_origin_cells: pointValue(row.image_origin_cells) ?? [0, 0],
					image_bounds_cells:
						boundsValue(row.image_bounds_cells) ??
						([
							[0, 0],
							[0, numberValue(row, "height_cells") ?? 1],
							[numberValue(row, "width_cells") ?? 1, numberValue(row, "height_cells") ?? 1],
							[numberValue(row, "width_cells") ?? 1, 0],
						] as [[number, number], [number, number], [number, number], [number, number]]),
					rotation_deg: numberValue(row, "rotation_deg") ?? 0,
					state: backdropStateValue(row.state),
				}))
			: [];
	} catch {
		return [];
	}
}

function rotatedAuthorBounds(
	[x, y]: [number, number],
	width: number,
	height: number,
	rotationDeg: number,
): [[number, number], [number, number], [number, number], [number, number]] {
	const unrotated: [[number, number], [number, number], [number, number], [number, number]] = [
		[x, y],
		[x, y + height],
		[x + width, y + height],
		[x + width, y],
	];
	if (rotationDeg === 0) return unrotated;
	const center: [number, number] = [x + width / 2, y + height / 2];
	return unrotated.map((point) => rotateAuthorPoint(point, center, rotationDeg)) as [
		[number, number],
		[number, number],
		[number, number],
		[number, number],
	];
}

function rotateAuthorPoint(
	[x, y]: [number, number],
	[cx, cy]: [number, number],
	rotationDeg: number,
): [number, number] {
	const radians = (rotationDeg * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	const localX = x - cx;
	const localY = y - cy;
	return [cx + localX * cos - localY * sin, cy + localX * sin + localY * cos];
}

function pointValue(value: unknown): [number, number] | null {
	if (!Array.isArray(value) || value.length < 2) return null;
	const [x, y] = value;
	return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
		? [x, y]
		: null;
}

function boundsValue(
	value: unknown,
): [[number, number], [number, number], [number, number], [number, number]] | null {
	if (!Array.isArray(value) || value.length !== 4) return null;
	const points = value.map(pointValue);
	return points.every((point): point is [number, number] => point !== null)
		? (points as [[number, number], [number, number], [number, number], [number, number]])
		: null;
}

function backdropStateValue(value: unknown): SpatialGraphBackdrop["state"] {
	return value === "aligned" || value === "provisional" || value === "unmatched"
		? value
		: "provisional";
}

function backdropHref(
	assetRoot: string | undefined,
	backdrop: SpatialGraphBackdrop,
): string | null {
	if (assetRoot === undefined || assetRoot.trim().length === 0 || backdrop.asset.length === 0)
		return null;
	const root = assetRoot.trim();
	if (/^https?:\/\//.test(root))
		return `${root.replace(/\/+$/, "")}/${backdrop.asset.replace(/^\/+/, "")}`;
	const modulesPrefix = `modules/${backdrop.module}/`;
	const rel = backdrop.asset.startsWith(modulesPrefix)
		? backdrop.asset.slice("modules/".length)
		: backdrop.asset;
	return pathToFileURL(resolve(root, rel)).href;
}

function rows(manifest: Record<string, unknown>, kind: string): Record<string, unknown>[] {
	const value = manifest[kind];
	return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(row: Record<string, unknown>, key: string): string | null {
	const value = row[key];
	return typeof value === "string" ? value : null;
}

function numberValue(row: Record<string, unknown>, key: string): number | null {
	const value = row[key];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function escapeHtml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}
