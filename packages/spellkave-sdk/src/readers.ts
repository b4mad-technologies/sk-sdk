// Browser-safe Spellkave SDK reader entry.
//
// This subpath exposes pure read models for browser and replay bundles. Keep
// connection construction and reducer surfaces on the root entry only.

export type { DriverToken } from "./core/driver_control";
export {
	buildEntityNameMap,
	descriptorValue,
	resolveEntityId,
	verbClassFromDescriptor,
} from "./core/readers/_helpers";
export type {
	ActionRechargeFiredEventRow,
	BoundaryFiredEventRow,
	ChannelSpendEventRow,
	ChannelWindowRefreshEventRow,
	ConditionBoundaryExpiryRow,
} from "./core/readers/action_economy_events";
export {
	actionRechargeFiredRequiredTables,
	boundaryFiredRequiredTables,
	channelSpendRequiredTables,
	channelWindowRefreshRequiredTables,
	conditionBoundaryExpiryRequiredTables,
	readConditionBoundaryExpiries,
	readRecentActionRechargeFirings,
	readRecentBoundaryFirings,
	readRecentChannelSpends,
	readRecentChannelWindowRefreshes,
} from "./core/readers/action_economy_events";
export type { ActorBodySwapEventRow } from "./core/readers/actor_body_swaps";
export { readActorBodySwapEvents } from "./core/readers/actor_body_swaps";
export type { ActorConditionRow, ActorSnapshot } from "./core/readers/actor_snapshot";
export {
	readActorConditions,
	readActorSnapshot,
	requiredTables as readActorSnapshotRequiredTables,
} from "./core/readers/actor_snapshot";
export type { ActorStateEntry, ReadActorStatesOptions } from "./core/readers/actor_states";
export {
	readActorStates,
	requiredTables as readActorStatesRequiredTables,
} from "./core/readers/actor_states";
export type {
	ActorIdentityBindingRow,
	ActorPrincipalRow,
	EntityBodyRow,
	EntityObjectStateRow,
} from "./core/readers/actors_and_bodies";
export {
	readActorIdentityBindings,
	readActorPrincipals,
	readEntityBody,
	readObjectStatesForEntity,
	requiredTables as readActorPrincipalsRequiredTables,
} from "./core/readers/actors_and_bodies";
export type { AffordanceDefaults } from "./core/readers/affordance_defaults";
export {
	AFFORDANCE_DEFAULTS_NAMESPACE,
	readAffordanceDefaults,
	requiredTables as readAffordanceDefaultsRequiredTables,
} from "./core/readers/affordance_defaults";
export {
	readAffordanceGroupMembership,
	requiredTables as readAffordanceGroupMembershipRequiredTables,
} from "./core/readers/affordance_group_membership";
export type {
	AffordanceInputField,
	AffordanceInputSchema,
} from "./core/readers/affordance_input";
export {
	readAffordanceInputSchemas,
	requiredTables as readAffordanceInputSchemasRequiredTables,
} from "./core/readers/affordance_input";
export {
	readAffordanceDefinitionRefs,
	requiredTables as readAffordanceDefinitionRefsRequiredTables,
} from "./core/readers/affordance_reference";
export {
	type EventApplyConsequenceEntry,
	readEventApplyConsequences,
	requiredTables as readEventApplyConsequencesRequiredTables,
} from "./core/readers/apply_consequences";
export type { BoundedCollection } from "./core/readers/bounded_collection";
export { boundedCollection } from "./core/readers/bounded_collection";
export type {
	BundleCapabilityDefinitionRow,
	BundleResourceDefinitionRow,
} from "./core/readers/bundle_definitions";
export {
	readCapabilityDefinition,
	readResourceDefinition,
	resourceRequiredTables as resourceDefinitionRequiredTables,
} from "./core/readers/bundle_definitions";
export type { BundleEntityRow, BundleItemRow } from "./core/readers/bundle_entities";
export { readEntity, readItem } from "./core/readers/bundle_entities";
export type { ActorCoLocation } from "./core/readers/co_location";
export { readActorCoLocation } from "./core/readers/co_location";
export type {
	CombatFeedback,
	CombatGridCell,
	CombatMove,
	CombatRosterEntry,
	CombatSessionView,
} from "./core/readers/combat_session";
export {
	readCombatSessionView,
	requiredTables as readCombatSessionRequiredTables,
} from "./core/readers/combat_session";
export type { ConditionDeltaEventRow } from "./core/readers/condition_deltas";
export {
	readRecentConditionDeltas,
	requiredTables as readRecentConditionDeltasRequiredTables,
} from "./core/readers/condition_deltas";
export type {
	ObservedContainerContents,
	ObservedContainerItem,
} from "./core/readers/container_contents";
export {
	readContainerContents,
	requiredTables as containerContentsManifest,
} from "./core/readers/container_contents";
export {
	captureDriverToken,
	readControlContinuationRefusals,
	readControlContinuations,
	readControlTransitions,
	readDriverControl,
	readSteeringEvents,
} from "./core/readers/driver_control";
export type { EntityArt, PublicArtSubject, PublicSubjectArt } from "./core/readers/entity_art";
export {
	METADATA_TARGET_KINDS,
	readPublicEntityArt,
	readPublicSubjectArt,
} from "./core/readers/entity_art";
export type { EntityContainmentRow } from "./core/readers/entity_containment";
export {
	readEntityContainer,
	readEntityContainment,
	requiredTables as readEntityContainmentRequiredTables,
} from "./core/readers/entity_containment";
export type { EquipmentSlotRow, EquipmentSnapshot } from "./core/readers/equipment";
export {
	readEquipment,
	requiredTables as readEquipmentRequiredTables,
} from "./core/readers/equipment";
export type {
	InterventionWindowFace,
	InterventionWindowProjection,
} from "./core/readers/intervention_windows";
export {
	readInterventionWindowsForActor,
	requiredTables as readInterventionWindowsRequiredTables,
} from "./core/readers/intervention_windows";
export type {
	InventoryProjection,
	InventoryQueryItem,
	ReadInventoryProjectionOptions,
} from "./core/readers/inventory_query";
export {
	readInventoryProjection,
	requiredTables as readInventoryProjectionRequiredTables,
} from "./core/readers/inventory_query";
export type {
	ItemDetailProjection,
	ItemEquipmentRole,
	ItemStateSlice,
} from "./core/readers/item_detail";
export {
	readAuthorizedItemDetail,
	requiredTables as readAuthorizedItemDetailRequiredTables,
} from "./core/readers/item_detail";
export type {
	EdgeAffordanceBinding,
	LocationOutgoingEdge,
	LocationSnapshot,
} from "./core/readers/location_snapshot";
export {
	readLocationSnapshot,
	requiredTables as readLocationSnapshotRequiredTables,
} from "./core/readers/location_snapshot";
export {
	type ManifestApplyProvenanceRow,
	readManifestApplyProvenance,
} from "./core/readers/manifest_apply_provenance";
export type { ManifestExportRow } from "./core/readers/manifest_export";
export {
	assertManifestExportAvailable,
	MANIFEST_EXPORT_VIEW,
	ManifestExportUnavailableError,
	manifestExportAvailable,
	readManifestExport,
	requiredTables as readManifestExportRequiredTables,
} from "./core/readers/manifest_export";
export type {
	ManipulationActionDescriptor,
	ManipulationContext,
	ManipulationObservedTarget,
	ManipulationParticipantContext,
} from "./core/readers/manipulation_context";
export {
	readManipulationContext,
	requiredTables as readManipulationContextRequiredTables,
} from "./core/readers/manipulation_context";
export {
	readMapLayers,
	requiredTables as readMapLayersRequiredTables,
} from "./core/readers/map_layers";
export type {
	AwaitObjectStateAppliedOpts,
	EntityIntState,
	ObjectStateRef,
} from "./core/readers/object_state";
export {
	awaitObjectStateApplied,
	readEntityIntStates,
	readObjectStateInt,
	requiredTables as readObjectStateIntRequiredTables,
} from "./core/readers/object_state";
export type { ObserverKnowledgeEntry } from "./core/readers/observer_knowledge";
export {
	readObserverKnowledge,
	requiredTables as readObserverKnowledgeRequiredTables,
} from "./core/readers/observer_knowledge";
export type { ObserverPlaceKnowledgeEntry } from "./core/readers/observer_place_knowledge";
export {
	readObserverPlaceKnowledge,
	requiredTables as readObserverPlaceKnowledgeRequiredTables,
} from "./core/readers/observer_place_knowledge";
export type { ObserverTraceKnowledgeEntry } from "./core/readers/observer_trace_knowledge";
export {
	readObserverTraceKnowledge,
	requiredTables as readObserverTraceKnowledgeRequiredTables,
} from "./core/readers/observer_trace_knowledge";
export {
	readOutcomeTemplateDescription,
	requiredTables as readOutcomeTemplateDescriptionRequiredTables,
} from "./core/readers/outcome_template";
export type { PlaceTopology } from "./core/readers/place_topology";
export {
	readPlaceTopology,
	requiredTables as readPlaceTopologyRequiredTables,
} from "./core/readers/place_topology";
export type { ReactionOptionProjection } from "./core/readers/reaction_options";
export {
	readReactionOptionsForActor,
	requiredTables as readReactionOptionsForActorRequiredTables,
} from "./core/readers/reaction_options";
export type { ResourceDeltaEventRow } from "./core/readers/resource_deltas";
export {
	readRecentResourceDeltas,
	requiredTables as readRecentResourceDeltasRequiredTables,
} from "./core/readers/resource_deltas";
export type {
	CurrentSceneProjection,
	SceneTarget,
	SceneTargetKind,
} from "./core/readers/scene";
export {
	readCurrentScene,
	requiredTables as readCurrentSceneRequiredTables,
} from "./core/readers/scene";
export type { SeatRow } from "./core/readers/seats";
export {
	readSeats,
	requiredTables as readSeatsRequiredTables,
} from "./core/readers/seats";
export type {
	CompactSelfCondition,
	CompactSelfState,
	SelfSummaryProjection,
} from "./core/readers/self";
export {
	readSelfConditions,
	readSelfStates,
	readSelfSummary,
	requiredTables as readSelfSummaryRequiredTables,
} from "./core/readers/self";
export type { CompactSelfCapability } from "./core/readers/self_capabilities";
export {
	readSelfCapabilities,
	requiredTables as readSelfCapabilitiesRequiredTables,
} from "./core/readers/self_capabilities";
export type {
	CompactSelfEconomyLastSpend,
	CompactSelfEconomySpend,
} from "./core/readers/self_economy";
export {
	readSelfEconomyChannelSpends,
	requiredTables as readSelfEconomyChannelSpendsRequiredTables,
} from "./core/readers/self_economy";
export type {
	CompactEconomyBudget,
	CompactEconomyBudgetChannel,
	EconomyBudgetEnvelopeStatus,
} from "./core/readers/self_economy_budget";
export {
	readSelfEconomyBudget,
	requiredTables as readSelfEconomyBudgetRequiredTables,
} from "./core/readers/self_economy_budget";
export type {
	CompactSelfEvaluation,
	CompactSelfEvaluationDraw,
} from "./core/readers/self_evaluations";
export {
	readSelfEvaluationById,
	readSelfRecentEvaluations,
	requiredTables as readSelfRecentEvaluationsRequiredTables,
} from "./core/readers/self_evaluations";
export type { SelfIdentityFacet } from "./core/readers/self_identity";
export {
	readSelfIdentity,
	requiredTables as readSelfIdentityRequiredTables,
} from "./core/readers/self_identity";
export type { SenseQueryDescriptor } from "./core/readers/sense_context";
export {
	readSenseContext,
	requiredTables as readSenseContextRequiredTables,
} from "./core/readers/sense_context";
export type { SessionParticipant, SessionSnapshot } from "./core/readers/session";
export {
	participantRequiredTables as readSessionParticipantsRequiredTables,
	readActiveSessionForActor,
	readActiveSessionWithRosterForParticipant,
	readSession,
	readSessionById,
	readSessionCurrentActor,
	readSessionParticipants,
	readTerminalSessions,
	requiredTables as readSessionRequiredTables,
} from "./core/readers/session";
export {
	type ParticipantSessionDetail,
	type ParticipantSessionSummary,
	readParticipantSessionDetail,
	readParticipantSessionSummaries,
} from "./core/readers/session_detail";
export type { ParticipantSessionStatus } from "./core/readers/session_status";
export { readParticipantSessionStatus } from "./core/readers/session_status";
export type { SpatialNodeStateRef } from "./core/readers/spatial_environment_state";
export {
	readSpatialNodeStateBool,
	requiredTables as readSpatialNodeStateBoolRequiredTables,
} from "./core/readers/spatial_environment_state";
export {
	readVisibleSpatialNicheAttachments,
	requiredTables as readVisibleSpatialNicheAttachmentsRequiredTables,
} from "./core/readers/spatial_niche_attachments";
export {
	readSubstrateDefinitions,
	requiredTables as readSubstrateDefinitionsRequiredTables,
} from "./core/readers/substrate_definitions";
export type { SuggestedNextAction } from "./core/readers/suggest_next_action";
export { suggestNextAction } from "./core/readers/suggest_next_action";
export {
	entityTagTables as readEntityTagsRequiredTables,
	readEntityFaction,
	readEntityTags,
} from "./core/readers/tag_reads";
export type {
	CurrentTraceProjection,
	ReadCurrentTraceProjectionOptions,
	TraceQueryEntry,
} from "./core/readers/trace_query";
export {
	readCurrentTraceProjection,
	requiredTables as readCurrentTraceProjectionRequiredTables,
} from "./core/readers/trace_query";
export type { ReadTracesAtOpts, TraceRow } from "./core/readers/traces";
export {
	readRecentTraces,
	readTracesAt,
	requiredTables as readTracesAtRequiredTables,
} from "./core/readers/traces";
export type { TurnStateSnapshot } from "./core/readers/turn_state";
export {
	readTurnState,
	requiredTables as readTurnStateRequiredTables,
} from "./core/readers/turn_state";
export type { WorldEventRow } from "./core/readers/world_events";
export {
	readRecentEvents,
	requiredTables as readRecentEventsRequiredTables,
} from "./core/readers/world_events";
export type { WorldStatus } from "./core/readers/world_status";
export {
	readWorldStatus,
	requiredTables as readWorldStatusRequiredTables,
} from "./core/readers/world_status";
export * from "./reader-manifest";
