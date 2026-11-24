import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { explore } from "@spellkave/tool-authoring";
import { renderSchemaManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";
import { createFileExplorationPort } from "../authoring/exploration";

describe("selected file exploration source", () => {
	it("reads a file actor's inventory and the same containment links as neighbors", async () => {
		const dir = mkdtempSync(join(tmpdir(), "spellkave-explore-inventory-"));
		const manifest = join(dir, "manifest.toml");
		try {
			writeFileSync(manifest, renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [{ bundle_id: "demo", display_name: "Demo", author: "test", version: "1" }],
				actors: [{ bundle_id: "demo", entity_key: "demo/buyer", name: "Buyer" }],
				entities: [
					{ bundle_id: "demo", entity_key: "demo/buyer", name: "Buyer", kind: "npc", place_node_id: "" },
					{ bundle_id: "demo", entity_key: "demo/coin", name: "Coin", kind: "item", place_node_id: "", owned_by_entity_key: "demo/buyer", quantity: 1 },
					{ bundle_id: "demo", entity_key: "demo/key", name: "Key", kind: "item", place_node_id: "", owned_by_entity_key: "demo/buyer", quantity: 1 },
				],
				entity_containment: [
					{ container_entity_key: "demo/buyer", entity_key: "demo/coin", direction: "", slot_id: "" },
					{ container_entity_key: "demo/buyer", entity_key: "demo/key", direction: "", slot_id: "" },
				],
			}));
			const port = createFileExplorationPort({
				workspace: { readToml: () => null, writeToml: (toml: string) => toml },
				workspacePath: join(dir, "workspace"),
				localPath: manifest,
			});
			const actors = await explore(port, {
				operation: "search",
				source: "local",
				collection: "instances",
				kind: "actors",
				text: "buyer",
			});
			const buyer = actors.items[0]?.ref;
			if (!buyer) throw new Error("fixture buyer missing");
			const inventory = await explore(port, {
				operation: "search",
				source: "local",
				collection: "instances",
				kind: "entities",
				source_id: actors.source.source_id,
				within: buyer,
			});
			const neighbors = await explore(port, {
				operation: "neighbors",
				source: "local",
				source_id: actors.source.source_id,
				ref: buyer,
				direction: "outbound",
			});
			const contained = neighbors.items.filter((item) => item.relationship?.kind === "entity_containment");
			expect(inventory.items.map((item) => item.ref.id).sort()).toEqual(["demo/coin", "demo/key"]);
			expect(contained.map((item) => item.ref.id).sort()).toEqual(["demo/coin", "demo/key"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
	it("refreshes named roots, preserves unchanged pagination, isolates same-directory files and refuses live fallback", async () => {
		const dir = mkdtempSync(join(tmpdir(), "spellkave-file-explore-"));
		const manifest = (id: string) =>
			renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [
					{ bundle_id: id, display_name: id, author: "test", version: "1", depends_on: [] },
				],
				place_graphs: [
					{
						place_graph_id: `${id}/graph`,
						display_name: "Graph",
						substrate_id: "outdoor",
						bundle_id: id,
					},
				],
				place_nodes: [
					{
						node_id: `${id}/a`,
						local_id: "a",
						place_graph_id: `${id}/graph`,
						display_name: "Loft",
						substrate_id: "outdoor",
						bundle_id: id,
					},
					{
						node_id: `${id}/b`,
						local_id: "b",
						place_graph_id: `${id}/graph`,
						display_name: "Loft",
						substrate_id: "outdoor",
						bundle_id: id,
					},
				],
			});
		try {
			const alpha = join(dir, "alpha.toml"),
				beta = join(dir, "beta.toml");
			writeFileSync(alpha, manifest("alpha"));
			writeFileSync(beta, manifest("beta"));
			const workspace = { readToml: () => null, writeToml: (toml: string) => toml };
			const port = (path: string) =>
				createFileExplorationPort({
					workspace,
					workspacePath: join(dir, "workspace"),
					localPath: path,
				});
			const a = port(alpha),
				b = port(beta);
			const q = { operation: "search" as const, source: "local" as const, text: "loft", limit: 1 };
			const first = await explore(a, q);
			expect(first.items[0]?.ref.id).toBe("alpha/a");
			expect((await explore(a, { ...q, cursor: first.page.next_cursor })).items[0]?.ref.id).toBe(
				"alpha/b",
			);
			expect((await explore(b, { ...q, cursor: first.page.next_cursor })).status).toBe(
				"stale_cursor",
			);
			const ref = first.items[0]?.ref;
			if (!ref) throw new Error("missing reference");
			const moved = await explore(b, {
				operation: "detail",
				source: "local",
				source_id: first.source.source_id,
				ref,
			});
			expect([moved.status, moved.reason, moved.error_class]).toEqual([
				"unavailable",
				"reference_source_changed",
				"in_world",
			]);
			writeFileSync(alpha, manifest("changed"));
			expect((await explore(a, { ...q, cursor: first.page.next_cursor })).status).toBe(
				"stale_cursor",
			);
			expect((await explore(a, { operation: "search" })).reason).toBe("reader_unavailable");
			expect(JSON.stringify(first)).not.toContain(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	describe("an unreadable file source", () => {
		const workspace = { readToml: () => null, writeToml: (toml: string) => toml };
		const header = ["#:schema", "https://spellkave.dev/schema/world-manifest-1.0.0.json\n"].join(
			" ",
		);
		const run = async (dir: string, localPath: string | undefined, fixturesRoot?: string) =>
			explore(
				createFileExplorationPort({ workspace, workspacePath: dir, localPath, fixturesRoot }),
				{ operation: "search", source: "local", text: "x" },
			);
		it("names the cause and the flag to pass instead of retrying", async () => {
			const dir = mkdtempSync(join(tmpdir(), "sk-explore-unreadable-"));
			try {
				const noTarget = await run(dir, undefined);
				expect([noTarget.reason, noTarget.error_class, noTarget.recovery]).toEqual([
					"source_unreadable",
					"usage",
					undefined,
				]);
				expect(noTarget.hint).toContain("--target");
				const missing = await run(dir, join(dir, "nope.toml"));
				expect(missing.cause).toContain(join(dir, "nope.toml"));
				// A root whose depends_on bundle is not a sibling: the missing path and --fixtures-root.
				const root = join(dir, "adv", "manifest.toml");
				mkdirSync(join(dir, "adv"));
				writeFileSync(
					root,
					`${header}schema_version = "1.0.0"\n[[bundles]]\nbundle_id = "adv"\ndisplay_name = "A"\nauthor = "t"\nversion = "1.0.0"\ndepends_on = ["srd"]\n`,
				);
				const dependency = await run(dir, root);
				expect(dependency.reason).toBe("source_unreadable");
				expect(dependency.cause).toContain(join(dir, "srd", "manifest.toml"));
				expect(dependency.cause).not.toContain("\n");
				expect(dependency.hint).toContain("--fixtures-root");
				expect(dependency.recovery).toBeUndefined();
				// Pointing --fixtures-root at a dir that holds the bundle makes it readable.
				mkdirSync(join(dir, "deps", "srd"), { recursive: true });
				writeFileSync(
					join(dir, "deps", "srd", "manifest.toml"),
					`${header}schema_version = "1.0.0"\n[[bundles]]\nbundle_id = "srd"\ndisplay_name = "S"\nauthor = "t"\nversion = "1.0.0"\n`,
				);
				expect((await run(dir, root, join(dir, "deps"))).ok).toBe(true);
				// A malformed manifest is the same class with a different hint.
				writeFileSync(root, `${header}not = [toml`);
				const malformed = await run(dir, root);
				expect([malformed.reason, malformed.hint]).toEqual([
					"source_unreadable",
					expect.stringContaining("sk validate"),
				]);
				expect(malformed.cause).toContain(root);
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		});
	});
});
