// Author-time manifest lint (#836 Part C).
//
// Reasons over a PARSED manifest at AUTHOR time and emits NON-FATAL warnings for
// the duplication / binding smells the validator does not flag. It is the
// author-time companion to the runtime spell-identity binding checks #835 landed
// (MF-VAL-264/265 in `spellkave-validate`) and to `emitSpell`'s
// `assertSpellCatalogBinding` — surfacing the same drift across a whole merged
// bundle, plus the render-discipline smells (twin actions, repeated tag sets,
// delimiter drift) that have no validator rule.
//
// DELIBERATELY DISTINCT from two neighbours, do not conflate them:
//   - `manifest validate` reasons over a manifest but FATALS (exit 2) on broken
//     refs. Lint is advisory: every finding is a `warning`, the run never fails.
//   - `just doctor` (ADR-0002) reasons over a LIVE world via the DoctorCheck
//     registry. Lint never touches a running node — it reads rows only.
//
// Pure, fs-free (this package ships only `src/`): the caller supplies the parsed
// manifest object (`inspectManifest(...).manifest`), so the fs-having CLI owns
// file reads and `--bundle` include-merging, same split as `routeDamage`/`emitSpell`.

import { type RefTagFamily, resolveRefTagValueOutcome } from "./ref-tags";
import { bundleScope, resolveTagPrefixFamily, visibleRefTagFamilies } from "./tag-prefix-families";

const SPELL_CATALOG_PREFIX = "srd/spell/";

export type LintRule =
	| "twin-action"
	| "dangling-required-capability"
	| "orphan-spell-capability"
	| "spell-delimiter-drift"
	| "tag-repetition"
	| "dead-target-capability"
	| "dangling-ref-tag"
	| "ambiguous-ref-tag"
	| "duplicate-exit-label";

