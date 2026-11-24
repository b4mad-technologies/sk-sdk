// embedded-manifest: {"category": "exact_text_oracle", "rationale": "applyset diff/apply proofs edit exact root and include texts to produce each row class"}
// embedded-manifest: {"category": "schema_object_oracle", "rationale": "a schema-shaped live export stands in for r_export_manifest to prove drift reporting"}
import type { FilesystemPort } from "@spellkave/tool-runtime";
import { bindTool } from "@spellkave/tool-runtime";
import type { ApplysetMemory, ScopedInstanceSnapshot } from "@spellkave/world-author/tooling";
import { describe, expect, it, vi } from "vitest";
import { type ApplyBundleCall, applysetApplyToolDef, applysetDiffToolDef } from "../applyset-tools";
import type { WorldRowsOnEntity } from "../applyset-world-rows.ts";

const EIGHT_WORLD_ROWS: WorldRowsOnEntity = {
	entityId: "10",
	entityDefId: "demo/torch",
	rows: [
		{ table: "entity_location", key: "a/elsewhere" },
		{ table: "entity_containment", key: "content:99" },
		{ table: "object_state", key: "a/bonus" },
		{ table: "capability", key: "a/grant" },
		{ table: "actor_identity", key: "7" },
		{ table: "actor_spatial_location", key: "a/moved" },
		{ table: "entity_equipment_slot", key: "wearer:ring" },
		{ table: "target_condition", key: "a/hex" },
	],
};

import type { AuthorToolContext } from "../authoring";

