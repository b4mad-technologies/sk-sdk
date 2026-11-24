// The TOON presentation of an `sk explore` answer (AXI §1, §2, §5, §6, §9).
//
// The engine and the contract keep JSON; `sk --format jsonl` and `sk query --json` print it
// unchanged. This module only reshapes that record into what an agent (or a person) reads best:
//
//   - rows become one uniform table (kind, key, label, context [, bundle, relationship, fields]);
//   - total and `more` are short `key: value` lines; so are the source, source id, completeness
//     and coverage; completeness is always explicit, while default-source metadata is compact
//     (every printed next command carries the source and its id);
//   - `next[]` holds complete commands that run as printed, `help[]` holds templates with
//     placeholders (never runnable as printed). Each is a one-column table, one command per
//     line: TOON writes an array of plain strings inline, comma-joined, which is not a place
//     to copy a command from;
//   - an unavailable answer is one `error:` block with reason, error_class, cause and hint;
//   - an empty, complete answer says so in one line (AXI §5).
//
// The result is a plain JSON-compatible object. Turning it into text is the generic
// `stringifyToon` of `output.ts`, which knows nothing about exploration.

import { EXPLORATION_BYTE_LIMIT } from "@spellkave/tool-authoring";

type Ref = { kind: string; id: string; bundle?: string };
type Item = {
	ref: Ref;
	label?: string;
	description?: string;
	fields?: Record<string, unknown>;
	context?: Ref[];
	via?: Ref;
	relationship?: { kind: string; key?: string; direction: string };
	relationships?: Array<{ kind: string; key?: string; direction: string }>;
	truncated?: { field: string; shown_code_points: number; total_code_points: number }[];
};
type Coverage = { state: string; reason?: string; families?: string[] };
type Answer = {
	ok?: boolean;
	operation?: string;
	source?: {
		source?: string;
		source_id?: string;
		world?: string;
		coverage?: "complete" | Coverage[];
	};
	completeness?: string;
	items?: Item[];
	page?: {
		complete?: boolean;
		examined?: number;
		matching?: number;
		by_collection?: Array<{ collection: string; count: number; completeness: string }>;
		total?: { count: number; unit?: string; by_kind?: { kind: string; count: number }[] };
	};
	next?: string[];
	recovery?: string[];
	status?: string;
	reason?: string;
	error_class?: string;
	cause?: string;
	hint?: string;
} & Record<string, unknown>;

/** Record keys that describe the connection of a live read; they pass through unchanged. */
const CONNECTION_KEYS = ["reads_as_publisher", "connected_identity", "note"] as const;

const scalar = (value: unknown): string | number | boolean | null =>
	value === null || ["string", "number", "boolean"].includes(typeof value)
		? (value as string | number | boolean | null)
		: value === undefined
			? null
			: JSON.stringify(value);
/** Commands as a one-column table: one line each, nothing joined. */
const commands = (lines: readonly string[]) => lines.map((command) => ({ command }));
const refText = (ref: Ref) => `${ref.kind} ${ref.id}`;

/** Keep authored scalars distinct from the row identity and navigation columns. */
const RESERVED_COLUMNS = new Set([
	"kind",
	"key",
	"label",
	"context",
	"bundle",
	"relationship",
	"via",
	"links",
]);

/** One row's scalars: the engine's own `description` plus the selected `fields`, once each. */
function scalarsOf(item: Item): Record<string, string | number | boolean | null> {
	const out: Record<string, string | number | boolean | null> = {};
	if (item.description !== undefined) out.description = scalar(item.description);
	for (const [name, value] of Object.entries(item.fields ?? {}))
		out[RESERVED_COLUMNS.has(name) ? `fields.${name}` : name] = scalar(value);
	return out;
}

