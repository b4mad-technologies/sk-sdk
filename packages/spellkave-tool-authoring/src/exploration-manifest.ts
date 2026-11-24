/** Explicit file projection; never apply this serializer to a live raw cache. */
import type {
	ExplorationCollection,
	ExplorationScalar,
	ExplorationSource,
} from "@spellkave/tool-contracts";
import { ROW_KIND_NATURAL_KEY, ROW_KIND_STORAGE_KEY } from "@spellkave/world-author/tooling";
import {
	type ExplorationIdentity,
	type ExplorationRelation,
	type ExplorationRow,
	type ExplorationSnapshot,
	explorationDigest,
	explorationIdentityKey,
} from "./exploration";
export const EXPLORATION_EXAMINED_ROW_LIMIT = 50000;
const common = ["display_name", "description"];
const declarations: Record<
	string,
	{ collection: ExplorationCollection; fields: readonly string[] }
> = {
	place_graphs: {
		collection: "places",
		fields: [
			...common,
			"place_graph_id",
			"parent_graph_id",
			"anchor_node_id",
			"blueprint_id",
			"substrate_id",
		],
	},
	place_nodes: {
		collection: "places",
		fields: [...common, "node_id", "place_graph_id", "substrate_id", "pos_x", "pos_y"],
	},
	entity_definitions: {
		collection: "definitions",
		fields: [...common, "entity_def_id", "item_dsl_source"],
	},
	capability_definitions: {
		collection: "definitions",
		fields: [...common, "capability_id", "actor_kind", "default_visibility"],
	},
	action_definitions: {
		collection: "definitions",
		fields: [
			...common,
			"action_id",
			"required_capability",
			"on_success",
			"on_failure",
			"resolution_predicate_source",
			"cost_time_ms",
		],
	},
	affordance_templates: {
		collection: "definitions",
		fields: [
			...common,
			"template_id",
			"niche_id",
			"capability_id",
			"outcome_template_id",
			"predicate_source",
			"locality_class",
		],
	},
	niche_definitions: {
		collection: "definitions",
		fields: [...common, "niche_id", "predicate", "predicate_source"],
	},
	outcome_templates: {
		collection: "definitions",
		fields: [
			...common,
			"outcome_template_id",
			"outcome_expression_source",
			"manipulation_action_id",
		],
	},
	consequence_templates: {
		collection: "definitions",
		fields: [...common, "template_id", "effect_refs_csv"],
	},
	object_state_definitions: {
		collection: "definitions",
		fields: [...common, "state_id", "default_visibility", "value_kind"],
	},
	// A tracked value an entity can hold (hit points, armour class, cost): object state
	// and initial state name it by id like an object state definition.
	resource_definitions: {
		collection: "definitions",
		fields: [
			...common,
			"resource_definition_id",
			"value_kind",
			"min_value",
			"max_value",
			"initial_value",
			"recovery_rule",
		],
	},
	// A bundle-wide (or graph-scoped) movement default: its own row, so an inbound
	// reference to its affordance template can list it.
	movement_defaults: {
		collection: "definitions",
		fields: ["affordance_template_id", "mode_id", "place_graph_id", "bindings_json"],
	},
	entities: {
		collection: "instances",
		fields: ["name", "description", "entity_key", "entity_def_id", "quantity", "kind"],
	},
	actors: {
		collection: "instances",
		fields: ["entity_key", "name", "description", "bundle_id"],
	},
};
const tagParents: Record<string, [string, string]> = {
	entity_definition_tag: ["entity_definitions", "entity_def_id"],
	capability_definition_tag: ["capability_definitions", "capability_id"],
	action_definition_tag: ["action_definitions", "action_id"],
	niche_definition_tag: ["niche_definitions", "niche_id"],
	outcome_template_tag: ["outcome_templates", "outcome_template_id"],
	object_state_definition_tag: ["object_state_definitions", "state_id"],
	resource_definition_tag: ["resource_definitions", "resource_definition_id"],
	entity_tag: ["entities", "entity_key"],
};
for (const [kind, [parentKind, parentField]] of Object.entries(tagParents)) {
	const parent = declarations[parentKind];
	if (parent)
		declarations[kind] = {
			collection: parent.collection,
			fields: [parentField, "tag", "bundle_id", "source"],
		};
}
export const EXPLORATION_MANIFEST_KINDS = [
	"bundles",
	...Object.keys(declarations),
	"place_edges",
	"entity_containment",
	"actor_spatial_locations",
	"entity_definition_initial_capability",
	"entity_definition_initial_state",
	"actor_capabilities",
	"place_edge_affordance",
	"object_state",
	...Object.keys(tagParents),
];
type Row = Record<string, unknown>;
const string = (row: Row, key: string): string | undefined =>
	typeof row[key] === "string" && row[key] !== "" ? (row[key] as string) : undefined;
