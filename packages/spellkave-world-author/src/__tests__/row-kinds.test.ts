import { describe, expect, it } from "vitest";
import { ROW_KIND_COMPOSITE_KEY, ROW_KIND_NATURAL_KEY, ROW_KIND_STORAGE_KEY } from "../row-kinds";

// #1968 R7 (ADR-0087) slice 2 parity proof: `ROW_KIND_NATURAL_KEY` moved
// from a hand-written TS literal to a wasm-served export of the Rust
// `spellkave-authoring` crate's `ROW_KIND_NATURAL_KEY` const. This is the
// FROZEN pre-port TS literal — the exact object `row-kinds.ts` exported
// before the port — captured here as the parity oracle so a future edit to
// either side (the Rust const or this frozen copy) that breaks byte-for-byte
// equality fails loudly, exhaustively (not by spot check). "Frozen" names its
// origin, not a ban on growth: a deliberate new entry on the Rust side (like
// the four manifest-natural-keys 1.1 additions below) is mirrored here in the
// same commit, so the oracle keeps proving parity rather than going stale.
const FROZEN_PRE_PORT_TS_LITERAL: Readonly<Record<string, string>> = {
	bundles: "bundle_id",
	// manifest-natural-keys 1.1: four single-column kinds that already had a
	// real server upsert but had never been registered here.
	map_layers: "map_layer_id",
	anchor_kind_definitions: "kind_id",
	boundary_definitions: "id",
	item_definitions: "item_def_id",
	coordinate_kind_definitions: "coordinate_kind_id",
	substrate_definitions: "substrate_id",
	area_shape_definitions: "shape_id",
	location_definitions: "location_def_id",
	spatial_state_definitions: "state_id",
	entity_definitions: "entity_def_id",
	containment_policy_definition: "policy_id",
	entity_definition_containment_policy: "entity_def_id",
	entity_containment_policy: "entity_key",
	entities: "entity_key",
	actors: "entity_key",
	// manifest-natural-keys 5.1: actor_identities moved to the composite
	// ROW_KIND_STORAGE_KEY table, widened to (entity_key, identity) to match
	// the server's real (actor_id, identity) key.
	object_state_definitions: "state_id",
	capability_definitions: "capability_id",
	role_definitions: "role_id",
	role_bindings: "binding_id",
	extent_kind_definitions: "kind_id",
	distance_metric_definitions: "metric_id",
	niche_definitions: "niche_id",
	outcome_templates: "outcome_template_id",
	outcome_graphs: "outcome_graph_id",
	outcome_graph_nodes: "outcome_graph_node_id",
	outcome_graph_edges: "outcome_graph_edge_id",
	economy_channel_definitions: "id",
	turn_scheduler: "id",
	session_definitions: "session_def_id",
	combat_grid_blueprints: "blueprint_id",
	effect_definitions: "effect_def_id",
	consequence_templates: "template_id",
	action_definitions: "action_id",
	resource_definitions: "resource_definition_id",
	autonomy_jobs: "job_id",
	trace_kind_definitions: "kind_id",
	dsl_macro_definitions: "macro_id",
	roll_tables: "roll_table_id",
	roll_table_entries: "roll_table_entry_id",
	modifier_templates: "modifier_template_id",
	condition_definitions: "condition_definition_id",
	place_graphs: "place_graph_id",
	place_seals: "place_graph_id",
	place_nodes: "node_id",
	place_edges: "edge_key",
	affordance_templates: "template_id",
	// ADR-0142 D-1.
	prompt_definitions: "prompt_def_id",
	audience_kind_definitions: "audience_kind_id",
	equipment_slot_definitions: "slot_id",
	modifier_target_definitions: "target_id",
	stacking_discipline_definitions: "discipline_id",
	condition_remove_policy_definitions: "policy_id",
	tag_value_definitions: "tag",
};

