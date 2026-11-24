/** Browser-safe DTOs for `spellkave_get` / `spellkave_describe` (D-11). No runtime. */

export const AUTHORED_ENTITIES_ONLY = "authored_entities_only";

export type OwnerInstanceRowKind =
	| "entities"
	| "actors"
	| "actor_spatial_locations"
	| "actor_capabilities"
	| "actor_equipment_slots"
	| "entity_containment"
	| "entity_tag"
	| "object_state";

export type OwnerGetInput = {
	kind: string;
	key?: string;
	bundle?: string;
	pattern?: string;
	fields?: string[];
	limit?: number;
};

export type OwnerDescribeInput = {
	kind: string;
	key: string;
	bundle?: string;
	limit?: number;
};

export type OwnerGetAnswer =
	| {
			ok: true;
			source?: ScopedReadSource;
			kind: string;
			bundle?: string;
			tick: string;
			labels: readonly string[];
			row?: Record<string, unknown>;
			rows?: Record<string, unknown>[];
			match_count?: number;
			left_out?: number;
	  }
	| {
			ok: false;
			source?: ScopedReadSource;
			code:
				| "not_publisher"
				| "unknown_key"
				| "ambiguous_bundle"
				| "usage"
				| "reader_unavailable"
				| "not_found_in_scope";
			message: string;
	  };

export type OwnerDescribeAnswer =
	| {
			ok: true;
			source?: ScopedReadSource;
			kind: "entities";
			bundle?: string;
			tick: string;
			labels: readonly string[];
			row: Record<string, unknown>;
			slices: Partial<Record<OwnerInstanceRowKind, Record<string, unknown>[]>>;
			numeric_id: string;
			place?: string;
			container_chain: Array<{
				numeric_id: string;
				entity_key?: string;
				place?: string;
			}>;
			chain_end: { reason: "place" | "none" | "cycle" | "outside_read_scope"; numeric_id?: string };
			belonging: Array<{
				entity_key: string;
				numeric_id: string;
				name?: string;
				definition?: string;
				belongs_to_key?: string;
				belongs_to_numeric_id: string;
				relation: "containment" | "ownership" | "equipment";
			}>;
			match_count: number;
			left_out: number;
	  }
	| {
			ok: false;
			source?: ScopedReadSource;
			code:
				| "not_publisher"
				| "unknown_key"
				| "ambiguous_bundle"
				| "usage"
				| "reader_unavailable"
				| "not_found_in_scope";
			message: string;
	  };

export interface OwnerInstanceRead {
	get(input: OwnerGetInput): OwnerGetAnswer;
	describe(input: OwnerDescribeInput): OwnerDescribeAnswer;
}

export interface ScopedReadSource {
	reads_as_publisher: false;
	identity: string;
	world: string;
	connection_epoch: number;
	source_epoch: number;
	tick: string;
	projection_version: number;
	authorized_scopes: readonly string[];
	read_depths?: readonly { binding_id: string; depth: "hidden" | "internal" }[];
	authorized_bundles?: readonly string[];
	coverage: Readonly<Record<string, string>>;
	labels: readonly string[];
}
export interface ScopedInstanceRead {
	get(input: OwnerGetInput): Promise<OwnerGetAnswer>;
	describe(input: OwnerDescribeInput): Promise<OwnerDescribeAnswer>;
}
export type InstanceRead = OwnerInstanceRead | ScopedInstanceRead;
