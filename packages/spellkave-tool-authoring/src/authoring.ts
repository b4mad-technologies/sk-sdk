// embedded-manifest: {"category": "production_empty_manifest", "rationale": "the public authoring runtime deliberately constructs the canonical empty manifest baseline"}
import {
	exportGrantsToolDef,
	type GrantsPort,
	grantRoleToolDef,
	listGrantsToolDef,
	revokeRoleToolDef,
} from "./grant-tools";
import { handOverRoleToolDef, prepareHandOverToolDef } from "./hand-over-tools";
import { renderSceneToolDef, type ScenesPort, stageSceneToolDef } from "./scene-tools";

// The canonical authoring facet (co-evolution-live-agents §4, design D6/D9).
//
// The agent-facing authoring surface lives here as a portable execution package. The
// facet is the four-step flow `discover-docs → write-manifest → validate → apply`;
// this module owns the two harness-independent pieces — the tool-name vocabulary
// and **doc discovery** — while the validator/apply bindings (fs + wasm) are wired
// by the consuming runner (world-explorer's Author), keeping this package
// host-neutral.
//

import type { DocsMetadata, InstanceRead } from "@spellkave/tool-contracts";
import {
	AUTHOR_TOOL_NAMES,
	type DocsVersionEvidence,
	withDocsVersionEvidence,
} from "@spellkave/tool-contracts";
import {
	APPLY_MANIFEST_DELTA_PARAMS,
	APPLY_MANIFEST_DELTA_TOOL,
	APPLYSET_APPLY_TOOL,
	APPLYSET_DIFF_TOOL,
	CAN_I_TOOL,
	DECLARE_INEXPRESSIBLE_TOOL,
	DESCRIBE_TOOL,
	DIFF_MANIFEST_PARAMS,
	DIFF_MANIFEST_TOOL,
	DOC_GAP_PARAMS,
	DOCS_PARAMS,
	DOCS_TOOL,
	EXPORT_MANIFEST_PARAMS,
	EXPORT_MANIFEST_TOOL,
	GET_TOOL,
	INEXPRESSIBLE_PARAMS,
	NOTE_DOC_GAP_TOOL,
	REMOVE_ENTITY_PARAMS,
	REMOVE_ENTITY_TOOL,
} from "@spellkave/tool-contracts/schemas";
import {
	type BoundTool,
	bindTool,
	type FilesystemPort,
	type NodeToolCapabilities,
} from "@spellkave/tool-runtime";
import {
	authoringDocMetadata,
	type Diagnostic,
	type DiffOnlyFilter,
	diffManifests,
	extractAuthoringDocSection,
	filteredRowCount,
	filterManifestForActor,
	flattenManifestDiff,
	isSupportedAuthoringDoc,
	listAuthoringDocSections,
	listAuthoringDocs,
	parseMapKey,
	parseSchemaManifestToml,
	queryAuthoringDocs,
	type RefTagFamily,
	refTagOutboundRefs,
	renderManifestInclude,
	renderSchemaManifest,
	resolveRefTagValue,
	routeDamage,
	routeDamageMagnitude,
	type SchemaManifest,
	scopedInlineDeltaPreflight,
	splitIncludedManifestMetadata,
	stripManifestHeaders,
	validateManifestToml,
} from "@spellkave/world-author/tooling";
import type { Static, TSchema } from "typebox";
import { type ApplysetPort, applysetApplyToolDef, applysetDiffToolDef } from "./applyset-tools";
import { type AuthorTargetRef, resolveAuthorTarget } from "./author-target";
import {
	ANNOTATE_PLACE_TOOL,
	ATTACH_MAP_LAYER_TOOL,
	AUTHOR_PLACE_TOOL,
	annotatePlaceToolDef,
	attachMapLayerToolDef,
	authorPlaceToolDef,
	BIND_ACTOR_TOOL,
	BIND_EDGE_AFFORDANCE_TOOL,
	bindActorToolDef,
	bindEdgeAffordanceToolDef,
	DEFINE_ACTION_TOOL,
	DEFINE_ACTION_VERB_TOOL,
	DEFINE_AFFORDANCE_TOOL,
	DEFINE_BEHAVIOR_TOOL,
	DEFINE_BUNDLE_TOOL,
	DEFINE_CAPABILITY_TOOL,
	DEFINE_CONDITION_TOOL,
	DEFINE_CONSEQUENCE_TOOL,
	DEFINE_ENTITY_TYPE_TOOL,
	DEFINE_NICHE_TOOL,
	DEFINE_RESOURCE_TOOL,
	DEFINE_ROLL_TABLE_TOOL,
	DEFINE_SESSION_TOOL,
	DEFINE_TRACE_KIND_TOOL,
	defineActionToolDef,
	defineActionVerbToolDef,
	defineAffordanceToolDef,
	defineBehaviorToolDef,
	defineBundleToolDef,
	defineCapabilityToolDef,
	defineConditionToolDef,
	defineConsequenceToolDef,
	defineEntityTypeToolDef,
	defineNicheToolDef,
	defineResourceToolDef,
	defineRollTableToolDef,
	defineSessionToolDef,
	defineTraceKindToolDef,
	EQUIP_ITEM_TOOL,
	EVAL_TOOL,
	equipItemToolDef,
	evalToolDef,
	LINK_PLACES_TOOL,
	linkPlacesToolDef,
	MAP_GRAPH_TOOL,
	mapGraphToolDef,
	PLACE_ACTOR_TOOL,
	PLACE_ENTITY_TOOL,
	placeActorToolDef,
	placeEntityToolDef,
	QUERY_TOOL,
	queryToolDef,
	SET_METADATA_TOOL,
	SET_MOVEMENT_DEFAULT_TOOL,
	STOW_ITEM_TOOL,
	setMetadataToolDef,
	setMovementDefaultToolDef,
	stowItemToolDef,
	TAG_ENTITY_TOOL,
	tagEntityToolDef,
	WRITE_ROWS_TOOL,
	withoutRedundantScaffoldBundles,
	writeRowsToolDef,
} from "./authoring-verbs";
import { canIToolDef } from "./can-i-tools";
import { explainToolDef } from "./explain-tools";
import { describeToolDef, getToolDef } from "./get-describe-tools";
import { defineTool, type ToolDefinition, type ToolResult } from "./tool-registry.ts";

// Re-export the PoC verb tool names (#1968 "verb-based authoring tools") from
// this module too, so a consumer importing `AUTHOR_FACING_TOOL_NAMES`-adjacent
// constants doesn't also need to know about `./authoring-verbs` as a second
// entry point.
export {
	type AuthorTarget,
	type AuthorTargetApplyResult,
	type AuthorTargetLookupFilter,
	type AuthorTargetRef,
	type ManifestRow,
	resolveAuthorTarget,
} from "./author-target";
export {
	ANNOTATE_PLACE_TOOL,
	ATTACH_MAP_LAYER_TOOL,
	AUTHOR_PLACE_TOOL,
	BIND_ACTOR_TOOL,
	BIND_EDGE_AFFORDANCE_TOOL,
	TAG_ENTITY_TOOL,
	LINK_PLACES_TOOL,
	DEFINE_ACTION_TOOL,
	DEFINE_ACTION_VERB_TOOL,
	DEFINE_AFFORDANCE_TOOL,
	DEFINE_BEHAVIOR_TOOL,
	DEFINE_BUNDLE_TOOL,
	DEFINE_CAPABILITY_TOOL,
	DEFINE_CONDITION_TOOL,
	DEFINE_CONSEQUENCE_TOOL,
	DEFINE_ENTITY_TYPE_TOOL,
	DEFINE_NICHE_TOOL,
	DEFINE_RESOURCE_TOOL,
	DEFINE_ROLL_TABLE_TOOL,
	DEFINE_SESSION_TOOL,
	EQUIP_ITEM_TOOL,
	DEFINE_TRACE_KIND_TOOL,
	MAP_GRAPH_TOOL,
	QUERY_TOOL,
	EVAL_TOOL,
	PLACE_ACTOR_TOOL,
	PLACE_ENTITY_TOOL,
	SET_MOVEMENT_DEFAULT_TOOL,
	SET_METADATA_TOOL,
	STOW_ITEM_TOOL,
	WRITE_ROWS_TOOL,
};