function row(item: Item, columns: readonly string[]): Record<string, unknown> {
	const extras = scalarsOf(item);
	const base: Record<string, unknown> = {
		kind: item.ref.kind,
		key: item.ref.id,
		label: item.label ?? null,
		context: item.context?.length ? item.context.map(refText).join("; ") : null,
		bundle: item.ref.bundle ?? null,
		via: item.via ? refText(item.via) : null,
		links: item.relationships?.length ?? 1,
		relationship: item.relationship
			? item.relationship.kind === "entity_containment"
				? item.relationship.direction === "inbound"
					? "inside"
					: "contains"
				: `${item.relationship.kind} ${item.relationship.direction}`
			: null,
	};
	return Object.fromEntries(columns.map((c) => [c, c in base ? base[c] : (extras[c] ?? null)]));
}

function truncated(items: Item[], single: boolean): Record<string, unknown> {
	const rows = items.flatMap((item) =>
		(item.truncated ?? []).map((t) => ({
			...(single ? {} : { key: item.ref.id }),
			field: t.field,
			shown: t.shown_code_points,
			total: t.total_code_points,
		})),
	);
	return rows.length ? { truncated: rows } : {};
}

function connection(answer: Answer): Record<string, unknown> {
	return Object.fromEntries(CONNECTION_KEYS.filter((k) => k in answer).map((k) => [k, answer[k]]));
}

function coverage(answer: Answer): Record<string, unknown> {
	const cov = answer.source?.coverage;
	return Array.isArray(cov)
		? {
				coverage: cov.map((c) => ({
					state: c.state,
					reason: c.reason ?? null,
					families: (c.families ?? []).join(" "),
				})),
			}
		: {};
}

/** `sk explore detail <kind> <key> ...` as a template: only what the answer cannot know is a placeholder. */
function helpLines(answer: Answer, templates: readonly string[]): readonly string[] {
	return (answer.operation === "search" ||
		answer.operation === "neighbors" ||
		answer.operation === "references") &&
		(answer.items?.length ?? 0) > 0 &&
		!(answer.next ?? []).some((c) => c.includes(" explore detail "))
		? templates
		: [];
}

/**
 * Reshape one finished explore record (`kind`, `ok`, the engine answer with `next`/`recovery` as
 * command lines) into the TOON-ready object. `detailTemplate` is the `explore detail` command with
 * `<kind> <key>` placeholders, built by the caller from its own command renderer.
 *
 * `defaultSource` is the source this command reads without `--source`. A successful answer from it
 * whose coverage is complete prints no `source`, `source_id`, `world` or `coverage`
 * line: every printed next command already carries `--source` and `--source-id`, so a follow-up
 * never reads another world. Anything else (another source, incomplete coverage) prints them all.
 */
