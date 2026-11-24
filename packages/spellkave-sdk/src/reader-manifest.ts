// Host-neutral reader table manifests.
//
// Reader modules import this file at module load time to declare the tables they
// consume. Keep it free of live SpacetimeDB connection imports so pure replay
// bundles can use reader modules without pulling connection/reducer surfaces.

export type { SnapshotDb } from "./replay";

// Always-subscribed session singletons every reader implicitly depends on.
// Never declared by individual reader manifests — declaring them per-reader
// would be noise (D5, design.md:138-143).
export const CONNECTION_BASELINE = [
	"config",
	"world_time",
	"directly_controlled_actor_spatial_location",
] as const;

// Tables contributed by reader manifests (D2). Each reader that consumes one
// of these must declare it in its own `requiredTables` export. The D2
// completeness CI gate asserts every entry here has at least one declaring
// reader — silent dead subscriptions are a build error, not a runtime surprise.
export const READER_SCOPED_TABLES = [
	// `world_event` is private (#915 PR-8); the per-caller
	// `visible_world_event` dispatch view is the read model.
	"visible_world_event",
	// event_apply_consequence / event_resource_delta / event_actor_body_swapped
	// are private (ADR-0120, #915); readers declare the visible_* views below.
	"visible_event_apply_consequence",
	"visible_event_resource_delta",
	// event_condition_delta is private (ADR-0120, K-B Part B); the per-caller
	// visible_event_condition_delta view is the read model (same shape as
	// visible_event_resource_delta above).
	"visible_event_condition_delta",
	"visible_event_actor_body_swapped",
	"event_channel_spend",
	"event_boundary_fired",
	"event_channel_window_refresh",
	"event_action_recharge_fired",
	"visible_condition_boundary_expiry",
	// `economy_channel_spend` is private (ADR-0120, #915); the per-caller
	// `visible_economy_channel_spend` view is the current-window standing read
	// model (#2083/#2096) — cumulative `spent_ms`/`window_start_ms` per
	// channel, distinct from `event_channel_spend`'s per-spend delta above.
	"visible_economy_channel_spend",
	"visible_economy_channel_budget",
	"actor",
	// `actor_identity` is private (#915 PR-5, ADR-0084 D-5 Family 1); the
	// self-only view is what readers actually declare/subscribe.
	"visible_actor_identity",
	"visible_actor_driver_control",
	"visible_actor_control_transition",
	"visible_control_continuation",
	"visible_control_continuation_refusal",
	"visible_event_steering",
	// `seat`: public playable-seat catalog (sk-pka5.4, ADR-0102 D-2) — playable /
	// embodied / claimed per actor, never the occupant identity; declared by
	// core/readers/seats.ts (readSeats).
	"seat",
	"visible_actor_spatial_location",
	"entity",
	"owned_object_state",
	"visible_object_state",
	"visible_target_condition",
	"visible_manifest_authored_entity",
	"visible_manifest_authored_entity_coverage",
	"visible_place_node",
	"visible_place_edge",
	"visible_place_graph_definition",
	"visible_map_layer",
	// Public substrate catalog (indoor/outdoor class via coordinate_kind_id).
	// Declared by core/readers/substrate_definitions.ts for OSM export (ADR-0123).
	"substrate_definition",
	// visible_turn_state: per-caller view over the private turn-scheduler
	// singleton (sk-jay0.6.15.56.16.12.5.2.1; the raw `turn_state` moved here
	// from REPLAY_PANEL_TABLES under ADR-0093 D-6) — `readTurnState`
	// (core/readers/turn_state.ts) is its declaring reader. session_participant
	// is private (ADR-0057, sk-2qt); clients subscribe visible_session_participant
	// (session.ts, combat_session.ts).
	"visible_turn_state",
	"visible_session_participant",
	// "item" / "item_location" / "entity_inventory" / "manifest_authored_item" —
	// removed; dissolved in Phase 2 entity-unification (Items 3, 5, 13).
	// Items are now entity rows accessed via "visible_manifest_authored_entity".
	"action_definition",
	// ADR-0141: per-perceiver lifecycle/readiness generation and independently
	// disclosed action/target/participant facts for direct manipulation.
	"visible_manipulation_context",
	"visible_manipulation_available_action",
	"visible_manipulation_observed_target",
	"visible_manipulation_participant_context",
	"visible_manipulation_participant_binding",
	// ADR-0142 D-6: per-perceiver dialogue-prompt projection.
	"visible_manipulation_prompt",
	"visible_prompt_occurrence",
	"affordance_template",
	// `niche_definition` is public (actor-carried-verbs D1/D2); the `provider`
	// column names WHO offers the niche (`place`/`entity`/`actor`, empty =
	// `place` — `resolve_niche_provider`). Read for the affordances reader's
	// `provider` join (ledger/designs/play-interaction-axioms.md W1).
	"niche_definition",
	// Provider flags are the authored, open classification used by direct
	// manipulation-context readers to rank separately disclosed niche facts.
	"niche_provider_definition",
	// outcome_template: public Layer-3 definition table (like action_definition
	// above), read for its `description` column — the authored source of the
	// PLAYER manipulate/sensing observation narrative (#1968 B-9).
	"outcome_template",
	"visible_evaluation_provenance",
	// `pending_resolution` and its reactor working-set are private (ADR-0120);
	// subscribe the per-caller views.
	"visible_pending_resolution",
	"visible_pending_resolution_reactor",
	// The frozen stochastic-draw extension row for a parked pending_resolution
	// (post-roll intervention windows, #2058) — private, per-caller view.
	"visible_pending_stochastic_resolution",
	"reservation",
	// `session` is private (ADR-0057, sk-2qt); the per-caller
	// `visible_session` view is the participation-bounded read model.
	"visible_session",
	// Public authored turn semantics; runtime session state stays participant-scoped.
	"session_definition",
	// entity_tag / action_definition_tag: relational + action tags. Subscribed so
	// a host can read author-given tags (faction:*, combat/attack:*) for NPC-bot
	// decisioning without coupling to the raw binding accessor (world-explorer).
	"visible_entity_tag",
	"visible_entity_tag_coverage",
	"action_definition_tag",
	// `observer_knowledge` / `observer_place_knowledge` / `observer_trace_knowledge`
	// are private (ADR-0120, #915 sweep PR-2); the per-caller `visible_*` views
	// are the perception-bounded read models.
	"visible_observer_knowledge",
	"visible_observer_place_knowledge",
	"visible_observer_trace_knowledge",
	// `trace` is private (ADR-0120, #915); the per-caller `visible_trace` view is
	// the perception-bounded read model.
	"visible_trace",
	"capability_definition",
	// visible_capability: per-caller view (ADR-0120) over entity-bound
	// capability grants — subscribed so a player can perceive their own
	// trained capabilities (finding #11).
	"visible_capability",
	// `entity_equipment_slot` is private (ADR-0120, #915 PR-6); the per-caller
	// `visible_entity_equipment_slot` view is the owner/DM-extent-bounded read
	// model.
	"visible_entity_equipment_slot",
	"equipment_slot_definition",
	"resource_definition",
	// resource_definition_tag: authored tags on a pool definition (quest, currency,
	// …). Subscribed so readActorStates can surface a pool's tags — letting a player
	// perceive a `quest`-tagged objective on its own sheet (#1229).
	"resource_definition_tag",
	// entity_definition_tag: authored tags on an entity's definition (species,
	// class, background, …). Subscribed so readSelfSummary can surface an
	// actor's own identity tags — the SAME pattern as resource_definition_tag
	// above, applied to the sibling entity-definition tag table (#2094).
	"entity_definition_tag",
	"tag_capability_grant",
	// visible_entity_containment: post Phase 2 (entity-unification), items carried in
	// actor inventory appear here. Subscribed so SDK readers can expose
	// inventory state without coupling scripts to the raw binding accessor.
	"visible_entity_containment",
	"entity_description",
	// spatial_environment_state: room/edge-topology env-state (ADR-0056), the
	// carrier for the ActorReachableNodes N-hop fanout (ADR-0076). Private
	// (ADR-0120, #915 sweep PR-4); the per-caller visible_* view is the
	// bounded read model.
	"visible_spatial_environment_state",
	"visible_spatial_niche_attachment",
	// metadata_attachment is private (ADR-0130 D-1); clients read through
	// these two play views instead — `readMetadataAttachmentRows`
	// (`core/readers/metadata_rows.ts`) unions them. Subscribed so
	// `readSurfaceMembership` can join `ui.self_summary` slot/order
	// membership onto `resource_definition` rows for `readSelfSummary`'s
	// `vitals`/`quest` buckets (#2119) — the same "authored data, not a
	// magic literal" pattern as `resource_definition_tag` above.
	"public_metadata_attachment",
	"visible_metadata_attachment",
	// tag_value_definition: public bundle-authored catalog for exact tag
	// values (prefix + description). Subscribed so `readSelfIdentity` can
	// enrich an actor's own `entity_definition_tag` rows with authored
	// discovery prose (#2119 identity-out-of-summary move) — the detailed
	// "who am I" now living at `self_states kind=identity`.
	"tag_value_definition",
] as const;