/** Canonical ergonomic input shapes for spellkave_set_metadata callers. */
export type { SetMetadataParams, SetMetadataUpdate } from "@spellkave/tool-contracts/schemas";

// Minimal pass-throughs (`@spellkave/srd-cc` finding #1, ledger/findings.md):
// a package bound to "no direct @spellkave/world-author
// dependency, only companion-agent's re-exports" needs (1) the SAME header-
// stripping helper `packages/spellkave-srd/src/author/verb-fixture.ts` already
// uses to turn a verb-driven workspace's rendered TOML into an `[[include]]`
// fragment, and (2) the SAME whole-bundle validator every verb call already
// runs internally, but invoked directly so a consumer can prove ITS OWN fully
// assembled multi-fragment bundle (root manifest + every fragment
// concatenated) clean in one pass, not just each individual verb call in
// isolation. Both symbols were already one hop away (world-author) with no
// existing companion-agent re-export; this adds nothing new to
// `@spellkave/world-author` itself, just widens this package's own public
// surface by two names.
export {
	type Diagnostic,
	renderManifestInclude,
	splitIncludedManifestMetadata,
	stripManifestHeaders,
	validateManifestToml,
};

/** Render a standalone loader root that owns no rows and includes only the
 * named generated fragments. This keeps deployment deltas on the typed wasm
 * renderer without inventing a bundle row or embedding TOML in a generator. */
export function renderManifestIncludeRoot(includePaths: readonly string[]): string {
	return renderSchemaManifest({
		schema_version: "1.0.0",
		include: includePaths.map((path) => ({ path })),
	});
}

// Ref-tag mechanism pass-throughs (`@spellkave/srd-cc` executable finding
// #2's 2026-07-27 rename): `@spellkave/world-author` no longer seeds a
// shared `RefTagFamily` vocabulary — a content package declaring its own
// families (e.g. `@spellkave/srd-cc`'s `src/ref-tag-families.ts`) needs the
// TYPE plus the two functions that consume it, through this package's own
// re-exports only (no direct `@spellkave/world-author` dependency per this
// package's "one authoring engine" invariant). `resolveRefTagValue` /
// `refTagOutboundRefs` are also usable directly (bypassing `spellkave_query`)
// wherever a caller wants ref-tag resolution today, since the tool layer
// itself threads no families yet (see `authoring-verbs.ts`'s
// `resolveQueryDetail` comment).
export { type RefTagFamily, refTagOutboundRefs, resolveRefTagValue };

// Damage-routing pass-through (operator ruling 2026-08-13): a content package authoring a weapon-
// like item's own `entity_definition_item_dsl_source` slot needs the bare
// positive damage-magnitude ladder (`@spellkave/world-author`'s
// `damage-type-routing.md` pattern, un-negated sibling of `routeDamage`)
// through this package's own re-export surface only — same "no direct
// @spellkave/world-author dependency" posture as the
// `stripManifestHeaders`/`validateManifestToml` pass-throughs above.
// `routeDamage` (negated, write-site) is the spell/trap form — re-exported
// for BL-57 spell adoption (srd-cc spell-behaviors).
export { routeDamage, routeDamageMagnitude };

/**
 * The four-step authoring facet, named so the flow is greppable and stable. The
 * Author drives them in order: discover the doc set, write a manifest, validate it
 * in-process against the server's validator, apply the validated bundle.
 */
export const AUTHORING_FACET_STEPS = [
	"discover-docs",
	"write-manifest",
	"validate",
	"apply",
] as const;
export type AuthoringFacetStep = (typeof AUTHORING_FACET_STEPS)[number];

/** Resolve the repo root from this module's location (package is 3 dirs deep). */
export function repoRoot(_filesystem: FilesystemPort): string {
	throw new Error("repoRoot is a Node host convenience; compose it in the host adapter.");
}

/**
 * Discover the Author's packaged reference set as stable corpus ids, sorted for
 * determinism. The corpus lives in `@spellkave/world-author`; this package keeps
 * the tool names stable while avoiding filesystem globbing.
 */
export function discoverDocs(_root?: string): string[] {
	return listAuthoringDocs()
		.filter(isSupportedAuthoringDoc)
		.map((doc) => doc.id)
		.sort();
}

/**
 * Load the packaged doc set as one concatenated reference string. Kept for
 * compatibility with older author prompts that expect framed bodies.
 */
export function loadAuthoringDocs(_root?: string): string {
	return listAuthoringDocs()
		.filter(isSupportedAuthoringDoc)
		.map((doc) => `===== ${doc.id} =====\n${doc.body}`)
		.join("\n\n");
}

// --- Doc index + deterministic doc-query (the pull-not-dump retrieval, design D1/D2). ---
//
// The Author no longer carries the whole corpus. It carries a compact INDEX (what
// docs exist) and PULLS the body it needs through `query-docs`. Retrieval is a
// simple, offline, deterministic keyword/heading ranking over the DISCOVERED set —
// no LLM, no embeddings (OQ-1). The firewall is structural: every candidate comes
// from `discoverDocs`, so a result can NEVER originate outside the packaged
// `@spellkave/world-author` corpus.

/** One row of the bounded doc index: a discovered path and its title. */
export interface DocIndexEntry {
	metadata?: DocsMetadata;
	/** General-to-specific navigation group used by human index renderers. */
	topic: string;
	/** Stable packaged corpus id, e.g. `dsl-grammar`. */
	rel: string;
	/** Human-readable corpus title. */
	title: string;
	/** Corpus kind (`guide` | `reference` | `example` | `repair`). */
	kind: string;
	/** One-line summary from corpus metadata. */
	summary: string;
	/**
	 * Whether this doc is backed by a worked manifest (#1983). The index and
	 * hit shapes advertise it rather than carrying the TOML, so a caller learns
	 * a copyable example exists without every result paying for one — then
	 * fetches it by id through the `doc` shape.
	 */
	has_example: boolean;
}

/**
 * A scored doc hit from {@link queryDocs}.
 * Progressive exposure: hits carry summary + short excerpt only — never the
 * full body (pull that with `doc` / `section` / `full`).
 */
export interface DocQueryHit {
	metadata?: DocsMetadata;
	rel: string;
	title: string;
	kind: string;
	summary: string;
	/** Relevance score (higher = more keyword/heading matches). */
	score: number;
	/**
	 * Short excerpt of the matched doc (token-cheap). Same text is also
	 * mirrored on `body` for older callers that still read `body`.
	 */
	excerpt: string;
	/** Alias of {@link excerpt} — NOT the full packaged body. */
	body: string;
	/** Full packaged body size in characters (so callers know the cost of `--doc`). */
	body_chars: number;
	/** See {@link DocIndexEntry.has_example}. */
	has_example: boolean;
}

