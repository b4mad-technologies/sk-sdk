// embedded-manifest: {"category": "exact_text_oracle", "rationale": "manifest-format documentation test requires an exact bundle-name counterexample"}
// embedded-manifest: {"category": "dynamic_authoring_proof", "rationale": "verb-authored manifest directly proves the documented four-call authoring workflow"}
// Doc-contract test suite (#1968 "docs as testable promises"). Offline only
// (workspace/validator layer, no fs, no live node, no model) — the OPERATOR
// RULE for this suite (2026-07-23) is that any test needing genuine WORLD
// state must build it through the verb tools against a LIVE target, never a
// wipe/seed cycle; every promise proven below only needs the workspace
// scratch-manifest + wasm-validator layer, so none of them touch a live node
// at all and the rule does not add a `SPELLKAVE_LOCAL_NODE` gate here.
//
// Each `it` below carries a `DOC-PROMISE: <doc-id>#<heading-slug>` comment —
// a machine-checkable pointer into `packages/spellkave-world-author/docs/**`
// (`<doc-id>` is that doc's corpus id / filename stem; `onramp` = README.md).
// The `doc-promises` skgate registry gate fails the build if an anchor's doc
// or heading no longer exists — bidirectional honesty: a test can't cite a
// promise the docs have since dropped or renamed, so a doc rewrite that silently
// invalidates a proof is caught here, not left to bit-rot.
//
// This suite intentionally does NOT re-derive `authoring-verbs.test.ts`'s
// deep implementation coverage (upsert-by-key semantics, spawn shape
// exclusivity, defaultBundle fallback chains, onFinding routing, ...) —
// those promises are already tested there and are cited by id in this PR's
// report instead of duplicated. What's here targets promises that were
// EITHER new in this PR's own verb-first docs, or previously undocumented-
// as-a-testable-claim in the classic prose docs (manifest-format.md,
// fixture-correctness.md).
// ci-allow(embedded-manifest-schema): manifest-format naming counterexample - deliberately wrong field naming
import { validateManifestToml } from "@spellkave/world-author";
import { describe, expect, it } from "vitest";

import type { AuthorToolContext, AuthorWorkspace } from "../authoring";
import { createAuthorFacingBoundTools } from "../authoring";
import type { QueryListResult, QuerySummaryResult, VerbResult } from "../authoring-verbs";

// ---------------------------------------------------------------------------
// Shared harness — mirrors author-facing-tools.test.ts's own fixtures (the
// PUBLIC entry point, `createAuthorFacingBoundTools`, not a reach into individual
// tool defs — this suite proves what a HOST binding the AUTHOR subset by
// name, exactly as the docs describe, actually gets).
// ---------------------------------------------------------------------------

function fakeWorkspace(initial: string | null = null): AuthorWorkspace & {
	current(): string | null;
} {
	let current = initial;
	return {
		readToml: () => current,
		writeToml: (toml: string) => {
			current = toml;
			return "/scratch/doc-contract-test";
		},
		current: () => current,
	};
}

function contextWith(overrides: Partial<AuthorToolContext> = {}): AuthorToolContext {
	return { workspace: fakeWorkspace(), ...overrides };
}

function toolByName(context: AuthorToolContext, name: string) {
	const tool = createAuthorFacingBoundTools(context).find((t) => t.name === name);
	if (tool === undefined) throw new Error(`missing AUTHOR tool ${name}`);
	return tool;
}

function tableRows(manifest: Record<string, unknown>, table: string): Record<string, unknown>[] {
	return Array.isArray(manifest[table]) ? (manifest[table] as Record<string, unknown>[]) : [];
}

