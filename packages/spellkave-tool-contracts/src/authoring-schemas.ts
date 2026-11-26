import { type Static, Type } from "typebox";
import { EXPLORE_PARAMS } from "./exploration";

export const PLACE_SUBSTRATE_DEFAULT = "outdoor";

export const TAGS_PARAM = Type.Array(Type.String(), {
	description:
		"One INSTANCE-level entity_tag row per tag ('this goblin is the leader / faction X') — NOT an " +
		"entity_definition_tag. Tag-grammar membership (MF-VAL-300) and dedup are enforced by the shared " +
		"validator at commit; an unknown-grammar tag is reported as a diagnostic, not persisted. When a tag " +
		"has authored tag_capability_grant rows (workspace/live), the result surfaces 'tag X grants " +
		"capability Y' so the author sees the consequence — informational, never blocking.",
});

export const DOCS_PARAMS = Type.Object({
	query: Type.Optional(
		Type.String({
			description:
				"Free-text question about how to author something, e.g. 'how do I express object decay over time'. Matched (keyword/heading) against the packaged authoring corpus. Omit to list the bounded corpus index instead of querying it.",
		}),
	),
	doc: Type.Optional(
		Type.String({
			description:
				"Exact corpus id (a `rel` from the index or a hit, e.g. 'dm-oversight') — returns that ONE doc whole: its prose body, the worked-example walkthrough when the id has both halves, and the complete example manifest TOML when `has_example` is true. This is how you get something copyable rather than only readable. Mutually exclusive with `query`; takes precedence if both are set.",
		}),
	),
	section: Type.Optional(
		Type.String({
			description:
				"Optional heading text or anchor within `doc` — returns only that section's markdown instead of the full body. Unknown section fails (does not silently return the whole doc). Ignored without `doc`.",
		}),
	),
	outline: Type.Optional(
		Type.Boolean({
			description:
				"With `doc`, return title + summary + heading list only (no full body). Default for oversized docs when neither `section` nor `full` is set.",
		}),
	),
	full: Type.Optional(
		Type.Boolean({
			description:
				"With `doc`, force the complete body even when oversized (tool-reference, long references). Prefer `section` instead. Default false.",
		}),
	),
	doc_paths: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Optional corpus-id filter (substring match) restricting the search to specific packaged docs. Only applies with `query` set; can only narrow the corpus, never widen it.",
		}),
	),
	limit: Type.Optional(
		Type.Number({
			description: "Max number of doc slices to return when `query` is set (default 3).",
		}),
	),
});

export const INEXPRESSIBLE_PARAMS = Type.Object({
	reason: Type.String({
		description:
			"Precisely why no documented row kind / DSL form can express this intent within the validator's surface.",
	}),
});

export const DOC_GAP_PARAMS = Type.Object({
	doc: Type.String({
		description: "Which corpus doc id you were working from, e.g. 'dsl-grammar'.",
	}),
	expected: Type.String({ description: "What the doc led you to expect." }),
	actual: Type.String({ description: "What the validator actually did — the discrepancy." }),
});

export const EXPORT_MANIFEST_PARAMS = Type.Object({
	bundle: Type.String({
		description: "bundle_id to reconstruct via r_export_manifest (ADR-0086).",
	}),
	actor: Type.Optional(
		Type.String({
			description:
				"entity_key of the hero to keep. When set, only that actor and what hangs off it remain.",
		}),
	),
	out: Type.Optional(Type.String({ description: "Write the rendered TOML to this file path." })),
	out_dir: Type.Optional(
		Type.String({
			description: "Write <slug>.toml into this directory (slug from --actor, else the bundle id).",
		}),
	),
});

export const GET_PARAMS = Type.Object({
	kind: Type.String({
		description:
			"Instance row kind: entities, actors, actor_spatial_locations, actor_capabilities, actor_equipment_slots, entity_containment, entity_tag, or object_state.",
	}),
	key: Type.Optional(
		Type.String({
			description:
				"Key field values joined with :: in schema natural- or storage-key order. Omit to list.",
		}),
	),
	bundle: Type.Optional(
		Type.String({ description: "bundle_id. Omit when the authored key is unique." }),
	),
	pattern: Type.Optional(
		Type.String({ description: "Substring filter on key fields for listings." }),
	),
	fields: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Listing columns. Omit for the compact preferred set. Key fields are always kept. Keyed get ignores this (whole row).",
		}),
	),
	limit: Type.Optional(Type.Integer({ minimum: 0, description: "Listing cap (default 50)." })),
});

export const DESCRIBE_PARAMS = Type.Object({
	kind: Type.String({ description: "Must be entities." }),
	key: Type.String({
		description: "Authored entity_key or numeric id of an authored entity.",
	}),
	bundle: Type.Optional(Type.String({ description: "bundle_id when the key is not unique." })),
	limit: Type.Optional(
		Type.Integer({ minimum: 0, description: "Belonging-list cap (default 50)." }),
	),
});

export const CAN_I_PARAMS = Type.Object({
	action: Type.String({ description: "The action id." }),
	as: Type.String({
		description: "The body the question is about, as its authored entity key or its entity id.",
	}),
	target: Type.Union(
		[
			Type.String({ description: "An authored entity key, entity id, or world." }),
			Type.Object({
				kind: Type.Union([
					Type.Literal("entity"),
					Type.Literal("place_node"),
					Type.Literal("place_edge"),
					Type.Literal("location"),
					Type.Literal("world"),
				]),
				id: Type.Optional(Type.String()),
			}),
		],
		{
			description: "The target of the attempt, as an authored key, entity id, or target reference.",
		},
	),
	args: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description:
				"Literal manipulation arguments for the probe. Supply the same selected items and either fresh expected_participants or participant_context as the intended dispatch; can-i does not compose a participant context.",
		}),
	),
	expect: Type.Optional(
		Type.Union([Type.Literal("admitted"), Type.Literal("refused")], {
			description: "Closed-door expectation. A differing answer is a rejection.",
		}),
	),
});

export const DIFF_MANIFEST_PARAMS = Type.Object({
	left: Type.String({
		description: "Reference manifest TOML (only-left rows are gaps).",
	}),
	right: Type.String({
		description: "Compared manifest TOML (only-right rows are snapshot/play).",
	}),
	ignore_fields: Type.Optional(
		Type.String({
			description:
				"Comma-separated extra field names to ignore on every kind (merged with the default snapshot/enrichment list).",
		}),
	),
	kinds: Type.Optional(
		Type.String({
			description: "Comma-separated row kinds to compare (default: every array-valued kind).",
		}),
	),
	only: Type.Optional(
		Type.Union([Type.Literal("gaps"), Type.Literal("snapshot"), Type.Literal("changed")], {
			description:
				"Restrict the report: gaps = only-left, snapshot = only-right, changed = same key with field diffs.",
		}),
	),
	map_key: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Repeatable from=to key-prefix maps (sk-0m4.54). Rewrites entity/actor keys and every string field that is or embeds that key before compare, so an export keyed candidate_1 can match a reference keyed hero_1.",
		}),
	),
});

const APPLYSET_DIR = Type.String({
	description:
		"The applyset root: a directory holding manifest.toml, or the root manifest file itself. " +
		"Its includes are read too; only the root's own rows are compared and sent.",
});

const APPLYSET_DEPS = Type.Optional(
	Type.Array(Type.String(), {
		description:
			"Repeatable dependency root manifests (or their directories), loaded for validation only and never sent.",
	}),
);

export const PORTABLE_SOURCE_PARAMS = Type.Object(
	{
		root_path: Type.String({
			description:
				"Stable logical relative root name recorded in applyset provenance; never a server file path.",
		}),
		root_toml: Type.String(),
		fragments: Type.Array(
			Type.Object({ path: Type.String(), toml: Type.String() }, { additionalProperties: false }),
		),
	},
	{ additionalProperties: false },
);

export const APPLYSET_DIFF_PARAMS = Type.Object({
	dir: Type.Optional(APPLYSET_DIR),
	source: Type.Optional(PORTABLE_SOURCE_PARAMS),
	dep: APPLYSET_DEPS,
	prune: Type.Optional(
		Type.Boolean({
			description:
				"Preview an apply with pruning: inspect world-added rows on each removed entity, without writing. Requires publisher closure to inspect entity contents; an unreadable candidate is reported as a refusal. Off by default.",
		}),
	),
});

export const APPLYSET_APPLY_PARAMS = Type.Object({
	dir: Type.Optional(APPLYSET_DIR),
	source: Type.Optional(PORTABLE_SOURCE_PARAMS),
	dep: APPLYSET_DEPS,
	prune: Type.Optional(
		Type.Boolean({
			description:
				"Also retract rows the applyset applied before and the files no longer name. Retracting an entity covers its authored containment, state, resource bound, equipment (the wearer side), actor, position, identity, and capability rows (those kinds cannot be removed alone); tag rows stay. Pruning an equipped item together with its slot row while the wearer stays is refused. A containment row the files replace with another containment for the same contained entity needs no retraction. Retracting an entity on which the world holds rows beyond what the files put there, or any entity prune when those rows cannot be read, is refused unless --force. Off by default.",
		}),
	),
	dry_run: Type.Optional(
		Type.Boolean({
			description: "Compute and report the difference; send nothing (same as diff).",
		}),
	),
	force: Type.Optional(
		Type.Boolean({
			description:
				"Let the files win over observed world changes, let this root take over an applyset name recorded under another root path, and retract an entity with world-added rows or unreadable prune contents. The answer reports the meanings used as a force_used list containing world_changed, root_takeover, and/or world_added_rows.",
		}),
	),
});

export const APPLY_MANIFEST_DELTA_PARAMS = Type.Object({
	toml: Type.Optional(
		Type.String({
			description:
				"Optional escape hatch: a full manifest-delta TOML string to flush. " +
				"Omit to commit the active workspace scratch (workspace.readToml) — the normal " +
				"transaction end after write verbs. Pass only when applying an external/ad-hoc delta " +
				"that is not the scratch pad.",
		}),
	),
});

export const QUERY_PARAMS = Type.Object({
	explore: Type.Optional(EXPLORE_PARAMS),
	kind: Type.Optional(
		Type.String({
			description:
				"A manifest row-kind name (a ROW_KIND_NATURAL_KEY key — e.g. 'capability_definitions', " +
				"'affordance_templates', 'action_definitions', 'outcome_templates', 'entity_definitions', " +
				"'area_shape_definitions', 'resource_definitions'), the SAME vocabulary spellkave_write_rows " +
				"and every define_* verb already use — not a closed enum. Also accepts a `*_tag` satellite kind " +
				"(e.g. 'resource_definition_tag', 'capability_definition_tag') — these have a TWO-field composite " +
				"key (parent id + tag) instead of a single natural key; see `schema: true` for the field order. " +
				"Omit for a workspace/target summary (bundle ids + a row-kind -> count map) instead of listing " +
				"one kind.",
		}),
	),
	id: Type.Optional(
		Type.String({
			description:
				"An exact natural-key value within `kind` — returns the complete authored row (detail shape), " +
				"its source, and (by default) its refs. For a composite-keyed `*_tag` satellite kind, this is its " +
				"ordered key fields' values joined by '::' (e.g. 'srd/wis::ability_score' for " +
				"resource_definition_tag's `{resource_definition_id, tag}` — get the exact ids from a `kind`-only " +
				"list call first). Mutually exclusive with `pattern`; requires `kind`.",
		}),
	),
	pattern: Type.Optional(
		Type.String({
			description:
				"A substring filter on `kind`'s ids (its natural-key value, or its '::'-joined composite-key " +
				"value for a `*_tag` satellite kind) — returns a filtered list instead of the full catalog. " +
				"Mutually exclusive with `id`; requires `kind`.",
		}),
	),
	bundle: Type.Optional(
		Type.String({
			description: "Restrict to rows stamped with this bundle_id (summary/list shapes only).",
		}),
	),
	fields: Type.Optional(
		Type.Union(
			[Type.Literal("preferred"), Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })],
			{
				description:
					"List shape only (`kind` without `id`; ignored for detail/summary/schema). " +
					"Default (omit): token-safe catalog — each item is only `{ id, bundle_id? }`. " +
					"`preferred`: project a small kind-specific field set (e.g. entities → name, " +
					"place_node_id, kind, entity_def_id) so one list call can answer who-is-where " +
					"without N detail round-trips. Explicit string[]: project exactly those column " +
					"names from each row (unknown/missing names omitted; nested values skipped). " +
					"`id` is always present; `bundle_id` is included when the row has it.",
			},
		),
	),
	refs: Type.Optional(
		Type.Union([Type.Literal("none"), Type.Literal("outbound"), Type.Literal("both")], {
			description:
				"Detail shape only (`kind`+`id`; ignored otherwise). 'outbound': fields on this row pointing " +
				"elsewhere (already-computed string-ref heuristic). 'both' additionally computes inbound_refs — " +
				"every OTHER row anywhere in the resolved source whose own outbound ref points AT this row, " +
				"grouped by referencing kind — so a caller traverses a chain (e.g. capability -> affordance -> " +
				"action -> outcome) by re-calling spellkave_query with a ref's own {kind, id}, no separate " +
				"traversal tool needed. Default: 'both' when `id` is set.",
		}),
	),
	target: Type.Optional(
		Type.Union([Type.Literal("workspace"), Type.Literal("local"), Type.Literal("live")], {
			description:
				"#1968 connection-level target override (READ-only — no write verb offers this): 'workspace' " +
				"reads ONLY the workspace scratch manifest, ignoring any connection-level target/live db this call " +
				"would otherwise consult. 'local' reads ONLY the active local folder target — errors if none is " +
				"configured. 'live' reads ONLY the active live target (or the legacy live db when no target is " +
				"wired at all) — errors if neither is available. Omit for the default union: workspace + whatever " +
				"is configured (result.source says which).",
		}),
	),
	schema: Type.Optional(
		Type.Boolean({
			description:
				"Ask what a row of `kind` may CONTAIN instead of which rows exist (#1983): with `kind`, that " +
				"row kind's required fields, field types, and natural/composite key; without `kind`, the " +
				"row-kind vocabulary itself (every kind the manifest schema defines, flagged for whether this " +
				"tool can also list its rows). Schema covers all 79 manifest row kinds — a superset of the ~53 " +
				"`id`/`pattern` can address: the 40 with a single-column natural key, plus the `*_tag` satellite " +
				"kinds and `tag_capability_grant` with a two-field composite key (finding #9; sk-bwd). Ignores " +
				"`id`/`pattern`/`bundle`/`target`: a " +
				"row kind's shape is the same everywhere, so no source is consulted.",
		}),
	),
});

export const MAP_GRAPH_PARAMS = Type.Object({
	graph: Type.Optional(
		Type.String({
			description:
				"Optional place_graph_id filter — when set, draw that graph (any substrate). " +
				"Omit to compose every outdoor positioned graph (world map).",
		}),
	),
	slice: Type.Optional(
		Type.Union(
			[
				Type.Literal("elevation_band"),
				Type.Literal("all_floors_offset"),
				Type.Literal("topology_only"),
				Type.Literal("metric"),
				Type.Literal("h3_world"),
			],
			{
				description:
					"How to project multi-floor / unpositioned graphs: elevation_band (one floor), " +
					"all_floors_offset (floors side-by-side), topology_only (adjacency layout), metric (all z in one plane), " +
					"h3_world (outdoor multi-graph from cell_res10 — same plane idea as web WorldMapView). " +
					"Omit for auto (indoor multi-z → elevation_band at z=0; outdoor compose uses h3 when cells present).",
			},
		),
	),
	z: Type.Optional(
		Type.Number({
			description: "Elevation for slice=elevation_band (default 0). Matches pose_elevation.",
		}),
	),
	z_tolerance: Type.Optional(
		Type.Number({
			description: "Half-width of elevation_band in elevation units (default 0.5).",
		}),
	),
	lod: Type.Optional(
		Type.Union([Type.Literal("structure"), Type.Literal("furnished")], {
			description:
				"structure = rooms/routes only (no occupancy badges); furnished = + actor counts (default).",
		}),
	),
	output_type: Type.Optional(
		Type.Union(
			[
				Type.Literal("utf8"),
				Type.Literal("ascii"),
				Type.Literal("braille"),
				Type.Literal("inventory"),
				Type.Literal("svg"),
				Type.Literal("jpg"),
			],
			{
				description:
					"Which single artifact to render — the engine computes ONLY this one (bead sk-due: " +
					"the old `terminal` param picked the text body while the engine rendered svg + " +
					"utf8 + ascii + braille + inventory regardless, every call). 'svg' (default) — this " +
					"tool's own interactive picture-first use case: the raw SVG in details.svg plus an " +
					"ImageContent PNG for hosts that render tool images (Pi TUI / Ghostty Kitty). " +
					"'utf8'/'ascii'/'braille' return that text variant in the like-named details field " +
					"instead (no image). 'inventory' skips the graph picture entirely, details.inventory " +
					"only. 'jpg' writes a backdrop-composed JPEG to output_dir/output_name and returns " +
					"its path as details.jpg_path — no svg/ascii/utf8/braille text in the response.",
			},
		),
	),
	output_dir: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"output_type='jpg' only; ignored otherwise. Directory to write the map-art JPEG into " +
				"— absolute, or RELATIVE to the host process's own cwd. Optional: omit for a fresh " +
				"temp directory (mkdtemp). Resolves this graph's authored [[map_layers]] backdrop " +
				"(unmasked — same drawn-in-full contract every backdrop render in this package " +
				"follows), rasterizes via resvg then encodes via ffmpeg -q:v 4, skipping the rewrite " +
				"when an unchanged render already sits there (deterministic churn guard).",
		}),
	),
	output_name: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"output_type='jpg' only; ignored otherwise. Base filename (no extension) for the JPEG " +
				"written under output_dir. Optional: omit for a name derived from graph, or 'map' when " +
				"graph itself is also omitted (a world-compose call).",
		}),
	),
	target: Type.Optional(
		Type.Union([Type.Literal("workspace"), Type.Literal("local"), Type.Literal("live")], {
			description:
				"Same read-only source override as spellkave_query (`workspace` | `local` | `live`). Omit for the default workspace+configured-target union.",
		}),
	),
});