/**
 * One doc fetched by id (#1983). Default progressive path for large docs is
 * outline (headings) unless `section` or `full` is set.
 */
export interface DocFetchResult {
	/** Additive provenance; absent server evidence stays explicitly unknown. */
	metadata?: DocsMetadata;
	rel: string;
	title: string;
	kind: string;
	summary: string;
	tags: string[];
	body: string;
	/** Present when the caller requested a single section. */
	section?: string;
	section_anchor?: string;
	/** True when this payload is headings-only (oversized doc without section/full). */
	outline?: boolean;
	/** Heading outline for navigation (always present on outline; often on oversized full too). */
	headings?: string[];
	/** Full body character count before any truncation/outline substitution. */
	body_chars?: number;
	/** True when the full body exceeds {@link DOC_OVERSIZE_CHARS} and was not force-fetched. */
	oversized?: boolean;
	/** Next-step hint when outline/oversized gates fire. */
	hint?: string;
	/**
	 * Structured tool index for `tool-reference` outlines — name/label/summary
	 * per AUTHOR verb (not nested heading spam).
	 */
	tools?: Array<{ name: string; label: string; summary: string }>;
	walkthrough?: string;
	toml?: string;
	expectedDiagnostics?: string[];
}

export interface DocQueryOptions {
	/** Optional corpus-id filter (substring match). Narrows the packaged set. */
	docPaths?: string[];
	/** Max number of doc slices to return. Default 3. */
	limit?: number;
}

const DEFAULT_QUERY_LIMIT = 3;
/** Hit excerpt budget — enough to orient, cheap enough for top-N fanout. */
export const DOC_EXCERPT_CHARS = 600;
/**
 * Full-doc body over this size defaults to outline unless `section` or `full`
 * is set (~2k tokens at 4 chars/token).
 */
export const DOC_OVERSIZE_CHARS = 8000;

/** First ~n chars of prose on a paragraph boundary when possible. */
export function excerptDocBody(body: string, maxChars = DOC_EXCERPT_CHARS): string {
	const trimmed = body.trim();
	if (trimmed.length <= maxChars) return trimmed;
	const slice = trimmed.slice(0, maxChars);
	const breakAt = Math.max(
		slice.lastIndexOf("\n\n"),
		slice.lastIndexOf(". "),
		slice.lastIndexOf("\n"),
	);
	const cut = breakAt > maxChars * 0.5 ? slice.slice(0, breakAt + 1) : slice;
	return `${cut.trimEnd()}…`;
}

const DOC_TOPIC_ORDER = [
	"Start here",
	"Guides",
	"Reference",
	"Troubleshooting",
	"Worked examples",
] as const;

function docTopic(doc: ReturnType<typeof listAuthoringDocs>[number]): string {
	if (doc.id === "onramp") return "Start here";
	switch (doc.kind) {
		case "guide":
			return "Guides";
		case "reference":
			return "Reference";
		case "repair":
			return "Troubleshooting";
		case "example":
			return "Worked examples";
	}
}

/**
 * The bounded index of the packaged corpus — topic + id + title for every
 * authoring doc. Topics run from general orientation to specific examples;
 * entries remain alphabetical within each topic.
 */
export function docIndex(_root?: string): DocIndexEntry[] {
	return listAuthoringDocs()
		.filter(isSupportedAuthoringDoc)
		.map((doc) => ({
			metadata: authoringDocMetadata(doc.id, ""),
			topic: docTopic(doc),
			rel: doc.id,
			title: doc.title,
			kind: doc.kind,
			summary: doc.summary,
			has_example: doc.toml !== undefined,
		}))
		.sort((left, right) => {
			const topic =
				DOC_TOPIC_ORDER.indexOf(left.topic as (typeof DOC_TOPIC_ORDER)[number]) -
				DOC_TOPIC_ORDER.indexOf(right.topic as (typeof DOC_TOPIC_ORDER)[number]);
			if (topic !== 0) return topic;
			return left.rel < right.rel ? -1 : left.rel > right.rel ? 1 : 0;
		});
}

/**
 * Fetch ONE doc whole by its exact corpus id — the direct-fetch shape beside
 * `docIndex` (browse) and {@link queryDocs} (search). Same firewall as every
 * other path here: the id is resolved against the packaged corpus, so a result
 * can never originate outside it.
 */

/** First sentence / clause of a description, capped. */
function firstSummaryLine(text: string, max = 160): string {
	const flat = text.replace(/\s+/g, " ").trim();
	if (flat.length === 0) return "";
	const m = /^(.+?[.!?])(?:\s|$)/.exec(flat);
	const sentence = (m?.[1] ?? flat).trim();
	return sentence.length <= max ? sentence : `${sentence.slice(0, max - 1)}…`;
}

/**
 * Parse the generated tool-reference body into one row per top-level tool
 * (`## \`name\``), with label + one-line summary — the index humans and agents
 * should see instead of every nested Example/field heading.
 */
export function parseToolReferenceCatalog(
	body: string,
): Array<{ name: string; label: string; summary: string }> {
	const lines = body.split("\n");
	const tools: Array<{ name: string; label: string; summary: string }> = [];
	let i = 0;
	while (i < lines.length) {
		const heading = /^## `([^`]+)`\s*$/.exec(lines[i] ?? "");
		if (!heading) {
			i += 1;
			continue;
		}
		const name = heading[1] ?? "";
		i += 1;
		let label = name;
		const prose: string[] = [];
		while (i < lines.length && !/^## /.test(lines[i] ?? "")) {
			const line = lines[i] ?? "";
			const labelMatch = /^\*\*([^*]+)\*\*/.exec(line.trim());
			if (labelMatch && prose.length === 0 && label === name) {
				// Generated shape: **Label** — execution mode `…`. Description is the NEXT paragraph.
				label = (labelMatch[1] ?? name).trim();
				i += 1;
				continue;
			}
			// Stop at parameter tables / examples — summary is the lead prose only.
			if (line.startsWith("|") || line.startsWith("### ") || line.startsWith("```")) {
				break;
			}
			if (line.trim() !== "") prose.push(line.trim());
			i += 1;
		}
		tools.push({
			name,
			label,
			summary: firstSummaryLine(prose.join(" ")),
		});
	}
	return tools;
}

function renderToolReferenceIndex(
	tools: Array<{ name: string; label: string; summary: string }>,
): string {
	const rows = tools
		.map((tool) => `| \`${tool.name}\` | ${tool.label} | ${tool.summary.replace(/\|/g, "\\|")} |`)
		.join("\n");
	return [
		"# Tool reference — AUTHOR verbs",
		"",
		`${tools.length} tools. Open one with \`sk docs tool-reference <tool>\` (e.g. \`sk docs tool-reference spellkave_define_session\`).`,
		"",
		"| Tool | Label | Summary |",
		"|---|---|---|",
		rows,
		"",
		"_Parameter tables and executed examples live on each tool page — not in this index._",
	].join("\n");
}