export async function projectExplorationManifest(
	manifest: Record<string, unknown>,
	identity: Omit<ExplorationSource, "source_epoch" | "coverage" | "projection_version">,
	options: {
		/** Lower per-family work budget; callers cannot raise the production cap. */
		examinedRowLimit?: number;
		/**
		 * Reader-declared coverage per family (e.g. the scoped live reader's own
		 * completion status). The examined-row bound still marks a family incomplete.
		 */
		coverage?: ExplorationSource["coverage"];
	} = {},
): Promise<ExplorationSnapshot> {
	const examinedRowLimit = options.examinedRowLimit ?? EXPLORATION_EXAMINED_ROW_LIMIT;
	if (
		!Number.isInteger(examinedRowLimit) ||
		examinedRowLimit < 1 ||
		examinedRowLimit > EXPLORATION_EXAMINED_ROW_LIMIT
	)
		throw new RangeError(
			`examinedRowLimit must be an integer between 1 and ${EXPLORATION_EXAMINED_ROW_LIMIT}`,
		);
	const coverage: ExplorationSource["coverage"] = (options.coverage ?? []).map((x) => ({ ...x }));
	const rows: ExplorationRow[] = [],
		relations: ExplorationRelation[] = [];
	const byKind = new Map<string, Map<string, ExplorationRow[]>>();
	const fields = Object.fromEntries(
		Object.entries(declarations).map(([kind, d]) => [kind, d.fields]),
	);
	const collections = Object.fromEntries(
		Object.entries(declarations).map(([kind, d]) => [kind, d.collection]),
	);
	const traversals: NonNullable<ExplorationSnapshot["traversals"]>[number][] = [
		{
			from: "place_graphs",
			to: "place_graphs",
			family: "place_graphs",
			route: "neighbors",
			context: true,
		},
		{
			from: "place_graphs",
			to: "place_nodes",
			family: "place_nodes",
			route: "neighbors",
			context: true,
		},
		{ from: "place_nodes", to: "place_nodes", family: "place_edges", route: "neighbors" },
		{ from: "place_nodes", to: "entities", family: "entities", route: "neighbors", context: true },
		{
			from: "place_nodes",
			to: "actors",
			family: "actor_spatial_locations",
			route: "neighbors",
			context: true,
		},
		{ from: "entities", to: "entity_definitions", family: "entities", route: "references" },
	];
	for (const from of ["actors", "entities"])
		for (const to of ["actors", "entities"])
			traversals.push({
				from,
				to,
				family: "entity_containment",
				route: "neighbors",
				context: true,
			});
	const family = (kind: string): Row[] => {
		const raw = Array.isArray(manifest[kind]) ? (manifest[kind] as Row[]) : [];
		const prior = coverage.find((x) => x.family === kind);
		if (prior && raw.length > examinedRowLimit && prior.state === "complete") {
			prior.state = "incomplete";
			prior.reason = "examined_row_bound";
		}
		if (!prior)
			coverage.push({
				family: kind,
				state: raw.length > examinedRowLimit ? "incomplete" : "complete",
				...(raw.length > examinedRowLimit ? { reason: "examined_row_bound" } : {}),
			});
		return raw.slice(0, examinedRowLimit);
	};
	const incomplete = (kind: string, reason = "unsupported_projection") => {
		const c = coverage.find((x) => x.family === kind);
		if (c) {
			c.state = "incomplete";
			c.reason ??= reason;
		}
	};
	for (const [kind, d] of Object.entries(declarations)) {
		const keys = new Map<string, ExplorationRow[]>();
		byKind.set(kind, keys);
		for (const raw of family(kind)) {
			const natural = ROW_KIND_NATURAL_KEY[kind];
			const storage = ROW_KIND_STORAGE_KEY[kind];
			const id = natural
				? string(raw, natural)
				: storage?.every((key) => typeof raw[key] === "string")
					? JSON.stringify(storage.map((key) => raw[key]))
					: undefined;
			if (!id) {
				incomplete(kind);
				continue;
			}
			const scalar: Record<string, ExplorationScalar> = {};
			for (const key of d.fields) {
				const v = raw[key];
				if (
					v === null ||
					typeof v === "string" ||
					typeof v === "boolean" ||
					(typeof v === "number" && Number.isFinite(v))
				)
					scalar[key] = v;
			}
			const row: ExplorationRow = {
				collection: d.collection,
				kind,
				id,
				...(string(raw, "bundle_id") ? { bundle: string(raw, "bundle_id") } : {}),
				label: string(scalar, "display_name") ?? string(scalar, "name") ?? movementLabel(kind, raw),
				description: typeof scalar.description === "string" ? scalar.description : undefined,
				fields: scalar,
				tags: [],
				context: [],
			};
			rows.push(row);
			keys.set(id, [...(keys.get(id) ?? []), row]);
		}
	}
	const find = (kind: string, id: string | undefined): ExplorationRow | undefined => {
		const found = id ? byKind.get(kind)?.get(id) : undefined;
		return found?.length === 1 ? found[0] : undefined;
	};
	// An actor steering row and its same-bundle entity body describe one
	// authored endpoint. Prefer its actor facet; never choose among duplicate
	// keys or join a same-key actor/body from different bundles.
	const findInstance = (key: string | undefined): ExplorationRow | undefined => {
		if (!key) return undefined;
		const actors = byKind.get("actors")?.get(key) ?? [];
		const entities = byKind.get("entities")?.get(key) ?? [];
		if (actors.length > 1 || entities.length > 1) return undefined;
		const actor = actors[0],
			entity = entities[0];
		if (actor && entity && actor.bundle !== entity.bundle) return undefined;
		return actor ?? entity;
	};
	const id = (row: ExplorationRow): ExplorationIdentity => ({
		collection: row.collection,
		kind: row.kind,
		id: row.id,
		...(row.bundle === undefined ? {} : { bundle: row.bundle }),
	});
	const relationKeys = new Set<string>();
	// Context and tag lists grow in side maps, so a hub row with many links stays linear.
	const contexts = new Map<ExplorationRow, ExplorationIdentity[]>();
	const tagLists = new Map<ExplorationRow, string[]>();
	const join = (
		kind: string,
		key: string | undefined,
		from: ExplorationRow | undefined,
		to: ExplorationRow | undefined,
		route: ExplorationRelation["route"],
		context = false,
	) => {
		if (!key || !from || !to) return;
		const relation = { kind, key, from: id(from), to: id(to), route };
		const relationKey = JSON.stringify(relation);
		if (relationKeys.has(relationKey)) return;
		relationKeys.add(relationKey);
		relations.push(relation);
		if (context) {
			const list = contexts.get(to) ?? [];
			contexts.set(to, list);
			list.push(id(from));
		}
	};
	const storageKey = (kind: string, raw: Row): string | undefined => {
		const keys = ROW_KIND_STORAGE_KEY[kind];
		if (!keys || keys.some((key) => typeof raw[key] !== "string")) return undefined;
		return JSON.stringify(keys.map((key) => raw[key]));
	};
	for (const raw of family("place_graphs")) {
		const graph = find("place_graphs", string(raw, "place_graph_id"));
		join(
			"graph_parent",
			graph ? explorationIdentityKey(graph) : undefined,
			find("place_graphs", string(raw, "parent_graph_id")),
			graph,
			"neighbors",
			true,
		);
	}
	for (const raw of family("place_nodes")) {
		const node = find("place_nodes", string(raw, "node_id"));
		join(
			"graph_node",
			node ? explorationIdentityKey(node) : undefined,
			find("place_graphs", string(raw, "place_graph_id")),
			node,
			"neighbors",
			true,
		);
	}
	for (const raw of family("place_edges"))
		join(
			"place_edges",
			string(raw, "edge_key"),
			find("place_nodes", string(raw, "from_node_id")),
			find("place_nodes", string(raw, "to_node_id")),
			"neighbors",
		);
	for (const raw of family("entities")) {
		const entity = find("entities", string(raw, "entity_key"));
		join(
			"entity_location",
			entity ? explorationIdentityKey(entity) : undefined,
			find("place_nodes", string(raw, "place_node_id")),
			entity,
			"neighbors",
			true,
		);
		join(
			"entity_definition",
			entity ? explorationIdentityKey(entity) : undefined,
			entity,
			find("entity_definitions", string(raw, "entity_def_id")),
			"references",
		);
	}
	for (const raw of family("actor_spatial_locations")) {
		const actor = find("actors", string(raw, "entity_key"));
		join(
			"actor_spatial_locations",
			string(raw, "entity_key"),
			find("place_nodes", string(raw, "place_node_id")),
			actor,
			"neighbors",
			true,
		);
	}
	for (const raw of family("entity_containment"))
		join(
			"entity_containment",
			storageKey("entity_containment", raw),
			findInstance(string(raw, "container_entity_key")),
			findInstance(string(raw, "entity_key")),
			"neighbors",
			true,
		);
	traversals.push({
		from: "entity_definitions",
		to: "capability_definitions",
		family: "entity_definition_initial_capability",
		route: "references",
	});
	for (const raw of family("entity_definition_initial_capability"))
		join(
			"entity_definition_initial_capability",
			storageKey("entity_definition_initial_capability", raw),
			find("entity_definitions", string(raw, "entity_def_id")),
			find("capability_definitions", string(raw, "capability_id")),
			"references",
		);
	// A state id resolves against the union of object state and resource definitions
	// (the validator's MF-VAL-253 seed check); an id both define names one state slot,
	// so it links to both rows.
	const stateTargets = (id: string | undefined) =>
		[find("object_state_definitions", id), find("resource_definitions", id)].filter(
			(row): row is ExplorationRow => row !== undefined,
		);
	for (const to of ["object_state_definitions", "resource_definitions"]) {
		traversals.push({
			from: "entity_definitions",
			to,
			family: "entity_definition_initial_state",
			route: "references",
		});
		for (const from of ["actors", "entities"])
			traversals.push({ from, to, family: "object_state", route: "references" });
	}
	for (const raw of family("entity_definition_initial_state"))
		for (const target of stateTargets(string(raw, "state_id")))
			join(
				"entity_definition_initial_state",
				storageKey("entity_definition_initial_state", raw),
				find("entity_definitions", string(raw, "entity_def_id")),
				target,
				"references",
			);
	for (const raw of family("object_state"))
		for (const target of stateTargets(string(raw, "state_id")))
			join(
				"object_state",
				storageKey("object_state", raw),
				findInstance(string(raw, "entity_key")),
				target,
				"references",
			);
	// Authored links that name a capability or affordance template from another row:
	// an actor's granted capability, a movement default and an edge's affordance.
	for (const from of ["actors", "entities"])
		traversals.push({
			from,
			to: "capability_definitions",
			family: "actor_capabilities",
			route: "references",
		});
	for (const raw of family("actor_capabilities"))
		join(
			"actor_capabilities",
			storageKey("actor_capabilities", raw),
			findInstance(string(raw, "actor_entity_key")),
			find("capability_definitions", string(raw, "capability_id")),
			"references",
		);
	traversals.push(
		{
			from: "movement_defaults",
			to: "affordance_templates",
			family: "movement_defaults",
			route: "references",
		},
		{
			from: "movement_defaults",
			to: "place_graphs",
			family: "movement_defaults",
			route: "references",
		},
	);
	for (const raw of family("movement_defaults")) {
		const key = storageKey("movement_defaults", raw);
		const from = find("movement_defaults", key);
		join(
			"movement_defaults.affordance_template_id",
			key,
			from,
			find("affordance_templates", string(raw, "affordance_template_id")),
			"references",
		);
		join(
			"movement_defaults.place_graph_id",
			key,
			from,
			find("place_graphs", string(raw, "place_graph_id")),
			"references",
		);
	}
	traversals.push({
		from: "place_nodes",
		to: "affordance_templates",
		family: "place_edge_affordance",
		route: "references",
	});
	// An edge is a relation, not a row: its affordance is used from the edge's origin room.
	// A duplicate edge key has no single origin, so it is never attributed (like find()).
	const edgeOrigin = new Map<string, string | undefined>();
	for (const raw of family("place_edges")) {
		const edge = string(raw, "edge_key");
		if (!edge) continue;
		edgeOrigin.set(edge, edgeOrigin.has(edge) ? undefined : string(raw, "from_node_id"));
	}
	for (const raw of family("place_edge_affordance"))
		join(
			"place_edge_affordance",
			storageKey("place_edge_affordance", raw),
			find("place_nodes", edgeOrigin.get(string(raw, "edge_key") ?? "")),
			find("affordance_templates", string(raw, "affordance_template_id")),
			"references",
		);
	// A cut edge list can hide an origin room: the affordance links are then incomplete too.
	const edgeCoverage = coverage.find((x) => x.family === "place_edges");
	if (edgeCoverage?.state === "incomplete")
		incomplete("place_edge_affordance", edgeCoverage.reason ?? "examined_row_bound");
	for (const [kind, links] of Object.entries({
		affordance_templates: [
			["niche_definitions", "niche_id"],
			["capability_definitions", "capability_id"],
			["outcome_templates", "outcome_template_id"],
		],
		action_definitions: [
			["capability_definitions", "required_capability"],
			["consequence_templates", "on_success"],
			["consequence_templates", "on_failure"],
		],
		outcome_templates: [["action_definitions", "manipulation_action_id"]],
	}))
		for (const raw of family(kind))
			for (const [targetKind, field] of links) {
				if (!targetKind || !field) continue;
				const from = find(kind, string(raw, ROW_KIND_NATURAL_KEY[kind] ?? ""));
				join(
					`${kind}.${field}`,
					from ? explorationIdentityKey(from) : undefined,
					from,
					find(targetKind, string(raw, field)),
					"references",
				);
			}
	for (const [from, to, family] of [
		["affordance_templates", "niche_definitions", "affordance_templates"],
		["affordance_templates", "capability_definitions", "affordance_templates"],
		["affordance_templates", "outcome_templates", "affordance_templates"],
		["action_definitions", "capability_definitions", "action_definitions"],
		["action_definitions", "consequence_templates", "action_definitions"],
		["outcome_templates", "action_definitions", "outcome_templates"],
	] as const)
		traversals.push({ from, to, family, route: "references" });
	for (const [familyKind, [parentKind, parentField]] of Object.entries(tagParents)) {
		for (const from of familyKind === "entity_tag" ? ["actors", "entities"] : [parentKind])
			traversals.push({
				from,
				to: familyKind,
				family: familyKind,
				route: "references",
				context: true,
			});
		for (const raw of family(familyKind)) {
			const parent =
					familyKind === "entity_tag"
						? findInstance(string(raw, parentField))
						: find(parentKind, string(raw, parentField)),
				tag = string(raw, "tag");
			if (parent && tag) {
				const list = tagLists.get(parent) ?? [];
				tagLists.set(parent, list);
				list.push(tag);
				const key = storageKey(familyKind, raw);
				join(familyKind, key, parent, find(familyKind, key), "references", true);
			}
		}
		const tagCoverage = coverage.find((x) => x.family === familyKind);
		if (tagCoverage?.state === "incomplete") {
			// Instance tag membership can attach to either authored facet, so
			// truncation cannot establish absence for either parent family.
			const parents = familyKind === "entity_tag" ? ["actors", "entities"] : [parentKind];
			for (const parent of parents) incomplete(parent, tagCoverage.reason);
		}
	}
	for (const [row, list] of contexts) row.context = list;
	for (const [row, list] of tagLists) row.tags = [...new Set(list)];
	// Through family(): a bundle list over the bound is reported incomplete, not cut silently.
	const bundles = family("bundles").flatMap((raw) => {
		const bundle = string(raw, "bundle_id");
		const title = string(raw, "display_name");
		return bundle ? [{ bundle, ...(title ? { title } : {}) }] : [];
	});
	// Digest only the declared projection. Opaque metadata/payload changes do not alter observable epochs.
	const source: ExplorationSource = {
		...identity,
		projection_version: "exploration-v1",
		coverage,
		source_epoch: await explorationDigest({
			rows,
			relations,
			coverage,
			fields,
			collections,
			traversals,
			bundles,
		}),
	};
	// Every field is detached scalar/identity data, so callers cannot mutate a
	// snapshot while a digest or subsequent traversal is in flight.
	const snapshot = { source, rows, relations, fields, collections, traversals, bundles };
	function freeze(value: unknown): void {
		if (value === null || typeof value !== "object" || Object.isFrozen(value)) return;
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	freeze(snapshot);
	return snapshot;
}
/** A movement default has no authored name; its label states what it selects. */
function movementLabel(kind: string, raw: Row): string | undefined {
	if (kind !== "movement_defaults") return undefined;
	const graph = string(raw, "place_graph_id");
	const mode = string(raw, "mode_id");
	return `Movement default ${string(raw, "affordance_template_id") ?? ""}${mode ? ` (${mode})` : ""}${graph ? ` in ${graph}` : ""}`;
}