const HEADER = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
`;
const BUNDLE =
	'[[bundles]]\nbundle_id = "demo"\ndisplay_name = "Demo"\nversion = "1.0.0"\nauthor = "t"\ndescription = "d"\n';

function def(id: string, desc: string): string {
	return `[[entity_definitions]]\nbundle_id = "demo"\nentity_def_id = "${id}"\ndisplay_name = "X"\ndescription = "${desc}"\n`;
}

function entity(key: string): string {
	return `[[entities]]\nentity_key = "${key}"\nbundle_id = "demo"\nname = "${key}"\nkind = "item"\nplace_node_id = ""\n`;
}

function entityExport(key: string, place: string): string {
	return JSON.stringify({
		entities: [
			{
				entity_key: key,
				bundle_id: "demo",
				entity_def_id: "",
				name: key,
				kind: "item",
				place_node_id: place,
				quantity: 1,
				owned_by_entity_key: "",
			},
		],
	});
}

function lookingWorld(place: string) {
	const world = fakeWorld({ exportRows: entityExport("demo/torch", place) });
	const port = world.context.applyset;
	if (port === undefined) throw new Error("expected applyset port");
	port.livePlaces = () => [{ kind: "entities", key: "demo/torch", place_node_id: place }];
	port.authoredEntityId = () => "10";
	port.worldRows = () => ({ entityId: "10", entityDefId: "", rows: [] });
	return world;
}

function containment(container: string, item: string): string {
	return `[[entity_containment]]\ncontainer_entity_key = "${container}"\nentity_key = "${item}"\n`;
}

/** An in-memory filesystem rooted at `/repo`. */
function memoryFs(files: Record<string, string>): FilesystemPort {
	const norm = (p: string) => p.replace(/\/+/g, "/").replace(/\/$/, "");
	const resolve = (...parts: string[]) => {
		const joined = parts.reduce(
			(acc, part) => (part.startsWith("/") ? part : `${acc}/${part}`),
			"/repo",
		);
		const out: string[] = [];
		for (const seg of norm(joined).split("/")) {
			if (seg === "" || seg === ".") continue;
			if (seg === "..") out.pop();
			else out.push(seg);
		}
		return `/${out.join("/")}`;
	};
	return {
		exists: (p) =>
			resolve(p) in files || Object.keys(files).some((f) => f.startsWith(`${resolve(p)}/`)),
		isFile: (p) => resolve(p) in files,
		readText: (p) => {
			const text = files[resolve(p)];
			if (text === undefined) throw new Error(`ENOENT ${p}`);
			return text;
		},
		writeText: (p, content) => {
			files[resolve(p)] = content;
		},
		ensureDirectory: () => {},
		dirname: (p) => p.slice(0, p.lastIndexOf("/")) || "/",
		join: (...parts) => norm(parts.join("/")),
		resolve,
		moduleDirectory: () => "/repo",
	};
}

/** A fake world: remembers what `r_apply_bundle` recorded, like the server's seal. */
function fakeWorld(options: { fail?: string; exportRows?: string } = {}) {
	let memory: ApplysetMemory | null = null;
	const calls: ApplyBundleCall[] = [];
	const context: AuthorToolContext = {
		workspace: { readToml: () => null, writeToml: () => "" },
		applyset: {
			readApplyset: async () => memory,
			applyBundle: async (call) => {
				calls.push(call);
				if (options.fail !== undefined) return { ok: false, detail: options.fail };
				const parts = new Map((memory?.parts ?? []).map((p) => [p.path, p.entries]));
				for (const part of JSON.parse(call.partsJson) as ApplysetMemory["parts"]) {
					if (part.entries.length === 0) parts.delete(part.path);
					else parts.set(part.path, part.entries);
				}
				memory = {
					root_path: call.rootPath,
					generation: call.expectedGeneration + 1,
					base_state: "known",
					parts: [...parts].map(([path, entries]) => ({ path, entries })),
				};
				return { ok: true };
			},
			rootPathFor: (file) => file.replace(/^\/repo\//, ""),
		},
		exportManifest: async (bundleId) => {
			if (options.exportRows === undefined) throw new Error("MF-EXPORT-011: over the bound");
			return {
				bundleId,
				status: "complete",
				rowCount: 1,
				diagnostics: "",
				manifestJson: JSON.stringify({
					schema_version: "1.0.0",
					...JSON.parse(options.exportRows),
				}),
			};
		},
	};
	return {
		context,
		calls,
		setMemory: (m: ApplysetMemory | null) => (memory = m),
		memory: () => memory,
	};
}

function root(rows: string, includes: string[] = []): string {
	const directives = includes.map((p) => `\n[[include]]\npath = "${p}"\n`).join("");
	return HEADER.concat('applyset = "demo"\n', BUNDLE, rows, directives);
}

function tools(context: AuthorToolContext, files: Record<string, string>) {
	const filesystem = memoryFs(files);
	const bind = <T>(def: T) =>
		bindTool(def as never, { context, capabilities: { node: { filesystem } } }) as {
			execute(id: string, params: unknown): Promise<{ details: Record<string, unknown> }>;
		};
	return {
		diff: (params: Record<string, unknown>) =>
			bind(applysetDiffToolDef)
				.execute("t", params)
				.then((r) => r.details),
		apply: (params: Record<string, unknown>) =>
			bind(applysetApplyToolDef)
				.execute("t", params)
				.then((r) => r.details),
	};
}

function scopedChest(place = "", status = "complete"): ScopedInstanceSnapshot {
	return {
		snapshot: {
			visible_manifest_authored_entity_coverage: {
				iter: () => [{ status: "complete", projectionVersion: 1 }],
			},
			visible_manifest_authored_entity: {
				iter: () => [{ manifestKey: "demo:demo/chest", entityId: 10n, bundleId: "demo" }],
			},
			entity: {
				iter: () => [
					{
						entityId: 10n,
						entityDefId: "",
						name: "demo/chest",
						kind: "item",
						quantity: 1n,
						ownedByEntityId: 0n,
					},
				],
			},
			entity_location: { iter: () => (place ? [{ entityId: 10n, placeNodeId: place }] : []) },
			object_state: {
				iter: () => [
					{
						targetKind: "entity",
						targetId: "10",
						stateId: "demo/charge",
						value: { tag: "Int", value: 2n },
						visibility: { tag: "Hidden" },
						sourceTemplateId: "",
						setAtTick: 7n,
						bundleId: "demo",
					},
				],
			},
		},
		source: {
			reads_as_publisher: false,
			identity: "caller",
			world: "world",
			tick: "7",
			connection_epoch: 1,
			source_epoch: 1,
			projection_version: 1,
			authorized_scopes: ["graph-binding"],
			authorized_bundles: [],
			labels: ["authored_entities_only"],
			coverage: { entities: status, actor_spatial_locations: "complete", object_state: status },
		},
	};
}

describe("spellkave_applyset_diff / spellkave_applyset_apply", () => {
	it("portable source shares the local normalized plan and logical provenance without consulting host files", async () => {
		const toml = root(entity("demo/torch"), ["part.toml"]);
		const fragment = def("demo/torch", "Portable");
		const local = tools(fakeWorld().context, {
			"/repo/world/manifest.toml": toml,
			"/repo/world/part.toml": fragment,
		});
		const world = fakeWorld();
		world.context.applyset!.rootPathFor = () => {
			throw new Error("host path access");
		};
		const remote = tools(world.context, {});
		const source = {
			root_path: "world/manifest.toml",
			root_toml: toml,
			fragments: [{ path: "world/part.toml", toml: fragment }],
		};
		expect(await remote.diff({ source })).toEqual(await local.diff({ dir: "/repo/world" }));
		const applied = await remote.apply({ source });
		expect(applied).toMatchObject({ ok: true, sent: true, root_path: "world/manifest.toml" });
		expect(world.calls).toHaveLength(1);
		expect(world.calls[0]?.rootPath).toBe("world/manifest.toml");
	});

	it("portable source rejects missing includes and ambiguous modes before enqueue", async () => {
		const world = fakeWorld();
		const remote = tools(world.context, {});
		const source = {
			root_path: "manifest.toml",
			root_toml: root("", ["missing.toml"]),
			fragments: [],
		};
		await expect(remote.apply({ source })).rejects.toThrow("missing supplied fragment");
		await expect(remote.apply({ source, dir: "/repo" })).rejects.toThrow("exactly one");
		await expect(remote.apply({ source, dep: ["/repo/private"] })).rejects.toThrow(
			"cannot read dependency paths",
		);
		expect(world.calls).toEqual([]);
	});

	it("refuses unread seal drift before sending and records the explicit force decision", async () => {
		const world = fakeWorld();
		const seal =
			'[[place_graphs]]\nplace_graph_id = "demo/g"\nbundle_id = "demo"\nsubstrate_id = "indoor"\ndisplay_name = "G"\n[[place_seals]]\nplace_graph_id = "demo/g"\nbundle_id = "demo"\n';
		const { apply } = tools(world.context, { "/repo/fx/manifest.toml": root(seal) });
		expect(await apply({ dir: "fx" })).toMatchObject({
			ok: false,
			sent: false,
			seal_drift_not_checked: ["demo/g"],
		});
		expect(world.calls).toHaveLength(0);
		expect(await apply({ dir: "fx", force: true })).toMatchObject({
			force_used: ["world_changed"],
		});
		expect(world.calls[0].deltaToml).toContain("[[place_seals]]");
	});

	it("refuses seeded conflict before sending and force records comparable hashes", async () => {
		const world = fakeWorld({
			exportRows: JSON.stringify({
				entity_definitions: [
					{ bundle_id: "demo", entity_def_id: "demo/a", display_name: "X", description: "world" },
				],
			}),
		});
		const files = { "/repo/fx/manifest.toml": root(def("demo/a", "file")) };
		const { diff, apply } = tools(world.context, files);
		expect((await diff({ dir: "fx" })).conflicts).toHaveLength(1);
		expect(await apply({ dir: "fx" })).toMatchObject({ ok: false, sent: false });
		expect(world.calls).toHaveLength(0);
		const forced = await apply({ dir: "fx", force: true });
		expect(forced.force_used).toEqual(["world_changed"]);
		expect(world.calls[0].deltaToml).toContain('description = "file"');
		expect(
			JSON.parse(world.calls[0].partsJson)[0].entries.find(
				(e: { key: string }) => e.key === "demo/a",
			).export_hash,
		).toMatch(/^[a-f0-9]{64}$/);
	});

	it("diffs a new applyset as all creates, then applies it once", async () => {
		const world = fakeWorld();
		const files = {
			"/repo/fx/manifest.toml": root(def("demo/a", "a"), ["b.toml"]),
			"/repo/fx/b.toml": def("demo/b", "b"),
		};
		const { diff, apply } = tools(world.context, files);
		const before = await diff({ dir: "fx" });
		expect(before.differences).toBe(true);
		expect(before.counts).toMatchObject({ create: 3, unchanged: 0 });
		expect(before.root_path).toBe("fx/manifest.toml");
		expect(world.calls).toHaveLength(0);

		const applied = await apply({ dir: "fx" });
		expect(applied.ok).toBe(true);
		expect(applied.sent).toBe(true);
		expect(applied.generation_after).toBe(1);
		expect(world.calls).toHaveLength(1);
		expect(world.calls[0]).toMatchObject({
			applyset: "demo",
			rootPath: "fx/manifest.toml",
			expectedGeneration: 0,
			force: false,
		});
		expect((applied.results as Array<{ result: string }>).map((r) => r.result)).toEqual([
			"created",
			"created",
			"created",
		]);

		const after = await diff({ dir: "fx/manifest.toml" });
		expect(after.differences).toBe(false);
		expect(after.generation).toBe(1);
	});

	it("sends only the changed row, and nothing when nothing changed", async () => {
		const world = fakeWorld();
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(def("demo/a", "a"), ["b.toml"]),
			"/repo/fx/b.toml": def("demo/b", "b"),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		const idle = await apply({ dir: "fx", force: true });
		expect(idle.sent).toBe(false);
		expect(world.calls).toHaveLength(1);

		files["/repo/fx/b.toml"] = def("demo/b", "changed");
		const changed = await apply({ dir: "fx", force: true });
		expect(changed.results).toEqual([
			{ result: "configured", kind: "entity_definitions", key: "demo/b", part: "b.toml" },
		]);
		expect(world.calls[1]?.deltaToml).toContain("changed");
		expect(world.calls[1]?.deltaToml).not.toContain("demo/a");
		expect(world.calls[1]?.expectedGeneration).toBe(1);
	});

	it("names prune candidates without --prune and refuses --prune on an unknown base", async () => {
		const world = fakeWorld();
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(def("demo/a", "a"), ["b.toml"]),
			"/repo/fx/b.toml": def("demo/b", "b"),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(def("demo/a", "a"));
		const kept = await apply({ dir: "fx", force: true });
		expect(kept.sent).toBe(false);
		expect(kept.prune_candidates).toEqual([
			{ kind: "entity_definitions", key: "demo/b", part: "b.toml" },
		]);

		const memory = world.memory() as ApplysetMemory;
		world.setMemory({ ...memory, base_state: "unknown" });
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		expect(refused.sent).toBe(false);
		expect((refused.diagnostics as Array<{ code: string }>).map((d) => d.code)).toEqual([
			"MF-APPLYSET-PRUNE-UNKNOWN",
		]);
		expect(world.calls).toHaveLength(1);
	});

	it("does not inspect world-added rows on a plain apply without --prune", async () => {
		const world = fakeWorld();
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.worldRows = () => "not_subscribed";
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(
			`[[entities]]
