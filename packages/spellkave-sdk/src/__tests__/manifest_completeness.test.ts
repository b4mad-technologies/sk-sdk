// Proxy-based completeness harness (D2, design.md:60-68; tasks.md 2.3-2.5).
//
// Wraps a fixture SnapshotDb in a Proxy that records every snake_case
// db[accessor] read. Each reader is invoked against the proxy; the recorded
// access set must exactly equal the reader's declared requiredTables (both
// directions: under-declaration AND over-declaration fail).
//
// Hard-fails on any camelCase accessor access — detects re-introduction of
// the dead fallback pattern dropped in tasks.md 6.6.

import { describe, expect, it } from "vitest";
import { asEntityRef } from "../core/ids";
import {
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
} from "../core/readers/action_economy_events";
import {
	requiredTables as actorBodySwapsRequiredTables,
	readActorBodySwapEvents,
} from "../core/readers/actor_body_swaps";
import {
	requiredTables as actorSnapshotRequiredTables,
	readActorSnapshot,
} from "../core/readers/actor_snapshot";
import {
	requiredTables as actorsAndBodiesRequiredTables,
	readActorIdentityBindings,
	readActorPrincipals,
	readEntityBody,
	readObjectStatesForEntity,
} from "../core/readers/actors_and_bodies";
import {
	capabilityRequiredTables,
	readCapabilityDefinition,
	readResourceDefinition,
	resourceRequiredTables,
} from "../core/readers/bundle_definitions";
import {
	requiredTables as bundleEntityRequiredTables,
	readEntity,
	readItem,
} from "../core/readers/bundle_entities";
import {
	requiredTables as combatSessionRequiredTables,
	readCombatSessionView,
} from "../core/readers/combat_session";
import {
	requiredTables as entityContainmentRequiredTables,
	readEntityContainment,
} from "../core/readers/entity_containment";
import {
	requiredTables as equipmentRequiredTables,
	readEquipment,
} from "../core/readers/equipment";
import {
	requiredTables as interventionWindowsRequiredTables,
	readInterventionWindowsForActor,
} from "../core/readers/intervention_windows";
import {
	requiredTables as locationSnapshotRequiredTables,
	readLocationSnapshot,
} from "../core/readers/location_snapshot";
import {
	requiredTables as mapLayersRequiredTables,
	readMapLayers,
} from "../core/readers/map_layers";
import {
	requiredTables as observerKnowledgeRequiredTables,
	readObserverKnowledge,
} from "../core/readers/observer_knowledge";
import {
	requiredTables as observerPlaceKnowledgeRequiredTables,
	readObserverPlaceKnowledge,
} from "../core/readers/observer_place_knowledge";
import {
	requiredTables as placeTopologyRequiredTables,
	readPlaceTopology,
} from "../core/readers/place_topology";
import {
	readSelfCapabilities,
	requiredTables as selfCapabilitiesRequiredTables,
} from "../core/readers/self_capabilities";
import {
	readSelfEconomyChannelSpends,
	requiredTables as selfEconomyRequiredTables,
} from "../core/readers/self_economy";
import {
	readSelfEconomyBudget,
	requiredTables as selfEconomyBudgetRequiredTables,
} from "../core/readers/self_economy_budget";
import {
	readSelfEvaluationById,
	readSelfRecentEvaluations,
	requiredTables as selfEvaluationsRequiredTables,
} from "../core/readers/self_evaluations";
import {
	readVisibleSpatialNicheAttachments,
	requiredTables as spatialNicheAttachmentsRequiredTables,
} from "../core/readers/spatial_niche_attachments";
import {
	readSubstrateDefinitions,
	requiredTables as substrateDefinitionsRequiredTables,
} from "../core/readers/substrate_definitions";
import {
	suggestNextAction,
	requiredTables as suggestNextActionRequiredTables,
} from "../core/readers/suggest_next_action";
import {
	requiredTables as currentTraceProjectionRequiredTables,
	readCurrentTraceProjection,
} from "../core/readers/trace_query";
import { readTracesAt, requiredTables as tracesRequiredTables } from "../core/readers/traces";
import {
	readRecentEvents,
	requiredTables as recentEventsRequiredTables,
} from "../core/readers/world_events";
import {
	readWorldStatus,
	requiredTables as worldStatusRequiredTables,
} from "../core/readers/world_status";
import type { SnapshotDb } from "../reader-manifest";

