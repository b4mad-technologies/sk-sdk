import { countMapPlaces } from "./inventory.ts";
import { mapBounds } from "./layout.ts";
import type { SpatialGraphLayout, SpatialGraphModel, SpatialGraphNode } from "./types.ts";

export interface RenderAsciiOptions {
	/** Max character columns for the plot (default 72). */
	width?: number;
	/** Max character rows for the plot (default 28). */
	height?: number;
	/**
	 * Character set:
	 * - true / omitted: full UTF-8 box-drawing + curves (default)
	 * - false: 7-bit ASCII only
	 */
	unicode?: boolean;
	/** ANSI color (default true for utf-8 unless NO_COLOR). */
	color?: boolean;
	/** Hide occupancy markers (default false). */
	hideOccupancy?: boolean;
	/** Include title/legend chrome (default true). */
	chrome?: boolean;
}

// Direction bits for orthogonal stroke merging.
const N = 1;
const E = 2;
const S = 4;
const W = 8;

/** Sharp junctions (routes). */
const BOX: Record<number, string> = {
	[N]: "│",
	[S]: "│",
	[N | S]: "│",
	[E]: "─",
	[W]: "─",
	[E | W]: "─",
	[N | E]: "└",
	[N | W]: "┘",
	[S | E]: "┌",
	[S | W]: "┐",
	[N | S | E]: "├",
	[N | S | W]: "┤",
	[N | E | W]: "┴",
	[S | E | W]: "┬",
	[N | S | E | W]: "┼",
};

/** Rounded corners where a 2-way bend is pure corner (prettier paths). */
const BOX_ROUND: Record<number, string> = {
	...BOX,
	[N | E]: "╰",
	[N | W]: "╯",
	[S | E]: "╭",
	[S | W]: "╮",
};

type Ink = "route" | "stairs" | "panel" | "place" | "occ" | "label" | "chrome" | "dim";

interface Cell {
	ch: string;
	ink: Ink;
	prio: number;
}

const ANSI: Record<Ink, string> = {
	// Match SVG palette loosely: route gold, stairs purple, place teal, occ blue
	route: "\x1b[38;5;178m",
	stairs: "\x1b[38;5;141m",
	panel: "\x1b[38;5;244m",
	place: "\x1b[38;5;37m",
	occ: "\x1b[38;5;33m\x1b[1m",
	label: "\x1b[38;5;252m",
	chrome: "\x1b[38;5;250m",
	dim: "\x1b[38;5;245m",
};
const RESET = "\x1b[0m";

/**
 * Terminal map from a laid-out spatial graph.
 * UTF-8 default: junction-aware box drawing, rounded bends, ANSI color,
 * curved stairs (quadratic samples). `unicode: false` → 7-bit ASCII, no color.
 */
