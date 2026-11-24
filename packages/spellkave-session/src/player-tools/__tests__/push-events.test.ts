// ADR-0093 P1 (D-2) — offline proof of `createWorldEventBuilder`
// (`push-events.ts`), sibling to `world-deltas.test.ts`'s delta-tracker
// proof: same fake-`SnapshotDb`-rows harness (no live node), same
// mutate-the-fixture-array-between-calls idiom to simulate a world change
// landing in the subscription cache.

import type { SnapshotDb } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";

import {
	createWorldEventBuilder,
	isCausedByActor,
	type WorldEvent,
	type WorldEventBuilderOptions,
} from "../push-events";

const ACTOR_ID = "1";

function makeDb(parts: Record<string, Array<Record<string, unknown>>>): SnapshotDb {
	const out: SnapshotDb = {
		visible_entity_tag: { iter: () => [] },
		visible_entity_tag_coverage: { iter: () => [{ status: "complete", projectionVersion: 1 }] },
	};
	for (const [accessor, rows] of Object.entries(parts)) {
		out[accessor] = { iter: () => rows.values() };
	}
	return out;
}

/** One actor (entity 1, "Hero"), no session, no pending windows, no resource
 * deltas, no affordances — every mutable domain starts empty so a caller
 * pushes into the SAME array references between `diffAndAdvance()` calls. */