// Known table names used by replay and panel manifests that are not part of the
// reader-scoped subscription baseline. Keep them out of READER_SCOPED_TABLES so
// the baseline-consumer gate still catches dead live subscriptions.
export const REPLAY_PANEL_TABLES = [
	// Public AUTHOR explain vocabulary; opted in by its catalog reader manifest.
	"role_definition",
	"role_aggregation",
	"visible_role_binding",
	"grant_inventory",
	"visible_place_seal",
	"visible_place_seal_break",
	"extent_kind_definition",
	"area_shape_definition",
	"visible_autonomy_job",
	// Direct arbitration participants opt into their recipient-authorized payloads.
	"visible_arbitration_request",
	"visible_arbitration_response",
	"visible_arbitration_rejection",
	"visible_arbitration_fallback",
	"coordinate_kind_definition",
	"event_autonomy_job",
	"place_edge_affordance",
	"visible_entity_location",
	"notable_events",
	"visible_event_create_entity",
	"visible_event_move",
	"visible_event_take",
	"visible_event_drop",
	"mod_bundle",
	// manifest_apply_digest / manifest_apply_outcome: drain-wait bookkeeping
	// (`connectTestWorld`'s `MANIFEST_SETUP_READER_MANIFEST` in `test-lab/live.ts`
	// plus sk/Pi/live-delta apply waiters, sk-0m4.45). Not a domain reader's
	// dependency — kept here rather than READER_SCOPED_TABLES.
	"manifest_apply_digest",
	// Private baseline memory is exposed only through exact-publisher views.
	"operator_manifest_applyset",
	"operator_manifest_applyset_part",
	"operator_manifest_applyset_export_hash",
	"manifest_apply_outcome",
	// Runtime-rendering DM seats validate authored deltas against these public
	// definition catalogs through a live AuthorTarget. Item detail also requests
	// entity/object-state definitions for authorized inventory prose and labels.
	// Reader manifests opt into these catalogs; the static baseline is unchanged.
	"entity_definition",
	"object_state_definition",
	// Authorized self-condition detail joins manifest-authored explanation text.
	"condition_definition",
	"modifier_target_definition",
	"dsl_macro_definition",
	// public_reference_metadata (ADR-0130 D-5/D-6): the `on_demand` public
	// view — rules text, creation data, docs. Play sessions never subscribe
	// it by default (D-4's whole point); reference consumers (character
	// creation, advancement, authoring tools) opt in explicitly, same
	// "reader manifests opt into these catalogs" pattern as the definition
	// catalogs above.
	"public_reference_metadata",
	// Seeded namespace vocabulary for runtime author validation.
	"metadata_namespace_definition",
	// ADR-0149 export view. Known so the reader may declare it. Not in the
	// strict baseline: connection.ts subscribes it only when the module lists it.
	"visible_observed_container_content",
	"visible_observed_container_coverage",
	"visible_manifest_export_result",
	"visible_manifest_apply_provenance",
	// Applyset prune D-8: definition seeds for the expected-set of a retracted entity.
	"entity_definition_initial_state",
	"entity_definition_initial_capability",
	"entity_definition_initial_condition",
	"entity_definition_initial_containment",
	"entity_definition_initial_equipment",
] as const;

