# Running an authored act through `r_manipulate`

You authored a capability, an affordance, an outcome, an action, and a
consequence — and `r_manipulate` still does nothing. This runbook lists the
**non-obvious requirements** for an authored act to actually fire, in the order
they bite. (Companion to [`interaction-dsl-and-world-authoring.md`](./interaction-dsl-and-world-authoring.md),
which covers the row shapes themselves.)

## The full chain an act needs

For an actor to perform an action `X` via `r_manipulate`, all of these must be
authored — missing any one makes the act silently unselectable:

| Row | Binds | Common miss |
|---|---|---|
| `capability_definitions` | declares capability `C` | — |
| `actor_capabilities` | grants `C` to the actor entity | actor never granted `C` |
| `affordance_templates` | `niche_id = "capability:C"`, `capability_id = C`, → `outcome_template_id` | — |
| `outcome_templates` | `manipulation_action_id = X` | outcome not linked to the action |
| `action_definitions` | `action_id = X`, `required_capability = C` | — |
| `consequence_templates` + `consequence_frame_writes` | what the act *does* | — |
| **`spatial_niche_attachments`** | binds `capability:C` to the **place node the actor stands on** | **most common miss** — see below |

### Anchoring depends on the niche's `provider` (changed by actor-carried-verbs)

Whether a niche needs spatial anchoring is now declared on the niche itself:
`niche_definitions.provider` resolves to a `niche_provider_definition` row
whose typed flags drive admission. Three seeded providers:

- `provider = "actor"` — the actor's capability carries the verb everywhere;
  **no attachment row is needed** (a target is an argument, not a
  precondition — bead `sk-rd0`). This is the right choice for
  `capability:*`-style verbs like attacks, Dodge or Rest.
- `provider = "entity"` — a candidate entity affords the niche through its
  own tags/state satisfying the niche predicate; no attachment row.
- `provider = ""` / `"place"` (the default for ordinary niches, and the
  fail-closed fallback for a niche with no `niche_definitions` row at all) —
  the pre-existing rule below applies unchanged: the niche exists only where
  a `spatial_niche_attachment` anchors it.

**`capability:*` niches are the exception: `provider` is required.** Do not
rely on the empty/place fallback for a capability-shaped niche. A missing or
empty provider fails closed *silently* — the verb becomes place-provided
without anyone saying so, and is dead everywhere an attachment was never
authored. That is how Fighter Second Wind vanished from the crypt (sk-0m4.69).
Author the row with an explicit `provider` (`actor` for carrier-bound class
features and self-verbs; `place` only when you mean room-scoping). Do **not**
flip the default to actor: capabilities are an authorization surface, and
fail-open would make every granted capability a verb everywhere. The
world-author pre-flight rejects the miss as **`WA-CAP-002`** (fatal, same
family as `WA-CAP-001`) so the next forgotten capability is caught by a gate,
not a playtest.

For a **place-provided** niche, authoring the capability and granting it is
not enough — without a `spatial_niche_attachment` binding `capability:C` to
the actor's node, selection finds nothing:

```toml
[[spatial_niche_attachments]]
bundle_id = "my-bundle"
place_node_id = "village/village_green"   # where the actor stands
niche_id = "capability:my-bundle/my_capability"
```

This is Gibson affordance discipline: an affordance is a property of the
actor-in-a-place, not of the actor alone. If `r_manipulate` rejects with
*"no authored affordance_template selected action_definition '…'"*
(the world API),
the error now tells you which of
these is missing (no affordances / capability not held / niche not anchored) —
and, since #1968's canon-warden gate pass 2, a niche that DID resolve but
whose affordance predicate simply evaluated false (an ordinary miss, e.g. a
failed attack roll) is now DISTINGUISHABLE from the "niche never resolved"
shape above: the rejection's `failure_kind` is `"niche_unresolved"` for the
missing-`spatial_niche_attachment` case above, and `"predicate_rejected"` for
an ordinary miss on a fully-attached affordance — the hint text names which
one fired. A third value, `"capability_not_held"`, means every candidate for
the action names a template `capability_id` the actor does not hold: the kernel
checks that capability at act time, so the predicate does not need to repeat it,
and an empty `capability_id` is ungated. All are open `failure_kind` STRING
values (ADR-0018), never a closed enum.

## Player-facing proof flow

Once the rows validate and expose their per-actor facts, prove the authored behavior through the
same bounded PLAYER flow used during play:

