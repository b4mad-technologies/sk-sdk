// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "Per-run bundles and independent presence/other/bare identities prove privileged frame landing and actual authored act state changes."}
/** Shared authored setup for the SDK journey and real NPC presence seam. */
import { stringify } from "smol-toml";
export const header = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
`;

export function fixture(b: string, dm: string, other: string): string {
	let source = `${header}[[bundles]]\nbundle_id="${b}"\ndisplay_name="Privileged act proof"\nauthor="spellkave-test"\nversion="1.0.0"\ndepends_on=["core"]\n`;
	for (const graph of ["forest", "village"]) {
		source += `[[place_graphs]]\nbundle_id="${b}"\nplace_graph_id="${b}/${graph}"\nsubstrate_id="outdoor"\ndisplay_name="${graph}"\nanchor_node_id="${b}/${graph}/root"\n`;
		for (const local of ["root", "clearing", "sealed"])
			source += `[[place_nodes]]\nbundle_id="${b}"\nnode_id="${b}/${graph}/${local}"\nlocal_id="${local}"\nplace_graph_id="${b}/${graph}"\nsubstrate_id="outdoor"\ndisplay_name="${local}"\npos_present=true\npos_x=${local === "root" ? 0 : 10}\npos_y=0\nextent_shape_id="core/area/cube"\nextent_params_json='{"extent_m":1}'\n`;
	}
	for (const graph of ["forest", "village"])
		for (const local of ["root", "clearing", "sealed"])
			source += `[[spatial_niche_attachments]]\nbundle_id="${b}"\nplace_node_id="${b}/${graph}/${local}"\nniche_id="core/mark_surface"\nvisibility="Public"\ncondition_bool=true\n`;
	for (const [name, graph] of [
		["wolf", "forest"],
		["foreign_wolf", "village"],
		["hero", "forest"],
		["seat", "forest"],
		["bare", "forest"],
		["lockbox", "forest"],
	]) {
		source += `[[entities]]\nbundle_id="${b}"\nentity_key="${b}/${name}"\nentity_def_id="core/creature/wolf"\nname="${name}"\nkind="npc"\nplace_node_id="${b}/${graph}/${name === "hero" ? "clearing" : "root"}"\n`;
		if (name === "hero" || name === "bare")
			source += `[[actors]]\nbundle_id="${b}"\nentity_key="${b}/${name}"\nname="${name}"\n`;
		if (name === "hero" || name === "bare")
			source += `[[actor_spatial_locations]]\nbundle_id="${b}"\nentity_key="${b}/${name}"\nplace_node_id="${b}/${graph}/${name === "hero" ? "clearing" : "root"}"\n`;
	}
	source += `[[actor_identities]]\nbundle_id="${b}"\nentity_key="${b}/hero"\nidentity="${other}"\nrole="primary"\nprovenance="person"\n`;
	for (const [name, tag] of [
		["seat", "srd.player_character"],
		["lockbox", "core/lockable"],
		["bare", `${b}/party`],
	])
		source += `[[entity_tag]]\nbundle_id="${b}"\nentity_key="${b}/${name}"\ntag="${tag}"\nsource="manifest"\n`;
	source += `[[role_bindings]]\nbundle_id="${b}"\nbinding_id="${b}/dm"\nrole_id="dm"\nsubject="${dm}"\nextent_kind_ref="place_graph"\nextent_ref="${b}/forest"\ndescription="Scoped act proof"\n`;
	for (const cap of ["frontier.despawn", "frontier.spawn_entity_definition"])
		source += `[[actor_capabilities]]\nbundle_id="${b}"\nactor_entity_key="${b}/bare"\ncapability_id="${cap}"\nsource="publisher-explicit"\n`;
	source += `[[actor_capabilities]]\nbundle_id="${b}"\nactor_entity_key="${b}/hero"\ncapability_id="core/inspect"\nsource="manifest"\n`;
	source += `[[actor_capabilities]]\nbundle_id="${b}"\nactor_entity_key="${b}/bare"\ncapability_id="frontier.apply_manifest"\nsource="publisher-explicit"\n`;
	return source;
}

/** Unique authored probes compose existing leaves; no test reducer bypass. */
export function probeAct(
	b: string,
	slug: string,
	capability: string,
	writes: Record<string, unknown>[],
	effect?: { primitive: string; parameters: Record<string, unknown> },
	stochastic = false,
): string {
	const id = `${b}/${slug}`;
	return (
		header +
		stringify({
			niche_definitions: [
				{
					bundle_id: b,
					niche_id: `${id}/niche`,
					display_name: slug,
					description: "Authored admission proof",
					provider: "actor",
					predicate_source: "",
				},
			],
			action_definitions: [
				{
					bundle_id: b,
					action_id: id,
					display_name: slug,
					required_capability: capability,
					resolution_mode: stochastic ? "Stochastic" : "Deterministic",
					resolution_predicate_source: stochastic ? "d20 >= 1" : "",
					on_success: `${id}/success`,
					...(stochastic ? { on_failure: `${id}/failure` } : {}),
					cost_time_ms: 0,
				},
			],
			affordance_templates: [
				{
					bundle_id: b,
					template_id: `${id}/affordance`,
					display_name: slug,
					capability_id: capability,
					niche_id: `${id}/niche`,
					outcome_template_id: `${id}/outcome`,
					predicate_source: `actor.has_capability('${capability}')`,
				},
			],
			outcome_templates: [
				{
					bundle_id: b,
					outcome_template_id: `${id}/outcome`,
					display_name: slug,
					manipulation_action_id: id,
					outcome_bool: true,
				},
			],
			consequence_templates: [
				{
					bundle_id: b,
					template_id: `${id}/success`,
					...(effect ? { effect_refs_csv: `${id}/effect` } : {}),
				},
				...(stochastic ? [{ bundle_id: b, template_id: `${id}/failure` }] : []),
			],
			consequence_frame_writes: writes.map((frame_write, ordinal) => ({
				template_id: `${id}/success`,
				ordinal,
				frame_write,
			})),
			...(effect
				? {
						effect_definitions: [
							{
								bundle_id: b,
								effect_def_id: `${id}/effect`,
								primitives_csv: effect.primitive,
								parameters_schema_json: JSON.stringify(effect.parameters),
							},
						],
					}
				: {}),
		})
	);
}
