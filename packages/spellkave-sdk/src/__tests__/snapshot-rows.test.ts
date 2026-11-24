import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { fieldOf, readDeadEntityIds, resolveEntityKeys, tableRows } from "../core/snapshot_rows";

// Neutral ids: nothing here names a real ruleset or story.
const DEAD = "rules/condition/dead";

describe("tableRows", () => {
	it("returns the first table handle present under any name", () => {
		const db = snapshotDbFromFixture({ visible_target_condition: [{ a: 1 }] });
		expect([...tableRows(db, "visibleTargetCondition", "visible_target_condition")]).toEqual([
			{ a: 1 },
		]);
	});

	it("returns an empty iterable when no name resolves", () => {
		const db = snapshotDbFromFixture({});
		expect([...tableRows(db, "nope", "also_nope")]).toEqual([]);
	});

	it("prefers an earlier name over a later one", () => {
		const db = snapshotDbFromFixture({ first: [{ n: 1 }], second: [{ n: 2 }] });
		expect([...tableRows(db, "first", "second")]).toEqual([{ n: 1 }]);
	});
});

describe("fieldOf", () => {
	it("takes the first non-empty alias and stringifies it", () => {
		expect(fieldOf({ entity_id: 7n }, "entityId", "entity_id")).toBe("7");
	});

	it("skips null, undefined and empty-string aliases", () => {
		expect(fieldOf({ a: null, b: "", c: "x" }, "missing", "a", "b", "c")).toBe("x");
	});

	it("returns empty string when nothing matches", () => {
		expect(fieldOf({}, "a", "b")).toBe("");
	});
});

describe("readDeadEntityIds", () => {
	const db = snapshotDbFromFixture({
		visible_target_condition: [
			{ entity_id: 1n, condition_definition_id: DEAD },
			{ entity_id: 2n, condition_definition_id: "rules/condition/prone" },
			{ entity_id: 3n, condition_definition_id: "other/condition/dead" },
			{ targetBodyEntityId: 4n, conditionId: DEAD },
			{ entity_id: "", condition_definition_id: DEAD },
		],
	});

	it("matches only the exact dead condition id by default", () => {
		expect(readDeadEntityIds(db, { deadConditionId: DEAD })).toEqual(new Set(["1", "4"]));
	});

	it("also matches a bundle-prefixed copy when a suffix is supplied", () => {
		expect(
			readDeadEntityIds(db, { deadConditionId: DEAD, deadConditionSuffix: "/condition/dead" }),
		).toEqual(new Set(["1", "3", "4"]));
	});

	it("treats an empty suffix as absent rather than matching everything", () => {
		expect(readDeadEntityIds(db, { deadConditionId: DEAD, deadConditionSuffix: "" })).toEqual(
			new Set(["1", "4"]),
		);
	});

	it("is empty when the condition table is absent", () => {
		expect(readDeadEntityIds(snapshotDbFromFixture({}), { deadConditionId: DEAD })).toEqual(
			new Set(),
		);
	});

	it("reads the camelCase accessor when that is the one present", () => {
		const camel = snapshotDbFromFixture({
			visibleTargetCondition: [{ entityId: 9n, conditionDefinitionId: DEAD }],
		});
		expect(readDeadEntityIds(camel, { deadConditionId: DEAD })).toEqual(new Set(["9"]));
	});
});

describe("resolveEntityKeys", () => {
	const db = snapshotDbFromFixture({
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "demo:demo/hero", bundleId: "demo", entityId: 11n },
			{ manifestKey: "demo:demo/inn/keeper", bundleId: "demo", entityId: 12n },
		],
	});

	it("maps placed keys to numeric id strings and omits unplaced ones", () => {
		const out = resolveEntityKeys(db, [
			asEntityRef("demo/hero"),
			asEntityRef("demo/ghost"),
			asEntityRef("demo/inn/keeper"),
		]);
		expect([...out]).toEqual([
			["demo/hero", "11"],
			["demo/inn/keeper", "12"],
		]);
	});

	it("resolves a bundle-prefixed key by its bare form but keys the result by the input", () => {
		const out = resolveEntityKeys(db, [asEntityRef("demo:demo/hero")]);
		expect(out.get("demo:demo/hero")).toBe("11");
	});

	it("resolves numeric entity refs directly", () => {
		expect(resolveEntityKeys(db, [asEntityRef("entity:42")]).get("entity:42")).toBe("42");
	});

	it("is empty for no keys", () => {
		expect(resolveEntityKeys(db, []).size).toBe(0);
	});
});
