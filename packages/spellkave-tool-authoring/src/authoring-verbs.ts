// embedded-manifest: {"category": "production_empty_manifest", "rationale": "the authoring verb runtime deliberately constructs the canonical empty manifest baseline"}

import type { ExplorationResult } from "@spellkave/tool-contracts";
import { containmentValidationContext } from "./containment-validation-context";
import { EXPLORATION_ARGUMENT_REASONS, explore } from "./exploration";
// VERB-AUTHORING-TOOLS PoC (#1968 "Design: verb-based authoring tools").
//
// PROOF OF CONCEPT — do not read this file as the final architecture. Its one
// job is to test TOOL ERGONOMICS: can a handful of verb calls (`spellkave_
// author_place` → `spellkave_define_resource` → `spellkave_place_actor` →
// `spellkave_define_behavior` → the existing `spellkave_apply_manifest_delta`)
// reproduce a hand-authored 259-line example manifest (`packages/spellkave-
// world-author/docs/examples/aoe-damage-spell.toml`) as cleanly as the doc's
// worked example does by hand? Each tool below implements ONLY the parameter
// surface that worked example needs — every unsupported shape fails LOUDLY,
// naming the offending parameter, rather than silently guessing (see
// `__tests__/authoring-verbs.test.ts` for the acceptance proof and the
// ergonomics findings written up in the #1968 phase-5 report).
//
// #1968 ERGONOMICS FIXES landed on the follow-up PoC round (the phase-5 report's
// findings ①/②/③ — ④ (metadata-attachment target-kind widening) is
// STRUCTURALLY DISSOLVED, not merely fixed: the `description` decision made
// `description` a first-class column on the row kinds themselves, so there is
// no target-kind gap left to widen. Any FUTURE metadata-attachment widening is
// #1764's separate arbitrary-namespaced-key surface, not this one):
//   ① actor placement gained `placements` — an alternative array shape that
//      spawns the SAME entity_def split across MULTIPLE place_nodes in one call
//      (mutually exclusive with the flat `at`/`count`/`resources`), so a scene
//      like "3 targets at the blast center + 1 bystander at the fringe" no
//      longer needs a second call.
//   ② EVERY write verb now self-scaffolds a `[[bundles]]` header the first time
//      it sees a new `bundle` (idempotent, `depends_on: ["core"]`) — a truly
//      EMPTY workspace needs no `spellkave_write_manifest_toml` pre-seed call
//      any more. A new micro-verb, `spellkave_define_resource`, authors a bare
//      `resource_definitions` row (the scaffolding step actor placement's
//      `resources` seeds and `spellkave_define_behavior`'s `effect.write.
//      resource`/`cost.pool` both need to already exist against).
//   ③ `spellkave_define_behavior` no longer hand-mirrors `compose.ts`'s "aoe"
//      row recipe — `clusterRows` (`@spellkave/world-author`) gained a bundle-
//      namespace override (`BehaviorConfig.idNamespace`) plus overridable AoE
//      shape/write-target fields (`ActorBehavior.areaShapeId`/
//      `areaShapeParamsJson`/`aoeResource`), so this verb now DRIVES the same
//      builder the SRD content drivers use instead of reinventing its wiring.
//
// Row-generation REUSE note: `spellkave_author_place` wraps the EXISTING
// `@spellkave/world-author` `patchManifest` ops (`add-place-graph`/
// `add-place-node`/`add-place-edge`/`add-entity`/`add-actor`) — those already
// carry the upsert-by-key discipline this PoC wants, so there was nothing to
// reinvent. `spellkave_define_behavior` drives `compose.ts`'s `clusterRows`
// directly (see FIX③ above) rather than hand-assembling the six row kinds a
// capability→outcome→affordance→action→consequence→frame_write chain needs.
//
// DEFERRED design note (out of THIS PoC round's scope, #1968): `MF-VAL-263`
// (the self-budget validator code) binds only SELF-targeted actions, but
// `spellkave_define_behavior` has no `target: self`/`target: place` param at
// all yet (every generated action targets co-located actors via
// `ForEachActorInRadius`/`ActorSpatialRef`). Once a self-target param exists,
// `define_behavior` should surface "target: self without a cost → needs a
// pool, or did you mean target: place?" as a parameter-level hint instead of
// letting the author discover it as a bare validator code — do not add that
// hint pre-emptively; there is nothing to hint AT until the target param
// itself lands.
//
// FOUR HIGHER-LEVEL DEFINITION VERBS (#1968 "Design: verb-based authoring
// tools" — the fixture-migration round's `define_entity_type`/generic-verb
// item, plus the core-generator's empirical satellite-folding need):
// `spellkave_define_entity_type`, `spellkave_define_roll_table`,
// `spellkave_define_condition`, `spellkave_define_niche`. THE PATTERN: fold
// satellite rows into parent-level params — `entity_definitions` +
// `entity_definition_tag`×N + `entity_definition_initial_{state,capability,
// condition}`×N in ONE call, `tags: string[]` everywhere instead of a separate
// `*_tag` write per tag. `core`'s ~380 authored rows are ~53% catalog-def
// satellites (`*_tag`×196, `roll_table_entries`, `spatial_niche_attachments`,
// `entity_definition_initial_*`); these four verbs are the fold for the
// SUBSET of that satellite mass anchored on entity/roll-table/condition/niche
// parents (capability satellites stay on `spellkave_write_rows`/
// `spellkave_define_capability`; the outcome/action/affordance/consequence
// chain now has its own composite fold too — see `spellkave_define_action_verb`
// below, executable finding #40 — this paragraph's ORIGINAL "no parent-level
// verb exists for those yet" claim about that chain is the finding's own
// grounding quote, corrected here rather than silently left stale).
//
// `blockOn: "fatal"` (not the narrower content verbs' default `"any"`): all
// four generate KERNEL/SUBSTRATE vocabulary (catalog definitions, roll
// tables, condition/modifier vocabulary, niche/spatial-attachment vocabulary)
// — the SAME domain `spellkave_write_rows` occupies, not the "new narrative
// content" domain `author_place`/`spawn`/`define_resource`/`define_behavior`
// serve. Empirically confirmed (not assumed): driving the ENTIRE committed
// `world-fixtures/core` bundle through these row kinds surfaces non-fatal
// MF-VAL-291 (cross-namespace-definition) warnings on every one of them, plus
// MF-VAL-212/213 (DSL-literal advisories) on `condition_definitions` — the
// SAME accepted-warning shape `spellkave_write_rows`'s own doc comment
// documents. A stricter `"any"` bar would make these verbs unusable by the
// core-fixture generator they are the acceptance harness for.
//
// PARAM-SURFACE HONESTY: every field is derived from the schema
// (`crates/spellkave-schema`) PLUS real fixture usage (`world-fixtures/core`,
// `world-fixtures/srd`) — never invented. `spellkave_define_niche`'s
// `description` is REQUIRED (not `?`), unlike every other verb's optional
// `description`: `NicheDefinitionRow.description` has no `#[serde(default)]`
// (niche_definitions kept its own PRE-EXISTING required description column
// through the #1968 description-column decision, per that decision's own
// "existing shape unchanged" carve-out) — making it optional here would
// silently author an invalid row.

import {
	ANNOTATE_PLACE_PARAMS,
	ANNOTATE_PLACE_TOOL,
	ATTACH_MAP_LAYER_PARAMS,
	ATTACH_MAP_LAYER_TOOL,
	AUTHOR_PLACE_PARAMS,
	AUTHOR_PLACE_TOOL,
	BIND_ACTOR_PARAMS,
	BIND_ACTOR_TOOL,
	BIND_EDGE_AFFORDANCE_PARAMS,
	BIND_EDGE_AFFORDANCE_TOOL,
	DEFINE_ACTION_PARAMS,
	DEFINE_ACTION_TOOL,
	DEFINE_ACTION_VERB_PARAMS,
	DEFINE_ACTION_VERB_TOOL,
	DEFINE_AFFORDANCE_PARAMS,
	DEFINE_AFFORDANCE_TOOL,
	DEFINE_BEHAVIOR_PARAMS,
	DEFINE_BEHAVIOR_TOOL,
	DEFINE_BUNDLE_PARAMS,
	DEFINE_BUNDLE_TOOL,
	DEFINE_CAPABILITY_PARAMS,
	DEFINE_CAPABILITY_TOOL,
	DEFINE_CONDITION_PARAMS,
	DEFINE_CONDITION_TOOL,
	DEFINE_CONSEQUENCE_PARAMS,
	DEFINE_CONSEQUENCE_TOOL,
	DEFINE_ENTITY_TYPE_PARAMS,
	DEFINE_ENTITY_TYPE_TOOL,
	DEFINE_NICHE_PARAMS,
	DEFINE_NICHE_TOOL,
	DEFINE_RESOURCE_PARAMS,
	DEFINE_RESOURCE_TOOL,
	DEFINE_ROLL_TABLE_PARAMS,
	DEFINE_ROLL_TABLE_TOOL,
	DEFINE_SESSION_PARAMS,
	DEFINE_SESSION_TOOL,
	DEFINE_TRACE_KIND_PARAMS,
	DEFINE_TRACE_KIND_TOOL,
	EQUIP_ITEM_PARAMS,
	EQUIP_ITEM_TOOL,
	EVAL_PARAMS,
	EVAL_TOOL,
	LINK_PLACES_PARAMS,
	LINK_PLACES_TOOL,
	MAP_GRAPH_PARAMS,
	MAP_GRAPH_TOOL,
	PLACE_ACTOR_TOOL,
	PLACE_ENTITY_TOOL,
	PLACE_PARAMS,
	PLACE_SUBSTRATE_DEFAULT,
	type PLACEMENT_PARAMS,
	QUERY_PARAMS,
	QUERY_TOOL,
	SET_METADATA_PARAMS,
	SET_METADATA_TOOL,
	SET_METADATA_UPDATE,
	SET_MOVEMENT_DEFAULT_PARAMS,
	SET_MOVEMENT_DEFAULT_TOOL,
	type SetMetadataUpdate,
	STOW_ITEM_PARAMS,
	STOW_ITEM_TOOL,
	TAG_ENTITY_PARAMS,
	TAG_ENTITY_TOOL,
	WRITE_ROWS_PARAMS,
	WRITE_ROWS_TOOL,
} from "@spellkave/tool-contracts/schemas";
import { type NodeToolCapabilities, ToolArgumentValidationError } from "@spellkave/tool-runtime";
import {
	type ActorBehavior,
	type BehaviorConfig,
	bootstrapVocabularyRows,
	clusterRows,
	type Diagnostic,
	describeManifestSchema,
	type EvaluationResult,
	evaluateDslExpression,
	extra_rows_by_natural_key_json,
	findRowByCompositeKey,
	type InboundRowRef,
	inspectManifest,
	inspectRowReferences,
	inspectSchemaManifest,
	manifestTagPrefixFamilies,
	type OutboundRowRef,
	outboundRefsExcluding,
	patchManifest,
	ROW_KIND_COMPOSITE_KEY,
	ROW_KIND_NATURAL_KEY,
	ROW_KIND_STORAGE_KEY,
	refTagOutboundRefs,
	renderSchemaManifest,
	shape_params_json,
	validateManifestToml,
} from "@spellkave/world-author/tooling";
import type { Static } from "typebox";
import { Check, Errors } from "typebox/value";
import type { AuthorSnapshotDb } from "./author-target";
import { type AuthorTarget, resolveAuthorTarget } from "./author-target";
import type { AuthorToolContext, AuthorToolResult } from "./authoring";
import { defineTool } from "./tool-registry.ts";

/**
 * Audience of the author-only namespaces these verbs register (ADR-0130 D-3):
 * whoever may change the world reads its author notes.
 */
const AUTHOR_AUDIENCE = "frontier.apply_manifest";

/** Metres per battlemap grid square when an author does not name one: the
 * 5e 5 ft square, `5 * 0.3048`. Spelled to the same precision the srd-cc
 * author path emits (`ARENA_GRID_CELL_SIZE_M`) so a defaulted map_layer row
 * and an explicitly authored one produce byte-identical fixtures. */
const DEFAULT_GRID_DISTANCE_M = 1.5240000486373901;

// ---------------------------------------------------------------------------
// Shared plumbing
// ---------------------------------------------------------------------------

function toolResult<T>(details: T): AuthorToolResult<T> {
	return { content: [{ type: "text", text: JSON.stringify(details, null, 2) }], details };
}

/** `Cast Firebloom`-style display text from a `firebloom`/`aoe_blast/arena`-style id. */
/** Decimal u64 H3 res10 → {cell_res10,7,4} decimal strings via h3-js. */
async function resolveH3CellFamily(
	cellRes10: string | undefined,
): Promise<{ cell_res10: string; cell_res7: string; cell_res4: string } | null> {
	if (cellRes10 === undefined) return null;
	const raw = String(cellRes10).trim();
	if (raw === "" || raw === "0") return null;
	try {
		const { cellToParent, isValidCell } = await import("h3-js");
		const hex = /^\d+$/.test(raw)
			? BigInt(raw).toString(16)
			: raw.replace(/^0x/i, "").toLowerCase();
		if (!isValidCell(hex)) {
			throw new Error(`invalid H3 cell '${raw}'`);
		}
		const toDec = (h: string) => BigInt(`0x${h}`).toString();
		return {
			cell_res10: toDec(hex),
			cell_res7: toDec(cellToParent(hex, 7)),
			cell_res4: toDec(cellToParent(hex, 4)),
		};
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		throw new Error(`resolveH3CellFamily: ${msg}`);
	}
}

function titleCase(id: string): string {
	const words = id.split(/[^a-zA-Z0-9]+/).filter((w) => w.length > 0);
	if (words.length === 0) return id;
	return words.map((w) => w[0]?.toUpperCase() + w.slice(1)).join(" ");
}

function slugify(id: string): string {
	const slug = id
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();
	return slug.length > 0 ? slug : "entity";
}

function currentDb(context: AuthorToolContext): AuthorSnapshotDb | undefined {
	if (context.db === undefined) return undefined;
	try {
		// A host's `db` thunk (e.g. the Pi extension's) may throw "not connected"
		// rather than being absent — `spellkave_lookup` is in the ALWAYS-offline-
		// active subset (AUTHOR_OFFLINE_TOOL_NAMES), so a disconnected host must
		// fall back to workspace-only, never surface a connection error here.
		return typeof context.db === "function" ? context.db() : context.db;
	} catch {
		return undefined;
	}
}

/**
 * #1968 verb-UX round smart default (bundle_id from context): resolve a write
 * verb's `bundle` — the CALL's own `params.bundle` always wins; falling back
 * to `context.defaultBundle` (a value or a thunk, mirroring `context.db`/
 * `context.target`) only when the caller omits it. Throws naming `bundle` as
 * the offending param when NEITHER is set — never silently authors under an
 * empty-string bundle_id.
 */
function resolveBundle(
	context: AuthorToolContext,
	provided: string | undefined,
	toolName: string,
): string {
	if (provided !== undefined) return provided;
	const fallback =
		typeof context.defaultBundle === "function" ? context.defaultBundle() : context.defaultBundle;
	if (fallback !== undefined) return fallback;
	throw new Error(
		`${toolName}: \`bundle\` is required — no per-call value was given and no context.defaultBundle is ` +
			"wired for this session. The offending param is `bundle`.",
	);
}

/**
 * #1968 verb-UX round smart default (display_name derived from id): every
 * folding verb's own `display_name` param — the CALLER's value always wins;
 * `titleCase(id)` (the SAME id -> display text derivation `ensureBundleScaffold`/
 * `spawn` already use elsewhere in this file) fills in when omitted, so a
 * quick authoring call need not repeat what the id already says.
 */
function resolveDisplayName(provided: string | undefined, id: string): string {
	return provided ?? titleCase(id);
}

interface TableHandleLike {
	iter(): Iterable<Record<string, unknown>>;
}

/**
 * Read a live table by its snake_case accessor — finding ledger entry
 * #5 (`packages/spellkave-srd-cc/ledger/findings.md`): the real generated
 * `DbConnection.db` (`@spellkave/bindings`'s `module_bindings/index.ts`,
 * spacetimedb 2.6.1) keys every table accessor by its schema object-literal
 * key verbatim — always snake_case (`resource_definition`, `place_node`,
 * ...) — there is no camelCase accessor on ANY current surface (live
 * connection, replay `SnapshotDb`, or test fixtures across this repo were all
 * audited; none construct a camelCase table key). A prior camelCase-FIRST
 * version of this helper masked a live read returning zero rows as
 * "table absent" rather than surfacing the wrong-name bug. Throws (never
 * silently returns `[]`) when the accessor genuinely resolves to nothing, so
 * a typo'd table name fails loudly instead of looking like an empty seed.
 */
function liveTable(db: AuthorSnapshotDb, table: string): Record<string, unknown>[] {
	const handle = (db as Record<string, TableHandleLike | undefined>)[table];
	if (handle === undefined) {
		throw new Error(
			`liveTable: no accessor "${table}" on the connected db — the live SDK exposes snake_case ` +
				"table names only (never camelCase); check the table name against the schema.",
		);
	}
	return Array.from(handle.iter());
}

function rowArray(manifest: Record<string, unknown>, key: string): Record<string, unknown>[] {
	const current = manifest[key];
	if (Array.isArray(current)) return current as Record<string, unknown>[];
	const rows: Record<string, unknown>[] = [];
	manifest[key] = rows;
	return rows;
}

function stringRows(manifest: Record<string, unknown>, key: string): Record<string, unknown>[] {
	return Array.isArray(manifest[key]) ? (manifest[key] as Record<string, unknown>[]) : [];
}


/** Remove every row in `manifest[kind]` matching `predicate`, mutating in place. Returns the count removed. */
function clearRowsWhere(
	manifest: Record<string, unknown>,
	kind: string,
	predicate: (row: Record<string, unknown>) => boolean,
): number {
	const rows = rowArray(manifest, kind);
	const kept = rows.filter((row) => !predicate(row));
	const removed = rows.length - kept.length;
	manifest[kind] = kept;
	return removed;
}

/** `clearRowsWhere` scoped to one field equalling one value — the common case (a parent or natural key). */
function clearRowsByKey(
	manifest: Record<string, unknown>,
	kind: string,
	field: string,
	value: unknown,
): number {
	if (value === undefined) return 0;
	return clearRowsWhere(manifest, kind, (row) => row[field] === value);
}

/**
 * `clearRowsByKey`'s composite-key sibling (sk-jay0.7.174.30): a kind whose
 * identity is `ROW_KIND_STORAGE_KEY`'s ordered field tuple rather than one
 * natural-key column. Matches an EXISTING row iff every field in `fields`
 * equals `row`'s own value for it; a `fields` entry `row` itself leaves
 * `undefined` (an omitted, non-required key column) never matches anything —
 * mirroring `clearRowsByKey`'s own `value === undefined` guard, so an
 * incomplete key can only ever APPEND, never accidentally collide with an
 * unrelated row that also happens to omit the same field.
 */
function clearRowsByCompositeKey(
	manifest: Record<string, unknown>,
	kind: string,
	fields: readonly string[],
	row: Record<string, unknown>,
): number {
	if (fields.some((field) => row[field] === undefined)) return 0;
	return clearRowsWhere(manifest, kind, (existing) =>
		fields.every((field) => existing[field] === row[field]),
	);
}

/**
 * Read-modify entry point every PoC write verb shares: parse the workspace's
 * current scratch bundle, or start a FRESH one (FIX②b, #1968) — `schema_version`
 * is the only field the render path requires; `ensureBundleScaffold` (called by
 * every write verb right after this) adds the `[[bundles]]` header the first
 * time it sees a new `bundle_id`, so an author no longer needs a pre-seeded
 * `spellkave_write_manifest_toml` call before the first verb call.
 */
function requireManifest(context: AuthorToolContext): Record<string, unknown> {
	const toml = context.workspace.readToml();
	if (toml === null) return { schema_version: "1.0.0" };
	return inspectManifest(toml).manifest as Record<string, unknown>;
}

/**
 * Idempotently ensure `bundleId` has a `[[bundles]]` header row — FIX②b
 * (#1968): every write verb self-scaffolds so authoring can start from a
 * genuinely EMPTY workspace. Mirrors what a host's scratch-shape guard expects
 * (e.g. the Pi extension's `assertScratchTomlShape`): a `depends_on` including
 * `"core"`; the schema directive itself is supplied by the render path, not
 * this function. Returns rows ADDED (0 when the header already exists).
 */

/** Ensure a metadata namespace exists (offline bundles lack core registrations). */
function ensureMetadataNamespace(
	manifest: Record<string, unknown>,
	bundleId: string,
	namespace: string,
	audience: string,
	description: string,
): number {
	const rows = rowArray(manifest, "metadata_namespaces");
	if (rows.some((r) => r.namespace === namespace)) return 0;
	rows.push({
		namespace,
		audience,
		bundle_id: bundleId,
		description,
	});
	return 1;
}

const scaffoldBundleDescription = (bundleId: string): string =>
	`Bundle scaffolded by the #1968 verb-authoring tools on first write to '${bundleId}'.`;

/**
 * Drop the scaffolded `[[bundles]]` rows whose bundle the target already
 * defines (sk-jay0.3.26.16). The scaffold only lets a fresh scratch render;
 * flushed as-is, its `depends_on = ["core"]` header would replace the
 * target's own authored bundle row by key. A deliberate `define_bundle` row
 * carries no scaffold description and is always kept.
 */
/** Replace each scaffolded header with the target's own row for that bundle. */
function withTargetBundleRows(
	rows: Record<string, unknown>[],
	target: AuthorTarget,
): Record<string, unknown>[] {
	if (!rows.some(isScaffoldBundleRow)) return rows;
	let defined: Record<string, unknown>[];
	try {
		defined = target.lookup("bundles");
	} catch {
		// A live target without the bundle table cannot say; keep the rows.
		return rows;
	}
	return rows.map((row) => {
		const own = isScaffoldBundleRow(row)
			? defined.find((candidate) => candidate.bundle_id === row.bundle_id)
			: undefined;
		if (own === undefined) return row;
		// The live mod_bundle row keeps depends_on as a comma-joined string.
		const dependsOn =
			typeof own.depends_on === "string"
				? own.depends_on.split(",").filter((id) => id.length > 0)
				: own.depends_on;
		return { ...own, depends_on: dependsOn };
	});
}

const isScaffoldBundleRow = (row: Record<string, unknown>): boolean =>
	typeof row.bundle_id === "string" && row.description === scaffoldBundleDescription(row.bundle_id);

export function withoutRedundantScaffoldBundles(toml: string, target: AuthorTarget): string {
	let manifest: Record<string, unknown>;
	try {
		manifest = inspectManifest(toml).manifest as Record<string, unknown>;
	} catch {
		// Not a parseable root (e.g. no schema directive): the target reports it.
		return toml;
	}
	const bundles = rowArray(manifest, "bundles");
	const kept = bundles.filter(
		(row) =>
			typeof row.bundle_id !== "string" ||
			row.description !== scaffoldBundleDescription(row.bundle_id) ||
			!target.resolveRef("bundles", row.bundle_id),
	);
	if (kept.length === bundles.length) return toml;
	return renderSchemaManifest({ ...manifest, bundles: kept });
}

function ensureBundleScaffold(manifest: Record<string, unknown>, bundleId: string): number {
	const bundles = rowArray(manifest, "bundles");
	if (bundles.some((b) => b.bundle_id === bundleId)) return 0;
	bundles.push({
		bundle_id: bundleId,
		display_name: titleCase(bundleId),
		author: "spellkave-verb-tools",
		version: "1.0.0",
		depends_on: ["core"],
		description: scaffoldBundleDescription(bundleId),
		// tag-vocabulary-declaration change: a scaffolded bundle owns its own
		// bundle-id dot-namespace by default (`docs/data-model-concepts/
		// tagging.md`'s `<bundle_id>.*` convention) — this is what lets the
		// verb layer's own default action-class tag (see `defineBehaviorToolDef`
		// below) resolve cleanly against the undeclared-prefix check
		// (MF-VAL-298) instead of every scaffolded bundle needing a hand-authored
		// `tag_prefixes` call first. Skipped for the literal `core` bundle id
		// (or a `core.`-prefixed one) — the validator's own core-reservation
		// check (MF-VAL-299) rejects ANY bundle declaring that namespace, and
		// `core`/`core.*` is already always-implicitly-declared regardless
		// (`validate_undeclared_prefix`'s own carve-out), so no entry is needed.
		...(bundleId === "core" || bundleId.startsWith("core.")
			? {}
			: { tag_prefixes: [{ prefix: bundleId }] }),
	});
	return 1;
}

/** A validator diagnostic augmented with the PoC's best-effort offending-parameter guess. */
export interface MappedDiagnostic extends Diagnostic {
	param?: string;
}

export interface VerbResult {
	ok: boolean;
	rows_added?: number;
	/**
	 * How many of `rows_added` REPLACED a pre-existing row sharing the same
	 * authored key (#1968 workspace idempotency) — present only when > 0, so a
	 * fresh call's `details` shape is byte-identical to before this change (no
	 * silent-success re-run: a re-run visibly reports what it overwrote).
	 */
	rows_replaced?: number;
	diagnostics?: MappedDiagnostic[];
	/**
	 * #1968 verb-UX round 3: present only when the HOST's `AuthorWorkspace.writeToml`
	 * rejected an otherwise-VALID render via its own scratch-shape guard (e.g. the Pi
	 * extension's `assertScratchTomlShape` — "never poison the core profile", see
	 * `AuthorWorkspace.writeToml`'s own doc comment). Mirrors the retired
	 * `spellkave_write_manifest_toml`/`patch_manifest` tools' identical `{ ok: false,
	 * guard }` shape (#1968 item 7 retired them as agent tools, but never ported this
	 * catch into `commitOrReport` — every verb call inherited the gap silently until now).
	 */
	guard?: string;
	[extra: string]: unknown;
}

/**
 * Shared committer for every PoC write verb: render, validate in-process, and
 * persist ONLY on a clean result — never a partial/poisoned write. `mapParam`
 * lets each tool attach its own offending-parameter guess to a diagnostic (the
 * ergonomics point of the whole PoC: a repair loop should not have to re-read
 * TOML line numbers to find what it authored wrong).
 *
 * `blockOn` (default `"any"`, unchanged for the four PoC content verbs):
 * `"any"` rejects on ANY diagnostic including warnings (the PoC's stricter
 * new-content ergonomics bar); `"fatal"` matches the REAL admission boundary
 * `r_apply_world_manifest` enforces (only `severity: "fatal"` blocks) — used
 * by `spellkave_write_rows` (#1968), whose job is reproducing EXISTING
 * kernel/substrate content that may already carry accepted, informational
 * warnings (e.g. MF-VAL-291 cross-namespace-definition, MF-VAL-212/213 DSL
 * literal advisories — verified present, zero-fatal, in the CURRENTLY
 * COMMITTED `world-fixtures/core` bundle). Warnings are always returned in
 * `diagnostics`, persisted or not — never silently hidden.
 *
 * `rowsReplaced` (#1968 workspace idempotency — "Result honesty"): how many
 * of `rowsAdded` REPLACED a pre-existing row sharing the same authored key
 * (each caller computes this itself, via `clearRowsByKey`/`clearRowsWhere`,
 * BEFORE pushing its new rows) — surfaced in `details.rows_replaced` (only
 * when > 0) so a re-run visibly reports replacement, never silent success.
 */
const VALIDATION_AUGMENT_KINDS = [
	"resource_definitions",
	"entity_definitions",
	"object_state_definitions",
	// Authored SetEntityTag selections resolve declared vocabulary on the target.
	"tag_value_definitions",
	"capability_definitions",
	"dsl_macro_definitions",
	// srd-cc executable finding #38 / issue #2092 — Cover/AC axes live as
	// authored `modifier_target_definitions` in a sibling fragment; without
	// this entry, `modifier_templates.applies_to` false-fails MF-VAL and
	// content re-declares the axis row (upsert-safe cargo cult).
	"modifier_target_definitions",
	// sk-9ll.3: `equipment_slot_definitions` is a bundle-scoped catalog
	// vocabulary row exactly like the definition kinds above — an item's
	// weapon slot (e.g. `srd/slot/main-hand`, `chapters/equipment/index.ts`)
	// lives in a SIBLING fragment of the SAME bundle, not in the scratch
	// workspace a `spellkave_equip_item` call builds. Without this entry, the
	// NEW `MF_VAL_ACTOR_EQUIP_SLOT_DEF_REF` static check (added alongside
	// this verb) false-fails every cross-fragment equip call the SAME way
	// MF-VAL-225 used to false-fail `modifier_templates.applies_to` before
	// that entry landed.
	"equipment_slot_definitions",
] as const;

const ENTITY_INSTANCE_AUGMENT_KINDS_LOCAL_ONLY = ["entities"] as const;

const PLACE_AUGMENT_KINDS_LOCAL_ONLY = ["place_graphs", "place_nodes"] as const;

/**
 * Build a VALIDATION-ONLY view of `manifest`: the workspace's own rows plus
 * whatever `target` already carries for the four lossless definition kinds
 * above (any target kind) — and, for a `local` target ONLY, `place_graphs`/
 * `place_nodes` too (see `PLACE_AUGMENT_KINDS_LOCAL_ONLY`'s own doc comment
 * for the live/local safety split) — merged by natural key (a workspace row
 * ALWAYS wins over a same-key target row — re-authoring a row the target
 * already has is intentional shadowing, not a collision). Returns a shallow
 * clone; `manifest` itself (the object that gets persisted) is never mutated.
 * Mirrors the server's `augment_for_validation` — validate against
 * (target ∪ workspace), the way world-aware admission validates
 * against (live world ∪ delta), so a legitimate ref to a row that lives in
 * the target (a `depends_on` bundle on disk, or the live world) resolves
 * in-validator instead of false-failing Fatal.
 *
 * #1968 R7 slice 5.2 (ADR-0087): the natural-key merge-by-target "HOW" —
 * which of `target.lookup(kind)`'s rows are genuinely new by
 * `ROW_KIND_NATURAL_KEY` — is Rust-owned
 * (`spellkave-authoring`'s `augment` module, wasm-exported as
 * `extra_rows_by_natural_key_json`). This loop keeps only the WHICH-kinds/
 * WHEN/same-bundle POLICY (`VALIDATION_AUGMENT_KINDS`/
 * `PLACE_AUGMENT_KINDS_LOCAL_ONLY`/`ENTITY_INSTANCE_AUGMENT_KINDS_LOCAL_ONLY`,
 * `target.kind` gating, `ownBundleIds` filtering) — the crate has no access to
 * `target.lookup` (I/O: a `local` target reads sibling TOML off disk, a `live`
 * target queries the connected world).
 *
 * perf(world-author, sk-jay0.7.23.35): `entity_definitions` — by far the
 * largest of these kinds (2375 committed rows in the srd-cc fixture tree
 * vs. 14-234 for every other augmented kind) — is narrowed to the
 * REFERENCE CLOSURE (`referencedEntityDefIds` below) instead of pulled
 * whole like the rest of this list. `renderSchemaManifest`+
 * `validateManifestToml` over the augmented manifest dominate a
 * `commitOrReport` call's cost (profiled: ~65%/~18%; the natural-key diff
 * itself is only ~10%) and both scale with augmented SIZE, not with how
 * the row set was selected — so narrowing WHICH rows get pulled in is the
 * lever with headroom, unlike a faster/cached diff.
 *
 * Audited `crates/spellkave-validate` (refs.rs, dsl_macros.rs,
 * stratification.rs, tag_grammar.rs, locality.rs) before narrowing this
 * kind, specifically for the failure mode a closure can't self-detect:
 * a rule that aggregates over the WHOLE kind rather than resolving one
 * row's own reference. Findings for `entity_definitions` specifically:
 *   - No self-reference: `EntityDefinitionRow` (`crates/spellkave-schema`)
 *     has no field pointing at another `entity_definitions` row, so the
 *     closure needs no fixed-point iteration among entity_definitions
 *     rows themselves — one pass over the rest of the manifest suffices.
 *   - `validate_duplicate_row_ids`/`scan_duplicate_ids` (refs.rs) scans
 *     `manifest.entity_definitions` for same-kind id collisions — but
 *     `augmentForValidation` ALREADY drops any target row sharing a
 *     workspace row's natural key before this ever runs ("a workspace
 *     row always wins" above), and target's own committed content was
 *     already duplicate-free when it was committed, so this check can
 *     only ever fire on a collision BETWEEN TWO WORKSPACE ROWS — narrowing
 *     which target rows get pulled in never changes what it sees.
 *   - `validate_definition_seed_containment_cycle` (refs.rs) walks
 *     `entity_definition_initial_containment`/`_equipment` — DIFFERENT row
 *     kinds, not in `VALIDATION_AUGMENT_KINDS` at all, so they were
 *     already workspace-only before this change; narrowing
 *     `entity_definitions` doesn't touch what this check sees either.
 *   - `validate_dsl_string_refs_in_manifest`/`walk_expr_refs` (refs.rs)
 *     statically resolves DSL-embedded refs, but only for specific AST
 *     node shapes (`RollTable`, `ImpliedByCount.condition_definition_id`,
 *     an event `template_id` `Compare` literal) — none of them resolve an
 *     `entity_def_id`. `HasTag`/`HasCapability` (where an entity/tag id
 *     could otherwise hide inside DSL text) are UNCHECKED statically —
 *     runtime-only per `spellkave-dsl`'s own "opaque, authored" framing —
 *     so no entity_definitions reference lives inside DSL predicate text
 *     for this checker to miss.
 *   - Definition refs include plain string fields and ADR-0155 frame-write
 *     `selection.allowed_ids` arrays. `referencedEntityDefIds` collects both;
 *     `dm-selection-target.test.ts` pins the selected item case. Other row
 *     kinds remain whole: their CSV references need separate closure analysis,
 *     and locality analysis requires whole place graphs.
 *
 * Never under-include: the closure scans the WORKSPACE's own manifest
 * (every kind, not just the augmented ones — any workspace row anywhere
 * could carry an `entity_def_id`-valued field) UNION every OTHER kind's
 * fully-augmented rows (this loop runs first, so `entities`/
 * `resource_definitions`/etc. already carry their own target-pulled extras
 * by the time the closure scan runs) — never just the kinds this file
 * happens to also augment, and never just entity_definitions' own rows.
 *
 * ACCEPTED LIMIT (operator decision pending — see docs/testing.md's
 * render-cost paragraph): "never under-include" above is about the
 * WORKSPACE's own references never false-failing — it does NOT mean this
 * call surfaces every diagnostic the OLD whole-pull behavior would have.
 * `commitOrReport` validates the FULL augmented manifest, so a diagnostic
 * about an AUGMENTED (target-pulled) row's own fields — not just the
 * workspace's rows — is real and reachable today (verified: a committed
 * `entity_definitions` row with a broken `on_equip_consequence_id` trips
 * MF-VAL-311 under the old whole-pull behavior even when the calling
 * workspace row never references that entity_definitions row at all).
 * Narrowing means a committed row's own pre-existing defect stops
 * surfacing on calls that don't reference it — it was previously
 * (accidentally) re-validated on every unrelated call against this
 * target. In the happy path this is a no-op (committed content is
 * already clean when committed); the only behavior change is for
 * ALREADY-CORRUPTED committed content, where old behavior re-surfaced
 * the defect as noise on every unrelated call (and could BLOCK an
 * unrelated legitimate write, since a target-active call blocks on any
 * Fatal regardless of which row it's about) and narrowed behavior does
 * not. Not fixed here — flagging for an explicit call on which behavior
 * is wanted.
 */
const REFERENCE_CLOSURE_NARROWED_KIND = "entity_definitions";

/**
 * Every string value, across every row of every kind in `scanTargets`, that
 * looks like a reference by field name (`outboundRefsExcluding`'s own
 * `*_id`/`*_key`/`*_ref`/bare-`id` heuristic — the SAME one `spellkave_query`'s
 * ref-chasing and the dangling-ref-tag lint already use). No exclusion list:
 * a row's own identity field (e.g. `entities.entity_key`) gets swept in too,
 * but that only ever causes harmless OVER-inclusion (an identity value never
 * collides with a DIFFERENT kind's natural key), never under-inclusion —
 * the one direction that matters for `augmentForValidation`'s "never false-
 * fail a real ref" contract.
 */
function frameSelectionIds(value: unknown): Set<string> {
	const ids = new Set<string>();
	// Selection lists carry references in frame-write JSON, outside the
	// top-level string-field heuristic. Rust validation owns their admission.
	const collectSelections = (value: unknown): void => {
		if (Array.isArray(value)) {
			for (const member of value) collectSelections(member);
			return;
		}
		if (value === null || typeof value !== "object") return;
		for (const [field, member] of Object.entries(value)) {
			if (field === "allowed_ids" && Array.isArray(member)) {
				for (const id of member) if (typeof id === "string") ids.add(id);
			} else collectSelections(member);
		}
	};
	collectSelections(value);
	return ids;
}

function referencedEntityDefIds(...scanTargets: readonly Record<string, unknown>[]): Set<string> {
	const ids = new Set<string>();
	for (const manifestLike of scanTargets) {
		for (const id of frameSelectionIds(manifestLike.consequence_frame_writes)) ids.add(id);
		for (const rows of Object.values(manifestLike)) {
			if (!Array.isArray(rows)) continue;
			for (const row of rows) {
				if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
				for (const ref of outboundRefsExcluding(row as Record<string, unknown>, []))
					ids.add(ref.value);
			}
		}
	}
	return ids;
}

const PROMPT_RESPONSE_ACTION_KIND = "action_definitions";

function referencedResponseActionIds(manifest: Record<string, unknown>): Set<string> {
	const ids = new Set<string>();
	for (const row of stringRows(manifest, "prompt_definitions")) {
		const responseIds = row.response_action_ids;
		if (!Array.isArray(responseIds)) continue;
		for (const id of responseIds) if (typeof id === "string") ids.add(id);
	}
	return ids;
}

