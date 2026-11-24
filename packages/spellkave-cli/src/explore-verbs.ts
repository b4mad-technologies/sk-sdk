// `sk explore <verb>` — the human form of the shared `spellkave_query` explore request.
//
// ADR-0144 D-8/D-9: every verb is a `(parameters, run)` pair whose flags, validation and help
// derive from `deriveFlags`/`parseToolArgs`, and whose body only builds the same `ExploreRequest`
// that `sk query --json '{"explore":...}'` and MCP send. There is no second implementation.
// What is CLI-only is the encoding: `next[]` and `recovery[]` are printed as complete
// `sk explore ...` lines (AXI §9), carrying the flags that make them runnable again.

import type { ExploreRequest } from "@spellkave/tool-contracts";
import { QUERY_TOOL } from "@spellkave/tool-contracts";
import { type Static, type TSchema, Type } from "typebox";
import { deriveFlags, parseToolArgs, UsageError } from "./args.ts";
import { exploreToonShape } from "./explore-toon.ts";

const source = Type.Optional(
	Type.Union([Type.Literal("local"), Type.Literal("workspace"), Type.Literal("live")], {
		description:
			"Where to read. Default: local when --target is set, otherwise live. Never a union of sources.",
	}),
);
const sourceId = Type.Optional(
	Type.String({
		description:
			"The source_id of the answer that returned <kind> <key> (or --within-*). Required with a reference; a printed next command carries it.",
	}),
);
const bundle = Type.Optional(Type.String({ description: "The bundle of the referenced row." }));
const view = Type.Optional(
	Type.Union([Type.Literal("objects"), Type.Literal("rows")], {
		description:
			"Default objects: instance bodies once, tags separately. Use rows for the technical inventory; --kind selects rows.",
	}),
);
const paging = {
	limit: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: 100,
			description: "Page size. Default: 5 for search (best matches first), 20 otherwise.",
		}),
	),
	cursor: Type.Optional(
		Type.String({ description: "Continuation from a previous page of the same command." }),
	),
};
const kind = Type.String({
	description: "Row kind of the reference, as printed (e.g. place_nodes).",
});
const key = Type.String({ description: "Row id of the reference, as printed." });

export interface ExploreVerb {
	name: "summary" | "search" | "detail" | "neighbors" | "references" | "field";
	summary: string;
	usage: string;
	parameters: TSchema;
	positionals: readonly string[];
}

const SEARCH = Type.Object({
	view,
	text: Type.Optional(Type.String({ maxLength: 512, description: "Text to find (case-folded)." })),
	kind: Type.Optional(Type.String({ description: "Only this row kind." })),
	bundle: Type.Optional(Type.String({ description: "Only rows of this bundle." })),
	collection: Type.Optional(
		Type.Union([Type.Literal("places"), Type.Literal("definitions"), Type.Literal("instances")], {
			description:
				"Default: the collection of --kind; unrestricted text searches all collections, otherwise places. Must agree with --kind.",
		}),
	),
	tag: Type.Optional(
		Type.Array(Type.String({ maxLength: 256 }), {
			maxItems: 16,
			description: "Only rows with this tag. Repeat the flag for several.",
		}),
	),
	within_kind: Type.Optional(Type.String({ description: "Only inside this container: its kind." })),
	within_key: Type.Optional(Type.String({ description: "Only inside this container: its id." })),
	within_bundle: Type.Optional(Type.String({ description: "The container's bundle." })),
	field: Type.Optional(
		Type.Array(Type.String({ maxLength: 256 }), {
			maxItems: 16,
			description: "Scalar to show instead of the defaults. Repeat the flag for several.",
		}),
	),
	source,
	source_id: sourceId,
	...paging,
});
const DETAIL = Type.Object({
	kind,
	key,
	bundle,
	field: Type.Optional(
		Type.Array(Type.String({ maxLength: 256 }), {
			maxItems: 16,
			description: "Scalar to show instead of the defaults. Repeat the flag for several.",
		}),
	),
	source,
	source_id: sourceId,
});
const NEIGHBORS = Type.Object({ kind, key, bundle, view, source, source_id: sourceId, ...paging });
const REFERENCES = Type.Object({
	kind,
	key,
	bundle,
	direction: Type.Optional(
		Type.Union([Type.Literal("outbound"), Type.Literal("inbound")], {
			description: "Default: outbound.",
		}),
	),
	source,
	source_id: sourceId,
	...paging,
});
const FIELD = Type.Object({
	kind,
	key,
	field: Type.String({ description: "The text field to read in full." }),
	bundle,
	offset: Type.Optional(
		Type.Integer({
			minimum: 0,
			description: "Code points to skip (the shown size of a cut text).",
		}),
	),
	source,
	source_id: sourceId,
	cursor: paging.cursor,
});

