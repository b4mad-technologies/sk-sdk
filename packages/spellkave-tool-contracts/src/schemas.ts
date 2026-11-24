import { Type } from "typebox";

export const SPELLKAVE_OFFER_CONTROL_TOOL = "spellkave_offer_control";
export const SPELLKAVE_WITHDRAW_CONTROL_TOOL = "spellkave_withdraw_control";
export const SPELLKAVE_TAKE_NPC_CONTROL_TOOL = "spellkave_take_npc_control";
export const SPELLKAVE_RETURN_NPC_CONTROL_TOOL = "spellkave_return_npc_control";
export const OFFER_CONTROL_PARAMS = Type.Object({
	identity: Type.String({
		minLength: 1,
		description:
			"Login identity to consent to steering this primary body; authority is still required.",
	}),
});
export const WITHDRAW_CONTROL_PARAMS = Type.Object({
	identity: Type.String({
		minLength: 1,
		description: "Login identity whose steering consent is withdrawn.",
	}),
});
const AS_BODY_PARAMS = {
	as_body_id: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"Observed non-presence body to act as using frontier.impersonate; the server checks scope and consent.",
		}),
	),
};
export const CONTROL_TOKEN_PARAMS = Type.Object({
	world_instance_id: Type.String({ minLength: 1 }),
	generation: Type.String({ pattern: "^[0-9]+$" }),
	actor_id: Type.String({ pattern: "^[0-9]+$" }),
	body_entity_id: Type.String({ pattern: "^[0-9]+$" }),
});
const ORIGINAL_CONTROL_TOKEN = { control_token: Type.Optional(CONTROL_TOKEN_PARAMS) };
export const TAKE_NPC_CONTROL_PARAMS = Type.Object({
	actor_id: Type.String({ pattern: "^[0-9]+$" }),
	presence_actor_id: Type.String({ pattern: "^[0-9]+$" }),
	world_instance_id: Type.String({ minLength: 1 }),
	expected_generation: Type.String({ pattern: "^[0-9]+$" }),
	request_id: Type.String({ minLength: 1, maxLength: 128 }),
	reason: Type.String({ minLength: 1, maxLength: 1024 }),
});
export const RETURN_NPC_CONTROL_PARAMS = Type.Object({
	actor_id: Type.String({ pattern: "^[0-9]+$" }),
	world_instance_id: Type.String({ minLength: 1 }),
	expected_generation: Type.String({ pattern: "^[0-9]+$" }),
	request_id: Type.String({ minLength: 1, maxLength: 128 }),
	reason: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const SPELLKAVE_STATUS_TOOL = "spellkave_status";
export const SPELLKAVE_EVENTS_TOOL = "spellkave_events";
export const SPELLKAVE_SELF_SUMMARY_TOOL = "spellkave_self_summary";
export const SPELLKAVE_SELF_STATES_TOOL = "spellkave_self_states";
export const SPELLKAVE_SCENE_TOOL = "spellkave_scene";
export const SPELLKAVE_SCENE_DETAIL_TOOL = "spellkave_scene_detail";
export const SPELLKAVE_INVENTORY_TOOL = "spellkave_inventory";
export const SPELLKAVE_ITEM_DETAIL_TOOL = "spellkave_item_detail";
export const SPELLKAVE_TRACES_TOOL = "spellkave_traces";
export const SPELLKAVE_TRACE_DETAIL_TOOL = "spellkave_trace_detail";
export const SPELLKAVE_SESSION_STATUS_TOOL = "spellkave_session_status";
export const SPELLKAVE_REACTION_OPTIONS_TOOL = "spellkave_reaction_options";
export const SPELLKAVE_REACT_OPTION_TOOL = "spellkave_react_option";
export const SPELLKAVE_INTERVENTION_WINDOWS_TOOL = "spellkave_intervention_windows";
export const SPELLKAVE_SUGGEST_NEXT_ACTION_TOOL = "spellkave_suggest_next_action";
export const SPELLKAVE_MOVE_TOOL = "spellkave_move";
// Renamed from spellkave_player_map (bead sk-due): player-facing tools are
// named for the THING, never the role — spellkave_scene, spellkave_inventory,
// spellkave_traces, spellkave_self_summary; this was the only one carrying a
// role prefix. "scene = what I see here, map = what I know of the world."
// The AUTHOR twin keeps its own name (spellkave_map_graph — "_graph" is
// right there, since an author looks at substrate structure, not knowledge).
export const SPELLKAVE_MAP_TOOL = "spellkave_map";
// bead sk-cdi: rebuild self/scene/session/factual action context/inventory + a paged
// window of traces in one call — the re-orientation an actor with no history
// (fresh conversation, reloaded world, restarted host) legitimately needs.
export const SPELLKAVE_ORIENT_TOOL = "spellkave_orient";

// Perceive tools (read-only) over existing @spellkave/sdk readers.
/** ADR-0137's additive action-independent discovery projection. */
export const SPELLKAVE_MANIPULATION_CONTEXT_TOOL = "spellkave_manipulation_context";
/** ADR-0141's factual, action-independent sensing discovery projection. */
export const SPELLKAVE_SENSE_CONTEXT_TOOL = "spellkave_sense_context";
export const SPELLKAVE_ENTITY_TOOL = "spellkave_entity";
export const SPELLKAVE_ENTITY_CONTAINER_TOOL = "spellkave_entity_container";
export const SPELLKAVE_OBSERVER_KNOWLEDGE_TOOL = "spellkave_observer_knowledge";
export const SPELLKAVE_OBSERVER_PLACE_KNOWLEDGE_TOOL = "spellkave_observer_place_knowledge";
export const SPELLKAVE_OBSERVER_TRACE_KNOWLEDGE_TOOL = "spellkave_observer_trace_knowledge";
export const SPELLKAVE_ENTITY_BODY_TOOL = "spellkave_entity_body";
export const SPELLKAVE_ACTOR_PRINCIPALS_TOOL = "spellkave_actor_principals";

// Act tools (invoke reducers) over existing @spellkave/sdk actor verbs.
export const SPELLKAVE_COMMUNICATE_TOOL = "spellkave_communicate";
export const SPELLKAVE_SENSE_TOOL = "spellkave_sense";
export const SPELLKAVE_SESSION_OPEN_TOOL = "spellkave_session_open";
export const SPELLKAVE_SESSION_CLOSE_TOOL = "spellkave_session_close";
export const SPELLKAVE_SESSION_MOVE_TOOL = "spellkave_session_move";
export const SPELLKAVE_END_TURN_TOOL = "spellkave_end_turn";
export const SPELLKAVE_MANIPULATE_TOOL = "spellkave_manipulate";
export const SPELLKAVE_RELEASE_CLAIM_TOOL = "spellkave_release_claim";
export const SPELLKAVE_WAKE_UP_TOOL = "spellkave_wake_up";

export const STATUS_PARAMS = Type.Object({});

/** Read the caller-scoped factored manipulation context; no reducer is invoked. */
export const MANIPULATION_CONTEXT_PARAMS = Type.Object({
	...AS_BODY_PARAMS,

	detail: Type.Optional(
		Type.Union([Type.Literal("summary"), Type.Literal("full")], {
			description:
				'Optional, default "summary": prompts[], targets[], participants[], the most relevant action rows (answers to open prompts first, then authored cues and defaults, then input forms, then alphabetical) as composition syntax, and more_action_ids naming every other action. "full" returns every action row with provider flags, template ids, groups and tags; it grows with the actor\'s capabilities (100 KB for a spellcaster) and is meant for programmatic readers.',
		}),
	),
	action_ids: Type.Optional(
		Type.Array(Type.String({ minLength: 1 }), {
			maxItems: 25,
			description:
				"Optional, summary only: action ids (from more_action_ids, a prompt's response_action_ids, or a hint) whose syntax rows to return first in actions[]. Ids the listing does not hold come back in unknown_action_ids.",
		}),
	),

	wait_for_prompt_ms: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 30000,
			description:
				"Optional. When prompts[] holds no open, unanswered prompt yet, wait up to this many milliseconds for one to open before returning (a prompt opens one to three ticks after the answer that leads to it). Returns as soon as one opens, or at the deadline with prompts[] as it is then; the host may cap the wait. Omit for an immediate read.",
		}),
	),
});

