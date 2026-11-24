/** Fixed authored definitions for the real setup journey. */
import { stringify } from "smol-toml";
import { fixture } from "./privileged-acts-fixture";
export function authoredSessionFixture(b: string, dm: string, player: string): string {
	return (
		fixture(b, dm, player) +
		stringify({
			entities: [
				{
					bundle_id: b,
					entity_key: `${b}/foe`,
					entity_def_id: "core/creature/wolf",
					kind: "npc",
					name: "foe",
					place_node_id: `${b}/forest/clearing`,
				},
			],
			entity_tag: [
				{
					bundle_id: b,
					entity_key: `${b}/hero`,
					tag: "srd.player_character",
					source: "manifest",
				},
			],
			actor_identities: [
				{
					bundle_id: b,
					entity_key: `${b}/foe`,
					identity: player,
					role: "primary",
					provenance: "person",
				},
			],
			actor_capabilities: [
				{
					bundle_id: b,
					actor_entity_key: `${b}/foe`,
					capability_id: "core/inspect",
					source: "manifest",
				},
			],
			actors: [{ bundle_id: b, entity_key: `${b}/foe`, name: "foe" }],
			actor_spatial_locations: [
				{ bundle_id: b, entity_key: `${b}/foe`, place_node_id: `${b}/forest/clearing` },
			],
			combat_grid_blueprints: [
				{
					bundle_id: b,
					blueprint_id: `${b}/grid`,
					width: 2,
					height: 2,
					topology: "4",
					cell_size_m: 1,
					edge_affordance_template_id: "core/affordance/traverse_open_portal",
				},
				{
					bundle_id: b,
					blueprint_id: `${b}/tiny`,
					width: 1,
					height: 1,
					topology: "4",
					cell_size_m: 1,
					edge_affordance_template_id: "core/affordance/traverse_open_portal",
				},
			],
			turn_scheduler: [
				{
					bundle_id: b,
					id: `${b}/scheduler`,
					scheduler_kind: "rolled_order",
					order_roll_source: "1",
					active: false,
				},
			],
			session_definitions: [
				{
					bundle_id: b,
					session_def_id: `${b}/broken-session`,
					turn_rule: "Sequential",
					combat_grid_blueprint_id: `${b}/grid`,
				},
				{
					bundle_id: b,
					session_def_id: `${b}/session`,
					turn_scheduler_id: `${b}/scheduler`,
					turn_rule: "Sequential",
					visibility_policy: "Public",
					combat_grid_blueprint_id: `${b}/grid`,
				},
				{
					bundle_id: b,
					session_def_id: `${b}/tiny-session`,
					turn_scheduler_id: `${b}/scheduler`,
					turn_rule: "Sequential",
					visibility_policy: "Public",
					combat_grid_blueprint_id: `${b}/tiny`,
				},
				{
					bundle_id: b,
					session_def_id: `${b}/callback-session`,
					turn_rule: "Sequential",
					on_terminate: `${b}/callback`,
				},
			],
			consequence_templates: [{ bundle_id: b, template_id: `${b}/callback` }],
			consequence_frame_writes: [
				{
					template_id: `${b}/callback`,
					ordinal: 0,
					frame_write: {
						Inscribe: {
							kind: "scrape_marks",
							location_kind: "place_node",
							location_ref: `${b}/village/clearing`,
							payload_json: '{"escape":true}',
						},
					},
				},
			],
		})
	);
}
