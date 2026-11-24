// embedded-manifest: {"category": "production_manifest_constructor", "rationale": "The data-only scene renderer constructs ordinary graph/population manifests and validates their dependency closure."}
/** Data-only scene composition over the existing renderer and validator. */
import {
	parseSchemaManifestToml,
	renderSchemaManifest,
	validateManifestToml,
} from "@spellkave/world-author/tooling";

export interface ScenePackage {
	format: "spellkave-scene/v1";
	id: string;
	version: string;
	bundle_id: string;
	blueprint_id: string;
	dependencies: string[];
	figures: Array<{
		key: string;
		entity_def_id: string;
		node_local_id: string;
		name: string;
		kind: string;
		default_count: number;
		max_count: number;
	}>;
}
export interface SceneValues {
	anchor_id: string;
	bearing_deg?: number;
	counts?: Record<string, number>;
}
export interface ScenePlan {
	format: "spellkave-scene-plan/v1";
	package: ScenePackage;
	package_digest: string;
	setup_name: string;
	values: Required<SceneValues>;
	dependencies: Array<{ bundle_id: string; digest: string }>;
	generated: { graph_id: string; node_ids: string[]; entity_keys: string[] };
	phases: Array<{ name: "graph" | "population"; toml: string; validation_toml: string }>;
	/** Entity definitions alone never create actors or controller bindings. */
	controllable: false;
	plan_digest: string;
}
function fail(path: string, message: string): never {
	throw new Error(`${path}: ${message}`);
}
function exact(value: unknown, fields: string[], path: string): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "expected an object");
	for (const field of Object.keys(value))
		if (!fields.includes(field)) fail(`${path}.${field}`, "unsupported field");
	return value as Record<string, unknown>;
}
function text(value: unknown, path: string): asserts value is string {
	if (typeof value !== "string" || !value.trim() || value.length > 256)
		fail(path, "expected a nonempty string of at most 256 characters");
}
function count(value: unknown, path: string): asserts value is number {
	if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 128)
		fail(path, "expected an integer in [0, 128]");
}
export function canonicalSceneJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonicalSceneJson).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonicalSceneJson(v)}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
export async function sceneDigest(value: unknown): Promise<string> {
	return sceneTextDigest(canonicalSceneJson(value));
}
export async function sceneTextDigest(value: string): Promise<string> {
	const bytes = new TextEncoder().encode(value);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
export async function renderScene(input: {
	package: ScenePackage;
	values: SceneValues;
	setup_name: string;
	/** Resolved data payloads, never a filesystem path or executable template. */
	dependencies: string[];
}): Promise<ScenePlan> {
	exact(input, ["package", "values", "setup_name", "dependencies"], "input");
	const pkg = input.package;
	exact(
		pkg,
		["format", "id", "version", "bundle_id", "blueprint_id", "dependencies", "figures"],
		"package",
	);
	if (pkg.format !== "spellkave-scene/v1") fail("package.format", "unsupported scene format");
	for (const field of ["id", "version", "bundle_id", "blueprint_id"] as const)
		text(pkg[field], `package.${field}`);
	if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.setup_name))
		fail("setup_name", "use 1–64 lowercase letters, digits, dot, underscore or hyphen");
	if (
		!Array.isArray(pkg.dependencies) ||
		pkg.dependencies.some((id) => typeof id !== "string" || !id)
	)
		fail("package.dependencies", "expected bundle ids");
	if (new Set(pkg.dependencies).size !== pkg.dependencies.length)
		fail("package.dependencies", "duplicate bundle id");
	if (!Array.isArray(input.dependencies) || input.dependencies.length > 32)
		fail("dependencies", "expected at most 32 resolved TOML payloads");
	const manifests = input.dependencies.map((toml, i) => {
		if (typeof toml !== "string" || toml.length > 1024 * 1024)
			fail(`dependencies[${i}]`, "expected TOML payload, at most 1 MiB");
		return parseSchemaManifestToml(toml);
	});
	const rows = (kind: string): Record<string, unknown>[] =>
		manifests.flatMap((manifest) => (manifest[kind] ?? []) as Record<string, unknown>[]);
	const bundles = rows("bundles");
	for (const id of pkg.dependencies)
		if (!bundles.some((row) => row.bundle_id === id))
			fail("dependencies", `missing bundle '${id}'`);
	if (bundles.some((row) => row.bundle_id === pkg.bundle_id))
		fail("package.bundle_id", "setup owner must differ from dependency bundles");
	const graph = rows("place_graphs").find((row) => row.place_graph_id === pkg.blueprint_id);
	if (!graph || graph.blueprint_id)
		fail("package.blueprint_id", "expected a resolved blueprint graph");
	const nodes = rows("place_nodes").filter((row) => row.place_graph_id === pkg.blueprint_id);
	if (!nodes.length) fail("package.blueprint_id", "blueprint has no resolved nodes");
	exact(input.values, ["anchor_id", "bearing_deg", "counts"], "values");
	text(input.values.anchor_id, "values.anchor_id");
	const anchor = rows("place_nodes").find((row) => row.node_id === input.values.anchor_id);
	if (!anchor) fail("values.anchor_id", "unresolved anchor node");
	const bearing = input.values.bearing_deg ?? 0;
	if (!Number.isFinite(bearing) || bearing < 0 || bearing >= 360)
		fail("values.bearing_deg", "expected degrees in [0, 360)");
	if (!Array.isArray(pkg.figures) || pkg.figures.length > 32)
		fail("package.figures", "expected at most 32 figure groups");
	const supplied = exact(
		input.values.counts ?? {},
		pkg.figures.map((figure) => figure.key),
		"values.counts",
	);
	const counts: Record<string, number> = {};
	const keys = new Set<string>();
	const graphId = `${pkg.bundle_id}/${input.setup_name}`;
	if (rows("place_graphs").some((row) => row.place_graph_id === graphId))
		fail("setup_name", "generated graph collides with a dependency");
	const entities = pkg.figures.flatMap((figure, i) => {
		const path = `package.figures[${i}]`;
		exact(
			figure,
			["key", "entity_def_id", "node_local_id", "name", "kind", "default_count", "max_count"],
			path,
		);
		for (const field of ["key", "entity_def_id", "node_local_id", "name", "kind"] as const)
			text(figure[field], `${path}.${field}`);
		if (!/^[a-z0-9][a-z0-9_-]*$/.test(figure.key) || keys.has(figure.key))
			fail(`${path}.key`, "invalid or duplicate group key");
		keys.add(figure.key);
		count(figure.max_count, `${path}.max_count`);
		count(figure.default_count, `${path}.default_count`);
		if (figure.default_count > figure.max_count) fail(`${path}.default_count`, "exceeds max_count");
		const quantity = supplied[figure.key] ?? figure.default_count;
		count(quantity, `values.counts.${figure.key}`);
		if (quantity > figure.max_count) fail(`values.counts.${figure.key}`, "exceeds package maximum");
		counts[figure.key] = quantity;
		if (!rows("entity_definitions").some((row) => row.entity_def_id === figure.entity_def_id))
			fail(`${path}.entity_def_id`, "unresolved entity definition");
		const node = nodes.find((row) => row.local_id === figure.node_local_id);
		if (!node || node.node_id !== `${pkg.blueprint_id}/${figure.node_local_id}`)
			fail(`${path}.node_local_id`, "unresolved or non-prefix blueprint node");
		return Array.from({ length: quantity }, (_, index) => ({
			bundle_id: pkg.bundle_id,
			entity_key: `${graphId}/figure/${figure.key}/${index + 1}`,
			entity_def_id: figure.entity_def_id,
			name: `${figure.name} ${index + 1}`,
			kind: figure.kind,
			place_node_id: `${graphId}/${figure.node_local_id}`,
		}));
	});
	if (entities.length > 128) fail("values.counts", "scene exceeds 128 figures");
	if (
		entities.some((entity) => rows("entities").some((row) => row.entity_key === entity.entity_key))
	)
		fail("setup_name", "generated entity collides with a dependency");
	const header = {
		schema_version: "1.0.0",
		bundles: [
			{
				bundle_id: pkg.bundle_id,
				display_name: pkg.id,
				author: "scene",
				version: pkg.version,
				depends_on: pkg.dependencies,
			},
		],
	};
	const phases: ScenePlan["phases"] = [
		{
			name: "graph",
			validation_toml: "",
			toml: renderSchemaManifest({
				...header,
				place_graph_instances: [
					{
						bundle_id: pkg.bundle_id,
						blueprint_id: pkg.blueprint_id,
						instance_id: graphId,
						parent_graph_id: anchor.place_graph_id,
						anchor: { kind: "place_node", id: input.values.anchor_id },
						bearing_deg: bearing,
					},
				],
			}),
		},
		{
			name: "population",
			validation_toml: "",
			toml: renderSchemaManifest({ ...header, entities }),
		},
	];
	for (const phase of phases) {
		const merged: Record<string, unknown> = { schema_version: "1.0.0" };
		for (const manifest of [...manifests, parseSchemaManifestToml(phase.toml)]) {
			for (const [kind, value] of Object.entries(manifest))
				if (Array.isArray(value)) merged[kind] = [...((merged[kind] ?? []) as unknown[]), ...value];
		}
		// Population validates against the geometry the first phase will create.
		if (phase.name === "population") {
			merged.place_graphs = [
				...(merged.place_graphs as unknown[]),
				{
					...graph,
					place_graph_id: graphId,
					bundle_id: pkg.bundle_id,
					blueprint_id: pkg.blueprint_id,
					parent_graph_id: anchor.place_graph_id,
					anchor_node_id: `${graphId}/${String(graph.anchor_node_id).slice(pkg.blueprint_id.length + 1)}`,
				},
			];
			merged.place_nodes = [
				...(merged.place_nodes as unknown[]),
				...nodes.map((node) => ({
					...node,
					bundle_id: pkg.bundle_id,
					place_graph_id: graphId,
					node_id: String(node.node_id).replace(`${pkg.blueprint_id}/`, `${graphId}/`),
				})),
			];
		}
		phase.validation_toml = renderSchemaManifest(merged);
		const fatal = validateManifestToml(phase.validation_toml).filter(
			(diag) => diag.severity === "fatal",
		);
		if (fatal.length) fail(`phases.${phase.name}`, JSON.stringify(fatal));
	}
	const unsigned = {
		format: "spellkave-scene-plan/v1" as const,
		package: structuredClone(pkg),
		package_digest: await sceneDigest(pkg),
		setup_name: input.setup_name,
		values: { anchor_id: input.values.anchor_id, bearing_deg: bearing, counts },
		dependencies: await Promise.all(
			pkg.dependencies.map(async (id) => ({
				bundle_id: id,
				digest: await sceneDigest(
					input.dependencies.filter((_, i) =>
						((manifests[i]!.bundles ?? []) as Record<string, unknown>[]).some(
							(row) => row.bundle_id === id,
						),
					),
				),
			})),
		),
		generated: {
			graph_id: graphId,
			node_ids: nodes
				.map((node) => String(node.node_id).replace(`${pkg.blueprint_id}/`, `${graphId}/`))
				.sort(),
			entity_keys: entities.map((entity) => entity.entity_key),
		},
		phases,
		controllable: false as const,
	};
	return { ...unsigned, plan_digest: await sceneDigest(unsigned) };
}