function augmentForValidation(
	manifest: Record<string, unknown>,
	target: AuthorTarget,
): Record<string, unknown> {
	const augmented: Record<string, unknown> = { ...manifest };
	// A verb-scaffolded header never shadows a bundle the target already defines
	// (sk-jay0.3.26.26): validate with the target's own row, so the
	// cross-bundle checks see its real depends_on, not the scaffold's ["core"].
	const incomingBundles = withTargetBundleRows(stringRows(manifest, "bundles"), target);
	if (incomingBundles.length > 0) augmented.bundles = incomingBundles;
	const localAugmentActive = target.kind === "local";
	// Same-bundle filter for the place kinds only (see PLACE_AUGMENT_KINDS_LOCAL_ONLY's
	// own doc comment) — the workspace's own [[bundles]] rows name the bundle(s) this
	// call is authoring; `local`'s `depends_on`-closure lookup otherwise also returns
	// core's/srd's OWN place_graphs, which is out of scope (and unsafe, MF-VAL-101).
	// `entities` (ENTITY_INSTANCE_AUGMENT_KINDS_LOCAL_ONLY) does NOT need this filter —
	// unlike place_graphs, `entities.bundle_id` is never FK-checked against
	// `manifest.bundles` (verified: no such check in `crates/spellkave-validate`), so
	// admitting a dependency's own entity instances carries none of the "references
	// unknown bundle" MF-VAL-101 hazard the place-kind filter exists to avoid.
	const ownBundleIds = localAugmentActive
		? new Set(stringRows(manifest, "bundles").map((b) => b.bundle_id))
		: undefined;
	const kinds: readonly string[] = localAugmentActive
		? [
				...VALIDATION_AUGMENT_KINDS,
				...PLACE_AUGMENT_KINDS_LOCAL_ONLY,
				...ENTITY_INSTANCE_AUGMENT_KINDS_LOCAL_ONLY,
			]
		: VALIDATION_AUGMENT_KINDS;
	// `entity_definitions` is narrowed to the reference closure (below,
	// AFTER this loop) instead of pulled whole like every other kind here —
	// see that block's own doc comment for why it alone is safe to narrow.
	for (const kind of kinds) {
		if (kind === REFERENCE_CLOSURE_NARROWED_KIND) continue;
		const existing = stringRows(manifest, kind);
		const sameBundleOnly =
			ownBundleIds !== undefined &&
			(PLACE_AUGMENT_KINDS_LOCAL_ONLY as readonly string[]).includes(kind);
		const selectedIds =
			kind === "tag_value_definitions"
				? frameSelectionIds(manifest.consequence_frame_writes)
				: undefined;
		// A local target can contain identical declarations from overlapping
		// fixture fragments. Collapse only identical selected tag rows: different
		// declarations for the same tag must still reach duplicate-key admission.
		const selectedTagRows = new Set<string>();
		const candidates = target
			.lookup(kind)
			.filter((row) => selectedIds === undefined || selectedIds.has(String(row.tag)))
			.filter((row) => !sameBundleOnly || ownBundleIds?.has(row.bundle_id))
			.filter((row) => {
				if (selectedIds === undefined) return true;
				const declaration = JSON.stringify(row);
				if (selectedTagRows.has(declaration)) return false;
				selectedTagRows.add(declaration);
				return true;
			});
		const extra: Record<string, unknown>[] = JSON.parse(
			extra_rows_by_natural_key_json(kind, JSON.stringify(existing), JSON.stringify(candidates)),
		);
		if (extra.length > 0) augmented[kind] = [...existing, ...extra];
	}
	// Match server tag-vocabulary augmentation: only dependency-reachable
	// owners of selected borrowed tag definitions enter validation input.
	// These headers never enter the persisted workspace or widen owner admission.
	const incomingTags = new Set(stringRows(manifest, "tag_value_definitions").map((row) => row.tag));
	const incomingOwnerIds = new Set(incomingBundles.map((row) => row.bundle_id));
	const selectedTagOwners = new Set(
		stringRows(augmented, "tag_value_definitions")
			.filter((row) => !incomingTags.has(row.tag))
			.map((row) => row.bundle_id),
	);
	if ([...selectedTagOwners].some((id) => !incomingOwnerIds.has(id))) {
		const ownerById = new Map(
			[...target.lookup("bundles"), ...incomingBundles].map((row) => [row.bundle_id, row]),
		);
		const reachableOwners = new Set<unknown>();
		const pendingOwners = incomingBundles.flatMap((row) =>
			Array.isArray(row.depends_on) ? row.depends_on : [],
		);
		while (pendingOwners.length > 0) {
			const id = pendingOwners.pop();
			if (reachableOwners.has(id)) continue;
			reachableOwners.add(id);
			const owner = ownerById.get(id);
			if (Array.isArray(owner?.depends_on)) pendingOwners.push(...owner.depends_on);
		}
		const borrowedOwners = [...ownerById.values()].filter(
			(row) =>
				!incomingOwnerIds.has(row.bundle_id) &&
				reachableOwners.has(row.bundle_id) &&
				selectedTagOwners.has(row.bundle_id),
		);
		if (borrowedOwners.length > 0) augmented.bundles = [...incomingBundles, ...borrowedOwners];
		// Owner prefixes activate grammar checks for sibling references too, so
		// include that owner's exact-value vocabulary, as server admission does.
		const borrowedOwnerIds = new Set(borrowedOwners.map((row) => row.bundle_id));
		const declarations = new Set<string>();
		const vocabulary = target.lookup("tag_value_definitions").filter((row) => {
			if (!borrowedOwnerIds.has(row.bundle_id)) return false;
			const declaration = JSON.stringify(row);
			if (declarations.has(declaration)) return false;
			declarations.add(declaration);
			return true;
		});
		const existingVocabulary = stringRows(augmented, "tag_value_definitions");
		const extraVocabulary: Record<string, unknown>[] = JSON.parse(
			extra_rows_by_natural_key_json(
				"tag_value_definitions",
				JSON.stringify(existingVocabulary),
				JSON.stringify(vocabulary),
			),
		);
		if (extraVocabulary.length > 0)
			augmented.tag_value_definitions = [...existingVocabulary, ...extraVocabulary];
	}
	if (kinds.includes(REFERENCE_CLOSURE_NARROWED_KIND)) {
		const existing = stringRows(manifest, REFERENCE_CLOSURE_NARROWED_KIND);
		const referencedIds = referencedEntityDefIds(manifest, augmented);
		const candidates = target
			.lookup(REFERENCE_CLOSURE_NARROWED_KIND)
			.filter(
				(row) => typeof row.entity_def_id === "string" && referencedIds.has(row.entity_def_id),
			);
		const extra: Record<string, unknown>[] = JSON.parse(
			extra_rows_by_natural_key_json(
				REFERENCE_CLOSURE_NARROWED_KIND,
				JSON.stringify(existing),
				JSON.stringify(candidates),
			),
		);
		if (extra.length > 0) augmented[REFERENCE_CLOSURE_NARROWED_KIND] = [...existing, ...extra];
	}
	// Namespace definitions round-trip losslessly. Only bring the namespaces
	// named by this delta's attachments into diagnostics, never into its payload.
	const referencedNamespaces = new Set(
		stringRows(manifest, "metadata_attachments").map((row) => row.namespace),
	);
	if (referencedNamespaces.size > 0) {
		const existing = stringRows(manifest, "metadata_namespaces");
		const candidates = target
			.lookup("metadata_namespaces")
			.filter((row) => referencedNamespaces.has(row.namespace));
		// A workspace registration supplies the namespace's validation contract.
		// Preserve multiple target registrations so metadata validation can report
		// ambiguity rather than silently picking an owner.
		const authoredNamespaces = new Set(existing.map((row) => row.namespace));
		const extra = candidates.filter((row) => !authoredNamespaces.has(row.namespace));
		if (extra.length > 0) augmented.metadata_namespaces = [...existing, ...extra];
	}
	// sk-jay0.2.33.15.7 (ADR-0142) — see PROMPT_RESPONSE_ACTION_KIND's doc
	// comment: same reference-closure-narrowing discipline as
	// REFERENCE_CLOSURE_NARROWED_KIND above, run unconditionally (not gated
	// by `localAugmentActive`) because `action_definitions` was never a
	// `VALIDATION_AUGMENT_KINDS` member to begin with.
	const referencedActionIds = referencedResponseActionIds(manifest);
	if (referencedActionIds.size > 0) {
		const existing = stringRows(manifest, PROMPT_RESPONSE_ACTION_KIND);
		const candidates = target
			.lookup(PROMPT_RESPONSE_ACTION_KIND)
			.filter((row) => typeof row.action_id === "string" && referencedActionIds.has(row.action_id));
		const extra: Record<string, unknown>[] = JSON.parse(
			extra_rows_by_natural_key_json(
				PROMPT_RESPONSE_ACTION_KIND,
				JSON.stringify(existing),
				JSON.stringify(candidates),
			),
		);
		if (extra.length > 0) augmented[PROMPT_RESPONSE_ACTION_KIND] = [...existing, ...extra];
	}
	return augmented;
}

/** Tag-vocabulary owner headers are augmented only through incoming dependency
 * closure, matching server admission. MF-VAL-306 ownership diagnostics remain
 * untouched here, including incoming foreign declarations and unreachable owners. */
function dropTargetDeferredDiagnostics(
	diagnostics: Diagnostic[],
	manifest: Record<string, unknown>,
	target: AuthorTarget,
): Diagnostic[] {
	const incomingMacroIds = new Set(
		stringRows(manifest, "dsl_macro_definitions").map((row) => row.macro_id),
	);
	const augmentedTargetMacroIds = target
		.lookup("dsl_macro_definitions")
		.map((row) => row.macro_id)
		.filter((macroId) => !incomingMacroIds.has(macroId));
	return diagnostics.filter(
		(d) =>
			!(d.code === "MF-VAL-101" && d.path === "bundles.depends_on") &&
			!(
				d.code === "MF-VAL-304" &&
				d.path === "dsl_macro_definitions.bundle_id" &&
				augmentedTargetMacroIds.some((macroId) => d.message.includes(`'${macroId}'`))
			) &&
			d.code !== "MF-VAL-226" &&
			d.code !== "MF-VAL-255",
	);
}

/**
 * Live SDK rows can still carry tagged enums `{ tag: "Public" }` or bigint
 * after toManifestRow gaps. renderSchemaManifest requires JSON-schema scalars.
 */
function sanitizeForSchemaRender(value: unknown, preserveOpenMetadata = false): unknown {
	if (typeof value === "bigint") {
		const n = Number(value);
		return Number.isSafeInteger(n) ? n : value.toString();
	}
	if (Array.isArray(value))
		return value.map((item) => sanitizeForSchemaRender(item, preserveOpenMetadata));
	if (value !== null && typeof value === "object") {
		const rec = value as Record<string, unknown>;
		const keys = Object.keys(rec);
		if (
			!preserveOpenMetadata &&
			typeof rec.tag === "string" &&
			keys.every((k) => k === "tag" || k === "value")
		) {
			const inner = rec.value;
			if (
				inner === undefined ||
				inner === null ||
				(typeof inner === "object" && inner !== null && Object.keys(inner as object).length === 0)
			) {
				return rec.tag;
			}
		}
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(rec))
			out[k] = sanitizeForSchemaRender(v, preserveOpenMetadata || k === "metadata");
		return out;
	}
	return value;
}

function metadataAttachmentIdentity(row: Record<string, unknown>): string | undefined {
	const fields = ["target_kind", "target_ref", "namespace", "bundle_id"];
	if (!fields.every((field) => typeof row[field] === "string")) return undefined;
	return JSON.stringify(fields.map((field) => row[field]));
}

function assertJsonSafeMetadata(value: unknown, path = "metadata"): void {
	if (value === null || typeof value === "string" || typeof value === "boolean") return;
	if (typeof value === "number") {
		if (Number.isFinite(value)) return;
		throw new Error(`${SET_METADATA_TOOL}: ${path} contains a non-finite number.`);
	}
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries()) assertJsonSafeMetadata(item, `${path}[${index}]`);
		return;
	}
	if (typeof value === "object") {
		for (const [key, item] of Object.entries(value as Record<string, unknown>))
			assertJsonSafeMetadata(item, `${path}.${key}`);
		return;
	}
	throw new Error(`${SET_METADATA_TOOL}: ${path} is not JSON-compatible.`);
}

function setNamespaceRow(
	manifest: Record<string, unknown>,
	bundleId: string,
	namespace: string,
	audience: string,
	description: string | undefined,
	onDemand?: boolean,
): { added: number; replaced: number } {
	const rows = rowArray(manifest, "metadata_namespaces");
	const matching = rows.filter((row) => row.namespace === namespace && row.bundle_id === bundleId);
	if (matching.length > 1)
		throw new Error(
			`${SET_METADATA_TOOL}: ambiguous metadata namespace '${namespace}' in bundle '${bundleId}' — ` +
				"repair duplicate metadata_namespaces rows before setting it.",
		);
	const next = {
		namespace,
		audience,
		bundle_id: bundleId,
		...(description === undefined ? {} : { description }),
		...(onDemand === undefined ? {} : { on_demand: onDemand }),
	};
	if (matching.length === 0) {
		rows.push(next);
		return { added: 1, replaced: 0 };
	}
	const index = rows.indexOf(matching[0] as Record<string, unknown>);
	rows[index] = next;
	return { added: 0, replaced: 1 };
}

function commitOrReport(
	context: AuthorToolContext,
	manifest: Record<string, unknown>,
	rowsAdded: number,
	rowsReplaced: number,
	toolName: string,
	mapParam: (d: Diagnostic) => string | undefined,
	extra?: Record<string, unknown>,
	blockOn: "any" | "fatal" = "any",
): AuthorToolResult<VerbResult> {
	const toml = renderSchemaManifest(manifest);
	// #1968 verb-UX round 2 gap②: with a `context.target` wired, validate
	// against (target ∪ workspace) instead of the workspace alone — see
	// `augmentForValidation`/`dropTargetDeferredDiagnostics` above. With NO
	// target, behavior is BYTE-IDENTICAL to before this change: closed-world,
	// standalone, honest fatal — offline single-file authoring stays exactly
	// as strict as today.
	const target = resolveAuthorTarget(context.target);
	let validationToml = toml;
	if (target !== undefined) {
		try {
			const augmented = sanitizeForSchemaRender(augmentForValidation(manifest, target)) as Record<
				string,
				unknown
			>;
			validationToml = renderSchemaManifest(augmented);
		} catch (err) {
			// Live projection may still carry non-round-trippable shapes; fall back to
			// workspace-only validation (depends_on fatals still deferred when target set).
			validationToml = toml;
			void err;
		}
	}
	let diagnostics = validateManifestToml(
		validationToml,
		containmentValidationContext(manifest, target),
	);
	if (target !== undefined)
		diagnostics = dropTargetDeferredDiagnostics(diagnostics, manifest, target);
	// A target's own already-committed content may carry pre-existing, accepted
	// WARNINGS (the SAME "empirically confirmed... every one of them" posture
	// `spellkave_write_rows`'s own `blockOn: "fatal"` doc comment names for
	// `world-fixtures/core`) — once augmented in for validation, a caller's
	// stricter `blockOn: "any"` bar would block on warnings that have NOTHING
	// to do with this call's own rows. With a target active, block on `fatal`
	// only, REGARDLESS of the verb's own `blockOn` — the real admission
	// boundary `r_apply_world_manifest` enforces (matches how the server's own
	// world-aware admission treats live-world-augmented warnings:
	// logged, never blocking). No target: `blockOn` is UNCHANGED (closed-world
	// verbs keep their own stricter bar).
	const blocking =
		blockOn === "fatal" || target !== undefined
			? diagnostics.filter((d) => d.severity === "fatal")
			: diagnostics;
	const mapped: MappedDiagnostic[] = diagnostics.map((d) => {
		const param = mapParam(d);
		return param === undefined ? { ...d } : { ...d, param };
	});
	if (blocking.length > 0) {
		return {
			content: [
				{
					type: "text",
					text:
						`${toolName}: INVALID — ${diagnostics.length} diagnostic(s), NOT persisted:\n` +
						mapped
							.map(
								(d) =>
									`${d.code}${d.param ? ` (param: ${d.param})` : ""}: ${d.message} (${d.path})`,
							)
							.join("; "),
				},
			],
			details: { ok: false, diagnostics: mapped },
		};
	}
	// #1968 verb-UX round 3: a VALID render may still be REJECTED by the host's own
	// scratch-shape guard (`AuthorWorkspace.writeToml`'s doc comment — "never poison
	// the core profile", e.g. the Pi extension's `assertScratchTomlShape`). Catch it
	// here rather than letting it escape as an uncaught throw — mirrors the retired
	// `spellkave_write_manifest_toml`/`patch_manifest` tools' identical graceful
	// `{ ok: false, guard }` rejection shape (never ported into `commitOrReport` when
	// those tools were retired, #1968 item 7 — this closes that gap for every verb).
	try {
		context.workspace.writeToml(toml);
	} catch (err) {
		return {
			content: [
				{ type: "text", text: `${toolName}: REJECTED by scratch-shape guard: ${String(err)}` },
			],
			details: { ok: false, guard: String(err) },
		};
	}
	const warningNote =
		mapped.length > 0 ? ` (${mapped.length} non-blocking warning(s) — see diagnostics)` : "";
	const replacedNote = rowsReplaced > 0 ? ` (${rowsReplaced} replaced a pre-existing row)` : "";
	return {
		content: [
			{
				type: "text",
				text: `VALID — ${rowsAdded} row(s) merged into the scratch bundle${replacedNote}${warningNote}.`,
			},
		],
		details: {
			ok: true,
			rows_added: rowsAdded,
			...(rowsReplaced > 0 ? { rows_replaced: rowsReplaced } : {}),
			diagnostics: mapped,
			...extra,
		},
	};
}

export interface QueryListItem {
	id: string;
	bundle_id?: string;
	/** Extra projected columns when `fields` is set (scalars only). */
	[field: string]: unknown;
}

export interface QuerySummaryResult {
	shape: "summary";
	/** "workspace" offline; "workspace+live"/"workspace+local" reflect whichever extra source was consulted (#1968 connection-level target) — same vocabulary as the former LookupResult.source. */
	source: "workspace" | "workspace+live" | "workspace+local";
	bundle_ids: string[];
	row_kinds: Record<string, number>;
	/**
	 * Optional guidance when neither a live db nor a local target is available and no
	 * explicit `target: "workspace"` override was requested.
	 */
	guidance?: string;
}

export interface QueryListResult {
	shape: "list";
	kind: string;
	source: "workspace" | "workspace+live" | "workspace+local";
	items: QueryListItem[];
	/** Which projection was applied: omit/undefined = ids-only; "preferred" or the explicit list. */
	fields?: "preferred" | string[];
	/**
	 * Optional guidance when neither a live db nor a local target is available and no
	 * explicit `target: "workspace"` override was requested.
	 */
	guidance?: string;
}

export interface QueryDetailResult {
	shape: "detail";
	kind: string;
	id: string;
	found: true;
	/** Exactly where THIS row was found — workspace wins when present there, else the resolved extra target (distinct from the list/summary shapes' compound "workspace+X" — a single row has exactly one source). */
	source: "workspace" | "local" | "live";
	row: Record<string, unknown>;
	outbound_refs?: OutboundRowRef[];
	/** Absent (never an empty array standing in for "computed, none found") when inbound-ref discovery isn't supported for `kind` — today, a `ROW_KIND_COMPOSITE_KEY` kind (finding #9's `*_tag` satellites): a composite id has no single field an inbound scan can match against generically, so only `outbound_refs` is populated for these kinds regardless of `refsMode`. */
	inbound_refs?: InboundRowRef[];
}

export interface QueryNotFoundResult {
	shape: "detail";
	kind: string;
	id: string;
	found: false;
}

/**
 * The row-kind VOCABULARY (#1983) — `schema: true` with no `kind`. Every kind
 * the manifest schema defines, flagged for whether this tool can also list its
 * rows: a kind is queryable only if it has a single-column natural key
 * (`ROW_KIND_NATURAL_KEY`, 40 of them), while the schema describes all 78.
 * A schema question about a non-queryable kind is still perfectly answerable,
 * so the two vocabularies are reported rather than intersected.
 */
export interface QuerySchemaIndexResult {
	shape: "schema";
	kinds: {
		kind: string;
		queryable: boolean;
		natural_key?: string;
		/** The ordered composite-key fields, when this kind has one instead of a single natural key (finding #9 — the `*_tag` satellite kinds). */
		composite_key?: string[];
	}[];
}

/** One row kind's field shape (#1983) — `schema: true` with a `kind`. */
export interface QuerySchemaKindResult {
	shape: "schema";
	kind: string;
	found: true;
	/** The single-column natural key, when this kind has one (i.e. is queryable). */
	natural_key?: string;
	/** The ordered composite-key fields, when this kind has one instead of a single natural key (finding #9 — the `*_tag` satellite kinds); its `id` for `spellkave_query`'s list/detail shapes is these fields' values joined by `::`. */
	composite_key?: string[];
	required: string[];
	fields: Record<string, unknown>;
}

export interface QuerySchemaNotFoundResult {
	shape: "schema";
	kind: string;
	found: false;
	ok: false;
	/** The known kinds, so a misspelling resolves without a second call. */
	kinds: string[];
}

export type QueryResult =
	| QuerySummaryResult
	| QueryListResult
	| QueryDetailResult
	| QueryNotFoundResult
	| QuerySchemaIndexResult
	| QuerySchemaKindResult
	| QuerySchemaNotFoundResult;

/**
 * Merge workspace rows (by id) with EXTRA (target/legacy-live) rows the
 * workspace doesn't already carry. `idOf` is generalized over HOW a row's id
 * is derived (finding #9, srd-cc finding ledger, 2026-07-26) — a plain
 * single-field lookup for a `ROW_KIND_NATURAL_KEY` kind, or the joined
 * composite-key string (`compositeQueryId`) for a `ROW_KIND_COMPOSITE_KEY`
 * kind — so this one merge stays the single place that decides workspace-
 * wins-over-extra, regardless of key shape.
 */
function mergeExtraRows(
	workspaceRows: Record<string, unknown>[],
	idOf: (row: Record<string, unknown>) => string,
	extraRows: Record<string, unknown>[],
): Record<string, unknown>[] {
	const merged = [...workspaceRows];
	const seen = new Set(workspaceRows.map(idOf));
	for (const row of extraRows) {
		const id = idOf(row);
		if (seen.has(id)) continue;
		seen.add(id);
		merged.push(row);
	}
	return merged;
}

/** `QUERY_TOOL`'s composite-id string encoding for a `ROW_KIND_COMPOSITE_KEY` kind (e.g. `resource_definition_tag`'s `{resource_definition_id, tag}`) — a TOOL-facing UX choice (how one opaque string names a two-field row), not a manifest fact, so it lives here rather than in `@spellkave/world-author` (whose `findRowByCompositeKey` takes the already-split field VALUES). Neither field observed across any authored fixture contains this delimiter (parent ids are `/`-slugs, tag values are bare words or `field=value` pairs) — joining is therefore lossless in practice; `parseCompositeQueryId` still fails loudly rather than silently mis-splitting if a future value ever did contain it. */
const QUERY_COMPOSITE_ID_DELIM = "::";

/** The joined composite-id string for one row, or `undefined` if any composite-key field is missing/non-string on it (defensive — every authored `*_tag` row carries both fields, per `ROW_KIND_COMPOSITE_KEY`'s own doc comment). */
function compositeQueryId(
	row: Record<string, unknown>,
	compositeFields: readonly string[],
): string | undefined {
	const parts: string[] = [];
	for (const field of compositeFields) {
		const value = row[field];
		if (typeof value !== "string") return undefined;
		parts.push(value);
	}
	return parts.join(QUERY_COMPOSITE_ID_DELIM);
}

/** Split a `QUERY_TOOL`-issued composite id back into its ordered field VALUES — the inverse of `compositeQueryId`. Throws (never a silent wrong split) when the id doesn't carry exactly as many parts as `compositeFields`. */
function parseCompositeQueryId(id: string, compositeFields: readonly string[]): string[] {
	const parts = id.split(QUERY_COMPOSITE_ID_DELIM);
	if (parts.length !== compositeFields.length) {
		throw new Error(
			`${QUERY_TOOL}: composite id '${id}' should have ${compositeFields.length} ` +
				`'${QUERY_COMPOSITE_ID_DELIM}'-joined parts (${compositeFields.join(", ")}) — got ${parts.length}. ` +
				"The offending param is `id`.",
		);
	}
	return parts;
}

type QueryTargetOverride = Static<typeof QUERY_PARAMS>["target"];

/** Every single-natural-key row kind `spellkave_query`'s target-aware full-manifest-ref-graph walk (`fullManifestFrom`) can probe (mirrors `local`'s own generic-over-any-keyed-kind lookup; a target's non-keyed/junction rows are outside this generic walk's reach, same bound `LIVE_TABLE_ACCESSORS` documents). Deliberately excludes `ROW_KIND_COMPOSITE_KEY` kinds (finding #9's `*_tag` satellites) — a composite-keyed row is never itself a ref TARGET (nothing points at a `*_tag` row by natural key), so the generic ref-graph walk has no reason to carry the satellite tables themselves; `resolveQuerySummary`'s own target-row-count merge, below, is NOT scoped to this list — see `summaryAugmentableRowKinds` (executable finding #42). */
function allKnownRowKinds(): string[] {
	return Object.keys(ROW_KIND_NATURAL_KEY);
}

/**
 * Every row kind `spellkave_query`'s no-args SUMMARY may report a count for
 * once a `target`/`extra` source is wired — `allKnownRowKinds()`'s
 * natural-key vocabulary PLUS every `ROW_KIND_COMPOSITE_KEY` kind (finding
 * #42, srd-cc finding ledger, 2026-07-28): the workspace-only fast path
 * (`inspectSchemaManifest(manifest).summary`) already counts every manifest
 * key including `*_tag` satellites, but the target-augmentation loop this
 * function feeds used to iterate `allKnownRowKinds()` alone — silently
 * dropping every composite-keyed kind's count the instant ANY target was
 * wired, even though those rows are independently listable/detailable
 * (`resolveQueryList`/`resolveQueryDetail` already handle them). Kept
 * SEPARATE from `allKnownRowKinds()` (not folded into it) because that
 * function also feeds `fullManifestFrom`'s ref-graph walk, which has no use
 * for a composite-keyed kind's own table (see that function's header).
 */
function summaryAugmentableRowKinds(): string[] {
	return [...Object.keys(ROW_KIND_NATURAL_KEY), ...Object.keys(ROW_KIND_COMPOSITE_KEY)];
}

/** One resolved extra-rows source for this `spellkave_query` call — either the active `AuthorTarget` or (back-compat) a bare `context.db` wrapped as an ephemeral live target. */
interface QueryExtraSource {
	label: "live" | "local";
	rows(rowKind: string): Record<string, unknown>[];
	/** Assemble a manifest-shaped object (every known row kind this source answers) — feeds `inspectRowReferences`'s generic graph walk, the same one the workspace manifest already uses (#1968 §3). */
	fullManifest(): Record<string, unknown>;
}

// The embedded bootstrap is immutable for this loaded module. Cache each kind across
// calls so a discovery walk does not parse the same genesis manifest for every row.
const queryBootstrapRows = new Map<string, Record<string, unknown>[]>();

/** File targets resolve genesis references from the same embedded vocabulary as explain.
 * Live reads retain their observed rows. Local declarations override bootstrap defaults.
 */
function queryTargetSource(target: AuthorTarget): QueryExtraSource {
	const cache = new Map<string, Record<string, unknown>[]>();
	const rows = (kind: string): Record<string, unknown>[] => {
		if (target.kind === "live") return target.lookup(kind);
		const cached = cache.get(kind);
		if (cached !== undefined) return cached;
		const fields =
			ROW_KIND_STORAGE_KEY[kind] ??
			(ROW_KIND_NATURAL_KEY[kind] ? [ROW_KIND_NATURAL_KEY[kind]] : undefined);
		const authored = target.lookup(kind);
		if (fields === undefined) return authored;
		let bootstrap = queryBootstrapRows.get(kind);
		if (bootstrap === undefined) {
			bootstrap = bootstrapVocabularyRows(kind);
			queryBootstrapRows.set(kind, bootstrap);
		}
		// Most SRD kinds have no genesis rows. Preserve the target's stable
		// array and avoid rebuilding a large catalog during every ref chase.
		if (bootstrap.length === 0) return authored;
		const merged = new Map<string, Record<string, unknown>>();
		for (const row of [...bootstrap, ...authored])
			merged.set(JSON.stringify(fields.map((field) => row[field])), row);
		const result = [...merged.values()];
		cache.set(kind, result);
		return result;
	};
	return { label: target.kind, rows, fullManifest: () => fullManifestFrom(rows) };
}

function fullManifestFrom(
	rows: (rowKind: string) => Record<string, unknown>[],
): Record<string, unknown> {
	const manifest: Record<string, unknown> = {};
	for (const kind of allKnownRowKinds()) {
		const kindRows = rows(kind);
		if (kindRows.length > 0) manifest[kind] = kindRows;
	}
	return manifest;
}

function workspaceHasRows(manifest: Record<string, unknown>): boolean {
	// `inspectManifest` includes non-row metadata such as `schema_version`; only
	// authored row arrays make the scratch workspace non-empty.
	return Object.values(manifest).some((rows) => Array.isArray(rows) && rows.length > 0);
}

function readOnlyGuidance(): string {
	return [
		"No connected world is wired. Configure or connect a source to read richer results:",
		"• Connect to a live session: run `spellkave_connect` from the CLI for this authoring context.",
		"• Configure author.target (Pi: `spellkave_config`; CLI: `sk config set --project author.target <dir>`; or `.spellkave/config.toml` / `SPELLKAVE_AUTHOR_LOCAL_TARGET=<dir>`).",
	].join("\n");
}

function shouldAttachGuide(
	paramsTarget: QueryTargetOverride,
	hasExtraSource: boolean,
	hasWorkspaceRows: boolean,
): boolean {
	return paramsTarget !== "workspace" && !hasExtraSource && !hasWorkspaceRows;
}

/**
 * Resolve which extra-rows source (beyond the workspace) THIS call reads,
 * honoring `params.target` (#1968 connection-level target override — READ
 * tools only). Default (no override): `context.target` when wired, else
 * (back-compat, unchanged) the legacy `context.db`-based live read — the
 * SAME resolution `spellkave_lookup` used before this merge.
 */
function resolveQueryExtraSource(
	context: AuthorToolContext,
	db: AuthorSnapshotDb | undefined,
	requested: QueryTargetOverride,
): QueryExtraSource | undefined {
	if (requested === "workspace") return undefined;
	const target = resolveAuthorTarget(context.target);
	if (requested === "local") {
		// Prefer an explicit local target; else context.localTarget (configured
		// author.target dir even while the default connection target is live).
		const local = target?.kind === "local" ? target : resolveAuthorTarget(context.localTarget);
		if (local?.kind !== "local") {
			throw new Error(
				`${QUERY_TOOL}: target: "local" requested but no local target is configured — the offending param is \`target\`.`,
			);
		}
		return queryTargetSource(local);
	}
	if (requested === "live") {
		if (target?.kind === "live") {
			return queryTargetSource(target);
		}
		if (db !== undefined) {
			const rows = (rowKind: string) => legacyLiveRows(db, rowKind);
			return { label: "live", rows, fullManifest: () => fullManifestFrom(rows) };
		}
		throw new Error(
			`${QUERY_TOOL}: target: "live" requested but not connected — the offending param is \`target\`.`,
		);
	}
	if (target !== undefined) {
		return queryTargetSource(target);
	}
	if (db !== undefined) {
		const rows = (rowKind: string) => legacyLiveRows(db, rowKind);
		return { label: "live", rows, fullManifest: () => fullManifestFrom(rows) };
	}
	return undefined;
}

/** Legacy unbound snapshots retain the generated table-accessor convention. */
function legacyLiveRows(db: AuthorSnapshotDb, rowKind: string): Record<string, unknown>[] {
	const tables = db as Record<
		string,
		{ iter?: () => Iterable<Record<string, unknown>> } | undefined
	>;
	const camel = rowKind.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
	const singular = rowKind.endsWith("s") ? rowKind.slice(0, -1) : rowKind;
	const singularCamel = singular.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
	const table = tables[rowKind] ?? tables[camel] ?? tables[singular] ?? tables[singularCamel];
	if (table?.iter === undefined) return [];
	return Array.from(table.iter(), (row) =>
		Object.fromEntries(
			Object.entries(row).map(([key, value]) => [
				key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
				value,
			]),
		),
	);
}

function querySourceLabel(
	extra: QueryExtraSource | undefined,
): "workspace" | "workspace+live" | "workspace+local" {
	return extra === undefined
		? "workspace"
		: extra.label === "local"
			? "workspace+local"
			: "workspace+live";
}

/**
 * Shape 1 (no `kind`): the workspace/target summary — generalizes today's
 * `spellkave_manifest_inspect` across `target` and an optional `bundle`
 * scope. The `bundle === undefined && extra === undefined` fast path
 * reuses `inspectSchemaManifest` directly (bit-identical to the retired
 * tool's own output, including non-keyed/junction row kinds it counted
 * that this function's `target`/`bundle`-aware augmentation below — scoped
 * to the KEYED vocabulary only — cannot reach).
 */
function resolveQuerySummary(
	manifest: Record<string, unknown>,
	extra: QueryExtraSource | undefined,
	bundle: string | undefined,
): QuerySummaryResult {
	const base = inspectSchemaManifest(manifest).summary;
	let rowKinds: Record<string, number>;
	let bundleIds: string[];
	if (bundle === undefined) {
		rowKinds = { ...base.rowKinds };
		bundleIds = [...base.bundleIds];
	} else {
		rowKinds = {};
		for (const [kind, rows] of Object.entries(manifest)) {
			if (!Array.isArray(rows)) continue;
			const count = (rows as Record<string, unknown>[]).filter(
				(r) => r.bundle_id === bundle,
			).length;
			if (count > 0) rowKinds[kind] = count;
		}
		bundleIds = base.bundleIds.filter((id) => id === bundle);
	}
	if (extra !== undefined) {
		const bundleIdSet = new Set(bundleIds);
		for (const kind of summaryAugmentableRowKinds()) {
			// Shape-agnostic over natural- vs composite-key kinds (finding #42),
			// same `idOf` construction `resolveQueryList`/`resolveQueryDetail`
			// already use — one merge, either key shape.
			const keyField = ROW_KIND_NATURAL_KEY[kind];
			const compositeFields = keyField === undefined ? ROW_KIND_COMPOSITE_KEY[kind] : undefined;
			if (keyField === undefined && compositeFields === undefined) continue; // defensive only
			const idOf = (row: Record<string, unknown>): string | undefined =>
				compositeFields !== undefined
					? compositeQueryId(row, compositeFields)
					: typeof row[keyField as string] === "string"
						? (row[keyField as string] as string)
						: undefined;
			let workspaceRows = stringRows(manifest, kind).filter((r) => idOf(r) !== undefined);
			let extraRows = extra.rows(kind).filter((r) => idOf(r) !== undefined);
			if (bundle !== undefined) {
				workspaceRows = workspaceRows.filter((r) => r.bundle_id === bundle);
				extraRows = extraRows.filter((r) => r.bundle_id === bundle);
			}
			const merged = mergeExtraRows(workspaceRows, (row) => idOf(row) as string, extraRows);
			if (merged.length > 0) rowKinds[kind] = merged.length;
			if (kind === "bundles") {
				for (const row of merged) {
					if (typeof row.bundle_id === "string") bundleIdSet.add(row.bundle_id);
				}
			}
		}
		bundleIds = [...bundleIdSet].sort();
	}
	return {
		shape: "summary",
		source: querySourceLabel(extra),
		bundle_ids: bundleIds,
		row_kinds: rowKinds,
	};
}

/**
 * Kind → short list-projection when `fields: "preferred"`.
 * Keep scalar, high-signal columns only (token budget). Kinds absent here
 * fall back to ids-only even under "preferred".
 */
export const QUERY_LIST_PREFERRED_FIELDS: Readonly<Record<string, readonly string[]>> =
	Object.freeze({
		entities: Object.freeze(["name", "place_node_id", "kind", "entity_def_id"]),
		actors: Object.freeze(["name"]),
		place_nodes: Object.freeze([
			"display_name",
			"place_graph_id",
			"pos_x",
			"pos_y",
			"pos_present",
			"substrate_id",
		]),
		place_graphs: Object.freeze([
			"display_name",
			"metres_per_unit",
			"bearing",
			"anchor_node_id",
			"substrate_id",
		]),
		place_edges: Object.freeze(["from_node_id", "to_node_id", "place_graph_id"]),
		capability_definitions: Object.freeze(["display_name", "actor_kind", "description"]),
		action_definitions: Object.freeze(["display_name", "required_capability", "self_eligible"]),
		resource_definitions: Object.freeze([
			"display_name",
			"min_value",
			"max_value",
			"initial_value",
		]),
		condition_definitions: Object.freeze(["display_name", "description"]),
		niche_definitions: Object.freeze(["display_name", "description"]),
	});

type QueryListFieldsParam = Static<typeof QUERY_PARAMS>["fields"];

function resolveListProjectionFields(
	kind: string,
	fields: QueryListFieldsParam,
): { mode: undefined | "preferred" | string[]; columns: readonly string[] } {
	if (fields === undefined) return { mode: undefined, columns: [] };
	if (fields === "preferred") {
		return {
			mode: "preferred",
			columns: QUERY_LIST_PREFERRED_FIELDS[kind] ?? [],
		};
	}
	// explicit list — de-dupe, drop empties, never re-project identity keys as required
	const seen = new Set<string>();
	const columns: string[] = [];
	for (const raw of fields) {
		const name = raw.trim();
		if (name.length === 0 || name === "id" || seen.has(name)) continue;
		seen.add(name);
		columns.push(name);
	}
	return { mode: columns, columns };
}

/** Project only JSON-scalar cells onto list items (no nested objects/arrays). */
function projectListScalar(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	const t = typeof value;
	if (t === "string" || t === "number" || t === "boolean") return value;
	return undefined;
}