export function fetchDoc(
	id: string,
	opts: {
		section?: string;
		outline?: boolean;
		full?: boolean;
		versionEvidence?: Readonly<DocsVersionEvidence>;
	} = {},
):
	| DocFetchResult
	| undefined
	| { error: "unknown_section"; id: string; section: string; headings: string[] } {
	const doc = listAuthoringDocs().find((candidate) => candidate.id === id);
	if (doc === undefined) return undefined;
	const headings = listAuthoringDocSections(doc.body).map((s) => s.heading);
	const bodyChars = doc.body.length;
	const oversized = bodyChars > DOC_OVERSIZE_CHARS;
	const metadataFor = (body: string) =>
		withDocsVersionEvidence(authoringDocMetadata(id, body), opts.versionEvidence);

	// Explicit section always wins (token-cheap progressive step).
	if (opts.section !== undefined && opts.section.trim() !== "") {
		const hit = extractAuthoringDocSection(doc.body, opts.section);
		if (hit === undefined) {
			return {
				error: "unknown_section",
				id,
				section: opts.section,
				headings,
			};
		}
		return {
			rel: doc.id,
			metadata: metadataFor(hit.body),
			title: doc.title,
			kind: doc.kind,
			summary: doc.summary,
			tags: doc.tags,
			body: hit.body,
			section: hit.heading,
			section_anchor: hit.anchor,
			body_chars: bodyChars,
			headings,
		};
	}

	// Outline-only (explicit, or default for oversized docs without --full).
	const wantOutline = opts.outline === true || (oversized && opts.full !== true);
	if (wantOutline) {
		// tool-reference: clean verb index (name/label/summary), not nested heading spam.
		if (doc.id === "tool-reference") {
			const tools = parseToolReferenceCatalog(doc.body);
			return {
				rel: doc.id,
				metadata: metadataFor(""),
				title: doc.title,
				kind: doc.kind,
				summary: doc.summary,
				tags: doc.tags,
				body: renderToolReferenceIndex(tools),
				outline: true,
				tools,
				headings: tools.map((tool) => tool.name),
				body_chars: bodyChars,
				oversized: true,
				hint: "sk docs tool-reference <tool>   # e.g. sk docs tool-reference spellkave_define_session",
			};
		}
		const outlineBody = [
			`# ${doc.title}`,
			"",
			doc.summary,
			"",
			"## Headings",
			...headings.map((h) => `- ${h}`),
			"",
			`_Full body is ${bodyChars} chars. Open one heading with \`--section "<heading>"\`, or pass \`--full\` only if you need the entire document._`,
		].join("\n");
		return {
			rel: doc.id,
			metadata: metadataFor(""),
			title: doc.title,
			kind: doc.kind,
			summary: doc.summary,
			tags: doc.tags,
			body: outlineBody,
			outline: true,
			headings,
			body_chars: bodyChars,
			oversized: oversized || undefined,
			hint: `sk docs --doc ${doc.id} --section "<heading>"  # or --full`,
			// Worked manifests stay on the doc payload even in outline mode (#1983).
			...(doc.walkthrough === undefined ? {} : { walkthrough: doc.walkthrough }),
			...(doc.toml === undefined ? {} : { toml: doc.toml }),
			...(doc.expectedDiagnostics === undefined
				? {}
				: { expectedDiagnostics: doc.expectedDiagnostics }),
		};
	}

	// Full body (small docs, or oversized with explicit --full).
	return {
		rel: doc.id,
		metadata: metadataFor(doc.body),
		title: doc.title,
		kind: doc.kind,
		summary: doc.summary,
		tags: doc.tags,
		body: doc.body,
		body_chars: bodyChars,
		headings: oversized ? headings : undefined,
		oversized: oversized || undefined,
		hint: oversized
			? `Large doc (${bodyChars} chars). Prefer --section; you forced --full.`
			: undefined,
		...(doc.walkthrough === undefined ? {} : { walkthrough: doc.walkthrough }),
		...(doc.toml === undefined ? {} : { toml: doc.toml }),
		...(doc.expectedDiagnostics === undefined
			? {}
			: { expectedDiagnostics: doc.expectedDiagnostics }),
	};
}

/** Render {@link docIndex} as a compact `- path — title` list for a prompt. */
export function renderDocIndex(root?: string): string {
	return docIndex(root)
		.map((e) => `- ${e.rel} — ${e.title}`)
		.join("\n");
}

/**
 * Deterministic retrieval over the packaged authoring corpus. No LLM, no
 * embeddings — offline-testable. Hits are summary + short excerpt only
 * (progressive exposure); pull a full/section body with `fetchDoc` / `--doc`.
 */
export function queryDocs(query: string, opts: DocQueryOptions = {}): DocQueryHit[] {
	const limit = opts.limit && opts.limit > 0 ? Math.trunc(opts.limit) : DEFAULT_QUERY_LIMIT;
	const allowed = opts.docPaths
		? new Set(discoverDocs().filter((id) => opts.docPaths?.some((p) => id === p || id.includes(p))))
		: undefined;
	// Narrow FIRST, truncate second. `docPaths` is documented as restricting
	// the SEARCH ("can only narrow the corpus"), so it has to be applied to the
	// candidate set, not to an already-truncated result page.
	const qLower = query.toLowerCase();
	const wantsReferenceBulk =
		/\b(tool[- ]?reference|verb schema|parameter reference|row reference|manifest-format|dsl-grammar)\b/.test(
			qLower,
		);
	const ranked = queryAuthoringDocs(query, Number.MAX_SAFE_INTEGER)
		.filter((hit) => !allowed || allowed.has(hit.item.id))
		.map((hit) => {
			let score = hit.score;
			const item = hit.item;
			// Downrank giant reference dumps unless the query is explicitly about them.
			// Never wipe a positive base score to ≤0 — docPaths narrowing must still
			// surface the named doc even when it is a large reference.
			if (!wantsReferenceBulk && item.body.length > DOC_OVERSIZE_CHARS) {
				score -= 2;
			}
			if (!wantsReferenceBulk && item.id === "tool-reference") {
				score -= 3;
			}
			if (
				!wantsReferenceBulk &&
				item.kind === "reference" &&
				item.body.length > DOC_OVERSIZE_CHARS / 2
			) {
				score -= 1;
			}
			if (hit.score > 0 && score <= 0) score = 0.25;
			return { item, score };
		})
		.filter((hit) => hit.score > 0)
		.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id));
	return ranked.slice(0, limit).map((hit) => {
		const excerpt = excerptDocBody(hit.item.body);
		return {
			metadata: authoringDocMetadata(hit.item.id, ""),
			rel: hit.item.id,
			title: hit.item.title,
			kind: hit.item.kind,
			summary: hit.item.summary,
			score: hit.score,
			excerpt,
			body: excerpt,
			body_chars: hit.item.body.length,
			has_example: hit.item.toml !== undefined,
		};
	});
}

/** The merged tool's three shapes: the bounded index, ranked hits, or one whole doc. */
export type DocsResult = { metadata?: DocsMetadata } & (
	| { shape: "index"; index: DocIndexEntry[] }
	| { shape: "hits"; hits: DocQueryHit[] }
	| { shape: "doc"; doc: DocFetchResult }
	| { shape: "doc"; ok: false; doc: null; unknown_id: string; index: DocIndexEntry[] }
	| {
			shape: "doc";
			ok: false;
			doc: null;
			unknown_section: string;
			doc_id: string;
			headings: string[];
	  }
);