function baseFixture(): {
	db: SnapshotDb;
	sessionRows: Record<string, unknown>[];
	participantRows: Record<string, unknown>[];
	turnStateRows: Record<string, unknown>[];
	reactionRows: Record<string, unknown>[];
	reactorRows: Record<string, unknown>[];
	resourceDeltaRows: Record<string, unknown>[];
	conditionDeltaRows: Record<string, unknown>[];
	manipulationContextRows: Record<string, unknown>[];
	manipulationAvailableActionRows: Record<string, unknown>[];
	actionDefinitionRows: Record<string, unknown>[];
	outcomeTemplateRows: Record<string, unknown>[];
	traceRows: Record<string, unknown>[];
	entityRows: Record<string, unknown>[];
} {
	const sessionRows: Record<string, unknown>[] = [];
	const participantRows: Record<string, unknown>[] = [];
	const turnStateRows: Record<string, unknown>[] = [];
	const reactionRows: Record<string, unknown>[] = [];
	const reactorRows: Record<string, unknown>[] = [];
	const resourceDeltaRows: Record<string, unknown>[] = [];
	const conditionDeltaRows: Record<string, unknown>[] = [];
	const affordanceRows: Record<string, unknown>[] = [];
	const affordanceTemplateRows: Record<string, unknown>[] = [];
	const manipulationContextRows: Record<string, unknown>[] = [
		{ perceiverEntityId: 1n, schemaVersion: 1, revision: 1n, ready: true },
	];
	const manipulationAvailableActionRows: Record<string, unknown>[] = [];
	const actionDefinitionRows: Record<string, unknown>[] = [];
	const outcomeTemplateRows: Record<string, unknown>[] = [];
	const traceRows: Record<string, unknown>[] = [];
	const entityRows: Record<string, unknown>[] = [];
	const db = makeDb({
		world_time: [{ tick: 1n }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [],
		session: sessionRows,
		session_participant: participantRows,
		visible_turn_state: turnStateRows,
		visible_pending_resolution: reactionRows,
		visible_pending_resolution_reactor: reactorRows,
		visible_pending_stochastic_resolution: [],
		visible_event_resource_delta: resourceDeltaRows,
		visible_event_condition_delta: conditionDeltaRows,
		visible_affordance: affordanceRows,
		affordance_template: affordanceTemplateRows,
		visible_manipulation_context: manipulationContextRows,
		visible_manipulation_available_action: manipulationAvailableActionRows,
		action_definition: actionDefinitionRows,
		outcome_template: outcomeTemplateRows,
		visible_trace: traceRows,
		entity: entityRows,
		visible_entity_tag: [],
	});
	return {
		db,
		sessionRows,
		participantRows,
		turnStateRows,
		reactionRows,
		reactorRows,
		resourceDeltaRows,
		conditionDeltaRows,
		manipulationContextRows,
		manipulationAvailableActionRows,
		actionDefinitionRows,
		outcomeTemplateRows,
		traceRows,
		entityRows,
	};
}

/** A factored context discloses action syntax independently of any target.
 * Advancement watches that action fact, never a materialized action-target
 * offer. */
function discloseManipulationAction(
	actionDefinitionRows: Record<string, unknown>[],
	outcomeTemplateRows: Record<string, unknown>[],
	manipulationAvailableActionRows: Record<string, unknown>[],
	actionId: string,
	displayName: string,
): void {
	actionDefinitionRows.push({
		actionId,
		displayName,
		selfOnly: true,
		selfEligible: true,
	});
	outcomeTemplateRows.push({
		outcomeTemplateId: `${actionId}/outcome`,
		manipulationActionId: actionId,
	});
	manipulationAvailableActionRows.push({
		actionFactId: `action:1:${actionId}`,
		perceiverEntityId: 1n,
		actionId,
		nicheIds: [],
	});
}

function builderOver(db: SnapshotDb, options?: WorldEventBuilderOptions) {
	return createWorldEventBuilder(
		() => db,
		() => ACTOR_ID,
		options,
	);
}

/** `visible_trace`'s own row shape (`traces.ts`'s `toTraceRow` is the model,
 * `readers.test.ts`'s trace fixtures the precedent for the camelCase
 * accessor keys). Defaults to a `place_node`-anchored, text-carrying row —
 * the shape the `srd/speak-aloud`/`srd/speak-to-room` chains inscribe
 * (`speech.ts`); overrides cover the `entity`-anchored (`srd/speak-to`) and
 * no-text-payload cases. */
function textTraceRow(
	traceId: number,
	overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
	return {
		traceId: BigInt(traceId),
		kind: "test/speech",
		locationKind: "place_node",
		locationRef: "node-1",
		payloadJson: JSON.stringify({ text: "Well met, traveler." }),
		inscribedAt: 1n,
		expiresAt: undefined,
		inscribedBy: "2",
		visibility: "Local",
		bundleId: "test",
		...overrides,
	};
}

describe("ADR-0093 D-2: createWorldEventBuilder", () => {
	it("primes quiet: the first call after construction returns []", () => {
		const { db } = baseFixture();
		const events = builderOver(db).diffAndAdvance();
		expect(events).toEqual([]);
	});

	it("session_lifecycle: opened, then closed", () => {
		const { db, sessionRows, participantRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance(); // prime, quiet

		sessionRows.push({
			sessionId: 5n,
			sessionDefId: "arena",
			lifecycle: "active",
			currentActor: "1",
			stateJson: "{}",
			openedBy: "1",
		});
		participantRows.push(
			{ sessionId: 5n, actorId: "2", ordinal: 1, joinedAt: 1n },
			{ sessionId: 5n, actorId: "1", ordinal: 0, joinedAt: 1n },
		);

		const opened = builder.diffAndAdvance();
		expect(opened).toEqual<WorldEvent[]>([
			{
				kind: "session_lifecycle",
				session_id: "5",
				phase: "opened",
				// ordinal-ordered (0, 1) — doubles as initiative order (T29).
				participants: ["1", "2"],
				opened_by: "1",
				observed_at_tick: 1,
			},
		]);

		(sessionRows[0] as { lifecycle: string }).lifecycle = "completed";
		const closed = builder.diffAndAdvance();
		expect(closed).toEqual<WorldEvent[]>([
			{
				kind: "session_lifecycle",
				session_id: "5",
				phase: "closed",
				participants: [],
				opened_by: "1",
				observed_at_tick: 1,
			},
		]);
	});

	it("turn_transition: first observed turn has from_actor null, a later change names the prior holder", () => {
		const { db, sessionRows, participantRows, turnStateRows } = baseFixture();
		sessionRows.push({
			sessionId: 5n,
			sessionDefId: "arena",
			lifecycle: "active",
			currentActor: "1",
			stateJson: "{}",
		});
		participantRows.push({ sessionId: 5n, actorId: "1", ordinal: 0, joinedAt: 1n });
		const builder = builderOver(db);
		builder.diffAndAdvance(); // prime with session already active

		turnStateRows.push({
			id: 0,
			turn: 1n,
			currentActor: 1n,
			activeSchedulerId: "arena-scheduler",
			scopeSessionId: 5n,
		});
		const first = builder.diffAndAdvance();
		expect(first).toEqual<WorldEvent[]>([
			{
				kind: "turn_transition",
				session_id: "5",
				from_actor: null,
				to_actor: "1",
				observed_at_tick: 1,
			},
		]);

		(turnStateRows[0] as { currentActor: bigint; turn: bigint }).currentActor = 2n;
		(turnStateRows[0] as { turn: bigint }).turn = 2n;
		const second = builder.diffAndAdvance();
		expect(second).toEqual<WorldEvent[]>([
			{
				kind: "turn_transition",
				session_id: "5",
				from_actor: "1",
				to_actor: "2",
				observed_at_tick: 1,
			},
		]);
	});

	it("reaction_window: a reaction seat opening then being answered (row removed) surfaces opened then closed", () => {
		const { db, reactionRows, reactorRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance(); // prime, quiet

		reactionRows.push({
			pendingId: 7n,
			originatingActionId: "core/shield",
			originatingActor: "2",
			targetActor: "1",
			computedOutcomeTemplate: "core/shield/outcome",
			sessionId: 5n,
			windowOpensAtMicros: 100n,
			windowClosesAtMicros: 200n,
			depth: 1n,
			bundleId: "core",
		});
		reactorRows.push({
			rowId: 1n,
			pendingId: 7n,
			entityRef: "1",
			reacted: false,
			windowedAt: 1n,
			bundleId: "core",
		});

		const opened = builder.diffAndAdvance();
		expect(opened).toEqual<WorldEvent[]>([
			{
				kind: "reaction_window",
				window_kind: "reaction",
				phase: "opened",
				pending_id: "7",
				originating_action_id: "core/shield",
				originating_actor: "2",
				observed_at_tick: 1,
			},
		]);

		reactionRows.length = 0;
		reactorRows.length = 0;
		const closed = builder.diffAndAdvance();
		expect(closed).toEqual<WorldEvent[]>([
			{
				kind: "reaction_window",
				window_kind: "reaction",
				phase: "closed",
				pending_id: "7",
				originating_action_id: "core/shield",
				originating_actor: "2",
				observed_at_tick: 1,
			},
		]);
	});

	it("self_hit: a new negative resource delta on the actor's own entity surfaces damage taken, with attacker_id populated from source_entity_ref (ADR-0093 B2)", () => {
		const { db, resourceDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance(); // prime, quiet

		resourceDeltaRows.push({
			eventId: "1001",
			entityId: 1n,
			resourceId: "srd/hp",
			delta: -4,
			newValue: 7,
			templateId: "srd/attack/melee/outcome",
			sourceEntityRef: "2",
		});
		const hit = builder.diffAndAdvance();
		expect(hit).toEqual<WorldEvent[]>([
			{
				kind: "self_hit",
				resource_id: "srd/hp",
				amount: 4,
				new_value: 7,
				attack_kind: "srd/attack/melee/outcome",
				attacker_id: "2",
				observed_at_tick: 1,
			},
		]);

		// The same delta row is still present on the NEXT call — already seen
		// (semantic dedupe by event_id), not re-reported.
		const quiet = builder.diffAndAdvance();
		expect(quiet).toEqual([]);

		// A positive (healing) delta never surfaces as a self_hit.
		resourceDeltaRows.push({
			eventId: "1002",
			entityId: 1n,
			resourceId: "srd/hp",
			delta: 3,
			newValue: 10,
			templateId: "srd/heal/outcome",
			sourceEntityRef: "2",
		});
		expect(builder.diffAndAdvance()).toEqual([]);
	});

	it("dealt_hit: a new negative resource delta this actor caused on another body surfaces amount only, never target HP", () => {
		const { db, resourceDeltaRows, entityRows } = baseFixture();
		entityRows.push({ entityId: 10n, name: "Crypt Warden" });
		const builder = builderOver(db);
		builder.diffAndAdvance();

		resourceDeltaRows.push({
			eventId: "3001",
			entityId: 10n,
			resourceId: "srd/hp",
			delta: -6,
			newValue: 4,
			templateId: "srd/attack/melee/success",
			sourceEntityRef: "1",
		});
		const events = builder.diffAndAdvance();
		expect(events).toEqual<WorldEvent[]>([
			{
				kind: "dealt_hit",
				target_name: "Crypt Warden",
				amount: 6,
				attacker_id: "1",
				observed_at_tick: 1,
			},
		]);
		expect(JSON.stringify(events)).not.toContain("new_value");
		expect(JSON.stringify(events)).not.toContain("newValue");
	});

	it("dealt_hit: zeroing another body's xp_value latch is not a hit (sk-0m4.15)", () => {
		const { db, resourceDeltaRows, entityRows } = baseFixture();
		entityRows.push({ entityId: 11n, name: "Crypt Warden" });
		const builder = builderOver(db);
		builder.diffAndAdvance();

		resourceDeltaRows.push({
			eventId: "3002",
			entityId: 11n,
			resourceId: "srd/xp_value",
			delta: -300,
			newValue: 0,
			templateId: "srd/claim-victory/success",
			sourceEntityRef: "1",
		});
		expect(builder.diffAndAdvance()).toEqual([]);
	});

	it("xp_gained: a positive delta on the actor's own xp pool surfaces as an award, never a dealt_hit", () => {
		const { db, resourceDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance();

		resourceDeltaRows.push({
			eventId: "3003",
			entityId: 1n,
			resourceId: "srd/xp",
			delta: 300,
			newValue: 300,
			templateId: "srd/claim-victory/success",
			sourceEntityRef: "1",
		});
		expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
			{
				kind: "xp_gained",
				amount: 300,
				new_value: 300,
				observed_at_tick: 1,
			},
		]);
		expect(builder.diffAndAdvance()).toEqual([]);
	});

	it("xp_gained: a kill-time grant (Aldwin writes the killer's own srd/xp) classifies the same way", () => {
		const { db, resourceDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance();

		resourceDeltaRows.push({
			eventId: "3005",
			entityId: 1n,
			resourceId: "srd/xp",
			delta: 50,
			newValue: 50,
			templateId: "elven_mini/dm/grant-kill-xp/10/success",
			sourceEntityRef: "2",
		});
		expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
			{
				kind: "xp_gained",
				amount: 50,
				new_value: 50,
				observed_at_tick: 1,
			},
		]);
	});

	it("self_resource_spent: a non-hp self spend is not combat damage (sk-0m4.20)", () => {
		const { db, resourceDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance();

		resourceDeltaRows.push({
			eventId: "3004",
			entityId: 1n,
			resourceId: "srd/fighter/action-surge-uses",
			delta: -1,
			newValue: 0,
			templateId: "srd/fighter/action-surge/success",
			sourceEntityRef: "1",
		});
		expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
			{
				kind: "self_resource_spent",
				resource_id: "srd/fighter/action-surge-uses",
				amount: 1,
				new_value: 0,
				source: "srd/fighter/action-surge/success",
				observed_at_tick: 1,
			},
		]);
	});

	it("self_resource_spent: a change ANOTHER entity caused on the actor's own pool is not a spend and is never pushed (sk-jay0.1.8.96)", () => {
		const { db, resourceDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance();

		// A sheet correction written by entity 2 (e.g. a DM `set`): the
		// actor's pool went down, but the actor spent nothing.
		resourceDeltaRows.push({
			eventId: "3006",
			entityId: 1n,
			resourceId: "srd/speed-walk",
			delta: -114,
			newValue: 6,
			templateId: "srd/dm/set/srd.speed-walk/success",
			sourceEntityRef: "2",
		});
		expect(builder.diffAndAdvance()).toEqual([]);
		// Dropped, not buffered: it is not a late consequence either.
		expect(builder.takeWhere((event) => isCausedByActor(event, ACTOR_ID, 1))).toEqual([]);
		expect(builder.diffAndAdvance()).toEqual([]);
	});

	it("self_resource_spent: an ownerless own-pool delta (empty source_entity_ref) is still pushed (sk-jay0.1.8.96)", () => {
		const { db, resourceDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance();

		resourceDeltaRows.push({
			eventId: "3007",
			entityId: 1n,
			resourceId: "srd/fighter/action-surge-uses",
			delta: -1,
			newValue: 0,
			templateId: "srd/fighter/action-surge/success",
			sourceEntityRef: "",
		});
		expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
			{
				kind: "self_resource_spent",
				resource_id: "srd/fighter/action-surge-uses",
				amount: 1,
				new_value: 0,
				source: "srd/fighter/action-surge/success",
				observed_at_tick: 1,
			},
		]);
	});

	it("self_hit: an ambient/ownerless delta (empty source_entity_ref, e.g. a clock-fire hazard) reports attacker_id honestly null, never fabricated", () => {
		const { db, resourceDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance(); // prime, quiet

		resourceDeltaRows.push({
			eventId: "2001",
			entityId: 1n,
			resourceId: "srd/hp",
			delta: -2,
			newValue: 9,
			templateId: "srd/hazard/spike_trap/outcome",
			sourceEntityRef: "",
		});
		expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
			{
				kind: "self_hit",
				resource_id: "srd/hp",
				amount: 2,
				new_value: 9,
				attack_kind: "srd/hazard/spike_trap/outcome",
				attacker_id: null,
				observed_at_tick: 1,
			},
		]);
	});

	it("self_condition_changed: a new condition delta on the actor's own entity surfaces applied/removed, with source_entity_id populated from source_entity_ref (K-B Part B)", () => {
		const { db, conditionDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance(); // prime, quiet

		conditionDeltaRows.push({
			eventId: "5001",
			entityId: 1n,
			conditionDefinitionId: "srd/condition/prone",
			applied: true,
			sourceEntityRef: "2",
			templateId: "srd/attack/melee/outcome",
			expiresAtTick: 0n,
		});
		expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
			{
				kind: "self_condition_changed",
				condition_id: "srd/condition/prone",
				applied: true,
				source_entity_id: "2",
				observed_at_tick: 1,
			},
		]);

		// The same delta row is still present on the NEXT call — already seen
		// (semantic dedupe by event_id), not re-reported.
		expect(builder.diffAndAdvance()).toEqual([]);

		conditionDeltaRows.push({
			eventId: "5002",
			entityId: 1n,
			conditionDefinitionId: "srd/condition/prone",
			applied: false,
			sourceEntityRef: "",
			templateId: "",
			expiresAtTick: 0n,
		});
		expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
			{
				kind: "self_condition_changed",
				condition_id: "srd/condition/prone",
				applied: false,
				source_entity_id: null,
				observed_at_tick: 1,
			},
		]);
	});

	it("dealt_condition: a new condition delta this actor caused on another body surfaces the target name, never own-body wording", () => {
		const { db, conditionDeltaRows, entityRows } = baseFixture();
		entityRows.push({ entityId: 10n, name: "Crypt Warden" });
		const builder = builderOver(db);
		builder.diffAndAdvance();

		conditionDeltaRows.push({
			eventId: "5003",
			entityId: 10n,
			conditionDefinitionId: "srd/condition/prone",
			applied: true,
			sourceEntityRef: "1",
			templateId: "srd/attack/melee/success",
			expiresAtTick: 0n,
		});
		expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
			{
				kind: "dealt_condition",
				target_name: "Crypt Warden",
				condition_id: "srd/condition/prone",
				applied: true,
				source_entity_id: "1",
				observed_at_tick: 1,
			},
		]);
	});

	it("condition_delta and resource_delta event ids never collide across their own dedupe sets, even sharing the same world_event id space", () => {
		const { db, resourceDeltaRows, conditionDeltaRows } = baseFixture();
		const builder = builderOver(db);
		builder.diffAndAdvance();

		// Same event_id text on both tables — a real possibility since both
		// draw from the same world_event id space (module header).
		resourceDeltaRows.push({
			eventId: "6001",
			entityId: 1n,
			resourceId: "srd/hp",
			delta: -4,
			newValue: 7,
			templateId: "srd/attack/melee/outcome",
			sourceEntityRef: "2",
		});
		conditionDeltaRows.push({
			eventId: "6001",
			entityId: 1n,
			conditionDefinitionId: "srd/condition/prone",
			applied: true,
			sourceEntityRef: "2",
			templateId: "srd/attack/melee/outcome",
			expiresAtTick: 0n,
		});
		const events = builder.diffAndAdvance();
		expect(events).toContainEqual({
			kind: "self_hit",
			resource_id: "srd/hp",
			amount: 4,
			new_value: 7,
			attack_kind: "srd/attack/melee/outcome",
			attacker_id: "2",
			observed_at_tick: 1,
		});
		expect(events).toContainEqual({
			kind: "self_condition_changed",
			condition_id: "srd/condition/prone",
			applied: true,
			source_entity_id: "2",
			observed_at_tick: 1,
		});
		// Both fired despite the shared id — neither dedupe set swallowed the
		// other's event.
		expect(events).toHaveLength(2);
	});

	it("a builder recreated mid-session reports nothing new on its first call (the documented recreate trap)", () => {
		const { db, sessionRows, participantRows } = baseFixture();
		sessionRows.push({
			sessionId: 5n,
			sessionDefId: "arena",
			lifecycle: "active",
			currentActor: "1",
			stateJson: "{}",
		});
		participantRows.push({ sessionId: 5n, actorId: "1", ordinal: 0, joinedAt: 1n });

		// A FRESH builder over a world where the session is already open sees
		// this as its own quiet baseline — never reports "opened" for state
		// that already existed before it was constructed.
		const freshBuilder = builderOver(db);
		expect(freshBuilder.diffAndAdvance()).toEqual([]);
		expect(freshBuilder.diffAndAdvance()).toEqual([]);
	});

	describe("advancement_available (Level-Up DM Arc S2)", () => {
		const WATCHED_ACTION_ID = "srd/advancement/level-up";

		it("never fires when watchedAdvancementActionIds is omitted (default quiet, pre-S2 callers unaffected)", () => {
			const { db, actionDefinitionRows, outcomeTemplateRows, manipulationAvailableActionRows } =
				baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			discloseManipulationAction(
				actionDefinitionRows,
				outcomeTemplateRows,
				manipulationAvailableActionRows,
				WATCHED_ACTION_ID,
				`${WATCHED_ACTION_ID}/affordance`,
			);
			expect(builder.diffAndAdvance()).toEqual([]);
		});

		it("absent below threshold, fires exactly once when the watched action appears, and is never repeated on re-delivery", () => {
			const { db, actionDefinitionRows, outcomeTemplateRows, manipulationAvailableActionRows } =
				baseFixture();
			const builder = builderOver(db, { watchedAdvancementActionIds: [WATCHED_ACTION_ID] });

			// Prime with the affordance still absent (below the XP threshold).
			expect(builder.diffAndAdvance()).toEqual([]);
			expect(builder.diffAndAdvance()).toEqual([]);

			// Crossing the threshold discloses the action in the factored context.
			discloseManipulationAction(
				actionDefinitionRows,
				outcomeTemplateRows,
				manipulationAvailableActionRows,
				WATCHED_ACTION_ID,
				`${WATCHED_ACTION_ID}/affordance`,
			);
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
				{
					kind: "advancement_available",
					action_id: WATCHED_ACTION_ID,
					// No affordance_template row seeded — readAffordances' own fallback
					// (affordances.ts's toAffordanceRow) is the DERIVED-BY template id,
					// not the action id.
					display_name: `${WATCHED_ACTION_ID}/affordance`,
					observed_at_tick: 1,
				},
			]);

			// Still present, unconsumed: re-delivery must NOT duplicate the event.
			expect(builder.diffAndAdvance()).toEqual([]);
		});

		it("an unwatched action id appearing self-targeted never fires (narrow allow-list match, not every self-targeted affordance)", () => {
			const { db, actionDefinitionRows, outcomeTemplateRows, manipulationAvailableActionRows } =
				baseFixture();
			const builder = builderOver(db, { watchedAdvancementActionIds: [WATCHED_ACTION_ID] });
			builder.diffAndAdvance(); // prime, quiet

			discloseManipulationAction(
				actionDefinitionRows,
				outcomeTemplateRows,
				manipulationAvailableActionRows,
				"srd/class-feature/fighter/second-wind",
				"Second Wind",
			);
			expect(builder.diffAndAdvance()).toEqual([]);
		});

		it("re-fires after the affordance disappears and later reappears (a further threshold crossing)", () => {
			const { db, actionDefinitionRows, outcomeTemplateRows, manipulationAvailableActionRows } =
				baseFixture();
			const builder = builderOver(db, { watchedAdvancementActionIds: [WATCHED_ACTION_ID] });
			builder.diffAndAdvance(); // prime, quiet

			discloseManipulationAction(
				actionDefinitionRows,
				outcomeTemplateRows,
				manipulationAvailableActionRows,
				WATCHED_ACTION_ID,
				`${WATCHED_ACTION_ID}/affordance`,
			);
			expect(builder.diffAndAdvance()).toHaveLength(1);

			// Consumed (level-up fired, the XP gate closes) — the action disappears.
			actionDefinitionRows.length = 0;
			outcomeTemplateRows.length = 0;
			manipulationAvailableActionRows.length = 0;
			expect(builder.diffAndAdvance()).toEqual([]);

			// A LATER threshold crossing re-materialises the same action id.
			discloseManipulationAction(
				actionDefinitionRows,
				outcomeTemplateRows,
				manipulationAvailableActionRows,
				WATCHED_ACTION_ID,
				`${WATCHED_ACTION_ID}/affordance`,
			);
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
				{
					kind: "advancement_available",
					action_id: WATCHED_ACTION_ID,
					display_name: `${WATCHED_ACTION_ID}/affordance`,
					observed_at_tick: 1,
				},
			]);
		});

		it("display_name is sourced from the matching action_definition row", () => {
			const { db, actionDefinitionRows, outcomeTemplateRows, manipulationAvailableActionRows } =
				baseFixture();
			const builder = builderOver(db, { watchedAdvancementActionIds: [WATCHED_ACTION_ID] });
			builder.diffAndAdvance(); // prime, quiet

			discloseManipulationAction(
				actionDefinitionRows,
				outcomeTemplateRows,
				manipulationAvailableActionRows,
				WATCHED_ACTION_ID,
				"Level Up",
			);
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
				{
					kind: "advancement_available",
					action_id: WATCHED_ACTION_ID,
					display_name: "Level Up",
					observed_at_tick: 1,
				},
			]);
		});
	});

	describe("speech_heard (ADR-0093 postscript, 2026-08-08)", () => {
		it("never fires when priming already found the trace present (recreate-trap discipline, same as every other kind)", () => {
			const { db, traceRows } = baseFixture();
			traceRows.push(textTraceRow(1));

			const freshBuilder = builderOver(db);
			expect(freshBuilder.diffAndAdvance()).toEqual([]);
			expect(freshBuilder.diffAndAdvance()).toEqual([]);
		});

		it("fires exactly once when a NEW text-carrying trace becomes visible, and is never repeated on re-delivery", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(textTraceRow(1));
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
				{
					kind: "speech_heard",
					inscribed_at: 1,
					trace_id: "1",
					trace_kind: "test/speech",
					text: "Well met, traveler.",
					inscribed_by: "2",
					inscribed_by_name: null,
					location_kind: "place_node",
					location_ref: "node-1",
					observed_at_tick: 1,
				},
			]);

			// Still present, unconsumed: re-delivery must NOT duplicate the event.
			expect(builder.diffAndAdvance()).toEqual([]);
		});

		it("forwards payload action_id without using it as spoken text", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance();

			traceRows.push(
				textTraceRow(1, {
					payloadJson: JSON.stringify({
						text: "Sure, I'll go.",
						action_id: "dm/dialog/choice/2",
					}),
				}),
			);
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
				{
					kind: "speech_heard",
					inscribed_at: 1,
					trace_id: "1",
					trace_kind: "test/speech",
					text: "Sure, I'll go.",
					action_id: "dm/dialog/choice/2",
					inscribed_by: "2",
					inscribed_by_name: null,
					location_kind: "place_node",
					location_ref: "node-1",
					observed_at_tick: 1,
				},
			]);
		});

		it("a trace with no text key in its payload never fires (the content-agnostic discriminator, not a kind/bundle check)", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(
				textTraceRow(1, {
					kind: "test/footprint",
					payloadJson: JSON.stringify({ shoe_size: 9 }),
				}),
			);
			expect(builder.diffAndAdvance()).toEqual([]);
		});

		it("an entity-anchored trace (srd/speak-to's addressee anchor) also fires — never location-scoped", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(
				textTraceRow(1, {
					locationKind: "entity",
					locationRef: "1",
					payloadJson: JSON.stringify({ text: "A word with you, alone." }),
				}),
			);
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
				{
					kind: "speech_heard",
					inscribed_at: 1,
					trace_id: "1",
					trace_kind: "test/speech",
					text: "A word with you, alone.",
					inscribed_by: "2",
					inscribed_by_name: null,
					location_kind: "entity",
					location_ref: "1",
					observed_at_tick: 1,
				},
			]);
		});

		it("an unattributed/environmental trace reports inscribed_by honestly null, never fabricated", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(textTraceRow(1, { inscribedBy: "" }));
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([
				{
					kind: "speech_heard",
					inscribed_at: 1,
					trace_id: "1",
					trace_kind: "test/speech",
					text: "Well met, traveler.",
					inscribed_by: null,
					inscribed_by_name: null,
					location_kind: "place_node",
					location_ref: "node-1",
					observed_at_tick: 1,
				},
			]);
		});

		// sk-dms.17: the discriminator is structural (a NEW text-carrying row in
		// the actor's own `visible_trace`), which also matches what the actor
		// just said itself. The act's own result already echoes that back, and
		// the 🌍 register is the world speaking, not the actor.
		it("does not push the hearer's OWN utterance back as a world event", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(textTraceRow(1, { inscribedBy: ACTOR_ID }));
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([]);
		});

		it("a suppressed own utterance is not re-considered on a later cycle", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(textTraceRow(1, { inscribedBy: ACTOR_ID }));
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([]);
			// Still visible, still not news — the seen-set insert happens before
			// the suppression, so it can never resurface.
			expect(builder.diffAndAdvance()).toEqual<WorldEvent[]>([]);
		});

		it("reports inscribed_by_name null when the speaker is attributed but not perceivable", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			// This fixture has no scene rows at all, so entity 2 is attributed but
			// unseen — hearing a voice does not confer knowing whose it is.
			traceRows.push(textTraceRow(1));
			const [event] = builder.diffAndAdvance();
			expect(event).toMatchObject({ inscribed_by: "2", inscribed_by_name: null });
		});

		it("several new text-carrying traces in one cycle each fire their own event", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(
				textTraceRow(1, { payloadJson: JSON.stringify({ text: "First." }) }),
				textTraceRow(2, { payloadJson: JSON.stringify({ text: "Second." }) }),
			);
			const events = builder.diffAndAdvance();
			// `readRecentTraces` sorts newest-trace_id-first (module header:
			// same "recent window" shape as `readRecentResourceDeltas`), so the
			// higher-id trace surfaces first here — order is a scan-order
			// artifact, not a promised delivery guarantee; the test pins it so a
			// future reorder is a deliberate, reviewed choice.
			expect(events).toHaveLength(2);
			expect(events.map((e) => (e as { text: string }).text)).toEqual(["Second.", "First."]);
		});
	});

	// sk-0m4.73: `takeWhere`'s carry buffer — the primitive the companion
	// `communicate` reply window (`tools.ts`) polls to return an NPC's reply
	// synchronously without losing or duplicating anything against the
	// `pushes` feed (`diffAndAdvance`). Every case below sits entirely on
	// this builder, independent of the reply-window tool itself.
	describe("takeWhere (sk-0m4.73 carry semantics)", () => {
		function isFromSpeaker(speakerId: string) {
			return (event: WorldEvent): boolean =>
				event.kind === "speech_heard" && event.inscribed_by === speakerId;
		}

		it("returns only the matching event; a non-matching event in the same cycle is buffered, not lost", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(
				textTraceRow(1, { inscribedBy: "2", payloadJson: JSON.stringify({ text: "From 2." }) }),
				textTraceRow(2, { inscribedBy: "3", payloadJson: JSON.stringify({ text: "From 3." }) }),
			);

			const matched = builder.takeWhere(isFromSpeaker("3"));
			expect(matched).toHaveLength(1);
			expect(matched[0]).toMatchObject({ inscribed_by: "3", text: "From 3." });

			// The unmatched event from speaker 2 was buffered, not dropped — the
			// very next drain (pushes) delivers it exactly once.
			const rest = builder.diffAndAdvance();
			expect(rest).toEqual<WorldEvent[]>([
				{
					kind: "speech_heard",
					inscribed_at: 1,
					trace_id: "1",
					trace_kind: "test/speech",
					text: "From 2.",
					inscribed_by: "2",
					inscribed_by_name: null,
					location_kind: "place_node",
					location_ref: "node-1",
					observed_at_tick: 1,
				},
			]);
			// And it is never delivered a second time.
			expect(builder.diffAndAdvance()).toEqual([]);
		});

		it("carried events are prepended, oldest first, ahead of a later cycle's newly observed events", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(textTraceRow(1, { inscribedBy: "2" }));
			// Predicate never matches: the whole cycle is buffered.
			expect(builder.takeWhere(() => false)).toEqual([]);

			traceRows.push(
				textTraceRow(2, { inscribedBy: "3", payloadJson: JSON.stringify({ text: "Newer." }) }),
			);
			const drained = builder.diffAndAdvance();
			expect(drained.map((e) => (e as { trace_id: string }).trace_id)).toEqual(["1", "2"]);
		});

		it("a stateful predicate that stops matching after its first accept takes only the first of two simultaneous matches", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			// Two lines from the SAME addressed speaker land in one cycle — the
			// communicate reply window only wants the first; the second must stay
			// available for `pushes`, never silently dropped or double-returned.
			traceRows.push(
				textTraceRow(1, { inscribedBy: "2", payloadJson: JSON.stringify({ text: "First line." }) }),
				textTraceRow(2, {
					inscribedBy: "2",
					payloadJson: JSON.stringify({ text: "Second line." }),
				}),
			);

			let matchedOnce = false;
			const takeFirstFromTwo = (event: WorldEvent): boolean => {
				if (matchedOnce) return false;
				if (event.kind !== "speech_heard" || event.inscribed_by !== "2") return false;
				matchedOnce = true;
				return true;
			};

			const matched = builder.takeWhere(takeFirstFromTwo);
			expect(matched).toHaveLength(1);

			const rest = builder.diffAndAdvance();
			expect(rest).toHaveLength(1);
			expect(rest[0]).not.toEqual(matched[0]);
		});

		it("no matches: takeWhere returns [] and every event is buffered for the next drain, same as an all-unmatched cycle", () => {
			const { db, traceRows } = baseFixture();
			const builder = builderOver(db);
			builder.diffAndAdvance(); // prime, quiet

			traceRows.push(textTraceRow(1, { inscribedBy: "2" }));
			expect(builder.takeWhere(() => false)).toEqual([]);

			const drained = builder.diffAndAdvance();
			expect(drained).toHaveLength(1);
			expect(drained[0]).toMatchObject({ kind: "speech_heard", inscribed_by: "2" });
		});
	});

	// sk-0m4.74: `isCausedByActor` is the CONSEQUENCE predicate `tools.ts`'s
	// `takeConsequences` takes with. One table, every kind, both the
	// same-tick/caused-by-me accept and the never-a-consequence reject —
	// pure function, no builder needed.
	describe("isCausedByActor (sk-0m4.74 consequence predicate)", () => {
		const ME = "1";
		const TICK = 5;

		it("dealt_hit: accepted when attacker_id === me at the act tick, rejected for a different attacker or a different tick", () => {
			expect(
				isCausedByActor(
					{
						kind: "dealt_hit",
						target_name: "Goblin",
						amount: 6,
						attacker_id: ME,
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(true);
			expect(
				isCausedByActor(
					{
						kind: "dealt_hit",
						target_name: "Goblin",
						amount: 6,
						attacker_id: "9",
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(false);
			expect(
				isCausedByActor(
					{
						kind: "dealt_hit",
						target_name: "Goblin",
						amount: 6,
						attacker_id: ME,
						observed_at_tick: TICK - 1,
					},
					ME,
					TICK,
				),
			).toBe(false);
		});

		it("dealt_condition: accepted when source_entity_id === me at the act tick, rejected for a different source or a different tick", () => {
			expect(
				isCausedByActor(
					{
						kind: "dealt_condition",
						target_name: "Goblin",
						condition_id: "srd/condition/prone",
						applied: true,
						source_entity_id: ME,
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(true);
			expect(
				isCausedByActor(
					{
						kind: "dealt_condition",
						target_name: "Goblin",
						condition_id: "srd/condition/prone",
						applied: true,
						source_entity_id: "9",
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(false);
			expect(
				isCausedByActor(
					{
						kind: "dealt_condition",
						target_name: "Goblin",
						condition_id: "srd/condition/prone",
						applied: true,
						source_entity_id: ME,
						observed_at_tick: TICK - 1,
					},
					ME,
					TICK,
				),
			).toBe(false);
		});

		it("self_condition_changed: NEVER a consequence, even at the same tick and with source_entity_id === me (a same-tick own-body condition can just as easily be another actor's attack landing a status)", () => {
			expect(
				isCausedByActor(
					{
						kind: "self_condition_changed",
						condition_id: "srd/condition/prone",
						applied: true,
						source_entity_id: ME,
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(false);
		});

		it("self_resource_spent / xp_gained: accepted at the act tick (already own-pool scoped by construction), rejected off-tick", () => {
			expect(
				isCausedByActor(
					{
						kind: "self_resource_spent",
						resource_id: "srd/fighter/action-surge-uses",
						amount: 1,
						source: "srd/fighter/action-surge/success",
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(true);
			expect(
				isCausedByActor({ kind: "xp_gained", amount: 300, observed_at_tick: TICK }, ME, TICK),
			).toBe(true);
			expect(
				isCausedByActor({ kind: "xp_gained", amount: 300, observed_at_tick: TICK - 1 }, ME, TICK),
			).toBe(false);
		});

		it("reaction_window: only phase 'opened' with originating_actor === me is a consequence; 'closed' never is, even at the same tick", () => {
			const opened = {
				kind: "reaction_window" as const,
				window_kind: "reaction" as const,
				phase: "opened" as const,
				pending_id: "7",
				originating_action_id: "core/shield",
				originating_actor: ME,
				observed_at_tick: TICK,
			};
			expect(isCausedByActor(opened, ME, TICK)).toBe(true);
			expect(isCausedByActor({ ...opened, originating_actor: "9" }, ME, TICK)).toBe(false);
			expect(isCausedByActor({ ...opened, phase: "closed" }, ME, TICK)).toBe(false);
		});

		it("session_lifecycle: only phase 'opened' with opened_by === me is a consequence; 'closed' never is", () => {
			const opened = {
				kind: "session_lifecycle" as const,
				session_id: "5",
				phase: "opened" as const,
				participants: [ME, "2"],
				opened_by: ME,
				observed_at_tick: TICK,
			};
			expect(isCausedByActor(opened, ME, TICK)).toBe(true);
			expect(isCausedByActor({ ...opened, opened_by: "2" }, ME, TICK)).toBe(false);
			expect(isCausedByActor({ ...opened, phase: "closed", participants: [] }, ME, TICK)).toBe(
				false,
			);
		});

		it("session_lifecycle: a foreign actor opening a session containing me in my act tick is not my consequence", () => {
			const openedByAnotherActor = {
				kind: "session_lifecycle" as const,
				session_id: "5",
				phase: "opened" as const,
				participants: [ME, "2"],
				opened_by: "2",
				observed_at_tick: TICK,
			};
			expect(isCausedByActor(openedByAnotherActor, ME, TICK)).toBe(false);
		});

		it("self_hit, turn_transition, speech_heard, advancement_available: NEVER a consequence, even at the same tick and even when the actor is otherwise implicated", () => {
			expect(
				isCausedByActor(
					{
						kind: "self_hit",
						resource_id: "srd/hp",
						amount: 4,
						attack_kind: "srd/attack/melee/outcome",
						attacker_id: ME,
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(false);
			expect(
				isCausedByActor(
					{
						kind: "turn_transition",
						session_id: "5",
						from_actor: null,
						to_actor: ME,
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(false);
			expect(
				isCausedByActor(
					{
						kind: "speech_heard",
						inscribed_at: 1,
						trace_id: "1",
						trace_kind: "test/speech",
						text: "Hello.",
						inscribed_by: ME,
						inscribed_by_name: null,
						location_kind: "place_node",
						location_ref: "node-1",
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(false);
			expect(
				isCausedByActor(
					{
						kind: "advancement_available",
						action_id: "srd/advancement/level-up",
						display_name: "Level Up",
						observed_at_tick: TICK,
					},
					ME,
					TICK,
				),
			).toBe(false);
		});
	});
});
