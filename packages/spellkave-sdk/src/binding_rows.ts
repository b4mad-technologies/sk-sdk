// Row types derived from the live DbConnection accessor, not from the generator's
// `.name("snake_case")` metadata. The `.name(...)` annotation is BSATN wire-format
// only — runtime field keys from iter() are always camelCase. See:
// repos/SpacetimeDB/crates/bindings-typescript/src/sdk/table_cache.ts (iter signature).
import type { DbConnection } from "@spellkave/bindings";

// biome-ignore lint/suspicious/noExplicitAny: pre-existing debt from #1368 biome onboarding, tracked in #1455
type IterRow<T extends { iter(): Iterator<any, any> }> =
	// biome-ignore lint/suspicious/noExplicitAny: pre-existing debt from #1368 biome onboarding, tracked in #1455
	ReturnType<T["iter"]> extends Iterator<infer R, any> ? R : never;

export type ActorSpatialLocationRow = IterRow<DbConnection["db"]["visible_actor_spatial_location"]>;
export type EntityLocationRow = IterRow<DbConnection["db"]["visible_entity_location"]>;
export type ActorRow = IterRow<DbConnection["db"]["actor"]>;
// `actor_identity` is private (#915 PR-5); `visible_actor_identity` is its
// self-only view (ADR-0084 D-5 Family 1 shape).
export type VisibleActorIdentityRow = IterRow<DbConnection["db"]["visible_actor_identity"]>;
export type SeatRow = IterRow<DbConnection["db"]["seat"]>;
export type EntityRow = IterRow<DbConnection["db"]["entity"]>;
export type EntityDefinitionRow = IterRow<DbConnection["db"]["entity_definition"]>;
export type ObjectStateDefinitionRow = IterRow<DbConnection["db"]["object_state_definition"]>;
export type ObjectStateRow = IterRow<DbConnection["db"]["visible_object_state"]>;
export type SessionRow = IterRow<DbConnection["db"]["visible_session"]>;
export type SessionDefinitionRow = IterRow<DbConnection["db"]["session_definition"]>;
export type SessionParticipantRow = IterRow<DbConnection["db"]["visible_session_participant"]>;
export type TurnStateRow = IterRow<DbConnection["db"]["visible_turn_state"]>;
export type PendingResolutionRow = IterRow<DbConnection["db"]["visible_pending_resolution"]>;
export type PendingResolutionReactorRow = IterRow<
	DbConnection["db"]["visible_pending_resolution_reactor"]
>;
// The frozen stochastic-draw extension row for a parked pending_resolution
// (post-roll intervention windows, #2058) — sibling of PendingResolutionRow,
// joined by pending_id. Present only for a stochastically-resolved action.
export type PendingStochasticResolutionRow = IterRow<
	DbConnection["db"]["visible_pending_stochastic_resolution"]
>;
export type EntityTagRow = IterRow<DbConnection["db"]["visible_entity_tag"]>;
// entity_definition_tag: authored tags on an entity's DEFINITION (species,
// class, background, …), keyed by entity_def_id — distinct from `entity_tag`
// above, which tags an individual entity INSTANCE (#2094).
export type TagCapabilityGrantRow = IterRow<DbConnection["db"]["tag_capability_grant"]>;
export type EntityDefinitionTagRow = IterRow<DbConnection["db"]["entity_definition_tag"]>;
export type ActionDefinitionTagRow = IterRow<DbConnection["db"]["action_definition_tag"]>;
export type TargetConditionRow = IterRow<DbConnection["db"]["visible_target_condition"]>;
export type EntityDescriptionRow = IterRow<DbConnection["db"]["entity_description"]>;
export type ManifestAuthoredEntityRow = IterRow<
	DbConnection["db"]["visible_manifest_authored_entity"]
>;
// ADR-0139's private per-perceiver context is delivered only through this
// caller-scoped view. The deprecated descriptor satellite intentionally has no
// SDK alias: shared action metadata remains in public action_definition.
export type ManipulationContextRow = IterRow<DbConnection["db"]["visible_manipulation_context"]>;
export type ManipulationAvailableActionRow = IterRow<
	DbConnection["db"]["visible_manipulation_available_action"]
>;
export type ManipulationObservedTargetRow = IterRow<
	DbConnection["db"]["visible_manipulation_observed_target"]
