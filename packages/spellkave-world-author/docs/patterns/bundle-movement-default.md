# Bundle movement default (walking with zero per-edge rows)

## Name

`bundle-movement-default` — One bundle-scoped movement default instead of per-edge affordance rows

## Problem

I want every edge in my bundle's place graphs to be walkable with the standard step policy and reach budget, without authoring a `place_edge_affordance` row on each edge.

## Forces

- Ordinary walking needs zero per-edge rows (ADR-0101 A-1); a row per edge
  is generated noise that hides the few edges that really differ.
- The kernel never names a bundle's ids: it resolves the reach resource
  and the long-running move session through binding keys.
- Resolution is per edge, EDGE > GRAPH > BUNDLE on the edge's own
  `bundle_id`; `depends_on` does **not** propagate a default, so a
  consuming bundle must declare its own row.
- An edge with no resolvable default and no rows still fails closed
  (`MissingTraversalAffordance`).

## Solution

Author ONE `[[movement_defaults]]` row per bundle (`place_graph_id = ""`,
`mode_id = ""`) naming the step affordance template plus both bindings:
`movement_reach_resource` (the per-tick reach budget) and
`long_running_move_session` (the clock-only Sequential session opened when
one hop exceeds that reach — empty scheduler on purpose, a clock not
initiative). Then:

- an edge's own row on the **same** template *refines* it (edge wins per
  binding key, e.g. a longer edge's `movement_cost_cells`);
- a row on **another** template *AND-joins* it (the locked-door idiom);
- `place_edge.inherit_movement_default = false` *replaces* it outright (a
  fly-only edge owning its whole mode set).

A consuming bundle that wants the same policy declares its own row naming
the same template and bindings. A combat-grid blueprint only chooses the
existing step policy for its generated cell edges; its geometry is the
battle-map part.

## TOML example

Copied from `packages/spellkave-adventure-kavemouth/fixtures/hamlet.manifest.toml`
(consuming bundle re-declaring the `srd` policy):

```toml
[[movement_defaults]]
affordance_template_id = "srd/affordance/step"
bindings_json = '{"movement_reach_resource":"srd/speed-walk","long_running_move_session":"srd/long_running_move"}'
bundle_id = "kavemouth"
mode_id = ""
place_graph_id = ""
```

The `srd` bundle's own row lives in
`packages/spellkave-srd-cc/fixtures/base/playing-the-game/grid.toml` beside
the `srd/combat-grid/standard-10x10` preset.

## Proof

- Kernel: the world API unit tests
  `zero_edge_rows_inherits_bundle_default` (`:263`) and
  `graph_default_beats_bundle_default` (`:340`).
- Scoping (`selected_defaults`, `movement_modes.rs:145-165`): a
  graph-scoped default (non-empty `place_graph_id`) matches on the edge's
  graph from any bundle and replaces the whole bundle-scoped set; a
  bundle-scoped default (`place_graph_id = ""`) applies only to edges of
  its own `bundle_id`.

## Related

[`long-running-actions`](../long-running-actions.md),
[`tool-reference`](../tool-reference.md) (`spellkave_set_movement_default`,
`spellkave_bind_edge_affordance`),
[`edge-traversal-resource-seed`](../repairs/edge-traversal-resource-seed.md),
[`adjacent-moves-ungated`](../repairs/adjacent-moves-ungated.md).

## Known misuse / anti-pattern

- A generated `place_edge_affordance` row on every edge.
- Expecting `depends_on` to inherit the upstream bundle's default.
- Re-authoring an adventure-namespaced copy of a shared grid preset when
  the policy is identical.

## SRD features that use this

- `srd/affordance/step` + `srd/speed-walk` + `srd/long_running_move` for
  the standalone `srd` bundle and every kavemouth graph; the shared
  `srd/combat-grid/standard-10x10` preset. Layout residue:
  [`fixtures-layout.md`](../../../spellkave-srd-cc/docs/fixtures-layout.md).
