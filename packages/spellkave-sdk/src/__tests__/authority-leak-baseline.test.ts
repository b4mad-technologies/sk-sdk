import { describe, expect, it } from "vitest";

import { snapshotDbFromFixture } from "../connection";
import { asEntityRef } from "../core/ids";
import { readActorSnapshot } from "../core/readers/actor_snapshot";
import { readEntityContainment } from "../core/readers/entity_containment";

/** Regression for #1897/#1898: remote rows are absent from caller views. */
describe("remote actor authority boundary", () => {
	const db = snapshotDbFromFixture({
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_actor_spatial_location: [],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "phandelver:phandelver/goblin", bundleId: "phandelver", entityId: 22n },
		],
		visible_target_condition: [],
		visible_object_state: [],
		resource_definition: [],
		resource_definition_tag: [],
		visible_entity_tag: [],
		entity: [
			{ entityId: 22n, name: "Remote Goblin", entityDefId: "goblin", kind: "actor", quantity: 1n },
			{ entityId: 90n, name: "Shortsword", entityDefId: "shortsword", kind: "item", quantity: 1n },
		],
		visible_entity_containment: [],
	});

	it("does not expose a remote actor location by arbitrary id", () => {
		expect(readActorSnapshot(db, asEntityRef("phandelver/goblin"))).toBeNull();
	});

	it("does not expose that remote actor's inventory", () => {
		expect(readEntityContainment(db, asEntityRef("phandelver/goblin"))).toEqual([]);
	});
});
