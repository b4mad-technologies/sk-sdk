# Observability

Observer knowledge is the canonical read surface for fog-of-war style
content gates. Modders do not author `observer_knowledge` or
`observer_place_knowledge` rows directly; reducers populate them when a
body perceives an entity or place. Predicate and reducer logic should
read those tables when content depends on what an observer has already
seen.

Both tables are body-keyed. `observer_entity_id` points at
`entity.entity_id`, not an actor identity, so possession-style body
swaps use the body's memory rather than merging memories into the
steering identity. The SDK reader is `readObserverKnowledge`
(`packages/spellkave-sdk/src/core/readers/observer_knowledge.ts`). The former
worked concept tour was retired with `apps/world-walkthrough` (2026-08-11) and
survives only at `archive/apps/world-walkthrough/out/observer-knowledge.md`.

**Manifest-time knowledge is primarily co-location-shaped — and it is
indiscriminate.** There is no explicit "seed actor X knows entity Y"
row: an actor learns an entity by being co-located with it (an
NPC placed at the same `place_node_id` as a lead item seed-learns that
lead). The catch: co-location learning applies to *every* body that
enters the node, so a lead you place in a room to seed an NPC's
knowledge is also learned **for free** by any hero who later walks in —
before any share/parley act runs. This makes a `CopyKnowledgeRow`
transfer act a no-op and collapses a "the intel was absent until they
told me" negative control. If a rescued/parleyed NPC must be the
*exclusive* source of some intel, prefer a plain `[[object_state]]`
flag written by their share act (gated on the act's precondition) over a
`knows_entity` row — the flag has no co-location back-channel. Reach for
a real `knows_entity` row only when the knowledge subject can live at a
node the receiving actor never co-locates with.

**A gated affordance still appears in topology/candidate lists — only
the attempt is refused.** A `knows_entity` (or any other predicate)
gate on a `[[place_edge_affordance]]` or niche-attached affordance does
not remove the edge/target from what the client sees (`adjacentMoves()`, the
manipulation context's disclosed targets — the old per-actor affordance
cache behind `readAffordances()` is retired); the server evaluates the predicate when the
actor actually attempts the move/manipulate, and rejects with a
non-`success` status if it fails. When proving a knowledge gate is not
vacuous, assert on the *attempt's* outcome, not on absence from the
listing — asserting the edge/affordance is missing from an ignorant
actor's list will incorrectly fail even when the gate works correctly.
To diagnose *why* an attempt failed, take `provenance_id` from the act
receipt and query `spellkave_self_states` with `kind=evaluation` and
`provenance_id=<id>` (or test the formula offline with `sk eval`, see
[`rule-bench`](../rule-bench.md)) — do not query database tables directly
with SQL or inspect server logs.

**Historical (retired 2026-08-11) — a new hero-tracked resource pool needed a
second seed row, or island-suite beats saw it as permanently unset.** The
island-suite harness this paragraph describes (`apps/world-walkthrough`,
`packages/world-explorer`) and the Phandelver hero it staged are retired; the
paths now live under `archive/apps/world-walkthrough/` and
`archive/packages/world-explorer/`, and there is no live second list to keep
in sync. Kept as the motivating case for the definition-level seed below.
`[[object_state]]` pre-instantiation
against `entity_key = "phandelver/hero"` only seeds the *canonical* single-run
hero. The island-suite test harness (`apps/world-walkthrough`'s
`--only <beat>` islands) instead spawns a fresh per-island party, built by
`packages/world-explorer/src/endurance/manifest.ts`'s `partyObjectState(...)`
calls — a second, hand-maintained list of hero-tracked state ids. A resource
missing from that list reads as `UnknownField` for the party hero (ADR-0035:
unknown reads as predicate-false, never a default), so any affordance gated on
`actor.stat("your/new_pool") < 1` never materializes for island-driven beats
even though the canonical hero and `just validate` both look fine. Add the new
`state_id` to both `manifest.ts`'s hero `partyObjectState` chain and its
`toContain` assertion in `endurance.test.ts` in the same PR that authors the
pool (then-current recipe; do not follow it today).

**Alternative to `partyObjectState` — a definition-level seed reaches every
clone, not just this one harness.** `partyObjectState` only fixes the beat-island
staging path (`archive/packages/world-explorer/src/stage-beat-islands.ts`). A fact that must be readable by *any*
actor spawned from a given `entity_def_id` — a traversal-gate predicate check
like `actor.stat('your/gate_fact') < 1`, not just a hero-tracked quest pool —
is better seeded once via `[[entity_definition_initial_state]]` keyed on
`entity_def_id` (not `entity_key`): every manifest-authored entity created from
that definition picks it up at commit time
(the world API →
`definition_seed::apply_definition_seeds`), including per-island party clones
(they are manifest-authored with `entity_def_id = "phandelver/hero"`,
`archive/packages/world-explorer/src/endurance/manifest.ts`), the canonical hero, and
any future clone mechanism — with no hand-maintained TS list to keep in sync.
Needs a same-bundle `state_id` that resolves against **either**
`[[object_state_definitions]]` (the TOML section is plural — not the singular
table name) **or** `[[resource_definitions]]` — `MF-VAL-253` accepts either
catalog (widened for executable finding #10,
`packages/spellkave-srd-cc/ledger/designs/finding-10-definition-time-resource-seed.md`:
the runtime materializer already copied `state_id`/`value` verbatim
regardless of which catalog it came from, so a single authored row in either
table is sufficient — a `resource_definitions` row no longer also needs a
parallel `object_state_definitions` row just to pass this check). The
`sildar/lifecycle` pair in `sildar-companion.toml` predates the widening and
authors both for an unrelated reason (see that file's own comment); it is not
required going forward for a resource-only id. **Visibility caveat (ADR-0120):**
`entity_definition_initial_state` has no `visibility` column of its own — the
materialized `object_state` row's `VisibilityClass` falls back to `Public`
unless the `state_id` also resolves against `[[object_state_definitions]]`,
whose `default_visibility` is the only authoring surface for it; a
resource-only id has no such surface, so author a parallel
`object_state_definitions` row when Local/Hidden visibility is wanted. An explicit per-instance
`[[object_state]]` row for
one specific `entity_key` still supersedes the seed for that one instance
(author-override precedence, same file) — keep both when the canonical
instance already has its own row; there is no conflict. LR-93 fix:
`we10-nezznar-terminal.toml`'s `phandelver/w19_collapsed` statue-trap gate
(this file and `sildar-companion.toml` belonged to the retired Phandelver
bundle, deleted in `fd2288bdea`; recover via `git show`).

---

Related: start at `onramp`; search repairs with `sk docs --query "…"`.