>;
// ADR-0142 D-6's per-perceiver dialogue-prompt projection.
export type PromptOccurrenceRow = IterRow<DbConnection["db"]["visible_prompt_occurrence"]>;
export type ManipulationPromptRow = IterRow<DbConnection["db"]["visible_manipulation_prompt"]>;
export type ManipulationParticipantContextRow = IterRow<
	DbConnection["db"]["visible_manipulation_participant_context"]
>;
export type ManipulationParticipantBindingRow = IterRow<
	DbConnection["db"]["visible_manipulation_participant_binding"]
>;
export type PlaceNodeRow = IterRow<DbConnection["db"]["visible_place_node"]>;
export type PlaceEdgeRow = IterRow<DbConnection["db"]["visible_place_edge"]>;
export type PlaceEdgeAffordanceRow = IterRow<DbConnection["db"]["place_edge_affordance"]>;
export type PlaceGraphDefinitionRow = IterRow<DbConnection["db"]["visible_place_graph_definition"]>;
export type MapLayerRow = IterRow<DbConnection["db"]["visible_map_layer"]>;
// Public catalog (not fog-of-war gated) — indoor/outdoor class for OSM export.
export type SubstrateDefinitionRow = IterRow<DbConnection["db"]["substrate_definition"]>;
export type VisibleSpatialNicheAttachmentRow = IterRow<
	DbConnection["db"]["visible_spatial_niche_attachment"]
>;
export type EvaluationProvenanceRow = IterRow<DbConnection["db"]["visible_evaluation_provenance"]>;
export type ConfigRow = IterRow<DbConnection["db"]["config"]>;
export type WorldTimeRow = IterRow<DbConnection["db"]["world_time"]>;
// `world_event` is private (#915 PR-8); rows arrive via the per-caller
// `visible_world_event` dispatch view (identical columns).
export type WorldEventRow = IterRow<DbConnection["db"]["visible_world_event"]>;
// `event_apply_consequence` / `event_resource_delta` / `event_actor_body_swapped`
// are private (ADR-0120, #915); rows arrive via their per-caller `visible_*`
// views (identical columns, owner/DM-extent-bounded).
export type EventApplyConsequenceRow = IterRow<
	DbConnection["db"]["visible_event_apply_consequence"]
>;
export type EventResourceDeltaRow = IterRow<DbConnection["db"]["visible_event_resource_delta"]>;
// `event_condition_delta` is private (ADR-0120, K-B Part B); rows arrive via
// the per-caller `visible_event_condition_delta` view (identical columns,
// owner/DM-extent-bounded — same shape as event_resource_delta above).
export type EventConditionDeltaRow = IterRow<DbConnection["db"]["visible_event_condition_delta"]>;
export type EventActorBodySwappedRow = IterRow<
	DbConnection["db"]["visible_event_actor_body_swapped"]
>;
export type EventChannelSpendRow = IterRow<DbConnection["db"]["event_channel_spend"]>;
export type EventBoundaryFiredRow = IterRow<DbConnection["db"]["event_boundary_fired"]>;
export type EventChannelWindowRefreshRow = IterRow<
	DbConnection["db"]["event_channel_window_refresh"]
>;
export type EventActionRechargeFiredRow = IterRow<
	DbConnection["db"]["event_action_recharge_fired"]
>;
// `condition_boundary_expiry` is private operational state; the owner-scoped
// view is the only SDK read surface (ADR-0120, #915).
export type ConditionBoundaryExpiryRow = IterRow<
	DbConnection["db"]["visible_condition_boundary_expiry"]
>;
// `economy_channel_spend` is private (ADR-0120, #915); rows arrive via the
// per-caller `visible_economy_channel_spend` view (identical columns,
// owner-body-bounded — #2083/#2096).
export type VisibleEconomyChannelSpendRow = IterRow<
	DbConnection["db"]["visible_economy_channel_spend"]
>;
export type VisibleEconomyChannelBudgetRow = IterRow<
	DbConnection["db"]["visible_economy_channel_budget"]
