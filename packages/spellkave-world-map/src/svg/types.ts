/** Shared spatial-graph view types (tool-result shaped; not ADR-0029 projection). */

export interface SpatialGraphNode {
	id: string;
	label: string;
	graphId: string;
	x: number;
	y: number;
	/** Graph-local pose_elevation; 0 when absent. */
	elevation: number;
	/** True when pose_elevation_present was set on the row. */
	elevationPresent: boolean;
	substrateId: string | null;
	/** H3 res10 hex index when authored (outdoor world compose). */
	cellRes10Hex?: string | null;
	/** World-map short label (optional). */
	shortLabel?: string | null;
	/** Outdoor node that portals into an indoor graph. */
	portalEntrance?: boolean;
	/** Node footprint DIAMETER in graph-local units, derived from the node's
	 * own authored extent (place_node.extent_shape_id/extent_params_json,
	 * metre-native HALF-extents — sphere → 2·radius_m, cube → 2·extent_m —
	 * divided by the graph's metres_per_unit). Absent when the node authors no explicit
	 * extent (bundle-default extents are NOT resolved here: the tool row set
	 * carries no mod_bundle rows) — callers fall back to a 1-unit footprint.
	 * Retained as the maximum planar diameter for compatibility; new drawing
	 * code should use `extent` so it does not collapse non-uniform shapes. */
	extentUnits?: number;
	/** Parsed explicit extent geometry. Params stay attached so adding a kernel
	 * shape is a renderer arm, not a model rewrite. width/height are the planar
	 * full extents in graph-local units; per-axis params take precedence over
	 * the legacy uniform scalar when present. */
	extent?: SpatialGraphNodeExtent;
	/** Draw the mark, suppress the text label (sk-pej D-3). Set on composed
	 * tactical-grid cells: 100 cells means 100 labels, which collapse into an
	 * unreadable smear over the backdrop art and say nothing a reader wants —
	 * "Cell 4,7" is a coordinate, not a place name. The cells stay in the SVG
	 * as marks with their `data-node-id`; the text inventory summarizes the grid
	 * and names only occupied or notable cells. */
	unlabeled?: boolean;
}

export interface SpatialGraphNodeExtent {
	shapeId: string;
	params: Readonly<Record<string, unknown>>;
	widthUnits: number;
	heightUnits: number;
	/** Full authored vertical extent in metres. Unlike x/y this stays metre-native,
	 * because a 2D sheet has no meaningful screen-space z scale. */
	depthMetres: number;
}

export interface SpatialGraphEdge {
	from: string;
	to: string;
	graphId: string;
}

export interface SpatialGraphActorCluster {
	placeNodeId: string;
	count: number;
}

export interface SpatialGraphMeta {
	graphId: string;
	/** place_graph.metres_per_unit: one graph unit → metres (ADR-0029). Default 1. */
	metresPerUnit: number;
	substrateId: string | null;
	displayName: string | null;
	/** Composition parent (empty = root). */
	parentGraphId?: string;
	/** Root outdoor H3 anchor (hex), when set. */
	originCellRes10Hex?: string | null;
	/** Clockwise degrees (ADR-0029). */
	bearing?: number;
	anchorNodeId?: string | null;
}

export interface SpatialGraphModel {
	nodes: SpatialGraphNode[];
	edges: SpatialGraphEdge[];
	actorClusters: SpatialGraphActorCluster[];
	/** Authored graph rows touched by the drawn nodes (metres_per_unit/bearing source). */
	graphs: SpatialGraphMeta[];
	root: string | null;
	reachable: string[];
	unreachable: string[];
	/** Floors discovered before slice filtering (sorted ascending). */
	floors: number[];
	/** Active slice description for inventory/chrome. */
	sliceLabel: string;
	notableScopes: SpatialGraphNotableScope[];
}

export interface SpatialGraphNotableScope {
	anchorNodeId: string;
	nicheId: string;
	x: number;
	y: number;
	extent: SpatialGraphNodeExtent;
}

export interface SpatialGraphBackdrop {
	graph_id: string;
	scene: string;
	module: string;
	asset: string;
	width_cells: number;
	height_cells: number;
	image_origin_cells: [number, number];
	image_bounds_cells: [[number, number], [number, number], [number, number], [number, number]];
	rotation_deg: number;
	state: "aligned" | "provisional" | "unmatched";
}

export interface SpatialGraphHexFootprint {
	hex: string;
	ring: Array<{ x: number; y: number }>;
	/** CSS class suffix for fill (terrain / ownership prep). */
	fillKind?: "root" | "settlement" | "wilderness" | "default";
}

export interface SpatialGraphLayout {
	nodes: SpatialGraphNode[];
	edges: SpatialGraphEdge[];
	graphs: Array<{ graphId: string; offsetX: number; offsetY: number }>;
	/** Optional floor panel labels for all_floors_offset. */
	floorPanels?: Array<{
		elevation: number;
		title: string;
		minX: number;
		minY: number;
		maxX: number;
		maxY: number;
	}>;
	/** Edges that cross floor panels (stairs) — dashed in SVG. */
	crossFloorEdgeKeys?: string[];
	/** H3 cell outlines in layout plane (outdoor world compose). */
	hexes?: SpatialGraphHexFootprint[];
}

