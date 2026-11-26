/**
 * Node-only spatial-graph pieces (`node:fs` / child_process / resvg / timg).
 * Must stay free of `@earendil-works/pi-tui` (optional peer): see `node/terminal.ts`.
 * Browser consumers must use `@spellkave/world-map/svg` only.
 */

export { type LoadedBundle, loadBundle, loadRowsSource } from "../load-bundle.ts";
export {
	backdropAssetDataHref,
	mapLayersToBackdrops,
	readPngSize,
	resolveFvttDataRoot,
	resolveMapAssetsRoot,
	resolveMapLayerAssetPath,
} from "./backdrop-resolve.ts";
export {
	type MapJpegOutputTarget,
	mapLayerFingerprint,
	provenanceHash,
	resolveMapJpegOutput,
	type WriteJpegResult,
	writeJpegWithChurnGuard,
} from "./jpeg-write.ts";
export { type RasterizeSvgResult, rasterizeSvgToPng } from "./rasterize.ts";
// Terminal image-protocol helpers (pi-tui) live in `@spellkave/world-map/node/terminal`
// — NOT here. This barrel is loaded by the hosted PLAYER MCP gateway
// (`pnpm deploy --prod`, no devDependencies), where pi-tui is absent (#2468).
export {
	findTimgBinary,
	isTimgPixelation,
	preferTimgUnicodeBlocks,
	renderPngWithTimg,
	type TimgPixelation,
	timgBytesToLines,
} from "./timg-backend.ts";
export {
	attachSpatialGraphImageToToolResult,
	type SpatialToolResultLike,
} from "./tool-result-image.ts";
