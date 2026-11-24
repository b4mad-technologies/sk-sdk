import { snapshotDbFromFixture } from "@spellkave/sdk";
import { describe, expect, it } from "vitest";
import type { SpellkaveCompanionTool as AgentTool } from "../tools";

import { createSpellkaveTools } from "../tools";

function trace(traceId: bigint, locationRef: string, kind: string, payloadJson: string) {
	return {
		traceId,
		kind,
		locationKind: "place_node",
		locationRef,
		payloadJson,
		inscribedAt: Number(traceId),
		expiresAt: undefined,
		inscribedBy: "1",
		visibility: { tag: "Local" },
		bundleId: "test",
	};
}

function tools(
	traces = [
		trace(1n, "near", "footprint", '{"direction":"north"}'),
		trace(2n, "near", "speech", '{"text":"hello"}'),
		trace(3n, "remote", "secret", '{"text":"unperceived"}'),
	],
) {
	const db = snapshotDbFromFixture({
		visible_entity_tag: [],
		visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "near" }],
		visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
		visible_manifest_authored_entity: [
			{ manifestKey: "test:test/hero", bundleId: "test", entityId: 1n },
		],
		visible_trace: traces,
	});
	return new Map(
		createSpellkaveTools({ db, act: { actorId: "test/hero" } }).map((tool) => [
			tool.name,
			tool as AgentTool,
		]),
	);
}

function requiredTool(registry: Map<string, AgentTool>, name: string): AgentTool {
	const tool = registry.get(name);
	expect(tool).toBeDefined();
	return tool as AgentTool;
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
	return result.content.map((part) => part.text ?? "").join("\n");
}

