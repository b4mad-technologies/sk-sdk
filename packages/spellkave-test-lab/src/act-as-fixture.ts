/** Synthetic AUTH-41 definitions shared by substrate and real tool consumers. */
import { header } from "./environment-ownership-fixture";
export function actAsFixture(
	b: string,
	identities: { person: string; dm: string; peer: string; host: string },
): string {
	let source = `${header(b)}
[[place_graphs]]
bundle_id="${b}"
place_graph_id="${b}/graph"
substrate_id="outdoor"
display_name="Control proof"
anchor_node_id="${b}/graph/root"
[[place_nodes]]
bundle_id="${b}"
node_id="${b}/graph/root"
local_id="root"
place_graph_id="${b}/graph"
substrate_id="outdoor"
display_name="Control proof root"
`;
	for (const name of ["person", "npc"])
		source += `
[[entities]]
bundle_id="${b}"
entity_key="${b}/${name}"
entity_def_id="core/creature/wolf"
name="${name}"
kind="npc"
place_node_id="${b}/graph/root"
[[actors]]
bundle_id="${b}"
entity_key="${b}/${name}"
name="${name}"
[[actor_spatial_locations]]
bundle_id="${b}"
entity_key="${b}/${name}"
place_node_id="${b}/graph/root"
`;
	source += `[[actor_identities]]
bundle_id="${b}"
entity_key="${b}/person"
identity="${identities.person}"
role="primary"
provenance="person"
`;
	for (const [name, principal, role] of [
		["dm", identities.dm, "dm"],
		["peer", identities.peer, "dm"],
		["host", identities.host, "npc-host"],
	] as const)
		source += `[[role_bindings]]
bundle_id="${b}"
binding_id="${b}/${name}"
subject="${principal}"
role_id="${role}"
extent_kind_ref="place_graph"
extent_ref="${b}/graph"
description="Control proof ${name}"
`;
	source += `[[actor_capabilities]]
bundle_id="${b}"
actor_entity_key="${b}/npc"
capability_id="core/inspect"
source="publisher-explicit"
[[autonomy_jobs]]
bundle_id="${b}"
job_id="${b}/independent"
frequency_ms=0
next_fire_at_ms=999999999999
dsl_function="weather.advance_phase"
source="manifest"
[[session_definitions]]
bundle_id="${b}"
session_def_id="${b}/session"
turn_rule="Concurrent"
legal_moves_csv="mt_advance_compound_intent"
`;

	return source;
}