export const EXPLORE_VERBS: readonly ExploreVerb[] = [
	{
		name: "summary",
		summary: "bundles, content families, counts and coverage across all collections",
		usage:
			"sk explore summary [--source local|workspace|live] [--view objects|rows] [--facets [--limit <tags>]]",
		parameters: Type.Object({
			tag: Type.Optional(
				Type.Array(Type.String({ maxLength: 256 }), {
					maxItems: 16,
					description:
						"Count this literal authored tag on definitions and objects. Repeat; default srd.player_character. Does not read live seats.",
				}),
			),
			facets: Type.Optional(
				Type.Boolean({
					description:
						"Include definition counts by kind, authored tag facets and ready-to-run filters. Default: compact counts only.",
				}),
			),
			source,
			source_id: sourceId,
			view,
			limit: Type.Optional(
				Type.Integer({
					minimum: 1,
					maximum: 100,
					description: "Maximum tag facets; default 12. Counts still cover the admitted snapshot.",
				}),
			),
		}),
		positionals: [],
	},
	{
		name: "search",
		summary: "find places, definitions or objects by text, kind, tag or container",
		usage:
			"sk explore search [<text>] [--kind <k>] [--within-kind <k> --within-key <id>] [--field <f>]...",
		parameters: SEARCH,
		positionals: ["text"],
	},
	{
		name: "detail",
		summary: "one row with its declared scalars",
		usage: "sk explore detail <kind> <key> [--field <f>]... --source-id <id>",
		parameters: DETAIL,
		positionals: ["kind", "key"],
	},
	{
		name: "neighbors",
		summary: "distinct admitted neighbors; --view rows audits each stored link",
		usage: "sk explore neighbors <kind> <key> --source-id <id>",
		parameters: NEIGHBORS,
		positionals: ["kind", "key"],
	},
	{
		name: "references",
		summary: "rows one row refers to, or (inbound) that refer to it",
		usage: "sk explore references <kind> <key> [--direction inbound] --source-id <id>",
		parameters: REFERENCES,
		positionals: ["kind", "key"],
	},
	{
		name: "field",
		summary: "the full text of one field, in bounded chunks",
		usage: "sk explore field <kind> <key> <field> [--offset n] --source-id <id>",
		parameters: FIELD,
		positionals: ["kind", "key", "field"],
	},
];

export function exploreVerb(name: string | undefined): ExploreVerb {
	const verb = EXPLORE_VERBS.find((candidate) => candidate.name === name);
	if (verb === undefined) {
		throw new UsageError(
			`sk explore: expected one of ${EXPLORE_VERBS.map((v) => v.name).join(", ")}${
				name === undefined ? "" : `, got ${JSON.stringify(name)}`
			} — run \`sk help explore\`.`,
		);
	}
	return verb;
}

const present = <T extends Record<string, unknown>>(value: T): T =>
	Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;

/** Parse one verb's argv tail into the shared request. Throws `UsageError` for caller mistakes. */
export function parseExploreArgs(verb: ExploreVerb, argv: string[]): ExploreRequest {
	const flags = deriveFlags(verb.parameters);
	const raw = parseToolArgs(flags, argv, verb.positionals) as Record<string, unknown> &
		Static<typeof SEARCH>;
	for (const spec of flags)
		if (spec.required && raw[spec.name] === undefined)
			throw new UsageError(`sk explore ${verb.name}: missing <${spec.name}> — ${verb.usage}`);
	if (verb.name === "summary") {
		if (raw.limit !== undefined && raw.facets !== true)
			throw new UsageError("sk explore summary: --limit needs --facets.");
		return present({
			operation: "summary" as const,
			tags: (raw.tag as string[] | undefined) ?? ["srd.player_character"],
			facets: raw.facets as ExploreRequest["facets"],
			view: raw.view,
			limit: raw.limit,
			source: raw.source as ExploreRequest["source"],
			source_id: raw.source_id,
		});
	}
	const common = {
		view: raw.view,
		source: raw.source as ExploreRequest["source"],
		source_id: raw.source_id as string | undefined,
		limit: raw.limit as number | undefined,
		cursor: raw.cursor as string | undefined,
	};
	if (verb.name === "search") {
		if ((raw.within_kind === undefined) !== (raw.within_key === undefined))
			throw new UsageError("sk explore search: --within-kind and --within-key go together.");
		if (raw.within_bundle !== undefined && raw.within_kind === undefined)
			throw new UsageError(
				"sk explore search: --within-bundle needs --within-kind and --within-key.",
			);
		const request = present({
			operation: "search" as const,
			...common,
			text: raw.text,
			kind: raw.kind,
			bundle: raw.bundle,
			collection: raw.collection,
			tags: raw.tag,
			fields: raw.field,
			within:
				raw.within_kind === undefined
					? undefined
					: present({
							kind: raw.within_kind,
							id: raw.within_key as string,
							bundle: raw.within_bundle,
						}),
		});
		return request as ExploreRequest;
	}
	const ref = present({
		kind: raw.kind as string,
		id: raw.key as string,
		bundle: raw.bundle,
	});
	// `--field` is one string for `field` (FIELD) and a list for `detail` (DETAIL);
	// check which one the parsed value is instead of asserting it.
	const field: unknown = raw.field;
	return present({
		operation: verb.name,
		...common,
		ref,
		direction: raw.direction,
		field: verb.name === "field" && typeof field === "string" ? field : undefined,
		fields:
			verb.name === "detail" && Array.isArray(field)
				? field.filter((f): f is string => typeof f === "string")
				: undefined,
		offset: raw.offset,
	}) as ExploreRequest;
}