function projectQueryListItem(
	row: Record<string, unknown>,
	id: string,
	columns: readonly string[],
): QueryListItem {
	const item: QueryListItem = { id };
	if (typeof row.bundle_id === "string") item.bundle_id = row.bundle_id;
	for (const col of columns) {
		if (col === "bundle_id") continue; // already handled
		if (!(col in row)) continue;
		const projected = projectListScalar(row[col]);
		if (projected === undefined && row[col] !== null && row[col] !== undefined) continue;
		if (projected !== undefined || row[col] === null) item[col] = projected ?? null;
	}
	return item;
}

/** Shape 2/3 (`kind`, no `id`): catalog list for `kind`. Default ids-only (#1968 token bound); pass `fields` to project extra scalars. */
function resolveQueryList(
	manifest: Record<string, unknown>,
	extra: QueryExtraSource | undefined,
	kind: string,
	bundle: string | undefined,
	pattern: string | undefined,
	fields?: QueryListFieldsParam,
): QueryListResult {
	const keyField = ROW_KIND_NATURAL_KEY[kind];
	const compositeFields = keyField === undefined ? ROW_KIND_COMPOSITE_KEY[kind] : undefined;
	if (keyField === undefined && compositeFields === undefined) {
		throw new Error(
			`${QUERY_TOOL}: unknown kind '${kind}' — not a manifest row kind. The offending param is \`kind\`.`,
		);
	}
	// `idOf` is the single per-call decision between the two key shapes —
	// everything downstream (merge, item projection) is shape-agnostic.
	const idOf: (row: Record<string, unknown>) => string | undefined =
		compositeFields !== undefined
			? (row) => compositeQueryId(row, compositeFields)
			: (row) =>
					typeof row[keyField as string] === "string"
						? (row[keyField as string] as string)
						: undefined;
	const hasId = (row: Record<string, unknown>): boolean => idOf(row) !== undefined;
	const merged = mergeExtraRows(
		stringRows(manifest, kind).filter(hasId),
		(row) => idOf(row) as string,
		(extra ? extra.rows(kind) : []).filter(hasId),
	);
	const projection = resolveListProjectionFields(kind, fields);
	const items: QueryListItem[] = merged
		.map((row) => projectQueryListItem(row, idOf(row) as string, projection.columns))
		.filter(
			(item) =>
				(bundle === undefined || item.bundle_id === bundle) &&
				(pattern === undefined || item.id.includes(pattern)),
		);
	items.sort((a, b) => a.id.localeCompare(b.id));
	return {
		shape: "list",
		kind,
		source: querySourceLabel(extra),
		items,
		...(projection.mode === undefined ? {} : { fields: projection.mode }),
	};
}

/**
 * Shape 4 (`kind` + `id`): the NEW capability (#1968 definition-lookup gap)
 * — the complete authored row, its source, and (by default) its
 * outbound/inbound refs. Precedence mirrors every write verb's own
 * workspace-first ref-check order: the workspace row wins when present;
 * only when ABSENT there does the resolved extra (target/legacy-db) source
 * answer. Refs are computed against the SAME single source the row itself
 * came from (never a workspace+target merge) — workspace refs walk the
 * workspace manifest directly; local/live refs walk a manifest assembled
 * from that target's own `fullManifest()` (#1968 §3: the identical generic
 * graph-walk, since `toManifestRow` already normalizes every live row into
 * the manifest's own snake_case shape).
 */
/**
 * The SHAPE half of this tool (#1983): what fields may a row of `kind` carry,
 * as opposed to which rows exist. Retires `spellkave-author schema manifest`.
 *
 * Per-kind on purpose. The whole manifest schema is ~112 KB (~28k tokens) —
 * dumping it is exactly the anti-pattern the doc corpus was restructured to
 * avoid (ADR-0047 G-3, "pull the smallest relevant slice"); one row kind is
 * ~600 bytes. Reusing this tool's existing `kind` parameter is what makes the
 * narrow ask natural: the vocabulary a caller already uses to LIST rows is the
 * same one that names their shape, so no second vocabulary has to be learned.
 *
 * The JSON Schema stores each row kind as an array whose items `$ref` a shared
 * definition, so resolving that one hop is what turns "there is a row kind
 * called X" into "here are X's fields".
 */
function resolveQuerySchema(
	kind: string | undefined,
): QuerySchemaIndexResult | QuerySchemaKindResult | QuerySchemaNotFoundResult {
	const schema = describeManifestSchema() as unknown as {
		properties?: Record<string, { items?: { $ref?: string } }>;
		definitions?: Record<string, { required?: string[]; properties?: Record<string, unknown> }>;
	};
	const properties = schema.properties ?? {};

	if (kind === undefined) {
		return {
			shape: "schema",
			kinds: Object.keys(properties)
				.sort()
				.map((name) => {
					const naturalKey = ROW_KIND_NATURAL_KEY[name];
					const compositeKey = ROW_KIND_COMPOSITE_KEY[name];
					return {
						kind: name,
						queryable: naturalKey !== undefined || compositeKey !== undefined,
						...(naturalKey === undefined ? {} : { natural_key: naturalKey }),
						...(compositeKey === undefined ? {} : { composite_key: [...compositeKey] }),
					};
				}),
		};
	}

	const entry = properties[kind];
	const ref = entry?.items?.$ref;
	const definition =
		ref === undefined ? undefined : schema.definitions?.[ref.split("/").pop() ?? ""];
	if (definition === undefined) {
		return {
			shape: "schema",
			kind,
			found: false,
			ok: false,
			kinds: Object.keys(properties).sort(),
		};
	}
	const naturalKey = ROW_KIND_NATURAL_KEY[kind];
	const compositeKey = ROW_KIND_COMPOSITE_KEY[kind];
	return {
		shape: "schema",
		kind,
		found: true,
		...(naturalKey === undefined ? {} : { natural_key: naturalKey }),
		...(compositeKey === undefined ? {} : { composite_key: [...compositeKey] }),
		required: definition.required ?? [],
		fields: definition.properties ?? {},
	};
}

function resolveQueryDetail(
	manifest: Record<string, unknown>,
	extra: QueryExtraSource | undefined,
	kind: string,
	id: string,
	refsMode: "none" | "outbound" | "both",
): QueryDetailResult | QueryNotFoundResult {
	const keyField = ROW_KIND_NATURAL_KEY[kind];
	const compositeFields = keyField === undefined ? ROW_KIND_COMPOSITE_KEY[kind] : undefined;
	if (keyField === undefined && compositeFields === undefined) {
		throw new Error(
			`${QUERY_TOOL}: unknown kind '${kind}' — not a manifest row kind. The offending param is \`kind\`.`,
		);
	}
	// One row lookup, shape-agnostic over which key kind of `kind` carries.
	const findRow = (rows: Record<string, unknown>[]): Record<string, unknown> | undefined =>
		compositeFields !== undefined
			? findRowByCompositeKey(
					{ [kind]: rows },
					kind,
					compositeFields,
					parseCompositeQueryId(id, compositeFields),
				)
			: rows.find((row) => row[keyField as string] === id);

	const workspaceRow = findRow(stringRows(manifest, kind));
	let row: Record<string, unknown> | undefined = workspaceRow;
	let source: "workspace" | "local" | "live" | undefined =
		workspaceRow !== undefined ? "workspace" : undefined;
	const refsManifest = manifest;
	// `extra.fullManifest()` materialises EVERY known row kind from the target, so
	// it is built lazily: a keyed row's outbound refs need only the row itself
	// (see the non-composite branch below), and a per-row rebuild made a full
	// closure walk quadratic in world size (live-preseeded discovery-closure).
	let refsManifestFromExtra: (() => Record<string, unknown>) | undefined;
	if (row === undefined && extra !== undefined) {
		const extraRow = findRow(extra.rows(kind));
		if (extraRow !== undefined) {
			row = extraRow;
			source = extra.label;
			refsManifestFromExtra = () => extra.fullManifest();
		}
	}
	if (row === undefined || source === undefined) {
		return { shape: "detail", kind, id, found: false };
	}
	const result: QueryDetailResult = { shape: "detail", kind, id, found: true, source, row };
	if (refsMode !== "none") {
		if (compositeFields !== undefined) {
			// Composite-keyed kinds (finding #9's `*_tag` satellites): outbound
			// refs only, excluding both key fields as the row's own identity —
			// see QueryDetailResult.inbound_refs' doc comment for why inbound
			// discovery isn't generalized to these kinds yet. Concatenated with
			// `refTagOutboundRefs` (finding #2, srd-cc finding ledger): a
			// `tag` value like `srd.ability.wis` is invisible to
			// `outboundRefsExcluding`'s field-NAME heuristic (the field is
			// literally named `tag`) but would resolve via a CALLER-SUPPLIED
			// `RefTagFamily[]` — resolved against `refsManifest` (not the outer
			// `manifest` param), so a `local`-target row's tag resolves against
			// that target's own full manifest, not just the (possibly empty)
			// workspace scratch bundle.
			//
			// Families now come from `refsManifest` itself (`tag-vocabulary-
			// declaration` change, Slice A): `manifestTagPrefixFamilies` reads
			// whatever the resolved bundle's own `[[bundle.tag_prefixes]]` rows
			// declare. A bundle declaring none still gets `[]` (the same zero-
			// default behavior this call site had before) — this is not a
			// fallback vocabulary, just a second source for the same argument.
			const tagManifest = refsManifestFromExtra?.() ?? refsManifest;
			result.outbound_refs = outboundRefsExcluding(row, compositeFields).concat(
				refTagOutboundRefs(tagManifest, row, manifestTagPrefixFamilies(tagManifest)),
			);
		} else if (refsMode === "outbound") {
			// Outbound refs read only the row's own fields; inbound discovery (the
			// whole-manifest scan) is not requested, so a one-row manifest gives the
			// identical `outbound` without materialising or scanning the world.
			result.outbound_refs = inspectRowReferences({ [kind]: [row] }, kind, id).outbound;
		} else {
			const refs = inspectRowReferences(refsManifestFromExtra?.() ?? refsManifest, kind, id);
			result.outbound_refs = refs.outbound;
			if (refsMode === "both") result.inbound_refs = refs.inbound;
		}
	}
	return result;
}

export const queryToolDef = defineTool({
	contract: QUERY_TOOL,
	schema: QUERY_PARAMS,
	exampleParams: { kind: "resource_definitions", id: "aoe_blast/hp" },
	run: async (
		context: AuthorToolContext,
		params: Static<typeof QUERY_PARAMS>,
	): Promise<AuthorToolResult<QueryResult | ExplorationResult>> => {
		if (params.explore !== undefined) {
			if (
				Object.keys(params).some(
					(key) => key !== "explore" && params[key as keyof typeof params] !== undefined,
				)
			) {
				throw new ToolArgumentValidationError(QUERY_TOOL, [
					{ path: "/explore", message: "explore is exclusive with legacy query parameters." },
				]);
			}
			const explored = await explore(context.exploration, params.explore);
			// Malformed by request + static schema alone: fail loud on the usage path,
			// naming the declared alternatives. Everything else keeps its envelope.
			if (EXPLORATION_ARGUMENT_REASONS.has(explored.reason ?? "")) {
				const valid = explored.valid?.length ? `; valid: ${explored.valid.join(", ")}` : "";
				throw new ToolArgumentValidationError(QUERY_TOOL, [
					{ path: "/explore", message: `${explored.reason}${valid}` },
				]);
			}
			return toolResult(explored);
		}
		// The shape question is answered from the schema alone — it consults no
		// workspace, target, or live db, so it short-circuits before any of the
		// source resolution below.
		if (params.schema === true) {
			return toolResult(resolveQuerySchema(params.kind));
		}
		if (params.id !== undefined && params.pattern !== undefined) {
			throw new Error(
				`${QUERY_TOOL}: \`id\` and \`pattern\` are mutually exclusive — the offending params are \`id\`/\`pattern\`.`,
			);
		}
		if ((params.id !== undefined || params.pattern !== undefined) && params.kind === undefined) {
			throw new Error(
				`${QUERY_TOOL}: \`id\`/\`pattern\` require \`kind\` — the offending param is \`kind\`.`,
			);
		}
		const toml = context.workspace.readToml();
		const manifest =
			toml === null ? {} : (inspectManifest(toml).manifest as Record<string, unknown>);
		const db = currentDb(context);
		const extra = resolveQueryExtraSource(context, db, params.target);

		if (params.kind === undefined) {
			const summary = resolveQuerySummary(manifest, extra, params.bundle);
			if (shouldAttachGuide(params.target, extra !== undefined, workspaceHasRows(manifest))) {
				summary.guidance = readOnlyGuidance();
			}
			return toolResult(summary);
		}
		if (params.id !== undefined) {
			return toolResult(
				resolveQueryDetail(manifest, extra, params.kind, params.id, params.refs ?? "both"),
			);
		}
		const list = resolveQueryList(
			manifest,
			extra,
			params.kind,
			params.bundle,
			params.pattern,
			params.fields,
		);
		if (shouldAttachGuide(params.target, extra !== undefined, workspaceHasRows(manifest))) {
			list.guidance = readOnlyGuidance();
		}
		return toolResult(list);
	},
});

function resolveEvalManifestToml(context: AuthorToolContext): string | null {
	const toml = context.workspace.readToml();
	const target = resolveAuthorTarget(context.target);
	if (target === undefined) {
		return toml;
	}
	try {
		const scratch = toml ? (inspectManifest(toml).manifest as Record<string, unknown>) : {};
		// Evaluation loads only macros and roll-table entries. Do not reuse the
		// broader validation augmentation: an unrelated malformed target definition
		// must not make an otherwise independent bench expression disappear.
		const augmented: Record<string, unknown> = {
			schema_version: scratch.schema_version ?? "1.0.0",
			...scratch,
		};
		for (const kind of ["dsl_macro_definitions", "roll_table_entries"] as const) {
			const existing = stringRows(scratch, kind);
			const extra: Record<string, unknown>[] = JSON.parse(
				extra_rows_by_natural_key_json(
					kind,
					JSON.stringify(existing),
					JSON.stringify(target.lookup(kind)),
				),
			);
			if (extra.length > 0) augmented[kind] = [...existing, ...extra];
		}
		// A macro row names its owning bundle. Include only those owners from the
		// same target source so the schema renderer can produce a parseable TOML;
		// roll-table rows need no bundle column or table row for the bench loader.
		const macroBundleIds = new Set(
			stringRows(augmented, "dsl_macro_definitions")
				.map((row) => row.bundle_id)
				.filter((bundleId): bundleId is string => typeof bundleId === "string"),
		);
		const existingBundles = stringRows(scratch, "bundles");
		const targetBundles = target
			.lookup("bundles")
			.filter((row) => typeof row.bundle_id === "string" && macroBundleIds.has(row.bundle_id));
		const extraBundles: Record<string, unknown>[] = JSON.parse(
			extra_rows_by_natural_key_json(
				"bundles",
				JSON.stringify(existingBundles),
				JSON.stringify(targetBundles),
			),
		);
		if (extraBundles.length > 0) augmented.bundles = [...existingBundles, ...extraBundles];
		return renderSchemaManifest(sanitizeForSchemaRender(augmented) as Record<string, unknown>);
	} catch {
		return toml;
	}
}

export const evalToolDef = defineTool({
	contract: EVAL_TOOL,
	schema: EVAL_PARAMS,
	exampleParams: {
		expression: "1d20 + actor.stat('demo/bonus') >= target.stat('demo/threshold')",
		kind: "predicate",
		facts: {
			actor: { stat: { "demo/bonus": 3 } },
			target: { stat: { "demo/threshold": 15 } },
		},
		dice: [12],
	},
	run: async (
		context: AuthorToolContext,
		params: Static<typeof EVAL_PARAMS>,
	): Promise<AuthorToolResult<EvaluationResult>> => {
		const manifestToml = resolveEvalManifestToml(context);
		const result = evaluateDslExpression({
			expression: params.expression,
			kind: params.kind,
			facts: params.facts as Record<string, unknown> | undefined,
			dice: params.dice,
			manifestToml,
		});
		return toolResult(result);
	},
});

const SPATIAL_ROW_KINDS = [
	"place_graphs",
	"place_nodes",
	"place_edges",
	"actor_spatial_locations",
] as const;

/** Collect full tool-shaped rows for spatial kinds via the same sources as spellkave_query. */
function collectSpatialToolRows(
	context: AuthorToolContext,
	target: QueryTargetOverride,
): {
	rows: {
		place_graphs: Record<string, unknown>[];
		place_nodes: Record<string, unknown>[];
		place_edges: Record<string, unknown>[];
		actor_spatial_locations: Record<string, unknown>[];
	};
	source: "workspace" | "workspace+live" | "workspace+local";
	hasExtraSource: boolean;
	workspaceHasRows: boolean;
} {
	const toml = context.workspace.readToml();
	const manifest = toml === null ? {} : (inspectManifest(toml).manifest as Record<string, unknown>);
	const db = currentDb(context);
	const extra = resolveQueryExtraSource(context, db, target);
	const collected: Record<(typeof SPATIAL_ROW_KINDS)[number], Record<string, unknown>[]> = {
		place_graphs: [],
		place_nodes: [],
		place_edges: [],
		actor_spatial_locations: [],
	};
	for (const kind of SPATIAL_ROW_KINDS) {
		const keyField = ROW_KIND_NATURAL_KEY[kind];
		const idOf = (row: Record<string, unknown>): string | undefined =>
			keyField !== undefined && typeof row[keyField] === "string"
				? (row[keyField] as string)
				: undefined;
		// actor_spatial_locations may lack a single natural key in ROW_KIND_NATURAL_KEY —
		// fall back to append-merge by stable JSON identity.
		if (keyField === undefined) {
			const workspaceRows = stringRows(manifest, kind);
			const extraRows = extra ? extra.rows(kind) : [];
			collected[kind] = [...workspaceRows, ...extraRows];
			continue;
		}
		const hasId = (row: Record<string, unknown>): boolean => idOf(row) !== undefined;
		collected[kind] = mergeExtraRows(
			stringRows(manifest, kind).filter(hasId),
			(row) => idOf(row) as string,
			(extra ? extra.rows(kind) : []).filter(hasId),
		);
	}
	return {
		rows: collected,
		source: querySourceLabel(extra),
		hasExtraSource: extra !== undefined,
		workspaceHasRows: workspaceHasRows(manifest),
	};
}

// Raster width for output_type='jpg' map-art — same choice PLAYER's
// spellkave_map (tools.ts, MAP_JPEG_WIDTH_PX) and kavemouth's renders.ts
// make for their own "with-map" product views (git-friendly size, still
// legible backdrop art).
const AUTHOR_MAP_JPEG_WIDTH_PX = 900;

export const mapGraphToolDef = defineTool<
	AuthorToolContext,
	typeof MAP_GRAPH_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: MAP_GRAPH_TOOL,
	schema: MAP_GRAPH_PARAMS,
	requiredCapabilities: ["node"],
	run: async (
		context: AuthorToolContext,
		params: Static<typeof MAP_GRAPH_PARAMS>,
		_toolCallId,
		capabilities,
	): Promise<
		AuthorToolResult<{
			source: string;
			graph: string | null;
			has_layout: boolean;
			places: number;
			routes: number;
			actors: number;
			unreachable: string[];
			inventory: string;
			svg?: string | null;
			ascii?: string | null;
			utf8?: string | null;
			braille?: string | null;
			/** output_type='jpg' only — the written file's path, or null when the
			 * layout never resolved (nothing to render). */
			jpg_path?: string | null;
			backdrops_resolved?: number;
			backdrops_skipped?: number;
			guidance?: string;
		}>
	> => {
		const map = capabilities?.node?.map;
		if (map === undefined) throw new Error("spellkave_map_graph requires Node map capability.");
		const { buildSpatialGraphView, countMapPlaces, spatialRenderPlanForOutputType } = await import(
			"@spellkave/world-map/svg"
		);
		const { rows, source, hasExtraSource, workspaceHasRows } = collectSpatialToolRows(
			context,
			params.target,
		);
		// Optional out-of-repo bitmap overlay from [[map_layers]] (asset modules / FVTT).
		const toml = context.workspace.readToml();
		const manifest =
			toml === null ? {} : (inspectManifest(toml).manifest as Record<string, unknown>);
		const layerRows = stringRows(manifest, "map_layers");
		const {
			backdrops,
			resolved: backdropsResolved,
			skipped: backdropsSkipped,
		} = map.mapLayersToBackdrops(layerRows);
		// sk-pej D-2: composing a session grid over its parent needs the
		// parent's own grid_distance_m (model.ts's metresPerParentLocalUnit) —
		// a DIFFERENT concern from `backdrops` above (which draws the art).
		// `layerRows` is already the full unfiltered manifest set, so this is
		// a type-shape addition only, no new row-sourcing.
		const rowsWithLayers = { ...rows, map_layers: layerRows };
		const outputType = params.output_type ?? "svg";
		const { renderOnly, terminal } = spatialRenderPlanForOutputType(outputType);
		const view = buildSpatialGraphView(rowsWithLayers, {
			graphId: params.graph,
			slice: params.slice,
			z: params.z,
			zTolerance: params.z_tolerance,
			lod: params.lod,
			// Outdoor multi-graph defaults to H3 when cells exist (preferH3World).
			preferH3World: params.graph === undefined || params.graph.trim() === "",
			terminal,
			renderOnly,
			// Sheet backdrops only when drawing a single graph (world H3 plane ≠ image cells).
			backdrops: (params.graph ? backdrops : []) as never,
			backdropHref: (b) => b.asset,
		});
		const actors = view.model.actorClusters.reduce((sum, cluster) => sum + cluster.count, 0);
		const placeCount = countMapPlaces(view.model);
		const guidance = shouldAttachGuide(params.target, hasExtraSource, workspaceHasRows)
			? readOnlyGuidance()
			: undefined;
		const inventory = `${view.inventory}${guidance ? `\n\n${guidance}` : ""}`;
		// Primary text variant for the ONE requested text output_type — null for
		// svg/jpg/inventory (those bodies are header+inventory only, below).
		const primaryText =
			outputType === "utf8"
				? view.utf8
				: outputType === "ascii"
					? view.ascii
					: outputType === "braille"
						? view.braille
						: null;
		// Terminal map in the text body (monospace-friendly) when requested; SVG/PNG still attached.
		const text = view.hasLayout
			? [
					`Spatial graph (${placeCount} places, ${view.model.edges.length} routes).`,
					primaryText ?? "",
					"",
					"--- inventory ---",
					inventory,
				]
					.filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
					.join("\n")
			: inventory;

		// output_type='jpg' — writes a backdrop-composed map-art JPEG, same
		// contract as PLAYER's spellkave_map (tools.ts): a SECOND, dedicated
		// sheet-aligned view (the plain `view` above never sets sheetAlign, so
		// it stays byte-identical to a non-jpg call), full/unmasked backdrop art,
		// output_dir/output_name both OPTIONAL — `resolveMapJpegOutput` defaults
		// an omitted output_dir to a fresh temp directory and an omitted
		// output_name to one derived from `graph`.
		let jpgPath: string | null | undefined;
		if (outputType === "jpg") {
			jpgPath = null;
			if (view.hasLayout) {
				const jpegLayerRows = params.graph
					? layerRows.filter((row) => String(row.place_graph_id) === params.graph)
					: [];
				const jpegView = buildSpatialGraphView(rowsWithLayers, {
					graphId: params.graph,
					slice: params.slice,
					z: params.z,
					zTolerance: params.z_tolerance,
					lod: params.lod,
					preferH3World: params.graph === undefined || params.graph.trim() === "",
					renderOnly: ["svg"],
					sheetAlign: true,
					backdrops: (params.graph ? backdrops : []) as never,
					backdropHref: (b) => b.asset,
				});
				if (jpegView.svg !== null) {
					const output = await map.writeJpeg({
						outputDir: params.output_dir,
						outputName: params.output_name,
						graph: params.graph,
						svg: jpegView.svg,
						width: AUTHOR_MAP_JPEG_WIDTH_PX,
						layerRows: jpegLayerRows,
					});
					jpgPath = output.jpgPath;
				}
			}
		}

		// Attach PNG ImageContent so Pi TUI and sk share one tool result shape.
		return await map.attachSpatialGraphImage({
			content: [{ type: "text" as const, text }],
			details: {
				source,
				graph: params.graph?.trim() || null,
				has_layout: view.hasLayout,
				places: placeCount,
				routes: view.model.edges.length,
				actors,
				unreachable: view.model.unreachable,
				inventory,
				...(outputType === "utf8" ? { utf8: view.utf8 } : {}),
				...(outputType === "ascii" ? { ascii: view.ascii } : {}),
				...(outputType === "braille" ? { braille: view.braille } : {}),
				...(outputType === "svg" ? { svg: view.svg } : {}),
				...(outputType === "jpg" ? { jpg_path: jpgPath } : {}),
				backdrops_resolved: backdropsResolved,
				backdrops_skipped: backdropsSkipped,
				...(guidance === undefined ? {} : { guidance }),
			},
		});
	},
});

// ---------------------------------------------------------------------------
// 2. spellkave_author_place — place_graphs + place_nodes + place_edges.
// ---------------------------------------------------------------------------

/** Integer graph-local positions for outdoor map_graph drawing. */
function placeNodePositions(
	nodes: readonly { id: string; x?: number; y?: number }[],
): Map<string, { x: number; y: number }> {
	const out = new Map<string, { x: number; y: number }>();
	const allExplicit = nodes.every(
		(n) =>
			typeof n.x === "number" &&
			Number.isFinite(n.x) &&
			typeof n.y === "number" &&
			Number.isFinite(n.y),
	);
	if (allExplicit) {
		for (const n of nodes) {
			out.set(n.id, { x: Math.round(n.x as number), y: Math.round(n.y as number) });
		}
		return out;
	}
	const n = nodes.length;
	const radius = 10;
	if (n === 1) {
		const first = nodes[0];
		if (first === undefined) return out;
		out.set(first.id, { x: 0, y: 0 });
		return out;
	}
	if (n === 2) {
		const [first, second] = nodes;
		if (first === undefined || second === undefined) return out;
		out.set(first.id, { x: 0, y: 0 });
		out.set(second.id, { x: radius, y: 0 });
		return out;
	}
	// n >= 3: circle starting at north (y-up), clockwise — equilateral for n=3.
	for (let i = 0; i < n; i++) {
		const angle = Math.PI / 2 + (2 * Math.PI * i) / n;
		const node = nodes[i];
		if (node === undefined) continue;
		out.set(node.id, {
			x: Math.round(radius * Math.cos(angle)),
			y: Math.round(radius * Math.sin(angle)),
		});
	}
	return out;
}

function commonPlaceGraphId(nodeIds: string[], toolName: string): string {
	const split = nodeIds.map((id) => {
		const idx = id.lastIndexOf("/");
		if (idx <= 0) {
			throw new Error(
				`${toolName}: nodes[].id must be a fully-qualified '<place_graph_id>/<local_id>' path — got ` +
					`'${id}'. The offending param is \`nodes\` (PoC boundary, #1968).`,
			);
		}
		return { graphId: id.slice(0, idx), localId: id.slice(idx + 1) };
	});
	const graphId = split[0]?.graphId;
	if (graphId === undefined) {
		throw new Error(`${toolName}: \`nodes\` must include at least one place node.`);
	}
	for (const { graphId: other } of split) {
		if (other !== graphId) {
			throw new Error(
				`${toolName}: \`nodes\` must share ONE common place_graph per call (PoC boundary, #1968) — got ` +
					`both '${graphId}' and '${other}'. Call ${AUTHOR_PLACE_TOOL} once per place_graph.`,
			);
		}
	}
	return graphId;
}

export const authorPlaceToolDef = defineTool({
	contract: AUTHOR_PLACE_TOOL,
	schema: AUTHOR_PLACE_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		nodes: [
			{ id: "aoe_blast/arena/center", name: "Arena Center" },
			{ id: "aoe_blast/arena/fringe", name: "Arena Fringe" },
		],
		edges: [],
		description:
			"Blast arena: center holds the caster + targets, fringe proves the radius-0 boundary.",
	},
	run: async (context: AuthorToolContext, params: Static<typeof AUTHOR_PLACE_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, AUTHOR_PLACE_TOOL);
		const manifest = requireManifest(context);
		if (params.nodes.length === 0) {
			throw new Error(`${AUTHOR_PLACE_TOOL}: \`nodes\` must include at least one place node.`);
		}
		const graphId = commonPlaceGraphId(
			params.nodes.map((n) => n.id),
			AUTHOR_PLACE_TOOL,
		);
		const nodeIds = new Set(params.nodes.map((n) => n.id));
		const edges = params.edges.map((edge) => {
			const from = edge[0];
			const to = edge[1];
			if (from === undefined || to === undefined || edge.length !== 2) {
				throw new Error(
					`${AUTHOR_PLACE_TOOL}: each edges entry must be a [from_node_id, to_node_id] pair — ` +
						"the offending param is `edges`.",
				);
			}
			if (!nodeIds.has(from) || !nodeIds.has(to)) {
				throw new Error(
					`${AUTHOR_PLACE_TOOL}: edges entry [${from}, ${to}] references a node not present in \`nodes\` — ` +
						"the offending param is `edges`.",
				);
			}
			return [from, to] as const;
		});

		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		let rowsReplaced = 0;
		const graphLocalId = graphId.slice(graphId.lastIndexOf("/") + 1);
		const substrate =
			typeof params.substrate === "string" && params.substrate.trim().length > 0
				? params.substrate.trim()
				: PLACE_SUBSTRATE_DEFAULT;
		// #1968 workspace idempotency: `patchManifest`'s add-place-graph/add-place-
		// node/add-place-edge ops ALREADY upsert-by-key internally (see patch.ts —
		// "there was nothing to reinvent" per this file's header note); we only need
		// to PEEK before each call to know whether it is about to replace, for
		// honest `rows_replaced` accounting.
		if (stringRows(manifest, "place_graphs").some((r) => r.place_graph_id === graphId)) {
			rowsReplaced += 1;
		}
		const originCells = await resolveH3CellFamily(params.origin_cell_res10);
		patchManifest(manifest, "add-place-graph", {
			place_graph_id: graphId,
			bundle_id: bundle,
			substrate_id: substrate,
			display_name: params.display_name?.trim() || titleCase(graphLocalId),
			anchor_node_id: params.nodes[0]?.id,
			metres_per_unit:
				typeof params.metres_per_unit === "number" &&
				Number.isFinite(params.metres_per_unit) &&
				params.metres_per_unit > 0
					? params.metres_per_unit
					: 1.0,
			bearing:
				typeof params.bearing === "number" && Number.isFinite(params.bearing)
					? params.bearing
					: 0.0,
			parent_graph_id: params.parent_graph_id?.trim() ?? "",
			...(originCells
				? {
						origin_cell_res10: originCells.cell_res10,
						origin_cell_res7: originCells.cell_res7,
						origin_cell_res4: originCells.cell_res4,
					}
				: {}),
			...(params.description !== undefined ? { description: params.description } : {}),
		});
		rowsAdded += 1;

		const positions = placeNodePositions(params.nodes);
		for (const node of params.nodes) {
			const localId = node.id.slice(node.id.lastIndexOf("/") + 1);
			if (stringRows(manifest, "place_nodes").some((r) => r.node_id === node.id)) {
				rowsReplaced += 1;
			}
			const pos = positions.get(node.id) ?? { x: 0, y: 0 };
			const elevation =
				typeof node.elevation === "number" && Number.isFinite(node.elevation) ? node.elevation : 0;
			const nodeCells = await resolveH3CellFamily(node.cell_res10);
			patchManifest(manifest, "add-place-node", {
				node_id: node.id,
				bundle_id: bundle,
				place_graph_id: graphId,
				local_id: localId,
				substrate_id: substrate,
				display_name: node.name ?? titleCase(localId),
				pos_x: pos.x,
				pos_y: pos.y,
				pos_present: true,
				pose_elevation: elevation,
				pose_elevation_present: true,
				...(nodeCells
					? {
							cell_res10: nodeCells.cell_res10,
							cell_res7: nodeCells.cell_res7,
							cell_res4: nodeCells.cell_res4,
						}
					: {}),
				// T5 follow-up (#1968 pattern): the Rust add-place-node patch op
				// (place_graph_ops.rs) already accepts an optional `description`
				// field and writes it to place_nodes.description untouched — this
				// param was simply never exposed at the TS tool-schema layer until
				// now (PLACE_NODE_PARAMS above).
				...(node.description !== undefined ? { description: node.description } : {}),
				// cell-extent-overlap-inheritance (sk-pxl) 2.1: same story as
				// `description` above — place_graph_ops.rs's add-place-node op
				// already accepts extent_shape_id/extent_params_json (place-node-
				// extent, sk-71u), only the TS tool schema was missing them.
				...(node.extent_shape_id !== undefined ? { extent_shape_id: node.extent_shape_id } : {}),
				...(node.extent_params_json !== undefined
					? { extent_params_json: node.extent_params_json }
					: {}),
			});
			rowsAdded += 1;
		}

		for (const [from, to] of edges) {
			const edgeKey = `${from}->${to}`;
			if (stringRows(manifest, "place_edges").some((r) => r.edge_key === edgeKey)) {
				rowsReplaced += 1;
			}
			patchManifest(manifest, "add-place-edge", {
				edge_key: edgeKey,
				bundle_id: bundle,
				place_graph_id: graphId,
				from_node_id: from,
				to_node_id: to,
			});
			rowsAdded += 1;
		}

		const layoutSummary = params.nodes.map((node) => {
			const pos = positions.get(node.id) ?? { x: 0, y: 0 };
			const elev =
				typeof node.elevation === "number" && Number.isFinite(node.elevation) ? node.elevation : 0;
			const label = node.name ?? titleCase(node.id.slice(node.id.lastIndexOf("/") + 1));
			return `${node.id} "${label}" @ (${pos.x}, ${pos.y}, z=${elev})`;
		});
		const result = commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			AUTHOR_PLACE_TOOL,
			(d) =>
				d.path.includes(graphId) || Array.from(nodeIds).some((id) => d.path.includes(id))
					? "nodes"
					: undefined,
			{
				place_graph_id: graphId,
				layout: layoutSummary,
				edges: edges.map(([from, to]) => `${from}—${to}`),
			},
		);
		// Text agents: surface coordinates in the content line when valid.
		if ((result.details as VerbResult | undefined)?.ok === true) {
			const text = result.content.find((b) => b.type === "text");
			if (text && "text" in text && typeof text.text === "string") {
				text.text =
					`${text.text}\n` +
					`Graph ${graphId} layout:\n` +
					layoutSummary.map((line) => `  ${line}`).join("\n") +
					(edges.length > 0 ? `\nEdges: ${edges.map(([a, b]) => `${a}—${b}`).join(", ")}` : "");
			}
		}
		return result;
	},
});

/**
 * sk-9ll.7: one instance-level `entity_tag` per string, mirroring
 * `resources`'s clear-and-reseed idempotency exactly (see `placements[].tags`
 * / top-level `tags` below). NOT the same axis as a `spellkave_define_*`
 * verb's own `tags` param (entity_definition_tag et al, DEFINITION-level) —
 * this is INSTANCE-level `entity_tag`; the server reads the UNION of both
 * (`collect_entity_tags`) for `has_tag(...)` predicates and
 * `tag_capability_grant` resolution. Tag-grammar membership (MF-VAL-300) is
 * NOT re-validated here — it is enforced server-side by the shared validator
 * crate via this tool's own `commitOrReport` -> `validateManifestToml` call,
 * same as every other tag-bearing verb; no second grammar in TS.
 */

/**
 * #1968 connection-level target: EVERY ref-check checks the workspace FIRST,
 * then `context.target` when present — the structural fix for the "live-only
 * ref false-rejects offline" finding (US5/US6): a `local` target resolves refs
 * against its own `depends_on` chain even with NO db/connection at all, and a
 * `live` target resolves against the connected world exactly like the legacy
 * `db`-based check did. `db` stays checked too (unchanged, back-compat — a
 * host may still wire `context.db` directly without wrapping it in a
 * `target`); the two checks are additive, never exclusive.
 */
function resolveEntityDef(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	entityDef: string | undefined,
	toolName: string,
	target?: AuthorTarget,
): string | undefined {
	if (entityDef === undefined) return undefined;
	if (!entityDef.includes("/")) {
		throw new Error(
			`${toolName}: entity_def '${entityDef}' is not a fully-qualified catalog id — put the open entity ` +
				"kind in `kind`, or pass a catalog id containing '/'. The offending param is `entity_def`.",
		);
	}
	const inWorkspace = stringRows(manifest, "entity_definitions").some(
		(r) => r.entity_def_id === entityDef,
	);
	const inLive = db
		? liveTable(db, "entity_definition").some(
				(r) => (r.entityDefId ?? r.entity_def_id) === entityDef,
			)
		: false;
	const inTarget = target ? target.resolveRef("entity_definitions", entityDef) : false;
	if (!inWorkspace && !inLive && !inTarget) {
		throw new Error(
			`${toolName}: entity_def '${entityDef}' does not resolve to any authored entity_definitions row ` +
				`(workspace${db ? " or live world" : ""}${target ? ` or the active ${target.kind} target` : ""}) ` +
				"— the offending param is `entity_def`.",
		);
	}
	return entityDef;
}

function resolveAt(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	at: string,
	toolName: string,
	target?: AuthorTarget,
): void {
	const inWorkspace = stringRows(manifest, "place_nodes").some((r) => r.node_id === at);
	const inLive = db
		? liveTable(db, "visible_place_node").some((r) => (r.nodeId ?? r.node_id) === at)
		: false;
	const inTarget = target ? target.resolveRef("place_nodes", at) : false;
	if (!inWorkspace && !inLive && !inTarget) {
		throw new Error(
			`${toolName}: at '${at}' does not resolve to any authored place_nodes row (workspace${db ? " or live world" : ""}` +
				`${target ? ` or the active ${target.kind} target` : ""}) — the offending param is \`at\`.`,
		);
	}
}