/** Resolve the merged tool's shape: `doc` => one doc, else `query` => hits, else index. */
export function resolveDocsResult(
	params: Static<typeof DOCS_PARAMS>,
	versionEvidence?: Readonly<DocsVersionEvidence>,
): DocsResult {
	const envelopeMetadata = (id = "index") =>
		withDocsVersionEvidence(authoringDocMetadata(id, ""), versionEvidence);
	const index = () =>
		docIndex().map((entry) => ({
			...entry,
			metadata: withDocsVersionEvidence(entry.metadata, versionEvidence),
		}));
	if (params.doc !== undefined) {
		const doc = fetchDoc(params.doc, {
			section: params.section,
			outline: params.outline,
			full: params.full,
			versionEvidence,
		});
		// An unknown id answers WITH the bounded index — the caller's next move
		// is always "which ids exist", and making them ask again for it is a
		// wasted round trip. It still reports `ok: false`, because being helpful
		// about a miss must not make the miss look like a hit: a shell caller
		// gating on `$?` (and the `sk` exit-code mapping) has to see a failure.
		if (doc === undefined) {
			return {
				shape: "doc",
				metadata: envelopeMetadata(),
				ok: false,
				doc: null,
				unknown_id: params.doc,
				index: index(),
			};
		}
		if ("error" in doc && doc.error === "unknown_section") {
			return {
				shape: "doc",
				metadata: envelopeMetadata(params.doc),
				ok: false,
				doc: null,
				unknown_section: doc.section,
				doc_id: doc.id,
				headings: doc.headings,
			};
		}
		return { shape: "doc", metadata: envelopeMetadata(params.doc), doc: doc as DocFetchResult };
	}
	if (params.query === undefined) {
		return { shape: "index", metadata: envelopeMetadata(), index: index() };
	}
	return {
		shape: "hits",
		metadata: envelopeMetadata(),
		hits: queryDocs(params.query, { docPaths: params.doc_paths, limit: params.limit }).map(
			(hit) => ({ ...hit, metadata: withDocsVersionEvidence(hit.metadata, versionEvidence) }),
		),
	};
}

export type AuthorToolResult<T> = ToolResult<T>;

function authoringToolResult<T>(details: T): AuthorToolResult<T> {
	return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
}

// `defineTool`/`toAgentTool` (`./tool-registry`, issue #1380) is the same
// single-registration-point helper `tools.ts` uses; here the host "context" is
// just the corpus root path (`root: string`) rather than a `SpellkaveToolContext`.

const docsToolDef = defineTool({
	contract: DOCS_TOOL,
	schema: DOCS_PARAMS,
	exampleParams: {},
	run: async (_root: string, params: Static<typeof DOCS_PARAMS>) =>
		authoringToolResult(resolveDocsResult(params)),
});

/**
 * `spellkave_docs` tool: dual-shape doc orientation. No `query` => the bounded
 * doc index; `query` => ranked summary+excerpt hits; `doc` => section/outline/full.
 * Progressive exposure keeps token use bounded (design D1/D2/D6 + token gate).
 * Reads ONLY the packaged `@spellkave/world-author` corpus.
 */
export function createDocsTool(
	root = "",
): BoundTool<typeof DOCS_PARAMS, AuthorToolResult<DocsResult>> {
	return bindTool(docsToolDef, { context: root, capabilities: {} });
}

// --- The AUTHOR-facing tool subset (unified-authoring spike D4/Q6, #1968 phase 5). ---
//
// Mirrors the PLAYER subset (`playerFacingToolDefinitions` in `tools.ts`) exactly in
// shape: one `AuthorToolContext` every tool in the subset binds against, a superset
// `authorFacingToolDefinitions` tuple, a derived `AUTHOR_FACING_TOOL_NAMES` list, and
// `createAuthorFacingTools(context)`. "One package for all author operations" (D4)
// applies to the OPS — `@spellkave/world-author` (Rust-backed wasm sugar) — this
// module stays thin `defineTool` wrappers over those ops, exactly like the two
// doc-pull tools above.

/**
 * Host-provided scratch-bundle persistence. Bound lazily (a function reference, not
 * a materialized value) so the SAME tool definitions work against any host's
 * storage — the Pi extension backs this with a cwd-derived scratch directory
 * (`workspace.ts`), a test backs it with an in-memory string. `writeToml` returns a
 * location descriptor (e.g. the bundle dir) for the tool result, mirroring
 * `DmMutationPort`'s admission-result convention.
 */
/** One successful `r_export_manifest` row, as the live port returns it. */
export interface ManifestExportRow {
	bundleId: string;
	status: string;
	rowCount: number;
	diagnostics: string;
	manifestJson: string;
}

export interface AuthorWorkspace {
	/** Current scratch-bundle TOML, or `null` if nothing has been written yet. */
	readToml(): string | null;
	/**
	 * Persist `toml` as the scratch bundle. Host-owned: the ONE fence the
	 * validator does not itself hold — "never poison the core profile" — is
	 * this function's job to enforce (mirrors world-explorer's
	 * `assertScratchTomlShape`, moved host-side since it is policy, not
	 * validation). Throws on a shape violation; callers catch and surface it
	 * as a rejection rather than writing a poisoned bundle.
	 */
	writeToml(toml: string): string;
}

/**
 * A finding the AUTHOR subset routes out via callback rather than shared mutable
 * state, so a host (or a test) observes findings without polling a run-state
 * object. Mirrors `spellkave_declare_inexpressible`/`spellkave_note_doc_gap`'s
 * legacy world-explorer behavior of pushing onto an `AuthorRunState` array, but as
 * a push (callback) instead of a pull (shared array) — the host decides what to do
 * with a finding (log it, persist it, forward it upstream).
 */
export type AuthorFinding =
	| { kind: "doc_gap"; doc: string; expected: string; actual: string }
	| { kind: "inexpressible"; reason: string };

/**
 * Host context the AUTHOR-facing subset binds against (parallel to
 * `SpellkaveToolContext` for the PLAYER subset). `applyDelta` is OPTIONAL: its
 * absence is the offline-authoring floor (write/patch/inspect/declare/note-doc-gap
 * work with no live connection at all); its presence is the connected floor that
 * additionally unlocks `spellkave_apply_manifest_delta`. See
 * `AUTHOR_OFFLINE_TOOL_NAMES` for the subset a host can activate with no
 * connection.
 */
