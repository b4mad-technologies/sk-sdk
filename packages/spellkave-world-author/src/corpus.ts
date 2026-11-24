// The authoring corpus is a curated INDEX over the package-local docs in
// `packages/spellkave-world-author/docs/**` (physically moved off
// `docs/modding/**`, #1968/R1) — full prose, self-contained, no repo checkout
// needed. Two halves:
//
//   • PROSE_DOCS below — hand-authored id/title/kind/tags for the
//     guide/reference prose (`docs/*.md`). Every such `.md` (except the
//     generated reference docs and README) must have a pointer here, enforced
//     by the coverage guard in `__tests__/corpus.test.ts` (ADR-0047 D-3). The
//     `body` is NOT hand-written — it is always the doc's full text, ingested
//     by `scripts/generate-authoring-corpus.ts` into `GENERATED_PROSE_BODIES`
//     (`./corpus.generated`) and merged in below.
//   • The EXAMPLE half — `EXAMPLES[]` and the `kind: "example"` DOCS entries —
//     is GENERATED from `docs/examples/<id>.toml` + `<id>.meta.json` by
//     `scripts/generate-authoring-corpus.ts` and imported from
//     `./corpus.generated`. Do not hand-edit example TOML here; edit the `.toml`
//     and regenerate (ADR-0047 D-2). `--check`-gated in CI.
//
// The `dsl-grammar` / `manifest-format` reference docs are themselves generated
// from the Rust crate (`scripts/generate-authoring-reference-docs.ts`); the same
// crate truth is also exposed structurally here via `reference.ts`.
//
// Consts stay inline (no runtime fs): `@spellkave/world-author` ships only
// `src/`, so `docs/**` is absent from the published tarball — the corpus must
// be self-contained within `src/` (ADR-0047 D-4). All single-sourcing happens
// at generate/CI time, not import time.

import type { DocsMetadata } from "@spellkave/tool-contracts";
import {
	GENERATED_CORPUS_REVISION,
	GENERATED_EXAMPLE_DOCS,
	GENERATED_EXAMPLES,
	GENERATED_PACKAGE_GUIDES,
	GENERATED_PATTERN_DOCS,
	GENERATED_PROSE_BODIES,
} from "./corpus.generated";

export const authoringCorpusRevision = GENERATED_CORPUS_REVISION;

export type AuthoringDocKind = "reference" | "guide" | "example" | "repair";

export interface AuthoringDoc {
	id: string;
	title: string;
	kind: AuthoringDocKind;
	/** One-line, browsable-index-friendly summary (#1968) — hand-authored for
	 * prose docs (PROSE_DOCS below), the example's own `intent` for example
	 * docs (`scripts/generate-authoring-corpus.ts`). Never the doc body. */
	summary: string;
	tags: string[];
	body: string;
	/** Repository-relative build input for a guide owned by another product package. */
	source_path?: string;
	/** Authored publication facts; omitted for established corpus material. */
	publication?: Pick<
		DocsMetadata,
		"content_status" | "supported_surfaces" | "feature_prerequisites"
	>;
	/**
	 * The worked manifest for an example-backed doc (#1983). Present exactly
	 * when `docs/examples/<id>.toml` exists — which is what made a separate
	 * `examples show` command necessary before: the doc `body` is the prose
	 * companion ("Companion to `<id>.toml`"), never the copyable TOML itself,
	 * so a caller who found the right doc still could not act on it. Carrying
	 * the payload on the doc collapses "search the corpus" and "fetch the
	 * example" into one lookup over one id space.
	 */
	toml?: string;
	/** Diagnostics {@link toml} is expected to produce, empty for a clean example. */
	expectedDiagnostics?: string[];
	/**
	 * The example's own `docs/examples/<id>.md` walkthrough, set ONLY when this
	 * id also has separate concept prose (`docs/<id>.md`) that already owns
	 * `body`. For an example-only doc the walkthrough IS the body, so carrying
	 * it twice would just double the payload of a corpus whose whole design is
	 * to pull the smallest useful slice.
	 */
	walkthrough?: string;
}

export interface AuthoringExample {
	id: string;
	intent: string;
	tags: string[];
	toml: string;
	expectedDiagnostics: string[];
}

export interface CorpusQueryResult<T> {
	item: T;
	score: number;
}

// Hand-authored id/title/kind/tags for the guide/reference prose under
// `packages/spellkave-world-author/docs/`. Example-kind docs are NOT listed
// here — they are generated (see header). No `body` here: it always comes
// from `GENERATED_PROSE_BODIES` (full ingested prose, R1), looked up below.
type ProseDocMeta = Omit<AuthoringDoc, "body">;