1. Read `spellkave_scene` and `spellkave_manipulation_context`.
2. Use the context's independent disclosed action and target facts to compose
   one typed attempt. Disclosure is not an eligibility guarantee.
3. Execute `spellkave_manipulate` with the authored `action_id` and `target_id`,
   or `spellkave_communicate` with its speech-act id and utterance.
4. Re-read the relevant summary/detail
   surface (`spellkave_self_summary`, `spellkave_item_detail`,
   `spellkave_trace_detail`, or `spellkave_session_status`).

The PLAYER presents facts but the reducer independently revalidates authority
and world predicates. A rejected direct attempt is an ordinary server result,
not proof that the disclosed facts were stale. Mark-making is an ordinary
authored manipulation; PLAYER does not receive a raw trace-payload tool.

The `spacetime call` commands below are **author/operator diagnostics**, not
PLAYER guidance. General raw reducers remain useful for isolated authoring
checks, but their server authority/capability gates still apply.

## Acting inside a session (combat, etc.)

A session-scoped act (e.g. an in-combat move or attack) runs inside an open
session. `r_session_open` takes three arguments — the session definition, the
participant entity ids, and a grid-extent JSON (`""` for no tactical grid)
(the world API):

```bash
# 1. open the session — participants, initiative, optional grid.
#    For a Sequential session with participants this also starts turn 1.
spacetime call <db> r_session_open '"my-bundle/session/combat"' '[12, 13]' '""'

# 2. the participant whose turn it is can act
spacetime call <db> r_manipulate 12 '{"entity":12}' '"my-bundle/move"' '{…args…}'

# 3. end that turn and hand it to the next participant (arg: session_id)
spacetime call <db> r_advance_turn 1
```

`r_session_open` calls the first turn advance itself when `turn_rule =
"Sequential"` and the participant list is not empty (`r_session_open.rs:168-173`);
an extra `r_advance_turn` right after opening skips the first participant.

**Combat turns rotate only through `r_advance_turn`.** Since ADR-0092 no
multi-participant session auto-advances on the world clock, and the tick
heartbeat does not read `round_duration_ms`; the heartbeat only terminates
promoted long-running actions (the world API). A slow
participant therefore holds the turn until someone calls `r_advance_turn`
(the NPC host or a driver does this for NPC turns).

## Target shape

`r_manipulate` always takes a target. Variant tags are **lowercase**
(`{"entity":N}`, `{"item":N}`, `{"placeNode":"…"}`, `{"world":{}}`). A
**self-act** (a move repositioning the acting figure) targets the actor itself —
`{"entity":<actor>}`, not `{"world":{}}` (world is rejected for subject-resolved
acts).

### Self-targeting (ADR-0060)

By default `r_manipulate` **rejects** an `{"entity": <actor>}` target when
the acting entity and the target are the same entity. This preserves the
"affordances are relations to distinct objects" default.

To author a self-targeting manipulate action (e.g. Fighter **Second Wind**,
Barbarian **Rage**, or any "you regain HP / you gain advantage" class feature),
set `self_eligible = true` in the `[[action_definitions]]` row:

```toml
[[action_definitions]]
action_id    = "srd/second_wind"
bundle_id    = "srd"
display_name = "Second Wind"
required_capability = "srd/fighter/second-wind"
on_success   = "srd/second_wind/success"
self_eligible = true          # allows {"entity": <actor>} as target
```

Without the flag the call fails immediately with outcome reason
`self_target_not_eligible`. The per-actor manipulation context exposes the
self-target fact only for actions whose `self_eligible = true`.

`self_eligible = true` **admits** the acting entity as one target among
others — the affordance still fans out to every other co-located distinct
entity too. For an action that should target **only** the acting entity
(rest, meditate, a pure self-buff — never a co-located NPC), set
`self_only = true` instead (ADR-0075, amends ADR-0060):

```toml
[[action_definitions]]
action_id    = "srd/rest_long"
bundle_id    = "srd"
display_name = "Long Rest"
required_capability = "srd/rest"
on_success   = "srd/rest_long/success"
self_only = true          # ONLY {"entity": <actor>} is admitted — no distinct
                           # entity, place, or world target is offered or accepted
```

`self_only` implies self-admission — do not also set `self_eligible` on the
same row, it is redundant. A self-only action still needs its ordinary
spatial gate (`spatial_niche_attachment`) if the affordance is meant to be
node-scoped ("rest only at a campsite"); `self_only` narrows *which entity*
is targetable, it does not exempt the action from the affordance's normal
location gating.

