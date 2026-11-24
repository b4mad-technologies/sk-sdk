// The DISCOVERY-CLOSURE funnel walk, session-owned copy. `createLiveAuthorTarget` (the live
// `spellkave_query` target) lives in this package, and srd-cc depends on session (not the reverse), so
// the live walk needs a home here. The srd-cc original
// (`packages/spellkave-srd-cc/src/test/shared/discovery-closure.ts`) stays for the offline tier
// until the deletion phase; the walk and its grounded ref exceptions are the same content-agnostic
// funnel (summary -> list -> detail -> outbound refs -> schema vocabulary). Full walk, no sampling.
import { expect } from "vitest";

// ---------------------------------------------------------------------------
// `spellkave_query` result shapes — LOCAL interfaces mirroring the tool's
// runtime output (the SAME convention `fixtures-author-tool/harness.ts` uses:
// these types aren't part of `@spellkave/tool-player`'s public surface,
// see that file's own `QuerySummaryResult`/`QueryListResult`/
// `QueryDetailResult` interfaces), not re-declared as a dependency on the
// tool's internal `authoring-verbs.ts` types.
// ---------------------------------------------------------------------------

export interface DiscoverySummaryResult {
	shape: "summary";
	source: string;
	bundle_ids: string[];
	row_kinds: Record<string, number>;
}

export interface DiscoveryListItem {
	id: string;
	bundle_id?: string;
}

export interface DiscoveryListResult {
	shape: "list";
	kind: string;
	source: string;
	items: DiscoveryListItem[];
}

export interface DiscoveryOutboundRef {
	field: string;
	value: string;
}

export interface DiscoveryDetailResult {
	shape: "detail";
	kind: string;
	id: string;
	found: boolean;
	source?: string;
	row?: Record<string, unknown>;
	outbound_refs?: DiscoveryOutboundRef[];
}

export interface DiscoverySchemaIndexResult {
	shape: "schema";
	kinds: {
		kind: string;
		queryable: boolean;
		natural_key?: string;
		composite_key?: string[];
	}[];
}

export type DiscoveryQueryResult =
	| DiscoverySummaryResult
	| DiscoveryListResult
	| DiscoveryDetailResult
	| DiscoverySchemaIndexResult;

/** The abstract executor the shared walk drives — bound to `spellkave_query`
 * against a local `fixtures/` target (offline) or a live seeded node (live-
 * preseeded); see each tier's own test file for how it wires this. */
export type DiscoveryQueryExecutor = (
	params: Record<string, unknown>,
) => Promise<DiscoveryQueryResult>;

// ---------------------------------------------------------------------------
// DISCOVERY_CLOSURE_REF_EXCEPTIONS — the named, GROUNDED exceptions to
// "every outbound ref resolves to found:true when re-queried". An ungrounded
// unresolved ref is a real finding (recorded to `ledger/findings.md`), not
// silently added here.
// ---------------------------------------------------------------------------

export interface DiscoveryRefContext {
	fromKind: string;
	fromId: string;
	field: string;
	value: string;
}

export interface DiscoveryRefException {
	name: string;
	/** One-line grounding: WHY this shape is a legitimate never-a-row
	 * reference, pinned to a file/doc, never asserted from memory. */
	grounding: string;
	matches: (ref: DiscoveryRefContext) => boolean;
}