/**
 * #1968 workspace idempotency: the next 1-based ordinal for an EXPLICIT
 * `key_prefix` — ALWAYS restarts at 1 for this prefix on every call (never
 * derived from what already exists in the workspace), so a re-run with the
 * SAME `key_prefix` reproduces the SAME keys deterministically and upserts.
 * `counters` is scoped to one placement-tool call (shared across placements
 * so two placements reusing the same literal prefix never collide within
 * that one call).
 */
function nextNamedIndex(counters: Map<string, number>, prefix: string): number {
	const next = (counters.get(prefix) ?? 0) + 1;
	counters.set(prefix, next);
	return next;
}

/**
 * #1968 workspace idempotency: the next 1-based ordinal for an ANONYMOUS (no
 * `key_prefix`) spawn — continues from however many `<bundle>/<slug>_<n>`
 * entities already exist in the workspace, so repeated calls are ADDITIVE
 * (a genuinely NEW entity_key every time) rather than colliding — matching
 * "anonymous spawns are additive" in the tool description.
 */
function nextAnonymousIndex(
	manifest: Record<string, unknown>,
	counters: Map<string, number>,
	bundle: string,
	slug: string,
): number {
	const stem = `${bundle}/${slug}_`;
	if (!counters.has(slug)) {
		let maxExisting = 0;
		for (const row of stringRows(manifest, "entities")) {
			const key = row.entity_key;
			if (typeof key !== "string" || !key.startsWith(stem)) continue;
			const ordinal = Number(key.slice(stem.length));
			if (Number.isInteger(ordinal) && ordinal > maxExisting) maxExisting = ordinal;
		}
		counters.set(slug, maxExisting);
	}
	const next = (counters.get(slug) ?? 0) + 1;
	counters.set(slug, next);
	return next;
}

/** The last `/`-segment of `entityDef` (or the whole thing if unqualified), slugified. */
function shortSlug(entityDef: string): string {
	const idx = entityDef.lastIndexOf("/");
	return slugify(idx >= 0 ? entityDef.slice(idx + 1) : entityDef);
}

/** Does any row in `rows` carry an `entity_key` under `stem` authored against a DIFFERENT entity_def_id? */
/**
 * sk-9ll.7: 'tag X grants capability Y' diagnostic — informational, never
 * blocking. Mirrors `capabilityExists`/`placeEdgeExists`'s own dual-source
 * (workspace + live db + connection-level target) lookup shape, but returns
 * every match instead of a boolean, since `tag_capability_grant` has no
 * single-column natural key (composite tag+capability_id+bundle_id, finding
 * #9 / sk-bwd) and a tag may carry more than one grant.
 */
function tagCapabilityGrants(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	tag: string,
	target?: AuthorTarget,
): string[] {
	const grants = new Set<string>();
	for (const row of stringRows(manifest, "tag_capability_grant")) {
		if (row.tag === tag && typeof row.capability_id === "string") grants.add(row.capability_id);
	}
	if (db !== undefined) {
		for (const row of liveTable(db, "tag_capability_grant")) {
			const capabilityId = (row.capabilityId ?? row.capability_id) as unknown;
			if (row.tag === tag && typeof capabilityId === "string") grants.add(capabilityId);
		}
	}
	if (target !== undefined) {
		for (const row of target.lookup("tag_capability_grant")) {
			if (row.tag === tag && typeof row.capability_id === "string") grants.add(row.capability_id);
		}
	}
	return Array.from(grants);
}

function anonymousSlugCollides(
	rows: Record<string, unknown>[],
	stem: string,
	entityDefId: string,
): boolean {
	return rows.some((r) => {
		const key = r.entity_key;
		return typeof key === "string" && key.startsWith(stem) && r.entity_def_id !== entityDefId;
	});
}

/**
 * #1968 addendum (meta-finding 3): an anonymous spawn's key stem defaults to
 * the SHORT last segment of a catalog `entity_def` path (`goblin_1`, not the
 * unwieldy `srd_monster_goblin_1`) — falling back to the FULLY-QUALIFIED slug
 * only when the short stem would collide, i.e. the workspace (or the active
 * target's local folder) already carries an entity spawned under that short
 * stem from a DIFFERENT entity_def_id (e.g. `srd/monster/goblin` vs
 * `homebrew/monster/goblin`, both short-slugging to `goblin`). A bare kind
 * literal (`entityDefId === undefined`) has no path to shorten — `slugify`
 * already returns its own short form, so no fallback logic applies.
 * `key_prefix`'s own explicit-identity semantics are UNCHANGED by this fix.
 */
function resolvePlacementSlug(
	manifest: Record<string, unknown>,
	target: AuthorTarget | undefined,
	bundle: string,
	entityDef: string,
	entityDefId: string | undefined,
): string {
	if (entityDefId === undefined) return slugify(entityDef);
	const short = shortSlug(entityDef);
	const stem = `${bundle}/${short}_`;
	if (anonymousSlugCollides(stringRows(manifest, "entities"), stem, entityDefId)) {
		return slugify(entityDef);
	}
	if (target && anonymousSlugCollides(target.lookup("entities", { bundle }), stem, entityDefId)) {
		return slugify(entityDef);
	}
	return short;
}

function placementToolDef(toolName: string, withActor: boolean) {
	return defineTool({
		contract: toolName,
		schema: PLACE_PARAMS,
		exampleParams: withActor
			? {
					bundle: "aoe_blast",
					kind: "npc",
					placements: [
						{ at: "aoe_blast/arena/center", count: 3, key_prefix: "caster" },
						{ at: "aoe_blast/arena/fringe", count: 1, key_prefix: "bystander" },
					],
					description:
						"Fireball proof cast: caster_1 is the mage; caster_2/caster_3 are targets; bystander_1 is the control.",
				}
			: {
					bundle: "aoe_blast",
					kind: "item",
					at: "aoe_blast/arena/center",
					key_prefix: "lever",
					description: "A fixed brass lever set into the arena wall.",
				},
		run: async (context: AuthorToolContext, params: Static<typeof PLACE_PARAMS>) => {
			const bundle = resolveBundle(context, params.bundle, toolName);
			const manifest = requireManifest(context);
			let rowsAdded = ensureBundleScaffold(manifest, bundle);
			let rowsReplaced = 0;
			const db = currentDb(context);
			if (params.kind.trim().length === 0) {
				throw new Error(`${toolName}: \`kind\` must not be empty.`);
			}

			const flatGiven =
				params.at !== undefined ||
				params.count !== undefined ||
				params.resources !== undefined ||
				params.tags !== undefined ||
				params.key_prefix !== undefined ||
				params.entity_key !== undefined;
			const placementsGiven = params.placements !== undefined;
			if (flatGiven && placementsGiven) {
				throw new Error(
					`${toolName}: \`at\`/\`count\`/\`resources\`/\`tags\`/\`key_prefix\`/\`entity_key\` and \`placements\` are ` +
						"mutually exclusive — pass ONE shape, never both. The offending params are `at`, `count`, " +
						"`resources`, `tags`, `key_prefix`, `entity_key`, `placements`. (`description`/`name`/`name_prefix`/`quantity` are " +
						"shared defaults across EVERY placement in either shape — not part of this mutual exclusivity.)",
				);
			}
			if (!flatGiven && !placementsGiven) {
				throw new Error(
					`${toolName}: either \`at\` (+ optional count/resources/tags/key_prefix/entity_key) or \`placements\` is ` +
						"required — the offending param is `at`.",
				);
			}
			const placements: Static<typeof PLACEMENT_PARAMS>[] = placementsGiven
				? (params.placements as Static<typeof PLACEMENT_PARAMS>[])
				: [
						{
							at: params.at as string,
							count: params.count,
							resources: params.resources,
							tags: params.tags,
							key_prefix: params.key_prefix,
							entity_key: params.entity_key,
							name: params.name,
							name_prefix: params.name_prefix,
							quantity: params.quantity,
						},
					];
			if (placements.length === 0) {
				throw new Error(`${toolName}: \`placements\` must include at least one entry.`);
			}
			if (withActor) {
				const quantityOnActor =
					params.quantity !== undefined || placements.some((p) => p.quantity !== undefined);
				if (quantityOnActor) {
					throw new Error(
						`${toolName}: \`quantity\` is not supported here — actors carry no stack (only ` +
							`${PLACE_ENTITY_TOOL}'s own entities row does). Use ${PLACE_ENTITY_TOOL} for a stackable ` +
							"item instance instead. The offending param is `quantity`.",
					);
				}
			}
			for (const placement of placements) {
				if (placement.entity_key !== undefined && placement.key_prefix !== undefined) {
					throw new Error(
						`${toolName}: \`entity_key\` and \`key_prefix\` are mutually exclusive — pass ONE, never both. ` +
							"The offending params are `entity_key`, `key_prefix`.",
					);
				}
				if (
					placement.entity_key !== undefined &&
					placement.count !== undefined &&
					placement.count > 1
				) {
					throw new Error(
						`${toolName}: \`entity_key\` is an explicit LITERAL key and only legal for a single instance — ` +
							"omit `count` or set it to 1. The offending params are `entity_key`, `count`.",
					);
				}
			}

			const target = resolveAuthorTarget(context.target);
			const entityDefId = resolveEntityDef(manifest, db, params.entity_def, toolName, target);
			for (const placement of placements) resolveAt(manifest, db, placement.at, toolName, target);

			const entityKeys: string[] = [];
			const tagCapabilityGrantDiagnostics: Array<{
				entity_key: string;
				tag: string;
				capability_id: string;
			}> = [];
			const namedCounters = new Map<string, number>();
			const anonymousCounters = new Map<string, number>();
			const identitySource = params.entity_def ?? params.kind;
			const slug = resolvePlacementSlug(manifest, target, bundle, identitySource, entityDefId);
			for (const placement of placements) {
				const count =
					placement.count !== undefined && placement.count > 0 ? Math.trunc(placement.count) : 1;
				for (let i = 0; i < count; i++) {
					let entityKey: string;
					let ordinalLabel: number | undefined;
					if (placement.entity_key !== undefined) {
						entityKey = placement.entity_key;
					} else if (placement.key_prefix !== undefined) {
						ordinalLabel = nextNamedIndex(namedCounters, placement.key_prefix);
						entityKey = `${bundle}/${placement.key_prefix}_${ordinalLabel}`;
					} else {
						ordinalLabel = nextAnonymousIndex(manifest, anonymousCounters, bundle, slug);
						entityKey = `${bundle}/${slug}_${ordinalLabel}`;
					}
					entityKeys.push(entityKey);
					// #1968 workspace idempotency: `add-entity`/`add-actor` ALREADY upsert
					// by entity_key internally (patch.ts) — a repeated `key_prefix` call
					// therefore replaces those two kinds for FREE. `existed` (peeked BEFORE
					// either call) is only for honest `rows_replaced` accounting.
					const existed = stringRows(manifest, "entities").some((r) => r.entity_key === entityKey);
					// sk-ntz.1: an explicit `name` (per-placement, else flat) is used VERBATIM — no ordinal suffix
					// — the escape hatch that lets this verb reproduce a fixture's own custom display name (the
					// entity/actor name-cosmetic diff the sk-ntz.1 fold's own fixture regeneration surfaced).
					const explicitName = placement.name ?? params.name;
					const namePrefix = placement.name_prefix ?? params.name_prefix;
					if (explicitName !== undefined && namePrefix !== undefined) {
						throw new Error(
							`${toolName}: \`name\` and \`name_prefix\` are mutually exclusive — pass ONE, never both. ` +
								"The offending params are `name`, `name_prefix`.",
						);
					}
					if (namePrefix !== undefined && namePrefix.trim().length === 0) {
						throw new Error(
							`${toolName}: \`name_prefix\` must not be empty. The offending param is \`name_prefix\`.`,
						);
					}
					if (namePrefix !== undefined && ordinalLabel === undefined) {
						throw new Error(
							`${toolName}: \`name_prefix\` keeps the ordinal suffix and is not legal with \`entity_key\` ` +
								"(no ordinal is minted). Use `name` for a verbatim single-instance display name. " +
								"The offending params are `name_prefix`, `entity_key`.",
						);
					}
					const name =
						explicitName !== undefined
							? explicitName
							: ordinalLabel !== undefined
								? `${namePrefix ?? titleCase(identitySource)} ${ordinalLabel}`
								: titleCase(identitySource);
					// sk-ntz.1: an explicit `quantity` (per-placement, else flat) is entities-only — `withActor`
					// already rejected it above for spellkave_place_actor, so it is safe to forward here unconditionally.
					const quantity = placement.quantity ?? params.quantity;
					patchManifest(manifest, "add-entity", {
						entity_key: entityKey,
						bundle_id: bundle,
						name,
						kind: params.kind,
						place_node_id: placement.at,
						...(entityDefId !== undefined ? { entity_def_id: entityDefId } : {}),
						...(params.description !== undefined ? { description: params.description } : {}),
						...(quantity !== undefined ? { quantity } : {}),
					});
					rowsAdded += 1;
					if (existed) rowsReplaced += 1;
					if (withActor) {
						patchManifest(manifest, "add-actor", {
							entity_key: entityKey,
							bundle_id: bundle,
							name,
							place_node_id: placement.at,
						});
						rowsAdded += 2; // add-actor also emits the actor_spatial_locations sidecar.
						if (existed) rowsReplaced += 2;
					} else {
						rowsReplaced += clearRowsByKey(manifest, "actors", "entity_key", entityKey);
						rowsReplaced += clearRowsByKey(
							manifest,
							"actor_spatial_locations",
							"entity_key",
							entityKey,
						);
					}

					// object_state is placement's OWN satellite (not a patchManifest op) — clear
					// wholesale, scoped to this entity_key, mirroring add-actor's cascade to
					// its actor_spatial_locations sidecar (a re-run with FEWER `resources`
					// must not leave a stale seed behind).
					rowsReplaced += clearRowsByKey(manifest, "object_state", "entity_key", entityKey);
					for (const seed of placement.resources ?? []) {
						rowArray(manifest, "object_state").push({
							entity_key: entityKey,
							state_id: seed.resource,
							value_int: seed.value,
							source_template_id: "manifest",
							bundle_id: bundle,
						});
						rowsAdded += 1;
					}

					// sk-9ll.7: instance entity_tag is placement's OWN satellite too — same
					// clear-and-reseed idempotency as object_state above (a re-run with
					// FEWER `tags` must not leave a stale one behind). Tag-grammar
					// membership (MF-VAL-300) is enforced by the shared validator at
					// `commitOrReport` time below, never re-validated here.
					rowsReplaced += clearRowsByKey(manifest, "entity_tag", "entity_key", entityKey);
					const tagGroup = tagRows("entity_key", entityKey, bundle, placement.tags);
					rowArray(manifest, "entity_tag").push(...tagGroup);
					rowsAdded += tagGroup.length;
					for (const tagRow of tagGroup) {
						const tag = tagRow.tag as string;
						for (const capabilityId of tagCapabilityGrants(manifest, db, tag, target)) {
							tagCapabilityGrantDiagnostics.push({
								entity_key: entityKey,
								tag,
								capability_id: capabilityId,
							});
						}
					}
				}
			}

			return commitOrReport(
				context,
				manifest,
				rowsAdded,
				rowsReplaced,
				toolName,
				(d) => (entityKeys.some((k) => d.path.includes(k)) ? "entity_def/at" : undefined),
				{
					entity_keys: entityKeys,
					...(tagCapabilityGrantDiagnostics.length > 0
						? { tag_capability_grants: tagCapabilityGrantDiagnostics }
						: {}),
				},
			);
		},
	});
}

export const placeEntityToolDef = placementToolDef(PLACE_ENTITY_TOOL, false);
export const placeActorToolDef = placementToolDef(PLACE_ACTOR_TOOL, true);

export const linkPlacesToolDef = defineTool({
	contract: LINK_PLACES_TOOL,
	schema: LINK_PLACES_PARAMS,
	exampleParams: {
		from: "srd_playing_the_game_proof/hamlet/inn_front",
		to: "srd_playing_the_game_proof/inn/foyer",
		bidirectional: true,
		description: "ADR-0101: no per-edge affordance — relies on a bundle-wide movement_default.",
	},
	run: async (context: AuthorToolContext, params: Static<typeof LINK_PLACES_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, LINK_PLACES_TOOL);
		const manifest = requireManifest(context);
		const from = params.from.trim();
		const to = params.to.trim();
		if (from === to) {
			throw new Error(`${LINK_PLACES_TOOL}: from and to must differ.`);
		}
		const nodes = stringRows(manifest, "place_nodes");
		const fromRow = nodes.find((r) => r.node_id === from);
		const toRow = nodes.find((r) => r.node_id === to);
		if (fromRow === undefined || toRow === undefined) {
			throw new Error(
				`${LINK_PLACES_TOOL}: both nodes must already exist in the workspace ` +
					`(missing ${fromRow === undefined ? from : to}). Author places first.`,
			);
		}
		const fromGraph = String(fromRow.place_graph_id ?? "");
		const toGraph = String(toRow.place_graph_id ?? "");
		const fromSub = String(fromRow.substrate_id ?? "");
		const toSub = String(toRow.substrate_id ?? "");
		const crossGraph = fromGraph !== toGraph;
		const autoCrossing = crossGraph || (fromSub !== "" && toSub !== "" && fromSub !== toSub);
		const crossing =
			params.substrate_crossing !== undefined ? params.substrate_crossing : autoCrossing;
		const bidirectional = params.bidirectional !== false;
		// ADR-0101 D-7: opt-IN, not opt-out — an ordinary edge now inherits the
		// bundle/graph movement_default (place_edges.inherit_movement_default
		// defaults to true) instead of getting its own place_edge_affordance row.
		const portal = params.portal === true;
		const affordanceTemplateId =
			typeof params.affordance_template_id === "string" &&
			params.affordance_template_id.trim().length > 0
				? params.affordance_template_id.trim()
				: "core/affordance/traverse_open_portal";
		const bindingsJson = typeof params.bindings_json === "string" ? params.bindings_json : "";
		const pairs: Array<[string, string]> = bidirectional
			? [
					[from, to],
					[to, from],
				]
			: [[from, to]];

		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		let rowsReplaced = 0;
		const edgeKeys: string[] = [];

		for (const [a, b] of pairs) {
			const edgeKey = `${a}->${b}`;
			edgeKeys.push(edgeKey);
			if (stringRows(manifest, "place_edges").some((r) => r.edge_key === edgeKey)) {
				rowsReplaced += 1;
			}
			// Cross-graph: empty place_graph_id (phandelver stonehill pattern).
			const placeGraphId = crossGraph ? "" : fromGraph;
			patchManifest(manifest, "add-place-edge", {
				edge_key: edgeKey,
				bundle_id: bundle,
				place_graph_id: placeGraphId,
				from_node_id: a,
				to_node_id: b,
				substrate_crossing: crossing,
				// MF-VAL-102: cross-substrate edges need a non-zero cell_anchor (Stonehill).
				...(crossing
					? {
							cell_anchor: (() => {
								const raw = params.cell_anchor?.trim();
								if (raw && raw !== "0") return raw;
								return 1;
							})(),
							cell_anchor_present: true,
							cell_anchor_u: 0,
							cell_anchor_v: 0,
							from_anchor_side: "north",
							from_anchor_offset: 0.5,
							to_anchor_side: "south",
							to_anchor_offset: 0.5,
						}
					: {}),
				...(params.description !== undefined ? { description: params.description } : {}),
			});
			rowsAdded += 1;
			if (portal) {
				patchManifest(manifest, "add-place-edge-affordance", {
					edge_key: edgeKey,
					affordance_template_id: affordanceTemplateId,
					bindings_json: bindingsJson,
				});
				rowsAdded += 1;
			}
			if (params.door === true) {
				rowsAdded += ensureMetadataNamespace(
					manifest,
					bundle,
					"place.door",
					AUTHOR_AUDIENCE,
					"Door/portal annotation (locks not enforced yet).",
				);
				rowArray(manifest, "metadata_attachments").push({
					bundle_id: bundle,
					namespace: "place.door",
					target_kind: "place_edge",
					target_ref: edgeKey,
					source: "manifest",
					payload_json: JSON.stringify({
						kind: "door",
						locked: false,
						secret: false,
						note: "E-prep: lock/secret mechanics not wired yet",
					}),
				});
				rowsAdded += 1;
			}
		}

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			LINK_PLACES_TOOL,
			() => undefined,
			{
				edge_keys: edgeKeys,
				cross_graph: crossGraph,
				substrate_crossing: crossing,
				portal,
				affordance_template_id: portal ? affordanceTemplateId : null,
				bindings_json: portal ? bindingsJson : null,
				door: params.door === true,
			},
		);
	},
});

// ---------------------------------------------------------------------------
// 2b-1. spellkave_bind_edge_affordance — attach a place_edge_affordance to
// an edge that already exists. sk-9ll.2 (child of sk-9ll, the author-tool gap
// review): `spellkave_link_places` only wires a `place_edge_affordance` when
// it ALSO creates the edge (the `portal` branch above); attaching to an
// edge some EARLIER call already created was write_rows-only, so a typo'd
// `edge_key` validated against nothing (the Rust `add-place-edge-affordance`
// patch op upserts by (edge_key, affordance_template_id) but deliberately
// does not check either side exists — "cross-row resolution is the
// validator's job", `crates/spellkave-authoring/src/patch/no_bundle_id_ops.rs`
// — and the offline scratch-workspace validator never ran on a
// spellkave_write_rows call the caller never routed through it either).
//
// OPERATOR DECISION 2026-08-17: authors think in doors, not directed edges —
// same `from`/`to` + `bidirectional` idiom as `spellkave_link_places` above,
// not a raw `edge_key` param. No `bundle` param: `place_edge_affordance` has
// no `bundle_id` column (the same no-bundle-id row group as
// `roll_table_entries`/`entity_containment`, `crates/spellkave-authoring/src/
// patch/no_bundle_id_ops.rs`'s own module header).
//
// ADR-0101 D-7: `mode_id` (open author-chosen traversal-mode id, widening the
// Rust op's upsert key to (edge_key, affordance_template_id, mode_id) — a
// second mode on the SAME edge+template is a sibling row, not a replace) and
// `inherit_movement_default` (a per-edge REPLACE of whether the edge also
// receives the resolved bundle/graph movement_default) land here rather than
// on `spellkave_link_places`, per the design's own split: link_places only
// creates edges now, this verb owns everything about what stands on one.
// ---------------------------------------------------------------------------

/** Does `edgeKeyValue` resolve to an authored place_edges row (workspace, live db, or the
 * active connection-level `AuthorTarget`)? Mirrors `resourceExists`'s three-way check shape. */
function placeEdgeExists(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	edgeKeyValue: string,
	target: AuthorTarget | undefined,
): boolean {
	if (stringRows(manifest, "place_edges").some((r) => r.edge_key === edgeKeyValue)) return true;
	if (
		db !== undefined &&
		liveTable(db, "visible_place_edge").some((r) => (r.edgeKey ?? r.edge_key) === edgeKeyValue)
	) {
		return true;
	}
	return target ? target.resolveRef("place_edges", edgeKeyValue) : false;
}

/** Does `templateId` resolve to an authored affordance_templates row (workspace, live db, or
 * the active connection-level `AuthorTarget`)? Mirrors `resourceExists`'s three-way check shape. */
function affordanceTemplateExists(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	templateId: string,
	target: AuthorTarget | undefined,
): boolean {
	if (stringRows(manifest, "affordance_templates").some((r) => r.template_id === templateId)) {
		return true;
	}
	if (
		db !== undefined &&
		liveTable(db, "affordance_template").some((r) => (r.templateId ?? r.template_id) === templateId)
	) {
		return true;
	}
	return target ? target.resolveRef("affordance_templates", templateId) : false;
}

export const bindEdgeAffordanceToolDef = defineTool({
	contract: BIND_EDGE_AFFORDANCE_TOOL,
	schema: BIND_EDGE_AFFORDANCE_PARAMS,
	exampleParams: {
		from: "srd_playing_the_game_proof/hamlet/inn_front",
		to: "srd_playing_the_game_proof/inn/foyer",
		affordance_template_id: "srd/affordance/step",
		bindings_json: '{"movement_reach_resource":"srd/speed-walk"}',
	},
	run: async (context: AuthorToolContext, params: Static<typeof BIND_EDGE_AFFORDANCE_PARAMS>) => {
		const manifest = requireManifest(context);
		const from = params.from.trim();
		const to = params.to.trim();
		if (from === to) {
			throw new Error(`${BIND_EDGE_AFFORDANCE_TOOL}: from and to must differ.`);
		}
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);
		const bidirectional = params.bidirectional !== false;
		const pairs: Array<[string, string]> = bidirectional
			? [
					[from, to],
					[to, from],
				]
			: [[from, to]];
		const edgeKeys = pairs.map(([a, b]) => `${a}->${b}`);

		for (const edgeKeyValue of edgeKeys) {
			if (!placeEdgeExists(manifest, db, edgeKeyValue, target)) {
				throw new Error(
					`${BIND_EDGE_AFFORDANCE_TOOL}: edge '${edgeKeyValue}' does not exist in the workspace` +
						`${db ? " or live world" : ""}${target ? ` or the active ${target.kind} target` : ""} — ` +
						`link the places first via ${LINK_PLACES_TOOL} / ${AUTHOR_PLACE_TOOL} (the offending params ` +
						"are `from`/`to`).",
				);
			}
		}
		if (!affordanceTemplateExists(manifest, db, params.affordance_template_id, target)) {
			throw new Error(
				`${BIND_EDGE_AFFORDANCE_TOOL}: affordance_template_id '${params.affordance_template_id}' does not ` +
					`resolve to an authored affordance_templates row in the workspace${db ? " or live world" : ""}` +
					`${target ? ` or the active ${target.kind} target` : ""} — the offending param is ` +
					"`affordance_template_id`.",
			);
		}

		const bindingsJson = typeof params.bindings_json === "string" ? params.bindings_json : "";
		const modeId = typeof params.mode_id === "string" ? params.mode_id : "";
		let rowsAdded = 0;
		let rowsReplaced = 0;
		for (const edgeKeyValue of edgeKeys) {
			const existed = stringRows(manifest, "place_edge_affordance").some(
				(r) =>
					r.edge_key === edgeKeyValue &&
					r.affordance_template_id === params.affordance_template_id &&
					String(r.mode_id ?? "") === modeId,
			);
			patchManifest(manifest, "add-place-edge-affordance", {
				edge_key: edgeKeyValue,
				affordance_template_id: params.affordance_template_id,
				bindings_json: bindingsJson,
				mode_id: modeId,
			});
			rowsAdded += 1;
			if (existed) rowsReplaced += 1;
		}

		// ADR-0101 D-7: inherit_movement_default is a per-edge REPLACE on the
		// place_edges row — a whole-row upsert under the hood (add-place-edge),
		// so this needs the edge already authored IN THIS WORKSPACE to avoid
		// silently dropping its other columns (pose/cell/substrate fields).
		if (params.inherit_movement_default !== undefined) {
			for (const edgeKeyValue of edgeKeys) {
				const existingRow = stringRows(manifest, "place_edges").find(
					(r) => r.edge_key === edgeKeyValue,
				);
				if (existingRow === undefined) {
					throw new Error(
						`${BIND_EDGE_AFFORDANCE_TOOL}: inherit_movement_default can only replace an edge ` +
							`already authored in THIS workspace — edge '${edgeKeyValue}' exists only live/target, ` +
							"or was not authored via spellkave_link_places / spellkave_author_place in this " +
							"session (the offending param is `inherit_movement_default`).",
					);
				}
				patchManifest(manifest, "add-place-edge", {
					...existingRow,
					inherit_movement_default: params.inherit_movement_default,
				});
				rowsAdded += 1;
				rowsReplaced += 1;
			}
		}

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			BIND_EDGE_AFFORDANCE_TOOL,
			(d) => {
				if (d.path.endsWith(".mode_id")) return "mode_id";
				if (d.path.includes(params.affordance_template_id)) return "affordance_template_id";
				return undefined;
			},
			{
				edge_keys: edgeKeys,
				affordance_template_id: params.affordance_template_id,
				bindings_json: bindingsJson,
				mode_id: modeId,
				bidirectional,
				inherit_movement_default: params.inherit_movement_default ?? null,
			},
		);
	},
});

/** Does `placeGraphId` resolve to an authored place_graphs row (workspace, live db, or the
 * active connection-level `AuthorTarget`)? Mirrors `affordanceTemplateExists`'s own shape. */
function placeGraphExists(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	placeGraphId: string,
	target: AuthorTarget | undefined,
): boolean {
	if (stringRows(manifest, "place_graphs").some((r) => r.place_graph_id === placeGraphId)) {
		return true;
	}
	if (
		db !== undefined &&
		liveTable(db, "visible_place_graph_definition").some(
			(r) => (r.placeGraphId ?? r.place_graph_id) === placeGraphId,
		)
	) {
		return true;
	}
	return target ? target.resolveRef("place_graphs", placeGraphId) : false;
}

export const setMovementDefaultToolDef = defineTool({
	contract: SET_MOVEMENT_DEFAULT_TOOL,
	schema: SET_MOVEMENT_DEFAULT_PARAMS,
	run: async (context: AuthorToolContext, params: Static<typeof SET_MOVEMENT_DEFAULT_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, SET_MOVEMENT_DEFAULT_TOOL);
		const manifest = requireManifest(context);
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);
		const placeGraphId =
			typeof params.place_graph_id === "string" ? params.place_graph_id.trim() : "";
		const modeId = typeof params.mode_id === "string" ? params.mode_id : "";
		const bindingsJson = typeof params.bindings_json === "string" ? params.bindings_json : "";

		if (placeGraphId !== "" && !placeGraphExists(manifest, db, placeGraphId, target)) {
			throw new Error(
				`${SET_MOVEMENT_DEFAULT_TOOL}: place_graph_id '${placeGraphId}' does not resolve to an ` +
					`authored place_graphs row in the workspace${db ? " or live world" : ""}` +
					`${target ? ` or the active ${target.kind} target` : ""} — the offending param is ` +
					"`place_graph_id`.",
			);
		}
		if (!affordanceTemplateExists(manifest, db, params.affordance_template_id, target)) {
			throw new Error(
				`${SET_MOVEMENT_DEFAULT_TOOL}: affordance_template_id '${params.affordance_template_id}' ` +
					`does not resolve to an authored affordance_templates row in the workspace` +
					`${db ? " or live world" : ""}${target ? ` or the active ${target.kind} target` : ""} — ` +
					"the offending param is `affordance_template_id`.",
			);
		}

		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const existed = stringRows(manifest, "movement_defaults").some(
			(r) =>
				String(r.bundle_id ?? "") === bundle &&
				String(r.place_graph_id ?? "") === placeGraphId &&
				String(r.mode_id ?? "") === modeId &&
				r.affordance_template_id === params.affordance_template_id,
		);
		patchManifest(manifest, "add-movement-default", {
			bundle_id: bundle,
			place_graph_id: placeGraphId,
			mode_id: modeId,
			affordance_template_id: params.affordance_template_id,
			bindings_json: bindingsJson,
		});
		rowsAdded += 1;
		const rowsReplaced = existed ? 1 : 0;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			SET_MOVEMENT_DEFAULT_TOOL,
			(d) => {
				if (d.path.endsWith(".mode_id")) return "mode_id";
				if (d.path.includes(params.affordance_template_id)) return "affordance_template_id";
				return undefined;
			},
			{
				bundle_id: bundle,
				place_graph_id: placeGraphId,
				mode_id: modeId,
				affordance_template_id: params.affordance_template_id,
				bindings_json: bindingsJson,
			},
		);
	},
});

function requireMapLayerText(value: string | undefined, name: string): string {
	const text = value?.trim() ?? "";
	if (text === "") {
		throw new Error(`${ATTACH_MAP_LAYER_TOOL}: ${name} is required and has no default.`);
	}
	return text;
}

export const attachMapLayerToolDef = defineTool<
	AuthorToolContext,
	typeof ATTACH_MAP_LAYER_PARAMS,
	unknown,
	NodeToolCapabilities
>({
	contract: ATTACH_MAP_LAYER_TOOL,
	schema: ATTACH_MAP_LAYER_PARAMS,
	requiredCapabilities: ["node"],
	exampleParams: {
		place_graph_id: "kavemouth/hamlet",
		asset_module: "kavemouth-maps",
		asset_path: "maps/hamlet.jpg",
		posture: "cc-by-4.0",
		source_kind: "first-party",
	},
	run: async (
		context: AuthorToolContext,
		params: Static<typeof ATTACH_MAP_LAYER_PARAMS>,
		_toolCallId,
		capabilities,
	) => {
		const map = capabilities?.node?.map;
		if (map === undefined)
			throw new Error("spellkave_attach_map_layer requires Node map capability.");
		const bundle = resolveBundle(context, params.bundle, ATTACH_MAP_LAYER_TOOL);
		const manifest = requireManifest(context);
		const graphId = params.place_graph_id.trim();
		if (!stringRows(manifest, "place_graphs").some((r) => r.place_graph_id === graphId)) {
			throw new Error(
				`${ATTACH_MAP_LAYER_TOOL}: place_graph '${graphId}' not in workspace — author_place first.`,
			);
		}
		const layerId = params.map_layer_id?.trim() || `${graphId}/backdrop`;
		// No built-in source: the caller names the module, the source kind and
		// the licence posture. The schema requires them; blank strings are
		// refused here because a silent default would stamp a wrong provenance.
		const assetModule = requireMapLayerText(params.asset_module, "asset_module");
		const sourceKind = requireMapLayerText(params.source_kind, "source_kind");
		const posture = requireMapLayerText(params.posture, "posture");
		const assetPath = params.asset_path.trim();
		const displayName =
			params.display_name?.trim() || titleCase(graphId.slice(graphId.lastIndexOf("/") + 1));

		// Best-effort local probe for dimensions (optional; params win).
		let widthPx =
			typeof params.image_width_px === "number" && params.image_width_px > 0
				? params.image_width_px
				: 0;
		let heightPx =
			typeof params.image_height_px === "number" && params.image_height_px > 0
				? params.image_height_px
				: 0;
		if (widthPx === 0 || heightPx === 0) {
			try {
				const size = map.probeAssetDimensions({ assetModule, assetPath });
				// JPG: leave 0 unless params set. map_graph still resolves file for overlay.
				if (size) {
					widthPx = size.width;
					heightPx = size.height;
				}
			} catch {
				/* offline / no root */
			}
		}

		const gridSize =
			typeof params.grid_size_px === "number" && params.grid_size_px > 0 ? params.grid_size_px : 0;
		const localW =
			typeof params.local_width_cells === "number" && params.local_width_cells > 0
				? params.local_width_cells
				: widthPx > 0 && gridSize > 0
					? widthPx / gridSize
					: 0;
		const localH =
			typeof params.local_height_cells === "number" && params.local_height_cells > 0
				? params.local_height_cells
				: heightPx > 0 && gridSize > 0
					? heightPx / gridSize
					: 0;

		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		let rowsReplaced = 0;
		const layers = rowArray(manifest, "map_layers");
		const existingIdx = layers.findIndex((r) => r.map_layer_id === layerId);
		if (existingIdx >= 0) {
			layers.splice(existingIdx, 1);
			rowsReplaced += 1;
		}
		layers.push({
			map_layer_id: layerId,
			bundle_id: bundle,
			place_graph_id: graphId,
			display_name: displayName,
			asset_module: assetModule,
			asset_path: assetPath,
			source_kind: sourceKind,
			state: params.state?.trim() || "template",
			posture,
			image_width_px: widthPx,
			image_height_px: heightPx,
			grid_size_px: gridSize,
			// ⚠️ UNIT DEFAULT — the value here is METRES, not feet (sk-yze).
			// This line was `?? 5` while the column was `grid_distance_m`;
			// the rename to `grid_distance_m` makes a bare 5 mean 5 METRES per
			// battlemap square, ~3.28x too large, in every map authored without
			// naming the value explicitly. Nothing would catch it: no type
			// changes, no test covers a default. The doctor's
			// `MapLayerGridDistancePlausible` check (band 0 < x < 5.0) is the
			// mechanical backstop for exactly this class.
			grid_distance_m: params.grid_distance_m ?? DEFAULT_GRID_DISTANCE_M,
			local_width_cells: localW,
			local_height_cells: localH,
			image_origin_x: params.image_origin_x ?? 0,
			image_origin_y: params.image_origin_y ?? 0,
			rotation_deg: params.rotation_deg ?? 0,
			min_zoom: 0,
			max_zoom: 0,
			description: `Backdrop ${assetPath} (${assetModule})`,
		});
		rowsAdded += 1;

		if (params.provenance !== false) {
			rowsAdded += ensureMetadataNamespace(
				manifest,
				bundle,
				"provenance.source",
				AUTHOR_AUDIENCE,
				"Source/license provenance for authored place content.",
			);
			rowArray(manifest, "metadata_attachments").push({
				bundle_id: bundle,
				namespace: "provenance.source",
				target_kind: "place_graph",
				target_ref: graphId,
				source: "manifest",
				payload_json: JSON.stringify({
					map_id: params.map_id ?? "",
					file: assetPath,
					module: assetModule,
					license: posture,
					license_url: params.license_url?.trim() ?? "",
					source_url: params.source_url?.trim() ?? "",
				}),
			});
			rowsAdded += 1;
		}

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			ATTACH_MAP_LAYER_TOOL,
			() => undefined,
			{
				map_layer_id: layerId,
				place_graph_id: graphId,
				asset_module: assetModule,
				asset_path: assetPath,
				image_width_px: widthPx,
				image_height_px: heightPx,
			},
		);
	},
});

