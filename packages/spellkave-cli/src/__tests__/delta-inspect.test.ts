// keep-file(K1): enumerate preservation and unkeyed regression rules over pure row analysis.
import { identityFieldsOf } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";
import { analyzeDeltaRows } from "../delta-inspect.ts";

describe("delta row risk analysis", () => {
	it.each([
		["object_state", { entity_key: "hero", state_id: "xp", value_int: 12 }],
		["role_bindings", { binding_id: "dm" }],
		["actors", { entity_key: "hero" }],
		["entities", { entity_key: "chest" }],
		["actor_equipment_slots", { actor_entity_key: "hero", slot_id: "hand" }],
		["actor_capabilities", { actor_entity_key: "hero", capability_id: "level" }],
	] as const)("flags %s and distinguishes authored presence from live presence", (kind, row) => {
		const found = analyzeDeltaRows({ [kind]: [row] }, { [kind]: [row] });
		expect(found.sensitiveRows).toEqual([
			expect.objectContaining({ rowKind: kind, row, presentInRoots: true }),
		]);
		expect(found.additions).toEqual([]);
		expect(analyzeDeltaRows({ [kind]: [row] }, {}).sensitiveRows[0]?.presentInRoots).toBe(false);
	});
	it("flags seat identities even though the subset registry cannot key them", () => {
		const row = { entity_key: "hero", identity: "seat" };
		const report = analyzeDeltaRows({ actor_identities: [row] }, { actor_identities: [row] });
		expect(report.sensitiveRows[0]).toMatchObject({
			rowKind: "actor_identities",
			presentInRoots: null,
		});
		expect(report.unkeyedKinds[0]?.rowKind).toBe("actor_identities");
		expect(report.additions[0]?.certainty).toBe("unkeyed");
	});
	it("gives ordered-set regression guidance without inventing a per-write identity", () => {
		expect(identityFieldsOf("consequence_frame_writes")).toBeUndefined();
		const report = analyzeDeltaRows(
			{ consequence_frame_writes: [{ template_id: "grant", ordinal: 0 }] },
			{},
		);
		expect(report.unkeyedKinds).toEqual([
			expect.objectContaining({
				rowKind: "consequence_frame_writes",
				testToAdd: expect.stringContaining("ordinal order"),
			}),
		]);
		expect(report.additions).toEqual([
			{ rowKind: "consequence_frame_writes", count: 1, certainty: "unkeyed" },
		]);
	});
	it("flags retractions without treating headers and deletions as census additions", () => {
		const report = analyzeDeltaRows(
			{
				bundles: [{}],
				include: [{}],
				retractions: [{ row_kind: "actor", authored_key: "world:hero" }],
			},
			{},
		);
		expect(report.sensitiveRows[0]).toMatchObject({ rowKind: "retractions", presentInRoots: null });
		expect(report.additions).toEqual([]);
		expect(report.unkeyedKinds).toEqual([]);
	});
	it("reports new keyed rows and future unkeyed kinds conservatively", () => {
		const report = analyzeDeltaRows(
			{ capability_definitions: [{ capability_id: "new" }], future_kind: [{ key: "future" }] },
			{},
		);
		expect(report.additions).toEqual([
			{ rowKind: "capability_definitions", count: 1, certainty: "absent_from_roots" },
			{ rowKind: "future_kind", count: 1, certainty: "unkeyed" },
		]);
		expect(report.unkeyedKinds[0]?.testToAdd).toContain("complete owned row set");
	});
});
