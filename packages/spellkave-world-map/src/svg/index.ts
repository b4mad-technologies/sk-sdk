/**
 * Browser-safe spatial-graph products: layout, SVG, ASCII, braille, inventory.
 * Node-only raster pieces live in `@spellkave/world-map/node`; terminal/pi-tui helpers in `@spellkave/world-map/node/terminal`.
 */

export {
	composeProjection,
	latLngToPlane,
	METRES_PER_DEG_LAT,
	type ProjectionParams,
	projectLocalPosition,
	type WorldOffset,
	worldOffsetToLatLng,
	worldOffsetToPlane,
} from "../coords.ts";
export {
	type AnchorComposeParams,
	composeChildLocalToParentFrame,
	isEphemeralInstanceGraph,
	localBoundsCenter,
	metresPerParentLocalUnit,
	type Point2D,
	resolveGraphAncestorChain,
} from "./compose.ts";
export {
	cellRes10ToHex,
	layoutOutdoorWorldByComposition,
	shouldUseH3WorldLayout,
} from "./h3-layout.ts";
export {
	countMapPlaces,
	isTacticalGridCell,
	renderSpatialGraphTextInventory,
} from "./inventory.ts";
export { layoutSpatialGraph, mapBounds } from "./layout.ts";
export { buildSpatialGraphModel, pickDefaultSlice } from "./model.ts";
export { type RenderAsciiOptions, renderSpatialGraphAscii } from "./render-ascii.ts";
export { type RenderBrailleOptions, renderSpatialGraphBraille } from "./render-braille.ts";
export { renderSpatialGraphSvg, svgEdgePairs, svgNodeIds } from "./render-svg.ts";
export {
	chooseScaleBar,
	formatMetresLabel,
	type ScaleBarSpec,
	sharedMetresPerGraphUnit,
} from "./scale.ts";
export type {
	RenderSvgOptions,
	SpatialGraphActorCluster,
	SpatialGraphBackdrop,
	SpatialGraphEdge,
	SpatialGraphLayout,
	SpatialGraphMeta,
	SpatialGraphModel,
	SpatialGraphNode,
	SpatialGraphToolRows,
	SpatialLod,
	SpatialSliceMode,
	SpatialViewOptions,
} from "./types.ts";

import { renderSpatialGraphTextInventory } from "./inventory.ts";
import { layoutSpatialGraph } from "./layout.ts";
import { buildSpatialGraphModel, pickDefaultSlice } from "./model.ts";
import { type RenderAsciiOptions, renderSpatialGraphAscii } from "./render-ascii.ts";
import { type RenderBrailleOptions, renderSpatialGraphBraille } from "./render-braille.ts";
import { renderSpatialGraphSvg } from "./render-svg.ts";
import type {
	RenderSvgOptions,
	SpatialGraphModel,
	SpatialGraphToolRows,
	SpatialViewOptions,
} from "./types.ts";

/** Which terminal map to put in the primary text body. */
export type SpatialTerminalMode = "utf8" | "ascii" | "braille";

/**
 * A single computable artifact off the shared model+layout. `buildSpatialGraphView`
 * used to render all four unconditionally on every call regardless of what a
 * caller actually wanted — the direct cost behind bead sk-due (18 unread SVG
 * payloads bloating the kavemouth story JSONL 286 KB -> 380 KB). `renderOnly`
 * below is the opt-in fix; `inventory`/`model`/`hasLayout` are not artifacts in
 * this sense — they are the cheap part and stay unconditional.
 */
export type SpatialArtifact = "svg" | "utf8" | "ascii" | "braille";

export interface SpatialGraphView {
	model: SpatialGraphModel;
	svg: string | null;
	/**
	 * Primary terminal map for the tool text body (selected mode).
	 * Kept as `ascii` for back-compat with details.ascii consumers.
	 */
	ascii: string | null;
	/** UTF-8 box-drawing map (junction-aware). */
	utf8: string | null;
	/** Dense braille map via termdot. */
	braille: string | null;
	inventory: string;
	hasLayout: boolean;
}

