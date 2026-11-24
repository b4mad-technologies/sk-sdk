import { type Static, Type } from "typebox";

const sources = Type.Union([
	Type.Literal("live"),
	Type.Literal("workspace"),
	Type.Literal("local"),
]);
const collections = Type.Union([
	Type.Literal("places"),
	Type.Literal("definitions"),
	Type.Literal("instances"),
]);
/**
 * A reference names a row inside one response's source; the source identity is stated once
 * per response (`source.source_id`) and once per request (`source_id`), never per reference.
 * The collection follows from the kind.
 */
export const EXPLORATION_REF = Type.Object(
	{
		kind: Type.String(),
		id: Type.String(),
		bundle: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);
export const EXPLORE_PARAMS = Type.Object(
	{
		operation: Type.Union([
			Type.Literal("summary"),
			Type.Literal("search"),
			Type.Literal("detail"),
			Type.Literal("neighbors"),
			Type.Literal("references"),
			Type.Literal("field"),
		]),
		source: Type.Optional(sources),
		source_id: Type.Optional(
			Type.String({
				maxLength: 64,
				description:
					"The `source.source_id` of the response that returned `ref`/`within`. Required with `ref` and `within`; another source, world or connection is refused.",
			}),
		),
		collection: Type.Optional(collections),
		facets: Type.Optional(
			Type.Boolean({
				description:
					"Summary only: include definition counts by kind and detailed authored tag facets. Default false; the compact summary offers this as a follow-up.",
			}),
		),
		view: Type.Optional(
			Type.Union([Type.Literal("objects"), Type.Literal("rows")], {
				description:
					"Summary/search/neighbors only. Default objects: instance bodies once, without tag rows. Explicit kind selects rows. Use rows for the technical inventory.",
			}),
		),
		text: Type.Optional(Type.String({ maxLength: 512 })),
		tags: Type.Optional(
			Type.Array(Type.String({ maxLength: 256 }), {
				maxItems: 16,
				description:
					"Summary: count these literal tags separately on definitions and distinct objects. Search: require all tags. Tags are never inherited from definitions.",
			}),
		),
		kind: Type.Optional(Type.String()),
		bundle: Type.Optional(Type.String()),
		within: Type.Optional(EXPLORATION_REF),
		ref: Type.Optional(EXPLORATION_REF),
		direction: Type.Optional(Type.Union([Type.Literal("outbound"), Type.Literal("inbound")])),
		field: Type.Optional(Type.String()),
		offset: Type.Optional(Type.Integer({ minimum: 0 })),
		fields: Type.Optional(
			Type.Array(Type.String({ maxLength: 256 }), {
				maxItems: 16,
				description:
					"search/detail only: scalar names from the collection schema for search, or the selected row kind's schema for detail; `label` is also selectable.",
			}),
		),
		limit: Type.Optional(
			Type.Integer({
				minimum: 1,
				maximum: 100,
				description:
					"Page size. Default 12 tag facets for summary, 5 for search (ranked: label equals, starts with, contains, then other text), 20 otherwise.",
			}),
		),
		cursor: Type.Optional(Type.String({ maxLength: 16384 })),
	},
	{
		additionalProperties: false,
		description:
			"Bounded admitted discovery. Summary inventories all three collections with coverage and per-kind counts (incomplete kinds are lower bounds). Instance summary/search count objects once by default; view rows preserves technical rows and explicit kind selects rows. Defaults to live; search collection follows kind, otherwise unrestricted text searches all collections and empty text defaults to places. An explicit collection must agree with kind. Explicit workspace/local source is never unioned. Follow exact returned references; no read grants write permission.",
	},
);
export type ExplorationRef = Static<typeof EXPLORATION_REF>;
export type ExploreRequest = Static<typeof EXPLORE_PARAMS>;
export type ExplorationCollection = Static<typeof collections>;
export type ExplorationSourceKind = Static<typeof sources>;
/** A reader's own full identity and coverage, as a port reports it. The wire form is `ExplorationResultSource`. */
export interface ExplorationSource {
	source: ExplorationSourceKind;
	source_id: string;
	world: string | null;
	world_instance: string | null;
	connection_epoch: string;
	source_epoch: string;
	projection_version: "exploration-v1";
	coverage: Array<{
		family: string;
		state: "complete" | "incomplete" | "unsupported" | "disconnected";
		reason?: string;
	}>;
}
/** Families that are not `complete`, grouped by state and reason; complete families are never listed. */
export interface ExplorationCoverageGroup {
	state: "incomplete" | "unsupported" | "disconnected";
	reason?: string;
	families: string[];
}
export interface ExplorationResultSource {
	source: ExplorationSourceKind;
	/** Opaque token of source, world instance and connection; echo it as `source_id` with any `ref`/`within`. */
	source_id: string;
	world?: string;
	/**
	 * `"complete"` when every family the request reads is complete; otherwise only those that are
	 * not. A family the request does not read (a place search and the definitions) is never listed.
	 */
	coverage: "complete" | ExplorationCoverageGroup[];
}
export type ExplorationScalar = string | number | boolean | null;
export interface ExplorationItem {
	ref: ExplorationRef;
	label?: string;
	description?: string;
	fields?: Record<string, ExplorationScalar>;
	context?: ExplorationRef[];
	/** Graph occupants are reached through this admitted room, not a fabricated direct edge. */
	via?: ExplorationRef;
	/** All stored links collapsed into this object; the first is also in relationship. */
	relationships?: Array<{ kind: string; key: string; direction: "outbound" | "inbound" }>;
	relationship?: {
		kind: string;
		key: string;
		/** The item is the far end; `via`, when present, otherwise the requested ref is the other end. */
		direction: "outbound" | "inbound";
	};
	/** Fields cut by a preview or byte bound; sizes are raw code points of the admitted value. */
	truncated?: Array<{ field: string; shown_code_points: number; total_code_points: number }>;
}
export type ExplorationErrorClass = "usage" | "in_world" | "infra";
export interface ExplorationResult {
	shape: "exploration";
	operation: ExploreRequest["operation"];
	source: ExplorationResultSource;
	ok: boolean;
	/** Present exactly when `ok` is false. */
	status?: "not_found_in_scope" | "unavailable" | "stale_cursor";
	reason?: string;
	/**
	 * Only for `source_unreadable` on a file source: one bounded line naming the caller's own
	 * file and what is wrong with it. Never set for a live source (Decision 4).
	 */
	cause?: string;
	/** Only with `cause`: the one thing to change, written for the host that ran the call. */
	hint?: string;
	/** Set exactly when `ok` is false; authoritative over any exit code. */
	error_class?: ExplorationErrorClass;
	/** Static declared alternatives for unsupported fields/kinds, never derived from admitted row presence. */
	valid?: string[];
	/** Coverage of the request's reader families; never a function of inaccessible rows. */
	completeness: "complete" | "incomplete";
	/** Inventory of each collection. Exact totals are absent when coverage is incomplete; kind counts state their coverage. */
	summary?: Array<{
		collection: ExplorationCollection;
		unit?: "objects" | "rows";
		row_metadata?: { actor_rows: number; entity_rows: number; tag_memberships: number };
		/** Requested literal tags on admitted definitions or distinct objects; never inherited. */
		tag_counts?: Array<{ tag: string; count: number }>;
		/** Admitted/examined rows or objects, a lower bound when coverage is incomplete. */
		examined?: number;
		/** Authored tags on admitted definition rows or distinct admitted objects (per collection), bounded by limit (default twelve); never on places. */
		tag_facets?: { items: Array<{ tag: string; count: number }>; more: boolean };
		/**
		 * Definitions only, default summary (without --facets): the five most frequent
		 * authored definition tags that do not refine another admitted tag (dot parent),
		 * as content families. Lower bounds when the collection is incomplete.
		 */
		families?: { items: Array<{ tag: string; count: number }>; more: boolean };
		completeness: "complete" | "incomplete";
		total?: number;
		by_kind?: Array<{ kind: string; count: number; completeness?: "complete" | "incomplete" }>;
	}>;
	/**
	 * References only: the declared link families this answer read, from the static
	 * projection topology. `complete` is complete over these; other authored links are not read.
	 */
	links?: string[];
	/**
	 * Summary only: the bundles of admitted rows (plus authored file bundles without
	 * rows), in UTF-8 order, at most twenty. Counts are rows (places, definitions) or
	 * distinct objects (instances); lower bounds when `completeness` is incomplete.
	 * `title` comes only from an authored bundle row of a file source, never guessed.
	 */
	bundles?: {
		items: Array<{
			bundle: string;
			title?: string;
			places: number;
			definitions: number;
			objects: number;
		}>;
		/** Admitted rows without a bundle, so the per-bundle counts add up to the totals. */
		unbundled?: { places: number; definitions: number; objects: number };
		more: boolean;
		completeness: "complete" | "incomplete";
	};
	items: ExplorationItem[];
	/**
	 * `complete` means no further page exists. `total` counts the items paging would
	 * return under this snapshot, only for search/neighbors/references with complete coverage.
	 * A search page that is cut also offers, in `next`, the same request with `limit: 20`.
	 */
	page: {
		complete: boolean;
		/** Admitted rows in the declared read families before matching or paging; not raw server scan counts. */
		examined?: number;
		/** Matching admitted items across all pages; a lower bound, never an exact total. */
		matching?: number;
		/** Unrestricted text matches across all pages, with independent collection coverage. */
		by_collection?: Array<{
			collection: ExplorationCollection;
			count: number;
			completeness: "complete" | "incomplete";
		}>;
		next_cursor?: string;
		total?: {
			count: number;
			unit?: "objects";
			/** Matching representatives by kind across all pages; rows unless unit is objects. */
			by_kind?: Array<{ kind: string; count: number }>;
		};
	};
	/** At most four ready-to-run follow-ups built from this request and response; omitted when empty. */
	next?: ExploreRequest[];
	/** Reserved for unavailable, stale_cursor and incomplete coverage; omitted when empty. */
	recovery?: Array<{ tool: string; params: Record<string, unknown> }>;
}