/** A reference or container needs the `source_id` of the answer that returned it. */
export function requireSourceId(request: ExploreRequest): void {
	if ((request.ref || request.within) && request.source_id === undefined)
		throw new UsageError(
			"--source-id is required with a reference: copy it from the `--source-id` of a printed next or help command, or from `source.source_id` of the `--format jsonl` record of the answer that returned it.",
		);
}

const SAFE = /^[A-Za-z0-9_./:@%+=,-]+$/;
const quote = (text: string) => (SAFE.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);

/**
 * The request as one complete, runnable command line. `globals` are the global tokens the user
 * passed before the command (`--target`, `--profile`, ...); they come first, as `sk` requires.
 * Every flag it prints is one `parseExploreArgs` reads back (tested as a round trip).
 */
export function renderExploreCommand(request: ExploreRequest, globals: readonly string[]): string {
	const out: string[] = ["sk", ...globals.map(quote), "explore", request.operation];
	const flag = (name: string, value: string | number | undefined) => {
		if (value !== undefined) out.push(name, quote(String(value)));
	};
	if (request.operation === "search") {
		if (request.text !== undefined) out.push(quote(request.text));
		flag("--kind", request.kind);
		flag("--bundle", request.bundle);
		flag("--collection", request.collection);
		for (const tag of request.tags ?? []) flag("--tag", tag);
		flag("--within-kind", request.within?.kind);
		flag("--within-key", request.within?.id);
		flag("--within-bundle", request.within?.bundle);
		for (const name of request.fields ?? []) flag("--field", name);
	} else if (request.ref) {
		out.push(quote(request.ref.kind), quote(request.ref.id));
		if (request.operation === "field" && request.field !== undefined)
			out.push(quote(request.field));
		flag("--bundle", request.ref.bundle);
		flag("--direction", request.direction);
		for (const name of request.operation === "detail" ? (request.fields ?? []) : [])
			flag("--field", name);
		flag("--offset", request.offset);
	}
	flag("--source", request.source);
	if (request.facets) out.push("--facets");
	if (request.operation === "summary") for (const tag of request.tags ?? []) flag("--tag", tag);
	flag("--view", request.view);
	flag("--source-id", request.source_id);
	flag("--limit", request.limit);
	flag("--cursor", request.cursor);
	return out.join(" ");
}

/**
 * The CLI record body: the engine's answer with `next[]` and `recovery[]` re-encoded as command
 * lines. The engine and contract keep JSON requests (MCP, `sk query`); only this projection is
 * CLI-specific.
 */
export function projectExploreBody(
	body: Record<string, unknown>,
	globals: readonly string[],
): Record<string, unknown> {
	const { next, recovery, ...rest } = body as {
		next?: ExploreRequest[];
		recovery?: Array<{ tool: string; params: { explore?: ExploreRequest } }>;
	} & Record<string, unknown>;
	const nextLines = (next ?? []).map((request) => renderExploreCommand(request, globals));
	const recoveryLines = (recovery ?? []).flatMap((route) =>
		route.tool === QUERY_TOOL && route.params.explore
			? [renderExploreCommand(route.params.explore, globals)]
			: [],
	);
	return {
		...rest,
		...(nextLines.length ? { next: nextLines } : {}),
		...(recoveryLines.length ? { recovery: recoveryLines } : {}),
	};
}

/** The live world a `--source live` answer read: which profile, URL and database. */
export interface ExploreLiveTarget {
	readonly url: string;
	readonly db: string;
	/** Which tier supplied the connection: flag, context or environment. */
	readonly source: string;
	readonly profile?: string;
}

/**
 * The finished record of an explore call as the sink's format wants it. JSONL keeps the canonical
 * record (`next`/`recovery` as command lines); TOON reshapes it for reading (`explore-toon.ts`),
 * keeping default-source metadata compact while always stating completeness. A live answer
 * always leads with `target` (profile, URL, database), so a production profile is visible.
 */