entity_key = "demo/chest"
bundle_id = "demo"
name = "Chest!"
kind = "item"
place_node_id = ""
`,
		);
		const kept = await apply({ dir: "fx", force: true });
		expect(kept.ok).toBe(true);
		expect(kept.sent).toBe(true);
		expect(kept.error).toBeUndefined();
		expect(kept.force_used).toBeUndefined();
		expect(kept.world_added_rows).toBeUndefined();
		expect(kept.prune_candidates).toEqual(
			expect.arrayContaining([{ kind: "entities", key: "demo/torch", part: "manifest.toml" }]),
		);
	});

	it("reports a retracted entity and its covered containment as pruned", async () => {
		const world = lookingWorld("");
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`, [
				"items.toml",
			]),
			"/repo/fx/items.toml": containment("demo/chest", "demo/torch"),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"), ["items.toml"]);
		files["/repo/fx/items.toml"] = "";

		const pruned = await apply({ dir: "fx", prune: true });
		expect(pruned.ok).toBe(true);
		expect(pruned.sent).toBe(true);
		expect(pruned.results).toEqual(
			expect.arrayContaining([
				{ result: "pruned", kind: "entities", key: "demo/torch", part: "manifest.toml" },
				{
					result: "pruned",
					kind: "entity_containment",
					key: '["demo/chest","demo/torch"]',
					part: "items.toml",
				},
			]),
		);
		expect(world.calls.at(-1)?.deltaToml).toContain('authored_key = "demo:demo/torch"');
	});

	it("refuses a containment prune without its entity, prints the diagnostic, and sends nothing", async () => {
		const world = fakeWorld();
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`, [
				"items.toml",
			]),
			"/repo/fx/items.toml": containment("demo/chest", "demo/torch"),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		expect(world.calls).toHaveLength(1);
		files["/repo/fx/items.toml"] = "";
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		expect(refused.sent).toBe(false);
		expect(
			(refused.diagnostics as Array<{ code: string; message: string }>).map((d) => d.code),
		).toContain("MF-APPLYSET-PRUNE-INSTANCE");
		expect(
			(refused.diagnostics as Array<{ message: string }>).some((d) =>
				d.message.includes("can be removed only together with its entity `demo/torch`"),
			),
		).toBe(true);
		expect(world.calls).toHaveLength(1);
		expect(String(refused.error ?? "")).not.toMatch(/--force/);
	});

	it("dry-run sends nothing", async () => {
		const world = fakeWorld();
		const { apply } = tools(world.context, { "/repo/fx/manifest.toml": root(def("demo/a", "a")) });
		const dry = await apply({ dir: "fx", dry_run: true });
		expect(dry.ok).toBe(true);
		expect(dry.sent).toBe(false);
		expect(dry.differences).toBe(true);
		expect(world.calls).toHaveLength(0);
	});

	it("reports the world's refusal with its code", async () => {
		const world = fakeWorld({
			fail: '{"code":"MF-APPLY-030","message":"stale applyset generation","details":{"expected_generation":0,"current_generation":1}}',
		});
		const { apply } = tools(world.context, { "/repo/fx/manifest.toml": root(def("demo/a", "a")) });
		const refused = await apply({ dir: "fx", force: true });
		expect(refused.ok).toBe(false);
		expect(refused.code).toBe("MF-APPLY-030");
		expect(world.calls[0]?.force).toBe(true);
	});

	it("reports drift from an export and bundles it could not export", async () => {
		const world = fakeWorld();
		const files = { "/repo/fx/manifest.toml": root(def("demo/a", "a")) };
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		const drifting = fakeWorld({
			exportRows: JSON.stringify({
				entity_definitions: [
					{
						bundle_id: "demo",
						entity_def_id: "demo/a",
						display_name: "X",
						description: "live edit",
					},
				],
			}),
		});
		drifting.setMemory(world.memory());
		const report = await tools(drifting.context, files).diff({ dir: "fx" });
		expect(report.differences).toBe(false);
		const rows = report.rows as Array<{ key: string; live: string }>;
		expect(rows.find((r) => r.key === "demo/a")?.live).toBe("drift");
		expect((report.values as Array<{ live: string }>)[0]?.live).toContain("live edit");

		const refusedExport = await tools(world.context, files).diff({ dir: "fx" });
		expect(refusedExport.live).toMatchObject({
			exported: [],
			not_exported: [{ bundle_id: "demo", reason: "MF-EXPORT-011: over the bound" }],
		});
	});

	it("reports a non-publisher export refusal and still classifies rows", async () => {
		const world = fakeWorld();
		world.context.exportManifest = async () => {
			throw new Error("manifest export requires the module publisher: MF-EXPORT-001");
		};
		const files = { "/repo/fx/manifest.toml": root(def("demo/a", "a")) };
		const report = await tools(world.context, files).diff({ dir: "fx" });
		expect(report.live).toMatchObject({
			exported: [],
			not_exported: [
				{
					bundle_id: "demo",
					reason: "the connection cannot read live rows (the export is publisher-only)",
				},
			],
		});
		const classes = (report.rows as Array<{ key: string; class: string }>).map((row) => row.class);
		expect(classes.length).toBeGreaterThan(0);
		expect(classes.every((kind) => kind === "create")).toBe(true);
	});

	it("refuses a root without applyset and a host without the port", async () => {
		const world = fakeWorld();
		const files = { "/repo/fx/manifest.toml": HEADER.concat(BUNDLE, def("demo/a", "a")) };
		await expect(tools(world.context, files).diff({ dir: "fx" })).rejects.toThrow(
			/MF-APPLYSET-LOAD/,
		);
		const { applyset: _, ...unconnected } = world.context;
		await expect(tools(unconnected, files).diff({ dir: "fx" })).rejects.toThrow(/not connected/);
		await expect(tools(world.context, {}).diff({ dir: "missing" })).rejects.toThrow(
			/no root manifest/,
		);
	});

	it("refuses scoped entity prune with and without force, without enqueue", async () => {
		const world = fakeWorld();
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.worldRows = () => "not_subscribed";
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		port.readsAsPublisher = () => false;
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		expect(refused.sent).toBe(false);
		expect(refused.error).toBe("scope_prune_unsupported: entity prune requires publisher closure");
		expect(world.calls).toHaveLength(1);
		const forced = await apply({ dir: "fx", prune: true, force: true });
		expect(forced.ok).toBe(false);
		expect(forced.sent).toBe(false);
		expect(world.calls).toHaveLength(1);
		expect(forced.error).toBe("scope_prune_unsupported: entity prune requires publisher closure");
		expect(forced.force_used).toBeUndefined();
	});

	// keep(K2): inject unavailable host readers and a scoped principal before any prune inspection.
	it.each([
		"missing reader",
		"not subscribed",
		"unknown entity",
		"scoped reader",
	])("prune preview refuses %s without writing", async (failure) => {
		const world = lookingWorld("a/elsewhere");
		const port = world.context.applyset;
		if (!port) throw new Error("expected applyset port");
		const files = { "/repo/fx/manifest.toml": root(entity("demo/torch")) };
		const { apply, diff } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root("");
		const read = vi.fn(() => ({ entityId: "10", entityDefId: "", rows: [] }));
		port.worldRows = read;
		let reason: string;
		if (failure === "missing reader") {
			delete port.worldRows;
			reason = "no worldRows";
		} else if (failure === "not subscribed") {
			port.worldRows = () => "not_subscribed";
			reason = "not_subscribed";
		} else if (failure === "unknown entity") {
			port.authoredEntityId = () => null;
			reason = "unknown authored id";
		} else {
			port.readsAsPublisher = () => false;
			reason = "scope_prune_unsupported";
		}
		const report = await diff({ dir: "fx", prune: true });
		expect(report.ok).toBe(false);
		expect(report.sent).toBe(false);
		expect(String(report.error)).toContain(reason);
		expect(report.world_added_rows).toEqual({});
		expect(world.calls).toHaveLength(1);
		if (failure === "scoped reader") expect(read).not.toHaveBeenCalled();
	});

	it("refuses a prune with world-added rows unless --force, pinning each owner table once", async () => {
		const world = lookingWorld("a/elsewhere");
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.worldRows = (entityId) =>
			entityId === "10" ? EIGHT_WORLD_ROWS : { entityId, entityDefId: "", rows: [] };
		port.authoredEntityId = () => "10";
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply, diff } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const preview = await diff({ dir: "fx", prune: true });
		expect(preview.ok).toBe(true);
		expect(preview.sent).toBe(false);
		expect(world.calls).toHaveLength(1);
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		expect(refused.sent).toBe(false);
		expect(String(refused.error)).toMatch(/--force/);
		expect(world.calls).toHaveLength(1);
		const listed = refused.world_added_rows as {
			"demo/torch": { taken: Array<{ table: string }>; left_behind: Array<{ table: string }> };
		};
		expect(preview.world_added_rows).toEqual(listed);
		const taken = listed["demo/torch"]?.taken ?? [];
		const left = listed["demo/torch"]?.left_behind ?? [];
		const listedTables = [...taken, ...left].map((row) => row.table).sort();
		expect(listedTables).toEqual(EIGHT_WORLD_ROWS.rows.map((row) => row.table).sort());
		expect(left.map((row) => row.table)).toEqual(["target_condition"]);
		expect(refused.live_only).toEqual([]);

		const forced = await apply({ dir: "fx", prune: true, force: true });
		expect(forced.ok).toBe(true);
		expect(forced.sent).toBe(true);
		expect(forced.force_used).toEqual(["world_added_rows"]);
		expect(forced.live_only).toEqual([]);
		const pruned = (forced.results as Array<{ key: string; world_added_rows?: unknown }>).find(
			(row) => row.key === "demo/torch",
		);
		expect(pruned?.world_added_rows).toEqual(listed["demo/torch"]);
	});

	it("reports force_used root_takeover and both without changing live_only", async () => {
		const world = fakeWorld();
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(def("demo/a", "a")),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		const memory = world.memory();
		if (memory === null) throw new Error("expected memory");
		world.setMemory({ ...memory, root_path: "other/manifest.toml" });
		files["/repo/fx/manifest.toml"] = root(def("demo/a", "b"));
		const takeover = await apply({ dir: "fx", force: true });
		expect(takeover.ok).toBe(true);
		expect(takeover.sent).toBe(true);
		expect(takeover.force_used).toEqual(["root_takeover"]);
		expect(takeover.live_only).toEqual([]);

		const mixed = lookingWorld("a/elsewhere");
		const port = mixed.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.worldRows = (entityId) =>
			entityId === "10" ? EIGHT_WORLD_ROWS : { entityId, entityDefId: "", rows: [] };
		port.authoredEntityId = () => "10";
		const mixedFiles: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const mixedTools = tools(mixed.context, mixedFiles);
		await mixedTools.apply({ dir: "fx", force: true });
		const mixedMemory = mixed.memory();
		if (mixedMemory === null) throw new Error("expected memory");
		mixed.setMemory({ ...mixedMemory, root_path: "other/manifest.toml" });
		mixedFiles["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const both = await mixedTools.apply({ dir: "fx", prune: true, force: true });
		expect(both.ok).toBe(true);
		expect(both.sent).toBe(true);
		expect(both.force_used).toEqual(["root_takeover", "world_added_rows"]);
		expect(both.live_only).toEqual([]);
	});

	const d8Cells = [
		{
			name: "publisher, none, without --force",
			force: false,
			publisher: true,
			subscribed: true,
			extras: false,
			ok: true,
			sent: true,
			force_used: undefined,
		},
		{
			name: "publisher, none, with --force",
			force: true,
			publisher: true,
			subscribed: true,
			extras: false,
			ok: true,
			sent: true,
			force_used: undefined,
		},
		{
			name: "publisher, some, without --force",
			force: false,
			publisher: true,
			subscribed: true,
			extras: true,
			ok: false,
			sent: false,
			force_used: undefined,
			error: /--force/,
			headings: true,
		},
		{
			name: "publisher, some, with --force",
			force: true,
			publisher: true,
			subscribed: true,
			extras: true,
			ok: true,
			sent: true,
			force_used: ["world_added_rows"] as const,
			headings: true,
		},
		{
			name: "not publisher, without --force",
			force: false,
			publisher: false,
			subscribed: true,
			extras: false,
			ok: false,
			sent: false,
			force_used: undefined,
			error: /scope_prune_unsupported/,
		},
		{
			name: "not publisher, with --force",
			force: true,
			publisher: false,
			subscribed: true,
			extras: false,
			ok: false,
			sent: false,
			force_used: undefined,
			error: /scope_prune_unsupported/,
		},
		{
			name: "not_subscribed, without --force",
			force: false,
			publisher: true,
			subscribed: false,
			extras: false,
			ok: false,
			sent: false,
			force_used: undefined,
			error: /cannot look: not_subscribed/,
		},
		{
			name: "not_subscribed, with --force",
			force: true,
			publisher: true,
			subscribed: false,
			extras: false,
			ok: true,
			sent: true,
			force_used: ["world_added_rows"] as const,
		},
	];

	it.each(d8Cells)("D-8 $name", async (cell) => {
		const world = lookingWorld(cell.extras ? "a/elsewhere" : "");
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.readsAsPublisher = () => true;
		if (!cell.publisher || !cell.subscribed) {
			port.worldRows = () => "not_subscribed";
		} else {
			port.authoredEntityId = () => "10";
			port.worldRows = (entityId) =>
				entityId === "10" && cell.extras
					? EIGHT_WORLD_ROWS
					: { entityId, entityDefId: "", rows: [] };
		}
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		port.readsAsPublisher = () => cell.publisher;
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const result = await apply({ dir: "fx", prune: true, force: cell.force });
		expect(result.ok).toBe(cell.ok);
		expect(result.sent).toBe(cell.sent);
		expect(result.force_used).toEqual(cell.force_used);
		if (cell.error !== undefined) expect(String(result.error)).toMatch(cell.error);
		if (cell.headings === true) {
			const listed =
				cell.sent === true
					? (
							result.results as Array<{
								key: string;
								world_added_rows?: { taken: unknown[]; left_behind: unknown[] };
							}>
						).find((row) => row.key === "demo/torch")?.world_added_rows
					: (
							result.world_added_rows as Record<
								string,
								{ taken: unknown[]; left_behind: unknown[] }
							>
						)["demo/torch"];
			expect(listed?.taken?.length).toBeGreaterThan(0);
			expect(listed?.left_behind?.length).toBeGreaterThan(0);
		}
	});

	it("lists a moved entity location as taken and an unchanged placed entity not at all", async () => {
		const moved = lookingWorld("a/elsewhere");
		const movedPort = moved.context.applyset;
		if (movedPort === undefined) throw new Error("expected applyset port");
		movedPort.authoredEntityId = () => "10";
		movedPort.worldRows = (entityId) =>
			entityId === "10"
				? {
						entityId,
						entityDefId: "",
						rows: [{ table: "entity_location", key: "a/elsewhere" }],
					}
				: { entityId, entityDefId: "", rows: [] };
		const movedFiles: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const movedApply = tools(moved.context, movedFiles).apply;
		await movedApply({ dir: "fx", force: true });
		movedFiles["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const refused = await movedApply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		expect(
			(refused.world_added_rows as Record<string, { taken: Array<{ table: string }> }>)[
				"demo/torch"
			].taken,
		).toEqual([{ table: "entity_location", key: "a/elsewhere" }]);

		const still = lookingWorld("");
		const stillPort = still.context.applyset;
		if (stillPort === undefined) throw new Error("expected applyset port");
		stillPort.authoredEntityId = () => "10";
		stillPort.worldRows = () => ({ entityId: "10", entityDefId: "", rows: [] });
		const stillFiles: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const stillApply = tools(still.context, stillFiles).apply;
		await stillApply({ dir: "fx" });
		stillFiles["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const ok = await stillApply({ dir: "fx", prune: true });
		expect(ok.ok).toBe(true);
		expect(ok.sent).toBe(true);
		expect(ok.world_added_rows).toBeUndefined();
	});

	it("refuses cannot look when the prune place is not comparable", async () => {
		const world = fakeWorld();
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.authoredEntityId = () => "10";
		port.worldRows = () => ({ entityId: "10", entityDefId: "", rows: [] });
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		expect(refused.error).toBe("cannot look: not_comparable place or position");
	});

	it("refuses cannot look when worldRows is missing, unless --force", async () => {
		const world = fakeWorld({ exportRows: entityExport("demo/torch", "") });
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.livePlaces = () => [{ kind: "entities", key: "demo/torch", place_node_id: "" }];
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		expect(refused.sent).toBe(false);
		expect(refused.error).toBe("cannot look: no worldRows");
		expect(world.calls).toHaveLength(1);
		const forced = await apply({ dir: "fx", prune: true, force: true });
		expect(forced.ok).toBe(true);
		expect(forced.sent).toBe(true);
	});

	it("refuses cannot look when authoredEntityId is missing", async () => {
		const world = lookingWorld("");
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.authoredEntityId = () => null;
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		expect(refused.error).toBe("cannot look: unknown authored id");
	});

	it("lists a second same-def occupant of a seeded container", async () => {
		const world = lookingWorld("");
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.worldRows = () => ({
			entityId: "10",
			entityDefId: "a/chest",
			rows: [
				{ table: "entity_containment", key: "container:a/potion" },
				{ table: "entity_containment", key: "container:a/potion" },
				{ table: "entityDefinitionInitialContainment", key: "a/potion" },
			],
		});
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		const listed = refused.world_added_rows as {
			"demo/torch": { left_behind: Array<{ table: string; key: string }> };
		};
		expect(listed["demo/torch"].left_behind).toEqual([
			{ table: "entity_containment", key: "container:a/potion" },
		]);
	});

	it("does not list an empty entity_location key when a contained prune drifts", async () => {
		const world = lookingWorld("elsewhere");
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.worldRows = () => ({ entityId: "10", entityDefId: "", rows: [] });
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${entity("demo/torch")}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const result = await apply({ dir: "fx", prune: true });
		const added = result.world_added_rows as
			| Record<string, { taken: Array<{ table: string; key: string }> }>
			| undefined;
		const taken = added?.["demo/torch"]?.taken ?? [];
		expect(taken.some((row) => row.table === "entity_location" && row.key === "")).toBe(false);
	});

	it("lists a moved actor position when memory already has a spatial row", async () => {
		const body = `[[entities]]
entity_key = "demo/body"
bundle_id = "demo"
name = "body"
kind = "npc"
place_node_id = "demo/cell"

[[actors]]
bundle_id = "demo"
entity_key = "demo/body"
name = "body"

[[actor_spatial_locations]]
bundle_id = "demo"
entity_key = "demo/body"
place_node_id = "demo/cell"
selection_path = "manifest:demo/body"
`;
		const world = fakeWorld({
			exportRows: JSON.stringify({
				entities: [
					{
						entity_key: "demo/body",
						bundle_id: "demo",
						entity_def_id: "",
						name: "body",
						kind: "npc",
						place_node_id: "demo/elsewhere",
						quantity: 1,
						owned_by_entity_key: "",
					},
				],
				actor_spatial_locations: [
					{
						entity_key: "demo/body",
						place_node_id: "demo/elsewhere",
						bundle_id: "demo",
						selection_path: "manifest:demo/body",
					},
				],
			}),
		});
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.livePlaces = () => [
			{ kind: "entities", key: "demo/body", place_node_id: "demo/elsewhere" },
			{
				kind: "actor_spatial_locations",
				key: "demo/body",
				place_node_id: "demo/elsewhere",
			},
		];
		port.authoredEntityId = () => "10";
		port.worldRows = () => ({
			entityId: "10",
			entityDefId: "",
			rows: [{ table: "actor_spatial_location", key: "demo/elsewhere" }],
		});
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${body}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const refused = await apply({ dir: "fx", prune: true });
		expect(refused.ok).toBe(false);
		const taken = (
			refused.world_added_rows as {
				"demo/body": { taken: Array<{ table: string; key: string }> };
			}
		)["demo/body"].taken;
		expect(taken).toEqual(
			expect.arrayContaining([{ table: "actor_spatial_location", key: "demo/elsewhere" }]),
		);
	});

	it("does not list the same actor position when memory already has a spatial row", async () => {
		const body = `[[entities]]
entity_key = "demo/body"
bundle_id = "demo"
name = "body"
kind = "npc"
place_node_id = "demo/cell"

[[actors]]
bundle_id = "demo"
entity_key = "demo/body"
name = "body"

[[actor_spatial_locations]]
bundle_id = "demo"
entity_key = "demo/body"
place_node_id = "demo/cell"
selection_path = "manifest:demo/body"
`;
		const world = fakeWorld({
			exportRows: JSON.stringify({
				entities: [
					{
						entity_key: "demo/body",
						bundle_id: "demo",
						entity_def_id: "",
						name: "body",
						kind: "npc",
						place_node_id: "demo/cell",
						quantity: 1,
						owned_by_entity_key: "",
					},
				],
				actor_spatial_locations: [
					{
						entity_key: "demo/body",
						place_node_id: "demo/cell",
						bundle_id: "demo",
						selection_path: "manifest:demo/body",
					},
				],
			}),
		});
		const port = world.context.applyset;
		if (port === undefined) throw new Error("expected applyset port");
		port.livePlaces = () => [
			{ kind: "entities", key: "demo/body", place_node_id: "demo/cell" },
			{
				kind: "actor_spatial_locations",
				key: "demo/body",
				place_node_id: "demo/cell",
			},
		];
		port.authoredEntityId = () => "10";
		port.worldRows = () => ({
			entityId: "10",
			entityDefId: "",
			rows: [{ table: "actor_spatial_location", key: "demo/cell" }],
		});
		const files: Record<string, string> = {
			"/repo/fx/manifest.toml": root(`${entity("demo/chest")}${body}`),
		};
		const { apply } = tools(world.context, files);
		await apply({ dir: "fx", force: true });
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest"));
		const kept = await apply({ dir: "fx", prune: true });
		expect(kept.ok).toBe(true);
		expect(kept.sent).toBe(true);
		const taken =
			(
				kept.world_added_rows as
					| {
							"demo/body": { taken: Array<{ table: string; key: string }> };
					  }
					| undefined
			)?.["demo/body"]?.taken ?? [];
		expect(taken.some((row) => row.table === "actor_spatial_location")).toBe(false);
	});
	it("compares scoped live chest state and refreshes the source before apply without owner access", async () => {
		const state = (value: number) =>
			`[[object_state]]\nentity_key="demo/chest"\nstate_id="demo/charge"\nbundle_id="demo"\nsource_template_id=""\nvalue_int=${value}\n`;
		const exported = JSON.parse(entityExport("demo/chest", ""));
		exported.object_state = [
			{
				entity_key: "demo/chest",
				state_id: "demo/charge",
				bundle_id: "demo",
				source_template_id: "",
				value_int: 1,
			},
		];
		const world = fakeWorld({ exportRows: JSON.stringify(exported) });
		const files = { "/repo/fx/manifest.toml": root(entity("demo/chest") + state(1)) };
		const bound = tools(world.context, files);
		expect(await bound.apply({ dir: "fx", force: true })).toMatchObject({ ok: true, sent: true });
		// The real adapter reads comparable hashes from the separate side table.
		const memory = world.memory();
		if (!memory) throw new Error("sealed memory missing");
		world.setMemory({
			...memory,
			export_hashes: memory.parts.flatMap((part) =>
				part.entries.flatMap((entry) =>
					entry.export_hash
						? [{ kind: entry.kind, key: entry.key, export_hash: entry.export_hash }]
						: [],
				),
			),
		});

		const port = world.context.applyset;
		if (!port) throw new Error("missing port");
		port.readsAsPublisher = () => false;
		const read = vi.fn(async () => scopedChest());
		port.readScopedSnapshot = read;
		port.livePlaces = () => {
			throw new Error("gameplay placement accessor forbidden");
		};
		world.context.exportManifest = async () => {
			throw new Error("publisher export forbidden");
		};
		files["/repo/fx/manifest.toml"] = root(entity("demo/chest") + state(3));
		const diff = await bound.diff({ dir: "fx" });
		expect(diff.conflicts).toEqual(
			expect.arrayContaining([expect.objectContaining({ kind: "object_state" })]),
		);
		const refused = await bound.apply({ dir: "fx" });
		expect(refused).toMatchObject({ ok: false, sent: false });
		expect(world.calls).toHaveLength(1);
		const forced = await bound.apply({ dir: "fx", force: true });
		expect(forced).toMatchObject({ ok: true, sent: true, force_used: ["world_changed"] });
		expect(world.calls).toHaveLength(2);
		expect(read).toHaveBeenCalledTimes(3);
	});
	it("refuses a scoped live placement conflict before enqueue and force records the known conflict", async () => {
		const world = fakeWorld({ exportRows: entityExport("demo/chest", "") });
		const files = { "/repo/fx/manifest.toml": root(entity("demo/chest")) };
		const bound = tools(world.context, files);
		await bound.apply({ dir: "fx", force: true });
		const memory = world.memory();
		if (!memory) throw new Error("sealed memory missing");
		world.setMemory({
			...memory,
			export_hashes: memory.parts.flatMap((p) =>
				p.entries.flatMap((e) =>
					e.export_hash ? [{ kind: e.kind, key: e.key, export_hash: e.export_hash }] : [],
				),
			),
		});
		const port = world.context.applyset!;
		port.readsAsPublisher = () => false;
		port.readScopedSnapshot = async () => scopedChest("demo/moved");
		port.livePlaces = () => {
			throw new Error("publisher/gameplay placement forbidden");
		};
		files["/repo/fx/manifest.toml"] = root(
			entity("demo/chest").replace('name = "demo/chest"', 'name = "Changed"'),
		);
		expect((await bound.diff({ dir: "fx" })).conflicts).toEqual(
			expect.arrayContaining([expect.objectContaining({ kind: "entities" })]),
		);
		expect(await bound.apply({ dir: "fx" })).toMatchObject({ ok: false, sent: false });
		expect(world.calls).toHaveLength(1);
		expect(await bound.apply({ dir: "fx", force: true })).toMatchObject({
			ok: true,
			sent: true,
			force_used: ["world_changed"],
		});
	});
	it("refuses a changed scoped row with no comparable baseline even with force", async () => {
		const world = fakeWorld({ exportRows: entityExport("demo/chest", "") });
		const files = { "/repo/fx/manifest.toml": root(entity("demo/chest")) };
		const bound = tools(world.context, files);
		await bound.apply({ dir: "fx", force: true });
		const memory = world.memory();
		if (!memory) throw new Error("sealed memory missing");
		world.setMemory({
			...memory,
			export_hashes: [],
			parts: memory.parts.map((p) => ({
				...p,
				entries: p.entries.map(({ export_hash: _, ...e }) => e),
			})),
		});
		const port = world.context.applyset!;
		port.readsAsPublisher = () => false;
		port.readScopedSnapshot = async () => scopedChest();
		files["/repo/fx/manifest.toml"] = root(
			entity("demo/chest").replace('name = "demo/chest"', 'name = "Changed"'),
		);
		const refused = await bound.apply({ dir: "fx", force: true });
		expect(refused).toMatchObject({ ok: false, sent: false });
		expect(refused.not_checked).toEqual(
			expect.arrayContaining([expect.objectContaining({ reason: "missing_baseline" })]),
		);
		expect(world.calls).toHaveLength(1);
	});
	it("admits a new instance only with complete authorized Bundle absence", async () => {
		const world = fakeWorld();
		const port = world.context.applyset!;
		port.readsAsPublisher = () => false;
		const empty = scopedChest();
		empty.snapshot = {};
		empty.source = { ...empty.source, authorized_bundles: ["demo"] };
		port.readScopedSnapshot = async () => empty;
		const files = { "/repo/fx/manifest.toml": HEADER + 'applyset="demo"\n' + entity("demo/new") };
		const result = await tools(world.context, files).apply({ dir: "fx" });
		expect(result, JSON.stringify(result)).toMatchObject({ ok: true, sent: true });
		expect(world.calls).toHaveLength(1);
	});
	it.each([
		"masked",
		"incomplete",
		"reader_unavailable",
	])("force cannot supply %s scoped comparison coverage", async (status) => {
		const world = fakeWorld({ exportRows: entityExport("demo/chest", "") });
		const files = { "/repo/fx/manifest.toml": root(entity("demo/chest")) };
		const bound = tools(world.context, files);
		await bound.apply({ dir: "fx", force: true });
		const port = world.context.applyset;
		if (!port) throw new Error("missing port");
		port.readsAsPublisher = () => false;
		port.readScopedSnapshot = async () => scopedChest("", status);
		files["/repo/fx/manifest.toml"] = root(
			entity("demo/chest").replace('name = "demo/chest"', 'name = "Changed"'),
		);
		expect(await bound.apply({ dir: "fx", force: true })).toMatchObject({ ok: false, sent: false });
		expect(world.calls).toHaveLength(1);
	});
	it("refuses unobserved prospective instance writes and unsupported definitions without enqueue", async () => {
		const world = fakeWorld({ exportRows: entityExport("demo/chest", "") });
		const files = { "/repo/fx/manifest.toml": root(entity("demo/chest")) };
		const bound = tools(world.context, files);
		await bound.apply({ dir: "fx", force: true });
		const port = world.context.applyset;
		if (!port) throw new Error("missing port");
		port.readsAsPublisher = () => false;
		port.readScopedSnapshot = async () => scopedChest();
		for (const extra of [entity("demo/unobserved"), def("demo/new-definition", "definition")]) {
			files["/repo/fx/manifest.toml"] = root(entity("demo/chest") + extra);
			expect(await bound.apply({ dir: "fx", force: true })).toMatchObject({
				ok: false,
				sent: false,
			});
			expect(world.calls).toHaveLength(1);
		}
	});
	it.each([
		"demo",
		"",
	])("stamps binding-only scoped payload bundle %j without a bundle declaration", async (bundle) => {
		const world = fakeWorld();
		const port = world.context.applyset;
		if (!port) throw new Error("missing applyset port");
		port.readsAsPublisher = () => false;
		port.readScopedSnapshot = async () => scopedChest();
		port.readExtentScope = async () => ({ publisher: false, bundle_extents: ["demo"], memory: [] });
		const execute = bindTool(applysetApplyToolDef, { context: world.context });
		const answer = await execute.execute("binding-only", {
			source: {
				root_path: "manifest.toml",
				root_toml:
					HEADER +
					`applyset="bindings"\n[[role_bindings]]\nbundle_id="${bundle}"\nbinding_id="demo/new"\nrole_id="viewer"\nsubject="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"\nextent_kind_ref="bundle"\nextent_ref="demo"\ndescription="Binding payload proof"\n`,
				fragments: [],
			},
		});
		expect(answer.details).toMatchObject({ ok: true, sent: true });
		expect(world.calls).toHaveLength(1);
		expect(world.calls[0]?.bundleIds).toEqual([bundle]);
	});
});