export const SENSE_CONTEXT_PARAMS = Type.Object({});

export const SELF_SUMMARY_PARAMS = Type.Object({});

export const SCENE_TARGETS_PARAMS = Type.Object({
	kind: Type.Optional(
		Type.Union(
			[Type.Literal("actor"), Type.Literal("entity"), Type.Literal("exit"), Type.Literal("trace")],
			{
				description: "Optional scene target kind filter.",
			},
		),
	),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Rows per page." })),
	cursor: Type.Optional(Type.String({ description: "Opaque next_cursor from the prior page." })),
	wait_for_arrival_ms: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 30000,
			description:
				"Optional. While you are on a journey (a move that takes several ticks), wait up to this many milliseconds for it to end, then answer with the scene as it is then. Returns at once when you are not travelling; the host may cap the wait, and journey_wait says how it ended. Use this instead of re-reading the scene or the session status until you arrive.",
		}),
	),
});

export const SCENE_DETAIL_PARAMS = Type.Object({
	rev: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"With handle: the target's OWN rev, copied verbatim from its row in spellkave_scene — not the listing envelope's top-level rev (stable per-target handles, freshness gated per target). Omit when addressing by target_id.",
		}),
	),
	handle: Type.Optional(
		Type.String({
			minLength: 2,
			description:
				"Stable scene target handle, e.g. s:exit:32 or s:actor:7 — copied from spellkave_scene. Pass with rev, or pass target_id instead.",
		}),
	),
	target_id: Type.Optional(
		Type.String({
			minLength: 3,
			description:
				"Alternative addressing, the same typed id spellkave_manipulate and spellkave_communicate take (entity:156, item:157, actor:7): reads a current scene target or an item:N child disclosed through an exposed container, and returns its rev. One of {handle, rev} or target_id.",
		}),
	),
});