export function renderSpatialGraphAscii(
	model: SpatialGraphModel,
	layout: SpatialGraphLayout,
	options: RenderAsciiOptions = {},
): string {
	const maxW = Math.max(24, Math.min(options.width ?? 72, 120));
	const maxH = Math.max(10, Math.min(options.height ?? 28, 60));
	const utf8 = options.unicode !== false;
	const color =
		options.color !== undefined
			? options.color
			: utf8 && process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0";
	const hideOcc = options.hideOccupancy === true;
	const chromeOn = options.chrome !== false;

	if (layout.nodes.length === 0) {
		return chromeOn ? `Spatial map (${utf8 ? "utf-8" : "ascii"}): empty layout.` : "";
	}

	const occ = new Map(model.actorClusters.map((c) => [c.placeNodeId, c.count] as const));
	const cross = new Set(layout.crossFloorEdgeKeys ?? []);
	const box = utf8 ? BOX_ROUND : null;

	const pad = 1;
	const plotW = maxW - pad * 2;
	const plotH = maxH - pad * 2;

	const bounds = mapBounds(layout.nodes);
	if (bounds.maxX - bounds.minX < 1e-6) {
		bounds.minX -= 1;
		bounds.maxX += 1;
	}
	if (bounds.maxY - bounds.minY < 1e-6) {
		bounds.minY -= 1;
		bounds.maxY += 1;
	}

	const grid: Cell[][] = Array.from({ length: maxH }, () =>
		Array.from({ length: maxW }, () => ({ ch: " ", ink: "dim" as Ink, prio: 0 })),
	);

	// Orthogonal masks per ink layer so stairs don't merge into routes.
	const routeMask = zeros(maxH, maxW);
	const stairsMask = zeros(maxH, maxW);
	const diag = blankStr(maxH, maxW);
	const diagInk: Ink[][] = Array.from({ length: maxH }, () =>
		Array.from({ length: maxW }, () => "route" as Ink),
	);

	// Floor panels — double-line rounded feel
	for (const p of layout.floorPanels ?? []) {
		const corners = [
			project(p.minX, p.minY, bounds, plotW, plotH, pad),
			project(p.maxX, p.minY, bounds, plotW, plotH, pad),
			project(p.maxX, p.maxY, bounds, plotW, plotH, pad),
			project(p.minX, p.maxY, bounds, plotW, plotH, pad),
		];
		drawPanel(grid, corners, utf8);
		const title = p.title.length > plotW - 6 ? `${p.title.slice(0, plotW - 7)}…` : p.title;
		const [tx, ty] = corners[0]!;
		putStr(grid, tx + 2, ty, ` ${title} `, "panel", 2);
	}

	const nodePx = new Map<string, { x: number; y: number; node: SpatialGraphNode }>();
	for (const node of layout.nodes) {
		const [x, y] = project(node.x, node.y, bounds, plotW, plotH, pad);
		nodePx.set(node.id, { x, y, node });
	}

	const seen = new Set<string>();
	const stairMids: Array<{ x: number; y: number }> = [];
	for (const edge of layout.edges) {
		const a = nodePx.get(edge.from);
		const b = nodePx.get(edge.to);
		if (a === undefined || b === undefined) continue;
		// Composed tactical cells are already represented by their marks; their
		// dense lattice of adjacency routes adds noise rather than information.
		if (a.node.unlabeled && b.node.unlabeled) continue;
		const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
		if (seen.has(key)) continue;
		seen.add(key);
		const stairs = cross.has(key);
		if (stairs) {
			const mid = strokeCurve(a.x, a.y, b.x, b.y, stairsMask, diag, diagInk, "stairs", utf8);
			if (mid) stairMids.push(mid);
		} else {
			strokeStraight(a.x, a.y, b.x, b.y, routeMask, diag, diagInk, "route", utf8);
		}
	}

	// Resolve masks → glyphs
	for (let y = 0; y < maxH; y++) {
		for (let x = 0; x < maxW; x++) {
			const sm = stairsMask[y]![x]!;
			const rm = routeMask[y]![x]!;
			if (sm !== 0) {
				const ch = utf8 ? (BOX[sm] ?? "│") : asciiFromMask(sm);
				// Prefer wavy/double feel for pure ortho stairs
				const pretty = utf8 && sm === (N | S) ? "║" : utf8 && sm === (E | W) ? "═" : ch;
				put(grid, x, y, pretty, "stairs", 1);
			} else if (rm !== 0) {
				const table = box ?? null;
				const ch = utf8 ? (table?.[rm] ?? BOX[rm] ?? "│") : asciiFromMask(rm);
				put(grid, x, y, ch, "route", 1);
			} else if (diag[y]![x] !== " ") {
				put(grid, x, y, diag[y]![x]!, diagInk[y]![x]!, 1);
			}
		}
	}

	// Stairs captions at curve midpoints
	if (utf8) {
		for (const m of stairMids) {
			putStr(grid, m.x - 2, m.y, "↕", "stairs", 3);
			putStr(grid, m.x, m.y, "stairs", "dim", 2);
		}
	}

	// Nodes + labels
	for (const { x, y, node } of nodePx.values()) {
		const count = hideOcc ? 0 : (occ.get(node.id) ?? 0);
		const mark = utf8 ? (count > 0 ? "●" : "○") : count > 0 ? "@" : "o";
		put(grid, x, y, mark, count > 0 ? "occ" : "place", 4);
		if (count > 0 && count < 10) {
			put(grid, x + 1, y - 1, String(count), "occ", 4);
		}
		if (!node.unlabeled) {
			const label = shortLabel(node.label);
			const lx = x + 2 + label.length < maxW ? x + 2 : Math.max(0, x - 1 - label.length);
			putStr(grid, lx, y, label, "label", 3);
		}
	}

	const body = grid
		.map((row) => {
			let line = "";
			let cur: Ink | null = null;
			for (const cell of row) {
				if (cell.ch === " " && cell.prio === 0) {
					if (color && cur !== null) {
						line += RESET;
						cur = null;
					}
					line += " ";
					continue;
				}
				if (color) {
					if (cur !== cell.ink) {
						if (cur !== null) line += RESET;
						line += ANSI[cell.ink];
						cur = cell.ink;
					}
					line += cell.ch;
				} else {
					line += cell.ch;
				}
			}
			if (color && cur !== null) line += RESET;
			return line.replace(/\s+$/g, "");
		})
		.join("\n");

	if (!chromeOn) return body;

	const title =
		model.graphs[0]?.displayName?.trim() ||
		model.graphs[0]?.graphId ||
		model.root ||
		"spatial graph";
	const sub = model.sliceLabel ?? "";
	const mode = utf8 ? "utf-8" : "ascii";
	const paint = (ink: Ink, s: string) => (color ? `${ANSI[ink]}${s}${RESET}` : s);
	const fontHint = process.env.SPELLKAVE_MAP_FONT_HINT?.trim() || "JetBrainsMono Nerd Font Mono";
	const header = [
		paint("chrome", `Spatial map (${mode}) — ${title}${sub ? ` · ${sub}` : ""}`),
		paint(
			"dim",
			`${countMapPlaces(model)} places · ${model.edges.length} routes` +
				(hideOcc
					? ""
					: ` · ${paint("occ", utf8 ? "●" : "@")}${paint("dim", "=occ ")}` +
						`${paint("place", utf8 ? "○" : "o")}${paint("dim", "=empty")}`),
		),
		paint("route", utf8 ? "─│╭╮ routes" : "-| routes") +
			(cross.size > 0
				? paint("dim", " · ") + paint("stairs", utf8 ? "═║↕ stairs / floor-link" : "~ stairs")
				: ""),
		paint("dim", `font: ${fontHint} (just map-font-check)`),
	].join("\n");
	const rule = paint("dim", (utf8 ? "─" : "-").repeat(Math.min(maxW, 40)));
	return `${header}\n${rule}\n${body}`;
}