/** Full subscription union. Temporary compat export — will be removed once
 * Session.connect() issues a single subscription from the manifest union. */
export const SUBSCRIBED_TABLES = [...CONNECTION_BASELINE, ...READER_SCOPED_TABLES] as const;

export const KNOWN_TABLES = [...SUBSCRIBED_TABLES, ...REPLAY_PANEL_TABLES] as const;

export const STRICT_TABLES = [...CONNECTION_BASELINE, ...READER_SCOPED_TABLES] as const;

/** Union of every subscribable table name known to this SDK. */
export type TableName = (typeof KNOWN_TABLES)[number];

/** Identity constraint: forces each entry in a `requiredTables` declaration
 * to be a known `TableName`, catching typos at the declaration site. */
export type RequiredTables<T extends readonly TableName[]> = T;

export interface ReaderManifest {
	requiredTables: readonly TableName[];
}

const _registeredManifests: ReaderManifest[] = [];

/** Register a reader's table manifest. Called at module load time by each
 * reader file. Phase 2 per-reader files call this; Phase 1 registry is empty. */
export function registerReaderManifest(manifest: ReaderManifest): void {
	_registeredManifests.push(manifest);
}

/** Union of all tables declared by registered reader manifests. */
export function getRegisteredReaderTables(): Set<string> {
	const result = new Set<string>();
	for (const m of _registeredManifests) {
		for (const t of m.requiredTables) {
			result.add(t);
		}
	}
	return result;
}

