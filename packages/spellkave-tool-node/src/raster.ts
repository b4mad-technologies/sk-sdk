import { join } from "node:path";
import type { NodeMapPort } from "@spellkave/tool-runtime";
import {
	attachSpatialGraphImageToToolResult,
	backdropAssetDataHref,
	mapLayerFingerprint,
	mapLayersToBackdrops,
	readPngSize,
	resolveMapJpegOutput,
	resolveMapLayerAssetPath,
	writeJpegWithChurnGuard,
} from "@spellkave/world-map/node";

/** Node raster persistence adapter; geometry and SVG generation stay in world-map. */
export const nodeMapPort: NodeMapPort = {
	mapLayersToBackdrops,
	backdropAssetDataHref: (backdrop) => backdropAssetDataHref(backdrop as never),
	attachSpatialGraphImage: (result) =>
		attachSpatialGraphImageToToolResult(result as never) as never,
	probeAssetDimensions({ assetModule, assetPath }) {
		const path = resolveMapLayerAssetPath({ asset_module: assetModule, asset_path: assetPath });
		return path === null ? undefined : (readPngSize(path) ?? undefined);
	},
	async writeJpeg({ outputDir, outputName, graph, svg, width, layerRows }) {
		const target = resolveMapJpegOutput(outputDir, outputName, graph);
		await writeJpegWithChurnGuard(
			target.dir,
			target.name,
			svg,
			width,
			mapLayerFingerprint(layerRows),
		);
		return { jpgPath: join(target.echoDir, `${target.name}.jpg`) };
	},
};
