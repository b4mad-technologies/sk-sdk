// embedded-manifest: {"category": "exact_text_oracle", "rationale": "minimal scratch TOML directly exercises author-facing dispatch and target selection"}
// embedded-manifest: {"category": "schema_object_oracle", "rationale": "schema-shaped objects directly exercise author-facing render and apply boundaries"}
// Offline regression for the AUTHOR-facing tool subset (unified-authoring spike
// D4/Q6, #1968 phase 5). Mirrors the PLAYER subset's tests (`tool-membership-baseline`,
// `authoring.test.ts`): constructed tool-set assertions plus behavior tests driven
// against a fake in-memory workspace — no fs, no live node, no model.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	APPLY_MANIFEST_DELTA_TOOL,
	APPLYSET_APPLY_TOOL,
	APPLYSET_DIFF_TOOL,
	AUTHOR_FACING_TOOL_NAMES,
	AUTHOR_OFFLINE_TOOL_NAMES,
	type AuthorFinding,
	type AuthorToolContext,
	type AuthorWorkspace,
	createAuthorFacingBoundTools as createPortableAuthorFacingBoundTools,
	DECLARE_INEXPRESSIBLE_TOOL,
	DIFF_MANIFEST_TOOL,
	DOCS_TOOL,
	EXPORT_MANIFEST_TOOL,
	NOTE_DOC_GAP_TOOL,
	QUERY_TOOL,
} from "@spellkave/tool-authoring";
import { nodeToolCapability } from "@spellkave/tool-node";
import { getAuthoringExample } from "@spellkave/world-author";
import { describe, expect, it, vi } from "vitest";

type AuthorTestTool = Omit<
	ReturnType<typeof createPortableAuthorFacingBoundTools>[number],
	"execute"
> & {
	// biome-ignore lint/suspicious/noExplicitAny: legacy regression assertions inspect heterogeneous tool details from the pre-cut host surface.
	execute(toolCallId: string, params: unknown): Promise<{ details: any; content?: unknown[] }>;
};

function createAuthorFacingBoundTools(context: AuthorToolContext): AuthorTestTool[] {
	return createPortableAuthorFacingBoundTools(context, {
		node: nodeToolCapability,
	}) as unknown as AuthorTestTool[];
}

/** A minimal, independently-validated (0 diagnostics) manifest, shared across tests. */
const VALID_TOML = getAuthoringExample("spatial-minimal-cell")?.toml ?? "";

