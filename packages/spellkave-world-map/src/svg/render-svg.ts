import { mapBounds } from "./layout.ts";
import {
	chooseScaleBar,
	formatMetresLabel,
	type ScaleBarSpec,
	sharedMetresPerGraphUnit,
} from "./scale.ts";
import type {
	RenderSvgOptions,
	SpatialGraphBackdrop,
	SpatialGraphEdge,
	SpatialGraphLayout,
	SpatialGraphModel,
	SpatialGraphNode,
} from "./types.ts";

/** Canonical web-vector draw product for a laid-out spatial graph. */
export function renderSpatialGraphSvg(
	model: SpatialGraphModel,
	layout: SpatialGraphLayout,
	options: RenderSvgOptions = {},
): string {
	const maxWidth = options.width ?? 1200;
	const maxHeight = options.height ?? 760;
	const pad = options.pad ?? 40;
	const titleH = 36;
	const ornamentPadY = 32;
	const chromeH = 40;
	const labelFontPx = 12;
	const estimateLabelHalfPx = (label: string): number => (label.length * labelFontPx * 0.58) / 2;
	const hasPanels = (layout.floorPanels?.length ?? 0) > 0;
	const maxLabelHalfPx = layout.nodes.reduce((max, node) => {
		// An unlabeled node (composed grid cell) draws no text, so it must not
		// widen the canvas padding either — otherwise 100 suppressed "Cell 4,7"
		// strings still push the margins out for labels nobody ever sees.
		if (node.unlabeled) return max;
		const text = hasPanels
			? node.label
			: labelWithElev(node.label, node.elevation, node.elevationPresent);
		return Math.max(max, estimateLabelHalfPx(text));
	}, 0);
	const badgeOutsetPx = 21;
	const padX = Math.max(pad, Math.ceil(maxLabelHalfPx + 12), badgeOutsetPx + 10);
	const minWidth = Math.min(maxWidth, 360);
	const minHeight = Math.min(maxHeight, 160 + chromeH + titleH);
	const backdrops = options.backdrops ?? [];
	const bounds = layoutBounds(layout, backdrops);
	const contentW = Math.max(bounds.maxX - bounds.minX, 1);
	const contentH = Math.max(bounds.maxY - bounds.minY, 0);
	const scaleByW = (maxWidth - padX * 2) / contentW;
	const scaleByH =
		contentH > 0
			? (maxHeight - pad * 2 - ornamentPadY - chromeH - titleH) / contentH
			: Number.POSITIVE_INFINITY;
	const scale = Math.min(scaleByW, scaleByH);
	const width = clamp(Math.ceil(contentW * scale + padX * 2), minWidth, maxWidth);
	const height = clamp(
		Math.ceil(contentH * scale + pad * 2 + ornamentPadY + chromeH + titleH),
		minHeight,
		maxHeight,
	);
	const usedW = contentW * scale + padX * 2;
	const usedH = contentH * scale + pad * 2 + ornamentPadY;
	const originX = (width - usedW) / 2;
	const originY = titleH + (height - chromeH - titleH - usedH) / 2;
	const project = (x: number, y: number): [number, number] => [
		originX + padX + (x - bounds.minX) * scale,
		originY + pad + ornamentPadY / 2 + (y - bounds.minY) * scale,
	];
	const nodeById = new Map(layout.nodes.map((node) => [node.id, node] as const));
	const actorsByPlace = new Map(
		model.actorClusters.map((cluster) => [cluster.placeNodeId, cluster.count] as const),
	);
	const cross = new Set(layout.crossFloorEdgeKeys ?? []);

	const hexMarks = (layout.hexes ?? []).map((hex) => {
		const pts = hex.ring
			.map((p) => {
				const [px, py] = project(p.x, p.y);
				return `${fmt(px)},${fmt(py)}`;
			})
			.join(" ");
		const kind = hex.fillKind ?? "default";
		return `<polygon data-h3="${escapeXml(hex.hex)}" data-fill="${escapeXml(kind)}" points="${pts}" class="h3-cell h3-cell--${escapeXml(kind)}" />`;
	});
	const worldMap = (layout.hexes?.length ?? 0) > 0;

	// Backdrop masking (written and tested; NOT enabled by any caller today —
	// see RenderSvgOptions.maskBackdropToNodes doc comment). AUTHOR mode never
	// sets the flag, so `maskId`/`maskAttr` stay unused there and the <image>
	// markup is byte-identical to before this option existed. bead sk-ubx
	// tracks turning this on for the player tool.
	const maskId = "backdrop-known-mask";
	const maskShapes =
		options.maskBackdropToNodes === true
			? layout.nodes.map((node) => {
					const [x, y] = project(node.x, node.y);
					return renderExtentShape(node, x, y, scale, "extent-mask", BACKDROP_REVEAL_MARGIN_CELLS);
				})
			: [];
	const maskBlock =
		maskShapes.length === 0
			? ""
			: `<defs><mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="${width}" height="${height}"><rect x="0" y="0" width="${width}" height="${height}" fill="#000" />${maskShapes.join("")}</mask></defs>\n`;
	const maskAttr = maskShapes.length === 0 ? "" : ` mask="url(#${maskId})"`;

	const images = layout.graphs.flatMap((graph) => {
		const backdrop = backdrops.find((candidate) => candidate.graph_id === graph.graphId);
		const href =
			backdrop === undefined || options.backdropHref === undefined
				? null
				: options.backdropHref(backdrop);
		if (backdrop === undefined || href === null) return [];
		const [ox, oy] = backdrop.image_origin_cells;
		const [x, y] = project(ox + graph.offsetX, oy + graph.offsetY);
		const imageWidth = backdrop.width_cells * scale;
		const imageHeight = backdrop.height_cells * scale;
		const rotate =
			backdrop.rotation_deg === 0
				? ""
				: ` transform="rotate(${fmt(backdrop.rotation_deg)} ${fmt(x + imageWidth / 2)} ${fmt(y + imageHeight / 2)})"`;
		return [
			`<image href="${escapeXml(href)}" x="${fmt(x)}" y="${fmt(y)}" width="${fmt(imageWidth)}" height="${fmt(imageHeight)}" opacity="0.62" preserveAspectRatio="none"${rotate}${maskAttr} />`,
		];
	});

	// Battle-map treatment for composed tactical-grid cells (operator request
	// 2026-08-14): cells render as a GRID — stroke-only squares tiling the
	// battlefield — not as a matrix of place dots, and an occupant badge sits
	// in the CENTRE of its cell. The square side is measured empirically as
	// the smallest positive projected distance between any two cells (they
	// are a uniform lattice, so that IS the cell pitch); fallback covers the
	// degenerate single-cell case.
	const gridCells = layout.nodes.filter((n) => n.unlabeled);
	const gridCellPx = (() => {
		let min = Number.POSITIVE_INFINITY;
		const pts = gridCells.map((n) => project(n.x, n.y));
		for (let i = 0; i < pts.length; i++) {
			for (let j = i + 1; j < pts.length; j++) {
				const d = Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]);
				if (d > 0.5 && d < min) min = d;
			}
		}
		return Number.isFinite(min) ? min : 18;
	})();

	const edgeLines = uniqueEdges(layout.edges).flatMap((edge) => {
		const from = nodeById.get(edge.from);
		const to = nodeById.get(edge.to);
		if (from === undefined || to === undefined) return [];
		// Cell-to-cell adjacency is already legible from the grid squares —
		// route lines between cells would redraw the whole lattice as an
		// orange mesh. Edges that LEAVE the grid (cell ↔ named place, e.g.
		// the anchor-node connection) stay drawn.
		if (from.unlabeled && to.unlabeled) return [];
		const [x1, y1] = project(from.x, from.y);
		const [x2, y2] = project(to.x, to.y);
		const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
		const isStairs = cross.has(key);
		const cls = isStairs ? "route-stairs" : "route";
		const midX = (x1 + x2) / 2;
		const midY = (y1 + y2) / 2;
		const label = isStairs
			? `<text x="${fmt(midX)}" y="${fmt(midY - 6)}" class="stairs-label">stairs</text>`
			: "";
		return [
			`<line data-from="${escapeXml(edge.from)}" data-to="${escapeXml(edge.to)}" x1="${fmt(x1)}" y1="${fmt(y1)}" x2="${fmt(x2)}" y2="${fmt(y2)}" class="${cls}" />${label}`,
		];
	});

	const hideOcc = options.hideOccupancy === true;
	const commonExtentDepth = extentDepthSummary(model, options);
	const nodeMarks = layout.nodes.map((node, idx) => {
		const [x, y] = project(node.x, node.y);
		const actorCount = hideOcc ? 0 : (actorsByPlace.get(node.id) ?? 0);
		// Grid cells centre their occupant badge IN the cell (a token on a
		// battle map); ordinary places keep the offset badge beside the dot.
		const badgeR = node.unlabeled ? Math.min(9, Math.max(5, gridCellPx * 0.32)) : 9;
		const [bx, by] = node.unlabeled ? [x, y] : [x + 12, y - 12];
		const actor =
			actorCount > 0
				? `<circle cx="${fmt(bx)}" cy="${fmt(by)}" r="${fmt(badgeR)}" class="actor" /><text x="${fmt(bx)}" y="${fmt(by + 3.5)}" class="actor-label">${actorCount}</text>`
				: "";
		// The floor rides its own <tspan class="label-floor"> (sk-jay0.4.21): the
		// drawn text and textContent are unchanged ("Cellar (z=-3)"), but a host
		// that already says the floor elsewhere hides it by class, with no label
		// parsing. World maps and floor panels never carry the suffix. The
		// separating space stays in the parent text node: resvg drops a space
		// that leads a tspan, which would glue the floor onto the name.
		const plainLabel = worldMap ? (node.shortLabel ?? node.label) : node.label;
		const floorSuffix =
			worldMap || hasPanels ? "" : elevSuffix(node.elevation, node.elevationPresent);
		const floorSpan =
			floorSuffix === ""
				? ""
				: ` <tspan class="label-floor">${escapeXml(floorSuffix.trimStart())}</tspan>`;
		// Slight radial label offset on world maps to reduce pile-ups.
		const ang = worldMap ? (idx * 2.4) % (Math.PI * 2) : 0;
		const lx = worldMap ? x + Math.cos(ang) * 14 : x;
		const ly = worldMap ? y + 18 + Math.sin(ang) * 10 : y + 20;
		const extentMark =
			!node.unlabeled && node.extent ? renderExtentShape(node, x, y, scale, "place-extent") : "";
		const depthMark =
			!node.unlabeled &&
			node.extent &&
			options.showExtentDepth === true &&
			commonExtentDepth === null
				? renderExtentDepth(node, x, y, scale)
				: "";
		const mark = node.portalEntrance
			? `<polygon points="${fmt(x)},${fmt(y - 9)} ${fmt(x + 8)},${fmt(y)} ${fmt(x)},${fmt(y + 9)} ${fmt(x - 8)},${fmt(y)}" class="place place-portal" />`
			: node.unlabeled
				? `<rect x="${fmt(x - gridCellPx / 2)}" y="${fmt(y - gridCellPx / 2)}" width="${fmt(gridCellPx)}" height="${fmt(gridCellPx)}" class="grid-cell" />`
				: `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="7" class="place" />`;
		const portalTag = node.portalEntrance
			? `<text x="${fmt(lx)}" y="${fmt(ly + 11)}" class="portal-tag">in</text>`
			: "";
		// sk-pej D-3: composed tactical-grid cells draw their mark but no text.
		// The node keeps its data-node-id, so the SVG stays as addressable as
		// before, and the text `inventory` output still names every cell.
		const labelText = node.unlabeled
			? ""
			: `<text x="${fmt(lx)}" y="${fmt(ly)}" class="label${node.portalEntrance ? " label-portal" : ""}">${escapeXml(plainLabel)}${floorSpan}</text>`;
		return `<g data-node-id="${escapeXml(node.id)}">${extentMark}${depthMark}${mark}${actor}${labelText}${portalTag}</g>`;
	});

	const floorPanels = (layout.floorPanels ?? []).map((panel) => {
		const [x1, y1] = project(panel.minX, panel.minY);
		const [x2, y2] = project(panel.maxX, panel.maxY);
		const w = Math.max(x2 - x1, 40);
		const h = Math.max(y2 - y1, 40);
		const zLabel = Number.isInteger(panel.elevation)
			? String(panel.elevation)
			: panel.elevation.toFixed(1);
		return `<g class="floor-panel" data-elevation="${escapeXml(zLabel)}"><rect x="${fmt(x1)}" y="${fmt(y1)}" width="${fmt(w)}" height="${fmt(h)}" rx="10" ry="10" class="floor-box" /><text x="${fmt(x1 + 12)}" y="${fmt(y1 + 18)}" class="floor-label">${escapeXml(panel.title)}</text></g>`;
	});

	const metresPerUnit = sharedMetresPerGraphUnit(model.graphs);
	const scaleBar =
		metresPerUnit === null
			? null
			: chooseScaleBar(scale, metresPerUnit, {
					targetPx: Math.min(120, width * 0.18),
					maxPx: Math.max(48, width * 0.28),
				});
	const chrome = renderMapChrome(width, height, chromeH, scaleBar, hasPanels, commonExtentDepth);
	const title = renderTitleBar(width, titleH, model, options);

	const aria = escapeXml(options.ariaLabel ?? titlePlain(model, options));
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${aria}">
<style>
svg{font-family:Inter,system-ui,Arial,sans-serif}
.h3-cell{fill:#c9d8cf;fill-opacity:.32;stroke:#536758;stroke-width:1.4;stroke-opacity:.9}
.h3-cell--root{fill:#9bb8a8;fill-opacity:.45}
.h3-cell--settlement{fill:#d4b896;fill-opacity:.5}
.h3-cell--wilderness{fill:#b7c9b0;fill-opacity:.38}
.h3-cell--default{fill:#c9d8cf;fill-opacity:.28}
.place-portal{fill:#8b4513;stroke:#fff;stroke-width:2}
.portal-tag{fill:#6b3a12;font-size:9px;font-weight:600;text-anchor:middle}
.label-portal{font-weight:700}
.route{stroke:#b97012;stroke-width:3;stroke-linecap:round;opacity:.9}
.route-stairs{stroke:#6b4f9a;stroke-width:2.5;stroke-linecap:round;stroke-dasharray:7 5;opacity:.95}
.place{fill:#148284;stroke:#fff;stroke-width:2.2}
.place-extent{fill:#148284;fill-opacity:.18;stroke:#0f5f61;stroke-width:1.5}
.grid-cell{fill:#148284;fill-opacity:.06;stroke:#0f5f61;stroke-opacity:.55;stroke-width:1}
.actor{fill:#245ebe;stroke:#fff;stroke-width:2}
.label{fill:#1d2428;font-size:12px;font-weight:700;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:4px;stroke-linejoin:round}
.actor-label{fill:#fff;font-size:9px;font-weight:800;text-anchor:middle}
.chrome-label{fill:#3a454b;font-size:11px;font-weight:600;text-anchor:start}
.scale-bar{stroke:#3a454b;stroke-width:2;stroke-linecap:square}
.scale-bar-label{fill:#3a454b;font-size:11px;font-weight:700;text-anchor:middle}
.floor-box{fill:#e7efed;stroke:#7a9690;stroke-width:1.5;opacity:.95}
.floor-label{fill:#1d3a36;font-size:13px;font-weight:800;text-anchor:start}
.stairs-label{fill:#6b4f9a;font-size:11px;font-weight:700;text-anchor:middle;paint-order:stroke;stroke:#fff;stroke-width:3px}
.title-main{fill:#14201e;font-size:15px;font-weight:800;text-anchor:start}
.title-sub{fill:#4a5a56;font-size:12px;font-weight:600;text-anchor:start}
.title-rule{stroke:#c5d0cc;stroke-width:1}
</style>
<rect width="100%" height="100%" fill="#f4f7f6" />
${maskBlock}${title}
${floorPanels.join("\n")}
${images.join("\n")}
${hexMarks.join("\n")}
${edgeLines.join("\n")}
${nodeMarks.join("\n")}
${chrome}
</svg>
`;
}

/**
 * Legibility pad (graph-local units) added to a node's own `extentUnits`
 * reveal footprint. Current fixtures author no explicit per-node extents
 * (rooms ride the bundle DEFAULT extent, which the model deliberately does
 * not resolve — see `SpatialGraphNode.extentUnits`) — a bare 1-unit reveal
 * would be an unreadable pinprick against a 30+-cell backdrop, so this
 * constant is a rendering/legibility choice, not a domain concept; it grows
 * the reveal automatically once real per-node extents get authored.
 */
const BACKDROP_REVEAL_MARGIN_CELLS = 1.5;

/** Render one node's planar extent. Mask callers add a graph-local legibility
 * margin; ordinary map marks use the authored geometry exactly. */
function renderExtentShape(
	node: SpatialGraphNode,
	x: number,
	y: number,
	scale: number,
	className: string,
	marginUnits = 0,
): string {
	const extent = node.extent;
	const width = ((extent?.widthUnits ?? 1) + marginUnits * 2) * scale;
	const height = ((extent?.heightUnits ?? 1) + marginUnits * 2) * scale;
	const attrs = className === "extent-mask" ? 'fill="#fff"' : `class="${className}"`;
	if (extent?.shapeId === "core/area/cube") {
		return `<rect x="${fmt(x - width / 2)}" y="${fmt(y - height / 2)}" width="${fmt(width)}" height="${fmt(height)}" ${attrs} />`;
	}
	// Sphere and the no-explicit-extent reveal fallback are circles. Unknown
	// explicit shapes intentionally retain the ordinary point mark until a
	// renderer arm defines their geometry.
	const rx = width / 2;
	const ry = height / 2;
	if (extent === undefined || extent.shapeId === "core/area/sphere") {
		return rx === ry
			? `<circle cx="${fmt(x)}" cy="${fmt(y)}" r="${fmt(rx)}" ${attrs} />`
			: `<ellipse cx="${fmt(x)}" cy="${fmt(y)}" rx="${fmt(rx)}" ry="${fmt(ry)}" ${attrs} />`;
	}
	return "";
}

/** Z has no honest screen-space projection on a plan. Keep x/y aligned to the
 * backdrop and annotate the footprint's full vertical span at its top-right. */
function renderExtentDepth(node: SpatialGraphNode, x: number, y: number, scale: number): string {
	const extent = node.extent;
	if (extent === undefined) return "";
	const right = x + (extent.widthUnits * scale) / 2 - 3;
	const top = y - (extent.heightUnits * scale) / 2 + 11;
	return `<text x="${fmt(right)}" y="${fmt(top)}" class="extent-depth" fill="#0f5f61" font-size="9" font-weight="800" text-anchor="end" paint-order="stroke" stroke="#fff" stroke-width="3" stroke-linejoin="round">↕ ${escapeXml(formatMetresLabel(extent.depthMetres))}</text>`;
}

/** The floor part of a node label (` (z=-3)`), or "" on the ground floor and
 * for a node with no authored elevation. Drawn as `tspan.label-floor`. */
function elevSuffix(elevation: number, present: boolean): string {
	if (!present || elevation === 0) return "";
	const z = Number.isInteger(elevation) ? String(elevation) : elevation.toFixed(1);
	return ` (z=${z})`;
}

function labelWithElev(label: string, elevation: number, present: boolean): string {
	return `${label}${elevSuffix(elevation, present)}`;
}

function titlePlain(model: SpatialGraphModel, options: RenderSvgOptions): string {
	const name = model.graphs[0]?.graphId ?? "spatial graph";
	return options.sliceCaption ? `${name} — ${options.sliceCaption}` : name;
}

function renderTitleBar(
	width: number,
	titleH: number,
	model: SpatialGraphModel,
	options: RenderSvgOptions,
): string {
	const graphName = humanGraphName(model);
	const sub =
		options.sliceCaption ??
		model.sliceLabel ??
		(model.floors.length > 1 ? `floors ${model.floors.join(", ")}` : "plan");
	const substrate = model.graphs[0]?.substrateId;
	const subFull = substrate ? `${humanSlice(sub)} · ${substrate}` : humanSlice(sub);
	return `<g class="title-bar">
<text class="title-main" x="16" y="22">${escapeXml(graphName)}</text>
<text class="title-sub" x="16" y="38">${escapeXml(subFull)}</text>
<line class="title-rule" x1="12" y1="${fmt(titleH - 2)}" x2="${fmt(width - 12)}" y2="${fmt(titleH - 2)}" />
</g>`;
}

/** Collapse a uniform authored z span into the title instead of repeating the
 * same badge over every small room. Mixed depths stay node-local. */
function extentDepthSummary(model: SpatialGraphModel, options: RenderSvgOptions): number | null {
	if (options.showExtentDepth !== true) return null;
	const depths = [
		...new Set(
			model.nodes.flatMap((node) =>
				!node.unlabeled && node.extent !== undefined
					? [Number(node.extent.depthMetres.toFixed(6))]
					: [],
			),
		),
	];
	return depths.length === 1 ? (depths.at(0) ?? null) : null;
}

function humanGraphName(model: SpatialGraphModel): string {
	const named = model.graphs[0]?.displayName?.trim();
	if (named) return named;
	const id = model.graphs[0]?.graphId ?? model.root ?? "Spatial graph";
	const leaf = id.split("/").at(-1) ?? id;
	return leaf.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanSlice(raw: string): string {
	if (raw.startsWith("elevation_band")) {
		const m = /z=([-\d.]+)/.exec(raw);
		const z = m?.[1] ?? "0";
		if (z === "0" || z === "0.0") return "Ground floor only";
		return `Floor slice z=${z}`;
	}
	if (raw.startsWith("all_floors_offset")) return "All floors (stacked panels)";
	if (raw.startsWith("topology_only")) return "Topology layout (no metric positions)";
	if (raw === "metric") return "Metric plan (all elevations flattened)";
	return raw;
}

function renderMapChrome(
	width: number,
	height: number,
	chromeH: number,
	scaleBar: ScaleBarSpec | null,
	showStairsLegend: boolean,
	commonExtentDepth: number | null,
): string {
	const y0 = height - chromeH;
	const pad = 12;
	const parts: string[] = [
		`<g class="map-chrome" data-chrome="legend" transform="translate(0 ${fmt(y0)})">`,
		`<line x1="${pad}" y1="0.5" x2="${fmt(width - pad)}" y2="0.5" stroke="#c5d0cc" stroke-width="1" />`,
	];

	let cursorX = pad;
	if (scaleBar !== null && scaleBar.px >= 12) {
		const barY = 14;
		const barPx = scaleBar.px;
		const label = formatMetresLabel(scaleBar.metres);
		parts.push(
			`<g class="scale-bar-group" data-scale-metres="${escapeXml(String(scaleBar.metres))}" data-scale-px="${fmt(barPx)}">`,
			`<line class="scale-bar" x1="${fmt(cursorX)}" y1="${barY}" x2="${fmt(cursorX + barPx)}" y2="${barY}" />`,
			`<line class="scale-bar" x1="${fmt(cursorX)}" y1="${barY - 5}" x2="${fmt(cursorX)}" y2="${barY + 5}" />`,
			`<line class="scale-bar" x1="${fmt(cursorX + barPx)}" y1="${barY - 5}" x2="${fmt(cursorX + barPx)}" y2="${barY + 5}" />`,
			`<text class="scale-bar-label" x="${fmt(cursorX + barPx / 2)}" y="${barY + 16}">${escapeXml(label)}</text>`,
			`</g>`,
		);
		cursorX += barPx + 28;
	}

	const symY = 14;
	parts.push(`<g class="symbol-legend" transform="translate(${fmt(cursorX)} 0)">`);
	parts.push(
		`<circle cx="6" cy="${symY}" r="6" class="place" />`,
		`<text class="chrome-label" x="18" y="${symY + 4}">place</text>`,
		`<line class="route" x1="62" y1="${symY}" x2="86" y2="${symY}" />`,
		`<text class="chrome-label" x="92" y="${symY + 4}">route</text>`,
		`<circle cx="148" cy="${symY}" r="9" class="actor" />`,
		`<text class="actor-label" x="148" y="${symY + 3.5}">n</text>`,
		`<text class="chrome-label" x="164" y="${symY + 4}">occupants</text>`,
	);
	if (showStairsLegend) {
		parts.push(
			`<line class="route-stairs" x1="248" y1="${symY}" x2="278" y2="${symY}" />`,
			`<text class="chrome-label" x="284" y="${symY + 4}">stairs / floor link</text>`,
		);
	}
	if (commonExtentDepth !== null) {
		parts.push(
			`<text class="chrome-label" style="text-anchor:end" x="${fmt(width - pad - cursorX)}" y="${symY + 4}">footprints ↕ ${escapeXml(formatMetresLabel(commonExtentDepth))}</text>`,
		);
	}
	parts.push(`</g></g>`);
	return parts.join("\n");
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function layoutBounds(
	layout: SpatialGraphLayout,
	backdrops: readonly SpatialGraphBackdrop[],
): { minX: number; minY: number; maxX: number; maxY: number } {
	const pts = [...layout.nodes];
	for (const panel of layout.floorPanels ?? []) {
		pts.push(
			{
				x: panel.minX,
				y: panel.minY,
				id: "",
				label: "",
				graphId: "",
				elevation: 0,
				elevationPresent: false,
				substrateId: null,
			},
			{
				x: panel.maxX,
				y: panel.maxY,
				id: "",
				label: "",
				graphId: "",
				elevation: 0,
				elevationPresent: false,
				substrateId: null,
			},
		);
	}
	const bounds = mapBounds(pts.length > 0 ? pts : [{ x: 0, y: 0 }]);
	// A node coordinate is its extent centre. Include explicit half-extents so
	// large rooms and pools participate in fit-to-canvas instead of clipping at
	// the viewport edge.
	for (const node of layout.nodes) {
		if (node.extent === undefined) continue;
		const halfW = node.extent.widthUnits / 2;
		const halfH = node.extent.heightUnits / 2;
		bounds.minX = Math.min(bounds.minX, node.x - halfW);
		bounds.minY = Math.min(bounds.minY, node.y - halfH);
		bounds.maxX = Math.max(bounds.maxX, node.x + halfW);
		bounds.maxY = Math.max(bounds.maxY, node.y + halfH);
	}
	for (const graph of layout.graphs) {
		const backdrop = backdrops.find((candidate) => candidate.graph_id === graph.graphId);
		if (backdrop === undefined) continue;
		for (const [x, y] of backdrop.image_bounds_cells) {
			bounds.minX = Math.min(bounds.minX, x + graph.offsetX);
			bounds.minY = Math.min(bounds.minY, y + graph.offsetY);
			bounds.maxX = Math.max(bounds.maxX, x + graph.offsetX);
			bounds.maxY = Math.max(bounds.maxY, y + graph.offsetY);
		}
	}
	for (const hex of layout.hexes ?? []) {
		for (const p of hex.ring) {
			bounds.minX = Math.min(bounds.minX, p.x);
			bounds.minY = Math.min(bounds.minY, p.y);
			bounds.maxX = Math.max(bounds.maxX, p.x);
			bounds.maxY = Math.max(bounds.maxY, p.y);
		}
	}
	return bounds;
}

function uniqueEdges(edges: readonly SpatialGraphEdge[]): SpatialGraphEdge[] {
	const byPair = new Map<string, SpatialGraphEdge>();
	for (const edge of edges) {
		const key = edge.from < edge.to ? `${edge.from}|${edge.to}` : `${edge.to}|${edge.from}`;
		if (!byPair.has(key)) byPair.set(key, edge);
	}
	return [...byPair.values()];
}

function fmt(value: number): string {
	if (!Number.isFinite(value)) return "0";
	const rounded = Math.round(value * 100) / 100;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

/** Test helper: node ids stamped on the SVG. */
export function svgNodeIds(svg: string): string[] {
	return [...svg.matchAll(/data-node-id="([^"]+)"/g)].map((m) => m[1]!);
}

/** Test helper: undirected edge pairs. */
export function svgEdgePairs(svg: string): string[] {
	return [...svg.matchAll(/data-from="([^"]+)" data-to="([^"]+)"/g)]
		.map((m) => {
			const a = m[1]!;
			const b = m[2]!;
			return a < b ? `${a}|${b}` : `${b}|${a}`;
		})
		.sort((a, b) => a.localeCompare(b));
}
