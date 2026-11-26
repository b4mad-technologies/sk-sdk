# Manifest format

<!-- Synced by scripts/sync-grimoire-reference-docs.mjs from b4mad-technologies/sk-grimoire docs/manifest-format.md at commit 7c157a7978b1a568e03e5470285259390dee5574. Do not edit by hand. -->

A Spellkave content bundle is a set of TOML manifests. This page lists the
top-level fields and every row kind a manifest may hold. It comes from
`spellkave_schema::manifest_json_schema()`; the descriptions are the doc
comments of `crates/spellkave-schema`. Fields whose name ends in `_source`
hold DSL text, described in [the DSL grammar](dsl-grammar.md).

## Required header

Every manifest starts with the schema line and the schema version.

```toml
#:schema https://spellkave.dev/schema/world-manifest-1.0.0.json
schema_version = "1.0.0"
```

## Applyset

A root manifest names the applyset it belongs to in the top-level field
`applyset`, right after the header:

```toml
applyset = "srd"
```

Only the root declares it. An `[[include]]` fragment that sets `applyset` is
rejected. How `sk diff` and `sk apply` use the applyset is described in the
`sk` command-line documentation of sk-sdk.

## Top-level fields

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `applyset` | no | `string` or `null` |  | ADR-0145 D-1: the applyset a ROOT manifest belongs to — the key of the server's applyset memory, named by the author (like kubectl's `--applyset`). Optional in the schema, required by every applyset apply (`sk dev seed\|up`, `sk apply`); an included fragment must not set it (the include loaders reject that). The apply reducers ignore it. |
| `metadata` | no | table of [`MetadataValue`](#metadatavalue) | `{}` |  |
| `schema_version` | yes | [`SchemaVersion`](#schemaversion) |  |  |

## Rows

Each row kind is an array of tables: `[[name]]`.

### action_definition_tag

`[[action_definition_tag]]`, schema type `ActionDefinitionTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `action_id` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### action_definitions

`[[action_definitions]]`, schema type `ActionDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `action_id` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `cost_time_ms` | no | `integer` | `0` |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `non_steering` | no | `boolean` |  | Explicit author assertion that this action's target writes are non-steering and therefore do not require a target claim. False keeps the conservative runtime classifier. Marking a hostile effect true is a content-authoring bug, not a kernel inference. |
| `on_failure` | no | `string` | `""` |  |
| `on_success` | yes | `string` |  |  |
| `reaction_eligibility` | no | `string` or `null` | `null` | Action-economy (batch 2, slice E): the §8.4 WHO-may-react axis — a DSL predicate over a candidate reactor's own fields/capabilities. Absent → not a reaction candidate. Consumed by the deferred reaction producer (slice E). Warden cond. 3 retired a MISPLACED affordance-cache field that was named `reaction_trigger`; the §8.4 `reaction_trigger` axis below is a distinct, correctly-placed `action_definition` field (slice F-impl). |
| `reaction_trigger` | no | `string` or `null` | `null` | Action-economy (batch 2, slice F-impl): the §8.4 WHAT-provokes axis — a DSL predicate over the TRIGGERING event's generic facts (`$event.kind`, `$event.detail.<field>`), distinct from `reaction_eligibility` (WHO). Absent / empty → provoke on every co-located trigger (lenient, slice-E behaviour preserved). The producer evaluates it ONCE per event against the populated intent facts; a Global-locality read (`world.*`/`session.*`) is rejected at validation (MF-VAL-239 — `$event.*` is bounded, not Global). |
| `reaction_window_ms` | no | `integer` or `null` | `null` | Action-economy: how long the reaction window stays open, in ms. Absent with a non-null `reaction_eligibility` → an implementation default. |
| `required_capability` | yes | `string` |  |  |
| `resolution_mode` | no | [`ActionResolutionModeRow`](#actionresolutionmoderow) | `"Deterministic"` |  |
| `resolution_predicate_source` | no | `string` | `""` | Authored Spellkave-DSL boolean expression evaluated once at the Stochastic resolution seam (replaces dormant resolution_check/dc). |
| `resolution_scope` | no | `string` |  | Open authored scope for actor-side resolution modifiers. Empty means the action has no narrower scope beyond the universal actor axis. |
| `resumable` | no | `boolean` | `false` | Interrupted progress may be credited on the next matching promotion. |
| `self_eligible` | no | `boolean` | `false` | Whether this reaction may include the acting actor as its own reactor. |
| `self_only` | no | `boolean` | `false` | ADR-0075 (amends ADR-0060 D-3): this manipulate action targets ONLY the acting actor — the materialiser fanout and the `r_manipulate` act-gate both exclude every distinct co-located entity (and every place/world target). Implies self-admission (no need to also set `self_eligible`). Absent/false = unchanged ADR-0060 behaviour; additive, existing rows omit it and stay byte-identical. |
| `session_def_id` | no | `string` | `""` |  |
| `spends_channel` | no | `string` or `null` | `null` | Action-economy (P2, ADR-0037 D-6 second Postscript): an open FK into `economy_channel_definitions.id` — the channel a triggered (`r_react`) reaction consumes. Absent → unmetered (byte-identical Tier-1 producer behaviour). When present and resolving to an off-turn-eligible class, the reaction producer opens a `pending_resolution` window only if the reactor has remaining budget this round, and `commit_pending_resolution` consumes the budget (capacity-guarded). Mirrors the content-neutral `AffordanceTemplateRow.spends_channel`; the kernel reads the id + the channel `off_turn_eligible` bool, never the literal "reaction". |

### actor_capabilities

`[[actor_capabilities]]`, schema type `ActorCapabilityRow`.

Brief 11 D10: `actor_entity_key` is the manifest key for the body entity (resolved to entity_id at apply time). D5: `proficiency` dropped — binary capability gate only; graduation lives in an attribute block.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `actor_entity_key` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `capability_id` | yes | `string` |  |  |
| `elevation_class` | no | `string` | `""` | reached only via broadening (never via direct control) — `""`/absent means `Hidden`-only elevation (the safe default); `"internal"` (or `"full"`) means `Internal` + ungated `Discoverable`, today's ADR-0081 D-3 behavior, reserved for grants that are actually DM/oversight-shaped. Meaningless without a non-empty `extent_ref`. |
| `extent_kind_ref` | no | `string` | `""` | Open vocabulary kind for `extent_ref`, resolving through `extent_kind_definition.kind_id`. Empty preserves legacy place-graph interpretation for existing manifests. |
| `extent_ref` | no | `string` | `""` | ADR-0007 D-4 authored see-as scope reference. Names a place graph; omitted or empty means the grant broadens no visibility. |
| `source` | yes | `string` |  |  |
| `source_args_hash` | no | `string` | `""` |  |
| `visibility` | no | `string` or `null` | `null` | ADR-0120 read-visibility override for this concrete grant (mirrors `[[object_state]].visibility`). `None` (field omitted) resolves at manifest commit to the owning `capability_definition.default_visibility` (falling back further to `Public` if no definition row exists) — see `capability_default_visibility` (#1935). `Some(_)` always wins. |

### actor_equipment_slots

`[[actor_equipment_slots]]`, schema type `ActorEquipmentSlotRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `actor_entity_key` | yes | `string` |  |  |
| `item_key` | yes | `string` |  |  |
| `slot_id` | yes | `string` |  |  |

### actor_identities

`[[actor_identities]]`, schema type `ActorIdentityRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_key` | yes | `string` |  |  |
| `identity` | yes | `string` |  |  |
| `provenance` | no | `string` or `null` |  | Omitted authored bindings are Service; runtime claims are Person. |
| `role` | yes | `string` |  |  |

### actor_spatial_locations

`[[actor_spatial_locations]]`, schema type `ActorSpatialLocationRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_key` | yes | `string` |  |  |
| `place_node_id` | yes | `string` |  |  |
| `selection_path` | no | `string` | `""` |  |

### actors

`[[actors]]`, schema type `ActorRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — e.g. "the guard with the limp". Open string, never load-bearing. |
| `entity_key` | yes | `string` |  |  |
| `name` | yes | `string` |  |  |

### affordance_template_participants

`[[affordance_template_participants]]`, schema type `AffordanceTemplateParticipantRow`.

Template-owned participant declaration (ADR-0132). Open `role_id` maps to one exact equipped-slot selector. Composite identity is `(template_id, role_id)`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `role_id` | yes | `string` |  |  |
| `slot_id` | yes | `string` |  |  |
| `template_id` | yes | `string` |  |  |

### affordance_templates

`[[affordance_templates]]`, schema type `AffordanceTemplateRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `accepts_global_storm` | no | `boolean` | `false` | Modder opt-in: acknowledges that this template's predicate classifies as `Global` and may dirty all actors with the required capability. |
| `bundle_id` | yes | `string` |  |  |
| `capability_id` | yes | `string` |  |  |
| `composes` | no | array of `string` or `null` | `null` | Action-economy: ordered sub-`affordance_template` ids this template unrolls at resolve time (the Multiattack shape). Absent → not composing. Validation rejects cycles + dangling sub-ids. Consumed by the slice-D resolver unroll. |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `locality_class` | no | `string` | `""` | Validator-assigned locality class (written during manifest validation, read by the materialiser at runtime). One of: Local, Place, Family, Global. |
| `movement_cost_expression_source` | no | `string` | `""` | ADR-0101 D-1/D-4: authored DSL int expression (`Outcome` kind, same shared crate as `predicate_source`) that multiplies the traversal edge's authored/metric distance when this template charges movement. Parsed at manifest commit next to `predicate_source` (FATAL on parse/type error). Empty ⇒ multiplier 1 (today's static-cost behaviour, unchanged). The kernel never interprets a state id or literal as "difficult terrain" — which state counts and how two difficult endpoints combine is entirely the author's expression. |
| `niche_id` | yes | `string` |  |  |
| `outcome_template_id` | yes | `string` |  |  |
| `predicate_bool` | no | `boolean` | `false` |  |
| `predicate_source` | no | `string` | `""` | DSL source text for this template's predicate (empty → `true`). |
| `range_m` | no | `number` | `0.0` | Metric reach for spatial targets, in place-node embedding units (ADR-0053). `0.0` preserves touch/same-node reachability. |
| `reads_occupancy` | no | `boolean` | `false` | Validator-computed verdict for whether the predicate reads a co-located-count / occupancy fact. Runtime arrival scoping reads this stored value; it never re-walks predicate ASTs at frame time. |
| `recharges_on` | no | `string` or `null` | `null` | Action-economy: recharge boundary (`turn_start` \| `turn_end`) after a successful fire; absent → no recharge clock. Closed set is enforced validator-side (no Rust enum, ADR-0018). Consumed by the recharge clock. |
| `spends_channel` | no | `string` or `null` | `null` | Action-economy (batch 2): the action class this affordance draws from the actor's per-round channel pool (FK → `economy_channel_definitions.id`). Absent → no budget gate fires. The budget gate reads this from the resolved template, never from the materialised `affordance` cache (ADR-0011 D-3). Consumed by the slice-C budget gate. |
| `stratification_ok` | no | `boolean` | `true` | Whether the predicate-dependency graph is cycle-free (stratified). `true` when the validator finds no SCC of size > 1 involving affordance. |
| `template_id` | yes | `string` |  |  |

### anchor_kind_definitions

`[[anchor_kind_definitions]]`, schema type `AnchorKindDefinitionRow`.

Authoring shape for `anchor_kind_definition` (Issue #336).

Modders add new anchor-kind vocabulary by writing `[[anchor_kind_definitions]]` rows in their bundle TOML. The kernel dispatches by `resolution_shape` (`H3Cell` / `PlaceNode`), not by `kind_id`. Core anchor kinds ship as seeded rows under `bundle_id="core"` — modders should NOT re-author those.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` | `""` |  |
| `kind_id` | yes | `string` |  |  |
| `resolution_shape` | yes | `string` |  | Parse/resolution handler. Must be one of `"H3Cell"` / `"PlaceNode"` (the closed `AnchorResolutionShape` enum). The manifest loader rejects unknown values. |

### area_shape_definitions

`[[area_shape_definitions]]`, schema type `AreaShapeDefinitionRow`.

Item 29 — area-shape vocabulary row. `parameter_schema_json` is a JSON object keyed by parameter name, valued by type hint (e.g. `{"radius_m":"f32"}`).

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` | `""` |  |
| `parameter_schema_json` | yes | `string` |  |  |
| `shape_id` | yes | `string` |  |  |

### audience_kind_definitions

`[[audience_kind_definitions]]`, schema type `AudienceKindDefinitionRow`.

ADR-0142 D-1/D-4 — audience vocabulary row. `resolution_shape` is one of the closed K-5 arms `DirectedTrace` | `Broadcast`; `audience_kind_id` stays an open authored string (ADR-0018 D-1).

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `audience_kind_id` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `description` | yes | `string` |  |  |
| `resolution_shape` | yes | `string` |  |  |

### autonomy_jobs

`[[autonomy_jobs]]`, schema type `AutonomyJobRow`.

Authored ambient autonomy job (ADR-0041). `dsl_function` names an effect definition. (the bridge); the validator fences it to autonomy-eligible (ambient) effects per ADR-0004 D-2 — a clock-fire has no acting subject, so it never targets an actor.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `anchor_place_node_id` | no | `string` or `null` | `null` | Optional captured spatial anchor for subject-bound autonomy fires. The value is a `place_node.node_id` captured when the job is scheduled. |
| `bundle_id` | yes | `string` |  | Owning mod bundle (cleared/reinserted on re-apply). |
| `description` | no | `string` | `""` | Human-readable description for operator tooling. |
| `dsl_function` | yes | `string` |  | DSL handle — resolves to an `effect_definition.effect_def_id` at fire time. |
| `enabled` | no | `boolean` | `true` | When `false`, the dispatcher skips this job. |
| `fire_at_boundary` | no | `string` | `""` | Named boundary that fires this job. Present with `owner_actor` only for the boundary-relative mode; absolute jobs leave it absent. |
| `frequency_ms` | yes | `integer` |  | Absolute jobs recur every N fiction milliseconds. Across both firing modes, `0` = one-shot (fire once, then delete); a non-zero boundary-armed job rearms for its next matching owner boundary. |
| `job_id` | yes | `string` |  | Stable namespaced identifier (PK in `autonomy_job`). |
| `next_fire_at_ms` | no | `integer` or `null` | `null` | Absolute fiction time at which this job fires. Present only for the clock-driven mode; boundary-armed jobs leave it absent. |
| `notable` | no | `boolean` | `false` | Author-set curation bit — a successful fire stamps `world_event.notable`. |
| `owner_actor` | no | `integer` | `0` | Actor owning `fire_at_boundary`. The boundary engine dispatches only rows matching this owner and boundary. |
| `payload_json` | no | `string` | `""` | JSON parameters forwarded to the effect on each fire. `""` if parameterless. |
| `priority` | no | `integer` | `0` | Dispatch order when several jobs share a tick (lower = earlier). |
| `repeats_remaining` | no | `integer` or `null` | `null` | Bounded-recurrence counter. Omitted / `None` = unbounded. |
| `requires_subject_alive` | no | `boolean` | `false` | When true, the dispatcher cancels this job if `subject` is absent or no longer alive at fire time. |
| `source` | no | `string` | `"manifest"` | Origin for cancel-by-source lookup. `"manifest"` for authored rows. |
| `subject` | no | `integer` or `null` | `null` | Optional responsible actor for subject-bound autonomy fires. The value is an `entity.entity_id` (normally the caster captured at schedule time). |
| `subject_entity_key` | no | `string` | `""` | Manifest-authoring alternative to `subject` (authored-hazard-pulses D-3): the `entity_key` of an `[[entities]]` row in the same manifest, resolved to its numeric `entity_id` at commit through the same-apply `entity_ids` map (the idiom `actor_equipment_slots.actor_entity_key` / `actor_capabilities.actor_entity_key` already use). Empty string = unused. A row that is unresolvable, or that sets both `subject` and a non-empty `subject_entity_key`, is rejected at apply. No manifest author can hardcode a fresh entity's runtime id, so this is the only way to author a subject-bound job (e.g. a hazard pulse) whose subject is spawned by the same manifest rather than captured by a cast. |

### binding_preconditions

`[[binding_preconditions]]`, schema type `BindingPrecondition`.

Caller-reviewed preimage and stable retry correlation for one binding transfer.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `binding_id` | yes | `string` |  |  |
| `expected_digest` | yes | `string` |  |  |
| `expected_incarnation` | yes | `string` |  |  |
| `expected_merged_role_digest` | yes | `string` |  |  |
| `expected_revision` | yes | `integer` |  |  |
| `reason` | yes | `string` |  |  |
| `request_id` | yes | `string` |  |  |

### boundary_definitions

`[[boundary_definitions]]`, schema type `BoundaryDefinitionRow`.

Authoring shape for `boundary_definitions` (CR-12 / LR-1; batch-2 condition-4 carrier).

Reset-boundary vocabulary: the named moments at which an action class's budget resets (`economy_channel_definitions.resets_on`, and later slice B's `recharges_on` / `fire_at_boundary`). `id` IS the boundary token (`turn_start`, `short_rest`, a modder's `encounter_end`). Modders extend the vocabulary by authoring a row, never by editing Rust — the legal set is data, not a `const &[&str]` (ADR-0018 D-1).

Deliberately NOT applied to a server table: the kernel fires only the boundaries it knows from its own clock (slice B's `TurnStart` / `TurnEnd`), so no runtime table consumer exists and a vocabulary table would be a zero-consumer fossil. This row kind is parsed-and-validated only — the table-granularity form of slice A's deferred-field pattern (the four `affordance_template` / `action_definition` fields deserialize but store nowhere yet). The validator builds the legal set from these rows, scoped by `bundle_id` through the same `depends_on` closure every cross-bundle reference uses.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` | `""` |  |
| `id` | yes | `string` |  |  |

### bundles

`[[bundles]]`, schema type `BundleRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `allow_flat_tags` | no | `boolean` | `false` | Opts out of the dot-namespace convention for tags. Defaults to `false`. |
| `author` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `default_extent_params_json` | no | `string` | `""` |  |
| `default_extent_shape_id` | no | `string` | `""` | Bundle-level default extent shape reference (place-node-extent, D-2): a `place_node` with no authored `extent_shape_id` resolves its extent from here. Empty = the bundle carries no default (a node with neither is a well-formedness failure, not a silent absence). |
| `depends_on` | no | array of `string` | `[]` |  |
| `description` | no | `string` | `""` |  |
| `display_name` | yes | `string` |  |  |
| `tag_prefixes` | no | array of [`TagPrefixDeclaration`](#tagprefixdeclaration) | `[]` | Bundle-owned tag-vocabulary namespaces (`tag-vocabulary-declaration` change, Decision 1). Empty = the bundle declares no namespace of its own; downstream tooling (validator, `sk` CLI, shared author tools) treats an undeclared bundle exactly as it did before this field existed. |
| `version` | yes | `string` |  |  |

### capability_definition_tag

`[[capability_definition_tag]]`, schema type `CapabilityDefinitionTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `capability_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### capability_definitions

`[[capability_definitions]]`, schema type `CapabilityDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `actor_kind` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `capability_id` | yes | `string` |  |  |
| `default_visibility` | no | `string` | `"Public"` | ADR-0120 read-visibility default for capabilities of this vocabulary. Concrete grants inherit this unless an authored `[[actor_capabilities]]` row overrides it. Omitted → `"public"`. |
| `description` | yes | `string` |  |  |
| `display_name` | yes | `string` |  |  |

### combat_grid_blueprints

`[[combat_grid_blueprints]]`, schema type `CombatGridBlueprintRow`.

Reusable session-grid authoring surface. Runtime opens still mint an ephemeral ADR-0052 place graph; this row only supplies the default geometry and generated-edge policy.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `accepts_stacked_occupancy` | no | `boolean` | `false` | ADR-0134 D-3: the kernel no longer vetoes a step onto an occupied cell; occupancy is a clause the edge template authors through `occupants_at(...)`. A blueprint whose `edge_affordance_template_id` template reads no `occupants_at` therefore lets actors stack, and the validator refuses that silently permissive shape (MF-VAL-333) unless the author states the intent here (the ADR-0027 D-1 `accepts_global_storm` pattern: intent lives in a manifest column, not in a no-op predicate). Default `false`. |
| `blueprint_id` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `cell_size_m` | no | `number` | `1.524` |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `distance_metric_id` | no | `string` or `null` |  | ADR-0134 D-1: `distance_metric_definition.metric_id` the minted grid measures pairwise node distances under (e.g. `core/metric/chebyshev` for SRD 5.2's "every square is 5 ft"). Omitted ⇒ Euclidean, the ADR-0053 D-2 formula. An unknown id is a validation error (MF-VAL-332). |
| `edge_affordance_bindings_json` | no | `string` | `"{}"` |  |
| `edge_affordance_template_id` | yes | `string` |  |  |
| `edge_overrides_json` | no | `string` | `"[]"` |  |
| `height` | yes | `integer` |  |  |
| `topology` | no | `string` | `"4"` |  |
| `width` | yes | `integer` |  |  |

### condition_capability_extent_grants

`[[condition_capability_extent_grants]]`, schema type `ConditionCapabilityExtentGrantRow`.

While an admitted condition is active on a body, derive this capability and extent at the Hidden disclosure floor. Stored grant ceilings are unchanged. The four reference fields form the storage key; bundle_id owns the rule.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `capability_id` | yes | `string` |  |  |
| `condition_definition_id` | yes | `string` |  |  |
| `extent_kind_ref` | yes | `string` |  |  |
| `extent_ref` | yes | `string` |  |  |

### condition_definition_tag

`[[condition_definition_tag]]`, schema type `ConditionDefinitionTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `condition_definition_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### condition_definitions

`[[condition_definitions]]`, schema type `ConditionDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `condition_definition_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `gate_predicate_source` | yes | `string` |  |  |
| `grants_capability_while_active` | no | array of `string` | `[]` | Capability ids granted to the bearer while it carries an active instance of this condition (Brief 11 D8). sk-syo made this field REAL. It shipped as dead metadata — written by the manifest committer, read by nothing — which is worse than absent, because an author trusts a field that validates and seeds cleanly and then silently does nothing. It also shipped as a CSV-in-a-`String`; it is now the list it always was. Why this is not redundant with the `ApplyStatus` + `actor.status(...)` idiom: an `affordance_template` carries a STRUCTURAL `capability_id` gate — without the capability the affordance is never offered at all. A status is only a fact that each predicate must remember to read. A ring that grants a spell is therefore expressible here and NOT expressible as a status without hand-wiring the gate into every affordance. |
| `hooks` | no | array of [`ConditionHookRow`](#conditionhookrow) | `[]` |  |
| `implies` | no | array of `string` | `[]` | Condition cascade — SRD-canonical "implies" edge. When this condition is applied to a target via `ApplyStatus`, each id listed here is also applied to the same target (recursively, with cycle + duplicate guards). Empty `Vec` = no cascade. Probe motivation: SRD §490 ff. — Paralyzed implies Incapacitated; Unconscious implies Incapacitated + Prone; Petrified implies Incapacitated. The implementing slice (srd-conformance-probe Phase 24 / Direction R) lands the field, the manifest wiring, and the cascading insert in `apply_status::execute`. The remove path and reference-counting semantics are deferred to a follow-up (issue #290 Axis 3 open design question). |
| `modifier_template_id` | no | `string` | `""` |  |
| `observable` | no | `boolean` | `true` |  |
| `remove_time_policy` | no | `string` | `"core/remove_policy/independent_lifetime"` |  |
| `stacking_rule` | no | `string` | `"core/stacking/single"` |  |
| `suppresses_capability_while_active` | no | array of `string` | `[]` | Capability ids SUPPRESSED on the bearer while it carries an active instance of this condition — the negative twin of `grants_capability_while_active`, and the reason sk-syo exists. The two are not interchangeable: granting ADDS to an open vocabulary, suppressing SUBTRACTS from it. Expressing a grant as a suppression would mean first giving every entity every conceivable capability and then masking, which an open vocabulary cannot do. Applies to the bearer AS AN ACTOR only. A condition that stops a creature acting must not stop it being acted UPON: "Speak with Dead" is the caster's affordance targeting a corpse that is itself Incapacitated, and must stay authorable. `capability_ids_for_actor` enforces that split — the Target-subject fact pool never applies it. |

### condition_remove_policy_definitions

`[[condition_remove_policy_definitions]]`, schema type `ConditionRemovePolicyDefinitionRow`.

`[[condition_remove_policy_definitions]]` rows in a bundle TOML. A condition's `remove_time_policy` resolves to one of these rows; the removal path evaluates `remove_predicate` instead of branching on policy ids.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `policy_id` | yes | `string` |  |  |
| `remove_predicate_source` | yes | `string` |  |  |

### consequence_frame_writes

`[[consequence_frame_writes]]`, schema type `ConsequenceFrameWriteRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `frame_write` | yes | any value |  | Externally tagged frame operation; the unit BreakPlaceSeal is a JSON/TOML string. |
| `ordinal` | yes | `integer` |  |  |
| `template_id` | yes | `string` |  |  |

### consequence_templates

`[[consequence_templates]]`, schema type `ConsequenceTemplateRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `effect_refs_csv` | no | `string` |  |  |
| `template_id` | yes | `string` |  |  |
| `traces_json` | no | `string` |  |  |

### containment_policy_definition

`[[containment_policy_definition]]`, schema type `ContainmentPolicyDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `access_predicate_source` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `exposure_predicate_source` | yes | `string` |  |  |
| `policy_id` | yes | `string` |  |  |

### coordinate_kind_definitions

`[[coordinate_kind_definitions]]`, schema type `CoordinateKindDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `coordinate_kind_id` | yes | `string` |  |  |
| `description` | no | `string` | `""` |  |

### distance_metric_definitions

`[[distance_metric_definitions]]`, schema type `DistanceMetricDefinitionRow`.

ADR-0134 D-1 — one authored distance metric. `metric_shape` names the closed kernel formula (`Euclidean` | `Chebyshev` | `Manhattan`); the commit path and validator reject any other value.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` | `""` |  |
| `metric_id` | yes | `string` |  |  |
| `metric_shape` | yes | `string` |  |  |

### dsl_macro_definitions

`[[dsl_macro_definitions]]`, schema type `DslMacroDefinitionRow`.

A reusable typed DSL expression fragment. The macro-aware compiler owns parsing and expansion; this manifest row is deliberately just the durable, lossless authoring definition it receives.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `body_source` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  |  |
| `macro_id` | yes | `string` |  |  |
| `parameters` | no | array of [`DslMacroParameterRow`](#dslmacroparameterrow) | `[]` |  |
| `return_type` | yes | `string` |  |  |

### economy_channel_definitions

`[[economy_channel_definitions]]`, schema type `EconomyChannelDefinitionRow`.

Action-economy (batch 2): a per-turn action budget class. The `core` bootstrap ships `standard`/`bonus`/`reaction`/`free`; modders may author their own (e.g. a "swift" channel) with no Rust change (ADR-0018). Mirrors the live `economy_channel_definitions` table.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `id` | yes | `string` |  |  |
| `off_turn_eligible` | no | `boolean` | `false` | An economy channel whose actions are usable OFF-TURN — offered and resolvable through `r_manipulate` even when it is not the actor's turn in a scoped session (the reaction shape). Default `false` = turn-gated (the D-6 behaviour; every existing class stays unchanged). Set `true` on `srd/action_class/reaction`. The budget is still consumed off-turn, so the per-turn allowance stays metered (ADR-0037 D-6 Postscript, 2026-06-28). |
| `pool_ms_per_round` | yes | `integer` |  |  |
| `resets_on` | yes | `string` |  | When this channel's pool resets. The vocabulary is authored, never a Rust enum (ADR-0018). |

### effect_definitions

`[[effect_definitions]]`, schema type `EffectDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `effect_def_id` | yes | `string` |  |  |
| `parameters_schema_json` | no | `string` | `"{}"` |  |
| `primitives_csv` | yes | `string` |  |  |

### entities

`[[entities]]`, schema type `EntityRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — e.g. "the guard with the limp". Open string, never load-bearing. |
| `entity_def_id` | no | `string` | `""` |  |
| `entity_key` | yes | `string` |  |  |
| `kind` | yes | [`EntityKindRow`](#entitykindrow) |  |  |
| `name` | yes | `string` |  |  |
| `owned_by_entity_key` | no | `string` | `""` |  |
| `place_node_id` | yes | `string` |  |  |
| `quantity` | no | `integer` | `1` |  |

### entity_containment

`[[entity_containment]]`, schema type `EntityContainmentRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `container_entity_key` | yes | `string` |  |  |
| `direction` | no | `string` | `""` |  |
| `entity_key` | yes | `string` |  |  |
| `slot_id` | no | `string` | `""` |  |

### entity_containment_policy

`[[entity_containment_policy]]`, schema type `EntityContainmentPolicyRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_key` | yes | `string` |  |  |
| `policy_id` | yes | `string` |  |  |

### entity_definition_containment_policy

`[[entity_definition_containment_policy]]`, schema type `EntityDefinitionContainmentPolicyRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_def_id` | yes | `string` |  |  |
| `policy_id` | yes | `string` |  |  |

### entity_definition_equip_modifier

`[[entity_definition_equip_modifier]]`, schema type `EntityDefinitionEquipModifierRow`.

Applies the modifier to the wearer while the matching item is equipped.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_def_id` | yes | `string` |  | FK into `entity_definition.entity_def_id` — the item. |
| `modifier_template_id` | yes | `string` |  | FK into `modifier_template.modifier_template_id`. |

### entity_definition_initial_capability

`[[entity_definition_initial_capability]]`, schema type `EntityDefinitionInitialCapabilityRow`.

Definition-level innate capability grant (#728). Each row grants an unconditional capability to an `entity_definition`; at admission/spawn every placed instance is born holding a `capability` row keyed on its `entity_id` (entity-anchored per ADR-0028 erratum). A seed table, NOT a CSV column on `EntityDefinitionRow` (ADR-0028 freezes the `grants_capability_while_*` CSV grant surface as legacy).

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `capability_id` | yes | `string` |  |  |
| `entity_def_id` | yes | `string` |  |  |
| `extent_kind_ref` | no | `string` | `""` |  |
| `extent_ref` | no | `string` | `""` |  |

### entity_definition_initial_condition

`[[entity_definition_initial_condition]]`, schema type `EntityDefinitionInitialConditionRow`.

Definition-level initial condition seed. Each row binds a `condition_definition_id` (and optional `duration_ticks`) to an `entity_definition`; at admission/spawn every placed instance is born with a `target_condition` row. The server table existed but was previously absent from this `Manifest` author struct; this row kind makes it authorable.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `condition_definition_id` | yes | `string` |  |  |
| `duration_ticks` | no | `integer` | `0` | Duration in world ticks. `0` = no expiry (permanent condition). |
| `entity_def_id` | yes | `string` |  |  |

### entity_definition_initial_containment

`[[entity_definition_initial_containment]]`, schema type `EntityDefinitionInitialContainmentRow`.

Definition-level initial containment (sk-84i.3, parent sk-84i). Each row says: "when an entity of this `entity_def_id` is placed or spawned, spawn `quantity` of `contained_entity_def_id` and carry it (loose containment — no `slot_id`/`direction`, mirroring `entity_containment`'s carried-item shape) inside the new instance." The contained definition's OWN seeds (state/capability/condition/containment/equipment) apply recursively to the spawned contained instance, so a bandit's quiver can itself author bolts.

Quantity rule (mirrors `Entity.quantity` / ADR-0028 D-6, see `entity::validate_quantity_stack_tag`): when the contained definition is `stackable = true`, ONE instance is spawned carrying `quantity` as its stack count. When it is NOT stackable, `quantity` SEPARATE instances are spawned (each with its own `entity_id`, stack count 1) — the same distinction `[[entities]].quantity` already draws for authored instances.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `contained_entity_def_id` | yes | `string` |  | FK into `entity_definition.entity_def_id` — the definition to spawn and contain. |
| `entity_def_id` | yes | `string` |  |  |
| `quantity` | no | `integer` | `1` | How many to spawn (see quantity rule above). Default `1`. |

### entity_definition_initial_equipment

`[[entity_definition_initial_equipment]]`, schema type `EntityDefinitionInitialEquipmentRow`.

Definition-level initial equipment (sk-84i.3, parent sk-84i). Each row says: "when an entity of this `entity_def_id` is placed or spawned, spawn one instance of `equipped_entity_def_id`, contain it (loose carriage, same as `entity_definition_initial_containment`), and equip it into `slot_id` — inserting an `entity_equipment_slot` row on the new instance."

Use a named slot for equipment that should be immediately available. FRESH instance, never re-equips an already-live entity.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_def_id` | yes | `string` |  |  |
| `equipped_entity_def_id` | yes | `string` |  | FK into `entity_definition.entity_def_id` — the item definition to spawn and equip. |
| `slot_id` | yes | `string` |  | FK into `equipment_slot_definition.slot_id`. |

### entity_definition_initial_state

`[[entity_definition_initial_state]]`, schema type `EntityDefinitionInitialStateRow`.

Definition-level initial state-value seed (#729). Each row binds an initial state-value to an `entity_definition`; at admission/spawn every placed instance inherits an `object_state` row. Mirrors `ObjectStateRow`'s typed carriers (no `value_kind` string enum — ADR-0018). Carrier precedence at commit: `value_int` > `value_text` > `value_bool`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_def_id` | yes | `string` |  |  |
| `state_id` | yes | `string` |  |  |
| `value_bool` | no | `boolean` | `true` |  |
| `value_int` | no | `integer` or `null` | `null` |  |
| `value_text` | no | `string` or `null` | `null` |  |

### entity_definition_item_dsl_source

`[[entity_definition_item_dsl_source]]`, schema type `EntityDefinitionItemDslSourceRow`.

sk-84i.2 (widened G-1): one authored DSL-source slot on an `entity_definition` (e.g. `slot = "srd/damage"`, `source = "2d8"`). Validated at merge-gate (`MF-VAL-318`) and manifest commit like `predicate_source`/`outcome_expression_source` (a hard parse error fails the commit). The server persists the raw `source` plus a commit-time macro-expanded AST; act time evaluates the cached tree (#2218).

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_def_id` | yes | `string` |  |  |
| `slot` | yes | `string` |  | Content-side slot id (e.g. `"srd/damage"`) — opaque to the kernel. |
| `source` | yes | `string` |  | Raw DSL source text (e.g. `"2d8"`). |

### entity_definition_tag

`[[entity_definition_tag]]`, schema type `EntityDefinitionTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_def_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### entity_definitions

`[[entity_definitions]]`, schema type `EntityDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `affordance_seed_id` | no | `string` | `""` |  |
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `entity_def_id` | yes | `string` |  |  |
| `grants_capability_while_equipped` | no | `string` | `""` | Capability ids (CSV) granted to the bearer entity that equips this entity definition (Brief 11 D8 — authoring-side grant source). |
| `grants_capability_while_present_in_location` | no | `string` | `""` | Capability ids (CSV) granted to entities at locations where an entity of this definition is present (Brief 11 D8). |
| `lineage_id` | no | `string` | `""` |  |
| `on_consume_consequence_id` | no | `string` | `""` |  |
| `on_destroy_consequence_id` | no | `string` | `""` |  |
| `on_equip_consequence_id` | no | `string` | `""` | sk-ct8.3 / finding #37 (BL-19): `consequence_template_id` executed (via `apply_consequence_with_bindings`, `Actor` bound to the wearer) when an entity of this definition is equipped by ANY affordance — `EquipItem`'s own frame-write arm, not a separate action. Empty string = no hook. |
| `on_unequip_consequence_id` | no | `string` | `""` | Same shape as `on_equip_consequence_id`, fired on `UnequipItem` AND on `unequip_for_entity_cleanup` (drop/transfer/destroy) so a cursed ring's effect cannot be dodged by destroying the item instead of unequipping it. Empty string = no hook. |
| `slot_compatibility_predicate` | no | `string` | `""` | Closed three-form slot-compatibility grammar (ADR-0118), not `spellkave-dsl`. Empty/`true` = any slot; `false` = none; `slot_id == "<id>"` = that slot only. Evaluated by `spellkave_validate::equip_predicate`. |
| `stackable` | no | `boolean` | `false` | Whether authored entities of this definition may use `quantity > 1`. |

### entity_resource_bound

`[[entity_resource_bound]]`, schema type `EntityResourceBoundRow`.

Per-instance resource-bound OVERRIDE (#30 / sk-ct8.2 "per-creature HP maximum"). Row absent for an `(entity, resource_definition)` pair ⇒ the bundle-wide `resource_definitions.{min_value,max_value}` bounds apply unchanged (inheritance); row present ⇒ `ModifyResource`'s clamp AND the DSL `Op::ReadResourceMax`/`Op::ReadResourceMin` leaf ops (`actor.resource_max("<id>")`/`actor.resource_min("<id>")`) consult this row instead. Mirrors [`ObjectStateRow`]'s per-instance shape.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_key` | yes | `string` |  |  |
| `max_value` | yes | `integer` |  |  |
| `min_value` | yes | `integer` |  |  |
| `resource_definition_id` | yes | `string` |  |  |

### entity_tag

`[[entity_tag]]`, schema type `EntityTagRow`.

Authoring shape of a relational INSTANCE tag (`[[entity_tag]]`).

The instance sibling of the `*_definition_tag` rows above: those anchor on a definition id, this anchors on an authored entity instance via `entity_key` (an `[[entities]]` row in the same manifest). At apply the key resolves to the entity id and an `entity_tag` row is inserted. This replaces the removed inline `world_objects.tags` CSV form (CR-4, predating the #1968 B-10 retirement of the `[[world_objects]]` row kind itself) and is the CR-7 write leg; the `has_tag` DSL read leg lands in a later slice.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_key` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### equipment_slot_definitions

`[[equipment_slot_definitions]]`, schema type `EquipmentSlotDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `default_compatibility_predicate` | no | `string` | `""` |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `label` | yes | `string` |  |  |
| `slot_id` | yes | `string` |  |  |

### extent_kind_definitions

`[[extent_kind_definitions]]`, schema type `ExtentKindDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | yes | `string` |  |  |
| `kind_id` | yes | `string` |  |  |
| `resolution_shape` | yes | `string` |  |  |

### include

`[[include]]`, schema type `IncludeDirective`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `path` | yes | `string` |  |  |

### item_definitions

`[[item_definitions]]`, schema type `ItemDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `item_def_id` | yes | `string` |  |  |
| `slot_compatibility_predicate` | no | `string` | `""` |  |
| `slot_id` | no | `string` | `""` |  |

### location_definitions

`[[location_definitions]]`, schema type `LocationDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `cell_res10` | no | `integer` | `0` |  |
| `cell_res4` | no | `integer` | `0` |  |
| `cell_res7` | no | `integer` | `0` |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `interior_graph_id` | no | `string` | `""` |  |
| `location_def_id` | yes | `string` |  |  |
| `parent_def` | no | `string` | `""` |  |

### location_traces

`[[location_traces]]`, schema type `LocationTraceRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `location_def_id` | yes | `string` |  |  |
| `trace_kind_id` | yes | `string` |  |  |

### map_layers

`[[map_layers]]`, schema type `MapLayerRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `asset_module` | no | `string` | `""` |  |
| `asset_path` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `grid_distance_m` | no | `number` | `0.0` |  |
| `grid_size_px` | no | `integer` | `0` |  |
| `image_height_px` | no | `integer` | `0` |  |
| `image_origin_x` | no | `number` | `0.0` |  |
| `image_origin_y` | no | `number` | `0.0` |  |
| `image_width_px` | no | `integer` | `0` |  |
| `local_height_cells` | no | `number` | `0.0` |  |
| `local_width_cells` | no | `number` | `0.0` |  |
| `map_layer_id` | yes | `string` |  |  |
| `max_zoom` | no | `number` | `0.0` |  |
| `min_zoom` | no | `number` | `0.0` |  |
| `place_graph_id` | yes | `string` |  |  |
| `posture` | no | `string` | `""` |  |
| `rotation_deg` | no | `number` | `0.0` |  |
| `source_kind` | no | `string` | `""` |  |
| `state` | no | `string` | `""` |  |

### metadata_attachments

`[[metadata_attachments]]`, schema type `MetadataRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `namespace` | yes | `string` |  |  |
| `payload_json` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `target_kind` | yes | `string` |  |  |
| `target_ref` | yes | `string` |  |  |

### metadata_namespaces

`[[metadata_namespaces]]`, schema type `MetadataNamespaceRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `audience` | yes | `string` |  | Who may read this namespace (ADR-0130 D-3): a `VisibilityClass` token, the strict owner token `owned`, or a `capability_definition` id. |
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` or `null` |  |  |
| `namespace` | yes | `string` |  |  |
| `on_demand` | no | `boolean` |  | Reference content delivered only on request (ADR-0130 D-4). Absent → `false`. |

### modifier_target_definitions

`[[modifier_target_definitions]]`, schema type `ModifierTargetDefinitionRow`.

Authoring shape for `modifier_target_definition` (Item 15 / Issue #314).

Modders add new composition-axis vocabulary by writing `[[modifier_target_definitions]]` rows in their bundle TOML. The kernel composes by `shape` (`Numeric` / `Mode` / `Reference`), not by `target_id`. Core targets ship as seeded rows under `bundle_id="core"` — modders should NOT re-author those.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `shape` | yes | `string` |  | Fold algebra. Must be one of `"Numeric"` / `"Mode"` / `"Reference"` (the closed `ModifierTargetShape` enum). The manifest loader rejects unknown values. |
| `target_id` | yes | `string` |  |  |

### modifier_template_tag

`[[modifier_template_tag]]`, schema type `ModifierTemplateTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `modifier_template_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### modifier_templates

`[[modifier_templates]]`, schema type `ModifierTemplateRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `applies_to` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `delta_kind` | no | `string` | `"Plus"` | CR-3 / ADR-0038 lift: the `ModifierDelta` shape discriminant — was the `delta_kind=<X>` behaviour kv-tag. Closed value-set (`Advantage`, `Disadvantage`, `Plus`, `Times`, `FlatSet`, `Replace`); the validator rejects any other value (MF-VAL-243). Absent → `Plus`. |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `modifier_expression_source` | yes | `string` |  |  |
| `modifier_template_id` | yes | `string` |  |  |
| `predicate_source` | yes | `string` |  |  |
| `priority` | no | `integer` | `0` |  |
| `replace_template_id` | no | `string` or `null` | `null` | CR-3 / ADR-0038 lift: for `delta_kind = "Replace"`, the modifier_template id whose shape replaces this one — was the `replace_template=<id>` kv-tag. Open ref (absent → unset). Mirror of `affordance_template`'s action-economy `Option<String>` authoring fields. |

### movement_defaults

`[[movement_defaults]]`, schema type `MovementDefaultRow`.

`[[movement_defaults]]` — declares the default traversal mode set for a bundle (`place_graph_id` empty) or one place-graph (ADR-0101 D-1/D-2). Resolution per edge is EDGE > GRAPH > BUNDLE: the nearest scope that declares any default row supplies the whole default mode set, which the edge's own `place_edge_affordance` rows then refine (same `(mode_id, affordance_template_id)`) or AND-join (same mode, other template) or extend (new `mode_id`). Not a natural-keyed row kind — bundle-scoped clear-then-insert at commit, same discipline as `spatial_environment_state` (excluded from `ROW_KIND_NATURAL_KEY`, no single-column author identity).

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `affordance_template_id` | yes | `string` |  |  |
| `bindings_json` | no | `string` | `""` |  |
| `bundle_id` | yes | `string` |  |  |
| `mode_id` | no | `string` | `""` | Empty ⇒ the implicit default mode (ADR-0101 D-1). |
| `place_graph_id` | no | `string` | `""` | Empty ⇒ bundle scope; non-empty ⇒ scoped to this one `place_graph_id`. |

### niche_definition_tag

`[[niche_definition_tag]]`, schema type `NicheDefinitionTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `niche_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### niche_definitions

`[[niche_definitions]]`, schema type `NicheDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | yes | `string` |  |  |
| `display_name` | yes | `string` |  |  |
| `niche_id` | yes | `string` |  |  |
| `predicate_source` | no | `string` | `""` | DSL predicate source (empty → trivially-true; matches any candidate target). Added in Brief 11 D2 to replace `target_kind` pre-categorisation. |
| `provider` | no | `string` |  | actor-carried-verbs D1/D2 (canon-warden amendment): FK into `niche_provider_definition.provider_id` — WHO provides this niche (`place` \| `entity` \| `actor`). Empty resolves to `place`, preserving today's place-attachment-gated behaviour for every pre-existing niche. |

### object_state

`[[object_state]]`, schema type `ObjectStateRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `entity_key` | yes | `string` |  |  |
| `expires_at_tick` | no | `integer` | `0` |  |
| `source_template_id` | yes | `string` |  |  |
| `state_id` | yes | `string` |  |  |
| `value_bool` | no | `boolean` | `true` | Boolean carrier — legacy form. Default `true` preserves pre-§12.5b authoring where `[[object_state]]` rows were always flags. |
| `value_int` | no | `integer` or `null` | `null` | Numeric carrier (§12.5b — Brief 09 Slicing Step 1 lift to DslValue). When `Some(_)`, takes precedence over `value_bool` at manifest commit. Enables modder authoring of `value_int = 10` for HP / mana / charges. |
| `value_text` | no | `string` or `null` | `null` | String carrier (§12.5b). When `Some(_)` and `value_int` is `None`, commits as `DslValue::Text(_)`. Enables authoring of `value_text = "running"` for machine status etc. (Brief 12 machine-state-dissolution Example). |
| `visibility` | no | `string` or `null` | `null` | ADR-0120 read-visibility override for this concrete instance row. `None` (field omitted) resolves at manifest commit to the owning `object_state_definition.default_visibility` (falling back further to `Public` if no definition row exists) — see `object_state_default_visibility` (#1935). `Some(_)` always wins. |

### object_state_definition_tag

`[[object_state_definition_tag]]`, schema type `ObjectStateDefinitionTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `state_id` | yes | `string` |  |  |
| `tag` | yes | `string` |  |  |

### object_state_definitions

`[[object_state_definitions]]`, schema type `ObjectStateDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `default_visibility` | no | `string` | `"Public"` |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `state_id` | yes | `string` |  |  |
| `target_kind` | yes | `string` |  |  |

### outcome_graph_edges

`[[outcome_graph_edges]]`, schema type `OutcomeGraphEdgeRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `authored_order` | no | `integer` | `0` |  |
| `from_node_id` | yes | `string` |  |  |
| `guard_predicate_source` | no | `string` | `""` |  |
| `outcome_graph_edge_id` | yes | `string` |  |  |
| `outcome_graph_id` | yes | `string` |  |  |
| `to_node_id` | yes | `string` |  |  |

### outcome_graph_nodes

`[[outcome_graph_nodes]]`, schema type `OutcomeGraphNodeRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `authored_order` | no | `integer` | `0` |  |
| `node_id` | yes | `string` |  |  |
| `outcome_graph_id` | yes | `string` |  |  |
| `outcome_graph_node_id` | yes | `string` |  |  |
| `outcome_template_id` | no | `string` | `""` |  |
| `terminal` | no | `boolean` | `false` |  |

### outcome_graphs

`[[outcome_graphs]]`, schema type `OutcomeGraphRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `max_depth` | no | `integer` | `8` |  |
| `max_draws` | no | `integer` | `8` |  |
| `max_nodes` | no | `integer` | `32` |  |
| `outcome_graph_id` | yes | `string` |  |  |
| `root_node_id` | yes | `string` |  |  |

### outcome_template_tag

`[[outcome_template_tag]]`, schema type `OutcomeTemplateTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `outcome_template_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### outcome_templates

`[[outcome_templates]]`, schema type `OutcomeTemplateRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `communication_speech_act_id` | no | `string` |  |  |
| `consequence_template_id` | no | `string` | `""` | Optional consequence applied when this outcome template is committed by an outcome graph node. Empty means no graph-node effect. |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `discovery_validated` | no | `boolean` |  | CR-3 / ADR-0038 lift: whether a successful sense via this outcome marks the target's spatial discovery as *validated* — was the `sense.discovery=validated` behaviour kv-tag. Absent → `false`. |
| `display_name` | yes | `string` |  |  |
| `manipulation_action_id` | no | `string` |  |  |
| `movement_descriptor` | no | `string` |  |  |
| `outcome_bool` | no | `boolean` | `false` |  |
| `outcome_expression_source` | no | `string` |  | DSL outcome source (empty -> `outcome_bool` compatibility carrier). |
| `outcome_template_id` | yes | `string` |  |  |
| `sense_query_kind` | no | `string` |  |  |
| `sense_visibility` | no | [`VisibilityClass`](#visibilityclass) | `"local"` | Visibility carried by sensing affordances. Existing manifests default Local. |

### place_edge_affordance

`[[place_edge_affordance]]`, schema type `PlaceEdgeAffordanceRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `affordance_template_id` | yes | `string` |  |  |
| `bindings_json` | no | `string` | `""` |  |
| `edge_key` | yes | `string` |  |  |
| `mode_id` | no | `string` | `""` | Open author-chosen traversal-mode id (ADR-0101 D-1). Empty ⇒ the implicit default mode — every legacy row (authored before modes existed) keeps its pre-existing AND-chain meaning. Rows sharing one `(edge_key, mode_id)` compose as AND; the edge is traversable iff at least one mode passes (OR). Not a closed enum (ADR-0018): an author invents "swim"/"fly"/"wade" freely. |

### place_edges

`[[place_edges]]`, schema type `PlaceEdgeRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `cell_anchor` | no | `integer` | `0` |  |
| `cell_anchor_present` | no | `boolean` | `false` |  |
| `cell_anchor_u` | no | `number` | `0.0` |  |
| `cell_anchor_v` | no | `number` | `0.0` |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `edge_key` | yes | `string` |  |  |
| `from_anchor_offset` | no | `number` | `0.0` |  |
| `from_anchor_side` | no | `string` | `""` |  |
| `from_node_id` | yes | `string` |  |  |
| `inherit_movement_default` | no | `boolean` | `true` | ADR-0101 D-1/D-2: whether this edge receives the resolved `movement_default` mode set (edge > graph > bundle). `false` **replaces** the default entirely — the edge then owns its full mode set from its own `place_edge_affordance` rows alone (the fly-only chasm idiom). Defaults to `true` so every legacy edge keeps inheriting once a bundle/graph default is authored. |
| `place_graph_id` | yes | `string` |  |  |
| `pose_dt_elevation` | no | `number` | `0.0` |  |
| `pose_dt_elevation_present` | no | `boolean` | `false` |  |
| `substrate_crossing` | no | `boolean` | `false` |  |
| `to_anchor_offset` | no | `number` | `0.0` |  |
| `to_anchor_side` | no | `string` | `""` |  |
| `to_node_id` | yes | `string` |  |  |

### place_graph_instances

`[[place_graph_instances]]`, schema type `PlaceGraphInstanceRow`.

Compact place-graph instancing row (Item 25 D7).

Manifest-apply expands this row into concrete `place_graph` + `place_node` + `place_edge` rows by cloning a blueprint graph under a fresh id.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `anchor` | yes | [`SpatialRef`](#spatialref) |  | Spatial anchor for the instance root (e.g. h3 cell for a world root, or place-node anchor for nested composition). |
| `bearing_deg` | no | `number` or `null` | `null` | Optional clockwise rotation override in degrees. `None` keeps the blueprint's authored bearing. |
| `blueprint_id` | yes | `string` |  | FK → `place_graph_definition.place_graph_id` (must resolve to a blueprint row, not an already-instanced graph). |
| `bundle_id` | no | `string` or `null` |  | Applying bundle that owns every expanded instance row, independent of blueprint provenance. Omission is compatible with a single applying bundle or a blueprint authored in this manifest. A foreign blueprint in a multi-bundle apply requires an explicit owner (MF-VAL-373). |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing (no mechanic reads it; see `Manifest`'s doc comment for the class rule). |
| `instance_id` | no | `string` or `null` | `null` | Optional caller-provided instance graph id. When set, manifest apply uses it verbatim and rejects duplicates; when omitted, apply keeps the legacy timestamp-derived `<blueprint_id>#<short_hex>` fallback. |
| `override_params` | no | table of `string` or `null` | `null` | Optional override map. Known keys today: - `metres_per_unit`: f32 override for graph-unit→metre ratio - `node_display_name.<local_id>`: per-node display-name override |
| `parent_graph_id` | no | `string` or `null` | `null` | `None` means this instance is rooted at world level. `Some(id)` means this instance is a component of `id`. |

### place_graphs

`[[place_graphs]]`, schema type `PlaceGraphRow`.

Item 28 — metric place-graph embedding. `bearing` and `metres_per_unit` are opt-in: non-metric graphs omit them (defaults: 0.0 / 1.0 = identity). A graph is metric iff all its nodes carry `pos_present` — there is no stored flag column.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `anchor_node_id` | no | `string` | `""` | Anchor node (Brief 26 D3): FK → `place_node.node_id`. The eject-destination for entities displaced by `Despawn`. Must be non-empty for every authored graph. `serde(default)` permits the field to be absent in legacy rows (produces an empty string, caught by the doctor check at runtime). |
| `bearing` | no | `number` | `0.0` | Clockwise rotation in degrees; 0.0 = no rotation. |
| `blueprint_id` | no | `string` | `""` | Instancing (Item 25 D2): empty = this IS the blueprint; non-empty = instance stamped from that blueprint. |
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` | `""` |  |
| `display_name` | yes | `string` |  |  |
| `is_ephemeral_instance` | no | `boolean` | `false` |  |
| `metres_per_unit` | no | `number` | `1.0` | Ratio: how many world metres one graph-local unit represents; 1.0 = identity. |
| `origin_cell_res10` | no | `integer` | `0` |  |
| `origin_cell_res4` | no | `integer` | `0` |  |
| `origin_cell_res7` | no | `integer` | `0` |  |
| `parent_graph_id` | no | `string` | `""` | Composition (Item 25 D4): empty = root instance; non-empty = component of the named parent graph (self-FK). |
| `place_graph_id` | yes | `string` |  |  |
| `substrate_id` | yes | `string` |  |  |

### place_node_traces

`[[place_node_traces]]`, schema type `PlaceNodeTraceRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `node_id` | yes | `string` |  |  |
| `trace_kind_id` | yes | `string` |  |  |

### place_nodes

`[[place_nodes]]`, schema type `PlaceNodeRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `cell_res10` | no | `integer` | `0` |  |
| `cell_res4` | no | `integer` | `0` |  |
| `cell_res7` | no | `integer` | `0` |  |
| `description` | no | `string` | `""` |  |
| `display_name` | yes | `string` |  |  |
| `extent_params_json` | no | `string` | `""` |  |
| `extent_shape_id` | no | `string` | `""` | Authored extent shape reference (`area_shape_definition.shape_id`); empty = resolve via the owning bundle's default extent (`BundleRow::default_extent_shape_id`). Replaces the removed cell-denominated `size_w`/`size_h` (place-node-extent, D-1). |
| `is_ephemeral` | no | `boolean` | `false` |  |
| `local_id` | yes | `string` |  |  |
| `node_id` | yes | `string` |  |  |
| `place_graph_id` | yes | `string` |  |  |
| `pos_present` | no | `boolean` | `false` |  |
| `pos_x` | no | `integer` | `0` |  |
| `pos_y` | no | `integer` | `0` |  |
| `pose_elevation` | no | `number` | `0.0` |  |
| `pose_elevation_present` | no | `boolean` | `false` |  |
| `substrate_id` | yes | `string` |  |  |

### place_seals

`[[place_seals]]`, schema type `PlaceSealRow`.

A seal belongs to the bundle owning the graph's root. Instances inherit copies.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `break_reason` | no | `string` or `null` |  | Export-only audit reason, retained in the row hash for drift detection. |
| `broken` | no | `boolean` or `null` |  | Export-only runtime overlay; authored inputs carrying it are rejected. |
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` | `""` |  |
| `place_graph_id` | yes | `string` |  |  |

### prompt_definitions

`[[prompt_definitions]]`, schema type `PromptDefinitionRow`.

A dialogue prompt contract (ADR-0142). The locality fields mirror those on [`AffordanceTemplateRow`] (ADR-0027).

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `accepts_global_storm` | no | `boolean` | `false` | Modder opt-in acknowledging a `Global`-classified `open_predicate_source`. Not yet enforced at manifest commit (see struct doc). |
| `audience_kind_ref` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `contract_version` | no | `integer` | `0` |  |
| `open_predicate_source` | no | `string` | `""` |  |
| `prompt_def_id` | yes | `string` |  |  |
| `response_action_ids` | no | array of `string` | `[]` |  |
| `source_selector` | yes | `string` |  |  |
| `trace_window_ticks` | no | `integer` | `0` |  |

### resource_definition_tag

`[[resource_definition_tag]]`, schema type `ResourceDefinitionTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `resource_definition_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### resource_definitions

`[[resource_definitions]]`, schema type `ResourceDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `initial_value` | no | `integer` or `null` | `null` | Value used to seed a fresh `object_state` row when `ModifyResource` fires against an `(entity, resource)` pair that has no live row yet. `None` → fall back to `min_value` (today's semantics for charges / gold / temp-HP-shaped resources). `Some(v)` → seed at `v` (HP-shaped resources author `Some(max_value)`). |
| `max_value` | yes | `integer` |  |  |
| `min_value` | yes | `integer` |  |  |
| `recovery_rule` | yes | `string` |  |  |
| `resource_definition_id` | yes | `string` |  |  |
| `value_kind` | yes | `string` |  |  |

### retractions

`[[retractions]]`, schema type `RetractionRow`.

ADR-0085 D-6: one authored deletion tombstone. `row_kind` selects which commit-time cascade resolves `authored_key`; `authored_key` is the exact natural/provenance key the corresponding live table already stores (for `row_kind = "entity"`, this is `manifest_authored_entity.manifest_key`, i.e. `"{bundle_id}:{entity_key}"`. `spellkave-validate` checks the retraction vocabulary (`SUPPORTED_RETRACTION_ROW_KINDS` in `crates/spellkave-validate/src/retractions.rs`) and rejects any other `row_kind` Fatal rather than silently accepting a tombstone the server cannot execute.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `authored_key` | yes | `string` |  |  |
| `row_kind` | yes | `string` |  |  |

### role_aggregations

`[[role_aggregations]]`, schema type `RoleAggregationRow`.

A bundle-owned contribution to an existing role's capability set.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `capability_ids` | yes | array of `string` |  |  |
| `description` | yes | `string` |  |  |
| `role_id` | yes | `string` |  |  |

### role_bindings

`[[role_bindings]]`, schema type `RoleBindingRow`.

A named role bound to an identity or an authored non-player actor over an extent. Realisation is server state, never an author-controlled field.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `binding_id` | yes | `string` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `description` | yes | `string` |  |  |
| `expires_at_tick` | no | `integer` or `null` | `null` |  |
| `extent_kind_ref` | no | `string` | `""` |  |
| `extent_ref` | yes | `string` |  |  |
| `handover_note` | no | `string` or `null` |  | Shared authored briefing, private with the binding; never executable. |
| `role_id` | yes | `string` |  |  |
| `subject` | yes | `string` |  |  |

### role_definitions

`[[role_definitions]]`, schema type `RoleDefinitionRow`.

Authored role vocabulary; a definition carries no binding or authority.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `capability_ids` | yes | array of `string` |  |  |
| `description` | yes | `string` |  |  |
| `display_name` | yes | `string` |  |  |
| `role_id` | yes | `string` |  |  |

### roll_table_entries

`[[roll_table_entries]]`, schema type `RollTableEntryRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `authored_order` | yes | `integer` |  |  |
| `result_ref` | yes | `string` |  |  |
| `roll_table_entry_id` | yes | `string` |  |  |
| `roll_table_id` | yes | `string` |  |  |
| `weight` | yes | `integer` |  |  |

### roll_table_entry_tag

`[[roll_table_entry_tag]]`, schema type `RollTableEntryTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `roll_table_entry_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### roll_table_tag

`[[roll_table_tag]]`, schema type `RollTableTagRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `roll_table_id` | yes | `string` |  |  |
| `source` | no | `string` | `"manifest"` |  |
| `tag` | yes | `string` |  |  |

### roll_tables

`[[roll_tables]]`, schema type `RollTableRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `display_name` | yes | `string` |  |  |
| `result_kind` | yes | `string` |  |  |
| `roll_table_id` | yes | `string` |  |  |

### session_definitions

`[[session_definitions]]`, schema type `SessionDefinitionRow`.

ADR-0037 D-H: authored session template. Mirrors the live `session_definition` table. Phase D opaque-string columns (`turn_rule`, `visibility_policy`, etc.) pass through verbatim. New columns added by ADR-0037 appear here; existing columns use `serde(default)` to remain optional when authoring non-combat session types.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `auto_join_on_targeting` | no | `boolean` | `false` | Enroll outsiders that target a participant with an economy action. Default `false`. ADR-0037 D-7 (COND-12). |
| `bundle_id` | yes | `string` |  |  |
| `busy_allow_pred` | no | `string` or `null` | `null` | Actions satisfying this predicate remain allowed while a participant is busy. |
| `busy_break_pred` | no | `string` or `null` | `null` | Actions satisfying this predicate abandon the session before proceeding. |
| `combat_grid_blueprint_id` | no | `string` | `""` | Optional FK into `combat_grid_blueprint.blueprint_id`. Empty = no automatic grid unless the reducer caller passes explicit grid extent. |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `grid_edge_affordance_bindings_json` | no | `string` | `""` | Optional bindings JSON copied onto each generated tactical-grid edge affordance. Empty = no bindings. |
| `grid_edge_affordance_template_id` | no | `string` | `""` | Affordance template copied onto generated tactical-grid edges. Empty = the session definition does not author grid traversal. |
| `initial_state` | no | `string` | `""` |  |
| `legal_moves_csv` | no | `string` | `""` |  |
| `on_terminate` | no | `string` | `""` |  |
| `participants_pred` | no | `string` | `""` |  |
| `round_duration_ms` | no | `integer` | `0` | Fiction milliseconds to advance per rotation wrap. `0` = unbound. Positive values must be a whole number of configured world ticks. |
| `session_def_id` | yes | `string` |  |  |
| `stakes_required` | no | `string` | `""` |  |
| `termination_pred` | no | `string` | `""` |  |
| `turn_eligibility_pred` | no | `string` |  | Optional Bool DSL predicate deciding which participants are handed the turn (ADR-0143 D-1). Evaluated per candidate with that participant as the DSL `actor` subject when `r_advance_turn` picks the next actor; a false result skips the participant without removing it. Empty = every participant is eligible (the unfiltered ADR-0037 rotation). Only actor-subject reads are admitted (MF-VAL-334). Persisted on the `session_turn_eligibility` satellite, never on `session_definition`. |
| `turn_rule` | no | `string` | `""` |  |
| `turn_scheduler_id` | no | `string` | `""` | FK into `turn_scheduler.id`. Empty = use the world-active scheduler. ADR-0037 D-3/D-4. |
| `visibility_policy` | no | `string` | `""` |  |
| `winner_predicate` | no | `string` | `""` |  |

### spatial_environment_state

`[[spatial_environment_state]]`, schema type `SpatialEnvironmentStateRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  | Owning bundle. Bundle-scoped manifest clear deletes this row by `bundle_id` directly, so authoring against a foreign-bundle definition is still cleaned up by this bundle's re-apply. |
| `location_def_id` | no | `string` | `""` |  |
| `place_edge_id` | no | `integer` or `null` | `null` |  |
| `place_edge_key` | no | `string` | `""` | Author-facing edge key. Resolved to `place_edge_id` during manifest commit; mutually exclusive with `place_edge_id` and `place_node_id`. |
| `place_node_id` | no | `string` | `""` |  |
| `state_id` | yes | `string` |  |  |
| `updated_tick` | no | `integer` | `0` |  |
| `value_bool` | no | `boolean` | `false` |  |
| `value_int` | no | `integer` or `null` | `null` |  |
| `value_text` | no | `string` or `null` | `null` |  |
| `visibility` | no | `string` | `"Public"` |  |

### spatial_niche_attachments

`[[spatial_niche_attachments]]`, schema type `SpatialNicheAttachmentRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `condition_bool` | no | `boolean` | `true` |  |
| `ecological_invariant` | no | `boolean` | `false` |  |
| `niche_id` | yes | `string` |  |  |
| `on_entry_action_id` | no | `string` | `""` | Optional action dispatched after successful entry into `place_node_id`. Authored only as a pair with `on_entry_target_entity_key`; empty means the attachment affects locality only. |
| `on_entry_target_entity_key` | no | `string` | `""` | Manifest entity key bound as TargetActor for `on_entry_action_id`. Resolved to a numeric entity id during manifest admission. |
| `place_edge_id` | no | `integer` or `null` | `null` |  |
| `place_node_id` | no | `string` | `""` |  |
| `visibility` | no | `string` | `"Public"` |  |

### spatial_state_definitions

`[[spatial_state_definitions]]`, schema type `SpatialStateDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | yes | `string` |  |  |
| `freshness_rule` | yes | `string` |  |  |
| `lod_policy` | yes | `string` |  |  |
| `merge_rule` | yes | `string` |  |  |
| `state_id` | yes | `string` |  |  |
| `value_type` | yes | `string` |  |  |
| `writer_policy` | yes | `string` |  |  |

### stacking_discipline_definitions

`[[stacking_discipline_definitions]]`, schema type `StackingDisciplineDefinitionRow`.

`[[stacking_discipline_definitions]]` rows in a bundle TOML. A condition's `stacking_rule` resolves to one of these rows; the kernel evaluates the DSL outcomes instead of branching on the discipline id.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `discipline_id` | yes | `string` |  |  |
| `display_name` | yes | `string` |  |  |
| `expires_at_tick_outcome_source` | yes | `string` |  | Int-valued DSL expression over the existing row state. `-1` means "leave the existing expiry unchanged"; non-negative values set a tick. |
| `stack_count_outcome_source` | yes | `string` |  | Int-valued DSL expression over the existing row state. Available facts: `stack_count`, `expires_at_tick`, and `world_tick`. |

### substrate_definitions

`[[substrate_definitions]]`, schema type `SubstrateDefinitionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `coordinate_kind_id` | yes | `string` |  | FK → coordinate_kind_definition.coordinate_kind_id. |
| `description` | no | `string` | `""` |  |
| `substrate_id` | yes | `string` |  |  |

### tag_capability_grant

`[[tag_capability_grant]]`, schema type `TagCapabilityGrantRow`.

sk-bwd: the IDENTITY→capability bridge row — "while an entity bears `tag`, it may act with `capability_id`". The grant lasts while the tag is present.

`tag` is an OPEN string, resolved against the union of `entity_tag` and `entity_definition_tag`. It is deliberately NOT validated against `tag_value_definition`. That vocabulary is advisory.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `capability_id` | yes | `string` |  | FK into `capability_definition.capability_id`. |
| `tag` | yes | `string` |  |  |

### tag_value_definitions

`[[tag_value_definitions]]`, schema type `TagValueDefinitionRow`.

One exact, bundle-owned member of a declared tag vocabulary.

`tag`, `prefix`, and `bundle_id` establish identity, namespace membership, and ownership respectively. `description` is presentation metadata only: it MUST NOT select behavior, dispatch, affordances, predicates, niches, or runtime rules.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  |  |
| `description` | yes | `string` |  |  |
| `prefix` | yes | `string` |  |  |
| `tag` | yes | `string` |  |  |

### target_conditions

`[[target_conditions]]`, schema type `TargetConditionRow`.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `condition_definition_id` | yes | `string` |  |  |
| `expires_at_tick` | no | `integer` or `null` | `null` |  |
| `source` | no | `string` | `""` |  |
| `stack_count` | no | `integer` | `1` |  |
| `target_id` | yes | `integer` |  |  |
| `target_kind` | yes | `string` |  |  |

### trace_kind_definitions

`[[trace_kind_definitions]]`, schema type `TraceKindDefinitionRow`.

Authored trace-kind vocabulary (ADR-0043). `kind_id` is an open string with no Rust match (ADR-0018 compliant); `location_kinds` is validated against the registered scope set (`spellkave-validate::trace_kinds`).

Field names mirror the table columns 1:1 (deliberate mapping, not drift — per LR-51(c)).

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `bundle_id` | yes | `string` |  | Owning mod bundle (cleared/reinserted on re-apply). |
| `description` | no | `string` | `""` | Human-readable description for authors and operator tooling. |
| `kind_id` | yes | `string` |  | Stable namespaced identifier (PK in `trace_kind_definition`). |
| `location_kinds` | yes | `string` |  | Comma-joined registered scopes the trace can attach to (e.g. `"place_node,place_edge"`). Each entry must be a registered scope id. |
| `perceptible_for_ticks` | no | `integer` or `null` | `null` | How many ticks after inscription this kind of trace stays admissible to an ARRIVING observer (ADR-0040 seam B, `observer_knowledge:: learn_at_node`). Absent = unbounded: the trace is a standing mark that anyone who later walks in can find — footprints, a slime trail, a scorch. `0` = perceptible only at the moment it is inscribed (seam A alone): an EVENT, not a mark — a sound, heard by whoever was present and by nobody who arrives afterwards (bead sk-n16). This is NOT a lifetime. The trace row survives regardless — the room keeps its history for an elevated/DM read-back; what expires is only the chance to perceive it by walking in. Deleting the row instead (`Inscribe.expires_at_tick`) would un-hear listeners who already heard, because the player read path resolves remembered traces back through the `trace` table and skips dangling ids. |
| `schema_json` | no | `string` | `""` | Canonical JSON schema for the trace payload: a flat object mapping a required payload key to its type name (`{"text":"string"}`), a `?` suffix marking the key optional (`{"addressee":"integer?"}`). `""` if the kind carries no structured payload. Enforced at inscription time by `inscribe::validate_payload_against_schema` — the author declares what must hold, the kernel makes it hold. |

### turn_scheduler

`[[turn_scheduler]]`, schema type `TurnSchedulerRow`.

Action-economy (batch 2): how `r_advance_turn` selects the next acting actor. The `core` bootstrap ships `core/turn/round_robin_scheduler`; exactly one row with `active = true` must exist per world. Mirrors the live `turn_scheduler` table (landed via #433). ADR-0037: adds `order_roll_source` (DSL expression for `RolledOrder` scheduling).

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `active` | yes | `boolean` |  |  |
| `bundle_id` | yes | `string` |  |  |
| `description` | no | `string` |  | Authored description (#1968) — open string, never load-bearing. |
| `id` | yes | `string` |  |  |
| `order_roll_source` | no | `string` or `null` | `null` | DSL expression evaluated once per participant at session open when `scheduler_kind = "rolled_order"`. Empty for `round_robin`. Validated: non-empty + parseable when `scheduler_kind = "rolled_order"`. |
| `scheduler_kind` | yes | `string` |  | Closed set enforced validator-side; `round_robin` is the value this change ships. ADR-0037 adds `rolled_order`. The kernel dispatches on the K-5 `SchedulerKind` enum (ADR-0037 D-3; never a closed String column). |

## Other types

Types that the fields above refer to.

### ActionResolutionModeRow

Type: one of `"Deterministic"`, `"Stochastic"`, `"Deferred"`.

### ConditionHookRow

Authoring shape of a single hook on a `condition_definition`.

Two shapes are admitted (issue #257, srd-conformance-probe Direction B):

* **Inline-DSL (preferred).** Author the detail filter and modifier expression as standalone DSL source strings via `detail_filter_source` and `expression_source`. At manifest admission the strings are parsed to sub-`Expression`s and grafted onto the parent `gate_predicate_source`'s node id space (see `spellkave_dsl::Expression::graft`); their resolved root ids become the `detail_filter` / `expression` node ids that the runtime evaluator walks. Authors never see the numeric ids.

* **Numeric (legacy).** Provide `detail_filter` / `expression` as raw `DslNodeId` offsets into the parsed `gate_predicate_source` AST. This shape exists for in-crate unit tests that build hook rows programmatically; production fixtures should use the inline-DSL form.

Exactly one of `expression` / `expression_source` must be set, and at most one of `detail_filter` / `detail_filter_source`. The validator and the manifest loader reject all other combinations.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `detail_filter` | no | `integer` or `null` | `null` |  |
| `detail_filter_source` | no | `string` or `null` | `null` |  |
| `event_kind` | yes | `string` |  |  |
| `expression` | no | `integer` or `null` | `null` |  |
| `expression_source` | no | `string` or `null` | `null` |  |

### DslMacroParameterRow

One ordered, typed parameter in a [`DslMacroDefinitionRow`].

`value_type` is the pre-existing DSL type family. Schemars projects the serde enum as a string until that shared enum owns its JSON-schema derive; deserialization still accepts only the enum's closed values.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `name` | yes | `string` |  |  |
| `value_type` | yes | `string` |  |  |

### EntityKindRow

Type: one of `"player"`, `"npc"`, `"item"`, `"place"`.

### MetadataValue

An open, JSON-compatible value authored under a manifest's `[metadata]` table. The deliberately small number range keeps a TOML → wasm JSON → JS → TOML round trip exact: JavaScript cannot represent integers above `2^53 - 1` without loss. TOML datetimes, `nan`/`inf`, and JSON `null` have no lossless representation in that cross-runtime contract and are rejected at the parsing boundary.

Type: `boolean` or `integer` or `number` or `string` or array of [`MetadataValue`](#metadatavalue) or table of [`MetadataValue`](#metadatavalue).

### SchemaVersion

Manifest schema version in MAJOR.MINOR.PATCH format

Type: string matching `^\d+\.\d+\.\d+$`.

### SpatialRef

Compact spatial anchor used by authoring rows that instantiate world content into a location.

`kind` is an open string discriminator resolved by `anchor_kind_definition`; `id` carries the address in that namespace.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `id` | yes | `string` |  |  |
| `kind` | yes | `string` |  |  |

### TagPrefixDeclaration

A single bundle-owned tag-vocabulary namespace declaration (`tag-vocabulary-declaration` change, design Decision 1). `prefix` is an open string the validator never enumerates against a Rust-coded legal-value list — this stays inside ADR-0018 D-1's closed-string-enum prohibition without building D-1's `tag_definition` value-vocabulary table; `tag_prefixes` is bundle-level *namespace* metadata, not a per-tag-value row.

| Field | Required | Type | Default | Description |
|---|---|---|---|---|
| `natural_key_field` | no | `string` or `null` | `null` | Required when `target_kind` is set: the natural-key field on that target row kind (mirrors `RefTagFamily.naturalKeyField`). Validated against the row-kind registry by `spellkave-validate` — see design's natural-key cross-check note. |
| `prefix` | yes | `string` |  | The namespace this bundle owns, e.g. "srd" (matching a dotted prefix "srd.<name>") or the multi-segment "srd.ability" (matching "srd.ability.<code>" under the canonical ref-tag convention — see design Decision 3). MAY itself contain dots; no trailing dot is stored, the validator appends "." when matching a tag's namespace boundary. |
| `target_kind` | no | `string` or `null` | `null` | Optional ref semantics: if present, every tag under this prefix is expected to resolve — its suffix (the part after "prefix.") should match a row's natural-key id in `target_kind`, exactly or as its final "/"-segment (mirrors `ref-tags.ts`'s existing suffix-match rule). `target_kind` is an open row-kind name — see design's "structure, not content" note for what "open" does and does not buy. |

### VisibilityClass

Type: one of `"public"`, `"local"`, `"hidden"`.