const PROSE_DOCS: ProseDocMeta[] = [
	{
		id: "containment-policies",
		title: "Containment exposure and access",
		kind: "guide",
		summary:
			"Author definition defaults and instance overrides for perceived contents and removal access, preserving personal possession.",
		tags: ["containment", "policy", "visibility", "ownership", "inventory"],
	},
	{
		id: "parameterized-scenes",
		title: "Parameterized scene setup",
		kind: "guide",
		summary:
			"Preview a data package, explicitly stage separate graph and population phases, and inspect partial receipts and cleanup limits.",
		tags: ["scene", "blueprint", "setup", "figures", "cleanup", "author"],
	},
	{
		id: "find-an-authoring-pattern",
		title: "Find an authoring pattern without a checkout",
		kind: "guide",
		summary:
			"Search by task, retrieve a complete pattern and worked example, and distinguish source evidence from installed or hosted proof.",
		tags: ["task", "pattern", "search", "installed", "example", "evidence", "recovery"],
	},
	{
		id: "hosted-authoring-workflow",
		title: "Author or run a session through hosted tools",
		kind: "guide",
		summary:
			"Retrieve public help, choose a caller-owned presence and use offered scoped portable tools without server files.",
		tags: ["hosted", "author", "DM", "presence", "payload", "task", "recovery"],
		publication: {
			content_status: "implemented",
			supported_surfaces: ["cli", "local-mcp", "hosted-mcp", "web"],
			feature_prerequisites: [],
		},
	},
	{
		id: "hosted-authoring-guidance",
		title: "Hosted compound workflows — evidence and remaining stories",
		kind: "guide",
		summary:
			"Reference verified local scene setup and the remaining atomic DM hand-over story, with explicit hosted deployment limits.",
		tags: ["hosted", "authoring", "planning", "prerequisites"],
		publication: {
			content_status: "planned",
			supported_surfaces: ["cli", "local-mcp"],
			feature_prerequisites: [
				{
					feature: "parameterized-scene-setups",
					status: "implemented",
					minimum_revision: "dd6f2d57e394ebe303f6c7426640c809c27226ec",
				},
				{ feature: "role-binding-hand-over", status: "planned", minimum_revision: "unknown" },
			],
		},
	},
	{
		id: "index",
		title: "Authoring docs — corpus index",
		kind: "reference",
		summary:
			"Generated index of every corpus doc, grouped by kind, with a one-line summary each (#1968 browsable docs).",
		tags: ["index", "navigation", "overview", "toc"],
	},
	{
		id: "behavior-composition",
		title: "Behavior composition — the ActorBehavior layer",
		kind: "guide",
		summary:
			"Turn one declarative ActorBehavior object into the full capability/outcome/affordance/action/consequence chain.",
		tags: [
			"behavior",
			"compose",
			"actor-behavior",
			"shape",
			"spell",
			"monster-action",
			"driver",
			"programmatic",
		],
	},
	{
		id: "onramp",
		title: "Modding onramp",
		kind: "guide",
		summary:
			"Start-here: AUTHOR + PLAYER tools, with TOML as the underlying model — not a gotcha encyclopedia.",
		tags: ["bundle", "seed", "validate", "manifest", "author", "player", "tools", "onramp"],
	},
	{
		id: "authoring-process",
		title: "Authoring process — shared agent contract",
		kind: "guide",
		summary:
			"The shared query-first, pre-check, proof-then-escalate process every authoring agent role builds on.",
		tags: ["process", "pre-check", "duplicate", "query-first", "proof", "escalation"],
	},
	{
		id: "patterns",
		title: "Patterns of Spellkave Manifest Authoring",
		kind: "guide",
		summary:
			"Problem-indexed pattern catalog (extra action, hazards, XP grants, dialog slots, …) — look here before filing a kernel gap.",
		tags: [
			"patterns",
			"catalog",
			"problem-indexed",
			"ModifyChannel",
			"composition",
			"action-surge",
			"authoring",
		],
	},
	{
		id: "place-graph-occupancy",
		title: "Intent — place graph + occupancy (who is where)",
		kind: "guide",
		summary:
			"Two-call playbook: map_graph for the picture, entities fields=preferred for names by place_node_id.",
		tags: [
			"intent",
			"place-graph",
			"map",
			"occupancy",
			"who-is-where",
			"entities",
			"map_graph",
			"spatial",
			"actors",
		],
	},
	{
		id: "manifest-format",
		title: "Manifest format reference",
		kind: "reference",
		summary:
			"Generated TOML row/field reference for every manifest row kind, derived from the Rust schema crate.",
		tags: ["schema", "toml", "row-kind", "field"],
	},
	{
		id: "dsl-grammar",
		title: "DSL grammar reference",
		kind: "reference",
		summary:
			"Generated operator reference for the predicate/outcome DSL used inside `_source` fields.",
		tags: ["dsl", "predicate", "outcome", "operator"],
	},
	{
		id: "interaction-dsl-and-world-authoring",
		title: "Interaction model and world authoring",
		kind: "reference",
		summary:
			"The broader interaction model: entities, containment, affordances, niches, outcomes, conditions, target refs.",
		tags: [
			"interaction",
			"affordance",
			"niche",
			"consequence",
			"frame-write",
			"condition",
			"equipment",
			"aoe",
		],
	},
	{
		id: "damage-type-routing",
		title: "Damage-type routing pattern",
		kind: "guide",
		summary:
			"Author typed damage via a delta_source DSL expression that reads target resistance/immunity tags.",
		tags: ["damage", "routing", "delta-source", "has-tag", "resistance", "immunity"],
	},
	{
		id: "metadata-attachments",
		title: "Metadata attachments",
		kind: "guide",
		summary:
			"Validated annotations (provenance, art, narration, persona) that are for humans/tools, never server behavior.",
		tags: [
			"metadata",
			"provenance",
			"editorial",
			"observer",
			"art",
			"narration",
			"persona",
			"placement-ladder",
		],
	},
	{
		id: "lingering-hazard-zones",
		title: "Lingering hazard zones (caster-attributed pulses)",
		kind: "guide",
		summary:
			"Author a self-pulsing hazard zone (Cloudkill, Stinking Cloud) that damages occupants each round, then fades.",
		tags: [
			"hazard",
			"cloudkill",
			"autonomy-job",
			"schedule",
			"pulse",
			"duration",
			"liveness",
			"concentration",
		],
	},
	{
		id: "long-running-actions",
		title: "Long-running actions, busy policy, and resumable progress",
		kind: "guide",
		summary:
			"Author actions with real in-world duration (rituals, crafting, rests): the §5.10 promotion threshold, busy allow/break predicates, authored expiry, and opt-in resumable progress.",
		tags: [
			"long-running",
			"cost_time_ms",
			"promotion",
			"session",
			"busy",
			"busy_allow_pred",
			"busy_break_pred",
			"resumable",
			"progress",
			"interrupted_work",
			"duration",
			"ritual",
			"rest",
		],
	},
	{
		id: "action-economy",
		title: "Action economy: channels, boundaries, and fiction time",
		kind: "guide",
		summary:
			"Author fiction-ms channel pools, action costs, boundary refreshes, condition modifiers, and autonomy firing modes.",
		tags: [
			"action-economy",
			"channel",
			"cost-time-ms",
			"boundary",
			"fire-boundary",
			"autonomy",
			"modifier",
			"fiction-time",
		],
	},
	{
		id: "spell-authoring-best-practices",
		title: "Spell authoring best practices",
		kind: "guide",
		summary:
			"How to add a spell without hand-wiring a dozen rows or drifting into lint-flagged duplication.",
		tags: [
			"spell",
			"identity",
			"emit-spell",
			"lint",
			"render-discipline",
			"dedup",
			"best-practice",
		],
	},
	{
		id: "running-an-authored-act",
		title: "Running an authored act through r_manipulate",
		kind: "repair",
		summary:
			"Runbook of non-obvious requirements for an authored act to actually fire through r_manipulate, in bite order.",
		tags: ["manipulate", "affordance", "capability", "act", "runbook", "troubleshooting"],
	},
	// Situational repairs extracted from the pre-split onramp (authoring-docs-tool-first-onramp).
	// Bodies: docs/repairs/<id>.md (except running-an-authored-act, top-level).
	{
		id: "actor-identity-bindings",
		title: "Actor Identity Bindings",
		kind: "repair",
		summary: "[[actor_identities]] binds a SpacetimeDB login identity to an authored actor.",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"actor_identities",
			"$sender",
			"actor_authorization_failed",
			"binding",
		],
	},
	{
		id: "actor-stat-self-only",
		title:
			"`actor.stat(...)` and a self-eligible `ModifyResource`'s `TargetActor` only ever read/write the ACTING entity's own row \u2014 never a third party",
		kind: "repair",
		summary: "Gotcha \u2014 there is no cross-actor resource read/write shape. In an",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"actor.stat",
			"ModifyResource",
			"TargetActor",
			"self_eligible",
		],
	},
	{
		id: "adjacent-moves-ungated",
		title:
			"`adjacentMoves()` lists raw graph geometry, not gated traversability; to prove an edge now rejects, attempt `.move()` and check the status",
		kind: "repair",
		summary: "listAdjacentMoves (packages/spellkave-sdk/src/core/movement.ts) iterates",
		tags: ["repair", "troubleshooting", "gotcha", "adjacentMoves", "traversability", "move"],
	},
	{
		id: "affordance-needs-niche-attachment",
		title:
			"An affordance `niche_id` needs a `spatial_niche_attachment` only when its niche is place-provided \u2014 pick the niche's `provider` deliberately",
		kind: "repair",
		summary: "**Gotcha \u2014 granting a capability via actor_capabilities does not, by",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"niche_id",
			"spatial_niche_attachment",
			"self_eligible",
		],
	},
	{
		id: "apply-status-claim-lock",
		title:
			"Any consequence containing `ApplyStatus` acquires a 10-tick claim-lock on its target \u2014 a second actor's manipulate against that same target can hit `claim_contended`",
		kind: "repair",
		summary: "r_manipulate classifies a resolved action's consequence as *steering-shaped*",
		tags: ["repair", "troubleshooting", "gotcha", "ApplyStatus", "claim_contended", "claim-lock"],
	},
	{
		id: "authoring-observability",
		title: "Observability",
		kind: "repair",
		summary: "Observer knowledge is the canonical read surface for fog-of-war style",
		tags: ["repair", "troubleshooting", "gotcha", "observability", "events", "knowledge", "doctor"],
	},
	{
		id: "edge-traversal-resource-seed",
		title:
			"an edge-traversal affordance predicate reading a resource via `actor.stat(...)` needs that resource seeded on EVERY actor who might traverse the edge, and multiple `place_edge_affordance` rows on one `edge_key` AND-chain",
		kind: "repair",
		summary: "Two facts compound here. First, evaluate_edge_traversal_affordances",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"place_edge_affordance",
			"actor.stat",
			"edge_key",
		],
	},
	{
		id: "effective-condition-modifiers",
		title: "Numeric condition modifiers need explicit `effective(...)` consumers",
		kind: "repair",
		summary: 'actor.stat("my/state") and target.stat("my/state") always read the authored',
		tags: ["repair", "troubleshooting", "gotcha", "effective", "modifier", "condition"],
	},
	{
		id: "empty-predicate-source",
		title:
			"An empty `predicate_source` needs `predicate_bool = true`, or the affordance silently never resolves",
		kind: "repair",
		summary: "**Gotcha \u2014 predicate_bool is not a decorative default; it is the literal",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"predicate_source",
			"predicate_bool",
			"affordance",
		],
	},
	{
		id: "equip-item-target-ref",
		title: "Equipping items: target-ref prefix, ownership depth, and `core/drop`'s real scope",
		kind: "repair",
		summary: "**Gotcha \u2014 entity:<id> vs item:<id> target refs resolve through DIFFERENT",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"item:",
			"entity:",
			"equip",
			"out_of_range",
			"drop",
		],
	},
	{
		id: "condition-capability-grant-and-suppression",
		title:
			"`grants_capability_while_active` grants a capability while a condition holds \u2014 and `suppresses_capability_while_active` takes one away",
		kind: "repair",
		summary: "Both fields on `[[condition_definitions]]` are lists of `capability_id`s, and",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"grants_capability_while_active",
			"suppresses_capability_while_active",
			"capability",
			"condition",
			"ApplyStatus",
		],
	},
	{
		id: "grid-anchor-forfeits-kill-zone",
		title:
			"Placing an actor's manifest position on a session's grid ANCHOR node forfeits its authored kill-zone cell \u2014 it row-major-falls-back instead",
		kind: "repair",
		summary: "An actor's combat_grid_blueprint seat is normally snapped from its authored",
		tags: ["repair", "troubleshooting", "gotcha", "grid", "anchor", "kill-zone", "session"],
	},
	{
		id: "has-item-dead-in-manipulate",
		title:
			"`has_item` works inside a manipulate predicate \u2014 RETIRED gotcha, kept for readers of old manifests",
		kind: "repair",
		summary: "**This gotcha no longer applies.** Since bead sk-vjh.7,",
		tags: [
			"repair",
			"troubleshooting",
			"retired",
			"has_item",
			"manipulate",
			"predicate",
			"possession-gate",
		],
	},
	{
		id: "hosted-world-observability",
		title: "Hosted-world observability for authors",
		kind: "repair",
		summary: "A hosted world's NPC cycles and tool outcomes are visible to the world",
		tags: ["repair", "observability", "hosted", "author", "openobserve", "control-plane"],
	},
	{
		id: "join-session-global-scope",
		title:
			"`JoinSession`/`LeaveSession` read a GLOBAL `turn_state.scope_session_id` \u2014 the acting entity does not need to be a participant, but the room-alarm gate it often pairs with is a `spatial_environment_state`, not an `object_state`",
		kind: "repair",
		summary: 'A JoinSession { participant_ref: "Actor" } frame-write (mid-combat',
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"JoinSession",
			"LeaveSession",
			"scope_session_id",
			"spatial_environment_state",
		],
	},
	{
		id: "leave-session-relocates",
		title:
			"`LeaveSession` always relocates the leaver off the tactical grid \u2014 it removes a participant from the turn order at the cost of taking the body out of the scene, so it is the wrong tool for a corpse",
		kind: "repair",
		summary:
			"Skip a body without removing it via turn_eligibility_pred; LeaveSession relocates the leaver",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"LeaveSession",
			"turn-order",
			"turn_eligibility_pred",
			"corpse",
			"condition-hook",
			"core/session_id",
		],
	},
	{
		id: "manipulate-ref-niche-attachment",
		title:
			'An item-scoped place niche needs a `spatial_niche_attachment` (or `provider = "entity"`), however the manipulate ref is built',
		kind: "repair",
		summary: "**Gotcha \u2014 the generic (entity:<id>/item:<id>) manipulate-target",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"entity:",
			"item:",
			"spatial_niche_attachment",
			"target_ref",
		],
	},
	{
		id: "manipulate-success-on-provenance",
		title:
			"`manipulate()`'s `successPredicate` has no fixed world-state signal for a stochastic (d20-driven) action \u2014 pass `successOnProvenance: true` on the client instead",
		kind: "repair",
		summary: "createActorClient(session, id, { successOnProvenance: true }) makes",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"successOnProvenance",
			"manipulate",
			"stochastic",
			"d20",
		],
	},
	{
		id: "mass-stand-down-apply-status",
		title: "Mass stand-down: `ForEachActorInRadius` + `ApplyStatus`, not per-entity writes",
		kind: "repair",
		summary: "A single deterministic act (e.g. an NPC leader calling off its allies) can",
		tags: ["repair", "troubleshooting", "gotcha", "ForEachActorInRadius", "ApplyStatus", "aoe"],
	},
	{
		id: "milestone-gate-terminal-flags",
		title:
			"A milestone gate composing over a prior beat's terminal flags only needs the ONE action each flag's own predicate requires \u2014 not a full re-derivation of that beat",
		kind: "repair",
		summary: "A milestone/advancement beat that gates on flags a much larger prior beat",
		tags: ["repair", "troubleshooting", "gotcha", "milestone", "predicate", "walkthrough"],
	},
	{
		id: "modify-resource-floored-noop",
		title:
			"A `ModifyResource` against an already-floored resource is a silent no-op \u2014 use a dedicated counter to prove repeated harm",
		kind: "repair",
		summary: "Resources clamp at min_value (srd/hp's is 0). A consequence that deals",
		tags: ["repair", "troubleshooting", "gotcha", "ModifyResource", "floor", "silent", "counter"],
	},
	{
		id: "no-knowledge-seed-primitive",
		title: "No manifest knowledge-seed primitive \u2014 OR-extend the reading predicate instead",
		kind: "repair",
		summary: "**Gotcha \u2014 the only manifest knowledge-writer is CopyKnowledgeRow",
		tags: ["repair", "troubleshooting", "gotcha", "knowledge", "predicate", "seed"],
	},
	{
		id: "npc-needs-driver",
		title: "NPCs need a driver \u2014 there is no autonomous NPC behavior",
		kind: "repair",
		summary: "Spellkave's module has a hard rule: **it contains no actor decision",
		tags: ["repair", "troubleshooting", "gotcha", "npc", "driver", "autonomy", "schedule"],
	},
	{
		id: "ordered-resource-grants",
		title: "Ordered resource grants can read earlier frame writes",
		kind: "repair",
		summary: "consequence_frame_writes execute by ascending ordinal, and each",
		tags: ["repair", "troubleshooting", "gotcha", "frame_write", "ordinal", "resource"],
	},
	{
		id: "region-scale-geography",
		title: "Region-scale geography: check the live place graph, not a stale brief",
		kind: "repair",
		summary: '**Gotcha \u2014 a beat brief\'s "region nodes: ZERO" open flank can go stale the',
		tags: ["repair", "troubleshooting", "gotcha", "region", "place_graph", "foundry", "geography"],
	},
	{
		id: "relocate-entity-ungated",
		title:
			"`RelocateEntity` is the un-gated, world-scoped forced-move leaf \u2014 no `place_edge` required, unlike `JoinSession`/`LeaveSession` it never touches a session",
		kind: "repair",
		summary: "A consequence that must move an actor somewhere it did NOT choose to walk",
		tags: ["repair", "troubleshooting", "gotcha", "RelocateEntity", "forced-move"],
	},
	{
		id: "remove-item-deletes-stack",
		title:
			"`RemoveItem` deletes a fully-consumed stack \u2014 it does not leave a zero-quantity row",
		kind: "repair",
		summary: "RemoveItem's quantity split (remove_item.rs::decide_quantity) has two",
		tags: ["repair", "troubleshooting", "gotcha", "RemoveItem", "quantity", "stack"],
	},
	{
		id: "sibling-resource-predicate-seeds",
		title: "Sibling resource pools each need their OWN predicate-safety seed",
		kind: "repair",
		summary: "**Gotcha \u2014 seeding one resource pool does NOT seed a sibling pool with the",
		tags: ["repair", "troubleshooting", "gotcha", "resource", "predicate", "seed", "object_state"],
	},
	{
		id: "target-has-capability-dead",
		title:
			"`target.has_capability(...)` is dead \u2014 capability facts are Actor-only; gate a TARGET's kind via `target.has_niche(...)` (an entity-def tag) instead",
		kind: "repair",
		summary: "**Gotcha \u2014 target.has_capability(...) parses and seeds cleanly, then never",
		tags: ["repair", "troubleshooting", "gotcha", "has_capability", "has_niche", "dead"],
	},
	{
		id: "weapon-stricter-affordance-variant",
		title:
			"Opting ONE weapon copy into a stricter affordance variant without regressing its siblings",
		kind: "repair",
		summary: 'Two entity_definitions can represent "the same" item (e.g. srd/item/shortbow',
		tags: ["repair", "troubleshooting", "gotcha", "weapon", "affordance", "variant"],
	},
	{
		id: "self-eligible-reaction-budget",
		title:
			"MF-VAL-263's budget requirement narrowed to self-eligible REACTIONS (2026-08-01, PR #2079) — a plain self-target action needs no `spends_channel` or `ModifyResource`",
		kind: "repair",
		summary: "The rule, as it stands today. self_eligible = true has two independent",
		tags: [
			"repair",
			"troubleshooting",
			"gotcha",
			"self_eligible",
			"mf-val-263",
			"reaction_eligibility",
			"reaction_trigger",
			"spends_channel",
			"ModifyResource",
		],
	},
	{
		id: "can-i",
		title: "Ask whether an actor may act",
		kind: "guide",
		summary:
			"Ask a running world whether one body may perform one action now, and which check decides.",
		tags: ["probe", "admission", "can-i", "authority"],
	},
	{
		id: "dm-oversight",
		title: "Defining a DM: region oversight (see-as extent)",
		kind: "guide",
		summary:
			"Bind a DM role to a principal through a separate presence body, with bounded read oversight and authorised handover.",
		tags: [
			"dm",
			"visibility",
			"hidden",
			"extent",
			"place-graph",
			"capability",
			"oversight",
			"binding",
			"presence",
		],
	},
	{
		id: "grants",
		title: "Granting and recovering runtime roles",
		kind: "guide",
		summary:
			"Delegate roles as the caller, inspect private bindings, expand a complete world snapshot and export/restore with explicit expiry recovery.",
		tags: ["role", "grant", "revoke", "binding", "extent", "export", "restore", "authority"],
	},
	{
		id: "roles",
		title: "Roles as authored content",
		kind: "guide",
		summary:
			"Define and aggregate capability vocabulary, bind roles to principals through presences, and inspect composition and realised or inert bindings with explain.",
		tags: ["role", "binding", "presence", "capability", "aggregation", "explain", "authority"],
	},
	{
		id: "privileges",
		title: "Privileges: who may do and see what",
		kind: "reference",
		summary:
			"Every authority gate compiled into the server: named capabilities, operator identity, and elevation grants.",
		tags: ["privilege", "capability", "operator", "elevation", "authority", "visibility", "dm"],
	},
	{
		id: "reading-a-world",
		title: "Reading a running world",
		kind: "guide",
		summary:
			"get and describe read admitted authored instances through publisher or role-scoped readers; inspect reads files; query reads definitions and the workspace.",
		tags: ["get", "describe", "query", "inspect", "owner", "publisher"],
	},
	{
		id: "playable-seats",
		title: "Discovering playable seats",
		kind: "guide",
		summary:
			"Distinguish authored SRD seat offers from current live claimed/embodied state, with Explorer searches and the existing seat reader.",
		tags: ["playable", "seats", "claim", "player", "explore", "inventory"],
	},
	{
		id: "getting-started-with-verbs",
		title: "Getting started with verbs",
		kind: "guide",
		summary:
			"AUTHOR verb deep-dive (4-call fireball) linked from onramp — not a rival start-here door.",
		tags: [
			"verb",
			"getting-started",
			"fireball",
			"smart-default",
			"idempotent",
			"upsert",
			"target",
			"stage-then-commit",
			"agent",
		],
	},
	{
		id: "osm-mapping",
		title: "OSM mapping — how authored places become a map",
		kind: "reference",
		summary:
			"What to author (origin cell, sheet positions, portal edges, floors, extents, map layers) for a place to appear on the OSM-native world map, and the tags external OSM tools see (ADR-0123).",
		tags: [
			"osm",
			"map",
			"spatial",
			"place-graph",
			"indoor",
			"level",
			"coordinates",
			"h3",
			"map_layers",
			"reference",
		],
	},
	{
		id: "tool-reference",
		title: "Tool reference — AUTHOR surface",
		kind: "reference",
		summary:
			"Generated schema reference for the AUTHOR verb registry (`authorFacingToolDefinitions` / `AUTHOR_TOOL_NAMES`), walked structurally from their own TypeBox parameters.",
		tags: ["verb", "tool", "schema", "parameter", "reference", "agent"],
	},
	{
		id: "fixture-correctness",
		title: "Fixture correctness — the catalog",
		kind: "reference",
		summary:
			"The single source of truth for authoring a world-fixtures bundle correctly — every enforcer points here.",
		tags: [
			"correctness",
			"lint",
			"mf-val",
			"hygiene",
			"bundle-scope",
			"depends-on",
			"layering",
			"sourcing",
		],
	},
	{
		id: "rule-bench",
		title: "Offline rule evaluation bench (`spellkave_eval` / `sk eval`)",
		kind: "guide",
		summary:
			"Offline DSL expression and rule benching without a running node: facts shapes, chosen dice mechanics, traces, and resolution timing.",
		tags: [
			"rule-bench",
			"eval",
			"dsl",
			"predicate",
			"offline",
			"formula",
			"trace",
			"dice",
			"facts",
			"resolution",
		],
	},
];