export type BuildSpatialGraphViewOptions = SpatialViewOptions &
	RenderSvgOptions &
	RenderAsciiOptions &
	RenderBrailleOptions & {
		/** Primary terminal product (default utf8). Selects which computed text
		 * variant becomes `view.ascii` — has no effect on WHICH variants get
		 * rendered; that's `renderOnly` below. */
		terminal?: SpatialTerminalMode;
		/**
		 * Restrict which of svg/utf8/ascii/braille actually get rendered — omit
		 * to keep the historical "compute everything" default every non-tool
		 * caller (renders.ts, spellkave-cli's map.ts, author-spatial-map-proofs.ts)
		 * still relies on for byte-identical fixtures (none of them pass this).
		 * The two tool call sites (spellkave_map, spellkave_map_graph) are the
		 * only callers that pass it, deriving it 1:1 from their own
		 * `output_type` param via `spatialRenderPlanForOutputType` below (bead
		 * sk-due). An artifact not in `renderOnly` comes back `null`, never computed.
		 */
		renderOnly?: readonly SpatialArtifact[];
	};

/** One-shot: tool rows → model + SVG + terminal maps (or inventory-only when empty). */
export function buildSpatialGraphView(
	rows: SpatialGraphToolRows,
	options: BuildSpatialGraphViewOptions = {},
): SpatialGraphView {
	const {
		graphId,
		slice,
		z,
		zTolerance,
		lod,
		sheetAlign,
		preferH3World,
		composeParent,
		hideOccupancy: hideOccupancyOpt,
		sliceCaption: sliceCaptionOpt,
		width: termWidth,
		height: termHeight,
		unicode: asciiUnicode,
		chrome: termChrome,
		color: termColor,
		terminal = "utf8",
		renderOnly,
		...svgOptions
	} = options;
	const viewOpts: SpatialViewOptions = {
		graphId,
		slice,
		z,
		zTolerance,
		lod,
		sheetAlign,
		preferH3World,
		composeParent,
	};
	const model = buildSpatialGraphModel(rows, viewOpts);
	const inventory = renderSpatialGraphTextInventory(model);
	if (model.nodes.length === 0) {
		return {
			model,
			svg: null,
			ascii: null,
			utf8: null,
			braille: null,
			inventory,
			hasLayout: false,
		};
	}
	const sliceMode = pickDefaultSlice(model.nodes, viewOpts);
	const layout = layoutSpatialGraph(model, { ...viewOpts, sliceMode });
	if (layout.nodes.length === 0) {
		return {
			model,
			svg: null,
			ascii: null,
			utf8: null,
			braille: null,
			inventory,
			hasLayout: false,
		};
	}
	const hideOccupancy = hideOccupancyOpt ?? lod === "structure";
	const want = (artifact: SpatialArtifact): boolean =>
		renderOnly === undefined || renderOnly.includes(artifact);
	const svg = want("svg")
		? renderSpatialGraphSvg(model, layout, {
				...svgOptions,
				hideOccupancy,
				sliceCaption: sliceCaptionOpt ?? model.sliceLabel,
			})
		: null;
	const utf8 = want("utf8")
		? renderSpatialGraphAscii(model, layout, {
				width: termWidth,
				height: termHeight,
				unicode: asciiUnicode !== false,
				chrome: termChrome,
				color: termColor,
				hideOccupancy,
			})
		: null;
	const asciiOnly = want("ascii")
		? renderSpatialGraphAscii(model, layout, {
				width: termWidth,
				height: termHeight,
				unicode: false,
				chrome: termChrome,
				color: false,
				hideOccupancy,
			})
		: null;
	const braille = want("braille")
		? renderSpatialGraphBraille(model, layout, {
				width: termWidth,
				height: termHeight,
				chrome: termChrome,
				hideOccupancy,
			})
		: null;
	const primary = terminal === "ascii" ? asciiOnly : terminal === "braille" ? braille : utf8;
	return {
		model,
		svg,
		ascii: primary,
		utf8,
		braille,
		inventory,
		hasLayout: true,
	};
}

