/** Pure bounded traversal over a host-supplied admitted, detached snapshot. */
import type {
	ExplorationCollection,
	ExplorationCoverageGroup,
	ExplorationErrorClass,
	ExplorationItem,
	ExplorationRef,
	ExplorationResult,
	ExplorationResultSource,
	ExplorationScalar,
	ExplorationSource,
	ExplorationSourceKind,
	ExploreRequest,
} from "@spellkave/tool-contracts";
import { foldExplorationText } from "./exploration-casefold";
export interface ExplorationIdentity {
	collection: ExplorationCollection;
	kind: string;
	id: string;
	bundle?: string;
}
export interface ExplorationRow extends ExplorationIdentity {
	label?: string;
	description?: string;
	tags: readonly string[];
	fields: Readonly<Record<string, ExplorationScalar>>;
	context: readonly ExplorationIdentity[];
}
export interface ExplorationRelation {
	kind: string;
	key: string;
	from: ExplorationIdentity;
	to: ExplorationIdentity;
	route: "neighbors" | "references";
}
export interface ExplorationSnapshot {
	source: ExplorationSource;
	rows: readonly ExplorationRow[];
	relations: readonly ExplorationRelation[];
	/** Declared field support is independent of the selected row's existence. */
	fields: Readonly<Record<string, readonly string[]>>;
	collections: Readonly<Record<string, ExplorationCollection>>;
	/** Static projection dependencies, including empty relations; never inferred from visible hits. */
	traversals?: readonly {
		from: string;
		to: string;
		family: string;
		route: "neighbors" | "references";
		context?: boolean;
	}[];
	/**
	 * Authored bundle titles. The summary lists bundles from admitted rows; a title is shown
	 * only when its bundle row is authored here, never guessed. A file source also lists its
	 * row-less bundles; a live source names only bundles of admitted rows.
	 */
	bundles?: readonly { bundle: string; title?: string }[];
}
export interface ExplorationPort {
	snapshot(source: ExplorationSourceKind): Promise<ExplorationSnapshot>;
}
/**
 * A file source the caller named cannot be read: missing, malformed or incomplete. Not
 * transient, so it is never retried. Only a file port (the caller's own files) may throw
 * it; the engine ignores it for `live`, whose reasons stay fixed and carry no free text.
 */
export class ExplorationSourceError extends Error {
	readonly hint: string;
	constructor(cause: string, hint: string) {
		super(cause);
		this.name = "ExplorationSourceError";
		this.hint = hint;
	}
}
const CAUSE_CODE_POINTS = 300;
const oneLine = (text: string, max: number) => {
	const all = Array.from(text.replace(/\s+/g, " ").trim());
	return all.length <= max ? all.join("") : `${all.slice(0, max - 1).join("")}…`;
};
export const EXPLORATION_BYTE_LIMIT = 16384;
/** Default summary: the most frequent definition tags shown as content families. */
const DEFAULT_FAMILY_FACETS = 5;
/** Summary bundle list bound; `bundles.more` discloses the rest. */
const SUMMARY_BUNDLE_LIMIT = 20;
/** A search page is a first look (five rows); every other walk keeps its page of twenty. */
export const EXPLORATION_SEARCH_LIMIT = 5;
export const EXPLORATION_PAGE_LIMIT = 20;
/** The wider page the "more results" follow-up asks for. */
const WIDE_LIMIT = EXPLORATION_PAGE_LIMIT;
const encoder = new TextEncoder();
const size = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
export function explorationIdentityKey(ref: ExplorationIdentity): string {
	return JSON.stringify([ref.collection, ref.kind, ref.bundle ?? "", ref.id]);
}
/** Stable digest also used by file providers; all inputs are plain declared data. */
export async function explorationDigest(value: unknown): Promise<string> {
	function canonical(v: unknown): unknown {
		if (Array.isArray(v)) return v.map(canonical);
		if (v !== null && typeof v === "object")
			return Object.fromEntries(
				Object.entries(v)
					.sort(([a], [b]) => compareUtf8(a, b))
					.filter(([, x]) => x !== undefined)
					.map(([k, x]) => [k, canonical(x)]),
			);
		return v;
	}
	const bytes = new Uint8Array(
		await globalThis.crypto.subtle.digest(
			"SHA-256",
			encoder.encode(JSON.stringify(canonical(value))),
		),
	);
	return Array.from(bytes, (x) => x.toString(16).padStart(2, "0")).join("");
}
function compareUtf8(a: string, b: string): number {
	const x = encoder.encode(a),
		y = encoder.encode(b);
	for (let i = 0; i < Math.min(x.length, y.length); i++)
		if (x[i] !== y[i]) return (x[i] ?? 0) - (y[i] ?? 0);
	return x.length - y.length;
}
export function compareExplorationKeys(a: readonly string[], b: readonly string[]): number {
	for (let i = 0; i < Math.min(a.length, b.length); i++) {
		const c = compareUtf8(a[i] ?? "", b[i] ?? "");
		if (c) return c;
	}
	return a.length - b.length;
}
/** The wire reference: the collection follows from the kind, the source is stated once per response. */
function wireRef(row: ExplorationIdentity): ExplorationRef {
	return {
		kind: row.kind,
		id: row.id,
		...(row.bundle === undefined ? {} : { bundle: row.bundle }),
	};
}
const sameRef = (a: ExplorationRef, b: ExplorationRef) =>
	a.kind === b.kind && a.id === b.id && a.bundle === b.bundle;
const SHORT = 16;
/**
 * The compact source identity token a response states once and a request echoes as
 * `source_id`: it covers the source kind, root, world instance and connection epoch, so a
 * reset, reconnect or another root yields a different token.
 */