/** Packaged source path relative to docs/ for a prose corpus id (tests + errors). */
export function authoringDocSourcePath(id: string): string {
	if (id === "onramp") return "README.md";
	// Problem-indexed pattern catalog lives under docs/patterns/ (sk-609b.12.7).
	if (id === "patterns") return "patterns/index.md";
	if (id.startsWith("patterns/")) return `${id}.md`;
	// Historical top-level repair keeps its original path; newer repairs live under docs/repairs/.
	const meta = PROSE_DOCS.find((doc) => doc.id === id);
	if (meta?.kind === "repair" && id !== "running-an-authored-act") {
		return `repairs/${id}.md`;
	}
	return `${id}.md`;
}

/** Full ingested prose for a `PROSE_DOCS` id, or a loud failure if it's missing. */
function proseBody(id: string): string {
	const body = GENERATED_PROSE_BODIES[id];
	if (body === undefined) {
		throw new Error(
			`corpus.ts: PROSE_DOCS entry "${id}" has no ingested prose — add ` +
				`packages/spellkave-world-author/docs/${authoringDocSourcePath(id)} (or fix the id) and regenerate ` +
				`(scripts/generate-authoring-corpus.ts)`,
		);
	}
	return body;
}

/**
 * The corpus, keyed by id — a MERGE of the prose and example halves, not a
 * concatenation (#1983).
 *
 * Concatenating them let one id name two different docs: `damage-type-routing`
 * and `dm-oversight` each existed as a `docs/<id>.md` concept guide AND a
 * `docs/examples/<id>.*` worked example, so the "stable packaged corpus id"
 * every consumer keys on (`DocIndexEntry.rel`, `doc_paths`, `getAuthoringDoc`)
 * silently resolved to whichever copy a caller happened to reach first.
 *
 * Merging is the right repair rather than renaming, because those two halves
 * are not a name collision — they are one subject written twice on purpose,
 * and each half explicitly links the other ("The concept guide is
 * `dm-oversight.md`", "Companion to `damage-type-routing.toml`"). One id, one
 * doc, carrying the example's `toml` so a caller can read the explanation and
 * copy the manifest from a single hit.
 *
 * `body` stays BYTE-EQUAL to the concept `.md` — the walkthrough goes to its
 * own field rather than being appended. That is not cosmetic: the ADR-0047 D-3
 * single-source guard (`__tests__/corpus.test.ts`) proves every guide body
 * against its packaged source precisely so a hand-edited const can never drift
 * from the doc it claims to serve, and a merge that concatenated prose would
 * have had to weaken it.
 *
 * An id with only one half keeps exactly its previous shape — a prose-only doc
 * has no `toml`, an example-only doc is unchanged apart from gaining one.
 */
