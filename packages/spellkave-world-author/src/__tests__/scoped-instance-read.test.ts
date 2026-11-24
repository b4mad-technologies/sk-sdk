// embedded-manifest: {"category": "schema_object_oracle", "rationale": "compact admitted rows independently prove normalized projector and Rust comparable identity parity", "signatures": ["schema_object", "schema_shape"]}
import { describe, expect, it, vi } from "vitest";
import { INSTANCE_ROW_KINDS } from "../filter-manifest-core";
import { renderSchemaManifest } from "../manifest";
import { createOwnerInstanceRead, type OwnerSnapshot } from "../owner-instance-read";
import {
	createScopedInstanceRead,
	type ScopedInstanceSnapshot,
	scopedComparableIdentities,
	scopedComparableManifest,
	scopedInlineDeltaPreflight,
} from "../scoped-instance-read";

function fixture(): ScopedInstanceSnapshot {
	const families = {
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "local:body", bundleId: "local", entityId: 10n },
			{ manifestKey: "local:item", bundleId: "local", entityId: 20n },
		],
		entity: [
			{
				entityId: 10n,
				name: "Body",
				kind: "npc",
				quantity: 1n,
				entityDefId: "local/body",
				ownedByEntityId: 0n,
			},
			{
				entityId: 20n,
				name: "Item",
				kind: "item",
				quantity: 1n,
				entityDefId: "local/item",
				ownedByEntityId: 10n,
			},
		],
		actor: [{ actorId: 77n, currentBody: 10n, name: "Actor" }],
		entity_location: [{ entityId: 10n, placeNodeId: "local/place" }],
		actor_spatial_location: [
			{
				entityId: 10n,
				placeNodeId: "local/place",
				posX: 1,
				posY: 2,
				posZ: 0,
				facing: 3,
				bundleId: "local",
			},
		],
		capability: [
			{
				entityId: 10n,
				capabilityId: "local/use",
				source: "manifest",
				extentRef: "",
				extentKindRef: "",
				visibility: { tag: "Hidden" },
				elevationClass: { tag: "Hidden" },
				bundleId: "local",
			},
		],
		entity_equipment_slot: [
			{ entityId: 10n, slotId: "local/hand", equippedEntityId: 20n, bundleId: "local" },
		],
		entity_containment: [{ entityId: 20n, containerId: 10n, bundleId: "local" }],
		entity_tag: [{ entityId: 10n, tag: "local/tag", source: "manifest", bundleId: "local" }],
		object_state: [
			{
				targetKind: "entity",
				targetId: "10",
				stateId: "local/open",
				value: { tag: "Bool", value: false },
				visibility: { tag: "Hidden" },
				sourceTemplateId: "",
				setAtTick: 1n,
				bundleId: "local",
			},
		],
	};
	const snapshot: OwnerSnapshot = Object.fromEntries(
		Object.entries(families).map(([k, v]) => [k, { iter: () => v }]),
	);
	return {
		snapshot,
		source: {
			reads_as_publisher: false,
			identity: "caller",
			world: "world",
			tick: "7",
			connection_epoch: 1,
			source_epoch: 1,
			projection_version: 1,
			authorized_scopes: ["binding"],
			authorized_bundles: ["local"],
			labels: ["authored_entities_only"],
			coverage: Object.fromEntries(INSTANCE_ROW_KINDS.map((k) => [k, "complete"])),
		},
	};
}
describe("scoped instance projection", () => {
	it.each(
		INSTANCE_ROW_KINDS,
	)("shares normalized %s output with the publisher projector", async (kind) => {
		const captured = fixture();
		const scoped = createScopedInstanceRead({ read: async () => captured, close() {} });
		const owner = createOwnerInstanceRead({
			snapshot: () => ({
				...captured.snapshot,
				operator_manifest_authored_entity: captured.snapshot.visible_manifest_authored_entity,
			}),
			worldTick: () => 7n,
			readsAsPublisher: true,
		});
		const { source, ...answer } = (await scoped.get({ kind, bundle: "local" })) as {
			source?: unknown;
		};
		expect(answer).toEqual(owner.get({ kind, bundle: "local" }));
		expect(source).toBe(captured.source);
	});
	it("uses Rust composite row identities and refuses replacements without a baseline", () => {
		const captured = fixture();
		const ids = scopedComparableIdentities(captured, "local");
		expect(ids.some((row) => row.kind === "actor_capabilities" && row.key.startsWith("["))).toBe(
			true,
		);
		const delta = renderSchemaManifest({
			schema_version: "1.0.0",
			entities: [
				{
					entity_key: "body",
					bundle_id: "local",
					name: "Changed",
					kind: "npc",
					quantity: 1,
					place_node_id: "local/place",
					entity_def_id: "local/body",
				},
			],
		});
		expect(scopedInlineDeltaPreflight(delta, captured)).toBe(
			"unchecked_scoped_write: missing_baseline",
		);
		const next = delta.replace('entity_key = "body"', 'entity_key = "new"');
		expect(scopedInlineDeltaPreflight(next, captured)).toBeUndefined();
		captured.source = {
			...captured.source,
			coverage: { ...captured.source.coverage, entities: "incomplete" },
		};
		expect(scopedInlineDeltaPreflight(next, captured)).toBe("unchecked_scoped_write: incomplete");
	});
	it("distinguishes unavailable from empty and hides inaccessible keyed existence", async () => {
		const captured = fixture();
		captured.source = {
			...captured.source,
			coverage: { ...captured.source.coverage, entities: "incomplete" },
		};
		const read = vi.fn(async () => captured);
		const port = createScopedInstanceRead({ read, close() {} });
		expect(await port.get({ kind: "entities", key: "outside" })).toMatchObject({
			ok: false,
			code: "not_found_in_scope",
			source: { coverage: { entities: "incomplete" } },
		});
		expect(await port.get({ kind: "resource_definitions" })).toMatchObject({
			ok: false,
			code: "usage",
		});
		read.mockRejectedValueOnce(new Error("offline"));
		expect(await port.get({ kind: "entities" })).toMatchObject({
			ok: false,
			code: "reader_unavailable",
		});
	});
	it("marks an unavailable chain endpoint without its foreign label or identity", async () => {
		const captured = fixture();
		captured.snapshot.visible_manifest_authored_entity = {
			iter: () => [{ manifestKey: "local:item", bundleId: "local", entityId: 20n }],
		};
		captured.snapshot.entity = {
			iter: () => [
				{
					entityId: 20n,
					name: "Item",
					kind: "item",
					quantity: 1n,
					entityDefId: "local/item",
					ownedByEntityId: 0n,
				},
			],
		};
		captured.snapshot.entity_containment = { iter: () => [] };
		captured.source = {
			...captured.source,
			coverage: { ...captured.source.coverage, entity_containment: "outside_read_scope" },
		};
		const port = createScopedInstanceRead({ read: async () => captured, close() {} });
		const answer = await port.describe({ kind: "entities", key: "item", bundle: "local" });
		expect(answer).toMatchObject({ ok: true, chain_end: { reason: "outside_read_scope" } });
		const encoded = JSON.stringify(answer, (_, value) =>
			typeof value === "bigint" ? String(value) : value,
		);
		expect(encoded).not.toContain('"Body"');
		expect(encoded).not.toContain('"entity_key":"body"');
	});
	it("preserves exact i64/u64 JSON number tokens for Rust comparison", () => {
		const captured = fixture();
		captured.snapshot.entity = {
			iter: () => [
				{
					entityId: 10n,
					name: "Body",
					kind: "npc",
					quantity: 18446744073709551615n,
					entityDefId: "local/body",
					ownedByEntityId: 0n,
				},
			],
		};
		captured.snapshot.object_state = {
			iter: () => [
				{
					targetKind: "entity",
					targetId: "10",
					stateId: "local/maximum",
					value: { tag: "Int", value: 9223372036854775807n },
					visibility: { tag: "Hidden" },
					sourceTemplateId: "",
					bundleId: "local",
				},
			],
		};
		const json = scopedComparableManifest(captured, "local");
		expect(json).toContain('"quantity":18446744073709551615');
		expect(json).toContain('"value_int":9223372036854775807');
		const identities = scopedComparableIdentities(captured, "local");
		expect(identities.some((row) => row.kind === "object_state")).toBe(true);
	});
});