export interface AuthorToolContext {
	scenes?: ScenesPort;
	grants?: GrantsPort;
	/** Admitted exploration snapshots only; never raw live database fallback. */
	exploration?: import("./exploration").ExplorationPort;
	workspace: AuthorWorkspace;
	/** Node hosts opt into file persistence through this narrow runtime capability. */
	filesystem?: FilesystemPort;
	/** Route a `declare_inexpressible`/`note_doc_gap` finding to the host. */
	onFinding?: (finding: AuthorFinding) => void;
	/**
	 * Dispatch a manifest-delta TOML to the live driver (ADR-0034 D-6/D-8,
	 * `r_apply_manifest_delta`, upsert semantics, validated server-side against
	 * live world ∪ delta). Landing in parallel (#1968 phase 3) — this package
	 * binds ONLY this port shape; absent = offline authoring, no live port at all.
	 */
	applyDelta?: (toml: string) => Promise<{ ok: boolean; detail?: string }>;
	/**
	 * Optional live read-model cache (#1968 phase 5 PoC — the verb tools in
	 * `./authoring-verbs`), mirroring the PLAYER subset's `SpellkaveToolContext.db`
	 * exactly (a value or a thunk, since a live connection's snapshot changes over
	 * time). Absent = `spellkave_query` answers from the workspace scratch bundle
	 * only (it says so in its result's `source` field); present = it ALSO reads the
	 * live world's catalog/vocabulary tables. Every other AUTHOR tool ignores this
	 * field entirely — only the PoC verbs consult it.
	 */
	db?:
		| import("./author-target.ts").AuthorSnapshotDb
		| (() => import("./author-target.ts").AuthorSnapshotDb | undefined);
	/**
	 * The connection-level backend (#1968 "Decision: connection-level target for
	 * the author tools") every write verb's reference checks run against
	 * (workspace FIRST, then this target when present) and
	 * `spellkave_apply_manifest_delta` flushes to when set. Absent = today's
	 * workspace-only behavior, fully backward compatible — every AUTHOR tool
	 * that predates this field keeps working unchanged with no `target` wired.
	 * `db`/`applyDelta` above are UNCHANGED (still the legacy live-only seam a
	 * host may wire directly); `target` supersedes them for hosts that wire it.
	 * A value OR a thunk (mirrors `db` above) — a host whose active target
	 * changes over the context's lifetime (e.g. Pi's connect/disconnect
	 * toggling live vs. a configured local folder) wires a thunk.
	 */
	target?: AuthorTargetRef;
	/** Same-session identity projection for binding explanations; absent means redacted. */
	explainDisclosure?: import("@spellkave/world-author/tooling").ExplainDisclosure;
	/**
	 * Live `r_export_manifest` port (sk-0m4.43, ADR-0149). Absent =
	 * `spellkave_export` refuses as not-connected. The reducer answers the
	 * module publisher only; a non-publisher is refused with MF-EXPORT-001.
	 * Hosts that already wire `--live` pass the same session they use for
	 * `applyDelta`.
	 */
	exportManifest?: (bundleId: string) => Promise<ManifestExportRow>;
	/**
	 * Live applyset port (ADR-0145): reads the world's applyset memory and
	 * sends one `r_apply_bundle` call. Absent = `spellkave_applyset_diff` and
	 * `spellkave_applyset_apply` refuse as not connected.
	 */
	applyset?: ApplysetPort;
	/** Live admission probe. Absent = spellkave_can_i refuses as no reachable world. */
	canI?: import("./can-i-tools").CanIPort;
	/**
	 * Explicit publisher or isolated caller-scoped instance reader for
	 * `spellkave_get` / `spellkave_describe`, also on CLI `LiveConnection`.
	 * Scoped answers carry their admitted source and coverage. An absent port
	 * refuses without an export fallback or arbitrary `context.db` access.
	 */
	readInstance?: InstanceRead;
	/**
	 * Optional configured local-folder target, independent of {@link target}.
	 * When a PLAYER/live connection is active, hosts often wire `target` to
	 * `live` — `spellkave_query`/`map_graph` with `target: "local"` still need
	 * the configured author.target directory. Absent = local override unavailable.
	 */
	localTarget?: AuthorTargetRef;
	/**
	 * #1968 verb-UX round ("smart defaults" — `bundle_id` from context): the
	 * workspace/connection-level default `bundle` every write verb's own
	 * `bundle` param falls back to when the CALLER omits it. A value or a
	 * thunk (mirrors `db`/`target` above) — a host authoring a single-bundle
	 * session (e.g. the core-fixture generator, a Pi workspace scoped to one
	 * mod) wires this once instead of repeating `bundle: "<id>"` on every
	 * call; a host juggling multiple bundles in one session simply omits it
	 * and every verb call keeps passing `bundle` explicitly (fully backward
	 * compatible — no host that predates this field is affected). Per-call
	 * `bundle` ALWAYS wins when both are present.
	 */
	defaultBundle?: string | (() => string | undefined);
}

// The doc tool already exists above bound to a bare `root: string` context
// (back-compat: `createDocsTool` is used individually, e.g. by the legacy
// world-explorer author). The AUTHOR-subset registry needs every definition
// bound to the SAME `AuthorToolContext`, so this is a thin re-wrap sharing the
// label/description/params of the original (single source of truth) with a
// `run` that ignores the richer context and calls the same pure functions.

const authorDocsToolDef = defineTool({
	contract: DOCS_TOOL,
	schema: DOCS_PARAMS,
	exampleParams: docsToolDef.exampleParams,
	run: async (_context: AuthorToolContext, params: Static<typeof DOCS_PARAMS>) =>
		authoringToolResult(resolveDocsResult(params)),
});

const declareInexpressibleToolDef = defineTool({
	contract: DECLARE_INEXPRESSIBLE_TOOL,
	schema: INEXPRESSIBLE_PARAMS,
	exampleParams: {
		reason:
			"No documented row kind expresses a resource pool that regenerates on a delay after combat ends — every recovery_rule is a fixed enum (e.g. long_rest/short_rest), not a scheduled predicate.",
	},
	run: async (context: AuthorToolContext, params: Static<typeof INEXPRESSIBLE_PARAMS>) => {
		context.onFinding?.({ kind: "inexpressible", reason: params.reason });
		return authoringToolResult({ reason: params.reason });
	},
});

const noteDocGapToolDef = defineTool({
	contract: NOTE_DOC_GAP_TOOL,
	schema: DOC_GAP_PARAMS,
	exampleParams: {
		doc: "manifest-format",
		expected: "resource_definitions.recovery_rule accepts an arbitrary string.",
		actual: "The validator rejects any recovery_rule outside the documented closed set.",
	},
	run: async (context: AuthorToolContext, params: Static<typeof DOC_GAP_PARAMS>) => {
		context.onFinding?.({
			kind: "doc_gap",
			doc: params.doc,
			expected: params.expected,
			actual: params.actual,
		});
		return authoringToolResult(params);
	},
});

const removeEntityToolDef = defineTool<
	AuthorToolContext,
	typeof REMOVE_ENTITY_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: REMOVE_ENTITY_TOOL,
	schema: REMOVE_ENTITY_PARAMS,
	requiredCapabilities: ["node"],
	run: async (context, params) => {
		const target = resolveAuthorTarget(context.target);
		if (target?.kind !== "local" || target.removeEntity === undefined)
			return authoringToolResult({
				ok: false,
				detail:
					"remove_entity requires an active local target (--target); no world or file changes were sent.",
			});
		const result = await target.removeEntity(params.entity_key, context.workspace);
		return authoringToolResult({
			...result,
			entity_key: params.entity_key,
			target: "local",
			sent: false,
		});
	},
});

const applyManifestDeltaToolDef = defineTool<
	AuthorToolContext,
	typeof APPLY_MANIFEST_DELTA_PARAMS,
	unknown