## Args shape

`ManipulationArgs` fields all default, but `spacetime call` deserialisation is
strict — pass every field explicitly (the struct has ten fields,
the world API):

```json
{"selected_items":[],"quantity":null,"destination":null,
 "station_ref":null,"build_target":null,"required_absent_state_ids":[],
 "dispatch_text":null,"expected_participants":null,
 "participant_context":null,"semantic_context":null}
```

## Provenance visibility

Every `r_manipulate` attempt writes `evaluation_provenance`, including rejected
attempts. That row is now server-filtered: client subscriptions read
`visible_evaluation_provenance`, while the raw `evaluation_provenance` table is
private server state. Public and local provenance remains broadly readable, but
hidden provenance is visible only to an authorized owner/observer projection.

Target conditions are filtered the same way. Clients read
`visible_target_condition`; the raw `target_condition` table is private server
state. `condition_definition.observable = true` conditions remain public.
Non-observable conditions are visible to the target body and the source body that
applied them, so an author can model "the poison landed" without broadcasting the
condition to every passive client.

For authors, this means dice traces from roll-gated predicates are not a global
debug feed. Test an authored action through the acting player's connection when
you need to inspect its private roll provenance; a third-party observer may still
see public world effects, such as HP changing, without seeing the caster's hidden
dice trace.

## Worked example

A grid combat session mints an **ephemeral place-graph** at open (ADR-0052): each
participant stands on an ordinary `place_node` cell. The full chain is then plain
substrate — a tactical move is `r_move` over a grid `place_edge` (budget-gated),
and an AoE is `ForEachActorInRadius` over the grid's `place_node` positions. See
ADR-0052
and the `tactical-grid-as-place-graph` change's demo for the worked proof.

## Movement gates: capability + reach are independent

`r_move` gates a step over a `place_edge` on **two separate mechanisms** —
mixing them up costs real debugging time (a live grid-combat proof pass spent
its first hour chasing the wrong one before finding this).