export const PLACE_NODE_PARAMS = Type.Object({
	id: Type.String({
		description:
			"Fully-qualified place-node id '<place_graph_id>/<local_id>' (e.g. 'aoe_blast/arena/center'). " +
			"PoC boundary: bare local ids are not supported.",
	}),
	name: Type.Optional(
		Type.String({ description: "display_name; defaults to a title-cased local id." }),
	),
	x: Type.Optional(
		Type.Number({
			description:
				"Optional metric graph-local pos_x (integer graph units). When any node omits x/y, " +
				"author_place auto-layouts all nodes on a circle (n>=3) or a line (n=1..2).",
		}),
	),
	y: Type.Optional(
		Type.Number({
			description: "Optional metric graph-local pos_y (integer graph units). See `x`.",
		}),
	),
	elevation: Type.Optional(
		Type.Number({
			description:
				"Optional graph-local pose_elevation (metres-ish via graph metres_per_unit). Use for floors/cellars " +
				"(e.g. 0 ground, -3 cellar). Omit for 0 with pose_elevation_present=true.",
		}),
	),
	cell_res10: Type.Optional(
		Type.String({
			description:
				"Optional outdoor H3 res10 cell as decimal u64 string (parents res7/res4 derived via h3-js). " +
				"Prefer strings so values above MAX_SAFE_INTEGER stay exact.",
		}),
	),
	description: Type.Optional(
		Type.String({
			description:
				"Sets THIS node's own `place_nodes.description` column (T5 follow-up, #1968 pattern: a " +
				"first-class field, never a metadata_attachments detour — same shape as the top-level " +
				"`description` param below, which sets the GRAPH's own description instead). Read by " +
				"movement-observation tools (e.g. spellkave_move) as the arrival prose for THIS node; " +
				"falls back to the graph's own description only on a graph-crossing move when omitted.",
		}),
	),
	extent_shape_id: Type.Optional(
		Type.String({
			description:
				"place_nodes.extent_shape_id (place-node-extent D-2, sk-71u): an explicit spatial extent " +
				"for THIS node — one of the KNOWN_AREA_SHAPE_IDS kernel shapes (e.g. 'core/area/sphere', " +
				"'core/area/cube'). Overrides the bundle's own default_extent_shape_id (spellkave_define_bundle) " +
				"for this node only. Pair with `extent_params_json`; omit both to fall back to the bundle default.",
		}),
	),
	extent_params_json: Type.Optional(
		Type.String({
			description:
				"place_nodes.extent_params_json — the params_json paired with `extent_shape_id` (e.g. " +
				"'{\"radius_m\": 2.5}' for core/area/sphere). Only meaningful alongside `extent_shape_id`.",
		}),
	),
});

export const AUTHOR_PLACE_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	substrate: Type.Optional(
		Type.String({
			description:
				"substrate_id for the graph and every node (core: outdoor | indoor | tactical). " +
				`Default '${PLACE_SUBSTRATE_DEFAULT}'. Houses/interiors should use 'indoor'.`,
		}),
	),
	parent_graph_id: Type.Optional(
		Type.String({
			description:
				"Composition parent place_graph_id (ADR-0029 / Item 25). Empty/omit = root. " +
				"Nested outdoor graphs project into the parent frame on the world map.",
		}),
	),
	origin_cell_res10: Type.Optional(
		Type.String({
			description:
				"Root outdoor H3 res10 anchor as decimal u64 string. Only composition roots should set this; " +
				"res7/res4 parents are derived. Nested graphs omit (origin stays 0).",
		}),
	),
	bearing: Type.Optional(
		Type.Number({
			description:
				"Clockwise rotation degrees relative to parent/world frame (ADR-0029). Default 0.",
		}),
	),
	metres_per_unit: Type.Optional(
		Type.Number({
			description: "Graph unit → metres (ADR-0029). Default 1. Outdoor world maps often use >1.",
		}),
	),
	display_name: Type.Optional(
		Type.String({ description: "place_graph display_name; default title-cased graph local id." }),
	),
	nodes: Type.Array(PLACE_NODE_PARAMS, {
		description:
			"One or more place nodes. Every id must share ONE common parent path (one place_graph per call — a " +
			"PoC boundary); the FIRST node becomes the place_graph's anchor_node_id.",
	}),
	// Use min/maxItems array (not Type.Tuple): TypeBox tuples emit draft-04
	// `items: [schema, schema]`, which xAI/OpenAI tool schema validation rejects.
	edges: Type.Array(Type.Array(Type.String(), { minItems: 2, maxItems: 2 }), {
		description:
			"[from_node_id, to_node_id] pairs; both ends must be in `nodes`. Pass [] for disconnected nodes " +
			"(e.g. two same-radius cells with no traversal edge between them, as the worked example does).",
	}),
	description: Type.Optional(
		Type.String({
			description:
				"Sets the generated place_graph's own `description` column (#1968 — a first-class, never " +
				"load-bearing authoring field, not a metadata_attachments row).",
		}),
	),
});

export const RESOURCE_SEED_PARAMS = Type.Object({
	resource: Type.String({
		description: "A resource_definition_id (or any object_state state_id).",
	}),
	value: Type.Number({ description: "The per-instance value_int override." }),
});

export const PLACEMENT_PARAMS = Type.Object({
	at: Type.String({
		description:
			"An already-authored place_node id (e.g. from spellkave_author_place) every instance in THIS " +
			"placement is placed at.",
	}),
	count: Type.Optional(
		Type.Number({ description: "How many identical instances at this placement (default 1)." }),
	),
	resources: Type.Optional(
		Type.Array(RESOURCE_SEED_PARAMS, {
			description:
				"Per-instance object_state overrides seeded on EVERY instance in THIS placement.",
		}),
	),
	key_prefix: Type.Optional(
		Type.String({
			description:
				"#1968 workspace idempotency: THIS placement's own explicit identity stem — keys become " +
				"'<bundle>/<key_prefix>_<n>' (n restarts at 1 for this placement's own prefix, EVERY call — never " +
				"derived from what already exists in the workspace). A re-run with the SAME key_prefix therefore " +
				"reproduces the SAME keys and UPSERTS the rows owned by the selected placement tool. Omit for an " +
				"anonymous, additive placement (default " +
				"'<bundle>/<slugified entity_def>_<n>', numbered onward from whatever already exists in the " +
				"workspace so repeated calls never collide) — name placements for idempotent scripts. Mutually " +
				"exclusive with `entity_key`.",
		}),
	),
	entity_key: Type.Optional(
		Type.String({
			description:
				"sk-9ll.6: THIS placement's own explicit, LITERAL entity_key, used verbatim — NO bundle prefix and " +
				"NO ordinal suffix minted (contrast `key_prefix`'s derived '<bundle>/<key_prefix>_<n>'). For a " +
				"pre-known exact key a script/fixture depends on (e.g. 'fastlane/hero') that does not follow the " +
				"'<bundle>/<stem>_<n>' convention — the escape hatch that let raw write_rows chains mint exact keys " +
				"this verb previously could not reproduce. Re-running with the SAME entity_key upserts its owned " +
				"rows, same as `key_prefix`. Mutually exclusive with `key_prefix`; only legal for a single instance " +
				"— omit `count` or set it to 1.",
		}),
	),
	name: Type.Optional(
		Type.String({
			description:
				"sk-ntz.1: THIS placement's own explicit, VERBATIM `entities.name`/`actors.name` override — used AS-IS " +
				"on every instance in THIS placement, no ordinal suffix appended (contrast the default title-cased " +
				"`kind`/`entity_def` naming, which DOES append an ordinal for multi-instance placements). Overrides " +
				"the flat `name` when both are set (THIS placement's own `name` wins) — the escape hatch that let raw " +
				"write_rows chains author a custom display name this verb previously could not reproduce (the fold " +
				"this verb was widened for, sk-ntz.1, otherwise had no way to keep a fixture's own 'Fast-lane Hero' " +
				"style name). Mutually exclusive with `name_prefix`. Omit for the existing default: title-cased " +
				"`kind`/`entity_def`, ordinal-suffixed for multi-instance placements — unchanged.",
		}),
	),
	name_prefix: Type.Optional(
		Type.String({
			description:
				"sk-jay0.7.15.3: THIS placement's own display-name STEM — replaces only the title-cased `kind`/" +
				"`entity_def` half of the derived name and KEEPS the ordinal (`'<name_prefix> <n>'`). The group-" +
				"placement counterpart to verbatim `name` (which is used AS-IS with no ordinal, so a count>1 batch " +
				"would otherwise share one identical name). Overrides the flat `name_prefix` when both are set (THIS " +
				"placement's own `name_prefix` wins). Mutually exclusive with `name`. Illegal with `entity_key` " +
				"(no ordinal is minted — use `name` for a single literal key). Omit for the existing default — " +
				"unchanged.",
		}),
	),
	quantity: Type.Optional(
		Type.Integer({
			minimum: 1,
			description:
				"sk-ntz.1: THIS placement's own explicit `entities.quantity` (stack size) override for every instance " +
				"in THIS placement — spellkave_place_entity ONLY (a stackable item's own on-instance count, e.g. a " +
				"10-credit purse); spellkave_place_actor rejects a set `quantity` outright (actors carry no stack — " +
				"use spellkave_place_entity instead). Overrides the flat `quantity` when both are set (THIS " +
				"placement's own `quantity` wins). Omit for the schema default (1) — unchanged.",
		}),
	),
	tags: Type.Optional(TAGS_PARAM),
});

export const PLACE_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	kind: Type.Union(
		[Type.Literal("player"), Type.Literal("npc"), Type.Literal("item"), Type.Literal("place")],
		{
			description:
				"Manifest entity kind accepted by the current authoritative schema. The placement tool controls " +
				"whether actor steering rows exist; `kind` does not. The open-vocabulary migration is tracked by #2066.",
		},
	),
	entity_def: Type.Optional(
		Type.String({
			description:
				"Optional fully-qualified catalog entity_def_id (contains '/', e.g. 'srd/monster/goblin') that " +
				"must already resolve in the workspace or live world. `kind` remains explicit and independent.",
		}),
	),
	at: Type.Optional(
		Type.String({
			description:
				"FLAT single-location shape: an already-authored place_node id every instance is placed at. " +
				"Mutually exclusive with `placements` (FIX①, #1968) — set `at` (+ `count`/`resources`) for ONE " +
				"location, or `placements` to split a batch across MULTIPLE locations in one call, never both.",
		}),
	),
	count: Type.Optional(
		Type.Number({
			description: "FLAT shape only: how many identical instances to place (default 1).",
		}),
	),
	resources: Type.Optional(
		Type.Array(RESOURCE_SEED_PARAMS, {
			description:
				"FLAT shape only: per-instance object_state overrides seeded on EVERY placed entity in this " +
				"call (e.g. a non-default starting pool value). Does NOT declare the resource_definitions row " +
				"itself (use spellkave_define_resource first).",
		}),
	),
	tags: Type.Optional(TAGS_PARAM),
	placements: Type.Optional(
		Type.Array(PLACEMENT_PARAMS, {
			description:
				"MULTI-LOCATION shape (FIX①, #1968): one or more {at, count?, resources?, tags?} groups placing the " +
				"SAME kind/entity_def split across DIFFERENT place_nodes in a single call (e.g. 3 targets at the " +
				"blast center + 1 bystander at the fringe). Mutually exclusive with the flat `at`/`count`/" +
				"`resources`/`tags` — set ONE shape or the other, never both.",
		}),
	),
	description: Type.Optional(
		Type.String({
			description:
				"Sets EVERY placed entity's own `description` column (across every placement) — e.g. 'the guard " +
				"with the limp' (#1968 — a first-class, never load-bearing authoring field, not a " +
				"metadata_attachments row).",
		}),
	),
	key_prefix: Type.Optional(
		Type.String({
			description:
				"FLAT shape only (mutually exclusive with `placements` — set `placements[].key_prefix` there " +
				"instead). #1968 workspace idempotency: see `placements[].key_prefix`'s description for the full " +
				"semantics — this is the same field, for the single-location flat shape. Mutually exclusive with " +
				"`entity_key`.",
		}),
	),
	entity_key: Type.Optional(
		Type.String({
			description:
				"FLAT shape only (mutually exclusive with `placements` — set `placements[].entity_key` there " +
				"instead). sk-9ll.6: see `placements[].entity_key`'s description for the full semantics — this is " +
				"the same field, for the single-location flat shape.",
		}),
	),
	name: Type.Optional(
		Type.String({
			description:
				"sk-ntz.1: FLAT shape (also `placements[].name`, which wins when both are set): sets EVERY placed " +
				"entity's own `entities.name`/`actors.name` verbatim (no ordinal suffix), instead of the default " +
				"title-cased `kind`/`entity_def` naming. A first-class, never load-bearing authoring field, mirrors " +
				"`description`'s own shared-across-every-placement convention. Mutually exclusive with `name_prefix`. " +
				"Omit for the existing default — unchanged.",
		}),
	),
	name_prefix: Type.Optional(
		Type.String({
			description:
				"sk-jay0.7.15.3: FLAT shape (also `placements[].name_prefix`, which wins when both are set): replaces " +
				"only the title-cased `kind`/`entity_def` half of the derived name and KEEPS the ordinal " +
				"(`'<name_prefix> <n>'`) across every placed instance. The group-placement counterpart to verbatim " +
				"`name`. Mutually exclusive with `name`. Illegal with `entity_key`. Omit for the existing default — " +
				"unchanged.",
		}),
	),
	quantity: Type.Optional(
		Type.Integer({
			minimum: 1,
			description:
				"sk-ntz.1: FLAT shape (also `placements[].quantity`, which wins when both are set): sets EVERY placed " +
				"entity's own `entities.quantity` (stack size) — spellkave_place_entity ONLY; spellkave_place_actor " +
				"rejects a set `quantity` (actors carry no stack — use spellkave_place_entity for a stackable item " +
				"instance instead). Omit for the schema default (1) — unchanged.",
		}),
	),
});

export const LINK_PLACES_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on generated edges. Omit to fall back to `context.defaultBundle`.",
		}),
	),
	from: Type.String({
		description: "Fully-qualified place_node id (must already exist in workspace/target).",
	}),
	to: Type.String({
		description: "Fully-qualified place_node id (must already exist in workspace/target).",
	}),
	bidirectional: Type.Optional(
		Type.Boolean({
			description: "Author reverse edge too (default true).",
		}),
	),
	substrate_crossing: Type.Optional(
		Type.Boolean({
			description:
				"Force substrate_crossing. Omit to auto: true when the two nodes' substrates differ, " +
				"or when they belong to different place_graphs (cross-graph portal).",
		}),
	),
	portal: Type.Optional(
		Type.Boolean({
			description:
				"Attach a place_edge_affordance on each edge (default FALSE, ADR-0101 — ordinary " +
				"edges inherit the bundle/graph movement_default instead, no per-edge row needed). " +
				"Pass true only to attach a special affordance right at creation time; template " +
				"defaults to core/affordance/traverse_open_portal unless affordance_template_id is set.",
		}),
	),
	affordance_template_id: Type.Optional(
		Type.String({
			description:
				"place_edge_affordance.affordance_template_id when portal is true (portal defaults " +
				'to false — see that field). Default "core/affordance/traverse_open_portal" when ' +
				'portal is true and this is omitted. Self-sufficient packs pass e.g. "srd/affordance/step".',
		}),
	),
	bindings_json: Type.Optional(
		Type.String({
			description:
				'place_edge_affordance.bindings_json when portal is true (default ""). ' +
				'e.g. \'{"movement_reach_resource":"srd/speed-walk","long_running_move_session":"srd/long_running_move"}\' for srd Step.',
		}),
	),
	/** E-prep: stamp metadata door=true on edges (no lock mechanics yet). */
	door: Type.Optional(
		Type.Boolean({
			description:
				"If true, attach metadata namespace place.door on each edge_key (inert; locks later).",
		}),
	),
	description: Type.Optional(Type.String({ description: "Optional edge description." })),
	cell_anchor: Type.Optional(
		Type.String({
			description:
				"H3 res10 cell anchor as decimal u64 string for substrate_crossing edges (MF-VAL-102). " +
				"Omit to use dummy 1 (legacy); outdoor portals should pass a real cell.",
		}),
	),
});

export const BIND_EDGE_AFFORDANCE_PARAMS = Type.Object({
	from: Type.String({
		description:
			"place_edges.from_node_id of an edge that ALREADY exists (workspace, live, or the active " +
			"target) — this call never creates one. Author it first via spellkave_link_places / " +
			"spellkave_author_place.",
	}),
	to: Type.String({
		description: "place_edges.to_node_id of the same already-existing edge.",
	}),
	affordance_template_id: Type.String({
		description:
			"place_edge_affordance.affordance_template_id — must already resolve to an authored " +
			"affordance_templates row (workspace, live, or the active target); this call does not " +
			"auto-create it.",
	}),
	bindings_json: Type.Optional(
		Type.String({
			description:
				'place_edge_affordance.bindings_json (default ""). e.g. \'{"movement_reach_resource":' +
				'"srd/speed-walk"}\' for srd Step.',
		}),
	),
	mode_id: Type.Optional(
		Type.String({
			description:
				'place_edge_affordance.mode_id (ADR-0101 D-1, default "" — the implicit default mode). ' +
				'An open author-chosen id (e.g. "fly", "swim") — rows sharing one (edge_key, mode_id) ' +
				"AND-join (all must pass); distinct mode_ids on the SAME edge OR (the cheapest passing " +
				"mode charges and supplies the long-running-move session). Upserts by " +
				"(edge_key, affordance_template_id, mode_id) — the SAME template under two different " +
				"mode_ids on one edge is a sibling row, not a replace.",
		}),
	),
	bidirectional: Type.Optional(
		Type.Boolean({
			description:
				"Attach to both from->to and to->from edges (default true) — mirrors spellkave_link_places' " +
				"own default. Both edges must already exist when true. Pass false to bind only the from->to " +
				"direction.",
		}),
	),
	inherit_movement_default: Type.Optional(
		Type.Boolean({
			description:
				"place_edges.inherit_movement_default (ADR-0101 D-1, schema default true) — REPLACES " +
				"the flag on every already-existing edge this call targets (from->to, and to->from too " +
				"when bidirectional). false means the edge owns its FULL mode set from its own " +
				"place_edge_affordance rows alone (the fly-only-chasm idiom); true (or omitting this " +
				"param) leaves/restores the resolved bundle/graph movement_default in play. Requires the " +
				"edge to already be an authored [[place_edges]] row IN THIS WORKSPACE (not just live/" +
				"target) — this is a whole-row re-author under the hood, so it needs the edge's other " +
				"columns already in hand to avoid silently dropping them.",
		}),
	),
});