export const annotatePlaceToolDef = defineTool({
	contract: ANNOTATE_PLACE_TOOL,
	schema: ANNOTATE_PLACE_PARAMS,
	exampleParams: {
		target_kind: "place_graph",
		target_ref: "kavemouth/region",
		terrain: ["road", "crossroads", "wilderness"],
		h3_origin_res10: 4242424242424,
	},
	run: async (context: AuthorToolContext, params: Static<typeof ANNOTATE_PLACE_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, ANNOTATE_PLACE_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const rowsReplaced = 0;

		if (params.h3_origin_res10 !== undefined) {
			if (params.target_kind !== "place_graph") {
				throw new Error(
					`${ANNOTATE_PLACE_TOOL}: h3_origin_res10 requires target_kind=place_graph.`,
				);
			}
			const cell = Math.trunc(params.h3_origin_res10);
			if (!Number.isSafeInteger(cell) || cell <= 0) {
				throw new Error(
					`${ANNOTATE_PLACE_TOOL}: h3_origin_res10 must be a positive safe integer ` +
						`(got ${params.h3_origin_res10}).`,
				);
			}
			const graphs = stringRows(manifest, "place_graphs");
			const g = graphs.find((r) => r.place_graph_id === params.target_ref);
			if (g === undefined) {
				throw new Error(`${ANNOTATE_PLACE_TOOL}: place_graph '${params.target_ref}' not found.`);
			}
			g.origin_cell_res10 = cell;
			const anchor = typeof g.anchor_node_id === "string" ? g.anchor_node_id : "";
			if (anchor) {
				const n = stringRows(manifest, "place_nodes").find((r) => r.node_id === anchor);
				if (n) n.cell_res10 = cell;
			}
			rowsAdded += 1;
		}

		const hasTerrain = (params.terrain?.length ?? 0) > 0;
		const hasPayload = params.payload !== undefined;
		if (hasTerrain || hasPayload || params.namespace) {
			const ns = params.namespace?.trim() || (hasTerrain ? "terrain.hint" : "place.note");
			rowsAdded += ensureMetadataNamespace(
				manifest,
				bundle,
				ns,
				AUTHOR_AUDIENCE,
				ns === "terrain.hint"
					? "Terrain vocabulary tags for later niche wiring."
					: "Author notes on place rows.",
			);
			const payload = {
				...(hasTerrain ? { hints: params.terrain } : {}),
				...(params.payload ?? {}),
			};
			rowArray(manifest, "metadata_attachments").push({
				bundle_id: bundle,
				namespace: ns,
				target_kind: params.target_kind,
				target_ref: params.target_ref,
				source: "manifest",
				payload_json: JSON.stringify(payload),
			});
			rowsAdded += 1;
		}

		if (rowsAdded === 0 && rowsReplaced === 0) {
			throw new Error(
				`${ANNOTATE_PLACE_TOOL}: nothing to write — pass terrain, payload, namespace, and/or h3_origin_res10.`,
			);
		}

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			ANNOTATE_PLACE_TOOL,
			() => undefined,
			{
				target_kind: params.target_kind,
				target_ref: params.target_ref,
				terrain: params.terrain ?? null,
				h3_origin_res10: params.h3_origin_res10 ?? null,
			},
		);
	},
});

function authoredEntityKeyFromManifestKey(manifestKey: unknown): string {
	const key = String(manifestKey ?? "");
	const colon = key.indexOf(":");
	return colon >= 0 ? key.slice(colon + 1) : key;
}

/** Live ASL is `entity_id`-keyed and often invisible on the public view.
 * `visible_manifest_authored_entity` + `entity.kind` is the honest "this actor exists". */
function liveAuthoredActorExists(db: AuthorSnapshotDb, entityKey: string): boolean {
	const authored = liveTable(db, "visible_manifest_authored_entity");
	const entities = liveTable(db, "entity");
	const entityById = new Map<string, Record<string, unknown>>();
	for (const row of entities) {
		entityById.set(String(row.entityId ?? row.entity_id), row);
	}
	for (const row of authored) {
		if (authoredEntityKeyFromManifestKey(row.manifestKey ?? row.manifest_key) !== entityKey) {
			continue;
		}
		const kind = String(entityById.get(String(row.entityId ?? row.entity_id))?.kind ?? "");
		if (kind === "player" || kind === "npc") return true;
	}
	return false;
}

function hasActorSpatialLocation(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	entityKey: string,
	target: AuthorTarget | undefined,
): boolean {
	if (stringRows(manifest, "actor_spatial_locations").some((r) => r.entity_key === entityKey)) {
		return true;
	}
	if (db !== undefined && liveAuthoredActorExists(db, entityKey)) {
		return true;
	}
	return target
		? target.lookup("actor_spatial_locations").some((r) => r.entity_key === entityKey)
		: false;
}

/** Containment commit only sees THIS delta's `entities` map — not live id-keyed
 * ASL. Copy a live player/npc into the workspace so apply does not MF-APPLY-026
 * and then hang (drain Err with no outcome row). */
function ensureWorkspaceEntityForLiveActor(
	manifest: Record<string, unknown>,
	entityKey: string,
	bundle: string,
	target: AuthorTarget | undefined,
	toolName: string,
	paramName: string,
): number {
	if (stringRows(manifest, "entities").some((r) => r.entity_key === entityKey)) return 0;
	const live = target?.lookup("actor_spatial_locations").find((r) => r.entity_key === entityKey);
	const entityDefId = live !== undefined ? String(live.entity_def_id ?? "") : "";
	const kind = live !== undefined ? String(live.kind ?? "") : "";
	if (entityDefId.length > 0 && (kind === "player" || kind === "npc")) {
		patchManifest(manifest, "add-entity", {
			entity_key: entityKey,
			bundle_id: String(live?.bundle_id ?? bundle),
			name: String(live?.name ?? entityKey),
			kind,
			entity_def_id: entityDefId,
			place_node_id: "",
		});
		return 1;
	}
	throw new Error(
		`${toolName}: ${paramName} '${entityKey}' has no entities row in the workspace ` +
			`(looked for entity_key '${entityKey}'; live actor_spatial_location is id-keyed by entity_id ` +
			`and entity_containment apply cannot resolve a live-only container). Include the actor's ` +
			`entities row in this delta or place it first, e.g. via ${PLACE_ACTOR_TOOL} — the offending param is \`${paramName}\`.`,
	);
}

export const bindActorToolDef = defineTool({
	contract: BIND_ACTOR_TOOL,
	schema: BIND_ACTOR_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		entity_key: "aoe_blast/caster_1",
		capabilities: [{ capability_id: "core/walk", source: "core" }],
	},
	run: async (context: AuthorToolContext, params: Static<typeof BIND_ACTOR_PARAMS>) => {
		if (params.capabilities?.some((grant) => grant.capability_id.startsWith("frontier."))) {
			throw new Error(
				`${BIND_ACTOR_TOOL}: privileged capabilities require spellkave_grant_role with an explicit role and extent`,
			);
		}
		const bundle = resolveBundle(context, params.bundle, BIND_ACTOR_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		let rowsReplaced = 0;
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);

		if (!hasActorSpatialLocation(manifest, db, params.entity_key, target)) {
			throw new Error(
				`${BIND_ACTOR_TOOL}: entity_key '${params.entity_key}' has no actor_spatial_locations row in the ` +
					`workspace${db ? " or live world" : ""}${target ? ` or the active ${target.kind} target` : ""} ` +
					`(place it first, e.g. via ${PLACE_ACTOR_TOOL}) — the offending param is \`entity_key\`.`,
			);
		}

		const existedIdentity = stringRows(manifest, "actor_identities").some(
			(r) => r.entity_key === params.entity_key,
		);
		patchManifest(manifest, "add-actor-identity", {
			bundle_id: bundle,
			entity_key: params.entity_key,
			identity: params.identity ?? "$sender",
			role: params.role ?? "primary",
		});
		rowsAdded += 1;
		if (existedIdentity) rowsReplaced += 1;

		for (const grant of params.capabilities ?? []) {
			const source = grant.source ?? "manifest";
			const existedGrant = stringRows(manifest, "actor_capabilities").some(
				(r) =>
					r.actor_entity_key === params.entity_key &&
					r.capability_id === grant.capability_id &&
					r.source === source,
			);
			patchManifest(manifest, "add-capability-grant", {
				bundle_id: bundle,
				actor_entity_key: params.entity_key,
				capability_id: grant.capability_id,
				source,
				...(grant.visibility !== undefined ? { visibility: grant.visibility } : {}),
				...(grant.extent_ref !== undefined ? { extent_ref: grant.extent_ref } : {}),
				...(grant.extent_kind_ref !== undefined ? { extent_kind_ref: grant.extent_kind_ref } : {}),
			});
			rowsAdded += 1;
			if (existedGrant) rowsReplaced += 1;
		}

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			BIND_ACTOR_TOOL,
			(d) => (d.path.includes(params.entity_key) ? "entity_key" : undefined),
			{ entity_key: params.entity_key },
		);
	},
});

export const tagEntityToolDef = defineTool({
	contract: TAG_ENTITY_TOOL,
	schema: TAG_ENTITY_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		entity_key: "aoe_blast/caster_1",
		tags: ["faction:heroes"],
	},
	run: async (context: AuthorToolContext, params: Static<typeof TAG_ENTITY_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, TAG_ENTITY_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		let rowsReplaced = 0;
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);

		if (!entityInstanceExists(manifest, params.entity_key, target)) {
			throw new Error(
				`${TAG_ENTITY_TOOL}: entity_key '${params.entity_key}' does not resolve to any authored entities ` +
					`row (workspace${target ? ` or the active ${target.kind} target` : ""}) — place it first, e.g. via ` +
					`${PLACE_ENTITY_TOOL} or ${PLACE_ACTOR_TOOL} — the offending param is \`entity_key\`.`,
			);
		}

		const mode = params.mode ?? "add";
		const existingRows = stringRows(manifest, "entity_tag").filter(
			(r) => r.entity_key === params.entity_key,
		);

		if (mode === "replace") {
			rowsReplaced += clearRowsByKey(manifest, "entity_tag", "entity_key", params.entity_key);
			const tagGroup = tagRows("entity_key", params.entity_key, bundle, params.tags);
			rowArray(manifest, "entity_tag").push(...tagGroup);
			rowsAdded += tagGroup.length;
		} else {
			// mode 'add': upsert only the tags NOT already present for this entity_key —
			// every OTHER tag (from THIS or any other caller) stays untouched, and a
			// repeated call with the SAME tags is a true no-op (idempotent).
			const present = new Set(existingRows.map((r) => r.tag as string));
			const toAdd = Array.from(new Set(params.tags)).filter((tag) => !present.has(tag));
			const tagGroup = tagRows("entity_key", params.entity_key, bundle, toAdd);
			rowArray(manifest, "entity_tag").push(...tagGroup);
			rowsAdded += tagGroup.length;
		}

		const tagCapabilityGrantDiagnostics: Array<{
			entity_key: string;
			tag: string;
			capability_id: string;
		}> = [];
		for (const tag of params.tags) {
			for (const capabilityId of tagCapabilityGrants(manifest, db, tag, target)) {
				tagCapabilityGrantDiagnostics.push({
					entity_key: params.entity_key,
					tag,
					capability_id: capabilityId,
				});
			}
		}

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			TAG_ENTITY_TOOL,
			(d) => (d.path.includes(params.entity_key) ? "entity_key" : undefined),
			{
				entity_key: params.entity_key,
				mode,
				...(tagCapabilityGrantDiagnostics.length > 0
					? { tag_capability_grants: tagCapabilityGrantDiagnostics }
					: {}),
			},
		);
	},
});


function entityInstanceExists(
	manifest: Record<string, unknown>,
	entityKey: string,
	target: AuthorTarget | undefined,
): boolean {
	if (stringRows(manifest, "entities").some((r) => r.entity_key === entityKey)) return true;
	return target ? target.resolveRef("entities", entityKey) : false;
}

/** Does `entity_containment` already place `itemEntityKey` inside
 * `containerEntityKey` (workspace or the active target)? Mirrors
 * `resolveCasterNode`'s workspace-then-target lookup shape — `entity_containment`
 * is outside `AuthorTarget`'s bounded live-table set today (same boundary
 * `resolveCasterNode` already documents for `actor_spatial_locations`). */
function entityContainedBy(
	manifest: Record<string, unknown>,
	itemEntityKey: string,
	containerEntityKey: string,
	target: AuthorTarget | undefined,
): boolean {
	const inWorkspace = stringRows(manifest, "entity_containment").find(
		(r) => r.entity_key === itemEntityKey,
	);
	if (inWorkspace !== undefined) return inWorkspace.container_entity_key === containerEntityKey;
	const inTarget = target?.lookup("entity_containment").find((r) => r.entity_key === itemEntityKey);
	return inTarget !== undefined && inTarget.container_entity_key === containerEntityKey;
}

/** The current occupant `item_key` of (`actorEntityKey`, `slotId`) in
 * `actor_equipment_slots`, or `undefined` if the slot is vacant — workspace
 * then the active target (same bounded-live-table posture as
 * {@link entityContainedBy}). */
function equipmentSlotOccupant(
	manifest: Record<string, unknown>,
	actorEntityKey: string,
	slotId: string,
	target: AuthorTarget | undefined,
): string | undefined {
	const inWorkspace = stringRows(manifest, "actor_equipment_slots").find(
		(r) => r.actor_entity_key === actorEntityKey && r.slot_id === slotId,
	);
	if (inWorkspace !== undefined) return String(inWorkspace.item_key);
	const inTarget = target
		?.lookup("actor_equipment_slots")
		.find((r) => r.actor_entity_key === actorEntityKey && r.slot_id === slotId);
	return inTarget !== undefined ? String(inTarget.item_key) : undefined;
}

export const equipItemToolDef = defineTool({
	contract: EQUIP_ITEM_TOOL,
	schema: EQUIP_ITEM_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		actor_entity_key: "aoe_blast/caster_1",
		item_entity_key: "aoe_blast/lever_1",
		slot_id: "core/slot/main_hand",
	},
	run: async (context: AuthorToolContext, params: Static<typeof EQUIP_ITEM_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, EQUIP_ITEM_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		let rowsReplaced = 0;
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);

		if (!hasActorSpatialLocation(manifest, db, params.actor_entity_key, target)) {
			throw new Error(
				`${EQUIP_ITEM_TOOL}: actor_entity_key '${params.actor_entity_key}' has no actor_spatial_locations row ` +
					`in the workspace${db ? " or live world" : ""}${target ? ` or the active ${target.kind} target` : ""} ` +
					`(place it first, e.g. via ${PLACE_ACTOR_TOOL}) — the offending param is \`actor_entity_key\`.`,
			);
		}

		if (!entityInstanceExists(manifest, params.item_entity_key, target)) {
			throw new Error(
				`${EQUIP_ITEM_TOOL}: item_entity_key '${params.item_entity_key}' does not resolve to any authored ` +
					`entities row (workspace${target ? ` or the active ${target.kind} target` : ""}) — place it first, ` +
					`e.g. via ${PLACE_ENTITY_TOOL} — the offending param is \`item_entity_key\`.`,
			);
		}

		if (!entityContainedBy(manifest, params.item_entity_key, params.actor_entity_key, target)) {
			throw new Error(
				`${EQUIP_ITEM_TOOL}: item_entity_key '${params.item_entity_key}' is not contained by actor_entity_key ` +
					`'${params.actor_entity_key}' in entity_containment (workspace${target ? ` or the active ${target.kind} target` : ""}) — ` +
					`stow it first, e.g. via ${STOW_ITEM_TOOL} — the offending param is \`item_entity_key\`.`,
			);
		}

		const occupant = equipmentSlotOccupant(
			manifest,
			params.actor_entity_key,
			params.slot_id,
			target,
		);
		if (occupant !== undefined && occupant !== params.item_entity_key) {
			throw new Error(
				`${EQUIP_ITEM_TOOL}: slot_id '${params.slot_id}' on actor_entity_key '${params.actor_entity_key}' is ` +
					`already occupied by item_key '${occupant}' (workspace${target ? ` or the active ${target.kind} target` : ""}) — ` +
					`unequip it first (mirrors the runtime EquipItem affordance's SlotAlreadyOccupied rejection) — the ` +
					`offending param is \`slot_id\`.`,
			);
		}
		const existed = occupant === params.item_entity_key;

		patchManifest(manifest, "add-actor-equipment-slot", {
			actor_entity_key: params.actor_entity_key,
			slot_id: params.slot_id,
			item_key: params.item_entity_key,
		});
		rowsAdded += 1;
		if (existed) rowsReplaced += 1;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			EQUIP_ITEM_TOOL,
			(d) =>
				d.path.includes(params.slot_id)
					? "slot_id"
					: d.path.includes(params.item_entity_key)
						? "item_entity_key"
						: d.path.includes(params.actor_entity_key)
							? "actor_entity_key"
							: undefined,
			{
				actor_entity_key: params.actor_entity_key,
				item_entity_key: params.item_entity_key,
				slot_id: params.slot_id,
			},
		);
	},
});

export const stowItemToolDef = defineTool({
	contract: STOW_ITEM_TOOL,
	schema: STOW_ITEM_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		actor_entity_key: "aoe_blast/caster_1",
		item_entity_key: "aoe_blast/lever_1",
	},
	run: async (context: AuthorToolContext, params: Static<typeof STOW_ITEM_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, STOW_ITEM_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		let rowsReplaced = 0;
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);

		// An item can go into a placed container with no actor involved, such as a
		// potion in a chest of a world without NPCs (sk-jay0.3.26.9).
		const actorEntityKey = params.actor_entity_key;
		if (actorEntityKey === undefined && params.container_entity_key === undefined) {
			throw new Error(
				`${STOW_ITEM_TOOL}: pass actor_entity_key (stow on the actor) or container_entity_key ` +
					"(stow into a placed container) — the offending param is `container_entity_key`.",
			);
		}
		if (actorEntityKey !== undefined) {
			if (!hasActorSpatialLocation(manifest, db, actorEntityKey, target)) {
				throw new Error(
					`${STOW_ITEM_TOOL}: actor_entity_key '${actorEntityKey}' has no actor_spatial_locations row ` +
						`in the workspace${db ? " or live world" : ""}${target ? ` or the active ${target.kind} target` : ""} ` +
						`(looked for entity_key '${actorEntityKey}'; live actor_spatial_location is id-keyed by entity_id). ` +
						`Place it first, e.g. via ${PLACE_ACTOR_TOOL} — the offending param is \`actor_entity_key\`.`,
				);
			}
			rowsAdded += ensureWorkspaceEntityForLiveActor(
				manifest,
				actorEntityKey,
				bundle,
				target,
				STOW_ITEM_TOOL,
				"actor_entity_key",
			);
		}

		if (!entityInstanceExists(manifest, params.item_entity_key, target)) {
			throw new Error(
				`${STOW_ITEM_TOOL}: item_entity_key '${params.item_entity_key}' does not resolve to any authored ` +
					`entities row (workspace${target ? ` or the active ${target.kind} target` : ""}) — place it first, ` +
					`e.g. via ${PLACE_ENTITY_TOOL} — the offending param is \`item_entity_key\`.`,
			);
		}

		const containerEntityKey = (params.container_entity_key ?? actorEntityKey) as string;
		if (
			containerEntityKey !== actorEntityKey &&
			!entityInstanceExists(manifest, containerEntityKey, target)
		) {
			throw new Error(
				`${STOW_ITEM_TOOL}: container_entity_key '${containerEntityKey}' does not resolve to any authored ` +
					`entities row (workspace${target ? ` or the active ${target.kind} target` : ""}) — place it first, ` +
					`e.g. via ${PLACE_ENTITY_TOOL} — the offending param is \`container_entity_key\`.`,
			);
		}

		if (params.item_entity_key === containerEntityKey) {
			throw new Error(
				`${STOW_ITEM_TOOL}: item_entity_key cannot equal container_entity_key ('${containerEntityKey}') — ` +
					`an entity cannot contain itself — the offending param is \`item_entity_key\`.`,
			);
		}

		const existed = stringRows(manifest, "entity_containment").some(
			(r) => r.entity_key === params.item_entity_key,
		);
		patchManifest(manifest, "add-entity-containment", {
			entity_key: params.item_entity_key,
			container_entity_key: containerEntityKey,
			...(params.slot_id !== undefined ? { slot_id: params.slot_id } : {}),
			...(params.direction !== undefined ? { direction: params.direction } : {}),
		});
		rowsAdded += 1;
		if (existed) rowsReplaced += 1;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			STOW_ITEM_TOOL,
			(d) =>
				d.path.includes(params.item_entity_key)
					? "item_entity_key"
					: d.path.includes(containerEntityKey)
						? "container_entity_key"
						: undefined,
			{ item_entity_key: params.item_entity_key, container_entity_key: containerEntityKey },
		);
	},
});

export const defineResourceToolDef = defineTool({
	contract: DEFINE_RESOURCE_TOOL,
	schema: DEFINE_RESOURCE_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "hp",
		display_name: "Hit Points",
		min_value: 0,
		max_value: 30,
		recovery_rule: "long_rest",
		initial_value: 30,
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_RESOURCE_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_RESOURCE_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);

		const resourceId = `${bundle}/${params.id}`;
		let rowsReplaced = clearRowsByKey(
			manifest,
			"resource_definitions",
			"resource_definition_id",
			resourceId,
		);
		rowsReplaced += clearRowsByKey(
			manifest,
			"resource_definition_tag",
			"resource_definition_id",
			resourceId,
		);
		const resourceRow: Record<string, unknown> = {
			resource_definition_id: resourceId,
			bundle_id: bundle,
			display_name: resolveDisplayName(params.display_name, params.id),
			value_kind: params.value_kind ?? "int",
			min_value: params.min_value,
			max_value: params.max_value,
			recovery_rule: params.recovery_rule ?? "none",
			...(params.initial_value !== undefined ? { initial_value: params.initial_value } : {}),
			...(params.description !== undefined ? { description: params.description } : {}),
		};
		rowArray(manifest, "resource_definitions").push(resourceRow);
		rowsAdded += 1;

		const tagGroup = tagRows("resource_definition_id", resourceId, bundle, params.tags);
		rowArray(manifest, "resource_definition_tag").push(...tagGroup);
		rowsAdded += tagGroup.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_RESOURCE_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "resource_definitions", rows: [resourceRow], param: "id", isArray: false },
					{ kind: "resource_definition_tag", rows: tagGroup, param: "tags", isArray: true },
				]),
			{ resource_definition_id: resourceId },
		);
	},
});

const SHAPE_ID_VALUES = ["core/area/node_ball", "core/area/sphere"] as const;

// #1968 R7 slice 4.3 (ADR-0087): ported to spellkave-authoring's Rust
// `compose::aoe::shape_params_json` — the SAME function `compose.ts`'s aoe
// shape default now calls, closing the hand-mirror incident (ADR-0087
// Context) that originally motivated this whole migration: two independent
// TypeScript implementations of this exact formatting drifted
// (`JSON.stringify`'s compact form vs. the literal `{"radius_m": 5.0}`
// spacing) until the srd-migration round's byte-diff gate caught it. The
// tool-specific error text/`SHAPE_ID_VALUES` validation stays here (host
// ergonomics) — the Rust function's own error is a defensive fallback, not
// the caller-facing message.
function shapeParamsJson(shapeId: string, radius: number): string {
	if (!SHAPE_ID_VALUES.includes(shapeId as (typeof SHAPE_ID_VALUES)[number])) {
		throw new Error(
			`${DEFINE_BEHAVIOR_TOOL}: unsupported effect.shape.id '${shapeId}' — PoC boundary (#1968): only ` +
				`${SHAPE_ID_VALUES.join(", ")} are wired.`,
		);
	}
	return shape_params_json(shapeId, JSON.stringify(radius));
}

/**
 * Does `resourceId` resolve to an authored resource_definitions row (workspace,
 * live db, or the active connection-level `AuthorTarget`)? Mirrors
 * `entityDefExists`'s own three-way check (#1968 gap② — a pre-check consistency
 * fix: this was the one PRE-CHECK in this file still workspace/db-only while
 * `resolveEntityDef`/`resolveAt`/`entityDefExists` were already target-aware,
 * leaving `spellkave_define_behavior`'s `effect.write.resource`/`cost.pool`
 * refs blocked BEFORE ever reaching `commitOrReport`'s own target-aware
 * validation for the SAME row kind).
 */
function resourceExists(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	resourceId: string,
	target?: AuthorTarget,
): boolean {
	if (
		stringRows(manifest, "resource_definitions").some(
			(r) => r.resource_definition_id === resourceId,
		)
	)
		return true;
	if (
		db !== undefined &&
		liveTable(db, "resource_definition").some(
			(r) => (r.resourceDefinitionId ?? r.resource_definition_id) === resourceId,
		)
	) {
		return true;
	}
	return target ? target.resolveRef("resource_definitions", resourceId) : false;
}

/**
 * ApplyStatus/RemoveCondition only (#1968 srd-migration round): does
 * `conditionId` resolve to an authored condition_definitions row (workspace,
 * live db, or the active connection-level `AuthorTarget`)? Mirrors
 * `resourceExists`'s three-way check exactly (same shape, different table).
 */
function conditionExists(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	conditionId: string,
	target?: AuthorTarget,
): boolean {
	if (
		stringRows(manifest, "condition_definitions").some(
			(r) => r.condition_definition_id === conditionId,
		)
	)
		return true;
	if (
		db !== undefined &&
		liveTable(db, "condition_definition").some(
			(r) => (r.conditionDefinitionId ?? r.condition_definition_id) === conditionId,
		)
	) {
		return true;
	}
	return target ? target.resolveRef("condition_definitions", conditionId) : false;
}

/**
 * spellkave_define_affordance only (#1968 verb-UX round 6): does `nicheId`
 * resolve to an authored niche_definitions row (workspace, live db, or the
 * active connection-level `AuthorTarget`)? Mirrors `conditionExists`'s
 * three-way check exactly (same shape, different table).
 */
function nicheExists(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	nicheId: string,
	target?: AuthorTarget,
): boolean {
	if (stringRows(manifest, "niche_definitions").some((r) => r.niche_id === nicheId)) return true;
	if (
		db !== undefined &&
		liveTable(db, "niche_definition").some((r) => (r.nicheId ?? r.niche_id) === nicheId)
	) {
		return true;
	}
	return target ? target.resolveRef("niche_definitions", nicheId) : false;
}

/**
 * spellkave_define_affordance only (#1968 verb-UX round 6): does
 * `capabilityId` resolve to an authored capability_definitions row
 * (workspace, live db, or the active connection-level `AuthorTarget`)?
 * Mirrors `conditionExists`'s three-way check exactly (same shape, different
 * table).
 */
function capabilityExists(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	capabilityId: string,
	target?: AuthorTarget,
): boolean {
	if (
		stringRows(manifest, "capability_definitions").some((r) => r.capability_id === capabilityId)
	) {
		return true;
	}
	if (
		db !== undefined &&
		liveTable(db, "capability_definition").some(
			(r) => (r.capabilityId ?? r.capability_id) === capabilityId,
		)
	) {
		return true;
	}
	return target ? target.resolveRef("capability_definitions", capabilityId) : false;
}

/**
 * Spawn only (#1968 US9): does `entityDefId` resolve to an authored
 * entity_definitions row (workspace, live db, or the active connection-level
 * `AuthorTarget`)? Mirrors `resolveEntityDef`'s catalog-id branch
 * (the placement tools above) — runtime `effect.write.primitive: "Spawn"` (unlike
 * placement tools' `entity_def`) never accepts a bare kind literal; it
 * always instantiates a concrete catalog blueprint (Brief 26
 * `EffectPrimitive::Spawn`, e.g. 'srd/monster/cat' — verified against
 * world-fixtures/srd/base/summon.toml).
 */
function entityDefExists(
	manifest: Record<string, unknown>,
	db: AuthorSnapshotDb | undefined,
	entityDefId: string,
	target: AuthorTarget | undefined,
): boolean {
	if (stringRows(manifest, "entity_definitions").some((r) => r.entity_def_id === entityDefId)) {
		return true;
	}
	if (
		db &&
		liveTable(db, "entity_definition").some(
			(r) => (r.entityDefId ?? r.entity_def_id) === entityDefId,
		)
	) {
		return true;
	}
	return target ? target.resolveRef("entity_definitions", entityDefId) : false;
}

/**
 * `grant_to`'s current place_node_id — workspace FIRST, then the active
 * connection-level `target`. Live lookup is bounded by the AUTHOR's visible
 * placement view: an admitted actor can have a row whose node is unavailable.
 * Preserve workspace precedence, but require a concrete node before generating
 * attachments; stringifying an unavailable node would defer failure to apply.
 */
function resolveCasterNode(
	manifest: Record<string, unknown>,
	grantTo: string,
	target: AuthorTarget | undefined,
): string {
	const loc = stringRows(manifest, "actor_spatial_locations").find((r) => r.entity_key === grantTo);
	const chosen =
		loc ?? target?.lookup("actor_spatial_locations").find((r) => r.entity_key === grantTo);
	if (chosen !== undefined) {
		if (typeof chosen.place_node_id === "string" && chosen.place_node_id.trim().length > 0)
			return chosen.place_node_id;
		throw new Error(
			`${DEFINE_BEHAVIOR_TOOL}: grant_to '${grantTo}' has an unavailable or invalid place_node_id ` +
				`in ${loc !== undefined ? "the workspace" : `the active ${target?.kind} target`}; ` +
				"supply its known current placement as an actor_spatial_locations workspace row before defining behavior.",
		);
	}
	throw new Error(
		`${DEFINE_BEHAVIOR_TOOL}: grant_to '${grantTo}' has no actor_spatial_locations row in the workspace` +
			`${target ? ` or the active ${target.kind} target` : ""} (place it first, e.g. via ${PLACE_ACTOR_TOOL}) — ` +
			"the offending param is `grant_to`.",
	);
}