// ---------------------------------------------------------------------------
// Proxy harness
// ---------------------------------------------------------------------------

const CAMEL_RE = /[a-z][A-Z]/;

function makeProxyDb(base: SnapshotDb): { proxy: SnapshotDb; accessed: Set<string> } {
	const accessed = new Set<string>();
	const proxy = new Proxy(base, {
		get(target, prop) {
			if (typeof prop === "string") {
				if (CAMEL_RE.test(prop)) {
					throw new Error(`camelCase accessor "${prop}" used — snake_case only`);
				}
				// Only record string props that look like table names (not Symbol / internal).
				if (prop !== "then" && !prop.startsWith("__")) {
					accessed.add(prop);
				}
			}
			return Reflect.get(target, prop);
		},
	}) as SnapshotDb;
	return { proxy, accessed };
}

function assertExact(accessed: Set<string>, declared: readonly string[], label: string): void {
	const declaredSet = new Set(declared);
	const over = [...accessed].filter((t) => !declaredSet.has(t));
	const under = [...declared].filter((t) => !accessed.has(t));
	if (over.length > 0 || under.length > 0) {
		const msgs: string[] = [];
		if (over.length) msgs.push(`over-declared (accessed but not declared): ${over.join(", ")}`);
		if (under.length) msgs.push(`under-declared (declared but not accessed): ${under.join(", ")}`);
		// Include full context so both accessed and declared table names appear in the error.
		msgs.push(`accessed=[${[...accessed].join(", ")}] declared=[${declared.join(", ")}]`);
		throw new Error(`${label} manifest mismatch:\n  ${msgs.join("\n  ")}`);
	}
}

// ---------------------------------------------------------------------------
// Fixture SnapshotDb
// ---------------------------------------------------------------------------

interface FakeRow {
	[k: string]: unknown;
}
function fakeHandle(rows: FakeRow[]): { iter(): Iterable<FakeRow> } {
	return { iter: () => rows };
}

