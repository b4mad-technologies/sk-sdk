# Interaction DSL And World Authoring

Spellkave authoring is declarative. A bundle defines durable world rows; clients
and reducers turn those rows into runtime interaction.

Reducers remain authoritative. A client may display an affordance, but the
server revalidates current state before any mutation.

## Typed DSL macros

Use `[[dsl_macro_definitions]]` to name a small, reusable typed expression.
Macros are authoring-time expansion only: admission checks the parameter and
return types, substitutes each call's expression into `body_source`, and then
runs the ordinary DSL validation and evaluation path. A macro is therefore not
derived state and does not add a runtime function or evaluator operator.

For example, the SRD bundle defines its ability-score calculation once and
calls it with a live stat read:

```toml
[[dsl_macro_definitions]]
macro_id = "srd/ability_modifier"
bundle_id = "srd"
return_type = "Int"
parameters = [{ name = "score", value_type = "Int" }]
body_source = "((score) - 10) / 2 + cond(((score) - 10) - (((score) - 10) / 2) * 2 < 0, -1, 0)"

[[affordance_templates]]
template_id = "my_bundle/check"
# … ordinary identity fields omitted …
predicate_source = "d20 + macro('srd/ability_modifier', actor.stat('srd/dex')) >= 15"
```

> **Update (2026-07-31, #1891 / PR #2075):** the `d20` term above is retained
> only to demonstrate macro composition syntax — it is stale authoring
> PRACTICE. `affordance_templates.predicate_source` is a deterministic
> ELIGIBILITY gate: as of #1891, any stochastic COMPARISON anywhere in an
> offer predicate — including a die laundered through a `let` binding, e.g.
> `let roll = d20; roll >= 15` — is treated as SATISFIED at materialise time
> without ever drawing. It can no longer gate whether the affordance offers.
> Author dice in the action's `resolution_predicate_source`
> (`resolution_mode = "Stochastic"`) instead, and keep `predicate_source` to
> capability/state/target checks (`actor.wielded_item.has_tag(...)`,
> `target.stat(...) >= N`, and the like). This is deliberately crude at the
> extremes: an unreachable DC (`d20 >= 30`) in an offer predicate still
> offers unconditionally — the kernel only checks "does this comparison draw
> at all", never the threshold — and simply fails honestly at act time, same
> as any other miss.

The macro id is a fully qualified string, the parameter list is ordered, and
each argument must match the declared `value_type` (`Bool`, `Int`, or `Text`).
Macro bodies use the existing DSL but cannot call another macro in v1. Leaf
macros can still compose at an authored call site, for example
`macro('srd/base_ac', macro('srd/ability_modifier', actor.stat('srd/dex')))`.
Keep the input expression live—such as `actor.stat('srd/dex')` above—rather than
materializing a calculated resource that can become stale when its source
changes. Use macros for repeated bounded calculations; use ordinary authored
state for facts that the world must actually store.

The bare `d20` term in the example above is also bias-compatible — see
[Roll modifiers (Advantage/Disadvantage/flat bonus)](#roll-modifiers-advantagedisadvantageflat-bonus)
below for how an active condition can shift a predicate's roll without the
predicate authoring anything itself.

## Roll modifiers (Advantage/Disadvantage/flat bonus)

Advantage, Disadvantage, and flat roll bonuses are never written into a
predicate's own DSL text. They compose from the acting entity's active
`condition_definitions` — a modifier template with `delta_kind` `Advantage`,
`Disadvantage`, or `Plus` (see `tool-reference.md`'s `modifier_templates` row
reference for the full `delta_kind` vocabulary) — into a `ComposedRollBias`
that the evaluator installs on the acting entity's evaluation context before
running the predicate. An authored predicate has no way to reference this
bias directly; it is ambient input the same way `actor.stat(...)` reads
ambient facts.

The evaluator consults the composed bias at exactly three points
(`crates/spellkave-dsl/src/eval.rs`): a bare single-die `Roll` (the `d20`/
`NdM` grammar, `count == 1` only — a multi-die literal like `2d6` is never
biased), `RollUnder`, and an `Int`-valued `RollTable` draw. Advantage draws
the die **twice** and keeps the more favorable flat-bonus-adjusted result;
Disadvantage keeps the less favorable one. "More favorable" depends on which
direction the operator's own success condition runs: `Roll` and `RollTable`
are consumed by a `>= target`-shaped comparison, so Advantage takes the
**max** of the two draws (Disadvantage the min); `RollUnder` succeeds on a
**lower** roll, so Advantage takes the **min** of the two draws there instead
(Disadvantage the max).

Both physical dice are recorded individually in the evaluation's own
provenance (`stochastic_draws`), not just the one that decided the outcome —
this is what lets a post-roll intervention (the SRD's Heroic Inspiration
reroll, `finding-58-post-roll-reroll-intervention.md`) replace exactly one of
the two recorded faces and recompute the branch, rather than only ever seeing
a single collapsed result.

## Author Instances As Entities

The final substrate uses one instance table: `[[entities]]`.

- Player bodies and NPC bodies are entities with `kind = "player"` or
  `kind = "npc"`.
- Items are entities with `kind = "item"`.
- Former world objects and fixtures are entities, usually with `kind = "npc"`,
  `kind = "place"`, or a tagged definition that explains their role.
- Inventory and machine-port contents are `[[entity_containment]]`.
- Ground placement is `entities.place_node_id`.
- Object facts are `[[object_state]]`.

Ordinary manipulation discovery is the factored per-perceiver
`manipulation_context` (ADR-0140). There is no entity flag to opt into a
generic affordance cache; that cache is retired. `r_manipulate` still
revalidates every attempt (ADR-0011 D-3) from authored templates, equipment,
and containment — discovery rows are never authority.

`[[items]]`, `[[item_locations]]`, `[[item_inventory]]`, `[[world_objects]]`,
and `[[world_object_locations]]` are retired (#1968 B-10) — the manifest
schema no longer accepts them at all. Use the `[[entities]]` +
`[[entity_containment]]` + `[[object_state]]` shape above.

## From Spatial Rows To Affordances

Movement starts with spatial topology:

<!-- snippet: traverse-edge-topology -->
```toml
[[place_edges]]
edge_key = "my_bundle/edge/a-b"
bundle_id = "my_bundle"
place_graph_id = "my_bundle/graph"
from_node_id = "my_bundle/graph/a"
to_node_id = "my_bundle/graph/b"

[[place_edge_affordance]]
edge_key = "my_bundle/edge/a-b"
affordance_template_id = "my_bundle/traverse"
```

The `affordance_template` supplies the predicate and outcome:

<!-- snippet: traverse-edge-affordance -->
```toml
[[affordance_templates]]
template_id = "my_bundle/traverse"
bundle_id = "my_bundle"
niche_id = "core/traversable_edge"
capability_id = "core/walk"
display_name = "Traverse"
predicate_source = "actor.has_capability(\"core/walk\")"
outcome_template_id = "core/traversal/move_outcome"
```

Traversal predicate tables are gone; attach normal affordance templates to
edges instead.

**Edge endpoints may live in the committed world (#1666).** At apply
admission (`r_apply_world_manifest`), `from_node_id`/`to_node_id` resolve
against this manifest's `[[place_nodes]]` *plus* already-committed
`place_node` rows — so a later apply can patch an edge onto nodes from an
earlier one, e.g. a `substrate_crossing` edge into a
`[[place_graph_instances]]`-created node (instance first, edge in the next
call: instance node ids materialize at commit). An endpoint absent from both
is a fatal `MF-VAL-105`. Two caveats: offline validation (`spellkave
validate`, the merge-gate) has no live world and stays file-set-only, and the
edge row's `bundle_id` must still be declared via `[[bundles]]` in the same
manifest. Live replay: `openspec/specs/world-manifest-validation/demos/edge-endpoint-live-nodes.md`.

## Owning Instances And Their Defaults

`place_graph_instances.bundle_id` names an incoming applying bundle header. It
owns the expanded graph, nodes, edges, movement defaults, niche attachments and
inhabitant capability grants; the blueprint's bundle remains provenance. Omit it
when there is one applying header, or an inline blueprint declares an owner with
an incoming header. A foreign blueprint in a multi-header apply needs an explicit
owner (`MF-VAL-373`). Parent and anchor ownership do not choose it.

Play-created clones and tactical grids carry the world owner (`""`), so authored
bundle replacement preserves them. Apply-expanded clones belong to their applying
bundle and are removed when that bundle is replaced. The OWN-91 survival tests
prove both boundaries.

A cloned node or edge with its instance graph's owner and a matching blueprint row
inherits the original row's bundle defaults. A same-owner overwrite keeps that
inheritance: set an explicit node extent, graph-scoped movement default or edge
affordance to override or refine it. A new row with no original blueprint match,
or a foreign-owner overwrite, uses its own bundle defaults. Graph-scoped movement
defaults still take precedence over bundle defaults. The OWN-91 default-boundary
live proof covers inherited traversal, explicit refinement, added edges and
foreign-owner overwrites.

## Actor↔Target Distance (`core/distance_to_actor_mm`)

*(added 2026-07-31, #2077)* A predicate can read the acting actor's
distance to the current target, in millimeters, measured under the place
graph's authored metric shape, through the ordinary `target.stat(...)` read:

<!-- snippet: distance-to-actor-predicate -->
```toml
predicate_source = "target.stat(\"core/distance_to_actor_mm\") <= 9144"
```

This is a kernel-populated fact, not authored `object_state` — it is computed
by `collect_spatial_inputs` from the SAME metric an affordance's own
`range_m` field already gates on (`actor_target_distance_millimeters`, which
calls `node_pair_metric` + `node_pair_metric_distance` —
the world API), so a
distance-gated predicate agrees with a `range_m` cutoff on the identical
geometry. Reading it composes a normal/
long-range split, a "within N ft" third-party-style conjunct on the
actor↔target pair, or any other distance-shaped gate that a hard `range_m`
cutoff can't express (Disadvantage instead of a flat reject, for example).

**Absent, not zero, when the metric is not comparable.** The fact is missing
— `UnknownField`, so the predicate evaluates `false` — when the actor has no
resolvable place_node, either node lacks a metric embedding, or the actor and
target sit in different `place_graph`s (a cross-graph pair has no single
comparable distance). It is never fabricated as `0` or any other sentinel;
author defensively the same way you would for any other optional stat read
(a leading `actor.has_capability(...)`/co-location conjunct, or accept that
the predicate simply never fires cross-graph).

**Deterministic — gates for real under offer evaluation too.** Unlike a bare
`d20`-shaped comparison, this is a plain fact read: `evaluate_offer_predicate_expression`
(the materialiser's offer/attemptability path, #2075) evaluates it normally
and gates on it, it never short-circuits it as "satisfied by construction"
the way a stochastic comparison is. A predicate mixing a distance conjunct
with a real die (`target.stat("core/distance_to_actor_mm") <= 1524 && d20 +
5 >= 25`) is offered only when the distance gate genuinely holds; the die
alone is what offer mode treats as attemptable regardless of outcome.

**Reserved field id.** `core/distance_to_actor_mm` is populated by the kernel
before any per-entity `object_state` fact is folded in, so it always wins a
same-name collision — an authored `object_state` row on the target that
happens to reuse this id can never shadow the kernel-computed value. Do not
author your own `object_state` under this id; pick a different name for
anything you want authored state (rather than the kernel) to own.

## Leave-Reach Geometry (`core/distance_to_departed_mm`, `core/distance_to_destination_mm`)

*(added 2026-08-17, bead sk-0m4.26)* During a **reaction-eligibility**
evaluation triggered by another actor's movement, the kernel populates two
additional distance facts on the candidate reactor: the reactor's grid
distance to the node the mover just **left**, and to the mover's
**destination**, both in millimeters. The distance uses the grid's authored
metric shape (`cell_distance_mm` in
the world API, 1 cell = 1524 mm):
Chebyshev on a blueprint that authors `core/metric/chebyshev` (the SRD one),
Euclidean on a blueprint that resolves to Euclidean. Subject roles in that evaluation:
`actor` is the candidate reactor, `target` is the mover (the mover's live
capability grants are folded under `target`, so `target.has_capability(...)`
reads the mover). The SRD opportunity-attack gate is the canonical consumer;
its full predicate, as shipped in
`packages/spellkave-srd-cc/fixtures/base/playing-the-game/attacks.toml`
(built by `OPPORTUNITY_ATTACK_ELIGIBILITY` in
`packages/spellkave-srd-cc/src/chapters/playing-the-game/fragments/attacks.ts`),
also requires the reactor to hold `srd/action/attack` and not be Addled:

<!-- snippet: leave-reach-eligibility-predicate -->
```toml
reaction_eligibility = "actor.has_capability('srd/action/attack') && actor.stat('core/distance_to_departed_mm') <= actor.stat('srd/reach_mm') && actor.stat('core/distance_to_destination_mm') > actor.stat('srd/reach_mm') && target.has_capability('srd/action/disengage') == false && actor.status('srd/condition/addled') == false"
```

The kernel only measures; which reach stat to compare against and which
capability exempts the mover are entirely the author's choice — no `srd/`
vocabulary is baked into the substrate.

**Absent, not zero, off-grid.** Both facts exist only when the departed and
destination nodes carry grid positions (session grids). On unpositioned
nodes the facts are missing (`UnknownField` ⇒ predicate `false`) and the
kernel falls back to co-located candidate scoping.

**Shadowable — do not author state ids under `core/distance_*`.** Unlike
`core/distance_to_actor_mm`, these two facts are appended AFTER the reactor's
own facts (the world API
extends `int_fields` with them after `build_actor_subject_facts`), and a
`stat` read takes the first matching fact (`Op::ReadInt` in
`crates/spellkave-dsl/src/eval.rs`). An authored `object_state` on the
reactor with the same id therefore wins over the kernel value. This is a
known bug (bead `sk-jay0.2.49`); until it is fixed, never author an
`object_state` id under `core/distance_*`.

## Dispatch Argument Quantity (`core/dispatch_arg_quantity`)

*(added 2026-08-23, sk-609b.22 / K-D)* When a dispatching action carries a
`quantity` argument (a split-quantity potion use, a Lay on Hands healing
amount), a resolution predicate, an outcome-graph edge guard, or an
apply-time `delta_source`/condition-gate composition can read it back through
the ordinary `actor.stat(...)` read:

```toml
delta_source = "-actor.stat(\"core/dispatch_arg_quantity\")"
```

This is a kernel-populated fact, not authored `object_state` — a pure
projection of the dispatch's own `ManipulationArgs.quantity`, already parsed
and shape-validated (rejecting `0`) before the fact is ever pushed.

**Absent, not zero — and, unlike `core/distance_to_actor_mm`, absence hard-fails
everywhere it can be read.** No `quantity` arg on the dispatch pushes
nothing. In a **`delta_source`** (an Int-typed evaluation), the missing fact
resolves to an evaluation *error*, never a silent `0` — by design, so a
`delta_source` reading a quantity that was never supplied fails loud instead
of quietly healing/damaging for zero. In a **resolution predicate** or an
**outcome-graph edge guard**, the missing fact is ALSO an evaluation error
(`UnknownField`), and — unlike some other kernel-populated facts — nothing
at either call site catches it: an absent-quantity resolution predicate
rejects the whole dispatch as a technical failure, and an absent-quantity
outcome-graph guard aborts the whole graph evaluation. **Do not author
`actor.stat("core/dispatch_arg_quantity")` in a resolution predicate or an
outcome-graph guard unless the affordance's dispatch always supplies a
`quantity` arg** — there is no graceful "gate closed" here, only a hard
reject. Both driving cases (split-quantity potion use, Lay on Hands) read
this fact only as a `delta_source`, never in predicate/guard position, for
exactly this reason.

This is the **primary dispatch subject** rule (ADR-0045 Postscript 2026-08-23
and the 2026-09-02 D-5 carve-out): `UnknownField` on a fact the *action*
was supposed to supply stays fatal. It is the opposite of a
`ForEachActorInRadius` per-candidate skip, which applies only to a
**bystander / non-opted-in occupant** that never bound the measured fact
(see [Area-of-effect frame writes](#area-of-effect-frame-writes)). Do not
read `core/dispatch_arg_quantity` in a per-occupant radius predicate — it is
dispatch-scoped, not occupant catalog.

**Reserved field id.** Like `core/distance_to_actor_mm`, this id is
kernel-populated and pushed ahead of any per-entity `object_state` fact, so
it always wins a same-name collision. Do not author your own `object_state`
under this id.

**Fan-out subject-lie.** Under a `ForEachActorInRadius` fan-out, `actor`
rebinds to each selected occupant in turn, but `core/dispatch_arg_quantity`
stays the SAME dispatch-scoped value for every occupant — it is not
re-derived per occupant. An author reading `actor.stat("core/dispatch_arg_quantity")`
inside a per-occupant predicate/`delta_source` gets the one quantity the
player chose for the whole dispatch, not a per-occupant share of it. If a
mechanic needs a per-occupant split, divide the fact's value in the
authored expression rather than expecting the kernel to have already split it.

**Narrower than `distance_to_actor_mm`.** Only three seams see this fact: the
dispatch-time resolution predicate, outcome-graph edge guards, and apply-time
`delta_source`/fan-out composition. It is never wired into reaction
eligibility or materialiser offer-eligibility (dispatch args do not exist
before the player supplies them), and it is not wired into the roll-bias
condition-gate composition pool (no driving case needs a quantity-gated
*condition*, as opposed to a resolution-predicate or `delta_source` read).
See `packages/spellkave-srd-cc/docs/substrate-verdicts/dispatch-args-kernel-design.md`
for the full seam map and the rejected sibling proposal (an arg-carried
spatial-binding token, cut for lack of a driving case).

## Session Participation (`core/session_id`)

*(added 2026-08-27, sk-awlo.3)* Inside a **condition hook** — and only there —
a predicate can ask whether its holder is currently in a combat session:

```toml
[[condition_definitions.hooks]]
event_kind = "Layer2.ConditionDelta"
detail_filter_source = """
  $event.detail.entity_id == target.stat('core/entity_id')
  && target.stat('core/session_id') > 0
"""
expression_source = "invoke_outcome_graph('my_bundle/leave-fight')"
```

Hook rows are `deny_unknown_fields` (`ConditionHookRow` in
`crates/spellkave-schema/src/lib.rs`): the keys are `event_kind`,
`detail_filter_source`, and exactly one of `expression_source` (shown) or the
numeric `expression`.

The value is the ambient scope session **if and only if this holder is a
participant of it**. That conjunction is the whole point, and the name
promises more than it delivers on purpose: there is exactly one session a
holder can be in, so from the holder's own point of view it is *the* session.
A fact mirroring the world-global `turn_state.scope_session_id` alone would
answer "a fight is happening somewhere", which is not a question any authored
rule wants to ask.

**Absent, not zero — and here absence is a graceful gate.** With no session in
scope, or a holder who is not a participant of it, the fact is simply not
pushed, so reading it raises `UnknownField`. In a hook `detail_filter` that is
already understood as *"this hook does not apply to this holder"* and the hook
quietly does not fire — unlike
[`core/dispatch_arg_quantity`](#dispatch-argument-quantity-coredispatch_arg_quantity),
whose absence hard-fails. An authored `target.stat('core/session_id') == 0`
therefore never matches; write `> 0` when you mean "I am in a fight".

**Scope: condition hooks only.** It is pushed in the per-`target_condition`
loop that collects hook intents, beside `core/entity_id`. It is not available
in affordance predicates, resolution predicates, or outcome-graph guards.

**Kernel-populated field id.** Do not author an `object_state` under this id.
The fact is appended after the hook's base facts
(`collect_condition_hook_intents` in
the world API) and a `stat`
read takes the first match, so — as with the leave-reach facts above — the
kernel value is not guaranteed to win a same-name collision.

### What it does not unlock

The fact exists so a hook can gate a `LeaveSession` frame write safely — hook
side effects are **not** isolated from their trigger, so an ungated
`LeaveSession` aborts the very `ApplyStatus` that fired the hook, and a
creature dying outside combat would refuse to die.

It is **not** the way to make turn order skip a participant. `LeaveSession`
removes the row `r_advance_turn` rotates over, which works, but it also
relocates the leaver off the tactical grid as part of its contract, which makes
a corpse untargetable. To skip a body that stays in the scene, author
`turn_eligibility_pred` on the session definition (ADR-0143). See
[`leave-session-relocates`](./repairs/leave-session-relocates.md) for both.

## Runtime Ambient State On Incident Edges

`[[spatial_environment_state]]` rows can be seeded directly in a manifest when
the dark, smoky, noisy, or otherwise altered location is known up front. A
runtime action can also write ambient state through an `Inscribe` frame write.

For traversal gates, the important target is the place edge: `r_move` evaluates
edge-bound affordances with `target.state("...")` populated from env-state on
that edge. When a cast should affect movement through the caster's current cell,
author a spatial env-state write with `location_kind = "binding"` and
`location_ref = "ActorIncidentEdges"`. The reducer resolves the actor's current
node, enumerates every incoming and outgoing `place_edge`, and writes one
env-state row per incident edge.

<!-- snippet: actor-incident-edges-inscribe -->
```toml
[[consequence_frame_writes]]
template_id = "my_bundle/cast_darkness/success"
ordinal = 0

[consequence_frame_writes.frame_write.Inscribe]
kind = "spatial_environment_state"
location_kind = "binding"
location_ref = "ActorIncidentEdges"
payload_json = '{"state_id":"my_bundle/darkness","value":true,"visibility":"Public"}'
```

Use this with a normal edge affordance predicate:

<!-- snippet: darkness-gated-predicate -->
```toml
predicate_source = "actor.has_capability(\"core/walk\") && target.has_niche(\"core/passable_portal\") && target.state(\"my_bundle/darkness\") == false || actor.has_capability(\"my_bundle/darkvision\")"
```

If the same spell should also affect node-targeted manipulation, add a separate
`Inscribe` write with `location_ref = "ActorSpatialRef"`. `ActorIncidentEdges`
is only for `spatial_environment_state` writes, does not accept a payload
`target_ref`, and does not create a ranged/targeted edge binding; a distant
target's incident edges are not authorable through this token.

### Node-Scoped Environment State On Traversal (`@from_node` / `@to_node`)

*(added movement-defaults-modes-terrain-cost, ADR-0101 D-4)* `r_move` also
projects `spatial_environment_state` onto the TWO place nodes an edge
connects, alongside the edge-bound facts above. For every defined
`spatial_state_definition`, a row whose `place_node_id` matches the edge's
`from_node_id` becomes `<state_id>@from_node` (bool/int, typed per the
definition; the definition's default when no row is present) plus a
`<state_id>@from_node@updated_tick` freshness twin (same rule as the plain
`@updated_tick` fact above); a row on the `to_node_id` becomes
`<state_id>@to_node` / `<state_id>@to_node@updated_tick` the same way. The
plain (unsuffixed) `<state_id>` name stays reserved for the edge-bound fact
above — `target.state("my_bundle/darkness")` always means the EDGE's own
state, never a node's.

This is how terrain becomes a property of the *area* while still being paid
on the edge: an `[[affordance_templates]]` row may carry
`movement_cost_expression_source`, an authored integer DSL expression (same
int-root grammar as any other `_source` field — see `dsl-grammar.md`) that
multiplies the traversing edge's authored/metric distance. It evaluates in
the SAME `target`-scoped context the template's own `predicate_source`
already reads, so it reaches the node-scoped facts above through the
ordinary `target.stat("<id>@from_node")` grammar:

```toml
[[affordance_templates]]
template_id = "my_bundle/affordance/step"
niche_id = "core/passable_portal"
capability_id = "core/walk"
outcome_template_id = "core/traversal/move_outcome"
predicate_source = "actor.has_capability(\"core/walk\")"
movement_cost_expression_source = "max(1, max(target.stat(\"my_bundle/difficult_terrain@from_node\"), target.stat(\"my_bundle/difficult_terrain@to_node\")))"
```

Whether two difficult endpoints should take the worse of the two (`max`,
above) or stack (`target.stat("...@from_node") * target.stat("...@to_node")`)
is entirely the author's call — the kernel never interprets any state id as
"difficult"; it only projects whatever `spatial_environment_state` rows
exist and multiplies whatever the expression returns (clamped to a
non-negative result; an absent expression leaves the distance unmultiplied,
today's static-cost behaviour unchanged). A reducer that writes
`my_bundle/difficult_terrain` on a node — a spell consequence, a hazard
trigger — changes the cost of the NEXT traversal into or out of that node,
with no manifest re-apply.

## Trace Inscription — Payload Carriage, Anchors, And How Long A Trace Stays Perceivable

An `Inscribe` frame write that inserts a `trace` row (as opposed to the
`spatial_environment_state` write path above) has several more authorable
knobs: carrying the dispatching action's own text and addressee onto the
trace, anchoring the trace to an entity instead of a fixed place, and — on the
trace KIND rather than the write — how long the result stays perceivable to
someone who arrives later.

**The rule of thumb before you reach for any of them:** the anchor says WHERE
the trace is, the payload says everything else about it — who it was aimed at,
what was said, who left it. Anchors are not a delivery mechanism. See
"Anchoring a trace to an entity" below for what happens when you use one as
though it were.

### Kernel-stamped join to the world event (not authorable)

An `Inscribe` or `InscribeTraceCluster` that runs inside `r_apply_consequence`
stamps `trace.event_id` with the `world_event.id` of that consequence. Authors
do not set this column: it is not a manifest field, not a FrameWriteOp knob,
and not part of `payload_json`. Seed traces (`[[location_traces]]`,
`[[place_node_traces]]`) and raw `r_inscribe_trace` stay unlinked
(`event_id = 0`). Operators join a waking NPC `cause_id` (a `trace_id`) to
the world event via `spellkave trace inspect`.

### Carrying the dispatching action's text (`carry_dispatch_text`)

Set `carry_dispatch_text = true` on an `Inscribe` write to fold the
dispatching action's text into the trace's `payload_json`, under a `text` key,
at dispatch time. The kernel reads the `dispatch_text` key of the dispatch's
`args_json` (`ManipulationArgs.dispatch_text`); the shared tool runtime's
`utterance` tool parameter (#1923) is folded to that kernel-wire key at the
boundary, so the kernel never sees an `utterance` key
(the world API,
`extract_dispatch_text`, and the test there that fails a reader of the
`utterance` key):

<!-- snippet: carry-dispatch-text-inscribe -->
```toml
[consequence_frame_writes.frame_write.Inscribe]
kind = "srd/speech_heard"
location_kind = "place_node"
location_ref = "ActorSpatialRef"
payload_json = '{"speaker":"herald"}'
carry_dispatch_text = true
```

If the dispatch's `args_json` carries `{"dispatch_text": "Open sesame"}`, the
inscribed trace's `payload_json` becomes `{"speaker":"herald","text":"Open
sesame"}`. `carry_dispatch_text` defaults to `false`, and `false`/absent
leaves `payload_json` byte-identical to before this field existed — regardless
of what the dispatch's `args_json` carries. `true` with no `dispatch_text` key
present (or a non-string value, or unparsable `args_json`) also leaves `payload_json` untouched; this is opt-in carriage, not a
requirement that every dispatch supply text. `payload_json` must already be a
JSON object for the merge to succeed — a non-object payload under
`carry_dispatch_text = true` is a loud authoring error, not a silent no-op.

### Carrying the dispatch's addressee (`carry_addressee`)

Set `carry_addressee = true` on an `Inscribe` write to fold the entity the
dispatch is aimed at into the trace's `payload_json`, under an `addressee`
key, as an entity id:

```toml
[consequence_frame_writes.frame_write.Inscribe]
kind = "srd/speech"
location_kind = "binding"
location_ref = "TargetSpatialRef"
payload_json = '{}'
carry_dispatch_text = true
carry_addressee = true
```

A dispatch targeting entity 4 with the text "Well met." inscribes
`{"text":"Well met.","addressee":4}` at the ADDRESSEE's current place-node
(`TargetSpatialRef`). This is how directed speech is authored (sk-0m4.33):
the trace sits where the addressee stands, ordinary co-location admission
delivers it there, and the payload records who it was aimed at. A grant
extent on the communicate capability (sk-0m4.34) is what lets the act reach
an addressee in another place graph; `range_m` alone cannot. Broadcast
and self-shaped speech still use `ActorSpatialRef` (the speaker's place).
Never `TargetEntityRef` — that glued the row to a person (sk-oj6).

Unlike `carry_dispatch_text`, this one is **not** best-effort. Setting it on a
dispatch with no entity target fails loudly at binding validation, before any
write happens. That is deliberate: the flag is your declaration that this
trace's payload carries an addressee, and a payload whose addressee is
"usually there" leaves every reader probing for it — the exact convention the
flag exists to replace.

An addressee in the payload routes nothing. It is content, like the text
itself, so everyone co-located still perceives the trace and overhears the
exchange. Directed speech is a fact about the utterance, not a delivery list.

### Carrying bounded menu labels (`carry_dispatch_options`)

An `Inscribe` write with `carry_dispatch_options = true` copies the dispatch's
`dispatch_options` into the payload's `options` array. The dispatch admits
at most sixteen string labels, each at most 120 Unicode characters; malformed labels
refuse the frame. Missing or null options leave the authored payload unchanged.
The parallel optional `dispatch_option_refs` argument carries exact static
authored definition ids (or null for an option without a reference). Under the
same opt-in it becomes `option_definition_refs` beside `options`; it never
derives from eligibility. References require labels, equal list lengths and
nonempty ids of at most 512 bytes. The merged payload must be a JSON object.
With carriage disabled the payload is unchanged.

Compose this write with the closed-question state transition in one consequence.
The resulting occurrence keeps that frame's speech `audience_trace_id`; its
presentation must use that trace rather than a later question. See
[dialog choice slots](patterns/dialog-choice-slots.md) and
[metadata attachments](metadata-attachments.md#dialogueprompt-closed-question-presentation).
The metadata marker is a client presentation convention; typed prompt rows,
response sets and state predicates enforce admission.

### Carrying opaque presentation context (`carry_dispatch_context`)

An `Inscribe` write with `carry_dispatch_context = true` copies the dispatch's
`dispatch_context` argument onto the payload under `context`. The argument is
one JSON object sent as text, at most 8 KiB. The kernel checks only those two
things and reads no key of the object. Text that is not one JSON object, or is
larger, refuses the frame. A missing or null argument leaves the payload
unchanged, and so does a write without the flag.

The context is content for whoever reads the trace, like the labels. It is
heard by everyone who perceives the trace, so nothing private belongs in it.
Its content is never read by the server: prompt rows, response sets and state
predicates decide what may be answered. Only the shape and the bound are
checked, at dispatch, whether or not a write carries the context. The
scripted ask-menu palette keeps its question traces without expiry, so every
carried context stays stored with its trace.

Compose it with `carry_dispatch_options` on the write that asks a closed
question. The occurrence binds that trace, so a reader gets the labels and the
context of the same question, never of a later one. The shipped use is the
machine side of a guided question (step, outline, answers so far); see
[guided dialogue](patterns/guided-dialogue.md) for its shape.

### Recording an answered occurrence (`carry_occurrence`)

An `Inscribe` write with `carry_occurrence = true` copies the server gate's
admitted occurrence id into `occurrence_id` as a decimal string, including across
deferred execution. Caller payloads cannot select the binding. An unbound reuse
of the same response action has no admitted occurrence and omits the field.
The flag opens no prompt. Label history resolves through the reader's visible
occurrence and its bound presentation; missing history uses neutral numbers.

Tag response actions explicitly with `ui.response-slot=<positive integer>`.
This is client syntax independent of action ids and labels. Keep the prompt
metadata's response ordering consistent with the marker. Markers and static
references grant no admission and expose no predicate results; the server
decides attempts (ADR-0166).

### Declaring a payload contract (`trace_kind_definitions.schema_json`)

A trace kind can declare what its payload must carry, and the kernel enforces
it while assembling the payload — no host can bypass it, because the kernel is
the only place the finished payload exists.

```toml
[[trace_kind_definitions]]
kind_id = "srd/speech"
bundle_id = "srd"
location_kinds = "place_node"
schema_json = '{"text":"string","addressee":"integer?"}'
```

The shape is a flat object mapping a payload key to its type name:
`string`, `integer`, `number`, `boolean`, `object`, `array`, `any`. Declared
keys are **required**; a `?` suffix makes the key optional (absent is fine,
present must still typecheck). Keys you do NOT declare are allowed through —
the schema states what must hold, not what may. An empty `schema_json`
declares no contract at all, and an unrecognised type name is a loud error
rather than a silent pass.

### How long a trace stays findable (`trace_kind_definitions.perceptible_for_ticks`)

A trace is perceived at two moments (ADR-0040): at inscription, by whoever is
co-located then, and on ARRIVAL, by a body that later walks onto its node.
`perceptible_for_ticks` governs only the second one.

```toml
[[trace_kind_definitions]]
kind_id = "my_bundle/slime_trail"
# field omitted -> unbounded: a standing MARK, findable whenever you walk in

[[trace_kind_definitions]]
kind_id = "srd/speech"
perceptible_for_ticks = 0
# 0 -> an EVENT: perceived only as it happens, never by walking in afterwards
```

Omitting the field is the default and preserves the behaviour every trace had
before this knob existed. Author `0` for anything that is a sound or a flash
rather than a mark. A finite value in between models a stimulus that lingers
and fades — smoke, a scent.

The bound is **exclusive**: `n` admits arrivals for `n` ticks after
inscription, through `inscribed_at + n - 1`. So `0` admits nothing on arrival
at all, including on the utterance's own tick — deliberately, because a tick
is as long as the operator says it is (`set_tick_interval_secs`, 300s by
default). A whole scene plus several arrivals fits inside one tick, so an
inclusive bound would let latecomers in and make a perception rule depend on
an operations knob.

**This is not a lifetime.** The row survives regardless: nothing is deleted,
a body that already perceived the trace keeps that memory forever, and a
caller holding a DM/oversight extent grant can still read the full history of
the nodes it watches.

Do not reach for the lifetime fields (`expires_after_ticks`, or the absolute
`expires_at_tick`) to get this effect. Those DELETE the row, and the player
read path resolves each remembered trace back through the `trace` table — so
deleting it silently un-hears a listener who had already heard. Use them only
for traces that are genuinely meant to stop EXISTING, which is a different
question:

| Knob | Question it answers | Deletes? |
|---|---|---|
| `Inscribe.expires_after_ticks` | how long does the trace exist | yes |
| `trace_kind_definitions.perceptible_for_ticks` | how long can it still be found by someone arriving | no |

Smoke wants both — it thins out AND stops being findable. Speech wants only
the second: see "Decay deletes; it does not un-tell" in
[`lingering-hazard-zones.md`](./lingering-hazard-zones.md).

### Anchoring a trace to an entity (`location_kind = "entity"`)

> **Do not use an entity anchor to model "spoken to this person."** The
> substrate supports the anchor and the following section documents it, but
> speech was authored this way once and it was wrong. An entity anchor makes
> the trace travel with the anchor, so utterances ACCUMULATE on a person and
> get handed to whoever later stands next to them: a hero walking into a
> tavern perceived another character's entire creation dialogue because the
> NPC it was addressed to happened to be standing there (bead sk-oj6). It
> bought nothing either — an entity anchor admits by co-location like any
> other, so it was never addressee-exclusive delivery. For directed speech,
> anchor at `TargetSpatialRef` (the addressee's place, never their entity)
> and set `carry_addressee` (above).
>
> An entity anchor is right when the trace genuinely IS a property of that
> object and should move with it — a tamper mark scratched into a chest,
> the smell clinging to a carried corpse.

A trace can be pinned to a specific entity instead of a fixed place —
`location_kind = "entity"`, `location_ref = "<entity_id>"`. The trace then
travels with that entity: both ADR-0040 perception seams (inscription-time
co-location and arrival-time co-location) admit whoever is co-located with the
anchor entity's CURRENT position, re-resolved live — not the position it
occupied at inscription time. This is explicitly **not** addressee-keyed
delivery: there is still no recipient column on `trace`; anyone who ends up
standing where the anchor currently is perceives it, the same free-overhearing
shape a `place_node` anchor already has (ADR-0095).

Use a literal entity id when the anchor is known at authoring time — a mark
left on a specific chest, say:

<!-- snippet: entity-anchor-inscribe -->
```toml
[consequence_frame_writes.frame_write.Inscribe]
kind = "my_bundle/tamper_mark"
location_kind = "entity"
location_ref = "42"
payload_json = '{}'
```

Two authoring requirements come with it: the trace kind's
`trace_kind_definitions.location_kinds` CSV must list `entity` (admission
rejects an anchor scope the trace kind doesn't declare), and the referenced
entity must actually exist (a bad `location_ref` is a loud authoring error,
not a silently unreachable anchor).

### Anchoring to the current manipulation target (`TargetEntityRef`)

When the anchor should be *whichever entity the dispatch is currently
targeting* rather than a literal id fixed at authoring time, use the
`TargetEntityRef` binding token — a sibling of
`ActorSpatialRef`/`TargetSpatialRef`:

<!-- snippet: target-entity-ref-inscribe -->
```toml
[consequence_frame_writes.frame_write.Inscribe]
kind = "srd/speech_heard"
location_kind = "binding"
location_ref = "TargetEntityRef"
payload_json = '{}'
carry_dispatch_text = true
```

`TargetEntityRef` resolves at `Inscribe` execution time to the manipulation
target's entity id and then flows through the same `entity`-anchor path as a
literal `location_ref` — same `location_kinds` allowlist check, same
co-location-with-current-position admission. A dispatch with no entity target
(a place-node-targeted manipulation, say) fails loudly — "frame binding:
missing TargetEntityRef binding" — rather than silently anchoring nowhere.

Reach for this when the dispatch target is a THING the trace belongs to and
should travel with — marking whichever chest was tampered with, whichever
corpse was handled. It is the wrong tool for "spoken to this person": see the
warning at the top of the entity-anchor section, and use `carry_addressee`
instead.

## Capabilities, Niches, Actions, Outcomes

The usual interaction chain is:

1. `capability_definition`: what an actor may attempt.
2. `niche_definition`: what kind of target can expose an interaction.
3. `affordance_template`: capability + niche + predicate + outcome.
4. `outcome_template`: the selected result identity and reducer-facing tags.
5. `action_definition`: a concrete action row when a Layer-2 reducer dispatches
   through action metadata.
6. `consequence_template` and `consequence_frame_writes`: durable mutation
   intent.

Outcome tags are bounded metadata, not prose. Examples:

```toml
tags = "movement.outcome=traverse_edge"
tags = "manipulation.action_id=core/pickup_item"
tags = "sense.query=look"
```

## Finite Selections And Bounded Identity Writes

A structured frame write can select a definition from an authored family:
`{ "allowed_ids": ["mymod/feature/a", "mymod/feature/b"] }`.
The dispatch supplies the exact string `definition_ref`. A single-member
family can omit it; a larger family cannot. Empty families, nonstring values,
unlisted IDs and unresolved or out-of-scope definitions refuse admission or
execution rather than expanding the family. Tags, conditions and inserted
items each resolve against their own declared vocabulary.

`SetEntityTag` carries `entity`, `tag` (the selection) and `present`. It
idempotently adds or removes the selected instance tag, recording
`source = "frame_write"`. It cannot write the player-seat tag or tags that
supply Party extents. Seed protected membership on the blueprint and use the
admitted authority route to change it. Identity and feature tags can derive
capabilities without manufacturing direct capability rows.

`SetEntityText` carries `entity`, `destination` and an authored `max_chars`
from 1 through 4096. It requires string `dispatch_text`, trims surrounding
whitespace and refuses empty or overlong text. The two destinations select
different table writes:

- `"EntityName"` updates the entity name, matching embodied actor names and
  their seat labels. It does not change row identity or ownership.
- `{ "ObjectStateText": { "state_id": "mymod/backstory" } }` updates an
  existing Text object-state row. It refuses a missing row or another value
  kind and preserves the row's visibility. Declare and initialize the home
  on the blueprint before offering this act.

These are structured `consequence_frame_writes`, not DSL expressions. Author
finite actions and their scoped bindings before play; the runtime selects
admitted arguments and observes receipts. See
[the draft-then-confirm pattern](patterns/draft-then-confirm-wizard.md).

## Kernel-Derived Target-Home Facts (`core/grounded`, `core/owned`, `core/contained`)

*(added 2026-09-23, sk-jay0.1.23.36.22.4)* Every `Entity`/`Item` target
carries a kernel-populated fact naming its HOME — where the target
currently sits, relative to the acting actor. `PlaceNode`/`PlaceNodeSet`/
`PlaceEdge`/`Location`/`World` targets carry no home fact at all
(`observed_targets.rs:199-203` returns no niches for those `TargetRef`
variants — there is nothing to be "grounded"/"owned"/"contained" relative
to).

**Read form: `target.has_niche(...)`, not `target.state(...) == true`.**
Both forms compile — `has_niche` reads the target's niche id list
(`Op::HasNiche`, a plain membership check with no missing-key error path);
`state` reads the SAME single-home value out of a separate bool-fact
bucket (`Op::ReadBool`, `target_home_bool_fact`) — but exactly ONE of the
three home facts is ever populated per target (a grounded target carries
no `core/contained` bool fact, and vice versa), and `Op::ReadBool` returns
`Err(UnknownField)` — not `false` — when the field it names is absent
(`crates/spellkave-dsl/src/eval.rs`). A predicate checking a single home
against a target that turns out to have a DIFFERENT home therefore
**errors closed** with `state()` (predicate_rejected, not "cleanly
false") — and combining two homes with `||` makes this far worse: `Op::Or`
propagates the first operand's error immediately (`crates/spellkave-dsl/
src/eval.rs`'s `Op::Or` arm uses `?`, never catching a missing-field error
to try the next operand), so `target.state("core/grounded") == true ||
target.state("core/contained") == true` throws on whichever home is
ABSENT before ever reaching the second disjunct — a contained target can
never satisfy that predicate no matter what the second half says. Reaching
this for real (`@spellkave/srd-cc`'s `srd/pickup`) rejected every
contained-item dispatch with `predicate_rejected` until switched to
`has_niche`. `has_niche` has no such trap — reads always find at most one
of the three ids and simply return `false` for the other two:

```toml
predicate_source = "target.has_niche(\"core/grounded\") || target.has_niche(\"core/contained\")"
```

`TargetHome` (the world API) is a closed
three-variant enum — exactly three home states, mutually exclusive per
target:

- **`core/grounded`** — the target sits on the ground: it has its own
  `entity_location` row. Covers both entities (creatures, world objects) and
  items lying loose on the floor.
- **`core/owned`** — the target is directly carried by the acting actor:
  equipped in one of the actor's equipment slots, or loosely contained with
  `container_id` = the actor's own body.
- **`core/contained`** — the target is an item whose DIRECT container is a
  DIFFERENT entity that is itself grounded (has an `entity_location` row) and
  is NOT a body (no actor currently inhabits it) — e.g. a potion sitting in a
  chest on the floor. Disclosed as its own `Item` target fact, distinct from
  the chest's own `core/grounded` `Entity` target fact.

  Two consequences are deliberate, not oversights:
  - **Any authored open/closed/locked state on the container is ignored by
    this disclosure rule.** The kernel has no open/locked enum (by design —
    see §7.2.1's `PickupTargetItem` row) and does not consult one here. A
    world that wants "only from an open chest" gates it in an affordance
    predicate or niche predicate reading the container's OWN authored
    `object_state`/condition, layered on top of `core/contained`; it is
    `@spellkave/srd-cc` content, tracked as a backlog item there, never a
    kernel concern.
  - **An unbound body counts as a non-body container.** `is_body` (via
    `actor::actor_for_current_body`) is true only while some `actor` row's
    `current_body` currently points at the entity. A corpse — a body no
    actor inhabits anymore — is NOT a body by this test, so its loose
    carriage becomes a `core/contained` disclosure like any other grounded
    container's: a fallen creature's dropped-but-still-contained items are
    takeable.

**Not disclosed at all** (no target fact, so no predicate can address it):
an item in a machine port or other slotted containment, an item held by a
DIFFERENT actor's body, and nested containment (an item in a bag that is
itself inside a chest — the bag has no `entity_location` row of its own).
`visible_entity_containment`'s possession set is unaffected by any of this —
these are independent, action-independent DISCLOSURE facts
(`affordance_materialiser::observed_targets`), not a widening of what an
actor's own inventory view returns (ADR-0120 postscript).

These are kernel literals (the world API),
not authored `object_state` or niche predicates — **do not author your own
state under these ids.** Unlike `core/distance_to_actor_mm` (above), which is
deliberately pushed into the act-path fact pool BEFORE per-entity
`object_state` so it always wins a same-name collision
(`r_manipulate/selection/spatial_facts.rs`'s documented ordering), the
target-home facts share the Bool pool with place state. The act-path candidate
context (`r_manipulate/selection/candidates.rs::manipulation_facts`) currently
assembles place-state facts, then the kernel target-home fact, then explicit
Actor/Target entity Bool facts from the shared entity-state collector.
`Op::ReadBool` resolves by first match. Do not rely on same-name collisions
between these carriers; author entity state under bundle-owned ids instead of
`core/grounded`/`core/owned`/`core/contained`.
`@spellkave/srd-cc`'s self-sufficiency exception names all three explicitly
as referenceable without a `core` bundle dependency (they are substrate, not
core-bundle content).

## Conditions And Modifiers

Use `condition_definition` for named effects with lifecycle, stack count,
observability, gates, or modifier behavior. Runtime application is a
`target_condition` row. Client readers see the server-filtered
`visible_target_condition` view. Mark a condition `observable = false` when the
applied row should be hidden from unrelated clients; the runtime still shows it
to the target body and the source body that applied it.

Targets are now entity-shaped. An item is an entity whose kind is `item`, so
condition and consequence authoring should target `entity` unless a legacy
runtime API explicitly asks for another shape.

Example frame write:

<!-- snippet: apply-status-frame-write -->
```toml
[[consequence_frame_writes]]
template_id = "core/drink_poisoned_cup/success"
ordinal = 0
frame_write = { ApplyStatus = { target_kind = "entity", target_ref = "Actor", condition_definition_id = "core/poisoned" } }
```

Use `object_state` for ordinary object facts such as opened, lit, depleted, or
locked. Use conditions only when the fact has condition identity or modifier
behavior.

Removing a condition is a `RemoveCondition` frame write carrying a typed
`source_match` selector that chooses which primary `target_condition` row(s) to
remove:

- `Exact` (keyed to the applying source's id) — remove only the row this source
  applied. Source-keyed cleanup: the default for self-reactions and targeted
  dispels.
- `"Any"` — remove **every** matching primary condition row regardless of which
  source applied it. A source-agnostic cleanse, e.g. *Lesser Restoration* ending
  `poisoned` no matter who inflicted it. Each removed row still cascades through
  the same per-condition remove-time policy.

<!-- snippet: remove-condition-frame-write -->
```toml
[consequence_frame_writes.frame_write.RemoveCondition]
condition_definition_id = "srd/poisoned"
source_match = "Any"
target_kind = "entity"
target_ref = "TargetActor"
```

### Modifier expiry is an absolute tick, not a runtime offset

`ApplyModifier` (lowers to `FrameWriteOp::InsertModifier`) takes an
`expires_at` parameter documented as "optional world tick at which the
modifier auto-expires; `null` = permanent". That tick is a literal integer
baked into the manifest/consequence at author time — there is no DSL
expression for "N ticks from whenever this fires" (no `current_tick() + N`
equivalent). An author who wants "this buff lasts 1 minute after the
triggering event" cannot express it: the trigger time is runtime-determined,
so no fixed tick authored in advance can be correct.

Two accepted workarounds, depending on what "expiry" needs to mean:

- **A persistent flag instead of a timed buff**, via `object_state` (see
  above) — honest when the fact doesn't need to self-clear. (The former
  precedent, the Phandelver `phandelver/we8/bathe_weapon` action, is retired
  content; only its walkthrough survives under `archive/apps/world-walkthrough/`.)
- **A self-pulsing scheduled effect**, via `ScheduleAutonomyJob` +
  `repeats_remaining`, when the effect genuinely needs to expire on its own
  after N rounds. See
  [`lingering-hazard-zones.md`](lingering-hazard-zones.md) — that pattern
  computes its own end condition at each pulse rather than pre-computing an
  absolute tick once.

### Creating Tagged World Objects

Use `CreateWorldObject` when a consequence should place a new entity-derived
object in the world. Its `tags` field is authored as a comma- or
semicolon-separated list; when the frame write succeeds, each tag is inserted as
an `entity_tag` row on the newly created entity. Those rows are immediately
visible to `target.has_tag(...)` predicates and to later consequences that query
instance tags.

<!-- snippet: create-world-object-frame-write -->
```toml
[[consequence_frame_writes]]
template_id = "my_bundle/build_wall/success"
ordinal = 0
frame_write = { CreateWorldObject = { object_def_id = "my_bundle/brick_wall", destination = { Ground = { spatial_ref = { kind = "binding", id = "TargetSpatialRef" } } }, owner_ref = "Actor", initial_state_ids = [], tags = "wall,cover,built_artifact" } }
```

Definition tags still belong in `[[entity_definition_tag]]` when every instance
of the definition should share a classifier. `CreateWorldObject.tags` is for
classifiers that belong to the spawned instance produced by that authored
consequence.

### Reacting to events with condition hooks

A `condition_definition` row's `hooks[]` (see the generated `hooks[]` table
in [`tool-reference.md`](tool-reference.md)'s `spellkave_define_condition`
section) let an ACTIVE condition react to something that happened elsewhere
in the world — e.g. a concentrating caster's condition removing itself the
moment the caster takes damage. Each hook names an `event_kind` (e.g.
`'Layer2.ResourceDelta'`, `'Layer2.ConditionDelta'` — the full closed set is
whatever `EventKind`/`Layer2Kind` currently produce; an unrecognised path is
a manifest-admission error, not a silent no-op), an optional
`detail_filter_source` (an inline-DSL Bool sub-expression gating which
INSTANCES of that event kind fire the hook), and a required
`expression_source` (an inline-DSL Int sub-expression naming the side effect
to apply when the hook fires; exactly one of `expression_source` or the
legacy numeric `expression` must be set — `ConditionHookRow` in
`crates/spellkave-schema/src/lib.rs`).

**Reading the firing event's own payload.** `detail_filter_source` and
`expression_source` may read `$event.detail.<field>` — the fields available
depend on `event_kind` and are a DECLARED, closed set per kind (not every
field a detail table happens to carry is readable; the table is
`EVENT_DETAIL_FIELDS` in `crates/spellkave-dsl/src/lib.rs`): `Layer2.ResourceDelta`
exposes `entity_id`, `delta`, `new_value` (`Int`) and `template_id`,
`resource_id` (`Text`); `Layer2.ConditionDelta`
exposes `entity_id`, `applied` (`Int` 0/1 — the DSL's `$event.detail` grammar
has no `ReadBool` path), `condition_definition_id`, `template_id` (`Text`).
Referencing a field a kind does NOT declare is a validation-time rejection at
manifest admission, not a runtime surprise. Every hook ALSO sees the
condition's own HOLDER as a fact, so a `detail_filter_source` can gate on "did
this event concern the entity holding ME": `target.stat('core/entity_id') ==
$event.detail.entity_id`.

**What a hook can actually DO when it fires.** `expression_source` is
evaluated as an outcome expression, same as a consequence's own outcome
side. Today, the only side effect that reliably reaches execution is
`invoke_outcome_graph('<consequence_template_id>')` — the referenced
`consequence_template` runs with the FIRING condition's own holder bound as
`Actor`/`TargetActor` (self-targeting by default, e.g. a hook whose job is
to remove its own holder's status). Every OTHER outcome shape a hook might
author (`modify_resource(...)`, `apply_status(...)`, `arbitrate(...)`, a
bare `RemoveCondition`/`EmitTrace`/`OutcomeSequence` op with inline
parameters rather than a template reference) is recorded as an explicit
skip — never applied, never silent — because a hook has no template id to
resolve those against; a future change may close specific ones of these,
but do not author them expecting them to fire. The concentration idiom —
"remove my own condition when I take damage" — is expressed as one
`condition_definition` whose `hooks[]` entry names `event_kind =
'Layer2.ResourceDelta'`, a `detail_filter_source` checking holder identity
and `$event.detail.delta < 0`, and an `expression_source` of
`invoke_outcome_graph('<bundle>/remove_own_condition')` pointing at a small
consequence template whose own `RemoveCondition` frame write does the
removal.

## Epistemic Read Visibility: Internal, Discoverable, RevealState

What the three base tokens mean for *delivery* — which clients receive a
state row at all (ADR-0120 as amended by ADR-0133):

- **`Public`** — reaches every client that can *perceive* the owning body:
  its own controller, a DM whose extent covers it, anyone co-present (same
  place node, or a cell of the same combat grid), its session peers, a DM
  whose place-graph extent contains it, and the world's operator (the
  module publisher or a body with manifest-apply authority, who reads
  everything). Not the whole world otherwise: a creature's hit points in one
  room never reach a player whose bodies are elsewhere. `observable = true`
  on a condition lowers to this class. The rule is about *bodies* — entities
  an actor embodies; state on anything else (an item, a lever, a door, a
  container) reaches every client as it always did.
- **`Local`** — reaches only its own controller, a covering DM extent,
  co-present bodies, and the operator; session peers in another place do
  not receive it.
- **`Hidden`** — reaches only the owning body's controller (and a covering
  DM extent); perceiving the body never opens it.

ADR-0081 adds two
`VisibilityClass` tokens alongside `Public`/`Local`/`Hidden` (authored the same
way — definition default via `default_visibility`, per-row override via
`visibility`; see the DM-oversight guide below for how elevated scope reads
all five):

- **`Internal`** — never delivered via the plain owner path, not even to the
  body that owns the row. Use it for mechanical simulation state no character
  "knows": encounter flags, hidden-loot dedup guards, pacing/authoring
  counters. An `Internal` row reaches a client only through an
  [ADR-0007 D-4 extent grant](dm-oversight.md) that explicitly authors
  `elevation_class = "internal"`
  (ADR-0084,
  #1938) — an ordinary extent grant with no `elevation_class` (the default,
  e.g. a `party` grant shared between ordinary party members) does NOT reach
  it.
- **`Discoverable`** — delivered via the plain owner path only once the owning
  body has *learned* the fact. Use it for quest-stage trackers, clues, and
  other content a character comes to know during play rather than knowing
  from the start. An `elevation_class = "internal"` reader sees it ungated,
  same as `Internal`; an ordinary (default-ceiling) extent grant does not —
  it still needs the owning body to have learned the fact.

<!-- snippet: discoverable-object-state-definition -->
```toml
[[object_state_definitions]]
bundle_id = "my_bundle"
state_id = "my_bundle/hidden_passage_found"
target_kind = "entity"
display_name = "Hidden passage found"
default_visibility = "Discoverable"
```

A `Discoverable` row's "learned" gate is a per-body `observer_state_knowledge`
row, written explicitly by a `RevealState` frame write — never inferred or
polled. Author it in the *same* consequence that teaches the fact (finishing a
dialogue, succeeding an inspect check, advancing the quest stage):

<!-- snippet: reveal-state-frame-write -->
```toml
[[consequence_frame_writes]]
template_id = "my_bundle/study_the_map/success"
ordinal = 1

[consequence_frame_writes.frame_write.RevealState]
owner_ref = "Actor"
state_id = "my_bundle/hidden_passage_found"
```

`owner_ref` (`Actor` / `TargetActor` / `TargetEntity` / a literal entity ref)
names the body whose `object_state` row becomes known; the *learner* is always
the acting subject (`Actor`) — the body that triggered the consequence, not
necessarily the row's owner. `state_id` must already have a live
`object_state` row on the resolved owner, or the write is rejected
(`RevealState: no object_state row for entity … state '…' — modder typo?`).

**The authoring footgun this exists to warn about:** a `Discoverable` row with
no matching `RevealState` write anywhere in the bundle is *pre-instantiated
but permanently ungated* — the owning body can never see it, silently, with
no validator diagnostic (this is a live-prove concern, not a static one). When
you flip a state definition to `Discoverable`, grep the bundle for every
consequence that should teach that fact and add the paired reveal write in
the same PR.

## Area-of-effect frame writes

A frame write normally hits one target. To affect *every* actor an area shape
covers, wrap the per-target effect in a `ForEachActorInRadius` op. It selects
actors against an authored `area_shape_definition` and runs its `body` once per
selected actor, rebinding `Actor`/`ActorSpatialRef` to each one.

<!-- snippet: aoe-for-each-actor-in-radius -->
```toml
[[consequence_frame_writes]]
template_id = "aoe-blast/cast_firebloom/success"
ordinal = 0
frame_write = { ForEachActorInRadius = { center_ref = "ActorSpatialRef", shape_id = "core/area/node_ball", shape_params_json = '{"ball_radius": 0}', predicate_source = "d20 < 13", body = [ { ModifyResource = { actor = "Actor", resource = "aoe-blast/hp", delta_source = "-d6" } } ] } }
```

- `shape_id` references an `area_shape_definition` row. `core/area/node_ball`
  is topological (centre node + nodes within `ball_radius` graph-edges; `0` =
  same node) and works on any graph; `core/area/sphere` (`{"radius_m": 5.0}`) is
  metric and needs nodes with `pos_x`/`pos_y`.
- `actor = "Actor"` in the body is the *per-actor* binding (the selected actor),
  not the caster.
- `predicate_source` is an authored per-target DSL **Bool** evaluated once per
  selected actor (ADR-0045 D-2). `""` = no filter (hit everyone); `"d20 < 13"`
  is a flat per-target DEX save — the body runs only on a failed save.
  A per-candidate `UnknownField` (the occupant never bound a fact the
  predicate reads — e.g. an HP-less dummy next to a lethality guard) **skips
  that actor** and writes an `evaluation_provenance` `write_failure` row; it
  does **not** abort the batch or roll back sibling writes (sk-pgsm;
  ADR-0045 Postscript 2026-09-02). Parse errors, wrong value-type, and
  draw-limit exceeded stay fatal for the whole consequence (ADR-0045 D-5).
  This skip is the **bystander / non-opted-in occupant** rule; it does not
  soften `UnknownField` on the **primary dispatch subject** (a resolution
  predicate, an outcome-graph guard, or `core/dispatch_arg_quantity` — see
  [Dispatch Argument Quantity](#dispatch-argument-quantity-coredispatch_arg_quantity)
  above). Still author **membership before measurement**
  (`has_tag(...) && stat(...)`) so a bystander short-circuits before the
  missing-fact read, rather than relying on the skip.
- `delta_source` is an authored DSL **Int** expression evaluated per target
  (ADR-0045 D-1): a literal (`"-7"`), a dice roll (`"-d6"`), arithmetic
  (`"-d4 - 1"`), or a `cond` (save-for-half: `"cond(d20 >= 13, 0 - d6 / 2, 0 - d6)"`).
- Dice expressions use a formula-aware draw budget (ADR-0059): the evaluator
  sizes the finite RNG draw allowance from the authored expression, so high-draw
  faithful save-for-half formulas such as `"cond(d20 >= 13, 0 - (20d6 + 20d6) / 2, 0 - (20d6 + 20d6))"`
  are authorable while oversized formulas still fail closed at the ceiling.
- A resource named by `ModifyResource` must have a `resource_definitions` row,
  or the bundle is rejected (`MF-VAL-217`) — this closes the old "spell admits
  but does nothing" silent no-op.

Worked, validating example: [`examples/aoe-damage-spell.toml`](./examples/aoe-damage-spell.md).
Dice damage and per-target saving throws are now authorable (ADR-0045), and
**ranged placement** is authorable via the affordance's `range_m` (ADR-0053): a
ranged spell can act on a distant cell or entity within metric range, not only
the caster's own node. What an AoE damage spell still **cannot** express —
damage-type routing and level scaling — remains open under
[#266](https://github.com/b4arena/spellkave/issues/266); per-caster range
*modifiers* (folding a caster bonus into the authored `range_m` literal) are
also still deferred.

## Spawn And Despawn Effects

`Spawn` and `Despawn` are `effect_definition` primitives for runtime lifecycle
changes:

- `Spawn` creates an entity or place-graph instance from `blueprint_id`.
- `Despawn` removes an entity or place-graph instance named by `target_ref`.

Direct cast effects may use the same frame bindings as the rest of the
consequence path. For `Spawn`, author `location_ref` as a binding spatial ref to
place the new instance at the caster's or selected target's runtime cell:

```json
{
  "blueprint_id": "core/item/loot_dagger",
  "location_ref": { "kind": "binding", "id": "ActorSpatialRef" }
}
```

`TargetSpatialRef` is also accepted, but it must resolve to a `place_node`; refs
that resolve to a place edge or another spatial kind are rejected at the normal
placement boundary. Literal `{"kind":"place_node","id":"..."}` refs still place
at the authored node exactly as before.

For a world-owned playable vessel, `Spawn` accepts `unbound_actor = true`.
Its entity blueprint supplies the actor, seat identity, initialized states
and initial capabilities. The resulting actor has no identity binding; a
later seat claim controls it. This mode refuses place-graph blueprints
(`MF-VAL-386`). Omitting the field retains the existing spawn behavior.
A creation blueprint is unplaced authoring data, so adventure re-apply does
not redeclare the spawned body or its subsequently inserted inventory.

The invoking actor is the caller's acting seat. One person may hold several
seats in a world (ADR-0161 D-5); when the caller's token carries the consent
claim `urn:spellkave:seat`, the default `Actor` binding resolves to the pinned
seat only, and a `Spawn` binds its summoner identity to the controlling actor
only when that pin admits the controller. An unpinned caller keeps the
existing behavior.

For `Despawn`, an entity target can bind to the invoking actor or selected target
entity:

```json
{
  "target_ref": { "kind": "binding", "id": "TargetEntity" }
}
```

`Actor` is also accepted for entity despawn. Literal entity refs and
`place_graph` refs stay literal. Missing bindings fail the reducer instead of
guessing a runtime row. Despawn releases the spawned body's `summoner`
binding first; if that release fails, the consequence is refused with an
error and nothing changes. The current guard protects every playable vessel,
including an unclaimed unfinished creation body. Do not use ordinary Despawn
as an abandonment cleanup route; automatic replacement requires a separate
admitted transition.

Graph Despawn removes every `place_edge_affordance` gate on each removed
graph-owned edge, including multiple templates and traversal modes, in the
same transaction as that edge. Session close and authored automatic
termination share this teardown. Gates on surviving edges remain. Legacy
orphan gates drain in capped world-clock sweeps; that repair pauses while a
manifest apply, failure/quarantine or applyset staging is pending. Publisher
doctor reports residual gates with `place_edge_affordance_has_edge`.

## Equipment

Equipment is entity-based:

- `equipment_slot_definitions` defines slot vocabulary.
- `entity_definitions.slot_compatibility_predicate` gates which entity
  definitions fit a slot. The field is a closed three-form grammar
  (ADR-0118: `""`/`"true"`, `"false"`, `slot_id == "<id>"`), not a
  `spellkave-dsl` expression.
- `actor_equipment_slots.item_key` names an authored item entity key.

<!-- snippet: actor-equipment-slot -->
```toml
[[actor_equipment_slots]]
actor_entity_key = "srd/regdar"
slot_id = "srd/main_hand"
item_key = "srd/item/dagger"
```

### Reading an explicitly equipped item

Use `actor.equipped_item('your-bundle/slot')` when a rule needs the item in a
particular authored slot (ADR-0126). The argument is a nonempty literal slot
identifier admitted in the bundle's reference scope, not a weapon category or
an item selector inferred by the runtime. For example:

```text
actor.equipped_item('demo/main-hand').has_tag('demo.weapon')
actor.equipped_item('demo/main-hand').stat('demo/charge')
actor.equipped_item('demo/main-hand').source('demo/damage')
```

Exactly one existing equipped item supplies tag, integer/text state, and source
facts. An empty slot, dangling item, or duplicate occupancy supplies no item
facts; there is no carried-item fallback. Missing positive tag tests are false;
missing scalar/source reads fail closed through the evaluator's normal errors.
Source bodies retain the original interaction Actor and Target, rather than
rebinding either to the selected equipment item. Equipment status, effective
state and resource-bound accessors are not added by this subject.

The legacy `actor.wielded_item` remains compatible: its current resolver picks
the lowest-ID equipped item across slots, or the lowest-ID carried item when
none is equipped (`selection/entity_facts.rs::resolve_wielded_item_entity`).
It does not distinguish armor from weapons. Content adopting explicit slots
must use the same authored slot across gates and attack/damage formulas; the
new accessor does not automatically migrate existing SRD expressions.

### Weapons carry their own damage (attacker-sourced)

Attack damage is **attacker-sourced**: the generic melee/ranged archetypes read
`actor.equipped_item('srd/slot/main-hand').source('srd/damage')` from the same
authored slot used by their weapon eligibility predicates (ADR-0126;
`spellkave-srd-cc/src/chapters/equipment/weapon-subject.ts`). A weapon-like `entity_definition` must
therefore ship a def-level `entity_definition_item_dsl_source` row for slot
`srd/damage` — otherwise it materialises the attack affordance but fails closed
at act time with `MissingItemDslSource` (ADR-0035 / ADR-0045 §D-5). That slot is
macro-aware (#2218): `source` may call `macro('srd/strength_modifier')`; commit
persists the expanded AST and act time evaluates the cached tree:

<!-- snippet: weapon-damage-source -->
```toml
[[entity_definition_tag]]
entity_def_id = "srd/item/longsword"
tag = "srd.weapon"
bundle_id = "srd"
source = "manifest"

[[entity_definition_item_dsl_source]]
entity_def_id = "srd/item/longsword"
slot = "srd/damage"
source = "1d8 + ((actor.stat('srd/str') - 10) / 2)"
bundle_id = "srd"
```

The validator surfaces a missing slot as **`MF-VAL-268`** (a Warning, not a
rejection — the runtime already fail-closes, and a decorative weapon prop may
never be wielded). It fires for exact `srd.weapon`-tagged defs in the `srd`
bundle or an srd-dependent bundle (sk-hml / #2184). An authored formula that
reads `stat`/`effective`/`resource_max`/`resource_min` for an id with no
catalog row is **`MF-VAL-329`** — it names the owning row and the
missing symbol rather than waiting for act-time `UnknownField`. It is Fatal
when the owning bundle's `depends_on` closure is fully present (or on live
admission) and Info with a hint when it is not, the same two-tier trust as
`MF-VAL-217`, so a per-file validate of a formula reading `srd/str` declared
in another file does not fail closed. See also
[`packages/spellkave-srd-cc/docs/attack-and-damage.md`](../../spellkave-srd-cc/docs/attack-and-damage.md)
and [`authoring-damage.md`](../../spellkave-srd-cc/docs/authoring-damage.md).

## Observing What Happened

Use JSONL commands rather than ad hoc SQL when possible:

```bash
spellkave manifest apply packages/spellkave-srd-cc/fixtures/manifest.toml   # or: just seed <manifest>
spellkave events 20
spellkave manipulation-context actions <perceiver_entity_id>
spellkave item list
spellkave inventory list <entity>
spellkave doctor
```

`manipulation-context actions` emits the caller-visible available-action
facts for one perceiver (ADR-0139; siblings `targets`, `participants`,
`prompts`, `inspect`, `list`); the old per-actor affordance cache and its
`affordance list` command are retired.

Every `spellkave` command emits one JSON object per line. Exit code `2` means
an in-world assertion or validation finding; exit code `1` means infrastructure
failure.

For an ordinary direct `r_manipulate` action, an error returned by its frame
aborts that reducer transaction, including synchronous nested condition hooks,
resources, conditions, events and new provenance. The invocation rejects;
it does not retain a new `Failed/write_failure` receipt. Pre-frame admission
refusals still retain their structured failure receipt. Composition child
failure tolerance and scheduled-job isolation have separate caller policies;
this guarantee does not extend to those paths. The live proof (`frame-failure-atomicity.live.test.ts`, in the TypeScript
adventure-runtime live tier) was deleted with the TypeScript host (sk-jay0.1.55.60.8).

Doctor's `retained_execution_failure` warning identifies caller-visible
Affordance/Failed/write_failure provenance: a committed execution failure whose
rollback is unverified. It cannot reconstruct lost HP, rewards or other prior
values, and hidden rows may be absent. Preserve historical evidence and audit
manually; do not replay failed actions or clear receipts as an automatic repair.

Runtime evaluation history is finite: after event pruning, a clock sweep
keeps each linked evaluation while any cited terminal event remains, and
retains the newest configured number of unlinked historical rows. Pending
stochastic/arbitration work, all prompt consumptions' accepting evaluations
(including closed occurrences), and receipts born in the current clock
transaction are protected. Each sweep deletes at most128 eligible rows;
legacy excess converges across advances. Missing expired evidence does not
prove a failed commit. The existing `event_retention_limit` controls this
history without changing its default or caller visibility. Publisher doctor
checks every consumption's accepting reference with
`prompt_consumption_has_provenance`.

## NPC Behavior

Manifests do not author autonomous NPC decision logic. A bundle can place an
NPC entity and grant capabilities, but any creature behavior must come from an
external SDK client that observes state and submits intents. In-module autonomy
is reserved for scenery and mechanical jobs, not actor preference or planning.


## Tagging DSL in TypeScript generators

Authors write DSL as TypeScript string literals, not as TOML. Mark those
literals with the `dsl` tagged template from `@spellkave/world-author` so
the text is greppable and can be validated without changing what generators
emit:

```ts
import { dsl } from "@spellkave/world-author";

gate_predicate_source: dsl`1 == 1`,
```

The tag is `String.raw`: interpolations work, the returned string is identical
to a plain template. Do not introduce a second grammar here — `crates/spellkave-dsl`
is the language (ADR-0131).
