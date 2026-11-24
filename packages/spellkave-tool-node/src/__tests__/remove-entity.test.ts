import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectManifest, renderSchemaManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";
import { createLocalAuthorTarget } from "../authoring/local-target.ts";
import { planEntityRemoval } from "../authoring/remove-entity.ts";
import { nodeFilesystem } from "../filesystem.ts";

describe("local entity removal plan", () => {
	// keep(K1): enumerate manifest identities and dependent placed-item references.
	it("removes the entity and dependent rows while preserving definitions and another entity", () => {
		const manifest = {
			entities: [
				{ entity_key: "demo/torch", name: "Torch" },
				{ entity_key: "demo/chest", name: "Chest" },
			],
			entity_containment: [{ entity_key: "demo/torch", container_entity_key: "demo/chest" }],
			entity_tag: [{ entity_key: "demo/torch", tag: "demo.bright" }],
			object_state: [{ entity_key: "demo/torch", state_id: "demo/lit" }],
			entity_resource_bound: [{ entity_key: "demo/torch", resource_definition_id: "demo/charges" }],
			actor_equipment_slots: [
				{ actor_entity_key: "demo/wearer", slot_id: "demo/hand", item_key: "demo/torch" },
			],
			metadata_attachments: [
				{ target_kind: "entity", target_ref: "demo/torch", namespace: "demo.note" },
			],
			entity_definitions: [{ entity_def_id: "demo/torch", description: "demo/torch" }],
			metadata: { note: "demo/torch" },
		};
		const result = planEntityRemoval(manifest, "demo/torch");
		expect(result.detail).toBeUndefined();
		expect(result.manifest.entities).toEqual([{ entity_key: "demo/chest", name: "Chest" }]);
		for (const kind of [
			"entity_containment",
			"entity_tag",
			"object_state",
			"entity_resource_bound",
			"actor_equipment_slots",
			"metadata_attachments",
		])
			expect(result.manifest[kind]).toEqual([]);
		expect(result.manifest.entity_definitions).toEqual(manifest.entity_definitions);
		expect(result.manifest.metadata).toEqual(manifest.metadata);
		expect(manifest.entities).toHaveLength(2);
	});

	// keep(K1): structural references must refuse rather than delete surviving content.
	it.each([
		{ entities: [{ entity_key: "demo/child", owned_by_entity_key: "demo/chest" }] },
		{ entity_containment: [{ entity_key: "demo/child", container_entity_key: "demo/chest" }] },
		{
			spatial_niche_attachments: [
				{ niche_id: "demo/trigger", on_entry_target_entity_key: "demo/chest" },
			],
		},
	])("refuses a surviving reference without mutating the input", (rows) => {
		const result = planEntityRemoval(rows, "demo/chest");
		expect(result.detail).toContain("surviving");
		expect(result.manifest).toBe(rows);
		expect(result.removed).toEqual({});
	});

	// keep(K3): repeated removals are idempotent.
	it("does not change an already removed entity", () => {
		const first = planEntityRemoval({ entities: [{ entity_key: "demo/torch" }] }, "demo/torch");
		const again = planEntityRemoval(first.manifest, "demo/torch");
		expect(again.removed).toEqual({});
		expect(again.manifest).toEqual(first.manifest);
	});
});

const rootFixture = () => ({
	schema_version: "1.0.0",
	bundles: [
		{ bundle_id: "demo", display_name: "Demo", author: "test", version: "1", depends_on: [] },
	],
	entities: [
		{ entity_key: "demo/torch", bundle_id: "demo", name: "Torch", kind: "item", place_node_id: "" },
	],
});

describe("local target removal persistence", () => {
	// keep(K2): callback failure and root I/O failure must preserve both persistence ports.
	it.each([
		"success",
		"scratch failure",
		"root failure",
	])("handles %s without a stale scratch resurrection", async (mode) => {
		const dir = mkdtempSync(join(tmpdir(), "sk-remove-entity-"));
		const root = join(dir, "manifest.toml");
		const initial = renderSchemaManifest(rootFixture());
		writeFileSync(root, initial);
		const coin = { ...rootFixture().entities[0], entity_key: "demo/coin", name: "Coin" };
		const initialScratch = renderSchemaManifest({
			...rootFixture(),
			entities: [...rootFixture().entities, coin],
		});
		let scratch = initialScratch;
		let failScratch = mode === "scratch failure";
		let failRoot = mode === "root failure";
		let rootWrites = 0;
		const workspace = {
			readToml: () => scratch,
			writeToml: (next: string) => {
				if (failScratch) {
					failScratch = false;
					throw new Error("injected scratch failure");
				}
				scratch = next;
				return "scratch";
			},
		};
		const target = createLocalAuthorTarget(dir, {
			filesystem: {
				...nodeFilesystem,
				writeText(path, text) {
					rootWrites++;
					if (failRoot) {
						failRoot = false;
						throw new Error("injected root failure");
					}
					nodeFilesystem.writeText(path, text);
				},
			},
		});
		try {
			const remove = target.removeEntity;
			if (!remove) throw new Error("local removal missing");
			// Warm the lookup cache: deletion must invalidate it.
			expect(target.resolveRef("entities", "demo/torch")).toBe(true);
			const result = await remove("demo/torch", workspace);
			if (mode === "success") {
				expect(result.ok).toBe(true);
				expect(target.resolveRef("entities", "demo/torch")).toBe(false);
				expect(inspectManifest(scratch).manifest.entities).toEqual([
					expect.objectContaining({ entity_key: "demo/coin" }),
				]);
				expect(target.resolveRef("entities", "demo/coin")).toBe(false);
				expect(await target.applyBatch(scratch)).toEqual({ ok: true });
				expect(target.resolveRef("entities", "demo/torch")).toBe(false);
			} else {
				expect(result.ok).toBe(false);
				expect(scratch).toBe(initialScratch);
				expect(readFileSync(root, "utf8")).toBe(initial);
				if (mode === "scratch failure") expect(rootWrites).toBe(0);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	// keep(K2): fragment provenance is a host filesystem boundary.
	it("refuses an include-owned entity and leaves root, fragment and scratch untouched", async () => {
		const dir = mkdtempSync(join(tmpdir(), "sk-remove-include-"));
		const root = join(dir, "manifest.toml");
		const fragment = join(dir, "items.toml");
		const data = rootFixture();
		const text = renderSchemaManifest({ ...data, entities: [], include: [{ path: "items.toml" }] });
		const items = renderSchemaManifest({ schema_version: "1.0.0", entities: data.entities })
			.split("\n")
			.slice(3)
			.join("\n");
		writeFileSync(root, text);
		writeFileSync(fragment, items);
		let writes = 0;
		try {
			const remove = createLocalAuthorTarget(dir).removeEntity;
			if (!remove) throw new Error("local removal missing");
			expect(
				await remove("demo/torch", {
					readToml: () => null,
					writeToml: () => {
						writes++;
						return "scratch";
					},
				}),
			).toEqual({ ok: false, detail: expect.stringContaining("items.toml") });
			expect(writes).toBe(0);
			expect(readFileSync(root, "utf8")).toBe(text);
			expect(readFileSync(fragment, "utf8")).toBe(items);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