export const SET_MOVEMENT_DEFAULT_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"movement_defaults.bundle_id. Omit to fall back to `context.defaultBundle`. ALWAYS the " +
				"scope owner, even when place_graph_id narrows the row to one graph.",
		}),
	),
	place_graph_id: Type.Optional(
		Type.String({
			description:
				'movement_defaults.place_graph_id (default "" — bundle scope, applies to every edge in ' +
				"the bundle with no closer graph default). Set to scope this default to ONE place_graph " +
				"instead (must already exist in workspace/live/target) — a graph-scoped default beats a " +
				"bundle-scoped one for edges in that graph (D-2: edge > graph > bundle).",
		}),
	),
	mode_id: Type.Optional(
		Type.String({
			description:
				'movement_defaults.mode_id (default "" — the implicit default mode, same open ' +
				'author-chosen vocabulary as spellkave_bind_edge_affordance\'s mode_id, e.g. "fly"). ' +
				"Rows sharing one (scope, mode_id) AND-join; a distinct mode_id under the same scope is " +
				"an alternative the kernel OR-picks the cheapest passing one from.",
		}),
	),
	affordance_template_id: Type.String({
		description:
			"movement_defaults.affordance_template_id — must already resolve to an authored " +
			"affordance_templates row (workspace, live, or the active target); this call does not " +
			"auto-create it.",
	}),
	bindings_json: Type.Optional(
		Type.String({
			description:
				'movement_defaults.bindings_json (default ""). e.g. \'{"movement_reach_resource":' +
				'"srd/speed-walk","long_running_move_session":"srd/long_running_move"}\' for srd Step.',
		}),
	),
});

export const ATTACH_MAP_LAYER_PARAMS = Type.Object({
	bundle: Type.Optional(Type.String()),
	place_graph_id: Type.String({
		description: "place_graph this backdrop belongs to.",
	}),
	asset_path: Type.String({
		description: 'Relative path under the asset module, e.g. "maps/hamlet.jpg".',
	}),
	asset_module: Type.String({
		minLength: 1,
		description:
			"Asset module id: the folder that holds the image. Resolves " +
			"SPELLKAVE_MAP_ASSETS_ROOT/<module> and FVTT_DATA_ROOT/<module>. No default.",
	}),
	display_name: Type.Optional(Type.String()),
	map_layer_id: Type.Optional(
		Type.String({ description: "Defaults to <place_graph_id>/backdrop." }),
	),
	posture: Type.String({
		minLength: 1,
		description:
			'License posture stamp of the image, e.g. "cc-by-4.0" or "proprietary". No default.',
	}),
	source_kind: Type.String({
		minLength: 1,
		description:
			'Where the image comes from, e.g. "first-party" or a named map source. No default.',
	}),
	grid_size_px: Type.Optional(Type.Number()),
	grid_distance_m: Type.Optional(Type.Number()),
	image_width_px: Type.Optional(Type.Number()),
	image_height_px: Type.Optional(Type.Number()),
	local_width_cells: Type.Optional(Type.Number()),
	local_height_cells: Type.Optional(Type.Number()),
	image_origin_x: Type.Optional(Type.Number()),
	image_origin_y: Type.Optional(Type.Number()),
	rotation_deg: Type.Optional(Type.Number()),
	state: Type.Optional(
		Type.String({
			description: 'aligned | provisional | unmatched | template (default "template").',
		}),
	),
	/** Provenance metadata on the place_graph (default true). */
	provenance: Type.Optional(Type.Boolean()),
	map_id: Type.Optional(Type.String({ description: "Catalog map id for provenance payload." })),
	license_url: Type.Optional(
		Type.String({ description: "License text URL for the provenance payload. No default." }),
	),
	source_url: Type.Optional(
		Type.String({ description: "Source page URL for the provenance payload. No default." }),
	),
});

export const ANNOTATE_PLACE_PARAMS = Type.Object({
	bundle: Type.Optional(Type.String()),
	target_kind: Type.Union(
		[Type.Literal("place_graph"), Type.Literal("place_node"), Type.Literal("place_edge")],
		{ description: "What the annotation attaches to." },
	),
	target_ref: Type.String({ description: "place_graph_id / node_id / edge_key." }),
	/** terrain.hint payload — free tags for later niche wiring. */
	terrain: Type.Optional(
		Type.Array(Type.String(), {
			description: 'Tags e.g. ["road","difficult","hazard_slime"] → namespace terrain.hint',
		}),
	),
	/** Optional free JSON object merged into payload (advanced). */
	payload: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
	namespace: Type.Optional(
		Type.String({
			description: 'Override namespace (default terrain.hint when terrain set, else "place.note").',
		}),
	),
	/** E-prep: set origin_cell_res10 on a place_graph (safe integer demo H3). */
	h3_origin_res10: Type.Optional(
		Type.Number({
			description:
				"When target_kind=place_graph, stamp origin_cell_res10 (and anchor node cell_res10 if anchor known). " +
				"Must be within Number.MAX_SAFE_INTEGER. Real H3 encoding later.",
		}),
	),
});

export const BIND_ACTOR_CAPABILITY_PARAMS = Type.Object({
	capability_id: Type.String({
		description:
			"actor_capabilities.capability_id — must already resolve to an authored capability_definitions " +
			"row (workspace, live, or the active target); this call does not auto-create it. " +
			"Privileged frontier.* ids use spellkave_grant_role with an explicit role and extent.",
	}),
	source: Type.Optional(
		Type.String({
			description:
				"actor_capabilities.source. Omit for the schema default 'manifest' (mirrors `add-capability-grant`'s " +
				"own default). This is grant provenance, not authority over a role or extent.",
		}),
	),
	visibility: Type.Optional(
		Type.String({
			description: "actor_capabilities.visibility (ADR-0120 read-visibility override).",
		}),
	),
	extent_ref: Type.Optional(
		Type.String({ description: "actor_capabilities.extent_ref (ADR-0007 D-4 see-as scope)." }),
	),
	extent_kind_ref: Type.Optional(
		Type.String({ description: "actor_capabilities.extent_kind_ref." }),
	),
});

export const BIND_ACTOR_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	entity_key: Type.String({
		description:
			"entity_key of an already-placed actor (e.g. via spellkave_place_actor) — must already carry an " +
			"actor_spatial_locations row (workspace, live, or the active target); this call does not place one.",
	}),
	identity: Type.Optional(
		Type.String({
			description:
				"actor_identities.identity. Default '$sender' resolves to whoever submits the applying delta. Pass " +
				"a concrete identity hex string only when binding to a KNOWN, fixed identity instead.",
		}),
	),
	role: Type.Optional(
		Type.String({
			description:
				"actor_identities.role. Default 'primary' (the corpus-dominant value; 'dm' is the one observed override). NOT a cosmetic label: r_claim_actor refuses every value but 'primary', so authoring 'dm' deliberately makes the seat un-self-claimable — right for a human DM anchor handed over by the operator, wrong for a programmatic seat that wants the self-claim path. It never affects visibility or write authority, which come from the capability grant alone.",
		}),
	),
	capabilities: Type.Optional(
		Type.Array(BIND_ACTOR_CAPABILITY_PARAMS, {
			description:
				"actor_capabilities grants issued to the SAME entity_key, alongside the identity bind. Default " +
				"`[]` (identity-only bind — no grant). Ordinary capability rows are supported; " +
				"frontier.* capability requests are refused with a pointer to spellkave_grant_role.",
		}),
	),
});

export const TAG_ENTITY_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated entity_tag row. Omit to fall back to " +
				"`context.defaultBundle` (#1968 smart default). NOTE: this is the bundle OWNING the new tag " +
				"row(s), not necessarily the bundle that placed `entity_key` — a cross-bundle caller stamps ITS " +
				"own bundle_id here (the kavemouth idiom this verb replaces: crypt-fight.ts/dm-npc.ts tag " +
				"the hero placed in hero.ts, all three sharing one bundle in that fixture, but nothing requires it).",
		}),
	),
	entity_key: Type.String({
		description:
			"entity_key of an already-placed entity (e.g. via spellkave_place_entity/spellkave_place_actor, in " +
			"THIS bundle or another) — must already carry an entities row (workspace or the active target); " +
			"this call does not place one. Use this verb instead of re-invoking the placement tool when the " +
			"entity's placement call lives in a DIFFERENT file/call than the one adding this tag.",
	}),
	tags: Type.Array(Type.String(), {
		minItems: 1,
		description:
			"One INSTANCE-level entity_tag row per tag, mirroring spellkave_place_entity/spellkave_place_actor's " +
			"own `tags` param exactly (same row shape, same MF-VAL-300 grammar, same tag_capability_grant " +
			"diagnostic) — the difference is WHEN: this verb runs AFTER the entity already exists, against an " +
			"entity_key placed by a DIFFERENT call/file.",
	}),
	mode: Type.Optional(
		Type.Union([Type.Literal("add"), Type.Literal("replace")], {
			description:
				"Default 'add': upsert the listed tags, leaving every OTHER tag already on this entity_key " +
				"untouched (idempotent — re-listing an already-present tag is a no-op) — the safe default for a " +
				"cross-file caller that does not own the entity's full tag set (this verb's whole reason to exist: " +
				"REPLACING would clobber tags the entity's OWN placement call already authored elsewhere). Set " +
				"'replace' only when THIS call owns the entity's complete tag set: it clears EVERY existing " +
				"entity_tag row for `entity_key` first, then reseeds exactly `tags` (a re-run with fewer tags drops " +
				"the stale ones, mirroring spellkave_place_entity/spellkave_place_actor's own clear-and-reseed).",
		}),
	),
});

export const EQUIP_ITEM_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on the generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	actor_entity_key: Type.String({
		description:
			"actor_equipment_slots.actor_entity_key — must already carry an actor_spatial_locations row " +
			"(workspace, live, or the active target); place it first via spellkave_place_actor.",
	}),
	item_entity_key: Type.String({
		description:
			"actor_equipment_slots.item_key — an already-authored entities row that entity_containment " +
			"already places inside actor_entity_key (stow it first via spellkave_stow_item).",
	}),
	slot_id: Type.String({
		description:
			"actor_equipment_slots.slot_id — must already resolve to an authored equipment_slot_definitions row.",
	}),
});

export const STOW_ITEM_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on the generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	actor_entity_key: Type.Optional(
		Type.String({
			description:
				"The actor stowing item_entity_key — must already carry an actor_spatial_locations row (workspace, " +
				"live, or the active target); place it first via spellkave_place_actor. Also the DEFAULT container " +
				"when container_entity_key is omitted. Omit it to put an item into a placed container with no " +
				"actor involved (a potion in a chest): then container_entity_key is required.",
		}),
	),
	item_entity_key: Type.String({
		description:
			"entity_containment.entity_key — an already-placed entity (workspace or the active target) to move " +
			"into container_entity_key (or actor_entity_key when container_entity_key is omitted).",
	}),
	container_entity_key: Type.Optional(
		Type.String({
			description:
				"entity_containment.container_entity_key. Default actor_entity_key — the common 'give the actor this " +
				"item directly' case (a starter weapon straight into the hero's inventory). Pass a DIFFERENT " +
				"already-placed container (e.g. a field kit already stowed on the actor) to nest item_entity_key " +
				"inside IT instead (the torch-inside-the-field-kit idiom).",
		}),
	),
	slot_id: Type.Optional(
		Type.String({
			description:
				"entity_containment.slot_id — machine-port slot id. Default '' (loose carriage — the common " +
				"item-in-backpack/actor-holding-item case, not a machine port).",
		}),
	),
	direction: Type.Optional(
		Type.String({
			description:
				"entity_containment.direction — machine-port direction ('in'/'out'). Default '' (loose carriage).",
		}),
	),
});

export const DEFINE_RESOURCE_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on the generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local resource stem; the full resource_definition_id is '<bundle>/<id>' (e.g. bundle='aoe_blast', " +
			"id='hp' -> 'aoe_blast/hp').",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"resource_definitions.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	min_value: Type.Number({ description: "resource_definitions.min_value." }),
	max_value: Type.Number({ description: "resource_definitions.max_value." }),
	initial_value: Type.Optional(
		Type.Number({
			description:
				"resource_definitions.initial_value — the object_state seed for an un-instantiated pool. Omit " +
				"to fall back to min_value at runtime (a charges/gold-shaped pool); set e.g. to max_value for an " +
				"HP-shaped pool that must start full.",
		}),
	),
	recovery_rule: Type.Optional(
		Type.Union(
			[
				Type.Literal("none"),
				Type.Literal("persistent"),
				Type.Literal("long_rest"),
				Type.Literal("short_rest_partial_long_rest_full"),
			],
			{
				description:
					"resource_definitions.recovery_rule (default 'none'). Closed PoC enum over the corpus's own " +
					"observed vocabulary — the field itself is open-string at the schema level (ADR-0018).",
			},
		),
	),
	value_kind: Type.Optional(
		Type.String({
			description:
				"resource_definitions.value_kind (default 'int' — the only value observed corpus-wide).",
		}),
	),
	description: Type.Optional(
		Type.String({
			description:
				"Sets the generated resource_definitions row's own `description` column (#1968).",
		}),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"One resource_definition_tag row per tag (#1968 verb-UX round 2 — mirrors " +
				"spellkave_define_entity_type/_condition/_niche's own `tags` fold instead of a separate " +
				"spellkave_write_rows call).",
		}),
	),
});

export const COST_PARAMS = Type.Object({
	pool: Type.String({
		description: "resource_definition_id debited on cast (e.g. a spell-slot pool).",
	}),
	amount: Type.Number({ description: "How much to debit per cast." }),
});

export const SHAPE_PARAMS = Type.Object({
	id: Type.Union([Type.Literal("core/area/node_ball"), Type.Literal("core/area/sphere")], {
		description:
			"Closed PoC enum: 'core/area/node_ball' (topological — radius = ball_radius graph-edge hops, 0 = same " +
			"node) or 'core/area/sphere' (metric — radius = radius_m). Other area shapes need direct authoring.",
	}),
	radius: Type.Number({
		description: "node_ball: integer edge-hop radius. sphere: metric radius_m.",
	}),
});

