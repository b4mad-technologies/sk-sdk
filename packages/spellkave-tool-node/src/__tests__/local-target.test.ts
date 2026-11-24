import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectManifest, renderSchemaManifest } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";

import { createLocalAuthorTarget } from "../authoring/local-target";

describe("local author target metadata deltas", () => {
	it("merges root metadata and upserts attachments by the live four-field identity", async () => {
		const dir = mkdtempSync(join(tmpdir(), "spellkave-local-target-"));
		try {
			const root = join(dir, "manifest.toml");
			writeFileSync(
				root,
				`#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
[metadata]
profile = "test"
[[bundles]]
bundle_id = "test"
display_name = "Test"
author = "test"
version = "1"
depends_on = []
[[metadata_namespaces]]
namespace = "test.note"
audience = "frontier.apply_manifest"
bundle_id = "test"
[[metadata_attachments]]
target_kind = "entity_definition"
target_ref = "test/rations"
namespace = "test.note"
bundle_id = "test"
source = "old"
payload_json = '{"note":"old"}'
`,
			);
			const target = createLocalAuthorTarget(root);
			const delta = renderSchemaManifest({
				schema_version: "1.0.0",
				metadata: { editor: { tag: "note", value: {} } },
				metadata_attachments: [
					{
						target_kind: "entity_definition",
						target_ref: "test/rations",
						namespace: "test.note",
						bundle_id: "test",
						source: "new",
						payload_json: '{"note":"new"}',
					},
				],
			});
			expect(await target.applyBatch(delta)).toEqual({ ok: true });
			const manifest = inspectManifest(readFileSync(root, "utf8")).manifest as Record<
				string,
				unknown
			>;
			expect(manifest.metadata).toEqual({ profile: "test", editor: { tag: "note", value: {} } });
			expect(manifest.metadata_attachments).toEqual([
				expect.objectContaining({ source: "new", payload_json: '{"note":"new"}' }),
			]);
			const foreignNamespace = renderSchemaManifest({
				schema_version: "1.0.0",
				metadata_namespaces: [
					{ namespace: "test.note", audience: "frontier.apply_manifest", bundle_id: "foreign" },
				],
			});
			expect(await target.applyBatch(foreignNamespace)).toEqual(
				expect.objectContaining({ ok: false, detail: expect.stringContaining("already owned") }),
			);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

// sk-jay0.3.24.58.1: explicit files in one directory are distinct source roots.
describe("named local manifest roots", () => {
	it("keeps distinct roots and their includes/dependencies separate, with directory compatibility", async () => {
		const dir = mkdtempSync(join(tmpdir(), "spellkave-named-target-"));
		const bundle = (id: string, deps: string[] = []) =>
			renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [
					{ bundle_id: id, display_name: id, author: "test", version: "1", depends_on: deps },
				],
			});
		const definitions = (id: string) =>
			renderSchemaManifest({
				schema_version: "1.0.0",
				entity_definitions: [
					{
						entity_def_id: id,
						bundle_id: id.split("/")[0],
						display_name: id,
						description: "root sentinel",
					},
				],
			}).replace(/^schema_version[^\n]*\n/gm, "");
		try {
			const depDir = join(dir, "dependency");
			mkdirSync(depDir);
			writeFileSync(
				join(depDir, "manifest.toml"),
				bundle("dependency") + definitions("dependency/item"),
			);
			const roots = join(dir, "roots");
			mkdirSync(roots);
			writeFileSync(join(roots, "manifest.toml"), bundle("default") + definitions("default/item"));
			writeFileSync(join(roots, "alpha.inc.toml"), definitions("alpha/item"));
			writeFileSync(join(roots, "beta.inc.toml"), definitions("beta/item"));
			for (const name of ["alpha", "beta"]) {
				writeFileSync(
					join(roots, `${name}.manifest.toml`),
					`${bundle(name, ["dependency"])}\n[[include]]\npath = "${name}.inc.toml"\n`,
				);
			}
			const alpha = createLocalAuthorTarget(join(roots, "alpha.manifest.toml"), {
				fixturesRoot: dir,
			});
			const beta = createLocalAuthorTarget(join(roots, "beta.manifest.toml"), {
				fixturesRoot: dir,
			});
			const ids = (target: ReturnType<typeof createLocalAuthorTarget>) =>
				target.lookup("entity_definitions").map((row) => row.entity_def_id);
			expect(ids(alpha)).toEqual(["dependency/item", "alpha/item"]);
			expect(ids(beta)).toEqual(["dependency/item", "beta/item"]);
			expect(alpha.resolveRef("entity_definitions", "beta/item")).toBe(false);
			expect(beta.resolveRef("entity_definitions", "alpha/item")).toBe(false);
			expect(ids(createLocalAuthorTarget(roots))).toEqual(["default/item"]);
			expect(alpha.lookup("entity_definitions")).toBe(alpha.lookup("entity_definitions"));
			const writable = createLocalAuthorTarget(join(roots, "manifest.toml"));
			const before = writable.lookup("entity_definitions");
			expect(
				await writable.applyBatch(
					renderSchemaManifest({
						schema_version: "1.0.0",
						metadata: { note: "cache invalidation" },
					}),
				),
			).toEqual({ ok: true });
			expect(writable.lookup("entity_definitions")).not.toBe(before);
			expect(ids(writable)).toEqual(["default/item"]);
			expect(ids(alpha)).toEqual(["dependency/item", "alpha/item"]);
			expect(ids(beta)).toEqual(["dependency/item", "beta/item"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("local target applies against the dependency closure (sk-jay0.3.26.16)", () => {
	const bundle = (id: string, deps: string[] = []) => ({
		bundle_id: id,
		display_name: id,
		author: "test",
		version: "1",
		depends_on: deps,
	});
	const item = (id: string) => ({
		entity_def_id: id,
		bundle_id: id.split("/")[0],
		display_name: id,
		description: "item",
	});
	const withDependency = (run: (dir: string) => Promise<void>) => async () => {
		const dir = mkdtempSync(join(tmpdir(), "spellkave-closure-target-"));
		try {
			mkdirSync(join(dir, "base"));
			writeFileSync(
				join(dir, "base", "manifest.toml"),
				renderSchemaManifest({
					schema_version: "1.0.0",
					bundles: [bundle("base")],
					entity_definitions: [item("base/chest")],
				}),
			);
			await run(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};

	it(
		"creates a new root that depends on another bundle on its first flush",
		withDependency(async (dir) => {
			const root = join(dir, "adventure", "manifest.toml");
			const target = createLocalAuthorTarget(join(dir, "adventure"));
			const delta = renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [bundle("adventure", ["base"])],
			});
			expect(await target.applyBatch(delta)).toEqual({ ok: true, applyset: "adventure" });
			expect(readFileSync(root, "utf8")).toMatch(/^applyset = "adventure"$/m);
			const written = inspectManifest(readFileSync(root, "utf8")).manifest as {
				bundles: { depends_on: string[] }[];
				entity_definitions?: unknown[];
			};
			expect(written.bundles[0]?.depends_on).toEqual(["base"]);
			expect(written.entity_definitions ?? []).toEqual([]);
			expect(target.resolveRef("entity_definitions", "base/chest")).toBe(true);
		}),
	);

	it(
		"extends an existing dependent root and still refuses a fatal finding",
		withDependency(async (dir) => {
			mkdirSync(join(dir, "adventure"));
			writeFileSync(
				join(dir, "adventure", "manifest.toml"),
				renderSchemaManifest({ schema_version: "1.0.0", bundles: [bundle("adventure", ["base"])] }),
			);
			const target = createLocalAuthorTarget(join(dir, "adventure"));
			const rows = (manifest: Record<string, unknown>) =>
				renderSchemaManifest({ schema_version: "1.0.0", ...manifest });
			expect(
				await target.applyBatch(rows({ entity_definitions: [item("adventure/potion")] })),
			).toEqual({ ok: true });
			expect(readFileSync(join(dir, "adventure", "manifest.toml"), "utf8")).not.toMatch(
				/^applyset/m,
			);
			const refused = await target.applyBatch(
				rows({ bundles: [bundle("adventure", ["missing"])] }),
			);
			expect(refused.ok).toBe(false);
			expect(refused.detail).toContain("missing");
			const kept = inspectManifest(readFileSync(join(dir, "adventure", "manifest.toml"), "utf8"))
				.manifest as { bundles: { depends_on: string[] }[] };
			expect(kept.bundles[0]?.depends_on).toEqual(["base"]);
		}),
	);
});

describe("verb validation against a dependent local root (sk-jay0.3.26.26)", () => {
	it("a fresh scratch's scaffolded header does not hide the root's depends_on", async () => {
		const { createAuthorFacingBoundTools } = await import("@spellkave/tool-authoring");
		const dir = mkdtempSync(join(tmpdir(), "spellkave-scaffold-shadow-"));
		try {
			mkdirSync(join(dir, "rules"));
			writeFileSync(
				join(dir, "rules", "manifest.toml"),
				renderSchemaManifest({
					schema_version: "1.0.0",
					bundles: [
						{
							bundle_id: "rules",
							display_name: "Rules",
							author: "t",
							version: "1",
							depends_on: [],
						},
					],
					capability_definitions: [
						{
							capability_id: "rules/action/use",
							bundle_id: "rules",
							actor_kind: "entity",
							default_visibility: "Public",
							display_name: "Use",
							description: "Use a thing.",
						},
					],
				}),
			);
			mkdirSync(join(dir, "adventure"));
			writeFileSync(
				join(dir, "adventure", "manifest.toml"),
				renderSchemaManifest({
					schema_version: "1.0.0",
					bundles: [
						{
							bundle_id: "adventure",
							display_name: "Adventure",
							author: "t",
							version: "1",
							depends_on: ["rules"],
						},
					],
				}),
			);
			let scratch: string | null = null;
			const tools = createAuthorFacingBoundTools({
				workspace: {
					readToml: () => scratch,
					writeToml: (next) => {
						scratch = next;
						return "/scratch";
					},
				},
				target: createLocalAuthorTarget(join(dir, "adventure")),
			});
			const defineAction = tools.find((t) => t.name === "spellkave_define_action");
			if (!defineAction) throw new Error("missing spellkave_define_action");
			const result = await defineAction.execute("action", {
				bundle: "adventure",
				id: "act/use",
				required_capability: "rules/action/use",
				on_success: "adventure/act/use/success",
			});
			const details = result.details as { ok: boolean; diagnostics?: { code: string }[] };
			expect(details.diagnostics?.map((d) => d.code) ?? []).not.toContain("MF-VAL-214");
			expect(details.ok).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("stow_item into a placed container without an actor (sk-jay0.3.26.9)", () => {
	it("puts a potion into a chest in a world without NPCs", async () => {
		const { createAuthorFacingBoundTools } = await import("@spellkave/tool-authoring");
		const dir = mkdtempSync(join(tmpdir(), "spellkave-stow-container-"));
		try {
			let scratch: string | null = null;
			const tools = createAuthorFacingBoundTools({
				workspace: {
					readToml: () => scratch,
					writeToml: (next) => {
						scratch = next;
						return "/scratch";
					},
				},
				target: createLocalAuthorTarget(join(dir, "cellar")),
				defaultBundle: "cellar",
			});
			const run = async (name: string, params: Record<string, unknown>) => {
				const tool = tools.find((t) => t.name === name);
				if (!tool) throw new Error(`missing ${name}`);
				return (await tool.execute(name, params)).details as { ok: boolean };
			};
			await run("spellkave_define_bundle", { bundle_id: "cellar", depends_on: [] });
			await run("spellkave_author_place", {
				nodes: [{ id: "cellar/rooms/vault", name: "Vault" }],
				edges: [],
			});
			for (const key of ["cellar/chest", "cellar/potion"])
				await run("spellkave_place_entity", {
					kind: "item",
					at: "cellar/rooms/vault",
					entity_key: key,
				});
			expect(
				(
					await run("spellkave_stow_item", {
						item_entity_key: "cellar/potion",
						container_entity_key: "cellar/chest",
					})
				).ok,
			).toBe(true);
			expect(await run("spellkave_apply_manifest_delta", {})).toMatchObject({ ok: true });
			const root = inspectManifest(readFileSync(join(dir, "cellar", "manifest.toml"), "utf8"))
				.manifest as { entity_containment: { entity_key: string; container_entity_key: string }[] };
			expect(root.entity_containment).toEqual([
				expect.objectContaining({
					entity_key: "cellar/potion",
					container_entity_key: "cellar/chest",
				}),
			]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("still refuses a stow with neither an actor nor a container", async () => {
		const { createAuthorFacingBoundTools } = await import("@spellkave/tool-authoring");
		const tool = createAuthorFacingBoundTools({
			workspace: { readToml: () => null, writeToml: () => "/scratch" },
			defaultBundle: "cellar",
		}).find((t) => t.name === "spellkave_stow_item");
		await expect(tool?.execute("stow", { item_entity_key: "cellar/potion" })).rejects.toThrow(
			/actor_entity_key .* or container_entity_key/,
		);
	});
});

// keep(K2): injects a changing scratch workspace into a target with no root on disk.
describe("scratch dependency resolution before the first flush (sk-jay0.3.26.22)", () => {
	it("defines a bundle then references a dependency id without writing the target", async () => {
		const { createAuthorFacingBoundTools } = await import("@spellkave/tool-authoring");
		const dir = mkdtempSync(join(tmpdir(), "spellkave-pending-deps-"));
		try {
			const dependency = join(dir, "srd.toml");
			writeFileSync(
				dependency,
				renderSchemaManifest({
					schema_version: "1.0.0",
					bundles: [
						{ bundle_id: "srd", display_name: "SRD", author: "test", version: "1", depends_on: [] },
					],
					capability_definitions: [
						{
							capability_id: "srd/use",
							bundle_id: "srd",
							actor_kind: "entity",
							default_visibility: "Public",
							display_name: "Use",
							description: "Use a thing.",
						},
					],
				}),
			);
			let scratch: string | null = null;
			const workspace = {
				readToml: () => scratch,
				writeToml: (next: string) => {
					scratch = next;
					return "/scratch";
				},
			};
			const root = join(dir, "new", "manifest.toml");
			const target = createLocalAuthorTarget(root, {
				dependencyManifests: { srd: dependency },
				readPendingManifest: workspace.readToml,
			});
			// Warm the empty cache before define_bundle changes the scratch.
			expect(target.resolveRef("capability_definitions", "srd/use")).toBe(false);
			const tools = createAuthorFacingBoundTools({ workspace, target });
			const call = async (name: string, params: Record<string, unknown>) => {
				const tool = tools.find((tool) => tool.name === `spellkave_${name}`);
				if (!tool) throw new Error(`missing ${name}`);
				const result = await tool.execute(name, params);
				expect(result.details).toMatchObject({ ok: true });
			};
			await call("define_bundle", {
				bundle_id: "adventure",
				display_name: "Adventure",
				author: "test",
				version: "1",
				depends_on: ["srd"],
			});
			await call("define_action", {
				bundle: "adventure",
				id: "act/use",
				required_capability: "srd/use",
				on_success: "adventure/act/use/success",
			});
			expect(existsSync(root)).toBe(false);
			expect(target.resolveRef("capability_definitions", "srd/use")).toBe(true);
			// Pending own rows belong to the workspace, never the target snapshot.
			expect(target.lookup("action_definitions")).toEqual([]);
			scratch = renderSchemaManifest({
				schema_version: "1.0.0",
				bundles: [
					{
						bundle_id: "adventure",
						display_name: "Adventure",
						author: "test",
						version: "1",
						depends_on: [],
					},
				],
			});
			expect(target.resolveRef("capability_definitions", "srd/use")).toBe(false);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("local target keyless rows (sk-jay0.3.26.23)", () => {
	it("keeps one copy of a keyless row when the same scratch is flushed twice", async () => {
		const dir = mkdtempSync(join(tmpdir(), "spellkave-keyless-target-"));
		try {
			const target = createLocalAuthorTarget(dir);
			const contained = (entity: string) => ({
				container_entity_key: "box/chest",
				entity_key: entity,
				direction: "",
				slot_id: "",
			});
			const delta = (entities: string[]) =>
				renderSchemaManifest({
					schema_version: "1.0.0",
					bundles: [
						{ bundle_id: "box", display_name: "Box", author: "t", version: "1", depends_on: [] },
					],
					entity_containment: entities.map(contained),
				});
			expect((await target.applyBatch(delta(["box/potion"]))).ok).toBe(true);
			expect((await target.applyBatch(delta(["box/potion", "box/ring"]))).ok).toBe(true);
			const rows = (
				inspectManifest(readFileSync(join(dir, "manifest.toml"), "utf8")).manifest as {
					entity_containment: { entity_key: string }[];
				}
			).entity_containment.map((row) => row.entity_key);
			expect(rows).toEqual(["box/potion", "box/ring"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