function mergeCorpus(): AuthoringDoc[] {
	const byId = new Map(
		composePublicDocCorpora([
			PROSE_DOCS.map((doc) => ({ ...doc, body: proseBody(doc.id) })),
			GENERATED_PATTERN_DOCS,
			GENERATED_PACKAGE_GUIDES,
		]).map((doc) => [doc.id, doc]),
	);
	for (const example of GENERATED_EXAMPLE_DOCS) {
		const toml = GENERATED_EXAMPLES.find((ex) => ex.id === example.id);
		const withToml: AuthoringDoc = {
			...example,
			...(toml === undefined
				? {}
				: { toml: toml.toml, expectedDiagnostics: toml.expectedDiagnostics }),
		};
		const prose = byId.get(example.id);
		if (prose === undefined) {
			byId.set(example.id, withToml);
			continue;
		}
		byId.set(example.id, mergeAuthoringDocExample(prose, withToml));
	}
	return [...byId.values()];
}

const DOCS: AuthoringDoc[] = mergeCorpus();

/** Canonical concept identity/publication wins; example supplies its payload. */
export function mergeAuthoringDocExample(prose: AuthoringDoc, example: AuthoringDoc): AuthoringDoc {
	if (prose.id !== example.id) throw new Error("cannot merge different document IDs");
	return {
		...example,
		...prose,
		tags: [...new Set([...prose.tags, ...example.tags])],
		walkthrough: example.body,
	};
}