export const WRITE_PARAMS = Type.Object({
	// This union deliberately spans two tiers: kernel write primitives
	// (ModifyResource/Spawn/Inscribe/ApplyStatus/RemoveCondition map onto
	// existing K-5-gated FrameWriteOp/EffectPrimitive arms) AND multi-row
	// content presets (EnvState/OutcomeGraph/ScheduledZone decompose via
	// compose.ts into those same primitives). None of these literals is a
	// kernel arm itself — the manifest columns stay open-string (ADR-0018).
	primitive: Type.Union(
		[
			Type.Literal("ModifyResource"),
			Type.Literal("Spawn"),
			Type.Literal("Inscribe"),
			Type.Literal("ApplyStatus"),
			Type.Literal("RemoveCondition"),
			Type.Literal("EnvState"),
			Type.Literal("OutcomeGraph"),
			Type.Literal("ScheduledZone"),
			Type.Literal("Clock"),
		],
		{
			description:
				"Closed PoC enum — the REAL kernel primitive names (#1968 US9/srd-migration round, never invented; " +
				"verified against world-fixtures/srd/base/summon.toml + world-fixtures/core/base/affordances.toml + " +
				"world-fixtures/srd/base/hold-monster.toml + world-fixtures/srd/base/lesser-restoration.toml + " +
				"world-fixtures/srd/base/darkness.toml + world-fixtures/srd/base/acid-arrow.toml + " +
				"world-fixtures/srd/base/moonbeam.toml + world-fixtures/srd/base/death-saves.toml): " +
				"'ModifyResource' (a resource/state delta — the original fireball-wired primitive), 'Spawn' (Brief " +
				"26 EffectPrimitive::Spawn — instantiate an entity_def at the actor's own node, the find_familiar " +
				"shape; requires `offered_when.target`), 'Inscribe' (the raw FrameWriteOp::Inscribe trace idiom " +
				"core/mark/core/pickup/core/drop use — a durable typed footprint, NO ModifyResource delta and NO " +
				"companion definition row; requires `offered_when.target`), 'ApplyStatus' (lands a condition on the " +
				"single TargetActor — the B9 Hold-Person/Hold-Monster/Bless-family shape; single-target only, no " +
				"`offered_when.target`), 'RemoveCondition' (the INVERSE — deletes a matching target_condition row, " +
				"the Lesser-Restoration cleanse shape; single-target only, no `offered_when.target`), 'EnvState' " +
				"(#1968 verb-UX round 4 — the Darkness/Silence/Fog AMBIENT-EFFECT shape, compose.ts's 'env-state': " +
				"the cast's ONLY write is an Inscribe{kind:'spatial_environment_state'} bool marker on the caster's " +
				"cell (or the target cell — see `env_state_center`); this call auto-creates the backing " +
				"spatial_state_definitions row, mirroring `cost.pool`'s auto-create; a SEPARATELY-authored consumer " +
				"affordance reads target.state(env_state_id); single-target only, no `offered_when.target`), " +
				"'OutcomeGraph' (#1968 verb-UX round 4 — the branch-on-outcome shape, compose.ts's 'outcome-graph': " +
				"the action's outcome invokes a graph whose `branches` (see that field) each carry their OWN " +
				"ModifyResource(TargetActor, srd/hp, ...) consequence, selected by the first true edge guard in " +
				"array order — unlike a gated single-target write, EVERY branch can apply an effect (a Melf's Acid " +
				"Arrow miss still deals half damage); single-target only, no `offered_when.target`), 'ScheduledZone' " +
				"(#1968 verb-UX round 5 — the TRUE LINGERING hazard shape, compose.ts's 'scheduled-zone' (ADR-0054): " +
				"the cast's ONLY direct write is the SAME Inscribe{kind:'spatial_environment_state'} marker EnvState " +
				"uses (auto-creates the backing spatial_state_definitions row, `zone_state_id`/`zone_intensity`/ " +
				"`zone_visibility`/`zone_center` — see those fields); it ALSO schedules a subject-bound " +
				"ScheduleAutonomyJob (`schedule` — repeats/frequency/liveness/source) that re-fires a SEPARATE, " +
				"self-contained pulse consequence each round — a node-local ForEachActorInRadius (fixed radius, " +
				"ball_radius 0) wrapping `effect.write.pulse`, which REUSES this same closed enum's two " +
				"autonomy-clock-eligible bodies ('ModifyResource' damage/heal via `pulse.delta`, or 'ApplyStatus' " +
				"condition via `pulse.condition`) rather than inventing a third write vocabulary; " +
				"`effect.per_target_gate` (if set) gates the PULSE body per occupant (the save-negate seam — Stinking " +
				"Cloud), not the affordance; single-target-only, no `offered_when.target`), 'Clock' (#1968 finding C2 " +
				"— the SELF-TARGETED multi-ordinal clock shape, compose.ts's 'clock' (the death-saves death-and-dying " +
				"pattern): unlike every OTHER primitive above (each writes a TargetActor or a radius-selected OTHER " +
				"actor), a clock's every write targets the ACTING subject alone. `tallies` (see that field) — N bare " +
				"ModifyResource(actor='Actor', ...) ordinals, authored first, array order = ordinal order — followed " +
				"by `thresholds` (see that field) — M ForEachActorInRadius(node_ball, ball_radius 0) ordinals wrapping " +
				"an ApplyStatus/RemoveCondition on 'Actor', reading the tallies' just-written state; requires " +
				"`offered_when.target: 'self'` (a clock is inherently self-only — there is no 'hit others' reading of " +
				"it) and needs no separate `cost` (the tallies themselves satisfy MF-VAL-263's on_success ModifyResource " +
				"requirement); single-target-topology-only, no `effect.shape`/`effect.per_target_gate` (each threshold " +
				"carries its OWN `when` instead of one shared per-target gate — `effect.per_target_gate`, if set, " +
				"becomes the AFFORDANCE's own eligibility gate instead, e.g. \"actor.status('dying') == true && ...\", " +
				"the same seam single-target's attack-roll gate reuses)). " +
				"'Spawn'/'Inscribe' are NOT FrameWriteOp arms nestable inside a ForEachActorInRadius body — they " +
				"never combine with `effect.shape`/`effect.per_target_gate` (PoC boundary: only 'ModifyResource' " +
				"selects actors in a radius). 'ApplyStatus'/'RemoveCondition'/'EnvState'/'OutcomeGraph'/'ScheduledZone'/" +
				"'Clock' are single-target-only too (PoC boundary: no aoe condition/env-state/outcome-graph/scheduled-" +
				"zone-CAST/clock pulse is wired — the scheduled-zone shape's OWN pulse is always the fixed node_ball-0 " +
				"radius, never `effect.shape`) — they never combine with `effect.shape` either ('ScheduledZone' reuses " +
				"`effect.per_target_gate` for its pulse's per-occupant gate instead, 'Clock' reuses it for the " +
				"affordance's eligibility gate instead, see above).",
		},
	),
	// ModifyResource-only fields (aoe AND single-target — see effect.shape).
	resource: Type.Optional(
		Type.String({
			description:
				"ModifyResource only: must already resolve to an authored resource_definitions row (workspace, " +
				"live, or the active target) — this PoC does not auto-create write-target resources (only " +
				"`cost.pool` auto-creates, see the tool description). aoe (effect.shape set): the resource every " +
				"selected actor's body write targets. single-target (effect.shape omitted, #1968 verb-UX round 2): " +
				"the resource the ONE TargetActor write targets — defaults to 'srd/hp'-shaped combat use but any " +
				"already-authored resource/state works (e.g. a non-HP disposition state).",
		}),
	),
	delta: Type.Optional(
		Type.String({
			description:
				"ModifyResource only: authored Int DSL expression evaluated per target, e.g. '-d6'. aoe: applied " +
				"to every selected actor. single-target: applied once, to the ONE TargetActor. Ignored (may be " +
				"omitted) when `attacks` is set.",
		}),
	),
	// MULTIATTACK (#1968 verb-UX round 3): ModifyResource + single-target ONLY (effect.shape
	// omitted) — N independent self-gating TargetActor writes in ONE action/consequence (a
	// monster's Multiattack, e.g. Polar Bear's two Rends; mirrors compose.ts's
	// `ActorBehavior.attacks` verbatim, the SAME builder every other define_behavior branch
	// already drives). Each entry's `delta` folds its OWN attack roll into the expression
	// (e.g. `cond(d20 >= 11, 0 - (1d8 + 5), 0)`), so a per-attack miss zeroes only THAT
	// attack — not the whole action. The server threads one reducer rng across the sibling
	// frame_writes (ADR-0045 COND-3 postscript), so N identical attacks still roll
	// INDEPENDENTLY. When set: `resource`/`delta` (the single top-level fields above) are
	// IGNORED — every attack write always targets `srd/hp`-shaped `resource` implicitly
	// (mirrors compose.ts's attacks-branch hardcode, `"srd/hp"`, byte-for-byte — there is no
	// per-attack resource override in this PoC). The affordance carries NO gate (each
	// sub-attack self-gates in its own frame_write) — `effect.per_target_gate` MUST be
	// omitted, and `effect.shape` (aoe) is unsupported (PoC boundary: Multiattack is
	// single-target only, like ApplyStatus/RemoveCondition above).
	attacks: Type.Optional(
		Type.Array(
			Type.Object({
				delta: Type.String({
					description:
						"This sub-attack's authored Int DSL expression, self-gating its OWN attack roll (e.g. " +
						"'cond(d20 >= 11, 0 - (1d8 + 5), 0)') — a miss on THIS roll must resolve to 0, not skip " +
						"the whole action (unlike the single-attack affordance-gated shape).",
				}),
				label: Type.Optional(
					Type.String({ description: "Human tag for this sub-attack (e.g. 'Rend'), report-only." }),
				),
			}),
			{
				description:
					"One entry per sub-attack (2+ for an SRD Multiattack, but generalises to any N) — see this " +
					"field's own top-level description for the full shape.",
			},
		),
	),
	// Spawn-only field.
	entity_def: Type.Optional(
		Type.String({
			description:
				"Spawn only: the entity_definitions catalog id to instantiate at the actor's own node (e.g. " +
				"'srd/monster/cat', mirroring srd/cast_find_familiar) — must already resolve (workspace or live); " +
				"this PoC does not auto-create the blueprint.",
		}),
	),
	// Inscribe-only fields (mirrors core/mark's frame_write.Inscribe: kind + payload_json).
	trace_kind: Type.Optional(
		Type.String({
			description:
				"Inscribe only: the trace's `kind` discriminant (e.g. 'puddle_mark') — an arbitrary authored " +
				"string; unlike `resource`, this is NEVER ref-checked against a definitions row (core/mark's own " +
				"'scrape_marks' has none either — FrameWriteOp::Inscribe's own doc: 'a durable typed footprint " +
				"without a resource delta').",
		}),
	),
	content: Type.Optional(
		Type.String({
			description:
				"Inscribe only: the trace's `payload_json` content — a JSON-encodable string describing the mark " +
				'(e.g. \'{"action":"relieve"}\').',
		}),
	),
	// ApplyStatus/RemoveCondition-only field (#1968 srd-migration round).
	condition: Type.Optional(
		Type.String({
			description:
				"ApplyStatus/RemoveCondition only: the condition_definitions condition_definition_id landed on " +
				"(ApplyStatus) or deleted from (RemoveCondition) the single TargetActor — must already resolve " +
				"(workspace, live, or the active target); this PoC does not auto-create the condition (use " +
				"spellkave_define_condition first).",
		}),
	),
	// RemoveCondition-only field.
	remove_source: Type.Optional(
		Type.String({
			description:
				"RemoveCondition only: an exact source key to match (FrameWriteOp::RemoveCondition's " +
				"`source_match: Exact`). Omit for the default 'Any' — source-agnostic removal (matches ANY " +
				"target_condition row for `condition`, regardless of what applied it).",
		}),
	),
	// EnvState-only fields (#1968 verb-UX round 4 — compose.ts's "env-state" shape).
	env_state_id: Type.Optional(
		Type.String({
			description:
				"EnvState only: the spatial_state_definitions id this write flips (e.g. 'srd/darkness') — auto-" +
				"created by this call as a BOOL state def with writer_policy 'world_interaction' (so the apply " +
				"path may write it at cast time) and a long freshness, mirroring `cost.pool`'s auto-create; this " +
				"PoC never requires it pre-authored. A separately-authored consumer affordance reads " +
				"target.state(env_state_id) — this call does not author the consumer.",
		}),
	),
	env_state_value: Type.Optional(
		Type.Boolean({
			description: "EnvState only: the bool value the marker Inscribe writes. Default true ('on').",
		}),
	),
	env_state_center: Type.Optional(
		Type.Union([Type.Literal("actor"), Type.Literal("target")], {
			description:
				"EnvState only: 'actor' (default) writes the CASTER'S OWN cell (ActorSpatialRef — follows the " +
				"caster, a Darkness-shaped ambient cast). 'target' anchors on the cast's TARGET cell " +
				"(TargetSpatialRef) instead.",
		}),
	),
	// OutcomeGraph-only field (#1968 verb-UX round 4 — compose.ts's "outcome-graph" shape).
	branches: Type.Optional(
		Type.Array(
			Type.Object({
				node: Type.String({
					description:
						"This branch's outcome_graph node id (e.g. 'hit'/'miss'; also the outcome/consequence id stem).",
				}),
				guard: Type.String({
					description:
						"This branch's edge guard predicate, evaluated root→node in array order — the FIRST true " +
						"guard wins (e.g. 'd20 >= 13'); the LAST branch should carry a '1 == 1' fallthrough so some " +
						"branch always selects.",
				}),
				delta: Type.String({
					description:
						"This branch's authored Int DSL expression — the ModifyResource delta its terminal node's " +
						"consequence applies when selected (e.g. '0 - 4d4'), written against `subject`'s `resource`.",
				}),
				label: Type.Optional(
					Type.String({ description: "Human tag for this branch, report-only." }),
				),
				subject: Type.Optional(
					Type.String({
						description:
							"This branch's own write subject — a kernel symbolic actor ref: 'TargetActor' (default, " +
							"the damage-against-target shape every prior branch authored) or 'Actor' (the CASTER, e.g. " +
							"a defeat-consequence XP credit back to the attacker — playable-fighter-l1-20 D-1). " +
							"Omit to keep today's byte-identical shape.",
					}),
				),
				resource: Type.Optional(
					Type.String({
						description:
							"This branch's own write resource — must already resolve to an authored resource_definitions " +
							"row, same rule as the top-level `resource` field. Defaults to 'srd/hp'. Omit to keep today's " +
							"byte-identical shape.",
					}),
				),
			}),
			{
				description:
					"OutcomeGraph only: one entry per branch arm (2+ — see this field's own top-level description). " +
					"Required, and must be non-empty, when effect.write.primitive is 'OutcomeGraph'.",
			},
		),
	),
	// ScheduledZone-only fields (#1968 verb-UX round 5 — compose.ts's "scheduled-zone" shape,
	// ADR-0054). `zone_state_id`/`zone_intensity`/`zone_visibility`/`zone_center` drive the
	// SAME marker-Inscribe machinery as EnvState's `env_state_id`/`env_state_value`/
	// `env_state_center` (a second field set instead of reusing those verbatim only because
	// the marker VALUE differs in kind — an int intensity here, a bool here EnvState — everything
	// else about "which cell, what visibility" is the identical concept).
	zone_state_id: Type.Optional(
		Type.String({
			description:
				"ScheduledZone only: the spatial_state_definitions id the marker Inscribe (and every pulse) reads/" +
				"writes (e.g. 'srd/hazard/cloudkill') — auto-created by this call as an INT state def with " +
				"writer_policy 'world_interaction' and a long freshness, mirroring EnvState's `env_state_id` auto-" +
				"create (and `cost.pool`'s). Required when effect.write.primitive is 'ScheduledZone'.",
		}),
	),
	zone_intensity: Type.Optional(
		Type.Number({
			description:
				"ScheduledZone only: the documentary int value the marker Inscribe stamps (e.g. the spell's damage " +
				"magnitude — Cloudkill's 5d8 stamps 5). Default 0. Never read by the pulse itself (the pulse's own " +
				"damage/condition comes from `pulse.delta`/`pulse.condition`) — purely an observable marker value.",
		}),
	),
	zone_visibility: Type.Optional(
		Type.String({
			description: "ScheduledZone only: the marker Inscribe's visibility class. Default 'Public'.",
		}),
	),
	zone_center: Type.Optional(
		Type.Union([Type.Literal("actor"), Type.Literal("target")], {
			description:
				"ScheduledZone only: 'actor' (default) anchors the marker AND every pulse on the CASTER'S CURRENT " +
				"cell each fire (ActorSpatialRef — a mobile aura that follows the caster). 'target' anchors on the " +
				"cast's TARGET cell instead (TargetSpatialRef — the captured anchor_place_node_id stays FIXED even " +
				"if the caster moves; the faithful 'dropped at range' hazard every shipped scheduled-zone spell " +
				"today uses — Cloudkill/Moonbeam/Stinking Cloud/the scheduled-damage-zone batch). Mirrors EnvState's " +
				"`env_state_center` — same two-value anchor concept, kept as its own field because it is scoped to " +
				"a different write primitive.",
		}),
	),
	schedule: Type.Optional(
		Type.Object(
			{
				repeats: Type.Optional(
					Type.Number({
						description:
							"How many rounds the pulse re-fires — bounds the duration (a subject-bound actor-reaching " +
							"autonomy job MUST be bounded, server fence + MF-VAL-249). Default 10 (SRD's common " +
							"'concentration up to 1 minute' → 10 one-tick rounds).",
					}),
				),
				frequency_ms: Type.Optional(
					Type.Number({
						description:
							"Fiction-millisecond period between pulses. Default 6000 (fires every round).",
					}),
				),
				requires_subject_alive: Type.Optional(
					Type.Boolean({
						description:
							"Whether the zone dissipates if the caster's entity is removed. Default false (the zone " +
							"lingers its full duration regardless — the SRD Cloudkill/Moonbeam behaviour). Set true for " +
							"a concentration-style hazard that ends with its caster.",
					}),
				),
				source: Type.Optional(
					Type.String({
						description:
							"The cancel-by-source/provenance key stamped on the runtime autonomy_job — author with the " +
							"{Actor}/{ResponsibleSubject}/{tick} placeholders (ADR-0055 D-3), e.g. " +
							"'<bundle>/<id>/{Actor}/{tick}', so the scheduler interpolates a PER-CAST-UNIQUE job_id at " +
							"cast time (two concurrent casts never collide on the autonomy_job PK). Omit for the " +
							"compose.ts legacy default ('srd/<id>', UNqualified by `bundle` — pass this explicitly for " +
							"any non-'srd' bundle).",
					}),
				),
			},
			{
				description:
					"ScheduledZone only: the ADR-0054 autonomy-pulse cadence + provenance. Every field optional — " +
					"omit the whole object for compose.ts's defaults (repeats 10, frequency_ms 6000, " +
					"requires_subject_alive false, source 'srd/<id>').",
			},
		),
	),
	pulse: Type.Optional(
		Type.Object(
			{
				primitive: Type.Union([Type.Literal("ModifyResource"), Type.Literal("ApplyStatus")], {
					description:
						"The scheduled pulse's OWN per-round frame_write body (wrapped in a fixed node-local " +
						"ForEachActorInRadius, ball_radius 0, by clusterRows — never `effect.shape`) — REUSES this " +
						"tool's two autonomy-clock-eligible write shapes rather than a new vocabulary: 'ModifyResource' " +
						"(a damage/heal delta on 'srd/hp', the Cloudkill/Moonbeam/scheduled-damage-zone-batch shape) or " +
						"'ApplyStatus' (lands a condition on each occupant, the Stinking Cloud save-or-condition shape " +
						"— #958 admits ApplyStatus to the subject-bound autonomy fence).",
				}),
				delta: Type.Optional(
					Type.String({
						description:
							"pulse.primitive 'ModifyResource' only: the authored Int DSL expression applied to EVERY " +
							"occupant's srd/hp each pulse (e.g. 'cond(d20 >= 13, 0 - (5d8 / 2), 0 - 5d8)' for save-for-" +
							"half — fold the save into the delta the same way single-target/aoe do). Required when " +
							"pulse.primitive is 'ModifyResource'.",
					}),
				),
				condition: Type.Optional(
					Type.String({
						description:
							"pulse.primitive 'ApplyStatus' only: the condition_definitions id landed on every occupant " +
							"whose `effect.per_target_gate` passes (e.g. 'srd/poisoned') — must already resolve " +
							"(workspace, live, or the active target); this PoC does not auto-create it (use " +
							"spellkave_define_condition first). Required when pulse.primitive is 'ApplyStatus'.",
					}),
				),
			},
			{
				description:
					"ScheduledZone only: the pulse's own write. Required when effect.write.primitive is " +
					"'ScheduledZone' — a zone with no pulse body would schedule a job that fires nothing.",
			},
		),
	),
	// Clock-only fields (#1968 finding C2 — compose.ts's "clock" shape, the death-saves
	// death-and-dying pattern). Both are REQUIRED, non-empty, when effect.write.primitive
	// is 'Clock' — array order IS ordinal order (tallies first, thresholds after).
	tallies: Type.Optional(
		Type.Array(
			Type.Object({
				resource: Type.String({
					description:
						"Clock only: the resource_definitions id this tally ordinal's bare ModifyResource(actor='Actor', " +
						"...) reads/writes — must already resolve (workspace, live, or the active target); this PoC does " +
						"not auto-create tally resources (use spellkave_define_resource first, same posture as " +
						"effect.write.resource).",
				}),
				predicate: Type.Optional(
					Type.String({
						description:
							"Clock only: an authored Bool DSL expression — when set, this ordinal's delta_source becomes " +
							"'cond(<predicate>, <delta ?? \"1\">, 0)', the increment-on-condition idiom every tally-split " +
							"ordinal needs (e.g. \"actor.stat('death_save_last_roll') >= 10\" to tally a success). Omit " +
							"for a raw (non-conditional) `delta` expression instead — the scratch-cell-capture idiom a " +
							"clock's FIRST ordinal often needs (e.g. \"d20 - actor.stat('death_save_last_roll')\", a " +
							"set-via-delta that lands exactly on a fresh roll). Exactly one of `predicate`/`delta` must " +
							"convey the real expression: set `predicate` alone for a plain +1-on-condition tally, `delta` " +
							"alone for a raw capture, or both when the increment amount is not 1.",
					}),
				),
				delta: Type.Optional(
					Type.String({
						description:
							"Clock only: with `predicate` set, the increment amount (default '1') — the expression becomes " +
							"'cond(<predicate>, <delta>, 0)'. With `predicate` OMITTED, this is the WHOLE raw delta_source " +
							"expression verbatim (the scratch-cell-capture idiom — see `predicate`'s own doc). Required " +
							"when `predicate` is omitted.",
					}),
				),
			}),
			{
				description:
					"Clock only: one entry per self-targeted tally ordinal, authored FIRST (array order = ordinal " +
					"order, before every `thresholds` entry) — see this field's own top-level description. Required, " +
					"non-empty, when effect.write.primitive is 'Clock'.",
			},
		),
	),
	thresholds: Type.Optional(
		Type.Array(
			Type.Object({
				when: Type.String({
					description:
						"Clock only: this threshold ordinal's own ForEachActorInRadius(node_ball, ball_radius 0) " +
						"predicate_source, evaluated against the POST-tally state (this ordinal runs after every " +
						"`tallies` entry) — e.g. \"actor.stat('death_save_failures') >= 3\", or an OR-branched short-" +
						"circuit like a nat-20 immediate-stabilize check. A bare ApplyStatus/RemoveCondition carries no " +
						"delta/predicate of its own to fold a `cond(...)` into, so this wrapper's own predicate_source " +
						"is the only way to gate one — safe here specifically because every `tallies` ordinal already " +
						"wrote 'Actor' alone (never a co-located bystander).",
				}),
				apply_status: Type.Optional(
					Type.String({
						description:
							"Clock only: the condition_definitions id this threshold lands on 'Actor' when `when` is " +
							"true — must already resolve (workspace, live, or the active target); this PoC does not " +
							"auto-create it (use spellkave_define_condition first). Exactly one of `apply_status`/" +
							"`remove_condition` must be set per threshold entry.",
					}),
				),
				remove_condition: Type.Optional(
					Type.String({
						description:
							"Clock only: the condition_definitions id this threshold REMOVES from 'Actor' when `when` is " +
							"true (the inverse of `apply_status`) — must already resolve. Exactly one of `apply_status`/" +
							"`remove_condition` must be set per threshold entry.",
					}),
				),
				remove_condition_source: Type.Optional(
					Type.String({
						description:
							"Clock + `remove_condition` only: an exact source key to match (RemoveCondition's " +
							"`source_match: Exact`). Omit for the default 'Any' — source-agnostic removal.",
					}),
				),
			}),
			{
				description:
					"Clock only: one entry per self-targeted threshold ordinal, authored AFTER every `tallies` entry " +
					"(array order = ordinal order) — see this field's own top-level description. Required, non-empty, " +
					"when effect.write.primitive is 'Clock'.",
			},
		),
	),
});

