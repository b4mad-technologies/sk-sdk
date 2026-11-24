/**
 * Host-boundary SVG → PNG. Uses @resvg/resvg-js when available.
 * Pure SVG remains the canonical product; this is only for pi-tui Image.
 */

export interface RasterizeSvgResult {
	png: Buffer;
	mimeType: "image/png";
}

export async function rasterizeSvgToPng(
	svg: string,
	options: { width?: number } = {},
): Promise<RasterizeSvgResult> {
	const { Resvg } = await import("@resvg/resvg-js");
	const resvg = new Resvg(svg, {
		fitTo:
			options.width === undefined
				? undefined
				: {
						mode: "width",
						value: options.width,
					},
	});
	const rendered = resvg.render();
	return { png: Buffer.from(rendered.asPng()), mimeType: "image/png" };
}