export const defineBehaviorToolDef = defineTool({
	contract: DEFINE_BEHAVIOR_TOOL,
	schema: DEFINE_BEHAVIOR_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "firebloom",
		grant_to: "aoe_blast/caster_1",
		offered_when: { reach: "same_node" },
		action_class: "spell",
		effect: {
			primitive: "ForEachActorInRadius",
			shape: { id: "core/area/node_ball", radius: 0 },
			per_target_gate: "d20 < 13",
			write: { primitive: "ModifyResource", resource: "aoe_blast/hp", delta: "-d6" },
		},
		description: "Firebloom: AoE blast, flat DEX save DC13 negates, 1d6 damage on a failed save.",
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_BEHAVIOR_PARAMS>) => {
		// #1968 combat-sim finding A1: `action_class` has NO serde/schema default
		// on either side of the wire — `action_definition_tag.tag` is a required
		// Rust `String` (no `#[serde(default)]`), and `tags`'s own doc comment
		// only widens/replaces the ONE tag `action_class` derives, never supplies
		// a fallback value for it. TypeBox declaring the param non-Optional is
		// NOT runtime-enforced here (this file never runs params through a
		// TypeBox `Value.Check`/Ajv pass before `run` — a caller that bypasses
		// or skips the tool-declaration JSON Schema, e.g. a raw TS script
		// spreading a partial object, reaches this line with `action_class`
		// `undefined`). Left unchecked, `actionTags: params.tags ?? [params.
		// action_class]` silently becomes `[undefined]`, which `compose.ts`
		// pushes as an `action_definition_tag` row carrying `tag: undefined` —
		// `JSON.stringify` then silently DROPS that key, so the manifest commits
		// in-process and the failure only surfaces at the NEXT call, as an opaque
		// wasm-level `manifest JSON parse failed: missing field 'tag'` naming
		// neither this call nor `action_class`. Fail loudly HERE instead, before
		// any row is generated — a graceful named-param error, never a corrupt
		// row.
		if (
			(params.action_class === undefined ||
				params.action_class === null ||
				(typeof params.action_class === "string" && params.action_class.trim() === "")) &&
			params.tags === undefined
		) {
			throw new Error(
				`${DEFINE_BEHAVIOR_TOOL}: action_class is required — it has no default (the generated ` +
					"action_definition_tag row needs a real tag value; omitting it would silently corrupt the " +
					"workspace with a `tag: undefined` row). Pass a class string (e.g. 'spell'), or set `tags` to " +
					"fully control both the capability_definition_tag AND action_definition_tag row sets instead " +
					"— the offending param is `action_class`.",
			);
		}
		const bundle = resolveBundle(context, params.bundle, DEFINE_BEHAVIOR_TOOL);
		const manifest = requireManifest(context);
		const db = currentDb(context);
		const authorTarget = resolveAuthorTarget(context.target);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);

		// #1968 finding B4: `grant_to` accepts a single entity_key (unchanged) OR
		// an array of entity_keys — normalize to an array once, up front. The
		// FIRST entry stays the sole `caster`/`defaultCaster` the capability/
		// action/affordance/outcome/consequence cluster is generated against
		// below (exactly the single-actor pipeline, unchanged) — every OTHER
		// entry gets its OWN `actor_capabilities` grant + `spatial_niche_
		// attachments` row after the cluster is built (see the grant-fan-out
		// block below `commonFields`/`clusterRows`).
		const grantTo = Array.isArray(params.grant_to) ? params.grant_to : [params.grant_to];
		if (grantTo.length === 0) {
			throw new Error(
				`${DEFINE_BEHAVIOR_TOOL}: grant_to must name at least one entity_key — the offending param is ` +
					"`grant_to`.",
			);
		}
		const primaryGrantTo = grantTo[0] as string;

		if (params.effect.primitive !== "ForEachActorInRadius") {
			throw new Error(
				`${DEFINE_BEHAVIOR_TOOL}: effect.primitive '${params.effect.primitive}' is unsupported — PoC boundary ` +
					"(#1968): only 'ForEachActorInRadius' is wired.",
			);
		}
		if (params.offered_when.reach !== "same_node") {
			throw new Error(
				`${DEFINE_BEHAVIOR_TOOL}: offered_when.reach '${params.offered_when.reach}' is unsupported — PoC ` +
					"boundary (#1968): only 'same_node' is wired.",
			);
		}

		const writePrimitive = params.effect.write.primitive;
		const targetMode = params.offered_when.target;
		const attacksParam = params.effect.write.attacks;

		// #1968 verb-UX round 3 — `def_instance` REQUIRES `bind_to_definition`: an
		// instance with no bound definition would carry an empty `entity_def_id`,
		// breaking the very inheritance it exists to prove (mirrors compose.ts's
		// `b.bindToDefinition ?? ""` fallback, which this call never wants to hit).
		if (params.def_instance !== undefined && params.bind_to_definition === undefined) {
			throw new Error(
				`${DEFINE_BEHAVIOR_TOOL}: def_instance requires bind_to_definition (an instance with no bound ` +
					"definition would carry an empty entity_def_id) — the offending param is `bind_to_definition`.",
			);
		}

		if (writePrimitive === "ModifyResource") {
			if (targetMode === "place") {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: offered_when.target 'place' with effect.write.primitive 'ModifyResource' ` +
						"is unsupported — PoC boundary (#1968): place-targeted writes support only 'Spawn'/'Inscribe' " +
						"(no fixture idiom modifies a resource with neither an actor nor a self target) — the " +
						"offending param is `effect.write.primitive`.",
				);
			}
			if (attacksParam !== undefined) {
				// #1968 verb-UX round 3 — MULTIATTACK: single-target only (mirrors
				// ApplyStatus/RemoveCondition's own PoC boundary), no affordance gate
				// (each sub-attack self-gates its own roll in `attacks[].delta`), and
				// `resource`/`delta` are IGNORED (every write targets `srd/hp`, compose.ts's
				// attacks-branch hardcode) so neither is required nor ref-checked here.
				if (params.effect.shape !== undefined) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.shape does not apply when effect.write.attacks is set ` +
							"(Multiattack is single-target only — PoC boundary, #1968) — the offending param is " +
							"`effect.shape`.",
					);
				}
				if (params.effect.per_target_gate !== undefined) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.per_target_gate does not apply when effect.write.attacks is ` +
							"set (each sub-attack self-gates its own roll in `attacks[].delta`) — the offending param " +
							"is `effect.per_target_gate`.",
					);
				}
				if (attacksParam.length === 0) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.attacks must include at least one entry — the ` +
							"offending param is `effect.write.attacks`.",
					);
				}
			} else {
				// #1968 verb-UX round 2: effect.shape PRESENT -> aoe (unchanged);
				// effect.shape OMITTED -> single-target (NEW — see effect.shape's own
				// doc comment). No further requirement here; both modes need
				// effect.write.resource/delta, checked next.
				if (params.effect.write.resource === undefined || params.effect.write.delta === undefined) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.resource and effect.write.delta are required when ` +
							"effect.write.primitive is 'ModifyResource' — the offending param is `effect.write`.",
					);
				}
				if (!resourceExists(manifest, db, params.effect.write.resource, authorTarget)) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.resource '${params.effect.write.resource}' has no matching ` +
							`resource_definitions row in the workspace${db ? " or live world" : ""}` +
							`${authorTarget ? ` or the active ${authorTarget.kind} target` : ""} — this PoC does not ` +
							"auto-create write-target resources (only cost.pool auto-creates); the offending param is " +
							"`effect.write.resource`.",
					);
				}
			}
		} else if (writePrimitive === "ApplyStatus" || writePrimitive === "RemoveCondition") {
			// #1968 srd-migration round: single-target-only condition writes — the
			// B9 Hold-Person/Hold-Monster/Bless-family shape (ApplyStatus) and its
			// inverse, the Lesser-Restoration cleanse shape (RemoveCondition).
			// Neither is a ForEachActorInRadius body arm today (PoC boundary — no
			// aoe condition pulse is wired, mirroring the Spawn/Inscribe PoC
			// boundary above), so `effect.shape` never applies and there is no
			// `offered_when.target` concept either (both write the ONE TargetActor,
			// same topology as single-target ModifyResource).
			if (targetMode === "place") {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: offered_when.target 'place' with effect.write.primitive '${writePrimitive}' ` +
						"is unsupported — PoC boundary (#1968): place-targeted writes support only 'Spawn'/'Inscribe' " +
						"(no fixture idiom applies/removes a condition with neither an actor nor a self target) — the " +
						"offending param is `effect.write.primitive`.",
				);
			}
			if (params.effect.shape !== undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.shape does not apply to effect.write.primitive '${writePrimitive}' ` +
						"(no aoe condition pulse is wired — PoC boundary, #1968) — the offending param is " +
						"`effect.shape`.",
				);
			}
			if (params.effect.write.condition === undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.condition is required when effect.write.primitive is ` +
						`'${writePrimitive}' — the offending param is \`effect.write.condition\`.`,
				);
			}
			if (!conditionExists(manifest, db, params.effect.write.condition, authorTarget)) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.condition '${params.effect.write.condition}' has no matching ` +
						`condition_definitions row in the workspace${db ? " or live world" : ""}` +
						`${authorTarget ? ` or the active ${authorTarget.kind} target` : ""} — this PoC does not ` +
						"auto-create the condition (use spellkave_define_condition first) — the offending param is " +
						"`effect.write.condition`.",
				);
			}
		} else if (writePrimitive === "EnvState") {
			// #1968 verb-UX round 4 — the Darkness/Silence/Fog AMBIENT-EFFECT shape
			// (compose.ts's "env-state"): single-target-only, same topology as ApplyStatus/
			// RemoveCondition above (no ForEachActorInRadius body, no `offered_when.target`
			// concept). `env_state_id` is NEVER pre-checked against an existing
			// spatial_state_definitions row — this call auto-creates it, mirroring
			// `cost.pool`'s own auto-create posture (checked below, after the manifest
			// scaffold, so the def exists by the time clusterRows's env-state branch emits it).
			if (targetMode === "place") {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: offered_when.target 'place' with effect.write.primitive 'EnvState' is ` +
						"unsupported — PoC boundary (#1968): place-targeted writes support only 'Spawn'/'Inscribe' (no " +
						"fixture idiom writes ambient env-state with neither an actor nor a self target) — the " +
						"offending param is `effect.write.primitive`.",
				);
			}
			if (params.effect.shape !== undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.shape does not apply to effect.write.primitive 'EnvState' (no aoe ` +
						"env-state pulse is wired — PoC boundary, #1968) — the offending param is `effect.shape`.",
				);
			}
			if (params.effect.write.env_state_id === undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.env_state_id is required when effect.write.primitive is ` +
						"'EnvState' — the offending param is `effect.write.env_state_id`.",
				);
			}
		} else if (writePrimitive === "OutcomeGraph") {
			// #1968 verb-UX round 4 — the branch-on-outcome shape (compose.ts's
			// "outcome-graph"): single-target-only, same topology as ApplyStatus/
			// RemoveCondition/EnvState above. `effect.per_target_gate` never applies — each
			// branch carries its OWN edge guard in `branches[].guard` instead of one shared
			// affordance gate (mirrors Multiattack's `attacks[].delta` self-gating posture).
			if (targetMode === "place") {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: offered_when.target 'place' with effect.write.primitive 'OutcomeGraph' is ` +
						"unsupported — PoC boundary (#1968): place-targeted writes support only 'Spawn'/'Inscribe' (no " +
						"fixture idiom branches an outcome graph with neither an actor nor a self target) — the " +
						"offending param is `effect.write.primitive`.",
				);
			}
			if (params.effect.shape !== undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.shape does not apply to effect.write.primitive 'OutcomeGraph' (no ` +
						"aoe outcome-graph pulse is wired — PoC boundary, #1968) — the offending param is `effect.shape`.",
				);
			}
			if (params.effect.per_target_gate !== undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.per_target_gate does not apply when effect.write.primitive is ` +
						"'OutcomeGraph' (each branch self-gates its own edge guard in `branches[].guard`) — the " +
						"offending param is `effect.per_target_gate`.",
				);
			}
			if (params.effect.write.branches === undefined || params.effect.write.branches.length === 0) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.branches must include at least one entry when ` +
						"effect.write.primitive is 'OutcomeGraph' — the offending param is `effect.write.branches`.",
				);
			}
		} else if (writePrimitive === "ScheduledZone") {
			// #1968 verb-UX round 5 — the TRUE lingering hazard shape (compose.ts's
			// "scheduled-zone", ADR-0054): same topology boundary as EnvState/OutcomeGraph
			// above (no ForEachActorInRadius body on the CAST's OWN consequence, no
			// `offered_when.target` place concept). `zone_state_id` is auto-created exactly
			// like EnvState's `env_state_id` (checked below, after the manifest scaffold).
			// `effect.per_target_gate`, when set, is REUSED for the PULSE's own per-occupant
			// gate (not the affordance) — see the field's own doc note in the primitive enum.
			if (targetMode === "place") {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: offered_when.target 'place' with effect.write.primitive 'ScheduledZone' is ` +
						"unsupported — PoC boundary (#1968): place-targeted writes support only 'Spawn'/'Inscribe' (no " +
						"fixture idiom schedules a lingering zone with neither an actor nor a self target) — the " +
						"offending param is `effect.write.primitive`.",
				);
			}
			if (params.effect.shape !== undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.shape does not apply to effect.write.primitive 'ScheduledZone' (the ` +
						"zone's own pulse is always a FIXED node-local radius, ball_radius 0 — PoC boundary, #1968) — the " +
						"offending param is `effect.shape`.",
				);
			}
			if (params.effect.write.zone_state_id === undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.zone_state_id is required when effect.write.primitive is ` +
						"'ScheduledZone' — the offending param is `effect.write.zone_state_id`.",
				);
			}
			const pulse = params.effect.write.pulse;
			if (pulse === undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.pulse is required when effect.write.primitive is ` +
						"'ScheduledZone' (a zone with no pulse body would schedule a job that fires nothing) — the " +
						"offending param is `effect.write.pulse`.",
				);
			}
			if (pulse.primitive === "ModifyResource") {
				if (pulse.delta === undefined) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.pulse.delta is required when effect.write.pulse.primitive ` +
							"is 'ModifyResource' — the offending param is `effect.write.pulse.delta`.",
					);
				}
			} else {
				// pulse.primitive === "ApplyStatus".
				if (pulse.condition === undefined) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.pulse.condition is required when ` +
							"effect.write.pulse.primitive is 'ApplyStatus' — the offending param is " +
							"`effect.write.pulse.condition`.",
					);
				}
				if (!conditionExists(manifest, db, pulse.condition, authorTarget)) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.pulse.condition '${pulse.condition}' has no matching ` +
							`condition_definitions row in the workspace${db ? " or live world" : ""}` +
							`${authorTarget ? ` or the active ${authorTarget.kind} target` : ""} — this PoC does not ` +
							"auto-create the condition (use spellkave_define_condition first) — the offending param is " +
							"`effect.write.pulse.condition`.",
					);
				}
			}
		} else if (writePrimitive === "Clock") {
			// #1968 finding C2 — the SELF-TARGETED multi-ordinal clock shape
			// (compose.ts's "clock", the death-saves death-and-dying pattern): a
			// clock is inherently self-only (there is no "hit others" reading of
			// it), so — unlike every other primitive above — `offered_when.target`
			// is REQUIRED to be 'self', never omitted or 'place'. No `effect.shape`
			// (no aoe geometry); `effect.per_target_gate`, if set, becomes the
			// AFFORDANCE's own eligibility gate (mirrors single-target's attack-roll
			// gate reuse of the same field) rather than a per-target body gate —
			// each threshold carries its OWN `when` instead.
			if (targetMode !== "self") {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.primitive 'Clock' requires offered_when.target: 'self' — a ` +
						"clock has no 'hit others' reading (every tally/threshold ordinal targets the ACTING actor " +
						"alone) — the offending param is `offered_when.target`.",
				);
			}
			if (params.effect.shape !== undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.shape does not apply to effect.write.primitive 'Clock' (no aoe ` +
						"geometry — a clock's radius wrapper is always the fixed node_ball-0, PoC boundary, #1968) — the " +
						"offending param is `effect.shape`.",
				);
			}
			const tallies = params.effect.write.tallies;
			if (tallies === undefined || tallies.length === 0) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.tallies must include at least one entry when ` +
						"effect.write.primitive is 'Clock' — the offending param is `effect.write.tallies`.",
				);
			}
			for (const tally of tallies) {
				if (tally.predicate === undefined && tally.delta === undefined) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.tallies[].resource '${tally.resource}' needs at least ` +
							"one of `predicate`/`delta` set (predicate alone -> a +1-on-condition tally; delta alone -> a " +
							"raw capture expression) — the offending param is `effect.write.tallies`.",
					);
				}
				if (!resourceExists(manifest, db, tally.resource, authorTarget)) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.tallies[].resource '${tally.resource}' has no matching ` +
							`resource_definitions row in the workspace${db ? " or live world" : ""}` +
							`${authorTarget ? ` or the active ${authorTarget.kind} target` : ""} — this PoC does not ` +
							"auto-create tally resources (use spellkave_define_resource first) — the offending param is " +
							"`effect.write.tallies`.",
					);
				}
			}
			const thresholds = params.effect.write.thresholds;
			if (thresholds === undefined || thresholds.length === 0) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.thresholds must include at least one entry when ` +
						"effect.write.primitive is 'Clock' — the offending param is `effect.write.thresholds`.",
				);
			}
			for (const threshold of thresholds) {
				const hasApply = threshold.apply_status !== undefined;
				const hasRemove = threshold.remove_condition !== undefined;
				if (hasApply === hasRemove) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.thresholds[].when '${threshold.when}' must set EXACTLY ONE ` +
							"of `apply_status`/`remove_condition` — the offending param is `effect.write.thresholds`.",
					);
				}
				const conditionId = (threshold.apply_status ?? threshold.remove_condition) as string;
				if (!conditionExists(manifest, db, conditionId, authorTarget)) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.thresholds[].${hasApply ? "apply_status" : "remove_condition"} ` +
							`'${conditionId}' has no matching condition_definitions row in the workspace` +
							`${db ? " or live world" : ""}${authorTarget ? ` or the active ${authorTarget.kind} target` : ""} ` +
							"— this PoC does not auto-create the condition (use spellkave_define_condition first) — the " +
							"offending param is `effect.write.thresholds`.",
					);
				}
			}
		} else {
			// Spawn / Inscribe.
			if (targetMode === undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.write.primitive '${writePrimitive}' requires \`offered_when.target\`: ` +
						"'self' or 'place' — PoC boundary (#1968): only 'ModifyResource' supports the legacy others-in-a-" +
						"radius default (no `offered_when.target`) — the offending param is `offered_when.target`.",
				);
			}
			if (params.effect.shape !== undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.shape does not apply to effect.write.primitive '${writePrimitive}' ` +
						"(no actor-radius selection happens for a place/self target) — the offending param is " +
						"`effect.shape`.",
				);
			}
			if (params.effect.per_target_gate !== undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: effect.per_target_gate does not apply to effect.write.primitive ` +
						`'${writePrimitive}' (no per-actor body to gate) — the offending param is ` +
						"`effect.per_target_gate`.",
				);
			}
			if (targetMode === "self" && params.cost === undefined) {
				throw new Error(
					`${DEFINE_BEHAVIOR_TOOL}: offered_when.target 'self' with effect.write.primitive '${writePrimitive}' ` +
						"has no ModifyResource budget resource in its on_success chain and no `cost` was given — self-" +
						'targeted needs a cost pool — or did you mean target: "place"? (MF-VAL-263, #1968) — the ' +
						"offending param is `cost`.",
				);
			}
			if (writePrimitive === "Spawn") {
				if (params.effect.write.entity_def === undefined) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.entity_def is required when effect.write.primitive is ` +
							"'Spawn' — the offending param is `effect.write.entity_def`.",
					);
				}
				if (!entityDefExists(manifest, db, params.effect.write.entity_def, authorTarget)) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.entity_def '${params.effect.write.entity_def}' does not ` +
							`resolve to any authored entity_definitions row (workspace${db ? " or live world" : ""}` +
							`${authorTarget ? ` or the active ${authorTarget.kind} target` : ""}) — this PoC does not ` +
							"auto-create the blueprint (use spellkave_define_entity_type first) — the offending param " +
							"is `effect.write.entity_def`.",
					);
				}
			} else {
				// Inscribe.
				if (
					params.effect.write.trace_kind === undefined ||
					params.effect.write.content === undefined
				) {
					throw new Error(
						`${DEFINE_BEHAVIOR_TOOL}: effect.write.trace_kind and effect.write.content are required when ` +
							"effect.write.primitive is 'Inscribe' — the offending param is `effect.write`.",
					);
				}
			}
		}

		const casterNode = resolveCasterNode(manifest, primaryGrantTo, authorTarget);
		// #1968 verb-UX round 2: `display_name` overrides the derived 'Cast
		// <TitleCase id>' — the derivation naively title-cases EVERY word
		// (`titleCase`'s own doc comment), so a multi-word id containing a
		// preposition (e.g. 'circle_of_death' -> 'Cast Circle Of Death') needs an
		// override to match a hand-authored capitalization ('Cast Circle of
		// Death').
		const displayName = params.display_name ?? `Cast ${titleCase(params.id)}`;

		// Generic, documented PoC defaults — see the tool description: define_behavior
		// has no bounds/seed params, so a leveled pool's bespoke values (e.g. max
		// charges) cannot be authored here. `clusterRows` itself never creates this
		// row (fixture-authoring convention, not this verb's concern) — done BEFORE
		// the cluster call so the resource exists by the time its frame_write refs it.
		if (params.cost && !resourceExists(manifest, db, params.cost.pool, authorTarget)) {
			rowArray(manifest, "resource_definitions").push({
				resource_definition_id: params.cost.pool,
				bundle_id: bundle,
				display_name: params.cost.pool,
				value_kind: "int",
				min_value: 0,
				max_value: 100,
				recovery_rule: "long_rest",
				initial_value: 100,
			});
			rowsAdded += 1;
		}

		// FIX③ (#1968 de-fork): ONE `ActorBehavior` + `clusterRows` replaces the six
		// hand-assembled row pushes this verb used to carry. `idNamespace: params.bundle`
		// is what makes the SRD-shaped builder emit `<bundle>/...` ids instead of its
		// `srd/...` default.
		// #1968 verb-UX round 2: capability_id/tags are common across every
		// writePrimitive branch below — `capabilityId` overrides the derived id
		// (#835 catalog-binding); `tags`, when set, REPLACES the single
		// `action_class` tag as the authoritative action_definition_tag AND
		// capability_definition_tag row set (see the params' own doc comments).
		const commonFields = {
			capabilityId: params.capability_id,
			capabilityTags: params.tags,
			// tag-vocabulary-declaration change: the legacy-default single tag is
			// namespaced under the bundle's own dot-namespace
			// (`<bundle>.<action_class>`) rather than emitted as a bare flat
			// value — `action_class` alone (e.g. "spell") is exactly the kind of
			// bundle-unscoped flat tag `docs/data-model-concepts/tagging.md`'s
			// convention warns against, and `ensureBundleScaffold` above already
			// declares this bundle's own `tag_prefixes` entry, so the namespaced
			// form resolves clean of MF-VAL-297/298 instead of every caller that
			// omits an explicit `tags` override drawing new staged-advisory
			// warnings against previously-clean content.
			actionTags: params.tags ?? [`${bundle}.${params.action_class}`],
			...(params.offered_when.range_m !== undefined ? { rangeM: params.offered_when.range_m } : {}),
			// #1968 verb-UX round 3 — def-binding is common across every writePrimitive
			// branch below too (mirrors capabilityId/tags): compose.ts's `bindToDefinition`/
			// `defInstance` apply regardless of the frame_write body shape.
			...(params.bind_to_definition ? { bindToDefinition: params.bind_to_definition } : {}),
			...(params.def_instance
				? {
						defInstance: {
							entityKey: params.def_instance.entity_key,
							name: params.def_instance.name,
							node: params.def_instance.node,
						},
					}
				: {}),
			// #1968 verb-UX round 4 — the speech-act framing is common across every
			// writePrimitive branch too (mirrors bindToDefinition/defInstance): it only
			// touches the outcome_templates row, independent of the frame_write body shape.
			...(params.communication_speech_act_id
				? { communicationSpeechActId: params.communication_speech_act_id }
				: {}),
			// #1968 B-9: authored PLAYER-facing observation narrative — common across
			// every writePrimitive branch (same shape as communicationSpeechActId
			// above): it only touches the outcome_templates row (its `description`
			// column) as a sibling to `capabilityDescription` above, which stays
			// operator-only on `capability_definitions`. Omitted → today's
			// `observation: null` + `observation_gap` behaviour, byte-identical.
			...(params.observation ? { observation: params.observation } : {}),
		};
		let behavior: ActorBehavior;
		if (writePrimitive === "ModifyResource" && params.effect.shape !== undefined) {
			// aoe — unchanged (FIX③, #1968 de-fork).
			const shape = params.effect.shape;
			const shapeParams = shapeParamsJson(shape.id, shape.radius);
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "aoe",
				predicateSource: params.effect.per_target_gate ?? "",
				// biome-ignore lint/style/noNonNullAssertion: validated above.
				deltaSource: params.effect.write.delta!,
				areaShapeId: shape.id,
				areaShapeParamsJson: shapeParams,
				// biome-ignore lint/style/noNonNullAssertion: validated above.
				aoeResource: params.effect.write.resource!,
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else if (writePrimitive === "ModifyResource") {
			// single-target (#1968 verb-UX round 2, NEW): effect.shape omitted —
			// one bare ModifyResource(TargetActor) write, no area-shape geometry, no
			// actor-radius selection. `clusterRows`'s "single-target" shape is the
			// SAME builder `author-spell-behavior.ts`/`author-monster-actions.ts`
			// drive directly (compose.ts) — reused here, not hand-mirrored (`ids()`
			// already respects `cfg.idNamespace`, so there is nothing left to fork).
			// MULTIATTACK (#1968 verb-UX round 3, `attacksParam` set): the SAME
			// single-target shape, but `attacks` replaces `deltaSource` — compose.ts's
			// `b.attacks` branch takes over the frame_write emission (N self-gating
			// ModifyResource(TargetActor, "srd/hp", ...) writes) and ignores both
			// `deltaSource` and `resourceStateId` entirely, so neither is set here.
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "single-target",
				predicateSource: params.effect.per_target_gate ?? "",
				...(attacksParam
					? {
							deltaSource: "", // ignored — `attacks` is set.
							attacks: attacksParam.map((a) => ({ deltaSource: a.delta, label: a.label })),
						}
					: {
							// biome-ignore lint/style/noNonNullAssertion: validated above.
							deltaSource: params.effect.write.delta!,
							// biome-ignore lint/style/noNonNullAssertion: validated above.
							resourceStateId: params.effect.write.resource!,
						}),
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else if (writePrimitive === "ApplyStatus") {
			// #1968 srd-migration round: single-target ApplyStatus — the B9
			// Hold-Person/Hold-Monster/Bless-family shape. Same topology as
			// single-target ModifyResource (bare TargetActor write, affordance-gated
			// via `predicateSource`); only the frame_write op differs (`compose.ts`'s
			// `b.applyCondition` branch).
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "single-target",
				predicateSource: params.effect.per_target_gate ?? "",
				deltaSource: "", // ignored — applyCondition is set.
				// biome-ignore lint/style/noNonNullAssertion: validated above.
				applyCondition: params.effect.write.condition!,
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else if (writePrimitive === "RemoveCondition") {
			// #1968 srd-migration round: single-target RemoveCondition — the
			// Lesser-Restoration cleanse shape, the INVERSE of ApplyStatus (deletes a
			// matching target_condition row instead of landing one).
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "single-target",
				predicateSource: params.effect.per_target_gate ?? "",
				deltaSource: "", // ignored — removeCondition is set.
				// biome-ignore lint/style/noNonNullAssertion: validated above.
				removeCondition: params.effect.write.condition!,
				removeConditionSource: params.effect.write.remove_source,
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else if (writePrimitive === "Spawn") {
			// Brief 26 EffectPrimitive::Spawn (the find_familiar shape,
			// world-fixtures/srd/base/summon.toml): the cast has NO frame_write of its
			// own — `clusterRows`'s "summon" shape dispatches an effect_definitions row
			// (primitives_csv "Spawn") off the success consequence's effect_refs_csv,
			// instantiating `entity_def` at the CASTER'S OWN node (`summonAtCaster`).
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "summon",
				predicateSource: "",
				deltaSource: "", // ignored for summon — the effect is the Spawn, not a resource delta.
				// biome-ignore lint/style/noNonNullAssertion: validated above.
				summonBlueprint: params.effect.write.entity_def!,
				summonAtCaster: true,
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else if (writePrimitive === "EnvState") {
			// #1968 verb-UX round 4 — the Darkness/Silence/Fog AMBIENT-EFFECT shape
			// (compose.ts's "env-state"): the cast's ONLY write is the bool env-state
			// marker Inscribe; no actor effect, no pulse. `zoneStateId`/`envStateValue`/
			// `zoneCenterRef` drive compose.ts's own env-state branch, which ALSO
			// auto-emits the backing spatial_state_definitions row (writer_policy
			// "world_interaction") — this verb never pre-checks env_state_id against an
			// existing definition (mirrors `cost.pool`'s own auto-create).
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "env-state",
				predicateSource: "", // ignored for env-state
				deltaSource: "", // ignored for env-state
				// biome-ignore lint/style/noNonNullAssertion: validated above.
				zoneStateId: params.effect.write.env_state_id!,
				envStateValue: params.effect.write.env_state_value ?? true,
				zoneCenterRef:
					params.effect.write.env_state_center === "target"
						? "TargetSpatialRef"
						: "ActorSpatialRef",
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else if (writePrimitive === "OutcomeGraph") {
			// #1968 verb-UX round 4 — the branch-on-outcome shape (compose.ts's
			// "outcome-graph"): the cast's success consequence is EMPTY — the action's
			// outcome invokes a graph whose branches each carry their OWN ModifyResource
			// consequence, selected by the first true edge guard in array order (mirrors
			// Melf's Acid Arrow: a miss still deals half damage, which a gated
			// single-target write cannot express). Each branch defaults to
			// TargetActor/srd/hp (playable-fighter-l1-20 D-1: byte-identical when a
			// branch omits `subject`/`resource`) but may name its own write subject
			// (e.g. 'Actor' — the caster — for a defeat-consequence XP credit) and
			// resource instead.
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "outcome-graph",
				predicateSource: "", // ignored for outcome-graph — each branch self-gates its own guard.
				deltaSource: "", // ignored — each branch carries its own delta.
				// biome-ignore lint/style/noNonNullAssertion: validated above (non-empty).
				branches: params.effect.write.branches!.map((b) => ({
					node: b.node,
					guard: b.guard,
					deltaSource: b.delta,
					label: b.label,
					subject: b.subject,
					resource: b.resource,
				})),
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else if (writePrimitive === "ScheduledZone") {
			// #1968 verb-UX round 5 — the TRUE lingering hazard shape (compose.ts's
			// "scheduled-zone", ADR-0054): the cast's OWN consequence carries only the
			// marker Inscribe (`clusterRows` emits it automatically for this shape,
			// exactly like EnvState's marker); `deltaSource`/`applyCondition` here
			// describe the SCHEDULED PULSE's body (its own SEPARATE consequence_template,
			// `<action>/pulse`, that the ScheduleAutonomyJob effect re-fires each round) —
			// `effect.write.pulse` REUSES ModifyResource/ApplyStatus rather than a new
			// vocabulary. `effect.per_target_gate` (if set) becomes the pulse's own
			// per-occupant ForEachActorInRadius gate (the save-negate seam), not an
			// affordance gate — this shape's affordance is always ungated.
			// biome-ignore lint/style/noNonNullAssertion: validated above.
			const pulse = params.effect.write.pulse!;
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "scheduled-zone",
				predicateSource: params.effect.per_target_gate ?? "",
				deltaSource: pulse.primitive === "ModifyResource" ? (pulse.delta ?? "") : "",
				...(pulse.primitive === "ApplyStatus" ? { applyCondition: pulse.condition } : {}),
				// biome-ignore lint/style/noNonNullAssertion: validated above.
				zoneStateId: params.effect.write.zone_state_id!,
				zoneIntensity: params.effect.write.zone_intensity,
				zoneVisibility: params.effect.write.zone_visibility,
				zoneCenterRef:
					params.effect.write.zone_center === "target" ? "TargetSpatialRef" : "ActorSpatialRef",
				scheduleRepeats: params.effect.write.schedule?.repeats,
				scheduleFrequencyMs: params.effect.write.schedule?.frequency_ms,
				requiresSubjectAlive: params.effect.write.schedule?.requires_subject_alive,
				scheduleSource: params.effect.write.schedule?.source,
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else if (writePrimitive === "Clock") {
			// #1968 finding C2 — the SELF-TARGETED multi-ordinal clock shape
			// (compose.ts's "clock", the death-saves death-and-dying pattern):
			// `tallies`/`thresholds` map straight onto `ActorBehavior.clockTallies`/
			// `clockThresholds` — no hand-mirrored row assembly, the SAME `clusterRows`
			// builder every other define_behavior branch already drives.
			// `effect.per_target_gate` becomes the AFFORDANCE's eligibility gate
			// (`predicateSource`), the same seam single-target's attack-roll gate uses
			// — validated above to always be self-targeted (targetMode === "self").
			// biome-ignore lint/style/noNonNullAssertion: validated above (non-empty).
			const tallies = params.effect.write.tallies!;
			// biome-ignore lint/style/noNonNullAssertion: validated above (non-empty).
			const thresholds = params.effect.write.thresholds!;
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "clock",
				predicateSource: params.effect.per_target_gate ?? "",
				deltaSource: "", // ignored for clock — tallies/thresholds carry the writes.
				clockTallies: tallies.map((t) => ({
					resource: t.resource,
					predicate: t.predicate,
					delta: t.delta,
				})),
				clockThresholds: thresholds.map((t) => ({
					when: t.when,
					applyStatus: t.apply_status,
					removeCondition: t.remove_condition,
					removeConditionSource: t.remove_condition_source,
				})),
				caster: primaryGrantTo,
				casterNode,
				selfEligible: true, // Clock is always self-eligible (enforced above).
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		} else {
			// Inscribe — the raw FrameWriteOp::Inscribe trace idiom
			// (core/mark/core/pickup/core/drop, world-fixtures/core/base/
			// affordances.toml): a durable typed footprint, no resource delta, no
			// companion definition row. `clusterRows` has no shape emitting a BARE
			// Inscribe with an arbitrary `kind` (its "zone"/"env-state" shapes always
			// pair the marker with a spatial_state_definitions row — a heavier,
			// different mechanism this PoC's trace idiom does not need). Drive
			// "single-target" purely for its capability/outcome/affordance/action
			// boilerplate (no TargetActor selection actually happens — `predicateSource`
			// is "" so the affordance is ungated) and OVERRIDE the single generated
			// frame_write below with the real bare Inscribe.
			behavior = {
				key: params.id,
				displayName,
				emitCapability: params.emit_capability ?? true,
				capabilityDescription: params.description,
				...commonFields,
				shape: "single-target",
				predicateSource: "",
				deltaSource: "0", // placeholder — overridden below, never rendered.
				caster: primaryGrantTo,
				casterNode,
				selfEligible: targetMode === "self",
				...(params.cost
					? { resourceCost: { resource: params.cost.pool, amount: params.cost.amount } }
					: {}),
			};
		}
		const cfg: BehaviorConfig = {
			bundleId: bundle,
			manifestPath: "",
			capPrefix: "spell",
			actionPrefix: params.action_prefix ?? "cast_",
			defaultCaster: primaryGrantTo,
			defaultCasterNode: casterNode,
			idNamespace: bundle,
		};
		const generated = clusterRows([behavior], cfg);

		if (writePrimitive === "Inscribe") {
			// Replace the single-target boilerplate's placeholder ModifyResource(
			// TargetActor) with the real bare Inscribe at the actor's OWN location
			// (ActorSpatialRef) — any trailing cost-debit frame_write `clusterRows`
			// already appended (ordinal 1+) is left untouched.
			const frameWrites = generated.consequence_frame_writes as Record<string, unknown>[];
			const first = frameWrites[0];
			if (first !== undefined) {
				frameWrites[0] = {
					...first,
					frame_write: {
						Inscribe: {
							kind: params.effect.write.trace_kind,
							location_kind: "binding",
							location_ref: "ActorSpatialRef",
							payload_json: params.effect.write.content,
						},
					},
				};
			}
		}

		// #1968 workspace idempotency: `clusterRows` derives every id in this
		// cluster from `params.bundle`/`params.id` alone (the `ids()` namespace,
		// compose.ts) — a re-run with the SAME bundle+id reproduces the SAME ids
		// byte-for-byte. `capability_definitions`/`outcome_templates`/
		// `affordance_templates`/`action_definitions`/`consequence_templates` each
		// carry their OWN natural key (`ROW_KIND_NATURAL_KEY`) and upsert directly;
		// their satellites (`*_tag`, `consequence_frame_writes`, `actor_capabilities`,
		// `spatial_niche_attachments`) have no independent key, so they are cleared
		// WHOLESALE, scoped to the parent id they were generated against, before the
		// new set is pushed (a re-run with e.g. a changed `cost` must not leave a
		// stale frame_write ordinal behind).
		const capId = (generated.capability_definitions as Record<string, unknown>[] | undefined)?.[0]
			?.capability_id as string | undefined;
		const actionId = (generated.action_definitions as Record<string, unknown>[] | undefined)?.[0]
			?.action_id as string | undefined;
		// #1968 verb-UX round 5 fix: EVERY consequence_templates row this call
		// generated, not just the first — a shape whose cluster carries a SECOND
		// (or Nth) template (scheduled-zone's own `<action>/pulse`; outcome-graph's
		// per-branch `<graph>/<node>_effect`) owns its OWN consequence_frame_writes
		// rows, which need their OWN clear-before-push scope. Scoping to only
		// `generated.consequence_templates[0]` (the old `successTemplateId`) left
		// every OTHER template's frame writes unscoped — a re-run duplicated them
		// instead of upserting. `consequence_templates` itself already upserts
		// correctly per-row above (it carries a natural key, `template_id`).
		const templateIds = (
			(generated.consequence_templates as Record<string, unknown>[] | undefined) ?? []
		)
			.map((r) => r.template_id)
			.filter((id): id is string => typeof id === "string");
		const nicheId = capId !== undefined ? `capability:${capId}` : undefined;

		let rowsReplaced = 0;

		// #1968 HIGH fresh-eyes fix: OutcomeGraph's per-branch ids
		// (`outcome_graph_node_id`/`outcome_graph_edge_id`/`outcome_template_id`/
		// `consequence_template_id`) derive from the user-supplied `branches[].node`
		// string (compose.ts's `ids()`/"outcome-graph" branch), but `outcome_graph_id`
		// itself is STABLE (`${actionId}/graph`, independent of the branch set). A
		// re-authored call with a branch REMOVED or RENAMED only regenerates the
		// SURVIVING branches — the per-table natural-key clear below is scoped to
		// `generated`'s OWN rows, so it never touches the OLD branch's rows, which stay
		// wired to the unchanged `outcome_graph_id`: orphaned, and enough to blow
		// `outcome_graphs.max_nodes` on the next validation (MF-VAL-262), permanently
		// (a retry regenerates the same surviving set and hits the same wall).
		// `outcome_graph_nodes`/`outcome_graph_edges` carry `outcome_graph_id` directly,
		// so they're cleared by an EXACT field match (no prefix-guessing needed).
		// `outcome_templates`/`consequence_templates` carry no `outcome_graph_id`
		// column, so their identity is read off the STALE nodes about to be removed
		// (their own `outcome_template_id`/`consequence_template_id` fields) — still
		// exact-match, derived from the id-derivation scheme, not guessed.
		if (writePrimitive === "OutcomeGraph" && actionId !== undefined) {
			const graphId = `${actionId}/graph`;
			const staleNodes = rowArray(manifest, "outcome_graph_nodes").filter(
				(row) => row.outcome_graph_id === graphId,
			);
			for (const node of staleNodes) {
				const outcomeTemplateId = node.outcome_template_id as string | undefined;
				if (outcomeTemplateId === undefined) continue;
				const templateRow = rowArray(manifest, "outcome_templates").find(
					(row) => row.outcome_template_id === outcomeTemplateId,
				);
				const consequenceTemplateId = templateRow?.consequence_template_id as string | undefined;
				rowsReplaced += clearRowsByKey(
					manifest,
					"outcome_templates",
					"outcome_template_id",
					outcomeTemplateId,
				);
				if (consequenceTemplateId !== undefined) {
					rowsReplaced += clearRowsByKey(
						manifest,
						"consequence_frame_writes",
						"template_id",
						consequenceTemplateId,
					);
					rowsReplaced += clearRowsByKey(
						manifest,
						"consequence_templates",
						"template_id",
						consequenceTemplateId,
					);
				}
			}
			rowsReplaced += clearRowsByKey(manifest, "outcome_graph_edges", "outcome_graph_id", graphId);
			rowsReplaced += clearRowsByKey(manifest, "outcome_graph_nodes", "outcome_graph_id", graphId);
		}

		for (const [table, rows] of Object.entries(generated)) {
			const typed = rows as Record<string, unknown>[];
			const naturalKeyField = ROW_KIND_NATURAL_KEY[table];
			if (naturalKeyField !== undefined) {
				for (const row of typed) {
					rowsReplaced += clearRowsByKey(manifest, table, naturalKeyField, row[naturalKeyField]);
				}
			} else if (table === "action_definition_tag") {
				rowsReplaced += clearRowsByKey(manifest, table, "action_id", actionId);
			} else if (table === "capability_definition_tag") {
				rowsReplaced += clearRowsByKey(manifest, table, "capability_id", capId);
			} else if (table === "consequence_frame_writes") {
				for (const templateId of templateIds) {
					rowsReplaced += clearRowsByKey(manifest, table, "template_id", templateId);
				}
			} else if (table === "actor_capabilities") {
				// #1968 finding B4: scoped to `capId` ALONE (the "parent"), not also
				// the caster — mirrors `spatial_niche_attachments`'s own `nicheId`-only
				// scope directly below, and is what makes a SHRUNK `grant_to` array
				// self-correcting: an entity_key dropped on a later call has its grant
				// row cleared here (this table's ENTIRE row set for this capability is
				// cleared, then the current full grant set — including any additional
				// entries — is re-pushed below), never left as an orphaned grant.
				rowsReplaced += clearRowsWhere(manifest, table, (row) => row.capability_id === capId);
			} else if (table === "spatial_niche_attachments") {
				rowsReplaced += clearRowsByKey(manifest, table, "niche_id", nicheId);
			} else if (table === "entity_definition_initial_capability") {
				// #1968 verb-UX round 3 — `bind_to_definition`'s satellite: no independent
				// natural key (junction row), so clear scoped to THIS behavior's own
				// (entity_def_id, capability_id) pair before pushing — a re-run with a
				// changed `bind_to_definition` must not leave a stale binding behind.
				rowsReplaced += clearRowsWhere(
					manifest,
					table,
					(row) => row.entity_def_id === params.bind_to_definition && row.capability_id === capId,
				);
			} else if (table === "actor_spatial_locations") {
				// #1968 verb-UX round 3 — `def_instance`'s satellite (mirrors
				// the placement tools' own object_state clear): `entities`/`actors` already
				// upsert-by-entity_key generically above (ROW_KIND_NATURAL_KEY), but their
				// actor_spatial_locations sidecar has no independent key — clear scoped to
				// the proof instance's own entity_key (every row this table carries here
				// comes from the SAME `def_instance.entity_key`, one behavior per call).
				const defInstanceKey = typed[0]?.entity_key;
				if (defInstanceKey !== undefined) {
					rowsReplaced += clearRowsByKey(manifest, table, "entity_key", defInstanceKey);
				}
			}
			rowArray(manifest, table).push(...typed);
			rowsAdded += typed.length;
		}

		// #1968 finding B4: fan out the SAME grant to every OTHER `grant_to`
		// entity — `clusterRows` above already pushed `primaryGrantTo`'s own
		// `actor_capabilities`/`spatial_niche_attachments` rows (inside
		// `generated`, cleared+pushed by the loop above); each additional
		// entry gets the IDENTICAL two row shapes (compose.ts's own
		// `rows.actor_capabilities.push`/`rows.spatial_niche_attachments.push`,
		// mirrored here), resolved against ITS OWN node — never assumed to
		// share `primaryGrantTo`'s node. `capId`/`nicheId` fall back to the
		// explicit `capability_id` override for the `emit_capability: false` +
		// reused-capability combo (the same id `clusterRows` derived internally
		// even though `generated.capability_definitions` is empty in that case).
		const grantCapId = capId ?? params.capability_id;
		const grantNicheId =
			nicheId ?? (grantCapId !== undefined ? `capability:${grantCapId}` : undefined);
		if (grantCapId !== undefined && grantNicheId !== undefined) {
			for (const entityKey of grantTo.slice(1)) {
				const node = resolveCasterNode(manifest, entityKey, authorTarget);
				rowArray(manifest, "actor_capabilities").push({
					actor_entity_key: entityKey,
					capability_id: grantCapId,
					source: entityKey,
					bundle_id: bundle,
				});
				rowArray(manifest, "spatial_niche_attachments").push({
					bundle_id: bundle,
					place_node_id: node,
					niche_id: grantNicheId,
				});
				rowsAdded += 2;
			}
		}
		if (grantNicheId !== undefined) {
			rowsAdded += ensureCapabilityNicheDefinition(
				manifest,
				grantNicheId,
				bundle,
				"place",
				"WA-CAP-002: capability:* niches require an explicit provider. " +
					"spellkave_define_behavior attaches this niche at grant_to's node (place-provided).",
			);
		}

		const successId = `${bundle}/${params.action_prefix ?? "cast_"}${params.id}/success`;
		return commitOrReport(context, manifest, rowsAdded, rowsReplaced, DEFINE_BEHAVIOR_TOOL, (d) => {
			if (!d.path.includes(successId)) return undefined;
			if (writePrimitive === "ModifyResource") {
				const deltaText = params.effect.write.delta ?? "";
				if (deltaText.length > 0 && d.message.includes(deltaText)) return "effect.write.delta";
				const gateText = params.effect.per_target_gate;
				if (gateText !== undefined && gateText.length > 0 && d.message.includes(gateText)) {
					return "effect.per_target_gate";
				}
			} else if (writePrimitive === "Inscribe") {
				const contentText = params.effect.write.content ?? "";
				if (contentText.length > 0 && d.message.includes(contentText))
					return "effect.write.content";
			} else if (writePrimitive === "ApplyStatus" || writePrimitive === "RemoveCondition") {
				const conditionText = params.effect.write.condition ?? "";
				if (conditionText.length > 0 && d.message.includes(conditionText))
					return "effect.write.condition";
				const gateText = params.effect.per_target_gate;
				if (gateText !== undefined && gateText.length > 0 && d.message.includes(gateText)) {
					return "effect.per_target_gate";
				}
			}
			return "effect.write";
		});
	},
});

// ---------------------------------------------------------------------------
// Shared plumbing for the four folded-satellite verbs below (6-9): map a
// validator diagnostic back to THIS call's own param name, reusing
// `mapWriteRowsParam`'s generic bracket/dot/distinctive-value scanner (a
// forward reference — `mapWriteRowsParam` is a hoisted function declaration
// defined later in this file, in the `spellkave_write_rows` section) per
// generated row-kind, then relabeling the row-kind name to the verb's own
// param. `groups` is checked in order; the FIRST group whose kind matches the
// diagnostic's row-kind wins (kinds never collide in practice — a diagnostic
// path always names exactly one row kind).
// ---------------------------------------------------------------------------

interface FoldedRowGroup {
	/** The Manifest row-kind name this group's rows were pushed under. */
	kind: string;
	rows: Record<string, unknown>[];
	/** This verb's own param name the diagnostic should be blamed on. */
	param: string;
	/** `true` for a `param: T[]` satellite array; `false` for the ONE parent row. */
	isArray: boolean;
}

function mapFoldedVerbParam(diagnostic: Diagnostic, groups: FoldedRowGroup[]): string | undefined {
	for (const group of groups) {
		if (group.rows.length === 0) continue;
		const mapped = mapWriteRowsParam(diagnostic, group.kind, group.rows);
		if (mapped === undefined) continue;
		if (!group.isArray) {
			// The parent row is always `rows[0]` (one row per call) — surface the
			// bare field name directly (it IS this verb's own top-level param name),
			// falling back to `group.param` (e.g. "id") when no field is determinable.
			const field = mapped.startsWith("rows[0].") ? mapped.slice("rows[0].".length) : undefined;
			return field ?? group.param;
		}
		// Satellite array param (e.g. "tags", "initial_states"): relabel "rows[i]"/
		// "rows[i].field" to "<param>[i]"/"<param>[i].field".
		return mapped.replace(/^rows/, group.param);
	}
	return undefined;
}

/** `<bundle>/<id>` — every folded verb below qualifies its local `id` stem this way, matching the corpus convention (`id` MAY itself contain '/' for sub-namespacing, e.g. "item/sword", "class/barbarian"). */
function qualifyId(bundle: string, id: string): string {
	return `${bundle}/${id}`;
}

/** One `[[<kind>_tag]]` row per tag, the fold this whole round replaces per-tag `spellkave_write_rows` calls with. */
function tagRows(
	idField: string,
	id: string,
	bundle: string,
	tags: string[] | undefined,
): Record<string, unknown>[] {
	return (tags ?? []).map((tag) => ({ [idField]: id, tag, bundle_id: bundle, source: "manifest" }));
}

export const defineEntityTypeToolDef = defineTool({
	contract: DEFINE_ENTITY_TYPE_TOOL,
	schema: DEFINE_ENTITY_TYPE_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "npc/goblin_scout",
		display_name: "Goblin Scout",
		tags: ["npc", "hostile"],
		initial_capabilities: [{ capability: "core/walk" }],
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_ENTITY_TYPE_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_ENTITY_TYPE_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const entityDefId = qualifyId(bundle, params.id);

		// #1968 workspace idempotency: clear the parent row + every satellite,
		// scoped to entityDefId, BEFORE pushing the new set — a re-run with fewer
		// tags/seeds must not leave stale ones behind (the "satellite-shrink" case).
		let rowsReplaced = clearRowsByKey(manifest, "entity_definitions", "entity_def_id", entityDefId);
		rowsReplaced += clearRowsByKey(manifest, "entity_definition_tag", "entity_def_id", entityDefId);
		rowsReplaced += clearRowsByKey(
			manifest,
			"entity_definition_initial_state",
			"entity_def_id",
			entityDefId,
		);
		rowsReplaced += clearRowsByKey(
			manifest,
			"entity_definition_initial_capability",
			"entity_def_id",
			entityDefId,
		);
		rowsReplaced += clearRowsByKey(
			manifest,
			"entity_definition_initial_condition",
			"entity_def_id",
			entityDefId,
		);
		rowsReplaced += clearRowsByKey(
			manifest,
			"entity_definition_initial_containment",
			"entity_def_id",
			entityDefId,
		);
		rowsReplaced += clearRowsByKey(
			manifest,
			"entity_definition_initial_equipment",
			"entity_def_id",
			entityDefId,
		);

		const entityRow: Record<string, unknown> = {
			entity_def_id: entityDefId,
			bundle_id: bundle,
			display_name: resolveDisplayName(params.display_name, params.id),
			lineage_id: params.lineage_id ?? "",
			affordance_seed_id: params.affordance_seed_id ?? "",
			on_consume_consequence_id: params.on_consume_consequence_id ?? "",
			on_destroy_consequence_id: params.on_destroy_consequence_id ?? "",
			grants_capability_while_equipped: params.grants_capability_while_equipped ?? "",
			grants_capability_while_present_in_location:
				params.grants_capability_while_present_in_location ?? "",
			slot_compatibility_predicate: params.slot_compatibility_predicate ?? "",
			stackable: params.stackable ?? false,
			...(params.description !== undefined ? { description: params.description } : {}),
		};
		rowArray(manifest, "entity_definitions").push(entityRow);
		rowsAdded += 1;

		const tagGroup = tagRows("entity_def_id", entityDefId, bundle, params.tags);
		rowArray(manifest, "entity_definition_tag").push(...tagGroup);
		rowsAdded += tagGroup.length;

		const stateGroup = (params.initial_states ?? []).map((s) => ({
			entity_def_id: entityDefId,
			state_id: s.state,
			bundle_id: bundle,
			...(s.value_bool !== undefined ? { value_bool: s.value_bool } : {}),
			...(s.value_int !== undefined ? { value_int: s.value_int } : {}),
			...(s.value_text !== undefined ? { value_text: s.value_text } : {}),
		}));
		rowArray(manifest, "entity_definition_initial_state").push(...stateGroup);
		rowsAdded += stateGroup.length;

		const capGroup = (params.initial_capabilities ?? []).map((c) => ({
			entity_def_id: entityDefId,
			capability_id: c.capability,
			bundle_id: bundle,
			...(c.extent_kind_ref === undefined ? {} : { extent_kind_ref: c.extent_kind_ref }),
			...(c.extent_ref === undefined ? {} : { extent_ref: c.extent_ref }),
		}));
		rowArray(manifest, "entity_definition_initial_capability").push(...capGroup);
		rowsAdded += capGroup.length;

		const condGroup = (params.initial_conditions ?? []).map((c) => ({
			entity_def_id: entityDefId,
			condition_definition_id: c.condition,
			bundle_id: bundle,
			...(c.duration_ticks !== undefined ? { duration_ticks: c.duration_ticks } : {}),
		}));
		rowArray(manifest, "entity_definition_initial_condition").push(...condGroup);
		rowsAdded += condGroup.length;

		const containGroup = (params.initial_containment ?? []).map((c) => ({
			entity_def_id: entityDefId,
			contained_entity_def_id: c.contained_entity_def_id,
			bundle_id: bundle,
			...(c.quantity !== undefined ? { quantity: c.quantity } : {}),
		}));
		rowArray(manifest, "entity_definition_initial_containment").push(...containGroup);
		rowsAdded += containGroup.length;

		const equipGroup = (params.initial_equipment ?? []).map((e) => ({
			entity_def_id: entityDefId,
			equipped_entity_def_id: e.equipped_entity_def_id,
			slot_id: e.slot_id,
			bundle_id: bundle,
		}));
		rowArray(manifest, "entity_definition_initial_equipment").push(...equipGroup);
		rowsAdded += equipGroup.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_ENTITY_TYPE_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "entity_definitions", rows: [entityRow], param: "id", isArray: false },
					{ kind: "entity_definition_tag", rows: tagGroup, param: "tags", isArray: true },
					{
						kind: "entity_definition_initial_state",
						rows: stateGroup,
						param: "initial_states",
						isArray: true,
					},
					{
						kind: "entity_definition_initial_capability",
						rows: capGroup,
						param: "initial_capabilities",
						isArray: true,
					},
					{
						kind: "entity_definition_initial_condition",
						rows: condGroup,
						param: "initial_conditions",
						isArray: true,
					},
					{
						kind: "entity_definition_initial_containment",
						rows: containGroup,
						param: "initial_containment",
						isArray: true,
					},
					{
						kind: "entity_definition_initial_equipment",
						rows: equipGroup,
						param: "initial_equipment",
						isArray: true,
					},
				]),
			{ entity_def_id: entityDefId },
			// "fatal": kernel/substrate catalog content — see the file-header note.
			"fatal",
		);
	},
});