export function isSupportedAuthoringDoc(doc: AuthoringDoc): boolean {
	return !doc.publication || doc.publication.content_status === "implemented";
}

/** Package-owned corpora cannot silently replace another package's document. */
export function composePublicDocCorpora(
	corpora: readonly (readonly AuthoringDoc[])[],
): AuthoringDoc[] {
	const byId = new Map<string, AuthoringDoc>();
	for (const corpus of corpora)
		for (const doc of corpus) {
			if (byId.has(doc.id)) throw new Error(`duplicate public document id "${doc.id}"`);
			byId.set(doc.id, doc);
		}
	return [...byId.values()];
}

const EXAMPLES: AuthoringExample[] = GENERATED_EXAMPLES;

function terms(query: string): string[] {
	return query
		.toLowerCase()
		.split(/[^a-z0-9_/-]+/)
		.filter(Boolean);
}

function scoreText(queryTerms: string[], fields: string[]): number {
	const haystack = fields.join(" ").toLowerCase();
	return queryTerms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
}

export function listAuthoringDocs(): AuthoringDoc[] {
	return [...DOCS];
}

export function getAuthoringDoc(id: string): AuthoringDoc | undefined {
	return DOCS.find((doc) => doc.id === id);
}

/** Resolve source-relative Markdown links into corpus IDs without IO. */
export const DOC_LINK_LIMIT = 16;
export const DOC_LINK_BYTES = 2000;

