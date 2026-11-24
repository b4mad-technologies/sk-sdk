# Gotcha — an edge-traversal affordance predicate reading a resource via `actor.stat(...)` needs that resource seeded on EVERY actor who might traverse the edge, and multiple `place_edge_affordance` rows on one `edge_key` AND-chain

(The `phandelver/hero` and Foundry-imported `generated/*.toml` examples are from the retired Phandelver bundle, deleted in `fd2288bdea` — recover via `git show`, see `archive/README.md`; the rule still holds.)

Two facts compound here. First, `evaluate_edge_traversal_affordances`
(the world API) ANDs every
`place_edge_affordance` row that shares a `mode_id` on one `edge_key` — every
row this gotcha talks about, like every row authored before
ADR-0101 (movement-defaults-modes-terrain-cost), carries the implicit default
`mode_id = ""`, so "every row on the edge" and "every row in the edge's
default mode" are the same set here. (A row with a *different* `mode_id`
is a separate alternative — the edge is traversable if *either* mode passes,
not both; that only matters once an edge authors more than one mode, e.g. a
walk-or-swim ford — see `spellkave_bind_edge_affordance`'s `mode_id`
parameter.) So adding a second, stricter row IN THE SAME MODE to an edge that
already carries an ungated `core/affordance/traverse_open_portal` (common on
`generated/*.toml` Foundry-imported topology, which cannot be hand-edited) is
a legitimate, harmless way to narrow traversal: the stricter row's predicate
becomes the effective gate once it goes false, while the looser row stays
true and contributes nothing. Second, per the `actor.stat(...)`
UnknownField-excludes-the-affordance gotcha in
[`sibling-resource-predicate-seeds`](./sibling-resource-predicate-seeds.md),
the predicate is evaluated against
WHICHEVER actor attempts the move — a resource seeded only on
`phandelver/hero` will wrongly reject a co-located NPC (e.g. an escaping
ally) who has no object_state row for that same resource, even while the
gate is meant to still be open. Seed the gating resource's `object_state`
row (value 0 / "not yet closed") for every actor who legitimately uses
that edge, not just the hero.

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
