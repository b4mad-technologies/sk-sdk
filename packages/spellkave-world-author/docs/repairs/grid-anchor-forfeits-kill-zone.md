# Placing an actor's manifest position on a session's grid ANCHOR node forfeits its authored kill-zone cell — it row-major-falls-back instead

An actor's `combat_grid_blueprint` seat is normally snapped from its authored
`place_node_id` via `materialise_tactical_grid` (the "seating naht":
`tactical-scene-graph-model` (open with `sk docs tactical-scene-graph-model`)
§"The ONE substrate change"). That snap only fires when the actor's
`source_node` differs from the session's grid anchor node — if you place an
actor's `entity`/`actor_spatial_locations` rows AT the same node the session
opens on (e.g. to satisfy a same-node predicate like communicate-scope
comprehension, #1871), `source_node == anchor_node` and `assign_grid_seats`
treats it as unpositioned: it gets whichever cell row-major pass 2 assigns
next in participant order, NOT its old authored cell. Leftover positions on
an ephemeral tactical-grid instance
(`place_graph_definition.is_ephemeral_instance` — typically a prior
`session_grid_*`, never a name-prefix sniff) are also treated as unpositioned:
session-open ignores them and row-major-seats the participant on the new grid;
`pre_session_place_node_id` falls back to that new grid's `anchor_node_id`
rather than recording the leftover cell (BL-76). Two consequences to
plan for: (1) any walkthrough/beat asserting a specific post-open grid cell
for that actor (`c_X_Y` in a `hero.move()`/melee-range check) breaks and must
re-derive the cell empirically rather than assume the pre-relocation
position; (2) the authored kill-zone spread
(`manifest-format` (open with `sk docs manifest-format`)
`[[combat_grid_blueprints]]` §`edge_overrides_json`) degrades for that actor —
acceptable for a deliberate same-node confrontation trade-off, not something
to do accidentally.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
