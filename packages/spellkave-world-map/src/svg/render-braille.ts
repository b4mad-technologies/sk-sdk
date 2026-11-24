/**
 * Braille terminal map via termdot (modern drawille successor).
 * Dense geometry from the same layout as SVG/UTF-8; labels via setText.
 */
import { createCanvas, frame, line, set, setText } from "termdot";

import { countMapPlaces } from "./inventory.ts";
import { mapBounds } from "./layout.ts";
import type { SpatialGraphLayout, SpatialGraphModel } from "./types.ts";

export interface RenderBrailleOptions {
	/** Terminal character columns (default 56). Braille pixels = cols * 2. */
	width?: number;
	/** Terminal character rows (default 22). Braille pixels = rows * 4. */
	height?: number;
	hideOccupancy?: boolean;
	chrome?: boolean;
}

/**
 * High-density UTF-8 braille map. Prefer box-drawing UTF-8 for labeled
 * agent readability; use braille when geometry density matters.
 */
export function renderSpatialGraphBraille(
	model: SpatialGraphModel,
	layout: SpatialGraphLayout,
	options: RenderBrailleOptions = {},
): string {
	const cols = Math.max(20, Math.min(options.width ?? 56, 100));
	const rows = Math.max(8, Math.min(options.height ?? 22, 48));
	const hideOcc = options.hideOccupancy === true;
	const chrome = options.chrome !== false;

	if (layout.nodes.length === 0) {
		return chrome ? "Spatial map (braille/termdot): empty layout." : "";
	}

	// Braille cell = 2×4 dots → pixel canvas size
	const pxW = cols * 2;
	const pxH = rows * 4;
	const pad = 3;

	const bounds = mapBounds(layout.nodes);
	if (bounds.maxX - bounds.minX < 1e-6) {
		bounds.minX -= 1;
		bounds.maxX += 1;
	}
	if (bounds.maxY - bounds.minY < 1e-6) {
		bounds.minY -= 1;
		bounds.maxY += 1;
	}

	const toPx = (x: number, y: number): [number, number] => {
		const dx = bounds.maxX - bounds.minX;
		const dy = bounds.maxY - bounds.minY;
		const px = pad + Math.round(((x - bounds.minX) / dx) * (pxW - pad * 2 - 1));
		const py = pad + Math.round(((y - bounds.minY) / dy) * (pxH - pad * 2 - 1));
		return [px, py];
	};

	const c = createCanvas();
	const occ = new Map(model.actorClusters.map((cl) => [cl.placeNodeId, cl.count] as const));
	const cross = new Set(layout.crossFloorEdgeKeys ?? []);

	// Floor panel outlines
	for (const panel of layout.floorPanels ?? []) {
		const [x0, y0] = toPx(panel.minX, panel.minY);
		const [x1, y1] = toPx(panel.maxX, panel.maxY);
		for (const pt of line(x0, y0, x1, y0)) set(c, pt.x, pt.y);
		for (const pt of line(x1, y0, x1, y1)) set(c, pt.x, pt.y);
		for (const pt of line(x1, y1, x0, y1)) set(c, pt.x, pt.y);
		for (const pt of line(x0, y1, x0, y0)) set(c, pt.x, pt.y);
	}

	const nodePx = new Map<string, { x: number; y: number; id: string; label: string }>();
	for (const n of layout.nodes) {
		const [x, y] = toPx(n.x, n.y);
		nodePx.set(n.id, { x, y, id: n.id, label: n.label });
	}

	const seen = new Set<string>();
	for (const e of layout.edges) {
		const a = nodePx.get(e.from);
		const b = nodePx.get(e.to);
		if (a === undefined || b === undefined) continue;
		const key = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const stairs = cross.has(key);
		// Stairs: dashed by skipping every other segment point
		let i = 0;
		for (const pt of line(a.x, a.y, b.x, b.y)) {
			if (!stairs || i % 3 !== 1) set(c, pt.x, pt.y);
			i++;
		}
	}

	// Node blobs + labels
	for (const n of nodePx.values()) {
		const count = hideOcc ? 0 : (occ.get(n.id) ?? 0);
		const r = count > 0 ? 2 : 1;
		for (let dy = -r; dy <= r; dy++) {
			for (let dx = -r; dx <= r; dx++) {
				if (dx * dx + dy * dy <= r * r + 0.5) set(c, n.x + dx, n.y + dy);
			}
		}
		const label = n.label.length > 12 ? `${n.label.slice(0, 10)}…` : n.label;
		const tag = count > 0 ? `${label}·${count}` : label;
		// setText uses pixel coords; place to the right of the blob
		setText(c, n.x + r + 2, n.y - 1, tag);
	}

	const body = frame(c);
	if (!chrome) return body;

	const title =
		model.graphs[0]?.displayName?.trim() ||
		model.graphs[0]?.graphId ||
		model.root ||
		"spatial graph";
	const sub = model.sliceLabel ?? "";
	const fontHint = process.env.SPELLKAVE_MAP_FONT_HINT?.trim() || "JetBrainsMono Nerd Font Mono";
	const header = [
		`Spatial map (braille/termdot) — ${title}${sub ? ` · ${sub}` : ""}`,
		`${countMapPlaces(model)} places · ${model.edges.length} routes · dense UTF-8 dots`,
		"Labels via termdot setText; stairs dashed.",
		`font: ${fontHint} (just map-font-check)`,
	].join("\n");
	return `${header}\n${"─".repeat(40)}\n${body}`;
}