export async function explorationSourceId(source: ExplorationSource): Promise<string> {
	return (
		await explorationDigest([
			source.source,
			source.source_id,
			source.world_instance,
			source.connection_epoch,
		])
	).slice(0, SHORT);
}
/** Only the families that are not complete, grouped by state and reason. */
function wireCoverage(
	coverage: ExplorationSource["coverage"],
): ExplorationResultSource["coverage"] {
	const groups = new Map<string, ExplorationCoverageGroup>();
	for (const entry of coverage) {
		if (entry.state === "complete") continue;
		const id = `${entry.state}\u0000${entry.reason ?? ""}`;
		const group = groups.get(id) ?? {
			state: entry.state,
			...(entry.reason === undefined ? {} : { reason: entry.reason }),
			families: [],
		};
		group.families.push(entry.family);
		groups.set(id, group);
	}
	return groups.size ? [...groups.values()] : "complete";
}
function wireSource(source: ExplorationSource, token: string): ExplorationResultSource {
	return {
		source: source.source,
		source_id: token,
		...(source.world === null ? {} : { world: source.world }),
		coverage: wireCoverage(source.coverage),
	};
}
function base(
	source: ExplorationResultSource,
	operation: ExploreRequest["operation"],
): ExplorationResult {
	return {
		shape: "exploration",
		operation,
		source,
		ok: true,
		completeness: "complete",
		items: [],
		page: { complete: true },
	};
}
function unavailableSource(
	source: ExplorationSourceKind,
	reason = "reader_unavailable",
): ExplorationResultSource {
	return {
		source,
		source_id: "unavailable",
		coverage: [{ state: "disconnected", reason, families: ["exploration"] }],
	};
}
/** Fixed reason → class map (design "AXI conformance"); never row-dependent. */
const ERROR_CLASS: Readonly<Record<string, ExplorationErrorClass>> = {
	invalid_input: "usage",
	unsupported_field: "usage",
	unsupported_family: "usage",
	invalid_offset: "usage",
	invalid_continuation: "usage",
	field_without_text: "usage",
	missing_source_id: "usage",
	not_found_in_scope: "in_world",
	reference_source_changed: "in_world",
	snapshot_or_request_changed: "in_world",
	source_unreadable: "usage",
	reader_unavailable: "infra",
	source_mismatch: "infra",
	projection_key_too_large: "infra",
};
/** Reasons that depend only on the request and static schema: they fail loud. */
export const EXPLORATION_ARGUMENT_REASONS: ReadonlySet<string> = new Set([
	"invalid_input",
	"unsupported_field",
	"missing_source_id",
]);
function refusal(
	result: ExplorationResult,
	status: NonNullable<ExplorationResult["status"]>,
	reason: string,
	recovery: NonNullable<ExplorationResult["recovery"]> = [],
	valid?: string[],
	diagnosis?: { cause: string; hint: string },
): ExplorationResult {
	const { next: _next, recovery: _recovery, ...rest } = result;
	const out: ExplorationResult = {
		...rest,
		ok: false,
		status,
		reason,
		error_class: ERROR_CLASS[reason] ?? "infra",
		...(valid ? { valid } : {}),
		...(diagnosis ?? {}),
		completeness: "incomplete",
		items: [],
		page: { complete: false },
		...(recovery.length ? { recovery } : {}),
	};
	return size(out) <= EXPLORATION_BYTE_LIMIT
		? out
		: { ...out, source: unavailableSource(result.source.source) };
}
/** `s` binds source identity and source epoch, `r` the canonical request; both are digest prefixes. */
interface Cursor {
	v: 2;
	s: string;
	r: string;
	c: { t: "i"; k: string[] } | { t: "t"; o: number };
}
const KEY_WIDTH = 8;
/** Item keys are padded to a fixed width for ordering; the cursor stores them without the padding. */
const trimKey = (key: readonly string[]) => {
	const out = [...key];
	while (out.length && out[out.length - 1] === "") out.pop();
	return out;
};
const padKey = (key: readonly string[]) => [
	...key,
	...Array.from({ length: KEY_WIDTH - key.length }, () => ""),
];
function encodeCursor(c: Cursor): string {
	return btoa(
		Array.from(encoder.encode(JSON.stringify(c)), (byte) => String.fromCharCode(byte)).join(""),
	);
}
function decodeCursor(text: string): Cursor | undefined {
	try {
		if (text.length > EXPLORATION_BYTE_LIMIT) return undefined;
		const c = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(
				Uint8Array.from(atob(text), (char) => char.charCodeAt(0)),
			),
		) as Cursor;
		if (c.v !== 2 || typeof c.s !== "string" || typeof c.r !== "string") return undefined;
		if (
			c.c?.t === "i" &&
			Array.isArray(c.c.k) &&
			c.c.k.length >= 1 &&
			c.c.k.length <= KEY_WIDTH &&
			c.c.k.every((x) => typeof x === "string")
		)
			return { ...c, c: { t: "i", k: padKey(c.c.k) } };
		if (c.c?.t === "t" && Number.isSafeInteger(c.c.o) && c.c.o >= 0) return c;
	} catch {
		/* malformed cursor is one fixed public diagnostic */
	}
	return undefined;
}
type Truncation = NonNullable<ExplorationItem["truncated"]>[number];
const PREVIEW_CODE_POINTS = 512;
function clip(field: string, text: string, truncated: Truncation[]): string {
	const all = Array.from(text);
	if (all.length <= PREVIEW_CODE_POINTS) return text;
	truncated.push({
		field,
		shown_code_points: PREVIEW_CODE_POINTS,
		total_code_points: all.length,
	});
	return all.slice(0, PREVIEW_CODE_POINTS).join("");
}
/**
 * Stable ordering tuple of a plain row; relationship items append their relation. The first
 * element is the relevance tier of a text search ("1".."4"), "0" for every other order, so the
 * sort key of a search is (tier, item key). Broad definition text searches suffix the tier
 * with .0 for entity blueprints and .1 for supporting definitions; cursors bind that policy.
 */