export const EFFECT_PARAMS = Type.Object({
	primitive: Type.Union([Type.Literal("ForEachActorInRadius")], {
		description: "Closed PoC enum — only 'ForEachActorInRadius' is wired.",
	}),
	// ModifyResource, present: the AoE-over-actors shape (a ForEachActorInRadius body
	// selecting every actor in `shape`). ModifyResource, OMITTED (#1968 verb-UX round 2):
	// the single-target shape — one bare ModifyResource(TargetActor) write, no area-shape
	// geometry, no actor-radius selection; reuses @spellkave/world-author's `clusterRows`
	// "single-target" shape (the SAME builder `author-spell-behavior.ts`/`author-monster-
	// actions.ts` drive directly) — the majority of committed srd spells/monster actions
	// use exactly this bare shape. MUST be omitted for 'Spawn'/'Inscribe' (#1968 US9 —
	// neither is a FrameWriteOp arm, so neither ever selects actors in a radius or writes
	// a single TargetActor either). Enforced at runtime, not in the schema.
	shape: Type.Optional(SHAPE_PARAMS),
	per_target_gate: Type.Optional(
		Type.String({
			description:
				"Authored Bool DSL expression gating the write, e.g. 'd20 < 13' (a failed save) or 'd20 >= 13' (a " +
				"hit). Omit for an ungated write. aoe (effect.shape set): gates the body PER SELECTED ACTOR. " +
				"single-target (effect.shape omitted): gates the AFFORDANCE itself (a miss/failed-check skips the " +
				"whole consequence — the attack-roll seam). ModifyResource only — MUST be omitted for " +
				"'Spawn'/'Inscribe'.",
		}),
	),
	write: WRITE_PARAMS,
});

export const DEFINE_BEHAVIOR_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Behavior key stem — derives capability_id '<bundle>/spell/<id>' and action_id '<bundle>/cast_<id>' " +
			"(+ its outcome/affordance/consequence siblings), unless overridden by `capability_id`.",
	}),
	capability_id: Type.Optional(
		Type.String({
			description:
				"#1968 verb-UX round 2: override the derived '<bundle>/spell/<id>' capability_id — e.g. for a " +
				"CATALOG spell whose entity_definitions.entity_def_id already exists under a different id shape " +
				"(mirrors compose.ts's ActorBehavior.capabilityId — for a catalog spell this MUST equal the " +
				"catalog entity_def_id so the capability IS the catalog identity, #835). `action_id` is never " +
				"touched by this — only the capability's own id changes.",
		}),
	),
	action_prefix: Type.Optional(
		Type.String({
			description:
				"#1968 srd-migration round: override the derived action id's prefix — the full action id is " +
				"'<bundle>/<action_prefix><id>' (default 'cast_', e.g. id='fireball' -> " +
				"'<bundle>/cast_fireball'). Pass '' to derive a BARE '<bundle>/<id>' action id (e.g. the Hex/" +
				"Bless/Bardic-Inspiration condition-modified-roll family's WRITER/CONSUMER pair, whose action ids " +
				"are '<bundle>/<key>', not '<bundle>/cast_<key>') — mirrors compose.ts's " +
				"BehaviorConfig.actionPrefix verbatim; outcome/affordance/success ids all derive from the SAME " +
				"action id, so this affects all four.",
		}),
	),
	emit_capability: Type.Optional(
		Type.Boolean({
			description:
				"#1968 srd-migration round: whether this call authors a capability_definitions row for " +
				"`capability_id`/the derived id. Default true. Pass false when the capability ALREADY exists " +
				"(authored by ANOTHER call/fragment, e.g. a feat grant that already created it) and this call " +
				"should REUSE it — `required_capability`/`actor_capabilities`/the niche all still key on " +
				"`capability_id` (which then MUST be set — omitting it AND setting false derives an id no prior " +
				"call could have authored), but no duplicate capability_definitions row is emitted (mirrors " +
				"compose.ts's ActorBehavior.emitCapability, a required field there, made an optional smart default " +
				"here since every prior verb caller wanted true).",
		}),
	),
	display_name: Type.Optional(
		Type.String({
			description:
				"#1968 verb-UX round 2: overrides the derived 'Cast <TitleCase id>' display name stamped onto " +
				"every generated row that carries one (capability/action/affordance/outcome). Omit for the smart " +
				"default — naive per-word title-casing mangles a multi-word id containing a preposition (e.g. " +
				"'circle_of_death' -> 'Cast Circle Of Death' instead of 'Cast Circle of Death').",
		}),
	),
	description: Type.Optional(
		Type.String({
			description:
				"Sets the generated capability_definitions row's own `description` column (#1968) — the " +
				"capability is this behavior's natural authoring-identity anchor, so that is where the " +
				"description lands (NOT the affordance/action/outcome/consequence/resource rows this verb also " +
				"generates).",
		}),
	),
	observation: Type.Optional(
		Type.String({
			description:
				"#1968 B-9: authored PLAYER-facing prose for what a player perceives on a successful manipulate " +
				"or sensing outcome — distinct from `description` above, which stays operator-only on " +
				"capability_definitions. Sets the generated outcome_templates row's own `description` column (its " +
				"actual authoring/read home — see outcome_template.rs's doc comment for why that table, not " +
				"action_definitions/consequence_templates). May reference ONLY the frozen placeholders " +
				"`{target_name}`, `{actor_name}`, `{place_name}` (resolved from data the player already sees, " +
				"never a raw id) — a state-dereferencing value (HP, a resource, a condition) belongs in the DSL " +
				"outcome expression, not here, and an unknown placeholder or a description over 500 chars is " +
				"rejected at validation. Omit for the existing default: the tool result carries an honest " +
				"`observation: null` + `observation_gap`, byte-identical to today.",
		}),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"#1968 verb-UX round 2: the FULL capability_definition_tag AND action_definition_tag row set — " +
				"when set, REPLACES the single `action_class` tag as the authoritative list for BOTH satellites " +
				"(include `action_class`'s own value in `tags` too, if wanted — it is not auto-prepended). Omit " +
				"for the legacy default: `action_class` alone becomes the one action tag, no capability tags — " +
				"`action_class` itself is REQUIRED either way (no default of its own, #1968 finding A1): this " +
				"param only controls what ELSE joins it, never whether it is needed.",
		}),
	),
	communication_speech_act_id: Type.Optional(
		Type.String({
			description:
				"#1968 verb-UX round 4 (SPEECH-ACT lens, Searle) — when set, the generated action's outcome_" +
				"templates row carries this `communication_speech_act_id`, so the affordance SURFACES as a " +
				"communication speech act while r_manipulate still EXECUTES the gated consequence normally via " +
				"`manipulation_action_id` (mirrors compose.ts's ActorBehavior.communicationSpeechActId — the " +
				"Persuasion 'directive' worked example). Omit for the legacy default: no speech-act framing.",
		}),
	),
	grant_to: Type.Union([Type.String(), Type.Array(Type.String())], {
		description:
			"entity_key of the caster (already placed via spellkave_place_actor) granted the capability — or an " +
			"ARRAY of entity_keys to grant the SAME capability to several actors in one call (#1968 finding B4: " +
			"'author once, grant twice' — e.g. two mechanically-identical monsters sharing one scimitar). The " +
			"capability/action/affordance/outcome/consequence cluster is authored exactly ONCE regardless (keyed " +
			"off the FIRST entry, which also becomes `defaultCaster` for any `[[actors]]`/entities the shape " +
			"itself emits, e.g. Spawn's `def_instance`) — every entry gets its OWN `actor_capabilities` grant + " +
			"`spatial_niche_attachments` row (attached to ITS OWN node, resolved independently per entity_key, " +
			"exactly like the single-actor case). Each caster needs a nonblank place_node_id, resolved from " +
			"the workspace before the active target. If a live AUTHOR cannot read the caster's placement, " +
			"the call fails before writing scratch; supply its known current actor_spatial_locations workspace row. " +
			"#1968 workspace idempotency: re-authoring the SAME bundle+id " +
			"REPLACES the WHOLE grant set — an entity_key dropped from the array on a later call has its grant " +
			"and attachment rows cleared, not left behind (mirrors every other satellite this verb folds).",
	}),
	offered_when: Type.Object({
		reach: Type.Union([Type.Literal("same_node")], {
			description:
				"Closed PoC enum — only 'same_node' is wired (its own range_m default, see `range_m`).",
		}),
		// #1968 verb-UX round 3 — a melee/ranged attack (or any placement-range write,
		// ADR-0053) needs a NON-ZERO affordance `range_m` to reach an orthogonally-adjacent
		// grid cell (#1226 — range_m=0 means touch/same-node only, so a melee attacker on a
		// grid could never strike an enemy one square away). Overrides `reach: "same_node"`'s
		// own range_m=0 default (mirrors compose.ts's `ActorBehavior.rangeM`, author with the
		// `ft()` feet→metric helper — e.g. `ft(5)` for standard 5-ft melee reach — never a
		// raw metre literal). Omit for the unaffected legacy default (range_m=0, touch range).
		range_m: Type.Optional(
			Type.Number({
				description:
					"Affordance range_m (metres, ADR-0053 metric embedding) — author via the ft() feet→metric " +
					"helper (e.g. ft(5) for standard 5-ft melee reach), never a raw metre literal. Omit for the " +
					"default range_m=0 (touch/same-node only).",
			}),
		),
		target: Type.Optional(
			Type.Union([Type.Literal("self"), Type.Literal("place")], {
				description:
					"#1968 US9 — a target concept beyond 'ForEachActorInRadius hits others in a radius'. Omit for " +
					"the legacy default (`effect.write.primitive` must be 'ModifyResource', wrapped in " +
					"`effect.shape`'s ForEachActorInRadius — unaffected by this param). 'self': the acting actor " +
					"targets ITSELF (action_definitions.self_eligible=true, mirrors srd/cast_find_familiar's " +
					"self_eligible=true) — MF-VAL-263 then requires SOME ModifyResource in the on_success chain; " +
					"`effect.write.primitive: 'ModifyResource'` satisfies it on its own, but 'Spawn'/'Inscribe' " +
					"need an explicit `cost` (else this tool errors BEFORE validation with a hint). 'place': the " +
					"write lands at the actor's OWN place_node with NO target-actor selection and NO self-" +
					"targeting at all (self_eligible stays false — MF-VAL-263 never engages, so no `cost` pool is " +
					"required or accepted); only 'Spawn'/'Inscribe' support 'place' (no fixture idiom modifies a " +
					"resource with neither an actor nor a self target).",
			}),
		),
	}),
	action_class: Type.String({
		description:
			"action_definition_tag applied to the generated action (e.g. 'spell'). REQUIRED — has no default " +
			"(#1968 finding A1): omitting it throws a named-param error rather than silently authoring a " +
			"corrupt row. Overridden (not supplemented) by `tags` when that param is set.",
	}),
	cost: Type.Optional(COST_PARAMS),
	effect: EFFECT_PARAMS,
	// #1968 verb-UX round 3 — DEF-LEVEL capability binding (mirrors compose.ts's
	// `ActorBehavior.bindToDefinition`/`defInstance` verbatim, the SAME `clusterRows`
	// builder this verb already drives). When set, this call ALSO emits an
	// `entity_definition_initial_capability` row binding THIS behavior's capability (the
	// derived `<bundle>/spell/<id>`, or `capability_id` when overridden) to the named
	// `entity_definitions` catalog id — e.g. `srd/monster/polar-bear` or
	// `srd/species/dragonborn`. At instance birth (manifest placement OR runtime Spawn) the
	// server's `apply_definition_seeds` copies the capability onto the placed/spawned entity
	// (an entity-anchored `capability` row, ADR-0028 D-5) — so every instance of the
	// definition is born combat/trait-capable, with NO per-instance `actor_capabilities`
	// grant. This is the scale unlock the 385-strong `monsters.toml` catalog (and playable
	// species/class definitions) need to carry proven behaviors by DEFINITION, not by hand.
	bind_to_definition: Type.Optional(
		Type.String({
			description:
				"An already-authored entity_definitions catalog id (workspace, live, or the active target — " +
				"same 3-way resolution as the placement tools' `entity_def`) that inherits this call's capability " +
				"at instance birth via entity_definition_initial_capability. This PoC does not auto-create the " +
				"definition (use spellkave_define_entity_type first).",
		}),
	),
	// #1968 verb-UX round 3 — the #728 PROOF instance (mirrors compose.ts's `defInstance`
	// verbatim): place a FRESH entity carrying `bind_to_definition` as its `entity_def_id`,
	// with a steering `[[actors]]` body (`entities` + `actors` + `actor_spatial_locations`
	// rows) but DELIBERATELY NO `actor_capabilities` row — r_manipulate's selection gates on
	// the caster actually HOLDING the capability (selection.rs distinguishes
	// "capability-not-held" from "niche-not-anchored"), so this instance can act ONLY if it
	// inherited the capability from the definition seed; a successful action against it is
	// therefore proof-POSITIVE of inheritance. REQUIRES `bind_to_definition` (else this tool
	// errors BEFORE validation naming `def_instance` — an instance with no bound definition
	// would carry an empty `entity_def_id`, breaking the very inheritance it exists to
	// prove). #1968 workspace idempotency: `entity_key` is the natural key for `entities`/
	// `actors` (ROW_KIND_NATURAL_KEY) so a re-run with the SAME `entity_key` upserts; its
	// `actor_spatial_locations` satellite is cleared+replaced the same way (scoped to
	// `entity_key`, mirroring the placement tools' own object_state satellite clear).
	def_instance: Type.Optional(
		Type.Object({
			entity_key: Type.String({
				description:
					"The proof instance's fully-qualified entity_key, e.g. 'srd/actor/polar-bear-def'.",
			}),
			name: Type.String({ description: "entities.name / actors.name for the proof instance." }),
			node: Type.Optional(
				Type.String({
					description:
						"An already-authored place_node id the proof instance is placed at. Omit to default to " +
						"the resolved caster node (`grant_to`'s own node) — the niche this behavior's capability " +
						"attaches is already anchored there.",
				}),
			),
		}),
	),
});

export const INITIAL_STATE_PARAMS = Type.Object({
	state: Type.String({
		description:
			"object_state_definitions OR resource_definitions state_id (MF-VAL-253 accepts either catalog) " +
			"seeded as an object_state row onto every placed instance of this entity_def. Visibility " +
			"caveat: a resource-only id has no default_visibility authoring surface, so the seeded row " +
			"falls back to Public — author a parallel object_state_definitions row when Local/Hidden " +
			"visibility is wanted.",
	}),
	value_bool: Type.Optional(
		Type.Boolean({
			description:
				"Bool carrier (schema default true when neither value_int nor value_text is set). Carrier " +
				"precedence at commit: value_int > value_text > value_bool.",
		}),
	),
	value_int: Type.Optional(
		Type.Number({ description: "Int carrier — highest commit precedence." }),
	),
	value_text: Type.Optional(
		Type.String({
			description: "Text carrier — commit precedence between value_int and value_bool.",
		}),
	),
});

