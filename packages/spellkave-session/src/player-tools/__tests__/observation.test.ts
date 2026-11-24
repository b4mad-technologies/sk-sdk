import { asEntityRef, type SnapshotDb } from "@spellkave/sdk";
import type { ActorStateEntry } from "@spellkave/sdk/readers";
import { describe, expect, it } from "vitest";

import {
	buildObservation,
	describeArrival,
	describeOutcomeTemplate,
	describeSelfResourceDelta,
	describeSpawnedCreatures,
	OBSERVATION_NOTHING_HAPPENS,
	spawnedActorsAfter,
} from "../observation";

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

describe("#1921 observation register — pure helpers", () => {
	describe("buildObservation", () => {
		it("falls back to the fixed 'Nothing happens.' line when the outcome was not accepted, ignoring resolved/gapReason", () => {
			expect(buildObservation(false, "would-be prose", "would-be gap")).toEqual({
				observation: OBSERVATION_NOTHING_HAPPENS,
			});
		});

		it("carries the resolved prose when accepted and a source resolved content", () => {
			expect(buildObservation(true, "The worn map shows a route.", "unused gap")).toEqual({
				observation: "The worn map shows a route.",
			});
		});

		it("returns observation: null + the precise gap reason when accepted but nothing resolved — never a silently missing field", () => {
			const result = buildObservation(true, null, "no authored source for this verb class");
			expect(result.observation).toBeNull();
			expect(result.observation_gap).toBe("no authored source for this verb class");
			expect("observation" in result).toBe(true);
		});
	});

	describe("describeArrival (T5, Gruppe A follow-up: graph blurb only on a graph switch)", () => {
		it("prefers the destination's authored node_description regardless of fromNodeId", () => {
			const db = makeDb({
				visible_place_node: [{ nodeId: "inn/common_room", description: "Low-beamed ceiling." }],
				visible_place_graph_definition: [],
				visible_place_edge: [],
				visible_actor_spatial_location: [],
			});
			expect(describeArrival(db, "inn/common_room", "inn/loft")).toBe("Low-beamed ceiling.");
		});

		it("falls back to the graph's authored description ONLY when the move crossed a graph boundary", () => {
			const db = makeDb({
				visible_place_node: [{ nodeId: "inn/common_room", placeGraphId: "inn", description: "" }],
				visible_place_graph_definition: [
					{ placeGraphId: "inn", description: "Fieldstone roadhouse." },
				],
				visible_place_edge: [],
				visible_actor_spatial_location: [],
			});
			// fromNodeId's leading segment ("hamlet") differs from toNodeId's ("inn").
			expect(describeArrival(db, "inn/common_room", "hamlet/gate")).toBe("Fieldstone roadhouse.");
		});

		it("also falls back to the graph description when fromNodeId is omitted (no tracked origin — the safer default over silently gapping)", () => {
			const db = makeDb({
				visible_place_node: [{ nodeId: "inn/common_room", placeGraphId: "inn", description: "" }],
				visible_place_graph_definition: [
					{ placeGraphId: "inn", description: "Fieldstone roadhouse." },
				],
				visible_place_edge: [],
				visible_actor_spatial_location: [],
			});
			expect(describeArrival(db, "inn/common_room")).toBe("Fieldstone roadhouse.");
		});

		it("returns null for a within-graph move to an undescribed node — never repeats the graph blurb, never fabricates a line", () => {
			const db = makeDb({
				visible_place_node: [{ nodeId: "inn/common_room", placeGraphId: "inn", description: "" }],
				visible_place_graph_definition: [
					{ placeGraphId: "inn", description: "Fieldstone roadhouse." },
				],
				visible_place_edge: [],
				visible_actor_spatial_location: [],
			});
			// fromNodeId's leading segment ("inn") matches toNodeId's — same graph.
			expect(describeArrival(db, "inn/common_room", "inn/loft")).toBeNull();
		});

		it("returns null for an undescribed node with no graph description either, same graph", () => {
			const db = makeDb({
				visible_place_node: [{ nodeId: "triboar_trail/neverwinter_gate", description: "" }],
				visible_place_graph_definition: [],
				visible_place_edge: [],
				visible_actor_spatial_location: [],
			});
			expect(
				describeArrival(db, "triboar_trail/neverwinter_gate", "triboar_trail/last_light"),
			).toBeNull();
		});
	});

	describe("describeSelfResourceDelta", () => {
		const heroHpEntry: ActorStateEntry = {
			state_id: "srd/hp",
			display_name: "Hit Points",
			value_kind: "int",
			value_int: 7,
			value: "7",
			tags: [],
		};
		const escortStageEntry: ActorStateEntry = {
			state_id: "phandelver/escort_stage",
			display_name: "Escort Stage",
			value_kind: "int",
			value_int: 1,
			value: "1",
			tags: ["quest"],
		};

		it("reports a changed pool by its authored display_name, not the raw state_id", () => {
			const before: ActorStateEntry[] = [heroHpEntry];
			const after: ActorStateEntry[] = [{ ...heroHpEntry, value_int: 3, value: "3" }];
			expect(describeSelfResourceDelta(before, after)).toBe("Hit Points: 7 → 3.");
		});

		it("reports a newly-appearing pool as 'is now <value>'", () => {
			const before: ActorStateEntry[] = [];
			const after: ActorStateEntry[] = [escortStageEntry];
			expect(describeSelfResourceDelta(before, after)).toBe("Escort Stage is now 1.");
		});

		it("returns null when nothing changed — the caller falls back to observation_gap, never fabricating text", () => {
			const entries: ActorStateEntry[] = [heroHpEntry];
			expect(describeSelfResourceDelta(entries, entries)).toBeNull();
		});
	});

	describe("spawnedActorsAfter / describeSpawnedCreatures (sk-84i.6)", () => {
		const goblin = {
			kind: "actor" as const,
			id: "42",
			label: "Goblin",
			detail: { name: "Goblin" },
		};
		const wolf = {
			kind: "actor" as const,
			id: "43",
			label: "Wolf",
			detail: { name: "Wolf" },
		};

		it("returns the new actor's stable id and player-facing name", () => {
			expect(spawnedActorsAfter([], [goblin])).toEqual([{ entity_id: "42", name: "Goblin" }]);
		});

		it("ignores actors already present before the act", () => {
			expect(spawnedActorsAfter([goblin], [goblin, wolf])).toEqual([
				{ entity_id: "43", name: "Wolf" },
			]);
		});

		it("summarizes one or many spawned creatures without interpolating ids", () => {
			expect(describeSpawnedCreatures([{ entity_id: "42", name: "Goblin" }])).toBe(
				"A Goblin appears.",
			);
			expect(
				describeSpawnedCreatures([
					{ entity_id: "42", name: "Goblin" },
					{ entity_id: "43", name: "Wolf" },
				]),
			).toBe("Goblin and Wolf appear.");
			expect(describeSpawnedCreatures([])).toBeNull();
		});
	});

	describe("describeOutcomeTemplate (#1968 B-9)", () => {
		const ACTOR_ID = asEntityRef("1");
		const TARGET_REF = asEntityRef("9");
		const ITEM_TARGET_REF = asEntityRef("item:9");
		function makeInterpolationDb(outcomeDescription: string): SnapshotDb {
			return makeDb({
				outcome_template: [
					{ outcomeTemplateId: "core/greet/outcome", description: outcomeDescription },
				],
				visible_actor_spatial_location: [
					{ entityId: 1n, placeNodeId: "inn/common_room" },
					{ entityId: 9n, placeNodeId: "inn/common_room" },
				],
				visible_target_condition: [],
				visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
				visible_manifest_authored_entity: [],
				owned_object_state: [],
				resource_definition: [],
				resource_definition_tag: [],
				entity: [
					{ entityId: 1n, name: "Lyra" },
					{ entityId: 9n, name: "the innkeeper" },
				],
				visible_entity_tag: [],
				visible_place_node: [{ nodeId: "inn/common_room", displayName: "the Common Room" }],
				visible_place_graph_definition: [],
				visible_place_edge: [],
			});
		}

		// #1921 browser-wasm regression fix (#1968): describeOutcomeTemplate is
		// now async — its Rust-sourced placeholder-token dependency
		// (@spellkave/world-author/observation-tokens) resolves differently for
		// Node vs. browser bundles, so every caller awaits one shared shape.
		it("returns null when the resolved outcome_template has no authored description — the caller falls back honestly", async () => {
			const db = makeInterpolationDb("");
			await expect(
				describeOutcomeTemplate(db, "core/greet/outcome", {
					actorId: ACTOR_ID,
					targetRef: TARGET_REF,
				}),
			).resolves.toBeNull();
		});

		it("returns null for an outcome_template id that does not exist", async () => {
			const db = makeInterpolationDb("The innkeeper nods.");
			await expect(
				describeOutcomeTemplate(db, "core/unknown/outcome", {
					actorId: ACTOR_ID,
					targetRef: TARGET_REF,
				}),
			).resolves.toBeNull();
		});

		it("returns plain authored prose verbatim when it carries no placeholders", async () => {
			const db = makeInterpolationDb("The lock clicks open.");
			await expect(
				describeOutcomeTemplate(db, "core/greet/outcome", {
					actorId: ACTOR_ID,
					targetRef: TARGET_REF,
				}),
			).resolves.toBe("The lock clicks open.");
		});

		it("interpolates {target_name} from the already-resolved target entity id", async () => {
			const db = makeInterpolationDb("You greet {target_name}.");
			await expect(
				describeOutcomeTemplate(db, "core/greet/outcome", {
					actorId: ACTOR_ID,
					targetRef: TARGET_REF,
				}),
			).resolves.toBe("You greet the innkeeper.");
		});

		// sk-h13: inventory/item inspect targets arrive as item:<entityId>
		it("interpolates {target_name} when targetRef uses the item: typed-ref prefix", async () => {
			const db = makeInterpolationDb("You look {target_name} over closely.");
			await expect(
				describeOutcomeTemplate(db, "core/greet/outcome", {
					actorId: ACTOR_ID,
					targetRef: ITEM_TARGET_REF,
				}),
			).resolves.toBe("You look the innkeeper over closely.");
		});

		it("interpolates {actor_name} from the acting actor's own snapshot", async () => {
			const db = makeInterpolationDb("{actor_name} bows politely.");
			await expect(
				describeOutcomeTemplate(db, "core/greet/outcome", {
					actorId: ACTOR_ID,
					targetRef: TARGET_REF,
				}),
			).resolves.toBe("Lyra bows politely.");
		});

		it("interpolates {place_name} from the actor's current node's display name", async () => {
			const db = makeInterpolationDb("A hush falls over {place_name}.");
			await expect(
				describeOutcomeTemplate(db, "core/greet/outcome", {
					actorId: ACTOR_ID,
					targetRef: TARGET_REF,
				}),
			).resolves.toBe("A hush falls over the Common Room.");
		});

		it("interpolates all three frozen tokens together in one line", async () => {
			const db = makeInterpolationDb("{actor_name} greets {target_name} at {place_name}.");
			await expect(
				describeOutcomeTemplate(db, "core/greet/outcome", {
					actorId: ACTOR_ID,
					targetRef: TARGET_REF,
				}),
			).resolves.toBe("Lyra greets the innkeeper at the Common Room.");
		});

		it("leaves an unresolvable token literally in the text rather than fabricating or dropping it", async () => {
			// No targetRef supplied — {target_name} cannot resolve.
			const db = makeInterpolationDb("You gesture at {target_name}.");
			await expect(
				describeOutcomeTemplate(db, "core/greet/outcome", { actorId: ACTOR_ID }),
			).resolves.toBe("You gesture at {target_name}.");
		});

		it("never substitutes a raw entity id — the resolved name only", async () => {
			const db = makeInterpolationDb("You greet {target_name}.");
			const observation = await describeOutcomeTemplate(db, "core/greet/outcome", {
				actorId: ACTOR_ID,
				targetRef: TARGET_REF,
			});
			expect(observation).not.toMatch(/\b9\b/);
		});
	});
});