export function authoringDocMetadata(id: string, deliveredBody?: string): DocsMetadata | undefined {
	const doc = getAuthoringDoc(id);
	if (!doc) return undefined;
	const docSource = (entry: AuthoringDoc) =>
		entry.source_path ??
		`packages/spellkave-world-author/docs/${entry.kind === "example" ? `examples/${entry.id}.md` : authoringDocSourcePath(entry.id)}`;
	const source = docSource(doc);
	const directory = source.split("/").slice(0, -1);
	const links: NonNullable<DocsMetadata["links"]> = [];
	const seen = new Set<string>();
	let linksTotal = 0;
	let linkBytes = 2;
	for (const match of (deliveredBody ?? doc.body).matchAll(/\]\(([^\s)]+)\)/g)) {
		const href = match[1];
		if (!href) continue;
		if (seen.has(href)) continue;
		seen.add(href);
		if (/^[a-z][a-z0-9+.-]*:|^\//i.test(href)) continue;
		const [path, section] = href.split("#");
		const parts = [...directory];
		if (path)
			for (const part of path.split("/")) {
				if (part === "..") parts.pop();
				else if (part && part !== ".") parts.push(part);
			}
		const target = path ? DOCS.find((candidate) => docSource(candidate) === parts.join("/")) : doc;
		if (target) {
			linksTotal += 1;
			const link = { href, document_id: target.id, ...(section ? { section } : {}) };
			// UTF-8 byte budget, portable to browser builds without a Node import.
			const bytes = new TextEncoder().encode(JSON.stringify(link)).length + 1;
			if (links.length < DOC_LINK_LIMIT && linkBytes + bytes <= DOC_LINK_BYTES) {
				links.push(link);
				linkBytes += bytes;
			}
		}
	}
	return {
		document_id: id,
		corpus_revision: authoringCorpusRevision,
		content_status: doc.publication?.content_status ?? "implemented",
		// Surface claims are authored publication facts, not inferred from generation.
		supported_surfaces: doc.publication?.supported_surfaces ?? ["cli", "local-mcp"],
		...(doc.publication?.feature_prerequisites
			? { feature_prerequisites: doc.publication.feature_prerequisites }
			: {}),
		server_revision: "unknown",
		compatibility: "unknown",
		...(links.length ? { links } : {}),
		...(linksTotal ? { links_total: linksTotal } : {}),
		...(linksTotal > links.length
			? {
					links_truncated: true,
					links_hint:
						"Retrieve a section by heading to resolve that section's links within the same budget.",
				}
			: {}),
	};
}

