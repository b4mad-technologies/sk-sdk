// Shared offline fixture for the resource/condition-delta builder tests
// (`world_events_builder_order.test.ts`, `world_events_builder_spend_source.test.ts`,
// `world_events_builder_attacker_name.test.ts`). Every mutable domain is a live
// array: a test pushes rows between `diffAndAdvance()` calls to simulate a
// world change landing in the subscription cache. Vocabulary is `test/…` only.
import type { SnapshotDb } from "../connection";
import { createWorldEventBuilder } from "../world-events/builder";

/** The builder's own actor. A numeric ref resolves to itself. */
export const ACTOR_ID = "1";

type Row = Record<string, unknown>;

export interface DeltaFixture {
	db: SnapshotDb;
	sessionRows: Row[];
	participantRows: Row[];
	resourceDeltaRows: Row[];
	conditionDeltaRows: Row[];
	entityRows: Row[];
}

export function deltaFixture(): DeltaFixture {
	const sessionRows: Row[] = [];
	const participantRows: Row[] = [];
	const resourceDeltaRows: Row[] = [];
	const conditionDeltaRows: Row[] = [];
	const entityRows: Row[] = [];
	const parts: Record<string, Row[]> = {
		world_time: [{ tick: 1n }],
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		session: sessionRows,
		session_participant: participantRows,
		visible_turn_state: [],
		visible_pending_resolution: [],
		visible_pending_resolution_reactor: [],
		visible_pending_stochastic_resolution: [],
		visible_event_resource_delta: resourceDeltaRows,
		visible_event_condition_delta: conditionDeltaRows,
		visible_trace: [],
		entity: entityRows,
	};
	const db: SnapshotDb = {};
	for (const [accessor, rows] of Object.entries(parts)) {
		db[accessor] = { iter: () => rows.values() };
	}
	return { db, sessionRows, participantRows, resourceDeltaRows, conditionDeltaRows, entityRows };
}

/** A builder over `db`, already primed (the first drain is always quiet). */
export function primedBuilder(db: SnapshotDb) {
	const builder = createWorldEventBuilder(
		() => db,
		() => ACTOR_ID,
	);
	builder.diffAndAdvance();
	return builder;
}

/** A hit-point delta on the actor's own body. `source` "" is ownerless. */
export function ownHit(eventId: string, source: string, newValue: number): Row {
	return {
		eventId,
		entityId: 1n,
		resourceId: "test/hp",
		delta: -1,
		newValue,
		templateId: "test/strike/success",
		sourceEntityRef: source,
	};
}

/** A non-hit-point delta on the actor's own pool. */
export function ownPoolDelta(eventId: string, source: string, delta = -1): Row {
	return {
		eventId,
		entityId: 1n,
		resourceId: "test/focus",
		delta,
		newValue: 3,
		templateId: "test/focus/success",
		sourceEntityRef: source,
	};
}

export function ownXpGain(eventId: string, newValue: number): Row {
	return {
		eventId,
		entityId: 1n,
		resourceId: "test/xp",
		delta: 50,
		newValue,
		templateId: "test/award/success",
		sourceEntityRef: "2",
	};
}

export function ownCondition(eventId: string, conditionId: string, source = "2"): Row {
	return {
		eventId,
		entityId: 1n,
		conditionDefinitionId: conditionId,
		applied: true,
		sourceEntityRef: source,
	};
}

export function openSession(fixture: DeltaFixture): void {
	fixture.sessionRows.push({
		sessionId: 5n,
		sessionDefId: "arena",
		lifecycle: "active",
		currentActor: "1",
		stateJson: "{}",
		openedBy: "2",
	});
	fixture.participantRows.push({ sessionId: 5n, actorId: "1", ordinal: 0, joinedAt: 1n });
}