export const MAP_PARAMS = Type.Object({
	graph: Type.Optional(
		Type.String({
			description:
				"Optional map id — when set, draw that map restricted to places " +
				"the connected actor has already seen. " +
				"Omit and the map picks for you: while you are in a fight that opened a " +
				"tactical grid, it draws THAT grid composed over the location you are fighting " +
				"in (backdrop art plus the room's own layout, combat cells on top); " +
				"otherwise it composes every known outdoor map. " +
				"Naming a map explicitly always wins — pass the location's own id to see the " +
				"region while a fight is open, or compose_parent=false for the bare grid.",
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
					"How to project multi-floor / unpositioned maps: elevation_band (one floor), " +
					"all_floors_offset (floors side-by-side), topology_only (adjacency layout), metric (all z in one plane), " +
					"h3_world (outdoor maps laid out geographically). Omit for auto.",
			},
		),
	),
	compose_parent: Type.Optional(
		Type.Boolean({
			description:
				"Default true. When the selected map is a battle grid (including an automatically selected one), " +
				"the grid draws composed over its parent location's " +
				"own known layout (and, for output_type='jpg', the parent's backdrop art too) — " +
				"one picture, the battle grid in room context. Has no effect for a non-grid map. " +
				"Set false for the grid alone " +
				"when you specifically want just the battle grid with no surrounding room.",
		}),
	),
	z: Type.Optional(
		Type.Number({
			description:
				"Elevation for slice=elevation_band. Omit to use the anchor floor for a battle grid " +
				"composed over its parent location; otherwise defaults to 0. An explicit z always wins.",
		}),
	),
	z_tolerance: Type.Optional(
		Type.Number({
			description: "Half-width of elevation_band in elevation units (default 0.5).",
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
					"Which single artifact to render — the engine computes ONLY this one. 'utf8' box-" +
					"drawing text, 'ascii' 7-bit text, 'braille' dense-dot text — each returned " +
					"in the like-named details field. 'inventory' skips the picture entirely, " +
					"details.inventory only. 'svg' (default) returns the raw SVG string in details.svg (and, when " +
					"the host renders tool-result images, an inline picture). " +
					"'jpg' writes a backdrop-composed JPEG to output_dir/output_name and returns its " +
					"path as details.jpg_path — no svg/ascii/utf8/braille text in the response at all.",
			},
		),
	),
	output_dir: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"output_type='jpg' only; ignored otherwise. Host-supplied directory to write the " +
				"map-art JPEG into — absolute, or RELATIVE to the host process's own cwd. " +
				"A relative value resolves against process.cwd() for the " +
				"write, and is echoed back UNCHANGED — never resolved — in details.jpg_path, so a " +
				"caller recording a portable artifact never leaks its own machine-local checkout " +
				"path. Optional: omit for a fresh temp directory — a caller that just " +
				"wants 'a JPEG, anywhere' does not have to invent a path. Backdrop art is " +
				"drawn in full (the map on top stays scoped to places already seen, but the " +
				"backdrop itself is NOT masked, so it may show rooms not yet discovered).",
		}),
	),
	output_name: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"output_type='jpg' only; ignored otherwise. Base filename (no extension) for the " +
				"JPEG written under output_dir, e.g. 'arrival'. Optional: omit for a " +
				"name derived from graph, or 'map' " +
				"when graph itself is also omitted.",
		}),
	),
});