export const DISCOVERY_CLOSURE_REF_EXCEPTIONS: DiscoveryRefException[] = [
	{
		name: "unset optional *_id field (empty-string schema-default sentinel)",
		grounding:
			"packages/spellkave-world-author/docs/tool-reference.md documents this convention verbatim " +
			"for multiple *_id-shaped optional fields (e.g. action_definitions.session_def_id/on_failure/ " +
			"resolution_predicate_source: 'Omit for none (schema default: empty string)') — an unauthored optional " +
			"*_id column round-trips as the empty string, never as a real row's natural key (every " +
			"observed natural key across this bundle's fixtures is a non-empty slug/path), so an empty " +
			"value is the field's own absence-sentinel, not a dangling pointer.",
		matches: (ref) => ref.value === "",
	},
	{
		name: "capability:<capability_id> synthetic niche",
		grounding:
			"packages/spellkave-tool-authoring/src/authoring-verbs.ts's spellkave_define_action_verb doc " +
			"block (~lines 6169-6210) names the `capability:<capability_id>` synthetic-niche convention " +
			"(dozens of uses across world-fixtures/phandelver/**) as a niche_id shape with deliberately NO " +
			"niche_definitions row to check against — the same doc block states existence-checking niche_id " +
			"there would false-reject this convention's own grounding call sites.",
		matches: (ref) => ref.field === "niche_id" && ref.value.startsWith("capability:"),
	},
	{
		name: "bare tag / entity_def_id-derived target niche",
		grounding: "Definition IDs and tags can serve as target niche identifiers.",
		matches: (ref) => ref.field === "niche_id",
	},
	{
		name: "place_nodes.local_id composite-PK fragment (own-row id, not a ref)",
		grounding: "A place node’s local ID is part of its own key.",
		matches: (ref) => ref.fromKind === "place_nodes" && ref.field === "local_id",
	},
	{
		name: "outcome graph node key (graph-local node_id / root_node_id, not a row reference)",
		grounding: "Outcome graph node IDs are local to the graph.",
		matches: (ref) =>
			(ref.fromKind === "outcome_graph_nodes" && ref.field === "node_id") ||
			(ref.fromKind === "outcome_graphs" && ref.field === "root_node_id"),
	},
	{
		name: "roll_table_entries.result_ref for an int-result_kind table (literal payload, not a row reference)",
		grounding: "For an integer result table, the result reference is an integer literal.",
		matches: (ref) =>
			ref.fromKind === "roll_table_entries" &&
			ref.field === "result_ref" &&
			/^\d+$/.test(ref.value),
	},
	{
		name: "bare capability_id with no capability_definitions row (walk-edge convention)",
		grounding:
			"world-fixtures' own base bundle ships `<walk-capability>` as a plain string referenced by " +
			"`actor_capabilities`/`affordance_templates.capability_id`/predicate text ONLY, with NO matching " +
			"capability_definitions row anywhere (grepped directly) — crates/spellkave-validate/src/refs.rs's " +
			"MF-VAL-266 checks capability_definitions.capability_id for DUPLICATES only, never existence of a " +
			"referencing capability_id. `grid-units.ts`'s own module header names this precedent and follows " +
			"the same bare-id shape for `srd/capability/walk`.",
		matches: (ref) => ref.field === "capability_id" && ref.value === "srd/capability/walk",
	},
	{
		name: "combat_grid_blueprints.distance_metric_id naming a core-seeded metric (module vocabulary, no manifest row)",
		grounding:
			"ADR-0134 D-1: the three `core/metric/*` distance_metric_definitions rows are seeded by the " +
			"module itself (the built-in distance metric IDs, mirrored as " +
			"`spellkave_schema::CORE_DISTANCE_METRIC_IDS`), the way `extent_kind_definitions` core seeds " +
			"ship — crates/spellkave-validate/src/action_economy.rs's MF-VAL-332 resolves a blueprint's " +
			"distance_metric_id against those seeds plus any manifest rows, so `srd/combat-grid/" +
			"standard-10x10` (ADR-0134 D-5, `core/metric/chebyshev`) legitimately names an id this " +
			"bundle's fixtures never declare. Narrowed to the three seeded ids: an authored metric id " +
			"with no [[distance_metric_definitions]] row still fails the walk.",
		matches: (ref) =>
			ref.fromKind === "combat_grid_blueprints" &&
			ref.field === "distance_metric_id" &&
			["core/metric/euclidean", "core/metric/chebyshev", "core/metric/manhattan"].includes(
				ref.value,
			),
	},
];

export interface DiscoveryClosureReport {
	bundleIds: string[];
	kindCounts: Record<string, number>;
	totalRowsWalked: number;
	totalOutboundRefs: number;
	exceptedRefCounts: { name: string; count: number }[];
	elapsedMs: number;
}

/**
 * Run the content-agnostic discovery funnel walk against `query`, asserting
 * every structural invariant inline (vitest `expect`, so a failure names
 * exactly which funnel step/kind/id/ref broke). Returns a small report for
 * the caller to log (row/ref counts, elapsed time) — never itself a
 * content-specific assertion surface.
 *
 * `expectBundle`: the bundle_id the caller expects present in the summary
 * (e.g. `BUNDLE_ID` from `chapters/playing-the-game/index.ts`) — asserted
 * with `toContain`, never `toEqual`, so a source that legitimately carries
 * MORE bundles (the live-preseeded node's `core` + `srd`) still passes.
 */
