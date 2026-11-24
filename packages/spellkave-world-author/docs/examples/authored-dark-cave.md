# Example - author a dark cave passage

How to seed ambient state on a passage from TOML and make traversal and
manipulation read it through authored predicates. The complete manifest form is
[`authored-dark-cave.toml`](./authored-dark-cave.toml).

The example declares `depends_on = ["core"]`: its `core/walk` and
`core/inspect` capabilities come from the mechanics core fixture, rather than
the kernel bootstrap vocabulary. The generator resolves that fixture through
a local author target while keeping only the example's own rows in the output.
For file validation, supply the dependency explicitly:

```bash
sk validate packages/spellkave-world-author/docs/examples/authored-dark-cave.toml \
  --dep packages/spellkave-mechanics/fixtures/core/manifest.toml
```

This is useful for cave darkness, smoke, noise, or other environmental facts
that should exist as world state before any reducer writes them at runtime.
If a runtime action should create the same traversal-affecting state from the
actor's current position, use an `Inscribe{spatial_environment_state}` write
with `location_ref = "ActorIncidentEdges"` as described in
[`interaction-dsl-and-world-authoring.md`](../interaction-dsl-and-world-authoring.md#runtime-ambient-state-on-incident-edges).

## The state rows

First define the vocabulary row. `value_type` says what kind of value the
instance row will carry; traversal reads the value through
`target.state("...")`.

```toml
[[spatial_state_definitions]]
state_id = "authored_dark_cave/ambient_darkness"
bundle_id = "authored_dark_cave"
value_type = "bool"
writer_policy = "manifest"
freshness_rule = ""
merge_rule = "replace"
lod_policy = "retain_latest"
description = "Darkness authored on a cave passage."
```

Then attach instance rows to the concrete place edge and the target place node.
Use `place_edge_key` in TOML for the edge row; manifest apply resolves it to the
live `place_edge_id` stored in the runtime table.

```toml
[[spatial_environment_state]]
bundle_id = "authored_dark_cave"
place_edge_key = "authored_dark_cave/edge/entrance-dark-passage"
state_id = "authored_dark_cave/ambient_darkness"
value_bool = true
visibility = "hidden"
updated_tick = 0

[[spatial_environment_state]]
bundle_id = "authored_dark_cave"
place_node_id = "authored_dark_cave/dark_passage"
state_id = "authored_dark_cave/ambient_darkness"
value_bool = true
visibility = "hidden"
updated_tick = 0
```

## The traversal predicate

Bind the edge to a traversal affordance whose predicate reads the env-state value
and allows traversal when the passage is not dark or the actor has the authored
counter-capability.

```toml
[[capability_definitions]]
capability_id = "authored_dark_cave/counter/darkvision"
bundle_id = "authored_dark_cave"
actor_kind = "entity"
display_name = "Darkvision"
description = "Counter-capability that lets an actor traverse this authored dark passage."

[[place_edge_affordance]]
edge_key = "authored_dark_cave/edge/entrance-dark-passage"
affordance_template_id = "authored_dark_cave/affordance/traverse_dark_passage"

[[affordance_templates]]
template_id = "authored_dark_cave/affordance/traverse_dark_passage"
bundle_id = "authored_dark_cave"
niche_id = "core/passable_portal"
capability_id = "core/walk"
display_name = "Traverse Dark Passage"
predicate_source = "actor.has_capability(\"core/walk\") && target.has_niche(\"core/passable_portal\") && target.state(\"authored_dark_cave/ambient_darkness\") == false || actor.has_capability(\"core/walk\") && target.has_niche(\"core/passable_portal\") && actor.has_capability(\"authored_dark_cave/counter/darkvision\")"
outcome_template_id = "core/move_outcome"
```

## The manipulation predicate

The same state value can gate a node-targeted manipulation affordance. This
fixture anchors a custom focus niche to the dark passage and overrides the core
inspect outcome with an authored predicate that allows inspection only when the
actor has the counter-capability or the node's darkness reads false.

```toml
[[spatial_niche_attachments]]
bundle_id = "authored_dark_cave"
place_node_id = "authored_dark_cave/dark_passage"
niche_id = "authored_dark_cave/dark_passage_focus"

[[affordance_templates]]
template_id = "authored_dark_cave/affordance/inspect_dark_passage"
bundle_id = "authored_dark_cave"
niche_id = "authored_dark_cave/dark_passage_focus"
capability_id = "core/inspect"
display_name = "Inspect Dark Passage"
predicate_source = "actor.has_capability(\"core/inspect\") && target.has_niche(\"authored_dark_cave/dark_passage_focus\") && target.state(\"authored_dark_cave/ambient_darkness\") == false || actor.has_capability(\"core/inspect\") && target.has_niche(\"authored_dark_cave/dark_passage_focus\") && actor.has_capability(\"authored_dark_cave/counter/darkvision\")"
outcome_template_id = "core/inspect/outcome"
```

This example does not make darkness affect perception or fog of war. Those
consequences require a separate perception layer. The row authored here is the
content-neutral environmental fact that traversal and later systems can read.

## Decaying darkness (authored staleness)

The darkness above is presence-only: it blocks until something rewrites the row.
A *time-bounded* effect — darkness that fades after N ticks — used to require a
hardcoded kernel freshness rule. It is now fully authorable, because the kernel
surfaces each env-state's `updated_tick` as the int fact `<state_id>@updated_tick`
(ADR-0056 D-4). The author reads it with `target.stat(...)` and compares against
`world.tick`; the TTL and the allow/deny meaning are authored, not built in.

```toml
[[spatial_state_definitions]]
state_id = "authored_dark_cave/decaying_darkness"
bundle_id = "authored_dark_cave"
value_type = "bool"
writer_policy = "manifest"
freshness_rule = "expires_after_ticks:5"
merge_rule = "replace"
lod_policy = "retain_latest"
description = "Magical darkness that decays 5 ticks after it was last refreshed."

[[affordance_templates]]
template_id = "authored_dark_cave/affordance/traverse_decaying_passage"
bundle_id = "authored_dark_cave"
niche_id = "core/passable_portal"
capability_id = "core/walk"
display_name = "Traverse Decaying-Dark Passage"
# Allow when: not dark, OR the dark has decayed (age beyond the 5-tick TTL),
# OR the actor has darkvision. Blocks only while the dark is still fresh.
predicate_source = "actor.has_capability(\"core/walk\") && target.has_niche(\"core/passable_portal\") && target.state(\"authored_dark_cave/decaying_darkness\") == false || actor.has_capability(\"core/walk\") && target.has_niche(\"core/passable_portal\") && world.tick - target.stat(\"authored_dark_cave/decaying_darkness@updated_tick\") > 5 || actor.has_capability(\"core/walk\") && target.has_niche(\"core/passable_portal\") && actor.has_capability(\"authored_dark_cave/counter/darkvision\")"
accepts_global_storm = true
outcome_template_id = "core/move_outcome"
```

Two things to note. `freshness_rule` is documentation of intent for the author —
the kernel no longer enforces it; your predicate does. And reading `world.tick`
makes the predicate **Global-scoped** (it must be re-evaluated as the clock
advances), so the validator requires `accepts_global_storm = true` as an explicit
acknowledgement of that re-evaluation cost (`MF-VAL-202`).

## Apply and inspect

```bash
just wipe && just seed
just seed docs/modding/examples/authored-dark-cave.toml

# Confirm the rows exist through the structured spatial surface.
spellkave place-edge list --edge-key authored_dark_cave/edge/entrance-dark-passage
spellkave place-edge inspect <edge_id_from_the_list_line>
```

If the `env-state` row uses an unknown `state_id` or points at a missing node,
edge, or location, `validate_mod_bundle` reports a finding instead of silently
accepting the row.