1. **Capability gate — `actor.has_capability("core/walk")`.** Every core
   traversal affordance template (`core/walk_edge`,
   `core/affordance/traverse_open_portal`, `traverse_known_threshold`,
   `traverse_locked_portal`) ANDs this with `target.has_niche("core/passable_portal")`
   (`packages/spellkave-mechanics/fixtures/core/base/affordances.toml`, generated by
   `packages/spellkave-mechanics/src/core/affordances.ts`). `target.has_niche(...)` is satisfied
   automatically by attaching the template to the edge via
   `place_edge_affordance` — the traversal-affordance niche is NOT the same
   thing as a `spatial_niche_attachment` (that row anchors a *manipulation*
   capability's affordance to a place node; edge traversal never needs one).
   `actor.has_capability("core/walk")`, on the other hand, is never granted
   for free: an actor with no `core/walk` `actor_capabilities` row fails
   every move over a **core** traversal template, always with the identical
   rejection (SRD content gates its own step templates on
   `srd/capability/walk` instead, granted by the `srd.creature` identity tag;
   srd-cc `fixtures/base/playing-the-game/grid.toml`) —
   a `predicate_no_longer_holds` detail carrying `predicate_value=false`, with
   no further signal about which clause of the predicate failed.
2. **Reach gate — the OPTIONAL `movement_reach_resource` binding.** The
   binding is read off the edge's *resolved traversal mode* — a
   `place_edge_affordance` row's `bindings_json` (or a combat-grid
   blueprint's own `edge_affordance_bindings_json`), a bundle/graph-scoped
   `[[movement_defaults]]` row the edge inherits (ADR-0101,
   movement-defaults-modes-terrain-cost: ordinary edges author zero
   `place_edge_affordance` rows of their own and still resolve a reach
   binding this way — see "Movement defaults: zero rows for ordinary
   walking" below), or the two merged when the edge's own row *refines* the
   inherited default. When an edge authors more than one `mode_id`
   (alternatives — walk vs. fly vs. swim), the binding that actually applies
   to one attempt is the one on the mode `r_move` picks: the cheapest
   passing mode, not necessarily the edge's first-authored row. `r_move`
   treats the resolved resource as a per-actor movement BUDGET, in grid
   cells converted through the place graph's `metres_per_unit`. A step whose
   distance is within the budget still commits immediately. A step whose
   distance exceeds a **positive** budget is no longer refused (#2230): one
   `r_move` opens the session named by the resolved mode's
   `long_running_move_session` binding (srd authors `srd/long_running_move`;
   core authors `core/long_running_move`), the walker stays at the origin
   and is busy until `ceil(distance/speed)` of a 6000 ms round, then the
   destination write lands. Missing that binding fails loudly and names the
   binding. The travel session is Sequential with an empty
   `turn_scheduler_id` — a clock-only session, not combat initiative
   (#2232). Zero or missing speed still fails closed with
   `movement_reach_exceeded`. This check is evaluated before the capability
   predicate but is otherwise completely unrelated to it.

**The two gates are easy to conflate because an unmet capability gate gives
no signal that a reach binding even exists.** Setting `movement_reach_resource`
alone, with no capability grant, produces the exact same
`predicate_value=false` rejection as an edge with no reach binding at all —
there is nothing in the failure that distinguishes "wrong resource binding"
from "missing capability." If a move is rejected, check the capability grant
FIRST; only look at `movement_reach_resource` once capability is confirmed.

### Granting `core/walk`

`core/walk` is a **core-shipped capability** (`capability_definitions`,
bundle `core`) — it is authored nowhere per-bundle, only GRANTED. Every actor
that should traverse an edge through a **core** traversal template (including
the temporary cells a core combat-grid session opens) needs an
`actor_capabilities` row for it; SRD content uses `srd/capability/walk`
from the creature identity tag instead:

- **Verb tools:** `spellkave_bind_actor`'s `capabilities` array grants the
  declared ordinary capability. Offline authoring resolves `core/walk` against
  the canonical core target; it is not a kernel bootstrap definition.
  Reserved `frontier.*` grants instead require publisher or actor-free genesis
  admission, as [the privilege guide](./privileges.md#the-reserved-prefix) explains:

  ```jsonc
  {
    "bundle": "my_bundle",
    "entity_key": "my_bundle/npc_1",
    "capabilities": [{ "capability_id": "core/walk", "source": "core" }]
  }
  ```

- **Raw row:** `spellkave_write_rows` with `kind: "actor_capabilities"` —
  `{ actor_entity_key, capability_id: "core/walk", source: "core" }` — the
  shape every shipped fixture that moves an actor already carries (e.g.
  [`examples/authored-dark-cave.toml`](./examples/authored-dark-cave.md)'s
  `scout`/`delver` actors).

`spellkave_define_behavior`'s `grant_to` does **not** apply here: it grants
the capability the SAME call defines (a fresh `capability_id` it mints), never
a pre-existing one — it cannot be pointed at `core/walk`.

`movement_reach_resource`'s value is read off the ACTOR first (an
`object_state` row on the moving entity) and only falls back to the
`resource_definitions.initial_value` when the actor has none — the same
"a definition's `initial_value` is only the pool's bound, never a per-actor
default" gotcha every other resource pool in this corpus carries. Author a
per-actor `object_state` row on that resource id if different actors should
have different reach; everyone shares the flat definition default otherwise.

### Adjacency and co-location basics

Beyond the two gates above, `r_move` also needs the plain spatial facts in
place:

- The named `place_edge`'s `from_node_id` must equal the actor's CURRENT
  `actor_spatial_locations.place_node_id` — you can only step off the node
  you are actually standing on.
- Both `from_node_id` and `to_node_id` must resolve to REGISTERED `place_node`
  rows — specifically, nodes whose `bundle_id` is in the target bundle's
  dependency chain (the bundle itself plus everything it transitively
  `depends_on`; the world API's
  `chain_scoped_node_ids` / edge-endpoints-resolve check). A dangling
  endpoint outside that chain is a FATAL validator diagnostic at author time,
  not a runtime `r_move` rejection — it never reaches the reducer at all.
- The edge needs at least one *resolvable traversal mode* — an own
  `place_edge_affordance` row, an inherited bundle/graph
  `[[movement_defaults]]` row (see below), or a combat-grid blueprint's
  materialised edge row. An edge with none of those (and, if it opted out via
  `place_edge.inherit_movement_default = false`, no own row either) rejects
  with the same `MissingTraversalAffordance` reason as before this change,
  before either gate above is even evaluated.
- **Destination occupancy is an authored read, not a kernel veto (ADR-0134
  D-3).** `r_move` has no built-in "cell already taken" rule. Whether a step
  onto an occupied node is legal is a clause on the edge's traversal
  template, read through the `occupants_at('<scope>', '<excluding_condition>')`
  leaf: it counts actors other than the mover that hold an
  `actor_spatial_location` row on the scoped node and do not carry the named
  condition. On the traversal path the scopes are `to_node` (the edge's
  destination) and `from_node` (its origin) — the same nodes the
  `<state_id>@to_node` / `@from_node` projections read, named without the
  `@` sigil because here the scope is an argument of its own. The second
  argument is optional; omitted, every occupant counts. The SRD 5.2
  grid-step template (`srd/affordance/grid-step`, the one its combat-grid
  blueprint binds) authors `&& occupants_at('to_node', 'srd/condition/dead') == 0`:
  a living creature blocks its cell, a corpse does not, and the condition id
  is content the kernel only compares. The ambient `srd/affordance/step`
  (the bundle-wide movement default every ordinary place edge inherits)
  carries no such clause, so ambient nodes keep free co-location. A refused step surfaces as the
  ordinary traversal-predicate refusal (`failure_kind`
  `predicate_no_longer_holds`, detail `affordance_template=<id>;…`,
  ADR-0091 D-3), never a dedicated occupancy kind. A grid whose template
  reads no `occupants_at` lets actors stack (see the
  `[[combat_grid_blueprints]]` section below for the annotation that makes
  that intent explicit). Session-join seating (`select_free_grid_cell`) and
  session-open seat assignment still never seat a joiner on an occupied
  cell; those are placement rules, not movement.

### Movement defaults: zero rows for ordinary walking (ADR-0101)

Authoring one `place_edge_affordance` row per walkable edge was the only way
to make an edge traversable before movement-defaults-modes-terrain-cost. A
bundle- or graph-scoped `[[movement_defaults]]` row (authoring verb
`spellkave_set_movement_default`) now supplies the default traversal mode for
every edge that does not opt out — resolution is EDGE > GRAPH (the edge's own
`place_graph_id`) > BUNDLE (the edge's own `bundle_id`), and nothing walks
`parent_graph_id` or keys on `blueprint_id`. `place_edges.inherit_movement_default`
(default `true`) is the one per-edge escape hatch: set it `false` and the edge
owns its *entire* mode set from its own `place_edge_affordance` rows alone
(a fly-only chasm that must refuse an ordinary walker). Left `true`, an
edge's own row on the *same* `affordance_template_id` as the inherited
default *refines* it (a binding-level overlay, the edge's own value wins per
key — e.g. a two-cell-long edge overriding `movement_cost_cells`); an own row
on a *different* template AND-joins the default's mode (the locked-door
idiom keeps working with no edit); an own row under a *different* `mode_id`
is a fresh alternative the edge OR's against the default (walk-or-swim). See
`spellkave_bind_edge_affordance`'s `mode_id` / `inherit_movement_default`
parameters and `spellkave_set_movement_default` in the generated
[tool-reference](./tool-reference.md) for the exact upsert keys.

## Combat grid movement policy

Combat grids are not a second movement system. Opening a grid-backed session
creates temporary `place_node` cells and `place_edge` links on top of the current
world location. Those rows live for the session, but while the session is active
they behave like ordinary spatial substrate: a player moves from cell to cell
with `r_move`, and the movement reducer evaluates the generated edge affordance
the same way it evaluates an authored world exit.

Because every generated edge still needs a traversal affordance, a grid-backed
session points at a combat grid blueprint. The blueprint declares the grid
shape and the traversal affordance that should be materialised for generated
edges. `combat_grid_blueprints.edge_affordance_template_id` /
`edge_affordance_bindings_json` is the prior art `[[movement_defaults]]`
generalised for ordinary place graphs (ADR-0101,
movement-defaults-modes-terrain-cost, "Movement defaults" above): one
authored default template + bindings applied to every generated edge unless
`edge_overrides_json` says otherwise for that edge — the blueprint stays the
producer of concrete edge-tier rows for grids specifically (expanded once at
session open, no new precedence tier), while `[[movement_defaults]]` is the
same idea for edges that already exist in a manifest-authored place graph:

The following `example/*` rows are schematic. They demonstrate the shape of a
standard open grid; they do **not** name a kernel-seeded identity or promise that
a bundle called `example` is installed. The kernel has no implicit standard-grid
fallback: authored content must reference a blueprint that exists in its bundle
dependency closure.

```toml
[[session_definitions]]
session_def_id = "example/session/combat"
combat_grid_blueprint_id = "example/combat-grid/standard"

[[combat_grid_blueprints]]
blueprint_id = "example/combat-grid/standard"
bundle_id = "example"
width = 4
height = 4
topology = "4"
cell_size_m = 1.5240000486373901
distance_metric_id = "core/metric/manhattan"
edge_affordance_template_id = "example/affordance/step"
edge_affordance_bindings_json = '{"movement_reach_resource":"example/speed-walk"}'
edge_overrides_json = '''
[
  {"from":"c_0_0","to":"c_1_0","movement_cost_cells":2,"label":"Rough ground"},
  {"from":"c_0_1","to":"c_1_1","blocked":true,"label":"Blocked brush"}
]
'''
```

`distance_metric_id` names the `[[distance_metric_definitions]]` row the grid
measures distance under (ADR-0134): the reach gate, the
`core/distance_to_actor_mm` fact, the movement cost of a step and
opportunity-attack range all read the same metric, so they agree on every
grid. The `core` bundle seeds `core/metric/euclidean` (straight line, the
default when the field is omitted), `core/metric/chebyshev` (every straight or
diagonal step is one cell — the SRD 5.2 grid rule, the natural pair for
`topology = "8"`) and `core/metric/manhattan` (no diagonal shortcut, the
natural pair for `topology = "4"`). Topology says which cells are adjacent;
the metric says how far apart any two cells are — the two are not
cross-validated, so a `"4"` grid with Chebyshev is legal and odd. An unknown
id fails validation (`MF-VAL-332`) rather than falling back silently. Area
shapes (`point_in_shape`, node extents) keep raw Euclidean geometry whatever
the grid's metric says.

`accepts_stacked_occupancy` states that this grid lets actors share a cell.
Since ADR-0134 D-3 the kernel has no built-in occupancy veto: whether a step
onto an occupied cell is legal is a clause on the edge template, read through
`occupants_at('to_node', '<condition id>')` (the SRD 5.2 grid-step template blocks
on any living occupant and lets corpses be entered). A blueprint whose
`edge_affordance_template_id` template reads no `occupants_at` therefore
lets actors stack, and the validator refuses that silently permissive shape
with `MF-VAL-333` unless the blueprint carries
`accepts_stacked_occupancy = true` — the same intent-lives-in-a-column
pattern as `accepts_global_storm`. A template the manifest does not declare
follows the same two-tier rule as every cross-bundle reference: with the
blueprint's whole `depends_on` closure present the template is undeclared
and the check fails closed; in a per-bundle authoring run whose closure is
incomplete (a proof scene binding the base bundle's `srd/affordance/step`)
the reference is trusted and the predicate is inspected by the pass that
sees the whole closure (`just seed`, live admission).

The example above means "every adjacent combat-grid edge is openly traversable",
with two authored edge exceptions. Authors should treat it as the simplest grid
policy, not as a hard-coded combat rule. Terrain, locked cells, or flight-only
movement should change the grid blueprint or the edge affordance bindings, so
the same `r_move` path keeps carrying tactical movement — `GridEdgeOverride`
also carries `mode_id` (ADR-0101), so a generated edge can be given a fly-only
or walk-or-swim alternative the same way a manifest-authored edge can. A
`movement_cost_cells` override like `"Rough ground"` above authors a *static*
per-edge multiplier; the same generated edge's traversal template can instead
carry a `movement_cost_expression_source` that reads the incident cells'
`spatial_environment_state` (`@from_node`/`@to_node` facts, ADR-0101 D-4) — the
grid struct needs no change for that, the expression lives on the template.
The older `session_definitions.grid_edge_affordance_*` fields are a legacy
fallback for direct reducer calls that pass an explicit grid extent; authored
combat content should prefer `combat_grid_blueprint_id`.

**Walls = cover / line of sight.** A `blocked` edge override is more than
impassable terrain: it is a **wall** that also **occludes line of sight**. Metric
reachability (`r_manipulate`, the same check that gates an attack's `range_m`)
walks the cells the attacker→target line crosses and, if any crossed edge is
`blocked`, the target is *out of reach* — you cannot strike (or otherwise reach)
a target *through* a wall, even when it is metrically adjacent. So a creature
lurking behind a thicket/boulder wall has **cover**: an attacker must flank to an
open edge. Author walls by adding `{"from":"c_x_y","to":"c_a_b","blocked":true}`
overrides (both directions for a two-way wall); the kernel reads only the generic
`blocked` flag — there is no separate "wall"/"cover" vocabulary.