const FIXTURE: SnapshotDb = {
	visible_entity_tag: fakeHandle([]),
	visible_entity_tag_coverage: fakeHandle([{ status: "complete", projectionVersion: 1 }]),
	observer_knowledge: fakeHandle([
		{ knowledgeId: 1n, observerId: "a1", knownEntityId: "core/item/inn_door", learnedAtTick: 2n },
	]),
	observer_place_knowledge: fakeHandle([
		{ knowledgeId: 2n, observerEntityId: 1n, knownNodeId: "node-1", learnedAtTick: 2n },
	]),
	trace: fakeHandle([
		{
			traceId: 1n,
			kind: "handled",
			locationKind: "place_node",
			locationRef: "node-1",
			payloadJson: "{}",
			inscribedAt: 5n,
			decayRate: "slow",
			decayBound: "none",
			expiresAt: undefined,
			inscribedBy: "a1",
			visibility: "public",
			bundleId: "core",
		},
	]),
	world_time: fakeHandle([{ tick: 5n }]),
	config: fakeHandle([{ worldName: "Test", agentsEnabled: true, eventRetentionLimit: 50 }]),
	// `world_event` is private (#915 PR-8); the reader reads the per-caller
	// `visible_world_event` dispatch view instead.
	visible_world_event: fakeHandle([{ id: 1n, tick: 3, kind: { tag: "Tick" }, summary: "s" }]),
	visible_event_actor_body_swapped: fakeHandle([
		{
			eventId: 1n,
			actorId: 7n,
			previousBodyEntityId: 1n,
			newBodyEntityId: 2n,
			consequenceTemplateId: "demo/swap",
		},
	]),
	event_channel_spend: fakeHandle([
		{
			eventId: 2n,
			actor: 1n,
			channel: "core/action_class/primary",
			costMs: 3_000n,
			remainingMs: 3_000n,
			window: 0n,
		},
	]),
	// Same actor/channel/window as `event_channel_spend` above so
	// `readSelfEconomyChannelSpends` exercises its `last_spend` join, not just
	// the bare state row (#2083/#2096).
	visible_economy_channel_spend: fakeHandle([
		{
			rowId: 1n,
			actorId: 1n,
			channelId: "core/action_class/primary",
			spentMs: 3_000n,
			windowStartMs: 0n,
		},
	]),
	visible_economy_channel_budget: fakeHandle([
		{
			actorId: 1n,
			channelId: "core/action_class/primary",
			poolMsPerRound: 6_000n,
			resetsOn: "turn_start",
			offTurnEligible: false,
			currentWindowStartMs: 0n,
			spentMs: 3_000n,
			grantMs: 0n,
			effectivePoolMs: 6_000n,
			remainingMs: 3_000n,
			remainingDisclosed: true,
			status: "ok",
		},
	]),
	event_boundary_fired: fakeHandle([
		{
			eventId: 3n,
			boundary: "turn_start",
			owner: 1n,
			source: "rotation",
			window: 0n,
		},
	]),
	event_channel_window_refresh: fakeHandle([
		{ eventId: 4n, actor: 1n, boundary: "turn_start", window: 0n },
	]),
	event_action_recharge_fired: fakeHandle([
		{ eventId: 5n, actor: 1n, affordance: "demo/breath", boundary: "turn_start" },
	]),
	visible_condition_boundary_expiry: fakeHandle([
		{
			targetConditionRowId: 6n,
			ownerActor: 1n,
			boundaryId: "turn_end",
			armedAtWindowMs: 0n,
			outOfSessionDueTick: 1n,
		},
	]),
	visible_actor_spatial_location: fakeHandle([
		{ entityId: 1n, placeNodeId: "node-1" },
		{ entityId: 2n, placeNodeId: "node-2" },
	]),
	actor: fakeHandle([{ actorId: 7n, name: "Player-Actor", currentBody: 1n, createdAtTick: 5n }]),
	// `actor_identity` is private (#915 PR-5); readers consume its self-only
	// `visible_actor_identity` view.
	visible_actor_identity: fakeHandle([
		{ rowId: 1n, actorId: 7n, identity: "0".repeat(64), role: "primary", boundAtTick: 5n },
	]),
	entity: fakeHandle([
		{
			entityId: 1n,
			entityDefId: "core:core/player",
			name: "Core Player",
			kind: "player",
			createdAtTick: 5n,
			quantity: 1n,
			ownedByEntityId: 0n,
		},
		{
			entityId: 10n,
			entityDefId: "core/item/sword",
			name: "Sword",
			kind: "item",
			createdAtTick: 5n,
			quantity: 1n,
			ownedByEntityId: 1n,
		},
		{
			entityId: 2n,
			entityDefId: "core:goblin",
			name: "Goblin",
			kind: "npc",
			createdAtTick: 5n,
			quantity: 1n,
			ownedByEntityId: 0n,
		},
	]),
	visible_object_state: fakeHandle([
		{
			rowId: 1n,
			targetKind: "entity",
			targetId: "1",
			stateId: "actors_and_bodies/fatigue",
			value: { tag: "Int", value: 2n },
			sourceTemplateId: "seed",
			setAtTick: 5n,
			expiresAtTick: 0n,
			bundleId: "actors_and_bodies",
		},
	]),
	visible_target_condition: fakeHandle([
		{
			rowId: 1n,
			targetKind: "entity",
			targetId: 1n,
			conditionDefinitionId: "rested",
			sourceId: "test",
			appliedAtTick: 1n,
			stackCount: 1,
			bundleId: "core",
		},
	]),
	visible_manifest_authored_entity_coverage: fakeHandle([
		{ status: "complete", projectionVersion: 1 },
	]),
	visible_manifest_authored_entity: fakeHandle([
		{ manifestKey: "core:a1", bundleId: "core", entityId: 1n },
		{ manifestKey: "core:core/item/sword", bundleId: "core", entityId: 10n },
	]),
	capability_definition: fakeHandle([
		{
			capabilityId: "core/use",
			bundleId: "core",
			actorKind: "actor",
			displayName: "Use",
			description: "Use a thing",
		},
	]),
	directly_controlled_actor_spatial_location: fakeHandle([{ entityId: 1n, placeNodeId: "node-1" }]),
	visible_capability: fakeHandle([
		{
			rowId: 1n,
			entityId: 1n,
			capabilityId: "core/use",
			source: "entity_definition",
			bundleId: "core",
		},
	]),
	resource_definition: fakeHandle([
		{
			resourceDefinitionId: "core/hp",
			bundleId: "core",
			displayName: "HP",
			valueKind: "integer",
			minValue: 0n,
			maxValue: 10n,
			recoveryRule: "rest",
			initialValue: 10n,
		},
	]),
	equipment_slot_definition: fakeHandle([
		{
			slotId: "core/main_hand",
			bundleId: "core",
			label: "Main hand",
			defaultCompatibilityPredicate: "tag('weapon')",
		},
	]),
	visible_entity_equipment_slot: fakeHandle([
		{
			rowId: 1n,
			entityId: 1n,
			slotId: "core/main_hand",
			equippedEntityId: 10n,
			equippedAtTick: 5n,
		},
	]),
	visible_entity_containment: fakeHandle([
		{ entityId: 10n, containerId: 1n, slotId: "", direction: "in", insertedAtTick: 5n },
	]),
	visible_place_node: fakeHandle([{ nodeId: "node-1" }, { nodeId: "node-2" }]),
	visible_place_graph_definition: fakeHandle([
		{ placeGraphId: "session_grid_1", anchorNodeId: "node-1", isEphemeralInstance: true },
	]),
	visible_place_edge: fakeHandle([
		{ edgeId: "e1", placeGraphId: "session_grid_1", fromNodeId: "node-1", toNodeId: "node-2" },
	]),
	visible_map_layer: fakeHandle([
		{
			mapLayerId: "kavemouth/inn/elven_tower_backdrop",
			bundleId: "kavemouth",
			placeGraphId: "kavemouth/inn",
			displayName: "Lamp and Ladle",
			assetModule: "ccc3-maps",
			assetPath: "maps/267 Lamp and Ladle-notitle.jpg",
			sourceKind: "elven-tower-ccc",
			state: "aligned",
			posture: "cc-by-4.0",
			imageWidthPx: 2000,
			imageHeightPx: 2275,
			gridSizePx: 50,
			gridDistanceM: 1.5240000486373901, // 5 ft, converted x0.3048
			localWidthCells: 40.0,
			localHeightCells: 46.0,
			imageOriginX: 0.0,
			imageOriginY: 0.0,
			rotationDeg: 0.0,
			minZoom: 0.0,
			maxZoom: 0.0,
		},
	]),
	substrate_definition: fakeHandle([
		{
			substrateId: "outdoor",
			bundleId: "core",
			coordinateKindId: "h3_cell",
			description: "Outdoor",
		},
		{
			substrateId: "indoor",
			bundleId: "core",
			coordinateKindId: "graph_local",
			description: "Indoor",
		},
	]),
	visible_session: fakeHandle([
		{ sessionId: 1n, sessionDefId: "srd/session/combat", lifecycle: "active", currentActor: "1" },
	]),
	session: fakeHandle([
		{ sessionId: 1n, sessionDefId: "srd/session/combat", lifecycle: "active", currentActor: "1" },
	]),
	visible_session_participant: fakeHandle([
		{ sessionId: 1n, actorId: "1", ordinal: 0, joinedAt: 5n },
		{ sessionId: 1n, actorId: "2", ordinal: 1, joinedAt: 5n },
	]),
	session_participant: fakeHandle([
		{ sessionId: 1n, actorId: "1", ordinal: 0, joinedAt: 5n },
		{ sessionId: 1n, actorId: "2", ordinal: 1, joinedAt: 5n },
	]),
	visible_pending_resolution: fakeHandle([
		{
			pendingId: 42n,
			originatingActionId: "core/wisdom_check",
			originatingActor: "1",
			targetActor: "1",
			computedOutcomeTemplate: "core/wisdom_check/outcome",
			sessionId: 0n,
			windowOpensAtMicros: 100n,
			windowClosesAtMicros: 200n,
			depth: 0n,
			bundleId: "core",
		},
	]),
	visible_pending_stochastic_resolution: fakeHandle([
		{
			pendingId: 42n,
			draws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 14 }],
			predicateSource: "d20 >= 11",
			rollBiasJson: "{}",
			frozenFactsJson: "{}",
			commitTailJson: "{}",
			originalProvenanceId: "p0",
			bundleId: "core",
		},
	]),
	visible_evaluation_provenance: fakeHandle([
		{
			provenanceId: "p1",
			kind: { tag: "Predicate" },
			status: { tag: "Succeeded" },
			subjectId: "1",
			ownerBodyEntityId: 1n,
			failureKind: "",
			failureDetail: "",
			selectedTemplateIds: [],
			stochasticDraws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 12 }],
			createdAtTick: 5n,
			bundleId: "core",
		},
	]),
	action_definition: fakeHandle([
		{
			actionId: "drink",
			displayName: "Drink",
			tags: "survival",
			requiredCapability: "none",
			costTimeMs: 500n,
			bundleId: "core",
			onSuccess: "",
			onFailure: "",
			sessionDefId: "",
		},
	]),
	affordance: fakeHandle([
		{
			affordanceId: 1n,
			actorId: "a1",
			actionDefId: "drink",
			intentTemplateJson: "{}",
			confidence: 0.8,
			bundleId: "core",
			derivedAtTick: 5n,
			derivedByTemplateId: "tmpl-1",
			derivedFromCsv: "",
			targetRef: "",
		},
	]),
};