export const defineRollTableToolDef = defineTool({
	contract: DEFINE_ROLL_TABLE_TOOL,
	schema: DEFINE_ROLL_TABLE_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "loot/scout_drops",
		result_kind: "int",
		entries: [
			{ result_ref: "1d4 gold", weight: 3 },
			{ result_ref: "a bent dagger", weight: 1 },
		],
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_ROLL_TABLE_PARAMS>) => {
		if (params.entries.length === 0) {
			throw new Error(`${DEFINE_ROLL_TABLE_TOOL}: \`entries\` must include at least one entry.`);
		}
		const bundle = resolveBundle(context, params.bundle, DEFINE_ROLL_TABLE_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const rollTableId = qualifyId(bundle, params.id);

		// #1968 workspace idempotency: clear the parent row + every satellite,
		// scoped to rollTableId, BEFORE pushing the new set. `roll_table_entry_tag`
		// carries no `roll_table_id` column of its own — its rows are scoped by the
		// `<roll_table_id>:<authored_order>` namespace its `roll_table_entry_id`
		// values live under instead.
		let rowsReplaced = clearRowsByKey(manifest, "roll_tables", "roll_table_id", rollTableId);
		rowsReplaced += clearRowsByKey(manifest, "roll_table_tag", "roll_table_id", rollTableId);
		rowsReplaced += clearRowsByKey(manifest, "roll_table_entries", "roll_table_id", rollTableId);
		rowsReplaced += clearRowsWhere(manifest, "roll_table_entry_tag", (row) =>
			String(row.roll_table_entry_id ?? "").startsWith(`${rollTableId}:`),
		);

		const tableRow: Record<string, unknown> = {
			roll_table_id: rollTableId,
			bundle_id: bundle,
			display_name: resolveDisplayName(params.display_name, params.id),
			result_kind: params.result_kind,
			...(params.description !== undefined ? { description: params.description } : {}),
		};
		rowArray(manifest, "roll_tables").push(tableRow);
		rowsAdded += 1;

		const tagGroup = tagRows("roll_table_id", rollTableId, bundle, params.tags);
		rowArray(manifest, "roll_table_tag").push(...tagGroup);
		rowsAdded += tagGroup.length;

		const entryRows: Record<string, unknown>[] = [];
		const entryTagRows: Record<string, unknown>[] = [];
		params.entries.forEach((entry, index) => {
			const authoredOrder = index + 1;
			const entryId = `${rollTableId}:${authoredOrder}`;
			// NOTE: no `bundle_id` field — RollTableEntryRow carries none (schema).
			entryRows.push({
				roll_table_entry_id: entryId,
				roll_table_id: rollTableId,
				authored_order: authoredOrder,
				weight: entry.weight ?? 1,
				result_ref: entry.result_ref,
			});
			entryTagRows.push(...tagRows("roll_table_entry_id", entryId, bundle, entry.tags));
		});
		rowArray(manifest, "roll_table_entries").push(...entryRows);
		rowsAdded += entryRows.length;
		rowArray(manifest, "roll_table_entry_tag").push(...entryTagRows);
		rowsAdded += entryTagRows.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_ROLL_TABLE_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "roll_tables", rows: [tableRow], param: "id", isArray: false },
					{ kind: "roll_table_tag", rows: tagGroup, param: "tags", isArray: true },
					{ kind: "roll_table_entries", rows: entryRows, param: "entries", isArray: true },
					{ kind: "roll_table_entry_tag", rows: entryTagRows, param: "entries", isArray: true },
				]),
			{ roll_table_id: rollTableId },
			"fatal",
		);
	},
});

export const defineConditionToolDef = defineTool({
	contract: DEFINE_CONDITION_TOOL,
	schema: DEFINE_CONDITION_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "burning",
		description: "Ongoing fire damage from a failed Firebloom save.",
		tags: ["debuff", "damage_over_time"],
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_CONDITION_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_CONDITION_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const conditionId = qualifyId(bundle, params.id);
		let rowsReplaced = 0;

		let removeTimePolicy = params.remove_time_policy;
		const removePolicyRows: Record<string, unknown>[] = [];
		if (params.remove_policy !== undefined) {
			if (removeTimePolicy !== undefined && removeTimePolicy !== params.remove_policy.id) {
				throw new Error(
					`${DEFINE_CONDITION_TOOL}: \`remove_time_policy\` ('${removeTimePolicy}') does not match ` +
						`\`remove_policy.id\` ('${params.remove_policy.id}') — pass matching ids or omit ` +
						"`remove_time_policy` (it is derived from `remove_policy.id`). The offending param is " +
						"`remove_time_policy`.",
				);
			}
			removeTimePolicy = params.remove_policy.id;
			// #1968 workspace idempotency: upsert by policy_id (mirrors commit.rs's
			// ADR-0085 finding-2 fix — the SERVER used to silently drop a changed
			// redeclare here; this file now matches that discipline instead of the
			// PoC's original skip-if-exists, which had the same silent-drop bug).
			rowsReplaced += clearRowsByKey(
				manifest,
				"condition_remove_policy_definitions",
				"policy_id",
				params.remove_policy.id,
			);
			removePolicyRows.push({
				policy_id: params.remove_policy.id,
				bundle_id: bundle,
				display_name: resolveDisplayName(
					params.remove_policy.display_name,
					params.remove_policy.id,
				),
				remove_predicate_source: params.remove_policy.remove_predicate_source,
			});
		}
		rowArray(manifest, "condition_remove_policy_definitions").push(...removePolicyRows);
		rowsAdded += removePolicyRows.length;

		let stackingRule = params.stacking_rule;
		const stackingRows: Record<string, unknown>[] = [];
		if (params.stacking !== undefined) {
			if (stackingRule !== undefined && stackingRule !== params.stacking.id) {
				throw new Error(
					`${DEFINE_CONDITION_TOOL}: \`stacking_rule\` ('${stackingRule}') does not match \`stacking.id\` ` +
						`('${params.stacking.id}') — pass matching ids or omit \`stacking_rule\` (it is derived from ` +
						"`stacking.id`). The offending param is `stacking_rule`.",
				);
			}
			stackingRule = params.stacking.id;
			// #1968 workspace idempotency: upsert by discipline_id (see remove_policy
			// note above — same ADR-0085 finding-2 discipline).
			rowsReplaced += clearRowsByKey(
				manifest,
				"stacking_discipline_definitions",
				"discipline_id",
				params.stacking.id,
			);
			stackingRows.push({
				discipline_id: params.stacking.id,
				bundle_id: bundle,
				display_name: resolveDisplayName(params.stacking.display_name, params.stacking.id),
				stack_count_outcome_source: params.stacking.stack_count_outcome_source,
				expires_at_tick_outcome_source: params.stacking.expires_at_tick_outcome_source,
			});
		}
		rowArray(manifest, "stacking_discipline_definitions").push(...stackingRows);
		rowsAdded += stackingRows.length;

		let modifierTemplateId = params.modifier_template_id;
		const modifiers = params.modifiers ?? [];
		if (modifiers.length > 1 && modifierTemplateId === undefined) {
			throw new Error(
				`${DEFINE_CONDITION_TOOL}: \`modifier_template_id\` is required when \`modifiers\` has more than ` +
					"one entry (ambiguous which one condition_definitions.modifier_template_id should reference) " +
					"— the offending param is `modifier_template_id`.",
			);
		}
		const modifierRows: Record<string, unknown>[] = [];
		const modifierTagRows: Record<string, unknown>[] = [];
		for (const modifier of modifiers) {
			const modifierId = qualifyId(bundle, modifier.id);
			if (modifiers.length === 1 && modifierTemplateId === undefined)
				modifierTemplateId = modifierId;
			// #1968 workspace idempotency: modifier_templates has its OWN natural key
			// (modifier_template_id, independently namespaced from conditionId) —
			// upsert per-modifier, not scoped to the condition's own key. Its
			// modifier_template_tag satellite is scoped to THIS modifier's id.
			rowsReplaced += clearRowsByKey(
				manifest,
				"modifier_templates",
				"modifier_template_id",
				modifierId,
			);
			rowsReplaced += clearRowsByKey(
				manifest,
				"modifier_template_tag",
				"modifier_template_id",
				modifierId,
			);
			modifierRows.push({
				modifier_template_id: modifierId,
				bundle_id: bundle,
				applies_to: modifier.applies_to,
				display_name: resolveDisplayName(modifier.display_name, modifier.id),
				predicate_source: modifier.predicate_source ?? "",
				modifier_expression_source: modifier.modifier_expression_source,
				priority: modifier.priority ?? 0,
				delta_kind: modifier.delta_kind ?? "Plus",
				replace_template_id: modifier.replace_template_id ?? null,
			});
			modifierTagRows.push(...tagRows("modifier_template_id", modifierId, bundle, modifier.tags));
		}
		rowArray(manifest, "modifier_templates").push(...modifierRows);
		rowsAdded += modifierRows.length;
		rowArray(manifest, "modifier_template_tag").push(...modifierTagRows);
		rowsAdded += modifierTagRows.length;

		// #1968 workspace idempotency: clear the condition parent row + its tag
		// satellite, scoped to conditionId, before pushing the new set.
		rowsReplaced += clearRowsByKey(
			manifest,
			"condition_definitions",
			"condition_definition_id",
			conditionId,
		);
		rowsReplaced += clearRowsByKey(
			manifest,
			"condition_definition_tag",
			"condition_definition_id",
			conditionId,
		);

		const conditionRow: Record<string, unknown> = {
			condition_definition_id: conditionId,
			bundle_id: bundle,
			display_name: resolveDisplayName(params.display_name, params.id),
			stacking_rule: stackingRule ?? "core/stacking/single",
			remove_time_policy: removeTimePolicy ?? "core/remove_policy/independent_lifetime",
			gate_predicate_source: params.gate_predicate_source ?? "",
			modifier_template_id: modifierTemplateId ?? "",
			hooks: (params.hooks ?? []).map((h) => ({
				event_kind: h.event_kind,
				...(h.detail_filter_source !== undefined
					? { detail_filter_source: h.detail_filter_source }
					: {}),
				...(h.expression_source !== undefined ? { expression_source: h.expression_source } : {}),
			})),
			observable: params.observable ?? true,
			grants_capability_while_active: params.grants_capability_while_active ?? [],
			suppresses_capability_while_active: params.suppresses_capability_while_active ?? [],
			implies: params.implies ?? [],
			...(params.description !== undefined ? { description: params.description } : {}),
		};
		rowArray(manifest, "condition_definitions").push(conditionRow);
		rowsAdded += 1;

		const tagGroup = tagRows("condition_definition_id", conditionId, bundle, params.tags);
		rowArray(manifest, "condition_definition_tag").push(...tagGroup);
		rowsAdded += tagGroup.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_CONDITION_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "condition_definitions", rows: [conditionRow], param: "id", isArray: false },
					{ kind: "condition_definition_tag", rows: tagGroup, param: "tags", isArray: true },
					{
						kind: "condition_remove_policy_definitions",
						rows: removePolicyRows,
						param: "remove_policy",
						isArray: false,
					},
					{
						kind: "stacking_discipline_definitions",
						rows: stackingRows,
						param: "stacking",
						isArray: false,
					},
					{ kind: "modifier_templates", rows: modifierRows, param: "modifiers", isArray: true },
					{
						kind: "modifier_template_tag",
						rows: modifierTagRows,
						param: "modifiers",
						isArray: true,
					},
				]),
			{ condition_definition_id: conditionId },
			"fatal",
		);
	},
});

export const defineNicheToolDef = defineTool({
	contract: DEFINE_NICHE_TOOL,
	schema: DEFINE_NICHE_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "trap/plate",
		description: "A pressure plate hidden at the arena fringe.",
		tags: ["trap"],
		attachments: [{ node: "aoe_blast/arena/fringe" }],
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_NICHE_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_NICHE_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const nicheId = qualifyId(bundle, params.id);

		// #1968 workspace idempotency: clear the parent row + every satellite,
		// scoped to nicheId, BEFORE pushing the new set.
		let rowsReplaced = clearRowsByKey(manifest, "niche_definitions", "niche_id", nicheId);
		rowsReplaced += clearRowsByKey(manifest, "niche_definition_tag", "niche_id", nicheId);
		rowsReplaced += clearRowsByKey(manifest, "spatial_niche_attachments", "niche_id", nicheId);

		const nicheRow: Record<string, unknown> = {
			niche_id: nicheId,
			bundle_id: bundle,
			display_name: resolveDisplayName(params.display_name, params.id),
			description: params.description,
			predicate_source: params.predicate_source ?? "",
		};
		rowArray(manifest, "niche_definitions").push(nicheRow);
		rowsAdded += 1;

		const tagGroup = tagRows("niche_id", nicheId, bundle, params.tags);
		rowArray(manifest, "niche_definition_tag").push(...tagGroup);
		rowsAdded += tagGroup.length;

		const attachmentRows: Record<string, unknown>[] = [];
		for (const attachment of params.attachments ?? []) {
			const hasNode = attachment.node !== undefined;
			const hasEdge = attachment.edge !== undefined;
			if (hasNode === hasEdge) {
				throw new Error(
					`${DEFINE_NICHE_TOOL}: each attachments[] entry needs EXACTLY ONE of \`node\`/\`edge\` (got ` +
						`${hasNode ? "both" : "neither"}) — the offending param is \`attachments\`.`,
				);
			}
			attachmentRows.push({
				bundle_id: bundle,
				niche_id: nicheId,
				place_node_id: attachment.node ?? "",
				place_edge_id: attachment.edge ?? null,
				visibility: attachment.visibility ?? "Public",
				condition_bool: attachment.condition_bool ?? true,
				ecological_invariant: attachment.ecological_invariant ?? false,
			});
		}
		rowArray(manifest, "spatial_niche_attachments").push(...attachmentRows);
		rowsAdded += attachmentRows.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_NICHE_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "niche_definitions", rows: [nicheRow], param: "id", isArray: false },
					{ kind: "niche_definition_tag", rows: tagGroup, param: "tags", isArray: true },
					{
						kind: "spatial_niche_attachments",
						rows: attachmentRows,
						param: "attachments",
						isArray: true,
					},
				]),
			{ niche_id: nicheId },
			"fatal",
		);
	},
});

export const defineAffordanceToolDef = defineTool({
	contract: DEFINE_AFFORDANCE_TOOL,
	schema: DEFINE_AFFORDANCE_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "trap/plate",
		niche_id: "aoe_blast/trap/plate",
		capability_id: "aoe_blast/trigger/plate",
		manipulation_action_id: "aoe_blast/cast_firebloom",
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_AFFORDANCE_PARAMS>) => {
		const hasExpr = params.outcome_expression_source !== undefined;
		const hasAction = params.manipulation_action_id !== undefined;
		if (hasExpr === hasAction) {
			throw new Error(
				`${DEFINE_AFFORDANCE_TOOL}: exactly ONE of \`outcome_expression_source\`/\`manipulation_action_id\` ` +
					`is required (got ${hasExpr ? "both" : "neither"}) — an affordance with neither would trigger ` +
					"nothing.",
			);
		}

		const bundle = resolveBundle(context, params.bundle, DEFINE_AFFORDANCE_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);

		if (!nicheExists(manifest, db, params.niche_id, target)) {
			throw new Error(
				`${DEFINE_AFFORDANCE_TOOL}: niche_id '${params.niche_id}' has no matching niche_definitions row ` +
					`in the workspace${db ? " or live world" : ""}${target ? ` or the active ${target.kind} target` : ""} ` +
					"— this verb does not auto-create the niche (use spellkave_define_niche first) — the offending " +
					"param is `niche_id`.",
			);
		}
		if (!capabilityExists(manifest, db, params.capability_id, target)) {
			throw new Error(
				`${DEFINE_AFFORDANCE_TOOL}: capability_id '${params.capability_id}' has no matching ` +
					`capability_definitions row in the workspace${db ? " or live world" : ""}` +
					`${target ? ` or the active ${target.kind} target` : ""} — this verb does not auto-create the ` +
					"capability (use spellkave_define_capability first) — the offending param is `capability_id`.",
			);
		}

		const affordanceId = qualifyId(bundle, params.id);
		const outcomeId = `${affordanceId}/outcome`;
		const templateId = `${affordanceId}/affordance`;
		const displayName = resolveDisplayName(params.display_name, params.id);

		// #1968 workspace idempotency: clear both rows, scoped to THIS call's own
		// derived ids, BEFORE pushing the new set — mirrors every other folding
		// verb's "replace, never duplicate" re-run discipline.
		let rowsReplaced = clearRowsByKey(
			manifest,
			"outcome_templates",
			"outcome_template_id",
			outcomeId,
		);
		rowsReplaced += clearRowsByKey(manifest, "affordance_templates", "template_id", templateId);

		const outcomeRow: Record<string, unknown> = {
			outcome_template_id: outcomeId,
			bundle_id: bundle,
			display_name: displayName,
			...(hasExpr
				? { outcome_expression_source: params.outcome_expression_source }
				: { outcome_bool: true, manipulation_action_id: params.manipulation_action_id }),
		};
		rowArray(manifest, "outcome_templates").push(outcomeRow);
		rowsAdded += 1;

		const gateOnAffordance = (params.predicate_source ?? "") !== "";
		const affordanceRow: Record<string, unknown> = {
			template_id: templateId,
			bundle_id: bundle,
			niche_id: params.niche_id,
			capability_id: params.capability_id,
			display_name: displayName,
			...(gateOnAffordance
				? { predicate_source: params.predicate_source }
				: { predicate_bool: true }),
			outcome_template_id: outcomeId,
			range_m: params.range_m ?? 0,
		};
		rowArray(manifest, "affordance_templates").push(affordanceRow);
		rowsAdded += 1;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_AFFORDANCE_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "outcome_templates", rows: [outcomeRow], param: "id", isArray: false },
					{ kind: "affordance_templates", rows: [affordanceRow], param: "id", isArray: false },
				]),
			{ outcome_template_id: outcomeId, template_id: templateId },
			"fatal",
		);
	},
});

export const defineCapabilityToolDef = defineTool({
	contract: DEFINE_CAPABILITY_TOOL,
	schema: DEFINE_CAPABILITY_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "trigger/plate",
		actor_kind: "entity",
		description: "Any entity that can trip the arena's hidden pressure plate.",
		tags: ["trigger"],
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_CAPABILITY_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_CAPABILITY_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const capabilityId = qualifyId(bundle, params.id);

		// #1968 workspace idempotency: clear the parent row + its tag satellite,
		// scoped to capabilityId, BEFORE pushing the new set.
		let rowsReplaced = clearRowsByKey(
			manifest,
			"capability_definitions",
			"capability_id",
			capabilityId,
		);
		rowsReplaced += clearRowsByKey(
			manifest,
			"capability_definition_tag",
			"capability_id",
			capabilityId,
		);

		const capabilityRow: Record<string, unknown> = {
			capability_id: capabilityId,
			bundle_id: bundle,
			actor_kind: params.actor_kind,
			display_name: resolveDisplayName(params.display_name, params.id),
			description: params.description,
			default_visibility: params.default_visibility ?? "Public",
		};
		rowArray(manifest, "capability_definitions").push(capabilityRow);
		rowsAdded += 1;

		const tagGroup = tagRows("capability_id", capabilityId, bundle, params.tags);
		rowArray(manifest, "capability_definition_tag").push(...tagGroup);
		rowsAdded += tagGroup.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_CAPABILITY_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "capability_definitions", rows: [capabilityRow], param: "id", isArray: false },
					{ kind: "capability_definition_tag", rows: tagGroup, param: "tags", isArray: true },
				]),
			{ capability_id: capabilityId },
			// "fatal": kernel/substrate catalog content — see the file-header note.
			"fatal",
		);
	},
});

export const defineConsequenceToolDef = defineTool({
	contract: DEFINE_CONSEQUENCE_TOOL,
	schema: DEFINE_CONSEQUENCE_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "trap/plate/success",
		frame_writes: [
			{
				Inscribe: {
					kind: "trap_triggered",
					location_kind: "binding",
					location_ref: "ActorSpatialRef",
					payload_json: '{"trap":"plate"}',
				},
			},
		],
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_CONSEQUENCE_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_CONSEQUENCE_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const templateId = qualifyId(bundle, params.id);

		// #1968 workspace idempotency: clear the parent row + every
		// consequence_frame_writes row scoped to templateId BEFORE pushing the
		// new set.
		let rowsReplaced = clearRowsByKey(manifest, "consequence_templates", "template_id", templateId);
		rowsReplaced += clearRowsByKey(manifest, "consequence_frame_writes", "template_id", templateId);

		const consequenceRow: Record<string, unknown> = {
			template_id: templateId,
			bundle_id: bundle,
			...(params.effect_ref !== undefined ? { effect_refs_csv: params.effect_ref } : {}),
			...(params.description !== undefined ? { description: params.description } : {}),
		};
		rowArray(manifest, "consequence_templates").push(consequenceRow);
		rowsAdded += 1;

		const frameWriteGroup = (params.frame_writes ?? []).map((frameWrite, ordinal) => ({
			template_id: templateId,
			ordinal,
			frame_write: frameWrite,
		}));
		rowArray(manifest, "consequence_frame_writes").push(...frameWriteGroup);
		rowsAdded += frameWriteGroup.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_CONSEQUENCE_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "consequence_templates", rows: [consequenceRow], param: "id", isArray: false },
					{
						kind: "consequence_frame_writes",
						rows: frameWriteGroup,
						param: "frame_writes",
						isArray: true,
					},
				]),
			{ template_id: templateId },
			// "fatal": kernel/substrate catalog content — see the file-header note.
			"fatal",
		);
	},
});

export const defineActionToolDef = defineTool({
	contract: DEFINE_ACTION_TOOL,
	schema: DEFINE_ACTION_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "trigger_plate",
		required_capability: "aoe_blast/trigger/plate",
		on_success: "aoe_blast/trap/plate/success",
		display_name: "Trigger Pressure Plate",
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_ACTION_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_ACTION_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);
		const actionId = qualifyId(bundle, params.id);

		if (!capabilityExists(manifest, db, params.required_capability, target)) {
			throw new Error(
				`${DEFINE_ACTION_TOOL}: required_capability '${params.required_capability}' has no matching ` +
					`capability_definitions row in the workspace${db ? " or live world" : ""}` +
					`${target ? ` or the active ${target.kind} target` : ""} — this verb does not auto-create the ` +
					"capability (use spellkave_define_capability first) — the offending param is " +
					"`required_capability`.",
			);
		}

		// #1968 workspace idempotency: clear the parent row + its tag satellite,
		// scoped to actionId, BEFORE pushing the new set.
		let rowsReplaced = clearRowsByKey(manifest, "action_definitions", "action_id", actionId);
		rowsReplaced += clearRowsByKey(manifest, "action_definition_tag", "action_id", actionId);

		const actionRow: Record<string, unknown> = {
			action_id: actionId,
			bundle_id: bundle,
			required_capability: params.required_capability,
			on_success: params.on_success,
			on_failure: params.on_failure ?? "",
			resolution_mode: params.resolution_mode ?? "Deterministic",
			...(params.resolution_predicate_source
				? { resolution_predicate_source: params.resolution_predicate_source }
				: {}),
			...(params.resolution_scope ? { resolution_scope: params.resolution_scope } : {}),
			...(params.non_steering ? { non_steering: true } : {}),
			display_name: resolveDisplayName(params.display_name, params.id),
			cost_time_ms: params.cost_time_ms ?? 0,
			session_def_id: params.session_def_id ?? "",
			resumable: params.resumable ?? false,
			reaction_eligibility: params.reaction_eligibility ?? null,
			reaction_window_ms: params.reaction_window_ms ?? null,
			reaction_trigger: params.reaction_trigger ?? null,
			self_eligible: params.self_eligible ?? false,
			self_only: params.self_only ?? false,
			spends_channel: params.spends_channel ?? null,
			...(params.description !== undefined ? { description: params.description } : {}),
		};
		rowArray(manifest, "action_definitions").push(actionRow);
		rowsAdded += 1;

		const tagGroup = tagRows("action_id", actionId, bundle, params.tags);
		rowArray(manifest, "action_definition_tag").push(...tagGroup);
		rowsAdded += tagGroup.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_ACTION_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "action_definitions", rows: [actionRow], param: "id", isArray: false },
					{ kind: "action_definition_tag", rows: tagGroup, param: "tags", isArray: true },
				]),
			{ action_id: actionId },
			// "fatal": kernel/substrate catalog content — see the file-header note.
			"fatal",
		);
	},
});

export const defineSessionToolDef = defineTool({
	contract: DEFINE_SESSION_TOOL,
	schema: DEFINE_SESSION_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "channel_ritual",
		round_duration_ms: 6000,
		termination_pred:
			"world.tick - session.stat('opened_at') >= session.stat('promoted_duration_ticks')",
		busy_break_pred: "target.has_tag('attack')",
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_SESSION_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_SESSION_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const sessionDefId = qualifyId(bundle, params.id);

		// #1968 workspace idempotency: replace the row wholesale (no satellite
		// tables exist for session_definitions).
		const rowsReplaced = clearRowsByKey(
			manifest,
			"session_definitions",
			"session_def_id",
			sessionDefId,
		);

		const sessionRow: Record<string, unknown> = {
			session_def_id: sessionDefId,
			bundle_id: bundle,
			participants_pred: params.participants_pred ?? "",
			busy_allow_pred: params.busy_allow_pred ?? null,
			busy_break_pred: params.busy_break_pred ?? null,
			initial_state: params.initial_state ?? "",
			legal_moves_csv: params.legal_moves_csv ?? "",
			turn_rule: params.turn_rule ?? "Sequential",
			visibility_policy: params.visibility_policy ?? "Public",
			termination_pred: params.termination_pred ?? "",
			on_terminate: params.on_terminate ?? "",
			stakes_required: params.stakes_required ?? "",
			winner_predicate: params.winner_predicate ?? "",
			turn_scheduler_id: params.turn_scheduler_id ?? "",
			round_duration_ms: params.round_duration_ms ?? 0,
			auto_join_on_targeting: params.auto_join_on_targeting ?? false,
			combat_grid_blueprint_id: params.combat_grid_blueprint_id ?? "",
			grid_edge_affordance_template_id: params.grid_edge_affordance_template_id ?? "",
			grid_edge_affordance_bindings_json: params.grid_edge_affordance_bindings_json ?? "",
			...(params.turn_eligibility_pred !== undefined
				? { turn_eligibility_pred: params.turn_eligibility_pred }
				: {}),
			...(params.description !== undefined ? { description: params.description } : {}),
		};
		rowArray(manifest, "session_definitions").push(sessionRow);
		rowsAdded += 1;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_SESSION_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "session_definitions", rows: [sessionRow], param: "id", isArray: false },
				]),
			{ session_def_id: sessionDefId },
			// "fatal": kernel/substrate catalog content — see the file-header note.
			"fatal",
		);
	},
});