>;
export type ActionDefinitionRow = IterRow<DbConnection["db"]["action_definition"]>;
export type AffordanceTemplateRow = IterRow<DbConnection["db"]["affordance_template"]>;
// `niche_definition` is public (actor-carried-verbs D1/D2); `provider` names
// WHO offers the niche (`place`/`entity`/`actor`, empty = `place`).
export type NicheDefinitionRow = IterRow<DbConnection["db"]["niche_definition"]>;
export type NicheProviderDefinitionRow = IterRow<DbConnection["db"]["niche_provider_definition"]>;
// `observer_knowledge` / `observer_place_knowledge` / `observer_trace_knowledge`
// are private (ADR-0120, #915 sweep PR-2); the row shapes are read through
// their per-caller `visible_*` views (identical columns, perception-bounded).
export type ObserverKnowledgeRow = IterRow<DbConnection["db"]["visible_observer_knowledge"]>;
export type ObserverPlaceKnowledgeRow = IterRow<
	DbConnection["db"]["visible_observer_place_knowledge"]
>;
export type ObserverTraceKnowledgeRow = IterRow<
	DbConnection["db"]["visible_observer_trace_knowledge"]
>;
// `trace` is private (ADR-0120, #915); the row shape is read through the
// per-caller `visible_trace` view (identical columns, perception-bounded).
export type TraceRow = IterRow<DbConnection["db"]["visible_trace"]>;
export type EntityContainmentRow = IterRow<DbConnection["db"]["visible_entity_containment"]>;
export type CapabilityDefinitionRow = IterRow<DbConnection["db"]["capability_definition"]>;
export type ConditionDefinitionRow = IterRow<DbConnection["db"]["condition_definition"]>;
export type ConditionDefinitionDescriptionRow = IterRow<
	DbConnection["db"]["condition_definition_description"]
>;
// `capability` is private (ADR-0120); rows arrive via the per-caller
// `visible_capability` view (identical columns, entity-owner-bounded).
export type VisibleCapabilityRow = IterRow<DbConnection["db"]["visible_capability"]>;
// `entity_equipment_slot` is private (ADR-0120, #915 PR-6); rows arrive via
// the per-caller `visible_entity_equipment_slot` view (identical columns,
// owner/DM-extent-bounded).
export type EntityEquipmentSlotRow = IterRow<DbConnection["db"]["visible_entity_equipment_slot"]>;
export type EquipmentSlotDefinitionRow = IterRow<DbConnection["db"]["equipment_slot_definition"]>;
export type ResourceDefinitionRow = IterRow<DbConnection["db"]["resource_definition"]>;
export type ResourceDefinitionTagRow = IterRow<DbConnection["db"]["resource_definition_tag"]>;
// `spatial_environment_state` is private (ADR-0120, #915 sweep PR-4); the row
// shape is read through the per-caller `visible_spatial_environment_state`
// view (identical columns).
export type SpatialEnvironmentStateRow = IterRow<
	DbConnection["db"]["visible_spatial_environment_state"]
>;
export type OutcomeTemplateRow = IterRow<DbConnection["db"]["outcome_template"]>;
// `metadata_attachment` is private (ADR-0130 D-1); clients read through
// three views sharing this row shape (D-5). `public_metadata_attachment` and
// `visible_metadata_attachment` union to the readable metadata set for a
// play session (D-6, `core/readers/metadata_rows.ts`'s
// `readMetadataAttachmentRows`); `public_reference_metadata` carries public
// `on_demand` rows (rules text, creation data, docs) for reference consumers.
export type PublicMetadataAttachmentRow = IterRow<DbConnection["db"]["public_metadata_attachment"]>;
export type VisibleMetadataAttachmentRow = IterRow<
	DbConnection["db"]["visible_metadata_attachment"]
>;
export type PublicReferenceMetadataRow = IterRow<DbConnection["db"]["public_reference_metadata"]>;
// tag_value_definition: bundle-authored catalog metadata for one exact tag
// value (e.g. `srd.species.human`) — `prefix` groups a facet's values,
// `description` is source-derived discovery prose. Public, keyed by `tag`.
// Joined onto `entity_definition_tag` rows by `readSelfIdentity` (#2119
// identity-out-of-summary move); a tag with no catalog row (a bare tag like
// `creature`) simply has no matching row here.
export type TagValueDefinitionRow = IterRow<DbConnection["db"]["tag_value_definition"]>;

export type ObservedContainerContentRow = IterRow<
	DbConnection["db"]["visible_observed_container_content"]
>;
export type ObservedContainerCoverageRow = IterRow<
	DbConnection["db"]["visible_observed_container_coverage"]
>;