async function inspectManifestOf(workspace: ReturnType<typeof fakeWorkspace>) {
	const { inspectManifest } = await import("@spellkave/world-author");
	const toml = workspace.current();
	if (toml === null) throw new Error("expected a persisted manifest");
	return inspectManifest(toml).manifest as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// getting-started-with-verbs.md
// ---------------------------------------------------------------------------

describe("getting-started-with-verbs.md — the 4-call fireball flow", () => {
	// DOC-PROMISE: getting-started-with-verbs#the-4-call-fireball-flow
	it("the doc's own 4 write calls + apply produce a manifest that validates with ZERO diagnostics", async () => {
		const workspace = fakeWorkspace(null);
		let applied: string | undefined;
		const context = contextWith({
			workspace,
			applyDelta: async (toml: string) => {
				applied = toml;
				return { ok: true };
			},
		});

		// Step 1 — author_place, exactly the doc's own params.
		await toolByName(context, "spellkave_author_place").execute("call-1", {
			bundle: "aoe_blast",
			nodes: [
				{ id: "aoe_blast/center", name: "Arena Center" },
				{ id: "aoe_blast/fringe", name: "Arena Fringe" },
			],
			edges: [],
		});

		// Step 2 — define_resource, exactly the doc's own params.
		await toolByName(context, "spellkave_define_resource").execute("call-2", {
			bundle: "aoe_blast",
			id: "hp",
			display_name: "Hit Points",
			min_value: 0,
			max_value: 30,
			recovery_rule: "long_rest",
			initial_value: 30,
		});

		// Step 3 — place actors, exactly the doc's own params.
		const spawnResult = await toolByName(context, "spellkave_place_actor").execute("call-3", {
			bundle: "aoe_blast",
			kind: "npc",
			placements: [
				{ at: "aoe_blast/center", count: 3 },
				{ at: "aoe_blast/fringe", count: 1 },
			],
		});
		const entityKeys = (spawnResult.details as VerbResult).entity_keys as string[];
		// The doc's own worked example names this literal key — if the placement
		// slug/numbering scheme ever changes, this promise (and the doc's own
		// `grant_to` example) goes red here, not silently in prose.
		expect(entityKeys[0]).toBe("aoe_blast/npc_1");

		// Step 4 — define_behavior, exactly the doc's own params (grant_to is the
		// doc's literal 'aoe_blast/npc_1').
		await toolByName(context, "spellkave_define_behavior").execute("call-4", {
			bundle: "aoe_blast",
			id: "firebloom",
			grant_to: "aoe_blast/npc_1",
			offered_when: { reach: "same_node" },
			action_class: "spell",
			effect: {
				primitive: "ForEachActorInRadius",
				shape: { id: "core/area/node_ball", radius: 0 },
				per_target_gate: "d20 < 13",
				write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d6" },
			},
		});

		const finalToml = workspace.current();
		expect(finalToml, "expected a persisted manifest after the 4 write calls").not.toBeNull();
		expect(validateManifestToml(finalToml as string)).toEqual([]);

		// Cheap equivalent of doctor `node_id_well_formed`: split on the last
		// slash; local_id must not contain '/' (sk-j8e.1).
		const authored = await inspectManifestOf(workspace);
		for (const row of tableRows(authored, "place_nodes")) {
			const nodeId = String(row.node_id);
			const localId = String(row.local_id);
			const slash = nodeId.lastIndexOf("/");
			expect(slash).toBeGreaterThan(0);
			expect(localId).not.toContain("/");
			expect(nodeId.slice(slash + 1)).toBe(localId);
			expect(nodeId).toBe(`${String(row.place_graph_id)}/${localId}`);
		}

		// Step 5 — apply_manifest_delta, exactly the doc's own claim: flushes the
		// finished workspace TOML to the wired port.
		await toolByName(context, "spellkave_apply_manifest_delta").execute("call-5", {
			toml: finalToml as string,
		});
		expect(applied).toBe(finalToml);
	});
});

describe("getting-started-with-verbs.md — smart defaults", () => {
	// DOC-PROMISE: getting-started-with-verbs#smart-defaults
	it("spellkave_author_place's node `name` defaults to a title-cased local id when omitted", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		await toolByName(context, "spellkave_author_place").execute("place", {
			bundle: "onramp_probe",
			nodes: [{ id: "onramp_probe/site/misty_glade" }],
			edges: [],
		});
		const manifest = await inspectManifestOf(workspace);
		const node = tableRows(manifest, "place_nodes").find(
			(r) => r.node_id === "onramp_probe/site/misty_glade",
		);
		expect(node?.display_name).toBe("Misty Glade");
	});
});

describe("tool-reference.md — spellkave_place_actor name_prefix", () => {
	// DOC-PROMISE: tool-reference#spellkave_place_actor
	it("`name_prefix` replaces the title-cased identity half and keeps the ordinal", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		await toolByName(context, "spellkave_author_place").execute("place", {
			bundle: "kavemouth",
			nodes: [{ id: "kavemouth/stonebridge/bridge_mid", name: "Bridge Mid" }],
			edges: [],
		});
		await toolByName(context, "spellkave_place_actor").execute("place-wolves", {
			bundle: "kavemouth",
			kind: "npc",
			at: "kavemouth/stonebridge/bridge_mid",
			count: 3,
			key_prefix: "adventure/encounter/road_wolf",
			name_prefix: "Road Wolf",
		});
		const manifest = await inspectManifestOf(workspace);
		expect(tableRows(manifest, "entities").map((r) => r.name)).toEqual([
			"Road Wolf 1",
			"Road Wolf 2",
			"Road Wolf 3",
		]);
		expect(tableRows(manifest, "actors").map((r) => r.name)).toEqual([
			"Road Wolf 1",
			"Road Wolf 2",
			"Road Wolf 3",
		]);
	});
});

