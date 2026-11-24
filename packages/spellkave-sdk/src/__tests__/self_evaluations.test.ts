import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import {
	readSelfEvaluationById,
	readSelfRecentEvaluations,
} from "../core/readers/self_evaluations";

function evalRow(overrides: Record<string, unknown>) {
	return {
		provenanceId: "eval:1",
		kind: { tag: "Affordance" },
		status: { tag: "Succeeded" },
		subjectId: "1",
		actingIdentity: "0",
		ownerBodyEntityId: 1n,
		visibility: { tag: "Hidden" },
		selectedTemplateIds: [],
		expressionIds: [],
		stochasticDraws: [],
		outcomeGraphIds: [],
		terminalEventIds: [],
		failureKind: "",
		failureDetail: "",
		createdAtTick: 10n,
		bundleId: "srd",
		...overrides,
	};
}

const fixture = {
	directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "village" }],
	visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
	visible_manifest_authored_entity: [],
	visible_evaluation_provenance: [
		evalRow({
			provenanceId: "eval:success",
			status: { tag: "Succeeded" },
			createdAtTick: 20n,
			selectedTemplateIds: ["core/attack_template"],
			stochasticDraws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 14 }],
		}),
		evalRow({
			provenanceId: "eval:failure",
			status: { tag: "Failed" },
			createdAtTick: 21n,
			selectedTemplateIds: ["core/attack_template"],
			stochasticDraws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 3 }],
		}),
		evalRow({
			provenanceId: "eval:no-draws",
			status: { tag: "Succeeded" },
			createdAtTick: 22n,
			stochasticDraws: [],
		}),
		evalRow({
			// A different entity's evaluation — must never leak into actor "1"'s history.
			provenanceId: "eval:other-entity",
			ownerBodyEntityId: 2n,
			createdAtTick: 23n,
		}),
		evalRow({
			provenanceId: "eval:missed-roll",
			status: { tag: "Succeeded" },
			createdAtTick: 24n,
			selectedTemplateIds: ["core/attack_template", "resolution_result:false"],
			stochasticDraws: [{ sourceId: "dsl_node:attack", drawIndex: 0, value: 5 }],
		}),
		evalRow({
			provenanceId: "eval:failed-gate",
			status: { tag: "Failed" },
			createdAtTick: 25n,
			expressionIds: ["action:attack", "gate:range"],
			failureKind: "predicate_rejected",
			failureDetail: "out of range",
		}),
	],
};

const db = snapshotDbFromFixture(fixture);

describe("readSelfRecentEvaluations", () => {
	it("returns the connected actor's own evaluations with resolved die faces", () => {
		const result = readSelfRecentEvaluations(db, asEntityRef("1"));
		const success = result.find((row) => row.provenance_id === "eval:success");
		expect(success).toEqual({
			provenance_id: "eval:success",
			created_at_tick: 20,
			status: "Succeeded",
			record_kind: "Affordance",
			subject_id: "1",
			selected_template_ids: ["core/attack_template"],
			draws: [{ source_id: "dsl_node:1", draw_index: 0, value: 14 }],
		});
	});

	it("keeps a Failed row's own die face, not just success rows (finding #22(a)+(b))", () => {
		const result = readSelfRecentEvaluations(db, asEntityRef("1"));
		const failure = result.find((row) => row.provenance_id === "eval:failure");
		expect(failure?.status).toBe("Failed");
		expect(failure?.draws).toEqual([{ source_id: "dsl_node:1", draw_index: 0, value: 3 }]);
	});

	it("projects a row with no stochastic draws rather than dropping it", () => {
		const result = readSelfRecentEvaluations(db, asEntityRef("1"));
		const noDraws = result.find((row) => row.provenance_id === "eval:no-draws");
		expect(noDraws?.draws).toEqual([]);
	});

	it("excludes an evaluation owned by a different entity", () => {
		const result = readSelfRecentEvaluations(db, asEntityRef("1"));
		expect(result.map((row) => row.provenance_id)).not.toContain("eval:other-entity");
	});

	it("orders most-recent-first by created_at_tick", () => {
		const result = readSelfRecentEvaluations(db, asEntityRef("1"));
		const ticks = result.map((row) => row.created_at_tick);
		expect(ticks).toEqual([...ticks].sort((a, b) => b - a));
	});

	it("cannot read a co-located remote body's evaluations", () => {
		expect(readSelfRecentEvaluations(db, asEntityRef("2"))).toEqual([]);
	});

	it("caps at SELF_EVALUATION_HISTORY_CAP (50), keeping the most recent rows", () => {
		const rowsFixture = {
			directly_controlled_actor_spatial_location: [{ entityId: 1n, placeNodeId: "village" }],
			visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
			visible_manifest_authored_entity: [],
			visible_evaluation_provenance: Array.from({ length: 60 }, (_, i) =>
				evalRow({ provenanceId: `eval:${i}`, createdAtTick: BigInt(i) }),
			),
		};
		const cappedDb = snapshotDbFromFixture(rowsFixture);
		const result = readSelfRecentEvaluations(cappedDb, asEntityRef("1"));
		expect(result).toHaveLength(50);
		// Most-recent-first: tick 59 down through tick 10 (60 rows, ticks 0..59, top 50 kept).
		expect(result[0]?.created_at_tick).toBe(59);
		expect(result[result.length - 1]?.created_at_tick).toBe(10);
	});
});

describe("readSelfEvaluationById", () => {
	it("returns a Succeeded row with resolution_result:false and draws", () => {
		const result = readSelfEvaluationById(db, asEntityRef("1"), "eval:missed-roll");
		expect(result).toEqual({
			provenance_id: "eval:missed-roll",
			created_at_tick: 24,
			status: "Succeeded",
			record_kind: "Affordance",
			subject_id: "1",
			selected_template_ids: ["core/attack_template", "resolution_result:false"],
			draws: [{ source_id: "dsl_node:attack", draw_index: 0, value: 5 }],
		});
	});

	it("returns a Failed gate row with expression_ids, failure_kind and failure_detail", () => {
		const result = readSelfEvaluationById(db, asEntityRef("1"), "eval:failed-gate");
		expect(result).toEqual({
			provenance_id: "eval:failed-gate",
			created_at_tick: 25,
			status: "Failed",
			record_kind: "Affordance",
			subject_id: "1",
			selected_template_ids: [],
			draws: [],
			expression_ids: ["action:attack", "gate:range"],
			failure_kind: "predicate_rejected",
			failure_detail: "out of range",
		});
	});

	it("returns null for an id that belongs to another entity", () => {
		const result = readSelfEvaluationById(db, asEntityRef("1"), "eval:other-entity");
		expect(result).toBeNull();
	});

	it("returns null for a non-existent provenance id", () => {
		const result = readSelfEvaluationById(db, asEntityRef("1"), "eval:does-not-exist");
		expect(result).toBeNull();
	});

	it("returns null for an actor that is not directly controlled", () => {
		const result = readSelfEvaluationById(db, asEntityRef("2"), "eval:other-entity");
		expect(result).toBeNull();
	});
});
