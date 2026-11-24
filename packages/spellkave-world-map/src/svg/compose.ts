/**
 * Pure helpers for sk-pej D-2: composing an ephemeral session-grid graph
 * over its parent location's topology (and, via `layout.graphs`, its
 * backdrop). No SpacetimeDB/model/layout imports — kept leaf-level so the
 * anchor-centring math is unit-testable in isolation from row parsing.
 */
import { projectLocalPosition } from "../coords.ts";

const SESSION_GRID_ID_PREFIX = "session_grid_";

export function isEphemeralInstanceGraph(row: Record<string, unknown>, graphId: string): boolean {
	const explicit = row.is_ephemeral_instance;
	if (typeof explicit === "boolean") return explicit;
	return graphId.startsWith(SESSION_GRID_ID_PREFIX);
}

/**
 * Walk `parent_graph_id` upward from `graphId`, returning `[graphId,
 * parent, grandparent, ...]` (child-first). Stops at the first empty/
 * unresolvable parent or a repeated id (cycle guard); `maxDepth` bounds a
 * malformed chain. Only ONE hop (graphId's immediate parent) is meaningful
 * for sk-pej D-2's node/topology composition today (single-level session
 * grids), but backdrop-row resolution (tools.ts) wants the general walk
 * so a later >1-deep nesting case does not need a second rewrite.
 */
export function resolveGraphAncestorChain(
	graphRows: readonly Record<string, unknown>[],
	graphId: string,
	maxDepth = 8,
): string[] {
	const byId = new Map<string, Record<string, unknown>>();
	for (const row of graphRows) {
		const id = row.place_graph_id;
		if (typeof id === "string" && id.length > 0) byId.set(id, row);
	}
	const chain: string[] = [];
	const seen = new Set<string>();
	let current: string | undefined = graphId;
	while (
		current !== undefined &&
		current.length > 0 &&
		!seen.has(current) &&
		chain.length < maxDepth
	) {
		chain.push(current);
		seen.add(current);
		const row = byId.get(current);
		const parent =
			row !== undefined && typeof row.parent_graph_id === "string" ? row.parent_graph_id : "";
		current = parent.length > 0 ? parent : undefined;
	}
	return chain;
}

// This module performs NO unit conversion. It used to convert
// `map_layer.grid_distance_ft` from feet; sk-yze renamed that column to
// `grid_distance_m` and converted its stored values, so the whole spatial
// model is now metre-native end to end (`place_graph_definition
// .metres_per_unit`, the tactical grid's `cell_size_m`, `area_shape.rs`'s
// `radius_m`/`range_m`/`extent_m`). If you find yourself reaching for 0.3048
// here again, the value you are holding is in the wrong unit at its source —
// fix it there.

export interface Point2D {
	x: number;
	y: number;
}

/**
 * Real-world metres represented by ONE unit of the PARENT graph's own
 * local coordinate space — the single metres -> [parent-local-unit]
 * conversion `composeChildLocalToParentFrame`'s caller (model.ts) needs to
 * resolve before calling it.
 *
 * Prefers the parent's OWN authored `[[map_layers]]` backdrop row, when one
 * exists: `grid_distance_m`, metres per backdrop grid square, used as-is.
 * This is the CORRECT source, not
 * `place_graph_definition.metres_per_unit`, whenever the parent's own node
 * positions were authored against that backdrop's grid — which they
 * typically are: `render-svg.ts`'s backdrop placement adds
 * `SpatialGraphBackdrop.image_origin_cells` directly to node `x`/`y` with no
 * scale factor in between, i.e. the renderer already treats "one graph-local
 * unit" and "one map_layer-declared grid square" as the SAME unit. Checked
 * against real content: elven-mini's `tomb`/`inn` place_graph_definition
 * rows both carry `metres_per_unit = 1.0` (packages/spellkave-srd-cc/
 * fixtures/elven-mini/{tomb,inn}.manifest.toml) — an unmaintained default —
 * while their node `pos_x`/`pos_y` run up to 46/54 (tomb) and their OWN
 * map_layer rows declare `local_width_cells = 54`/`grid_distance_m = 1.524`
 * (adventure.manifest.toml:1016-1037) — i.e. positions are backdrop-cell
 * indices (each 1.524 m, the 5 ft square), NOT `metres_per_unit`-many
 * metres. Trusting `metres_per_unit` there would place the composed grid at
 * roughly 1/1.524 of its correct size. That `metres_per_unit = 1.0` is
 * itself a live gameplay defect, filed as sk-j1a — it also mis-scales
 * indoor range and movement checks, not just this render path.
 *
 * Falls back to `fallbackMetresPerUnit` (the parent's own
 * `place_graph_definition.metres_per_unit`, already documented
 * metres-per-unit) only when the parent authors no backdrop at all —
 * nothing better is knowable in that case, and `metres_per_unit` is at
 * least the field the renderer's own scale-bar chrome
 * (`sharedMetresPerGraphUnit`) already trusts.
 */