describe("ROW_KIND_NATURAL_KEY (wasm-served)", () => {
	it("is deep-equal to the frozen pre-port TS literal", () => {
		expect(ROW_KIND_NATURAL_KEY).toEqual(FROZEN_PRE_PORT_TS_LITERAL);
	});

	it("has exactly the same key set as the frozen literal (exhaustive, not spot-check)", () => {
		expect(Object.keys(ROW_KIND_NATURAL_KEY).sort()).toEqual(
			Object.keys(FROZEN_PRE_PORT_TS_LITERAL).sort(),
		);
	});

	it("every entry's natural-key field matches exactly", () => {
		for (const [kind, field] of Object.entries(FROZEN_PRE_PORT_TS_LITERAL)) {
			expect(ROW_KIND_NATURAL_KEY[kind]).toBe(field);
		}
	});

	it("is frozen (Object.isFrozen), matching the old literal's Readonly contract", () => {
		expect(Object.isFrozen(ROW_KIND_NATURAL_KEY)).toBe(true);
	});
});

// Finding #9 (srd-cc battle-test ledger, 2026-07-26): the `*_tag` satellite
// kinds' composite natural key, wasm-served from the SAME Rust source of
// truth as `ROW_KIND_NATURAL_KEY` above.
const EXPECTED_COMPOSITE_KEY: Readonly<Record<string, readonly string[]>> = {
	entity_definition_tag: ["entity_def_id", "tag"],
	object_state_definition_tag: ["state_id", "tag"],
	capability_definition_tag: ["capability_id", "tag"],
	niche_definition_tag: ["niche_id", "tag"],
	outcome_template_tag: ["outcome_template_id", "tag"],
	action_definition_tag: ["action_id", "tag"],
	resource_definition_tag: ["resource_definition_id", "tag"],
	roll_table_tag: ["roll_table_id", "tag"],
	roll_table_entry_tag: ["roll_table_entry_id", "tag"],
	modifier_template_tag: ["modifier_template_id", "tag"],
	condition_definition_tag: ["condition_definition_id", "tag"],
	entity_tag: ["entity_key", "tag"],
	condition_capability_extent_grants: [
		"condition_definition_id",
		"capability_id",
		"extent_kind_ref",
		"extent_ref",
	],
	// sk-bwd: the IDENTITY -> capability
	// bridge, where the tag is the PARENT rather than the discriminant.
	tag_capability_grant: ["tag", "capability_id"],
};

describe("ROW_KIND_COMPOSITE_KEY (wasm-served)", () => {
	it("has exactly the same key set as expected (exhaustive, not spot-check)", () => {
		expect(Object.keys(ROW_KIND_COMPOSITE_KEY).sort()).toEqual(
			Object.keys(EXPECTED_COMPOSITE_KEY).sort(),
		);
	});

	it("every entry's composite-key fields match exactly", () => {
		for (const [kind, fields] of Object.entries(EXPECTED_COMPOSITE_KEY)) {
			expect(ROW_KIND_COMPOSITE_KEY[kind]).toEqual(fields);
		}
	});

	it("shares no kind with ROW_KIND_NATURAL_KEY", () => {
		for (const kind of Object.keys(ROW_KIND_COMPOSITE_KEY)) {
			expect(ROW_KIND_NATURAL_KEY[kind]).toBeUndefined();
		}
	});

	it("is frozen (Object.isFrozen), matching ROW_KIND_NATURAL_KEY's Readonly contract", () => {
		expect(Object.isFrozen(ROW_KIND_COMPOSITE_KEY)).toBe(true);
	});
});

