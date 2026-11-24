import { describe, expect, it } from "vitest";
import { asEntityRef } from "../core/ids";
import { resolveEntityId } from "../core/readers/_helpers";
import type { SnapshotDb } from "../reader-manifest";

function snapshot(status?: string, version = 1): SnapshotDb {
	return new Proxy(
		{
			visible_manifest_authored_entity: {
				iter: () => [{ manifestKey: "fixture:no-tags", entityId: 7n }],
			},
			...(status
				? {
						visible_manifest_authored_entity_coverage: {
							iter: () => [{ status, projectionVersion: version }],
						},
					}
				: {}),
		},
		{
			get(target, key) {
				if (key === "manifest_authored_entity") throw new Error("private base read attempted");
				return Reflect.get(target, key);
			},
		},
	) as SnapshotDb;
}

describe("admitted authored mapping coverage", () => {
	it("resolves no-tag admitted keys without consulting the private base", () => {
		expect(resolveEntityId(snapshot("complete"), asEntityRef("no-tags"))).toBe(7n);
	});
	it.each([
		undefined,
		"incomplete",
		"reader_unavailable",
	])("rejects stale key rows with %s coverage", (status) => {
		expect(() => resolveEntityId(snapshot(status), asEntityRef("no-tags"))).toThrow(
			"reader_unavailable",
		);
	});
	it("rejects an unknown coverage version", () => {
		expect(() => resolveEntityId(snapshot("complete", 2), asEntityRef("no-tags"))).toThrow(
			"reader_unavailable",
		);
	});
	it("keeps numeric references usable without mapping coverage", () => {
		expect(resolveEntityId(snapshot(), asEntityRef("entity:7"))).toBe(7n);
	});
});