export const INVENTORY_PARAMS = Type.Object({
	kind: Type.Optional(
		Type.String({
			description: "Optional exact authored entity kind filter. Forces the flat paged list.",
		}),
	),
	name_prefix: Type.Optional(
		Type.String({
			description: "Optional case-insensitive item-name prefix filter. Forces the flat paged list.",
		}),
	),
	limit: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: 100,
			description:
				"Maximum items per page, and the unfiltered grouped-tree threshold. Defaults to 50.",
		}),
	),
	cursor: Type.Optional(
		Type.String({
			description: "Opaque next_cursor from a prior paged response. Forces the flat paged list.",
		}),
	),
});

export const ITEM_DETAIL_PARAMS = Type.Object({
	rev: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"With handle: the item's OWN rev, copied verbatim from its row in spellkave_inventory — not the listing envelope's top-level rev (stable per-item handles, freshness gated per item). Omit when addressing by target_id.",
		}),
	),
	handle: Type.Optional(
		Type.String({
			minLength: 2,
			description:
				"Stable inventory item handle, e.g. i:42 — copied from spellkave_inventory. Pass with rev, or pass target_id instead.",
		}),
	),
	target_id: Type.Optional(
		Type.String({
			minLength: 3,
			description:
				"Alternative addressing, the same typed id spellkave_manipulate takes (item:157 or entity:157): the current inventory row for that item is read without a rev, and its rev is returned. One of {handle, rev} or target_id.",
		}),
	),
});

export const SESSION_STATUS_PARAMS = Type.Object({
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 100,
			description: "Ongoing sessions per page; implies detail.",
		}),
	),
	cursor: Type.Optional(
		Type.String({
			description:
				"Continuation from ongoing.next_cursor; implies detail. Restart without cursor if the list changes.",
		}),
	),
	detail: Type.Optional(
		Type.Boolean({
			description:
				"Include authorized operation details and world-tick timing, including initiated and external-wait phases.",
		}),
	),
	session_id: Type.Optional(
		Type.String({
			pattern: "^[0-9]+$",
			description:
				"Read details for a previously observed session, including its terminal state. Requires participation; implies detail.",
		}),
	),
});

export const REACTION_OPTIONS_PARAMS = Type.Object({
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Rows per page." })),
	cursor: Type.Optional(Type.String({ description: "Opaque next_cursor from the prior page." })),
});

export const INTERVENTION_WINDOWS_PARAMS = Type.Object({
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Rows per page." })),
	cursor: Type.Optional(Type.String({ description: "Opaque next_cursor from the prior page." })),
});

export const REACT_OPTION_PARAMS = Type.Object({
	rev: Type.String({
		minLength: 1,
		description:
			"Current reaction-window or intervention-window revision (matches the handle's domain).",
	}),
	handle: Type.String({
		minLength: 2,
		description:
			"A handle from spellkave_reaction_options (e.g. r2) or spellkave_intervention_windows (e.g. w0).",
	}),
	response_intent: Type.String({
		minLength: 1,
		description: "Authored or free-text response intent passed to the typed reaction reducer.",
	}),
	selected_draw_index: Type.Optional(
		Type.Number({
			minimum: 0,
			description:
				"Intervention windows only: the index (into that window's `faces`) of the already-drawn face to replace. Omit to decline — the original result stands and nothing is spent. Providing an index accepts: it spends the window's fuel resource and replaces exactly that one face; the new roll must then be used. Ignored (and should be omitted) for a plain spellkave_reaction_options seat.",
		}),
	),
});

export const TRACE_ENTRIES_PARAMS = Type.Object({
	kind: Type.Optional(Type.String({ description: "Optional exact authored trace kind." })),
	kind_prefix: Type.Optional(Type.String({ description: "Optional authored trace-kind prefix." })),
	inscribed_by: Type.Optional(Type.String({ description: "Optional exact inscriber id." })),
	visibility: Type.Optional(Type.String({ description: "Optional exact visibility class." })),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Rows per page." })),
	cursor: Type.Optional(Type.String({ description: "Opaque next_cursor from the prior page." })),
});

