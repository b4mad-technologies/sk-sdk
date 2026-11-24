import type { PendingStochasticResolutionRow } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import {
	assertPendingResolutionDeclined,
	assertPendingResolutionPreserved,
	capturePendingResolution,
} from "./pending-probe";

const payload: PendingStochasticResolutionRow = {
	pendingId: 2n,
	draws: [{ sourceId: "dsl_node:1", drawIndex: 0, value: 9n }],
	predicateSource: "d20 > 0",
	rollBiasJson: "null",
	frozenFactsJson: '{"int_fields":[]}',
	commitTailJson: '{"resolution_branch":"on_success"}',
	originalProvenanceId: "original",
	bundleId: "probe",
};
const original = { provenanceId: "original", terminalEventIds: [], selectedTemplateIds: [] };
const continuation = {
	provenanceId: "continued",
	selectedTemplateIds: ["intervention_original:original", "intervention_declined"],
	stochasticDraws: payload.draws,
	terminalEventIds: [11n],
	failureKind: "",
};
function db(pending: Record<string, unknown>[], provenance: Record<string, unknown>[] = []) {
	return {
		visible_pending_stochastic_resolution: { iter: () => pending },
		visible_evaluation_provenance: { iter: () => provenance },
	};
}

describe("pending resolution probe observations", () => {
	it("copies frozen state independently of later cache mutations", () => {
		const row = structuredClone(payload);
		const before = capturePendingResolution(db([row]), 2n);
		assertPendingResolutionPreserved(before, db([row]));
		const draw = row.draws[0];
		if (draw === undefined) throw new Error("fixture draw missing");
		draw.value = 4n;
		expect(before.draws[0]?.value).toBe(9n);
		expect(() => assertPendingResolutionPreserved(before, db([row]))).toThrow();
	});

	it.each([
		"commitTailJson",
		"frozenFactsJson",
		"predicateSource",
	] as const)("rejects a changed %s even when the die face survives", (field) => {
		expect(() =>
			assertPendingResolutionPreserved(payload, db([{ ...payload, [field]: "changed" }])),
		).toThrow();
	});

	it("requires visible subscribed evidence rather than treating missing tables as empty", () => {
		expect(() => capturePendingResolution({}, 2n)).toThrow("subscribed table");
		expect(() => assertPendingResolutionDeclined(payload, {})).toThrow("subscribed table");
		expect(() => capturePendingResolution(db([]), 2n)).toThrow("one visible pending");
	});

	it("accepts one declined continuation while retaining unrelated pending work", () => {
		expect(
			assertPendingResolutionDeclined(
				payload,
				db([{ ...payload, pendingId: 3n }], [original, continuation]),
			),
		).toBe(continuation);
	});

	it.each([
		[original],
		[original, continuation, { ...continuation, provenanceId: "duplicate" }],
		[{ ...original, terminalEventIds: [10n] }, continuation],
		[original, { ...continuation, stochasticDraws: [] }],
		[original, { ...continuation, terminalEventIds: [11n, 12n] }],
		[original, { ...continuation, selectedTemplateIds: ["intervention_original:original"] }],
	])("rejects incomplete or duplicate completion evidence %#", (...provenance) => {
		expect(() => assertPendingResolutionDeclined(payload, db([], provenance))).toThrow();
	});
});