const rowKey = (row: ExplorationIdentity, tier = "0") => [
	tier,
	row.collection,
	row.kind,
	row.bundle ?? "",
	row.id,
	"",
	"",
	"",
];
interface Entry {
	key: string[];
	item: ExplorationItem;
}
/** Only the declared actor/body identity is shared; unrelated kinds never coalesce. */
function objectRows(rows: readonly ExplorationRow[]): ExplorationRow[] {
	const key = (row: ExplorationRow) => JSON.stringify([row.bundle ?? "", row.fields.entity_key]);
	const bodies = new Map(
		rows
			.filter((row) => row.kind === "entities" && typeof row.fields.entity_key === "string")
			.map((row) => [key(row), row]),
	);
	for (const actor of rows) {
		if (actor.kind !== "actors" || typeof actor.fields.entity_key !== "string") continue;
		const body = bodies.get(key(actor));
		if (body)
			bodies.set(key(actor), {
				...body,
				tags: [...new Set([...body.tags, ...actor.tags])],
				context: [
					...new Map(
						[...body.context, ...actor.context].map((ref) => [explorationIdentityKey(ref), ref]),
					).values(),
				],
			});
	}
	return rows
		.filter(
			(row) =>
				row.kind !== "entity_tag" &&
				!(
					row.kind === "actors" &&
					typeof row.fields.entity_key === "string" &&
					bodies.has(key(row))
				),
		)
		.map((row) =>
			row.kind === "entities" && typeof row.fields.entity_key === "string"
				? (bodies.get(key(row)) ?? row)
				: row,
		);
}
/**
 * Relevance tier of a matched row for a non-empty folded needle, computed from the row's own
 * visible fields only (Decision 4): 1 label equals, 2 label starts with, 3 label contains,
 * 4 only another searched field (id, description, tag) contains it. "0" without a needle.
 */
function relevanceTier(row: ExplorationRow, needle: string): string {
	if (needle === "") return "0";
	const label = foldExplorationText(row.label ?? "");
	if (label === needle) return "1";
	if (label.startsWith(needle)) return "2";
	return label.includes(needle) ? "3" : "4";
}
/** The projector derives `label` from `display_name`, else `name`. */
const labelField = (row: ExplorationRow) =>
	typeof row.fields.display_name === "string" ? "display_name" : "name";
/**
 * `search` is the minimal default (ref, label, one context ref); `detail` adds the
 * description preview and declared scalars; `bare` carries identity only. An explicit
 * `selection` (already validated against the public schema) replaces the default set.
 */