export function queryAuthoringDocs(query: string, limit = 5): CorpusQueryResult<AuthoringDoc>[] {
	const queryTerms = terms(query);
	return DOCS.filter(isSupportedAuthoringDoc)
		.map((doc) => {
			const base = scoreText(queryTerms, [
				doc.id,
				doc.title,
				doc.kind,
				doc.summary,
				doc.tags.join(" "),
				doc.body,
			]);
			// Prefer repair entries when scores are otherwise comparable so symptom
			// queries surface a short fix sheet ahead of a long guide body.
			let score = base;
			if (base > 0 && doc.kind === "repair") score += 0.5;
			// Exact tag / id hits beat incidental body mentions (symptom search).
			const tagHay = new Set([doc.id, ...doc.tags.map((tag) => tag.toLowerCase())]);
			for (const term of queryTerms) {
				if (
					tagHay.has(term) ||
					tagHay.has(term.replace(/_/g, "-")) ||
					tagHay.has(term.replace(/-/g, "_"))
				) {
					score += 2;
				}
			}
			return { item: doc, score };
		})
		.filter((result) => result.score > 0)
		.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
		.slice(0, limit);
}

/** Heading text → github-like anchor slug. */
export function authoringHeadingAnchor(heading: string): string {
	return heading
		.trim()
		.toLowerCase()
		.replace(/[`*_~]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

export interface AuthoringDocSection {
	heading: string;
	anchor: string;
	body: string;
	level: number;
}

/** Split a markdown body into heading sections (ATX #..###### only). */
export function listAuthoringDocSections(body: string): AuthoringDocSection[] {
	const lines = body.split("\n");
	const sections: AuthoringDocSection[] = [];
	let current: AuthoringDocSection | undefined;
	for (const line of lines) {
		const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
		if (match) {
			if (current) sections.push(current);
			const heading = match[2] ?? "";
			current = {
				heading,
				anchor: authoringHeadingAnchor(heading),
				level: (match[1] ?? "#").length,
				body: `${line}\n`,
			};
			continue;
		}
		if (current) current.body += `${line}\n`;
	}
	if (current) sections.push(current);
	return sections;
}

/**
 * Return one section of a doc body by heading text or anchor (first match).
 * Matching is case-insensitive; heading may be a substring of the full heading.
 */
export function extractAuthoringDocSection(
	body: string,
	section: string,
): AuthoringDocSection | undefined {
	const needle = section.trim().toLowerCase();
	const needleAnchor = authoringHeadingAnchor(section);
	if (!needle) return undefined;
	const sections = listAuthoringDocSections(body);
	return (
		sections.find(
			(s) =>
				s.heading.toLowerCase() === needle ||
				s.anchor === needleAnchor ||
				s.heading.toLowerCase().includes(needle),
		) ?? undefined
	);
}

export function listAuthoringExamples(): AuthoringExample[] {
	return [...EXAMPLES];
}

export function getAuthoringExample(id: string): AuthoringExample | undefined {
	return EXAMPLES.find((example) => example.id === id);
}

export function queryAuthoringExamples(
	query: string,
	limit = 5,
): CorpusQueryResult<AuthoringExample>[] {
	const queryTerms = terms(query);
	return EXAMPLES.map((example) => ({
		item: example,
		score: scoreText(queryTerms, [example.id, example.intent, example.tags.join(" ")]),
	}))
		.filter((result) => result.score > 0)
		.sort((a, b) => b.score - a.score || a.item.id.localeCompare(b.item.id))
		.slice(0, limit);
}