function zeros(h: number, w: number): number[][] {
	return Array.from({ length: h }, () => Array.from({ length: w }, () => 0));
}

function blankStr(h: number, w: number): string[][] {
	return Array.from({ length: h }, () => Array.from({ length: w }, () => " "));
}

function shortLabel(name: string): string {
	const t = name.trim();
	if (t.length <= 14) return t;
	return `${t.slice(0, 12)}…`;
}

function project(
	x: number,
	y: number,
	bounds: { minX: number; minY: number; maxX: number; maxY: number },
	plotW: number,
	plotH: number,
	pad: number,
): [number, number] {
	const dx = bounds.maxX - bounds.minX;
	const dy = bounds.maxY - bounds.minY;
	const px = pad + Math.round(((x - bounds.minX) / dx) * (plotW - 1));
	const py = pad + Math.round(((y - bounds.minY) / dy) * (plotH - 1));
	return [px, py];
}

function put(grid: Cell[][], x: number, y: number, ch: string, ink: Ink, prio: number): void {
	if (y < 0 || y >= grid.length || x < 0 || x >= (grid[0]?.length ?? 0)) return;
	const cell = grid[y]![x]!;
	if (prio < cell.prio) return;
	cell.ch = ch[0] ?? " ";
	cell.ink = ink;
	cell.prio = prio;
}

function putStr(grid: Cell[][], x: number, y: number, text: string, ink: Ink, prio: number): void {
	for (let i = 0; i < text.length; i++) put(grid, x + i, y, text[i]!, ink, prio);
}

function orMask(mask: number[][], x: number, y: number, bit: number): void {
	if (y < 0 || y >= mask.length || x < 0 || x >= (mask[0]?.length ?? 0)) return;
	mask[y]![x] = (mask[y]![x] ?? 0) | bit;
}

function asciiFromMask(mask: number): string {
	if ((mask & (N | S)) !== 0 && (mask & (E | W)) === 0) return "|";
	if ((mask & (E | W)) !== 0 && (mask & (N | S)) === 0) return "-";
	return "+";
}

function strokeStraight(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	mask: number[][],
	diag: string[][],
	diagInk: Ink[][],
	ink: Ink,
	utf8: boolean,
): void {
	const pts = bresenham(x0, y0, x1, y1);
	paintPolyline(pts, mask, diag, diagInk, ink, utf8);
}