/**
 * The reader-table union `buildSubscribeSet()` (`connection.ts`) uses when a
 * caller passes NO `readerManifests` at all: `READER_SCOPED_TABLES` (the
 * hand-curated catalog the D2 completeness gate keeps in sync with every
 * reader's own declaration) unioned with `getRegisteredReaderTables()` (which
 * additionally carries tables a reader declares but that live outside that
 * curated list, e.g. `place_edge_affordance` via `scene.ts`).
 *
 * Exported so a caller that DOES need its own `readerManifests` — to widen
 * the subscription with a few extra tables on top of the default, e.g.
 * `WATCH_BUFFER_REQUIRED_TABLES` — can start from this instead of hand-
 * copying `READER_SCOPED_TABLES` (drifts silently) or, worse, supplying an
 * array with ONLY its own extra tables: `buildSubscribeSet` treats ANY
 * supplied `readerManifests` as a total REPLACEMENT of the default union, not
 * an addition to it (see that function's own doc comment and its "uses an
 * explicit reader-manifest set instead of the full reader-scoped union" test)
 * — a caller that forgets this silently narrows its own subscription to only
 * what it explicitly listed, plus `CONNECTION_BASELINE`. That is exactly what
 * happened to Play (sk-jay0.1.1.14 investigation of #3487): its `readerManifests`
 * carried only `WATCH_BUFFER_REQUIRED_TABLES`, so `visible_place_node`,
 * `visible_place_edge`, `place_edge_affordance` and every other default
 * reader-scoped table were never subscribed, leaving `readCurrentScene`
 * (`scene.ts`) permanently unable to resolve a scene for ANY actor.
 */
export function defaultReaderManifest(): ReaderManifest {
	return {
		requiredTables: Array.from(
			new Set<TableName>([
				...READER_SCOPED_TABLES,
				...(getRegisteredReaderTables() as Set<TableName>),
			]),
		),
	};
}

/**
 * Returns the names of any READER_SCOPED_TABLES entries not present in
 * `declaredTables`. Used by the baseline-consumer CI gate (tasks.md 1.4):
 * any missing entry means a subscribed table has no declaring reader.
 */
export function findUndeclaredBaselineTables(declaredTables: ReadonlySet<string>): string[] {
	return READER_SCOPED_TABLES.filter((t) => !declaredTables.has(t));
}