export function metresPerParentLocalUnit(
	parentMapLayerRow: Record<string, unknown> | undefined,
	fallbackMetresPerUnit: number,
): number {
	const gridDistanceM = parentMapLayerRow?.grid_distance_m;
	if (typeof gridDistanceM === "number" && Number.isFinite(gridDistanceM) && gridDistanceM > 0) {
		return gridDistanceM;
	}
	return fallbackMetresPerUnit > 0 ? fallbackMetresPerUnit : 1;
}

/** Bounds-derived centre of a node set in its own local coordinate space
 * (midpoint of min/max per axis) — the reference point D-2's ORIGIN
 * CONVENTION (bead sk-pej, operator decision 2026-08-13) centres the grid
 * on. Rejected alternatives (per the bead): cell (0,0) on the anchor
 * (arbitrary growth direction), grid fills the anchor node's extent
 * (blocked — nodes have no authored extent today, sk-71u). */
export function localBoundsCenter(nodes: readonly Point2D[]): Point2D {
	if (nodes.length === 0) return { x: 0, y: 0 };
	let minX = nodes[0]!.x;
	let maxX = nodes[0]!.x;
	let minY = nodes[0]!.y;
	let maxY = nodes[0]!.y;
	for (const n of nodes) {
		minX = Math.min(minX, n.x);
		maxX = Math.max(maxX, n.x);
		minY = Math.min(minY, n.y);
		maxY = Math.max(maxY, n.y);
	}
	return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

export interface AnchorComposeParams {
	/** Child graph-local units -> world METRES. For a session grid this is
	 * `place_graph_definition.metres_per_unit`, which the SERVER sets to
	 * `extent.cell_size` (r_session_open.rs:387) — and `cell_size` IS
	 * already metres: fixtures author it as `1.5240000486373901`, exactly
	 * `ft(5)` via the `feet * 0.3048` helper in
	 * `packages/spellkave-srd-cc/src/chapters/spells/spell-behaviors.ts`.
	 * Metres is the world unit throughout (cf. `area_shape.rs`'s `radius_m` /
	 * `range_m` / `extent_m` and `place_graph.rs:34-36`'s own doc comment on
	 * `metres_per_unit`); feet appear in exactly one place in the whole
	 * spatial model, `map_layer.grid_distance_m` — the ARTWORK's own grid
	 * convention, not the world's. */
	childMetresPerUnit: number;
	/** Real-world metres represented by ONE unit of the PARENT graph's own
	 * local coordinate space — the caller (model.ts) resolves this via
	 * `metresPerParentLocalUnit` (this module) BEFORE calling this function;
	 * see that function's doc for why it usually is NOT the parent's raw
	 * `place_graph_definition.metres_per_unit`. */
	parentMetresPerUnit: number;
	/** Clockwise degrees (ADR-0029 convention). Session grids hardcode
	 * 0.0 today (r_session_open.rs:386) — identity rotation — but this
	 * function does not special-case that away. */
	bearingDeg: number;
	/** Anchor node's RAW (pre-layout-offset) position in the parent's own
	 * local frame — the parent's own `place_node.pos_x/pos_y` for the node
	 * `place_graph_definition.anchor_node_id` points at. */
	anchor: Point2D;
	/** Child's own local-space centre (`localBoundsCenter` over its raw,
	 * untransformed nodes). */
	center: Point2D;
}

export function composeChildLocalToParentFrame(
	localX: number,
	localY: number,
	params: AnchorComposeParams,
): Point2D {
	const unitsPerLocal =
		params.childMetresPerUnit > 0 && params.parentMetresPerUnit > 0
			? params.childMetresPerUnit / params.parentMetresPerUnit
			: 1;
	const offset = projectLocalPosition(
		{ bearing_deg: params.bearingDeg, scale: unitsPerLocal },
		localX - params.center.x,
		localY - params.center.y,
	);
	return {
		x: params.anchor.x + offset.east_m,
		y: params.anchor.y + offset.north_m,
	};
}
