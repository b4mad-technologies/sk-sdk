import { describe, expect, it } from "vitest";
import { rows } from "../core/readers/_helpers";
import type { SnapshotDb } from "../reader-manifest";

function snapshot(status?: string, version = 1, includeView = true): SnapshotDb {
	const tables = {
		...(includeView
			? { visible_entity_tag: { iter: () => [{ entityId: 7n, tag: "admitted" }] } }
			: {}),
		...(status
			? { visible_entity_tag_coverage: { iter: () => [{ status, projectionVersion: version }] } }
			: {}),
	};
	return new Proxy(tables, {
		get(target, key) {
			if (key === "entity_tag") throw new Error("private base read attempted");
			return Reflect.get(target, key);
		},
	}) as unknown as SnapshotDb;
}
describe("runtime tag coverage", () => {
	it("delivers admitted tags only with the paired complete current projection", () => {
		expect(rows(snapshot("complete"), "visible_entity_tag")).toEqual([
			{ entityId: 7n, tag: "admitted" },
		]);
	});
	it.each([
		undefined,
		"incomplete",
		"outside_read_scope",
		"reader_unavailable",
	])("refuses %s coverage without touching the raw base", (status) => {
		expect(() => rows(snapshot(status), "visible_entity_tag")).toThrow("reader_unavailable");
	});
	it("refuses a future protocol or a missing admitted view despite complete metadata", () => {
		expect(() => rows(snapshot("complete", 2), "visible_entity_tag")).toThrow("reader_unavailable");
		expect(() => rows(snapshot("complete", 1, false), "visible_entity_tag")).toThrow(
			"reader_unavailable",
		);
	});
});