export const INITIAL_CAPABILITY_PARAMS = Type.Object({
	capability: Type.String({
		description:
			"capability_definitions capability_id granted unconditionally to every placed instance of this " +
			"entity_def (an entity_definition_initial_capability seed row).",
	}),
	extent_kind_ref: Type.Optional(
		Type.String({
			description:
				"Authored extent kind for this innate grant; preserve the same paired kind/ref contract as actor_capabilities. Omit both fields for an unscoped grant.",
		}),
	),
	extent_ref: Type.Optional(
		Type.String({
			description:
				"Extent reference paired with extent_kind_ref, copied to every spawned instance's innate capability grant.",
		}),
	),
});

export const INITIAL_CONDITION_PARAMS = Type.Object({
	condition: Type.String({
		description:
			"condition_definitions condition_definition_id seeded onto every placed instance of this entity_def.",
	}),
	duration_ticks: Type.Optional(
		Type.Number({
			description: "Ticks until auto-expiry; 0 or omitted = permanent (schema default 0).",
		}),
	),
});

export const INITIAL_CONTAINMENT_PARAMS = Type.Object({
	contained_entity_def_id: Type.String({
		description:
			"entity_def_id of the child instance spawned and carried loose (entity_containment, slot_id = '') " +
			"on every placed/spawned instance of this entity_def (an entity_definition_initial_containment " +
			"seed row). Structural, not a flat-value copy: the child's OWN initial_* seeds apply to it first " +
			"(recursion). The containment/equipment graph is cycle-checked server-side (MF-VAL-314) at admission.",
	}),
	quantity: Type.Optional(
		Type.Number({
			description:
				"Stack-vs-instance-count rule (ADR-0028 D-6): when the contained definition is stackable, ONE " +
				"instance is spawned carrying this as its stack count; otherwise this many separate instances " +
				"are spawned. Default 1.",
		}),
	),
});

export const INITIAL_EQUIPMENT_PARAMS = Type.Object({
	equipped_entity_def_id: Type.String({
		description:
			"entity_def_id of the child instance spawned and equipped into `slot_id` on every placed/spawned " +
			"instance of this entity_def (an entity_definition_initial_equipment seed row) — a child, one slot, " +
			"implicit quantity 1. The containment/equipment graph is cycle-checked server-side (MF-VAL-314) at " +
			"admission, and the equipped definition's slot_compatibility_predicate is checked at commit " +
			"(MF-VAL-311/-312/-313).",
	}),
	slot_id: Type.String({
		description: "equipment_slot_definitions slot_id the spawned child is equipped into.",
	}),
});

export const DEFINE_ENTITY_TYPE_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local entity_def_id stem; the full id is '<bundle>/<id>' (e.g. bundle='core', id='item/sword' -> " +
			"'core/item/sword'). May itself contain '/' for sub-namespacing (matches the corpus convention, e.g. " +
			"'npc/caravan', 'class/barbarian').",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"entity_definitions.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	description: Type.Optional(
		Type.String({
			description:
				"entity_definitions.description (#1968 first-class column). PLAYER-REACHABLE: " +
				"`readAuthorizedItemDetail` (@spellkave/sdk item_detail reader) falls back to this " +
				"column whenever a placed instance has no per-instance `entity_description` row, so " +
				"it must hold only what any observer may plausibly know on sight — never stat-block " +
				"numbers, hidden mechanics, or spoilers. Stat-block/rules prose belongs in an " +
				"`srd.text` `metadata_attachments` row instead, which keeps it out of description-" +
				"reading tool responses — but that is not an access-control boundary today (audience " +
				"enforcement doesn't exist yet, see metadata-attachments.md).",
		}),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), { description: "One entity_definition_tag row per tag." }),
	),
	stackable: Type.Optional(
		Type.Boolean({
			description:
				"entity_definitions.stackable — may authored instances use quantity>1 (default false).",
		}),
	),
	lineage_id: Type.Optional(
		Type.String({ description: "entity_definitions.lineage_id (default '')." }),
	),
	affordance_seed_id: Type.Optional(
		Type.String({ description: "entity_definitions.affordance_seed_id (default '')." }),
	),
	on_consume_consequence_id: Type.Optional(
		Type.String({ description: "entity_definitions.on_consume_consequence_id (default '')." }),
	),
	on_destroy_consequence_id: Type.Optional(
		Type.String({ description: "entity_definitions.on_destroy_consequence_id (default '')." }),
	),
	grants_capability_while_equipped: Type.Optional(
		Type.String({
			description:
				"CSV capability ids granted to the bearer while it equips an entity of this definition (default '').",
		}),
	),
	grants_capability_while_present_in_location: Type.Optional(
		Type.String({
			description:
				"CSV capability ids granted to entities at locations where an entity of this definition is " +
				"present (default '').",
		}),
	),
	slot_compatibility_predicate: Type.Optional(
		Type.String({
			description:
				"Closed three-form slot-compatibility grammar (not spellkave-dsl); '' or 'true' means any slot, 'false' means none, slot_id == <quoted id> means only that slot.",
		}),
	),
	initial_states: Type.Optional(
		Type.Array(INITIAL_STATE_PARAMS, {
			description:
				"entity_definition_initial_state rows — seeded onto every placed instance at admission/spawn.",
		}),
	),
	initial_capabilities: Type.Optional(
		Type.Array(INITIAL_CAPABILITY_PARAMS, {
			description: "entity_definition_initial_capability rows — innate capability grants.",
		}),
	),
	initial_conditions: Type.Optional(
		Type.Array(INITIAL_CONDITION_PARAMS, {
			description:
				"entity_definition_initial_condition rows — conditions born active on every placed instance.",
		}),
	),
	initial_containment: Type.Optional(
		Type.Array(INITIAL_CONTAINMENT_PARAMS, {
			description:
				"entity_definition_initial_containment rows — each spawns a child instance carried loose (no " +
				"equipment slot) on every placed/spawned instance. Structural, not a flat-value copy; MF-VAL-314 " +
				"cycle-checked server-side at admission (not duplicated here).",
		}),
	),
	initial_equipment: Type.Optional(
		Type.Array(INITIAL_EQUIPMENT_PARAMS, {
			description:
				"entity_definition_initial_equipment rows — each spawns a child instance and equips it into the " +
				"named slot on every placed/spawned instance. Structural, not a flat-value copy; MF-VAL-314 " +
				"cycle-checked server-side at admission (not duplicated here).",
		}),
	),
});

export const ROLL_TABLE_ENTRY_PARAMS = Type.Object({
	result_ref: Type.String({
		description: "roll_table_entries.result_ref — the drawn value/reference text for this entry.",
	}),
	weight: Type.Optional(Type.Number({ description: "roll_table_entries.weight (default 1)." })),
	tags: Type.Optional(
		Type.Array(Type.String(), {
			description: "One roll_table_entry_tag row per tag, for THIS entry.",
		}),
	),
});

export const DEFINE_ROLL_TABLE_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row (roll_table_entries excepted — that row kind carries no " +
				"bundle_id column). Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local roll_table_id stem; the full id is '<bundle>/<id>' (e.g. bundle='core', id='d20' -> 'core/d20').",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"roll_tables.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	result_kind: Type.String({
		description:
			"roll_tables.result_kind — an open string (the corpus already uses more than one value, e.g. 'int', " +
			"'outcome_graph'); no closed PoC enum.",
	}),
	description: Type.Optional(
		Type.String({ description: "roll_tables.description (#1968 first-class column)." }),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), { description: "One roll_table_tag row per tag." }),
	),
	entries: Type.Array(ROLL_TABLE_ENTRY_PARAMS, {
		description:
			"One row per entry, in AUTHORED order. `authored_order` (1-based) and `roll_table_entry_id` " +
			"('<roll_table_id>:<authored_order>') are BOTH derived from array position + the parent id, matching " +
			"the corpus convention verbatim — never hand-specified.",
	}),
});

export const CONDITION_HOOK_PARAMS = Type.Object({
	event_kind: Type.String({
		description: "condition_definitions.hooks[].event_kind, e.g. 'Layer2.ApplyConsequence'.",
	}),
	detail_filter_source: Type.Optional(
		Type.String({
			description:
				"Inline-DSL Bool sub-expression gating which event instances this hook fires for. Passed through " +
				"verbatim (single-parse discipline is the server's job, not this verb's).",
		}),
	),
	expression_source: Type.Optional(
		Type.String({
			description:
				"Inline-DSL Int sub-expression evaluated when the hook fires. Passed through verbatim.",
		}),
	),
});

export const REMOVE_POLICY_PARAMS = Type.Object({
	id: Type.String({
		description:
			"The FULL condition_remove_policy_definitions policy_id (cross-bundle vocabulary — e.g. " +
			"'core/remove_policy/independent_lifetime'; NOT bundle-prefixed by this verb, unlike `id`).",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"condition_remove_policy_definitions.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	remove_predicate_source: Type.String({
		description:
			"DSL Bool expression; the removal path evaluates this instead of branching on the policy id.",
	}),
});

export const STACKING_PARAMS = Type.Object({
	id: Type.String({
		description:
			"The FULL stacking_discipline_definitions discipline_id (cross-bundle vocabulary — e.g. " +
			"'core/stacking/single'; NOT bundle-prefixed by this verb, unlike `id`).",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"stacking_discipline_definitions.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	stack_count_outcome_source: Type.String({
		description:
			"Int-valued DSL expression over the existing row state (facts: stack_count, expires_at_tick, world_tick).",
	}),
	expires_at_tick_outcome_source: Type.String({
		description: "Int-valued DSL expression; -1 means 'leave the existing expiry unchanged'.",
	}),
});

export const MODIFIER_PARAMS = Type.Object({
	id: Type.String({ description: "Local modifier_templates id stem; full id '<bundle>/<id>'." }),
	display_name: Type.Optional(
		Type.String({
			description:
				"modifier_templates.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	applies_to: Type.String({
		description:
			"modifier_templates.applies_to — the composition-axis vocabulary id (an authored " +
			"modifier_target_definitions row, e.g. 'ResolutionCheck'; open string).",
	}),
	modifier_expression_source: Type.String({
		description: "DSL expression producing the modifier's magnitude.",
	}),
	predicate_source: Type.Optional(
		Type.String({ description: "DSL Bool gate; '' (default) means always-active." }),
	),
	priority: Type.Optional(Type.Number({ description: "modifier_templates.priority (default 0)." })),
	delta_kind: Type.Optional(
		Type.Union(
			[
				Type.Literal("Advantage"),
				Type.Literal("Disadvantage"),
				Type.Literal("Plus"),
				Type.Literal("Times"),
				Type.Literal("FlatSet"),
				Type.Literal("Replace"),
			],
			{
				description:
					"modifier_templates.delta_kind (default 'Plus') — the validator's OWN closed vocabulary " +
					"(MF-VAL-243), not a PoC-narrower enum.",
			},
		),
	),
	replace_template_id: Type.Optional(
		Type.String({
			description:
				"Required (by the validator) when delta_kind='Replace' — the modifier_template id this one replaces.",
		}),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), {
			description: "One modifier_template_tag row per tag, for THIS modifier.",
		}),
	),
});

export const DEFINE_CONDITION_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({ description: "Local condition_definition_id stem; full id '<bundle>/<id>'." }),
	display_name: Type.Optional(
		Type.String({
			description:
				"condition_definitions.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	description: Type.Optional(
		Type.String({ description: "condition_definitions.description (#1968 first-class column)." }),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), { description: "One condition_definition_tag row per tag." }),
	),
	gate_predicate_source: Type.Optional(
		Type.String({
			description:
				"DSL Bool expression gating condition-triggered modifier application (default '').",
		}),
	),
	observable: Type.Optional(
		Type.Boolean({ description: "condition_definitions.observable (default true)." }),
	),
	grants_capability_while_active: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Capability ids GRANTED to the bearer while this condition is active (default []). Enforced in capability_ids_for_actor; use this rather than a status when the thing granted is an ability to act, because affordance_template.capability_id is a structural gate a status cannot reproduce.",
		}),
	),
	suppresses_capability_while_active: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"Capability ids SUPPRESSED on the bearer AS AN ACTOR while this condition is active (default []). Suppression beats a grant of the same id. Applies to the bearer's own attempts to act only — it never makes the bearer an illegal TARGET, so a spell like Speak with Dead stays authorable against a corpse that cannot itself speak.",
		}),
	),
	implies: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"condition_definitions.implies — cascade edges (each id is ALSO applied when this condition is applied).",
		}),
	),
	hooks: Type.Optional(
		Type.Array(CONDITION_HOOK_PARAMS, { description: "condition_definitions.hooks[]." }),
	),
	remove_time_policy: Type.Optional(
		Type.String({
			description:
				"condition_definitions.remove_time_policy — REFERENCE an existing policy id (default " +
				"'core/remove_policy/independent_lifetime'). Pass `remove_policy` instead to ALSO author the row.",
		}),
	),
	remove_policy: Type.Optional(REMOVE_POLICY_PARAMS),
	stacking_rule: Type.Optional(
		Type.String({
			description:
				"condition_definitions.stacking_rule — REFERENCE an existing discipline id (default " +
				"'core/stacking/single'). Pass `stacking` instead to ALSO author the row.",
		}),
	),
	stacking: Type.Optional(STACKING_PARAMS),
	modifier_template_id: Type.Optional(
		Type.String({
			description:
				"condition_definitions.modifier_template_id — REFERENCE an existing modifier (default ''). Omit " +
				"when `modifiers` has EXACTLY one entry (auto-wired to it); REQUIRED when `modifiers` has more " +
				"than one entry (which one is the FK, otherwise ambiguous).",
		}),
	),
	modifiers: Type.Optional(
		Type.Array(MODIFIER_PARAMS, {
			description:
				"modifier_templates rows (+ their modifier_template_tag satellites) authored in this call.",
		}),
	),
});

export const NICHE_ATTACHMENT_PARAMS = Type.Object({
	node: Type.Optional(
		Type.String({
			description:
				"spatial_niche_attachments.place_node_id — an authored place_node id. EXACTLY ONE of `node`/`edge` " +
				"must be set per attachment (the two authored attachment shapes the corpus actually uses).",
		}),
	),
	edge: Type.Optional(
		Type.Number({
			description:
				"spatial_niche_attachments.place_edge_id — a place_edge numeric id (0 is the SpacetimeDB 'every " +
				"edge' wildcard convention, e.g. a global passable-portal gate). EXACTLY ONE of `node`/`edge`.",
		}),
	),
	visibility: Type.Optional(
		Type.String({ description: "spatial_niche_attachments.visibility (default 'Public')." }),
	),
	condition_bool: Type.Optional(
		Type.Boolean({ description: "spatial_niche_attachments.condition_bool (default true)." }),
	),
	ecological_invariant: Type.Optional(
		Type.Boolean({
			description: "spatial_niche_attachments.ecological_invariant (default false).",
		}),
	),
});

export const DEFINE_NICHE_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({ description: "Local niche_id stem; full id '<bundle>/<id>'." }),
	display_name: Type.Optional(
		Type.String({
			description:
				"niche_definitions.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	description: Type.String({
		description:
			"niche_definitions.description — REQUIRED (unlike every OTHER verb's optional `description?`): " +
			"NicheDefinitionRow kept its own PRE-EXISTING required description column through the #1968 " +
			"description-column decision (no `#[serde(default)]` in the schema); omitting it would author an " +
			"invalid row, not merely a less-documented one.",
	}),
	tags: Type.Optional(
		Type.Array(Type.String(), { description: "One niche_definition_tag row per tag." }),
	),
	predicate_source: Type.Optional(
		Type.String({
			description:
				"DSL Bool predicate (default '' = trivially-true, matches any candidate target).",
		}),
	),
	attachments: Type.Optional(
		Type.Array(NICHE_ATTACHMENT_PARAMS, {
			description: "spatial_niche_attachments rows binding this niche to place nodes/edges.",
		}),
	),
});

export const DEFINE_AFFORDANCE_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local affordance key stem — derives template_id '<bundle>/<id>/affordance' and outcome_template_id " +
			"'<bundle>/<id>/outcome'.",
	}),
	niche_id: Type.String({
		description:
			"affordance_templates.niche_id — an ALREADY-authored niche_definitions id (workspace, live, or the " +
			"active target, e.g. via spellkave_define_niche) this call never creates — the trigger surface (a " +
			"trap/trigger niche, e.g. a pressure plate).",
	}),
	capability_id: Type.String({
		description:
			"affordance_templates.capability_id — an ALREADY-authored capability_definitions id (workspace, live, " +
			"or the active target, e.g. 'core/walk') this call never creates — the pre-existing capability any " +
			"qualifying actor already holds (no NEW grant is authored by this call).",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"Overrides the derived title-cased `id` for BOTH the outcome and affordance rows.",
		}),
	),
	predicate_source: Type.Optional(
		Type.String({
			description:
				"affordance_templates.predicate_source — the deterministic ELIGIBILITY gate for whether this " +
				"affordance offers (e.g. a capability/state check like 'target.stat(\"srd/ac\") >= 1'). A " +
				"stochastic comparison here (e.g. 'd20 >= 13') is treated as satisfied at materialise time and " +
				"never gates offer (#1891) — author dice on the action's resolution_predicate_source " +
				"(resolution_mode = 'Stochastic') instead. Omit for an ungated trigger (predicate_bool = true).",
		}),
	),
	range_m: Type.Optional(
		Type.Number({
			description: "affordance_templates.range_m (ADR-0053 metric embedding). Default 0.",
		}),
	),
	outcome_expression_source: Type.Optional(
		Type.String({
			description:
				"outcome_templates.outcome_expression_source — invokes a pre-authored effect (e.g. " +
				"\"invoke_outcome_graph('<bundle>/<id>/graph')\"). Exactly ONE of `outcome_expression_source`/" +
				"`manipulation_action_id` is required — an affordance with neither would trigger nothing.",
		}),
	),
	manipulation_action_id: Type.Optional(
		Type.String({
			description:
				"outcome_templates.manipulation_action_id — executes a pre-authored action_definitions row " +
				"instead (the darkness-consumer idiom, packages/spellkave-srd/src/author/author-darkness.ts's `act_in_dark`). Exactly " +
				"ONE of `outcome_expression_source`/`manipulation_action_id` is required.",
		}),
	),
});