/** The 6-value `output_type` shape shared by `spellkave_map` and
 * `spellkave_map_graph` (bead sk-due — one flat enum, the canonical
 * `--format` shape, replacing the old `terminal` param that only picked the
 * TEXT variant while the engine rendered everything regardless). */
export type MapOutputType = "utf8" | "ascii" | "braille" | "inventory" | "svg" | "jpg";

/**
 * Derive the engine's `renderOnly`/`terminal` knobs from a map tool's own
 * `output_type` — the ONE place this mapping is written, so the two tools'
 * output_type semantics can never drift apart. `jpg` needs no artifact from
 * THIS call: its backdrop-composed raster source comes from a second,
 * dedicated `buildSpatialGraphView` call the jpg branch makes itself (sheet-
 * aligned, with backdrops) — see `spellkave_map`/`spellkave_map_graph`'s own
 * jpg branch. `inventory` renders nothing at all — `renderSpatialGraphTextInventory`
 * output is unconditional regardless of `renderOnly`.
 */
export function spatialRenderPlanForOutputType(outputType: MapOutputType): {
	renderOnly: readonly SpatialArtifact[];
	terminal: SpatialTerminalMode;
} {
	switch (outputType) {
		case "utf8":
			return { renderOnly: ["utf8"], terminal: "utf8" };
		case "ascii":
			return { renderOnly: ["ascii"], terminal: "ascii" };
		case "braille":
			return { renderOnly: ["braille"], terminal: "braille" };
		case "svg":
			return { renderOnly: ["svg"], terminal: "utf8" };
		case "inventory":
		case "jpg":
			return { renderOnly: [], terminal: "utf8" };
	}
}

/** Browser SVG product: model + laid-out SVG (or null when empty). */
export interface SpatialGraphSvgView {
	model: SpatialGraphModel;
	svg: string | null;
	hasLayout: boolean;
}

export type BuildSpatialGraphSvgViewOptions = SpatialViewOptions & RenderSvgOptions;

/**
 * One-shot browser path: tool rows → model → layout → SVG.
 * Same SVG bytes as `buildSpatialGraphView(..., { renderOnly: ["svg"] }).svg`
 * for identical inputs (asserted by browser-entry tests).
 */
export function buildSpatialGraphSvgView(
	rows: SpatialGraphToolRows,
	options: BuildSpatialGraphSvgViewOptions = {},
): SpatialGraphSvgView {
	const {
		graphId,
		slice,
		z,
		zTolerance,
		lod,
		sheetAlign,
		preferH3World,
		composeParent,
		hideOccupancy: hideOccupancyOpt,
		sliceCaption: sliceCaptionOpt,
		...svgOptions
	} = options;
	const viewOpts: SpatialViewOptions = {
		graphId,
		slice,
		z,
		zTolerance,
		lod,
		sheetAlign,
		preferH3World,
		composeParent,
	};
	const model = buildSpatialGraphModel(rows, viewOpts);
	if (model.nodes.length === 0) {
		return { model, svg: null, hasLayout: false };
	}
	const sliceMode = pickDefaultSlice(model.nodes, viewOpts);
	const layout = layoutSpatialGraph(model, { ...viewOpts, sliceMode });
	if (layout.nodes.length === 0) {
		return { model, svg: null, hasLayout: false };
	}
	const hideOccupancy = hideOccupancyOpt ?? lod === "structure";
	const svg = renderSpatialGraphSvg(model, layout, {
		...svgOptions,
		hideOccupancy,
		sliceCaption: sliceCaptionOpt ?? model.sliceLabel,
	});
	return { model, svg, hasLayout: true };
}
