/** Metric scale-bar helpers for the spatial-graph SVG chrome (cartographic nice lengths). */

export interface ScaleBarSpec {
	/** Bar length in world metres. */
	metres: number;
	/** Bar length in SVG pixels. */
	px: number;
	/** Graph-unit → metres used for the bar (place_graph.metres_per_unit). */
	metresPerGraphUnit: number;
	/** Layout pixels per world metre. */
	pxPerMetre: number;
}

/**
 * Resolve a single metres-per-graph-unit for the drawn set.
 * Same scale across graphs → that value; mixed scales → null (omit bar).
 */
export function sharedMetresPerGraphUnit(
	graphs: readonly { metresPerUnit: number }[],
): number | null {
	if (graphs.length === 0) return null;
	const first = graphs[0]!.metresPerUnit;
	for (const graph of graphs) {
		if (!(graph.metresPerUnit > 0) || Math.abs(graph.metresPerUnit - first) > 1e-9) return null;
	}
	return first;
}

/**
 * Pick a 1–2–5×10ⁿ bar length near `targetPx`, capped at `maxPx`.
 * `layoutPxPerGraphUnit` is the SVG fit scale (pixels per pos_x unit).
 */
export function chooseScaleBar(
	layoutPxPerGraphUnit: number,
	metresPerGraphUnit: number,
	options: { targetPx?: number; maxPx?: number } = {},
): ScaleBarSpec | null {
	if (!(layoutPxPerGraphUnit > 0) || !(metresPerGraphUnit > 0)) return null;
	const targetPx = options.targetPx ?? 100;
	const maxPx = options.maxPx ?? 200;
	const pxPerMetre = layoutPxPerGraphUnit / metresPerGraphUnit;
	if (!(pxPerMetre > 0) || !Number.isFinite(pxPerMetre)) return null;

	const rawMetres = targetPx / pxPerMetre;
	if (!(rawMetres > 0) || !Number.isFinite(rawMetres)) return null;

	const exp = Math.floor(Math.log10(rawMetres));
	const base = 10 ** exp;
	const candidates = [1, 2, 5, 10, 20, 50]
		.flatMap((m) => [m * base * 0.1, m * base, m * base * 10])
		.filter((m) => m > 0 && Number.isFinite(m));
	const unique = [...new Set(candidates.map((m) => roundMetres(m)))].sort((a, b) => a - b);

	let best: { metres: number; px: number } | null = null;
	for (const metres of unique) {
		const px = metres * pxPerMetre;
		if (px < 24) continue; // too short to read
		if (px > maxPx) {
			if (best === null) {
				// nothing fit yet — take this if still vaguely usable after clamp intent
				continue;
			}
			break;
		}
		if (best === null || Math.abs(px - targetPx) < Math.abs(best.px - targetPx)) {
			best = { metres, px };
		}
	}
	// Fallback: largest candidate under maxPx, or min readable fraction of span
	if (best === null) {
		for (const metres of unique) {
			const px = metres * pxPerMetre;
			if (px <= maxPx && px >= 12) best = { metres, px };
		}
	}
	if (best === null) return null;
	return {
		metres: best.metres,
		px: best.px,
		metresPerGraphUnit,
		pxPerMetre,
	};
}

export function formatMetresLabel(metres: number): string {
	if (Number.isInteger(metres) || Math.abs(metres - Math.round(metres)) < 1e-9) {
		return `${Math.round(metres)} m`;
	}
	const rounded = Math.round(metres * 100) / 100;
	return `${rounded} m`;
}

function roundMetres(value: number): number {
	if (value >= 1) return Math.round(value * 1000) / 1000;
	// keep short decimals for sub-metre bars
	const digits = value >= 0.1 ? 2 : 3;
	const f = 10 ** digits;
	return Math.round(value * f) / f;
}