export const DEFINE_CAPABILITY_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local capability_id stem; the full id is '<bundle>/<id>' (e.g. bundle='core', id='walk' -> " +
			"'core/walk'). A handful of corpus capability ids are DELIBERATELY cross-namespace (e.g. " +
			"'frontier.apply_manifest' under bundle_id='core') — this verb always derives '<bundle>/<id>', so a " +
			"cross-namespace id stays on spellkave_write_rows (mirrors spellkave_define_entity_type's own " +
			"cross-namespace carve-out).",
	}),
	actor_kind: Type.String({
		description:
			"capability_definitions.actor_kind — an open string (the corpus already uses more than one value, " +
			"e.g. 'entity', 'operator'); no closed PoC enum.",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"capability_definitions.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	description: Type.String({
		description:
			"capability_definitions.description — REQUIRED (unlike every OTHER verb's optional `description?`): " +
			"CapabilityDefinitionRow kept its own PRE-EXISTING required description column through the #1968 " +
			"description-column decision (no `#[serde(default)]` in the schema); omitting it would author an " +
			"invalid row, not merely a less-documented one (same carve-out as spellkave_define_niche's own " +
			"required `description`).",
	}),
	default_visibility: Type.Optional(
		Type.String({
			description:
				"capability_definitions.default_visibility — the ADR-0120 read-visibility default concrete grants " +
				"inherit unless overridden. Omit to default 'Public' (#1968 smart default — matches the schema's " +
				"own `default_public()` serde default).",
		}),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), { description: "One capability_definition_tag row per tag." }),
	),
});

export const DEFINE_CONSEQUENCE_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on the consequence_templates row. Omit to fall back to `context.defaultBundle` " +
				"(#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local consequence_template_id stem; the full id is '<bundle>/<id>' (e.g. bundle='core', " +
			"id='pickup/success' -> 'core/pickup/success').",
	}),
	effect_ref: Type.Optional(
		Type.String({
			description:
				"consequence_templates.effect_refs_csv — an already-authored effect_definitions id this " +
				"consequence invokes (e.g. a scheduled-zone/summon effect). The corpus never joins more than one " +
				"id here despite the column's '_csv' name — a single ref, not a real CSV list. Omit for a " +
				"consequence with no effect_definitions reference.",
		}),
	),
	description: Type.Optional(
		Type.String({ description: "consequence_templates.description (#1968 first-class column)." }),
	),
	frame_writes: Type.Optional(
		Type.Array(
			Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Literal("BreakPlaceSeal")]),
			{
				description:
					"consequence_frame_writes rows, in AUTHORED order — each a raw FrameWriteOp body object or the unit string BreakPlaceSeal (e.g. " +
					"{Inscribe: {...}}, {ModifyResource: {...}}, {PickupTargetItem: {...}}), mirroring " +
					"spellkave_write_rows' own untyped row shape (the closed Rust FrameWriteOp enum is never modeled " +
					"in TypeBox here). `ordinal` (0-based) is derived from array position — never hand-specified.",
			},
		),
	),
});

export const DEFINE_ACTION_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on the action_definitions row. Omit to fall back to `context.defaultBundle` " +
				"(#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local action_id stem; the full id is '<bundle>/<id>' (e.g. bundle='core', id='pickup' -> " +
			"'core/pickup').",
	}),
	required_capability: Type.String({
		description:
			"action_definitions.required_capability — an ALREADY-authored capability_definitions id (workspace, " +
			"live, or the active target, e.g. via spellkave_define_capability) this call never creates.",
	}),
	on_success: Type.String({
		description:
			"action_definitions.on_success — the consequence_templates id (e.g. via spellkave_define_consequence) " +
			"applied when this action resolves successfully.",
	}),
	on_failure: Type.Optional(
		Type.String({
			description:
				"action_definitions.on_failure — the consequence_templates id applied on failure. Omit for none " +
				"(schema default: empty string).",
		}),
	),
	display_name: Type.Optional(
		Type.String({
			description:
				"action_definitions.display_name. Omit to derive a title-cased `id` (#1968 smart default).",
		}),
	),
	cost_time_ms: Type.Optional(
		Type.Number({
			description:
				"action_definitions.cost_time_ms in fiction milliseconds. With spends_channel, omit or set 0 to spend one full channel pool; without a channel, 0 is unmetered.",
		}),
	),
	resolution_mode: Type.Optional(
		Type.Union(
			[Type.Literal("Deterministic"), Type.Literal("Stochastic"), Type.Literal("Deferred")],
			{
				description:
					"action_definitions.resolution_mode. Omit for the schema default ('Deterministic').",
			},
		),
	),
	resolution_predicate_source: Type.Optional(
		Type.String({
			description:
				"action_definitions.resolution_predicate_source — authored boolean DSL for Stochastic resolution. Omit for empty (Deterministic/Deferred).",
		}),
	),
	resolution_scope: Type.Optional(
		Type.String({
			description:
				"action_definitions.resolution_scope — open authored id selecting scoped actor-side roll modifiers. Omit for no narrow scope.",
		}),
	),
	non_steering: Type.Optional(
		Type.Boolean({
			description:
				"Explicit author assertion that target effects are cooperative/non-steering and need no target claim. Omit/false for conservative automatic classification; marking a hostile effect true is a content bug.",
		}),
	),
	session_def_id: Type.Optional(
		Type.String({
			description: "action_definitions.session_def_id. Omit for the schema default (empty string).",
		}),
	),
	resumable: Type.Optional(
		Type.Boolean({
			description:
				"action_definitions.resumable (#2022) — interrupted long-running progress is credited on the next " +
				"matching promotion (same actor, action, target). Omit for the schema default (false).",
		}),
	),
	self_eligible: Type.Optional(
		Type.Boolean({
			description: "action_definitions.self_eligible. Omit for the schema default (false).",
		}),
	),
	self_only: Type.Optional(
		Type.Boolean({
			description: "action_definitions.self_only (ADR-0075). Omit for the schema default (false).",
		}),
	),
	spends_channel: Type.Optional(
		Type.String({
			description:
				"action_definitions.spends_channel — an open FK into economy_channel_definitions.id " +
				"(action-economy budgeting). Omit for unmetered (schema default: absent).",
		}),
	),
	reaction_eligibility: Type.Optional(
		Type.String({
			description:
				"action_definitions.reaction_eligibility — a DSL predicate over a candidate reactor (§8.4 WHO " +
				"axis). Omit for not-a-reaction-candidate (schema default: absent).",
		}),
	),
	reaction_window_ms: Type.Optional(
		Type.Number({
			description:
				"action_definitions.reaction_window_ms. Omit for an implementation default when " +
				"`reaction_eligibility` is set.",
		}),
	),
	reaction_trigger: Type.Optional(
		Type.String({
			description:
				"action_definitions.reaction_trigger — a DSL predicate over the triggering event (§8.4 WHAT " +
				"axis). Omit to provoke on every co-located trigger (schema default: absent).",
		}),
	),
	description: Type.Optional(
		Type.String({ description: "action_definitions.description (#1968 first-class column)." }),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), { description: "One action_definition_tag row per tag." }),
	),
});

export const DEFINE_SESSION_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on the session_definitions row. Omit to fall back to " +
				"`context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local session_def_id stem; the full id is '<bundle>/<id>' (e.g. bundle='core', " +
			"id='long_running_action' -> 'core/long_running_action').",
	}),
	turn_rule: Type.Optional(
		Type.String({
			description:
				"session_definitions.turn_rule. Omit for 'Sequential' (smart default — the only rule " +
				"`r_session_open`/`r_advance_turn` schedule today; other values pass through verbatim).",
		}),
	),
	round_duration_ms: Type.Optional(
		Type.Number({
			description:
				"session_definitions.round_duration_ms (ADR-0037 D-5). Omit for the schema default (0 = " +
				"unbound). Set 6000 for a default-tick-paced session whose termination_pred should be re-evaluated every " +
				"world tick (the `core/long_running_action` shape).",
		}),
	),
	termination_pred: Type.Optional(
		Type.String({
			description:
				"session_definitions.termination_pred — DSL predicate evaluated after every turn advance; on " +
				"match the session terminates 'completed'. For a time-bound session use " +
				"\"world.tick - session.stat('opened_at') >= session.stat('promoted_duration_ticks')\". Omit " +
				"for none (schema default: empty).",
		}),
	),
	winner_predicate: Type.Optional(
		Type.String({
			description: "session_definitions.winner_predicate. Omit for the schema default (empty).",
		}),
	),
	on_terminate: Type.Optional(
		Type.String({
			description:
				"session_definitions.on_terminate — a consequence_templates id applied on 'completed' " +
				"termination, before the originating action's own on_success (#2022 binding order). Omit for " +
				"none (schema default: empty).",
		}),
	),
	participants_pred: Type.Optional(
		Type.String({
			description:
				"session_definitions.participants_pred. Omit for the schema default (empty; currently not " +
				"validated at open — architecture Phase E/F).",
		}),
	),
	busy_allow_pred: Type.Optional(
		Type.String({
			description:
				"session_definitions.busy_allow_pred (#2022) — actions matching this DSL predicate (attempted " +
				"action tags via target.has_tag(...), id via target.text('action_id')) stay ALLOWED while a " +
				"participant is busy in this session. Omit for none (with busy_break_pred also absent: full " +
				"block).",
		}),
	),
	busy_break_pred: Type.Optional(
		Type.String({
			description:
				"session_definitions.busy_break_pred (#2022) — actions matching this predicate ABANDON the " +
				"session (abort semantics: on_failure + progress record), then proceed. Omit for none.",
		}),
	),
	legal_moves_csv: Type.Optional(
		Type.String({
			description:
				"session_definitions.legal_moves_csv — comma-separated move-template ids `r_session_move` " +
				"accepts. Omit for the schema default (empty).",
		}),
	),
	initial_state: Type.Optional(
		Type.String({
			description: "session_definitions.initial_state (JSON). Omit for the schema default (empty).",
		}),
	),
	visibility_policy: Type.Optional(
		Type.String({
			description: "session_definitions.visibility_policy. Omit for 'Public' (smart default).",
		}),
	),
	stakes_required: Type.Optional(
		Type.String({
			description: "session_definitions.stakes_required. Omit for the schema default (empty).",
		}),
	),
	turn_scheduler_id: Type.Optional(
		Type.String({
			description:
				"session_definitions.turn_scheduler_id — FK into an ALREADY-authored turn_scheduler row " +
				"(ADR-0037 D-3/D-4, e.g. a RolledOrder d20 initiative). Omit for the world-active scheduler " +
				"(schema default: empty).",
		}),
	),
	auto_join_on_targeting: Type.Optional(
		Type.Boolean({
			description:
				"session_definitions.auto_join_on_targeting (ADR-0037 D-7). Omit for the schema default " +
				"(false).",
		}),
	),
	combat_grid_blueprint_id: Type.Optional(
		Type.String({
			description:
				"session_definitions.combat_grid_blueprint_id — FK into an ALREADY-authored " +
				"combat_grid_blueprint row (ADR-0045/0052 tactical grid). Omit for no automatic grid (schema " +
				"default: empty).",
		}),
	),
	grid_edge_affordance_template_id: Type.Optional(
		Type.String({
			description:
				"session_definitions.grid_edge_affordance_template_id. Omit for the schema default (empty).",
		}),
	),
	grid_edge_affordance_bindings_json: Type.Optional(
		Type.String({
			description:
				"session_definitions.grid_edge_affordance_bindings_json. Omit for the schema default (empty).",
		}),
	),
	turn_eligibility_pred: Type.Optional(
		Type.String({
			description:
				"session_definitions.turn_eligibility_pred (ADR-0143) — Bool DSL predicate evaluated per " +
				"participant as `actor` when the turn advances; a false result skips that participant " +
				"without removing it (it stays targetable and counted). Actor-subject reads only " +
				"(MF-VAL-334), e.g. \"actor.status('<condition_id>') == false\" or a Bool macro. Omit to " +
				"hand every participant the turn.",
		}),
	),
	description: Type.Optional(
		Type.String({ description: "session_definitions.description (#1968 first-class column)." }),
	),
});

export const DEFINE_ACTION_VERB_CONSEQUENCE_PARAMS = Type.Object({
	effect_ref: Type.Optional(
		Type.String({
			description:
				"consequence_templates.effect_refs_csv — an already-authored effect_definitions id this " +
				"consequence invokes. Omit for a consequence with no effect_definitions reference (the common case " +
				"for a check-shaped action).",
		}),
	),
	description: Type.Optional(
		Type.String({ description: "consequence_templates.description (#1968 first-class column)." }),
	),
	frame_writes: Type.Optional(
		Type.Array(
			Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Literal("BreakPlaceSeal")]),
			{
				description:
					"consequence_frame_writes rows, in AUTHORED order — each a raw FrameWriteOp body object or the unit string BreakPlaceSeal, mirroring " +
					"spellkave_define_consequence's own `frame_writes` param verbatim. Omit entirely for MF-VAL-222's " +
					"own documented no-op shape: a manipulation-dispatchable action needs a non-empty `on_success`, and " +
					"a consequence_templates row with NO frame_writes at all is the validator-sanctioned way to satisfy " +
					"that with no actual effect (both this verb's grounding call sites use exactly this shape for most " +
					"of their generated checks).",
			},
		),
	),
});

