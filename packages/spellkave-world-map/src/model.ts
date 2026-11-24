/**
 * In-memory OSM document model (ADR-0123 D-3/D-4).
 *
 * **Id representation:** every OSM id is a decimal **string** of a positive
 * 63-bit integer (FNV-1a-64 masked). Never `number` — values exceed
 * Number.MAX_SAFE_INTEGER. Writers emit the string verbatim; consumers that
 * need bigint parse with `BigInt(id)`.
 */

export interface OsmMeta {
	/** Decimal string of a positive 63-bit OSM id. */
	id: string;
	version: number;
	changeset: number;
	uid: number;
	user: string;
	visible: boolean;
	timestamp: string;
}

export interface OsmNode extends OsmMeta {
	type: "node";
	lat: number;
	lon: number;
	tags: Record<string, string>;
}

export interface OsmWay extends OsmMeta {
	type: "way";
	/** Ordered node id refs (decimal strings). Closed areas repeat the first ref last. */
	refs: string[];
	tags: Record<string, string>;
}

export interface OsmMember {
	type: "node" | "way" | "relation";
	ref: string;
	role: string;
}

export interface OsmRelation extends OsmMeta {
	type: "relation";
	members: OsmMember[];
	tags: Record<string, string>;
}

export interface OsmDocument {
	generator: string;
	tick: number;
	timestamp: string;
	nodes: OsmNode[];
	ways: OsmWay[];
	relations: OsmRelation[];
}

export interface UnplacedGraph {
	place_graph_id: string;
	reason: string;
}

export interface BackdropEntry {
	id: string;
	graph: string;
	relation_id: string;
	name: string;
	// no description — map_layer has no such column (ADR-0123 G-4)
	url: string;
	asset: { module: string; path: string };
	source: string;
	license: string;
	state: string;
	size_px: [number, number];
	/** MapLibre image source order: TL, TR, BR, BL as [lon, lat]. */
	coordinates: [[number, number], [number, number], [number, number], [number, number]];
	grid_distance_m?: number;
	minzoom?: number;
	maxzoom?: number;
}

export interface ExportManifest {
	generator: string;
	timestamp: string;
	tick: number;
	origin: {
		lat: number;
		lon: number;
		cell_res10_hex: string;
		cell_res10_decimal: string;
	} | null;
	counts: {
		nodes: number;
		ways: number;
		relations: number;
		backdrops: number;
		unplaced_graphs: number;
	};
	unplaced_graphs: UnplacedGraph[];
	/** Human-readable notes (bootstrap fallback, substrate gaps, …). */
	diagnostics: string[];
}

export interface OsmExport {
	doc: OsmDocument;
	backdrops: BackdropEntry[];
	manifest: ExportManifest;
}
