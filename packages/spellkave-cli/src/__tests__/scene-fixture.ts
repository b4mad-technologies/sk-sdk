/** Versioned synthetic empty-source package shared by live scene proofs. */
import type { ScenePackage } from "@spellkave/tool-authoring";
import { renderSchemaManifest } from "@spellkave/world-author/tooling";
export function sceneFixture(catalog: string, trials: string) {
	const source = renderSchemaManifest({
		schema_version: "1.0.0",
		bundles: [
			{
				bundle_id: catalog,
				display_name: "Scene catalog",
				author: "synthetic",
				version: "1.0.0",
				depends_on: ["core", "test_lab_live_on_demand_gatekeeper"],
			},
		],
		place_graphs: [
			{
				bundle_id: catalog,
				place_graph_id: `${catalog}/room`,
				substrate_id: "test_lab_live_on_demand_gatekeeper/plane",
				display_name: "Empty room",
				anchor_node_id: `${catalog}/room/entry`,
			},
		],
		place_nodes: [
			{
				bundle_id: catalog,
				node_id: `${catalog}/room/entry`,
				place_graph_id: `${catalog}/room`,
				local_id: "entry",
				substrate_id: "test_lab_live_on_demand_gatekeeper/plane",
				display_name: "Entry",
			},
		],
		entity_definition_tag: [
			{
				bundle_id: catalog,
				entity_def_id: `${catalog}/target`,
				tag: "core.creature",
				source: "manifest",
			},
		],
		entity_definitions: [
			{ bundle_id: catalog, entity_def_id: `${catalog}/target`, display_name: "Target" },
		],
	});
	const pkg: ScenePackage = {
		format: "spellkave-scene/v1",
		id: "target-room",
		version: "1.0.0",
		bundle_id: trials,
		blueprint_id: `${catalog}/room`,
		dependencies: [catalog, "core", "test_lab_live_on_demand_gatekeeper"],
		figures: [
			{
				key: "targets",
				entity_def_id: `${catalog}/target`,
				node_local_id: "entry",
				kind: "npc",
				name: "Target",
				default_count: 1,
				max_count: 4,
			},
		],
	};
	return { source, pkg };
}
