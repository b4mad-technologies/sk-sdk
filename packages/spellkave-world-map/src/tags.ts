/**
 * ADR-0123 D-2 tag helpers: indoor/outdoor class via coordinate_kind_id,
 * level index from elevation, and the LEVEL_HEIGHT_M convention.
 *
 * Class is NEVER matched on the substrate_id string literal. A modder-authored
 * `cave` substrate on `graph_local` is indoor-class.
 */

/** Default storey height (metres) — ADR-0123 D-2 / G-1. */
export const LEVEL_HEIGHT_M = 3.0;

export type SpatialClass = "indoor" | "outdoor" | "tactical" | "drop";

/** Kernel bootstrap seed used when substrate_definitions rows are absent. */
export const CORE_SUBSTRATE_KINDS: Readonly<Record<string, string>> = {
	outdoor: "h3_cell",
	indoor: "graph_local",
	tactical: "tactical_grid",
};

export function spatialClassOf(
	substrateId: string,
	kindBySubstrate: ReadonlyMap<string, string>,
): SpatialClass {
	const kind = kindBySubstrate.get(substrateId) ?? CORE_SUBSTRATE_KINDS[substrateId] ?? "";
	if (kind === "graph_local") return "indoor";
	if (kind === "h3_cell") return "outdoor";
	if (kind === "tactical_grid") return "tactical";
	// Unknown kind: outdoor-class (no SIT tags) rather than inventing floors.
	return "outdoor";
}

/**
 * Build substrate_id → coordinate_kind_id map.
 * Starts from the kernel bootstrap seed, then overlays authored
 * substrate_definitions. Returns whether the bootstrap fallback was needed
 * (no authored rows, or a row still resolved only via CORE_SUBSTRATE_KINDS).
 */
export function buildCoordinateKindMap(
	substrateDefinitions: readonly { substrate_id: string; coordinate_kind_id: string }[],
): { kindBySubstrate: Map<string, string>; usedBootstrapFallback: boolean } {
	const kindBySubstrate = new Map<string, string>();
	for (const [id, kind] of Object.entries(CORE_SUBSTRATE_KINDS)) {
		kindBySubstrate.set(id, kind);
	}
	let authored = 0;
	for (const s of substrateDefinitions) {
		if (s.substrate_id && s.coordinate_kind_id) {
			kindBySubstrate.set(s.substrate_id, s.coordinate_kind_id);
			authored += 1;
		}
	}
	return {
		kindBySubstrate,
		usedBootstrapFallback: authored === 0,
	};
}

/** level index = round(elevation / LEVEL_HEIGHT_M) when indoor/tactical-class + elevation present. */
export function levelIndex(
	poseElevationPresent: boolean,
	poseElevation: number,
	cls: SpatialClass,
): number | null {
	if (!poseElevationPresent) return null;
	if (cls !== "indoor" && cls !== "tactical") return null;
	return Math.round(poseElevation / LEVEL_HEIGHT_M);
}