describe("dual-shape traces tool (#1931 merge)", () => {
	it("latest-one and its cursor preserve numeric order when speech shares a tick", async () => {
		const registry = tools([
			{ ...trace(98n, "near", "speech", '{"text":"old menu"}'), inscribedAt: 0 },
			{ ...trace(108n, "near", "speech", '{"text":"new name prompt"}'), inscribedAt: 0 },
		]);
		const readPage = async (cursor?: string) => {
			const page = await requiredTool(registry, "spellkave_traces").execute("latest-one", {
				limit: 1,
				...(cursor === undefined ? {} : { cursor }),
			});
			const details = page.details as {
				items: { handle: string; rev: string }[];
				next_cursor: string;
			};
			const entry = details.items[0];
			if (entry === undefined) throw new Error("Expected one visible speech entry");
			return { entry, next_cursor: details.next_cursor };
		};
		const first = await readPage();
		const latest = await requiredTool(registry, "spellkave_trace_detail").execute(
			"latest-detail",
			first.entry,
		);
		expect(latest.details).toMatchObject({ trace: { payload: { text: "new name prompt" } } });
		const second = await readPage(first.next_cursor);
		const older = await requiredTool(registry, "spellkave_trace_detail").execute(
			"older-detail",
			second.entry,
		);
		expect(older.details).toMatchObject({ trace: { payload: { text: "old menu" } } });
	});

	it("orients on current perceived traces without raw payload JSON (complete branch)", async () => {
		const result = await requiredTool(tools(), "spellkave_traces").execute("orient", {});
		expect(result.details).toMatchObject({
			current_node_id: "near",
			total_traces: 2,
			by_kind: { footprint: 1, speech: 1 },
			listing: "complete",
		});
		const items = (result.details as { items: unknown[] }).items;
		expect(items).toHaveLength(2);
		expect(text(result)).not.toContain("payload_json");
		expect(text(result)).not.toContain("unperceived");
	});

	it("caps authored kind groups with truthful overflow metadata, in both branches", async () => {
		const registry = new Map(
			createSpellkaveTools({
				db: snapshotDbFromFixture({
					visible_entity_tag: [],
					visible_entity_tag_coverage: [{ status: "complete", projectionVersion: 1 }],
					visible_actor_spatial_location: [{ entityId: 1n, placeNodeId: "near" }],
					visible_manifest_authored_entity_coverage: [{ status: "complete", projectionVersion: 1 }],
					visible_manifest_authored_entity: [],
					visible_trace: Array.from({ length: 14 }, (_, index) =>
						trace(BigInt(index + 1), "near", `kind-${String(index).padStart(2, "0")}`, "{}"),
					),
				}),
				act: { actorId: "1" },
			}).map((tool) => [tool.name, tool as AgentTool]),
		);
		const complete = await requiredTool(registry, "spellkave_traces").execute("many", {});
		expect(complete.details).toMatchObject({
			listing: "complete",
			kind_groups_total: 14,
			kind_groups_shown: 12,
			kind_groups_truncated: true,
		});
		expect(Object.keys((complete.details as { by_kind: object }).by_kind)).toHaveLength(12);

		// Filtering forces the paginated branch; by_kind stays GLOBAL (computed over
		// ALL perceived traces, not the matched subset) — the #1931 dual-shape note's
		// adjudicated "what else is here" invariant.
		const paginated = await requiredTool(registry, "spellkave_traces").execute("many-filtered", {
			kind: "kind-00",
		});
		expect(paginated.details).toMatchObject({
			listing: "paginated",
			matched: 1,
			kind_groups_total: 14,
			kind_groups_shown: 12,
			kind_groups_truncated: true,
		});
	});

	it("filters and pages compact entries without payload content (paginated branch)", async () => {
		const first = await requiredTool(tools(), "spellkave_traces").execute("entries", {
			limit: 1,
		});
		expect(first.details).toMatchObject({
			listing: "paginated",
			shown: 1,
			matched: 2,
			truncated: true,
		});
		expect(text(first)).not.toContain("direction");
		const cursor = (first.details as { next_cursor: string }).next_cursor;
		const second = await requiredTool(tools(), "spellkave_traces").execute("entries-2", {
			limit: 1,
			cursor,
		});
		expect(second.details).toMatchObject({
			listing: "paginated",
			shown: 1,
			truncated: false,
			next_cursor: null,
		});
		const filtered = await requiredTool(tools(), "spellkave_traces").execute("speech", {
			kind_prefix: "spe",
		});
		expect(filtered.details).toMatchObject({
			listing: "paginated",
			matched: 1,
			items: [{ kind: "speech" }],
		});
	});

	// sk-0m4.97: bounded pages must surface what just happened, not tick-1 history.
	it("lists perceived traces most-recent-first (complete and paginated)", async () => {
		const complete = await requiredTool(tools(), "spellkave_traces").execute("order", {});
		const completeItems = (
			complete.details as { items: Array<{ kind: string; inscribed_at: number }> }
		).items;
		expect(completeItems.map((item) => item.kind)).toEqual(["speech", "footprint"]);
		expect(completeItems.map((item) => item.inscribed_at)).toEqual([2, 1]);

		const page = await requiredTool(tools(), "spellkave_traces").execute("order-page", {
			limit: 1,
		});
		expect(page.details).toMatchObject({
			listing: "paginated",
			items: [{ kind: "speech", inscribed_at: 2 }],
		});
	});

	it("returns parsed detail and omits the raw JSON carrier", async () => {
		const summary = await requiredTool(tools(), "spellkave_traces").execute("orient", {});
		const { items } = summary.details as { items: { kind: string; handle: string; rev: string }[] };
		// biome-ignore lint/style/noNonNullAssertion: fixture guarantees a "speech" trace
		const speech = items.find((item) => item.kind === "speech")!;
		const detail = await requiredTool(tools(), "spellkave_trace_detail").execute("detail", {
			rev: speech.rev,
			handle: speech.handle,
		});
		expect(detail.details).toMatchObject({
			status: "ok",
			trace: { kind: "speech", payload: { text: "hello" } },
		});
		expect(text(detail)).not.toContain("payload_json");
	});

	it("rejects stale and cross-domain handles", async () => {
		const summary = await requiredTool(tools(), "spellkave_traces").execute("orient", {});
		const { items } = summary.details as { items: { handle: string; rev: string }[] };
		// biome-ignore lint/style/noNonNullAssertion: fixture guarantees at least one trace
		const first = items[0]!;
		// T12: a REAL handle with a WRONG (caller-stale-copied) rev — the
		// genuine per-target staleness case, not a made-up unknown identity.
		expect(
			(
				await requiredTool(tools(), "spellkave_trace_detail").execute("stale", {
					rev: "old",
					handle: first.handle,
				})
			).details,
		).toMatchObject({
			status: "stale_handle",
			// #1932: guidance names the merged tool to re-read for a fresh handle.
			reason: expect.stringContaining("spellkave_traces"),
		});
		expect(
			(
				await requiredTool(tools(), "spellkave_trace_detail").execute("cross", {
					rev: first.rev,
					handle: "i:0",
				})
			).details,
		).toMatchObject({
			status: "cross_domain",
			reason: expect.stringContaining("spellkave_traces"),
		});
	});

	// #1932 (audit row 47): a filter matching nothing now says what kinds/
	// visibilities ARE present, instead of a silent shown:0.
	it("names the kinds/visibilities actually present when a filter matches nothing", async () => {
		const result = await requiredTool(tools(), "spellkave_traces").execute("kind-miss", {
			kind: "nonexistent",
		});
		expect(result.details).toMatchObject({
			listing: "paginated",
			matched: 0,
			values_present: { kind: ["footprint", "speech"], visibility: ["Local"] },
			reason: expect.stringContaining("No traces matched"),
		});
	});
});
