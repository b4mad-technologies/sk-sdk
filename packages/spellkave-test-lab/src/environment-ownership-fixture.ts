// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "Per-run bundle IDs, edge keys, versions and job sources isolate whole-bundle and delta ownership survival on fresh and reused worlds."}
/** Per-run manifests and publisher SQL for ENV-93 ownership proofs. */
import type { TestWorld } from "./live";

export function header(bundle: string, version = 1, dependency = "core"): string {
	const dependencies = "depends_on = " + JSON.stringify(dependency ? [dependency] : []);
	return `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[[bundles]]
bundle_id = "${bundle}"
display_name = "Environment ownership proof"
author = "spellkave-test"
version = "${version}.0.0"
${dependencies}
`;
}

export function baseline(bundle: string): string {
	return `[[spatial_environment_state]]
bundle_id = "${bundle}"
place_edge_key = "${bundle}/edge"
state_id = "${bundle}/open"
value_bool = false
visibility = "Public"
`;
}

export function content(bundle: string, version = 1): string {
	const b = bundle;
	let source = `${header(b, version)}
[[place_graphs]]
bundle_id = "${b}"
place_graph_id = "${b}/graph"
substrate_id = "outdoor"
display_name = "Environment graph"
anchor_node_id = "${b}/graph/root"
[[place_edges]]
bundle_id = "${b}"
edge_key = "${b}/edge"
place_graph_id = "${b}/graph"
from_node_id = "${b}/graph/root"
to_node_id = "${b}/graph/end"
[[spatial_state_definitions]]
bundle_id = "${b}"
state_id = "${b}/open"
value_type = "Bool"
writer_policy = "world_interaction"
freshness_rule = "expires_after_ticks:1"
merge_rule = "replace"
lod_policy = "retain_latest"
description = "Open seal"
${baseline(b)}
[[niche_definitions]]
bundle_id = "${b}"
niche_id = "${b}/niche"
display_name = "Environment niche"
description = "Ownership proof actions"
[[spatial_niche_attachments]]
bundle_id = "${b}"
niche_id = "${b}/niche"
place_node_id = "${b}/graph/root"
[[affordance_templates]]
bundle_id = "${b}"
template_id = "${b}/step"
display_name = "Generic movement candidate"
niche_id = "${b}/niche"
capability_id = ""
predicate_bool = true
outcome_template_id = "${b}/move"
[[affordance_templates]]
bundle_id = "${b}"
template_id = "${b}/walk"
display_name = "Traverse open seal"
niche_id = "${b}/niche"
capability_id = ""
predicate_source = "target.state('${b}/open') == true"
outcome_template_id = "${b}/move"
[[outcome_templates]]
bundle_id = "${b}"
outcome_template_id = "${b}/move"
display_name = "Environment movement"
movement_descriptor = "move"
outcome_bool = true
[[place_edge_affordance]]
edge_key = "${b}/edge"
affordance_template_id = "${b}/walk"
[[autonomy_jobs]]
bundle_id = "${b}"
job_id = "${b}/authored"
frequency_ms = 0
next_fire_at_ms = 999999999999
dsl_function = "weather.advance_phase"
source = "manifest"
`;
	for (const node of ["root", "end"])
		source += `
[[place_nodes]]
bundle_id = "${b}"
node_id = "${b}/graph/${node}"
place_graph_id = "${b}/graph"
local_id = "${node}"
substrate_id = "outdoor"
display_name = "Environment ${node}"
extent_shape_id = "core/area/cube"
extent_params_json = '{"extent_m":1.0}'
`;
	for (const action of ["open", "schedule", "cancel", "cancel-manifest"]) {
		source += `
[[capability_definitions]]
bundle_id = "${b}"
capability_id = "${b}/${action}"
display_name = "${action}"
actor_kind = "entity"
description = "Ownership proof act"
[[affordance_templates]]
bundle_id = "${b}"
template_id = "${b}/${action}"
display_name = "${action}"
niche_id = "${b}/niche"
capability_id = "${b}/${action}"
predicate_bool = true
outcome_template_id = "${b}/${action}"
[[outcome_templates]]
bundle_id = "${b}"
outcome_template_id = "${b}/${action}"
display_name = "${action}"
manipulation_action_id = "${b}/${action}"
outcome_bool = true
[[action_definitions]]
bundle_id = "${b}"
action_id = "${b}/${action}"
display_name = "${action}"
required_capability = "${b}/${action}"
on_success = "${b}/${action}"
self_eligible = true
[[consequence_templates]]
bundle_id = "${b}"
template_id = "${b}/${action}"
`;
		if (action === "open")
			source += `
[[consequence_frame_writes]]
template_id = "${b}/${action}"
ordinal = 0
[consequence_frame_writes.frame_write.Inscribe]
kind = "spatial_environment_state"
location_kind = "binding"
location_ref = "ActorIncidentEdges"
payload_json = '{"state_id":"${b}/open","value":true,"visibility":"Public"}'
`;
		else {
			source += `effect_refs_csv = "${b}/${action}"
[[effect_definitions]]
bundle_id = "${b}"
effect_def_id = "${b}/${action}"
primitives_csv = "${action === "schedule" ? "ScheduleAutonomyJob" : "CancelAutonomyJob"}"
parameters_schema_json = '${JSON.stringify(action === "schedule" ? { dsl_function: "weather.advance_phase", fires_at_ms: 999999999999, payload_json: "", source: `${b}/source` } : { source: action === "cancel-manifest" ? "manifest" : `${b}/source` })}'
`;
		}
	}
	return source;
}

export function player(bundle: string): string {
	const owner = `${bundle}_player`;
	let source = `${header(owner, 1, bundle)}
[[entities]]
bundle_id = "${owner}"
entity_key = "${owner}/player"
name = "Environment player"
kind = "player"
place_node_id = "${bundle}/graph/root"
[[actors]]
bundle_id = "${owner}"
entity_key = "${owner}/player"
name = "Environment player"
`;
	for (const action of ["open", "schedule", "cancel", "cancel-manifest"])
		source += `
[[actor_capabilities]]
bundle_id = "${owner}"
actor_entity_key = "${owner}/player"
capability_id = "${bundle}/${action}"
source = "authored"
`;
	return source;
}

/** Publisher SQL observes committed private rows independently of subscriptions. */
export async function rows(world: TestWorld, query: string): Promise<Record<string, unknown>[]> {
	const response = await fetch(
		`${process.env.SPELLKAVE_URL}/v1/database/${process.env.SPELLKAVE_DB ?? "spellkave-dev"}/sql`,
		{
			method: "POST",
			headers: { "Content-Type": "text/plain", Authorization: `Bearer ${world.token}` },
			body: query,
		},
	);
	if (!response.ok) throw new Error(`SQL ${response.status}: ${await response.text()}`);
	const statements = (await response.json()) as {
		schema: { elements: { name: { some?: string } }[] };
		rows: unknown[][];
	}[];
	return statements.flatMap((statement) =>
		statement.rows.map((row) =>
			Object.fromEntries(
				statement.schema.elements.map((column, index) => [
					column.name.some ?? `column${index}`,
					row[index],
				]),
			),
		),
	);
}