export function exploreToonShape(
	record: Record<string, unknown>,
	detailTemplate?: string | readonly string[],
	defaultSource?: string,
): Record<string, unknown> {
	const answer = record as Answer;
	const id = answer.source?.source_id;
	const source = {
		...(answer.source?.source ? { source: answer.source.source } : {}),
		...(id ? { source_id: id } : {}),
		...(answer.source?.world ? { world: answer.source.world } : {}),
	};
	const gaps = Array.isArray(answer.source?.coverage)
		? answer.source.coverage.filter((group) => group.state !== "complete")
		: [];
	const fixedLimitsOnly =
		answer.ok !== false &&
		gaps.length > 0 &&
		gaps.every(
			(group) =>
				(group.state === "incomplete" &&
					["examined_row_bound", "authored_entities_only"].includes(group.reason ?? "")) ||
				(group.state === "unsupported" && group.reason === "no_live_projection"),
		);
	const limitations = [
		...(gaps.some((group) => group.reason === "authored_entities_only")
			? ["authored instance projection; runtime bodies and containment-only rows may be omitted"]
			: []),
		...(gaps.some((group) => group.reason === "examined_row_bound") ? ["fixed reader bound"] : []),
		...(gaps.some((group) => group.reason === "no_live_projection")
			? ["unsupported live projections"]
			: []),
	].join(" and ");
	const route = {
		...(answer.next?.length ? { next: commands(answer.next) } : {}),
		// The engine's successful incomplete-answer recovery replays the request without a
		// cursor (exploration.ts:explore). Replaying cannot enlarge a fixed reader bound
		// or add a missing live projection.
		// Keep transient/refusal recovery and canonical JSONL untouched, and keep paging
		// through the examined subset in `next`.
		...(!fixedLimitsOnly && answer.recovery?.length ? { recovery: commands(answer.recovery) } : {}),
	};

	if (answer.ok === false) {
		return {
			error: answer.status ?? "unavailable",
			completeness: answer.completeness ?? "incomplete",
			...(answer.reason ? { reason: answer.reason } : {}),
			...(answer.error_class ? { error_class: answer.error_class } : {}),
			...(answer.cause ? { cause: answer.cause } : {}),
			...(answer.hint ? { hint: answer.hint } : {}),
			...(Array.isArray(answer.valid) ? { valid: answer.valid } : {}),
			...(typeof answer.note === "string" ? { note: answer.note } : {}),
			...connection(answer),
			...route,
		};
	}

	const items = answer.items ?? [];
	const quiet =
		defaultSource !== undefined &&
		answer.source?.source === defaultSource &&
		(answer.completeness ?? "complete") === "complete" &&
		!Array.isArray(answer.source?.coverage);
	const total = answer.page?.total?.count;
	const head = {
		// What a references answer searched, so "0 matches" says which links were read.
		...(Array.isArray(answer.links) ? { links_read: answer.links } : {}),
		...(answer.search_scope === "all collections" ? { search_scope: "all collections" } : {}),
		...(answer.page?.by_collection
			? {
					matches_by_collection: answer.page.by_collection
						.map(
							(entry) =>
								`${entry.collection}: ${entry.completeness === "complete" ? "" : ">="}${entry.count}`,
						)
						.join("; "),
				}
			: {}),
		...(quiet ? {} : source),
		completeness: answer.completeness ?? "complete",
		...(answer.source?.source === "live" ? { scope: "caller-visible rows" } : {}),
		...(total === undefined ? {} : { total }),
		...(answer.page?.total?.unit ? { unit: answer.page.total.unit } : {}),
		...(answer.page?.examined === undefined
			? {}
			: {
					examined_rows: answer.page.examined,
					matching_at_least: answer.page.matching,
					count_note:
						"Examined = admitted rows in read families before filtering; matching = matching items across pages (lower bound). Neither is a complete total.",
				}),
		...(answer.page?.total?.by_kind?.length
			? {
					counts_by_kind: answer.page.total.by_kind,
					count_note:
						answer.page.total.unit === "objects"
							? "Counts are distinct admitted objects; actor/body pairs count once."
							: "Counts are rows; different kinds can describe the same object.",
				}
			: {}),
		...(answer.page?.complete === false
			? {
					...(answer.operation === "field"
						? {}
						: {
								limits: `pages stop at the requested row limit or ${EXPLORATION_BYTE_LIMIT}-byte JSON answer budget`,
							}),
					// A chunk of one text has no row count; a list says how much of it is shown.
					more:
						answer.operation === "field"
							? true
							: `showing ${items.length}${total === undefined ? "" : ` of ${total}`}; the next commands show more`,
				}
			: {}),
		...(quiet ? {} : coverage(answer)),
		...(fixedLimitsOnly
			? {
					coverage_note: `Coverage limits: ${limitations}. Repeating this command will not broaden coverage.`,
				}
			: {}),
	};
	const help = helpLines(
		answer,
		typeof detailTemplate === "string" ? [detailTemplate] : (detailTemplate ?? []),
	);
	const tail = {
		...connection(answer),
		...route,
		...(help.length ? { help: commands(help) } : {}),
	};
	if (answer.operation === "summary" && Array.isArray(answer.summary)) {
		const summary = answer.summary as Array<{
			collection: string;
			unit?: string;
			examined?: number;
			row_metadata?: Record<string, number>;
			tag_counts?: Array<{ tag: string; count: number }>;
			completeness: string;
			total?: number;
			by_kind?: Array<{ kind: string; count: number; completeness?: string }>;
		}>;
		const metadata = summary.find((entry) => entry.row_metadata)?.row_metadata;
		const tags = [
			...new Set(summary.flatMap((entry) => entry.tag_counts?.map((row) => row.tag) ?? [])),
		];
		const tagCount = (collection: string, tag: string) => {
			const entry = summary.find((entry) => entry.collection === collection);
			const count = entry?.tag_counts?.find((row) => row.tag === tag)?.count;
			return count === undefined ? null : entry?.completeness === "complete" ? count : `>=${count}`;
		};
		return {
			...head,
			collections: summary.map((entry) => ({
				// Units remain explicit when objects and technical rows share an inventory.
				collection: entry.collection,
				completeness: entry.completeness,
				total: entry.total ?? null,
				...(entry.examined === undefined ? {} : { examined: entry.examined }),
				...(entry.unit ? { unit: entry.unit } : {}),
			})),
			...bundleView(answer.bundles),
			counts_by_kind: summary.flatMap((entry) =>
				(entry.collection === "instances" && metadata ? [] : (entry.by_kind ?? [])).map((row) => ({
					collection: entry.collection,
					kind: row.kind,
					count: row.completeness === "incomplete" ? `>=${row.count}` : row.count,
					...(summary.some((group) => group.by_kind?.some((kind) => kind.completeness))
						? { completeness: row.completeness ?? entry.completeness }
						: {}),
				})),
			),
			...(metadata
				? {
						inventory: `${summary.find((entry) => entry.collection === "instances")?.total} objects; ${Object.values(metadata).reduce((a, b) => a + b, 0)} rows = entities: ${metadata.entity_rows} placed bodies + actors: ${metadata.actor_rows} controllers + entity_tag: ${metadata.tag_memberships} tag assignments.`,
					}
				: {
						count_note:
							"Counts are rows unless unit=objects; objects combine a body and its controller. Null totals are unknown; examined/incomplete counts are lower bounds.",
					}),
			...(tags.length
				? {
						tag_counts: tags.map((tag) => ({
							tag,
							definitions: tagCount("definitions", tag),
							instances: tagCount("instances", tag),
						})),
					}
				: {}),
			playability: "Authored tag counts, not live seats.",
			...(!summary.find((entry) => entry.collection === "definitions")?.by_kind
				? { definition_counts: "Per-kind counts and definition tags: --facets." }
				: summary.find((entry) => entry.collection === "definitions")?.completeness === "complete"
					? { definition_counts: "Kind counts are complete." }
					: { definition_counts: "Incomplete kind counts are lower bounds." }),
			source_note:
				answer.source?.source === "live"
					? "Live: caller-visible authored projection. Counts can differ from files: containment-only/runtime bodies may be absent; catalogs/tags are separately projected."
					: "Files: authored file snapshot; live: caller-visible projection. Containment-only/runtime bodies and catalog/tag rows can differ.",
			...(Array.isArray(answer.tag_facets)
				? {
						tag_facets: answer.tag_facets,
						tag_facets_more: answer.tag_facets_more,
						tag_note:
							"Authored tags on admitted objects; incomplete counts are lower bounds, not live player/seat state.",
					}
				: {}),
			...(Array.isArray(answer.definition_tag_facets)
				? {
						definition_tag_facets: answer.definition_tag_facets,
						definition_tag_facets_more: answer.definition_tag_facets_more,
						definition_tag_note:
							"Authored tags on admitted definitions, such as a content family; --limit applies to each facet list separately.",
					}
				: {}),
			...(Array.isArray(answer.families)
				? {
						families: answer.families,
						...(answer.families_more ? { families_more: true } : {}),
						families_note:
							"Most frequent definition tags that refine no other tag; every tag: --facets.",
					}
				: {}),
			...(Array.isArray(answer.guidance) ? { help: commands(answer.guidance as string[]) } : {}),
			...tail,
		};
	}

	if (items.length === 0) {
		const searched = typeof answer.search_scope === "string" ? ` in ${answer.search_scope}` : "";
		return {
			...head,
			items:
				(answer.completeness ?? "complete") === "complete"
					? `0 matches${searched}; complete for this scope only`
					: `0 matches${searched} in examined rows; coverage is incomplete`,
			...tail,
		};
	}
	// One row: a detail view reads as an object, not a one-row table.
	if (answer.operation === "detail" || answer.operation === "field") {
		const [only] = items as [Item];
		return {
			...head,
			item: {
				kind: only.ref.kind,
				key: only.ref.id,
				...(only.ref.bundle ? { bundle: only.ref.bundle } : {}),
				...(only.label === undefined ? {} : { label: only.label }),
				...(only.context?.length ? { context: only.context.map(refText).join("; ") } : {}),
				...scalarsOf(only),
			},
			...truncated(items, true),
			...tail,
		};
	}
	// A column appears only when some row has a value for it; `bundle` only when bundles differ.
	const extra = [...new Set(items.flatMap((item) => Object.keys(scalarsOf(item))))];
	const bundles = new Set(items.map((item) => item.ref.bundle));
	const columns = [
		"kind",
		"key",
		...(items.some((item) => item.label !== undefined) ? ["label"] : []),
		...(items.some((item) => item.context?.length) ? ["context"] : []),
		...(bundles.size > 1 ? ["bundle"] : []),
		...(items.some((item) => item.relationship) ? ["relationship"] : []),
		...(items.some((item) => item.via) ? ["via"] : []),
		...(items.some((item) => (item.relationships?.length ?? 0) > 1) ? ["links"] : []),
		...extra,
	];
	if (
		answer.operation === "neighbors" &&
		["place_nodes", "place_graphs"].includes(String(answer.neighbor_root))
	) {
		const group = (item: Item) =>
			["actors", "entities"].includes(item.ref.kind)
				? "contents"
				: item.relationship?.kind === "place_edges"
					? "exits"
					: item.relationship?.direction === "inbound" &&
							["graph_node", "graph_parent"].includes(item.relationship.kind)
						? "parent"
						: "contents";
		return {
			...head,
			...Object.fromEntries(
				["contents", "exits", "parent"].map((name) => [
					name,
					items.filter((item) => group(item) === name).map((item) => row(item, columns)),
				]),
			),
			...truncated(items, false),
			...tail,
		};
	}
	return {
		...head,
		items: items.map((item) => row(item, columns)),
		...truncated(items, false),
		...tail,
	};
}

/** The summary's bundle table: rows for places/definitions, distinct objects for instances. */
function bundleView(bundles: unknown): Record<string, unknown> {
	const value = bundles as
		| {
				items: Array<{
					bundle: string;
					title?: string;
					places: number;
					definitions: number;
					objects: number;
				}>;
				unbundled?: { places: number; definitions: number; objects: number };
				more: boolean;
				completeness: string;
		  }
		| undefined;
	if (!value?.items.length && !value?.unbundled) return {};
	// Complete counts stay numbers; incomplete ones read as lower bounds.
	const count = (n: number) => (value.completeness === "complete" ? n : `>=${n}`);
	return {
		bundles: value.items.map((entry) => ({
			bundle: entry.bundle,
			title: entry.title ?? null,
			places: count(entry.places),
			definitions: count(entry.definitions),
			objects: count(entry.objects),
		})),
		...(value.more ? { bundles_more: true } : {}),
		...(value.unbundled
			? {
					unbundled: `places ${count(value.unbundled.places)}, definitions ${count(value.unbundled.definitions)}, objects ${count(value.unbundled.objects)}`,
				}
			: {}),
		bundles_note:
			"Places and definitions are rows (tag rows included); objects are distinct bodies.",
	};
}