/** Quadratic curve for stairs/floor-links — gentle bulge, not a dashed slash. */
function strokeCurve(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
	mask: number[][],
	diag: string[][],
	diagInk: Ink[][],
	ink: Ink,
	utf8: boolean,
): { x: number; y: number } | null {
	const dx = x1 - x0;
	const dy = y1 - y0;
	const len = Math.hypot(dx, dy) || 1;
	// Perpendicular bulge ~22% of span (readable S-curve without chaos).
	const ox = (-dy / len) * len * 0.22;
	const oy = (dx / len) * len * 0.22;
	const cx = (x0 + x1) / 2 + ox;
	const cy = (y0 + y1) / 2 + oy;
	const samples = Math.max(12, Math.ceil(len * 1.5));
	const pts: Array<[number, number]> = [];
	for (let i = 0; i <= samples; i++) {
		const t = i / samples;
		const u = 1 - t;
		const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
		const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
		pts.push([Math.round(x), Math.round(y)]);
	}
	// Dedup consecutive
	const slim: Array<[number, number]> = [];
	for (const p of pts) {
		const last = slim[slim.length - 1];
		if (!last || last[0] !== p[0] || last[1] !== p[1]) slim.push(p);
	}
	paintPolyline(slim, mask, diag, diagInk, ink, utf8);
	const mid = slim[Math.floor(slim.length / 2)];
	return mid ? { x: mid[0], y: mid[1] } : null;
}

function bresenham(x0: number, y0: number, x1: number, y1: number): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	let x = x0;
	let y = y0;
	const dx = Math.abs(x1 - x0);
	const dy = Math.abs(y1 - y0);
	const sx = x0 < x1 ? 1 : -1;
	const sy = y0 < y1 ? 1 : -1;
	let err = dx - dy;
	for (;;) {
		out.push([x, y]);
		if (x === x1 && y === y1) break;
		const e2 = 2 * err;
		if (e2 > -dy) {
			err -= dy;
			x += sx;
		}
		if (e2 < dx) {
			err += dx;
			y += sy;
		}
	}
	return out;
}

function paintPolyline(
	pts: Array<[number, number]>,
	mask: number[][],
	diag: string[][],
	diagInk: Ink[][],
	ink: Ink,
	utf8: boolean,
): void {
	if (pts.length === 0) return;
	// Skip pure endpoints so node glyphs win
	for (let i = 1; i < pts.length; i++) {
		const [x0, y0] = pts[i - 1]!;
		const [x1, y1] = pts[i]!;
		const isLast = i === pts.length - 1;
		const stepDx = x1 - x0;
		const stepDy = y1 - y0;
		if (stepDx === 0 && stepDy === 0) continue;

		const ortho = stepDx === 0 || stepDy === 0;
		if (ortho) {
			if (stepDx === 1) {
				orMask(mask, x0, y0, E);
				orMask(mask, x1, y1, W);
			} else if (stepDx === -1) {
				orMask(mask, x0, y0, W);
				orMask(mask, x1, y1, E);
			} else if (stepDy === 1) {
				orMask(mask, x0, y0, S);
				orMask(mask, x1, y1, N);
			} else if (stepDy === -1) {
				orMask(mask, x0, y0, N);
				orMask(mask, x1, y1, S);
			} else {
				// long ortho jump (shouldn't after bresenham) — fill
				for (const [x, y] of bresenham(x0, y0, x1, y1)) {
					if (stepDx !== 0) orMask(mask, x, y, E | W);
					if (stepDy !== 0) orMask(mask, x, y, N | S);
				}
			}
		} else {
			// Diagonal step: use ╱ ╲ — skip polyline endpoints so node glyphs win.
			const ch = utf8 ? (stepDx === stepDy ? "╲" : "╱") : stepDx === stepDy ? "\\" : "/";
			if (isLast) continue;
			if (y1 >= 0 && y1 < diag.length && x1 >= 0 && x1 < (diag[0]?.length ?? 0)) {
				diag[y1]![x1] = ch;
				diagInk[y1]![x1] = ink;
			}
		}
	}
}

function drawPanel(grid: Cell[][], corners: Array<[number, number]>, utf8: boolean): void {
	const xs = corners.map((c) => c[0]);
	const ys = corners.map((c) => c[1]);
	const minX = Math.min(...xs);
	const maxX = Math.max(...xs);
	const minY = Math.min(...ys);
	const maxY = Math.max(...ys);
	const h = utf8 ? "─" : "-";
	const v = utf8 ? "│" : "|";
	const tl = utf8 ? "╭" : "+";
	const tr = utf8 ? "╮" : "+";
	const bl = utf8 ? "╰" : "+";
	const br = utf8 ? "╯" : "+";
	for (let x = minX; x <= maxX; x++) {
		put(grid, x, minY, h, "panel", 1);
		put(grid, x, maxY, h, "panel", 1);
	}
	for (let y = minY; y <= maxY; y++) {
		put(grid, minX, y, v, "panel", 1);
		put(grid, maxX, y, v, "panel", 1);
	}
	put(grid, minX, minY, tl, "panel", 1);
	put(grid, maxX, minY, tr, "panel", 1);
	put(grid, minX, maxY, bl, "panel", 1);
	put(grid, maxX, maxY, br, "panel", 1);
}