// ---------------------------------------------------------------------------
// Per-reader completeness assertions
// ---------------------------------------------------------------------------

describe("manifest completeness — Proxy harness", () => {
	it("readWorldStatus accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readWorldStatus(proxy);
		assertExact(accessed, worldStatusRequiredTables, "readWorldStatus");
	});

	it("readRecentEvents accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readRecentEvents(proxy, 5);
		assertExact(accessed, recentEventsRequiredTables, "readRecentEvents");
	});

	it("readActorBodySwapEvents accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readActorBodySwapEvents(proxy);
		assertExact(accessed, actorBodySwapsRequiredTables, "readActorBodySwapEvents");
	});

	it("action-economy event readers access exactly their declared tables", () => {
		const spend = makeProxyDb(FIXTURE);
		readRecentChannelSpends(spend.proxy, 5);
		assertExact(spend.accessed, channelSpendRequiredTables, "readRecentChannelSpends");

		const boundary = makeProxyDb(FIXTURE);
		readRecentBoundaryFirings(boundary.proxy, 5);
		assertExact(boundary.accessed, boundaryFiredRequiredTables, "readRecentBoundaryFirings");

		const refresh = makeProxyDb(FIXTURE);
		readRecentChannelWindowRefreshes(refresh.proxy, 5);
		assertExact(
			refresh.accessed,
			channelWindowRefreshRequiredTables,
			"readRecentChannelWindowRefreshes",
		);

		const recharge = makeProxyDb(FIXTURE);
		readRecentActionRechargeFirings(recharge.proxy, 5);
		assertExact(
			recharge.accessed,
			actionRechargeFiredRequiredTables,
			"readRecentActionRechargeFirings",
		);

		const expiry = makeProxyDb(FIXTURE);
		readConditionBoundaryExpiries(expiry.proxy);
		assertExact(
			expiry.accessed,
			conditionBoundaryExpiryRequiredTables,
			"readConditionBoundaryExpiries",
		);
	});

	it("readActorSnapshot accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readActorSnapshot(proxy, asEntityRef("1"));
		assertExact(accessed, actorSnapshotRequiredTables, "readActorSnapshot");
	});

	it("readLocationSnapshot accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readLocationSnapshot(proxy, "node-1");
		assertExact(accessed, locationSnapshotRequiredTables, "readLocationSnapshot");
	});

	it("readCombatSessionView accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readCombatSessionView(proxy, asEntityRef("1"));
		assertExact(accessed, combatSessionRequiredTables, "readCombatSessionView");
	});

	it("readObserverKnowledge accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readObserverKnowledge(proxy, "a1");
		assertExact(accessed, observerKnowledgeRequiredTables, "readObserverKnowledge");
	});

	it("readObserverPlaceKnowledge accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readObserverPlaceKnowledge(proxy, "1");
		assertExact(accessed, observerPlaceKnowledgeRequiredTables, "readObserverPlaceKnowledge");
	});

	it("readPlaceTopology accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		const topology = readPlaceTopology(proxy);
		assertExact(accessed, placeTopologyRequiredTables, "readPlaceTopology");
		expect(topology.place_nodes.map((n) => n.node_id).sort()).toEqual(["node-1", "node-2"]);
	});

	it("readVisibleSpatialNicheAttachments accesses exactly its declared table", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readVisibleSpatialNicheAttachments(proxy);
		assertExact(
			accessed,
			spatialNicheAttachmentsRequiredTables,
			"readVisibleSpatialNicheAttachments",
		);
	});

	it("readMapLayers accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readMapLayers(proxy);
		assertExact(accessed, mapLayersRequiredTables, "readMapLayers");
	});

	it("readSubstrateDefinitions accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		const rows = readSubstrateDefinitions(proxy);
		assertExact(accessed, substrateDefinitionsRequiredTables, "readSubstrateDefinitions");
		expect(rows.map((r) => r.substrate_id).sort()).toEqual(["indoor", "outdoor"]);
	});

	it("readInterventionWindowsForActor accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readInterventionWindowsForActor(proxy, asEntityRef("a1"));
		assertExact(accessed, interventionWindowsRequiredTables, "readInterventionWindowsForActor");
	});

	it("readTracesAt accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb({
			...FIXTURE,
			visible_trace: fakeHandle([
				{
					traceId: 1n,
					locationKind: "place_node",
					locationRef: "node-1",
					payloadJson: '{"action_id":"response","occurrence_id":"7"}',
				},
			]),
			action_definition_tag: fakeHandle([{ actionId: "response", tag: "ui.response-slot=1" }]),
			visible_prompt_occurrence: fakeHandle([
				{
					occurrenceId: 7n,
					promptDefId: "prompt",
					audienceTraceId: 0n,
					responseActionIds: ["response"],
				},
			]),
			public_metadata_attachment: fakeHandle([]),
			visible_metadata_attachment: fakeHandle([]),
		});
		readTracesAt(proxy, "place_node", "node-1");
		assertExact(accessed, tracesRequiredTables, "readTracesAt");
	});

	it("readCurrentTraceProjection accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb({
			...FIXTURE,
			visible_trace: fakeHandle([
				{
					traceId: 1n,
					locationKind: "place_node",
					locationRef: "node-1",
					payloadJson: '{"action_id":"response","occurrence_id":"7"}',
				},
			]),
			action_definition_tag: fakeHandle([{ actionId: "response", tag: "ui.response-slot=1" }]),
			visible_prompt_occurrence: fakeHandle([
				{
					occurrenceId: 7n,
					promptDefId: "prompt",
					audienceTraceId: 0n,
					responseActionIds: ["response"],
				},
			]),
			public_metadata_attachment: fakeHandle([]),
			visible_metadata_attachment: fakeHandle([]),
		});
		readCurrentTraceProjection(proxy, asEntityRef("1"));
		assertExact(accessed, currentTraceProjectionRequiredTables, "readCurrentTraceProjection");
	});

	it("readEntityContainment accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readEntityContainment(proxy, asEntityRef("1"));
		assertExact(accessed, entityContainmentRequiredTables, "readEntityContainment");
	});

	it("bundle entity readers access exactly their declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readEntity(proxy, asEntityRef("a1"));
		readItem(proxy, asEntityRef("core/item/sword"));
		assertExact(accessed, bundleEntityRequiredTables, "bundle entity readers");
	});

	it("bundle definition readers access exactly their declared tables", () => {
		const cap = makeProxyDb(FIXTURE);
		readCapabilityDefinition(cap.proxy, "core/use");
		assertExact(cap.accessed, capabilityRequiredTables, "readCapabilityDefinition");

		const res = makeProxyDb(FIXTURE);
		readResourceDefinition(res.proxy, "core/hp");
		assertExact(res.accessed, resourceRequiredTables, "readResourceDefinition");
	});

	it("readSelfCapabilities accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readSelfCapabilities(proxy, asEntityRef("1"));
		// Cover the non-spatial ownership path as well as the spatial fast path.
		expect(readSelfCapabilities(proxy, asEntityRef("999"))).toEqual([]);
		assertExact(accessed, selfCapabilitiesRequiredTables, "readSelfCapabilities");
	});

	it("readSelfRecentEvaluations accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readSelfRecentEvaluations(proxy, asEntityRef("1"));
		assertExact(accessed, selfEvaluationsRequiredTables, "readSelfRecentEvaluations");
	});

	it("readSelfEvaluationById accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readSelfEvaluationById(proxy, asEntityRef("1"), "eval:1");
		assertExact(accessed, selfEvaluationsRequiredTables, "readSelfEvaluationById");
	});

	it("readSelfEconomyChannelSpends accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		const [row] = readSelfEconomyChannelSpends(proxy, asEntityRef("1"));
		expect(row?.last_spend?.cost_ms).toBe("3000");
		assertExact(accessed, selfEconomyRequiredTables, "readSelfEconomyChannelSpends");
	});

	it("readSelfEconomyBudget accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		const budget = readSelfEconomyBudget(proxy, asEntityRef("1"));
		expect(budget.status).toBe("ok");
		expect(budget.channels[0]?.remaining_ms).toBe("3000");
		assertExact(accessed, selfEconomyBudgetRequiredTables, "readSelfEconomyBudget");
	});

	it("readEquipment accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readEquipment(proxy, asEntityRef("a1"));
		assertExact(accessed, equipmentRequiredTables, "readEquipment");
	});

	it("actors_and_bodies readers access exactly their declared tables together", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		readActorPrincipals(proxy);
		readActorIdentityBindings(proxy);
		readEntityBody(proxy, asEntityRef("1"));
		readObjectStatesForEntity(proxy, asEntityRef("1"));
		assertExact(accessed, actorsAndBodiesRequiredTables, "actors_and_bodies readers");
	});

	it("suggestNextAction accesses exactly its declared tables", () => {
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		suggestNextAction(proxy, asEntityRef("1"));
		assertExact(accessed, suggestNextActionRequiredTables, "suggestNextAction");
	});

	it("proxy hard-fails on camelCase accessor", () => {
		const { proxy } = makeProxyDb(FIXTURE);
		expect(() => (proxy as unknown as Record<string, unknown>).worldTime).toThrow(
			/camelCase accessor "worldTime"/,
		);
	});
});