>({
	contract: APPLY_MANIFEST_DELTA_TOOL,
	schema: APPLY_MANIFEST_DELTA_PARAMS,
	exampleParams: {},
	run: async (context: AuthorToolContext, params: Static<typeof APPLY_MANIFEST_DELTA_PARAMS>) => {
		const explicitToml = params.toml;
		const source: "scratch" | "toml" =
			explicitToml !== undefined && explicitToml.length > 0 ? "toml" : "scratch";
		let toml: string;
		if (source === "toml") {
			toml = explicitToml as string;
		} else {
			const scratch = context.workspace.readToml();
			if (scratch === null || scratch.trim().length === 0) {
				throw new Error(
					`${APPLY_MANIFEST_DELTA_TOOL}: workspace scratch is empty — author with write verbs ` +
						`(e.g. ${AUTHOR_PLACE_TOOL}, ${PLACE_ENTITY_TOOL}, ${PLACE_ACTOR_TOOL}, ${WRITE_ROWS_TOOL}) first, or pass toml for an external delta.`,
				);
			}
			toml = scratch;
		}

		const target = resolveAuthorTarget(context.target);
		if (target !== undefined) {
			const result = await target.applyBatch(
				source === "scratch" ? withoutRedundantScaffoldBundles(toml, target) : toml,
			);
			return authoringToolResult({
				...result,
				target: target.kind,
				source,
				waited: "seal_or_outcome",
			});
		}
		if (context.applyDelta === undefined) {
			throw new Error(
				`${APPLY_MANIFEST_DELTA_TOOL}: not connected — offline authoring has no live port/target. Wire ` +
					"context.target (#1968 connection-level target) or context.applyDelta (the legacy live-only " +
					`port) or use a write verb (e.g. ${PLACE_ENTITY_TOOL}, ${PLACE_ACTOR_TOOL}, ${AUTHOR_PLACE_TOOL}, ${WRITE_ROWS_TOOL}) to author into the scratch bundle instead.`,
			);
		}
		if (context.applyset?.readsAsPublisher?.() === false) {
			try {
				// Binding-only D-6 operations need no instance read capability.
				let refusal = scopedInlineDeltaPreflight(toml);
				if (refusal !== undefined && context.applyset.readScopedSnapshot)
					refusal = scopedInlineDeltaPreflight(toml, await context.applyset.readScopedSnapshot());
				if (refusal)
					return authoringToolResult({ ok: false, detail: refusal, source, sent: false });
			} catch {
				return authoringToolResult({
					ok: false,
					detail: "reader_unavailable",
					source,
					sent: false,
				});
			}
		}
		const result = await context.applyDelta(toml);
		return authoringToolResult({ ...result, source, waited: "seal_or_outcome" });
	},
});

const exportManifestToolDef = defineTool<
	AuthorToolContext,
	typeof EXPORT_MANIFEST_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: EXPORT_MANIFEST_TOOL,
	schema: EXPORT_MANIFEST_PARAMS,
	requiredCapabilities: ["node"],
	run: async (
		context: AuthorToolContext,
		params: Static<typeof EXPORT_MANIFEST_PARAMS>,
		_toolCallId,
		capabilities,
	) => {
		if (context.exportManifest === undefined) {
			throw new Error(
				`${EXPORT_MANIFEST_TOOL}: not connected — pass --live against a running node.`,
			);
		}
		const hasOut = params.out !== undefined && params.out.length > 0;
		const hasOutDir = params.out_dir !== undefined && params.out_dir.length > 0;
		if (hasOut === hasOutDir) {
			throw new Error(
				`${EXPORT_MANIFEST_TOOL}: pass exactly one of --out <file> or --out-dir <dir>.`,
			);
		}
		let row: ManifestExportRow;
		try {
			row = await context.exportManifest(params.bundle);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			const code = /MF-EXPORT-\d+/.exec(message)?.[0] ?? "";
			return authoringToolResult({
				ok: false,
				kind: "manifest_export",
				bundle_id: params.bundle,
				error: message,
				code,
				status: "",
				row_count: 0,
				diagnostics: "",
				out_path: "",
			});
		}
		let manifest = JSON.parse(row.manifestJson) as SchemaManifest;
		if (params.actor !== undefined && params.actor.length > 0) {
			try {
				manifest = filterManifestForActor(manifest, params.actor);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return authoringToolResult({
					ok: false,
					kind: "manifest_export",
					bundle_id: params.bundle,
					error: message,
					status: "",
					row_count: 0,
					diagnostics: "",
					out_path: "",
				});
			}
		}
		const toml = renderSchemaManifest(manifest);
		const rowCount =
			params.actor !== undefined && params.actor.length > 0
				? filteredRowCount(manifest)
				: row.rowCount;
		const slugSource =
			params.actor !== undefined && params.actor.length > 0 ? params.actor : params.bundle;
		const slug = slugSource.replace(/[/:]/g, "-");
		const filesystem = capabilities?.node?.filesystem;
		if (filesystem === undefined)
			throw new Error("spellkave_export_manifest requires Node filesystem capability.");
		const outPath = hasOut
			? filesystem.resolve(params.out as string)
			: filesystem.resolve(params.out_dir as string, `${slug}.toml`);
		filesystem.ensureDirectory(filesystem.dirname(outPath));
		filesystem.writeText(outPath, toml);
		return authoringToolResult({
			ok: true,
			kind: "manifest_export",
			bundle_id: row.bundleId,
			error: "",
			status: row.status,
			row_count: rowCount,
			diagnostics: row.diagnostics,
			out_path: outPath,
		});
	},
});

function splitCsv(value: string | undefined): string[] | undefined {
	if (value === undefined) return undefined;
	const parts = value
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part.length > 0);
	return parts.length === 0 ? undefined : parts;
}

function loadSchemaManifest(
	filesystem: FilesystemPort,
	path: string,
	side: "left" | "right",
): SchemaManifest {
	let toml: string;
	try {
		toml = filesystem.readText(path);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`${DIFF_MANIFEST_TOOL}: cannot read ${side} '${path}': ${message}`);
	}
	try {
		return parseSchemaManifestToml(toml);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`${DIFF_MANIFEST_TOOL}: cannot parse ${side} '${path}': ${message}`);
	}
}

const diffManifestToolDef = defineTool<
	AuthorToolContext,
	typeof DIFF_MANIFEST_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: DIFF_MANIFEST_TOOL,
	schema: DIFF_MANIFEST_PARAMS,
	requiredCapabilities: ["node"],
	exampleParams: {
		left: "packages/spellkave-world-author/docs/examples/weighted-int-roll-table.toml",
		right: "packages/spellkave-world-author/docs/examples/spatial-minimal-cell.toml",
		only: "changed",
	},
	run: async (
		_context: AuthorToolContext,
		params: Static<typeof DIFF_MANIFEST_PARAMS>,
		_toolCallId,
		capabilities,
	) => {
		const filesystem = capabilities?.node?.filesystem;
		if (filesystem === undefined)
			throw new Error("spellkave_diff_manifest requires Node filesystem capability.");
		const left = loadSchemaManifest(filesystem, params.left, "left");
		const right = loadSchemaManifest(filesystem, params.right, "right");
		const extraFields = splitCsv(params.ignore_fields);
		const kinds = splitCsv(params.kinds);
		const only = params.only as DiffOnlyFilter | undefined;
		const mapTokens = params.map_key ?? [];
		const mapKeys = mapTokens.map((token) => parseMapKey(token));
		const diff = diffManifests(left, right, {
			...(extraFields === undefined ? {} : { ignoreFields: { global: extraFields } }),
			...(kinds === undefined ? {} : { kinds }),
			...(mapKeys.length === 0 ? {} : { mapKeys }),
		});
		const flat = flattenManifestDiff(diff, only);
		return authoringToolResult({
			ok: true,
			kind: "manifest_diff",
			left: params.left,
			right: params.right,
			only_left: flat.gaps.length,
			only_right: flat.snapshot.length,
			changed: flat.changes.length,
			kinds: flat.kindCounts,
			gaps: flat.gaps,
			snapshot: flat.snapshot,
			changes: flat.changes,
			unkeyed_kinds: diff.unkeyedKinds,
		});
	},
});

/**
 * The AUTHOR-facing tool subset, in registration order (Q6/D4). Mirrors
 * `playerFacingToolDefinitions` exactly in shape: one tuple every host binds to
 * ONE `AuthorToolContext` via {@link createAuthorFacingTools}.
 */
