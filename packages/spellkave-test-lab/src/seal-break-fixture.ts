/** Authored .48 fixtures; every transition uses the production manipulate path. */
import { parse, stringify } from "smol-toml";
import { fixture, header, probeAct } from "./privileged-acts-fixture";
export { header };

export function sealBreakFixture(b: string, identity: string, observer: string): string {
	let source = fixture(b, identity, observer).replace('role_id="dm"', 'role_id="warden"');
	source += stringify({
		resource_definitions: [
			{
				bundle_id: b,
				resource_definition_id: `${b}/hp`,
				display_name: "Preparation failure probe",
				min_value: 0,
				max_value: 10,
				initial_value: 1,
				value_kind: "int",
				recovery_rule: "persistent",
			},
		],
	});
	for (const [name, parent] of [
		["closed", "forest"],
		["failed", "forest"],
		["sibling", "forest"],
		["late", "forest"],
		["outer", "forest"],
		["inner", "outer"],
	] as const) {
		source += stringify({
			place_graphs: [
				{
					bundle_id: b,
					place_graph_id: `${b}/${name}`,
					parent_graph_id: `${b}/${parent}`,
					substrate_id: "outdoor",
					display_name: name,
					anchor_node_id: `${b}/${name}/root`,
				},
			],
			place_nodes: [
				{
					bundle_id: b,
					node_id: `${b}/${name}/root`,
					local_id: "root",
					place_graph_id: `${b}/${name}`,
					substrate_id: "outdoor",
					display_name: name,
					extent_shape_id: "core/area/cube",
					extent_params_json: '{"extent_m":1}',
				},
			],
			spatial_niche_attachments: [
				{
					bundle_id: b,
					place_node_id: `${b}/${name}/root`,
					niche_id: "core/mark_surface",
					visibility: "Public",
					condition_bool: true,
				},
			],
			place_seals: [
				{ bundle_id: b, place_graph_id: `${b}/${name}`, description: "Prepared boundary" },
			],
		});
	}
	return source;
}

export function sealBreakProbe(
	b: string,
	slug: string,
	writes: unknown[],
	capability = "frontier.break_seal",
	stochastic = false,
	effect?: { primitive: string; parameters: Record<string, unknown> },
): string {
	const authored = parse(probeAct(b, slug, capability, [], effect, stochastic));
	delete authored.niche_definitions;
	(authored.affordance_templates as { niche_id: string }[])[0]!.niche_id = "core/mark_surface";
	authored.consequence_frame_writes = writes.map((frame_write, ordinal) => ({
		template_id: `${b}/${slug}/success`,
		ordinal,
		frame_write,
	})) as never;
	delete authored.schema_version;
	return header + stringify(authored);
}

export const mark = (node: string) => ({
	Inscribe: {
		kind: "scrape_marks",
		location_kind: "place_node",
		location_ref: node,
		payload_json: '{"probe":"sibling"}',
	},
});