// bead sk-cdi Scope B: traces page by CURSOR, most-recent-first, small
// default (see `ORIENT_TRACES_DEFAULT_LIMIT`/`ORIENT_TRACES_MAX_LIMIT` in
// tools.ts for the justification) — never a fixed time window, and never the
// whole history in one call.
export const ORIENT_PARAMS = Type.Object({
	cursor: Type.Optional(
		Type.String({
			description:
				"Opaque traces.next_cursor from a prior spellkave_orient call — fetches the NEXT (older) page of traces. Omit for the first call: the most recent page, which stands alone as a usable orientation.",
		}),
	),
	limit: Type.Optional(
		Type.Number({
			minimum: 1,
			maximum: 25,
			description:
				"Traces per page (default 10, max 25). Going further back costs more calls, deliberately — recall should cost turns, not one unbounded dump.",
		}),
	),
});

export const TRACE_DETAIL_PARAMS = Type.Object({
	rev: Type.String({
		minLength: 1,
		description:
			"The trace's OWN rev, copied verbatim from its row in spellkave_traces — not the listing envelope's top-level rev (stable per-trace handles, freshness gated per trace).",
	}),
	handle: Type.String({
		minLength: 2,
		description: "Stable trace handle, e.g. t:4 — copied from spellkave_traces.",
	}),
});

export const SELF_STATES_PARAMS = Type.Object({
	kind: Type.Optional(
		Type.Union(
			[
				Type.Literal("state"),
				Type.Literal("condition"),
				Type.Literal("capability"),
				Type.Literal("evaluation"),
				Type.Literal("economy"),
				Type.Literal("economy_budget"),
				Type.Literal("identity"),
			],
			{
				description: "Self-sheet row kind. Defaults to state.",
			},
		),
	),
	state_prefix: Type.Optional(
		Type.String({ description: "Exact state_id prefix filter; valid only for kind=state." }),
	),
	state_tag: Type.Optional(
		Type.String({ description: "Exact authored resource tag filter; valid only for kind=state." }),
	),
	provenance_id: Type.Optional(
		Type.String({
			description:
				"Exact provenance_id filter; valid only for kind=evaluation. Returns matched 1 and the row, or matched 0.",
		}),
	),
	limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100, description: "Rows per page." })),
	cursor: Type.Optional(Type.String({ description: "Opaque next_cursor from the prior page." })),
});

export const EVENTS_PARAMS = Type.Object({
	limit: Type.Optional(
		Type.Number({
			description: "Maximum number of recent events to read.",
			minimum: 1,
			maximum: 100,
		}),
	),
});

export const SUGGEST_NEXT_ACTION_PARAMS = Type.Object({
	entity_ref: Type.String({
		description:
			"EntityRef of the perceiver body to suggest for — not `Actor.actor_id` (the steering principal). Accepts a bare numeric entity id (`42`), `entity:42`, `item:42` (an item is still an entity row; same numeric id), or a manifest key suffix (`core/player`).",
		minLength: 1,
	}),
});

// T7 (act_scene -> spellkave_move rename): exactly one addressing mode.
// Preferred mode: {rev, handle}, a revision-bound exit handle copied from
// spellkave_scene. Compatibility mode: {edge_id}, a raw place_edge id for
// general/operator callers that do not go through spellkave_scene at all
// (absorbed from the deprecated raw spellkave_move wrapper). The run
// function, not this schema, enforces "exactly one" — TypeBox has no
// first-class XOR-of-optional-groups shape.
export const MOVE_PARAMS = Type.Object({
	...AS_BODY_PARAMS,
	...ORIGINAL_CONTROL_TOKEN,

	rev: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"Scene-handle mode: the exit's OWN rev, copied verbatim from its row in spellkave_scene — not the listing envelope's top-level rev. Required together with handle; omit both and pass edge_id instead for the adjacent-exit mode.",
		}),
	),
	handle: Type.Optional(
		Type.String({
			minLength: 2,
			description:
				"Scene-handle mode: stable scene exit handle, e.g. s:exit:32, from spellkave_scene. Required together with rev; omit both and pass edge_id instead for the adjacent-exit mode.",
		}),
	),
	edge_id: Type.Optional(
		Type.String({
			minLength: 1,
			description:
				"Adjacent-exit mode: identifier of an adjacent exit from where you are. Prefer rev+handle instead — this mode exists when you do not have a scene handle.",
		}),
	),
	wait_for_arrival_ms: Type.Optional(
		Type.Number({
			minimum: 0,
			maximum: 30000,
			description:
				'Optional, scene-handle mode. A move longer than your reach becomes a journey of several ticks (outcome "travelling"). With this field the call waits up to that many milliseconds for the journey to end and then returns the arrival observation; journey says whether you arrived, were stopped elsewhere, or are still travelling (the host may cap the wait). Without it the call returns as soon as the journey starts.',
		}),
	),
});