const legacyAuthorFacingToolDefinitions = [
	prepareHandOverToolDef,
	handOverRoleToolDef,
	renderSceneToolDef,
	stageSceneToolDef,
	grantRoleToolDef,
	revokeRoleToolDef,
	listGrantsToolDef,
	exportGrantsToolDef,
	authorDocsToolDef,
	queryToolDef,
	evalToolDef,
	mapGraphToolDef,
	declareInexpressibleToolDef,
	noteDocGapToolDef,
	authorPlaceToolDef,
	linkPlacesToolDef,
	bindEdgeAffordanceToolDef,
	setMovementDefaultToolDef,
	setMetadataToolDef,
	attachMapLayerToolDef,
	annotatePlaceToolDef,
	defineResourceToolDef,
	placeEntityToolDef,
	placeActorToolDef,
	bindActorToolDef,
	tagEntityToolDef,
	equipItemToolDef,
	stowItemToolDef,
	defineBehaviorToolDef,
	defineEntityTypeToolDef,
	defineRollTableToolDef,
	defineConditionToolDef,
	defineNicheToolDef,
	defineAffordanceToolDef,
	defineCapabilityToolDef,
	defineConsequenceToolDef,
	defineActionToolDef,
	defineSessionToolDef,
	defineActionVerbToolDef,
	defineBundleToolDef,
	defineTraceKindToolDef,
	setMetadataToolDef,
	writeRowsToolDef,
	applyManifestDeltaToolDef,
	removeEntityToolDef,
	exportManifestToolDef,
	diffManifestToolDef,
	applysetDiffToolDef,
	applysetApplyToolDef,
	canIToolDef,
	getToolDef,
	describeToolDef,
	explainToolDef,
] as const;

/** Connected tools whose result can show placed instances. */
export const PLACED_INSTANCE_READ_TOOLS = new Set<string>([
	"spellkave_can_i",
	"spellkave_export",
	"spellkave_query",
	"spellkave_get",
	"spellkave_describe",
]);

export interface ConnectedAuthorAnswer {
	reads_as_publisher: boolean;
	connected_identity: string;
	note?: string;
}

/** Fields every connected author-tool answer carries (ADR-0150). */
export function connectedAuthorAnswer(input: {
	readsAsPublisher: boolean;
	connectedIdentity: string;
	readsPlacedInstances: boolean;
}): ConnectedAuthorAnswer {
	const answer: ConnectedAuthorAnswer = {
		reads_as_publisher: input.readsAsPublisher,
		connected_identity: input.connectedIdentity,
	};
	if (!input.readsAsPublisher && input.readsPlacedInstances) {
		const identity =
			input.connectedIdentity.length > 0 ? input.connectedIdentity : "an unknown identity";
		answer.note =
			`Scoped instance reads use the current role grants for ${identity} and report coverage. ` +
			"When a reader is unavailable, check `sk config view` or request an appropriate read grant. Export and entity prune require publisher closure.";
	}
	return answer;
}

const CONNECTED_ANSWER_DESCRIPTION =
	" When connected, the answer includes reads_as_publisher and connected_identity. " +
	"reads_as_publisher is true only after the publisher subscription applies. " +
	"Caller-scoped instance reads use current role grants and report source and coverage. " +
	"An unavailable reader needs an appropriate read grant or connection selection (`sk config view`). Export and entity prune require publisher closure.";

for (const def of [
	applyManifestDeltaToolDef,
	exportManifestToolDef,
	applysetDiffToolDef,
	applysetApplyToolDef,
	canIToolDef,
	getToolDef,
	describeToolDef,
]) {
	if (!def.description.includes("reads_as_publisher")) {
		def.description = `${def.description}${CONNECTED_ANSWER_DESCRIPTION}`;
	}
}

export const authorFacingToolDefinitions = AUTHOR_TOOL_NAMES.map((name) => {
	const definition = legacyAuthorFacingToolDefinitions.find((candidate) => candidate.name === name);
	if (definition === undefined)
		throw new Error(`AUTHOR contract '${name}' has no companion execution body.`);
	return definition;
});

export type AuthorFacingToolDefinition = (typeof authorFacingToolDefinitions)[number];

/** Names of the AUTHOR-facing subset, in registration order. */
export const AUTHOR_FACING_TOOL_NAMES: readonly string[] = AUTHOR_TOOL_NAMES;

/**
 * The AUTHOR tools that need a destination (live connection or local target): the complement of {@link AUTHOR_OFFLINE_TOOL_NAMES}.
 */
export const AUTHOR_CONNECTED_TOOL_NAMES: readonly string[] = [
	stageSceneToolDef.name,
	REMOVE_ENTITY_TOOL,
	APPLY_MANIFEST_DELTA_TOOL,
	EXPORT_MANIFEST_TOOL,
	APPLYSET_DIFF_TOOL,
	APPLYSET_APPLY_TOOL,
	CAN_I_TOOL,
	GET_TOOL,
	DESCRIBE_TOOL,
	revokeRoleToolDef.name,
	listGrantsToolDef.name,
	exportGrantsToolDef.name,
	prepareHandOverToolDef.name,
	handOverRoleToolDef.name,
];

/**
 * Names of tools that need neither a live connection nor a local target.
 * ADR-0074: membership is exported by the registry. A host activates this list
 * unconditionally and gates the remaining tools on their destination requirements,
 * exactly like the PLAYER subset's connect/disconnect gate.
 */
export const AUTHOR_OFFLINE_TOOL_NAMES: readonly string[] = authorFacingToolDefinitions
	.filter(
		(
			def,
		): def is Exclude<
			AuthorFacingToolDefinition,
			| typeof applyManifestDeltaToolDef
			| typeof removeEntityToolDef
			| typeof exportManifestToolDef
			| typeof applysetDiffToolDef
			| typeof applysetApplyToolDef
			| typeof canIToolDef
			| typeof getToolDef
			| typeof describeToolDef
		> => !AUTHOR_CONNECTED_TOOL_NAMES.includes(def.name),
	)
	.map((def) => def.name);

export type AuthorFacingBoundTool = BoundTool<AuthorFacingToolDefinition["parameters"], unknown>;

/** Bind the AUTHOR-facing subset without selecting a delivery adapter. */
export function createAuthorFacingBoundTools(
	context: AuthorToolContext,
	capabilities: NodeToolCapabilities = {},
): AuthorFacingBoundTool[] {
	// Same heterogeneous-tuple widening `tools.ts`'s `createPlayerFacingTools` uses:
	// `authorFacingToolDefinitions` is a tuple of distinct per-tool
	// `ToolDefinition<AuthorToolContext, P_n, R_n>` types so the union above stays
	// precise; widen to the common shape here and let the runtime perform the
	// transport-neutral binding.
	return authorFacingToolDefinitions.map((def) =>
		bindTool(def as ToolDefinition<AuthorToolContext, TSchema, unknown, NodeToolCapabilities>, {
			context,
			capabilities,
		}),
	) as AuthorFacingBoundTool[];
}

export {
	APPLY_MANIFEST_DELTA_TOOL,
	APPLYSET_APPLY_TOOL,
	APPLYSET_DIFF_TOOL,
	CAN_I_TOOL,
	DECLARE_INEXPRESSIBLE_TOOL,
	DIFF_MANIFEST_TOOL,
	DOCS_TOOL,
	EXPORT_MANIFEST_TOOL,
	NOTE_DOC_GAP_TOOL,
} from "@spellkave/tool-contracts/schemas";
export type { ApplyBundleCall, ApplysetPort } from "./applyset-tools";