export const DEFINE_ACTION_VERB_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({
		description:
			"Local id stem every derived id qualifies against '<bundle>/<id>': action_id itself, plus " +
			"'<action_id>/outcome' (outcome_templates), '<action_id>/affordance' (affordance_templates), and " +
			"'<action_id>/success' (consequence_templates, also `action_definitions.on_success`) — matches both " +
			"grounding call sites' own naming convention verbatim, never a caller override.",
	}),
	required_capability: Type.Optional(
		Type.String({
			description:
				"An ALREADY-authored capability_definitions id (workspace, live, or the active target, e.g. via " +
				"spellkave_define_capability) this call never creates — reused for BOTH " +
				"action_definitions.required_capability AND affordance_templates.capability_id (this verb's own " +
				"grounding call sites always use the SAME id in both places), UNLESS `affordance_capability_id` " +
				"overrides the affordance half (see that param). sk-9ll.6: omit (or pass '') for an UNGATED verb — " +
				"some authored chains (e.g. an always-hit attack with no gating capability at all) need no capability " +
				"row, matching the schema's own empty-string default; an empty value is never existence-checked — " +
				"only a non-empty value still requires a matching capability_definitions row.",
		}),
	),
	affordance_capability_id: Type.Optional(
		Type.String({
			description:
				"actor-carried-verbs D6: overrides affordance_templates.capability_id independently of " +
				"action_definitions.required_capability — for the creature-carried-statblock shape, where the " +
				"ACTION stays keyed on a shared discriminator (e.g. 'srd/action/attack', an initiative-watch " +
				"read site) while the AFFORDANCE's actual admission gate is a per-creature capability " +
				"(e.g. 'srd/creature/black-bear/action') granted only to that creature. An ALREADY-authored " +
				"capability_definitions id (workspace, live, or the active target) this call never creates — " +
				"same existence-check posture as `required_capability` (a non-empty value is checked; '' is not). " +
				"Omit for the verb's original single-id posture (default: `required_capability`'s own value).",
		}),
	),
	niche_id: Type.String({
		description:
			"affordance_templates.niche_id. NOT existence-checked against niche_definitions (see this verb's own " +
			"file-header note) — a bare entity_definition_tag value (e.g. 'creature') or the " +
			"'capability:<capability_id>' synthetic-niche convention are both LEGAL here despite authoring no " +
			"niche_definitions row of their own, but a bare entity_definition_tag with no niche_definitions row " +
			"resolves to the 'place' provider's fail-closed default (requires_spatial_attachment: true) and " +
			"REJECTS every dispatch with attachment_presence — an actor-carried tag has no place attachment to " +
			"satisfy it. Pair the tag with an explicit spellkave_write_rows niche_definitions " +
			"row (provider = 'entity') whenever the niche is entity-provided, not place-attached. An authored " +
			"niche_definitions id (via spellkave_define_niche) works too.",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"Overrides the derived title-cased `id` for the action/outcome/affordance rows alike (mirrors " +
				"spellkave_define_affordance's own shared display_name). Omit for the smart default (#1968).",
		}),
	),
	description: Type.Optional(
		Type.String({ description: "action_definitions.description (#1968 first-class column)." }),
	),
	predicate_source: Type.Optional(
		Type.String({
			description:
				"affordance_templates.predicate_source — the deterministic ELIGIBILITY gate for whether this " +
				"affordance offers. A stochastic comparison here (e.g. 'd20 >= 13') is treated as satisfied at " +
				"materialise time and never gates offer (#1891) — use this verb's own resolution_predicate_source " +
				"(with resolution_mode = 'Stochastic') for dice instead. Omit for an ungated trigger " +
				"(predicate_bool = true) — mirrors spellkave_define_affordance's identical omit-for-ungated " +
				"convention.",
		}),
	),
	range_m: Type.Optional(
		Type.Number({
			description: "affordance_templates.range_m (ADR-0053 metric embedding). Default 0.",
		}),
	),
	accepts_global_storm: Type.Optional(
		Type.Boolean({
			description:
				"affordance_templates.accepts_global_storm — modder opt-in acknowledging this template's predicate " +
				"classifies as Global. Default false.",
		}),
	),
	cost_time_ms: Type.Optional(
		Type.Number({
			description:
				"action_definitions.cost_time_ms in fiction milliseconds. With spends_channel, omit or set 0 to spend one full channel pool; without a channel, 0 is unmetered.",
		}),
	),
	on_failure: Type.Optional(
		Type.String({
			description:
				"action_definitions.on_failure — the consequence_templates id applied on failure. Omit for none " +
				"(schema default: empty string) — this verb only ever AUTHORS the on_success consequence, never an " +
				"on_failure one (neither grounding call site needs one; author it separately, e.g. via " +
				"spellkave_define_consequence, if wanted).",
		}),
	),
	outcome_expression_source: Type.Optional(
		Type.String({
			description:
				"outcome_templates.outcome_expression_source (playable-fighter-l1-20 D-1) — e.g. " +
				"\"invoke_outcome_graph('<bundle>/<id>/graph')\" to ALSO fire a pre-authored outcome graph, in " +
				"addition to this action's own `consequence` (independent, sequential — " +
				"the action runs first, followed by the expression in the same binding context). " +
				"Every prior corpus example (`srd/acid_arrow`, `srd/outcome_guard_state_branch`) sets this INSTEAD of " +
				"`consequence` (an empty-consequence, graph-only action) — setting BOTH on this verb's own generated " +
				"outcome row is new with this field, structurally supported (no validator or runtime exclusivity " +
				"found), used to bolt a defeat-consequence (e.g. an XP credit) onto an action whose own damage/ " +
				"condition writes are unchanged. Omit for '' (schema default) — today's byte-identical behavior.",
		}),
	),
	resolution_mode: Type.Optional(
		Type.Union(
			[Type.Literal("Deterministic"), Type.Literal("Stochastic"), Type.Literal("Deferred")],
			{
				description:
					"action_definitions.resolution_mode. Omit for the schema default ('Deterministic').",
			},
		),
	),
	resolution_predicate_source: Type.Optional(
		Type.String({
			description:
				"action_definitions.resolution_predicate_source — authored boolean DSL for Stochastic resolution. Omit for empty (Deterministic/Deferred).",
		}),
	),
	resolution_scope: Type.Optional(
		Type.String({
			description:
				"action_definitions.resolution_scope — open authored id selecting scoped actor-side roll modifiers. Omit for no narrow scope.",
		}),
	),
	non_steering: Type.Optional(
		Type.Boolean({
			description:
				"Explicit author assertion that target effects are cooperative/non-steering and need no target claim. Omit/false for conservative automatic classification; marking a hostile effect true is a content bug.",
		}),
	),
	session_def_id: Type.Optional(
		Type.String({
			description: "action_definitions.session_def_id. Omit for the schema default (empty string).",
		}),
	),
	self_eligible: Type.Optional(
		Type.Boolean({
			description: "action_definitions.self_eligible. Omit for the schema default (false).",
		}),
	),
	self_only: Type.Optional(
		Type.Boolean({
			description: "action_definitions.self_only (ADR-0075). Omit for the schema default (false).",
		}),
	),
	spends_channel: Type.Optional(
		Type.String({
			description:
				"action_definitions.spends_channel — an open FK into economy_channel_definitions.id " +
				"(action-economy budgeting). Omit for unmetered (schema default: absent).",
		}),
	),
	reaction_eligibility: Type.Optional(
		Type.String({
			description:
				"action_definitions.reaction_eligibility — a DSL predicate over a candidate reactor (§8.4 WHO " +
				"axis). Omit for not-a-reaction-candidate (schema default: absent).",
		}),
	),
	reaction_window_ms: Type.Optional(
		Type.Number({
			description:
				"action_definitions.reaction_window_ms. Omit for an implementation default when " +
				"`reaction_eligibility` is set.",
		}),
	),
	reaction_trigger: Type.Optional(
		Type.String({
			description:
				"action_definitions.reaction_trigger — a DSL predicate over the triggering event (§8.4 WHAT " +
				"axis). Omit to provoke on every co-located trigger (schema default: absent).",
		}),
	),
	tags: Type.Optional(
		Type.Array(Type.String(), { description: "One action_definition_tag row per tag." }),
	),
	consequence: Type.Optional(DEFINE_ACTION_VERB_CONSEQUENCE_PARAMS),
	outcome_id_suffix: Type.Optional(
		Type.String({
			description:
				"sk-9ll.6: the local suffix qualifying the generated outcome_templates id as " +
				"'<action_id>/<outcome_id_suffix>' (also `affordance_templates.outcome_template_id`). Omit for the " +
				"legacy default 'outcome'. Raw write_rows chains this verb is meant to fold use several different " +
				"suffixes here (e.g. 'hit') — set this to match an existing convention instead of falling back to " +
				"spellkave_write_rows.",
		}),
	),
	consequence_id_suffix: Type.Optional(
		Type.String({
			description:
				"sk-9ll.6: the local suffix qualifying the generated consequence_templates id (and " +
				"`action_definitions.on_success`) as '<action_id>/<consequence_id_suffix>'. Omit for the legacy " +
				"default 'success'. Raw write_rows chains this verb is meant to fold use several different suffixes " +
				"here (e.g. 'consequence') — set this to match an existing convention instead of falling back to " +
				"spellkave_write_rows.",
		}),
	),
	spends_channel_placement: Type.Optional(
		Type.Union([Type.Literal("affordance"), Type.Literal("action"), Type.Literal("both")], {
			description:
				"sk-9ll.6: where a set `spends_channel` value is written. Default 'both' (this verb's original " +
				"mirrored behavior) — the server reads `spends_channel` off BOTH rows for DIFFERENT purposes: an " +
				"on-turn action reads the resolved affordance template, while an off-turn reaction uses " +
				"the originating action definition. A reaction action with no " +
				"action-row spends_channel is UNMETERED (free). Pass 'affordance' to write it only on " +
				"affordance_templates (a non-reaction, on-turn-only verb where the action-row copy is genuinely dead), " +
				"or 'action' to write it only on action_definitions. Ignored when `spends_channel` itself is omitted.",
		}),
	),
	composes: Type.Optional(
		Type.Array(Type.String(), {
			description:
				"sk-9ll.6: affordance_templates.composes — child affordance_template ids this template unrolls " +
				"into on a successful manipulate (the action-composition slice, `r_manipulate`'s own composition " +
				"unroll). Pass-through, verbatim, in AUTHORED order. Omit for the schema default (no composition, " +
				"this verb's own consequence fires alone).",
		}),
	),
	communication_speech_act_id: Type.Optional(
		Type.String({
			description:
				"sk-9ll.6: outcome_templates.communication_speech_act_id — when set, the generated outcome " +
				"surfaces as a communication speech act (mirrors spellkave_define_behavior's own identical " +
				"pass-through) while r_manipulate still EXECUTES the gated consequence normally. Omit for the " +
				"legacy default: no speech-act framing.",
		}),
	),
});

export const WRITE_ROWS_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on the scaffolded `[[bundles]]` header (self-scaffolds if new) and defaulted onto " +
				"every row that doesn't already set its own `bundle_id` (only when the target kind's schema has that " +
				"column). Omit to fall back to `context.defaultBundle` (#1968 smart default) — an error names " +
				"`bundle` when neither is set.",
		}),
	),
	kind: Type.String({
		description:
			"The exact Manifest row-kind name — a `[[kind]]` TOML table, e.g. 'extent_kind_definitions' or " +
			"'roll_table_entries'. The generic escape hatch for any row kind the other verbs " +
			"(author_place/spawn/define_resource/define_behavior) don't cover — validated at call time against " +
			"@spellkave/world-author's live schema surface (describeManifestSchema()), never a fixed list here; an " +
			"unsupported kind fails loudly naming the current valid set. See spellkave_docs (manifest-format) for " +
			"the full row/field reference.",
	}),
	rows: Type.Array(Type.Record(Type.String(), Type.Unknown()), {
		description:
			"One or more row objects in this kind's own field shape (see the manifest-format reference doc). Each " +
			"row is merged as-is into the scratch bundle and re-validated with everything else already authored — " +
			"nothing is persisted unless the WHOLE merged manifest is clean.",
	}),
});

const OPEN_METADATA_OBJECT = Type.Record(Type.String(), Type.Unknown(), {
	description:
		"An open JSON-compatible metadata object. Values are authored unchanged: this shared tool does not reserve a docs, UI, or ruleset schema.",
});

const METADATA_ATTACHMENT_TARGET = Type.Object(
	{
		kind: Type.String({
			description:
				"An admitted metadata target kind. The shared manifest validator owns the current vocabulary; unsupported values fail at commit.",
		}),
		ref: Type.String({ description: "The admitted target's stable id/ref." }),
	},
	{ additionalProperties: false },
);

const METADATA_BUNDLE = Type.Optional(
	Type.String({
		description:
			"Owning bundle for namespace and attachment updates. Omit to use context.defaultBundle; manifest updates need none.",
	}),
);

/** A single ergonomic metadata update. `key` is a root metadata key or attachment namespace. */
export const SET_METADATA_UPDATE = Type.Union([
	Type.Object(
		{
			target: Type.Literal("manifest"),
			key: Type.String({ description: "Top-level [metadata] key to replace." }),
			value: Type.Unknown({
				description:
					"A JSON-compatible scalar, array, or object. Open metadata has no shared docs/UI schema.",
			}),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			target: Type.Literal("namespace"),
			key: Type.String({ description: "Namespace to register, e.g. 'mymod.hints'." }),
			value: Type.Object(
				{
					audience: Type.String({
						description: "Explicit namespace audience; no implicit default.",
					}),
					description: Type.Optional(Type.String()),
					on_demand: Type.Optional(
						Type.Boolean({
							description:
								"ADR-0130: reference content (rules text, creation data, docs) delivered only " +
								"to a client that subscribes public_reference_metadata, never to a play " +
								"session on connect. Defaults to false (kernel default) when omitted.",
						}),
					),
				},
				{ additionalProperties: false },
			),
		},
		{ additionalProperties: false },
	),
	Type.Object(
		{
			target: METADATA_ATTACHMENT_TARGET,
			key: Type.String({ description: "Registered metadata namespace for this annotation." }),
			value: OPEN_METADATA_OBJECT,
			source: Type.Optional(
				Type.String({ description: "Attachment source; defaults to 'manifest'." }),
			),
			audience: Type.Optional(
				Type.String({
					description: "Registers an absent namespace in this atomic call; never defaults.",
				}),
			),
			description: Type.Optional(
				Type.String({
					description: "Optional description when this call registers the namespace.",
				}),
			),
		},
		{ additionalProperties: false },
	),
]);

export type SetMetadataUpdate = Static<typeof SET_METADATA_UPDATE>;

/**
 * One generic metadata authoring surface, in singleton or explicit atomic-batch
 * form. The root stays a single object because OpenAI-backed hosts reject a
 * union at a tool-parameter root (sk-jay0.7.90); the singleton/batch split and
 * every target-specific `value` shape are enforced at call time against
 * `SET_METADATA_UPDATE`, which remains the authority on an update's shape.
 */
export const SET_METADATA_PARAMS = Type.Object(
	{
		bundle: METADATA_BUNDLE,
		target: Type.Optional(
			Type.Union(
				[Type.Literal("manifest"), Type.Literal("namespace"), METADATA_ATTACHMENT_TARGET],
				{
					description:
						"Singleton form: 'manifest' for a top-level [metadata] key, 'namespace' to register a namespace, " +
						"or {kind, ref} to attach metadata to an admitted target. Omit when passing updates[].",
				},
			),
		),
		key: Type.Optional(
			Type.String({
				description:
					"Singleton form: the top-level [metadata] key, or the metadata namespace for a registration or attachment.",
			}),
		),
		value: Type.Optional(
			Type.Unknown({
				description:
					"Singleton form: a JSON-compatible scalar, array, or object for target 'manifest'; " +
					"{audience, description?} for target 'namespace'; an open metadata object for an attachment target.",
			}),
		),
		source: Type.Optional(
			Type.String({
				description: "Attachment source for the singleton attachment form; defaults to 'manifest'.",
			}),
		),
		audience: Type.Optional(
			Type.String({
				description:
					"Singleton attachment form: registers an absent namespace in this atomic call; never defaults.",
			}),
		),
		description: Type.Optional(
			Type.String({
				description:
					"Singleton attachment form: optional description when this call registers the namespace.",
			}),
		),
		updates: Type.Optional(
			Type.Array(SET_METADATA_UPDATE, {
				minItems: 1,
				description:
					"Explicit atomic batch. Do not combine with singleton target/key/value fields; every update is validated before anything persists.",
			}),
		),
	},
	{ additionalProperties: false },
);

export type SetMetadataParams = Static<typeof SET_METADATA_PARAMS>;

export const DEFINE_BUNDLE_PARAMS = Type.Object({
	bundle_id: Type.String({
		description:
			"bundles.bundle_id — the bundle's own id (e.g. 'srd', 'core'). This verb authors the [[bundles]] " +
			"header row itself, so there is no separate `bundle` scoping param the way other define_* verbs have: " +
			"the row being defined IS the bundle.",
	}),
	depends_on: Type.Array(Type.String(), {
		description:
			"bundles.depends_on — REQUIRED and explicit on purpose (srd-cc executable finding #8): deliberateness " +
			"is the whole point of this verb over the auto-scaffold every other write verb falls back to (which " +
			"silently defaults to ['core']). Pass [] for a foundational, drop-in-identity bundle (mirroring " +
			"core's own depends_on = []), or the real dependency list otherwise.",
	}),
	display_name: Type.Optional(
		Type.String({
			description:
				"bundles.display_name. Omit to derive a title-cased `bundle_id` (#1968 smart default).",
		}),
	),
	version: Type.Optional(Type.String({ description: "bundles.version (default '1.0.0')." })),
	author: Type.Optional(
		Type.String({ description: "bundles.author (default 'spellkave-verb-tools')." }),
	),
	description: Type.Optional(
		Type.String({ description: "Sets the generated bundles row's own `description` column." }),
	),
	default_extent_shape_id: Type.Optional(
		Type.String({
			description:
				"bundles.default_extent_shape_id (place-node-extent D-2): the shape a place_node in this bundle " +
				"resolves its extent from when it authors none of its own (an area_shape_definition.shape_id " +
				"reference, e.g. 'core/area/cube'). Omit to leave the bundle without a default — every place_node " +
				"then MUST author its own explicit extent or fail admission.",
		}),
	),
	default_extent_params_json: Type.Optional(
		Type.String({
			description:
				"bundles.default_extent_params_json — the params_json paired with default_extent_shape_id (e.g. " +
				"'{\"extent_m\": 9}' for core/area/cube). Only meaningful alongside default_extent_shape_id.",
		}),
	),
});

export const DEFINE_TRACE_KIND_PLACE_PARAMS = Type.Object({
	node: Type.String({
		description:
			"place_node_traces.node_id — an already-authored place_node id (workspace, live, or the active " +
			"target) this call never creates. Rejected at commit if it does not resolve to a place_node " +
			"(sk-9ll.8: no more silent fallback to bundle 'core').",
	}),
});

export const DEFINE_TRACE_KIND_PARAMS = Type.Object({
	bundle: Type.Optional(
		Type.String({
			description:
				"bundle_id stamped on every generated row. Omit to fall back to `context.defaultBundle` (#1968 smart default).",
		}),
	),
	id: Type.String({ description: "Local trace-kind id stem; full id '<bundle>/<id>'." }),
	location_kinds: Type.Optional(
		Type.String({
			description:
				"trace_kind_definitions.location_kinds — comma-joined registered scopes this kind can attach " +
				'to (e.g. "place_node", or "place_node,location_definition"). Default \'place_node\' — the ' +
				"scope every corpus trace kind uses today, and the only scope `places[]` (below) can target.",
		}),
	),
	description: Type.Optional(
		Type.String({
			description:
				"trace_kind_definitions.description — human-readable, for authors and operator tooling. " +
				"Default ''.",
		}),
	),
	schema_json: Type.Optional(
		Type.String({
			description:
				"trace_kind_definitions.schema_json — canonical JSON schema for the trace payload (flat " +
				"object mapping a required key to its type name, '?' suffix marks it optional, e.g. " +
				'\'{"text":"string","addressee":"integer?"}\'). Default \'\' (no contract — most trace kinds ' +
				"carry no structured payload).",
		}),
	),
	perceptible_for_ticks: Type.Optional(
		Type.Number({
			description:
				"trace_kind_definitions.perceptible_for_ticks — how many ticks after inscription this kind " +
				"stays admissible to an ARRIVING observer (ADR-0040 seam B). Omit for unbounded (a standing " +
				"mark — footprints, a slime trail, a scorch); 0 = perceptible only at the moment of inscription " +
				"(an EVENT, not a mark — bead sk-n16).",
		}),
	),
	places: Type.Optional(
		Type.Array(DEFINE_TRACE_KIND_PLACE_PARAMS, {
			description:
				"place_node_traces rows binding this trace kind to already-authored place nodes as a standing, " +
				"ambient trace. Omit to author only the vocabulary.",
		}),
	),
});

export const EVAL_PARAMS = Type.Object(
	{
		expression: Type.String({
			description: "DSL source text to evaluate offline.",
		}),
		kind: Type.Union([Type.Literal("predicate"), Type.Literal("int"), Type.Literal("text")], {
			description: "Expression result kind: 'predicate', 'int', or 'text'.",
		}),
		facts: Type.Optional(
			Type.Record(Type.String(), Type.Unknown(), {
				description:
					"The values the expression reads, grouped by subject (actor, target, location, session, world, actor.wielded_item, equipped items, bindings, event), plus roll_tables, item_sources, roll_modifier_bias, event_kind, occupants_at, peers_near_target, channel_pools. Validated strictly in Rust.",
			}),
		),
		dice: Type.Optional(
			Type.Array(Type.Integer({ minimum: 1 }), {
				description:
					"Die faces in draw order consumed by stochastic roll operators and roll tables.",
			}),
		),
	},
	{ additionalProperties: false },
);

export const EXPLAIN_PARAMS = Type.Object({
	kind: Type.Union([
		Type.Literal("verb"),
		Type.Literal("persona"),
		Type.Literal("role"),
		Type.Literal("binding"),
		Type.Literal("capability"),
		Type.Literal("extent-kind"),
		Type.Literal("place"),
	]),
	id: Type.String(),
	target: Type.Optional(Type.Union([Type.Literal("files"), Type.Literal("live")])),
});

export const REMOVE_ENTITY_PARAMS = Type.Object(
	{
		entity_key: Type.String({
			minLength: 1,
			description:
				"Exact authored key of the placed entity to remove from the local root and staged scratch, e.g. my_adventure/torch. This edits files only; preview and apply world pruning separately.",
		}),
	},
	{ additionalProperties: false },
);