export const ENTITY_PARAMS = Type.Object({
	entity_id: Type.String({
		description:
			"Entity identifier (numeric id, 'entity:N', or a manifest key). Returns its identity row — entity_def_id, name, kind, and stack quantity — or null if it does not resolve. General-purpose quantity surface outside the PLAYER inventory flow (spellkave_inventory and spellkave_item_detail also carry quantity); spellkave_entity_container returns containment only, never quantity.",
		minLength: 1,
	}),
});

export const ENTITY_CONTAINER_PARAMS = Type.Object({
	entity_id: Type.String({
		description:
			"Contained entity identifier. Returns the container that holds it, or null if it is not contained.",
		minLength: 1,
	}),
});

export const OBSERVER_KNOWLEDGE_PARAMS = Type.Object({
	observer_id: Type.String({
		description:
			"Observer body entity identifier. Returns what that body has perceived (entities, action facts, traces).",
		minLength: 1,
	}),
});

export const OBSERVER_PLACE_KNOWLEDGE_PARAMS = Type.Object({
	observer_id: Type.String({
		description:
			"Observer body entity identifier. Returns the place nodes that body has perceived.",
		minLength: 1,
	}),
});

export const OBSERVER_TRACE_KNOWLEDGE_PARAMS = Type.Object({
	observer_id: Type.String({
		description:
			"Observer body entity identifier. Returns the inscribed-trace knowledge that body has perceived (seam A + seam B — ADR-0040).",
		minLength: 1,
	}),
});

export const ENTITY_BODY_PARAMS = Type.Object({
	entity_id: Type.String({
		description: "Entity identifier. Returns its body row, or null if it has none.",
		minLength: 1,
	}),
});

export const ACTOR_PRINCIPALS_PARAMS = Type.Object({});

export const COMMUNICATE_PARAMS = Type.Object({
	target_id: Type.String({
		description:
			"Typed target reference to communicate with — use an observed participant or location reference (e.g. 'entity:42'). The world authoritatively validates the attempt; a bare numeric id is ambiguous and may be rejected or misresolved.",
		minLength: 1,
	}),
	speech_act_id: Type.String({ description: "Speech-act identifier to perform.", minLength: 1 }),
	utterance: Type.Optional(
		Type.String({
			description:
				"Optional words to say. On acceptance they are delivered to the world as dispatch_text, echoed in the receipt, and may open the bounded reply window.",
		}),
	),
	args_json: Type.Optional(
		Type.String({
			description:
				"Optional JSON argument blob, passed 1:1 to the world. Defaults to '{}'. For an authored session opener, participant_entity_ids is a nonempty list of up to 64 distinct runtime body ids; the session definition and grid remain authored, and older modules refuse this argument before dispatch. For an action that creates an entity, definition_ref names an allowed definition; the world checks the choice against the action's authored limits. A prompt-bound answer (a speech_act_id listed in a prompts[] row's responseActionIds in spellkave_manipulation_context, e.g. dm/dialog/choice/2) must carry that prompts[] row here as {\"semantic_context\": <row>}; without it the world rejects the answer with prompt_context_required.",
		}),
	),
});

export const SESSION_OPEN_PARAMS = Type.Object({
	session_def_id: Type.String({
		description: "Session definition identifier to open.",
		minLength: 1,
	}),
	participants_csv: Type.Optional(
		Type.String({
			description:
				"Optional comma-separated participant body ids the caller directly controls. Defaults to empty.",
		}),
	),
});

export const SESSION_CLOSE_PARAMS = Type.Object({
	control_tokens: Type.Optional(
		Type.Array(CONTROL_TOKEN_PARAMS, {
			minItems: 1,
			maxItems: 64,
			description:
				"Original control observations for every Service participant you directly drive. Copy the observations from the decision snapshot; stale, missing or held observations refuse the whole close before any effects.",
		}),
	),
	session_id: Type.Number({ description: "Session id to close.", minimum: 0 }),
	outcome: Type.String({
		description: "Terminal session outcome: completed, abandoned, or failed.",
		minLength: 1,
	}),
});

