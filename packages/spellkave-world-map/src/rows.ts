/**
 * Plain-row contract for @spellkave/world-map.
 *
 * Accepts the snake_case shapes of:
 * - `@spellkave/sdk` `readPlaceTopology()` / `readMapLayers()`
 * - manifest TOML rows (`place_graphs`, `place_nodes`, `place_edges`, `map_layers`,
 *   `substrate_definitions`)
 *
 * The package never knows whether rows came from a live DB view or a file.
 */

import { resolveEffectiveSpatialEnvironmentStates } from "@spellkave/sdk/environment-state";

/** Adapt the file/SDK plain-row contract at this boundary, then share precedence. */
function effectiveStateRows(input: readonly Record<string, unknown>[]): Record<string, unknown>[] {
	return resolveEffectiveSpatialEnvironmentStates(
		input.map((raw) => ({
			raw,
			bundleId: str(raw, "bundle_id"),
			stateId: str(raw, "state_id"),
			stateRowId: BigInt(String(raw.state_row_id ?? raw.stateRowId ?? 0)),
			updatedTick: BigInt(String(raw.updated_tick ?? raw.updatedTick ?? 0)),
			targetKind: str(raw, "target_kind"),
			targetRef: raw.targetRef ?? raw.target_ref,
			placeNodeId: str(raw, "place_node_id", str(raw, "node_id")),
			placeEdgeId: String(raw.place_edge_id ?? raw.edge_id ?? raw.placeEdgeId ?? raw.edge_key ?? 0),
			locationDefId: str(raw, "location_def_id"),
			cellRes10: BigInt(String(raw.cell_res10 ?? raw.cellRes10 ?? 0)),
			cellRes7: BigInt(String(raw.cell_res7 ?? raw.cellRes7 ?? 0)),
			cellRes4: BigInt(String(raw.cell_res4 ?? raw.cellRes4 ?? 0)),
			substrateId: str(raw, "substrate_id"),
		})),
	).map((row) => row.raw);
}

export interface GraphRow {
	place_graph_id: string;
	parent_graph_id: string;
	anchor_node_id: string;
	substrate_id: string;
	bearing: number;
	metres_per_unit: number;
	origin_cell_res10: unknown;
	origin_cell_res7: unknown;
	origin_cell_res4: unknown;
	display_name: string;
	description: string;
	bundle_id: string;
	blueprint_id: string;
	is_ephemeral_instance: boolean;
}

export interface NodeRow {
	node_id: string;
	place_graph_id: string;
	bundle_id: string;
	local_id: string;
	substrate_id: string;
	display_name: string;
	description: string;
	cell_res10: unknown;
	cell_res7: unknown;
	cell_res4: unknown;
	pos_present: boolean;
	pos_x: number;
	pos_y: number;
	pose_elevation_present: boolean;
	pose_elevation: number;
	extent_shape_id: string;
	extent_params_json: string;
	is_ephemeral: boolean;
}

export interface EdgeRow {
	edge_id?: string;
	edge_key: string;
	bundle_id: string;
	place_graph_id: string;
	from_node_id: string;
	to_node_id: string;
	pose_dt_elevation_present: boolean;
	pose_dt_elevation: number;
	substrate_crossing: boolean;
	cell_anchor_present: boolean;
	cell_anchor: unknown;
	cell_anchor_u: number;
	cell_anchor_v: number;
	from_anchor_side: string;
	from_anchor_offset: number;
	to_anchor_side: string;
	to_anchor_offset: number;
	description: string;
	inherit_movement_default: boolean;
}

export interface MapLayerRow {
	map_layer_id: string;
	place_graph_id: string;
	display_name: string;
	asset_module: string;
	asset_path: string;
	source_kind: string;
	posture: string;
	state: string;
	image_width_px: number;
	image_height_px: number;
	grid_size_px: number;
	grid_distance_m: number;
	local_width_cells: number;
	local_height_cells: number;
	image_origin_x: number;
	image_origin_y: number;
	rotation_deg: number;
	min_zoom: number;
	max_zoom: number;
	bundle_id: string;
}

export interface SubstrateDef {
	substrate_id: string;
	coordinate_kind_id: string;
}

export interface MetadataAttachmentRow {
	target_kind: string;
	target_ref: string;
	namespace: string;
	payload_json: string;
	audience?: string;
	bundle_id?: string;
}

/** Normalized typed bag consumed by projectWorld / exportWorld. */
export interface EdgeAffordanceRow {
	edge_key: string;
	affordance_template_id: string;
	mode_id: string;
	bindings_json?: string;
}