// ---------------------------------------------------------------------------
// Negative completeness tests (#18)
// Spec: under-declared reader accesses place_node but only declares
// actor_spatial_location; over-declared reader declares both but only
// accesses actor_spatial_location. Both must fail with both names in error.
// ---------------------------------------------------------------------------

describe("manifest completeness — negative cases", () => {
	it("under-declared: reader declares ['visible_actor_spatial_location'] but accesses visible_place_node — both names in error", () => {
		// Synthetic reader: declares only actor_spatial_location, but reads visible_place_node too.
		function syntheticUnderDeclared(db: SnapshotDb): void {
			const _loc = db.visible_actor_spatial_location;
			const _node = db.visible_place_node;
		}
		const declared = ["visible_actor_spatial_location"] as const;
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		syntheticUnderDeclared(proxy);
		let errorMsg = "";
		try {
			assertExact(accessed, declared, "syntheticUnderDeclared");
		} catch (e) {
			errorMsg = (e as Error).message;
		}
		expect(errorMsg).toMatch(/actor_spatial_location/);
		expect(errorMsg).toMatch(/visible_place_node/);
	});

	it("over-declared: reader declares ['visible_actor_spatial_location','visible_place_node'] but only accesses actor_spatial_location — both names in error", () => {
		// Synthetic reader: declares two tables but only reads one.
		function syntheticOverDeclared(db: SnapshotDb): void {
			const _loc = db.visible_actor_spatial_location;
		}
		const declared = ["visible_actor_spatial_location", "visible_place_node"] as const;
		const { proxy, accessed } = makeProxyDb(FIXTURE);
		syntheticOverDeclared(proxy);
		let errorMsg = "";
		try {
			assertExact(accessed, declared, "syntheticOverDeclared");
		} catch (e) {
			errorMsg = (e as Error).message;
		}
		expect(errorMsg).toMatch(/actor_spatial_location/);
		expect(errorMsg).toMatch(/visible_place_node/);
	});
});
