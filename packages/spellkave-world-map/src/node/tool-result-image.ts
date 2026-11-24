import { rasterizeSvgToPng } from "./rasterize.ts";

/** Minimal tool-result shape (pi-agent-core AgentToolResult-compatible). */
export interface SpatialToolResultLike {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	details?: unknown;
}

/**
 * If `details.svg` is present, rasterize to PNG and append an ImageContent
 * block so Pi's TUI (and any host that renders tool-result images) shows the
 * map inline — same product as `sk map-render` without --out.
 *
 * Large `svg` is stripped from details after rasterize to keep LLM context small;
 * `inventory` and counts remain.
 */
export async function attachSpatialGraphImageToToolResult<T extends SpatialToolResultLike>(
	result: T,
): Promise<T> {
	const details = result.details;
	if (typeof details !== "object" || details === null || Array.isArray(details)) {
		return result;
	}
	const record = details as Record<string, unknown>;
	const svg = typeof record.svg === "string" ? record.svg : null;
	if (svg === null || svg.length === 0) return result;
	// Idempotent: tool run + host wrapper may both call this; keep a single PNG.
	if (result.content.some((block) => block.type === "image")) return result;

	try {
		const { png, mimeType } = await rasterizeSvgToPng(svg);
		const data = png.toString("base64");
		const inventory =
			typeof record.inventory === "string" ? record.inventory : "Spatial graph rendered as image.";
		const textBlocks = result.content.filter((block) => block.type === "text");
		const hasText = textBlocks.some(
			(block) => typeof block.text === "string" && block.text.length > 0,
		);
		// Keep details.svg for hosts (sk) that paint from the vector; add ImageContent
		// for Pi TUI tool-result rendering (Ghostty/Kitty).
		return {
			...result,
			content: [
				...(hasText ? textBlocks : [{ type: "text" as const, text: inventory }]),
				{ type: "image" as const, data, mimeType },
			],
			details: record,
		};
	} catch {
		// Rasterize failure must not break the tool — keep original SVG details.
		return result;
	}
}