export interface LintFinding {
	rule: LintRule;
	severity: "warning";
	/** The row id the finding is about (action_id / capability_id / entity_def_id). */
	id: string;
	/** Owning bundle of the subject row, when authored. Never inferred from its id. */
	bundleId?: string;
	message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Read a manifest row table as records, tolerating absent / malformed tables. */
function rows(manifest: Record<string, unknown>, kind: string): Record<string, unknown>[] {
	const table = manifest[kind];
	return Array.isArray(table) ? table.filter(isRecord) : [];
}

function str(row: Record<string, unknown>, key: string): string | undefined {
	const value = row[key];
	return typeof value === "string" ? value : undefined;
}

/** The tag multiset under one carrier id, as a stable sorted key (order-insensitive). */
function tagKey(
	tagRows: Record<string, unknown>[],
	idKey: string,
	idValue: string,
): string | undefined {
	const tags = tagRows
		.filter((r) => str(r, idKey) === idValue)
		.map((r) => str(r, "tag"))
		.filter((t): t is string => typeof t === "string");
	if (tags.length === 0) return undefined;
	return [...tags].sort().join(" ");
}

// R1 — twin action_definitions: two (or more) rows byte-identical except `action_id`.
// The #836 evidence #2 (`cast_X` ↔ `cast_X/affordance` ~50% of spell actions), but
// detected generally: any actions that canonicalize to the same row sans id are a
// copy-paste twin whose differing field should be the only thing authored.
function lintTwinActions(manifest: Record<string, unknown>): LintFinding[] {
	const byCanonical = new Map<string, string[]>();
	const owners = new Map<string, string | undefined>();
	for (const row of rows(manifest, "action_definitions")) {
		const id = str(row, "action_id");
		if (!id) continue;
		owners.set(id, str(row, "bundle_id"));
		const { action_id: _omit, ...rest } = row;
		const canonical = JSON.stringify(
			Object.fromEntries(Object.entries(rest).sort(([a], [b]) => a.localeCompare(b))),
		);
		const ids = byCanonical.get(canonical) ?? [];
		ids.push(id);
		byCanonical.set(canonical, ids);
	}
	const findings: LintFinding[] = [];
	for (const ids of byCanonical.values()) {
		if (ids.length < 2) continue;
		const sorted = [...ids].sort();
		// Report the twin on each redundant sibling (all but the first), naming the kept one.
		const [keep, ...twins] = sorted;
		for (const twin of twins) {
			findings.push({
				rule: "twin-action",
				severity: "warning",
				id: twin,
				bundleId: owners.get(twin),
				message: `action_definition '${twin}' is byte-identical to '${keep}' except its id — a copy-paste twin; emit one canonical action (let the primitive render it).`,
			});
		}
	}
	return findings;
}

// R2 — a required_capability with no capability_definition (author-time MF-VAL-265).
function lintDanglingRequiredCapability(manifest: Record<string, unknown>): LintFinding[] {
	const known = new Set(
		rows(manifest, "capability_definitions")
			.map((r) => str(r, "capability_id"))
			.filter((id): id is string => typeof id === "string"),
	);
	const findings: LintFinding[] = [];
	for (const row of rows(manifest, "action_definitions")) {
		const id = str(row, "action_id");
		const req = str(row, "required_capability");
		if (!id || !req || known.has(req)) continue;
		findings.push({
			rule: "dangling-required-capability",
			severity: "warning",
			id,
			bundleId: str(row, "bundle_id"),
			message: `action '${id}' requires capability '${req}' with no capability_definition in the bundle (runtime MF-VAL-265). Author the capability or fix the ref.`,
		});
	}
	return findings;
}

// R3 — a srd/spell/* capability with no matching catalog entity_definition of the
// same id (author-time MF-VAL-264 / the `assertSpellCatalogBinding` smell). Non-
// srd/spell ids (synthetic affordances, monster actions, routing variants) are
// exempt — they legitimately have no catalog entity (the #835 carve-out).
function lintOrphanSpellCapability(manifest: Record<string, unknown>): LintFinding[] {
	const catalog = new Set(
		rows(manifest, "entity_definitions")
			.map((r) => str(r, "entity_def_id"))
			.filter((id): id is string => typeof id === "string"),
	);
	const findings: LintFinding[] = [];
	for (const row of rows(manifest, "capability_definitions")) {
		const id = str(row, "capability_id");
		if (!id || !id.startsWith(SPELL_CATALOG_PREFIX) || catalog.has(id)) continue;
		findings.push({
			rule: "orphan-spell-capability",
			severity: "warning",
			id,
			bundleId: str(row, "bundle_id"),
			message: `capability '${id}' is a srd/spell identity with no catalog entity_definition of the same id (#835, runtime MF-VAL-264). One catalog spell is one identity — author the entity, or use a non-srd/spell id for a synthetic affordance.`,
		});
	}
	return findings;
}

// R4 — a srd/spell/<slug> identity whose slug carries an underscore, violating the
// #835 hyphen catalog convention (`srd/spell/magic_missile` vs the catalog's
// `srd/spell/magic-missile`). Read across all three identity carriers; dedup by id.
function lintSpellDelimiterDrift(manifest: Record<string, unknown>): LintFinding[] {
	const seen = new Set<string>();
	const findings: LintFinding[] = [];
	const consider = (id: string | undefined, bundleId: string | undefined) => {
		if (!id || !id.startsWith(SPELL_CATALOG_PREFIX) || seen.has(id)) return;
		const slug = id.slice(SPELL_CATALOG_PREFIX.length);
		if (!slug.includes("_")) return;
		seen.add(id);
		findings.push({
			rule: "spell-delimiter-drift",
			severity: "warning",
			id,
			bundleId,
			message: `spell identity '${id}' uses '_' in its slug; the #835 catalog convention is hyphen-delimited (e.g. '${id.replace(/_/g, "-")}'). Mixed delimiters orphan the catalog binding.`,
		});
	};
	for (const row of rows(manifest, "capability_definitions"))
		consider(str(row, "capability_id"), str(row, "bundle_id"));
	for (const row of rows(manifest, "entity_definitions"))
		consider(str(row, "entity_def_id"), str(row, "bundle_id"));
	for (const row of rows(manifest, "action_definitions"))
		consider(str(row, "required_capability"), str(row, "bundle_id"));
	return findings;
}

// R5 — IDENTITY tags re-carried on behavior rows: the catalog `entity_definition_tag`
// set (the spell's identity; under #835 the entity_def_id == the capability_id)
// duplicated VERBATIM onto the behavior `capability_definition_tag` and/or the cast
// action's `action_definition_tag`. That is the #836 evidence #3 smell — the same
// tag set on entity + capability + action.
//
// ⚠️ It does NOT fire on a capability+action pair that has no catalog identity tags:
// tags on those two carriers are exactly what `emitSpell` renders from ONE
// declaration (single-sourced in the author's intent, two rows in the output), and
// synthetic affordances / monster actions (`srd/buff/*`, `srd/monster-action/*`)
// legitimately tag both with no catalog entity. Flagging that would cry wolf on the
// blessed primitive. The smell is specifically the IDENTITY tags leaking onto behavior.
function lintTagRepetition(manifest: Record<string, unknown>): LintFinding[] {
	const entityTags = rows(manifest, "entity_definition_tag");
	const capabilityTags = rows(manifest, "capability_definition_tag");
	const actionTags = rows(manifest, "action_definition_tag");
	const actionByCapability = new Map<string, string>();
	for (const row of rows(manifest, "action_definitions")) {
		const req = str(row, "required_capability");
		const id = str(row, "action_id");
		if (req && id && !actionByCapability.has(req)) actionByCapability.set(req, id);
	}
	const findings: LintFinding[] = [];
	const capabilityIds = new Set(
		rows(manifest, "capability_definitions")
			.map((r) => str(r, "capability_id"))
			.filter((id): id is string => typeof id === "string"),
	);
	for (const capabilityId of capabilityIds) {
		const entityKey = tagKey(entityTags, "entity_def_id", capabilityId);
		if (entityKey === undefined) continue; // no catalog identity tags -> nothing to leak.
		const capKey = tagKey(capabilityTags, "capability_id", capabilityId);
		const actionKey = tagKey(
			actionTags,
			"action_id",
			actionByCapability.get(capabilityId) ?? " none",
		);
		// The smell: the catalog identity tag set re-carried verbatim on a behavior
		// carrier. Count carriers sharing the identity set (the entity itself + matches).
		const carriers = 1 + (capKey === entityKey ? 1 : 0) + (actionKey === entityKey ? 1 : 0);
		if (carriers < 2) continue;
		findings.push({
			rule: "tag-repetition",
			severity: "warning",
			id: capabilityId,
			bundleId: str(
				rows(manifest, "capability_definitions").find(
					(row) => str(row, "capability_id") === capabilityId,
				) ?? {},
				"bundle_id",
			),
			message: `spell '${capabilityId}' re-carries its catalog identity tag set on ${carriers} carriers (entity/capability/action). Tags belong on the catalog entity_definition; do not duplicate identity tags onto the behavior capability/action rows.`,
		});
	}
	return findings;
}

// R6 (#1846) — structurally dead DSL predicates: constructs that parse,
// validate, and seed cleanly but the runtime derivation provably never evaluates
// true. Falsifiable per construct (source-grounded, not a guess):
//   - target.has_capability: `manipulation_facts` (r_manipulate/selection/
//     candidates.rs) and `traversal_affordance_facts`/`edge_traversal_...`
//     (r_move.rs) both build the DSL `capabilities` fact list from
//     `DslSubjectRef::Actor` only — no code path anywhere ever emits a
//     `DslSubjectRef::Target` capability fact, in ANY reducer context.
// R7 and R8 lived in this family and are both RETIRED; see their comment
// blocks below for what made each construct real.

const PREDICATE_SOURCE_ID_KEYS = [
	"template_id",
	"outcome_graph_node_id",
	"outcome_graph_edge_id",
	"niche_id",
	"modifier_template_id",
	"condition_definition_id",
	"policy_id",
];

/** Best-effort row label for a generic cross-table scan (falls back to the table name). */
function rowLabel(table: string, row: Record<string, unknown>): string {
	for (const key of PREDICATE_SOURCE_ID_KEYS) {
		const value = str(row, key);
		if (value) return value;
	}
	return table;
}

/** Every `*predicate_source` string field on a row (the author-facing DSL-source columns). */
function predicateSourceFields(row: Record<string, unknown>): [string, string][] {
	return Object.entries(row).filter(
		(entry): entry is [string, string] =>
			entry[0].endsWith("predicate_source") && typeof entry[1] === "string" && entry[1] !== "",
	);
}

// R6 — `target.has_capability(...)`: dead in every kernel evaluation path (see above).
function lintDeadTargetCapability(manifest: Record<string, unknown>): LintFinding[] {
	const findings: LintFinding[] = [];
	for (const [table, table_rows] of Object.entries(manifest)) {
		if (!Array.isArray(table_rows)) continue;
		for (const row of table_rows) {
			if (!isRecord(row)) continue;
			for (const [field, source] of predicateSourceFields(row)) {
				if (!source.includes("target.has_capability(")) continue;
				findings.push({
					rule: "dead-target-capability",
					severity: "warning",
					id: rowLabel(table, row),
					bundleId: str(row, "bundle_id"),
					message: `${table}.${field} calls 'target.has_capability(...)' — capability facts derive actor-only everywhere in the kernel (r_manipulate's manipulation_facts, r_move's traversal_affordance_facts); a target-subject capability check can never be true (#1846). Use 'target.has_niche(...)' via entity_definition_tag instead.`,
				});
			}
		}
	}
	return findings;
}



// R9 (finding #2, srd-cc battle-test ledger) — a `*_tag` row's `tag` value
// matches a CALLER-SUPPLIED `refTagFamilies` prefix (e.g. "srd.ability.") but
// the value after the prefix doesn't resolve to any row of the declared
// `targetKind` — almost always a typo (e.g. `srd.ability.wsi`), invisible to
// the validator because `tag` is a free string with no ref-shaped FIELD NAME
// (`isRefField` in `./inspection.ts` never matches a bare `tag` field).
// Discovery is generic over every `*_tag`-suffixed table — no dependency on
// `ROW_KIND_COMPOSITE_KEY` needed, since the `_tag` suffix is itself the
// row-kind convention.
//
// `refTagFamilies` is caller-supplied, never seeded here (`./ref-tags.ts`'s
// own header explains why this engine declares no 5e-shaped vocabulary of
// its own) — an empty list (the default every caller gets unless it opts in,
// see `lintManifest` below) makes this rule fire on nothing, which is the
// correct behavior for a bundle that hasn't declared any ref-typed tag
// convention, not a regression.
function lintDanglingRefTag(
	manifest: Record<string, unknown>,
	refTagFamilies: readonly RefTagFamily[],
): LintFinding[] {
	const findings: LintFinding[] = [];
	for (const [table, tableRows] of Object.entries(manifest)) {
		if (!table.endsWith("_tag") || !Array.isArray(tableRows)) continue;
		for (const row of tableRows) {
			if (!isRecord(row)) continue;
			const tag = str(row, "tag");
			if (!tag) continue;
			// The row's own "id" for the finding: whichever field isn't
			// tag/bundle_id/source (mirrors outboundRefsExcluding's own exclusion idiom).
			const id = Object.entries(row).find(
				([key, value]) =>
					key !== "tag" && key !== "bundle_id" && key !== "source" && typeof value === "string",
			)?.[1] as string | undefined;
			if (!id) continue;
			const family = resolveTagPrefixFamily(
				tag,
				visibleRefTagFamilies(manifest, str(row, "bundle_id"), refTagFamilies),
			);
			if (family !== undefined) {
				const value = tag.slice(family.prefix.length);
				const visible =
					family.declaringBundleId === undefined
						? undefined
						: bundleScope(manifest, family.declaringBundleId);
				const outcome = resolveRefTagValueOutcome(
					manifest,
					family.targetKind,
					family.naturalKeyField,
					value,
					tag,
					visible,
				);
				if (outcome.kind === "resolved") {
					continue;
				}
				if (outcome.kind === "ambiguous") {
					findings.push({
						rule: "ambiguous-ref-tag",
						severity: "warning",
						id,
						bundleId: str(row, "bundle_id"),
						message: `MF-VAL-303: ${table} '${id}' tags '${tag}' — candidates: ${outcome.candidates.join(", ")}; no outbound edge.`,
					});
					continue;
				}
				findings.push({
					rule: "dangling-ref-tag",
					severity: "warning",
					id,
					bundleId: str(row, "bundle_id"),
					message: `${table} '${id}' tags '${tag}' — no ${family.targetKind} row's id matches '${value}'; check for a typo (finding #2).`,
				});
			}
		}
	}
	return findings;
}

const COMPASS_SECTORS = [
	"east",
	"northeast",
	"north",
	"northwest",
	"west",
	"southwest",
	"south",
	"southeast",
] as const;

function metricDirection(fromX: number, fromY: number, toX: number, toY: number): string {
	const dx = toX - fromX;
	const dy = toY - fromY;
	const deg = Math.atan2(dy, dx) * (180 / Math.PI);
	const normalised = deg < 0 ? deg + 360 : deg;
	const sector = Math.floor((normalised + 22.5) / 45) % 8;
	// biome-ignore lint/style/noNonNullAssertion: sector is always 0-7 via % 8.
	return COMPASS_SECTORS[sector]!;
}

function num(row: Record<string, unknown>, key: string): number | undefined {
	const value = row[key];
	return typeof value === "number" ? value : undefined;
}

function bool(row: Record<string, unknown>, key: string): boolean {
	return row[key] === true;
}

/** Mirrors `readCurrentScene`/`readLocationSnapshot`'s own exit-label rule:
 * the compass direction when both endpoints carry an authored position,
 * else the raw destination node id. */
function exitLabel(
	edge: Record<string, unknown>,
	nodesById: Map<string, Record<string, unknown>>,
): string {
	const toNodeId = str(edge, "to_node_id");
	const fromNode = nodesById.get(str(edge, "from_node_id") ?? "");
	const toNode = toNodeId !== undefined ? nodesById.get(toNodeId) : undefined;
	if (
		fromNode !== undefined &&
		toNode !== undefined &&
		bool(fromNode, "pos_present") &&
		bool(toNode, "pos_present")
	) {
		const fromX = num(fromNode, "pos_x");
		const fromY = num(fromNode, "pos_y");
		const toX = num(toNode, "pos_x");
		const toY = num(toNode, "pos_y");
		if (fromX !== undefined && fromY !== undefined && toX !== undefined && toY !== undefined) {
			return metricDirection(fromX, fromY, toX, toY);
		}
	}
	return toNodeId ?? "";
}

function lintDuplicateExitLabels(manifest: Record<string, unknown>): LintFinding[] {
	const nodesById = new Map(
		rows(manifest, "place_nodes")
			.map((row) => [str(row, "node_id"), row] as const)
			.filter((entry): entry is [string, Record<string, unknown>] => entry[0] !== undefined),
	);
	const byFromNode = new Map<string, { edgeKey: string; label: string }[]>();
	for (const edge of rows(manifest, "place_edges")) {
		const fromNodeId = str(edge, "from_node_id");
		const edgeKey = str(edge, "edge_key");
		if (!fromNodeId || !edgeKey) continue;
		const label = exitLabel(edge, nodesById);
		if (!label) continue;
		const list = byFromNode.get(fromNodeId) ?? [];
		list.push({ edgeKey, label });
		byFromNode.set(fromNodeId, list);
	}
	const findings: LintFinding[] = [];
	for (const [fromNodeId, edges] of byFromNode) {
		const byLabel = new Map<string, string[]>();
		for (const edge of edges) {
			const list = byLabel.get(edge.label) ?? [];
			list.push(edge.edgeKey);
			byLabel.set(edge.label, list);
		}
		for (const [label, edgeKeys] of byLabel) {
			if (edgeKeys.length < 2) continue;
			const sorted = [...edgeKeys].sort();
			for (const edgeKey of sorted) {
				const siblings = sorted.filter((key) => key !== edgeKey);
				findings.push({
					rule: "duplicate-exit-label",
					severity: "warning",
					id: edgeKey,
					bundleId: str(
						rows(manifest, "place_edges").find((edge) => str(edge, "edge_key") === edgeKey) ?? {},
						"bundle_id",
					),
					message: `place_edge '${edgeKey}' from node '${fromNodeId}' shares the label '${label}' with ${siblings.length} other exit(s) from the same node (${siblings.join(", ")}) — spellkave_scene lists them identically, so a PLAYER cannot tell them apart without a spellkave_scene_detail probe per candidate (T3). Reposition an endpoint so the compass directions diverge, or author distinct pos_x/pos_y so the labels stop colliding.`,
				});
			}
		}
	}
	return findings;
}

export interface LintManifestOptions {
	/**
	 * The `dangling-ref-tag` rule's (R9) vocabulary of ref-typed `*_tag` value
	 * prefixes (e.g. `srd.ability.` → `resource_definitions`) — CALLER-SUPPLIED,
	 * never seeded by this package (`./ref-tags.ts`'s header explains why this
	 * game-agnostic engine declares no 5e-shaped vocabulary of its own).
	 * Defaults to an empty list: the rule fires on nothing unless a caller
	 * (e.g. a content bundle's own test/CLI invocation) opts in with its own
	 * declared families. `sk lint` run standalone against a fixtures path does
	 * not yet supply any — families are caller-declared until a manifest-level
	 * `tag_prefixes` declaration surface exists (proposed separately via
	 * OpenSpec; see `./ref-tags.ts`'s header).
	 */
	refTagFamilies?: readonly RefTagFamily[];
}

/**
 * Lint a parsed manifest for author-time duplication / binding smells (#836 Part C)
 * plus structurally dead DSL predicate constructs (#1846). Every finding is a
 * non-fatal `warning`; findings are sorted (rule, then id) for a deterministic
 * report. Pass the merged-bundle manifest to catch cross-fragment drift.
 */
export function lintManifest(
	manifest: Record<string, unknown>,
	options: LintManifestOptions = {},
): LintFinding[] {
	const findings = [
		...lintTwinActions(manifest),
		...lintDanglingRequiredCapability(manifest),
		...lintOrphanSpellCapability(manifest),
		...lintSpellDelimiterDrift(manifest),
		...lintTagRepetition(manifest),
		...lintDeadTargetCapability(manifest),
		...lintDanglingRefTag(manifest, options.refTagFamilies ?? []),
		...lintDuplicateExitLabels(manifest),
	];
	return findings.sort((a, b) => a.rule.localeCompare(b.rule) || a.id.localeCompare(b.id));
}

/** The lint rule ids, for a documented author-time contract (CLI output / docs). */
export const LINT_RULES: LintRule[] = [
	"twin-action",
	"dangling-required-capability",
	"orphan-spell-capability",
	"spell-delimiter-drift",
	"tag-repetition",
	"dead-target-capability",
	"dangling-ref-tag",
	"ambiguous-ref-tag",
	"duplicate-exit-label",
];