function preview(
	row: ExplorationRow,
	admitted: Map<string, ExplorationRow>,
	mode: "search" | "detail" | "bare",
	selection?: readonly string[],
): ExplorationItem {
	const out: ExplorationItem = { ref: wireRef(row) };
	if (mode === "bare") return out;
	const truncated: Truncation[] = [];
	const wants = (name: string, byDefault: boolean) =>
		selection ? selection.includes(name) : byDefault;
	if (row.label !== undefined && wants("label", true))
		out.label = clip(labelField(row), row.label, truncated);
	if (row.description !== undefined && wants("description", mode === "detail"))
		out.description = clip("description", row.description, truncated);
	out.context = row.context
		.filter((x) => admitted.has(explorationIdentityKey(x)))
		.slice(0, mode === "search" ? 1 : 16)
		.map((x) => wireRef(x));
	const scalars = Object.entries(row.fields)
		.filter(([key]) =>
			selection ? selection.includes(key) && key !== "description" : mode === "detail",
		)
		.sort(([a], [b]) => compareUtf8(a, b))
		.slice(0, 16);
	if (scalars.length || (mode === "detail" && !selection))
		out.fields = Object.fromEntries(
			scalars.map(([key, val]) => [key, typeof val === "string" ? clip(key, val, truncated) : val]),
		);
	const unique = [...new Map(truncated.map((x) => [x.field, x])).values()];
	if (unique.length) out.truncated = unique;
	return out;
}
export async function explore(
	port: ExplorationPort | undefined,
	request: ExploreRequest,
): Promise<ExplorationResult> {
	const sourceKind = request.source ?? "live";
	// The caller's own request, re-addressed to the resolved source and without its cursor.
	const replay: ExploreRequest = Object.fromEntries(
		Object.entries({ ...request, source: sourceKind, cursor: undefined }).filter(
			([, v]) => v !== undefined,
		),
	) as ExploreRequest;
	const restart = [{ tool: "spellkave_query", params: { explore: replay } }];
	let snapshot: ExplorationSnapshot;
	try {
		if (!port) throw new Error();
		snapshot = await port.snapshot(sourceKind);
	} catch (error) {
		// A file source the caller named but that cannot be read will not heal by retrying:
		// say why and what to change. Live keeps fixed reasons, so its errors never reach here.
		if (error instanceof ExplorationSourceError && sourceKind !== "live")
			return refusal(
				base(unavailableSource(sourceKind, "source_unreadable"), request.operation),
				"unavailable",
				"source_unreadable",
				[],
				undefined,
				{
					cause: oneLine(error.message, CAUSE_CODE_POINTS),
					hint: oneLine(error.hint, CAUSE_CODE_POINTS),
				},
			);
		// An unreachable reader is transient infrastructure: repeating the call is the supported route.
		return refusal(
			base(unavailableSource(sourceKind), request.operation),
			"unavailable",
			"reader_unavailable",
			restart,
		);
	}
	const token = await explorationSourceId(snapshot.source);
	const result = base(wireSource(snapshot.source, token), request.operation);
	if (snapshot.source.source !== sourceKind)
		return refusal(result, "unavailable", "source_mismatch");
	if (size(result) > EXPLORATION_BYTE_LIMIT)
		return refusal(result, "unavailable", "projection_key_too_large");
	if (request.text !== undefined && Array.from(request.text).length > 256)
		return refusal(result, "unavailable", "invalid_input");
	if (request.operation !== "search" && request.operation !== "summary" && !request.ref)
		return refusal(result, "unavailable", "invalid_input");
	if (
		request.operation === "summary" &&
		Object.keys(request).some(
			(key) =>
				!["operation", "source", "source_id", "view", "limit", "facets", "tags"].includes(key),
		)
	)
		return refusal(result, "unavailable", "invalid_input");
	if (
		request.operation === "summary" &&
		request.limit !== undefined &&
		(!Number.isInteger(request.limit) || request.limit < 1 || request.limit > 100)
	)
		return refusal(result, "unavailable", "invalid_input");
	if (
		request.view !== undefined &&
		(!["summary", "search", "neighbors"].includes(request.operation) ||
			!["objects", "rows"].includes(request.view) ||
			(request.view === "objects" && request.kind !== undefined))
	)
		return refusal(result, "unavailable", "invalid_input");
	if (
		(request.facets !== undefined &&
			(request.operation !== "summary" || typeof request.facets !== "boolean")) ||
		(request.operation === "summary" && request.limit !== undefined && request.facets !== true)
	)
		return refusal(result, "unavailable", "invalid_input");
	if (request.offset !== undefined && request.operation !== "field")
		return refusal(result, "unavailable", "invalid_input");
	// A reference is only meaningful with the source it came from; the engine checks that below.
	if ((request.ref || request.within) && request.source_id === undefined)
		return refusal(result, "unavailable", "missing_source_id");
	// Collection membership is static schema, never inferred from admitted row data.
	if (request.operation === "search" && request.kind) {
		const collection = snapshot.collections[request.kind];
		if (collection) {
			if (request.collection !== undefined && request.collection !== collection)
				return refusal(result, "unavailable", "invalid_input", [], [collection]);
			request = { ...request, collection };
		}
	}
	const families = snapshot.source.coverage;
	const allCollections =
		request.operation === "search" && !request.collection && !request.kind && !!request.text;
	const searchCollection = request.collection ?? (allCollections ? undefined : "places");
	const relevant =
		request.operation === "summary"
			? Object.keys(snapshot.collections)
			: request.operation === "search"
				? request.kind
					? [request.kind]
					: Object.keys(snapshot.collections).filter(
							(kind) =>
								searchCollection === undefined || snapshot.collections[kind] === searchCollection,
						)
				: [request.ref?.kind ?? ""];
	// Only declared row kinds: a coverage-only family (the file bundle list) is no --kind.
	const covered = (kind: string) =>
		kind in snapshot.collections &&
		families.some((x) => x.family === kind && (x.state === "complete" || x.state === "incomplete"));
	if ((request.kind && !covered(request.kind)) || (request.ref && !covered(request.ref.kind)))
		return refusal(
			result,
			"unavailable",
			"unsupported_family",
			[],
			Object.keys(snapshot.collections).filter(covered).sort(compareUtf8),
		);
	if (
		request.operation === "field" &&
		(!request.field || !snapshot.fields[request.ref?.kind ?? ""]?.includes(request.field))
	)
		return refusal(
			result,
			"unavailable",
			"unsupported_field",
			[],
			[...(snapshot.fields[request.ref?.kind ?? ""] ?? [])],
		);
	if (request.fields !== undefined) {
		if (request.operation !== "search" && request.operation !== "detail")
			return refusal(result, "unavailable", "invalid_input");
		// Detail uses its row kind's schema. Search retains collection-wide
		// field selection; neither depends on admitted row contents.
		const collection =
			request.operation === "search"
				? searchCollection
				: snapshot.collections[request.ref?.kind ?? ""];
		const declared = new Set(["label"]);
		const selectedKind = request.operation === "detail" ? request.ref?.kind : undefined;
		for (const [kind, of] of Object.entries(snapshot.collections))
			if (selectedKind ? kind === selectedKind : collection === undefined || of === collection)
				for (const name of snapshot.fields[kind] ?? []) declared.add(name);
		if (request.fields.some((name) => !declared.has(name)))
			return refusal(
				result,
				"unavailable",
				"unsupported_field",
				[],
				[...declared].sort(compareUtf8),
			);
	}
	const defaultLimit =
		request.operation === "search" ? EXPLORATION_SEARCH_LIMIT : EXPLORATION_PAGE_LIMIT;
	const preferBlueprints =
		request.operation === "search" &&
		request.collection === "definitions" &&
		request.kind === undefined &&
		(request.text ?? "") !== "";
	const canonicalRequest = {
		...request,
		view: request.view ?? (request.kind ? "rows" : "objects"),
		cursor: undefined,
		source_id: undefined,
		source: sourceKind,
		collection: request.operation === "search" ? (searchCollection ?? "all") : request.collection,
		limit: request.limit ?? defaultLimit,
		direction: request.direction ?? "outbound",
		// A continuation from the previous tie-break order must restart, never silently skip rows.
		...(preferBlueprints ? { ranking: "entity-blueprint-tie-break-v1" } : {}),
		...(allCollections ? { ranking: "instance-tie-break-v1" } : {}),
	};
	const digest = (await explorationDigest(canonicalRequest)).slice(0, SHORT);
	// One value binds the cursor to the source identity and the source epoch.
	const bound = (await explorationDigest([token, snapshot.source.source_epoch])).slice(0, SHORT);
	const cursor = request.cursor ? decodeCursor(request.cursor) : undefined;
	if (request.cursor && (!cursor || cursor.r !== digest || cursor.s !== bound))
		return refusal(result, "stale_cursor", "snapshot_or_request_changed", restart);
	// Cursor shape depends on the cursor and request only: check before lookup.
	if (cursor && cursor.c.t !== (request.operation === "field" ? "t" : "i"))
		return refusal(result, "stale_cursor", "invalid_continuation", restart);
	// Any stated source identity must be this source and connection.
	if (request.source_id !== undefined && request.source_id !== token)
		return refusal(result, "unavailable", "reference_source_changed", [
			{ tool: "spellkave_query", params: { explore: { operation: "search", source: sourceKind } } },
		]);
	const admitted = new Map(snapshot.rows.map((row) => [explorationIdentityKey(row), row]));
	const objects = objectRows([...admitted.values()]);
	const bodyByKey = new Map(
		objects
			.filter((row) => row.kind === "entities" && typeof row.fields.entity_key === "string")
			.map((row) => [JSON.stringify([row.bundle ?? "", row.fields.entity_key]), row]),
	);
	const canonicalObject = (row: ExplorationRow) =>
		row.kind === "actors" && typeof row.fields.entity_key === "string"
			? (bodyByKey.get(JSON.stringify([row.bundle ?? "", row.fields.entity_key])) ?? row)
			: row;
	const lookup = (ref: ExplorationRef | undefined) => {
		const collection = ref ? snapshot.collections[ref.kind] : undefined;
		return ref && collection
			? admitted.get(explorationIdentityKey({ ...ref, collection }))
			: undefined;
	};
	const selected = lookup(request.ref);
	const within = lookup(request.within);
	if ((request.ref && !selected) || (request.within && !within))
		return refusal(result, "not_found_in_scope", "not_found_in_scope");
	const cursorFor = (c: Cursor["c"]) => encodeCursor({ v: 2, s: bound, r: digest, c });
	// Read dependencies come from declared projection topology, not the presence of
	// admitted or inaccessible rows. Unknown providers retain conservative coverage.
	const readKinds = new Set(relevant);
	// The declared link families a walk reads; a references answer names them (static topology).
	const linksRead = new Set<string>();
	const traversals = snapshot.traversals;
	const walk = request.operation === "neighbors" || request.operation === "references";
	if (walk || request.within) {
		if (!traversals) for (const family of families) readKinds.add(family.family);
		else if (walk) {
			const roots = new Set([request.ref?.kind ?? ""]);
			if (
				request.operation === "neighbors" &&
				request.view !== "rows" &&
				["actors", "entities"].includes(request.ref?.kind ?? "")
			) {
				roots.add("actors");
				roots.add("entities");
			}
			if (
				request.operation === "neighbors" &&
				request.ref?.kind === "place_graphs" &&
				request.view !== "rows"
			)
				roots.add("place_nodes");
			for (const link of traversals) {
				if (link.route !== request.operation) continue;
				const touches =
					request.operation === "neighbors"
						? roots.has(link.from) || roots.has(link.to)
						: roots.has((request.direction ?? "outbound") === "inbound" ? link.to : link.from);
				if (touches) linksRead.add(link.family);
				if (touches) for (const kind of [link.from, link.to, link.family]) readKinds.add(kind);
			}
		} else {
			// Context closure may visit every declared descendant of the selected container.
			const descendants = new Set([request.within?.kind ?? ""]);
			let changed = true;
			while (changed) {
				changed = false;
				for (const link of traversals)
					if (link.context && descendants.has(link.from)) {
						for (const kind of [link.from, link.to, link.family]) readKinds.add(kind);
						if (!descendants.has(link.to)) {
							descendants.add(link.to);
							changed = true;
						}
					}
			}
		}
	}
	const incomplete = [...readKinds].some(
		(kind) => families.find((x) => x.family === kind)?.state !== "complete",
	);
	result.completeness = incomplete ? "incomplete" : "complete";
	// Report only the families this request reads: an incomplete family it never touches
	// cannot change its answer, so it is neither warned about nor listed.
	// A read family with no coverage entry counts as incomplete above, so it is listed too.
	const read: ExplorationSource["coverage"] = [
		...families.filter((x) => readKinds.has(x.family)),
		...[...readKinds]
			.filter((kind) => !families.some((x) => x.family === kind))
			.map((family) => ({ family, state: "incomplete" as const })),
	];
	result.source = { ...result.source, coverage: wireCoverage(read) };
	if (request.operation === "references" && traversals)
		result.links = [...linksRead].sort(compareUtf8);
	const examined = snapshot.rows.filter((row) => readKinds.has(row.kind)).length;
	if (incomplete) result.recovery = restart;
	if (request.operation === "summary") {
		const summary = (["places", "definitions", "instances"] as const).map((collection) => {
			const kinds = Object.keys(snapshot.collections)
				.filter((kind) => snapshot.collections[kind] === collection)
				.sort(compareUtf8);
			const complete = kinds.every(
				(kind) => families.find((entry) => entry.family === kind)?.state === "complete",
			);
			const objects = collection === "instances" && request.view !== "rows";
			const unit = objects ? ("objects" as const) : ("rows" as const);
			const rows = [...admitted.values()].filter((row) => row.collection === collection);
			const tagCountsRequested =
				collection === "places" || !request.tags?.length
					? {}
					: {
							tag_counts: [...new Set(request.tags)].map((tag) => ({
								tag,
								count: (collection === "instances" ? objectRows(rows) : rows).filter((row) =>
									row.tags.includes(tag),
								).length,
							})),
						};
			// `rows` are admitted rows (the host snapshot is the admission). objectRows only
			// merges an actor with its body; definitions have no such pair and count per row.
			// --facets lists definition and object tags. Without it, definitions carry
			// `families`: the most frequent tags that do not refine another admitted tag
			// (a dot-separated parent such as a.b for a.b.c), so refinements do not crowd them out.
			const faceted =
				request.facets === true ? collection !== "places" : collection === "definitions";
			const facetLimit = request.facets ? (request.limit ?? 12) : DEFAULT_FAMILY_FACETS;
			const tagCounts = new Map<string, number>();
			if (faceted)
				for (const row of collection === "instances" ? objectRows(rows) : rows)
					for (const tag of new Set(row.tags)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
			const tags = [...tagCounts].sort(([a, x], [b, y]) => y - x || compareUtf8(a, b));
			const refines = (tag: string) => {
				for (let i = tag.lastIndexOf("."); i > 0; i = tag.lastIndexOf(".", i - 1))
					if (tagCounts.has(tag.slice(0, i))) return true;
				return false;
			};
			const ranked = request.facets ? tags : tags.filter(([tag]) => !refines(tag));
			const facetList = {
				items: ranked.slice(0, facetLimit).map(([tag, count]) => ({ tag, count })),
				more: ranked.length > facetLimit,
			};
			const facets = !faceted
				? {}
				: request.facets
					? { tag_facets: facetList }
					: { families: facetList };
			const counts = new Map<string, number>();
			for (const row of objects ? objectRows(rows) : rows)
				counts.set(row.kind, (counts.get(row.kind) ?? 0) + 1);
			const by_kind = [...counts]
				.sort(([a], [b]) => compareUtf8(a, b))
				.map(([kind, count]) => ({
					kind,
					count,
					...(!complete
						? {
								completeness:
									families.find((entry) => entry.family === kind)?.state === "complete"
										? ("complete" as const)
										: ("incomplete" as const),
							}
						: {}),
				}));
			if (!complete)
				return {
					collection,
					unit,
					completeness: "incomplete" as const,
					...tagCountsRequested,
					examined: (objects ? objectRows(rows) : rows).length,
					...(collection === "definitions" && request.facets ? { by_kind } : {}),
					...facets,
				};
			return {
				collection,
				unit,
				...facets,
				...tagCountsRequested,
				...(objects
					? {
							row_metadata: {
								actor_rows: rows.filter((row) => row.kind === "actors").length,
								entity_rows: rows.filter((row) => row.kind === "entities").length,
								tag_memberships: rows.filter((row) => row.kind === "entity_tag").length,
							},
						}
					: {}),
				completeness: "complete" as const,
				total: by_kind.reduce((sum, entry) => sum + entry.count, 0),
				...(collection !== "definitions" || request.facets ? { by_kind } : {}),
			};
		});
		// Bundles come from admitted rows only, so a live answer never names a bundle the
		// caller cannot read; a file source also lists its authored bundles without rows.
		const perBundle = new Map<string, { places: number; definitions: number; objects: number }>();
		// Rows without a bundle go to `unbundled`, so the counts add up to the totals.
		const unbundled = { places: 0, definitions: 0, objects: 0 };
		const tally = (bundle: string | undefined, key: "places" | "definitions" | "objects") => {
			if (bundle === undefined) {
				unbundled[key] += 1;
				return;
			}
			const entry = perBundle.get(bundle) ?? { places: 0, definitions: 0, objects: 0 };
			entry[key] += 1;
			perBundle.set(bundle, entry);
		};
		for (const row of admitted.values())
			if (row.collection !== "instances")
				tally(row.bundle, row.collection === "places" ? "places" : "definitions");
		for (const row of objectRows(
			[...admitted.values()].filter((r) => r.collection === "instances"),
		))
			tally(row.bundle, "objects");
		// Row-less bundles come only from a file source. A live answer names only bundles of
		// admitted rows and takes a title only for those, so an authored bundle row the caller
		// reaches no row of is never named (WE-06).
		const titles = new Map(
			(snapshot.bundles ?? [])
				.filter((entry) => sourceKind !== "live" || perBundle.has(entry.bundle))
				.map((entry) => [entry.bundle, entry.title]),
		);
		for (const bundle of titles.keys())
			if (!perBundle.has(bundle)) perBundle.set(bundle, { places: 0, definitions: 0, objects: 0 });
		const bundleIds = [...perBundle.keys()].sort(compareUtf8);
		// A truncated file bundle list (its own coverage family) cannot list every bundle.
		const bundleList = families.find((entry) => entry.family === "bundles");
		const listed = sourceKind === "live" || !bundleList || bundleList.state === "complete";
		const bundles: NonNullable<ExplorationResult["bundles"]> = {
			items: bundleIds.slice(0, SUMMARY_BUNDLE_LIMIT).map((bundle) => {
				const title = titles.get(bundle);
				const counts = perBundle.get(bundle) ?? { places: 0, definitions: 0, objects: 0 };
				return { bundle, ...(title ? { title } : {}), ...counts };
			}),
			...(unbundled.places + unbundled.definitions + unbundled.objects > 0 ? { unbundled } : {}),
			more: bundleIds.length > SUMMARY_BUNDLE_LIMIT,
			completeness: listed ? result.completeness : "incomplete",
		};
		const out: ExplorationResult = {
			...result,
			summary,
			...(bundles.items.length || bundles.unbundled ? { bundles } : {}),
			page: { complete: true },
			next: summary.map(({ collection }) => ({
				operation: "search",
				collection,
				...(request.view ? { view: request.view } : {}),
				source: sourceKind,
				source_id: token,
			})),
		};
		if (
			!request.facets ||
			(summary.some((entry) => entry.tag_facets?.more) && (request.limit ?? 12) < 100)
		)
			out.next?.push({
				operation: "summary",
				facets: true,
				...(request.tags ? { tags: request.tags } : {}),
				source: sourceKind,
				source_id: token,
				...(request.view ? { view: request.view } : {}),
				...(request.facets ? { limit: Math.min(100, (request.limit ?? 12) * 2) } : {}),
			});
		return size(out) <= EXPLORATION_BYTE_LIMIT
			? out
			: refusal(result, "unavailable", "projection_key_too_large");
	}
	/**
	 * Adds the derived envelope: visible-scope total, and at most four follow-ups
	 * built only from this request and the refs, cursors and offsets in `out`.
	 */
	const finalize = (
		out: ExplorationResult,
		reachable?: number,
		byKind?: Array<{ kind: string; count: number }>,
	): ExplorationResult => {
		const counted =
			request.operation === "search" ||
			request.operation === "neighbors" ||
			request.operation === "references";
		const page = { ...out.page, complete: out.page.next_cursor === undefined };
		delete page.total;
		if (counted && incomplete && reachable !== undefined) {
			page.examined = examined;
			page.matching = reachable;
		}
		if (allCollections) page.by_collection = matchingByCollection;
		if (counted && !incomplete && reachable !== undefined)
			page.total = {
				count: reachable,
				...((request.operation === "neighbors" && request.view !== "rows") ||
				(request.operation === "search" &&
					request.collection === "instances" &&
					!request.kind &&
					request.view !== "rows")
					? { unit: "objects" as const }
					: {}),
				...(byKind && byKind.length > 1 ? { by_kind: byKind } : {}),
			};
		const next: ExploreRequest[] = [];
		if (page.next_cursor) next.push({ ...replay, source_id: token, cursor: page.next_cursor });
		// "Reveal the truncated list": when a search page is cut and narrower than the wide page,
		// the same request with a wider limit is one ready follow-up (the total is `page.total`).
		if (
			page.next_cursor &&
			request.operation === "search" &&
			(request.limit ?? defaultLimit) < WIDE_LIMIT
		)
			next.push({ ...replay, source_id: token, limit: WIDE_LIMIT });
		for (const item of out.items)
			for (const cut of [...(item.truncated ?? [])].sort((a, b) => compareUtf8(a.field, b.field)))
				if (snapshot.fields[item.ref.kind]?.includes(cut.field))
					next.push({
						operation: "field",
						source: sourceKind,
						source_id: token,
						ref: item.ref,
						field: cut.field,
						offset: cut.shown_code_points,
					});
		const sole = out.items.length === 1 ? out.items[0] : undefined;
		const detailLinks: ExploreRequest[] = [];
		if (sole && request.operation === "detail") {
			if (snapshot.collections[sole.ref.kind] === "definitions")
				next.push({
					operation: "references",
					direction: "inbound",
					source: sourceKind,
					source_id: token,
					ref: sole.ref,
				});
			// Use an admitted declared link, never guess the target bundle from its ID.
			for (const link of snapshot.relations) {
				if (
					link.route !== "references" ||
					link.kind !== "entity_definition" ||
					!sameRef(link.from, sole.ref) ||
					!lookup(link.to)
				)
					continue;
				detailLinks.push({
					operation: "detail",
					source: sourceKind,
					source_id: token,
					ref: wireRef(link.to),
				});
			}
		}
		if (sole)
			for (const operation of [
				"detail",
				snapshot.collections[sole.ref.kind] === "definitions" ? "references" : "neighbors",
			] as const) {
				const same =
					operation === request.operation &&
					request.ref !== undefined &&
					sameRef(request.ref, sole.ref);
				if (!same) next.push({ operation, source: sourceKind, source_id: token, ref: sole.ref });
			}
		next.push(...detailLinks);
		const { next: _drop, ...rest } = out;
		return { ...rest, page, ...(next.length ? { next: next.slice(0, 4) } : {}) };
	};
	if (request.operation === "field" && selected && request.field) {
		const field = selected.fields[request.field];
		if (typeof field !== "string") return refusal(result, "unavailable", "field_without_text");
		const text = Array.from(field),
			offset = cursor?.c.t === "t" ? cursor.c.o : (request.offset ?? 0);
		if (offset > text.length) return refusal(result, "unavailable", "invalid_offset");
		const item = preview(selected, admitted, "bare");
		let end = Math.min(text.length, offset + 4096);
		do {
			item.fields = { [request.field]: text.slice(offset, end).join("") };
			const out = finalize({
				...result,
				items: [item],
				page: {
					complete: end === text.length,
					...(end < text.length ? { next_cursor: cursorFor({ t: "t", o: end }) } : {}),
				},
			});
			if (size(out) <= EXPLORATION_BYTE_LIMIT) return out;
			end = offset + Math.floor((end - offset) / 2);
		} while (end > offset);
		return refusal(result, "unavailable", "projection_key_too_large");
	}
	let entries: Entry[] = [];
	if (request.operation === "search") {
		const needle = foldExplorationText(request.text ?? "");
		// Compute the admitted containment/context closure once, instead of walking
		// all ancestors again for every candidate. Cycles terminate by identity.
		const descendants = new Set<string>();
		if (within) {
			const children = new Map<string, string[]>();
			for (const row of snapshot.rows)
				for (const parent of row.context) {
					const parentKey = explorationIdentityKey(parent);
					if (!admitted.has(parentKey)) continue;
					children.set(parentKey, [
						...(children.get(parentKey) ?? []),
						explorationIdentityKey(row),
					]);
				}
			const pending = [explorationIdentityKey(within)];
			while (pending.length) {
				const key = pending.pop();
				if (!key || descendants.has(key)) continue;
				descendants.add(key);
				pending.push(...(children.get(key) ?? []));
			}
		}
		const inside = (row: ExplorationRow) => !within || descendants.has(explorationIdentityKey(row));
		const rows =
			(searchCollection === "instances" || allCollections) &&
			!request.kind &&
			request.view !== "rows"
				? objectRows(snapshot.rows)
				: snapshot.rows;
		entries = rows
			.filter(
				(row) =>
					(searchCollection === undefined || row.collection === searchCollection) &&
					(!request.kind || row.kind === request.kind) &&
					(request.bundle === undefined || row.bundle === request.bundle) &&
					(request.tags ?? []).every((tag) => row.tags.includes(tag)) &&
					inside(row) &&
					[row.id, row.label ?? "", row.description ?? "", ...row.tags].some((text) =>
						foldExplorationText(text).includes(needle),
					),
			)
			.map((row) => {
				const tier = relevanceTier(row, needle);
				return {
					key: rowKey(
						row,
						allCollections
							? `${tier}.${row.collection === "instances" ? "0" : "1"}`
							: preferBlueprints
								? `${tier}.${row.kind === "entity_definitions" ? "0" : "1"}`
								: tier,
					),
					item: preview(row, admitted, "search", request.fields),
				};
			});
	} else if (request.operation === "detail" && selected) {
		entries = [
			{ key: rowKey(selected), item: preview(selected, admitted, "detail", request.fields) },
		];
	} else if (selected) {
		const objectView = request.operation === "neighbors" && request.view !== "rows";
		const direction = request.direction ?? "outbound",
			key = explorationIdentityKey(objectView ? canonicalObject(selected) : selected);
		const roomKeys = new Set<string>();
		if (objectView && selected.kind === "place_graphs")
			for (const relation of snapshot.relations) {
				if (
					relation.route !== "neighbors" ||
					relation.kind !== "graph_node" ||
					explorationIdentityKey(relation.from) !== key
				)
					continue;
				const room = admitted.get(explorationIdentityKey(relation.to));
				if (room?.kind === "place_nodes") roomKeys.add(explorationIdentityKey(room));
			}
		for (const relation of snapshot.relations) {
			if (relation.route !== request.operation) continue;
			const from = admitted.get(explorationIdentityKey(relation.from)),
				to = admitted.get(explorationIdentityKey(relation.to));
			if (!from || !to) continue;
			const fromKey = explorationIdentityKey(objectView ? canonicalObject(from) : from);
			const toKey = explorationIdentityKey(objectView ? canonicalObject(to) : to);
			const viaRoom =
				objectView && ["entity_location", "actor_spatial_locations"].includes(relation.kind)
					? roomKeys.has(fromKey)
						? from
						: roomKeys.has(toKey)
							? to
							: undefined
					: undefined;
			if (
				request.operation === "references" &&
				explorationIdentityKey(direction === "inbound" ? to : from) !== key
			)
				continue;
			if (request.operation === "neighbors" && fromKey !== key && toKey !== key && !viaRoom)
				continue;
			const actualDirection =
				request.operation === "neighbors"
					? fromKey === key || (viaRoom && from === viaRoom)
						? "outbound"
						: "inbound"
					: direction;
			const rawTarget = actualDirection === "outbound" ? to : from;
			const target = objectView ? canonicalObject(rawTarget) : rawTarget,
				item = preview(target, admitted, "search");
			if (objectView && target.kind === "entity_tag") continue;
			if (viaRoom) item.via = wireRef(viaRoom);
			item.relationship = { kind: relation.kind, key: relation.key, direction: actualDirection };
			entries.push({
				item,
				key: [
					"0",
					target.collection,
					target.kind,
					target.bundle ?? "",
					target.id,
					relation.kind,
					relation.key,
					actualDirection,
				],
			});
		}
		if (objectView) {
			const grouped = new Map<string, Entry>();
			for (const entry of entries) {
				const id = JSON.stringify(entry.item.ref);
				const previous = grouped.get(id);
				if (!previous) {
					entry.key = entry.key.slice(0, 5).concat(["", "", ""]);
					grouped.set(id, entry);
				} else if (entry.item.relationship) {
					const links =
						previous.item.relationships ??
						(previous.item.relationship ? [previous.item.relationship] : []);
					const link = entry.item.relationship;
					if (
						!links.some(
							(candidate) =>
								candidate.kind === link.kind &&
								candidate.key === link.key &&
								candidate.direction === link.direction,
						)
					)
						links.push(link);
					if (links.length > 1) previous.item.relationships = links;
				}
			}
			entries = [...grouped.values()];
		}
	}
	entries = [...new Map(entries.map((entry) => [JSON.stringify(entry.key), entry])).values()].sort(
		(a, b) => compareExplorationKeys(a.key, b.key),
	);
	// Every item that paging this request to completion returns under this snapshot.
	const reachable = entries.length;
	const matchingByCollection = (["places", "definitions", "instances"] as const).map(
		(collection) => ({
			collection,
			count: entries.filter(({ item }) => snapshot.collections[item.ref.kind] === collection)
				.length,
			completeness:
				(!request.within || !incomplete) &&
				Object.keys(snapshot.collections)
					.filter((kind) => snapshot.collections[kind] === collection)
					.every((kind) => families.find((entry) => entry.family === kind)?.state === "complete")
					? ("complete" as const)
					: ("incomplete" as const),
		}),
	);
	// Count the same admitted, filtered rows that paging returns, before applying the cursor.
	// Object views count their canonical representatives; raw views keep separate rows.
	const counts = new Map<string, number>();
	if (request.operation === "search" && request.collection === "instances" && !incomplete)
		for (const { item } of entries) counts.set(item.ref.kind, (counts.get(item.ref.kind) ?? 0) + 1);
	const byKind = [...counts]
		.sort(([a], [b]) => compareUtf8(a, b))
		.map(([kind, count]) => ({ kind, count }));
	const after = cursor?.c.t === "i" ? cursor.c.k : undefined;
	if (after) entries = entries.filter((entry) => compareExplorationKeys(entry.key, after) > 0);
	const limit = request.limit ?? defaultLimit;
	const pageOf = (page: Entry[]): ExplorationResult => {
		const more = page.length < entries.length;
		const last = page[page.length - 1];
		return finalize(
			{
				...result,
				items: page.map((entry) => entry.item),
				page: {
					complete: !more,
					...(more && last ? { next_cursor: cursorFor({ t: "i", k: trimKey(last.key) }) } : {}),
				},
			},
			reachable,
			byKind,
		);
	};
	const taken: Entry[] = [];
	let out = pageOf(taken);
	for (let i = 0; i < Math.min(entries.length, limit); i++) {
		const entry = entries[i];
		if (!entry) continue;
		const candidate = pageOf([...taken, entry]);
		if (size(candidate) > EXPLORATION_BYTE_LIMIT) {
			if (!taken.length) {
				const { item } = entry;
				// Drop optional previews/context first; exact identity and field routes survive.
				delete item.fields;
				delete item.description;
				delete item.label;
				item.context = [];
				const row = lookup(item.ref);
				const cuts = Object.entries(row?.fields ?? {})
					.filter(([, v]) => typeof v === "string")
					.slice(0, 16)
					.map(([field, v]) => ({
						field,
						shown_code_points: 0,
						total_code_points: Array.from(String(v)).length,
					}));
				if (cuts.length) item.truncated = cuts;
				else delete item.truncated;
				const reduced = pageOf([entry]);
				if (size(reduced) > EXPLORATION_BYTE_LIMIT)
					return refusal(result, "unavailable", "projection_key_too_large");
				return reduced;
			}
			break;
		}
		taken.push(entry);
		out = candidate;
	}
	if (!out.items.length && entries.length)
		return refusal(result, "unavailable", "projection_key_too_large");
	return out;
}