export interface EdgeStateRow {
	edge_id?: string;
	edge_key?: string;
	state_id: string;
	value: boolean | string | number | Record<string, unknown>;
}

export interface SpatialNicheAttachmentRow {
	place_node_id: string;
	niche_id: string;
	condition_bool?: boolean;
}

export interface NicheDefinitionRow {
	niche_id: string;
	display_name: string;
	description?: string;
}

export interface NodeStateRow {
	node_id: string;
	state_id: string;
	value: boolean | string | number | Record<string, unknown>;
}

export interface NormalizedRows {
	place_graphs: GraphRow[];
	place_nodes: NodeRow[];
	place_edges: EdgeRow[];
	map_layers: MapLayerRow[];
	substrate_definitions: SubstrateDef[];
	metadata_attachments: MetadataAttachmentRow[];
	place_edge_affordances: EdgeAffordanceRow[];
	edge_states: EdgeStateRow[];
	spatial_niche_attachments: SpatialNicheAttachmentRow[];
	niche_definitions: NicheDefinitionRow[];
	node_states: NodeStateRow[];
	default_extent_shape_id: string;
	default_extent_params_json: string;
}

/**
 * Loose input accepted at the package boundary.
 * Keys match view/TOML column names (snake_case).
 */
export interface WorldOsmInput {
	place_graphs?: readonly Record<string, unknown>[];
	place_nodes?: readonly Record<string, unknown>[];
	place_edges?: readonly Record<string, unknown>[];
	map_layers?: readonly Record<string, unknown>[];
	substrate_definitions?: readonly Record<string, unknown>[];
	metadata_attachments?: readonly Record<string, unknown>[];
	place_edge_affordances?: readonly Record<string, unknown>[];
	edge_states?: readonly Record<string, unknown>[];
	spatial_niche_attachments?: readonly Record<string, unknown>[];
	niche_definitions?: readonly Record<string, unknown>[];
	spatial_environment_states?: readonly Record<string, unknown>[];
	node_states?: readonly Record<string, unknown>[];
	/** Bundle-level default extent (optional). */
	default_extent_shape_id?: string;
	default_extent_params_json?: string;
	/** Alias used by some loaders / bundle header. */
	bundles?: readonly Record<string, unknown>[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(row: Record<string, unknown>, key: string, fallback = ""): string {
	const v = row[key];
	return typeof v === "string" ? v : fallback;
}

function num(row: Record<string, unknown>, key: string, fallback = 0): number {
	const v = row[key];
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(row: Record<string, unknown>, key: string, fallback = false): boolean {
	const v = row[key];
	return typeof v === "boolean" ? v : fallback;
}

function toGraph(row: Record<string, unknown>): GraphRow {
	return {
		place_graph_id: str(row, "place_graph_id"),
		parent_graph_id: str(row, "parent_graph_id"),
		anchor_node_id: str(row, "anchor_node_id"),
		substrate_id: str(row, "substrate_id"),
		bearing: num(row, "bearing"),
		metres_per_unit: num(row, "metres_per_unit", 1),
		origin_cell_res10: row.origin_cell_res10 ?? 0,
		origin_cell_res7: row.origin_cell_res7 ?? 0,
		origin_cell_res4: row.origin_cell_res4 ?? 0,
		display_name: str(row, "display_name"),
		description: str(row, "description"),
		bundle_id: str(row, "bundle_id"),
		blueprint_id: str(row, "blueprint_id"),
		is_ephemeral_instance: bool(row, "is_ephemeral_instance"),
	};
}

function toNode(row: Record<string, unknown>): NodeRow {
	return {
		node_id: str(row, "node_id"),
		place_graph_id: str(row, "place_graph_id"),
		bundle_id: str(row, "bundle_id"),
		local_id: str(row, "local_id"),
		substrate_id: str(row, "substrate_id"),
		display_name: str(row, "display_name"),
		description: str(row, "description"),
		cell_res10: row.cell_res10 ?? 0,
		cell_res7: row.cell_res7 ?? 0,
		cell_res4: row.cell_res4 ?? 0,
		pos_present: bool(row, "pos_present"),
		pos_x: num(row, "pos_x"),
		pos_y: num(row, "pos_y"),
		pose_elevation_present: bool(row, "pose_elevation_present"),
		pose_elevation: num(row, "pose_elevation"),
		extent_shape_id: str(row, "extent_shape_id"),
		extent_params_json: str(row, "extent_params_json"),
		is_ephemeral: bool(row, "is_ephemeral"),
	};
}

function toEdge(row: Record<string, unknown>, index: number): EdgeRow {
	const edgeKey = str(row, "edge_key");
	return {
		edge_id: str(row, "edge_id") || undefined,
		edge_key: edgeKey || `edge:anon:${index}`,
		bundle_id: str(row, "bundle_id"),
		place_graph_id: str(row, "place_graph_id"),
		from_node_id: str(row, "from_node_id"),
		to_node_id: str(row, "to_node_id"),
		pose_dt_elevation_present: bool(row, "pose_dt_elevation_present"),
		pose_dt_elevation: num(row, "pose_dt_elevation"),
		substrate_crossing: bool(row, "substrate_crossing"),
		cell_anchor_present: bool(row, "cell_anchor_present"),
		cell_anchor: row.cell_anchor ?? 0,
		cell_anchor_u: num(row, "cell_anchor_u"),
		cell_anchor_v: num(row, "cell_anchor_v"),
		from_anchor_side: str(row, "from_anchor_side"),
		from_anchor_offset: num(row, "from_anchor_offset"),
		to_anchor_side: str(row, "to_anchor_side"),
		to_anchor_offset: num(row, "to_anchor_offset"),
		description: str(row, "description"),
		inherit_movement_default: bool(row, "inherit_movement_default", true),
	};
}

function toMapLayer(row: Record<string, unknown>): MapLayerRow {
	return {
		map_layer_id: str(row, "map_layer_id"),
		place_graph_id: str(row, "place_graph_id"),
		display_name: str(row, "display_name"),
		asset_module: str(row, "asset_module"),
		asset_path: str(row, "asset_path"),
		source_kind: str(row, "source_kind"),
		posture: str(row, "posture"),
		state: str(row, "state"),
		image_width_px: num(row, "image_width_px"),
		image_height_px: num(row, "image_height_px"),
		grid_size_px: num(row, "grid_size_px", 1),
		grid_distance_m: num(row, "grid_distance_m", 1),
		local_width_cells: num(row, "local_width_cells"),
		local_height_cells: num(row, "local_height_cells"),
		image_origin_x: num(row, "image_origin_x"),
		image_origin_y: num(row, "image_origin_y"),
		rotation_deg: num(row, "rotation_deg"),
		min_zoom: num(row, "min_zoom"),
		max_zoom: num(row, "max_zoom"),
		bundle_id: str(row, "bundle_id"),
	};
}

function toSubstrate(row: Record<string, unknown>): SubstrateDef {
	return {
		substrate_id: str(row, "substrate_id"),
		coordinate_kind_id: str(row, "coordinate_kind_id"),
	};
}

function toMetadataAttachment(row: Record<string, unknown>): MetadataAttachmentRow {
	return {
		target_kind: str(row, "target_kind"),
		target_ref: str(row, "target_ref"),
		namespace: str(row, "namespace"),
		payload_json: str(row, "payload_json"),
		audience: str(row, "audience") || undefined,
		bundle_id: str(row, "bundle_id") || undefined,
	};
}

function toEdgeAffordance(row: Record<string, unknown>): EdgeAffordanceRow {
	return {
		edge_key: str(row, "edge_key") || str(row, "edgeKey"),
		affordance_template_id: str(row, "affordance_template_id") || str(row, "affordanceTemplateId"),
		mode_id: str(row, "mode_id") || str(row, "modeId"),
		bindings_json: str(row, "bindings_json") || str(row, "bindingsJson") || undefined,
	};
}

function toEdgeState(row: Record<string, unknown>): EdgeStateRow {
	const rawVal = row.value;
	let val: boolean | string | number | Record<string, unknown> = false;
	if (typeof rawVal === "boolean" || typeof rawVal === "string" || typeof rawVal === "number") {
		val = rawVal;
	} else if (isRecord(rawVal)) {
		if ("bool" in rawVal) val = Boolean(rawVal.bool);
		else if ("text" in rawVal) val = String(rawVal.text);
		else if ("int" in rawVal) val = Number(rawVal.int);
		else if ("tag" in rawVal && "value" in rawVal) {
			if (rawVal.tag === "bool") val = Boolean(rawVal.value);
			else if (rawVal.tag === "text") val = String(rawVal.value);
			else if (rawVal.tag === "int") val = Number(rawVal.value);
			else val = rawVal;
		} else {
			val = rawVal;
		}
	}
	const edgeId =
		row.edge_id !== undefined
			? String(row.edge_id)
			: row.place_edge_id !== undefined
				? String(row.place_edge_id)
				: row.placeEdgeId !== undefined
					? String(row.placeEdgeId)
					: undefined;
	return {
		edge_id: edgeId,
		edge_key: str(row, "edge_key") || str(row, "edgeKey") || undefined,
		state_id: str(row, "state_id") || str(row, "stateId"),
		value: val,
	};
}

function toSpatialNiche(row: Record<string, unknown>): SpatialNicheAttachmentRow {
	return {
		place_node_id: str(row, "place_node_id") || str(row, "placeNodeId") || str(row, "node_id"),
		niche_id: str(row, "niche_id") || str(row, "nicheId"),
		condition_bool: row.condition_bool !== undefined ? Boolean(row.condition_bool) : undefined,
	};
}

function toNicheDef(row: Record<string, unknown>): NicheDefinitionRow {
	return {
		niche_id: str(row, "niche_id") || str(row, "nicheId"),
		display_name: str(row, "display_name") || str(row, "displayName"),
		description: str(row, "description") || undefined,
	};
}

function toNodeState(row: Record<string, unknown>): NodeStateRow | null {
	const rawVal = row.value;
	let val: boolean | string | number | Record<string, unknown> = false;
	if (typeof rawVal === "boolean" || typeof rawVal === "string" || typeof rawVal === "number") {
		val = rawVal;
	} else if (isRecord(rawVal)) {
		if ("bool" in rawVal) val = Boolean(rawVal.bool);
		else if ("text" in rawVal) val = String(rawVal.text);
		else if ("int" in rawVal) val = Number(rawVal.int);
		else if ("tag" in rawVal && "value" in rawVal) {
			if (rawVal.tag === "bool") val = Boolean(rawVal.value);
			else if (rawVal.tag === "text") val = String(rawVal.value);
			else if (rawVal.tag === "int") val = Number(rawVal.value);
			else val = rawVal;
		} else {
			val = rawVal;
		}
	}
	const nodeId =
		str(row, "place_node_id") ||
		str(row, "placeNodeId") ||
		str(row, "node_id") ||
		str(row, "nodeId") ||
		(row.target_kind === "place_node" || row.targetKind === "place_node"
			? str(row, "target_ref") || str(row, "targetRef")
			: "");
	if (!nodeId) return null;
	return {
		node_id: nodeId,
		state_id: str(row, "state_id") || str(row, "stateId"),
		value: val,
	};
}

/** Coerce a loose row bag into typed rows. */
export function normalizeWorldOsmInput(input: WorldOsmInput): NormalizedRows {
	const graphs = (input.place_graphs ?? []).filter(isRecord).map(toGraph);
	const nodes = (input.place_nodes ?? []).filter(isRecord).map(toNode);
	const edges = (input.place_edges ?? []).filter(isRecord).map(toEdge);
	const mapLayers = (input.map_layers ?? []).filter(isRecord).map(toMapLayer);
	const substrates = (input.substrate_definitions ?? []).filter(isRecord).map(toSubstrate);
	const metadataAttachments = (input.metadata_attachments ?? [])
		.filter(isRecord)
		.map(toMetadataAttachment);
	const edgeAffordances = (input.place_edge_affordances ?? [])
		.filter(isRecord)
		.map(toEdgeAffordance);
	const edgeStates = effectiveStateRows((input.edge_states ?? []).filter(isRecord)).map(
		toEdgeState,
	);
	const niches = (input.spatial_niche_attachments ?? []).filter(isRecord).map(toSpatialNiche);
	const nicheDefs = (input.niche_definitions ?? []).filter(isRecord).map(toNicheDef);

	const rawNodeStates = effectiveStateRows(
		[...(input.node_states ?? []), ...(input.spatial_environment_states ?? [])].filter(isRecord),
	);
	const nodeStates = rawNodeStates
		.filter(isRecord)
		.map(toNodeState)
		.filter((s): s is NodeStateRow => s !== null);

	let defaultShape = input.default_extent_shape_id ?? "";
	let defaultParams = input.default_extent_params_json ?? "";
	if ((!defaultShape || !defaultParams) && input.bundles?.length) {
		const bundleRow = input.bundles.find(isRecord);
		if (bundleRow) {
			if (!defaultShape) defaultShape = str(bundleRow, "default_extent_shape_id");
			if (!defaultParams) defaultParams = str(bundleRow, "default_extent_params_json");
		}
	}

	return {
		place_graphs: graphs,
		place_nodes: nodes,
		place_edges: edges,
		map_layers: mapLayers,
		substrate_definitions: substrates,
		metadata_attachments: metadataAttachments,
		place_edge_affordances: edgeAffordances,
		edge_states: edgeStates,
		spatial_niche_attachments: niches,
		niche_definitions: nicheDefs,
		node_states: nodeStates,
		default_extent_shape_id: defaultShape,
		default_extent_params_json: defaultParams,
	};
}