// ADR-0146 (manifest-natural-keys), sk-jay0.7.174.30: the wider storage-key
// table, wasm-served from the same Rust source of truth. Never existed as a
// hand-written TS literal before this export, so there is no "frozen
// pre-port" oracle to compare against — these are structural checks against
// the known Rust table (`crates/spellkave-schema/src/row_identity.rs`).
const EXPECTED_STORAGE_KEY: Readonly<Record<string, readonly string[]>> = {
	role_aggregations: ["role_id", "bundle_id"],
	actor_capabilities: ["actor_entity_key", "capability_id", "source", "source_args_hash"],
	object_state: ["entity_key", "state_id"],
	entity_containment: ["container_entity_key", "entity_key"],
	actor_equipment_slots: ["actor_entity_key", "slot_id"],
	actor_spatial_locations: ["entity_key"],
	actor_identities: ["entity_key", "identity"],
	metadata_attachments: ["target_kind", "target_ref", "namespace", "bundle_id"],
	entity_definition_initial_state: ["entity_def_id", "state_id"],
	entity_definition_initial_capability: ["entity_def_id", "capability_id"],
	entity_definition_initial_condition: ["entity_def_id", "condition_definition_id"],
	entity_definition_initial_containment: ["entity_def_id", "contained_entity_def_id"],
	entity_definition_initial_equipment: ["entity_def_id", "slot_id"],
	entity_definition_item_dsl_source: ["entity_def_id", "slot"],
	entity_definition_equip_modifier: ["entity_def_id", "modifier_template_id"],
	metadata_namespaces: ["namespace", "bundle_id"],
	place_edge_affordance: ["edge_key", "affordance_template_id", "mode_id"],
	place_node_traces: ["node_id", "trace_kind_id"],
	location_traces: ["location_def_id", "trace_kind_id"],
	movement_defaults: ["bundle_id", "place_graph_id", "mode_id", "affordance_template_id"],
	spatial_niche_attachments: ["bundle_id", "place_node_id", "place_edge_id", "niche_id"],
	spatial_environment_state: [
		"bundle_id",
		"place_node_id",
		"place_edge_id",
		"place_edge_key",
		"location_def_id",
		"state_id",
	],
	entity_resource_bound: ["entity_key", "resource_definition_id"],
	affordance_template_participants: ["template_id", "role_id"],
	target_conditions: ["target_kind", "target_id", "condition_definition_id"],
	condition_capability_extent_grants: [
		"condition_definition_id",
		"capability_id",
		"extent_kind_ref",
		"extent_ref",
	],
	tag_capability_grant: ["tag", "capability_id"],
	entity_definition_tag: ["entity_def_id", "tag", "bundle_id", "source"],
	object_state_definition_tag: ["state_id", "tag", "bundle_id", "source"],
	capability_definition_tag: ["capability_id", "tag", "bundle_id", "source"],
	niche_definition_tag: ["niche_id", "tag", "bundle_id", "source"],
	outcome_template_tag: ["outcome_template_id", "tag", "bundle_id", "source"],
	action_definition_tag: ["action_id", "tag", "bundle_id", "source"],
	resource_definition_tag: ["resource_definition_id", "tag", "bundle_id", "source"],
	roll_table_tag: ["roll_table_id", "tag", "bundle_id", "source"],
	roll_table_entry_tag: ["roll_table_entry_id", "tag", "bundle_id", "source"],
	modifier_template_tag: ["modifier_template_id", "tag", "bundle_id", "source"],
	condition_definition_tag: ["condition_definition_id", "tag", "bundle_id", "source"],
	entity_tag: ["entity_key", "tag", "bundle_id", "source"],
};

describe("ROW_KIND_STORAGE_KEY (wasm-served)", () => {
	it("has exactly the same key set as expected (exhaustive, not spot-check)", () => {
		expect(Object.keys(ROW_KIND_STORAGE_KEY).sort()).toEqual(
			Object.keys(EXPECTED_STORAGE_KEY).sort(),
		);
	});

	it("every entry's storage-key fields match exactly", () => {
		for (const [kind, fields] of Object.entries(EXPECTED_STORAGE_KEY)) {
			expect(ROW_KIND_STORAGE_KEY[kind]).toEqual(fields);
		}
	});

	it("shares no kind with ROW_KIND_NATURAL_KEY", () => {
		for (const kind of Object.keys(ROW_KIND_STORAGE_KEY)) {
			expect(ROW_KIND_NATURAL_KEY[kind]).toBeUndefined();
		}
	});

	it("is frozen (Object.isFrozen), matching ROW_KIND_NATURAL_KEY's Readonly contract", () => {
		expect(Object.isFrozen(ROW_KIND_STORAGE_KEY)).toBe(true);
	});
});