export const SESSION_MOVE_PARAMS = Type.Object({
	session_id: Type.Number({ description: "Session id to advance.", minimum: 0 }),
	move_template_id: Type.String({
		description: "Move template identifier to submit.",
		minLength: 1,
	}),
});

export const END_TURN_PARAMS = Type.Object({});

export const MANIPULATE_PARAMS = Type.Object({
	...AS_BODY_PARAMS,
	...ORIGINAL_CONTROL_TOKEN,

	target_id: Type.String({
		description:
			"Typed target reference to manipulate — prefer target_ref from spellkave_manipulation_context when it is ready (e.g. 'entity:42', 'item:7'). Direct typed attempts remain allowed; the world authoritatively validates them. A bare numeric id is ambiguous (defaults to entity) and will misresolve a contained item's location, e.g. rejecting a self-targeted item use as out_of_range (#1838). A carried item is an item: target; the inventory handle 'i:7' is read as 'item:7'.",
		minLength: 1,
	}),
	action_id: Type.String({
		description:
			"Open authored action identifier to attempt against the target — prefer action_id from spellkave_manipulation_context when it is ready; it is discovery data, not an eligibility guarantee.",
		minLength: 1,
	}),
	args_json: Type.Optional(
		Type.String({
			description:
				"Optional JSON argument blob, passed 1:1 to the world. Defaults to '{}'. For an authored session opener, participant_entity_ids is a nonempty list of up to 64 distinct runtime body ids; the session definition and grid remain authored, and older modules refuse this argument before dispatch. For an action that creates an entity, definition_ref names an allowed definition; the world checks the choice against the action's authored limits. May include participant_context (an mpc:<id> token from spellkave_manipulation_context.participants) when the action has more than one disclosed participant binding. A prompt-bound action (an action_id listed in a prompts[] row's responseActionIds in spellkave_manipulation_context) must carry that prompts[] row here as {\"semantic_context\": <row>}; without it the world rejects the attempt with prompt_context_required.",
		}),
	),
	participant_context: Type.Optional(
		Type.String({
			description:
				"Optional mpc:<id> token from spellkave_manipulation_context.participants for this action. Required when the ready context lists more than one participant row for the action (e.g. Load with two bolts). May also be placed inside args_json; the two must agree.",
			minLength: 1,
		}),
	),
});

/** Direct sensing is a typed attempt. `spellkave_sense_context` supplies
 * factual query syntax; the server freshly selects and authorizes it. */
export const SENSE_PARAMS = Type.Object({
	...AS_BODY_PARAMS,
	...ORIGINAL_CONTROL_TOKEN,

	query_kind: Type.String({
		description:
			"Authored sensing query identifier from spellkave_sense_context (for example 'look'). The server authoritatively selects and validates it.",
		minLength: 1,
	}),
	visibility: Type.String({
		description: "Authored visibility class from spellkave_sense_context (for example 'Local').",
		minLength: 1,
	}),
});

export const RELEASE_CLAIM_PARAMS = Type.Object({
	target_id: Type.String({
		description:
			"Target entity identifier whose claim/lock this actor releases (multiplayer contention).",
		minLength: 1,
	}),
});

export const WAKE_UP_PARAMS = Type.Object({});

export const READ_ONLY_TOOL_NAMES = [
	SPELLKAVE_STATUS_TOOL,
	SPELLKAVE_EVENTS_TOOL,
	SPELLKAVE_SUGGEST_NEXT_ACTION_TOOL,
	SPELLKAVE_MANIPULATION_CONTEXT_TOOL,
	SPELLKAVE_SENSE_CONTEXT_TOOL,
	SPELLKAVE_ENTITY_CONTAINER_TOOL,
	SPELLKAVE_OBSERVER_KNOWLEDGE_TOOL,
	SPELLKAVE_OBSERVER_PLACE_KNOWLEDGE_TOOL,
	SPELLKAVE_OBSERVER_TRACE_KNOWLEDGE_TOOL,
	SPELLKAVE_TRACES_TOOL,
	SPELLKAVE_TRACE_DETAIL_TOOL,
	SPELLKAVE_SESSION_STATUS_TOOL,
	SPELLKAVE_REACTION_OPTIONS_TOOL,
	SPELLKAVE_INTERVENTION_WINDOWS_TOOL,
	SPELLKAVE_ENTITY_BODY_TOOL,
	SPELLKAVE_ACTOR_PRINCIPALS_TOOL,
] as const;