describe("getting-started-with-verbs.md — the target model: stage, then commit", () => {
	// DOC-PROMISE: getting-started-with-verbs#the-target-model-stage-then-commit
	it("every OTHER verb (read-only tools + offline write verbs) works with NO connection at all", async () => {
		// A bare context: workspace only — no db, no target, no applyDelta.
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });

		await toolByName(context, "spellkave_author_place").execute("place", {
			bundle: "onramp_probe",
			nodes: [{ id: "onramp_probe/site/center", name: "Center" }],
			edges: [],
		});

		const query = toolByName(context, "spellkave_query");

		// no `kind` -> summary shape (today's spellkave_manifest_inspect).
		const summaryResult = await query.execute("summary", {});
		const summary = summaryResult.details as QuerySummaryResult;
		expect(summary.shape).toBe("summary");
		expect(summary.source).toBe("workspace");
		expect(summary.row_kinds.place_nodes).toBe(1);

		// `kind`, no `id`/`pattern` -> list shape (today's spellkave_lookup).
		const listResult = await query.execute("list", { kind: "resource_definitions" });
		const list = listResult.details as QueryListResult;
		expect(list.shape).toBe("list");
		expect(list.source).toBe("workspace");
	});
});

describe("getting-started-with-verbs.md — when a verb refuses", () => {
	// DOC-PROMISE: getting-started-with-verbs#when-a-verb-refuses
	it("a validator diagnostic (a dangling ref, MF-VAL-254) surfaces gracefully — never thrown — mapped back to the offending row/param, and persists NOTHING beyond what already validated", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const writeRows = toolByName(context, "spellkave_write_rows");

		// A structurally-complete, independently VALID row first (so there is
		// something real already persisted to prove the failed call below adds
		// nothing on top of it).
		const seeded = await writeRows.execute("seed", {
			bundle: "onramp_probe",
			kind: "entity_definitions",
			rows: [
				{ entity_def_id: "onramp_probe/torch", bundle_id: "onramp_probe", display_name: "Torch" },
			],
		});
		expect((seeded.details as VerbResult).ok, JSON.stringify(seeded.details)).toBe(true);
		const beforeFailedCall = workspace.current();

		// A structurally-complete row whose `capability_id` dangles (references
		// no `capability_definitions` row) — validator-diagnostic territory, not
		// a JS-shape violation.
		const result = await writeRows.execute("write", {
			bundle: "onramp_probe",
			kind: "entity_definition_initial_capability",
			rows: [{ entity_def_id: "onramp_probe/torch", capability_id: "onramp_probe/does_not_exist" }],
		});

		const details = result.details as VerbResult & {
			diagnostics?: Array<{ code: string; param?: string }>;
		};
		expect(details.ok, JSON.stringify(details)).toBe(false);
		const diag = details.diagnostics?.find((d) => d.code === "MF-VAL-254");
		expect(diag, JSON.stringify(details)).toBeDefined();
		// "mapped back to the call" — the diagnostic names the offending row.
		expect(diag?.param).toBe("rows[0].capability_id");
		// Nothing NEW committed: the workspace is byte-identical to right before
		// the failed call — the whole merged manifest is the gate.
		expect(workspace.current()).toBe(beforeFailedCall);
	});
});

// ---------------------------------------------------------------------------
// tool-reference.md
// ---------------------------------------------------------------------------

describe("tool-reference.md — spellkave_query", () => {
	// DOC-PROMISE: tool-reference#spellkave_query
	it("every former spellkave_lookup catalog kind is still a live, callable spellkave_query `kind`", async () => {
		const workspace = fakeWorkspace(null);
		const context = contextWith({ workspace });
		const tool = toolByName(context, "spellkave_query");
		for (const kind of [
			"area_shape_definitions",
			"economy_channel_definitions",
			"entity_definitions",
			"resource_definitions",
		] as const) {
			const result = await tool.execute(`query-${kind}`, { kind });
			const list = result.details as QueryListResult;
			expect(list.shape, kind).toBe("list");
			expect(list.kind, kind).toBe(kind);
		}
	});
});

// ---------------------------------------------------------------------------
// manifest-format.md / fixture-correctness.md — a promise pre-dating the verb
// docs, proven directly against the shared wasm validator (no verb call
// needed — this is an offline TOML-shape promise, not a tool-surface one).
// ---------------------------------------------------------------------------

describe("manifest-format.md / fixture-correctness.md — bundle_id naming", () => {
	// DOC-PROMISE: manifest-format#bundles
	// DOC-PROMISE: fixture-correctness#convention
	it("a non-snake_case bundle_id is flagged MF-VAL-271 (Warning, not Fatal)", () => {
		const toml = `#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"

[[bundles]]
bundle_id = "Bad-Bundle"
author = "test"
display_name = "Bad Bundle"
version = "0.0.1"
`;
		const diags = validateManifestToml(toml);
		const match = diags.find((d) => d.code === "MF-VAL-271");
		expect(match, JSON.stringify(diags)).toBeDefined();
		expect(match?.severity).toBe("warning");
	});
});