export interface SpatialGraphToolRows {
	place_graphs?: readonly Record<string, unknown>[];
	place_nodes?: readonly Record<string, unknown>[];
	place_edges?: readonly Record<string, unknown>[];
	actor_spatial_locations?: readonly Record<string, unknown>[];
	/**
	 * Optional, unfiltered `[[map_layers]]` rows. sk-pej D-2's session-grid
	 * composition needs the PARENT graph's own `grid_distance_m` to convert
	 * the grid's metre-native `cell_size` into the parent's own backdrop-cell
	 * coordinate space (see `compose.ts`'s `metresPerParentLocalUnit`) — a
	 * DIFFERENT concern from `RenderSvgOptions.backdrops`, which is what
	 * actually draws the artwork. Absent, or no row matching the composed
	 * parent's `place_graph_id`, falls back to
	 * `place_graph_definition.metres_per_unit`.
	 */
	map_layers?: readonly Record<string, unknown>[];
	visible_spatial_niche_attachments?: readonly Record<string, unknown>[];
	/** Public geometry used only for visible attachment scopes, never rendered. */
	notable_anchor_nodes?: readonly Record<string, unknown>[];
}

/**
 * How to project a (possibly multi-floor / unpositioned) graph into 2D.
 * - elevation_band: one floor (default for indoor multi-z)
 * - all_floors_offset: floors side-by-side
 * - topology_only: ignore coords; place by adjacency
 * - metric: all positioned nodes in one plane (legacy outdoor)
 */
export type SpatialSliceMode =
	| "elevation_band"
	| "all_floors_offset"
	| "topology_only"
	| "metric"
	/** Outdoor multi-graph compose from cell_res10 (h3-js), same idea as web WorldMapView. */
	| "h3_world";

export type SpatialLod = "structure" | "furnished";

export interface SpatialViewOptions {
	graphId?: string;
	/** Slice mode; auto-picked when omitted. */
	slice?: SpatialSliceMode;
	/** Elevation for elevation_band (default 0). */
	z?: number;
	/** Half-width of elevation band (default 0.5). */
	zTolerance?: number;
	/** structure = rooms only; furnished = + occupancy badges (default). */
	lod?: SpatialLod;
	/**
	 * Keep authored x/y (no indoor Y-flip). Use when placing nodes in map-image
	 * cell space under a [[map_layers]] backdrop (map-from-image product views).
	 */
	sheetAlign?: boolean;
	/**
	 * Prefer H3 cell plane for unfiltered outdoor compose when nodes carry cell_res10.
	 * Default true. Set false to force graph-local metric side-by-side compose.
	 */
	preferH3World?: boolean;
	/**
	 * Compose an ephemeral session-grid graph (`graphId`) over its parent
	 * location's own topology when `graphId` resolves to a
	 * `place_graph_definition` row with `is_ephemeral_instance = true` and a
	 * resolvable `parent_graph_id` (bead sk-pej D-2, operator decision
	 * 2026-08-13: "compose by default... one picture, no mode switch").
	 * Default true — the map tool's own `compose_parent` param is this
	 * option's escape hatch, settable to `false` to force the grid-alone
	 * single view. Has NO effect when `graphId` is not itself an ephemeral
	 * instance (an ordinary authored nested graph, e.g. elven-mini's
	 * `tomb`/`inn` under `hamlet`, never composes regardless of this flag —
	 * see `isEphemeralInstanceGraph` in `compose.ts`), so existing non-grid
	 * callers render byte-identically whether this is set or omitted.
	 */
	composeParent?: boolean;
}

export interface RenderSvgOptions {
	width?: number;
	height?: number;
	pad?: number;
	/** Optional backdrop image href resolver; when omitted, backdrops are skipped. */
	backdropHref?: (backdrop: SpatialGraphBackdrop) => string | null;
	backdrops?: readonly SpatialGraphBackdrop[];
	ariaLabel?: string;
	/** Hide actor badges (structure LOD). */
	hideOccupancy?: boolean;
	/** Extra title drawn under chrome (slice label). */
	sliceCaption?: string;
	/** Annotate explicit footprints with their full vertical span (for example ↕ 3 m). */
	showExtentDepth?: boolean;
	/**
	 * Mask backdrop `<image>`s to the drawn nodes' own footprints (player-map
	 * PNG mode) — an SVG `<mask>` built from `layout.nodes` (already the
	 * fog-of-war-filtered known set for PLAYER callers), each node revealing its
	 * own extent shape plus a fixed legibility margin.
	 * Default false/undefined — written and tested, but NOT enabled by any
	 * caller today: `spellkave_map` (tools.ts) renders the backdrop in
	 * full/unmasked per operator decision 2026-08-12 (the fog-of-war applies
	 * to the GRAPH drawn on top, not to the art). AUTHOR's `spellkave_map_graph`
	 * never sets this either, so its SVG output stays byte-identical. Turning
	 * this on for the player tool is tracked as bead sk-ubx.
	 */
	maskBackdropToNodes?: boolean;
}