export async function runDiscoveryClosureWalk(
	query: DiscoveryQueryExecutor,
	options: { expectBundle: string },
): Promise<DiscoveryClosureReport> {
	const startedAt = Date.now();

	// (a) No-args summary: non-empty bundles incl. the expected one, non-empty
	// kind -> count map.
	const summary = (await query({})) as DiscoverySummaryResult;
	expect(summary.shape, "no-args spellkave_query call must return the summary shape").toBe(
		"summary",
	);
	expect(summary.bundle_ids.length, "summary.bundle_ids must be non-empty").toBeGreaterThan(0);
	expect(
		summary.bundle_ids,
		`summary.bundle_ids must include '${options.expectBundle}' (additional bundles are tolerated, ` +
			"never asserted exclusive)",
	).toContain(options.expectBundle);
	const kinds = Object.keys(summary.row_kinds);
	expect(kinds.length, "summary.row_kinds must be non-empty").toBeGreaterThan(0);

	// (b) + (c) + (d), interleaved per kind: list every kind (id-count must
	// match the summary), then detail EVERY listed id (found:true, non-empty
	// row) and chase EVERY outbound ref for closure — full walk, no sampling.
	const idsToKinds = new Map<string, string[]>();
	const rowsByKind = new Map<string, string[]>();

	for (const kind of kinds) {
		const list = (await query({ kind })) as DiscoveryListResult;
		expect(list.shape, `kind='${kind}' list call must return the list shape`).toBe("list");
		expect(
			list.items.length,
			`kind='${kind}' list id-count must match summary.row_kinds['${kind}']`,
		).toBe(summary.row_kinds[kind]);
		const ids = list.items.map((item) => item.id);
		rowsByKind.set(kind, ids);
		for (const id of ids) {
			const owners = idsToKinds.get(id) ?? [];
			owners.push(kind);
			idsToKinds.set(id, owners);
		}
	}

	let totalRowsWalked = 0;
	let totalOutboundRefs = 0;
	const exceptedCounts = new Map<string, number>();

	for (const [kind, ids] of rowsByKind) {
		for (const id of ids) {
			totalRowsWalked += 1;
			const detail = (await query({ kind, id, refs: "outbound" })) as DiscoveryDetailResult;
			expect(detail.shape, `detail(kind='${kind}', id='${id}') must return the detail shape`).toBe(
				"detail",
			);
			expect(
				detail.found,
				`detail(kind='${kind}', id='${id}') must resolve found:true for an id the list call just returned`,
			).toBe(true);
			expect(detail.row, `detail(kind='${kind}', id='${id}') must carry a row`).toBeDefined();
			expect(
				Object.keys(detail.row ?? {}).length,
				`detail(kind='${kind}', id='${id}') row must be non-empty`,
			).toBeGreaterThan(0);

			for (const ref of detail.outbound_refs ?? []) {
				totalOutboundRefs += 1;
				const ownerKinds = idsToKinds.get(ref.value);
				if (ownerKinds !== undefined) {
					// REF CLOSURE: chase the ref by RE-QUERYING spellkave_query with
					// its own {kind, id} — the tool's own documented "chase a
					// reference" idiom — and require it resolves.
					for (const targetKind of ownerKinds) {
						const rechased = (await query({
							kind: targetKind,
							id: ref.value,
							refs: "none",
						})) as DiscoveryDetailResult;
						expect(
							rechased.found,
							`ref closure: ${kind}/${id}'s outbound ref ${ref.field}='${ref.value}' must resolve ` +
								`via re-query {kind: '${targetKind}', id: '${ref.value}'}`,
						).toBe(true);
					}
					continue;
				}
				const exception = DISCOVERY_CLOSURE_REF_EXCEPTIONS.find((entry) =>
					entry.matches({ fromKind: kind, fromId: id, field: ref.field, value: ref.value }),
				);
				expect(
					exception,
					`ref closure gap: ${kind}/${id}'s outbound ref ${ref.field}='${ref.value}' does not resolve ` +
						"to any known row and matches no grounded DISCOVERY_CLOSURE_REF_EXCEPTIONS entry — a " +
						"genuine query-tool/content finding, not a silent exception.",
				).toBeDefined();
				if (exception !== undefined) {
					exceptedCounts.set(exception.name, (exceptedCounts.get(exception.name) ?? 0) + 1);
				}
			}
		}
	}

	// (e) schema:true (no kind): the row-kind vocabulary must name every kind
	// the summary reported (schema is a documented SUPERSET, ~78 kinds vs the
	// ~52 addressable ones — this direction only, never the reverse).
	const schema = (await query({ schema: true })) as DiscoverySchemaIndexResult;
	expect(schema.shape, "schema:true (no kind) call must return the schema shape").toBe("schema");
	const schemaKindNames = new Set(schema.kinds.map((entry) => entry.kind));
	for (const kind of kinds) {
		expect(
			schemaKindNames.has(kind),
			`schema:true's row-kind vocabulary must include summary kind '${kind}'`,
		).toBe(true);
	}

	return {
		bundleIds: summary.bundle_ids,
		kindCounts: { ...summary.row_kinds },
		totalRowsWalked,
		totalOutboundRefs,
		exceptedRefCounts: [...exceptedCounts.entries()].map(([name, count]) => ({ name, count })),
		elapsedMs: Date.now() - startedAt,
	};
}
