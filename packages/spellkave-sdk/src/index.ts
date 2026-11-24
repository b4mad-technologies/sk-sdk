// Host-neutral Spellkave TypeScript SDK.
//
// Built on `spacetimedb` (official client SDK) + `@spellkave/bindings`
// (generated protocol surface). Read-first by design: connection, snapshot,
// and read-model helpers; no pi.dev / React / Vite / Playwright dependency.
//
// 3.2 extracted the host-neutral helpers from `.pi/extensions/spellkave/src`
// (profile, credential, paths, resolve, actor, movement readers, plus the
// connection lifecycle + snapshot adapter). Pi-only glue (widget, tool,
// extension main entry) stayed in the pi adapter. 3.3 will add explicit
// read-first APIs for world status, recent events, actor/location
// snapshots, and suggested-next-action read models on top of this base.

export type {
	EvaluationProvenanceRow,
	PendingStochasticResolutionRow,
	SpatialEnvironmentStateRow,
} from "./binding_rows";
export {
	buildSubscribeSet,
	CACHE_APPLIED_MARKER,
	CONNECTION_BASELINE,
	type ConnectArgs,
	captureSnapshotFrame,
	connect,
	defaultReaderManifest,
	FILTERED_SUBSCRIPTION_TABLES,
	findUndeclaredBaselineTables,
	getRegisteredReaderTables,
	installRefreshHooks,
	OPTIONAL_SATELLITE_TABLES,
	OWNER_SUBSCRIPTION_TABLES,
	READER_SCOPED_TABLES,
	type ReaderManifest,
	type RequiredTables,
	registerReaderManifest,
	type SnapshotCaptureFrame,
	type SnapshotDb,
	type SnapshotFixtureTables,
	type SpellkaveSession,
	STRICT_TABLES,
	SUBSCRIBED_TABLES,
	snapshot,
	snapshotDb,
	snapshotDbFromCaptureFrame,
	snapshotDbFromFixture,
	snapshotFromDb,
	subscribeSetForSurface,
	type TableName,
} from "./connection";
export * from "./core/actor";
export * from "./core/actor_control";
export type {
	RActorWakeUpFn,
	RAdvanceTurnFn,
	RManipulateFn,
	RMoveFn,
	RReactFn,
	RReleaseClaimFn,
	RSenseFn,
	RSessionCloseFn,
	RSessionMoveFn,
	RSessionOpenFn,
} from "./core/actor_control_source";
export * from "./core/binding_drift";
export * from "./core/credential";
export type { DriverToken } from "./core/driver_control";
export { freezeDriverReducers } from "./core/driver_control";
export type {
	FactoredManipulationAttempt,
	FactoredManipulationAttemptInput,
	FactoredManipulationAttemptResult,
} from "./core/factored_manipulation_attempt";
export { composeFactoredManipulationAttempt } from "./core/factored_manipulation_attempt";
export type { ActorId, EntityId, EntityRef } from "./core/ids";
export { asActorId, asEntityId, asEntityRef } from "./core/ids";
export * from "./core/interaction/index";
export * from "./core/movement";
export * from "./core/paths";
export * from "./core/profile";
// Resolve an actor/entity key (or numeric ref) to its numeric entity id — the
// key the relational tables (object_state, entity_tag) are keyed by. Used by
// hosts that hold string actor ids but must read numeric-keyed state.
export { descriptorValue, resolveEntityId, verbClassFromDescriptor } from "./core/readers/_helpers";
export type { ActorBodySwapEventRow } from "./core/readers/actor_body_swaps";
export { readActorBodySwapEvents } from "./core/readers/actor_body_swaps";
export type { ActorConditionRow, ActorSnapshot } from "./core/readers/actor_snapshot";
export { readActorConditions, readActorSnapshot } from "./core/readers/actor_snapshot";
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
} from "./core/readers/actors_and_bodies";
export type { EventApplyConsequenceEntry } from "./core/readers/apply_consequences";
export { readEventApplyConsequences } from "./core/readers/apply_consequences";
export type {
	BundleCapabilityDefinitionRow,
	BundleResourceDefinitionRow,
} from "./core/readers/bundle_definitions";
export {
	readCapabilityDefinition,
	readResourceDefinition,
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
export { readCombatSessionView } from "./core/readers/combat_session";
export type {
	ObservedContainerContents,
	ObservedContainerItem,
} from "./core/readers/container_contents";
export { readContainerContents } from "./core/readers/container_contents";
export type {
	DialogueGuide,
	DialogueGuideAnswer,
	DialogueGuideEntry,
} from "./core/readers/dialogue_guide";
export { parseDialogueGuide } from "./core/readers/dialogue_guide";
export {
	captureDriverToken,
	readControlContinuationRefusals,
	readControlContinuations,
	readControlTransitions,
	readDriverControl,
	readSteeringEvents,
} from "./core/readers/driver_control";
export type { EntityArt } from "./core/readers/entity_art";
export type { EntityContainmentRow } from "./core/readers/entity_containment";
export { readEntityContainer, readEntityContainment } from "./core/readers/entity_containment";
export type { EquipmentSlotRow, EquipmentSnapshot } from "./core/readers/equipment";
export { readEquipment } from "./core/readers/equipment";
export type {
	EdgeAffordanceBinding,
	LocationOutgoingEdge,
	LocationSnapshot,
} from "./core/readers/location_snapshot";
export { readLocationSnapshot } from "./core/readers/location_snapshot";
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
} from "./core/readers/manifest_export";
export type {
	ManipulationActionDescriptor,
	ManipulationContext,
	ManipulationObservedTarget,
	ManipulationParticipantContext,
	ManipulationPrompt,
} from "./core/readers/manipulation_context";
export { readManipulationContext } from "./core/readers/manipulation_context";
export { readMapLayers } from "./core/readers/map_layers";
export type { MetadataAttachmentRow } from "./core/readers/metadata_rows";
export { readMetadataAttachmentRows } from "./core/readers/metadata_rows";
export type { AwaitObjectStateAppliedOpts, ObjectStateRef } from "./core/readers/object_state";
export { awaitObjectStateApplied, readObjectStateInt } from "./core/readers/object_state";
export type { ObserverKnowledgeEntry } from "./core/readers/observer_knowledge";
export { readObserverKnowledge } from "./core/readers/observer_knowledge";
export type { ObserverPlaceKnowledgeEntry } from "./core/readers/observer_place_knowledge";
export { readObserverPlaceKnowledge } from "./core/readers/observer_place_knowledge";
export type { ObserverTraceKnowledgeEntry } from "./core/readers/observer_trace_knowledge";
export { readObserverTraceKnowledge } from "./core/readers/observer_trace_knowledge";
export type { PlaceTopology } from "./core/readers/place_topology";
export { readPlaceTopology } from "./core/readers/place_topology";
export type { SeatRow } from "./core/readers/seats";
export { readSeats } from "./core/readers/seats";
export type { SenseQueryDescriptor } from "./core/readers/sense_context";
export { readSenseContext } from "./core/readers/sense_context";
export type { SessionSnapshot } from "./core/readers/session";
export {
	readActiveSessionForActor,
	readSession,
	readSessionById,
	readSessionCurrentActor,
	readSessionParticipants,
} from "./core/readers/session";
export type { SpatialNodeStateRef } from "./core/readers/spatial_environment_state";
export {
	readSpatialNodeStateBool,
	resolveEffectiveSpatialEnvironmentStates,
} from "./core/readers/spatial_environment_state";
export { readVisibleSpatialNicheAttachments } from "./core/readers/spatial_niche_attachments";
export { readSubstrateDefinitions } from "./core/readers/substrate_definitions";
export type { SuggestedNextAction } from "./core/readers/suggest_next_action";
export { suggestNextAction } from "./core/readers/suggest_next_action";
export {
	readActionTags,
	readEntityFaction,
	readEntityTags,
} from "./core/readers/tag_reads";
export type {
	CurrentTraceProjection,
	ReadCurrentTraceProjectionOptions,
	TraceQueryEntry,
} from "./core/readers/trace_query";
export { readCurrentTraceProjection } from "./core/readers/trace_query";
export type { ReadTracesAtOpts, TraceRow } from "./core/readers/traces";
export { readTracesAt } from "./core/readers/traces";
export type { TravelSession } from "./core/readers/travel_session";
export { travelSessionForActor } from "./core/readers/travel_session";
export type { WorldEventRow } from "./core/readers/world_events";
export { readRecentEvents } from "./core/readers/world_events";
export type { WorldStatus } from "./core/readers/world_status";
export { readWorldStatus } from "./core/readers/world_status";
export {
	emptyManipulationArgs,
	MANIPULATION_ARGS_WIRE_KEYS,
	manipulationArgsFromJson,
} from "./core/reducers/manipulation_args";
export {
	advanceScene,
	advanceScenes,
	advanceTurns,
	pauseWorldTicks,
	setDebugRngSeed,
} from "./core/reducers/tick";
export { actorEntityId, targetRefFromString, targetRefToString } from "./core/reducers/transport";
export * from "./core/resolve";
export * from "./core/shape_telemetry";
export * from "./core/snapshot_rows";
export * from "./manifest-apply";
export * from "./provenance";
export type {
	WatchActor,
	WatchActorCondition,
	WatchActorState,
	WatchCursor,
	WatchEvent,
	WatchFrame,
	WatchItem,
} from "./watch-buffer";
export {
	hasOversightGrant,
	projectWatchFrame,
	readWatchOwnBodies,
	readWatchTick,
	WATCH_BUFFER_CAP,
	WATCH_BUFFER_REQUIRED_TABLES,
	WatchBuffer,
	watchOverlayAdmitted,
} from "./watch-buffer";