export function projectExploreRecord(
	record: Record<string, unknown>,
	globals: readonly string[],
	format: "human" | "jsonl" | "toon",
	defaultSource?: ExploreRequest["source"],
	request?: ExploreRequest,
	liveTarget?: ExploreLiveTarget,
): Record<string, unknown> {
	const target = liveTarget === undefined ? {} : { target: liveTarget };
	const projected = projectExploreBody(record, globals);
	if (format !== "toon") return { ...target, ...projected };
	const source = record.source as
		| { source?: ExploreRequest["source"]; source_id?: string }
		| undefined;
	const bundles = new Set(
		((record.items ?? []) as Array<{ ref: { bundle?: string } }>).map((item) => item.ref.bundle),
	);
	const templates = [...bundles].map((bundle) =>
		renderExploreCommand(
			{
				operation: "detail",
				ref: { kind: "<kind>", id: "<key>", ...(bundle === undefined ? {} : { bundle }) },
				...(source?.source ? { source: source.source } : {}),
				...(source?.source_id === undefined || source.source_id === "unavailable"
					? {}
					: { source_id: source.source_id }),
			},
			globals,
		).replace("'<kind>' '<key>'", "<kind> <key>"),
	);
	if (request?.operation === "summary") {
		const guidance = [["sk", ...globals.map(quote), "docs", "playable-seats"].join(" ")];
		if (request.facets)
			guidance.push(
				renderExploreCommand(
					{
						operation: "search",
						collection: "definitions",
						tags: ["srd.player_character"],
						source: source?.source,
						source_id: source?.source_id,
					},
					globals,
				),
			);
		projected.guidance = guidance;
		// Each collection keeps its own facet field and `more`: object tags stay in
		// tag_facets as before; definition tags (content families such as a spell
		// list) get definition_tag_facets. --limit applies to each field separately.
		const inventories = (record.summary ?? []) as Array<{
			collection: "definitions" | "instances" | "places";
			completeness: string;
			tag_facets?: { items: Array<{ tag: string; count: number }>; more: boolean };
			families?: { items: Array<{ tag: string; count: number }>; more: boolean };
		}>;
		// The default summary keeps families compact: tag and count, one --facets command.
		const definitions = inventories.find((entry) => entry.collection === "definitions");
		if (definitions?.families) {
			const lower = definitions.completeness === "complete" ? "" : ">=";
			projected.families = definitions.families.items.map(
				(facet) => `${facet.tag} ${lower}${facet.count}`,
			);
			projected.families_more = definitions.families.more;
		}
		for (const [collection, field, scope] of [
			["instances", "tag_facets", "objects"],
			["definitions", "definition_tag_facets", "definitions"],
		] as const) {
			const inventory = inventories.find((entry) => entry.collection === collection);
			if (!inventory?.tag_facets) continue;
			projected[field] = inventory.tag_facets.items.map((facet) => ({
				...facet,
				scope,
				completeness: inventory.completeness,
				command: renderExploreCommand(
					{
						operation: "search",
						collection,
						tags: [facet.tag],
						source: source?.source,
						source_id: source?.source_id,
					},
					globals,
				),
			}));
			projected[`${field}_more`] = inventory.tag_facets.more;
		}
	}
	// Readable form only, static text: `valid` lists row kinds; content families are
	// authored tags on definitions. The canonical answer stays unchanged (no `hint`, no `next`).
	if (record.ok === false && record.reason === "unsupported_family") {
		projected.note =
			"Content families are authored tags on definitions: the summary in next lists them; then search with --collection definitions --tag <tag>.";
		projected.next = [
			renderExploreCommand(
				{
					operation: "summary",
					facets: true,
					source: source?.source,
					source_id: source?.source_id,
				},
				globals,
			),
		];
	}
	if (request?.operation === "search") {
		projected.search_scope = request.kind
			? `kind ${request.kind}`
			: (request.collection ?? (request.text ? "all collections" : "places"));
		if (
			record.ok !== false &&
			!((record.items ?? []) as unknown[]).length &&
			!request.kind &&
			(request.collection !== undefined || !request.text) &&
			!request.within
		) {
			projected.next = [
				...((projected.next ?? []) as string[]),
				...(["places", "definitions", "instances"] as const)
					.filter((collection) => collection !== (request.collection ?? "places"))
					.map((collection) =>
						renderExploreCommand(
							{
								operation: "search",
								collection,
								text: request.text,
								bundle: request.bundle,
								tags: request.tags,
								source: source?.source,
								source_id: source?.source_id,
							},
							globals,
						),
					),
			];
		}
	}
	if (request?.operation === "neighbors" && request.view !== "rows")
		projected.neighbor_root = request.ref?.kind;
	return { ...target, ...exploreToonShape(projected, templates, defaultSource) };
}
