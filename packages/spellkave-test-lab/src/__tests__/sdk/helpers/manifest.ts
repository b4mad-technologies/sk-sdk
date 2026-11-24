// embedded-manifest: {"category": "exact_renderer_oracle", "rationale": "Parameterized bundle, node, and edge rendering is the assertion subject in SDK graph tests."}
// ci-allow(embedded-manifest-schema): line-array parameterized graph renderer - assembles fragments, never a whole valid document
/**
 * Builds a minimal world-manifest TOML for SDK integration tests.
 * Keeps tests self-contained; no fixture files required for synthetic graphs.
 */

export interface SimpleGraphOpts {
	bundleId: string;
	nodes: Array<{ id: string; name?: string }>;
	edges: Array<{ key: string; from: string; to: string }>;
}

export function simpleGraph(opts: SimpleGraphOpts): string {
	const { bundleId, nodes, edges } = opts;

	const lines: string[] = [
		`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json`,
		`schema_version = "1.0.0"`,
		``,
		`[metadata]`,
		`profile = "${bundleId}"`,
		``,
		`[[bundles]]`,
		`bundle_id = "${bundleId}"`,
		`display_name = "SDK e2e test"`,
		`author = "sdk-test"`,
		`version = "1.0.0"`,
		`depends_on = ["core"]`,
		`description = "Ephemeral fixture for SDK live node test."`,
		``,
		`[[place_graphs]]`,
		`place_graph_id = "${bundleId}"`,
		`bundle_id = "${bundleId}"`,
		`substrate_id = "indoor"`,
		`display_name = "SDK e2e graph"`,
	];

	for (const node of nodes) {
		// biome-ignore lint/style/noNonNullAssertion: pre-existing debt from #1368 biome onboarding, tracked in #1455
		const localId = node.id.includes("/") ? node.id.split("/").pop()! : node.id;
		lines.push(
			``,
			`[[place_nodes]]`,
			`node_id = "${node.id}"`,
			`bundle_id = "${bundleId}"`,
			`place_graph_id = "${bundleId}"`,
			`local_id = "${localId}"`,
			`substrate_id = "indoor"`,
			`display_name = "${node.name ?? node.id}"`,
		);
	}

	for (const edge of edges) {
		lines.push(
			``,
			`[[place_edges]]`,
			`edge_key = "${edge.key}"`,
			`bundle_id = "${bundleId}"`,
			`place_graph_id = "${bundleId}"`,
			`from_node_id = "${edge.from}"`,
			`to_node_id = "${edge.to}"`,
			``,
			`[[place_edge_affordance]]`,
			`edge_key = "${edge.key}"`,
			`affordance_template_id = "core/affordance/traverse_open_portal"`,
		);
	}

	return lines.join("\n");
}
