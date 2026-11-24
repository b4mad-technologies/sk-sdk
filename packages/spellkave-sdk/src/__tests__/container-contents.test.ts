// keep-file(K4): snapshot contract for the optional caller-scoped projection.
import { describe, expect, it } from "vitest";
import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readContainerContents } from "../core/readers/container_contents";

const actor = asEntityRef("1");
const edge = (perceiver: bigint, parent: bigint, item: bigint) => ({
	key: `${perceiver}:${parent}:${item}`,
	perceiverEntityId: perceiver,
	containerEntityId: parent,
	entityId: item,
	name: `Item ${item}`,
	quantity: 2n,
	entityDefId: "test/item",
});
const header = (perceiver: bigint, parent: bigint, complete = true) => ({
	key: `${perceiver}:${parent}`,
	perceiverEntityId: perceiver,
	containerEntityId: parent,
	revision: "public-revision",
	complete,
});

describe("observed container contents", () => {
	it("keeps direct parents and perceivers separate with canonical lossless refs", () => {
		const db = snapshotDbFromFixture({
			visible_observed_container_coverage: [header(1n, 2n), header(1n, 3n), header(4n, 2n)],
			visible_observed_container_content: [
				edge(1n, 2n, 9007199254740993n),
				edge(1n, 3n, 5n),
				edge(4n, 2n, 6n),
			],
		});
		expect(readContainerContents(db, actor, "entity:2")).toEqual({
			container_ref: "entity:2",
			scope: "direct",
			status: "available",
			revision: "public-revision",
			items: [
				{
					target_ref: "item:9007199254740993",
					parent_ref: "entity:2",
					name: "Item 9007199254740993",
					quantity: 2,
					entity_def_id: "test/item",
				},
			],
		});
	});
	it("suppresses even stale rows after coverage revocation and on older modules", () => {
		for (const db of [
			snapshotDbFromFixture({}),
			snapshotDbFromFixture({ visible_observed_container_content: [edge(1n, 2n, 3n)] }),
		]) {
			expect(readContainerContents(db, actor, "entity:2")).toEqual({
				container_ref: "entity:2",
				scope: "direct",
				status: "unavailable",
				revision: "unavailable",
				items: [],
			});
		}
	});
	it("distinguishes admitted empty contents from a bounded prefix", () => {
		const db = snapshotDbFromFixture({
			visible_observed_container_coverage: [header(1n, 2n), header(1n, 3n, false)],
		});
		expect(readContainerContents(db, actor, "entity:2").status).toBe("empty");
		expect(readContainerContents(db, actor, "entity:3").status).toBe("truncated");
		expect(readContainerContents(db, actor, "entity:99").status).toBe("unavailable");
	});
});