export const defineActionVerbToolDef = defineTool({
	contract: DEFINE_ACTION_VERB_TOOL,
	schema: DEFINE_ACTION_VERB_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		id: "trap/plate/inspect",
		required_capability: "aoe_blast/trigger/plate",
		niche_id: "aoe_blast/trap/plate",
		display_name: "Inspect Pressure Plate",
		predicate_source: 'target.state("aoe_blast/plate_disarmed") == false',
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_ACTION_VERB_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_ACTION_VERB_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const db = currentDb(context);
		const target = resolveAuthorTarget(context.target);

		if (
			params.required_capability !== undefined &&
			params.required_capability !== "" &&
			!capabilityExists(manifest, db, params.required_capability, target)
		) {
			throw new Error(
				`${DEFINE_ACTION_VERB_TOOL}: required_capability '${params.required_capability}' has no matching ` +
					`capability_definitions row in the workspace${db ? " or live world" : ""}` +
					`${target ? ` or the active ${target.kind} target` : ""} — this verb does not auto-create the ` +
					"capability (use spellkave_define_capability first) — the offending param is " +
					"`required_capability`.",
			);
		}
		if (
			params.affordance_capability_id !== undefined &&
			params.affordance_capability_id !== "" &&
			!capabilityExists(manifest, db, params.affordance_capability_id, target)
		) {
			throw new Error(
				`${DEFINE_ACTION_VERB_TOOL}: affordance_capability_id '${params.affordance_capability_id}' has no ` +
					`matching capability_definitions row in the workspace${db ? " or live world" : ""}` +
					`${target ? ` or the active ${target.kind} target` : ""} — this verb does not auto-create the ` +
					"capability (use spellkave_define_capability first) — the offending param is " +
					"`affordance_capability_id`.",
			);
		}

		// sk-9ll.6: empty (or omitted) `required_capability` is the ungated-verb sentinel
		// (matches the schema's own empty-string default) — some fixture chains author
		// no capability_definitions row at all.
		const requiredCapability = params.required_capability ?? "";

		const actionId = qualifyId(bundle, params.id);
		const outcomeId = `${actionId}/${params.outcome_id_suffix ?? "outcome"}`;
		const affordanceId = `${actionId}/affordance`;
		const consequenceId = `${actionId}/${params.consequence_id_suffix ?? "success"}`;
		const displayName = resolveDisplayName(params.display_name, params.id);

		// sk-9ll.6: where a set spends_channel value is written — default 'both' (the
		// server reads it off BOTH rows for different purposes: r_manipulate's budget
		// gate off the affordance row, r_react/reaction_producer's off-turn metering
		// off the action row — see this param's own description for the exact call
		// sites).
		const spendsChannelPlacement = params.spends_channel_placement ?? "both";
		const spendsChannelOnAction =
			params.spends_channel !== undefined &&
			(spendsChannelPlacement === "action" || spendsChannelPlacement === "both");
		const spendsChannelOnAffordance =
			params.spends_channel !== undefined &&
			(spendsChannelPlacement === "affordance" || spendsChannelPlacement === "both");

		// #1968 workspace idempotency: clear every one of the four rows + their
		// satellites, scoped to THIS call's own derived ids, BEFORE pushing the
		// new set.
		let rowsReplaced = clearRowsByKey(manifest, "action_definitions", "action_id", actionId);
		rowsReplaced += clearRowsByKey(manifest, "action_definition_tag", "action_id", actionId);
		rowsReplaced += clearRowsByKey(manifest, "outcome_templates", "outcome_template_id", outcomeId);
		rowsReplaced += clearRowsByKey(manifest, "affordance_templates", "template_id", affordanceId);
		rowsReplaced += clearRowsByKey(manifest, "consequence_templates", "template_id", consequenceId);
		rowsReplaced += clearRowsByKey(
			manifest,
			"consequence_frame_writes",
			"template_id",
			consequenceId,
		);

		const actionRow: Record<string, unknown> = {
			action_id: actionId,
			bundle_id: bundle,
			required_capability: requiredCapability,
			on_success: consequenceId,
			on_failure: params.on_failure ?? "",
			resolution_mode: params.resolution_mode ?? "Deterministic",
			...(params.resolution_predicate_source
				? { resolution_predicate_source: params.resolution_predicate_source }
				: {}),
			...(params.resolution_scope ? { resolution_scope: params.resolution_scope } : {}),
			...(params.non_steering ? { non_steering: true } : {}),
			display_name: displayName,
			cost_time_ms: params.cost_time_ms ?? 0,
			session_def_id: params.session_def_id ?? "",
			reaction_eligibility: params.reaction_eligibility ?? null,
			reaction_window_ms: params.reaction_window_ms ?? null,
			reaction_trigger: params.reaction_trigger ?? null,
			self_eligible: params.self_eligible ?? false,
			self_only: params.self_only ?? false,
			spends_channel: spendsChannelOnAction ? params.spends_channel : null,
			...(params.description !== undefined ? { description: params.description } : {}),
		};
		rowArray(manifest, "action_definitions").push(actionRow);
		rowsAdded += 1;

		const tagGroup = tagRows("action_id", actionId, bundle, params.tags);
		rowArray(manifest, "action_definition_tag").push(...tagGroup);
		rowsAdded += tagGroup.length;

		const outcomeRow: Record<string, unknown> = {
			outcome_template_id: outcomeId,
			bundle_id: bundle,
			display_name: displayName,
			outcome_bool: true,
			manipulation_action_id: actionId,
			...(params.outcome_expression_source !== undefined
				? { outcome_expression_source: params.outcome_expression_source }
				: {}),
			...(params.communication_speech_act_id !== undefined
				? { communication_speech_act_id: params.communication_speech_act_id }
				: {}),
		};
		rowArray(manifest, "outcome_templates").push(outcomeRow);
		rowsAdded += 1;

		const gateOnAffordance = (params.predicate_source ?? "") !== "";
		const affordanceRow: Record<string, unknown> = {
			template_id: affordanceId,
			bundle_id: bundle,
			niche_id: params.niche_id,
			capability_id: params.affordance_capability_id ?? requiredCapability,
			display_name: displayName,
			...(gateOnAffordance
				? { predicate_source: params.predicate_source }
				: { predicate_bool: true }),
			outcome_template_id: outcomeId,
			range_m: params.range_m ?? 0,
			accepts_global_storm: params.accepts_global_storm ?? false,
			spends_channel: spendsChannelOnAffordance ? params.spends_channel : null,
			...(params.composes !== undefined ? { composes: params.composes } : {}),
		};
		rowArray(manifest, "affordance_templates").push(affordanceRow);
		rowsAdded += 1;
		if (typeof params.niche_id === "string") {
			rowsAdded += ensureCapabilityNicheDefinition(
				manifest,
				params.niche_id,
				bundle,
				"actor",
				"WA-CAP-002: capability:* niches require an explicit provider. " +
					"spellkave_define_action_verb does not auto-attach, so this synthetic niche is actor-carried.",
			);
		}

		const consequenceRow: Record<string, unknown> = {
			template_id: consequenceId,
			bundle_id: bundle,
			...(params.consequence?.effect_ref !== undefined
				? { effect_refs_csv: params.consequence.effect_ref }
				: {}),
			...(params.consequence?.description !== undefined
				? { description: params.consequence.description }
				: {}),
		};
		rowArray(manifest, "consequence_templates").push(consequenceRow);
		rowsAdded += 1;

		const frameWriteGroup = (params.consequence?.frame_writes ?? []).map((frameWrite, ordinal) => ({
			template_id: consequenceId,
			ordinal,
			frame_write: frameWrite,
		}));
		rowArray(manifest, "consequence_frame_writes").push(...frameWriteGroup);
		rowsAdded += frameWriteGroup.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_ACTION_VERB_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "action_definitions", rows: [actionRow], param: "id", isArray: false },
					{ kind: "action_definition_tag", rows: tagGroup, param: "tags", isArray: true },
					{ kind: "outcome_templates", rows: [outcomeRow], param: "id", isArray: false },
					{ kind: "affordance_templates", rows: [affordanceRow], param: "id", isArray: false },
					{ kind: "consequence_templates", rows: [consequenceRow], param: "id", isArray: false },
					{
						kind: "consequence_frame_writes",
						rows: frameWriteGroup,
						param: "frame_writes",
						isArray: true,
					},
				]),
			{
				action_id: actionId,
				outcome_template_id: outcomeId,
				template_id: affordanceId,
				consequence_template_id: consequenceId,
			},
			// "fatal": kernel/substrate catalog content — see the file-header note.
			"fatal",
		);
	},
});

// ---------------------------------------------------------------------------
// 11. spellkave_write_rows — the generic long-tail escape hatch (#1968 backlog:
// "fixtures become verb-call scripts"). Every row kind the other verbs don't
// (yet) cover — the dominant use case is kernel/substrate content (extent
// kinds, action-economy scheduling, capability/outcome/action satellites, ...)
// that has no narrative-authoring shape a spell/place/spawn verb was ever
// meant to fit.
// ---------------------------------------------------------------------------

/** Per-kind facts this verb derives from the schema, never hand-maintains. */
interface RowKindInfo {
	hasBundleId: boolean;
	hasDescription: boolean;
}

let cachedRowKinds: Map<string, RowKindInfo> | undefined;

interface ManifestSchemaShape {
	properties?: Record<string, { type?: string; items?: { $ref?: string } }>;
	definitions?: Record<string, { properties?: Record<string, unknown> }>;
}

/**
 * Schema-derived row-kind vocabulary for `spellkave_write_rows` — computed
 * from `describeManifestSchema()` (`spellkave_schema::manifest_json_schema()`
 * under the hood), never a hand-maintained list: a schema/kernel change ripples
 * into this verb's accepted `kind` set automatically. Every top-level
 * `Manifest` array field is a candidate EXCEPT `include`: its own schema
 * description says it is "processed and inlined by the manifest loader before
 * this struct sees the concatenated source" and "Server-side apply logic
 * ignores it" — writing one through this verb would silently no-op, which
 * this verb's design explicitly refuses to do (see `commitOrReport`'s
 * never-silently-drop ethos). Memoized: the schema is static per process.
 */
function manifestRowKinds(): Map<string, RowKindInfo> {
	if (cachedRowKinds !== undefined) return cachedRowKinds;
	const schema = describeManifestSchema() as ManifestSchemaShape;
	const kinds = new Map<string, RowKindInfo>();
	for (const [key, value] of Object.entries(schema.properties ?? {})) {
		if (key === "include") continue;
		if (value.type !== "array") continue;
		const ref = value.items?.$ref;
		const defName = ref?.replace("#/definitions/", "");
		const defProps = (defName ? schema.definitions?.[defName]?.properties : undefined) ?? {};
		kinds.set(key, {
			hasBundleId: "bundle_id" in defProps,
			hasDescription: "description" in defProps,
		});
	}
	cachedRowKinds = kinds;
	return kinds;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Map a validator diagnostic back to `rows[i]` (+ `.field` when determinable),
 * generically over ANY row kind. `crates/spellkave-validate` paths come in two
 * shapes: `"<kind>[<natural-key-value>]"` / `"<kind>[<key>].<field>"` (a
 * row-keyed check, e.g. `economy_channel_definitions[{id}]`) or the flatter
 * `"<kind>.<field>"` (a whole-array check, e.g. `entity_tag.entity_key` —
 * every offending row's identifying value lands in the MESSAGE instead, not
 * the path). This scans both the bracketed key text (when present) and the
 * message for each row's DISTINCTIVE field values — values not shared by any
 * OTHER row in this same call — so a field every row shares (a common
 * `bundle_id`, a repeated `tag`) can never cause a false match the way a
 * plain first-match substring scan would. Returns `undefined` when the path
 * doesn't belong to this kind, or no row's distinctive values appear anywhere
 * — "where determinable" is a real boundary, not every diagnostic maps.
 */
function mapWriteRowsParam(
	diagnostic: Diagnostic,
	kind: string,
	rows: Record<string, unknown>[],
): string | undefined {
	if (
		diagnostic.path !== kind &&
		!diagnostic.path.startsWith(`${kind}[`) &&
		!diagnostic.path.startsWith(`${kind}.`)
	) {
		return undefined;
	}
	const bracketed = diagnostic.path.match(
		new RegExp(`^${escapeRegExp(kind)}\\[([^\\]]*)\\](?:\\.(.+))?$`),
	);
	const field =
		bracketed?.[2] ??
		(diagnostic.path.startsWith(`${kind}.`) ? diagnostic.path.slice(kind.length + 1) : undefined);
	const haystacks = [bracketed?.[1], diagnostic.message].filter(
		(h): h is string => h !== undefined,
	);
	if (haystacks.length === 0) return undefined;

	const rowValues = rows.map((row) =>
		Object.values(row ?? {})
			.map((v) => String(v))
			.filter((v) => v.length > 0),
	);
	const valueCounts = new Map<string, number>();
	for (const values of rowValues) {
		for (const v of values) valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
	}

	for (let i = 0; i < rows.length; i++) {
		const distinctive = rowValues[i]?.filter((v) => valueCounts.get(v) === 1) ?? [];
		if (distinctive.some((v) => haystacks.some((h) => h.includes(v)))) {
			return field !== undefined ? `rows[${i}].${field}` : `rows[${i}]`;
		}
	}
	return undefined;
}

/**
 * #1968 combat-sim finding A2: `spellkave_define_behavior` auto-generates a
 * `spatial_niche_attachments` row binding its `capability:<cap>` niche to
 * `grant_to`'s own node (`clusterRows`, compose.ts) — `spellkave_write_rows`
 * does NOT, and deliberately shouldn't: it is the generic escape hatch for
 * ANY row kind, with no `grant_to`/caster-node concept to auto-attach
 * against. Every death-save roll in the combat-sim discovery pass failed
 * silently with the SAME generic r_manipulate hint (#1968 finding B1) until
 * one was hand-authored. Rather than auto-magic a niche attachment this verb
 * has no principled node to pick, surface a non-blocking WARNING naming the
 * unattached niche, so the SAME silent-failure trap is caught at author time
 * instead of discovered mid-fight.
 */
const WRITE_ROWS_NICHE_ATTACHMENT_KINDS: ReadonlySet<string> = new Set([
	"action_definitions",
	"affordance_templates",
]);

/** WA-CAP-002: capability:* niches require an explicit provider. Folding verbs that
 * author a `capability:<id>` affordance also author this row so closed-world
 * calls do not fatal. `write_rows` does NOT — that escape hatch must name provider. */
function ensureCapabilityNicheDefinition(
	manifest: Record<string, unknown>,
	nicheId: string,
	bundle: string,
	provider: "actor" | "place" | "entity",
	description: string,
): number {
	if (!nicheId.startsWith("capability:")) return 0;
	const rows = rowArray(manifest, "niche_definitions");
	const existing = rows.find((row) => row.niche_id === nicheId);
	if (existing !== undefined) {
		const current = typeof existing.provider === "string" ? existing.provider.trim() : "";
		if (current === "") existing.provider = provider;
		return 0;
	}
	rows.push({
		niche_id: nicheId,
		bundle_id: bundle,
		display_name: nicheId,
		description,
		predicate_source: "",
		provider,
	});
	return 1;
}

/** The `capability:<id>` niche this write_rows row would need attached, per `clusterRows`'s own `capability:${cap}` derivation — `affordance_templates` carries `niche_id` directly; `action_definitions` has no direct niche column, so the niche is derived from `required_capability` (the SAME convention every `spellkave_define_behavior`-authored niche uses). */
function writeRowsNicheId(kind: string, row: Record<string, unknown>): string | undefined {
	if (kind === "affordance_templates") {
		return typeof row.niche_id === "string" && row.niche_id.length > 0 ? row.niche_id : undefined;
	}
	if (kind === "action_definitions") {
		return typeof row.required_capability === "string" && row.required_capability.length > 0
			? `capability:${row.required_capability}`
			: undefined;
	}
	return undefined;
}

/**
 * Non-blocking A2 warning text: which of this call's `action_definitions`/
 * `affordance_templates` rows author a niche with NO `spatial_niche_attachments`
 * row anywhere in (workspace ∪ target) — never `undefined`/`empty` niche
 * columns (those are separate `MF-VAL-nnn` validator diagnostics, unrelated
 * to this check). Checked against the manifest AFTER this call's own rows are
 * merged, so a row authored earlier in the SAME call (or an already-committed
 * workspace row) counts as covering a later row's niche.
 */
function missingNicheAttachmentWarnings(
	manifest: Record<string, unknown>,
	target: AuthorTarget | undefined,
	kind: string,
	rows: Record<string, unknown>[],
): string[] {
	if (!WRITE_ROWS_NICHE_ATTACHMENT_KINDS.has(kind)) return [];
	const nicheIds = [
		...new Set(
			rows.map((row) => writeRowsNicheId(kind, row)).filter((n): n is string => n !== undefined),
		),
	];
	if (nicheIds.length === 0) return [];
	const attached = new Set<string>();
	for (const row of stringRows(manifest, "spatial_niche_attachments")) {
		if (typeof row.niche_id === "string") attached.add(row.niche_id);
	}
	if (target !== undefined) {
		for (const row of target.lookup("spatial_niche_attachments")) {
			if (typeof row.niche_id === "string") attached.add(row.niche_id);
		}
	}
	return nicheIds
		.filter((n) => !attached.has(n))
		.map(
			(n) =>
				`WARNING (#1968 A2): niche '${n}' authored via ${WRITE_ROWS_TOOL} (kind '${kind}') has no ` +
				"spatial_niche_attachments row in the workspace or target — r_manipulate will never select this " +
				"row on any actor's node until one is authored (spellkave_define_behavior grants this " +
				"automatically; spellkave_write_rows does not, by design — it has no caster node to attach " +
				"against). Author one via spellkave_write_rows (kind: 'spatial_niche_attachments') before relying " +
				`on this ${kind === "action_definitions" ? "action" : "affordance"} — see "` +
				'spellkave_write_rows and spatial niche attachments" in getting-started-with-verbs.md.',
		);
}

export interface WriteRowsExtra {
	kind: string;
	/** Schema-derived: does this kind's row shape carry a first-class `description` column? */
	description_per_row_allowed: boolean;
	/**
	 * #1968 finding A2: non-blocking hints naming an `action_definitions`/
	 * `affordance_templates` row this call authored whose niche has no
	 * `spatial_niche_attachments` row anywhere in (workspace ∪ target) —
	 * present only when at least one such gap exists.
	 */
	attachment_warnings?: string[];
	[extra: string]: unknown;
}

/**
 * The root parameter schema is one flat object so OpenAI-backed hosts accept
 * the tool (sk-jay0.7.90), so the per-target `value` shapes that the union
 * once enforced statically are checked here instead. `SET_METADATA_UPDATE`
 * stays the single authority on a valid update.
 */
function assertMetadataUpdate(update: unknown, where: string): void {
	if (Check(SET_METADATA_UPDATE, update)) return;
	const issues = [...Errors(SET_METADATA_UPDATE, update)]
		.map((issue) => `${"path" in issue && issue.path ? issue.path : "/"}: ${issue.message}`)
		.slice(0, 3);
	const target = (update as { target?: unknown }).target;
	const expectation =
		target === "manifest"
			? "target 'manifest' takes a string key and any JSON-compatible value"
			: target === "namespace"
				? "target 'namespace' takes a string key and a value of {audience, description?, on_demand?}"
				: typeof target === "object" && target !== null
					? "an attachment target {kind, ref} takes a string key, an object value, and optional source/audience/description"
					: "target must be 'manifest', 'namespace', or {kind, ref}";
	throw new Error(
		`${SET_METADATA_TOOL}: invalid metadata update at ${where} — ${expectation}` +
			`${issues.length === 0 ? "" : ` (${issues.join("; ")})`}.`,
	);
}

/**
 * Set open metadata without making metadata a kernel-owned vocabulary. Root
 * writes replace only the named top-level keys; attachment identity mirrors
 * live admission: (target_kind, target_ref, namespace, bundle_id), with
 * source and payload mutable on a re-set.
 */
function metadataUpdates(params: Static<typeof SET_METADATA_PARAMS>): SetMetadataUpdate[] {
	const hasBatch = Object.hasOwn(params, "updates");
	const hasSingletonField =
		Object.hasOwn(params, "target") ||
		Object.hasOwn(params, "key") ||
		Object.hasOwn(params, "value");
	if (hasBatch && hasSingletonField)
		throw new Error(
			`${SET_METADATA_TOOL}: pass either one target/key/value update or updates[], not both.`,
		);
	if (!hasBatch && !hasSingletonField)
		throw new Error(
			`${SET_METADATA_TOOL}: pass target, key, and value, or a non-empty updates[] batch.`,
		);
	if (hasBatch) {
		const batch = (params as { updates: unknown }).updates;
		if (!Array.isArray(batch) || batch.length === 0)
			throw new Error(`${SET_METADATA_TOOL}: updates[] must be a non-empty array of updates.`);
		batch.forEach((update, index) => {
			assertMetadataUpdate(update, `updates[${index}]`);
		});
		return batch as SetMetadataUpdate[];
	}
	const { bundle: _bundle, ...singleton } = params as Record<string, unknown>;
	assertMetadataUpdate(singleton, "target/key/value");
	return [params] as SetMetadataUpdate[];
}

function resolvedNamespaceRows(
	manifest: Record<string, unknown>,
	authorTarget: AuthorTarget | undefined,
	namespace: string,
): Record<string, unknown>[] {
	const workspaceRows = stringRows(manifest, "metadata_namespaces").filter(
		(row) => row.namespace === namespace,
	);
	const workspaceOwnerCounts = new Map<string, number>();
	for (const row of workspaceRows) {
		if (typeof row.bundle_id === "string")
			workspaceOwnerCounts.set(row.bundle_id, (workspaceOwnerCounts.get(row.bundle_id) ?? 0) + 1);
	}
	if ([...workspaceOwnerCounts.values()].some((count) => count > 1))
		throw new Error(
			`${SET_METADATA_TOOL}: ambiguous metadata namespace '${namespace}' in the workspace.`,
		);
	const byOwner = new Map<string, Record<string, unknown>>();
	for (const row of authorTarget?.lookup("metadata_namespaces") ?? []) {
		if (typeof row.bundle_id === "string" && row.namespace === namespace)
			byOwner.set(row.bundle_id, row);
	}
	for (const row of workspaceRows) {
		if (typeof row.bundle_id === "string") byOwner.set(row.bundle_id, row);
	}
	return [...byOwner.values()];
}

export const setMetadataToolDef = defineTool({
	contract: SET_METADATA_TOOL,
	schema: SET_METADATA_PARAMS,
	exampleParams: {
		target: "manifest",
		key: "editor",
		value: { summary: "A private authoring note." },
	},
	run: async (context: AuthorToolContext, params: Static<typeof SET_METADATA_PARAMS>) => {
		const manifest = requireManifest(context);
		const updates = metadataUpdates(params);
		const rootKeys = new Set<string>();
		const namespaceRegistrations = new Set<string>();
		for (const update of updates) {
			if (update.target === "manifest") {
				if (rootKeys.has(update.key))
					throw new Error(
						`${SET_METADATA_TOOL}: updates contains root metadata key '${update.key}' more than once.`,
					);
				rootKeys.add(update.key);
			} else if (
				update.target === "namespace" ||
				(typeof update.target === "object" && update.audience !== undefined)
			) {
				if (namespaceRegistrations.has(update.key))
					throw new Error(
						`${SET_METADATA_TOOL}: updates contains namespace '${update.key}' more than once.`,
					);
				namespaceRegistrations.add(update.key);
			}
		}
		const needsBundle = updates.some((update) => update.target !== "manifest");
		const bundle = needsBundle
			? resolveBundle(context, params.bundle, SET_METADATA_TOOL)
			: undefined;
		const authorTarget = resolveAuthorTarget(context.target);
		let rowsAdded = 0;
		let rowsReplaced = 0;
		if (bundle !== undefined) rowsAdded += ensureBundleScaffold(manifest, bundle);
		const inputIds = new Set<string>();
		for (const [updateIndex, update] of updates.entries()) {
			if (update.target === "manifest") {
				assertJsonSafeMetadata(update.value, `updates[${updateIndex}].value`);
				const current = manifest.metadata;
				if (
					current !== undefined &&
					(current === null || typeof current !== "object" || Array.isArray(current))
				)
					throw new Error(`${SET_METADATA_TOOL}: existing manifest metadata must be an object.`);
				manifest.metadata = {
					...(current as Record<string, unknown> | undefined),
					[update.key]: update.value,
				};
				continue;
			}
			if (bundle === undefined)
				throw new Error(`${SET_METADATA_TOOL}: bundle is required for this update.`);
			if (update.target === "namespace") {
				const namespaceRows = resolvedNamespaceRows(manifest, authorTarget, update.key);
				const foreignOwner = namespaceRows.find((row) => row.bundle_id !== bundle);
				if (foreignOwner !== undefined)
					throw new Error(
						`${SET_METADATA_TOOL}: namespace '${update.key}' is already owned by bundle ` +
							`'${String(foreignOwner.bundle_id)}'; do not re-register a foreign namespace.`,
					);
				const result = setNamespaceRow(
					manifest,
					bundle,
					update.key,
					update.value.audience,
					update.value.description,
					update.value.on_demand,
				);
				rowsAdded += result.added;
				rowsReplaced += result.replaced;
				continue;
			}

			const identity = JSON.stringify([update.target.kind, update.target.ref, update.key, bundle]);
			if (inputIds.has(identity))
				throw new Error(
					`${SET_METADATA_TOOL}: updates contains the same live identity more than once ` +
						`(${update.target.kind}:${update.target.ref}:${update.key}:${bundle}).`,
				);
			inputIds.add(identity);
			assertJsonSafeMetadata(update.value, `updates[${updateIndex}].value`);
			if (update.description !== undefined && update.audience === undefined)
				throw new Error(
					`${SET_METADATA_TOOL}: attachment description requires audience so the namespace registration is explicit.`,
				);
			const namespaceRows = resolvedNamespaceRows(manifest, authorTarget, update.key);
			if (namespaceRows.length > 1)
				throw new Error(
					`${SET_METADATA_TOOL}: ambiguous metadata namespace '${update.key}' in bundle '${bundle}'.`,
				);
			if (update.audience !== undefined && namespaceRows.length === 0) {
				const namespaceResult = setNamespaceRow(
					manifest,
					bundle,
					update.key,
					update.audience,
					update.description,
				);
				rowsAdded += namespaceResult.added;
				rowsReplaced += namespaceResult.replaced;
			} else if (namespaceRows.length !== 1) {
				throw new Error(
					`${SET_METADATA_TOOL}: attachment namespace '${update.key}' is not registered for bundle '${bundle}'; ` +
						"supply audience to register it in this call.",
				);
			} else if (update.audience !== undefined && namespaceRows[0]?.bundle_id !== bundle) {
				throw new Error(
					`${SET_METADATA_TOOL}: namespace '${update.key}' is owned by bundle '${String(namespaceRows[0]?.bundle_id)}'; ` +
						"do not re-register a foreign namespace.",
				);
			} else if (update.audience !== undefined && namespaceRows[0]?.audience !== update.audience) {
				throw new Error(
					`${SET_METADATA_TOOL}: namespace '${update.key}' is already registered with a different audience; ` +
						"use target 'namespace' to update an owned registration explicitly.",
				);
			}
			let payloadJson: string;
			try {
				payloadJson = JSON.stringify(update.value);
			} catch {
				throw new Error(`${SET_METADATA_TOOL}: attachment value must be JSON-serializable.`);
			}
			const row = {
				bundle_id: bundle,
				namespace: update.key,
				target_kind: update.target.kind,
				target_ref: update.target.ref,
				source: update.source ?? "manifest",
				payload_json: payloadJson,
			};
			const rowIdentity = metadataAttachmentIdentity(row) as string;
			const rows = rowArray(manifest, "metadata_attachments");
			const matching = rows.filter(
				(candidate) => metadataAttachmentIdentity(candidate) === rowIdentity,
			);
			if (matching.length > 1)
				throw new Error(
					`${SET_METADATA_TOOL}: ambiguous metadata attachment '${update.target.kind}:${update.target.ref}:${update.key}' ` +
						`in bundle '${bundle}' — repair duplicate rows before setting it.`,
				);
			if (matching.length === 0) {
				rows.push(row);
				rowsAdded += 1;
			} else {
				rows[rows.indexOf(matching[0] as Record<string, unknown>)] = row;
				rowsReplaced += 1;
			}
		}
		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			SET_METADATA_TOOL,
			(d) => (d.path.startsWith("metadata") ? "updates" : undefined),
			{ updates: updates.length },
			"fatal",
		);
	},
});

export const writeRowsToolDef = defineTool({
	contract: WRITE_ROWS_TOOL,
	schema: WRITE_ROWS_PARAMS,
	exampleParams: {
		bundle: "aoe_blast",
		kind: "capability_definition_tag",
		rows: [
			{
				capability_id: "aoe_blast/trigger/plate",
				tag: "hazard",
				bundle_id: "aoe_blast",
				source: "manifest",
			},
		],
	},
	run: async (context: AuthorToolContext, params: Static<typeof WRITE_ROWS_PARAMS>) => {
		const rowKinds = manifestRowKinds();
		const kindInfo = rowKinds.get(params.kind);
		if (kindInfo === undefined) {
			const known = [...rowKinds.keys()].sort().join(", ");
			throw new Error(
				`${WRITE_ROWS_TOOL}: unsupported kind '${params.kind}' — must be one of the schema-derived Manifest ` +
					`row kinds: ${known}. The offending param is \`kind\`.`,
			);
		}
		if (params.rows.length === 0) {
			throw new Error(`${WRITE_ROWS_TOOL}: \`rows\` must include at least one row.`);
		}

		const bundle = resolveBundle(context, params.bundle, WRITE_ROWS_TOOL);
		const manifest = requireManifest(context);
		// `kind === "bundles"`: the caller IS authoring the `[[bundles]]` header
		// itself (e.g. a foundational bundle like `core`, whose `depends_on` must
		// be `[]` — `ensureBundleScaffold`'s generic scaffold always sets
		// `depends_on: ["core"]`, which is wrong for `core` itself and would
		// double-insert a conflicting header before this call's own row lands).
		// Skip the auto-scaffold in exactly this one case; every other kind keeps
		// the same self-scaffolding behavior every other write verb has.
		// `spellkave_define_bundle` (11a, below) is the DELIBERATE first-class
		// path for exactly this case (srd-cc executable finding #8,
		// `packages/spellkave-srd-cc/ledger/findings.md`) — this raw-row
		// escape hatch remains available for direct `[[bundles]]` row access
		// (e.g. a caller already assembling a full row object generically).
		let rowsAdded = params.kind === "bundles" ? 0 : ensureBundleScaffold(manifest, bundle);
		let rowsReplaced = 0;
		const naturalKeyField = ROW_KIND_NATURAL_KEY[params.kind];
		// sk-jay0.7.174.30: ADR-0146 gave every one of these satellite/junction
		// kinds (`*_tag`, `entity_definition_initial_*`,
		// `spatial_niche_attachments`, `actor_capabilities`, `object_state`, …)
		// a real server-side upsert on `ROW_KIND_STORAGE_KEY`'s composite key —
		// this verb no longer needs to keep them append-only just because they
		// have no SINGLE natural-key column. Only consulted when there is no
		// natural key (a kind never has both), so this can never race
		// `naturalKeyField` above. `consequence_frame_writes` stays append-only
		// here: it is the Class-β `SET_LEVEL_FIELD` (design.md D3) whose
		// identity is the WHOLE ordered list per template, not a per-row
		// composite key, so it is deliberately absent from
		// `ROW_KIND_STORAGE_KEY` — see `row_identity.rs`'s own doc comment.
		const storageKeyFields =
			naturalKeyField === undefined ? ROW_KIND_STORAGE_KEY[params.kind] : undefined;
		const rows = params.rows as Record<string, unknown>[];
		for (const row of rows) {
			const finalRow: Record<string, unknown> =
				kindInfo.hasBundleId && row.bundle_id === undefined
					? { ...row, bundle_id: bundle }
					: { ...row };
			// #1968 workspace idempotency: upsert by natural key where this kind has
			// one — `rowArray` is re-fetched fresh (not a captured reference) since
			// `clearRowsByKey` may replace `manifest[kind]` with a new filtered array.
			if (naturalKeyField !== undefined) {
				rowsReplaced += clearRowsByKey(
					manifest,
					params.kind,
					naturalKeyField,
					finalRow[naturalKeyField],
				);
			} else if (storageKeyFields !== undefined) {
				rowsReplaced += clearRowsByCompositeKey(manifest, params.kind, storageKeyFields, finalRow);
			}
			rowArray(manifest, params.kind).push(finalRow);
			rowsAdded += 1;
		}

		// #1968 finding A2: computed AFTER this call's rows are merged into
		// `manifest` (so an earlier row in the SAME call, or an already-committed
		// workspace row, counts as covering a later row's niche) but BEFORE
		// `commitOrReport` — a validation-rejected call returns before this
		// point ever matters, matching every other non-blocking-warning path in
		// this file (surfaced only alongside a successful commit).
		const authorTarget = resolveAuthorTarget(context.target);
		const attachmentWarnings = missingNicheAttachmentWarnings(
			manifest,
			authorTarget,
			params.kind,
			rows,
		);

		const extra: WriteRowsExtra = {
			kind: params.kind,
			description_per_row_allowed: kindInfo.hasDescription,
			...(attachmentWarnings.length > 0 ? { attachment_warnings: attachmentWarnings } : {}),
		};
		const result = commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			WRITE_ROWS_TOOL,
			(d) => mapWriteRowsParam(d, params.kind, rows),
			extra,
			// "fatal": write_rows reproduces EXISTING kernel/substrate content, which
			// may already carry accepted, informational warnings (see commitOrReport's
			// doc comment) — matching the REAL r_apply_world_manifest admission
			// boundary rather than the narrower verbs' stricter new-content bar.
			"fatal",
		);
		// Only a SUCCESSFUL commit gets the warning appended to the visible text —
		// a rejected call already explains itself via `commitOrReport`'s own
		// diagnostics, and `attachment_warnings` living only in `details` there
		// would be silently invisible to an agent that reads `content` as prose.
		if ((result.details as VerbResult).ok && attachmentWarnings.length > 0) {
			result.content.push({ type: "text", text: attachmentWarnings.join("\n") });
		}
		return result;
	},
});

export const defineBundleToolDef = defineTool({
	contract: DEFINE_BUNDLE_TOOL,
	schema: DEFINE_BUNDLE_PARAMS,
	exampleParams: {
		bundle_id: "srd",
		display_name: "spellkave-srd-probe",
		author: "spellkave",
		version: "0.1.0",
		depends_on: ["core"],
		description: "SRD 5.2 conformance probe content bundle.",
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_BUNDLE_PARAMS>) => {
		// `depends_on` is required at the TypeBox schema level (not `Type.
		// Optional`), but this registry's `execute`/`run` boundary (`tool-
		// registry.ts`) never enforces the JSON Schema at runtime — a caller
		// that bypasses TypeBox (a raw script, or an agent skipping its own
		// schema) could still pass `undefined`. `BundleRow.depends_on` carries
		// `#[serde(default)]` schema-side, so an unchecked `undefined` would
		// silently render as `[]` instead of failing loudly — defeating the
		// entire point of this verb (deliberateness over the auto-scaffold's
		// silent default). Guard explicitly, mirroring `defineBehaviorToolDef`'s
		// `action_class` guard for the same reason.
		if (params.depends_on === undefined) {
			throw new Error(
				`${DEFINE_BUNDLE_TOOL}: \`depends_on\` is required — pass [] for a foundational bundle with no ` +
					"dependency, or the real dependency list otherwise. The offending param is `depends_on`.",
			);
		}
		const manifest = requireManifest(context);
		// No `ensureBundleScaffold` call — this verb IS the deliberate header
		// author, mirroring `writeRowsToolDef`'s own `kind === "bundles"` skip.
		const rowsReplaced = clearRowsByKey(manifest, "bundles", "bundle_id", params.bundle_id);
		const bundleRow: Record<string, unknown> = {
			bundle_id: params.bundle_id,
			display_name: resolveDisplayName(params.display_name, params.bundle_id),
			author: params.author ?? "spellkave-verb-tools",
			version: params.version ?? "1.0.0",
			depends_on: params.depends_on,
			...(params.description !== undefined ? { description: params.description } : {}),
			...(params.default_extent_shape_id !== undefined
				? { default_extent_shape_id: params.default_extent_shape_id }
				: {}),
			...(params.default_extent_params_json !== undefined
				? { default_extent_params_json: params.default_extent_params_json }
				: {}),
		};
		rowArray(manifest, "bundles").push(bundleRow);

		return commitOrReport(
			context,
			manifest,
			1,
			rowsReplaced,
			DEFINE_BUNDLE_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{ kind: "bundles", rows: [bundleRow], param: "bundle_id", isArray: false },
				]),
			{ bundle_id: params.bundle_id },
			// "fatal": this verb generates the SAME kernel/substrate vocabulary
			// (the bundle header) the write_rows escape hatch it replaces already
			// authors under blockOn: "fatal" — matching the REAL
			// r_apply_world_manifest admission boundary rather than the narrower
			// content verbs' stricter new-content bar.
			"fatal",
		);
	},
});

export const defineTraceKindToolDef = defineTool({
	contract: DEFINE_TRACE_KIND_TOOL,
	schema: DEFINE_TRACE_KIND_PARAMS,
	exampleParams: {
		bundle: "kavemouth",
		id: "adventure/trace/slime_trail",
		description: "A glistening trail of translucent slime, still faintly wet.",
		places: [{ node: "kavemouth/tomb/entrance" }],
	},
	run: async (context: AuthorToolContext, params: Static<typeof DEFINE_TRACE_KIND_PARAMS>) => {
		const bundle = resolveBundle(context, params.bundle, DEFINE_TRACE_KIND_TOOL);
		const manifest = requireManifest(context);
		let rowsAdded = ensureBundleScaffold(manifest, bundle);
		const kindId = qualifyId(bundle, params.id);

		// #1968 workspace idempotency: clear the parent row + every satellite,
		// scoped to kindId, BEFORE pushing the new set.
		let rowsReplaced = clearRowsByKey(manifest, "trace_kind_definitions", "kind_id", kindId);
		rowsReplaced += clearRowsByKey(manifest, "place_node_traces", "trace_kind_id", kindId);

		const traceKindRow: Record<string, unknown> = {
			kind_id: kindId,
			bundle_id: bundle,
			location_kinds: params.location_kinds ?? "place_node",
			description: params.description ?? "",
			schema_json: params.schema_json ?? "",
			...(params.perceptible_for_ticks !== undefined
				? { perceptible_for_ticks: params.perceptible_for_ticks }
				: {}),
		};
		rowArray(manifest, "trace_kind_definitions").push(traceKindRow);
		rowsAdded += 1;

		const placeRows = (params.places ?? []).map((place) => ({
			node_id: place.node,
			trace_kind_id: kindId,
		}));
		rowArray(manifest, "place_node_traces").push(...placeRows);
		rowsAdded += placeRows.length;

		return commitOrReport(
			context,
			manifest,
			rowsAdded,
			rowsReplaced,
			DEFINE_TRACE_KIND_TOOL,
			(d) =>
				mapFoldedVerbParam(d, [
					{
						kind: "trace_kind_definitions",
						rows: [traceKindRow],
						param: "id",
						isArray: false,
					},
					{ kind: "place_node_traces", rows: placeRows, param: "places", isArray: true },
				]),
			{ kind_id: kindId },
			"fatal",
		);
	},
});

export {
	ANNOTATE_PLACE_TOOL,
	APPLY_MANIFEST_DELTA_TOOL,
	ATTACH_MAP_LAYER_TOOL,
	AUTHOR_PLACE_TOOL,
	BIND_ACTOR_TOOL,
	BIND_EDGE_AFFORDANCE_TOOL,
	DECLARE_INEXPRESSIBLE_TOOL,
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
	DIFF_MANIFEST_TOOL,
	DOCS_TOOL,
	EQUIP_ITEM_TOOL,
	EVAL_TOOL,
	EXPORT_MANIFEST_TOOL,
	LINK_PLACES_TOOL,
	MAP_GRAPH_TOOL,
	NOTE_DOC_GAP_TOOL,
	PLACE_ACTOR_TOOL,
	PLACE_ENTITY_TOOL,
	QUERY_TOOL,
	SET_METADATA_TOOL,
	SET_MOVEMENT_DEFAULT_TOOL,
	STOW_ITEM_TOOL,
	TAG_ENTITY_TOOL,
	WRITE_ROWS_TOOL,
} from "@spellkave/tool-contracts/schemas";