export const TOOL_SCHEMAS = {
	[SPELLKAVE_STATUS_TOOL]: STATUS_PARAMS,
	[SPELLKAVE_EVENTS_TOOL]: EVENTS_PARAMS,
	[SPELLKAVE_SUGGEST_NEXT_ACTION_TOOL]: SUGGEST_NEXT_ACTION_PARAMS,
	[SPELLKAVE_MOVE_TOOL]: MOVE_PARAMS,
	[SPELLKAVE_MANIPULATION_CONTEXT_TOOL]: MANIPULATION_CONTEXT_PARAMS,
	[SPELLKAVE_SENSE_CONTEXT_TOOL]: SENSE_CONTEXT_PARAMS,
	[SPELLKAVE_ENTITY_TOOL]: ENTITY_PARAMS,
	[SPELLKAVE_ENTITY_CONTAINER_TOOL]: ENTITY_CONTAINER_PARAMS,
	[SPELLKAVE_OBSERVER_KNOWLEDGE_TOOL]: OBSERVER_KNOWLEDGE_PARAMS,
	[SPELLKAVE_OBSERVER_PLACE_KNOWLEDGE_TOOL]: OBSERVER_PLACE_KNOWLEDGE_PARAMS,
	[SPELLKAVE_OBSERVER_TRACE_KNOWLEDGE_TOOL]: OBSERVER_TRACE_KNOWLEDGE_PARAMS,
	[SPELLKAVE_TRACES_TOOL]: TRACE_ENTRIES_PARAMS,
	[SPELLKAVE_TRACE_DETAIL_TOOL]: TRACE_DETAIL_PARAMS,
	[SPELLKAVE_SESSION_STATUS_TOOL]: SESSION_STATUS_PARAMS,
	[SPELLKAVE_REACTION_OPTIONS_TOOL]: REACTION_OPTIONS_PARAMS,
	[SPELLKAVE_INTERVENTION_WINDOWS_TOOL]: INTERVENTION_WINDOWS_PARAMS,
	[SPELLKAVE_REACT_OPTION_TOOL]: REACT_OPTION_PARAMS,
	[SPELLKAVE_ENTITY_BODY_TOOL]: ENTITY_BODY_PARAMS,
	[SPELLKAVE_ACTOR_PRINCIPALS_TOOL]: ACTOR_PRINCIPALS_PARAMS,
	[SPELLKAVE_COMMUNICATE_TOOL]: COMMUNICATE_PARAMS,
	[SPELLKAVE_SENSE_TOOL]: SENSE_PARAMS,
	[SPELLKAVE_SESSION_OPEN_TOOL]: SESSION_OPEN_PARAMS,
	[SPELLKAVE_SESSION_CLOSE_TOOL]: SESSION_CLOSE_PARAMS,
	[SPELLKAVE_SESSION_MOVE_TOOL]: SESSION_MOVE_PARAMS,
	[SPELLKAVE_END_TURN_TOOL]: END_TURN_PARAMS,
	[SPELLKAVE_MANIPULATE_TOOL]: MANIPULATE_PARAMS,
	[SPELLKAVE_RELEASE_CLAIM_TOOL]: RELEASE_CLAIM_PARAMS,
	[SPELLKAVE_WAKE_UP_TOOL]: WAKE_UP_PARAMS,
} as const;

export * from "./authoring-schemas";
export * from "./authoring-tool-names";

export const SPELLKAVE_PACE_TIME_TOOL = "spellkave_pace_time";
export const PACE_TIME_PARAMS = Type.Object(
	{
		op: Type.Union([
			Type.Literal("pause"),
			Type.Literal("resume"),
			Type.Literal("step"),
			Type.Literal("interval"),
		]),
		ticks: Type.Optional(Type.Integer({ minimum: 1, maximum: 10000 })),
		seconds: Type.Optional(Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
	},
	{ additionalProperties: false },
);

export * from "./grant-schemas";

export const ACTING_CONTEXT_PARAMS = Type.Object(
	{
		binding_id: Type.Optional(
			Type.String({
				description:
					"Select a currently caller-owned presence binding. Omit to list your contexts.",
			}),
		),
		character: Type.Optional(
			Type.Boolean({
				description: "Select your primary character. Mutually exclusive with binding_id.",
			}),
		),
	},
	{ additionalProperties: false },
);

export * from "./scene-schemas";