function fakeWorkspace(initial: string | null = null): AuthorWorkspace & {
	written: string[];
	current(): string | null;
} {
	let current = initial;
	const written: string[] = [];
	return {
		readToml: () => current,
		writeToml: (toml: string) => {
			current = toml;
			written.push(toml);
			return "/scratch/explorer_scratch";
		},
		written,
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

describe("AUTHOR-facing subset membership (ADR-0074: exported, never curated)", () => {
	it("the offline subset excludes tools requiring a live or local destination", () => {
		const connected = [
			"spellkave_stage_scene",
			"spellkave_remove_entity",
			APPLY_MANIFEST_DELTA_TOOL,
			EXPORT_MANIFEST_TOOL,
			APPLYSET_DIFF_TOOL,
			APPLYSET_APPLY_TOOL,
			"spellkave_can_i",
			"spellkave_get",
			"spellkave_describe",
			"spellkave_revoke_role",
			"spellkave_list_grants",
			"spellkave_export_grants",
			"spellkave_prepare_hand_over",
			"spellkave_hand_over_role",
		];
		expect(AUTHOR_OFFLINE_TOOL_NAMES).toEqual(
			AUTHOR_FACING_TOOL_NAMES.filter((name) => !connected.includes(name)),
		);
		for (const name of connected) expect(AUTHOR_OFFLINE_TOOL_NAMES).not.toContain(name);
		expect(AUTHOR_OFFLINE_TOOL_NAMES).toHaveLength(
			AUTHOR_FACING_TOOL_NAMES.length - connected.length,
		);
	});

	it("createAuthorFacingBoundTools binds every registry name to the one context, in order", () => {
		const tools = createAuthorFacingBoundTools(contextWith());
		expect(tools.map((t) => t.name)).toEqual(AUTHOR_FACING_TOOL_NAMES);
		for (const tool of tools) expect(typeof tool.execute).toBe("function");
	});
});

describe("spellkave_docs — dual-shape doc orientation, bound through the AUTHOR context (#1968, precedent #1931)", () => {
	it("without a query, returns the bounded index (shape: 'index')", async () => {
		const tool = toolByName(contextWith(), DOCS_TOOL);

		const result = await tool.execute("id", {});

		expect((result.details as { shape: string }).shape).toBe("index");
		const index = (result.details as { index: Array<{ rel: string; title: string }> }).index;
		expect(index.length).toBeGreaterThan(0);
		expect(index.every((e) => e.title.length > 0)).toBe(true);
	});

	it("with a query, returns ranked slices carrying full doc prose (shape: 'hits')", async () => {
		const tool = toolByName(contextWith(), DOCS_TOOL);

		const result = await tool.execute("id", { query: "manifest format schema version" });

		expect((result.details as { shape: string }).shape).toBe("hits");
		const hits = (result.details as { hits: Array<{ rel: string; body: string }> }).hits;
		expect(hits.length).toBeGreaterThan(0);
		expect(hits[0]?.body.length ?? 0).toBeGreaterThan(500);
	});
});

describe("spellkave_query — merges spellkave_manifest_inspect + spellkave_lookup (#1968)", () => {
	it("no `kind` on an empty workspace returns an honest empty summary — never throws (deliberate improvement over the retired spellkave_manifest_inspect, which threw on an empty workspace; spellkave_query also serves pre-authoring target-only exploration, e.g. 'what already exists on live', where the workspace is legitimately empty)", async () => {
		const tool = toolByName(contextWith({ workspace: fakeWorkspace(null) }), QUERY_TOOL);

		const result = await tool.execute("id", {});

		expect(result.details).toMatchObject({
			shape: "summary",
			source: "workspace",
			bundle_ids: [],
			row_kinds: {},
		});
	});

	it("no `kind` summarizes the current scratch bundle's rows (today's spellkave_manifest_inspect)", async () => {
		const tool = toolByName(contextWith({ workspace: fakeWorkspace(VALID_TOML) }), QUERY_TOOL);

		const result = await tool.execute("id", {});

		const summary = result.details as {
			shape: string;
			bundle_ids: string[];
			row_kinds: Record<string, number>;
		};
		expect(summary.shape).toBe("summary");
		expect(summary.bundle_ids).toContain("example_spatial_cell");
		expect(summary.row_kinds.place_nodes).toBe(2);
	});

	it("`kind`, no `id`/`pattern` lists the full catalog for that kind (today's spellkave_lookup)", async () => {
		const tool = toolByName(contextWith({ workspace: fakeWorkspace(VALID_TOML) }), QUERY_TOOL);

		const result = await tool.execute("id", { kind: "place_nodes" });

		const list = result.details as { shape: string; kind: string; items: Array<{ id: string }> };
		expect(list.shape).toBe("list");
		expect(list.kind).toBe("place_nodes");
		expect(list.items.length).toBeGreaterThan(0);
	});

	it("`kind` + `id` returns the complete authored row plus refs by default (the NEW definition-lookup capability, #1968)", async () => {
		const tool = toolByName(contextWith({ workspace: fakeWorkspace(VALID_TOML) }), QUERY_TOOL);
		const listResult = await tool.execute("list", { kind: "place_nodes" });
		const firstId = (listResult.details as { items: Array<{ id: string }> }).items[0]?.id;
		expect(firstId).toBeDefined();

		const detailResult = await tool.execute("detail", {
			kind: "place_nodes",
			id: firstId as string,
		});

		const detail = detailResult.details as {
			shape: string;
			found: boolean;
			source: string;
			row: Record<string, unknown>;
			outbound_refs?: unknown[];
			inbound_refs?: unknown[];
		};
		expect(detail.shape).toBe("detail");
		expect(detail.found).toBe(true);
		expect(detail.source).toBe("workspace");
		expect(detail.row.node_id).toBe(firstId);
		expect(detail.outbound_refs).toBeDefined();
		expect(detail.inbound_refs).toBeDefined();
	});

	it("`kind` + `id` for an id that does not exist reports found: false, not a throw", async () => {
		const tool = toolByName(contextWith({ workspace: fakeWorkspace(VALID_TOML) }), QUERY_TOOL);

		const result = await tool.execute("id", { kind: "place_nodes", id: "does/not/exist" });

		expect(result.details).toEqual({
			shape: "detail",
			kind: "place_nodes",
			id: "does/not/exist",
			found: false,
		});
	});

	it("`id` and `pattern` together throw, naming the offending params", async () => {
		const tool = toolByName(contextWith({ workspace: fakeWorkspace(VALID_TOML) }), QUERY_TOOL);

		await expect(
			tool.execute("id", { kind: "place_nodes", id: "a", pattern: "b" }),
		).rejects.toThrow(/mutually exclusive/);
	});
});

describe("findings routing — callback, not shared mutable state", () => {
	it("spellkave_declare_inexpressible routes an inexpressible finding", async () => {
		const findings: AuthorFinding[] = [];
		const tool = toolByName(
			contextWith({ onFinding: (f) => findings.push(f) }),
			DECLARE_INEXPRESSIBLE_TOOL,
		);

		await tool.execute("id", { reason: "no DSL primitive expresses continuous regen decay" });

		expect(findings).toEqual([
			{ kind: "inexpressible", reason: "no DSL primitive expresses continuous regen decay" },
		]);
	});

	it("spellkave_note_doc_gap routes a doc-gap finding and never throws without onFinding wired", async () => {
		const tool = toolByName(contextWith({ onFinding: undefined }), NOTE_DOC_GAP_TOOL);

		const result = await tool.execute("id", {
			doc: "dsl-grammar",
			expected: "a `decay` DSL verb",
			actual: "validator rejected the field as unknown",
		});

		expect(result.details).toMatchObject({ doc: "dsl-grammar" });
	});
});

describe("spellkave_apply_manifest_delta — the ONE connection-gated AUTHOR tool", () => {
	it("throws a clear not-connected error when no live port is wired (offline authoring)", async () => {
		const tool = toolByName(contextWith({ applyDelta: undefined }), APPLY_MANIFEST_DELTA_TOOL);

		await expect(tool.execute("id", { toml: "..." })).rejects.toThrow(/not connected/);
	});

	it("dispatches an explicit toml through the port when connected", async () => {
		const applyDelta = vi.fn(async () => ({ ok: true }));
		const tool = toolByName(contextWith({ applyDelta }), APPLY_MANIFEST_DELTA_TOOL);

		const result = await tool.execute("id", { toml: "delta toml" });

		expect(applyDelta).toHaveBeenCalledWith("delta toml");
		expect(result.details).toEqual({ ok: true, source: "toml", waited: "seal_or_outcome" });
	});

	it("commits workspace scratch when toml is omitted", async () => {
		const applyDelta = vi.fn(async () => ({ ok: true }));
		const scratch = 'schema_version = "1.0.0"\n[[bundles]]\nbundle_id = "demo"\n';
		const tool = toolByName(
			contextWith({ applyDelta, workspace: fakeWorkspace(scratch) }),
			APPLY_MANIFEST_DELTA_TOOL,
		);

		const result = await tool.execute("id", {});

		expect(applyDelta).toHaveBeenCalledWith(scratch);
		expect(result.details).toEqual({ ok: true, source: "scratch", waited: "seal_or_outcome" });
	});

	it("throws when scratch is empty and toml is omitted", async () => {
		const applyDelta = vi.fn(async () => ({ ok: true }));
		const tool = toolByName(
			contextWith({ applyDelta, workspace: fakeWorkspace(null) }),
			APPLY_MANIFEST_DELTA_TOOL,
		);

		await expect(tool.execute("id", {})).rejects.toThrow(/scratch is empty/);
		expect(applyDelta).not.toHaveBeenCalled();
	});
});

describe("spellkave_export — live snapshot + optional hero filter", () => {
	it("throws when the live export port is not wired", async () => {
		const tool = toolByName(contextWith(), EXPORT_MANIFEST_TOOL);
		await expect(tool.execute("id", { bundle: "elven_mini", out: "/tmp/x.toml" })).rejects.toThrow(
			/not connected/,
		);
	});

	it("returns ok:false when --actor is unknown", async () => {
		const exportManifest = vi.fn(async () => ({
			bundleId: "elven_mini",
			status: "complete",
			rowCount: 2,
			diagnostics: "coverage_gap_row_kinds=60",
			manifestJson: JSON.stringify({
				schema_version: "1.0.0",
				bundles: [{ bundle_id: "elven_mini" }],
				entities: [{ entity_key: "elven_mini/adventure/hero_1", bundle_id: "elven_mini" }],
				actors: [{ entity_key: "elven_mini/adventure/hero_1" }],
			}),
		}));
		const tool = toolByName(contextWith({ exportManifest }), EXPORT_MANIFEST_TOOL);
		const result = await tool.execute("id", {
			bundle: "elven_mini",
			actor: "nobody",
			out: "/tmp/nobody.toml",
		});
		expect(result.details).toMatchObject({ ok: false, kind: "manifest_export" });
		expect(String((result.details as { error?: string }).error)).toMatch(/nobody/);
	});
});

describe("spellkave_diff — offline semantic compare", () => {
	it("is in the offline subset and reports onlyLeft/onlyRight/changed", async () => {
		expect(AUTHOR_OFFLINE_TOOL_NAMES).toContain(DIFF_MANIFEST_TOOL);
		const dir = mkdtempSync(join(tmpdir(), "sk-diff-"));
		const left = join(dir, "left.toml");
		const right = join(dir, "right.toml");
		writeFileSync(
			left,
			[
				'schema_version = "1.0.0"',
				"[[entities]]",
				'entity_key = "hero"',
				'name = "Renn"',
				"[[entities]]",
				'entity_key = "sword"',
				'name = "Longsword"',
			].join("\n"),
		);
		writeFileSync(
			right,
			[
				'schema_version = "1.0.0"',
				"[[entities]]",
				'entity_key = "hero"',
				'name = "Created"',
				"[[entities]]",
				'entity_key = "torch"',
				'name = "Torch"',
			].join("\n"),
		);
		try {
			const tool = toolByName(contextWith(), DIFF_MANIFEST_TOOL);
			const result = await tool.execute("id", { left, right });
			expect(result.details).toMatchObject({
				ok: true,
				kind: "manifest_diff",
				only_left: 1,
				only_right: 1,
				changed: 1,
			});
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("throws when a path cannot be read", async () => {
		const tool = toolByName(contextWith(), DIFF_MANIFEST_TOOL);
		await expect(
			tool.execute("id", { left: "/no/such/left.toml", right: "/no/such/right.toml" }),
		).rejects.toThrow(/cannot read left/);
	});
});
